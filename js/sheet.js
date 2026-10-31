// 試算表格式：App 的資料 ↔ Google 試算表的列（只做轉換，不連網路）
//   每張資料表一個分頁，分頁名稱和頁面標題一樣；另有隱藏的 _meta 分頁（第 1 列格式版本、第 2 列自動抄表的讀信網址、第 3 列上次讀信的時間、第 4 列寄信用 Gmail）
//   「最新回報」分頁是試算表上的程式寫的（抄表程式每台最新一次的回報，見 apps-script/meter.gs），App 只讀不寫
//   第一列是中文標題（和表單欄位名稱一樣），最後一欄是 id；讀取時依標題找欄位，調換欄位順序也讀得到
//   編號、序號等文字欄設成純文字（001 不會變成 1）；日期存成試算表的日期（可以排序、篩選）；勾選的欄位是核取方塊
//   讀取時容許手動輸入：空白列略過、沒有 id 的列補上 id；
//   只有 id、沒勾的核取方塊的列不是資料（補上勾選欄時 Google 會把整欄空白格填成 FALSE）：記在 junk，同步時刪掉
//   缺了選填的欄（新版加的欄位、被刪掉的欄）：記在 addColumns，同步時補在最後面、用 App 的資料填上；
//     這一欄讀不到，所以讀回來的資料沒有這個欄位（合併時用 App 的值，見 storage.js 的 mergeRemote）
//   看不懂的值記在 problems（例如「設備第 12 列：購買日期看不懂」），其他資料照常讀進來
//   格式版本（_meta 分頁）：
//     1（2026-10-11）：第一版（同一天加了位置、合約修改紀錄兩個分頁，合約的設備欄換成位置；還沒有人用過，所以沒有升版）
const Sheet = (() => {
  const VERSION = 1;
  const ID = 'id';
  const META = { title: '_meta', sheetId: 99 };
  const METER_KEY = 'meterUrl'; // _meta 第 2 列：自動抄表的讀信網址（Apps Script 部署成網頁應用程式的網址，見 sync.js 的 setMeterUrl）
  const METER_AT_KEY = 'meterReadAt'; // _meta 第 3 列：試算表上的程式上次看完信箱的時間（ISO 文字，程式寫的，見 apps-script/meter.gs）
  const SENDER_KEY = 'senderMail'; // _meta 第 4 列：機器寄信用的 Gmail（機器設定那頁填的，見 sync.js 的 setSenderMail）
  const TONER = '最新回報'; // 試算表上的程式寫的分頁（張數、碳粉）；沒有這個分頁時不讀（見 sync.js 的 pull）
  const TABLES = Object.keys(SCHEMAS);
  const TAB = Object.fromEntries(TABLES.map((t, i) => [t, {
    title: SCHEMAS[t].title,
    sheetId: i + 1,
    fields: SCHEMAS[t].fields,
    headers: [...SCHEMAS[t].fields.map(f => f.label), ID],
  }]));

  // ---------- 日期：試算表的日期是從 1899-12-30 起算的天數 ----------
  const EPOCH = Date.UTC(1899, 11, 30);
  const DAY = 86400000;

  function toSerial(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return (Date.UTC(y, m - 1, d) - EPOCH) / DAY;
  }

  function fromSerial(n) {
    const d = new Date(EPOCH + Math.floor(n) * DAY);
    return `${d.getUTCFullYear()}-${U.pad2(d.getUTCMonth() + 1)}-${U.pad2(d.getUTCDate())}`;
  }

  const blank = v => v === undefined || v === null || String(v).trim() === '';

  // 第 0 欄是 A、第 26 欄是 AA
  function colLetter(c) {
    let s = '';
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }

  // ---------- 寫入：資料 → 列 ----------
  function encode(f, v) {
    if (f.type === 'flag') return !!v;
    if (v === null || v === undefined || v === '') return '';
    switch (f.type) {
      case 'date': {
        const iso = U.parseDate(v);
        return iso ? toSerial(iso) : String(v);
      }
      case 'number':
        return typeof v === 'number' ? v : String(v);
      case 'month':
        return U.fmtMonth(v); // 存成文字 2026/09
      default:
        return String(v);
    }
  }

  // 一筆資料 → 一列；header 是試算表目前的標題列（欄位順序可能被調整過）
  //   不認得的欄位填 null：Sheets API 寫入時會略過，不會清掉使用者自己加的欄位
  function encodeRow(t, rec, header = TAB[t].headers) {
    const byLabel = new Map(TAB[t].fields.map(f => [f.label, f]));
    return header.map(h => {
      const label = String(h ?? '').trim();
      if (label === ID) return rec.id;
      const f = byLabel.get(label);
      return f ? encode(f, rec[f.key]) : null;
    });
  }

  // 全部資料 → { 分頁名稱: 二維陣列（含標題列） }
  function toValues(data) {
    const out = {};
    TABLES.forEach(t => {
      out[TAB[t].title] = [TAB[t].headers, ...(data[t] || []).map(r => encodeRow(t, r))];
    });
    return out;
  }

  // ---------- 讀取：列 → 資料 ----------
  // values 是 Sheets API 以 UNFORMATTED_VALUE、SERIAL_NUMBER 讀回的二維陣列，從 A1 開始：
  //   日期格是數字（序號），手動打成文字的日期是字串；每列尾端的空白格會被省略
  function headerIndex(row) {
    const idx = new Map();
    (row || []).forEach((h, i) => {
      const label = String(h ?? '').trim();
      if (label && !idx.has(label)) idx.set(label, i);
    });
    return idx;
  }

  function problem(ctx, tab, row, msg) {
    ctx.problems.push({ tab, row, msg });
  }

  // 勾選：核取方塊讀回來是 true／false；手打的「是」「v」「1」也算有勾
  const YES = /^(是|true|v|✓|✔|y|yes|1)$/i;
  const NO = /^(否|false|n|no|0|x)$/i;

  // 回傳 { value, error }；空白時文字欄是 ''、數字和日期是 null（有預設值的數字用預設值）、勾選是 false
  function decode(f, raw) {
    if (f.type === 'flag') {
      if (typeof raw === 'boolean') return { value: raw };
      if (blank(raw)) return { value: false };
      const t = U.toHalf(String(raw)).trim();
      if (YES.test(t)) return { value: true };
      if (NO.test(t)) return { value: false };
      return { value: false, error: `${f.label}看不懂（${raw}），要勾選或空白` };
    }
    if (blank(raw)) {
      if (f.type === 'number' || f.type === 'date') return { value: f.default ?? null };
      return { value: '' };
    }
    switch (f.type) {
      case 'date': {
        const iso = typeof raw === 'number' ? fromSerial(raw) : U.parseDate(raw);
        return iso ? { value: iso } : { value: null, error: `${f.label}看不懂（${raw}）` };
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : U.parseNum(raw);
        return n === null ? { value: null, error: `${f.label}不是數字（${raw}）` } : { value: n };
      }
      case 'month': {
        // 被改成日期格式時讀回來是序號，取年月
        const ym = typeof raw === 'number' ? fromSerial(raw).slice(0, 7) : U.parseMonth(raw);
        return ym ? { value: ym } : { value: '', error: `${f.label}看不懂（${raw}），要寫成 2026/09` };
      }
      default:
        // 編號、序號被改成數字格式時，開頭的 0 會不見（001 → 1），無法自動補回
        if (typeof raw === 'number' && (f.caps || f.auto)) {
          return { value: String(raw), error: `${f.label}被存成數字 ${raw}，開頭的 0 可能不見了，請把這一欄設成純文字後重打` };
        }
        return { value: String(raw).trim() };
    }
  }

  // 沒有 id 或 id 重複的列給新的 id，記在 idFixes 讓同步時寫回試算表
  //   整個分頁沒有 id 欄時，記在 addIdHeader（寫在最後一個標題的右邊）
  function idColumn(tab, idx, header, ctx) {
    ctx.rowOf[tab] = {};
    ctx.headers[tab] = [...header];
    if (idx.has(ID)) return idx.get(ID);
    const col = header.length;
    ctx.addIdHeader.push({ tab, col });
    ctx.headers[tab][col] = ID;
    return col;
  }

  function takeId(cells, col, tab, row, seen, ctx) {
    let id = blank(cells[col]) ? '' : String(cells[col]).trim();
    if (!id || seen.has(id)) {
      id = U.uid();
      ctx.idFixes.push({ tab, row, col, id });
    }
    seen.add(id);
    ctx.rowOf[tab][id] = row;
    return id;
  }

  function readTable(t, values, ctx) {
    const { title: tab, fields } = TAB[t];
    if (!values || !values.length) {
      problem(ctx, tab, null, `找不到「${tab}」分頁或分頁是空的`);
      ctx.broken.push(t);
      return [];
    }
    const header = values[0] || [];
    const idx = headerIndex(header);
    // 欄位依標題找，找不到再找改名前的標題（was）；{ key: { col, label } }
    const at = {};
    fields.forEach(f => {
      const label = [f.label, ...(f.was || [])].find(l => idx.has(l));
      if (label) at[f.key] = { col: idx.get(label), label };
    });
    const lost = fields.filter(f => !f.optional && !at[f.key]);
    lost.forEach(f => problem(ctx, tab, 1, `找不到「${f.label}」欄，請把標題改回「${f.label}」`));
    if (lost.length) ctx.broken.push(t);
    const idCol = idColumn(tab, idx, header, ctx);
    // 缺了選填的欄：補在最後面（id 欄之後），同步時寫上標題和 App 的資料
    const absent = fields.filter(f => f.optional && !at[f.key]);
    if (absent.length) ctx.missing[t] = absent.map(f => f.key);
    absent.forEach(f => {
      const col = ctx.headers[tab].length;
      ctx.headers[tab][col] = f.label;
      ctx.addColumns.push({ table: t, tab, key: f.key, col });
    });
    // 改名前的標題：同步時改成新的（headers 先換掉，寫回資料時才對得上欄位）
    fields.filter(f => at[f.key] && at[f.key].label !== f.label).forEach(f => {
      ctx.headers[tab][at[f.key].col] = f.label;
      ctx.rewrites.push({ table: t, tab, row: 1, col: at[f.key].col, value: f.label });
    });
    const seen = new Set();
    const rows = [];

    values.slice(1).forEach((cells, i) => {
      const row = i + 2;
      if (!cells || cells.every(blank)) return;
      if (cells.every((v, c) => c === idCol || blank(v) || v === false)) {
        ctx.junk.push({ table: t, tab, row });
        return;
      }
      const rec = {};
      fields.forEach(f => {
        const col = at[f.key]?.col;
        if (col === undefined && f.optional) return; // 這一欄還不在試算表上
        const raw = col === undefined ? '' : cells[col];
        const { value, error } = decode(f, raw);
        if (error) problem(ctx, tab, row, error);
        // 系統產生的（設備的編號）空白時，同步時會補上，不算問題
        else if (!f.optional && !f.auto && col !== undefined && (value === null || value === '')) problem(ctx, tab, row, `${f.label}空白`);
        if (value !== undefined) rec[f.key] = value;
      });
      rows.push({ id: takeId(cells, idCol, tab, row, seen, ctx), ...rec });
    });
    return rows;
  }

  // _meta 分頁一列一項：第一格是名稱、第二格是值
  const metaValue = (values, key) => (values || []).find(r => String(r?.[0] ?? '').trim() === key)?.[1];

  // _meta 分頁記的格式版本；沒有這個分頁（或讀不到）時當作版本 1
  function metaVersion(values) {
    const v = Number(metaValue(values, 'version'));
    return v > 0 ? v : 1;
  }

  // 「最新回報」分頁：[{ serial, device, date, time, bw, color, K, Y, M, C, ip }]，依標題找欄；沒有這個分頁時是 null
  //   日期讀成 2026-10-21；時間是文字 08:30（被改成時間格式也讀得懂）；張數 0 以上的整數、碳粉 0～100，空白、看不懂的是 null；沒有序號的列略過
  function readToner(values) {
    if (!values) return null;
    const head = (values[0] || []).map(h => String(h ?? '').trim());
    const cell = (cells, label) => (head.includes(label) ? cells[head.indexOf(label)] : '');
    const level = v => (typeof v === 'number' && v >= 0 && v <= 100 ? v : null);
    const count = v => (Number.isInteger(v) && v >= 0 ? v : null);
    const time = v => {
      if (typeof v !== 'number') return String(v ?? '').trim();
      const min = Math.round((v % 1) * 1440);
      return `${U.pad2(Math.floor(min / 60))}:${U.pad2(min % 60)}`;
    };
    return values.slice(1).map(cells => cells || []).filter(cells => !blank(cell(cells, '序號'))).map(cells => {
      const d = cell(cells, '日期');
      return {
        serial: String(cell(cells, '序號')).trim(),
        device: String(cell(cells, '設備') ?? '').trim(),
        date: typeof d === 'number' ? fromSerial(d) : U.parseDate(String(d ?? '')),
        time: time(cell(cells, '時間')),
        bw: count(cell(cells, '黑白張數')),
        color: count(cell(cells, '彩色張數')),
        ...Object.fromEntries(['K', 'Y', 'M', 'C'].map(c => [c, level(cell(cells, `碳粉${c}`))])),
        ip: String(cell(cells, 'IP') ?? '').trim(),
      };
    });
  }

  // byTitle：{ 分頁名稱: values }，由 readRanges() 的範圍讀回，有 _meta、最新回報分頁時也一起讀
  // 回傳 { data, problems, idFixes, addIdHeader, addColumns, missing, rowOf, headers, broken, version, rewrites, junk, meterUrl, meterReadAt, senderMail, toner }
  //   data 和 data.json 同樣的結構
  //   rowOf[分頁][id] 是那一筆在第幾列；headers[分頁] 是標題列（補上 id 欄之後）
  //   broken 是缺分頁或缺欄位的資料表：讀到的資料不完整，同步時不要拿來取代 App 裡的資料
  //   version 是試算表目前的格式版本；rewrites 是要改寫的格子 [{ table, tab, row, col, value }]（改名的標題）
  //   addColumns 是要補上的欄 [{ table, tab, key, col }]；missing[表] 是讀不到的欄位（試算表上還沒有這一欄）
  //   junk 是只有 id、沒勾的核取方塊的列 [{ table, tab, row }]
  function fromValues(byTitle) {
    const ctx = {
      problems: [], idFixes: [], addIdHeader: [], addColumns: [], missing: {}, rowOf: {}, headers: {}, broken: [],
      version: metaVersion(byTitle[META.title]), rewrites: [], junk: [],
    };
    const data = {};
    TABLES.forEach(t => { data[t] = readTable(t, byTitle[TAB[t].title], ctx); });
    const { problems, idFixes, addIdHeader, addColumns, missing, rowOf, headers, broken, version, rewrites, junk } = ctx;
    const meterUrl = String(metaValue(byTitle[META.title], METER_KEY) ?? '').trim();
    const meterReadAt = String(metaValue(byTitle[META.title], METER_AT_KEY) ?? '').trim();
    const senderMail = String(metaValue(byTitle[META.title], SENDER_KEY) ?? '').trim();
    const toner = readToner(byTitle[TONER]);
    return { data, problems, idFixes, addIdHeader, addColumns, missing, rowOf, headers, broken, version, rewrites, junk, meterUrl, meterReadAt, senderMail, toner };
  }

  // 一格的值（補上的欄用）
  const encodeCell = (t, key, rec) => encode(TAB[t].fields.find(f => f.key === key), rec[key]);

  // 「設備第 12 列：購買日期看不懂（2026/13/01）」
  const problemText = p => `${p.tab}${p.row ? `第 ${p.row} 列` : ''}：${p.msg}`;

  // ---------- 建立試算表 ----------
  const allTabs = () => TABLES.map(t => TAB[t]);

  // spreadsheets.create 的 body；分頁 id 固定，設定格式時用得到
  function createBody(title = '設備管理') {
    return {
      properties: { title, locale: 'zh_TW', timeZone: 'Asia/Taipei' },
      sheets: [
        ...allTabs().map(s => ({ properties: { sheetId: s.sheetId, title: s.title, gridProperties: { frozenRowCount: 1 } } })),
        { properties: { sheetId: META.sheetId, title: META.title, hidden: true } },
      ],
    };
  }

  // 勾選的欄位不設格式（核取方塊見 columnRequests）；文字、網址、從清單選的、可以複選的、設備編號都存純文字
  function numberFormat(f) {
    if (f.type === 'date') return { type: 'DATE', pattern: 'yyyy/mm/dd' };
    if (f.type === 'number') return { type: 'NUMBER', pattern: f.digits ? '#,##0.00##' : '#,##0' };
    if (f.type === 'flag') return null;
    return { type: 'TEXT' };
  }

  const defaultIds = () => Object.fromEntries(allTabs().map(s => [s.title, s.sheetId]));

  const column = (sheetId, c) => ({ sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 });
  const headerRow = sheetId => ({ sheetId, startRowIndex: 0, endRowIndex: 1 });
  const style = (range, userEnteredFormat, fields) => ({ repeatCell: { range, cell: { userEnteredFormat }, fields } });
  const format = (range, nf) => style(range, { numberFormat: nf }, 'userEnteredFormat.numberFormat');
  const validate = (range, condition, strict = false) => ({
    setDataValidation: { range, rule: { condition, strict, showCustomUi: true } },
  });
  const protect = (range, description) => ({ addProtectedRange: { protectedRange: { range, description, warningOnly: true } } });

  // 一欄的格式和檢查：日期、數字格式；勾選是核取方塊；有預設值的快選、左右切換的選項是下拉選單（只提醒、不擋）
  function columnRequests(sheetId, c, f) {
    const range = column(sheetId, c);
    const reqs = [];
    const nf = numberFormat(f);
    const list = f.suggest?.length ? f.suggest : f.toggle?.map(o => o.value);
    if (nf) reqs.push(format(range, nf));
    if (f.type === 'date') reqs.push(validate(range, { type: 'DATE_IS_VALID' }));
    if (f.type === 'flag') reqs.push(validate(range, { type: 'BOOLEAN' }, true));
    if (list?.length) reqs.push(validate(range, { type: 'ONE_OF_LIST', values: list.map(v => ({ userEnteredValue: v })) }));
    return reqs;
  }

  // 補上的欄（addColumns）的格式
  function addColumnRequests(sheetId, t, key, c) {
    return columnRequests(sheetId, c, TAB[t].fields.find(f => f.key === key));
  }

  // 格式、下拉選單、保護（spreadsheets.batchUpdate 的 requests）
  //   下拉選單和日期檢查只提醒、不擋（和 App 的快選按鈕一樣）；標題列和 id 欄修改時跳出警告
  //   sheetIds：{ 分頁名稱: sheetId }，只設定有列出的分頁（補建單一分頁時用）
  function setupRequests(sheetIds = defaultIds()) {
    const GRAY_BG = { red: 0.93, green: 0.95, blue: 0.98 };
    const GRAY_TEXT = { red: 0.6, green: 0.6, blue: 0.6 };
    const reqs = [];
    allTabs().filter(s => sheetIds[s.title] !== undefined).forEach(s => {
      const sheetId = sheetIds[s.title];
      const idCol = s.headers.length - 1;
      reqs.push(
        style(headerRow(sheetId), { textFormat: { bold: true } }, 'userEnteredFormat.textFormat.bold'),
        style(headerRow(sheetId), { backgroundColor: GRAY_BG }, 'userEnteredFormat.backgroundColor'),
        format(column(sheetId, idCol), { type: 'TEXT' }),
        style(column(sheetId, idCol), { textFormat: { foregroundColor: GRAY_TEXT } }, 'userEnteredFormat.textFormat.foregroundColor'),
        protect(headerRow(sheetId), '標題列：App 依標題找欄位，請不要修改'),
        protect(column(sheetId, idCol), 'id：App 用來對應每一筆資料，請不要修改'),
      );
      s.fields.forEach((f, c) => reqs.push(...columnRequests(sheetId, c, f)));
    });
    return reqs;
  }

  // _meta 分頁的內容：格式版本，以後改格式時用來判斷要不要轉換
  const metaValues = () => [['version', VERSION]];

  // 同步時讀取的範圍（values.batchGet）
  const readRanges = () => TABLES.map(t => TAB[t].title);

  return {
    VERSION, ID, META, METER_KEY, SENDER_KEY, TONER, TAB,
    toSerial, fromSerial, colLetter,
    encodeRow, encodeCell, toValues, fromValues, problemText,
    createBody, setupRequests, addColumnRequests, metaValues, readRanges,
  };
})();
