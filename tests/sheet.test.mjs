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
  id, code: '', name: '', status: '使用中', category: '', brand: '', model: '', serial: '', location: '', keeper: '',
  buyDate: null, price: null, vendor: '', warranty: null, link: '', note: '', ...over,
});

const sample = () => ({
  devices: [
    device('d1', {
      code: 'NB-001', name: '會議室筆電', category: '筆電', brand: 'ASUS', model: 'B5402', serial: '0123ABC',
      location: '3F 會議室', keeper: '王小明', buyDate: '2025-03-15', price: 32000, vendor: '原價屋',
      warranty: '2027-03-14', link: 'https://drive.google.com/x', note: '附充電器\n外接螢幕線另放',
    }),
    device('d2', { code: '007', name: '印表機', status: '維修中' }),
  ],
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

const HEADERS = ['編號', '名稱', '狀態', '類別', '品牌', '型號', '序號', '位置', '保管人', '購買日期', '購買金額', '購買廠商', '保固到期', '連結', '備註', 'id'];

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
  assert.equal(d1[9], Sheet.toSerial('2025-03-15'));
  assert.equal(d1[10], 32000);
  assert.equal(d1.at(-1), 'd1');
  const d2 = v['設備'][2];
  assert.equal(d2[0], '007');
  assert.equal(d2[9], '');
  assert.equal(d2[10], '');
});

test('手動輸入：空白列略過、沒有 id 的列補上 id、文字的日期和有千分位的金額也讀得懂', () => {
  const r = plain(Sheet.fromValues(withTab('設備', [
    HEADERS,
    [],
    ['', '', ''],
    ['PR-002', '影印機', '閒置', '印表機', '', '', '', '2F', '', '2024/9/30', '45,000'],
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
  assert.deepEqual({ ...r.idFixes[0], id: undefined }, { tab: '設備', row: 4, col: 15, id: undefined });
  assert.equal(r.idFixes[0].id, d.id);
});

test('手動輸入：調換欄位順序、多出不認得的欄位、少了選填的欄位都讀得到', () => {
  const r = plain(Sheet.fromValues(withTab('設備', [
    ['自己加的', '名稱', '編號', '狀態', 'id'],
    ['備忘', '印表機', '007', '維修中', 'd2'],
  ])));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.broken, []);
  assert.deepEqual(r.data.devices, [plain(sample().devices[1])]);
});

test('寫回一筆時依目前的標題列排列，不認得的欄位不動（null）', () => {
  const row = plain(Sheet.encodeRow('devices', sample().devices[0], ['自己加的', '編號', '名稱', 'id']));
  assert.deepEqual(row, [null, 'NB-001', '會議室筆電', 'd1']);
});

test('看不懂的值記成問題，其他資料照常讀進來', () => {
  const r = plain(Sheet.fromValues(withTab('設備', [
    HEADERS,
    ['NB-003', '', '使用中', '', '', '', '', '', '', '2026/13/01', '一萬'],
    [7, '螢幕', '使用中'],
  ])));
  assert.deepEqual(r.problems.map(Sheet.problemText), [
    '設備第 2 列：名稱空白',
    '設備第 2 列：購買日期看不懂（2026/13/01）',
    '設備第 2 列：購買金額不是數字（一萬）',
    '設備第 3 列：編號被存成數字 7，開頭的 0 可能不見了，請把這一欄設成純文字後重打',
  ]);
  assert.equal(r.data.devices.length, 2);
  assert.equal(r.data.devices[1].code, '7');
});

test('id 重複時，第二筆換新的 id', () => {
  const r = plain(Sheet.fromValues(withTab('設備', [
    HEADERS,
    ['A-1', '甲', '使用中', '', '', '', '', '', '', '', '', '', '', '', '', 'd1'],
    ['A-2', '乙', '使用中', '', '', '', '', '', '', '', '', '', '', '', '', 'd1'],
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
  assert.deepEqual(body.sheets.map(s => s.properties.title), ['設備', '_meta']);
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
  assert.deepEqual(fmtOf(9), { type: 'DATE', pattern: 'yyyy/mm/dd' }); // 購買日期
  assert.deepEqual(fmtOf(10), { type: 'NUMBER', pattern: '#,##0' });    // 購買金額
  assert.deepEqual(fmtOf(15), { type: 'TEXT' });                        // id

  // 下拉選單只提醒、不擋；沒有預設值的快選（品牌、位置）不做下拉選單
  const lists = reqs.filter(r => r.setDataValidation?.range.sheetId === devices).map(r => r.setDataValidation);
  assert.ok(lists.every(v => v.rule.strict === false));
  const listOf = c => lists.find(v => v.range.startColumnIndex === c && v.rule.condition.type === 'ONE_OF_LIST')
    ?.rule.condition.values.map(x => x.userEnteredValue).join();
  assert.equal(listOf(2), '使用中,閒置,維修中,報廢');
  assert.ok(listOf(3).startsWith('筆電,桌機'));
  assert.equal(listOf(4), undefined);
  assert.equal(listOf(7), undefined);
  assert.equal(reqs.filter(r => r.addProtectedRange).length, 2); // 標題列與 id 欄
  assert.ok(reqs.filter(r => r.addProtectedRange).every(r => r.addProtectedRange.protectedRange.warningOnly));
});

test('改名前的標題（was）讀得到，同步時改成新的標題', () => {
  const schema = vm.runInContext('SCHEMAS.devices.fields.find(f => f.key === "keeper")', ctx);
  schema.was = ['使用人'];
  try {
    const r = plain(Sheet.fromValues(withTab('設備', [
      HEADERS.map(h => (h === '保管人' ? '使用人' : h)),
      ['NB-001', '筆電', '使用中', '', '', '', '', '', '小華', '', '', '', '', '', '', 'd1'],
    ])));
    assert.equal(r.data.devices[0].keeper, '小華');
    assert.deepEqual(r.rewrites, [{ table: 'devices', tab: '設備', row: 1, col: 8, value: '保管人' }]);
    assert.equal(r.headers['設備'][8], '保管人');
  } finally {
    delete schema.was;
  }
});
