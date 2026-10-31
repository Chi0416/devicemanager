// 詳情頁：設備詳情（Detail）、位置詳情（Place）、客戶詳情（Customer）共用 createDetail
//   上面：資訊卡（設備下面接最新回報、耗材，位置下面接用量）；下面：一張表一列，寫最新的狀況和筆數
//     點一列打開那張表的頁面（只列這台設備、這個位置的紀錄，右上角新增）；右邊的「＋」直接新增
//     那一頁平常是卡片列表（list.js）；列上有 view 時用它自己的畫法（位置的異動：一台待過一段一張卡片）
//   右上角「編輯」打開那一筆的表單；那一筆被刪掉時這一頁跟著關
//   設備：點設備卡片打開（見 app.js）；標題、資訊卡寫機型＋名稱（編號不顯示）；資訊卡上點位置打開位置詳情
//     在這裡新增紀錄時自動帶入這台設備；合約是它現在所在位置的，新增時帶入這個位置
//   位置：位置頁點一張卡片打開（見 places.js）；標題寫位置名稱；資訊卡上點客戶打開客戶詳情、點現在放著的機器打開設備詳情
//     異動：這裡放過哪些機器，一台待過一段一張卡片（那一列寫最近一次進出、右邊寫幾段）；合約：包含這個位置的；抄表、保養、翻新：機器放在這裡的期間做的（照日期從異動算）
//     新增抄表、保養、翻新時，這裡只放著一台的話帶入那一台；卡片標題右邊灰字寫哪一台，只放過一台的不寫
function createDetail({ table, dlg, sub, title, infoHTML, rows, onInfoClick = () => {} }) {
  const titleEl = dlg.querySelector('.sheet-title');
  const bodyEl = dlg.querySelector('.sheet-body');
  const infoEl = dlg.querySelector('.detail-info');
  const rowsEl = dlg.querySelector('.detail-rows');
  const subTitle = sub.querySelector('.sheet-title');
  const subBody = sub.querySelector('.sheet-body');
  let id = null;   // 打開的那一筆
  let open = null; // 打開的那張表

  const current = () => (id ? Store.get(table, id) : null);
  const rowOf = key => rows.find(r => r.key === key);

  const lists = Object.fromEntries(rows.map(r => {
    const opts = { openForm: rid => Form.open(r.key, rid), rows: () => (current() ? r.records(current()) : []) };
    const aside = r.aside ? rec => r.aside(rec, current()) : null;
    return [r.key, r.view ? r.view(opts) : createList(r.key, SCHEMAS[r.key], { ...opts, detail: true, aside })];
  }));
  Object.values(lists).forEach(l => subBody.appendChild(l.el));

  // 每一列：summary(這一筆) → { main, sub, warn }
  function rowHTML(row, x) {
    const s = row.summary(x);
    const n = row.records(x).length;
    const what = SCHEMAS[row.key].title;
    return `
      <li>
        <button type="button" class="list-item" data-open="${row.key}">
          <span class="row-label">${row.label}</span>
          <span class="member-info"><b class="${s.warn ? 'warn' : ''}">${U.esc(s.main)}</b>${s.sub ? `<small>${U.esc(s.sub)}</small>` : ''}</span>
          <span class="uses">${n || ''}</span><span class="go" aria-hidden="true">›</span>
        </button>
        ${Records.canAdd(row.key) ? `<button type="button" class="row-add" data-add="${row.key}" aria-label="新增${what}">＋</button>` : ''}
      </li>`;
  }

  function render() {
    const x = current();
    if (!x) {
      if (sub.open) sub.close();
      if (dlg.open) dlg.close();
      return;
    }
    titleEl.textContent = title(x);
    infoEl.innerHTML = infoHTML(x);
    rowsEl.innerHTML = rows.map(r => rowHTML(r, x)).join('');
    if (open) {
      subTitle.textContent = `${title(x)} ${rowOf(open).label}`;
      lists[open].refresh();
    }
  }

  // ---------- 動作 ----------
  // 已經打開（被別的詳情蓋住）時重新打開，放到最上面
  function show(recId) {
    if (!Store.get(table, recId)) return;
    id = recId;
    render();
    if (dlg.open) dlg.close();
    dlg.showModal();
    bodyEl.scrollTop = 0;
  }

  // 一張表的頁面：這一筆的紀錄
  function openTable(key) {
    open = key;
    // 業務員只能新增抄表、保養（見 records.js 的 canAdd）
    sub.querySelector('[data-act="add"]').style.visibility = Records.canAdd(key) ? '' : 'hidden';
    Object.entries(lists).forEach(([k, l]) => { l.el.hidden = k !== key; });
    lists[key].reset();
    render();
    if (!sub.open) sub.showModal();
    subBody.scrollTop = 0;
  }

  const add = key => Form.open(key, null, rowOf(key).preset(current()));

  // 資料改了（新增、修改、刪除、同步）：重畫；剛改的那筆紀錄閃一下
  function changed(key, rec) {
    if (!dlg.open) return;
    render();
    if (sub.open && rec && key === open) lists[key].changed(rec);
  }

  function init() {
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-act="edit"]').addEventListener('click', () => Form.open(table, id));
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // 點背景關閉
    infoEl.addEventListener('click', onInfoClick);
    rowsEl.addEventListener('click', e => {
      const plus = e.target.closest('[data-add]');
      if (plus) {
        add(plus.dataset.add);
        return;
      }
      const row = e.target.closest('[data-open]');
      if (row) openTable(row.dataset.open);
    });
    sub.querySelector('[data-act="close"]').addEventListener('click', () => sub.close());
    sub.querySelector('[data-act="add"]').addEventListener('click', () => add(open));
    sub.addEventListener('click', e => { if (e.target === sub) sub.close(); });
    sub.addEventListener('close', () => { open = null; });
  }

  return { init, open: show, changed, refresh: () => changed(null, null) };
}

// 兩個詳情共用的列：合約（目前的合約到期日、合約內容第一行）、抄表（最近一次哪天抄、哪個月的帳）、保養和翻新（最近一次那天做了什麼）
//   粗體那行有日期時，日期寫在最前面，不加括號
const DetailRows = {
  // c：目前的合約；all：這個位置所有的合約（提前結束、到期之後沒有新的，寫最後那一份怎麼結束的）
  contract(c, all = []) {
    if (!c && all.length) return { main: '沒有目前的合約', sub: Records.endText(all.at(-1))?.text || '' };
    if (!c) return { main: '還沒有合約' };
    const end = Records.endText(c);
    return { main: end?.text || `${U.fmtDate(c.signDate)} 簽約`, sub: Records.firstLine(c.content), warn: !!end?.warn };
  },

  reading(list) {
    const r = [...list].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.id).localeCompare(String(b.id))).at(-1);
    if (!r) return { main: '還沒有抄表' };
    const use = Records.readingUse(r);
    const sub = [r.month && `${U.fmtMonth(r.month)} 帳`, use?.text].filter(Boolean).join('・');
    return { main: `${U.fmtDate(r.date)} 抄表`.trim(), sub, warn: !!use?.warn };
  },

  // 同一趟換了好幾樣，全部列出來
  work(list, table, what, note = Records.workNote) {
    const last = list.reduce((m, r) => (String(r.date ?? '') > m ? String(r.date ?? '') : m), '');
    if (!list.length) return { main: `還沒有${SCHEMAS[table].title}` };
    const day = list.filter(x => String(x.date ?? '') === last);
    const notes = day.map(x => note(x)?.text).filter(Boolean);
    return { main: `${U.fmtDate(last)} ${day.map(what).filter(Boolean).join('、')}`.trim(), sub: notes.join('；') };
  },
};

// ---------- 設備詳情 ----------
const Detail = (() => {
  const statusField = SCHEMAS.devices.fields.find(f => f.key === 'status');
  const mine = key => d => Records.of(key, d.code);
  const withDevice = d => ({ device: d.code });
  // 新增異動：類型先選好（機器在倉庫先選安裝，在客戶那裡先選撤機）
  const moveOf = d => ({ device: d.code, type: Records.moveTypeFor(d) });

  function infoHTML(d) {
    const tone = Refs.tone('statuses', Refs.find(statusField, d.status));
    const cells = [['序號', d.serial], ['主機板號碼', d.board], ['保管人', d.keeper]]
      .map(([label, v]) => `<span class="cell"><small>${label}</small><span>${U.esc(v) || '—'}</span></span>`).join('');
    const w = warrantyNote(d);
    const p = Records.place(d.location);
    return `
      <div class="detail-card">
        <span class="card-top">
          <span class="card-title">${U.esc(Records.label(d))}</span>
          ${d.status ? `<span class="badge ${U.esc(tone)}">${U.esc(d.status)}</span>` : ''}
        </span>
        <span class="card-grid">${cells}</span>
        ${w ? `<span class="card-note${w.warn ? ' warn' : ''}">${U.esc(w.text)}</span>` : ''}
        ${p ? `<button type="button" class="detail-link" data-place="${U.esc(p.id)}"><small>位置</small><span>${U.esc(p.name)}</span><span class="go" aria-hidden="true">›</span></button>` : ''}
      </div>
      ${latestHTML(d)}
      ${consumablesHTML(d)}`;
  }

  // 最新回報：抄表程式最新一次回報的張數、碳粉（找哪一筆、多久以前見 records.js 的 latestReport）
  //   右上角回報的日期時間和幾天前（今天、昨天、N 天前），抄表跟客戶確認日期時一眼看得出多舊；今天、昨天綠字，超過 3 天橘字，中間灰字（跟設備卡片一樣）
  //   黑白、彩色張數兩格；K Y M C 四格（黑白機 Y M C 都沒有時只有 K，讀不到的「—」）；20% 以下紅字；百分比下面一條碳粉顏色的細條（讀不到的只有灰色底條）
  //   有張數時最下面一個「抄表」：打開抄表表單，帶入這台、回報的日期和張數，結算月份自己選
  //   沒回報過的也顯示：張數、四格「—」、灰色底條，右上角「還沒有回報」
  function latestHTML(d) {
    const t = Records.latestReport(d);
    const count = v => (v === null || v === undefined ? '<span class="muted">—</span>' : `<span>${U.fmtNum(v)}</span>`);
    const counts = [['黑白', t?.bw], ['彩色', t?.color]].map(([label, v]) => `<span class="cell"><small>${label}</small>${count(v)}</span>`).join('');
    const colors = !t || ['Y', 'M', 'C'].some(c => t[c] !== null) ? ['K', 'Y', 'M', 'C'] : ['K'];
    const cells = colors.map(c => {
      const v = t ? t[c] : null;
      const cls = v === null ? 'muted' : v <= Records.TONER_LOW ? 'low' : '';
      const bar = `<i class="toner-bar t-${c.toLowerCase()}" aria-hidden="true"><b style="width:${v ?? 0}%"></b></i>`;
      return `<span class="cell"><small>${c}</small><span class="${cls}">${v === null ? '—' : `${v}%`}</span>${bar}</span>`;
    }).join('');
    const days = Records.reportDays(t);
    const when = !t ? '還沒有回報' : days === null ? '—' : Records.reportWhen(t);
    const read = Number.isInteger(t?.bw) && t.date && Records.canAdd('readings')
      ? `<button type="button" class="detail-link" data-read="${U.esc(d.id)}"><small>抄表</small><span>帶入這次的日期和張數</span><span class="go" aria-hidden="true">›</span></button>` : '';
    return `
      <div class="detail-card toner-card">
        <span class="uc-head"><b>最新回報</b><span class="${Records.reportTone(days)}">${U.esc(when)}</span></span>
        <span class="card-grid latest-counts">${counts}</span>
        <span class="card-grid toner-grid">${cells}</span>
        ${read}
      </div>`;
  }

  // 「抄表」：日期、張數用回報的，結算月份空著自己選；日期跟客戶確認過不一樣時再改
  function readFromLatest(d) {
    const t = Records.latestReport(d);
    if (!t) return;
    Form.open('readings', null, { device: d.code, date: t.date, bw: t.bw, color: t.color ?? '' },
      { message: `已帶入最新回報（${Records.reportWhen(t)}），結算月份自己選` });
  }

  // 耗材：這台的碳粉、感光鼓…，從裝進現在這個位置那天算（見 records.js 的 consumablesAt）；在倉庫、一格放好幾台的不算
  //   一項一列：壽命（設定的，或在這裡換過的平均）、已用幾 %（細長條，快到了橘色、超過紅色）、上次換哪天、預估什麼時候到
  //   還算不出平均的：寫換過幾次、上次換到現在印了幾張
  function consumablesHTML(d) {
    const list = Records.consumablesAt(d.location).filter(x => x.device.id === d.id);
    if (!list.length) return '';
    const n = v => U.fmtNum(v);
    const rows = list.map(x => {
      const life = x.lifeSet ? `壽命 ${n(x.life)} 張（設定）` : x.avg ? `平均每支 ${n(x.avg)} 張` : '';
      const times = x.count ? `換過 ${x.count} 次` : '';
      const head = [life, times].filter(Boolean).join('・');
      const start = x.start ? `${x.start.install ? '安裝' : '上次換'} ${U.fmtDate(x.start.date)}` : '';
      const tone = x.over ? 'danger' : x.soon ? 'warn' : '';
      // 起點那天沒有張數（安裝當天沒抄表、換的那天前後都沒有抄表）：算不出用了多少，不畫長條
      if (x.used === null) {
        return `<li class="cons-row"><span class="cons-top"><b>${U.esc(x.item)}</b><span>${U.esc(head)}</span></span>
          <span class="cons-sub"><span>${U.esc(start)}</span></span>
          <small>${x.start?.install ? '安裝那天' : '換的那天'}沒有張數，算不出用了多少</small></li>`;
      }
      if (!x.life) {
        return `<li class="cons-row"><span class="cons-top"><b>${U.esc(x.item)}</b><span>${U.esc(head)}</span></span>
          <span class="cons-sub">${U.esc([start, x.used !== null && `到現在${x.approx ? '約 ' : ' '}${n(x.used)} 張`].filter(Boolean).join('・'))}</span>
          <small>再換一次才算得出平均</small></li>`;
      }
      const pct = Math.round((x.pct || 0) * 100);
      const when = x.over ? '已經超過了' : x.eta ? `預估 ${Records.etaText(x.eta)}${x.kind === 'color' || /碳粉/.test(x.item) ? '用完' : '到'}` : '';
      return `<li class="cons-row"><span class="cons-top"><b>${U.esc(x.item)}</b><span>${U.esc(head)}</span></span>
        <span class="meter ${tone}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(pct, 100)}" aria-label="${U.esc(x.item)}已用 ${pct}%"><i style="width:${Math.min(pct, 100)}%"></i></span>
        <span class="cons-sub"><span>已用 ${pct}%${x.used !== null ? `（${x.approx ? '約 ' : ''}${n(x.used)} 張）` : ''}</span><span class="${tone}">${U.esc(when)}</span></span>
        <small>${U.esc(start)}</small></li>`;
    }).join('');
    return `
      <div class="detail-card cons-card">
        <span class="uc-head"><b>耗材</b></span>
        <ul class="cons-list">${rows}</ul>
      </div>`;
  }

  function locationRow(d) {
    const m = Records.latest('moves', d.code, 'date');
    return { main: Records.placeName(d.location) || '還沒有填位置', sub: m ? `${U.fmtDate(m.date)} ${m.type}` : '' };
  }

  function partsRow(d) {
    const on = Records.of('parts', d.code).filter(p => !p.removeDate).map(p => p.name);
    return { main: on.length ? on.join('、') : '沒有裝選配件' };
  }

  return createDetail({
    table: 'devices',
    dlg: document.getElementById('detail-sheet'),
    sub: document.getElementById('sub-sheet'),
    title: d => Records.label(d) || '設備',
    infoHTML,
    onInfoClick(e) {
      const link = e.target.closest('[data-place]');
      if (link) Place.open(link.dataset.place);
      const read = e.target.closest('[data-read]');
      if (read && Store.get('devices', read.dataset.read)) readFromLatest(Store.get('devices', read.dataset.read));
    },
    rows: [
      { key: 'moves', label: '位置', summary: locationRow, records: mine('moves'), preset: moveOf },
      // 合約綁位置：這台現在所在位置的合約
      { key: 'contracts', label: '合約', summary: d => DetailRows.contract(Records.deviceContract(d.code), Records.contractsAt(d.location)),
        records: d => Records.contractsAt(d.location), preset: d => ({ locations: d.location || '' }) },
      { key: 'readings', label: '抄表', summary: d => DetailRows.reading(Records.of('readings', d.code)), records: mine('readings'), preset: withDevice },
      { key: 'maintenance', label: '保養', summary: d => DetailRows.work(Records.of('maintenance', d.code), 'maintenance', r => r.item),
        records: mine('maintenance'), preset: withDevice },
      { key: 'refurbs', label: '翻新',
        summary: d => DetailRows.work(Records.of('refurbs', d.code), 'refurbs', r => Records.firstLine(r.content), Records.refurbNote),
        records: mine('refurbs'), preset: withDevice },
      { key: 'parts', label: '配件', summary: partsRow, records: mine('parts'), preset: withDevice },
    ],
  });
})();

// ---------- 位置詳情 ----------
const Place = (() => {
  // 紀錄卡片標題右邊：哪一台（位置都一樣，不用寫；和異動卡片一樣，見 records.js 的 recordCells）；找不到設備時橘字
  //   這個位置只放過一台的不寫（每張都一樣）
  const machine = (r, p) => {
    const cell = Records.recordCells('moves', r)[0];
    const one = new Set(Records.staysAt(p.code).map(s => Refs.norm(s.device))).size <= 1;
    return one && !cell.warn ? null : { text: cell.value, warn: cell.warn };
  };
  // 這裡只放著一台時，新增紀錄帶入那一台
  const theOne = p => {
    const on = Records.machinesAt(p.code);
    return on.length === 1 ? { device: on[0].code } : {};
  };
  const at = key => p => Records.recordsAt(key, p.code);
  // 新增異動：空的位置先選安裝、裝到這裡；放著一台時先選撤機、撤的是那一台；倉庫先選撤機、撤到這裡
  const moveHere = p => {
    const on = Records.machinesAt(p.code);
    return !p.stock && on.length === 1 ? { device: on[0].code, type: '撤機' } : { to: p.code, type: Records.moveTypeAt(p) };
  };
  // 現在放著的機器：三台以內一台一個按鈕（點了打開設備詳情），多的寫幾台
  const MAX_LINKS = 3;

  function infoHTML(p) {
    const on = Records.machinesAt(p.code);
    const olds = String(p.oldNames ?? '').split('\n').map(x => x.trim()).filter(Boolean);
    const links = on.length <= MAX_LINKS ? on.map(d =>
      `<button type="button" class="detail-link" data-device="${U.esc(d.id)}"><small>設備</small><span>${U.esc(Records.label(d))}</span><span class="go" aria-hidden="true">›</span></button>`).join('')
      : `<span class="card-note">現在放著 ${on.length} 台</span>`;
    return `
      <div class="detail-card">
        <span class="card-top">
          <span class="card-title">${U.esc(p.name)}</span>
          ${p.stock ? '<span class="badge purple">倉庫</span>' : ''}
          ${p.disabled ? '<span class="badge gray">停用</span>' : ''}
        </span>
        ${!p.stock && p.sales ? `<span class="card-sub">業務員：${U.esc(p.sales)}</span>` : ''}
        ${p.address ? `<span class="card-sub">地址：${U.esc(p.address)}</span>` : ''}
        ${olds.length ? `<span class="card-sub">以前叫：${U.esc(olds.join('、'))}</span>` : ''}
        ${p.note ? `<span class="card-sub">${U.esc(Records.firstLine(p.note))}</span>` : ''}
        ${customerLink(p)}
        ${on.length ? links : '<span class="card-note">現在沒有機器</span>'}
      </div>
      ${p.stock ? '' : usageHTML(p)}`;
  }

  // 客戶：點了打開客戶詳情；客戶清單裡找不到（試算表裡打的）的只寫名字
  function customerLink(p) {
    if (p.stock || !String(p.customer ?? '').trim()) return '';
    const c = Records.customerOf(p);
    return c ? `<button type="button" class="detail-link" data-customer="${U.esc(c.id)}"><small>客戶</small><span>${U.esc(c.name)}</span><span class="go" aria-hidden="true">›</span></button>`
      : `<span class="card-sub">客戶：${U.esc(p.customer)}</span>`;
  }

  // 用量：最近 12 個月的長條圖（下面黑白、上面彩色，一季抄的同一季三個月一樣高，見 records.js 的 monthlyUsage）
  //   點一條，下面那一行寫那個月的張數；打開時寫最近一個月；最下面寫最近一期跟上一期、去年同期比
  const num = v => U.fmtNum(Math.round(v));
  const monthText = m => `${m.slice(0, 4)}/${m.slice(5)}`;
  // 點了的那個月：大字寫總張數，下面小字寫黑白、彩色
  function pickHTML(m) {
    if (!m) return '';
    if (m.total === null) return `<b>${monthText(m.month)} 沒有抄表</b>`;
    const parts = [m.bw !== null && `黑白 ${num(m.bw)}`, m.color !== null && `彩色 ${num(m.color)}`].filter(Boolean);
    return `<b>${monthText(m.month)}　${num(m.total)} 張</b><small>${parts.join('・')}</small>`;
  }
  const pickText = m => pickHTML(m).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // 刻度取整數（1,000、2,000、5,000…）
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(x => x * p).find(x => x >= v);
  }
  function usageHTML(p) {
    const periods = Records.placeUsage(p.code);
    const months = Records.monthlyUsage(periods);
    if (!months.length) {
      return '<div class="detail-card usage-card"><span class="uc-head"><b>用量</b></span><span class="card-note">還沒有用量：要抄過兩次表才算得出來</span></div>';
    }
    const top = niceMax(Math.max(...months.map(m => m.total || 0)));
    const last = [...months].reverse().find(m => m.total !== null);
    const s = Records.usageSummary(periods);
    const yoy = Records.yearOverYear(periods);
    const pct = r => `${r >= 0 ? '↑' : '↓'}${Math.abs(Math.round(r * 100))}%`;
    const sum = [`最近一期 ${s.label} ${num(s.total)} 張`, s.change !== null && `比上一期 ${pct(s.change)}`, yoy !== null && `比去年同期 ${pct(yoy)}`]
      .filter(Boolean).join('・');
    const cols = months.map(m => {
      const h = m.total ? Math.max(2, m.total / top * 100) : 0;
      const seg = (cls, v) => (v ? `<i class="${cls}" style="flex-grow:${v}"></i>` : '');
      return `<button type="button" class="uc-col${m === last ? ' on' : ''}" data-um="${m.month}" data-pick="${U.esc(pickHTML(m))}" aria-label="${U.esc(pickText(m))}">
        <span class="uc-plot"><span class="uc-bar" style="height:${h.toFixed(1)}%">${seg('uc-c', m.color)}${seg('uc-b', m.bw)}</span></span>
        <small>${Number(m.month.slice(5))}</small></button>`;
    }).join('');
    return `
      <div class="detail-card usage-card">
        <span class="uc-head"><b>用量</b><span>${monthText(months[0].month)}–${monthText(months.at(-1).month)}・每月</span></span>
        <div class="uc-chart"><span class="uc-tick">${num(top)}</span>${cols}</div>
        <span class="uc-legend"><span><i class="uc-b"></i>黑白</span><span><i class="uc-c"></i>彩色</span></span>
        <span class="uc-pick">${pickHTML(last)}</span>
        <span class="card-note">${U.esc(sum)}</span>
      </div>`;
  }

  // 異動那一列：最近一次進出的機器，下面寫日期、類型（跟設備詳情的位置那一列一樣）；離開的接到哪裡去（2026/04/21 移機到 XX）
  function moveRow(p) {
    const m = Records.lastMoveAt(p.code);
    if (!m) return { main: '還沒有異動' };
    const left = Refs.norm(m.to) !== Refs.norm(p.code) && Records.placeName(m.to);
    return {
      main: Records.label(Records.device(m.device)) || m.device,
      sub: `${U.fmtDate(m.date)} ${m.type || ''}${left ? `到${left}` : ''}`.trim(),
    };
  }

  // 異動那一頁：這裡放過哪些機器，一台待過一段一張卡片（見 records.js 的 staysAt），現在放著的在最上面
  //   卡片：機型＋名稱，右邊待了多久；下面左右兩格「進來」「離開」：小標題旁邊寫日期，下面寫類型、從哪裡來／到哪裡去、備註第一行
  //   點一格打開那筆異動；開始記異動之前就在這裡的，進來寫「沒有紀錄」；還在這裡的，離開寫「還在這裡」（綠字）
  function staysView({ rows, openForm }) {
    const el = document.createElement('section');
    el.className = 'panel';
    el.hidden = true;
    el.innerHTML = '<div class="list"></div>';
    const listEl = el.querySelector('.list');
    let flashId = null;
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-move]');
      if (btn) openForm(btn.dataset.move);
    });

    const where = (m, dir, p) => [m.type, Records.placeName(p) && `${dir}${Records.placeName(p)}`].filter(Boolean).join('，') || '異動';
    const cell = (label, m, text) => `
      <button type="button" class="stay-cell" data-move="${U.esc(m.id)}">
        <small>${label} ${U.esc(U.fmtDate(m.date))}</small>
        <b>${U.esc(text)}<span class="go" aria-hidden="true">›</span></b>
        ${Records.firstLine(m.note) ? `<span class="stay-note">${U.esc(Records.firstLine(m.note))}</span>` : ''}
      </button>`;
    const plain = (label, text, cls) => `<span class="stay-cell ${cls}"><small>${label}</small><b>${text}</b></span>`;
    function cardHTML(s) {
      const d = Records.device(s.device);
      const span = s.in ? Records.spanText(s.in.date, s.out ? s.out.date : U.today()) : '';
      const flash = flashId && [s.in?.id, s.out?.id].includes(flashId);
      return `
        <div class="card stay-card${flash ? ' flash' : ''}">
          <span class="card-top">
            <span class="card-title">${U.esc(Records.label(d) || s.device)}</span>
            ${span ? `<span class="card-side">${U.esc(span)}</span>` : ''}
          </span>
          <span class="stay-grid">
            ${s.in ? cell('進來', s.in, where(s.in, '從', s.in.from)) : plain('進來', '沒有紀錄', 'none')}
            ${s.out ? cell('離開', s.out, where(s.out, '到', s.out.to)) : plain('離開', '還在這裡', 'now')}
          </span>
        </div>`;
    }

    function refresh() {
      const list = rows();
      listEl.innerHTML = list.length ? list.map(cardHTML).join('') : '<p class="empty">還沒有異動</p>';
      flashId = null;
    }
    return { el, refresh, reset: refresh, changed(rec) { flashId = rec?.id ?? null; refresh(); } };
  }

  return createDetail({
    table: 'locations',
    dlg: document.getElementById('place-sheet'),
    sub: document.getElementById('place-sub-sheet'),
    title: p => p.name || '位置',
    infoHTML,
    onInfoClick(e) {
      const link = e.target.closest('[data-device]');
      if (link) Detail.open(link.dataset.device);
      const cust = e.target.closest('[data-customer]');
      if (cust) Customer.open(cust.dataset.customer);
      // 用量的長條：點一條，下面寫那個月的張數
      const col = e.target.closest('[data-um]');
      if (col) {
        const card = col.closest('.usage-card');
        card.querySelectorAll('.uc-col.on').forEach(c => c.classList.remove('on'));
        col.classList.add('on');
        card.querySelector('.uc-pick').innerHTML = col.dataset.pick;
      }
    },
    rows: [
      { key: 'moves', label: '異動', summary: moveRow, records: p => Records.staysAt(p.code), preset: moveHere, view: staysView },
      { key: 'contracts', label: '合約', summary: p => DetailRows.contract(Records.currentContract(p.code), Records.contractsAt(p.code)),
        records: p => Records.contractsAt(p.code), preset: p => ({ locations: p.code }) },
      { key: 'readings', label: '抄表', summary: p => DetailRows.reading(at('readings')(p)), records: at('readings'), preset: theOne, aside: machine },
      { key: 'maintenance', label: '保養', summary: p => DetailRows.work(at('maintenance')(p), 'maintenance', r => r.item),
        records: at('maintenance'), preset: theOne, aside: machine },
      { key: 'refurbs', label: '翻新', summary: p => DetailRows.work(at('refurbs')(p), 'refurbs', r => Records.firstLine(r.content), Records.refurbNote),
        records: at('refurbs'), preset: theOne, aside: machine },
    ],
  });
})();

// ---------- 客戶詳情 ----------
//   客戶頁點一張卡片（見 customers.js）、位置詳情點客戶打開；標題寫客戶名稱
//   資訊卡：統編、主要業務員、電話、傳真、聯絡人、帳單地址、送貨地址、備註；有母公司的點了打開母公司
//   旗下公司（母公司才有）：一間一列，寫幾個位置，點了打開那間
//   位置：一個位置一列，名稱下面寫現在放的機器（停用的灰字），點了打開位置詳情；母公司自己沒有位置的不寫
//   下面一列合約：這些位置的合約（一份寫好幾個位置的只算一份）
const Customer = (() => {
  const placesOf = c => Records.customerPlaces(c);
  const link = (attr, id, label, text) =>
    `<button type="button" class="detail-link" data-${attr}="${U.esc(id)}"><small>${label}</small><span>${U.esc(text)}</span><span class="go" aria-hidden="true">›</span></button>`;
  // 一列：名稱（藍字），下面一行小字；點了打開位置詳情或那間公司
  const rowHTML = (attr, id, name, sub, off = false) => `
    <button type="button" class="cust-row${off ? ' off' : ''}" data-${attr}="${U.esc(id)}">
      <span class="cust-main"><b>${U.esc(name)}</b>${sub ? `<small>${U.esc(sub)}</small>` : ''}</span><span class="go" aria-hidden="true">›</span>
    </button>`;

  function infoHTML(c) {
    const cell = ([label, v, wide]) => `<span class="cell${wide ? ' wide' : ''}"><small>${label}</small><span>${U.esc(v) || '—'}</span></span>`;
    const cells = [['統一編號', c.taxId], ['主要業務員', c.sales], ['電話', c.phone], ['傳真', c.fax], ['聯絡人', c.contact, true],
      ['帳單地址', c.billAddress, true], ['送貨地址', c.shipAddress, true]].map(cell).join('');
    const parent = Records.customer(c.parent);
    return `
      <div class="detail-card">
        <span class="card-top"><span class="card-title">${U.esc(c.name)}</span></span>
        <span class="card-grid">${cells}</span>
        ${c.note ? `<span class="card-sub">${U.esc(Records.firstLine(c.note))}</span>` : ''}
        ${parent ? link('customer', parent.id, '母公司', parent.name) : c.parent ? `<span class="card-sub">母公司：${U.esc(c.parent)}</span>` : ''}
      </div>
      ${kidsHTML(c)}
      ${placesHTML(c)}`;
  }

  function kidsHTML(c) {
    const kids = Records.childrenOf(c);
    if (!kids.length) return '';
    return `
      <div class="detail-card cust-card">
        <span class="uc-head"><b>旗下公司</b><span>${kids.length} 間</span></span>
        ${kids.map(k => rowHTML('customer', k.id, k.name, placesOf(k).length ? `${placesOf(k).length} 個位置` : '還沒有位置')).join('')}
      </div>`;
  }

  // 停用的排在後面；母公司自己沒有位置的不寫
  function placesHTML(c) {
    const list = [...placesOf(c)].sort((a, b) => !!a.disabled - !!b.disabled);
    if (!list.length && Records.childrenOf(c).length) return '';
    const on = list.filter(p => !p.disabled);
    const n = on.reduce((sum, p) => sum + Records.machinesAt(p.code).length, 0);
    const sub = p => {
      if (p.disabled) return '停用';
      const ms = Records.machinesAt(p.code);
      return ms.length > 1 ? `${ms.length} 台` : ms.length ? Records.label(ms[0]) : '空著';
    };
    return `
      <div class="detail-card cust-card">
        <span class="uc-head"><b>位置</b><span>${list.length ? `${on.length} 個・${n} 台機器` : ''}</span></span>
        ${list.length ? list.map(p => rowHTML('place', p.id, p.name || p.code, sub(p), p.disabled)).join('')
          : '<span class="card-note">還沒有位置：在位置的表單選這個客戶</span>'}
      </div>`;
  }

  // 這些位置的合約，由舊到新；一份寫好幾個位置的只列一次
  function contracts(c) {
    const seen = new Set();
    return placesOf(c).flatMap(p => Records.contractsAt(p.code)).filter(r => !seen.has(r.id) && seen.add(r.id))
      .sort((a, b) => String(a.signDate ?? '').localeCompare(String(b.signDate ?? '')) || String(a.id).localeCompare(String(b.id)));
  }
  // 合約那一列：目前的合約有幾份，到期、快到期的有幾份
  function contractRow(c) {
    const now = [...new Set(placesOf(c).filter(p => !p.disabled).map(p => Records.currentContract(p.code)).filter(Boolean))];
    if (!now.length) return { main: contracts(c).length ? '沒有目前的合約' : '還沒有合約' };
    const due = now.filter(r => Records.endText(r)?.warn).length;
    return { main: `目前 ${now.length} 份`, sub: due ? `${due} 份到期或快到期` : '', warn: !!due };
  }

  return createDetail({
    table: 'customers',
    dlg: document.getElementById('customer-sheet'),
    sub: document.getElementById('customer-sub-sheet'),
    title: c => c.name || '客戶',
    infoHTML,
    onInfoClick(e) {
      const place = e.target.closest('[data-place]');
      if (place) Place.open(place.dataset.place);
      const cust = e.target.closest('[data-customer]');
      if (cust) Customer.open(cust.dataset.customer);
    },
    rows: [
      { key: 'contracts', label: '合約', summary: contractRow, records: contracts, preset: () => ({}) },
    ],
  });
})();
