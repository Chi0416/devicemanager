// 資料存放的測試：node --test tests/*.test.mjs
//   IndexedDB：第一次打開把 localStorage 的舊資料搬過去、之後從 IndexedDB 讀、一次動作只存一次、登出清掉、打不開時的處理
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const plain = v => JSON.parse(JSON.stringify(v));

// 假的 IndexedDB：一張表，內容放在 box（關掉 App 再打開用同一個 box）；puts 記存了幾次（一次交易算一次）
function fakeIdb(box = {}, { fail = false } = {}) {
  const stats = { puts: 0 };
  const later = fn => setTimeout(fn, 0);
  const request = get => {
    const req = {};
    later(() => { req.result = get(); req.onsuccess?.(); });
    return req;
  };
  const db = {
    createObjectStore() {},
    transaction(_, mode) {
      const tx = {};
      let wrote = false;
      tx.objectStore = () => ({
        get: k => request(() => (k in box ? structuredClone(box[k]) : undefined)),
        put: (v, k) => { box[k] = structuredClone(v); wrote = true; return request(() => k); },
      });
      later(() => later(() => { if (mode === 'readwrite' && wrote) stats.puts++; tx.oncomplete?.(); }));
      return tx;
    },
  };
  const indexedDB = {
    open() {
      const req = {};
      later(() => {
        if (fail) { req.error = new Error('打不開'); req.onerror?.(); return; }
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { indexedDB, box, stats };
}

function app(ls, idb) {
  const alerts = [];
  const ctx = vm.createContext({
    localStorage: {
      getItem: k => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: k => { delete ls[k]; },
      key: i => Object.keys(ls)[i] ?? null,
      get length() { return Object.keys(ls).length; },
    },
    alert: m => alerts.push(m),
    setTimeout, clearTimeout, structuredClone,
    ...(idb ? { indexedDB: idb.indexedDB } : {}),
  });
  for (const f of ['util', 'schema', 'storage']) vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
  return { Store: vm.runInContext('Store', ctx), alerts };
}

test('IndexedDB：localStorage 的舊資料第一次打開時搬過去，搬好才刪；之後從 IndexedDB 讀；迴圈改很多筆只存一次', async () => {
  // 舊版存的
  const ls = {};
  const old = app(ls).Store;
  const dev = old.add('devices', { code: '26-0001', name: '#1' });
  assert.ok(ls['devmgr.v1']);

  const idb = fakeIdb();
  const a = app(ls, idb).Store;
  await a.ready;
  assert.equal(a.get('devices', dev.id).name, '#1');
  assert.equal(a.pendingCount(), 1); // 還沒同步的也搬過去
  assert.equal(idb.box.data.devices.length, 1);
  assert.equal(ls['devmgr.v1'], undefined);
  assert.equal(ls['devmgr.sync'], undefined);

  const before = idb.stats.puts;
  for (let i = 0; i < 50; i++) a.add('readings', { device: '26-0001', bw: i });
  await a.saved();
  assert.equal(idb.stats.puts, before + 1);
  assert.equal(idb.box.data.readings.length, 50);
  assert.equal(ls['devmgr.v1'], undefined); // 不再寫 localStorage

  // 關掉再打開
  const b = app(ls, fakeIdb(idb.box)).Store;
  assert.equal(b.list('readings').length, 0); // 還沒讀出來
  await b.ready;
  assert.equal(b.list('readings').length, 50);
  assert.equal(b.pendingCount(), 51);
  assert.equal(b.available, true);

  // 登出：IndexedDB 裡的也清掉
  b.wipe();
  await b.saved();
  assert.equal(idb.box.data.devices.length, 0);
  assert.deepEqual(plain(idb.box.sync.pending), {});
  const c = app(ls, fakeIdb(idb.box)).Store;
  await c.ready;
  assert.equal(c.list('readings').length, 0);
});

test('IndexedDB 打不開：還沒搬過的照舊用 localStorage；搬過的不當成空的接著存', async () => {
  const ls = {};
  const a = app(ls, fakeIdb({}, { fail: true })).Store;
  await a.ready;
  a.add('devices', { code: '26-0001' });
  assert.equal(JSON.parse(ls['devmgr.v1']).devices.length, 1);
  assert.equal(a.unreadable, false);

  // 搬過去之後，有一次打不開
  const idb = fakeIdb();
  await app(ls, idb).Store.ready;
  const b = app(ls, fakeIdb(idb.box, { fail: true })).Store;
  await b.ready;
  assert.equal(b.unreadable, true);
  assert.equal(b.available, false);
  b.add('devices', { code: '26-0002' });
  assert.equal(ls['devmgr.v1'], undefined);
  assert.equal(idb.box.data.devices.length, 1); // 原本的還在
});

test('Store.get 用 id 直接查：新增、修改、刪除、整份換掉之後都查得到最新的；匯入的最新回報只收數字', () => {
  const { Store } = app({});
  const a = Store.add('devices', { code: '26-0001', name: '#1' });
  const b = Store.add('devices', { code: '26-0002', name: '#2' });
  assert.equal(Store.get('devices', a.id).name, '#1');
  Store.update('devices', a.id, { name: '#1 改' });
  assert.equal(Store.get('devices', a.id).name, '#1 改');
  assert.equal(Store.get('devices', a.id), Store.list('devices')[0]);
  Store.remove('devices', a.id);
  assert.equal(Store.get('devices', a.id), undefined);
  assert.equal(Store.get('devices', b.id).name, '#2');

  // 合併試算表的：這台還沒送出的修改、刪除照樣疊上去
  const c = Store.add('devices', { code: '26-0003', name: '#3' });
  Store.clearAllPending();
  Store.update('devices', b.id, { name: '#2 這台改的' });
  Store.remove('devices', c.id);
  Store.mergeRemote({ devices: [{ id: b.id, name: '#2' }, { id: c.id, name: '#3' }, { id: 'x1', name: '別台加的' }] });
  assert.deepEqual(plain(Store.list('devices').map(r => r.name)), ['#2 這台改的', '別台加的']);
  assert.equal(Store.get('devices', 'x1').name, '別台加的');
  assert.equal(Store.get('devices', c.id), undefined);

  Store.addAll([{ table: 'devices', rec: { id: 'y1', name: '匯入的' } }]);
  assert.equal(Store.get('devices', 'y1').name, '匯入的');
  Store.loadRemote({ devices: [{ id: 'z1', name: '雲端的' }] });
  assert.equal(Store.get('devices', 'y1'), undefined);
  assert.equal(Store.get('devices', 'z1').name, '雲端的');

  const parsed = Store.parseImport({ devices: [], toner: [{ serial: 'A1', bw: 10, K: '<img src=x onerror=alert(1)>', Y: 50, waste: '90' }] });
  assert.deepEqual(plain(parsed.toner), [{ serial: 'A1', bw: 10, K: null, Y: 50, waste: null }]);
});
