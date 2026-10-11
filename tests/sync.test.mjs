// 同步流程的測試：node --test tests/*.test.mjs
//   用一個模擬的 Google 雲端硬碟＋試算表（FakeGoogle，存在記憶體裡）代替真的 Google
//   App 的程式（storage.js、sheet.js、google.js、sync.js）照瀏覽器的方式放進 vm 環境執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ---------- 模擬的 Google API ----------
class FakeGoogle {
  constructor() {
    this.files = {}; // id → { title, appProperties, trashed, sheets: [{ sheetId, title, grid }] }
    this.n = 0;
    this.calls = [];
    this.onBatchGet = null; // 讀取時插入的動作（模擬同步途中使用者又改了資料）
  }

  // 'title'!A5、'title'!A:ZZ、title
  static parseRange(r) {
    const m = r.match(/^(?:'((?:[^']|'')+)'|([^!]+))(?:!([A-Z]+)(\d+)?(?::[A-Z]+\d*)?)?$/);
    const col = (m[3] || 'A').split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return { title: (m[1] || m[2]).replace(/''/g, "'"), col, row: m[4] ? Number(m[4]) - 1 : 0 };
  }

  sheet(id, title) {
    return this.files[id].sheets.find(s => s.title === title);
  }

  // 試算表讀回來的樣子：空字串是空格，尾端的空格與空列省略
  static read(grid) {
    const rows = grid.map(r => {
      const out = (r || []).map(v => (v === undefined || v === null ? '' : v));
      while (out.length && out.at(-1) === '') out.pop();
      return out;
    });
    while (rows.length && !rows.at(-1).length) rows.pop();
    return rows;
  }

  write(id, range, values) {
    const { title, col, row } = FakeGoogle.parseRange(range);
    const grid = this.sheet(id, title).grid;
    values.forEach((vals, i) => {
      grid[row + i] ||= [];
      vals.forEach((v, j) => { if (v !== null && v !== undefined) grid[row + i][col + j] = v; });
    });
  }

  // 直接看、改試算表（模擬使用者在 Google 試算表裡手動修改）
  values(id, title) {
    return FakeGoogle.read(this.sheet(id, title).grid);
  }

  setCell(id, title, row, col, v) {
    const grid = this.sheet(id, title).grid;
    grid[row - 1] ||= [];
    grid[row - 1][col] = v;
  }

  appendRow(id, title, row) {
    this.sheet(id, title).grid.push(row);
  }

  fetch = async (url, opts = {}) => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    this.calls.push(`${method} ${decodeURIComponent(u.pathname)}`);
    const ok = json => ({ status: 200, ok: true, text: async () => JSON.stringify(json) });
    const notFound = () => ({ status: 404, ok: false, text: async () => JSON.stringify({ error: { message: 'not found' } }) });
    const path = decodeURIComponent(u.pathname);

    if (path === '/drive/v3/about') return ok({ user: { emailAddress: 'test@example.com' } });
    if (path === '/drive/v3/files') {
      const files = Object.entries(this.files)
        .filter(([, f]) => f.appProperties?.devicemanager === '1' && !f.trashed)
        .map(([id]) => ({ id }));
      return ok({ files });
    }
    let m = path.match(/^\/drive\/v3\/files\/(.+)$/);
    if (m) {
      const f = this.files[m[1]];
      if (!f) return notFound();
      if (method === 'PATCH') f.appProperties = { ...f.appProperties, ...body.appProperties };
      return ok({ id: m[1], trashed: !!f.trashed });
    }
    if (path === '/v4/spreadsheets' && method === 'POST') {
      const id = `sheet${++this.n}`;
      this.files[id] = {
        title: body.properties.title,
        sheets: body.sheets.map(s => ({ sheetId: s.properties.sheetId, title: s.properties.title, hidden: !!s.properties.hidden, grid: [] })),
      };
      return ok({ spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}` });
    }
    m = path.match(/^\/v4\/spreadsheets\/([^/:]+)(.*)$/);
    if (!m) throw new Error(`未模擬的網址 ${url}`);
    const [, id, rest] = m;
    const f = this.files[id];
    if (!f) return notFound();

    if (rest === '' && method === 'GET') {
      return ok({
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}`,
        sheets: f.sheets.map(s => ({ properties: { sheetId: s.sheetId, title: s.title } })),
      });
    }
    if (rest === ':batchUpdate') {
      const replies = body.requests.map(r => {
        if (r.addSheet) {
          const sheetId = 1000 + (++this.n);
          f.sheets.push({ sheetId, title: r.addSheet.properties.title, hidden: !!r.addSheet.properties.hidden, grid: [] });
          return { addSheet: { properties: { sheetId, title: r.addSheet.properties.title } } };
        }
        if (r.deleteDimension) {
          const { sheetId, startIndex, endIndex } = r.deleteDimension.range;
          f.sheets.find(s => s.sheetId === sheetId).grid.splice(startIndex, endIndex - startIndex);
        }
        return {};
      });
      return ok({ replies });
    }
    if (rest === '/values:batchClear') {
      body.ranges.forEach(r => { this.sheet(id, FakeGoogle.parseRange(r).title).grid = []; });
      return ok({});
    }
    if (rest === '/values:batchUpdate') {
      body.data.forEach(d => this.write(id, d.range, d.values));
      return ok({});
    }
    if (rest === '/values:batchGet') {
      if (this.onBatchGet) { const fn = this.onBatchGet; this.onBatchGet = null; fn(); }
      const ranges = u.searchParams.getAll('ranges');
      return ok({ valueRanges: ranges.map(r => ({ values: this.values(id, FakeGoogle.parseRange(r).title) })) });
    }
    m = rest.match(/^\/values\/(.+):append$/);
    if (m) {
      const grid = this.sheet(id, FakeGoogle.parseRange(m[1]).title).grid;
      const last = FakeGoogle.read(grid).length;
      body.values.forEach((row, i) => { grid[last + i] = row.map(v => (v === null ? undefined : v)); });
      return ok({});
    }
    throw new Error(`未模擬的網址 ${method} ${url}`);
  };
}

// ---------- 載入 App ----------
const ROOT = new URL('../', import.meta.url);
const FILES = ['util', 'schema', 'storage', 'config', 'google', 'sheet', 'sync'];
const TOKEN_KEY = 'devmgr.google.token';

// 每個測試一個全新的裝置：localStorage、權杖、Google 都是新的
//   configured：config.js 有沒有設定 OAuth 用戶端 ID（測試裡預設有）
function device(fake, { storage = {}, token = true, confirmAnswer = true, clock = null, configured = true } = {}) {
  const ls = { ...storage };
  const toasts = [];
  const notes = []; // 送進提醒的標題
  const inbox = []; // 送進提醒的整則（{ title, body, action }）
  const asked = { answer: confirmAnswer, messages: [] };
  const alerts = [];
  const loggedOut = { count: 0 };
  const nav = { onLine: true }; // navigator.onLine：改成 false 是瀏覽器知道沒有網路
  const events = {};             // window 的事件（online），測試裡用 fire() 觸發
  const popups = { count: 0 };   // 跳出 Google 登入視窗的次數
  const ctx = vm.createContext({
    localStorage: {
      getItem: k => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: k => { delete ls[k]; },
      key: i => Object.keys(ls)[i] ?? null,
      get length() { return Object.keys(ls).length; },
    },
    alert: msg => alerts.push(msg),
    confirm: msg => { asked.messages.push(msg); return asked.answer; },
    setTimeout: () => 0, // 自動同步的計時器不執行，測試裡直接呼叫同步
    clearTimeout: () => {},
    fetch: fake.fetch,
    navigator: nav,
    URLSearchParams,
    location: { origin: 'http://localhost:8770', pathname: '/', search: '', hash: '', assign() {} },
    history: { replaceState() {} },
    document: { hidden: false, addEventListener() {} },
  });
  ctx.window = ctx;
  ctx.window.addEventListener = (type, fn) => { (events[type] ||= []).push(fn); };
  if (clock) {
    ctx.Date = class extends Date {
      constructor(...a) { super(...(a.length ? a : [clock.now])); }
      static now() { return clock.now; }
    };
  }
  // Google 登入元件：按下登入就直接成功
  ctx.google = {
    accounts: {
      oauth2: {
        initTokenClient: cfg => ({ requestAccessToken: () => { popups.count++; cfg.callback({ access_token: 'fake', expires_in: 3600 }); } }),
        hasGrantedAllScopes: () => true,
        revoke: (t, done) => done && done(),
      },
    },
  };
  if (token) ls[TOKEN_KEY] = JSON.stringify({ accessToken: 'fake', expiresAt: (clock?.now ?? Date.now()) + 3600e3 });
  for (const f of FILES) {
    vm.runInContext(readFileSync(new URL(`js/${f}.js`, ROOT), 'utf8'), ctx, { filename: `${f}.js` });
    if (f === 'config' && configured) vm.runInContext("CONFIG.googleClientId = 'test-client'", ctx);
  }
  const app = vm.runInContext('({ Store, Sync, Sheet })', ctx);
  app.Sync.init({
    toast: (msg, kind) => toasts.push(kind ? `${kind}:${msg}` : msg),
    notify: m => { notes.push(m.title); inbox.push(m); },
    onLogout: () => { loggedOut.count++; },
  });
  const fire = type => (events[type] || []).forEach(fn => fn());
  return { ...app, ls, toasts, asked, notes, inbox, alerts, loggedOut, nav, fire, popups };
}

const plain = v => JSON.parse(JSON.stringify(v));
const blankDevice = {
  code: '', name: '', status: '使用中', category: '', brand: '', model: '', serial: '', location: '', keeper: '',
  buyDate: null, price: null, vendor: '', warranty: null, link: '', note: '',
};
const DEVICE = { ...blankDevice, code: 'NB-001', name: '會議室筆電', category: '筆電', location: '3F 會議室', buyDate: '2025-03-15', price: 32000 };
const PRINTER = { ...blankDevice, code: 'PR-001', name: '印表機', category: '印表機' };
const COL = { code: 0, name: 1, status: 2, location: 7, keeper: 8, buyDate: 9, price: 10, id: 15 };
// 在試算表裡手打的一列（沒有 id）
const typed = (code, name, status = '使用中') => [code, name, status, '', '', '', '', '2F', '', '2026/9/10', '1,200'];

// 連結後的第一台裝置，已有一台設備
async function linked(fake = new FakeGoogle(), opts = {}) {
  const d = device(fake, opts);
  d.Store.add('devices', DEVICE);
  await d.Sync.startLink();
  d.asked.messages.length = 0; // 連結時「資料會存到哪個帳號」的確認，另外測
  const id = d.Sync.state().url.split('/').pop();
  return { fake, d, id };
}

test('連結：雲端沒有試算表時建立一份「設備管理」，寫入這台裝置的資料', async () => {
  const { fake, d, id } = await linked();
  const st = d.Sync.state();
  assert.equal(st.linked, true);
  assert.equal(st.email, 'test@example.com');
  assert.equal(st.pending, 0);
  assert.equal(st.error, '');
  assert.ok(d.toasts.includes('已連結 Google 帳號'));
  assert.equal(fake.files[id].title, '設備管理');
  assert.deepEqual(fake.files[id].appProperties, { devicemanager: '1' });
  assert.deepEqual(fake.values(id, '設備')[1].slice(0, 4), ['NB-001', '會議室筆電', '使用中', '筆電']);
  assert.equal(fake.values(id, '設備')[1][COL.buyDate], d.Sheet.toSerial('2025-03-15'));
  assert.deepEqual(fake.values(id, '_meta'), [['version', 1]]);
  assert.equal(fake.sheet(id, '_meta').hidden, true);
});

test('還沒設定 OAuth 用戶端 ID：不能連結，狀態寫著還沒設定', async () => {
  const fake = new FakeGoogle();
  const d = device(fake, { configured: false, token: false });
  assert.equal(d.Sync.state().configured, false);
  await d.Sync.startLink();
  assert.equal(d.Sync.state().linked, false);
  assert.equal(d.popups.count, 0);
  assert.ok(d.toasts.includes('error:雲端同步還沒設定'));
  assert.deepEqual(fake.calls, []);
});

test('新增、修改、刪除都寫回試算表的同一列', async () => {
  const { fake, d, id } = await linked();
  const p = d.Store.add('devices', PRINTER);
  assert.equal(d.Sync.state().pending, 1);
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().pending, 0);
  let rows = fake.values(id, '設備');
  assert.equal(rows.length, 3);
  assert.equal(rows[2][COL.id], p.id);

  d.Store.update('devices', p.id, { status: '維修中' });
  await d.Sync.syncNow();
  rows = fake.values(id, '設備');
  assert.equal(rows.length, 3);
  assert.equal(rows[2][COL.status], '維修中');

  d.Store.remove('devices', p.id);
  await d.Sync.syncNow();
  assert.equal(fake.values(id, '設備').length, 2);
  assert.equal(d.Sync.state().pending, 0);
});

test('在試算表裡修改、新增（沒有 id），同步後 App 也有', async () => {
  const { fake, d, id } = await linked();
  fake.setCell(id, '設備', 2, COL.keeper, '王小明');
  fake.appendRow(id, '設備', typed('MN-001', '螢幕'));
  await d.Sync.syncNow();

  const list = d.Store.list('devices');
  assert.equal(list.length, 2);
  assert.equal(list.find(r => r.code === 'NB-001').keeper, '王小明');
  const added = list.find(r => r.code === 'MN-001');
  assert.equal(added.buyDate, '2026-09-10');
  assert.equal(added.price, 1200);
  // 試算表補上 id
  assert.equal(fake.values(id, '設備')[2][COL.id], added.id);
  // 再同步一次不會重複新增
  await d.Sync.syncNow();
  assert.equal(d.Store.list('devices').length, 2);
  assert.equal(fake.values(id, '設備').length, 3);
});

test('在試算表刪掉一列，App 也跟著刪除（少量刪除不詢問）', async () => {
  const { fake, d, id } = await linked();
  fake.sheet(id, '設備').grid.splice(1, 1);
  await d.Sync.syncNow();
  assert.equal(d.Store.list('devices').length, 0);
  assert.deepEqual(d.asked.messages, []);
  // 提醒留一則，列出是哪一筆，點了打開試算表
  const m = d.inbox.at(-1);
  assert.equal(m.title, '試算表刪了 1 筆，這台也跟著刪了');
  assert.match(m.body, /設備：NB-001 會議室筆電 使用中/);
  assert.match(m.body, /檔案 → 版本記錄/);
  assert.equal(m.action.type, 'sheet');
  // 再同步一次不會再留
  await d.Sync.syncNow();
  assert.equal(d.inbox.filter(x => x.title.startsWith('試算表刪了')).length, 1);
});

test('在這台裝置自己刪的、試算表裡新增或修改的，都不會留「試算表刪了」的提醒', async () => {
  const { fake, d, id } = await linked();
  const p = d.Store.add('devices', PRINTER);
  await d.Sync.syncNow();
  d.Store.remove('devices', p.id);
  fake.setCell(id, '設備', 2, COL.keeper, '王小明');
  fake.appendRow(id, '設備', typed('MN-001', '螢幕'));
  await d.Sync.syncNow();
  assert.equal(d.inbox.filter(x => /刪了|少了/.test(x.title)).length, 0);
});

// 連結後再加 n 台設備並同步
async function withDevices(n = 5) {
  const ctx = await linked();
  for (let i = 0; i < n; i++) ctx.d.Store.add('devices', { ...PRINTER, code: `PR-${100 + i}` });
  await ctx.d.Sync.syncNow();
  ctx.d.asked.messages.length = 0;
  return ctx;
}

test('試算表一次少了 5 筆以上：先詢問，選「取消」就保留並寫回試算表', async () => {
  const { fake, d, id } = await withDevices();
  fake.sheet(id, '設備').grid.splice(2, 5); // 選取一大片刪掉
  d.asked.answer = false;
  await d.Sync.syncNow();
  assert.equal(d.asked.messages.length, 1);
  assert.match(d.asked.messages[0], /少了 5 筆資料（設備 5 筆）/);
  assert.equal(d.Store.list('devices').length, 6);
  assert.equal(fake.values(id, '設備').length, 7);
  assert.equal(d.Sync.state().pending, 0);
  assert.ok(d.notes.includes('試算表裡少了 5 筆資料'));
  assert.match(d.inbox.at(-1).body, /保留，並寫回試算表/);
  assert.doesNotMatch(d.inbox.at(-1).body, /版本記錄/);
  // 再同步一次不會重複寫入，也不會再問
  await d.Sync.syncNow();
  assert.equal(fake.values(id, '設備').length, 7);
  assert.equal(d.asked.messages.length, 1);
});

test('試算表一次少了 5 筆以上：選「確定」就跟著刪除', async () => {
  const { fake, d, id } = await withDevices();
  fake.sheet(id, '設備').grid.splice(2, 5);
  d.asked.answer = true;
  await d.Sync.syncNow();
  assert.equal(d.asked.messages.length, 1);
  assert.equal(d.Store.list('devices').length, 1);
  const m = d.inbox.at(-1);
  assert.equal(m.title, '試算表裡少了 5 筆資料');
  assert.equal(m.body.split('\n').filter(l => l.startsWith('設備：')).length, 5);
  assert.match(m.body, /版本記錄/);
  assert.equal(m.action.type, 'sheet');
});

test('試算表一次少了 10 筆以上：提醒最多列 10 筆，其餘寫「等幾筆」', async () => {
  const { fake, d, id } = await withDevices(12);
  fake.sheet(id, '設備').grid.splice(2, 12);
  d.asked.answer = true;
  await d.Sync.syncNow();
  const body = d.inbox.at(-1).body;
  assert.equal(body.split('\n').filter(l => l.startsWith('設備：')).length, 10);
  assert.match(body, /…等 12 筆/);
});

test('沒有網路：顯示會自動同步，不算失敗；網路恢復後正常同步', async () => {
  const { fake, d } = await linked();
  d.Store.add('devices', PRINTER);
  fake.offline = true;
  await d.Sync.syncNow();
  let st = d.Sync.state();
  assert.equal(st.offline, true);
  assert.equal(st.error, '');
  assert.equal(st.pending, 1);
  assert.ok(d.toasts.includes('目前沒有網路，連上後會自動同步'));
  fake.offline = false;
  await d.Sync.syncNow();
  st = d.Sync.state();
  assert.equal(st.offline, false);
  assert.equal(st.pending, 0);
});

test('離線超過 1 小時（登入過期）：連上網路後不再顯示「沒有網路」，改成請使用者按「同步」', async () => {
  const clock = { now: Date.UTC(2026, 9, 11, 2, 0) };
  const { fake, d } = await linked(new FakeGoogle(), { clock });
  fake.offline = true;
  d.nav.onLine = false;
  d.Store.add('devices', PRINTER);
  await d.Sync.syncNow();
  clock.now += 2 * 3600e3; // 登入過期
  let st = d.Sync.state();
  assert.equal(st.offline, true);
  assert.equal(st.needLogin, true);
  // 連上網路：登入過期不會自動同步，也不再說沒有網路
  fake.offline = false;
  d.nav.onLine = true;
  const before = fake.calls.length;
  d.fire('online');
  st = d.Sync.state();
  assert.equal(fake.calls.length, before);
  assert.equal(st.offline, false);
  assert.equal(st.needLogin, true);
  assert.equal(st.pending, 1);
  // 按「同步」：重新登入後送出
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().pending, 0);
});

test('登入過期又沒有網路：修改資料、按「同步」都不跳 Google 登入視窗，提示沒有網路', async () => {
  const { fake, d } = await linked();
  const storage = { ...d.ls, [TOKEN_KEY]: JSON.stringify({ accessToken: 'old', expiresAt: Date.now() - 1 }) };
  const again = device(fake, { storage, token: false });
  again.nav.onLine = false;
  again.Store.add('devices', PRINTER);
  assert.equal(again.popups.count, 0);
  let st = again.Sync.state();
  assert.equal(st.offline, true);
  assert.equal(st.pending, 1);
  await again.Sync.syncNow();
  assert.equal(again.popups.count, 0);
  assert.ok(again.toasts.includes('目前沒有網路，連上網路後再按「同步」'));
  // 連上網路：改成請使用者按「同步」，按了才跳登入視窗、送出
  again.nav.onLine = true;
  again.fire('online');
  st = again.Sync.state();
  assert.equal(st.offline, false);
  assert.equal(st.pending, 1);
  await again.Sync.syncNow();
  assert.equal(again.popups.count, 1);
  assert.equal(again.Sync.state().pending, 0);
});

test('手動輸入、沒有 id 的列：補 id 時斷線，這台裝置先不放進來；之後在 App 裡改這筆也不會變兩筆', async () => {
  const { fake, d, id } = await linked();
  fake.appendRow(id, '設備', typed('MN-001', '螢幕'));
  fake.onBatchGet = () => { fake.offline = true; }; // 讀回來之後就斷線
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().offline, true);
  assert.equal(d.Store.list('devices').length, 1);
  fake.offline = false;
  await d.Sync.syncNow();
  const m = d.Store.list('devices').find(r => r.code === 'MN-001');
  d.Store.update('devices', m.id, { status: '閒置' });
  await d.Sync.syncNow();
  const rows = fake.values(id, '設備');
  assert.equal(rows.length, 3);
  assert.equal(rows[2][COL.status], '閒置');
  assert.equal(rows[2][COL.id], m.id);
});

test('還沒同步的修改優先：同步時不會被試算表的舊資料蓋掉', async () => {
  const { fake, d, id } = await linked();
  const dev = d.Store.list('devices')[0];
  d.Store.update('devices', dev.id, { status: '閒置' });
  fake.setCell(id, '設備', 2, COL.name, '在試算表改的名字');
  await d.Sync.syncNow();
  assert.equal(d.Store.list('devices')[0].status, '閒置');
  assert.equal(fake.values(id, '設備')[1][COL.status], '閒置');
});

test('同步途中又修改的資料，留到下一次同步', async () => {
  const { fake, d } = await linked();
  const dev = d.Store.list('devices')[0];
  fake.onBatchGet = () => d.Store.update('devices', dev.id, { keeper: '小華' });
  d.Store.add('devices', PRINTER);
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().pending, 1);
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().pending, 0);
});

test('分頁被刪掉：補建回來並寫入這台裝置的資料', async () => {
  const { fake, d, id } = await linked();
  fake.files[id].sheets = fake.files[id].sheets.filter(s => s.title !== '設備');
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().error, '');
  assert.equal(d.Store.list('devices').length, 1);
  assert.equal(fake.values(id, '設備').length, 2);
  assert.deepEqual(plain(d.Sync.state().problems), []); // 這次就寫回去了，不算看不懂的地方
});

test('標題被改壞：App 的資料保留、修改留著，顯示要改回哪個標題', async () => {
  const { fake, d, id } = await linked();
  fake.setCell(id, '設備', 1, COL.name, '品名'); // 「名稱」被改名
  const dev = d.Store.list('devices')[0];
  d.Store.update('devices', dev.id, { status: '閒置' });
  await d.Sync.syncNow();
  const st = d.Sync.state();
  assert.equal(st.pending, 1);
  assert.equal(d.Store.list('devices')[0].status, '閒置');
  assert.deepEqual(plain(st.problems).map(d.Sheet.problemText), ['設備第 1 列：找不到「名稱」欄，請把標題改回「名稱」']);
  // 改回來之後就正常
  fake.setCell(id, '設備', 1, COL.name, '名稱');
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().pending, 0);
  assert.deepEqual(plain(d.Sync.state().problems), []);
});

test('試算表被丟到垃圾桶：詢問後選「確定」，用這台裝置的資料重新建立一份', async () => {
  const { fake, d, id } = await linked();
  fake.files[id].trashed = true;
  await d.Sync.syncNow();
  assert.equal(d.asked.messages.length, 1);
  assert.match(d.asked.messages[0], /「設備管理」試算表找不到了/);
  const newId = d.Sync.state().url.split('/').pop();
  assert.notEqual(newId, id);
  assert.equal(fake.values(newId, '設備').length, 2);
  assert.ok(d.toasts.some(t => t.includes('重新建立')));
  assert.ok(d.notes.includes('已重新建立試算表'));
});

test('試算表被丟到垃圾桶：選「取消」就取消連結，資料保留、不重建', async () => {
  const { fake, d, id } = await linked();
  fake.files[id].trashed = true;
  const files = Object.keys(fake.files).length;
  d.asked.answer = false;
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().linked, false);
  assert.equal(Object.keys(fake.files).length, files);
  assert.equal(d.Store.list('devices').length, 1);
  assert.ok(d.toasts.includes('已取消連結'));
});

test('第二台裝置（沒有資料）連結：直接用雲端的資料，不詢問', async () => {
  const { fake } = await linked();
  const phone = device(fake);
  await phone.Sync.startLink();
  assert.equal(phone.Store.list('devices').length, 1);
  assert.equal(phone.Sync.state().linked, true);
  assert.deepEqual(phone.asked.messages, []);
});

test('連結：這台裝置有資料、雲端還沒有試算表時，先確認要存到哪個帳號；選「取消」就不連結', async () => {
  const fake = new FakeGoogle();
  const d = device(fake, { confirmAnswer: false });
  d.Store.add('devices', DEVICE);
  await d.Sync.startLink();
  assert.equal(d.asked.messages.length, 1);
  assert.match(d.asked.messages[0], /這台裝置上有 1 筆資料，會存到 test@example\.com 的 Google 試算表/);
  assert.equal(d.Sync.state().linked, false);
  assert.deepEqual(Object.keys(fake.files), []); // 沒有建立試算表
  assert.equal(d.Store.list('devices').length, 1);

  // 選「確定」才建立
  d.asked.answer = true;
  await d.Sync.startLink();
  assert.equal(d.Sync.state().linked, true);
  const id = d.Sync.state().url.split('/').pop();
  assert.equal(fake.values(id, '設備').length, 2);
});

test('兩邊都有資料時先詢問；選「取消」就不連結', async () => {
  const { fake } = await linked();
  const other = device(fake, { confirmAnswer: false });
  other.Store.add('devices', PRINTER);
  await other.Sync.startLink();
  assert.equal(other.Sync.state().linked, false);
  assert.match(other.asked.messages[0], /已經有一份「設備管理」（設備 1 筆）/);
  assert.equal(other.Store.list('devices')[0].code, 'PR-001');

  const yes = device(fake, { confirmAnswer: true });
  yes.Store.add('devices', PRINTER);
  await yes.Sync.startLink();
  assert.equal(yes.Sync.state().linked, true);
  assert.deepEqual(plain(yes.Store.list('devices').map(r => r.code)), ['NB-001']); // 改用雲端的資料
});

test('匯入 data.json 後整份重寫試算表', async () => {
  const { fake, d, id } = await linked();
  fake.appendRow(id, '設備', typed('MN-001', '螢幕'));
  d.Store.replaceAll(d.Store.parseImport({ devices: [{ ...PRINTER, id: 'p9' }] }));
  await d.Sync.syncNow();
  assert.deepEqual(fake.values(id, '設備').map(r => r[COL.id]), ['id', 'p9']);
  assert.equal(d.Sync.state().pending, 0);
});

test('登入過期：不會自動同步，狀態顯示需要重新連線', async () => {
  const { fake, d } = await linked();
  const storage = { ...d.ls, [TOKEN_KEY]: JSON.stringify({ accessToken: 'old', expiresAt: Date.now() - 1 }) };
  const again = device(fake, { storage, token: false });
  const before = fake.calls.length;
  assert.equal(again.Sync.state().needLogin, true);
  assert.equal(fake.calls.length, before);
  // 按「同步」：重新登入後同步
  again.Store.add('devices', PRINTER);
  await again.Sync.syncNow();
  assert.equal(again.Sync.state().needLogin, false);
  assert.equal(again.Sync.state().pending, 0);
});

test('登出：先把還沒同步的修改送出，確認後只清掉這個 App 的資料（同一個網址底下其他 App 的不動）；再登入會抓回來', async () => {
  const { fake, d, id } = await linked(new FakeGoogle(), { storage: { 'stockbook.v1': '{"trades":[]}' } });
  d.Store.add('devices', PRINTER);
  assert.equal(d.Sync.state().pending, 1);
  await d.Sync.logout();
  assert.equal(fake.values(id, '設備').length, 3); // 登出前送出了
  assert.equal(d.asked.messages.length, 1);
  assert.match(d.asked.messages[0], /登出後，這台裝置上的資料會清除。\n資料都存在 test@example\.com 的 Google 試算表裡/);
  assert.deepEqual(d.alerts, []);
  assert.equal(d.loggedOut.count, 1);
  assert.equal(d.Sync.state().linked, false);
  assert.equal(d.Store.list('devices').length, 0);
  assert.deepEqual(Object.keys(d.ls).filter(k => k.startsWith('devmgr.')), []);
  assert.equal(d.ls['stockbook.v1'], '{"trades":[]}');

  // 同一台裝置再登入：資料從試算表抓回來
  const again = device(fake, { storage: d.ls, token: false });
  await again.Sync.startLink();
  assert.equal(again.Store.list('devices').length, 2);
});

test('登出：登入過期時先重新登入、同步，再登出', async () => {
  const { fake, d } = await linked();
  const storage = { ...d.ls, [TOKEN_KEY]: JSON.stringify({ accessToken: 'old', expiresAt: Date.now() - 1 }) };
  const again = device(fake, { storage, token: false });
  again.Store.add('devices', PRINTER);
  await again.Sync.logout();
  assert.equal(again.loggedOut.count, 1);
  assert.equal(again.Store.list('devices').length, 0);
});

test('登出：選「取消」就不登出，資料和連結都保留', async () => {
  const { d } = await linked();
  d.asked.answer = false;
  await d.Sync.logout();
  assert.equal(d.asked.messages.length, 1);
  assert.equal(d.loggedOut.count, 0);
  assert.equal(d.Sync.state().linked, true);
  assert.equal(d.Sync.state().loggingOut, false);
  assert.equal(d.Store.list('devices').length, 1);
});

test('登出：沒有網路時不清資料，告訴使用者原因', async () => {
  const { fake, d } = await linked();
  d.Store.add('devices', PRINTER);
  fake.offline = true;
  await d.Sync.logout();
  assert.deepEqual(d.asked.messages, []); // 沒走到確認
  assert.equal(d.alerts.length, 1);
  assert.match(d.alerts[0], /還不能登出/);
  assert.match(d.alerts[0], /目前沒有網路，連上網路後再按一次「登出」/);
  assert.equal(d.loggedOut.count, 0);
  assert.equal(d.Sync.state().linked, true);
  assert.equal(d.Store.list('devices').length, 2);
  assert.equal(d.Sync.state().pending, 1);
});

test('登出：試算表的標題被改壞時不清資料（就算沒有待同步的修改），告訴使用者要改回哪個標題', async () => {
  const { fake, d, id } = await linked();
  fake.setCell(id, '設備', 1, COL.name, '品名'); // 這張表 App 的資料比試算表完整
  await d.Sync.logout();
  assert.equal(d.Sync.state().pending, 0);
  assert.equal(d.alerts.length, 1);
  assert.match(d.alerts[0], /「設備」的資料沒辦法寫回試算表/);
  assert.match(d.alerts[0], /請把標題改回「名稱」/);
  assert.equal(d.loggedOut.count, 0);
  assert.equal(d.Store.list('devices')[0].name, '會議室筆電');

  // 改回來之後就可以登出
  fake.setCell(id, '設備', 1, COL.name, '名稱');
  await d.Sync.logout();
  assert.equal(d.loggedOut.count, 1);
});

test('登出：同步時發現試算表不見了、選「取消」：取消連結，資料留在這台裝置', async () => {
  const { fake, d, id } = await linked();
  fake.files[id].trashed = true;
  d.asked.answer = false;
  await d.Sync.logout();
  assert.equal(d.asked.messages.length, 1);
  assert.match(d.asked.messages[0], /試算表找不到了/);
  assert.equal(d.loggedOut.count, 0);
  assert.equal(d.Sync.state().linked, false);
  assert.equal(d.Store.list('devices').length, 1);
});

test('試算表上看不懂的那一筆，在 App 裡改好之後，同一次同步就不再算問題', async () => {
  const { fake, d, id } = await linked();
  fake.setCell(id, '設備', 2, COL.buyDate, '2026/13/01'); // 打錯日期
  await d.Sync.syncNow();
  assert.deepEqual(plain(d.Sync.state().problems).map(p => p.msg), ['購買日期看不懂（2026/13/01）']);
  const dev = d.Store.list('devices')[0];
  d.Store.update('devices', dev.id, { buyDate: '2025-03-15' }); // 在 App 裡改好
  await d.Sync.syncNow();
  assert.deepEqual(plain(d.Sync.state().problems), []);
  assert.equal(fake.values(id, '設備')[1][COL.buyDate], d.Sheet.toSerial('2025-03-15'));
});
