// 紀錄：異動、合約、抄表、保養、翻新、選配件（欄位見 schema.js）共用的計算
//   每一筆的「設備」欄寫設備編號（24-0001），用編號對到設備（大小寫、全形半形不同也認得）
//   位置歷程：設備目前的位置＝最新一筆異動（依日期，同一天依新增的先後）的新位置；設備那一列的「位置」欄由這裡算好填上
//   目前的合約：最新一筆（依簽約日）
//   抄表用量：這次減上一次；保養填的張數一起排
const Records = (() => {
  const TABLES = ['moves', 'contracts', 'readings', 'maintenance', 'refurbs', 'parts'];
  const WORKS = ['maintenance']; // 保養也可以填張數
  const COUNTS = [['bw', '黑白'], ['color', '彩色']];
  const CONTRACT_SOON = 30; // 目前的合約這麼多天內到期時標色
  const key = v => Refs.norm(v);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const fmt = v => U.fmtNum(v);
  const firstLine = v => String(v ?? '').trim().split('\n')[0].trim();
  const daysTo = iso => Math.round((Date.parse(iso) - Date.parse(U.today())) / 86400000);
  // 表單提醒裡的短日期：今年的寫 09/25，其他年寫 2025/09/25
  const shortDate = iso => (String(iso).slice(0, 4) === U.today().slice(0, 4) ? U.fmtDate(iso).slice(5) : U.fmtDate(iso));

  // 依日期由舊到新；同一天依新增的先後（id 前段是新增的時間）
  const byDate = k => (a, b) => cmp(String(a[k] ?? ''), String(b[k] ?? '')) || cmp(String(a.id), String(b.id));

  const device = code => (key(code) ? Store.list('devices').find(d => key(d.code) === key(code)) || null : null);
  // 這台設備的紀錄（還沒有編號的設備沒有紀錄）
  const of = (table, code) => (key(code) ? Store.list(table).filter(r => key(r.device) === key(code)) : []);
  const latest = (table, code, k) => of(table, code).sort(byDate(k)).at(-1) || null;

  // 表單上位置欄（設備）下面：這台設備的編號和名稱
  const deviceNote = code => {
    const d = device(code);
    return d ? [d.code, d.name].filter(Boolean).join(' ') : '';
  };

  // 某一天設備在哪裡：那天（含）之前最後一筆異動的新位置；那天之前還沒有異動時是第一筆異動的原位置；沒有異動時是設備現在的位置
  function locationAt(code, date) {
    const moves = of('moves', code).sort(byDate('date'));
    if (!moves.length || !date) return device(code)?.location || '';
    const last = moves.filter(m => String(m.date ?? '') <= String(date)).at(-1);
    return last ? last.to : moves[0].from || '';
  }

  // 紀錄的卡片最上面一行（底部「紀錄」分頁）：那時候在哪裡、哪一台設備；找不到時提醒
  //   date 沒給時不寫位置（異動的卡片標題已經寫了）
  function deviceLine(code, date = null) {
    const d = device(code);
    if (!d) return { text: `${code || '沒有填設備'}：找不到這台設備`, warn: true };
    const where = date ? locationAt(code, date) : '';
    return { text: [where, [d.code, d.name].filter(Boolean).join(' ')].filter(Boolean).join(' · '), warn: false };
  }
  // 搜尋紀錄時，打設備名稱、現在的位置、那時候的位置都找得到
  const deviceText = (code, date = null) => [device(code)?.name, device(code)?.location, date && locationAt(code, date)].filter(Boolean).join(' ');

  // 一筆紀錄的簡短說明（儲存後的提示、提醒裡用），例如「24-0001 2026/10/11 移機」
  function describe(table, r) {
    const parts = {
      moves: [U.fmtDate(r.date), r.type],
      contracts: [U.fmtDate(r.signDate), '簽約'],
      readings: [r.month ? `${U.fmtMonth(r.month)} 抄表` : `${U.fmtDate(r.date)} 抄表`],
      maintenance: [U.fmtDate(r.date), r.item],
      refurbs: [U.fmtDate(r.date), '翻新'],
      parts: [r.name],
    }[table] || [];
    return [r.device, ...parts].filter(Boolean).join(' ');
  }

  // 卡片最下面的備註（只寫第一行）
  const noteLine = v => (firstLine(v) ? { text: firstLine(v), warn: false } : null);

  // ---------- 位置歷程 ----------
  const hasMoves = code => of('moves', code).length > 0;
  const moveTitle = r => `${r.from ? `${r.from} → ` : '→ '}${r.to || ''}`;

  // 依異動重新填設備的位置；回傳改到的設備 [{ table, id }]
  //   lost：剛刪掉（或改到別台設備）的異動；那台設備沒有異動了的話，位置回到那一筆的原位置
  //   還沒有異動的設備不動（表單上填的位置是起點）
  function syncLocations(lost = []) {
    const last = new Map();
    [...Store.list('moves')].sort(byDate('date')).forEach(m => last.set(key(m.device), m));
    const out = [];
    Store.list('devices').forEach(d => {
      const k = key(d.code);
      if (!k) return;
      const m = last.get(k);
      const back = !m && lost.find(x => key(x.device) === k);
      if (!m && !back) return;
      const loc = String((m ? m.to : back.from) ?? '');
      if (loc === String(d.location ?? '')) return;
      Store.update('devices', d.id, { location: loc });
      out.push({ table: 'devices', id: d.id });
    });
    return out;
  }

  // ---------- 合約 ----------
  const currentContract = code => latest('contracts', code, 'signDate');
  const isCurrentContract = r => currentContract(r.device)?.id === r.id;

  // 到期日：目前的合約已經到期或快到期時標色；舊的合約只寫日期
  function endText(r) {
    if (!r.endDate) return null;
    const days = daysTo(r.endDate);
    const date = U.fmtDate(r.endDate);
    if (!isCurrentContract(r)) return { text: `到期 ${date}`, warn: false };
    if (days < 0) return { text: `已到期（${date}）`, warn: true };
    if (days <= CONTRACT_SOON) return { text: days ? `剩 ${days} 天到期（${date}）` : `今天到期（${date}）`, warn: true };
    return { text: `到期 ${date}`, warn: false };
  }

  function contractNote(r) {
    const end = endText(r);
    const text = [end?.text, r.readDay && `抄表 ${firstLine(r.readDay)}`].filter(Boolean).join('・');
    return text ? { text, warn: !!end?.warn } : null;
  }

  // ---------- 抄表 ----------
  const countsText = r => COUNTS.filter(([k]) => isNum(r[k])).map(([k, label]) => `${label} ${fmt(r[k])}`).join('・');

  // 這台設備的張數：抄表和有填張數的保養，由舊到新
  const meterLine = code => [...of('readings', code), ...WORKS.flatMap(t => of(t, code)).filter(r => COUNTS.some(([k]) => isNum(r[k])))]
    .sort(byDate('date'));

  // 這一筆之前（日期較早；同一天較早新增的）最後一次有填這個張數的
  //   rec 還沒存（新增中，沒有 id）時，同一天的都算之前
  function previous(rec, k) {
    const date = String(rec.date ?? '');
    const id = rec.id ? String(rec.id) : '￿';
    return meterLine(rec.device)
      .filter(r => r.id !== rec.id && isNum(r[k]) && (cmp(String(r.date ?? ''), date) || cmp(String(r.id), id)) < 0)
      .at(-1) || null;
  }

  // 本期用量：這一筆有填的張數 [{ k, label, prev, diff }]；第一次抄表時 prev、diff 是 null
  const usage = rec => COUNTS.filter(([k]) => isNum(rec[k])).map(([k, label]) => {
    const prev = previous(rec, k);
    return { k, label, prev, diff: prev ? rec[k] - prev[k] : null };
  });

  // 抄表卡片最下面一行：本期用量；比上一次少時提醒
  function usageNote(rec) {
    const u = usage(rec);
    const less = u.filter(x => x.diff !== null && x.diff < 0);
    if (less.length) {
      return { text: less.map(x => `${x.label}比上一次少（上次 ${fmt(x.prev[x.k])}，${U.fmtDate(x.prev.date)}）`).join('；'), warn: true };
    }
    const has = u.filter(x => x.diff !== null);
    if (has.length) return { text: `本期 ${has.map(x => `${x.label} ${fmt(x.diff)}`).join('・')}`, warn: false };
    return u.length ? { text: '第一次抄表', warn: false } : null;
  }

  // 抄表卡片最下面一行：哪天抄的、本期用量（列表依結算月份分組，日期寫在這裡）
  function readingNote(rec) {
    const use = usageNote(rec);
    const text = [rec.date && `${U.fmtDate(rec.date)} 抄`, use?.text].filter(Boolean).join('・');
    return text ? { text, warn: !!use?.warn } : null;
  }

  // 表單上結算月份下面：這台設備這個月已經抄過了（重抄、換機時還是可以存）
  function monthNote(values) {
    if (!values.month || !values.device) return '';
    const dup = of('readings', values.device).find(r => r.id !== values.id && r.month === values.month);
    return dup ? { text: `這個月已經抄過了（${shortDate(dup.date)}）`, warn: true } : '';
  }

  // 表單上張數欄位下面（兩行）：上次的張數，打了這次的張數後寫本期用量；比上次少時提醒（還是可以存）
  //   values 是表單目前填的內容（張數是打的字），values.id 是正在編輯的那一筆
  function countNote(values, k) {
    const v = U.parseNum(String(values[k] ?? ''));
    const prev = values.device ? previous({ ...values, [k]: v }, k) : null;
    if (!prev) return '';
    const last = `上次 ${fmt(prev[k])}（${shortDate(prev.date)}）`;
    if (v === null) return last;
    return v < prev[k] ? { text: `${last}\n比上次少`, warn: true } : `${last}\n本期 ${fmt(v - prev[k])}`;
  }

  // ---------- 保養、翻新 ----------
  // 保養卡片最下面一行：張數、備註的第一行
  function workNote(r) {
    const text = [countsText(r), firstLine(r.note)].filter(Boolean).join('・');
    return text ? { text, warn: false } : null;
  }

  // 翻新卡片最下面一行：入庫日、工程師、國別、噴漆、原廠商
  function refurbNote(r) {
    const text = [
      r.stockDate && `${U.fmtDate(r.stockDate)} 入庫`, r.engineer, r.country, r.painted && '噴漆', r.source && `原廠商 ${r.source}`,
    ].filter(Boolean).join('・');
    return text ? { text, warn: false } : null;
  }

  // 翻新表單上序號下面：和設備現在的序號不一樣時，橘字寫設備的序號（不會去改設備，要改的話到設備「編輯」）
  function serialNote(values) {
    const now = String(device(values.device)?.serial ?? '').trim();
    const v = String(values.serial ?? '').trim();
    return v && now && key(v) !== key(now) ? { text: `設備是 ${now}`, warn: true } : '';
  }

  // ---------- 選配件 ----------
  // 裝著的在前，拆掉的在後；各自依安裝日期新到舊
  const partOrder = (a, b) => (!!a.removeDate - !!b.removeDate) || cmp(String(b.installDate ?? ''), String(a.installDate ?? ''));

  function partNote(r) {
    const text = [
      r.serial && `序號 ${r.serial}`,
      r.installDate && `${U.fmtDate(r.installDate)} 安裝`,
      r.removeDate && `${U.fmtDate(r.removeDate)} 拆除`,
      firstLine(r.note),
    ].filter(Boolean).join('・');
    return text ? { text, warn: false } : null;
  }

  // ---------- 對不上的設備 ----------
  // 找不到設備的紀錄（在試算表裡打錯了設備編號）：[{ table, rec }]
  function orphans() {
    const codes = new Set(Store.list('devices').map(d => key(d.code)).filter(Boolean));
    return TABLES.flatMap(t => Store.list(t).filter(r => !codes.has(key(r.device))).map(rec => ({ table: t, rec })));
  }

  // 同步時設備換了編號（兩台裝置各新增一台、拿到同一個編號，見 schema.js 的 fixDeviceCodes）：紀錄跟著換
  //   兩台用同一個舊編號，分不出紀錄是哪一台的：只有一台是這台裝置上新增的（還沒同步）時，
  //   這台裝置上新增的紀錄跟著這台裝置上新增的設備；分不出來時紀錄留在沒換號的那台
  //   isLocal(表, id)：這一筆是不是這台裝置上新增或改過、還沒同步的；回傳改到的 [{ table, id }]
  function followCodes(fixed, isLocal) {
    const out = [];
    fixed.filter(f => f.from).forEach(f => {
      const kept = Store.list('devices').find(d => d.id !== f.id && key(d.code) === key(f.from));
      const mine = isLocal('devices', f.id);
      if (kept && isLocal('devices', kept.id) === mine) return;
      TABLES.forEach(t => of(t, f.from).filter(r => !kept || isLocal(t, r.id) === mine).forEach(r => {
        Store.update(t, r.id, { device: f.to });
        out.push({ table: t, id: r.id });
      }));
    });
    return out;
  }

  return {
    TABLES, firstLine, noteLine, device, of, latest, deviceNote, locationAt, deviceLine, deviceText, describe,
    hasMoves, moveTitle, syncLocations,
    currentContract, isCurrentContract, contractNote, endText,
    countsText, usage, usageNote, readingNote, monthNote, countNote,
    workNote, refurbNote, serialNote,
    partOrder, partNote, orphans, followCodes,
  };
})();
