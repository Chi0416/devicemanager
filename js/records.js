// 紀錄：異動、合約、抄表、保養、翻新、選配件（欄位見 schema.js）共用的計算
//   每一筆的「設備」欄寫設備編號（24-0001），用編號對到設備（大小寫、全形半形不同也認得）
//   位置：存位置編號（L0001），畫面上寫名稱；改名時舊名字記在「以前的名字」（見 PLAN.md 第 4-3 節）
//   位置歷程：設備目前的位置＝最新一筆異動（依日期，同一天依新增的先後）的新位置；設備那一列的「位置」欄由這裡算好填上
//     保養、抄表、翻新那時候在哪裡不另外存，照日期往回找那天之前的最後一筆異動
//     搬機器那天的紀錄算客戶那邊（不算倉庫）：撤機那天抄的最後一次表算原客戶，安裝那天抄的算新客戶
//   異動帶的狀態：撤機先帶庫存、安裝先帶出租中，存了最新一筆時設備的狀態跟著改
//   目前的合約：合約綁位置；一個位置目前的合約是包含它的合約裡簽約日最新的那一份，機器目前的合約是它所在位置的
//   抄表用量：這次減上一次；保養填的張數一起排
const Records = (() => {
  const TABLES = ['moves', 'contracts', 'readings', 'maintenance', 'refurbs', 'parts'];
  // 有「設備」欄的紀錄（合約綁位置，沒有）
  const DEVICE_TABLES = TABLES.filter(t => SCHEMAS[t].fields.some(f => f.key === 'device'));
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

  // 認一台機器：機型＋名稱（IMC4500 #1234）；編號只在系統裡用，畫面上不顯示
  const label = d => [d?.model, d?.name].filter(Boolean).join(' ') || d?.code || '';
  // 再加上機器序號（查機器、印紀錄時最常用的）：IMC4500 #1234 · 3101R800451
  const fullLabel = d => [label(d), d?.serial].filter(Boolean).join(' · ');
  // 表單上位置欄（設備）下面：這台設備的機型、名稱、序號
  const deviceNote = code => fullLabel(device(code));

  // 設備表單上名稱下面：同機型已經有一樣的名稱時提醒（還是可以存）
  function nameNote(values) {
    const n = key(values.name);
    if (!n) return '';
    const dup = Store.list('devices').find(d => d.id !== values.id && key(d.name) === n && key(d.model) === key(values.model));
    return dup ? { text: '同機型已經有這個名稱', warn: true } : '';
  }

  // ---------- 位置 ----------
  const place = code => (key(code) ? Store.list('locations').find(p => key(p.code) === key(code)) || null : null);
  // 位置編號 → 名稱；找不到時照原本的字（看得出是哪個編號對不上）
  const placeName = code => place(code)?.name || String(code ?? '').trim();
  // 搜尋用：名稱和以前的名字
  const placeText = code => {
    const p = place(code);
    return p ? [p.name, p.oldNames].filter(Boolean).join(' ') : String(code ?? '');
  };
  // 現在放在這個位置的設備
  const machinesAt = code => (key(code) ? Store.list('devices').filter(d => key(d.location) === key(code)) : []);

  // 下拉選單、清單裡位置名稱下面的小字：現在放著哪台（好幾台時寫幾台）
  function placeSub(p) {
    const on = machinesAt(p.code);
    return on.length > 1 ? `${on.length} 台` : on.length ? label(on[0]) : '';
  }

  // 一格一台：這個位置已經放著別台機器時提醒（換機時兩筆異動先輸入哪一筆都可以，所以只提醒）；倉庫不提醒
  function slotNote(code, deviceCode) {
    const p = place(code);
    if (!p || p.stock) return '';
    const other = machinesAt(code).find(d => key(d.code) !== key(deviceCode));
    return other ? { text: `這裡現在是 ${label(other)}`, warn: true } : '';
  }

  // 位置改名：舊名字加一行到「以前的名字」，寫到哪一天為止；回傳改到的 [{ table, id }]
  //   在 App 裡改的（schema 的 afterSave）、在試算表裡改的（同步時，見 sync.js）都會記
  function keepOldName(before, after) {
    const old = String(before?.name ?? '').trim();
    const now = after && Store.get('locations', after.id);
    if (!old || !now || old === String(now.name ?? '').trim()) return [];
    const lines = [String(now.oldNames ?? '').trim(), `${old}（到 ${U.fmtDate(U.today())}）`].filter(Boolean);
    Store.update('locations', now.id, { oldNames: lines.join('\n') });
    return [{ table: 'locations', id: now.id }];
  }

  // 依名字找位置（現在的名字，或以前的名字）
  const oldNameList = p => String(p.oldNames ?? '').split('\n').map(x => x.replace(/（到 [^）]*）\s*$/, '').trim()).filter(Boolean);
  function placeByName(name) {
    const n = key(name);
    if (!n) return null;
    const all = Store.list('locations');
    return all.find(p => key(p.name) === n) || all.find(p => oldNameList(p).some(x => key(x) === n)) || null;
  }

  // 一次算好每台設備的異動，很多筆紀錄一起算「那時候在哪裡」時用（不用每一筆都重新找）
  //   回傳 (設備編號, 日期) → 位置編號
  function locator() {
    const moves = new Map();
    [...Store.list('moves')].sort(byDate('date')).forEach(m => {
      const k = key(m.device);
      if (!moves.has(k)) moves.set(k, []);
      moves.get(k).push(m);
    });
    const here = new Map(Store.list('devices').map(d => [key(d.code), d.location]));
    return (code, date) => placeOn(moves.get(key(code)) || [], here.get(key(code)), date);
  }

  // 某一天設備在哪裡：那天之前最後一筆異動的新位置；那天之前還沒有異動時是第一筆異動的原位置；沒有異動時是設備現在的位置
  //   那天有異動（搬機器那天）：那天待過的位置裡，算客戶那邊（不是倉庫）的最後一個；都是倉庫時算那天最後的位置
  //     撤機那天抄的最後一次表算原客戶、安裝那天抄的算新客戶；客戶搬家（兩邊都是客戶）算新位置
  //     失火、故障抄不到表時就沒有這一筆，不影響
  function placeOn(moves, now, date) {
    if (!moves.length || !date) return now || '';
    const d = String(date);
    const before = moves.filter(m => String(m.date ?? '') < d).at(-1);
    const day = [before ? before.to : moves[0].from || '', ...moves.filter(m => String(m.date ?? '') === d).map(m => m.to)];
    return day.filter(p => key(p) && !place(p)?.stock).at(-1) ?? day.at(-1);
  }
  const locationAt = (code, date) => placeOn(of('moves', code).sort(byDate('date')), device(code)?.location, date);

  // 進出這個位置的異動（新位置或原位置是它）
  const movesAt = code => (key(code) ? Store.list('moves').filter(m => key(m.to) === key(code) || key(m.from) === key(code)) : []);
  // 機器放在這個位置的期間做的紀錄（抄表、保養、翻新）
  function recordsAt(table, code) {
    if (!key(code)) return [];
    const at = locator();
    return Store.list(table).filter(r => key(at(r.device, r.date)) === key(code));
  }

  // 「紀錄」分頁的卡片最上面那一排（下面才是紀錄的內容），和設備卡片一樣小標題在上、內容在下：[{ label, value, warn }]
  //   保養、抄表、翻新：位置（那時候的）｜機型｜名稱（序號不寫，搜尋找得到）
  //   合約：位置（合約綁位置，不寫機器）
  //   異動：機型｜名稱（標題已經寫了從哪裡到哪裡）
  //   找不到設備、合約沒填位置時提醒
  function recordCells(table, r) {
    if (table === 'contracts') {
      const names = contractPlaces(r);
      return [{ label: '位置', value: names.join('、') || '沒有填位置', warn: !names.length }];
    }
    const d = device(r.device);
    if (!d) return [{ label: '設備', value: `${r.device || '沒有填'}：找不到這台設備`, warn: true }];
    return [
      ...(table === 'moves' ? [] : [{ label: '位置', value: placeName(locationAt(r.device, r.date)) }]),
      { label: '機型', value: d.model || '' },
      { label: '名稱', value: d.name || '' },
    ];
  }

  // 搜尋紀錄時，打設備的名稱、機型、序號、那時候的位置（現在的名字、以前的名字）都找得到
  //   不找設備現在的位置：搜尋「客戶A」不會跑出現在在客戶A 的機器搬來之前的紀錄
  const deviceText = (code, date = null) => {
    const d = device(code);
    return [d?.name, d?.model, d?.serial, date && placeText(locationAt(code, date))].filter(Boolean).join(' ');
  };

  // 一筆紀錄的簡短說明（儲存後的提示、提醒裡用），例如「IMC4500 #1234 2026/10/11 移機」；找不到設備時寫編號
  //   合約寫位置：「大華公司 1F、大華公司 2F 2026/01/05 簽約」
  function describe(table, r) {
    if (table === 'contracts') return [contractPlaces(r).join('、'), U.fmtDate(r.signDate), '簽約'].filter(Boolean).join(' ');
    const parts = {
      moves: [U.fmtDate(r.date), r.type],
      readings: [r.month ? `${U.fmtMonth(r.month)} 抄表` : `${U.fmtDate(r.date)} 抄表`],
      maintenance: [U.fmtDate(r.date), r.item],
      refurbs: [U.fmtDate(r.date), '翻新'],
      parts: [r.name],
    }[table] || [];
    return [label(device(r.device)) || r.device, ...parts].filter(Boolean).join(' ');
  }

  // 卡片最下面的備註（只寫第一行）
  const noteLine = v => (firstLine(v) ? { text: firstLine(v), warn: false } : null);

  // ---------- 位置歷程 ----------
  const hasMoves = code => of('moves', code).length > 0;
  const moveTitle = r => `${r.from ? `${placeName(r.from)} → ` : '→ '}${placeName(r.to)}`;

  // 依異動重新填設備的位置，順便把每一筆的原位置接上前一筆的新位置；回傳改到的 [{ table, id }]
  //   原位置：第一筆照原本的（開始記異動前在哪裡），之後每一筆＝前一筆的新位置
  //     改了舊異動的新位置、日期，刪掉中間一筆，補登以前的，前後都接得起來
  //   lost：剛刪掉（或改到別台設備）的異動；那台設備沒有異動了的話，位置回到那一筆的原位置
  //   還沒有異動的設備不動（表單上填的位置是起點）
  function syncLocations(lost = []) {
    const byDevice = new Map();
    [...Store.list('moves')].sort(byDate('date')).forEach(m => {
      const k = key(m.device);
      if (!k) return;
      if (!byDevice.has(k)) byDevice.set(k, []);
      byDevice.get(k).push(m);
    });
    const out = [];
    byDevice.forEach(list => list.forEach((m, i) => {
      const from = i ? String(list[i - 1].to ?? '') : null;
      if (from === null || from === String(m.from ?? '')) return;
      Store.update('moves', m.id, { from });
      out.push({ table: 'moves', id: m.id });
    }));
    Store.list('devices').forEach(d => {
      const k = key(d.code);
      if (!k) return;
      const m = byDevice.get(k)?.at(-1);
      const back = !m && lost.find(x => key(x.device) === k);
      if (!m && !back) return;
      const loc = String((m ? m.to : back.from) ?? '');
      if (loc === String(d.location ?? '')) return;
      Store.update('devices', d.id, { location: loc });
      out.push({ table: 'devices', id: d.id });
    });
    return out;
  }

  // 新位置的下拉選單：沒有機器的位置在最上面（安裝時找空的那一格），再來是倉庫（撤機），最後是已經放著機器的
  //   回傳 (位置) → 數字，數字小的在前；每次列選單時先算好哪些位置有機器
  function freeFirst() {
    const used = new Set(Store.list('devices').map(d => key(d.location)).filter(Boolean));
    return p => (p.stock ? 1 : used.has(key(p.code)) ? 2 : 0);
  }

  // 異動的狀態先帶什麼：撤機帶庫存、安裝帶出租中（狀態清單裡沒有這個名字時不帶）；其他類型不帶（設備的狀態不改）
  const MOVE_STATUS = { 撤機: '庫存', 安裝: '出租中' };
  function moveStatus(values) {
    const name = MOVE_STATUS[String(values.type ?? '').trim()];
    return name && Store.list('statuses').some(s => key(s.name) === key(name)) ? name : '';
  }

  // 存了異動之後，設備的狀態改成這一筆的狀態；回傳改到的設備 [{ table, id }]
  //   只有這台設備最新的一筆才改（補登以前的異動不會改）
  //   新增、改了狀態或設備時才改：只改備註時不會蓋掉後來自己改的狀態
  //   刪掉異動時不會改回去（位置會），要自己改
  function applyMoveStatus(before, after) {
    const s = String(after?.status ?? '').trim();
    if (!s) return [];
    if (before && before.status === after.status && key(before.device) === key(after.device)) return [];
    if (of('moves', after.device).sort(byDate('date')).at(-1)?.id !== after.id) return [];
    const d = device(after.device);
    if (!d || d.status === s) return [];
    Store.update('devices', d.id, { status: s });
    return [{ table: 'devices', id: d.id }];
  }

  // 新增異動時的原位置：這一筆之前（日期較早；同一天先新增的）最後一筆的新位置
  //   補登在所有異動之前的：開始記異動前在哪裡（第一筆的原位置）；還沒有異動：設備現在的位置
  //   編輯時（id）不算自己；它是第一筆時照原本的
  function placeBefore(code, date, id = null) {
    if (!key(code)) return '';
    const list = of('moves', code).filter(m => m.id !== id).sort(byDate('date'));
    const at = [String(date ?? ''), id ? String(id) : '￿'];
    const prev = list.filter(m => (cmp(String(m.date ?? ''), at[0]) || cmp(String(m.id), at[1])) < 0).at(-1);
    if (prev) return String(prev.to ?? '');
    if (id) return String(Store.get('moves', id)?.from ?? '');
    return String((list.length ? list[0].from : device(code)?.location) ?? '');
  }

  // ---------- 異動的類型：安裝 倉庫 → 客戶、撤機 客戶 → 倉庫、移機 客戶 → 客戶，其他不限 ----------
  //   還沒有位置的機器（剛買的）算在倉庫；報廢這類（狀態勾「不用提醒」）的機器不能安裝
  const MOVE_RULES = { 安裝: ['stock', 'site'], 撤機: ['site', 'stock'], 移機: ['site', 'site'] };
  const ruleOf = values => MOVE_RULES[String(values.type ?? '').trim()] || null;
  const stockSet = () => new Set(Store.list('locations').filter(p => p.stock).map(p => key(p.code)));
  const quietSet = () => new Set(Store.list('statuses').filter(s => s.quiet).map(s => key(s.name)));
  const isStock = code => !!place(code)?.stock;

  // 原位置（選機器）的選單：安裝只列倉庫裡的機器（報廢的不列）、撤機和移機只列放在客戶那裡的
  function moveDevices(values) {
    const rule = ruleOf(values);
    if (!rule) return null;
    const stock = stockSet();
    const quiet = quietSet();
    const inStock = d => !key(d.location) || stock.has(key(d.location));
    return rule[0] === 'stock' ? d => inStock(d) && !quiet.has(key(d.status)) : d => !inStock(d);
  }
  // 新位置的選單：撤機只列倉庫，安裝和移機只列客戶的位置
  function movePlaces(values) {
    const rule = ruleOf(values);
    return rule ? p => !!p.stock === (rule[1] === 'stock') : null;
  }
  // 打了一個選單裡沒列的：為什麼沒列
  const moveDevicesNote = values => (values.type === '安裝' ? '安裝只列倉庫裡的機器（報廢的不列）' : `${values.type}只列放在客戶那裡的機器`);
  const movePlacesNote = values => (values.type === '撤機' ? '撤機只列倉庫' : `${values.type}只列客戶的位置`);

  // 存檔時檢查（寫在那一格下面）；舊資料類型、位置都沒改的不擋
  const unchangedMove = v => {
    const old = v.id && Store.get('moves', v.id);
    return !!old && ['type', 'from', 'to'].every(k => String(old[k] ?? '') === String(v[k] ?? ''));
  };
  // 類型：原位置（這台機器那時候在哪裡）和類型對不上
  function moveTypeCheck(values) {
    const rule = ruleOf(values);
    if (!rule || !values.device || unchangedMove(values)) return '';
    const from = values.from;
    if (rule[0] === 'stock') return key(from) && !isStock(from) ? '這台不在倉庫' : '';
    return !key(from) ? '這台還沒有位置' : isStock(from) ? '這台在倉庫' : '';
  }
  // 新位置和類型對不上
  function moveToCheck(values) {
    const rule = ruleOf(values);
    if (!rule || !key(values.to) || unchangedMove(values)) return '';
    if (rule[1] === 'stock') return isStock(values.to) ? '' : '撤機要選倉庫';
    return isStock(values.to) ? `${values.type}要選客戶的位置，不是倉庫` : '';
  }
  // 原位置：報廢的機器不能安裝
  function moveDeviceCheck(values) {
    if (values.type !== '安裝' || unchangedMove(values)) return '';
    const s = device(values.device)?.status;
    return s && quietSet().has(key(s)) ? `這台是「${s}」，不能安裝` : '';
  }

  // 從詳情頁新增異動時先選好的類型：機器在倉庫（或還沒有位置）先選安裝，在客戶那裡先選撤機；報廢的不選
  //   位置詳情：倉庫先選撤機，其他先選安裝
  function moveTypeFor(d) {
    if (!d || quietSet().has(key(d.status))) return '';
    return !key(d.location) || isStock(d.location) ? '安裝' : '撤機';
  }
  const moveTypeAt = p => (p?.stock ? '撤機' : '安裝');

  // 日期下面：在今天之後；比這台機器最近一筆異動早（這筆不會改到現在的位置）
  //   編輯時只看最新的那一筆（改舊的不用提醒）
  function moveDateNote(values) {
    const date = String(values.date ?? '');
    if (!date) return '';
    if (date > U.today()) return { text: '在今天之後', warn: true };
    const list = of('moves', values.device).sort(byDate('date'));
    if (values.id && list.at(-1)?.id !== values.id) return '';
    const last = list.filter(m => m.id !== values.id).at(-1);
    return last && date < String(last.date ?? '') ? { text: `比 ${shortDate(last.date)} 那筆早\n不會改到現在的位置`, warn: true } : '';
  }

  // 新位置下面（兩行）：那裡已經放著別台機器（一格一台）；撤機時提醒原來那一格的合約、停用；安裝到還沒有合約的位置
  function moveToNote(values) {
    const lines = [];
    let warn = false;
    const slot = slotNote(values.to, values.device);
    if (slot) { lines.push(slot.text); warn = true; }
    const from = values.from;
    if (values.type === '撤機' && key(from) && !isStock(from)) {
      const c = currentContract(from);
      if (c) lines.push(`${placeName(from)} 還有合約${c.endDate ? `（到 ${U.fmtDate(c.endDate)}）` : ''}`, '客戶不租了：合約填提前結束日、位置勾停用');
      else lines.push(`客戶不租了的話，${placeName(from)} 可以勾停用`);
    }
    if (['安裝', '移機'].includes(values.type) && key(values.to) && !isStock(values.to) && !currentContract(values.to)) {
      lines.push('這個位置還沒有合約');
      warn = true;
    }
    return lines.length ? { text: lines.slice(0, 2).join('\n'), warn } : '';
  }

  // 「連續新增」時新位置留不留：倉庫留著（客戶一次退好幾台），客戶的位置不留（免得裝到同一格）
  const keepPlace = values => isStock(values.to);

  // 位置勾停用時：還放著機器的不能停用（先撤機）；本來就停用的不擋
  function disableCheck(values) {
    if (values.disabled !== 'true') return '';
    if (values.id && Store.get('locations', values.id)?.disabled) return '';
    const on = machinesAt(values.code);
    return on.length ? `這裡還放著 ${on.length > 1 ? `${on.length} 台` : label(on[0])}，先撤機` : '';
  }

  // ---------- 合約 ----------
  // 合約的位置（編號）、位置的名稱
  const placesOf = r => Refs.multi(r?.locations);
  const contractPlaces = r => placesOf(r).map(placeName);
  // 提前結束了（過了提前結束日）
  const endedEarly = r => !!r.earlyEnd && String(r.earlyEnd) < U.today();
  // 包含這個位置的合約，由舊到新（依簽約日，同一天依新增的先後）
  const contractsAt = code => (key(code)
    ? Store.list('contracts').filter(r => placesOf(r).some(p => key(p) === key(code))).sort(byDate('signDate')) : []);
  // 這個位置目前的合約：簽約日最新的那一份；那一份已經提前結束了就沒有
  function currentContract(code) {
    const c = contractsAt(code).at(-1) || null;
    return c && !endedEarly(c) ? c : null;
  }
  // 機器目前的合約：它現在所在位置的（換機時不用改合約）
  const deviceContract = code => currentContract(device(code)?.location);
  const isCurrentContract = r => placesOf(r).some(p => currentContract(p)?.id === r.id);

  // 到期日：目前的合約已經到期或快到期時標色；舊的合約只寫日期；提前結束的寫提前結束日
  function endText(r) {
    if (r.earlyEnd) return { text: `${endedEarly(r) ? '已提前結束' : '提前結束'}（${U.fmtDate(r.earlyEnd)}）`, warn: false };
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

  // ---------- 合約修改紀錄 ----------
  // 一個欄位畫面上看到的字：位置寫名稱、日期寫 2026/10/11
  const shown = (f, v) => (f.ref === 'locations'
    ? Refs.valuesOf(f, v).map(placeName).join('、')
    : String(U.display(f, v) ?? '').trim());

  // 修改合約（新增時不記）：改了的欄位各記一筆；回傳新增的 [{ table, id }]
  //   在 App 裡改的（schema 的 afterSave）、在試算表裡改的（同步時，見 sync.js）都會記
  function logContract(before, after) {
    if (!before || !after) return [];
    const date = U.today();
    return SCHEMAS.contracts.fields
      .filter(f => f.key in after && shown(f, before[f.key]) !== shown(f, after[f.key]))
      .map(f => Store.add('contractLog', { contract: after.id, date, field: f.label, before: shown(f, before[f.key]), after: shown(f, after[f.key]) }))
      .map(r => ({ table: 'contractLog', id: r.id }));
  }

  // 編輯合約的表單最下面：[{ date, text }]，舊到新；同一天照記下來的先後（同一次修改照欄位的順序）
  const contractHistory = id => Store.list('contractLog').map((r, i) => ({ r, i })).filter(x => x.r.contract === id)
    .sort((a, b) => cmp(String(a.r.date ?? ''), String(b.r.date ?? '')) || a.i - b.i)
    .map(({ r }) => ({ date: r.date, text: `${r.field}：${r.before || '（空白）'} → ${r.after || '（空白）'}` }));

  // 刪掉合約時，它的修改紀錄一起刪
  function dropContractLog(r) {
    const gone = Store.list('contractLog').filter(x => x.contract === r.id);
    gone.forEach(x => Store.remove('contractLog', x.id));
    return gone.map(x => ({ table: 'contractLog', id: x.id }));
  }

  // ---------- 要處理（總覽、提醒的鈴鐺）：依資料算，處理掉就自己不見 ----------
  // 合約到期、快到期：目前的合約過了到期日，或 30 天內到期；依到期日排
  //   續約按「重新簽約」、客戶不租了填提前結束日就不算了；位置都停用了的（客戶走了）不算
  const contractsDue = () => Store.list('contracts')
    .filter(r => r.endDate && daysTo(r.endDate) <= CONTRACT_SOON && placesOf(r).some(p => !place(p)?.disabled) && isCurrentContract(r))
    .sort(byDate('endDate'));
  // 保固 30 天內到期（過了就不列）；報廢這類（狀態勾「不用提醒」）的不算；依到期日排
  function warrantyDue() {
    const quiet = quietSet();
    return Store.list('devices')
      .filter(d => d.warranty && !quiet.has(key(d.status)) && daysTo(d.warranty) >= 0 && daysTo(d.warranty) <= WARRANTY_SOON)
      .sort(byDate('warranty'));
  }
  // 空著的位置：不是倉庫、沒停用、沒放機器；等安裝，或客戶不租了要停用；依名稱排
  function emptyPlaces() {
    const used = new Set(Store.list('devices').map(d => key(d.location)).filter(Boolean));
    return Store.list('locations').filter(p => !p.stock && !p.disabled && !used.has(key(p.code)))
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-Hant'));
  }
  // 進出這個位置的最後一筆異動
  const lastMoveAt = code => [...movesAt(code)].sort(byDate('date')).at(-1) || null;

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

  // 翻新卡片最下面一行：入庫日、工程師、國別、噴漆、廠商或來源
  function refurbNote(r) {
    const text = [
      r.stockDate && `${U.fmtDate(r.stockDate)} 入庫`, r.engineer, r.country, r.painted && '噴漆', r.source && `廠商或來源 ${r.source}`,
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

  // ---------- 總覽 ----------
  // 設備的狀態，照狀態清單的寫法（大小寫、全形半形不同也認得）
  const statusField = () => SCHEMAS.devices.fields.find(f => f.key === 'status');
  const statusOf = d => Refs.nameOf('statuses', Refs.find(statusField(), d.status)) || String(d.status ?? '').trim();

  // 各機型有幾台：status 是狀態的名字（空字串是全部）；機型的大小寫、全形半形、空格不同算同一種
  //   回傳 [{ model, brand, count }]：model、brand 用最多台的寫法
  //   照機型清單的順序（設定 → 清單 → 機型 →「排序」）；清單裡沒排過、不在清單裡的依名字排在後面；沒填機型的排最後
  // 機型在機型清單裡的順序；沒排過、不在清單裡的是 Infinity
  function modelOrder(m) {
    const o = m ? Refs.find(SCHEMAS.devices.fields.find(f => f.key === 'model'), m) : null;
    return typeof o?.order === 'number' ? o.order : Infinity;
  }
  const byText = (x, y) => String(x ?? '').localeCompare(String(y ?? ''), 'zh-Hant', { numeric: true });

  // 設備列表的順序：照機型清單的順序（沒填機型的排最後），同一個機型依名稱（#1234 照數字大小）
  const deviceOrder = (a, b) => (!a.model - !b.model) || (modelOrder(a.model) - modelOrder(b.model)) || byText(a.model, b.model) || byText(a.name, b.name);

  function modelCounts(status = '') {
    const orderOf = modelOrder;
    const groups = new Map();
    Store.list('devices').filter(d => !status || statusOf(d) === status).forEach(d => {
      const model = String(d.model ?? '').trim();
      const k = key(model).replace(/\s+/g, '');
      if (!groups.has(k)) groups.set(k, { names: new Map(), brands: new Map(), count: 0 });
      const g = groups.get(k);
      g.count++;
      g.names.set(model, (g.names.get(model) || 0) + 1);
      if (d.brand) g.brands.set(d.brand, (g.brands.get(d.brand) || 0) + 1);
    });
    const most = m => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    return [...groups].map(([k, g]) => ({ model: k ? most(g.names) : '', brand: most(g.brands), count: g.count }))
      .sort((a, b) => (!a.model - !b.model) || (orderOf(a.model) - orderOf(b.model)) || a.model.localeCompare(b.model, 'zh-Hant', { numeric: true }));
  }

  // ---------- 機型的世代 ----------
  // 照 Ricoh 型號的命名猜：IM C 開頭是「IM C」；C 加四位數看最後兩碼（C6004、MP C3504EX 是「C xx04」）；
  //   MP 直接接數字是「黑白 MP」；猜不到的（借機）空白
  function guessGen(name) {
    const n = String(name ?? '').toUpperCase().replace(/\s+/g, '');
    if (/^IMC\d/.test(n)) return 'IM C';
    const m = n.match(/^(?:MP)?C\d{2}(\d{2})/);
    if (m) return `C xx${m[1]}`;
    return /^MP\d/.test(n) ? '黑白 MP' : '';
  }
  // 機型表單上世代下面：空白時會怎麼算
  function genNote(v) {
    if (String(v.gen ?? '').trim()) return '';
    const g = guessGen(v.name);
    return g ? `空白時照型號算：${g}` : '空白時放在「其他」';
  }
  // 總覽的機型依世代分組：[{ gen, count, rows: modelCounts 的列 }]
  //   世代：機型清單裡填的，沒填的照型號猜，都沒有的（還有沒填機型的）放「其他」，排最後；其他組照機型清單的順序
  const OTHER_GEN = '其他';
  function modelGroups(status = '') {
    const norm = v => key(v).replace(/\s+/g, '');
    const gens = new Map(Store.list('options').filter(o => o.list === '機型').map(o => [norm(o.name), String(o.gen ?? '').trim()]));
    const groups = new Map();
    modelCounts(status).forEach(r => {
      const gen = (r.model && (gens.get(norm(r.model)) || guessGen(r.model))) || OTHER_GEN;
      if (!groups.has(gen)) groups.set(gen, { gen, count: 0, rows: [] });
      const g = groups.get(gen);
      g.count += r.count;
      g.rows.push(r);
    });
    return [...groups.values()].sort((a, b) => (a.gen === OTHER_GEN) - (b.gen === OTHER_GEN));
  }

  // ---------- 對不上的設備、位置 ----------
  // 找不到設備的紀錄（在試算表裡打錯了設備編號）：[{ table, rec }]
  function orphans() {
    const codes = new Set(Store.list('devices').map(d => key(d.code)).filter(Boolean));
    return DEVICE_TABLES.flatMap(t => Store.list(t).filter(r => !codes.has(key(r.device))).map(rec => ({ table: t, rec })));
  }

  // 找不到的位置編號（在試算表裡打錯了）：[{ table, rec, value }]
  function lostPlaces() {
    return Refs.refsTo('locations').flatMap(({ table, field }) => Store.list(table).flatMap(rec =>
      Refs.valuesOf(field, rec[field.key]).filter(v => !place(v)).map(value => ({ table, rec, value }))));
  }

  // 同步時換了編號（兩台裝置各新增一台設備或一個位置、拿到同一個編號，見 schema.js 的 fixCodes）：用到它的資料跟著換
  //   兩筆用同一個舊編號，分不出資料是哪一筆的：只有一筆是這台裝置上新增的（還沒同步）時，
  //   這台裝置上新增的資料跟著這台裝置上新增的那一筆；分不出來時留在沒換號的那筆
  //   isLocal(表, id)：這一筆是不是這台裝置上新增或改過、還沒同步的；target 是換號的表；回傳改到的 [{ table, id }]
  function followCodes(fixed, isLocal, target = 'devices') {
    const out = new Map();
    fixed.filter(f => f.from).forEach(f => {
      const kept = Store.list(target).find(d => d.id !== f.id && key(d.code) === key(f.from));
      const mine = isLocal(target, f.id);
      if (kept && isLocal(target, kept.id) === mine) return;
      Refs.refsTo(target).forEach(({ table, field }) => Store.list(table)
        .filter(r => Refs.valuesOf(field, r[field.key]).some(v => key(v) === key(f.from)) && (!kept || isLocal(table, r.id) === mine))
        .forEach(r => {
          const v = Refs.valuesOf(field, r[field.key]).map(x => (key(x) === key(f.from) ? f.to : x)).join('、');
          Store.update(table, r.id, { [field.key]: v });
          out.set(`${table}:${r.id}`, { table, id: r.id });
        }));
    });
    return [...out.values()];
  }

  // ---------- 位置換成編號、舊資料轉換 ----------
  // 新增一個位置（名字有「倉庫」的勾倉庫）
  function addPlace(name, more = {}) {
    return Store.add('locations', {
      ...Refs.blankRecord('locations'), name: String(name).trim(), stock: String(name).includes('倉庫'), ...more, code: nextLocationCode(),
    });
  }

  // 寫名字的位置換成編號（舊資料、在試算表裡打的名字；以前的名字也認得）；名字不在位置表裡的建一個新的位置
  //   像編號（L0099）但找不到的不動（提醒「找不到位置」，見 lostPlaces）；回傳改到的 [{ table, id }]
  function fixPlaceRefs() {
    const out = new Map();
    const codeOf = v => {
      if (place(v) || LOC_RE.test(U.toHalf(v).trim().toUpperCase())) return v;
      let p = placeByName(v);
      if (!p) {
        p = addPlace(v);
        out.set(`locations:${p.id}`, { table: 'locations', id: p.id });
      }
      return p.code;
    };
    Refs.refsTo('locations').forEach(({ table, field }) => Store.list(table).forEach(r => {
      const vals = Refs.valuesOf(field, r[field.key]);
      const next = vals.map(codeOf);
      if (next.every((v, i) => v === vals[i])) return;
      Store.update(table, r.id, { [field.key]: next.join('、') });
      out.set(`${table}:${r.id}`, { table, id: r.id });
    }));
    return [...out.values()];
  }

  // 舊資料轉換（2026-10-11 位置獨立成表、合約改成綁位置）：打開 App、匯入 data.json 時做，做過就不會再做
  //   選項裡的位置清單 → 位置表；設備、異動寫名字的位置 → 編號
  //   合約的設備 → 合約期間那台機器所在的位置（還沒到期的用現在的，到期了的用到期那天的；簽約時機器多半還在倉庫，不能用簽約日）
  //   回傳有沒有改到
  function upgrade() {
    let changed = false;
    Store.list('options').filter(o => o.list === '位置').forEach(o => {
      if (String(o.name ?? '').trim() && !placeByName(o.name)) addPlace(o.name, { disabled: !!o.disabled });
      Store.remove('options', o.id);
      changed = true;
    });
    if (fixPlaceRefs().length) changed = true;
    Store.list('contracts').filter(r => r.device).forEach(r => {
      const when = [r.endDate || U.today(), U.today()].sort()[0];
      const at = String(r.locations ?? '').trim() || locationAt(r.device, when);
      Store.update('contracts', r.id, { locations: at, device: undefined });
      changed = true;
    });
    if (fixPlaceRefs().length) changed = true;
    return changed;
  }

  return {
    TABLES, DEVICE_TABLES, firstLine, noteLine, device, of, latest, label, fullLabel, deviceNote, nameNote, locationAt, recordCells, deviceText, describe, deviceOrder,
    place, placeName, placeText, placeSub, machinesAt, slotNote, keepOldName, placeByName, movesAt, recordsAt,
    hasMoves, moveTitle, syncLocations, freeFirst, moveStatus, applyMoveStatus, placeBefore,
    moveDevices, movePlaces, moveDevicesNote, movePlacesNote, moveTypeCheck, moveToCheck, moveDeviceCheck, moveTypeFor, moveTypeAt,
    moveDateNote, moveToNote, keepPlace, disableCheck, contractsDue, warrantyDue, emptyPlaces, lastMoveAt,
    placesOf, contractPlaces, contractsAt, currentContract, deviceContract, isCurrentContract, contractNote, endText,
    logContract, contractHistory, dropContractLog,
    countsText, usage, usageNote, readingNote, monthNote, countNote,
    workNote, refurbNote, serialNote,
    partOrder, partNote, statusOf, modelCounts, guessGen, genNote, modelGroups, orphans, lostPlaces, followCodes, fixPlaceRefs, upgrade,
  };
})();
