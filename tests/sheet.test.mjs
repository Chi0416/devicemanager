// 試算表格式的測試：node --test tests/*.test.mjs
//   用瀏覽器載入的同一份程式（util.js、schema.js、sheet.js 都是全域變數），放進同一個 vm 環境執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
for (const f of ['util', 'schema', 'sheet']) {
  const src = readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
  vm.runInContext(src, ctx, { filename: `${f}.js` });
}
const { Sheet } = vm.runInContext('({ Sheet })', ctx);

// vm 裡建立的物件和這裡的原型不同，比較前先轉成一般物件
const plain = v => JSON.parse(JSON.stringify(v));

// 空白的欄位：文字是 ''，數字和日期是 null（和表單存的、試算表讀回來的一樣）
const device = (id, over = {}) => ({
  id, code: '', name: '', status: '使用中', category: '', brand: '', model: '', serial: '', board: '', location: '', keeper: '',
  buyDate: null, price: null, vendor: '', warranty: null, link: '', note: '', ...over,
});

const person = (id, over = {}) => ({
  id, name: '', code: '', jobTitle: '', dept: '', phone: '', email: '', sales: false, perms: '', all: false, joinDate: null, leaveDate: null, note: '', ...over,
});
// 紀錄：設備欄寫設備編號
const work = (id, over = {}) => ({ id, device: '', date: null, bw: null, color: null, note: '', by: '', report: '', ...over });
const vendor = (id, over = {}) => ({ id, name: '', contact: '', phone: '', address: '', disabled: false, note: '', ...over });

const sample = () => ({
  statuses: [
    { id: 's1', name: '出租中', order: 1, color: '藍', quiet: false, disabled: false },
    { id: 's2', name: '報廢', order: 4, color: '灰', quiet: true, disabled: false },
  ],
  options: [
    { id: 'o1', list: '類別', name: '筆電', order: 1, disabled: false, gen: '', life: null, pages: '' },
    { id: 'o2', list: '品牌', name: 'ASUS', order: null, disabled: false, gen: '', life: null, pages: '' },
    { id: 'o3', list: '品牌', name: '舊品牌', order: null, disabled: true, gen: '', life: null, pages: '' },
  ],
  // 位置：編號系統給的，設備、異動、合約存編號；以前的名字可以好幾行
  locations: [
    { id: 'l1', code: 'L0001', name: '3F 會議室', oldNames: '3F 小會議室（到 2026/01/01）', stock: false, customer: '大華公司', sales: '王小明',
      address: '台北市中正區重慶南路一段 1 號', disabled: false, note: '' },
    { id: 'l2', code: 'L0002', name: '舊倉庫', oldNames: '', stock: true, customer: '', sales: '', address: '', disabled: true, note: '' },
  ],
  // 客戶：統編 0 開頭（純文字）；母公司寫名稱
  customers: [
    { id: 'cu1', name: '大華集團', taxId: '01234567', sales: '', parent: '', billAddress: '台北市信義區松仁路 100 號', shipAddress: '',
      contact: '', phone: '', fax: '', note: '' },
    { id: 'cu2', name: '大華公司', taxId: '87654321', sales: '王小明', parent: '大華集團', billAddress: '台北市信義區松仁路 100 號',
      shipAddress: '台北市中正區重慶南路一段 1 號', contact: '林小姐', phone: '02-2311-0000', fax: '02-2311-0001', note: '帳單寄母公司' },
  ],
  people: [
    person('p1', { name: '王小明', code: 'E001', jobTitle: '資訊組長', dept: '資訊組', email: 'a@gmail.com', sales: true, perms: '記抄表、做異動', joinDate: '2020-02-01' }),
    person('p2', { name: '陳大華', leaveDate: '2026-06-30' }),
  ],
  vendors: [vendor('v1', { name: '原價屋', phone: '02-1234-5678' })],
  devices: [
    device('d1', {
      code: 'NB-001', name: '會議室筆電', category: '筆電', brand: 'ASUS', model: 'B5402', serial: '0123ABC',
      board: 'RNP002673A1B2C3', location: 'L0001', keeper: '王小明', buyDate: '2025-03-15', price: 32000, vendor: '原價屋',
      warranty: '2027-03-14', link: 'https://drive.google.com/x', note: '附充電器\n外接螢幕線另放',
    }),
    device('d2', { code: '007', name: '印表機', status: '維修中' }),
  ],
  moves: [{ id: 'm1', device: 'NB-001', date: '2026-01-05', type: '安裝', from: '', to: 'L0001', status: '出租中', note: '' }],
  // 合約綁位置：一份合約可以寫好幾個位置
  contracts: [{
    id: 'c1', locations: 'L0001、L0002', signDate: '2026-01-01', endDate: '2027-12-31', earlyEnd: null,
    content: '月租 3,000\n含 2,000 張', billing: '超過每張 0.3 元', readDay: '25 日', cycle: '每季',
  }],
  contractLog: [{ id: 'g1', contract: 'c1', date: '2026-06-01', field: '抄表日期', before: '每月 15 日', after: '每月 25 日' }],
  readings: [{ id: 'r1', device: 'NB-001', date: '2026-03-03', month: '2026-02', bw: 12000, color: 100, note: '', by: '阿明', report: '阿明：張數打錯' }],
  maintenance: [
    work('k1', { device: 'NB-001', date: '2026-02-01', item: '碳粉 K', bw: 11800, color: 90 }),
    work('k2', { device: 'NB-001', date: '2026-02-01', item: '感光鼓' }),
  ],
  refurbs: [{
    id: 'f1', device: '007', date: '2026-03-01', stockDate: '2026-03-05', engineer: '王小明', serial: '3101R800999', country: '日',
    source: '日本拍賣', painted: true, content: '換外殼\n清潔內部', note: '',
  }],
  parts: [{ id: 'a1', device: 'NB-001', name: '送紙匣', serial: 'PB1', installDate: '2026-01-05', removeDate: null, note: '' }],
});

// 試算表讀回來時尾端空白格會被省略，模擬這個行為
const trimRows = values => values.map(row => {
  const r = [...row];
  while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === null)) r.pop();
  return r;
});
const asRead = byTitle => Object.fromEntries(Object.entries(byTitle).map(([k, v]) => [k, trimRows(v)]));

// 以全部寫出的資料為底，把某個分頁換成手動輸入的內容
function withTab(title, rows) {
  const v = asRead(plain(Sheet.toValues(sample())));
  v[title] = rows;
  return v;
}

const HEADERS = ['編號', '名稱', '狀態', '類別', '品牌', '機型', '序號', '主機板號碼', '位置', '保管人', '購買日期', '購買金額', '購買廠商', '保固到期', '連結', '備註', 'id'];

test('日期序號：2023-03-15 是 45000，來回轉換不變', () => {
  assert.equal(Sheet.toSerial('2023-03-15'), 45000);
  assert.equal(Sheet.fromSerial(45000), '2023-03-15');
  for (const iso of ['1900-03-01', '2024-02-29', '2026-08-31', '2026-12-31']) {
    assert.equal(Sheet.fromSerial(Sheet.toSerial(iso)), iso);
  }
  assert.equal(Sheet.fromSerial(46265.75), '2026-08-31'); // 有時間的日期只取日期
});

test('寫出後再讀回，資料完全一樣', () => {
  const data = sample();
  const r = plain(Sheet.fromValues(asRead(plain(Sheet.toValues(data)))));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.idFixes, []);
  assert.deepEqual(r.data, plain(data));
});

test('寫出的格式：中文標題、日期是序號、編號是文字、空白寫空字串', () => {
  const v = plain(Sheet.toValues(sample()));
  assert.deepEqual(v['設備'][0], HEADERS);
  const d1 = v['設備'][1];
  assert.equal(d1[0], 'NB-001');
  assert.equal(d1[7], 'RNP002673A1B2C3');
  assert.equal(d1[10], Sheet.toSerial('2025-03-15'));
  assert.equal(d1[11], 32000);
  assert.equal(d1.at(-1), 'd1');
  const d2 = v['設備'][2];
  assert.equal(d2[0], '007');
  assert.equal(d2[10], '');
  assert.equal(d2[11], '');
});

test('手動輸入：空白列略過、沒有 id 的列補上 id、文字的日期和有千分位的金額也讀得懂', () => {
  const r = plain(Sheet.fromValues(withTab('設備', [
    HEADERS,
    [],
    ['', '', ''],
    ['PR-002', '影印機', '閒置', '印表機', '', '', '', '', '2F', '', '2024/9/30', '45,000'],
  ])));
  assert.deepEqual(r.problems, []);
  assert.equal(r.data.devices.length, 1);
  const d = r.data.devices[0];
  assert.equal(d.code, 'PR-002');
  assert.equal(d.status, '閒置');
  assert.equal(d.buyDate, '2024-09-30');
  assert.equal(d.price, 45000);
  assert.equal(d.warranty, null);
  assert.equal(d.note, '');
  assert.equal(r.idFixes.length, 1);
  assert.deepEqual({ ...r.idFixes[0], id: undefined }, { tab: '設備', row: 4, col: 16, id: undefined });
  assert.equal(r.idFixes[0].id, d.id);
});

test('手動輸入：調換欄位順序、多出不認得的欄位都讀得到', () => {
  const r = plain(Sheet.fromValues(withTab('設備', [
    ['自己加的', ...HEADERS.slice(1, 3), HEADERS[0], ...HEADERS.slice(3)],
    ['備忘', '印表機', '維修中', '007', '', '', '', '', '', '', '', '', '', '', '', '', '', 'd2'],
  ])));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.broken, []);
  assert.deepEqual(r.addColumns, []);
  assert.deepEqual(r.data.devices, [plain(sample().devices[1])]);
});

test('少了選填的欄（新版加的欄位、被刪掉的欄）：補在最後面（id 之後），讀回來的資料沒有那幾個欄位', () => {
  const r = plain(Sheet.fromValues(withTab('設備', [
    ['編號', '名稱', '狀態', '位置', 'id'],
    ['007', '印表機', '維修中', '2F', 'd2'],
  ])));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.broken, []);
  assert.deepEqual(r.data.devices, [{ id: 'd2', code: '007', name: '印表機', status: '維修中', location: '2F' }]);
  const missing = ['category', 'brand', 'model', 'serial', 'board', 'keeper', 'buyDate', 'price', 'vendor', 'warranty', 'link', 'note'];
  assert.deepEqual(r.missing, { devices: missing });
  assert.deepEqual(r.addColumns.map(c => [c.key, c.col]), missing.map((k, i) => [k, 5 + i]));
  assert.deepEqual(r.headers['設備'].slice(5, 7), ['類別', '品牌']);
  // 寫回時依補上之後的標題列排列
  const row = plain(Sheet.encodeRow('devices', sample().devices[0], r.headers['設備']));
  assert.equal(row[4], 'd1');
  assert.equal(row[5], '筆電');
  assert.equal(row[9], 'RNP002673A1B2C3');
  assert.equal(row[11], Sheet.toSerial('2025-03-15'));
});

test('缺了 id 欄又缺選填的欄：id 補在最後一個標題右邊，選填的欄再接在後面', () => {
  const r = plain(Sheet.fromValues(withTab('選項', [
    ['清單', '名稱'],
    ['位置', '2F'],
  ])));
  assert.deepEqual(r.addIdHeader, [{ tab: '選項', col: 2 }]);
  assert.deepEqual(r.addColumns, [
    { table: 'options', tab: '選項', key: 'order', col: 3 },
    { table: 'options', tab: '選項', key: 'disabled', col: 4 },
    { table: 'options', tab: '選項', key: 'gen', col: 5 },
    { table: 'options', tab: '選項', key: 'life', col: 6 },
    { table: 'options', tab: '選項', key: 'pages', col: 7 },
  ]);
  assert.deepEqual(r.headers['選項'], ['清單', '名稱', 'id', '順序', '停用', '世代', '壽命（張）', '算哪種張數']);
  assert.equal(r.data.options[0].name, '2F');
  assert.ok(!('disabled' in r.data.options[0]));
});

test('勾選的欄位：寫成 true／false（核取方塊）；手打的「是」「v」「1」也算有勾，看不懂的列成問題', () => {
  const v = plain(Sheet.toValues(sample()));
  assert.deepEqual(v['選項'].map(row => row[3]), ['停用', false, false, true]);
  const r = plain(Sheet.fromValues(withTab('選項', [
    ['清單', '名稱', '停用', 'id'],
    ['位置', 'A', true, 'a'], ['位置', 'B', '是', 'b'], ['位置', 'C', 'v', 'c'], ['位置', 'D', 1, 'd'],
    ['位置', 'E', false, 'e'], ['位置', 'F', '', 'f'], ['位置', 'G', '否', 'g'], ['位置', 'H', '不一定', 'h'],
  ])));
  assert.deepEqual(r.data.options.map(o => o.disabled), [true, true, true, true, false, false, false, false]);
  assert.deepEqual(r.problems.map(Sheet.problemText), ['選項第 9 列：停用看不懂（不一定），要勾選或空白']);
});

test('人員沒有用途欄、廠商沒有類型欄（舊的欄 App 不讀）', () => {
  const v = plain(Sheet.toValues(sample()));
  assert.deepEqual(v['人員'][0], ['姓名', '員工編號', '職稱', '部門', '電話', 'Email', '業務員', '權限', '看全部', '入職日', '離職日', '備註', 'id']);
  assert.equal(v['人員'][1][1], 'E001');
  assert.deepEqual(v['人員'][1].slice(6, 8), [true, '記抄表、做異動']); // 業務員是核取方塊，權限寫成「、」分開的文字
  assert.deepEqual(v['廠商'][0], ['名稱', '聯絡人', '電話', '地址', '停用', '備註', 'id']);
});

test('只有 id、沒勾的核取方塊的列不是資料（補上勾選欄時 Google 把空白格填成 FALSE）：不讀、不補 id，記在 junk', () => {
  const v = plain(Sheet.toValues(sample()));
  const head = v['人員'][0];
  const row = (cells) => head.map(h => (h in cells ? cells[h] : ''));
  v['人員'].push(row({ 業務員: false }), row({ 業務員: false, id: 'x1' }), row({}), row({ 姓名: '新來的', 業務員: false }));
  const r = plain(Sheet.fromValues(asRead(v)));
  assert.deepEqual(r.data.people.map(p => p.name), ['王小明', '陳大華', '新來的']);
  assert.deepEqual(r.junk, [{ table: 'people', tab: '人員', row: 4 }, { table: 'people', tab: '人員', row: 5 }]);
  assert.deepEqual(r.problems, []);
  assert.equal(r.idFixes.length, 1); // 只有「新來的」補 id
});

test('寫回一筆時依目前的標題列排列，不認得的欄位不動（null）', () => {
  const row = plain(Sheet.encodeRow('devices', sample().devices[0], ['自己加的', '編號', '名稱', 'id']));
  assert.deepEqual(row, [null, 'NB-001', '會議室筆電', 'd1']);
});

test('看不懂的值記成問題，其他資料照常讀進來', () => {
  const r = plain(Sheet.fromValues(withTab('設備', [
    HEADERS,
    ['NB-003', '', '使用中', '', '', '', '', '', '', '', '2026/13/01', '一萬'],
    ['', '沒有編號的', '使用中'],
    [7, '螢幕', '使用中'],
  ])));
  assert.deepEqual(r.problems.map(Sheet.problemText), [
    '設備第 2 列：名稱空白',
    '設備第 2 列：購買日期看不懂（2026/13/01）',
    '設備第 2 列：購買金額不是數字（一萬）',
    '設備第 4 列：編號被存成數字 7，開頭的 0 可能不見了，請把這一欄設成純文字後重打',
  ]);
  assert.equal(r.data.devices.length, 3);
  assert.equal(r.data.devices[1].code, ''); // 系統產生的編號空白：同步時補上，不算問題
  assert.equal(r.data.devices[2].code, '7');
});

test('id 重複時，第二筆換新的 id', () => {
  const r = plain(Sheet.fromValues(withTab('設備', [
    HEADERS,
    ['A-1', '甲', '使用中', '', '', '', '', '', '', '', '', '', '', '', '', '', 'd1'],
    ['A-2', '乙', '使用中', '', '', '', '', '', '', '', '', '', '', '', '', '', 'd1'],
  ])));
  const [a, b] = r.data.devices;
  assert.equal(a.id, 'd1');
  assert.notEqual(b.id, 'd1');
  assert.deepEqual(r.idFixes.map(f => [f.row, f.id]), [[3, b.id]]);
});

test('缺必填的欄、缺分頁、沒有 id 欄', () => {
  const v = asRead(plain(Sheet.toValues(sample())));
  v['設備'] = [['名稱', '狀態']];
  const r = plain(Sheet.fromValues(v));
  assert.deepEqual(r.problems.map(Sheet.problemText), ['設備第 1 列：找不到「編號」欄，請把標題改回「編號」']);
  assert.deepEqual(r.addIdHeader, [{ tab: '設備', col: 2 }]);
  assert.equal(r.headers['設備'][2], 'id');
  assert.deepEqual(r.broken, ['devices']);

  delete v['設備'];
  const r2 = plain(Sheet.fromValues(v));
  assert.deepEqual(r2.problems.map(Sheet.problemText), ['設備：找不到「設備」分頁或分頁是空的']);
  assert.deepEqual(r2.broken, ['devices']);
});

test('記錄每一筆在第幾列（空白列也算列號）', () => {
  const v = asRead(plain(Sheet.toValues(sample())));
  v['設備'].splice(2, 0, []); // d1 和 d2 中間插一列空白
  const r = plain(Sheet.fromValues(v));
  assert.deepEqual(r.rowOf['設備'], { d1: 2, d2: 4 });
  assert.deepEqual(r.headers['設備'], HEADERS);
  assert.deepEqual(r.broken, []);
});

test('欄位字母', () => {
  assert.deepEqual([0, 9, 25, 26, 27, 51, 52, 701, 702].map(Sheet.colLetter),
    ['A', 'J', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('補建單一分頁時，只產生那個分頁的格式設定', () => {
  const reqs = plain(Sheet.setupRequests({ 設備: 777 }));
  const sheetIdOf = r => (r.repeatCell || r.setDataValidation || r.addProtectedRange.protectedRange).range.sheetId;
  assert.ok(reqs.length > 0);
  assert.ok(reqs.every(r => sheetIdOf(r) === 777));
});

test('建立試算表：分頁、格式、下拉選單、保護', () => {
  const body = plain(Sheet.createBody('設備管理'));
  assert.equal(body.properties.title, '設備管理');
  assert.deepEqual(body.sheets.map(s => s.properties.title),
    ['設備', '位置', '客戶', '異動', '合約', '合約修改紀錄', '抄表', '保養', '翻新', '選配件', '狀態', '選項', '人員', '廠商', '_meta']);
  assert.equal(body.properties.locale, 'zh_TW');
  assert.equal(body.sheets.at(-1).properties.hidden, true);

  const reqs = plain(Sheet.setupRequests());
  const ids = new Set(body.sheets.map(s => s.properties.sheetId));
  const sheetIdOf = r => (r.repeatCell || r.setDataValidation || r.addProtectedRange.protectedRange).range.sheetId;
  reqs.forEach(r => assert.ok(ids.has(sheetIdOf(r)), JSON.stringify(r)));

  const devices = Sheet.TAB.devices.sheetId;
  const fmtOf = c => reqs.find(r => r.repeatCell?.range.sheetId === devices && r.repeatCell.range.startColumnIndex === c
    && r.repeatCell.fields === 'userEnteredFormat.numberFormat')?.repeatCell.cell.userEnteredFormat.numberFormat;
  assert.deepEqual(fmtOf(0), { type: 'TEXT' });                         // 編號
  assert.deepEqual(fmtOf(7), { type: 'TEXT' });                         // 主機板號碼
  assert.deepEqual(fmtOf(10), { type: 'DATE', pattern: 'yyyy/mm/dd' }); // 購買日期
  assert.deepEqual(fmtOf(11), { type: 'NUMBER', pattern: '#,##0' });    // 購買金額
  assert.deepEqual(fmtOf(16), { type: 'TEXT' });                        // id

  // 下拉選單只提醒、不擋；從清單選的欄位（狀態、類別、位置）之後用 _下拉 分頁做
  const listsOf = id => reqs.filter(r => r.setDataValidation?.range.sheetId === id).map(r => r.setDataValidation);
  const lists = listsOf(devices);
  assert.ok(lists.every(v => v.rule.strict === false));
  const listOf = (all, c) => all.find(v => v.range.startColumnIndex === c && v.rule.condition.type === 'ONE_OF_LIST')
    ?.rule.condition.values.map(x => x.userEnteredValue).join();
  assert.equal(listOf(lists, 2), undefined);
  assert.equal(listOf(lists, 3), undefined);
  assert.equal(listOf(lists, 7), undefined);
  // 狀態的顏色有下拉選單
  assert.equal(listOf(listsOf(Sheet.TAB.statuses.sheetId), 2), '藍,紫,橘,綠,灰,紅');
  // 勾選的欄位是核取方塊
  const opt = Sheet.TAB.options.sheetId;
  const box = reqs.find(r => r.setDataValidation?.range.sheetId === opt && r.setDataValidation.range.startColumnIndex === 3);
  assert.equal(box.setDataValidation.rule.condition.type, 'BOOLEAN');
  assert.equal(reqs.filter(r => r.addProtectedRange).length, 28); // 14 個分頁 × 標題列與 id 欄
  // 左右切換的欄位（異動的類型）有下拉選單
  assert.equal(listOf(listsOf(Sheet.TAB.moves.sheetId), 2), '安裝,撤機,移機,其他');
  assert.ok(reqs.filter(r => r.addProtectedRange).every(r => r.addProtectedRange.protectedRange.warningOnly));
});

test('改名前的標題（was）讀得到，同步時改成新的標題', () => {
  const schema = vm.runInContext('SCHEMAS.devices.fields.find(f => f.key === "keeper")', ctx);
  schema.was = ['使用人'];
  try {
    const r = plain(Sheet.fromValues(withTab('設備', [
      HEADERS.map(h => (h === '保管人' ? '使用人' : h)),
      ['NB-001', '筆電', '使用中', '', '', '', '', '', '', '小華', '', '', '', '', '', '', 'd1'],
    ])));
    assert.deepEqual(r.addColumns, []);
    assert.equal(r.data.devices[0].keeper, '小華');
    assert.deepEqual(r.rewrites, [{ table: 'devices', tab: '設備', row: 1, col: 9, value: '保管人' }]);
    assert.equal(r.headers['設備'][9], '保管人');
  } finally {
    delete schema.was;
  }
});

test('紀錄：設備欄寫設備編號（純文字）；保養一筆一個項目，翻新項目是自由輸入的文字', () => {
  const v = plain(Sheet.toValues(sample()));
  assert.deepEqual(v['異動'][0], ['設備', '日期', '類型', '原位置', '新位置', '狀態', '備註', 'id']);
  assert.deepEqual(v['合約'][0], ['位置', '簽約日', '到期日', '提前結束日', '合約內容', '計費方式', '抄表日期', '抄表週期', 'id']);
  assert.equal(v['合約'][1][0], 'L0001、L0002'); // 位置存編號，好幾個用「、」分開
  assert.deepEqual(v['合約修改紀錄'][0], ['合約', '日期', '欄位', '改之前', '改之後', 'id']);
  assert.deepEqual(v['位置'][0], ['編號', '名稱', '以前的名字', '倉庫', '客戶', '業務員', '地址', '停用', '備註', 'id']);
  assert.deepEqual(v['位置'][1].slice(4, 6), ['大華公司', '王小明']); // 客戶、業務員寫名字
  assert.deepEqual(v['位置'][2].slice(0, 8), ['L0002', '舊倉庫', '', true, '', '', '', true]);
  assert.deepEqual(v['客戶'][0], ['名稱', '統一編號', '主要業務員', '母公司', '帳單地址', '送貨地址', '聯絡人', '電話', '傳真', '備註', 'id']);
  assert.deepEqual(v['客戶'][2].slice(0, 4), ['大華公司', '87654321', '王小明', '大華集團']);
  assert.deepEqual(v['抄表'][0], ['設備', '抄表日期', '結算月份', '黑白張數', '彩色張數', '備註', '輸入的人', '業務員回報', 'id']);
  assert.deepEqual(v['抄表'][1].slice(6, 8), ['阿明', '阿明：張數打錯']);
  assert.equal(v['抄表'][1][2], '2026/02'); // 結算月份存成文字
  assert.deepEqual(v['保養'][0], ['設備', '日期', '項目', '黑白張數', '彩色張數', '備註', '輸入的人', '業務員回報', 'id']);
  assert.deepEqual(v['翻新'][0], ['設備', '翻新日期', '入庫日', '工程師', '序號', '國別', '廠商或來源', '噴漆', '翻新項目', '備註', 'id']);
  assert.equal(v['翻新'][1][7], true); // 噴漆是核取方塊
  assert.deepEqual(v['選配件'][0], ['設備', '名稱', '序號', '安裝日期', '拆除日期', '備註', 'id']);
  assert.equal(v['保養'][1][0], 'NB-001');
  assert.equal(v['保養'][1][2], '碳粉 K');
  assert.equal(v['翻新'][1][8], '換外殼\n清潔內部');
  const reqs = plain(Sheet.setupRequests());
  const fmt = reqs.find(r => r.repeatCell?.range.sheetId === Sheet.TAB.readings.sheetId && r.repeatCell.range.startColumnIndex === 0
    && r.repeatCell.fields === 'userEnteredFormat.numberFormat').repeatCell.cell.userEnteredFormat.numberFormat;
  assert.deepEqual(fmt, { type: 'TEXT' });
});

test('抄表的結算月份：文字 2026/9、被改成日期格式的序號都讀得懂；看不懂的列成問題', () => {
  const head = Sheet.TAB.readings.headers;
  const r = plain(Sheet.fromValues(withTab('抄表', [
    head,
    ['NB-001', '2026/10/3', '2026/9', 100],
    ['NB-001', '2026/11/2', Sheet.toSerial('2026-10-01'), 200],
    ['NB-001', '2026/12/1', '十一月', 300],
  ])));
  assert.deepEqual(r.data.readings.map(x => x.month), ['2026-09', '2026-10', '']);
  assert.deepEqual(r.problems.filter(p => p.tab === '抄表').map(Sheet.problemText), ['抄表第 4 列：結算月份看不懂（十一月），要寫成 2026/09']);
});

test('機型以前叫「型號」：舊標題讀得到，同步時改成「機型」', () => {
  const r = plain(Sheet.fromValues(withTab('設備', [
    HEADERS.map(h => (h === '機型' ? '型號' : h)),
    ['24-0001', '影印機', '出租中', '', 'Ricoh', 'IM C6000', '', '', '', '', '', '', '', '', '', '', 'd9'],
  ])));
  assert.equal(r.data.devices[0].model, 'IM C6000');
  assert.deepEqual(r.rewrites, [{ table: 'devices', tab: '設備', row: 1, col: 5, value: '機型' }]);
});

test('翻新的「原廠商」改名「廠商或來源」：舊標題讀得到，同步時改成新的', () => {
  const head = Sheet.TAB.refurbs.headers.map(h => (h === '廠商或來源' ? '原廠商' : h));
  const r = plain(Sheet.fromValues(withTab('翻新', [head, ['007', '2026/3/1', '', '', '', '日', '日本拍賣', true, '換外殼', '', 'f9']])));
  assert.equal(r.data.refurbs[0].source, '日本拍賣');
  assert.deepEqual(r.rewrites, [{ table: 'refurbs', tab: '翻新', row: 1, col: 6, value: '廠商或來源' }]);
});

test('_meta 第 2 列的讀信網址（自動抄表）讀得到；沒有這一列時是空字串', () => {
  const url = 'https://script.google.com/macros/s/abc/exec';
  assert.equal(Sheet.fromValues({ _meta: [['version', 1], ['meterUrl', ` ${url} `]] }).meterUrl, url);
  assert.equal(Sheet.fromValues({ _meta: [['version', 1], ['meterUrl', ` ${url} `]] }).version, 1);
  assert.equal(Sheet.fromValues({ _meta: [['version', 1]] }).meterUrl, '');
  assert.equal(Sheet.fromValues({}).meterUrl, '');
});

test('_meta 第 3 列上次讀信的時間（試算表上的程式寫的）讀得到；第 2 列空著也讀得到，沒有這一列時是空字串', () => {
  const at = '2026-10-20T06:05:00.000Z';
  assert.equal(Sheet.fromValues({ _meta: [['version', 1], [], ['meterReadAt', at]] }).meterReadAt, at);
  assert.equal(Sheet.fromValues({ _meta: [['version', 1], [], ['meterReadAt', at]] }).meterUrl, '');
  assert.equal(Sheet.fromValues({ _meta: [['version', 1]] }).meterReadAt, '');
  assert.equal(Sheet.fromValues({}).meterReadAt, '');
});

test('_meta 第 4 列的寄信用 Gmail（機器設定）讀得到；中間空著也讀得到，沒有這一列時是空字串', () => {
  assert.equal(Sheet.fromValues({ _meta: [['version', 1], [], [], ['senderMail', ' meter.abc@gmail.com ']] }).senderMail, 'meter.abc@gmail.com');
  assert.equal(Sheet.fromValues({ _meta: [['version', 1]] }).senderMail, '');
  assert.equal(Sheet.fromValues({}).senderMail, '');
});

test('「最新回報」分頁（試算表上的程式寫的）：依標題找欄，日期、時間、張數、碳粉、IP 讀得懂，空白和看不懂的是 null；沒有這個分頁時是 null', () => {
  const head = ['序號', '設備', '主機板號碼', '日期', '時間', '黑白張數', '彩色張數', '碳粉K', '碳粉Y', '碳粉M', '碳粉C', 'IP'];
  const r = Sheet.fromValues({
    最新回報: [
      head,
      ['313CM615862', '26-0001', 'RNP0026735', 46316, '08:30', 123490, 2866, 80, 40, 60, 10, ' 192.168.1.20 '],
      [' 3101R800451 ', '', '', '2026/10/17', 0.375, 45678, '', 30],
      [],
      ['', '26-0002', '', 46316, '09:00', 1, 1, 50],
      ['E123', '', '', 46316, '09:10', 'x', -1, -3, '', 'x', 120],
    ],
  });
  assert.deepEqual(plain(r.toner), [
    { serial: '313CM615862', device: '26-0001', date: '2026-10-21', time: '08:30', bw: 123490, color: 2866, K: 80, Y: 40, M: 60, C: 10, ip: '192.168.1.20' },
    { serial: '3101R800451', device: '', date: '2026-10-17', time: '09:00', bw: 45678, color: null, K: 30, Y: null, M: null, C: null, ip: '' },
    { serial: 'E123', device: '', date: '2026-10-21', time: '09:10', bw: null, color: null, K: null, Y: null, M: null, C: null, ip: '' },
  ]);
  const moved = Sheet.fromValues({ 最新回報: [['碳粉C', '序號', '黑白張數', '日期'], [5, 'A1', 900, 46316]] });
  assert.deepEqual(plain(moved.toner), [{ serial: 'A1', device: '', date: '2026-10-21', time: '', bw: 900, color: null, K: null, Y: null, M: null, C: 5, ip: '' }]); // 以前的分頁沒有 IP 欄
  assert.equal(Sheet.fromValues({}).toner, null);
  assert.equal(Sheet.fromValues({ 碳粉: [['序號'], ['A1']] }).toner, null); // 以前的「碳粉」分頁不讀
});
