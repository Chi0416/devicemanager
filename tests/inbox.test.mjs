// 提醒的測試：node --test tests/*.test.mjs
//   App 的程式照瀏覽器的方式放進 vm 環境執行（沒有畫面，只測收提醒、去重複、已解決、清除）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = ['util', 'schema', 'storage', 'inbox'];

function app(storage = {}) {
  const ls = { ...storage };
  const ctx = vm.createContext({
    localStorage: {
      getItem: k => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: k => { delete ls[k]; },
    },
    alert: () => {},
  });
  for (const f of FILES) vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx, { filename: `${f}.js` });
  return { ...vm.runInContext('({ Store, Inbox })', ctx), ls };
}

const plain = v => JSON.parse(JSON.stringify(v));
const issue = (key, body = '內容') => ({ key, title: '標題', body });

test('事件：每次都新增一則，未讀', () => {
  const { Inbox } = app();
  Inbox.add({ title: '已取消連結', body: '說明' });
  Inbox.add({ title: '已取消連結', body: '說明' });
  assert.equal(Inbox.list().length, 2);
  assert.equal(Inbox.unread(), 2);
  Inbox.markAllRead();
  assert.equal(Inbox.unread(), 0);
});

test('問題：同一個問題不重複；內容變了重新標成未讀；不見了標成已解決；又出現時恢復', () => {
  const { Inbox } = app();
  Inbox.reconcile('warranty:', [issue('warranty:a')]);
  Inbox.reconcile('warranty:', [issue('warranty:a')]);
  assert.equal(Inbox.list().length, 1);
  Inbox.markAllRead();

  Inbox.reconcile('warranty:', [issue('warranty:a')]);
  assert.equal(Inbox.unread(), 0); // 沒變就不吵

  Inbox.reconcile('warranty:', [issue('warranty:a', '新的內容')]);
  assert.equal(Inbox.unread(), 1);
  Inbox.markAllRead();

  Inbox.reconcile('warranty:', []);
  assert.equal(Inbox.list()[0].resolved, true);
  assert.equal(Inbox.unread(), 0); // 解決了不用再看一次

  Inbox.reconcile('warranty:', [issue('warranty:a', '新的內容')]);
  assert.equal(Inbox.list()[0].resolved, false);
  assert.equal(Inbox.unread(), 1);
});

test('只處理同一類（prefix）的問題，其他類不受影響', () => {
  const { Inbox } = app();
  Inbox.reconcile('warranty:', [issue('warranty:a')]);
  Inbox.reconcile('sheet:', [issue('sheet:設備')]);
  Inbox.reconcile('sheet:', []);
  const byKey = Object.fromEntries(Inbox.list().map(m => [m.key, m.resolved]));
  assert.deepEqual(byKey, { 'warranty:a': false, 'sheet:設備': true });
});

test('清除已讀：清掉看過的事件和已解決的問題，還沒解決的留著', () => {
  const { Inbox } = app();
  Inbox.add({ title: '事件' });
  Inbox.reconcile('warranty:', [issue('warranty:a'), issue('warranty:b')]);
  Inbox.reconcile('warranty:', [issue('warranty:a')]); // b 解決了
  Inbox.add({ title: '還沒看的事件' });
  Inbox.list().filter(m => m.title !== '還沒看的事件').forEach(m => { m.read = true; });
  Inbox.clearRead();
  assert.deepEqual(plain(Inbox.list()).map(m => m.key.startsWith('event:') ? m.title : m.key).sort(), ['warranty:a', '還沒看的事件']);
});

test('最多留 100 則，從最舊的刪起，還沒解決的問題不刪', () => {
  const { Inbox } = app();
  Inbox.reconcile('warranty:', [issue('warranty:keep')]); // 最舊、但還沒解決
  for (let i = 0; i < 105; i++) Inbox.add({ title: `事件 ${i}` });
  Inbox.markAllRead();
  Inbox.add({ title: '最新' });
  const titles = Inbox.list().map(m => m.title);
  assert.equal(titles.length, 100);
  assert.ok(Inbox.list().some(m => m.key === 'warranty:keep'));
  assert.ok(titles.includes('最新'));
  assert.ok(!titles.includes('事件 0'));
});

test('存在這台裝置（devmgr. 開頭）：重新打開 App 還在', () => {
  const first = app();
  first.Inbox.add({ title: '已重新建立試算表' });
  assert.ok('devmgr.inbox' in first.ls);
  const again = app(first.ls);
  assert.deepEqual(plain(again.Inbox.list()).map(m => m.title), ['已重新建立試算表']);
});

test('同步失敗留一則（不重複），之後同步成功標成已解決', () => {
  const { Inbox } = app();
  const st = { linked: true, running: false, error: '', problems: [], problemsAt: 0, okAt: 0 };
  Inbox.syncStatus({ ...st, error: '連不上 Google' });
  Inbox.syncStatus({ ...st, error: '連不上 Google' });
  assert.equal(Inbox.list().length, 1);
  assert.equal(Inbox.list()[0].title, '同步失敗');
  Inbox.syncStatus({ ...st, running: true }); // 重試中，還不知道結果
  assert.equal(Inbox.list()[0].resolved, false);
  Inbox.syncStatus({ ...st, okAt: 123 });
  assert.equal(Inbox.list()[0].resolved, true);
});

test('試算表看不懂的格子：每個分頁一則；剛打開 App 還沒讀過試算表時不會誤判成已解決', () => {
  const { Inbox } = app();
  const st = { linked: true, running: false, error: '', okAt: 0 };
  const problems = [
    { tab: '設備', row: 12, msg: '購買日期看不懂（2026/13/01）' },
    { tab: '設備', row: 15, msg: '購買金額不是數字（一萬）' },
    { tab: '維修紀錄', row: 3, msg: '報修日期空白' },
  ];
  Inbox.syncStatus({ ...st, problems, problemsAt: 1 });
  const msgs = plain(Inbox.list());
  assert.deepEqual(msgs.map(m => m.title).sort(), ['試算表「維修紀錄」有 1 個地方看不懂', '試算表「設備」有 2 個地方看不懂']);
  assert.equal(msgs.find(m => m.key === 'sheet:設備').body, '第 12 列：購買日期看不懂（2026/13/01）\n第 15 列：購買金額不是數字（一萬）');

  Inbox.syncStatus({ ...st, problems: [], problemsAt: 1 }); // 同一次讀取的結果，不重算
  assert.ok(Inbox.list().every(m => !m.resolved));
  Inbox.syncStatus({ ...st, problems: problems.slice(2), problemsAt: 2 }); // 設備修好了
  assert.equal(Inbox.list().find(m => m.key === 'sheet:設備').resolved, true);
  assert.equal(Inbox.list().find(m => m.key === 'sheet:維修紀錄').resolved, false);
});

test('沒有連結：同步和試算表的提醒都標成已解決', () => {
  const { Inbox } = app();
  const st = { linked: true, running: false, error: '連不上 Google', problems: [{ tab: '設備', row: 2, msg: '名稱空白' }], problemsAt: 1, okAt: 0 };
  Inbox.syncStatus(st);
  assert.equal(Inbox.list().length, 2);
  Inbox.syncStatus({ linked: false });
  assert.ok(Inbox.list().every(m => m.resolved));
});
