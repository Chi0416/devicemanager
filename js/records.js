// 紀錄：異動、合約、抄表、保養、翻新、選配件（欄位見 schema.js）共用的計算
//   每一筆的「設備」欄寫設備編號（24-0001），用編號對到設備（大小寫、全形半形不同也認得）
//   位置：存位置編號（L0001），畫面上寫名稱；改名時舊名字記在「以前的名字」（見 PLAN.md 第 4-3 節）
//   位置歷程：設備目前的位置＝最新一筆異動（依日期，同一天依新增的先後）的新位置；設備那一列的「位置」欄由這裡算好填上
//     保養、抄表、翻新那時候在哪裡不另外存，照日期往回找那天之前的最後一筆異動
//     搬機器那天的紀錄算客戶那邊（不算倉庫）：撤機那天抄的最後一次表算原客戶，安裝那天抄的算新客戶
//   異動帶的狀態：撤機先帶庫存、安裝先帶出租中，存了最新一筆時設備的狀態跟著改
//   目前的合約：合約綁位置；一個位置目前的合約是包含它的合約裡簽約日最新的那一份，機器目前的合約是它所在位置的
//   抄表用量：這次減上一次；保養填的張數一起排
//   每台設備的紀錄、異動、張數一次整理好（cached），資料沒改就直接用；抄表列表每張卡片都要找，一張一張從頭找太慢
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
  // 張數的紀錄（抄表、有填張數的保養）：依日期；同一天照張數由少到多（張數只會變多）
  //   自動抄表一天寄好幾封時，同一次同步補上的 id 先後是亂的，不能照新增的先後排；張數一樣才照 id
  const meterTotal = r => (isNum(r.bw) ? r.bw : 0) + (isNum(r.color) ? r.color : 0);
  const byMeter = (a, b) => cmp(String(a.date ?? ''), String(b.date ?? '')) || (meterTotal(a) - meterTotal(b)) || cmp(String(a.id), String(b.id));

  // ---------- 一次整理好的資料：Store 的版本號沒變就直接用，改了資料下次用到時才重新整理 ----------
  //   拿到的陣列不能改（要排序的先複製一份）
  const memo = new Map();
  function cached(name, build) {
    const hit = memo.get(name);
    if (hit && hit.v === Store.version) return hit.value;
    const value = build();
    memo.set(name, { v: Store.version, value });
    return value;
  }
  // 依 field 分好：Map(編號 → [紀錄])，每一組照原本的順序，order 有給時各自排好
  function groupBy(rows, field, order = null) {
    const m = new Map();
    rows.forEach(r => {
      const k = key(r[field]);
      if (!k) return;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    if (order) m.forEach(l => l.sort(order));
    return m;
  }
  // 依編號找：Map(編號 → 一筆)；同一個編號有兩筆時是前面那一筆
  function byCode(rows) {
    const m = new Map();
    rows.forEach(r => { const k = key(r.code); if (k && !m.has(k)) m.set(k, r); });
    return m;
  }
  const NONE = [];
  // 每台設備的紀錄（照原本的順序）、異動（依日期）、張數（抄表和有填張數的保養，見 byMeter）
  const rowsOf = (table, code) => cached(`of:${table}`, () => groupBy(Store.list(table), 'device')).get(key(code)) || NONE;
  const moveLines = () => cached('moves', () => groupBy(Store.list('moves'), 'device', byDate('date')));
  const movesOf = code => moveLines().get(key(code)) || NONE;
  const meterLines = () => cached('meter', () => groupBy([...Store.list('readings'), ...WORKS.flatMap(t => Store.list(t))
    .filter(r => COUNTS.some(([k]) => isNum(r[k])))], 'device', byMeter));
  const readingLines = () => cached('readings', () => groupBy(Store.list('readings'), 'device', byMeter));
  // 現在放在每個位置的設備：Map(位置編號 → [設備])
  const devicesAt = () => cached('devicesAt', () => groupBy(Store.list('devices'), 'location'));

  const device = code => (key(code) ? cached('devices', () => byCode(Store.list('devices'))).get(key(code)) || null : null);
  // 這台設備的紀錄（還沒有編號的設備沒有紀錄）
  const of = (table, code) => [...rowsOf(table, code)];
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
  const place = code => (key(code) ? cached('places', () => byCode(Store.list('locations'))).get(key(code)) || null : null);
  // 位置編號 → 名稱；找不到時照原本的字（看得出是哪個編號對不上）
  const placeName = code => place(code)?.name || String(code ?? '').trim();
  // 搜尋用：名稱和以前的名字
  const placeText = code => {
    const p = place(code);
    return p ? [p.name, p.oldNames].filter(Boolean).join(' ') : String(code ?? '');
  };
  // 現在放在這個位置的設備
  const machinesAt = code => [...(devicesAt().get(key(code)) || NONE)];

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
  const locationAt = (code, date) => placeOn(movesOf(code), device(code)?.location, date);

  // 進出這個位置的異動（新位置或原位置是它）
  const movesAt = code => (key(code) ? Store.list('moves').filter(m => key(m.to) === key(code) || key(m.from) === key(code)) : []);
  // 位置詳情的異動：這裡放過哪些機器，一台待過一次是一段 [{ device: 設備編號, in: 進來那筆異動, out: 離開那筆 }]
  //   每台照自己的異動由舊到新：新位置是這裡的是進來，原位置是這裡的是離開（換機那天先撤再裝，兩台各一段）
  //   開始記異動之前就在這裡的（第一筆是從這裡搬走）沒有 in；還在這裡的沒有 out
  //   現在放在這裡、沒有進出這裡的異動的（設備表單直接填位置）也算一段，in、out 都沒有
  //   還在這裡的在最上面（越晚進來越上面），再來越晚離開的越上面
  function staysAt(code) {
    const k = key(code);
    if (!k) return [];
    const stays = [];
    const open = new Map(); // 設備編號 → 還沒離開的那一段
    [...movesAt(code)].sort(byDate('date')).forEach(m => {
      const dk = key(m.device);
      if (key(m.from) === k) {
        const s = open.get(dk);
        if (s) s.out = m;
        else stays.push({ device: m.device, in: null, out: m });
        open.delete(dk);
      }
      if (key(m.to) === k) {
        const s = { device: m.device, in: m, out: null };
        stays.push(s);
        open.set(dk, s);
      }
    });
    machinesAt(code).filter(d => !open.has(key(d.code))).forEach(d => stays.push({ device: d.code, in: null, out: null }));
    const end = s => (s.out ? String(s.out.date ?? '') : '￿');
    const start = s => (s.in ? String(s.in.date ?? '') : '');
    const last = s => String((s.out || s.in)?.id ?? '');
    return stays.sort((a, b) => cmp(end(b), end(a)) || cmp(start(b), start(a)) || cmp(last(b), last(a)));
  }
  // 待了多久：未滿一個月寫幾天（同一天寫當天），未滿一年寫幾個月，再久寫幾年幾個月
  function spanText(from, to) {
    const [y1, m1, d1] = String(from ?? '').split('-').map(Number);
    const [y2, m2, d2] = String(to ?? '').split('-').map(Number);
    if (!y1 || !y2) return '';
    const months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
    if (months < 1) {
      const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
      return days > 0 ? `${days} 天` : '當天';
    }
    const y = Math.floor(months / 12);
    return [y && `${y} 年`, months % 12 && `${months % 12} 個月`].filter(Boolean).join(' ');
  }
  // 機器放在這個位置的期間做的紀錄（抄表、保養、翻新）
  function recordsAt(table, code) {
    if (!key(code)) return [];
    return Store.list(table).filter(r => key(locationAt(r.device, r.date)) === key(code));
  }

  // 「紀錄」分頁的卡片最上面那一排（下面才是紀錄的內容），和設備卡片一樣小標題在上、內容在下：[{ label, value, warn }]
  //   保養、抄表、翻新：位置（那時候的）｜設備（機型＋名稱，IMC6000 #1001；序號不寫，搜尋找得到）
  //   合約：位置（合約綁位置，不寫機器）
  //   異動：設備（標題已經寫了從哪裡到哪裡）
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
      { label: '設備', value: label(d) },
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
  // 設備的狀態跟著位置帶：在倉庫（或還沒有位置）帶庫存、在客戶那裡帶出租中；狀態清單裡沒有這個名字時帶第一個
  function deviceStatus(values) {
    const loc = values.location;
    return moveStatus({ type: !key(loc) || isStock(loc) ? '撤機' : '安裝' }) || firstStatus();
  }

  // 存了異動之後，設備的狀態改成這一筆的狀態；回傳改到的設備 [{ table, id }]
  //   只有這台設備最新的一筆才改（補登以前的異動不會改）
  //   新增、改了狀態或設備時才改：只改備註時不會蓋掉後來自己改的狀態
  //   刪掉異動時不會改回去（位置會），要自己改（對不上的總覽「要處理」會列，見 statusMismatch）
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

  // 存了安裝、撤機之後接著抄表（見 form.js 的 schema.next）：機器和日期帶好
  //   安裝當天的張數是起點（結算月份可以空白）；撤機前最後一次抄表要結帳（填結算月份）
  function readingAfterMove(r) {
    if (!['安裝', '撤機'].includes(r.type) || !key(r.device)) return null;
    return {
      table: 'readings',
      preset: { device: r.device, date: r.date },
      message: r.type === '安裝' ? '已存好安裝。接著抄表：這天是裝機抄表，結算月份可以空白' : '已存好撤機。接著抄表：最後一次，填這次要結帳的結算月份',
    };
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
  //   日期寫在最前面，不加括號（2026/10/30 到期・剩 19 天）
  function endText(r) {
    if (r.earlyEnd) return { text: `${U.fmtDate(r.earlyEnd)} ${endedEarly(r) ? '已提前結束' : '提前結束'}`, warn: false };
    if (!r.endDate) return null;
    const days = daysTo(r.endDate);
    const date = U.fmtDate(r.endDate);
    if (!isCurrentContract(r)) return { text: `${date} 到期`, warn: false };
    if (days < 0) return { text: `${date} 已到期`, warn: true };
    if (days <= CONTRACT_SOON) return { text: days ? `${date} 到期・剩 ${days} 天` : `${date} 今天到期`, warn: true };
    return { text: `${date} 到期`, warn: false };
  }

  function contractNote(r) {
    const end = endText(r);
    const read = [r.cycle, firstLine(r.readDay)].filter(Boolean).join(' ');
    const text = [end?.text, read && `抄表 ${read}`].filter(Boolean).join('・');
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

  // 這台設備的張數：抄表和有填張數的保養，由舊到新（同一天照張數，見 byMeter）
  const meterLine = code => meterLines().get(key(code)) || NONE;

  // 這一筆之前（日期較早；同一天張數較少的）最後一次有填這個張數的
  //   rec 還沒存（新增中，沒有 id）時，同一天的都算之前：同一天打了比較少的張數會提醒
  function previous(rec, k) {
    const date = String(rec.date ?? '');
    const before = rec.id ? r => byMeter(r, rec) < 0 : r => cmp(String(r.date ?? ''), date) <= 0;
    return meterLine(rec.device).filter(r => r.id !== rec.id && isNum(r[k]) && before(r)).at(-1) || null;
  }

  // 算帳的上一次（跟位置的用量一樣，見 placeUsages）：這一筆之前最後一次有結算月份、或是起點的抄表，有填這個張數的
  //   順便抄、保養填的張數不算（一期不會被切成兩段）；之前的照 previous 的算法
  function billPrev(rec, k) {
    const date = String(rec.date ?? '');
    const before = rec.id ? r => byMeter(r, rec) < 0 : r => cmp(String(r.date ?? ''), date) <= 0;
    const line = readingLines().get(key(rec.device)) || NONE;
    for (let i = line.length - 1; i >= 0; i--) {
      const r = line[i];
      if (r.id !== rec.id && isNum(r[k]) && before(r) && (r.month || isStart(r))) return r;
    }
    return null;
  }

  // 使用量：這一筆有填的張數 [{ k, label, prev, diff, less }]
  //   prev、diff：跟算帳一樣，這次減上一次結算或起點的抄表（見 billPrev）；第一次抄表時是 null
  //   less：比之前有記張數的任何一筆（保養填的、順便抄的也算）少時，是那一筆；沒有時 null
  const usage = rec => COUNTS.filter(([k]) => isNum(rec[k])).map(([k, label]) => {
    const prev = billPrev(rec, k);
    const last = previous(rec, k);
    return { k, label, prev, diff: prev ? rec[k] - prev[k] : null, less: last && rec[k] < last[k] ? last : null };
  });

  // 使用量寫成一行（詳情的抄表那一列）；比上一次少時提醒
  function usageNote(rec) {
    const u = usage(rec);
    const less = u.filter(x => x.less);
    if (less.length) {
      return { text: less.map(x => `${x.label}比上一次少（上次 ${fmt(x.less[x.k])}，${U.fmtDate(x.less.date)}）`).join('；'), warn: true };
    }
    const has = u.filter(x => x.diff !== null);
    if (has.length) return { text: `使用量 ${has.map(x => `${x.label} ${fmt(x.diff)}`).join('・')}`, warn: false };
    return u.length ? { text: '沒有上次', warn: false } : null;
  }

  // 結算月份空白的抄表（都不算帳）：起點或順便抄
  //   起點（標籤寫「裝機抄表」）：機器放到這個位置之後的第一筆抄表（安裝、移機、換機進來那天抄的；沒有異動的是這台的第一筆），下一次抄表從它算起
  //   順便抄：其他空白的（路過順便抄、自動抄表的測試）；跟保養填的張數一樣只是記下來，一期不會被切成兩段
  function isStart(rec) {
    const date = String(rec.date ?? '');
    const here = key(locationAt(rec.device, date));
    const arrive = of('moves', rec.device).filter(m => key(m.to) === here && String(m.date ?? '') <= date)
      .reduce((d, m) => (String(m.date) > d ? String(m.date) : d), '');
    const before = rec.id ? r => byMeter(r, rec) < 0 : r => cmp(String(r.date ?? ''), date) <= 0;
    return !of('readings', rec.device).some(r => r.id !== rec.id && String(r.date ?? '') >= arrive && before(r));
  }
  const readingKind = rec => (rec.month || !key(rec.device) ? '' : isStart(rec) ? '裝機抄表' : '順便抄');

  // 結算月份選錯（日期、張數都對，「比上次少」抓不到，用量會算到別的月份）：Map(抄表的 id → '月份重複' 或 '月份順序不對')
  //   月份重複：這台在同一個位置有兩筆一樣的結算月份（撤機那天在原客戶結帳、同一個月裝到新客戶結帳的不算）
  //   月份順序不對：日期比較晚的那筆（同一天照張數，見 byMeter），結算月份反而比之前的早
  const monthFlags = () => cached('monthFlags', () => {
    const out = new Map();
    readingLines().forEach(line => {
      const billed = line.filter(r => r.month);
      const slot = r => `${key(locationAt(r.device, r.date))}|${r.month}`;
      const count = new Map();
      billed.forEach(r => count.set(slot(r), (count.get(slot(r)) || 0) + 1));
      let max = '';
      billed.forEach(r => {
        const m = String(r.month);
        if (m < max) out.set(r.id, '月份順序不對');
        else if (count.get(slot(r)) > 1) out.set(r.id, '月份重複');
        if (m > max) max = m;
      });
    });
    return out;
  });

  // 抄表的用量那一段：結算月份空白的寫「起點」「順便抄」，不寫本期；比上一次少、結算月份選錯時照樣提醒
  function readingUse(rec) {
    const flag = monthFlags().get(rec.id);
    const use = usageNote(rec);
    const kind = readingKind(rec);
    if (flag) return { text: [flag, use?.text].filter(Boolean).join('・'), warn: true };
    if (!kind) return use;
    return use?.warn ? { text: `${kind}・${use.text}`, warn: true } : { text: kind, warn: false };
  }

  // 卡片上使用量那一格：比上次少橘字；算不出來的寫「—」；推算的寫「約」
  const useCell = (diff, approx = false) => (diff === null ? { use: '—', tone: 'muted' }
    : diff < 0 ? { use: '比上次少', tone: 'warn' } : { use: `${approx ? '約 ' : ''}${fmt(diff)}`, tone: '' });

  // 抄表卡片的黑白、彩色兩欄（使用量粗體、計數器灰字，見 list.js）[{ label, use, tone, count }]
  //   使用量跟算帳一樣（見 usage）；裝機抄表、順便抄、沒有上次寫「—」（右上角標籤寫是哪一種，見 readingTag）
  //   比之前有記張數的任何一筆少時橘字（保養填的也算）
  function readingCols(rec) {
    const kind = readingKind(rec);
    return usage(rec).map(x => ({
      label: x.label,
      ...(x.less ? useCell(-1) : useCell(kind ? null : x.diff)),
      count: fmt(rec[x.k]),
    }));
  }
  // 抄表卡片右上角的標籤：結算月份選錯（橘色，見 monthFlags）；裝機抄表、順便抄、沒有上次（填了結算月份，但這台之前沒有抄表可以比；都算不出使用量）
  function readingTag(rec) {
    const flag = monthFlags().get(rec.id);
    if (flag) return { label: flag, cls: 'orange' };
    const kind = readingKind(rec);
    const u = usage(rec);
    const label = kind || (u.length && u.every(x => x.diff === null) ? '沒有上次' : '');
    return label ? { label, cls: 'gray' } : null;
  }

  // 表單上結算月份下面：這台設備在這個位置這個月已經抄過了；比之前那筆的月份早、比之後那筆的月份晚（都還是可以存）
  //   空白時：寫這筆是起點還是順便抄；撤機那天的順便抄提醒要填（撤機前最後一次要結帳，不然這一段不算）
  function monthNote(values) {
    if (!values.month) {
      const kind = values.date ? readingKind(values) : '';
      if (kind === '順便抄' && of('moves', values.device).some(m => m.type === '撤機' && String(m.date) === String(values.date))) {
        return { text: '撤機前最後一次，要填結算月份，不然這段不算', warn: true };
      }
      return kind ? `空白＝${kind}，不算帳` : '空白＝不算帳';
    }
    if (!values.device) return '';
    const date = String(values.date ?? '');
    const here = key(locationAt(values.device, date));
    const others = readingLines().get(key(values.device))?.filter(r => r.id !== values.id && r.month) || [];
    const dup = others.find(r => r.month === values.month && key(locationAt(r.device, r.date)) === here);
    if (dup) return { text: `這個月已經抄過了（${shortDate(dup.date)}）`, warn: true };
    if (!date) return '';
    const before = others.filter(r => String(r.date ?? '') < date && r.month > values.month).at(-1);
    if (before) return { text: `比 ${shortDate(before.date)} 那筆的月份早`, warn: true };
    const after = others.find(r => String(r.date ?? '') > date && r.month < values.month);
    return after ? { text: `比 ${shortDate(after.date)} 那筆的月份晚`, warn: true } : '';
  }

  // 表單上張數欄位下面（兩行）：上次的張數，打了這次的張數後寫使用量；比上次少時提醒（還是可以存）
  //   values 是表單目前填的內容（張數是打的字），values.id 是正在編輯的那一筆
  //   抄表：上次、使用量跟卡片一樣照算帳的上一次（見 billPrev）；比上次少照有記張數的任何一筆（保養填的也算）
  //   use 為 false 時只寫有記張數的上一筆，不寫使用量（保養：卡片的使用量是上次換同一項到這次，項目下面寫了）
  function countNote(values, k, use = true) {
    const v = U.parseNum(String(values[k] ?? ''));
    const rec = { ...values, [k]: v };
    const any = values.device ? previous(rec, k) : null;
    if (!any) return '';
    const lastOf = p => `上次 ${fmt(p[k])}（${shortDate(p.date)}）`;
    if (v !== null && v < any[k]) return { text: `${lastOf(any)}\n比上次少`, warn: true };
    const prev = use ? billPrev(rec, k) : null;
    if (!prev) return lastOf(any);
    return v === null ? lastOf(prev) : `${lastOf(prev)}\n使用量 ${fmt(v - prev[k])}`;
  }

  // ---------- 每個位置的用量：以「一期」算（兩次抄表之間），每月抄、一季抄、半年抄的都比得公平 ----------
  //   一筆抄表的用量＝那台機器這次減上一次抄表（中間保養填的張數不算分段，整期才不會少算）；算在抄表那天機器所在的位置
  //   一期幾個月：結算月份和上一次抄表的結算月份差幾個月；結算月份空白的起點只當上一次，不算一期；順便抄的跳過（見 isStart）
  //   同一個位置同一個結算月份有好幾筆（換機那個月、倉庫）加起來；第一次抄表、比上次少的（換主機板）不算
  //   一次把全部的位置算好（位置頁每張卡片都要，一個一個找太慢）：Map(位置編號 → [{ month, months, bw, color, total }]，舊到新)
  const monthIndex = m => { const [y, mo] = String(m).split('-').map(Number); return y * 12 + mo - 1; };
  const usageByPlace = () => cached('usage', placeUsages);
  function placeUsages() {
    const out = new Map();
    readingLines().forEach(line => {
      const last = {}; // 每一種張數上一次抄表的那一筆
      line.forEach(r => {
        if (!r.month && !isStart(r)) return;
        const diffs = r.month ? COUNTS.map(([c]) => c).filter(c => isNum(r[c]) && last[c] && r[c] >= last[c][c]).map(c => [c, r[c] - last[c][c], last[c]]) : [];
        if (diffs.length) {
          // 上一次是安裝當天的起點（沒有結算月份）：照日期換算幾個月
          const prev = diffs[0][2];
          const months = prev.month ? monthIndex(r.month) - monthIndex(prev.month)
            : Math.round((Date.parse(r.date) - Date.parse(prev.date)) / (30.44 * 86400000));
          const place = key(locationAt(r.device, r.date));
          if (!out.has(place)) out.set(place, new Map());
          const byMonth = out.get(place);
          if (!byMonth.has(r.month)) byMonth.set(r.month, { month: r.month, months: 0, bw: null, color: null });
          const m = byMonth.get(r.month);
          m.months = Math.max(m.months, months || 1);
          diffs.forEach(([c, d]) => { m[c] = (m[c] || 0) + d; });
        }
        COUNTS.forEach(([c]) => { if (isNum(r[c])) last[c] = r; });
      });
    });
    const result = new Map();
    out.forEach((byMonth, place) => result.set(place, [...byMonth.values()]
      .sort((a, b) => cmp(a.month, b.month))
      .map(m => ({ ...m, total: (m.bw || 0) + (m.color || 0) }))));
    return result;
  }
  const placeUsage = (code, all = usageByPlace()) => all.get(key(code)) || [];

  // 位置卡片上的用量：最近一期，和前一期比每月平均（漲或跌幾 %）
  //   { label: '9 月' 或 '7–9 月', months, total, perMonth, bw, color, change }；還沒有用量時是 null
  function usageSummary(periods) {
    const p = periods.at(-1);
    if (!p) return null;
    const q = periods.at(-2);
    const per = x => x.total / (x.months || 1);
    const ym = i => ({ y: Math.floor(i / 12), m: i % 12 + 1 });
    const end = ym(monthIndex(p.month));
    const start = ym(monthIndex(p.month) - (p.months || 1) + 1);
    const thisYear = Number(U.today().slice(0, 4));
    const label = p.months > 1
      ? (start.y === end.y ? `${start.y === thisYear ? '' : `${start.y}/`}${start.m}–${end.m} 月` : `${start.y}/${start.m}–${end.y}/${end.m}`)
      : `${end.y === thisYear ? '' : `${end.y}/`}${end.m} 月`;
    return {
      label, months: p.months || 1, total: p.total, perMonth: Math.round(per(p)), bw: p.bw, color: p.color,
      change: q && per(q) > 0 ? per(p) / per(q) - 1 : null,
    };
  }

  // 位置詳情的長條圖：最近 12 個月（到最近一期的結算月份），一個月一條；一期好幾個月的，每個月放那一期的每月平均
  //   （一季抄一次的，同一季三個月一樣高）；[{ month: '2026-09', bw, color, total }]，那個月沒有抄表的是 null，舊到新
  const monthKey = i => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
  function perMonth(periods) {
    const by = new Map();
    periods.forEach(p => {
      const k = p.months || 1;
      for (let i = 0; i < k; i++) {
        by.set(monthIndex(p.month) - i, { bw: p.bw === null ? null : p.bw / k, color: p.color === null ? null : p.color / k, total: p.total / k });
      }
    });
    return by;
  }
  function monthlyUsage(periods, n = 12) {
    if (!periods.length) return [];
    const by = perMonth(periods);
    const end = monthIndex(periods.at(-1).month);
    return Array.from({ length: n }, (_, i) => end - n + 1 + i)
      .map(i => ({ month: monthKey(i), ...(by.get(i) || { bw: null, color: null, total: null }) }));
  }
  // 比去年同期：最近一期的每月平均，和去年同樣那幾個月的每月平均比（漲跌的比例）；去年那幾個月有沒抄到的是 null
  function yearOverYear(periods) {
    const p = periods.at(-1);
    if (!p) return null;
    const by = perMonth(periods);
    const k = p.months || 1;
    const ago = Array.from({ length: k }, (_, i) => by.get(monthIndex(p.month) - i - 12));
    if (ago.some(x => !x)) return null;
    const before = ago.reduce((n, x) => n + x.total, 0) / k;
    return before > 0 ? p.total / k / before - 1 : null;
  }

  // 每個位置目前的合約（一次算好，位置頁用）：Map(位置編號 → 合約)；和 currentContract 一樣
  function currentContracts() {
    const by = new Map();
    [...Store.list('contracts')].sort(byDate('signDate')).forEach(r => placesOf(r).forEach(p => by.set(key(p), r)));
    by.forEach((r, k) => { if (endedEarly(r)) by.delete(k); });
    return by;
  }
  // 位置卡片上的合約：{ text, sub, warn }（已到期、剩幾天到期標色）；沒有合約時是 null
  function contractShort(c) {
    if (!c) return null;
    const date = c.endDate ? U.fmtDate(c.endDate) : '';
    if (c.earlyEnd) return { text: '提前結束', sub: U.fmtDate(c.earlyEnd), warn: false };
    if (!c.endDate) return { text: '沒有到期日', sub: '', warn: false };
    const days = daysTo(c.endDate);
    if (days < 0) return { text: '已到期', sub: date, warn: true };
    if (days <= CONTRACT_SOON) return { text: days ? `剩 ${days} 天` : '今天到期', sub: date, warn: true };
    return { text: `到 ${date}`, sub: '', warn: false };
  }

  // ---------- 耗材（保養項目）：一支能印多少、已用幾 %、預估什麼時候到 ----------
  //   壽命：保養項目有設定的用設定的（感光鼓 10 萬，提前回收保養）；沒設定的用這台機器在這個位置換過的平均（碳粉）
  //   算哪種張數：保養項目設定的；空白時照名稱，碳粉 C、M、Y 只算彩色，其他算黑白加彩色
  //   一段：這次換到下次換之間印了幾張；安裝那天的耗材當新的（安裝當天會抄表），安裝到第一次換也算一段
  //   換的那天的張數：保養填的；沒填時照那天的抄表，沒有就用前後兩次推算（約）
  //   預估：從上次換（或安裝）到最近一次抄表，平均一天印幾張，算還能印幾天
  const TONER_COLOR = /碳粉\s*[CMY]$/i;
  const SOON_DAYS = 14; // 預估這麼多天內到，算「耗材快到了」
  const itemOption = name => Store.list('options').find(o => o.list === '保養項目' && key(o.name) === key(name)) || null;
  function itemKind(name, opt = itemOption(name)) {
    const v = String(opt?.pages ?? '').trim();
    if (v) return v === '彩色' ? 'color' : 'total';
    return TONER_COLOR.test(String(name ?? '').trim()) ? 'color' : 'total';
  }
  // 保養項目表單上算哪種張數下面：空白時會怎麼算
  function pagesNote(v) {
    if (String(v.pages ?? '').trim()) return '';
    return itemKind(v.name, {}) === 'color' ? '空白時照名稱：只算彩色' : '空白時照名稱：黑白加彩色';
  }
  const pagesBy = (kind, p) => {
    if (!p) return null;
    if (kind === 'color') return isNum(p.color) ? p.color : null;
    return isNum(p.bw) || isNum(p.color) ? (p.bw || 0) + (p.color || 0) : null;
  };
  // 那天的張數：那天抄的（或保養填的）；沒有時照前後兩次推算；只有之前的用之前的；approx 是推算的
  function counterAt(points, date) {
    const d = String(date ?? '');
    const same = points.filter(p => String(p.date) === d).at(-1);
    if (same) return { bw: same.bw, color: same.color, approx: false };
    const before = points.filter(p => String(p.date) < d).at(-1);
    const after = points.find(p => String(p.date) > d);
    if (before && after) {
      const t = (Date.parse(d) - Date.parse(before.date)) / (Date.parse(after.date) - Date.parse(before.date));
      const mix = c => (isNum(before[c]) && isNum(after[c]) ? Math.round(before[c] + (after[c] - before[c]) * t) : null);
      return { bw: mix('bw'), color: mix('color'), approx: true };
    }
    return before ? { bw: before.bw, color: before.color, approx: true } : null;
  }

  // 每台機器的張數、保養、異動（總覽每個位置都要算）
  const consumeContext = () => cached('consume', () => ({
    points: meterLines(),
    works: groupBy(Store.list('maintenance'), 'device', byDate('date')),
    moves: moveLines(),
    devicesAt: devicesAt(),
    items: Store.list('options').filter(o => o.list === '保養項目'),
  }));

  // 這個位置現在那台機器的耗材：[{ item, kind, life, lifeSet, avg, count, start, used, pct, eta, over, soon, approx }]
  //   只列換過的、或有設定壽命的；倉庫、空著的位置、一格放好幾台的不算
  //   start：上次換（或安裝）{ date, install }；used：到最近一次抄表印了幾張；eta：預估哪天到（ISO），算不出來是 null
  function consumablesAt(placeCode, c = consumeContext()) {
    const pk = key(placeCode);
    const here = c.devicesAt.get(pk) || [];
    if (here.length !== 1 || place(placeCode)?.stock) return [];
    const d = here[0];
    const dk = key(d.code);
    const points = c.points.get(dk) || [];
    const latest = points.at(-1) || null;
    // 裝進這個位置那天（最後一次搬進來）；之前在別的地方換的不算
    const inAt = (c.moves.get(dk) || []).filter(m => key(m.to) === pk).at(-1) || null;
    const since = inAt ? String(inAt.date) : '';
    const works = (c.works.get(dk) || []).filter(r => String(r.date) >= since);
    const names = [...new Map([...c.items.map(o => [key(o.name), o.name]), ...works.map(r => [key(r.item), r.item])]).values()].filter(Boolean);
    return names.map(item => {
      const opt = c.items.find(o => key(o.name) === key(item)) || null;
      const kind = itemKind(item, opt || {});
      const reps = works.filter(r => key(r.item) === key(item));
      const lifeSet = isNum(opt?.life) && opt.life > 0;
      if (!reps.length && !lifeSet) return null;
      // 每一次換（安裝那天當新的）的張數
      const marks = [...(inAt ? [{ date: inAt.date, install: true }] : []), ...reps.map(r => ({ date: r.date, install: false, rec: r }))]
        .map(m => {
          const own = m.rec && COUNTS.some(([k]) => isNum(m.rec[k])) ? { bw: m.rec.bw, color: m.rec.color, approx: false } : counterAt(points, m.date);
          return { ...m, pages: pagesBy(kind, own), approx: !!own?.approx };
        });
      const gaps = marks.slice(1).map((m, i) => (m.pages !== null && marks[i].pages !== null ? m.pages - marks[i].pages : null)).filter(g => g > 0);
      const avg = gaps.length ? Math.round(gaps.reduce((n, g) => n + g, 0) / gaps.length) : null;
      const life = lifeSet ? opt.life : avg;
      const start = marks.at(-1) || null;
      const now = latest && start && String(latest.date) >= String(start.date) ? pagesBy(kind, latest) : null;
      const used = start && start.pages !== null && now !== null ? Math.max(0, now - start.pages) : null;
      const days = start && latest ? (Date.parse(latest.date) - Date.parse(start.date)) / 86400000 : 0;
      let eta = null;
      if (life && used !== null && used < life && days >= 7 && used > 0) {
        const left = (life - used) / (used / days);
        eta = new Date(Date.parse(latest.date) + left * 86400000).toISOString().slice(0, 10);
      }
      const over = !!(life && used !== null && used >= life);
      return {
        item, kind, life, lifeSet, avg, count: reps.length,
        start: start && { date: start.date, install: start.install }, used,
        pct: life && used !== null ? used / life : null, eta, over,
        soon: over || (eta !== null && daysTo(eta) <= SOON_DAYS), approx: !!start?.approx,
        device: d,
      };
    }).filter(Boolean);
  }

  // 要處理的「耗材快到了」：預估 14 天內到、或已經超過的，每個位置每一項一筆；依預估的日子排（超過的在前）
  function consumablesDue() {
    const c = consumeContext();
    return Store.list('locations').filter(p => !p.stock && !p.disabled)
      .flatMap(p => consumablesAt(p.code, c).filter(x => x.soon).map(x => ({ ...x, place: p, id: `${p.id}:${x.item}` })))
      .sort((a, b) => (b.over - a.over) || cmp(String(a.eta ?? ''), String(b.eta ?? '')));
  }

  // 預估的日子寫成「2027/01 中旬」（1–10 上旬、11–20 中旬、21 以後下旬）
  function etaText(iso) {
    if (!iso) return '';
    const day = Number(iso.slice(8, 10));
    return `${iso.slice(0, 4)}/${iso.slice(5, 7)} ${day <= 10 ? '上旬' : day <= 20 ? '中旬' : '下旬'}`;
  }

  // 這台上次換同一項（日期比較早的最後一筆，在哪裡換的都算；保養卡片、表單用 workStart 只算裝到這裡之後的）
  const prevWork = (r, c) => (key(r.item) ? (c.works.get(key(r.device)) || [])
    .filter(w => key(w.item) === key(r.item) && w.id !== r.id && String(w.date) < String(r.date)).at(-1) || null : null);
  // 一筆保養那時候的張數：有填的用填的，沒填的照前後的抄表推算（approx）
  const workCounter = (r, points) => (COUNTS.some(([k]) => isNum(r[k])) ? r : counterAt(points, r.date));

  // 這次換的使用量從哪裡算起（跟耗材一樣，見 consumablesAt）：裝到這個位置之後上一次換同一項；還沒換過的從裝進來那天算（安裝那天當新的）
  //   在別的地方換的不算；在倉庫、裝進來當天換的沒有起點；沒有異動的（補登的機器）只看上一次換
  //   回傳 { date, install, at: 那時候的張數 { bw, color, approx } }；沒有起點時 null
  function workStart(r, c) {
    const date = String(r.date ?? '');
    const dk = key(r.device);
    const here = key(locationAt(r.device, date));
    const inAt = (c.moves.get(dk) || []).filter(m => key(m.to) === here && String(m.date ?? '') <= date).at(-1) || null;
    const since = inAt ? String(inAt.date) : '';
    const points = c.points.get(dk) || [];
    const prev = prevWork(r, c);
    if (prev && String(prev.date) >= since) return { date: prev.date, install: false, at: workCounter(prev, points) };
    if (!inAt || since === date || place(here)?.stock) return null;
    return { date: since, install: true, at: counterAt(points, since) };
  }

  // 保養卡片的黑白、彩色兩欄（排法跟抄表卡片一樣，見 readingCols）：這次有填的張數 [{ label, use, tone, count }]
  //   使用量：上次換同一項（還沒換過的從安裝那天）到這次印了幾張（見 workStart），黑白、彩色分開寫；那天沒填張數的照抄表推算，寫「約」
  //   算不出來的寫「—」；比上次少時橘字（推算的寫「—」）；這次沒填張數的不寫
  function workCols(r) {
    const was = workStart(r, consumeContext())?.at || null;
    return COUNTS.filter(([k]) => isNum(r[k])).map(([k, label]) => {
      const diff = isNum(was?.[k]) ? r[k] - was[k] : null;
      return { label, ...useCell(was?.approx && diff < 0 ? null : diff, !!was?.approx), count: fmt(r[k]) };
    });
  }

  // 保養表單上項目下面（兩行）：這台上次換這一項是哪天（還沒換過的寫安裝那天，見 workStart）、到現在印了幾張（填了張數用填的）、這個位置的平均
  //   比平均少很多（不到七成）時提醒：換得太快，可能機器有問題或耗材被拿走
  function itemNote(values) {
    if (!values.device || !values.item || !values.date) return '';
    const c = consumeContext();
    const kind = itemKind(values.item);
    const start = workStart(values, c);
    if (!start) return '';
    const points = c.points.get(key(values.device)) || [];
    const typed = { bw: U.parseNum(String(values.bw ?? '')), color: U.parseNum(String(values.color ?? '')) };
    const nowPages = isNum(typed.bw) || isNum(typed.color) ? pagesBy(kind, typed) : pagesBy(kind, counterAt(points, values.date));
    const prevPages = pagesBy(kind, start.at);
    const avg = consumablesAt(locationAt(values.device, values.date), c).find(x => key(x.item) === key(values.item))?.avg ?? null;
    const head = `${start.install ? '安裝' : '上次換'} ${shortDate(start.date)}`;
    if (nowPages === null || prevPages === null || nowPages < prevPages) return head;
    const pages = nowPages - prevPages;
    // 項目是半格：平常兩行寫上次換、到現在幾張；比平均少很多時第二行寫平均
    return avg && pages < avg * 0.7
      ? { text: `${head}，約 ${fmt(pages)} 張\n比平均 ${fmt(avg)} 少很多`, warn: true }
      : `${head}\n到現在約 ${fmt(pages)} 張`;
  }

  // ---------- 最新回報：抄表程式每台最新一次的張數、碳粉（設備卡片、設備詳情） ----------
  //   連結 Google 時是試算表「最新回報」分頁讀回來的（見 sync.js）；沒有時用匯入的 data.json 裡的（假資料，見 tools/make-demo.mjs）
  //   先用序號找，找不到再用設備編號
  //   多久以前：今天、昨天綠字（fresh）、超過 3 天橘字（old，抄表程式可能停了，總覽的「回報停了」也是；週五回報到週一隔 3 天，週末不算），中間灰字
  const TONER_LOW = 20; // 碳粉幾 % 以下紅字
  const REPORT_FRESH = 1;
  const REPORT_OLD = 3;
  const reports = () => (typeof Sync !== 'undefined' && Sync.state().toner) || Store.toner() || [];
  function latestReport(d, list = reports()) {
    return (key(d.serial) && list.find(x => key(x.serial) === key(d.serial))) || list.find(x => key(x.device) === key(d.code)) || null;
  }
  const reportDays = t => (t?.date ? Math.round((Date.parse(U.today()) - Date.parse(t.date)) / 86400000) : null);
  const agoText = n => (n <= 0 ? '今天' : n === 1 ? '昨天' : `${n} 天前`);
  const reportTone = n => (n === null ? '' : n <= REPORT_FRESH ? 'fresh' : n > REPORT_OLD ? 'old' : '');
  // 設備詳情右上角：2026/10/21 08:30・今天
  const reportWhen = t => `${U.fmtDate(t.date)} ${t.time}`.trim() + `・${agoText(reportDays(t))}`;

  // 設備卡片序號那一行的右邊（「出租中」下面）：{ text: '今天 08:30', tone }；沒回報過的 null
  //   今天、昨天寫時間，再早的只寫 N 天前；碳粉不寫（太長，使用者另外處理）
  function reportNote(d, list) {
    const t = latestReport(d, list);
    const n = reportDays(t);
    if (n === null) return null;
    return { text: n <= 1 && t.time ? `${agoText(n)} ${t.time}` : agoText(n), tone: reportTone(n) };
  }

  // ---------- 總覽的要處理：回報停了、該抄表了、狀態和位置對不上 ----------
  // 只看現在放在客戶那裡的機器：不是倉庫、沒停用的位置；報廢這類（狀態勾「不用提醒」）的不算
  function placedDevices() {
    const quiet = quietSet();
    return Store.list('devices').map(d => ({ device: d, place: place(d.location) }))
      .filter(x => x.place && !x.place.stock && !x.place.disabled && !quiet.has(key(x.device.status)));
  }
  const byPlaceName = (a, b) => String(a.place.name ?? '').localeCompare(String(b.place.name ?? ''), 'zh-Hant');

  // 回報停了：回報過、超過 3 天沒回報（沒裝抄表程式的不列）；越久的越上面
  //   [{ id, device, place, report, days }]
  function reportsDue(list = reports()) {
    return placedDevices().map(x => {
      const report = latestReport(x.device, list);
      return { ...x, id: x.device.id, report, days: reportDays(report) };
    }).filter(x => x.days !== null && x.days > REPORT_OLD).sort((a, b) => b.days - a.days || byPlaceName(a, b));
  }

  // 狀態和位置對不上：出租中卻放在倉庫或沒有位置、庫存卻放在客戶那裡（照異動帶的狀態：安裝帶出租中、撤機帶庫存）
  //   刪掉異動、在試算表裡改了異動時，位置會跟著算，狀態不會（見 applyMoveStatus），列出來自己改
  //   沒有位置的：以前新增設備時預設出租中、位置空白，存進去的看起來像租出去了；庫存、其他狀態沒有位置不算
  //   維修中、報廢這類放在哪裡都可以；依位置名稱排，沒有位置的排最後（照機型）
  //   [{ id, device, place（沒有位置的是 null）, status }]
  function statusMismatch() {
    const atStock = new Map([[MOVE_STATUS.安裝, false], [MOVE_STATUS.撤機, true]]); // 這個狀態的機器該放在倉庫嗎
    return Store.list('devices').map(d => ({ id: d.id, device: d, place: place(d.location), status: statusOf(d) }))
      .filter(x => (x.place ? atStock.has(x.status) && atStock.get(x.status) !== !!x.place.stock
        : !key(x.device.location) && x.status === MOVE_STATUS.安裝))
      .sort((a, b) => (!a.place - !b.place) || (a.place ? byPlaceName(a, b) : deviceOrder(a.device, b.device)));
  }

  // 該抄表了：照合約的抄表週期，該抄的結算月份過完再 10 天還沒有抄表（每月 5 日抄上個月的來得及）
  //   週期：這個位置目前的合約的抄表週期；空白、沒有合約的當每月
  //   該抄的結算月份：這個位置最後一次算帳的抄表（有結算月份的，哪一台機器抄的都算，自動抄表寫進來的也算）＋週期
  //     現在這台搬進來之後還沒算過帳的（剛裝、剛換機，或很久以前別的客戶留下的）：搬進來那天的起點當那個月算過
  //   沒有搬進來的異動、也沒抄過的算不出來，不列
  //   [{ id, device, place, cycle, last: 上次結算月份（現在這台還沒算過帳的空白）, due: 該抄的結算月份 }]；越早該抄的越上面
  const READ_GRACE = 10;
  const CYCLE_MONTHS = { 每月: 1, 雙月: 2, 每季: 3, 半年: 6, 每年: 12 };
  const cycleOf = c => (CYCLE_MONTHS[String(c?.cycle ?? '').trim()] ? String(c.cycle).trim() : '每月');
  function readingsDue() {
    const billed = new Map(); // 位置編號 → 最後一次算帳的結算月份
    Store.list('readings').forEach(r => {
      if (!r.month || !key(r.device)) return;
      const p = key(locationAt(r.device, r.date));
      if (String(r.month) > (billed.get(p) || '')) billed.set(p, String(r.month));
    });
    const contracts = currentContracts();
    const deadline = `-${String(READ_GRACE).padStart(2, '0')}`;
    return placedDevices().flatMap(x => {
      const pk = key(x.place.code);
      const cycle = cycleOf(contracts.get(pk));
      const arrive = of('moves', x.device.code).filter(m => key(m.to) === pk)
        .reduce((v, m) => (String(m.date ?? '') > v ? String(m.date) : v), '').slice(0, 7);
      const billedAt = billed.get(pk) || '';
      const last = billedAt && billedAt >= arrive ? billedAt : '';
      const from = last || arrive;
      if (!from) return [];
      const due = monthIndex(from) + CYCLE_MONTHS[cycle];
      if (U.today() <= monthKey(due + 1) + deadline) return [];
      return [{ ...x, id: x.device.id, cycle, last, due: monthKey(due) }];
    }).sort((a, b) => cmp(a.due, b.due) || byPlaceName(a, b));
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

  // 匯入 data.json、以 Google 為主時要加的：這台（和 Google 同一份）沒有的，用 id 比對
  //   清單（狀態、選項、人員、廠商）已經有同名的不加：資料寫的是名字，同名的就是同一個
  //   在 Google 刪掉、檔案裡還有的分不出來，會加回去；回傳 [{ table, rec }]
  function fileOnly(parsed) {
    const named = ['statuses', 'options', 'people', 'vendors'];
    const out = [];
    Object.keys(SCHEMAS).forEach(t => {
      const have = Store.list(t);
      (parsed[t] || []).forEach(rec => {
        const same = r => r.id === rec.id
          || (named.includes(t) && key(r.name) && key(r.name) === key(rec.name) && (t !== 'options' || r.list === rec.list));
        if (have.some(same) || out.some(o => o.table === t && same(o.rec))) return;
        out.push({ table: t, rec });
      });
    });
    return out;
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
    place, placeName, placeText, placeSub, machinesAt, slotNote, keepOldName, placeByName, movesAt, staysAt, spanText, recordsAt,
    hasMoves, moveTitle, syncLocations, freeFirst, moveStatus, deviceStatus, applyMoveStatus, placeBefore,
    moveDevices, movePlaces, moveDevicesNote, movePlacesNote, moveTypeCheck, moveToCheck, moveDeviceCheck, moveTypeFor, moveTypeAt,
    moveDateNote, moveToNote, isStock, disableCheck, readingAfterMove, contractsDue, warrantyDue, emptyPlaces, lastMoveAt,
    placesOf, contractPlaces, contractsAt, currentContract, deviceContract, isCurrentContract, contractNote, endText,
    logContract, contractHistory, dropContractLog,
    countsText, usage, usageNote, readingKind, readingUse, readingCols, readingTag, monthNote, countNote, usageByPlace, placeUsage, usageSummary, monthlyUsage, yearOverYear, currentContracts, contractShort,
    workNote, workCols, refurbNote, serialNote, itemKind, pagesNote, counterAt, consumablesAt, consumablesDue, etaText, itemNote,
    TONER_LOW, latestReport, reportDays, reportTone, reportWhen, reportNote, reportsDue, readingsDue, statusMismatch,
    partOrder, partNote, statusOf, modelCounts, guessGen, genNote, modelGroups, OTHER_GEN, orphans, lostPlaces, followCodes, fixPlaceRefs, upgrade, fileOnly,
  };
})();
