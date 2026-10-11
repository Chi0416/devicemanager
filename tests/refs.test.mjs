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
  const a = vm.runInContext('({ Store, Refs, SCHEMAS, nextDeviceCode, fixDeviceCodes, warrantyNote, cleanBoard, boardNote })', ctx);
  const field = (t, key) => a.SCHEMAS[t].fields.find(f => f.key === key);
  return { ...a, ls, field };
}

const plain = v => JSON.parse(JSON.stringify(v));
const names = list => plain(list.map(r => r.name));

function withData() {
  const a = app({}, { today: '2026-10-11' });
  const { Store } = a;
  Store.add('options', { list: '位置', name: '3F 會議室', disabled: false });
  Store.add('options', { list: '位置', name: '2F 辦公室', disabled: false });
  Store.add('options', { list: '位置', name: '舊倉庫', disabled: true });
  Store.add('options', { list: '品牌', name: 'ASUS', disabled: false });
  Store.add('people', { name: '王小明', jobTitle: '資訊組長', dept: '資訊組', leaveDate: null });
  Store.add('people', { name: '陳大華', jobTitle: '工程師', leaveDate: null });
  Store.add('people', { name: '林美玉', leaveDate: '2026-09-30' }); // 已經離職
  Store.add('vendors', { name: '原價屋', disabled: false });
  Store.add('vendors', { name: '聯強', disabled: true }); // 停用
  return a;
}

test('全新的裝置：類別先放預設項目，沒改過時不算這台裝置的資料', () => {
  const { Store, Refs, field } = app();
  assert.deepEqual(names(Refs.items(field('devices', 'category'))), ['手機', '平板', '印表機', '桌機', '筆電', '網路設備', '螢幕'].sort((a, b) => a.localeCompare(b, 'zh-Hant')));
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

test('下拉選單：選項依清單分；人員（保管人、工程師）、廠商整張表都列；停用、已離職的不列；依名字排', () => {
  const { Refs, field } = withData();
  assert.deepEqual(names(Refs.items(field('devices', 'location'))), ['2F 辦公室', '3F 會議室']);
  assert.deepEqual(names(Refs.items(field('devices', 'location'), { all: true })), ['2F 辦公室', '3F 會議室', '舊倉庫']);
  assert.deepEqual(names(Refs.items(field('devices', 'brand'))), ['ASUS']);
  assert.deepEqual(names(Refs.items(field('devices', 'keeper'))), ['王小明', '陳大華']); // 林美玉已經離職
  assert.deepEqual(names(Refs.items(field('refurbs', 'engineer'))), ['王小明', '陳大華']);
  assert.deepEqual(names(Refs.items(field('devices', 'vendor'))), ['原價屋']); // 聯強停用了
  assert.equal(Refs.sub('people', Refs.items(field('devices', 'keeper'))[0]), '資訊組長 · 資訊組');
});

test('依名字找：全形半形、大小寫、前後空白都不影響；停用的也找得到（舊資料照常認得）', () => {
  const { Refs, field } = withData();
  assert.equal(Refs.find(field('devices', 'brand'), ' ａｓｕｓ ').name, 'ASUS');
  assert.equal(Refs.find(field('devices', 'location'), '舊倉庫').name, '舊倉庫');
  assert.equal(Refs.find(field('devices', 'location'), 'ASUS'), null); // 品牌清單的，不是位置
  assert.equal(Refs.find(field('devices', 'keeper'), '林美玉').name, '林美玉'); // 已經離職的舊資料照常認得
  assert.equal(Refs.find(field('devices', 'vendor'), '聯強').name, '聯強'); // 停用的也找得到
  assert.equal(Refs.find(field('devices', 'keeper'), ''), null);
});

test('「＋ 新增」：選項加進那一份清單；人員、廠商只先記名字', () => {
  const { Store, Refs, field } = withData();
  const loc = Refs.quickAdd(field('devices', 'location'), ' 5F 機房 ');
  assert.equal(loc.list, '位置');
  assert.equal(loc.name, '5F 機房');
  assert.equal(loc.disabled, false);

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

test('幾台在用：同一台設備在兩個欄位用到只算一次；不能刪除時說明原因', () => {
  const { Store, Refs } = withData();
  Store.add('devices', { code: 'NB-001', name: '筆電', location: '3F 會議室', keeper: '王小明' });
  Store.add('devices', { code: 'NB-002', name: '筆電', location: '3f 會議室', keeper: '' });
  const room = Store.list('options').find(o => o.name === '3F 會議室');
  assert.equal(Refs.usesText('options', room), '2 台設備');
  assert.match(Refs.removeBlock('options', room), /^還有 2 台設備用到「3F 會議室」，不能刪除。不再使用的話，可以勾「停用」$/);
  const ming = Store.list('people').find(p => p.name === '王小明');
  assert.equal(Refs.usesText('people', ming), '1 台設備');
  assert.match(Refs.removeBlock('people', ming), /可以填「離職日」/);
  const asus = Store.list('options').find(o => o.name === 'ASUS');
  assert.equal(Refs.removeBlock('options', asus), '');
});

test('改名：用到舊名字的設備一起改（只改那個範圍的欄位）', () => {
  const { Store, Refs } = withData();
  const d1 = Store.add('devices', { code: 'NB-001', name: '筆電', location: '3F 會議室', keeper: '王小明' });
  const d2 = Store.add('devices', { code: 'NB-002', name: '3F 會議室', location: '2F 辦公室' }); // 名稱剛好一樣，不是位置欄位
  const room = Store.list('options').find(o => o.name === '3F 會議室');
  const before = { ...room };
  Store.update('options', room.id, { name: '3F 大會議室' });
  const changed = Refs.renameRefs('options', before, Store.get('options', room.id));
  assert.deepEqual(plain(changed), [{ table: 'devices', id: d1.id }]);
  assert.equal(Store.get('devices', d1.id).location, '3F 大會議室');
  assert.equal(Store.get('devices', d2.id).name, '3F 會議室');
  // 名字沒變：不用改
  assert.deepEqual(plain(Refs.renameRefs('options', Store.get('options', room.id), Store.get('options', room.id))), []);
});

test('不在清單裡的值：每個範圍一組（保管人、工程師都是人員）；一鍵加進清單', () => {
  const { Store, Refs } = withData();
  Store.add('devices', { code: 'NB-001', name: '筆電', location: '4F', keeper: '張三', brand: 'ASUS', vendor: '燦坤' });
  Store.add('devices', { code: 'NB-002', name: '筆電', location: '4F', keeper: '王小明', category: '伺服器', vendor: '聯強' });
  Store.add('refurbs', { device: 'NB-001', date: '2026-10-01', engineer: '李四', content: '換外殼' });
  const m = plain(Refs.missing()).map(x => [x.key, x.name, x.values]);
  assert.deepEqual(m, [
    ['options:類別', '類別', ['伺服器']],
    ['options:位置', '位置', ['4F']],
    ['people:', '人員', ['李四', '張三']],
    ['vendors:', '廠商', ['燦坤']],
  ]);
  assert.equal(Refs.importMissing('people:'), 2);
  assert.equal(Store.list('people').find(p => p.name === '李四').name, '李四');
  assert.equal(Refs.importMissing('options:位置'), 1);
  assert.equal(Refs.importMissing('vendors:'), 1);
  assert.deepEqual(plain(Refs.missing()).map(x => x.key), ['options:類別']);
  assert.equal(Refs.listOfScope('people:').key, 'people');
  assert.equal(Refs.listOfScope('options:位置').key, 'options:位置');
});

test('設定裡的清單：狀態、類別、位置、品牌、保養項目、選配件、人員、廠商；停用的排在後面', () => {
  const { Refs } = withData();
  assert.deepEqual(plain(Refs.lists().map(l => l.title)), ['狀態', '類別', '位置', '品牌', '保養項目', '選配件', '人員', '廠商']);
  const loc = Refs.lists().find(l => l.key === 'options:位置');
  assert.deepEqual(names(Refs.listItems(loc)), ['2F 辦公室', '3F 會議室', '舊倉庫']);
  const people = Refs.lists().find(l => l.key === 'people');
  assert.deepEqual(names(Refs.listItems(people)).at(-1), '林美玉');
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
  assert.equal(s.uniqueMsg({ code: '24-0001', name: 'IM C6000' }, ['board']), '這個主機板號碼已經用在 24-0001 IM C6000');
  assert.ok(s.search.includes('board'));
});
