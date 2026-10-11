// 清單的測試：node --test tests/*.test.mjs
//   從清單選的欄位（refs.js）：範圍、找名字、新增、幾台在用、改名一起改、不在清單裡的值、下一個流水號
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = ['util', 'schema', 'storage', 'refs', 'records'];

function app(storage = {}, { today = null } = {}) {
  const ls = { ...storage };
  const ctx = vm.createContext({
    localStorage: {
      getItem: k => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: k => { delete ls[k]; },
      key: i => Object.keys(ls)[i] ?? null,
      get length() { return Object.keys(ls).length; },
    },
    alert: () => {},
  });
  for (const f of FILES) vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
  if (today) vm.runInContext(`U.today = () => '${today}'`, ctx);
  const a = vm.runInContext('({ Store, Refs, SCHEMAS, nextDeviceCode, fixDeviceCodes, nextLocationCode, fixLocationCodes, warrantyNote, cleanBoard, boardNote })', ctx);
  const field = (t, key) => a.SCHEMAS[t].fields.find(f => f.key === key);
  return { ...a, ls, field };
}

const plain = v => JSON.parse(JSON.stringify(v));
const names = list => plain(list.map(r => r.name));

// 位置是自己一張表（編號 L0001…，畫面上寫名稱）；品牌是選項表裡的一份清單
function withData() {
  const a = app({}, { today: '2026-10-11' });
  const { Store } = a;
  Store.add('locations', { code: 'L0001', name: '3F 會議室', disabled: false });
  Store.add('locations', { code: 'L0002', name: '2F 辦公室', disabled: false });
  Store.add('locations', { code: 'L0003', name: '舊倉庫', stock: true, disabled: true });
  Store.add('options', { list: '品牌', name: 'ASUS', disabled: false });
  Store.add('options', { list: '品牌', name: 'Canon', disabled: false });
  Store.add('options', { list: '品牌', name: '舊品牌', disabled: true });
  Store.add('people', { name: '王小明', jobTitle: '資訊組長', dept: '資訊組', leaveDate: null });
  Store.add('people', { name: '陳大華', jobTitle: '工程師', leaveDate: null });
  Store.add('people', { name: '林美玉', leaveDate: '2026-09-30' }); // 已經離職
  Store.add('vendors', { name: '原價屋', disabled: false });
  Store.add('vendors', { name: '聯強', disabled: true }); // 停用
  return a;
}

test('全新的裝置：類別先放預設項目（照寫的順序），沒改過時不算這台裝置的資料', () => {
  const { Store, Refs, field } = app();
  assert.deepEqual(names(Refs.items(field('devices', 'category'))), ['筆電', '桌機', '螢幕', '印表機', '網路設備', '手機', '平板']);
  assert.deepEqual(names(Refs.items(field('maintenance', 'item'))), ['碳粉 K', '碳粉 C', '碳粉 M', '碳粉 Y', '感光鼓', '廢粉盒', '清潔保養']);
  assert.equal(Store.ownCount(), 0);
  // 改過一項就算
  const seed = Store.list('options')[0];
  Store.update('options', seed.id, { name: '筆記型電腦' });
  assert.equal(Store.ownCount(), 1);
});

test('清單功能做好之前的資料（沒有選項表）：讀進來時補上預設的類別', () => {
  const { Store } = app({ 'devmgr.v1': JSON.stringify({ devices: [{ id: 'd1', code: 'NB-001', name: '筆電' }] }) });
  assert.equal(Store.list('devices').length, 1);
  assert.equal(Store.list('options').filter(o => o.list === '類別').length, 7);
});

test('下拉選單：選項依清單分；人員（保管人、工程師）、廠商整張表都列；停用、已離職的不列；依名字排（位置依名稱，不是編號）', () => {
  const { Refs, field } = withData();
  assert.deepEqual(names(Refs.items(field('devices', 'location'))), ['2F 辦公室', '3F 會議室']);
  assert.deepEqual(names(Refs.items(field('devices', 'location'), { all: true })), ['2F 辦公室', '3F 會議室', '舊倉庫']);
  assert.deepEqual(names(Refs.items(field('devices', 'brand'))), ['ASUS', 'Canon']);
  assert.deepEqual(names(Refs.items(field('devices', 'keeper'))), ['王小明', '陳大華']); // 林美玉已經離職
  assert.deepEqual(names(Refs.items(field('refurbs', 'engineer'))), ['王小明', '陳大華']);
  assert.deepEqual(names(Refs.items(field('devices', 'vendor'))), ['原價屋']); // 聯強停用了
  assert.equal(Refs.sub('people', Refs.items(field('devices', 'keeper'))[0]), '資訊組長 · 資訊組');
});

test('依名字找：全形半形、大小寫、前後空白都不影響；停用的也找得到（舊資料照常認得）；位置依編號找', () => {
  const { Refs, field } = withData();
  assert.equal(Refs.find(field('devices', 'brand'), ' ａｓｕｓ ').name, 'ASUS');
  assert.equal(Refs.find(field('devices', 'brand'), '舊品牌').name, '舊品牌');
  assert.equal(Refs.find(field('devices', 'location'), 'l0003').name, '舊倉庫'); // 停用的、小寫的編號
  assert.equal(Refs.find(field('devices', 'location'), 'ASUS'), null); // 品牌清單的，不是位置
  assert.equal(Refs.find(field('devices', 'keeper'), '林美玉').name, '林美玉'); // 已經離職的舊資料照常認得
  assert.equal(Refs.find(field('devices', 'vendor'), '聯強').name, '聯強'); // 停用的也找得到
  assert.equal(Refs.find(field('devices', 'keeper'), ''), null);
});

test('「＋ 新增」：選項加進那一份清單；位置打的是名稱、編號由系統給；人員、廠商只先記名字', () => {
  const { Refs, field } = withData();
  const brand = Refs.quickAdd(field('devices', 'brand'), ' Ricoh ');
  assert.equal(brand.list, '品牌');
  assert.equal(brand.name, 'Ricoh');
  assert.equal(brand.disabled, false);

  const loc = Refs.quickAdd(field('devices', 'location'), ' 5F 機房 ');
  assert.equal(loc.name, '5F 機房');
  assert.equal(loc.code, 'L0004');
  assert.equal(loc.disabled, false);
  assert.equal(Refs.labelOf('locations', loc), '5F 機房');
  assert.equal(Refs.nameOf('locations', loc), 'L0004'); // 存的是編號

  const v = Refs.quickAdd(field('devices', 'vendor'), '燦坤');
  assert.equal(v.name, '燦坤');
  assert.equal(v.disabled, false);
  assert.ok(!('types' in v));

  const n = Refs.quickAdd(field('devices', 'keeper'), '張三');
  assert.equal(n.name, '張三');
  assert.equal(n.jobTitle, '');
  assert.equal(n.leaveDate, null);
  assert.ok(!('roles' in n));
});

test('幾台在用：同一台設備在兩個欄位用到只算一次；不能刪除時說明原因（寫位置的名稱）', () => {
  const { Store, Refs } = withData();
  Store.add('devices', { code: 'NB-001', name: '筆電', location: 'L0001', keeper: '王小明', brand: 'ASUS' });
  Store.add('devices', { code: 'NB-002', name: '筆電', location: 'l0001', keeper: '', brand: 'asus' });
  const room = Store.list('locations').find(o => o.name === '3F 會議室');
  assert.equal(Refs.usesText('locations', room), '2 台設備');
  assert.match(Refs.removeBlock('locations', room), /^還有 2 台設備用到「3F 會議室」，不能刪除。不再使用的話，可以勾「停用」$/);
  const asus = Store.list('options').find(o => o.name === 'ASUS');
  assert.equal(Refs.usesText('options', asus), '2 台設備');
  const ming = Store.list('people').find(p => p.name === '王小明');
  assert.equal(Refs.usesText('people', ming), '1 台設備');
  assert.match(Refs.removeBlock('people', ming), /可以填「離職日」/);
  const canon = Store.list('options').find(o => o.name === 'Canon');
  assert.equal(Refs.removeBlock('options', canon), '');
});

test('改名：用到舊名字的設備一起改（只改那個範圍的欄位）；位置存編號，改名不用動設備', () => {
  const { Store, Refs } = withData();
  const d1 = Store.add('devices', { code: 'NB-001', name: '筆電', brand: 'ASUS', location: 'L0001' });
  const d2 = Store.add('devices', { code: 'NB-002', name: 'ASUS', brand: 'Canon' }); // 名稱剛好一樣，不是品牌欄位
  const asus = Store.list('options').find(o => o.name === 'ASUS');
  const before = { ...asus };
  Store.update('options', asus.id, { name: 'Asus' });
  const changed = Refs.renameRefs('options', before, Store.get('options', asus.id));
  assert.deepEqual(plain(changed), [{ table: 'devices', id: d1.id }]);
  assert.equal(Store.get('devices', d1.id).brand, 'Asus');
  assert.equal(Store.get('devices', d2.id).name, 'ASUS');
  // 名字沒變：不用改
  assert.deepEqual(plain(Refs.renameRefs('options', Store.get('options', asus.id), Store.get('options', asus.id))), []);
  // 位置改名：編號沒變，設備不用改
  const room = Store.list('locations').find(o => o.code === 'L0001');
  const was = { ...room };
  Store.update('locations', room.id, { name: '3F 大會議室' });
  assert.deepEqual(plain(Refs.renameRefs('locations', was, Store.get('locations', room.id))), []);
  assert.equal(Store.get('devices', d1.id).location, 'L0001');
});

test('不在清單裡的值：每個範圍一組（保管人、工程師都是人員）；一鍵加進清單；位置存編號，不列在這裡', () => {
  const { Store, Refs } = withData();
  Store.add('devices', { code: 'NB-001', name: '筆電', location: '4F', keeper: '張三', brand: 'HP', vendor: '燦坤' });
  Store.add('devices', { code: 'NB-002', name: '筆電', location: 'L0099', keeper: '王小明', category: '伺服器', vendor: '聯強' });
  Store.add('refurbs', { device: 'NB-001', date: '2026-10-01', engineer: '李四', content: '換外殼' });
  const m = plain(Refs.missing()).map(x => [x.key, x.name, x.values]);
  assert.deepEqual(m, [
    ['options:類別', '類別', ['伺服器']],
    ['options:品牌', '品牌', ['HP']],
    ['people:', '人員', ['李四', '張三']],
    ['vendors:', '廠商', ['燦坤']],
  ]);
  assert.equal(Refs.importMissing('people:'), 2);
  assert.equal(Store.list('people').find(p => p.name === '李四').name, '李四');
  assert.equal(Refs.importMissing('options:品牌'), 1);
  assert.equal(Refs.importMissing('vendors:'), 1);
  assert.deepEqual(plain(Refs.missing()).map(x => x.key), ['options:類別']);
  assert.equal(Refs.listOfScope('people:').key, 'people');
  assert.equal(Refs.listOfScope('options:品牌').key, 'options:品牌');
  assert.equal(Refs.listOfScope('locations:').key, 'locations');
});

test('設定裡的清單：狀態、類別、位置、品牌、機型、保養項目、選配件、人員、廠商；停用的排在後面', () => {
  const { Refs } = withData();
  assert.deepEqual(plain(Refs.lists().map(l => l.title)), ['狀態', '類別', '位置', '品牌', '機型', '保養項目', '選配件', '人員', '廠商']);
  assert.deepEqual(plain(Refs.lists().filter(l => l.sortable).map(l => l.title)), ['狀態', '類別', '機型', '保養項目', '選配件']);
  const loc = Refs.lists().find(l => l.key === 'locations');
  assert.deepEqual(names(Refs.listItems(loc)), ['2F 辦公室', '3F 會議室', '舊倉庫']);
  const people = Refs.lists().find(l => l.key === 'people');
  assert.deepEqual(names(Refs.listItems(people)).at(-1), '林美玉');
});

test('可以選好幾個的欄位（合約的位置）：每一個各自算在用、改編號時只換那一個', () => {
  const { Store, Refs, field } = withData();
  const f = field('contracts', 'locations');
  assert.equal(f.many, true);
  assert.deepEqual(plain(Refs.valuesOf(f, 'L0001、L0002')), ['L0001', 'L0002']);
  const c = Store.add('contracts', { locations: 'L0001、L0002', signDate: '2026-01-05' });
  const room = Store.list('locations').find(o => o.code === 'L0002');
  assert.equal(Refs.usesText('locations', room), '1 筆合約');
  assert.match(Refs.removeBlock('locations', room), /^還有 1 筆合約用到「2F 辦公室」/);
  // 在試算表裡改了位置的編號：合約裡的那一個跟著換
  const before = { ...room };
  Store.update('locations', room.id, { code: 'L0020' });
  assert.deepEqual(plain(Refs.renameRefs('locations', before, Store.get('locations', room.id))), [{ table: 'contracts', id: c.id }]);
  assert.equal(Store.get('contracts', c.id).locations, 'L0001、L0020');
});

test('編號：年份兩位數＋流水號四位數，年份照購買日期（沒填用今年），同一年的取最大的往下編', () => {
  const { Store, nextDeviceCode } = app({}, { today: '2026-10-11' });
  assert.equal(nextDeviceCode(), '26-0001');
  assert.equal(nextDeviceCode({ buyDate: '2023-05-01' }), '23-0001');
  Store.add('devices', { code: '26-0009', name: 'a' });
  Store.add('devices', { code: '26-0003', name: 'b' });
  Store.add('devices', { code: 'NB-001', name: '自己打的舊編號' });
  Store.add('devices', { code: '23-0002', name: 'c' });
  assert.equal(nextDeviceCode({ buyDate: null }), '26-0010');
  assert.equal(nextDeviceCode({ buyDate: '2023/12/31' }), '23-0003');
  assert.equal(nextDeviceCode({ buyDate: '2024-01-01' }), '24-0001');
});

test('整理編號：沒有編號的補上；系統給的編號重複時，先新增的留著、後新增的換下一號；自己打的舊編號不動', () => {
  const { Store, fixDeviceCodes } = app({}, { today: '2026-10-11' });
  Store.add('devices', { id: 'a1', code: '26-0001', name: '手機上新增的' });
  Store.add('devices', { id: 'a2', code: '26-0001', name: '電腦上新增的' });
  Store.add('devices', { id: 'a3', code: '', name: '試算表手打的', buyDate: '2025-02-01' });
  Store.add('devices', { id: 'a4', code: 'NB-001', name: '舊的' });
  Store.add('devices', { id: 'a5', code: 'NB-001', name: '舊的重複' });
  const fixed = plain(fixDeviceCodes());
  assert.deepEqual(fixed, [
    { id: 'a2', from: '26-0001', to: '26-0002', name: '電腦上新增的' },
    { id: 'a3', from: '', to: '25-0001', name: '試算表手打的' },
  ]);
  assert.equal(Store.get('devices', 'a1').code, '26-0001');
  assert.equal(Store.get('devices', 'a5').code, 'NB-001');
  assert.deepEqual(plain(fixDeviceCodes()), []);
});

test('位置的編號：L＋流水號四位數，取最大的往下編；重複時後新增的換下一號', () => {
  const { Store, nextLocationCode, fixLocationCodes } = app({}, { today: '2026-10-11' });
  assert.equal(nextLocationCode(), 'L0001');
  Store.add('locations', { id: 'p1', code: 'L0003', name: 'a' });
  Store.add('locations', { id: 'p2', code: 'L0003', name: 'b' }); // 兩台裝置各新增一個
  Store.add('locations', { id: 'p3', code: '', name: '試算表手打的' });
  assert.equal(nextLocationCode(), 'L0004');
  assert.deepEqual(plain(fixLocationCodes()), [
    { id: 'p2', from: 'L0003', to: 'L0004', name: 'b' },
    { id: 'p3', from: '', to: 'L0005', name: '試算表手打的' },
  ]);
  assert.deepEqual(plain(fixLocationCodes()), []);
});

test('狀態：預設出租中、庫存、維修中、報廢，依順序排；新增設備時預設第一個；報廢不用提醒', () => {
  const { Store, Refs, field, SCHEMAS } = app();
  const f = field('devices', 'status');
  assert.deepEqual(names(Refs.items(f)), ['出租中', '庫存', '維修中', '報廢']);
  assert.deepEqual(plain(Refs.items(f).map(r => Refs.tone('statuses', r))), ['blue', 'purple', 'orange', 'gray']);
  assert.equal(f.default(), '出租中');
  // 改順序：庫存排第一
  const stock = Store.list('statuses').find(s => s.name === '庫存');
  Store.update('statuses', stock.id, { order: 0 });
  assert.equal(f.default(), '庫存');
  // 自己加的狀態沒填順序：排在最後
  Refs.quickAdd(f, '待回收');
  assert.deepEqual(names(Refs.items(f)).at(-1), '待回收');
  assert.equal(Store.list('statuses').find(s => s.name === '待回收').color, '藍');
  assert.equal(Store.ownCount(), 2);
  assert.ok(SCHEMAS.statuses.fields.find(x => x.key === 'quiet'));
});

test('保固：30 天內到期標色、過期寫出來；不用提醒的狀態（報廢）不寫', () => {
  const { Store, warrantyNote } = app({}, { today: '2026-10-11' });
  assert.deepEqual(plain(warrantyNote({ warranty: '2026-10-30', status: '出租中' })), { text: '保固剩 19 天（2026/10/30）', warn: true });
  assert.deepEqual(plain(warrantyNote({ warranty: '2026-10-11', status: '出租中' })), { text: '保固今天到期（2026/10/11）', warn: true });
  assert.deepEqual(plain(warrantyNote({ warranty: '2026-12-31', status: '庫存' })), { text: '保固到 2026/12/31', warn: false });
  assert.deepEqual(plain(warrantyNote({ warranty: '2026-01-01', status: '出租中' })), { text: '保固已過期（2026/01/01）', warn: false });
  assert.equal(warrantyNote({ warranty: '2026-10-30', status: '報廢' }), null);
  assert.equal(warrantyNote({ warranty: null, status: '出租中' }), null);
  // 自己加的「遺失」勾了不用提醒
  Store.add('statuses', { name: '遺失', order: 9, color: '紅', quiet: true, disabled: false });
  assert.equal(warrantyNote({ warranty: '2026-10-30', status: '遺失' }), null);
});

test('主機板號碼：RNP＋12 碼；只打 12 碼時補上 RNP、轉大寫、拿掉空白和分隔符號；格式不對時提醒', () => {
  const { cleanBoard, boardNote } = app();
  assert.equal(cleanBoard('RNP123456789012'), 'RNP123456789012');
  assert.equal(cleanBoard(' rnp123456789012 '), 'RNP123456789012');
  assert.equal(cleanBoard('123456789012'), 'RNP123456789012');
  assert.equal(cleanBoard('0026738f4e21'), 'RNP0026738F4E21');
  assert.equal(cleanBoard('1234-5678-9012'), 'RNP123456789012');
  assert.equal(cleanBoard('ｒｎｐ１２３４５６７８９０１２'), 'RNP123456789012');
  assert.equal(cleanBoard(''), '');
  assert.equal(boardNote({ board: 'RNP123456789012' }), '');
  assert.equal(boardNote({ board: 'rnp123456789012' }), '會存成 RNP123456789012');
  assert.equal(boardNote({ board: '123456789012' }), '會存成 RNP123456789012');
  assert.equal(boardNote({ board: '' }), '');
  assert.deepEqual(plain(boardNote({ board: 'RNP12345' })), { text: '應該是 RNP＋12 碼', warn: true });
});

test('設備：主機板號碼有填的話不能重複，搜尋找得到', () => {
  const { SCHEMAS } = app();
  const s = SCHEMAS.devices;
  assert.deepEqual(plain(s.unique), [['code'], ['board']]);
  assert.equal(s.uniqueMsg({ code: '24-0001', name: '#1234', model: 'IMC6000' }, ['board']), '這個主機板號碼已經用在 IMC6000 #1234');
  assert.ok(s.search.includes('board'));
});

test('排序：↑ ↓ 移一格，沒停用的重新編成 1、2、3…，停用的排在後面；新加的排在最後', () => {
  const { Store, Refs, field } = app();
  const l = Refs.lists().find(x => x.key === 'options:機型');
  ['IMC4500', 'IMC6000', 'IMC5500'].forEach(name => Refs.quickAdd(field('devices', 'model'), name));
  Store.add('options', { list: '機型', name: 'MP3555', order: null, disabled: true });
  // 還沒排過：依名字
  assert.deepEqual(names(Refs.listItems(l)), ['IMC4500', 'IMC5500', 'IMC6000', 'MP3555']);
  const id = name => Store.list('options').find(o => o.name === name).id;
  assert.equal(Refs.move(l, id('IMC6000'), -1), true);
  assert.equal(Refs.move(l, id('IMC6000'), -1), true);
  assert.equal(Refs.move(l, id('IMC6000'), -1), false); // 已經第一個
  assert.deepEqual(names(Refs.listItems(l)), ['IMC6000', 'IMC4500', 'IMC5500', 'MP3555']);
  assert.equal(Refs.move(l, id('IMC5500'), -1), true);
  assert.deepEqual(names(Refs.items(field('devices', 'model'))), ['IMC6000', 'IMC5500', 'IMC4500']);
  assert.deepEqual(plain(Store.list('options').filter(o => o.list === '機型').map(o => [o.name, o.order])),
    [['IMC4500', 3], ['IMC6000', 1], ['IMC5500', 2], ['MP3555', 4]]);
  // 新加的沒有順序：排在最後
  Refs.quickAdd(field('devices', 'model'), 'C3504');
  assert.deepEqual(names(Refs.items(field('devices', 'model'))), ['IMC6000', 'IMC5500', 'IMC4500', 'C3504']);
});
