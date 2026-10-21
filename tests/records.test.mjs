// 紀錄的測試：node --test tests/*.test.mjs
//   位置（編號、改名、一格一台、位置詳情）、異動（位置歷程）、合約（綁位置、修改紀錄）、抄表用量、保養、翻新、選配件（records.js）
//   紀錄的設備欄和保養項目（refs.js）、舊資料轉換
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
// 紀錄卡片下面那一排（小標題＋內容）接成一行，方便比對；有一格要提醒就算提醒
const line = (Records, table, r) => {
  const cells = Records.recordCells(table, r);
  return { text: cells.map(c => c.value).filter(Boolean).join(' · '), warn: cells.some(c => c.warn) };
};

// 位置（存編號，畫面上寫名稱）：L0001 公司倉庫（倉庫）、L0002 大華貿易 3F、L0003 安心診所 櫃台
const WH = 'L0001';
const DH = 'L0002';
const AX = 'L0003';

// 兩台設備（名稱是機身號碼，編號只在系統裡用）：24-0001 一開始放在公司倉庫，25-0001 還沒填位置
function withDevices() {
  const a = app();
  a.add('locations', { code: WH, name: '公司倉庫', stock: true });
  a.add('locations', { code: DH, name: '大華貿易 3F' });
  a.add('locations', { code: AX, name: '安心診所 櫃台' });
  const d1 = a.add('devices', { code: '24-0001', name: '#1001', serial: '3101R800451', status: '出租中', location: WH });
  const d2 = a.add('devices', { code: '25-0001', name: '#1002', status: '庫存' });
  return { ...a, d1, d2 };
}

// ---------- 位置歷程 ----------
test('位置：設備目前的位置＝最新一筆異動的新位置（依日期，同一天依新增的先後）', () => {
  const { Store, Records, add, d1 } = withDevices();
  add('moves', { id: 'm1', device: '24-0001', date: '2026-03-01', type: '安裝', from: WH, to: DH });
  add('moves', { id: 'm3', device: '24-0001', date: '2026-05-01', type: '移機', from: DH, to: AX });
  add('moves', { id: 'm2', device: '24-0001', date: '2026-01-01', type: '其他', from: '', to: WH }); // 後來補登的舊紀錄
  assert.deepEqual(plain(Records.syncLocations()), [{ table: 'devices', id: d1.id }]);
  assert.equal(Store.get('devices', d1.id).location, AX);
  // 同一天兩筆：後新增的為準
  add('moves', { id: 'm4', device: '24-0001', date: '2026-05-01', type: '撤機', from: AX, to: WH });
  Records.syncLocations();
  assert.equal(Store.get('devices', d1.id).location, WH);
  // 沒有變：不用改
  assert.deepEqual(plain(Records.syncLocations()), []);
});

test('位置：點錯了就改或刪那一筆，位置自動回到對的；最後一筆刪掉時回到那一筆的原位置', () => {
  const { Store, Records, SCHEMAS, add, d1, d2 } = withDevices();
  const m1 = add('moves', { device: '24-0001', date: '2026-03-01', type: '安裝', from: WH, to: DH });
  const m2 = add('moves', { device: '24-0001', date: '2026-05-01', type: '移機', from: DH, to: AX });
  SCHEMAS.moves.afterSave(null, m2);
  assert.equal(Store.get('devices', d1.id).location, AX);
  // 刪掉最新一筆：回到前一筆的新位置
  Store.remove('moves', m2.id);
  SCHEMAS.moves.afterRemove(m2);
  assert.equal(Store.get('devices', d1.id).location, DH);
  // 這一筆其實是另一台設備的：兩台都重新算，原來那台沒有異動了，回到原位置
  const before = { ...m1 };
  Store.update('moves', m1.id, { device: '25-0001' });
  SCHEMAS.moves.afterSave(before, Store.get('moves', m1.id));
  assert.equal(Store.get('devices', d1.id).location, WH);
  assert.equal(Store.get('devices', d2.id).location, DH);
  assert.equal(Records.hasMoves('24-0001'), false);
  assert.equal(Records.hasMoves('25-0001'), true);
});

test('位置：還沒有異動的設備，表單上的位置照常可以填；有了異動之後只顯示', () => {
  const { Records, add, d1, field } = withDevices();
  const lock = field('devices', 'location').lock;
  assert.equal(lock(d1), '');
  add('moves', { device: '24-0001', date: '2026-03-01', type: '安裝', from: WH, to: DH });
  assert.equal(lock(d1), '要換位置請新增異動');
  // 新增異動時，原位置先帶入設備目前的位置
  assert.equal(field('moves', 'from').calc({ device: '24-0001' }), WH);
  assert.equal(field('moves', 'from').calc({ device: '' }), '');
  assert.equal(field('moves', 'from').hidden, true); // 表單上不顯示，選了位置（設備）就填好
  assert.equal(Records.deviceNote('24-0001'), '#1001 · 3101R800451');
});

// ---------- 位置 ----------
test('位置：存編號、畫面上寫名稱；改名只改位置那一列，舊名字記在「以前的名字」；搜尋時以前的名字也找得到', () => {
  const { Store, Refs, Records, SCHEMAS, field, add, d1 } = withDevices();
  const m = add('moves', { device: '24-0001', date: '2026-03-01', type: '移機', from: WH, to: DH });
  assert.equal(Records.placeName(DH), '大華貿易 3F');
  assert.equal(Records.placeName('L0099'), 'L0099'); // 找不到時照原本的字
  assert.equal(Records.moveTitle(m), '公司倉庫 → 大華貿易 3F');
  assert.equal(field('devices', 'location').format(WH), '公司倉庫'); // 設備卡片、分組上寫名稱
  const p = Store.list('locations').find(x => x.code === DH);
  const before = { ...p };
  Store.update('locations', p.id, { name: '大華國際 3F' });
  assert.deepEqual(plain(SCHEMAS.locations.afterSave(before, Store.get('locations', p.id))), [{ table: 'locations', id: p.id }]);
  assert.equal(Store.get('locations', p.id).oldNames, '大華貿易 3F（到 2026/10/11）');
  assert.equal(Store.get('moves', m.id).to, DH); // 異動不用改
  assert.equal(Records.moveTitle(Store.get('moves', m.id)), '公司倉庫 → 大華國際 3F');
  // 再改一次：多一行
  const again = { ...Store.get('locations', p.id) };
  Store.update('locations', p.id, { name: '大華 3F' });
  Records.keepOldName(again, Store.get('locations', p.id));
  assert.equal(Store.get('locations', p.id).oldNames, '大華貿易 3F（到 2026/10/11）\n大華國際 3F（到 2026/10/11）');
  // 名字沒變（改了別的欄位）：不記
  assert.deepEqual(plain(Records.keepOldName(Store.get('locations', p.id), Store.get('locations', p.id))), []);
  // 以前的名字：搜尋、下拉選單打字、依名字找都找得到
  assert.match(Records.placeText(DH), /大華貿易 3F/);
  assert.match(Refs.targetOf('locations').also(Store.get('locations', p.id)), /大華貿易 3F/);
  assert.equal(Records.placeByName('大華貿易 3F').code, DH);
  assert.equal(Records.placeByName('大華 3F').code, DH);
  assert.equal(Records.placeByName('沒有這個'), null);
  assert.equal(Refs.usesText('locations', Store.get('locations', p.id)), '1 筆異動');
  assert.equal(Store.get('devices', d1.id).location, WH);
});

test('一格一台：選了一個已經放著別台機器的位置時提醒；倉庫不提醒；下拉選單寫現在放著哪台', () => {
  const { Store, Refs, Records, field, add, d1, d2 } = withDevices();
  Store.update('devices', d1.id, { location: DH });
  const to = field('moves', 'to').note;
  assert.deepEqual(plain(to({ to: DH, device: '25-0001' })), { text: '這裡現在是 #1001', warn: true });
  assert.equal(to({ to: DH, device: '24-0001' }), ''); // 自己
  assert.equal(to({ to: AX, device: '25-0001' }), ''); // 空的
  assert.equal(field('devices', 'location').note({ location: DH, code: '25-0001' }).text, '這裡現在是 #1001');
  Store.update('devices', d1.id, { location: WH });
  Store.update('devices', d2.id, { location: WH });
  assert.equal(to({ to: WH, device: '26-0001' }), ''); // 倉庫可以放好幾台
  const wh = Store.list('locations').find(x => x.code === WH);
  assert.equal(Refs.sub('locations', wh), '2 台');
  assert.equal(Refs.sub('locations', Store.list('locations').find(x => x.code === AX)), '');
  Store.update('devices', d2.id, { location: AX });
  assert.equal(Refs.sub('locations', Store.list('locations').find(x => x.code === AX)), '#1002');
  assert.deepEqual(plain(Records.machinesAt(AX).map(d => d.code)), ['25-0001']);
  add('devices', { code: '26-0001', name: '#2000', location: AX });
});

test('位置詳情：進出這一格的異動；機器放在這一格期間做的保養、抄表（換機前後分得開）', () => {
  const { Records, add } = withDevices();
  // #1001 1/5 裝到大華，7/1 搬去安心；#1002 7/1 換進大華
  add('moves', { device: '24-0001', date: '2026-01-05', type: '安裝', from: WH, to: DH });
  add('moves', { device: '24-0001', date: '2026-07-01', type: '移機', from: DH, to: AX });
  add('moves', { device: '25-0001', date: '2026-07-01', type: '安裝', from: WH, to: DH });
  const a = add('maintenance', { device: '24-0001', date: '2026-03-10', item: '碳粉 K' });
  const b = add('maintenance', { device: '24-0001', date: '2026-05-20', item: '感光鼓' });
  const c = add('maintenance', { device: '24-0001', date: '2026-09-15', item: '碳粉 K' });
  const d = add('maintenance', { device: '25-0001', date: '2026-08-01', item: '碳粉 C' });
  assert.deepEqual(plain(Records.recordsAt('maintenance', DH).map(r => r.id)).sort(), [a.id, b.id, d.id].sort());
  assert.deepEqual(plain(Records.recordsAt('maintenance', AX).map(r => r.id)), [c.id]);
  assert.equal(Records.movesAt(DH).length, 3);
  assert.equal(Records.movesAt(AX).length, 1);
  // 搜尋只找那時候在那裡的：#1001 現在在安心，3 月那筆不會被「安心」找到
  assert.doesNotMatch(Records.deviceText('24-0001', '2026-03-10'), /安心/);
  assert.match(Records.deviceText('24-0001', '2026-03-10'), /大華貿易 3F/);
  assert.match(Records.deviceText('24-0001', '2026-09-15'), /安心診所 櫃台/);
});

test('位置詳情的異動：一台待過一段，現在放著的在最上面；換機那天兩台各一段；開始記異動之前就在的沒有進來；沒有異動的也算', () => {
  const { Records, add } = withDevices();
  // #1003 本來就在大華，2025/01/01 撤回倉庫；#1001 2025/03/05 裝到大華，2026/01/10 換成 #1002（先撤再裝）；#1004 在安心，沒有異動
  add('devices', { code: '26-0002', name: '#1003', location: DH });
  add('devices', { code: '26-0001', name: '#1004', location: AX });
  add('moves', { device: '26-0002', date: '2025-01-01', type: '撤機', from: DH, to: WH });
  add('moves', { device: '24-0001', date: '2025-03-05', type: '安裝', from: WH, to: DH });
  add('moves', { device: '24-0001', date: '2026-01-10', type: '撤機', from: DH, to: WH });
  add('moves', { device: '25-0001', date: '2026-01-10', type: '安裝', from: WH, to: DH });
  Records.syncLocations();
  const stays = code => plain(Records.staysAt(code).map(s => [s.device, s.in?.date ?? null, s.out?.date ?? null]));
  assert.deepEqual(stays(DH), [['25-0001', '2026-01-10', null], ['24-0001', '2025-03-05', '2026-01-10'], ['26-0002', null, '2025-01-01']]);
  assert.deepEqual(stays(AX), [['26-0001', null, null]]);
  // 倉庫：還在的越晚進來越上面，再來越晚離開的越上面
  assert.deepEqual(stays(WH), [['24-0001', '2026-01-10', null], ['26-0002', '2025-01-01', null], ['25-0001', null, '2026-01-10'], ['24-0001', null, '2025-03-05']]);
  assert.deepEqual(plain(Records.staysAt('')), []);
  // 待了多久
  assert.equal(Records.spanText('2025-08-15', '2026-03-28'), '7 個月');
  assert.equal(Records.spanText('2024-05-01', '2026-03-01'), '1 年 10 個月');
  assert.equal(Records.spanText('2024-03-01', '2026-03-01'), '2 年');
  assert.equal(Records.spanText('2026-01-31', '2026-02-28'), '28 天');
  assert.equal(Records.spanText('2026-03-28', '2026-03-28'), '當天');
  assert.equal(Records.spanText('', '2026-03-28'), '');
});

test('搬機器那天的紀錄算客戶那邊：撤機那天抄的算原客戶、安裝那天抄的算新客戶，換機那天兩台都算這一格；客戶搬家算新位置', () => {
  const { Records, add } = withDevices();
  const NEW = 'L0004';
  add('locations', { code: NEW, name: '安心診所 新辦公室' });
  // #1001 3/1 裝到大華、6/30 撤回倉庫；#1002 同一天換進大華；#1001 8/1 裝到安心、9/1 跟著客戶搬到新辦公室
  add('moves', { device: '24-0001', date: '2026-03-01', type: '安裝', from: WH, to: DH });
  add('moves', { device: '24-0001', date: '2026-06-30', type: '撤機', from: DH, to: WH });
  add('moves', { device: '25-0001', date: '2026-06-30', type: '安裝', from: WH, to: DH });
  add('moves', { device: '24-0001', date: '2026-08-01', type: '安裝', from: WH, to: AX });
  add('moves', { device: '24-0001', date: '2026-09-01', type: '移機', from: AX, to: NEW });
  const r = (device, date) => add('readings', { device, date, bw: 100 }).id;
  const first = r('24-0001', '2026-03-01');
  const last = r('24-0001', '2026-06-30');
  const swap = r('25-0001', '2026-06-30');
  const after = r('24-0001', '2026-07-15');
  assert.deepEqual(plain(Records.recordsAt('readings', DH)).map(x => x.id).sort(), [first, last, swap].sort());
  assert.deepEqual(plain(Records.recordsAt('readings', WH)).map(x => x.id), [after]);
  assert.deepEqual(plain(line(Records, 'readings', { device: '24-0001', date: '2026-06-30' })), { text: '大華貿易 3F · #1001', warn: false });
  assert.equal(Records.locationAt('24-0001', '2026-08-01'), AX);
  assert.equal(Records.locationAt('24-0001', '2026-09-01'), NEW); // 兩邊都是客戶：算新位置
  assert.equal(Records.locationAt('25-0001', '2026-01-01'), WH); // 第一筆異動之前：原位置
});

test('異動的表單：第一格寫「原位置」（打位置找設備）；新位置的選單空的位置在最上面，再來是倉庫，最後是已經放著機器的', () => {
  const { Store, Refs, field, d2 } = withDevices();
  assert.equal(field('moves', 'device').formLabel, '原位置');
  assert.equal(field('readings', 'device').formLabel, '位置');
  Store.update('devices', d2.id, { location: DH });
  const order = () => plain(Refs.items(field('moves', 'to')).map(r => r.code));
  assert.deepEqual(order(), [AX, WH, DH]);
  // 機器搬走了，那一格變成空的，排到最上面
  Store.update('devices', d2.id, { location: WH });
  assert.deepEqual(order().slice(0, 2).sort(), [AX, DH].sort());
  assert.equal(order()[2], WH);
});

test('異動的狀態：撤機先帶庫存、安裝先帶出租中，可以改；存了最新一筆時設備的狀態跟著改，補登以前的、只改備註、刪掉都不會改', () => {
  const { Store, Records, SCHEMAS, field, add, d1 } = withDevices();
  const calc = field('moves', 'status').calc;
  assert.equal(calc({ type: '撤機' }), '庫存');
  assert.equal(calc({ type: '安裝' }), '出租中');
  assert.equal(calc({ type: '移機' }), ''); // 其他類型不帶，設備的狀態不改
  const save = rec => { const m = add('moves', rec); SCHEMAS.moves.afterSave(null, m); return m; };
  const status = () => Store.get('devices', d1.id).status;
  save({ device: '24-0001', date: '2026-03-01', type: '安裝', from: WH, to: DH, status: '出租中' });
  const out = save({ device: '24-0001', date: '2026-06-30', type: '撤機', from: DH, to: WH, status: '維修中' }); // 故障：改成維修中
  assert.equal(status(), '維修中');
  // 補登以前的異動：不是最新的一筆，不改
  save({ device: '24-0001', date: '2026-01-01', type: '其他', from: '', to: WH, status: '庫存' });
  assert.equal(status(), '維修中');
  // 修好了自己改成庫存；之後只改那筆異動的備註，不會蓋掉
  Store.update('devices', d1.id, { status: '庫存' });
  const before = { ...out };
  Store.update('moves', out.id, { note: '無法開機' });
  SCHEMAS.moves.afterSave(before, Store.get('moves', out.id));
  assert.equal(status(), '庫存');
  // 狀態空白：不改
  save({ device: '24-0001', date: '2026-08-01', type: '其他', from: WH, to: AX, status: '' });
  assert.equal(status(), '庫存');
  // 刪掉異動：位置回去，狀態不會改回去
  const last = Records.of('moves', '24-0001').find(m => m.date === '2026-08-01');
  Store.remove('moves', last.id);
  SCHEMAS.moves.afterRemove(last);
  assert.equal(Store.get('devices', d1.id).location, WH);
  assert.equal(status(), '庫存');
  // 狀態清單裡沒有「庫存」（改了名字）：不帶
  const st = Store.list('statuses').find(s => s.name === '庫存');
  Store.update('statuses', st.id, { name: '在庫' });
  assert.equal(calc({ type: '撤機' }), '');
});

test('異動的原位置接上前一筆：刪掉中間一筆、改了舊的新位置、補登以前的，前後都接得起來；第一筆照原本的', () => {
  const { Store, Records, SCHEMAS, field, add } = withDevices();
  const save = rec => { const m = add('moves', rec); SCHEMAS.moves.afterSave(null, m); return m; };
  const chain = () => plain(Records.of('moves', '24-0001').sort((a, b) => a.date.localeCompare(b.date)).map(m => `${m.from}>${m.to}`));
  const m1 = save({ device: '24-0001', date: '2026-03-01', type: '安裝', from: WH, to: DH });
  const m2 = save({ device: '24-0001', date: '2026-05-01', type: '移機', from: DH, to: AX });
  save({ device: '24-0001', date: '2026-08-01', type: '撤機', from: AX, to: WH });
  // 刪掉中間那筆：撤機的原位置變成大華
  Store.remove('moves', m2.id);
  SCHEMAS.moves.afterRemove(m2);
  assert.deepEqual(chain(), [`${WH}>${DH}`, `${DH}>${WH}`]);
  // 改了第一筆的新位置：下一筆跟著改
  const before = { ...m1 };
  Store.update('moves', m1.id, { to: AX });
  SCHEMAS.moves.afterSave(before, Store.get('moves', m1.id));
  assert.deepEqual(chain(), [`${WH}>${AX}`, `${AX}>${WH}`]);
  // 補登在所有異動之前：原位置是開始記異動前在哪裡，原本的第一筆接上它
  const from = field('moves', 'from').calc;
  assert.equal(from({ device: '24-0001', date: '2026-01-10' }), WH);
  save({ device: '24-0001', date: '2026-01-10', type: '其他', from: WH, to: DH });
  assert.deepEqual(chain(), [`${WH}>${DH}`, `${DH}>${AX}`, `${AX}>${WH}`]);
  // 新增時的原位置：那天之前最後一筆的新位置；同一天已經有的算在前面；還沒有異動的是設備現在的位置
  assert.equal(from({ device: '24-0001', date: '2026-04-01' }), AX);
  assert.equal(from({ device: '24-0001', date: '2026-08-01' }), WH);
  assert.equal(from({ device: '25-0001', date: '2026-08-01' }), '');
  // 編輯時不算自己；第一筆照原本的
  const first = Records.of('moves', '24-0001').find(m => m.date === '2026-01-10');
  assert.equal(from({ device: '24-0001', date: '2026-01-10', id: first.id }), WH);
  assert.equal(from({ device: '24-0001', date: '2026-03-01', id: m1.id }), DH);
});

test('異動的類型：安裝 倉庫 → 客戶、撤機 客戶 → 倉庫、移機 客戶 → 客戶；下拉選單只列合得上的，存檔時檢查', () => {
  const { Store, Refs, Records, field, add, d1, d2 } = withDevices();
  const d3 = add('devices', { code: '26-0001', name: '#1003', status: '出租中', location: DH });
  const d4 = add('devices', { code: '26-0002', name: '#1004', status: '報廢', location: WH });
  const devices = type => plain(Refs.items(field('moves', 'device'), { values: { type } }).map(r => r.code)).sort();
  const places = type => plain(Refs.items(field('moves', 'to'), { values: { type } }).map(r => r.code)).sort();
  // 安裝：倉庫裡的、還沒有位置的機器（報廢的不列）；裝到客戶的位置
  assert.deepEqual(devices('安裝'), [d1.code, d2.code].sort());
  assert.deepEqual(places('安裝'), [AX, DH].sort());
  // 撤機：放在客戶那裡的機器；撤到倉庫
  assert.deepEqual(devices('撤機'), [d3.code]);
  assert.deepEqual(places('撤機'), [WH]);
  assert.deepEqual(devices('移機'), [d3.code]);
  assert.deepEqual(places('移機'), [AX, DH].sort());
  // 其他、還沒選類型：全部
  assert.equal(devices('其他').length, 4);
  assert.equal(devices('').length, 4);
  assert.equal(places('其他').length, 3);
  // 打了一個沒列出來的：選單裡寫為什麼
  assert.equal(field('moves', 'to').onlyNote({ type: '撤機' }), '撤機只列倉庫');
  assert.equal(field('moves', 'device').onlyNote({ type: '安裝' }), '安裝只列倉庫裡的機器（報廢的不列）');
  // 存檔時檢查：類型和原位置、新位置對不上
  const typeCheck = field('moves', 'type').check;
  const toCheck = field('moves', 'to').check;
  assert.equal(typeCheck({ type: '安裝', device: d3.code, from: DH }), '這台不在倉庫');
  assert.equal(typeCheck({ type: '安裝', device: d2.code, from: '' }), '');
  assert.equal(typeCheck({ type: '撤機', device: d1.code, from: WH }), '這台在倉庫');
  assert.equal(typeCheck({ type: '撤機', device: d2.code, from: '' }), '這台還沒有位置');
  assert.equal(typeCheck({ type: '其他', device: d1.code, from: WH }), '');
  assert.equal(toCheck({ type: '撤機', to: DH }), '撤機要選倉庫');
  assert.equal(toCheck({ type: '安裝', to: WH }), '安裝要選客戶的位置，不是倉庫');
  assert.equal(toCheck({ type: '安裝', to: AX }), '');
  assert.equal(field('moves', 'device').check({ type: '安裝', device: d4.code }), '這台是「報廢」，不能安裝');
  // 舊資料：類型、位置都沒改的不擋（只改備註照常可以存）
  const old = add('moves', { device: d3.code, date: '2026-01-01', type: '撤機', from: DH, to: AX });
  assert.equal(toCheck({ id: old.id, type: '撤機', from: DH, to: AX }), '');
  assert.equal(toCheck({ id: old.id, type: '撤機', from: DH, to: DH }), '撤機要選倉庫');
  // 從詳情頁新增：機器在倉庫先選安裝、在客戶那裡先選撤機、報廢的不選；位置詳情：倉庫先選撤機，其他先選安裝
  assert.equal(Records.moveTypeFor(d1), '安裝');
  assert.equal(Records.moveTypeFor(d2), '安裝');
  assert.equal(Records.moveTypeFor(Store.get('devices', d3.id)), '撤機');
  assert.equal(Records.moveTypeFor(d4), '');
  assert.equal(Records.moveTypeAt(Store.list('locations').find(p => p.code === WH)), '撤機');
  assert.equal(Records.moveTypeAt(Store.list('locations').find(p => p.code === AX)), '安裝');
});

test('異動的表單：編輯時原位置鎖住、寫當時的位置；日期打錯時提醒；新位置下面提醒合約、一格一台；連續撤機時倉庫留著', () => {
  const { Records, field, add } = withDevices();
  const f = field('moves', 'device');
  assert.equal(f.lock({ id: 'x' }), '選錯機器的話，刪掉這筆重新新增');
  add('moves', { device: '24-0001', date: '2026-10-06', type: '安裝', from: WH, to: DH });
  Records.syncLocations();
  // 原位置寫那天機器在哪裡：10/06 裝到大華之前在公司倉庫
  assert.equal(f.shown({ device: '24-0001', date: '2026-10-11' }), '大華貿易 3F');
  assert.equal(f.shown({ device: '24-0001', date: '2026-09-01' }), '公司倉庫');
  assert.equal(f.shown({ device: '25-0001', date: '2026-10-11' }), ''); // 還沒有位置：照平常的寫法（機型＋名稱）
  // 日期：比最近一筆早（不會改到現在的位置）、在今天之後（今天是 2026-10-11）
  const date = field('moves', 'date').note;
  assert.deepEqual(plain(date({ device: '24-0001', date: '2026-09-01' })), { text: '比 10/06 那筆早\n不會改到現在的位置', warn: true });
  assert.equal(date({ device: '24-0001', date: '2026-10-08' }), '');
  assert.deepEqual(plain(date({ device: '24-0001', date: '2026-10-12' })), { text: '在今天之後', warn: true });
  // 新位置下面：撤機時原來那一格還有合約；沒有合約時提醒可以停用；安裝到還沒有合約的位置
  const to = field('moves', 'to').note;
  assert.deepEqual(plain(to({ type: '撤機', device: '24-0001', from: DH, to: WH })), { text: '客戶不租了的話，大華貿易 3F 可以勾停用', warn: false });
  add('contracts', { locations: DH, signDate: '2026-01-05', endDate: '2027-03-15' });
  assert.deepEqual(plain(to({ type: '撤機', device: '24-0001', from: DH, to: WH })),
    { text: '大華貿易 3F 還有合約（到 2027/03/15）\n客戶不租了：合約填提前結束日、位置勾停用', warn: false });
  assert.deepEqual(plain(to({ type: '安裝', device: '25-0001', from: '', to: AX })), { text: '這個位置還沒有合約', warn: true });
  assert.deepEqual(plain(to({ type: '安裝', device: '25-0001', from: '', to: DH })), { text: '這裡現在是 #1001', warn: true });
  // 異動沒有「儲存，再新增一筆」，新位置不留
  assert.equal(field('moves', 'to').keep, undefined);
  assert.equal(Records.disableCheck({ disabled: 'true', code: DH }), '這裡還放著 #1001，先撤機');
});

test('「儲存，再新增一筆」：異動、合約、抄表、翻新沒有（一次一筆）；設備連續新增時，位置是倉庫才留著', () => {
  const { SCHEMAS, field } = withDevices();
  assert.deepEqual(plain(Object.keys(SCHEMAS).filter(k => SCHEMAS[k].once)), ['moves', 'contracts', 'readings', 'refurbs']);
  ['moves', 'contracts', 'readings', 'refurbs'].forEach(k => assert.deepEqual(plain(SCHEMAS[k].fields.filter(x => x.keep)), [], k));
  const keep = field('devices', 'location').keep;
  assert.equal(keep({ location: WH }), true);
  assert.equal(keep({ location: AX }), false);
  assert.equal(keep({ location: '' }), false);
});

test('位置停用：還放著機器的不能停用（先撤機）；空的、本來就停用的照常可以存', () => {
  const { Store, field, d1, d2 } = withDevices();
  const check = field('locations', 'disabled').check;
  Store.update('devices', d2.id, { location: WH });
  assert.equal(check({ disabled: 'true', code: WH }), '這裡還放著 2 台，先撤機');
  Store.update('devices', d1.id, { location: DH });
  assert.equal(check({ disabled: 'true', code: DH }), '這裡還放著 #1001，先撤機');
  assert.equal(check({ disabled: 'true', code: AX }), '');
  assert.equal(check({ disabled: '', code: DH }), '');
  const dh = Store.list('locations').find(p => p.code === DH);
  Store.update('locations', dh.id, { disabled: true });
  assert.equal(check({ id: dh.id, disabled: 'true', code: DH }), '');
});

// ---------- 合約 ----------
test('合約綁位置：一個位置目前的合約是簽約日最新的那一份；機器目前的合約是它所在位置的，換機時不用改', () => {
  const { Store, Records, SCHEMAS, add, d1, d2 } = withDevices();
  const old = add('contracts', { locations: DH, signDate: '2024-01-01', endDate: '2025-12-31', content: '舊合約' });
  const now = add('contracts', { locations: `${DH}、${AX}`, signDate: '2026-01-01', endDate: '2026-10-30', content: '月租 3,000\n含 2,000 張', readDay: '每月 25 日' });
  assert.equal(Records.currentContract(DH).id, now.id);
  assert.equal(Records.currentContract(AX).id, now.id); // 一份合約寫兩個位置
  assert.equal(Records.currentContract(WH), null);
  assert.equal(Records.isCurrentContract(old), false);
  assert.equal(Records.isCurrentContract(now), true);
  assert.deepEqual(plain(Records.contractNote(now)), { text: '剩 19 天到期（2026/10/30）・抄表 每月 25 日', warn: true });
  assert.deepEqual(plain(Records.contractNote(old)), { text: '到期 2025/12/31', warn: false });
  assert.equal(SCHEMAS.contracts.card.title(now), '月租 3,000');
  assert.deepEqual(plain(Records.contractsAt(DH).map(c => c.id)), [old.id, now.id]);
  // 機器：放在大華就是大華的合約；故障換機，新的那台放進大華，直接是同一份
  assert.equal(Records.deviceContract('24-0001'), null); // 在倉庫
  Store.update('devices', d1.id, { location: DH });
  assert.equal(Records.deviceContract('24-0001').id, now.id);
  Store.update('devices', d1.id, { location: WH });
  Store.update('devices', d2.id, { location: DH });
  assert.equal(Records.deviceContract('25-0001').id, now.id);
  // 卡片最上面寫合約的位置；說明寫位置和簽約日
  assert.deepEqual(plain(line(Records, 'contracts', now)), { text: '大華貿易 3F、安心診所 櫃台', warn: false });
  assert.deepEqual(plain(line(Records, 'contracts', { locations: '' })), { text: '沒有填位置', warn: true });
  assert.equal(Records.describe('contracts', now), '大華貿易 3F、安心診所 櫃台 2026/01/01 簽約');
  assert.match(SCHEMAS.contracts.searchText(now), /安心診所 櫃台/);
});

test('合約：目前的合約已經過了到期日；提前結束了就沒有目前的合約', () => {
  const { Records, add } = withDevices();
  const c = add('contracts', { locations: DH, signDate: '2025-01-01', endDate: '2026-09-30' });
  assert.deepEqual(plain(Records.endText(c)), { text: '已到期（2026/09/30）', warn: true });
  const early = add('contracts', { locations: AX, signDate: '2025-01-01', endDate: '2027-12-31', earlyEnd: '2026-06-30' });
  assert.equal(Records.currentContract(AX), null);
  assert.deepEqual(plain(Records.endText(early)), { text: '已提前結束（2026/06/30）', warn: false });
  const later = add('contracts', { locations: WH, signDate: '2025-01-01', endDate: '2027-12-31', earlyEnd: '2026-12-31' });
  assert.equal(Records.currentContract(WH).id, later.id); // 還沒到提前結束那天
  assert.deepEqual(plain(Records.endText(later)), { text: '提前結束（2026/12/31）', warn: false });
});

test('合約：「重新簽約」新增一份，帶入位置、內容、計費方式、抄表日期；改了什麼記在修改紀錄，刪掉合約時一起刪', () => {
  const { Store, Records, SCHEMAS, add } = withDevices();
  const s = SCHEMAS.contracts;
  assert.deepEqual(plain(s.copy.keys), ['locations', 'content', 'billing', 'readDay']);
  assert.deepEqual(plain(s.copy.watch), ['locations', 'signDate', 'endDate', 'billing']);
  assert.deepEqual(plain(s.fields.map(f => f.label)), ['位置', '簽約日', '到期日', '提前結束日', '合約內容', '計費方式', '抄表日期']);
  const c = add('contracts', { locations: DH, signDate: '2026-01-05', endDate: '2028-12-31', readDay: '每月 25 號', billing: '每張 0.4' });
  // 新增時不記
  assert.deepEqual(plain(s.afterSave(null, c)), []);
  const before = { ...c };
  Store.update('contracts', c.id, { readDay: '每月 5 號', locations: `${DH}、${AX}` });
  const logged = s.afterSave(before, Store.get('contracts', c.id));
  assert.equal(logged.length, 2);
  assert.deepEqual(plain(s.history(c)), [
    { date: '2026-10-11', text: '位置：大華貿易 3F → 大華貿易 3F、安心診所 櫃台' },
    { date: '2026-10-11', text: '抄表日期：每月 25 號 → 每月 5 號' },
  ]);
  // 日期寫成 2026/10/11、空白寫（空白）
  const b2 = { ...Store.get('contracts', c.id) };
  Store.update('contracts', c.id, { endDate: null });
  s.afterSave(b2, Store.get('contracts', c.id));
  assert.equal(s.history(c).at(-1).text, '到期日：2028/12/31 → （空白）'); // 舊到新
  const log = Store.list('contractLog').find(r => r.field === '到期日');
  assert.deepEqual(plain([log.contract, log.before, log.after]), [c.id, '2028/12/31', '']);
  // 沒改：不記
  assert.deepEqual(plain(Records.logContract(Store.get('contracts', c.id), Store.get('contracts', c.id))), []);
  // 刪掉合約：修改紀錄一起刪
  Store.remove('contracts', c.id);
  s.afterRemove(c);
  assert.equal(Store.list('contractLog').length, 0);
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

test('抄表：同一天好幾筆（自動抄表一天寄好幾封）照張數排，不照 id 的先後；表單新增時同一天的還是都算之前', () => {
  const { Records, add } = withDevices();
  add('readings', { device: '24-0001', date: '2026-10-01', bw: 122000, color: 2800, month: '2026-09' });
  // 同一次同步補上的 id：先後和寄的先後相反
  const c = add('readings', { id: 'm1', device: '24-0001', date: '2026-10-20', bw: 122962, color: 2862 });
  const b = add('readings', { id: 'm2', device: '24-0001', date: '2026-10-20', bw: 122961, color: 2862 });
  const a = add('readings', { id: 'm3', device: '24-0001', date: '2026-10-20', bw: 122957, color: 2862 });
  assert.deepEqual(plain(Records.usageNote(a)), { text: '本期 黑白 957・彩色 62', warn: false });
  assert.deepEqual(plain(Records.usageNote(b)), { text: '本期 黑白 4・彩色 0', warn: false });
  assert.deepEqual(plain(Records.usageNote(c)), { text: '本期 黑白 1・彩色 0', warn: false });
  assert.equal(Records.countNote({ ...b, bw: '122961' }, 'bw'), '上次 122,957（10/20）\n本期 4');
  // 新增：同一天的都算之前，打得比較少就提醒
  assert.deepEqual(plain(Records.countNote({ device: '24-0001', date: '2026-10-20', bw: '122950', id: null }, 'bw')),
    { text: '上次 122,962（10/20）\n比上次少', warn: true });
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

test('抄表的結算月份：自己選、不預設，空白是安裝當天的起點（不算帳）；同一台同一個月抄兩次時提醒（還是可以存）；列表依結算月份分組、卡片寫哪天抄的', () => {
  const { Records, SCHEMAS, add, field } = withDevices();
  const f = field('readings', 'month');
  assert.equal(f.type, 'month');
  assert.equal(f.optional, true); // 安裝當天的起點可以空白
  assert.equal(f.default, undefined);  // 不預設
  assert.equal(f.keep, undefined);
  const r1 = add('readings', { device: '24-0001', date: '2026-10-03', month: '2026-09', bw: 1000 });
  const r2 = add('readings', { device: '24-0001', date: '2026-10-28', month: '2026-10', bw: 1500 });
  assert.deepEqual(plain(f.note({ device: '24-0001', month: '2026-09', id: null })), { text: '這個月已經抄過了（10/03）', warn: true });
  assert.equal(f.note({ device: '24-0001', month: '2026-09', id: r1.id }), ''); // 編輯自己那筆
  assert.equal(f.note({ device: '25-0001', month: '2026-09', id: null }), '');  // 別台
  assert.equal(f.note({ device: '24-0001', month: '', id: null }), '空白＝不算帳'); // 還沒填日期
  assert.equal(f.note({ device: '24-0001', date: '2026-11-15', month: '', id: null }), '空白＝順便抄，不算帳');
  assert.equal(f.note({ device: '25-0001', date: '2026-11-15', month: '', id: null }), '空白＝起點，不算帳');
  assert.deepEqual(plain(SCHEMAS.readings.period),
    { key: 'month', unit: 'month', label: '結算月份', then: 'date', fallback: 'date', emptyHead: '結算月份空白' });
  assert.deepEqual(plain(Records.readingNote(r2)), { text: '2026/10/28 抄・本期 黑白 500', warn: false });
  assert.equal(Records.describe('readings', r1), '#1001 2026/09 抄表');
});

test('結算月份空白：機器放到這個位置後第一次抄的是起點，其他的是順便抄（一期不切開）；換機、換回來；撤機那天空白時提醒', () => {
  const { Records, field, add } = withDevices();
  const note = field('readings', 'month').note;
  const read = (device, date, month, bw) => add('readings', { device, date, month, bw });
  const moved = (device, date, type, from, to) => { add('moves', { device, date, type, from, to }); Records.syncLocations(); };
  // #1001 8/1 裝到大華，9/10 路過順便抄
  moved('24-0001', '2026-08-01', '安裝', WH, DH);
  const a1 = read('24-0001', '2026-08-01', '', 1000);
  read('24-0001', '2026-09-01', '2026-08', 2000);
  const a3 = read('24-0001', '2026-09-10', '', 2500);
  assert.deepEqual(plain(Records.readingNote(a1)), { text: '2026/08/01 抄・起點', warn: false });
  assert.deepEqual(plain(Records.readingNote(a3)), { text: '2026/09/10 抄・順便抄', warn: false });
  // 9/15 換機：#1001 撤機那天的抄表空白時提醒要填；換上去的 #1002 那天抄的是起點
  moved('24-0001', '2026-09-15', '撤機', DH, WH);
  moved('25-0001', '2026-09-15', '安裝', WH, DH);
  assert.deepEqual(plain(note({ device: '24-0001', date: '2026-09-15', month: '', id: null })),
    { text: '撤機前最後一次，要填結算月份，不然這段不算', warn: true });
  assert.equal(note({ device: '25-0001', date: '2026-09-15', month: '', id: null }), '空白＝起點，不算帳');
  read('24-0001', '2026-09-15', '2026-09', 3000);
  read('25-0001', '2026-09-15', '', 500);
  read('25-0001', '2026-10-01', '2026-09', 1300);
  // 11/1 #1001 修好換回來：以前在這裡抄過，換回來那天抄的還是起點
  moved('25-0001', '2026-11-01', '撤機', DH, WH);
  moved('24-0001', '2026-11-01', '安裝', WH, DH);
  read('25-0001', '2026-11-01', '2026-10', 2000);
  const back = read('24-0001', '2026-11-01', '', 3000);
  read('24-0001', '2026-12-01', '2026-11', 3500);
  assert.equal(Records.readingKind(back), '起點');
  // 9 月：#1001 9/1～9/15 的 1,000（不是從順便抄的 2,500 算起）＋ #1002 的 800；放在倉庫那段不算
  assert.deepEqual(plain(Records.placeUsage(DH)).map(p => [p.month, p.months, p.bw]),
    [['2026-08', 1, 1000], ['2026-09', 1, 1800], ['2026-10', 1, 700], ['2026-11', 1, 500]]);
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
  assert.deepEqual(plain(Records.refurbNote(f)), { text: '2026/09/25 入庫・陳志明・日・噴漆・廠商或來源 日本拍賣', warn: false });
  assert.equal(Records.workNote(p), null);
  assert.deepEqual(plain(Records.usageNote(r)), { text: '本期 黑白 600', warn: false });
  assert.equal(Records.describe('maintenance', k), '#1001 2026/09/10 碳粉 K');
  assert.equal(Records.describe('refurbs', f), '#1001 2026/09/20 翻新');
  // 保養只記在哪裡換了哪個：沒有廠商、費用；連續新增時日期留著
  assert.deepEqual(plain(SCHEMAS.maintenance.fields.map(x => x.key)), ['device', 'date', 'item', 'bw', 'color', 'note']);
  assert.deepEqual(plain(SCHEMAS.maintenance.fields.filter(x => x.keep).map(x => x.key)), ['date']);
});

test('翻新：翻新日期、入庫日、工程師（人員）、序號、國別（美／日）、廠商或來源、噴漆；沒有費用、張數', () => {
  const { Store, SCHEMAS, field, d1 } = withDevices();
  assert.deepEqual(plain(SCHEMAS.refurbs.fields.map(x => x.label)),
    ['設備', '翻新日期', '入庫日', '工程師', '序號', '國別', '廠商或來源', '噴漆', '翻新項目', '備註']);
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
  assert.deepEqual(plain(Refs.items(f).map(r => r.name)).sort(), ['加熱組', '廢粉盒', '感光鼓', '清潔保養', '碳粉 C', '碳粉 K', '碳粉 M', '碳粉 Y'].sort());
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
  assert.deepEqual(plain(Refs.items(f).map(r => r.code)), ['25-0001', '24-0001']); // 依選單上寫的字排（位置、還沒填位置的寫名稱）
  assert.equal(Refs.targetOf('devices').label(d1), '公司倉庫');
  assert.equal(Refs.targetOf('devices').label(d2), '#1002'); // 還沒填位置的顯示機型＋名稱
  assert.equal(Refs.sub('devices', d1), '#1001 · 3101R800451'); // 選單的小字有序號，打序號也找得到
  assert.equal(Refs.find(f, '24-0001').id, d1.id);
  add('moves', { device: '24-0001', date: '2026-03-01', type: '安裝', from: WH, to: DH });
  add('readings', { device: '24-0001', date: '2026-03-25', bw: 100 });
  add('readings', { device: '99-0001', date: '2026-03-25', bw: 100 }); // 打錯的編號
  assert.equal(Refs.usesText('devices', d1), '1 筆異動、1 筆抄表');
  assert.deepEqual(plain(Refs.missing()), []);
  assert.deepEqual(plain(Records.orphans().map(o => [o.table, o.rec.device])), [['readings', '99-0001']]);
  assert.deepEqual(plain(line(Records, 'readings', { device: '99-0001' })), { text: '99-0001：找不到這台設備', warn: true });
  assert.deepEqual(plain(line(Records, 'moves', { device: '24-0001' })), { text: '#1001', warn: false });
  // 卡片上寫那時候在哪裡：3/1 安裝到大華之前在公司倉庫
  assert.deepEqual(plain(line(Records, 'readings', { device: '24-0001', date: '2026-03-25' })), { text: '大華貿易 3F · #1001', warn: false });
  assert.deepEqual(plain(line(Records, 'readings', { device: '24-0001', date: '2026-02-01' })), { text: '公司倉庫 · #1001', warn: false });
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

test('機型的世代：照型號猜（IM C、C xx04…、黑白 MP），清單裡填的優先；總覽依世代分組、寫小計，猜不到的放「其他」排最後', () => {
  const { Records, add, field } = withDevices();
  const guess = Records.guessGen;
  assert.deepEqual(['IMC6000', 'IM C4500', 'IMC300', 'C6004EX', 'MP C3504', 'C3503', 'C2503', 'MPC4501', 'C5501', 'C3300', 'C5000', 'MP5055', 'MP4000B', '借機']
    .map(guess), ['IM C', 'IM C', 'IM C', 'C xx04', 'C xx04', 'C xx03', 'C xx03', 'C xx01', 'C xx01', 'C xx00', 'C xx00', '黑白 MP', '黑白 MP', '']);
  // 機型表單：世代只有機型有；空白時寫會怎麼算
  const gen = field('options', 'gen');
  assert.equal(gen.showIf({ list: '機型' }), true);
  assert.equal(gen.showIf({ list: '品牌' }), false);
  assert.equal(Records.genNote({ name: 'IMC6000', gen: '' }), '空白時照型號算：IM C');
  assert.equal(Records.genNote({ name: '借機', gen: '' }), '空白時放在「其他」');
  assert.equal(Records.genNote({ name: '借機', gen: '其他' }), '');
  // 分組：照機型清單的順序；清單裡填了世代的照填的
  ['IMC6000', 'C4501', '借機', 'C3504', 'IMC4500'].forEach((name, i) => add('options', { list: '機型', name, order: i + 1 }));
  add('options', { list: '機型', name: 'C3503', order: 6, gen: 'C xx04' }); // 自己歸到 xx04
  const dev = (code, model) => add('devices', { code, name: code, status: '出租中', model });
  dev('26-0001', 'IMC6000'); dev('26-0002', 'IMC6000'); dev('26-0003', 'C4501'); dev('26-0004', '借機');
  dev('26-0005', 'C3504'); dev('26-0006', 'IMC4500'); dev('26-0007', 'C3503');
  const groups = Records.modelGroups('出租中');
  assert.deepEqual(plain(groups.map(g => [g.gen, g.count, g.rows.map(r => r.model || '未填')])), [
    ['IM C', 3, ['IMC6000', 'IMC4500']],
    ['C xx01', 1, ['C4501']],
    ['C xx04', 2, ['C3504', 'C3503']],
    ['其他', 2, ['借機', '未填']], // withDevices 的 24-0001 出租中、沒填機型
  ]);
});

test('位置的用量：以一期算（兩次抄表之間），每月抄、一季抄都比每月平均；換機那個月兩台加起來；第一次抄表不算', () => {
  const { Records, Refs, add } = withDevices(); // 今天 2026-10-11
  // 大華每月抄：#1001 3/1 裝進去、7/1 換成 #1002
  add('moves', { device: '24-0001', date: '2026-03-01', type: '安裝', from: WH, to: DH });
  add('moves', { device: '24-0001', date: '2026-07-01', type: '撤機', from: DH, to: WH });
  add('moves', { device: '25-0001', date: '2026-07-01', type: '安裝', from: WH, to: DH });
  const read = (device, date, month, bw, color) => add('readings', { device, date, month, bw, color });
  read('24-0001', '2026-03-01', '2026-02', 1000, 100); // 安裝當天：起點，不算用量
  read('24-0001', '2026-04-01', '2026-03', 3000, 300);
  read('24-0001', '2026-05-01', '2026-04', 5000, 500);
  read('24-0001', '2026-07-01', '2026-06', 9000, 900); // 5 月漏抄：這一期兩個月
  read('25-0001', '2026-07-01', '2026-06', 200, 0);    // 換上去的那台：起點
  read('25-0001', '2026-08-01', '2026-07', 2200, 50);
  // 中間保養填的張數不分段（整期才不會少算）
  add('maintenance', { device: '25-0001', date: '2026-08-20', item: '碳粉 K', bw: 3000, color: 60 });
  read('25-0001', '2026-09-01', '2026-08', 4400, 100);
  const dh = plain(Records.placeUsage(DH));
  assert.deepEqual(dh.map(p => [p.month, p.months, p.bw, p.color, p.total]), [
    ['2026-03', 1, 2000, 200, 2200],
    ['2026-04', 1, 2000, 200, 2200],
    ['2026-06', 2, 4000, 400, 4400],
    ['2026-07', 1, 2000, 50, 2050],
    ['2026-08', 1, 2200, 50, 2250],
  ]);
  // 卡片：最近一期、和前一期比每月平均
  const s = Records.usageSummary(Records.placeUsage(DH));
  assert.equal(s.label, '8 月');
  assert.equal(s.total, 2250);
  assert.equal(Math.round(s.change * 100), 10); // 2250 比 2050
  // 一季抄一次：寫幾月到幾月、每月平均；跟前一季比每月平均
  add('moves', { device: '24-0001', date: '2026-07-02', type: '安裝', from: WH, to: AX });
  read('24-0001', '2026-07-02', '2026-06', 9000, 900);
  read('24-0001', '2026-10-01', '2026-09', 18000, 900);
  const ax = Records.usageSummary(Records.placeUsage(AX));
  assert.deepEqual(plain(ax), { label: '7–9 月', months: 3, total: 9000, perMonth: 3000, bw: 9000, color: 0, change: null });
  assert.equal(Records.usageSummary([]), null);
  assert.deepEqual(plain(Records.placeUsage('L0099')), []);
  // 合約：已到期、剩幾天、到哪天、提前結束、沒有到期日
  const short = c => plain(Records.contractShort(c));
  assert.deepEqual(short({ endDate: '2026-09-30' }), { text: '已到期', sub: '2026/09/30', warn: true });
  assert.deepEqual(short({ endDate: '2026-11-05' }), { text: '剩 25 天', sub: '2026/11/05', warn: true });
  assert.deepEqual(short({ endDate: '2027-12-31' }), { text: '到 2027/12/31', sub: '', warn: false });
  assert.deepEqual(short({ endDate: '2027-12-31', earlyEnd: '2026-12-31' }), { text: '提前結束', sub: '2026/12/31', warn: false });
  assert.deepEqual(short({}), { text: '沒有到期日', sub: '', warn: false });
  assert.equal(Records.contractShort(null), null);
  // 每個位置目前的合約（一次算好）：和 currentContract 一樣
  const old = add('contracts', { locations: DH, signDate: '2024-01-01', endDate: '2025-12-31' });
  const now = add('contracts', { locations: `${DH}、${AX}`, signDate: '2026-01-01', endDate: '2028-12-31' });
  add('contracts', { locations: WH, signDate: '2026-01-01', earlyEnd: '2026-02-01' });
  const map = Records.currentContracts(); // 位置編號（大小寫、全形半形不同也認得）→ 合約
  const at = code => map.get(Refs.norm(code));
  assert.equal(at(DH).id, now.id);
  assert.equal(at(AX).id, now.id);
  assert.equal(at(WH), undefined);
  assert.notEqual(at(DH).id, old.id);
});

test('位置詳情的用量：最近 12 個月一個月一條（一季抄的三個月一樣高、沒抄到的空著）；比去年同期', () => {
  const { Records } = withDevices();
  const P = (month, months, bw, color) => ({ month, months, bw, color, total: (bw || 0) + (color || 0) });
  // 2025/10–2026/09：每月抄，2026/04–06 改成一季抄（6 月那期 3 個月），2025/12 漏抄（2026/01 那期 2 個月）
  const periods = [
    P('2025-09', 1, 1000, 100), P('2025-10', 1, 1100, 100), P('2025-11', 1, 1200, 100),
    P('2026-01', 2, 2000, 200), P('2026-02', 1, 900, 100), P('2026-03', 1, 1000, 100),
    P('2026-06', 3, 3600, 300), P('2026-07', 1, 1300, 100), P('2026-09', 2, 2200, 200),
  ];
  const m = Records.monthlyUsage(periods);
  assert.equal(m.length, 12);
  assert.equal(m[0].month, '2025-10');
  assert.equal(m.at(-1).month, '2026-09');
  const at = k => m.find(x => x.month === k);
  assert.deepEqual(plain(at('2026-04')), { month: '2026-04', bw: 1200, color: 100, total: 1300 }); // 一季的每月平均
  assert.deepEqual(plain(at('2026-05')), plain({ ...at('2026-04'), month: '2026-05' }));
  assert.equal(at('2025-12').total, 1100); // 漏抄：和 1 月平分
  assert.equal(at('2026-08').total, 1200); // 9 月那期 2 個月
  assert.deepEqual(plain(Records.monthlyUsage([])), []);
  // 比去年同期：9 月那期（8、9 月）每月 1,200，去年 8、9 月沒有完整的抄表 → 不比
  assert.equal(Records.yearOverYear(periods), null);
  // 去年 8 月也有：每月 1,100 → 漲 9%
  const withAgo = [P('2025-08', 1, 1000, 100), ...periods];
  assert.equal(Math.round(Records.yearOverYear(withAgo) * 100), 9);
  assert.equal(Records.yearOverYear([]), null);
});

test('安裝、撤機存好後接著抄表：機器和日期帶好；安裝那筆的結算月份空白只當起點；位置寫那天在哪裡', () => {
  const { Records, SCHEMAS, field, add } = withDevices();
  const next = SCHEMAS.moves.next;
  assert.deepEqual(plain(next({ type: '安裝', device: '24-0001', date: '2026-10-06' })), {
    table: 'readings', preset: { device: '24-0001', date: '2026-10-06' },
    message: '已存好安裝。接著抄表：這天的張數是起點，結算月份可以空白',
  });
  assert.equal(next({ type: '撤機', device: '24-0001', date: '2026-10-06' }).message, '已存好撤機。接著抄表：最後一次，填這次要結帳的結算月份');
  assert.equal(next({ type: '移機', device: '24-0001', date: '2026-10-06' }), null);
  assert.equal(next({ type: '其他', device: '24-0001', date: '2026-10-06' }), null);
  // 安裝當天的起點（沒有結算月份）不算一期，下一次抄表的用量從它算起
  add('moves', { device: '24-0001', date: '2026-10-06', type: '安裝', from: WH, to: DH });
  Records.syncLocations();
  add('readings', { device: '24-0001', date: '2026-10-06', month: '', bw: 1000, color: 100 });
  add('readings', { device: '24-0001', date: '2026-11-05', month: '2026-10', bw: 3000, color: 400 });
  assert.deepEqual(plain(Records.placeUsage(DH)).map(p => [p.month, p.months, p.bw, p.color]), [['2026-10', 1, 2000, 300]]);
  // 抄表表單的位置寫那天機器在哪裡：撤機那天抄的是原來的客戶
  add('moves', { device: '24-0001', date: '2026-12-01', type: '撤機', from: DH, to: WH });
  Records.syncLocations();
  const shown = field('readings', 'device').shown;
  assert.equal(shown({ device: '24-0001', date: '2026-12-01' }), '大華貿易 3F');
  assert.equal(shown({ device: '24-0001', date: '2026-12-02' }), '公司倉庫');
  assert.equal(shown({ device: '24-0001', date: '' }), '');
});

test('耗材：安裝那天當新的、每次換之間印幾張的平均、已用幾 %、預估哪天到；有設定壽命的用設定的；快到了列在要處理', () => {
  const { Store, Records, add } = withDevices(); // 今天 2026-10-11
  add('moves', { device: '24-0001', date: '2026-06-01', type: '安裝', from: WH, to: DH });
  Records.syncLocations();
  const read = (date, month, bw) => add('readings', { device: '24-0001', date, month, bw, color: 0 });
  read('2026-06-01', '', 100000); // 安裝當天的起點
  read('2026-07-01', '2026-06', 104000);
  read('2026-08-01', '2026-07', 108000);
  read('2026-09-01', '2026-08', 112000);
  read('2026-10-01', '2026-09', 116000);
  add('maintenance', { device: '24-0001', date: '2026-07-16', item: '碳粉 K', bw: 106000, color: 0 }); // 安裝到這次：6,000 張
  add('maintenance', { device: '24-0001', date: '2026-09-16', item: '碳粉 K' }); // 沒填張數：前後兩次抄表推算 114,000
  const k = Records.consumablesAt(DH).find(x => x.item === '碳粉 K');
  assert.equal(k.kind, 'total');
  assert.equal(k.avg, 7000); // (6,000 + 8,000) / 2
  assert.equal(k.life, 7000);
  assert.equal(k.lifeSet, false);
  assert.equal(k.count, 2);
  assert.deepEqual(plain(k.start), { date: '2026-09-16', install: false });
  assert.equal(k.used, 2000);
  assert.equal(k.approx, true);
  assert.equal(Math.round(k.pct * 100), 29);
  assert.equal(k.eta, '2026-11-07'); // 15 天印 2,000 張，剩 5,000 張
  assert.equal(k.soon, false);
  assert.equal(Records.etaText(k.eta), '2026/11 上旬');
  // 感光鼓：預設壽命 10 萬（設定的），沒換過，從安裝算起
  const drum = () => Records.consumablesAt(DH).find(x => x.item === '感光鼓');
  assert.equal(drum().lifeSet, true);
  assert.equal(drum().life, 100000);
  assert.equal(drum().used, 16000);
  assert.equal(drum().soon, false);
  // 壽命改成 17,000：一週多就到了，列在要處理；改成 15,000：已經超過
  const opt = Store.list('options').find(o => o.list === '保養項目' && o.name === '感光鼓');
  Store.update('options', opt.id, { life: 17000 });
  assert.equal(drum().soon, true);
  assert.deepEqual(plain(Records.consumablesDue().map(x => [x.place.code, x.item, x.over])), [[DH, '感光鼓', false]]);
  Store.update('options', opt.id, { life: 15000 });
  assert.equal(drum().over, true);
  // 沒換過、也沒設定壽命的不列；倉庫不算
  assert.equal(Records.consumablesAt(DH).some(x => x.item === '廢粉盒'), false);
  assert.deepEqual(plain(Records.consumablesAt(WH)), []);
  // 算哪種張數：碳粉 C、M、Y 只算彩色，保養項目設定的優先
  assert.equal(Records.itemKind('碳粉 C', {}), 'color');
  assert.equal(Records.itemKind('碳粉 K', {}), 'total');
  assert.equal(Records.itemKind('感光鼓', { pages: '彩色' }), 'color');
  assert.equal(Records.pagesNote({ name: '碳粉 Y', pages: '' }), '空白時照名稱：只算彩色');
  // 保養表單：上次換到現在印了幾張，比平均少很多時提醒
  assert.deepEqual(plain(Records.itemNote({ device: '24-0001', item: '碳粉 K', date: '2026-10-10', bw: '', color: '' })),
    { text: '上次換 09/16，約 2,000 張\n比平均 7,000 少很多', warn: true });
  assert.equal(Records.itemNote({ device: '24-0001', item: '碳粉 K', date: '2026-10-10', bw: '120000', color: '0' }),
    '上次換 09/16\n到現在約 6,000 張');
  assert.equal(Records.itemNote({ device: '24-0001', item: '碳粉 C', date: '2026-10-10' }), '');
});

test('要處理：合約到期、快到期（重新簽約、提前結束、位置停用了就不算），保固 30 天內到期（報廢的不算），空著的位置', () => {
  const { Store, Records, add, d1, d2 } = withDevices(); // 今天 2026-10-11
  const ids = list => plain(list.map(r => r.id));
  // 合約：已到期、30 天內、還早、沒有到期日
  const late = add('contracts', { locations: DH, signDate: '2024-01-01', endDate: '2026-09-30' });
  const soon = add('contracts', { locations: AX, signDate: '2025-01-01', endDate: '2026-11-05' });
  add('contracts', { locations: 'L0009', signDate: '2025-01-01', endDate: '2027-12-31' });
  add('contracts', { locations: 'L0010', signDate: '2025-01-01' });
  assert.deepEqual(ids(Records.contractsDue()), [late.id, soon.id]); // 依到期日
  // 大華重新簽約：舊的不是目前的合約了
  add('contracts', { locations: DH, signDate: '2026-10-01', endDate: '2029-09-30' });
  assert.deepEqual(ids(Records.contractsDue()), [soon.id]);
  // 安心填了提前結束日（已經過了）：沒有目前的合約
  Store.update('contracts', soon.id, { earlyEnd: '2026-10-01' });
  assert.deepEqual(ids(Records.contractsDue()), []);
  // 位置都停用了（客戶走了）的不算
  const gone = add('locations', { code: 'L0011', name: '舊客戶', disabled: true });
  add('contracts', { locations: gone.code, signDate: '2024-01-01', endDate: '2026-01-31' });
  assert.deepEqual(ids(Records.contractsDue()), []);
  // 保固：30 天內（今天到期也算）、過了不列、報廢不列；依到期日
  Store.update('devices', d1.id, { warranty: '2026-11-10' });
  Store.update('devices', d2.id, { warranty: '2026-10-11' });
  const d3 = add('devices', { code: '26-0001', name: '#1003', status: '報廢', warranty: '2026-10-20' });
  add('devices', { code: '26-0002', name: '#1004', status: '出租中', warranty: '2026-10-10' });
  add('devices', { code: '26-0003', name: '#1005', status: '出租中', warranty: '2026-11-11' });
  assert.deepEqual(ids(Records.warrantyDue()), [d2.id, d1.id]);
  assert.ok(!Records.warrantyDue().some(d => d.id === d3.id));
  // 空著的位置：不是倉庫、沒停用、沒放機器（24-0001 在公司倉庫，25-0001 沒有位置）
  assert.deepEqual(plain(Records.emptyPlaces().map(p => p.code)).sort(), [AX, DH].sort());
  Store.update('devices', d2.id, { location: AX });
  assert.deepEqual(plain(Records.emptyPlaces().map(p => p.code)), [DH]);
  // 進出這個位置的最後一筆異動
  add('moves', { device: '24-0001', date: '2026-03-01', type: '安裝', from: WH, to: DH });
  const out = add('moves', { device: '24-0001', date: '2026-06-30', type: '撤機', from: DH, to: WH });
  assert.equal(Records.lastMoveAt(DH).id, out.id);
  assert.equal(Records.lastMoveAt(AX), null);
});

test('設備：編號不顯示，認機器看機型＋名稱；名稱下面寫序號；同機型同名稱時提醒；列表照機型清單的順序', () => {
  const { Store, SCHEMAS, Records, field, add } = withDevices();
  const s = SCHEMAS.devices;
  assert.equal(s.card.code, undefined);
  assert.deepEqual(plain(s.card.grid), ['location', 'keeper']); // 機型寫在標題，不另外一格
  assert.equal(field('devices', 'code').hidden, true);
  assert.equal(field('devices', 'code').auto !== undefined, true); // 系統還是會給編號
  const a = add('devices', { code: '26-0011', name: '#1234', model: 'IMC4500', serial: '3101R800999', status: '出租中' });
  assert.equal(s.card.title(a), 'IMC4500 #1234');
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

test('紀錄分頁卡片最上面一行：位置 · 機型 名稱（不寫序號），保養、抄表寫那時候的位置；異動只寫機器', () => {
  const { Records, add } = withDevices();
  add('moves', { device: '24-0001', date: '2025-03-05', type: '安裝', from: WH, to: DH });
  add('moves', { device: '24-0001', date: '2026-04-01', type: '移機', from: DH, to: AX });
  const m = add('maintenance', { device: '24-0001', date: '2025-08-01', item: '碳粉 K' });
  const r = add('readings', { device: '24-0001', date: '2026-09-25', month: '2026-09', bw: 1 });
  const mv = add('moves', { device: '24-0001', date: '2026-04-01', type: '其他', to: AX });
  assert.deepEqual(plain(line(Records, 'maintenance', m)), { text: '大華貿易 3F · #1001', warn: false });
  assert.deepEqual(plain(line(Records, 'readings', r)), { text: '安心診所 櫃台 · #1001', warn: false });
  assert.deepEqual(plain(line(Records, 'moves', mv)), { text: '#1001', warn: false });
  assert.deepEqual(plain(line(Records, 'readings', { device: '99-0001' })), { text: '99-0001：找不到這台設備', warn: true });
});

// ---------- 位置換成編號、舊資料轉換 ----------
test('舊資料轉換：選項裡的位置清單 → 位置表；設備、異動寫名字的 → 編號；合約的設備 → 合約期間那台機器所在的位置；做過就不會再做', () => {
  const a = app();
  const { Store, Records } = a;
  a.add('options', { list: '位置', name: '公司倉庫', disabled: false });
  a.add('options', { list: '位置', name: '大華貿易 3F', disabled: false });
  a.add('options', { list: '位置', name: '舊點', disabled: true });
  a.add('options', { list: '品牌', name: 'Ricoh' });
  const d = a.add('devices', { code: '24-0001', name: '#1001', location: '安心診所 櫃台' }); // 不在清單裡的也建一個
  const m1 = a.add('moves', { device: '24-0001', date: '2025-03-05', type: '安裝', from: '公司倉庫', to: '大華貿易 3F' });
  const m2 = a.add('moves', { device: '24-0001', date: '2026-04-01', type: '移機', from: '大華貿易 3F', to: '安心診所 櫃台' });
  const old = Store.add('contracts', { device: '24-0001', signDate: '2025-03-01', endDate: '2026-03-31' }); // 簽約時還在倉庫
  const now = Store.add('contracts', { device: '24-0001', signDate: '2026-03-28', endDate: '2028-03-31' });
  assert.equal(Records.upgrade(), true);
  assert.deepEqual(plain(Store.list('locations').map(p => [p.code, p.name, !!p.stock, !!p.disabled])), [
    ['L0001', '公司倉庫', true, false],
    ['L0002', '大華貿易 3F', false, false],
    ['L0003', '舊點', false, true],
    ['L0004', '安心診所 櫃台', false, false],
  ]);
  assert.deepEqual(plain(Store.list('options').filter(o => o.list === '位置')), []);
  assert.equal(Store.list('options').filter(o => o.list === '品牌').length, 1);
  assert.equal(Store.get('devices', d.id).location, 'L0004');
  assert.deepEqual(plain([Store.get('moves', m1.id).from, Store.get('moves', m1.id).to, Store.get('moves', m2.id).to]), ['L0001', 'L0002', 'L0004']);
  assert.equal(Store.get('contracts', old.id).locations, 'L0002'); // 合約期間在大華（不是簽約那天的倉庫）
  assert.equal(Store.get('contracts', now.id).locations, 'L0004');
  assert.equal(Store.get('contracts', now.id).device, undefined);
  assert.equal(Records.upgrade(), false);
});

test('試算表裡打了位置的名字：換成編號（以前的名字也認得），沒有的建一個；打錯的編號提醒找不到', () => {
  const { Store, Records, add } = withDevices();
  const dh = Store.list('locations').find(p => p.code === DH);
  Store.update('locations', dh.id, { oldNames: '大華舊名（到 2026/01/01）' });
  const m1 = add('moves', { device: '24-0001', date: '2026-03-01', type: '安裝', from: '公司倉庫', to: '大華舊名' });
  const m2 = add('moves', { device: '24-0001', date: '2026-04-01', type: '移機', from: DH, to: '新客戶 1F' });
  const c = add('contracts', { locations: '安心診所 櫃台、L0099', signDate: '2026-01-01' });
  const changed = plain(Records.fixPlaceRefs());
  const made = Store.list('locations').find(p => p.name === '新客戶 1F');
  assert.equal(made.code, 'L0004');
  assert.deepEqual(changed.map(x => x.table).sort(), ['contracts', 'locations', 'moves', 'moves']);
  assert.deepEqual(plain([Store.get('moves', m1.id).from, Store.get('moves', m1.id).to, Store.get('moves', m2.id).to]), [WH, DH, 'L0004']);
  assert.equal(Store.get('contracts', c.id).locations, `${AX}、L0099`);
  assert.deepEqual(plain(Records.lostPlaces().map(x => [x.table, x.value])), [['contracts', 'L0099']]);
  assert.deepEqual(plain(Records.fixPlaceRefs()), []);
});

test('位置編號重複換號：這台裝置上新增的異動、合約跟著這台裝置上新增的位置', () => {
  const { Store, Records, add } = withDevices();
  add('locations', { id: 'p1', code: 'L0004', name: '別台裝置新增的' });
  add('locations', { id: 'p2', code: 'L0004', name: '這台新增的' });
  add('moves', { id: 'mv', device: '24-0001', date: '2026-10-01', type: '安裝', from: WH, to: 'L0004' });
  add('contracts', { id: 'c1', locations: `${DH}、L0004`, signDate: '2026-10-01' });
  add('contracts', { id: 'c2', locations: 'L0004', signDate: '2026-10-01' }); // 試算表讀回來的，留在沒換號的那個
  const local = new Set(['locations:p2', 'moves:mv', 'contracts:c1']);
  Store.update('locations', 'p2', { code: 'L0005' });
  const out = plain(Records.followCodes([{ id: 'p2', from: 'L0004', to: 'L0005' }], (t, id) => local.has(`${t}:${id}`), 'locations'));
  assert.deepEqual(out, [{ table: 'moves', id: 'mv' }, { table: 'contracts', id: 'c1' }]);
  assert.equal(Store.get('moves', 'mv').to, 'L0005');
  assert.equal(Store.get('contracts', 'c1').locations, `${DH}、L0005`);
  assert.equal(Store.get('contracts', 'c2').locations, 'L0004');
});

test('紀錄卡片下面那一排：和設備卡片一樣小標題在上（位置｜設備，設備寫機型＋名稱），異動沒有位置，合約只有位置', () => {
  const { Records, Store, add, d1 } = withDevices();
  Store.update('devices', d1.id, { model: 'IMC4500' });
  const m = add('maintenance', { device: '24-0001', date: '2026-09-10', item: '碳粉 K' });
  const mv = add('moves', { device: '24-0001', date: '2026-09-01', type: '其他', to: Store.list('devices')[0].location });
  assert.deepEqual(plain(Records.recordCells('maintenance', m).map(c => [c.label, c.value])), [['位置', Records.placeName(Store.get('devices', d1.id).location)], ['設備', 'IMC4500 #1001']]);
  assert.deepEqual(plain(Records.recordCells('moves', mv).map(c => [c.label, c.value])), [['設備', 'IMC4500 #1001']]);
  assert.deepEqual(plain(Records.recordCells('contracts', { locations: '' })), [{ label: '位置', value: '沒有填位置', warn: true }]);
});

test('匯入 data.json、以 Google 為主：用 id 比對，只加這台沒有的；清單（狀態、選項）裡同名的不加', () => {
  const { Store, Records, add } = app();
  const s = Store.list('statuses')[0];
  add('options', { list: '類別', name: '投影機' });
  const parsed = Store.parseImport({
    devices: [{ id: 'd1', name: '筆電' }],
    statuses: [{ ...s, color: '紅' }, { id: 'x1', name: s.name }, { id: 'x2', name: '外借' }],
    options: [{ id: 'x3', list: '類別', name: ' 投影機 ' }, { id: 'x4', list: '品牌', name: '投影機' }, { id: 'x5', list: '品牌', name: '投影機' }],
  });
  const extra = Records.fileOnly(parsed);
  assert.deepEqual(plain(extra.map(o => `${o.table}:${o.rec.id}`)), ['devices:d1', 'statuses:x2', 'options:x4']);
  Store.addAll(extra);
  assert.equal(Store.get('statuses', s.id).color, s.color); // 同一個 id 的照這台的
  assert.equal(Store.pendingCount(), 4); // 加進來的要寫回試算表（還有前面新增的投影機）
});

test('最新回報：設備卡片序號那一行的右邊寫多久以前（今天、昨天寫時間），3 天內綠字、超過 30 天橘字；不寫碳粉；沒回報過的不寫', () => {
  const { Records, Store } = app({ today: '2026-10-21' });
  const at = (date, more = {}) => [{ serial: ' a1 ', device: '', date, time: '08:30', K: 80, Y: null, M: null, C: null, ...more }];
  const d = { serial: 'A1', code: '26-0001' };
  assert.deepEqual(plain(Records.reportNote(d, at('2026-10-21', { Y: 15, M: 60, C: 10 }))), { text: '今天 08:30', tone: 'fresh' });
  assert.deepEqual(plain(Records.reportNote(d, at('2026-10-20'))), { text: '昨天 08:30', tone: 'fresh' });
  assert.equal(Records.reportNote(d, at('2026-10-18')).text, '3 天前');
  assert.equal(Records.reportNote(d, at('2026-10-18')).tone, 'fresh');
  assert.deepEqual(plain(Records.reportNote(d, at('2026-10-17'))), { text: '4 天前', tone: '' });
  assert.equal(Records.reportNote(d, at('2026-09-21')).tone, ''); // 30 天
  assert.deepEqual(plain(Records.reportNote(d, at('2026-09-20'))), { text: '31 天前', tone: 'old' });
  assert.equal(Records.reportNote(d, at('')), null);
  assert.equal(Records.reportNote(d, []), null);
  // 沒有序號的用設備編號找
  assert.equal(Records.reportNote({ serial: '', code: '26-0002' }, [{ serial: 'X9', device: '26-0002', date: '2026-10-21', time: '' }]).text, '今天');
  assert.equal(Records.reportWhen(at('2026-10-20')[0]), '2026/10/20 08:30・昨天');
  // 沒連結 Google 時用匯入的 data.json 裡的
  Store.replaceAll(Store.parseImport({ devices: [], toner: at('2026-10-21') }));
  assert.equal(Records.reportNote(d).text, '今天 08:30');
});
