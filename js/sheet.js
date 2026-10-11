// 試算表格式：App 的資料 ↔ Google 試算表的列（只做轉換，不連網路）
//   每張資料表一個分頁，分頁名稱和頁面標題一樣；另有隱藏的 _meta 分頁（格式版本）
//   第一列是中文標題（和表單欄位名稱一樣），最後一欄是 id；讀取時依標題找欄位，調換欄位順序也讀得到
//   編號、序號等文字欄設成純文字（001 不會變成 1）；日期存成試算表的日期（可以排序、篩選）
//   讀取時容許手動輸入：空白列略過、沒有 id 的列補上 id；
//   看不懂的值記在 problems（例如「設備第 12 列：購買日期看不懂」），其他資料照常讀進來
//   格式版本（_meta 分頁）：
//     1（2026-10-11）：第一版
const Sheet = (() => {
  const VERSION = 1;
  const ID = 'id';
  const META = { title: '_meta', sheetId: 99 };
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
    if (v === null || v === undefined || v === '') return '';
    switch (f.type) {
      case 'date': {
        const iso = U.parseDate(v);
        return iso ? toSerial(iso) : String(v);
      }
      case 'number':
        return typeof v === 'number' ? v : String(v);
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
      out[TAB[t].title] = [TAB[t].headers, ...data[t].map(r => encodeRow(t, r))];
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

  // 回傳 { value, error }；空白時文字欄是 ''、數字和日期是 null（有預設值的數字用預設值）
  function decode(f, raw) {
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
      default:
        // 編號、序號被改成數字格式時，開頭的 0 會不見（001 → 1），無法自動補回
        if (typeof raw === 'number' && f.caps) {
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
      const rec = {};
      fields.forEach(f => {
        const col = at[f.key]?.col;
        const raw = col === undefined ? '' : cells[col];
        const { value, error } = decode(f, raw);
        if (error) problem(ctx, tab, row, error);
        else if (!f.optional && col !== undefined && (value === null || value === '')) problem(ctx, tab, row, `${f.label}空白`);
        if (value !== undefined) rec[f.key] = value;
      });
      rows.push({ id: takeId(cells, idCol, tab, row, seen, ctx), ...rec });
    });
    return rows;
  }

  // _meta 分頁記的格式版本；沒有這個分頁（或讀不到）時當作版本 1
  function metaVersion(values) {
    const row = (values || []).find(r => String(r?.[0] ?? '').trim() === 'version');
    const v = Number(row?.[1]);
    return v > 0 ? v : 1;
  }

  // byTitle：{ 分頁名稱: values }，由 readRanges() 的範圍讀回，有 _meta 分頁時也一起讀
  // 回傳 { data, problems, idFixes, addIdHeader, rowOf, headers, broken, version, rewrites }
  //   data 和 data.json 同樣的結構
  //   rowOf[分頁][id] 是那一筆在第幾列；headers[分頁] 是標題列（補上 id 欄之後）
  //   broken 是缺分頁或缺欄位的資料表：讀到的資料不完整，同步時不要拿來取代 App 裡的資料
  //   version 是試算表目前的格式版本；rewrites 是要改寫的格子 [{ table, tab, row, col, value }]（改名的標題）
  function fromValues(byTitle) {
    const ctx = {
      problems: [], idFixes: [], addIdHeader: [], rowOf: {}, headers: {}, broken: [],
      version: metaVersion(byTitle[META.title]), rewrites: [],
    };
    const data = {};
    TABLES.forEach(t => { data[t] = readTable(t, byTitle[TAB[t].title], ctx); });
    const { problems, idFixes, addIdHeader, rowOf, headers, broken, version, rewrites } = ctx;
    return { data, problems, idFixes, addIdHeader, rowOf, headers, broken, version, rewrites };
  }

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

  function numberFormat(f) {
    if (f.type === 'date') return { type: 'DATE', pattern: 'yyyy/mm/dd' };
    if (f.type === 'number') return { type: 'NUMBER', pattern: f.digits ? '#,##0.00##' : '#,##0' };
    return { type: 'TEXT' }; // 文字、網址都存純文字
  }

  const defaultIds = () => Object.fromEntries(allTabs().map(s => [s.title, s.sheetId]));

  // 格式、下拉選單、保護（spreadsheets.batchUpdate 的 requests）
  //   下拉選單和日期檢查只提醒、不擋（和 App 的快選按鈕一樣）；標題列和 id 欄修改時跳出警告
  //   sheetIds：{ 分頁名稱: sheetId }，只設定有列出的分頁（補建單一分頁時用）
  function setupRequests(sheetIds = defaultIds()) {
    const GRAY_BG = { red: 0.93, green: 0.95, blue: 0.98 };
    const GRAY_TEXT = { red: 0.6, green: 0.6, blue: 0.6 };
    const column = (sheetId, c) => ({ sheetId, startRowIndex: 1, startColumnIndex: c, endColumnIndex: c + 1 });
    const headerRow = sheetId => ({ sheetId, startRowIndex: 0, endRowIndex: 1 });
    const style = (range, userEnteredFormat, fields) => ({ repeatCell: { range, cell: { userEnteredFormat }, fields } });
    const format = (range, nf) => style(range, { numberFormat: nf }, 'userEnteredFormat.numberFormat');
    const validate = (range, condition) => ({
      setDataValidation: { range, rule: { condition, strict: false, showCustomUi: true } },
    });
    const protect = (range, description) => ({ addProtectedRange: { protectedRange: { range, description, warningOnly: true } } });

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
      s.fields.forEach((f, c) => {
        const range = column(sheetId, c);
        reqs.push(format(range, numberFormat(f)));
        if (f.type === 'date') reqs.push(validate(range, { type: 'DATE_IS_VALID' }));
        if (f.suggest?.length) reqs.push(validate(range, { type: 'ONE_OF_LIST', values: f.suggest.map(v => ({ userEnteredValue: v })) }));
      });
    });
    return reqs;
  }

  // _meta 分頁的內容：格式版本，以後改格式時用來判斷要不要轉換
  const metaValues = () => [['version', VERSION]];

  // 同步時讀取的範圍（values.batchGet）
  const readRanges = () => TABLES.map(t => TAB[t].title);

  return {
    VERSION, ID, META, TAB,
    toSerial, fromSerial, colLetter,
    encodeRow, toValues, fromValues, problemText,
    createBody, setupRequests, metaValues, readRanges,
  };
})();
