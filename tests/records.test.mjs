// 紀錄的測試：node --test tests/*.test.mjs
//   異動（位置歷程）、合約、抄表用量、保養、翻新、選配件（records.js），紀錄的設備欄和保養項目（refs.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = ['util', 'schema', 'storage', 'refs', 'records'];

function app({ today = '2026-10-11' } = {}) {
  const ls = {};
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
  vm.runInContext(`U.today = () => '${today}'`, ctx);
  const a = vm.runInContext('({ Store, Refs, Records, SCHEMAS })', ctx);
  const field = (t, key) => a.SCHEMAS[t].fields.find(f => f.key === key);
  // 新增一筆：沒寫的欄位用空白（和表單存的一樣）
  const add = (t, rec) => a.Store.add(t, { ...a.Refs.blankRecord(t), ...rec });
  return { ...a, field, add };
}

const plain = v => JSON.parse(JSON.stringify(v));

// 兩台設備（名稱是機身號碼，編號只在系統裡用）：24-0001 一開始放在公司倉庫，25-0001 還沒填位置
function withDevices() {
  const a = app();
  ['公司倉庫', '大華貿易 3F', '安心診所 櫃台'].forEach(name => a.add('options', { list: '位置', name }));
  const d1 = a.add('devices', { code: '24-0001', name: '#1001', serial: '3101R800451', status: '出租中', location: '公司倉庫' });
  const d2 = a.add('devices', { code: '25-0001', name: '#1002', status: '庫存' });
  return { ...a, d1, d2 };
}

// ---------- 位置歷程 ----------
test('位置：設備目前的位置＝最新一筆異動的新位置（依日期，同一天依新增的先後）', () => {
  const { Store, Records, add, d1 } = withDevices();
  add('moves', { id: 'm1', device: '24-0001', date: '2026-03-01', type: '安裝', from: '公司倉庫', to: '大華貿易 3F' });
  add('moves', { id: 'm3', device: '24-0001', date: '2026-05-01', type: '移機', from: '大華貿易 3F', to: '安心診所 櫃台' });
  add('moves', { id: 'm2', device: '24-0001', date: '2026-01-01', type: '其他', from: '', to: '公司倉庫' }); // 後來補登的舊紀錄
  assert.deepEqual(plain(Records.syncLocations()), [{ table: 'devices', id: d1.id }]);
  assert.equal(Store.get('devices', d1.id).location, '安心診所 櫃台');
  // 同一天兩筆：後新增的為準
  add('moves', { id: 'm4', device: '24-0001', date: '2026-05-01', type: '撤機', from: '安心診所 櫃台', to: '公司倉庫' });
  Records.syncLocations();
  assert.equal(Store.get('devices', d1.id).location, '公司倉庫');
  // 沒有變：不用改
  assert.deepEqual(plain(Records.syncLocations()), []);
});

test('位置：點錯了就改或刪那一筆，位置自動回到對的；最後一筆刪掉時回到那一筆的原位置', () => {
  const { Store, Records, SCHEMAS, add, d1, d2 } = withDevices();
  const m1 = add('moves', { device: '24-0001', date: '2026-03-01', type: '安裝', from: '公司倉庫', to: '大華貿易 3F' });
  const m2 = add('moves', { device: '24-0001', date: '2026-05-01', type: '移機', from: '大華貿易 3F', to: '安心診所 櫃台' });
  SCHEMAS.moves.afterSave(null, m2);
  assert.equal(Store.get('devices', d1.id).location, '安心診所 櫃台');
  // 刪掉最新一筆：回到前一筆的新位置
  Store.remove('moves', m2.id);
  SCHEMAS.moves.afterRemove(m2);
  assert.equal(Store.get('devices', d1.id).location, '大華貿易 3F');
  // 這一筆其實是另一台設備的：兩台都重新算，原來那台沒有異動了，回到原位置
  const before = { ...m1 };
  Store.update('moves', m1.id, { device: '25-0001' });
  SCHEMAS.moves.afterSave(before, Store.get('moves', m1.id));
  assert.equal(Store.get('devices', d1.id).location, '公司倉庫');
  assert.equal(Store.get('devices', d2.id).location, '大華貿易 3F');
  assert.equal(Records.hasMoves('24-0001'), false);
  assert.equal(Records.hasMoves('25-0001'), true);
});

test('位置：還沒有異動的設備，表單上的位置照常可以填；有了異動之後只顯示', () => {
  const { Records, add, d1, field } = withDevices();
  const lock = field('devices', 'location').lock;
  assert.equal(lock(d1), '');
  add('moves', { device: '24-0001', date: '2026-03-01', type: '安裝', from: '公司倉庫', to: '大華貿易 3F' });
  assert.equal(lock(d1), '要換位置請新增異動');
  // 新增異動時，原位置先帶入設備目前的位置
  assert.equal(field('moves', 'from').calc({ device: '24-0001' }), '公司倉庫');
  assert.equal(field('moves', 'from').calc({ device: '' }), '');
  assert.equal(field('moves', 'from').hidden, true); // 表單上不顯示，選了位置（設備）就填好
  assert.equal(Records.deviceNote('24-0001'), '#1001 · 3101R800451');
});

test('位置清單改名：設備、異動的原位置和新位置一起改', () => {
  const { Store, Refs, add, d1 } = withDevices();
  const m = add('moves', { device: '24-0001', date: '2026-03-01', type: '移機', from: '公司倉庫', to: '公司倉庫' });
  const opt = Store.list('options').find(o => o.name === '公司倉庫');
  const before = { ...opt };
  Store.update('options', opt.id, { name: '總公司倉庫' });
  const changed = plain(Refs.renameRefs('options', before, Store.get('options', opt.id)));
  assert.deepEqual(changed, [{ table: 'devices', id: d1.id }, { table: 'moves', id: m.id }]);
  assert.equal(Store.get('moves', m.id).from, '總公司倉庫');
  assert.equal(Store.get('moves', m.id).to, '總公司倉庫');
  assert.equal(Store.get('devices', d1.id).location, '總公司倉庫');
  assert.equal(Refs.usesText('options', Store.get('options', opt.id)), '1 台設備、1 筆異動');
});

// ---------- 合約 ----------
test('合約：最新一筆（依簽約日）是目前的合約；快到期、已到期時標色，舊合約不標', () => {
  const { Records, SCHEMAS, add } = withDevices();
  const old = add('contracts', { device: '24-0001', signDate: '2024-01-01', endDate: '2025-12-31', content: '舊客戶' });
  const now = add('contracts', { device: '24-0001', signDate: '2026-01-01', endDate: '2026-10-30', content: '月租 3,000\n含 2,000 張', readDay: '每月 25 日' });
  assert.equal(Records.currentContract('24-0001').id, now.id);
  assert.equal(Records.isCurrentContract(old), false);
  assert.deepEqual(plain(Records.contractNote(now)), { text: '剩 19 天到期（2026/10/30）・抄表 每月 25 日', warn: true });
  assert.deepEqual(plain(Records.contractNote(old)), { text: '到期 2025/12/31', warn: false });
  assert.equal(SCHEMAS.contracts.card.title(now), '月租 3,000');
  assert.equal(Records.currentContract('25-0001'), null);
});

test('合約：目前的合約已經過了到期日', () => {
  const { Records, add } = withDevices();
  const c = add('contracts', { device: '24-0001', signDate: '2025-01-01', endDate: '2026-09-30' });
  assert.deepEqual(plain(Records.endText(c)), { text: '已到期（2026/09/30）', warn: true });
});

// ---------- 抄表 ----------
test('抄表：本期用量＝這次減上一次，保養、翻新填的張數一起排；比上一次少時提醒', () => {
  const { Records, add } = withDevices();
  const r1 = add('readings', { device: '24-0001', date: '2026-07-25', bw: 10000, color: 500 });
  const s1 = add('maintenance', { device: '24-0001', date: '2026-08-10', item: '碳粉 K', bw: 10800 });
  const r2 = add('readings', { device: '24-0001', date: '2026-08-25', bw: 11500, color: 620 });
  const r3 = add('readings', { device: '24-0001', date: '2026-09-25', bw: 11200, color: 700 });
  add('readings', { device: '25-0001', date: '2026-08-01', bw: 1 }); // 別台的不算
  assert.deepEqual(plain(Records.usageNote(r1)), { text: '第一次抄表', warn: false });
  assert.deepEqual(plain(Records.usageNote(r2)), { text: '本期 黑白 700・彩色 120', warn: false }); // 黑白跟保養時的 10,800 比
  assert.deepEqual(plain(Records.usageNote(r3)), { text: '黑白比上一次少（上次 11,500，2026/08/25）', warn: true });
  assert.equal(Records.countsText(s1), '黑白 10,800');
  assert.equal(Records.latest('readings', '24-0001', 'date').id, r3.id);
});

test('抄表：表單上寫上次的張數和本期用量；新增時同一天的都算之前，編輯時不跟自己比', () => {
  const { Records, add } = withDevices();
  const r1 = add('readings', { device: '24-0001', date: '2026-08-25', bw: 11500, color: 620 });
  // 兩行：上次（今年的日期不寫年）／本期或比上次少
  assert.equal(Records.countNote({ device: '24-0001', date: '2026-09-25', bw: '12,000', id: null }, 'bw'), '上次 11,500（08/25）\n本期 500');
  assert.deepEqual(plain(Records.countNote({ device: '24-0001', date: '2026-08-25', bw: '11000', id: null }, 'bw')),
    { text: '上次 11,500（08/25）\n比上次少', warn: true });
  assert.equal(Records.countNote({ device: '24-0001', date: '2026-09-25', color: '', id: null }, 'color'), '上次 620（08/25）');
  assert.equal(Records.countNote({ device: '24-0001', date: '2026-08-25', bw: '11500', id: r1.id }, 'bw'), ''); // 第一筆，前面沒有
  assert.equal(Records.countNote({ device: '', date: '2026-09-25', bw: '1', id: null }, 'bw'), '');
  // 去年的寫年
  add('readings', { device: '25-0001', date: '2025-12-25', bw: 900 });
  assert.equal(Records.countNote({ device: '25-0001', date: '2026-01-25', bw: '', id: null }, 'bw'), '上次 900（2025/12/25）');
});

test('抄表的結算月份：自己選、不預設；同一台同一個月抄兩次時提醒（還是可以存）；列表依結算月份分組、卡片寫哪天抄的', () => {
  const { Records, SCHEMAS, add, field } = withDevices();
  const f = field('readings', 'month');
  assert.equal(f.type, 'month');
  assert.equal(f.optional, undefined); // 必填
  assert.equal(f.default, undefined);  // 不預設
  assert.equal(f.keep, undefined);
  const r1 = add('readings', { device: '24-0001', date: '2026-10-03', month: '2026-09', bw: 1000 });
  const r2 = add('readings', { device: '24-0001', date: '2026-10-28', month: '2026-10', bw: 1500 });
  assert.deepEqual(plain(f.note({ device: '24-0001', month: '2026-09', id: null })), { text: '這個月已經抄過了（10/03）', warn: true });
  assert.equal(f.note({ device: '24-0001', month: '2026-09', id: r1.id }), ''); // 編輯自己那筆
  assert.equal(f.note({ device: '25-0001', month: '2026-09', id: null }), '');  // 別台
  assert.equal(f.note({ device: '24-0001', month: '', id: null }), '');
  assert.deepEqual(plain(SCHEMAS.readings.period), { key: 'month', unit: 'month', label: '結算月份', then: 'date' });
  assert.deepEqual(plain(Records.readingNote(r2)), { text: '2026/10/28 抄・本期 黑白 500', warn: false });
  assert.equal(Records.describe('readings', r1), '#1001 2026/09 抄表');
});

// ---------- 保養、翻新 ----------
test('保養、翻新：卡片標題和最下面一行；保養的張數算進抄表用量', () => {
  const { Records, SCHEMAS, add } = withDevices();
  const k = add('maintenance', { device: '24-0001', date: '2026-09-10', item: '碳粉 K', bw: 12000, color: 100, note: '客戶說卡紙\n第二行' });
  const p = add('maintenance', { device: '24-0001', date: '2026-09-10', item: '感光鼓' }); // 同一趟換的第二樣
  const f = add('refurbs', { device: '24-0001', date: '2026-09-20', stockDate: '2026-09-25', engineer: '陳志明', country: '日', painted: true,
    source: '日本拍賣', content: '換外殼\n清潔內部' });
  const r = add('readings', { device: '24-0001', date: '2026-09-25', bw: 12600 });
  assert.equal(SCHEMAS.maintenance.card.title(k), '碳粉 K');
  assert.equal(SCHEMAS.refurbs.card.title(f), '換外殼');
  assert.deepEqual(plain(Records.workNote(k)), { text: '黑白 12,000・彩色 100・客戶說卡紙', warn: false });
  assert.deepEqual(plain(Records.refurbNote(f)), { text: '2026/09/25 入庫・陳志明・日・噴漆・原廠商 日本拍賣', warn: false });
  assert.equal(Records.workNote(p), null);
  assert.deepEqual(plain(Records.usageNote(r)), { text: '本期 黑白 600', warn: false });
  assert.equal(Records.describe('maintenance', k), '#1001 2026/09/10 碳粉 K');
  assert.equal(Records.describe('refurbs', f), '#1001 2026/09/20 翻新');
  // 保養只記在哪裡換了哪個：沒有廠商、費用；連續新增時日期留著
  assert.deepEqual(plain(SCHEMAS.maintenance.fields.map(x => x.key)), ['device', 'date', 'item', 'bw', 'color', 'note']);
  assert.deepEqual(plain(SCHEMAS.maintenance.fields.filter(x => x.keep).map(x => x.key)), ['date']);
});

test('翻新：翻新日期、入庫日、工程師（人員）、序號、國別（美／日）、原廠商、噴漆；沒有費用、張數', () => {
  const { Store, SCHEMAS, field, d1 } = withDevices();
  assert.deepEqual(plain(SCHEMAS.refurbs.fields.map(x => x.label)),
    ['設備', '翻新日期', '入庫日', '工程師', '序號', '國別', '原廠商', '噴漆', '翻新項目', '備註']);
  assert.equal(field('refurbs', 'engineer').ref, 'people');
  assert.deepEqual(plain(field('refurbs', 'country').toggle.map(o => o.value)), ['美', '日']);
  assert.equal(field('refurbs', 'painted').type, 'flag');
  // 序號先帶入設備現在的序號；改成不一樣的時候提醒（不會去改設備）
  Store.update('devices', d1.id, { serial: '3101R800451' });
  const serial = field('refurbs', 'serial');
  assert.equal(serial.calc({ device: '24-0001' }), '3101R800451');
  assert.equal(serial.note({ device: '24-0001', serial: '3101r800451' }), ''); // 大小寫不同不算
  assert.deepEqual(plain(serial.note({ device: '24-0001', serial: '3101R800999' })), { text: '設備是 3101R800451', warn: true });
  assert.equal(serial.note({ device: '25-0001', serial: '3101R800999' }), ''); // 設備還沒填序號
  assert.equal(Store.get('devices', d1.id).serial, '3101R800451');
});

test('保養項目：預設碳粉、感光鼓…，一筆選一個；幾筆在用、不能刪、改名一起改；不在清單裡的提醒', () => {
  const { Store, Refs, field, add } = withDevices();
  const f = field('maintenance', 'item');
  assert.deepEqual(plain(Refs.items(f).map(r => r.name)).sort(), ['廢粉盒', '感光鼓', '清潔保養', '碳粉 C', '碳粉 K', '碳粉 M', '碳粉 Y'].sort());
  assert.deepEqual(plain(Refs.items(field('parts', 'name')).map(r => r.name)).sort(), ['傳真卡', '底座', '裝訂器', '送紙匣'].sort());
  assert.equal(Store.ownCount(), 5); // 只有自己加的位置和設備，預設項目不算
  const s = add('maintenance', { device: '24-0001', date: '2026-09-10', item: '碳粉 K' });
  const k = Store.list('options').find(o => o.name === '碳粉 K');
  assert.equal(Refs.usesText('options', k), '1 筆保養');
  assert.match(Refs.removeBlock('options', k), /^還有 1 筆保養用到「碳粉 K」，不能刪除/);
  const before = { ...k };
  Store.update('options', k.id, { name: '黑色碳粉' });
  Refs.renameRefs('options', before, Store.get('options', k.id));
  assert.equal(Store.get('maintenance', s.id).item, '黑色碳粉');
  // 試算表手打了清單裡沒有的項目
  add('maintenance', { device: '24-0001', date: '2026-09-11', item: '定影器' });
  assert.deepEqual(plain(Refs.missing().map(m => [m.key, m.values])), [['options:保養項目', ['定影器']]]);
});

// ---------- 設備欄 ----------
test('紀錄的設備欄：表單上寫「位置」、選單顯示位置、存編號；幾筆紀錄在用；不能「＋ 新增」、不列在「不在清單裡」', () => {
  const { Store, Refs, Records, field, add, d1, d2 } = withDevices();
  const f = field('readings', 'device');
  assert.equal(f.formLabel, '位置');
  assert.deepEqual(plain(Refs.items(f).map(r => r.code)), ['24-0001', '25-0001']);
  assert.equal(Refs.targetOf('devices').label(d1), '公司倉庫');
  assert.equal(Refs.targetOf('devices').label(d2), '#1002'); // 還沒填位置的顯示機型＋名稱
  assert.equal(Refs.sub('devices', d1), '#1001 · 3101R800451'); // 選單的小字有序號，打序號也找得到
  assert.equal(Refs.find(f, '24-0001').id, d1.id);
  add('moves', { device: '24-0001', date: '2026-03-01', type: '安裝', from: '公司倉庫', to: '大華貿易 3F' });
  add('readings', { device: '24-0001', date: '2026-03-25', bw: 100 });
  add('readings', { device: '99-0001', date: '2026-03-25', bw: 100 }); // 打錯的編號
  assert.equal(Refs.usesText('devices', d1), '1 筆異動、1 筆抄表');
  assert.deepEqual(plain(Refs.missing()), []);
  assert.deepEqual(plain(Records.orphans().map(o => [o.table, o.rec.device])), [['readings', '99-0001']]);
  assert.deepEqual(plain(Records.recordLine('readings', { device: '99-0001' })), { text: '99-0001：找不到這台設備', warn: true });
  assert.deepEqual(plain(Records.recordLine('moves', { device: '24-0001' })), { text: '#1001', warn: false });
  // 卡片上寫那時候在哪裡：3/1 安裝到大華之前在公司倉庫
  assert.deepEqual(plain(Records.recordLine('readings', { device: '24-0001', date: '2026-03-25' })), { text: '大華貿易 3F · #1001', warn: false });
  assert.deepEqual(plain(Records.recordLine('readings', { device: '24-0001', date: '2026-02-01' })), { text: '公司倉庫 · #1001', warn: false });
  // 搜尋紀錄時打序號找得到
  assert.match(Records.deviceText('24-0001'), /3101R800451/);
  // 在試算表裡改了設備編號：紀錄一起改
  const before = { ...d1 };
  Store.update('devices', d1.id, { code: '24-0009' });
  Refs.renameRefs('devices', before, Store.get('devices', d1.id));
  assert.equal(Records.of('readings', '24-0009').length, 1);
  assert.equal(Records.of('moves', '24-0009').length, 1);
});

test('編號重複換號：這台裝置上新增的紀錄跟著這台裝置上新增的設備；分不出來時留在沒換號的那台', () => {
  const { Store, Records, add } = withDevices();
  const remote = add('devices', { id: 'a1', code: '26-0001', name: '別台裝置新增的' });
  const mine = add('devices', { id: 'a2', code: '26-0001', name: '這台新增的' });
  const r1 = add('readings', { id: 'r1', device: '26-0001', date: '2026-10-01', bw: 1 });
  const r2 = add('readings', { id: 'r2', device: '26-0001', date: '2026-10-02', bw: 2 });
  const local = new Set(['devices:a2', 'readings:r2']);
  Store.update('devices', mine.id, { code: '26-0002' });
  const fixed = [{ id: mine.id, from: '26-0001', to: '26-0002', name: mine.name }];
  assert.deepEqual(plain(Records.followCodes(fixed, (t, id) => local.has(`${t}:${id}`))), [{ table: 'readings', id: 'r2' }]);
  assert.equal(Store.get('readings', r1.id).device, '26-0001');
  assert.equal(Store.get('readings', r2.id).device, '26-0002');
  // 兩台都是試算表讀回來的（分不出來）：不動
  Store.update('devices', remote.id, { code: '26-0003' });
  assert.deepEqual(plain(Records.followCodes([{ id: remote.id, from: '26-0002', to: '26-0003' }], () => false)), []);
});

// ---------- 選配件 ----------
test('選配件：裝著的在前、拆掉的在後；已拆除的標籤', () => {
  const { SCHEMAS, Records, add } = withDevices();
  const a = add('parts', { device: '24-0001', name: '送紙匣', installDate: '2026-01-05', removeDate: '2026-06-01' });
  const b = add('parts', { device: '24-0001', name: '裝訂器', installDate: '2026-02-01', serial: 'SR1' });
  const c = add('parts', { device: '24-0001', name: '傳真卡', installDate: '2026-03-01' });
  assert.deepEqual([a, b, c].sort(SCHEMAS.parts.order).map(r => r.name), ['傳真卡', '裝訂器', '送紙匣']);
  assert.deepEqual(plain(SCHEMAS.parts.status(a)), { label: '已拆除', cls: 'gray' });
  assert.equal(SCHEMAS.parts.status(b), null);
  assert.deepEqual(plain(Records.partNote(b)), { text: '序號 SR1・2026/02/01 安裝', warn: false });
});

// ---------- 總覽 ----------
test('總覽：各機型有幾台，先篩狀態；機型的大小寫、空格不同算同一種；照機型清單的順序，沒填機型的排最後', () => {
  const { Records, add } = withDevices();
  add('devices', { code: '26-0002', name: 'a', status: '出租中', brand: 'Ricoh', model: 'IM C6000' });
  add('devices', { code: '26-0003', name: 'b', status: '出租中', brand: 'Ricoh', model: 'im c6000' });
  add('devices', { code: '26-0004', name: 'c', status: '出租中', brand: 'Ricoh', model: 'IMC6000' });
  add('devices', { code: '26-0005', name: 'd', status: '出租中', brand: 'Ricoh', model: 'IM C4500' });
  add('devices', { code: '26-0006', name: 'e', status: '出租中', model: '' });
  add('devices', { code: '26-0007', name: 'f', status: '庫存', brand: 'Ricoh', model: 'IM C4500' });
  add('devices', { code: '26-0008', name: 'g', status: '出租中 ', brand: 'Ricoh', model: 'IM C4500' }); // 試算表手打多了空白
  // withDevices 的兩台：24-0001 出租中、25-0001 庫存，都沒填機型
  // 機型清單還沒排：依名字
  assert.deepEqual(plain(Records.modelCounts('出租中')), [
    { model: 'IM C4500', brand: 'Ricoh', count: 2 },
    { model: 'IM C6000', brand: 'Ricoh', count: 3 },
    { model: '', brand: '', count: 2 },
  ]);
  // 機型清單排過：照清單的順序
  add('options', { list: '機型', name: 'IM C6000', order: 1 });
  add('options', { list: '機型', name: 'IM C4500', order: 2 });
  assert.deepEqual(plain(Records.modelCounts('出租中').map(r => r.model)), ['IM C6000', 'IM C4500', '']);
  assert.deepEqual(plain(Records.modelCounts('庫存')), [
    { model: 'IM C4500', brand: 'Ricoh', count: 1 },
    { model: '', brand: '', count: 1 },
  ]);
  assert.equal(Records.modelCounts('').reduce((n, r) => n + r.count, 0), 9);
  assert.deepEqual(plain(Records.modelCounts('報廢')), []);
});

test('設備：編號不顯示，認機器看機型＋名稱；名稱下面寫序號；同機型同名稱時提醒；列表照機型清單的順序', () => {
  const { Store, SCHEMAS, Records, field, add } = withDevices();
  const s = SCHEMAS.devices;
  assert.equal(s.card.code, undefined);
  assert.deepEqual(plain(s.card.grid), ['model', 'location', 'keeper']);
  assert.equal(field('devices', 'code').hidden, true);
  assert.equal(field('devices', 'code').auto !== undefined, true); // 系統還是會給編號
  const a = add('devices', { code: '26-0011', name: '#1234', model: 'IMC4500', serial: '3101R800999', status: '出租中' });
  assert.equal(s.card.sub(a), '序號 3101R800999');
  assert.equal(s.describe(a), 'IMC4500 #1234');
  assert.equal(Records.fullLabel(a), 'IMC4500 #1234 · 3101R800999');
  const note = field('devices', 'name').note;
  assert.deepEqual(plain(note({ name: '#1234', model: 'IMC4500', id: null })), { text: '同機型已經有這個名稱', warn: true });
  assert.equal(note({ name: '#1234', model: 'IMC4500', id: a.id }), ''); // 編輯自己
  assert.equal(note({ name: '#1234', model: 'IMC6000', id: null }), ''); // 別的機型可以同名
  // 照機型清單的順序，同一個機型依名稱（照數字大小）
  add('options', { list: '機型', name: 'IMC6000', order: 1 });
  add('options', { list: '機型', name: 'IMC4500', order: 2 });
  const b = add('devices', { code: '26-0012', name: '#998', model: 'IMC4500', status: '出租中' });
  const c = add('devices', { code: '26-0013', name: '#5000', model: 'IMC6000', status: '出租中' });
  const order = [a, b, c, ...Store.list('devices').slice(0, 2)].sort(s.order).map(d => d.name);
  assert.deepEqual(order, ['#5000', '#998', '#1234', '#1001', '#1002']); // 沒填機型的排最後
});

test('紀錄分頁卡片最上面一行：位置 · 機型 名稱（不寫序號）；合約寫合約期間的位置（不是簽約那天的倉庫）；異動只寫機器', () => {
  const { Records, add } = withDevices();
  add('moves', { device: '24-0001', date: '2025-03-05', type: '安裝', from: '公司倉庫', to: '大華貿易 3F' });
  add('moves', { device: '24-0001', date: '2026-04-01', type: '移機', from: '大華貿易 3F', to: '安心診所 櫃台' });
  const old = add('contracts', { device: '24-0001', signDate: '2025-03-01', endDate: '2026-03-31' }); // 簽約時還在倉庫
  const now = add('contracts', { device: '24-0001', signDate: '2026-03-28', endDate: '2028-03-31' });
  const m = add('maintenance', { device: '24-0001', date: '2025-08-01', item: '碳粉 K' });
  const r = add('readings', { device: '24-0001', date: '2026-09-25', month: '2026-09', bw: 1 });
  const mv = add('moves', { device: '24-0001', date: '2026-04-01', type: '其他', to: '安心診所 櫃台' });
  assert.deepEqual(plain(Records.recordLine('maintenance', m)), { text: '大華貿易 3F · #1001', warn: false });
  assert.deepEqual(plain(Records.recordLine('contracts', old)), { text: '大華貿易 3F · #1001', warn: false });
  assert.deepEqual(plain(Records.recordLine('contracts', now)), { text: '安心診所 櫃台 · #1001', warn: false });
  assert.deepEqual(plain(Records.recordLine('readings', r)), { text: '安心診所 櫃台 · #1001', warn: false });
  assert.deepEqual(plain(Records.recordLine('moves', mv)), { text: '#1001', warn: false });
  assert.deepEqual(plain(Records.recordLine('readings', { device: '99-0001' })), { text: '99-0001：找不到這台設備', warn: true });
});
