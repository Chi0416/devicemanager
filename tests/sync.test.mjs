// 同步流程的測試：node --test tests/*.test.mjs
//   用一個模擬的 Google 雲端硬碟＋試算表（FakeGoogle，存在記憶體裡）代替真的 Google
//   App 的程式（storage.js、sheet.js、google.js、sync.js）照瀏覽器的方式放進 vm 環境執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ---------- 模擬的 Google API ----------
class FakeGoogle {
  static ROWS = 30;

  constructor() {
    this.files = {}; // id → { title, appProperties, trashed, sheets: [{ sheetId, title, grid }] }
    this.n = 0;
    this.calls = [];
    this.onBatchGet = null; // 讀取時插入的動作（模擬同步途中使用者又改了資料）
    this.meter = null;      // 讀信網址被叫的時候（模擬試算表上的程式讀信）：() => 回傳的 { count, fixed, at }；沒設是讀信失敗
  }

  // 'title'!A5、'title'!A:ZZ、'title'!K5:K、title；whole 是沒寫範圍（整個分頁）
  static parseRange(r) {
    const m = r.match(/^(?:'((?:[^']|'')+)'|([^!]+))(?:!([A-Z]+)(\d+)?(?::([A-Z]+)\d*)?)?$/);
    const num = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const col = num(m[3] || 'A');
    return { title: (m[1] || m[2]).replace(/''/g, "'"), col, endCol: m[5] ? num(m[5]) : col, row: m[4] ? Number(m[4]) - 1 : 0, whole: !m[3] };
  }

  sheet(id, title) {
    return this.files[id].sheets.find(s => s.title === title);
  }

  // 試算表讀回來的樣子：空字串是空格，尾端的空格與空列省略
  static read(grid) {
    const rows = grid.map(r => {
      const out = Array.from(r || [], v => (v === undefined || v === null ? '' : v)); // 沒寫過的格子也是空格
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

    if (u.hostname === 'script.google.com') {
      // 業務員拿資料（見 apps-script/meter.gs 的 salesData_）：sales 是模擬的程式
      if (method === 'POST' && (body?.action === 'data' || body?.action === 'add')) {
        const handler = body.action === 'data' ? this.sales : this.salesAdd;
        if (!handler) return notFound();
        const r = handler(body);
        return { status: 200, ok: true, json: async () => r };
      }
      if (!this.meter) return notFound();
      const r = this.meter();
      return { status: 200, ok: true, json: async () => r };
    }

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
        // 模擬 Google：欄設成核取方塊時，整欄的空白格填成 FALSE（試算表預設 1000 列，這裡只模擬到 ROWS 列）
        if (r.setDataValidation?.rule.condition.type === 'BOOLEAN') {
          const { sheetId, startRowIndex, startColumnIndex } = r.setDataValidation.range;
          const grid = f.sheets.find(s => s.sheetId === sheetId).grid;
          for (let i = startRowIndex; i < FakeGoogle.ROWS; i++) {
            grid[i] ||= [];
            if (grid[i][startColumnIndex] === undefined || grid[i][startColumnIndex] === '') grid[i][startColumnIndex] = false;
          }
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
      body.ranges.forEach(r => {
        const { title, col, endCol, row, whole } = FakeGoogle.parseRange(r);
        const s = this.sheet(id, title);
        if (whole) s.grid = [];
        else s.grid.slice(row).forEach(cells => { for (let c = col; c <= endCol; c++) if (cells && c < cells.length) cells[c] = undefined; });
      });
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
const FILES = ['util', 'schema', 'storage', 'refs', 'records', 'config', 'google', 'sheet', 'sync'];
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
    AbortSignal,
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
    if (f === 'config') vm.runInContext(`CONFIG.googleClientId = '${configured ? 'test-client' : ''}'`, ctx);
  }
  const app = vm.runInContext('({ Store, Sync, Sheet, Refs, Records })', ctx);
  app.Sync.init({
    toast: (msg, kind) => toasts.push(kind ? `${kind}:${msg}` : msg),
    // 以哪邊為主的小視窗：answer 是 true 選第一個、false 是不選（先不連結）、字串是選那一個
    choose: o => {
      asked.messages.push(o.text);
      return Promise.resolve(asked.answer === true ? o.options[0].key : asked.answer || null);
    },
    notify: m => { notes.push(m.title); inbox.push(m); },
    onLogout: () => { loggedOut.count++; },
  });
  const fire = type => (events[type] || []).forEach(fn => fn());
  return { ...app, ls, toasts, asked, notes, inbox, alerts, loggedOut, nav, fire, popups };
}

const plain = v => JSON.parse(JSON.stringify(v));
const blankDevice = {
  code: '', name: '', status: '使用中', category: '', brand: '', model: '', serial: '', board: '', location: '', keeper: '',
  buyDate: null, price: null, vendor: '', warranty: null, link: '', note: '',
};
// 位置寫的是名字（舊資料、試算表手打的）：同步時建一個位置、換成編號（見 records.js 的 fixPlaceRefs）
const DEVICE = { ...blankDevice, code: 'NB-001', name: '會議室筆電', category: '事務機', location: '3F 會議室', buyDate: '2025-03-15', price: 32000 };
const PRINTER = { ...blankDevice, code: 'PR-001', name: '印表機', category: '印表機' };
const COL = { code: 0, name: 1, status: 2, board: 7, location: 8, keeper: 9, buyDate: 10, price: 11, id: 16 };
// 在試算表裡手打的一列（沒有 id）
const typed = (code, name, status = '使用中') => [code, name, status, '', '', '', '', '', '2F', '', '2026/9/10', '1,200'];

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
  assert.deepEqual(fake.values(id, '設備')[1].slice(0, 4), ['NB-001', '會議室筆電', '使用中', '事務機']);
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
  assert.match(m.body, /設備：會議室筆電/);
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

test('自動抄表的讀信網址：存在 _meta 第 2 列，同步不會蓋掉；其他裝置連結、同步後也有，改了、清掉也跟著', async () => {
  const { fake, d, id } = await linked();
  const first = 'https://script.google.com/macros/s/abc/exec';
  await d.Sync.setMeterUrl(first);
  assert.equal(d.Sync.state().meterUrl, first);
  assert.deepEqual(fake.values(id, '_meta'), [['version', 1], ['meterUrl', first]]);
  d.Store.add('devices', PRINTER);
  await d.Sync.syncNow();
  assert.deepEqual(fake.values(id, '_meta'), [['version', 1], ['meterUrl', first]]);
  assert.equal(d.Sync.state().meterUrl, first);

  const phone = device(fake);
  await phone.Sync.startLink();
  assert.equal(phone.Sync.state().meterUrl, first);

  const second = 'https://script.google.com/macros/s/def/exec';
  await phone.Sync.setMeterUrl(second);
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().meterUrl, second);
  await phone.Sync.setMeterUrl('');
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().meterUrl, '');
});

test('寄信用 Gmail：存在 _meta 第 4 列，不動讀信網址；其他裝置連結、同步後也有', async () => {
  const { fake, d, id } = await linked();
  const url = 'https://script.google.com/macros/s/abc/exec';
  await d.Sync.setMeterUrl(url);
  await d.Sync.setSenderMail('meter.abc@gmail.com');
  assert.equal(d.Sync.state().senderMail, 'meter.abc@gmail.com');
  const meta = fake.values(id, '_meta');
  assert.deepEqual([meta[1], meta[3]], [['meterUrl', url], ['senderMail', 'meter.abc@gmail.com']]);

  const phone = device(fake);
  await phone.Sync.startLink();
  assert.equal(phone.Sync.state().senderMail, 'meter.abc@gmail.com');
  await phone.Sync.setSenderMail('meter.def@gmail.com');
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().senderMail, 'meter.def@gmail.com');
  assert.equal(d.Sync.state().meterUrl, url);
});

test('上次讀信的時間：試算表上的程式寫在 _meta 第 3 列，同步、連結時讀回來；App 按「讀信」拿到的先記下來；設讀信網址不會蓋掉', async () => {
  const { fake, d, id } = await linked();
  assert.equal(d.Sync.state().meterReadAt, '');
  const first = '2026-10-20T05:00:00.000Z';
  fake.write(id, "'_meta'!A3", [['meterReadAt', first]]);
  d.Store.add('devices', PRINTER);
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().meterReadAt, first);
  await d.Sync.setMeterUrl('https://script.google.com/macros/s/abc/exec');
  assert.deepEqual(fake.values(id, '_meta')[2], ['meterReadAt', first]);

  const phone = device(fake);
  await phone.Sync.startLink();
  assert.equal(phone.Sync.state().meterReadAt, first);

});

test('最新回報：試算表上沒有「最新回報」分頁時不讀、也不建；程式建了以後，同步、連結時讀回來', async () => {
  const { fake, d, id } = await linked();
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().toner, null);
  assert.equal(fake.files[id].sheets.some(s => s.title === '最新回報'), false);

  fake.files[id].sheets.push({ sheetId: 500, title: '最新回報', grid: [
    ['序號', '設備', '主機板號碼', '日期', '時間', '黑白張數', '彩色張數', '碳粉K', '碳粉Y', '碳粉M', '碳粉C'],
    ['313CM615862', '26-0001', '', 46316, '08:30', 123490, 2866, 80, 40, 60, 10],
  ] });
  await d.Sync.syncNow();
  const row = { serial: '313CM615862', device: '26-0001', date: '2026-10-21', time: '08:30', bw: 123490, color: 2866, K: 80, Y: 40, M: 60, C: 10 };
  assert.deepEqual(plain(d.Sync.state().toner), [row]);
  assert.deepEqual(JSON.parse(d.ls['devmgr.cloud']).toner, [row]);
  assert.equal(fake.values(id, '最新回報').length, 2);

  const phone = device(fake);
  await phone.Sync.startLink();
  assert.deepEqual(plain(phone.Sync.state().toner), [row]);
});

// 讀信網址：模擬試算表上的程式讀到一封信，寫一列抄表、在 _meta 第 3 列記時間
const METER_URL = 'https://script.google.com/macros/s/abc/exec';
function mailOnce(fake, id, at) {
  fake.meter = () => {
    fake.appendRow(id, '抄表', ['NB-001', 46315, '2026/09', 1200, '', '自動抄表']);
    fake.write(id, "'_meta'!A3", [['meterReadAt', at]]);
    fake.meter = () => { fake.write(id, "'_meta'!A3", [['meterReadAt', at]]); return { count: 0, fixed: 0, at }; };
    return { count: 1, fixed: 0, at };
  };
}
const settle = async d => { do await new Promise(r => setImmediate(r)); while (d.Sync.state().running); };

test('按「同步」：有讀信網址時先叫程式讀信，讀到的這次同步就拿回來，提示寫進幾筆；上次讀信的時間跟著更新', async () => {
  const { fake, d, id } = await linked();
  await d.Sync.setMeterUrl(METER_URL);
  const at = '2026-10-20T06:05:00.000Z';
  mailOnce(fake, id, at);
  const before = fake.calls.length;
  await d.Sync.syncNow();
  const calls = fake.calls.slice(before);
  const mailAt = calls.indexOf('GET /macros/s/abc/exec');
  assert.ok(mailAt >= 0 && mailAt < calls.findIndex(c => c.includes('batchGet')));
  assert.equal(d.Store.list('readings').length, 1);
  assert.equal(d.Sync.state().meterReadAt, at);
  assert.equal(d.toasts.at(-1), '已同步（寫進 1 筆）');
  await d.Sync.syncNow();
  assert.equal(d.toasts.at(-1), '已同步');
});

test('讀信失敗：照樣同步，時間不更新；按「同步」時提示讀信失敗', async () => {
  const { fake, d } = await linked();
  await d.Sync.setMeterUrl(METER_URL);
  d.Store.add('devices', PRINTER);
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().pending, 0);
  assert.equal(d.Sync.state().meterReadAt, '');
  assert.match(d.toasts.at(-1), /^error:已同步，但讀信失敗/);
});

test('程式沒回傳時間（舊版）：照樣同步；按「同步」時提示要重貼程式、換新版本', async () => {
  const { fake, d } = await linked();
  await d.Sync.setMeterUrl(METER_URL);
  fake.meter = () => ({ count: 0 });
  d.Store.add('devices', PRINTER);
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().pending, 0);
  assert.equal(d.Sync.state().meterReadAt, '');
  assert.match(d.toasts.at(-1), /^error:已同步，但試算表上的程式是舊版/);
});

test('沒有讀信網址：同步不讀信；改資料後、連上網路的自動同步也不讀信', async () => {
  const { fake, d, id } = await linked();
  mailOnce(fake, id, '2026-10-20T06:05:00.000Z');
  await d.Sync.syncNow();
  assert.ok(!fake.calls.includes('GET /macros/s/abc/exec'));
  assert.equal(d.toasts.at(-1), '已同步');

  await d.Sync.setMeterUrl(METER_URL);
  d.Store.add('devices', PRINTER);
  d.fire('online');
  await settle(d);
  assert.equal(d.Sync.state().pending, 0);
  assert.ok(!fake.calls.includes('GET /macros/s/abc/exec'));
  assert.equal(d.Store.list('readings').length, 0);
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
  assert.match(other.asked.messages[0], /已經有一份「設備管理」（設備 1 筆、位置 1 筆）/);
  assert.equal(other.Store.list('devices')[0].code, 'PR-001');

  const yes = device(fake, { confirmAnswer: true });
  yes.Store.add('devices', PRINTER);
  await yes.Sync.startLink();
  assert.equal(yes.Sync.state().linked, true);
  assert.deepEqual(plain(yes.Store.list('devices').map(r => r.code)), ['NB-001']); // 改用雲端的資料
});

test('兩邊都有資料時選「以這台為主」：試算表整份換成這台的資料', async () => {
  const { fake, id } = await linked();
  const other = device(fake, { confirmAnswer: 'local' });
  other.Store.add('devices', PRINTER);
  await other.Sync.startLink();
  assert.equal(other.Sync.state().linked, true);
  assert.deepEqual(fake.values(id, '設備').slice(1).map(r => r[COL.code]), ['PR-001']);
  assert.deepEqual(plain(other.Store.list('devices').map(r => r.code)), ['PR-001']);
  assert.equal(other.Sync.state().pending, 0);
  assert.ok(other.notes.includes('已改用這台的資料'));
});

test('匯入 data.json、以 Google 為主：只加入試算表沒有的，試算表上原本的不動', async () => {
  const { fake, d, id } = await linked();
  const nb = d.Store.list('devices')[0];
  const file = d.Store.parseImport({ devices: [{ ...nb, name: '舊名字' }, { ...PRINTER, id: 'p9' }] });
  const extra = d.Records.fileOnly(file);
  assert.deepEqual(plain(extra.map(e => e.rec.id)), ['p9']);
  d.Store.addAll(extra);
  await d.Sync.syncNow();
  assert.deepEqual(fake.values(id, '設備').slice(1).map(r => r[COL.name]), ['會議室筆電', '印表機']);
  assert.equal(d.Sync.state().pending, 0);
});

test('匯入 data.json 後整份重寫試算表', async () => {
  const { fake, d, id } = await linked();
  fake.appendRow(id, '設備', typed('MN-001', '螢幕'));
  d.Store.replaceAll(d.Store.parseImport({ devices: [{ ...PRINTER, id: 'p9' }] }));
  await d.Sync.syncNow();
  assert.deepEqual(fake.values(id, '設備').map(r => r[COL.id]), ['id', 'p9']);
  assert.equal(d.Sync.state().pending, 0);
});

test('匯入 data.json 裡的最新回報（假資料）：同步後還在、匯出也有；匯入沒有最新回報的檔案就清掉', async () => {
  const { d } = await linked();
  const row = { serial: '3101R800451', device: 'PR-001', date: '2026-10-21', time: '08:12', bw: 45678, color: 1234, K: 70, Y: 50, M: 60, C: 40 };
  d.Store.replaceAll(d.Store.parseImport({ devices: [{ ...PRINTER, id: 'p9' }], toner: [row] }));
  await d.Sync.syncNow();
  assert.deepEqual(plain(d.Store.toner()), [row]);
  assert.deepEqual(plain(d.Store.exportPayload().toner), [row]);
  d.Store.replaceAll(d.Store.parseImport({ devices: [] }));
  assert.equal(d.Store.toner(), null);
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

// ---------- 清單（選項、人員、廠商） ----------
test('連結：只有預設的項目（類別、保養項目、選配件）時不算這台裝置的資料，不詢問；預設的項目也存進試算表', async () => {
  const fake = new FakeGoogle();
  const d = device(fake, { confirmAnswer: false });
  await d.Sync.startLink();
  assert.deepEqual(d.asked.messages, []);
  assert.equal(d.Sync.state().linked, true);
  const id = d.Sync.state().url.split('/').pop();
  assert.deepEqual(fake.values(id, '選項')[0], ['清單', '名稱', '順序', '停用', '世代', '壽命（張）', '算哪種張數', 'id']);
  assert.equal(fake.values(id, '選項').length, 16); // 類別 3、保養項目 8、選配件 4
  assert.deepEqual(fake.values(id, '選項')[1].slice(0, 4), ['類別', '事務機', 1, false]);
});

test('連結：試算表上只有預設的類別時，當作雲端還沒有資料，這台裝置的資料存過去', async () => {
  const fake = new FakeGoogle();
  const first = device(fake);
  await first.Sync.startLink(); // 只有預設的類別
  const id = first.Sync.state().url.split('/').pop();
  const d = device(fake);
  d.Store.add('devices', DEVICE);
  await d.Sync.startLink();
  assert.equal(d.asked.messages.length, 1);
  assert.match(d.asked.messages[0], /這台裝置上有 1 筆資料，會存到/);
  assert.equal(fake.values(id, '設備').length, 2);
  assert.equal(d.Store.list('devices').length, 1);
});

test('兩邊都有資料時，詢問的訊息只列出真的有資料的表', async () => {
  const { fake } = await linked();
  const other = device(fake, { confirmAnswer: false });
  other.Store.add('devices', PRINTER);
  await other.Sync.startLink();
  assert.match(other.asked.messages[0], /已經有一份「設備管理」（設備 1 筆、位置 1 筆）。/);
});

test('試算表少了選填的欄（舊版建立的、被刪掉的）：補在最後面，用這台裝置的資料填上，App 裡的資料不會被清掉', async () => {
  const { fake, d, id } = await linked();
  const dev = d.Store.list('devices')[0];
  d.Store.update('devices', dev.id, { model: 'B5402', note: '附充電器' });
  await d.Sync.syncNow();
  // 刪掉「機型」那一欄（第 6 欄）
  fake.sheet(id, '設備').grid.forEach(row => row.splice(5, 1));
  await d.Sync.syncNow();
  const st = d.Sync.state();
  assert.equal(st.error, '');
  assert.deepEqual(plain(st.problems), []);
  assert.equal(st.pending, 0);
  assert.equal(d.Store.list('devices')[0].model, 'B5402');
  const rows = fake.values(id, '設備');
  assert.equal(rows[0].at(-1), '機型');
  assert.equal(rows[0].at(-2), 'id');
  assert.equal(rows[1].at(-1), 'B5402');
  // 再同步一次：已經補好，不會再補
  await d.Sync.syncNow();
  assert.equal(fake.values(id, '設備')[0].filter(h => h === '機型').length, 1);
  // 在試算表裡改補上的那一欄，讀得回來
  fake.setCell(id, '設備', 2, rows[0].length - 1, 'X13');
  await d.Sync.syncNow();
  assert.equal(d.Store.list('devices')[0].model, 'X13');
});

test('試算表少了選填的欄，同一次也有新增的設備：新的那一列也寫在補上的欄', async () => {
  const { fake, d, id } = await linked();
  fake.sheet(id, '設備').grid.forEach(row => row.splice(5, 1));
  d.Store.add('devices', { ...PRINTER, model: 'L3210' });
  await d.Sync.syncNow();
  const rows = fake.values(id, '設備');
  assert.equal(rows[0].at(-1), '機型');
  assert.equal(rows[2][rows[0].length - 1], 'L3210');
});

// 人員的「業務員」（核取方塊）是 2026-10-31 補的欄：Google 會把整欄的空白格填成 FALSE
const person = (d, more) => ({ ...d.Refs.blankRecord('people'), ...more });
const dropCols = (fake, id, tab, names) => {
  const g = fake.sheet(id, tab).grid;
  const cols = names.map(n => g[0].indexOf(n)).filter(i => i >= 0).sort((a, b) => b - a);
  g.forEach(row => cols.forEach(c => row && row.splice(c, 1)));
};

test('舊的試算表補上「業務員」欄（核取方塊，Google 把整欄空白格填成 FALSE）：同一次清掉資料下面的格子，新增的人接在資料下面，不會多出沒有姓名的人員', async () => {
  const { fake, d, id } = await linked();
  d.Store.add('people', person(d, { name: '舊人' }));
  await d.Sync.syncNow();
  dropCols(fake, id, '人員', ['業務員', '權限']);
  d.Store.add('people', person(d, { name: '阿明', email: 'a@gmail.com', sales: true, perms: '記抄表' }));
  await d.Sync.syncNow();
  await d.Sync.syncNow();
  const rows = fake.values(id, '人員');
  assert.deepEqual(rows.map(r => r[0]), ['姓名', '舊人', '阿明']);
  assert.equal(rows[2][rows[0].indexOf('業務員')], true);
  assert.deepEqual(plain(d.Sync.state().problems), []);
  assert.equal(d.Store.list('people').length, 2);
});

test('試算表裡已經有只有 id、沒勾核取方塊的列（上一版補欄後留下的）：同步時刪掉，App 裡讀進來的沒有姓名的人員直接拿掉，不用問、不用提醒', async () => {
  const { fake, d, id } = await linked();
  d.asked.answer = false; // 問的話選「保留，並寫回試算表」，問了就會把沒有姓名的寫回去
  d.Store.add('people', person(d, { name: '舊人' }));
  await d.Sync.syncNow();
  // 上一版的樣子：第 3～20 列只有 FALSE 和 id（App 也讀進來了），新增的人在最下面
  const g = fake.sheet(id, '人員').grid;
  const [sales, idCol] = ['業務員', 'id'].map(h => g[0].indexOf(h));
  for (let r = 2; r < 20; r++) {
    g[r] = [];
    g[r][sales] = false;
    g[r][idCol] = `j${r}`;
    d.Store.add('people', person(d, { id: `j${r}` }));
  }
  g[20] = [];
  g[20][0] = '阿明';
  g[20][sales] = true;
  g[20][idCol] = 'p-amin';
  d.Store.add('people', person(d, { id: 'p-amin', name: '阿明', sales: true }));
  d.Store.clearAllPending();
  d.asked.messages.length = 0;
  await d.Sync.syncNow();
  assert.deepEqual(fake.values(id, '人員').map(r => r[0]), ['姓名', '舊人', '阿明']);
  assert.deepEqual(plain(d.Store.list('people').map(p => p.name)).sort(), ['舊人', '阿明']);
  assert.deepEqual(d.asked.messages, []);
  assert.ok(!d.notes.some(n => /試算表/.test(n)));
  assert.deepEqual(plain(d.Sync.state().problems), []);
  assert.equal(d.Sync.state().pending, 0);
});

test('在試算表裡改了清單的名字：用到舊名字的設備一起改，同一次寫回試算表', async () => {
  const { fake, d, id } = await linked();
  const opts = fake.values(id, '選項');
  const row = opts.findIndex(r => r[1] === '事務機') + 1;
  fake.setCell(id, '選項', row, 1, '多功能事務機');
  await d.Sync.syncNow();
  assert.equal(d.Store.list('devices')[0].category, '多功能事務機');
  assert.equal(fake.values(id, '設備')[1][3], '多功能事務機');
  assert.equal(d.Sync.state().pending, 0);
  // 再同步一次不會再改
  const calls = fake.calls.length;
  await d.Sync.syncNow();
  assert.ok(!fake.calls.slice(calls).some(c => c.includes(':append')));
});

test('在這台裝置改了清單的名字（還沒同步），試算表也改了別的名字：以這台的為準', async () => {
  const { fake, d, id } = await linked();
  const opt = d.Store.list('options').find(o => o.name === '事務機');
  const before = { ...opt };
  d.Store.update('options', opt.id, { name: '影印機' });
  d.Refs?.renameRefs?.('options', before, d.Store.get('options', opt.id));
  const row = fake.values(id, '選項').findIndex(r => r[1] === '事務機') + 1;
  fake.setCell(id, '選項', row, 1, '多功能事務機');
  await d.Sync.syncNow();
  assert.equal(d.Store.get('options', opt.id).name, '影印機');
  assert.equal(fake.values(id, '選項')[row - 1][1], '影印機');
});

test('在試算表裡勾「停用」、新增人員（沒有 id），同步後 App 也有', async () => {
  const { fake, d, id } = await linked();
  const row = fake.values(id, '選項').findIndex(r => r[1] === '碎紙機') + 1;
  fake.setCell(id, '選項', row, 3, true);
  fake.appendRow(id, '人員', ['王小明', 'e001', '資訊組長', '', '', '', '', '', '', '2020/2/1', '', '備註']);
  await d.Sync.syncNow();
  assert.equal(d.Store.list('options').find(o => o.name === '碎紙機').disabled, true);
  const p = d.Store.list('people')[0];
  assert.equal(p.name, '王小明');
  assert.equal(p.joinDate, '2020-02-01');
  assert.equal(p.note, '備註');
  assert.equal(fake.values(id, '人員')[1][12], p.id);
  assert.deepEqual(plain(d.Sync.state().problems), []);
});

test('試算表刪掉選項：提醒寫出是哪一份清單的哪一項', async () => {
  const { fake, d, id } = await linked();
  const row = fake.values(id, '選項').findIndex(r => r[1] === '打卡鐘');
  fake.sheet(id, '選項').grid.splice(row, 1);
  await d.Sync.syncNow();
  assert.match(d.inbox.at(-1).body, /選項：類別 打卡鐘/);
});

test('舊版建立的試算表沒有人員、廠商分頁：補建回來，不算看不懂的地方', async () => {
  const { fake, d, id } = await linked();
  fake.files[id].sheets = fake.files[id].sheets.filter(s => s.title !== '人員' && s.title !== '廠商');
  d.Store.add('people', { ...d.Refs.blankRecord('people'), name: '王小明' });
  await d.Sync.syncNow();
  assert.equal(d.Sync.state().error, '');
  assert.deepEqual(plain(d.Sync.state().problems), []);
  assert.equal(fake.values(id, '人員')[1][0], '王小明');
  assert.deepEqual(fake.values(id, '廠商'), [['名稱', '聯絡人', '電話', '地址', '停用', '備註', 'id']]);
});

// ---------- 設備的編號（系統產生） ----------
test('在試算表裡手打、沒填編號的設備：同步時補上編號，同一次寫回試算表，不算看不懂的地方', async () => {
  const { fake, d, id } = await linked();
  fake.appendRow(id, '設備', ['', '影印機', '出租中', '', '', '', '', '', '', '', '2025/3/1']);
  await d.Sync.syncNow();
  const dev = d.Store.list('devices').find(r => r.name === '影印機');
  assert.equal(dev.code, '25-0001');
  assert.equal(fake.values(id, '設備')[2][COL.code], '25-0001');
  assert.deepEqual(plain(d.Sync.state().problems), []);
  assert.equal(d.Sync.state().pending, 0);
  assert.deepEqual(d.inbox.filter(m => /編號/.test(m.title)), []); // 補上的不用提醒
});

test('兩台裝置沒網路時各新增一台、拿到同一個編號：同步時後新增的那台換下一號（編號畫面上看不到，不用提醒）', async () => {
  const { fake, d } = await linked();
  const phone = device(fake);
  await phone.Sync.startLink();
  fake.offline = true;
  const a = d.Store.add('devices', { ...PRINTER, name: '電腦上新增的', code: '26-0001' });
  await new Promise(r => setTimeout(r, 2)); // 讓 id 的時間分得出先後
  const b = phone.Store.add('devices', { ...PRINTER, name: '手機上新增的', code: '26-0001' });
  await d.Sync.syncNow();
  await phone.Sync.syncNow();
  fake.offline = false;
  await d.Sync.syncNow();
  await phone.Sync.syncNow();
  assert.equal(phone.Store.get('devices', a.id).code, '26-0001');
  assert.equal(phone.Store.get('devices', b.id).code, '26-0002');
  assert.equal(phone.inbox.filter(x => /編號/.test(x.title)).length, 0);
  // 另一台同步後也一樣，不會再換一次
  await d.Sync.syncNow();
  assert.equal(d.Store.get('devices', b.id).code, '26-0002');
  assert.equal(d.Store.get('devices', a.id).code, '26-0001');
  assert.equal(d.inbox.filter(x => /編號重複/.test(x.title)).length, 0);
});

// ---------- 紀錄 ----------
test('在試算表裡加了一筆異動（沒有 id、新位置打名字）：換成位置編號、沒有的建一個，設備的位置跟著改，同一次寫回試算表', async () => {
  const { fake, d, id } = await linked();
  const dev = d.Store.list('devices')[0];
  fake.appendRow(id, '異動', [dev.code, '2026/10/1', '移機', '3F 會議室', '大華貿易 3F']);
  await d.Sync.syncNow();
  const to = d.Store.get('devices', dev.id).location;
  assert.match(to, /^L\d{4}$/);
  assert.equal(d.Records.placeName(to), '大華貿易 3F');
  const move = d.Store.list('moves')[0];
  assert.equal(move.to, to);
  assert.equal(d.Records.placeName(move.from), '3F 會議室');
  assert.equal(fake.values(id, '設備').find(r => r[COL.id] === dev.id)[COL.location], to);
  assert.equal(fake.values(id, '異動')[1][4], to); // 異動那一列也換成編號
  assert.deepEqual(fake.values(id, '位置').slice(1).map(r => r[1]).sort(), ['3F 會議室', '大華貿易 3F']);
  assert.equal(d.Sync.state().pending, 0);
  assert.deepEqual(plain(d.Sync.state().problems), []);
});

test('在試算表裡改了位置的名字：舊名字記在「以前的名字」，同一次寫回試算表；設備存的編號不用改', async () => {
  const { fake, d, id } = await linked();
  await d.Sync.syncNow();
  const code = d.Store.list('devices')[0].location;
  const row = fake.values(id, '位置').findIndex(r => r[0] === code) + 1;
  fake.setCell(id, '位置', row, 1, '3F 大會議室');
  await d.Sync.syncNow();
  const p = d.Store.list('locations').find(x => x.code === code);
  assert.equal(p.name, '3F 大會議室');
  assert.match(p.oldNames, /^3F 會議室（到 \d{4}\/\d{2}\/\d{2}）$/);
  assert.equal(fake.values(id, '位置')[row - 1][2], p.oldNames);
  assert.equal(d.Store.list('devices')[0].location, code);
  assert.equal(d.Sync.state().pending, 0);
});

test('在試算表裡改了合約：記在合約修改紀錄，同一次寫回試算表；再同步不會重複記', async () => {
  const { fake, d, id } = await linked();
  await d.Sync.syncNow();
  const code = d.Store.list('devices')[0].location;
  const c = d.Store.add('contracts', {
    locations: code, signDate: '2026-01-05', endDate: '2028-12-31', earlyEnd: null, content: '', billing: '', readDay: '每月 25 號',
  });
  await d.Sync.syncNow();
  assert.equal(d.Store.list('contractLog').length, 0);
  // 合約的欄：位置、簽約日、到期日、提前結束日、合約內容、計費方式、抄表日期、抄表週期、id
  fake.setCell(id, '合約', 2, 6, '每月 5 號');
  await d.Sync.syncNow();
  assert.equal(d.Store.get('contracts', c.id).readDay, '每月 5 號');
  assert.deepEqual(plain(d.Store.list('contractLog').map(r => [r.contract, r.field, r.before, r.after])), [[c.id, '抄表日期', '每月 25 號', '每月 5 號']]);
  assert.deepEqual(fake.values(id, '合約修改紀錄').slice(1).map(r => r.slice(2, 5)), [['抄表日期', '每月 25 號', '每月 5 號']]);
  assert.equal(d.Sync.state().pending, 0);
  await d.Sync.syncNow();
  assert.equal(d.Store.list('contractLog').length, 1);
});

test('兩台裝置各新增一台、拿到同一個編號：換號的那台在這台裝置上新增的紀錄跟著換', async () => {
  const { fake, d } = await linked();
  const phone = device(fake);
  await phone.Sync.startLink();
  fake.offline = true;
  d.Store.add('devices', { ...PRINTER, name: '電腦上新增的', code: '26-0001' });
  d.Store.add('readings', { device: '26-0001', date: '2026-10-01', bw: 100, color: null, note: '' });
  await new Promise(r => setTimeout(r, 2)); // 讓 id 的時間分得出先後
  const b = phone.Store.add('devices', { ...PRINTER, name: '手機上新增的', code: '26-0001' });
  const rb = phone.Store.add('readings', { device: '26-0001', date: '2026-10-02', bw: 200, color: null, note: '' });
  fake.offline = false;
  await d.Sync.syncNow();
  await phone.Sync.syncNow();
  assert.equal(phone.Store.get('devices', b.id).code, '26-0002');
  assert.equal(phone.Store.get('readings', rb.id).device, '26-0002');
  assert.equal(phone.Store.list('readings').find(r => r.id !== rb.id).device, '26-0001');
  await d.Sync.syncNow();
  assert.equal(d.Store.get('readings', rb.id).device, '26-0002');
});

// ---------- 業務員：向總部試算表上的程式拿資料（見 sync.js 的業務員、apps-script/meter.gs 的 salesData_） ----------
// 模擬總部的程式：用 meter.gs 的 salesPerson_、salesRows_ 從總部的試算表挑列；fake.salesEmail 是業務員登入的帳號
const meter = vm.createContext({});
vm.runInContext(readFileSync(new URL('apps-script/meter.gs', ROOT), 'utf8'), meter, { filename: 'meter.gs' });
const { salesPerson_, salesRows_, salesPlan_ } = vm.runInContext('({ salesPerson_, salesRows_, salesPlan_ })', meter);
const HQ = 'https://script.google.com/macros/s/hq/exec';
//   送出（salesAdd）：一樣用 meter.gs 的 salesPlan_；新增的照試算表的標題列加在最下面、輸入的人寫名字，回報的只改業務員回報那一格
function salesServer(fake, id) {
  const who = () => {
    const values = Object.fromEntries(fake.files[id].sheets.map(s => [s.title, FakeGoogle.read(s.grid)]));
    const today = Sheet0.toSerial(new Date().toISOString().slice(0, 10));
    return { values, person: salesPerson_(values['人員'], fake.salesEmail, today) };
  };
  const denied = () => ({ error: `${fake.salesEmail} 不是業務員，請找管理員`, denied: true });
  fake.sales = () => {
    const { values, person } = who();
    if (!person) return denied();
    return { ...person, email: fake.salesEmail, admin: 'hq@example.com', values: salesRows_(values, person) };
  };
  fake.salesAdd = body => {
    const { values, person } = who();
    if (!person) return denied();
    return { results: body.items.map(item => {
      const plan = salesPlan_(values, person, item);
      if (plan.error) return plan;
      const grid = fake.sheet(id, item.tab).grid;
      if (plan.kind === 'report') {
        grid.find(r => r[grid[0].indexOf('id')] === plan.id)[grid[0].indexOf('業務員回報')] = plan.report;
      } else {
        const fixed = { 輸入的人: plan.by, 業務員回報: plan.report };
        grid.push(grid[0].map(h => (h in fixed ? fixed[h] : item.head.indexOf(h) < 0 ? undefined : item.row[item.head.indexOf(h)])));
      }
      return { id: plan.id, ok: true };
    }) };
  };
}
const Sheet0 = device(new FakeGoogle()).Sheet;

// 總部：阿明負責大華，長榮是別人的；大華、長榮各放一台，各抄過一次表
async function hq() {
  const { fake, d, id } = await linked();
  const add = (t, rec) => d.Store.add(t, { ...d.Refs.blankRecord(t), ...rec });
  add('people', { name: '阿明', email: 'a@gmail.com', sales: true, perms: '記抄表' });
  add('people', { name: '小華', email: 'x@gmail.com' });
  add('locations', { code: 'L0001', name: '大華貿易', sales: '阿明' });
  add('locations', { code: 'L0002', name: '長榮航運' });
  add('devices', { ...PRINTER, code: '26-0001', name: '#1001', location: 'L0001' });
  add('devices', { ...PRINTER, code: '26-0002', name: '#1002', location: 'L0002' });
  add('readings', { device: '26-0001', date: '2026-10-01', bw: 100 });
  add('readings', { device: '26-0002', date: '2026-10-01', bw: 200 });
  add('contracts', { locations: 'L0001、L0002', signDate: '2026-01-01', endDate: '2027-12-31' });
  await d.Sync.syncNow();
  salesServer(fake, id);
  return { fake, d, id };
}

test('業務員：打開邀請連結登入，向總部的程式拿他負責的客戶；別的位置寫「其他位置」，設備頁只有他的；不碰試算表', async () => {
  const { fake } = await hq();
  fake.salesEmail = 'a@gmail.com';
  const s = device(fake, { token: false });
  const calls = fake.calls.length;
  await s.Sync.join(HQ);
  const st = s.Sync.state();
  assert.equal(st.sales, true);
  assert.equal(st.salesName, '阿明');
  assert.equal(st.admin, 'hq@example.com');
  assert.equal(st.error, '');
  assert.ok(s.toasts.includes('已登入：業務員 阿明'));
  assert.deepEqual(plain(s.Store.list('locations').map(p => p.name)), ['大華貿易']);
  assert.deepEqual(plain(s.Records.shownDevices().map(x => x.code)), ['26-0001']);
  assert.deepEqual(plain(s.Store.list('readings').map(r => r.bw)), [100]);
  assert.equal(s.Store.list('contracts').length, 1);
  assert.equal(s.Records.placeName('L0002'), '其他位置');
  assert.deepEqual(plain(s.Store.list('people').map(p => p.name)), ['阿明', '小華']);
  assert.equal(s.Store.list('people')[0].email, undefined); // 人員只有名字
  // 只打總部的程式（先叫它讀信、再拿資料），不碰試算表、雲端硬碟
  assert.deepEqual(fake.calls.slice(calls), ['GET /macros/s/hq/exec', 'POST /macros/s/hq/exec']);
  assert.equal(s.Sync.salesCan('readings'), true); // 阿明有記抄表
  assert.equal(s.Sync.salesCan('maintenance'), false);
  assert.equal(s.Records.canAdd('moves'), false);
  // 業務員沒有登出（要用「離開」）
  await s.Sync.logout();
  assert.equal(s.loggedOut.count, 0);
});

test('業務員：人員沒勾業務員（或離職）時拿不到資料，這台的資料清掉，請他找管理員；可以離開', async () => {
  const { fake } = await hq();
  fake.salesEmail = 'a@gmail.com';
  const s = device(fake, { token: false });
  await s.Sync.join(HQ);
  assert.equal(s.Store.list('locations').length, 1);
  fake.salesEmail = 'x@gmail.com'; // 換成沒勾業務員的人
  await s.Sync.syncNow();
  const st = s.Sync.state();
  assert.equal(st.denied, true);
  assert.equal(st.error, 'x@gmail.com 不是業務員，請找管理員');
  assert.equal(s.Store.list('locations').length, 0);
  assert.equal(s.Store.list('devices').length, 0);
  await s.Sync.leave();
  assert.equal(s.loggedOut.count, 1);
  assert.equal(s.Sync.state().linked, false);
  assert.ok(!Object.keys(s.ls).some(k => k.startsWith('devmgr.') && k !== 'devmgr.google.token'));
});

test('業務員：總部的程式還是舊版（不認得拿資料，回「密語不對」）時寫請管理員更新；登入過期時請他重新登入', async () => {
  const { fake } = await hq();
  fake.sales = () => ({ error: '密語不對' });
  const s = device(fake, { token: false });
  await s.Sync.join(HQ);
  assert.equal(s.Sync.state().error, '總部試算表上的程式是舊版，請找管理員更新');
  fake.sales = () => ({ error: '登入已過期，請重新登入', login: true });
  await s.Sync.syncNow();
  assert.equal(s.Sync.state().needLogin, true);
  assert.equal(s.Sync.state().error, '');
});

test('管理員登出時可以換掉確認的文字（換成業務員時用）', async () => {
  const { d } = await linked();
  await d.Sync.logout('確定換成業務員？');
  assert.equal(d.asked.messages.at(-1), '確定換成業務員？');
  assert.equal(d.loggedOut.count, 1);
});

test('業務員新增抄表：送給總部的程式寫進試算表（照試算表的標題排），再拿回來；沒有權限、不是他的機器的寫在提醒，拿回來時就不見了', async () => {
  const { fake, id } = await hq();
  fake.salesEmail = 'a@gmail.com';
  const s = device(fake, { token: false });
  await s.Sync.join(HQ);
  const add = (t, rec) => s.Store.add(t, { ...s.Refs.blankRecord(t), ...rec });
  add('readings', { device: '26-0001', date: '2026-10-31', month: '2026-10', bw: 150 });
  assert.equal(s.Sync.state().pending, 1);
  await s.Sync.syncNow();
  const rows = fake.values(id, '抄表');
  const last = rows.at(-1);
  assert.equal(last[rows[0].indexOf('設備')], '26-0001');
  assert.equal(last[rows[0].indexOf('黑白張數')], 150);
  assert.equal(last[rows[0].indexOf('結算月份')], '2026/10');
  assert.equal(s.Sync.state().pending, 0);
  assert.deepEqual(plain(s.Store.list('readings').map(r => r.bw)).sort(), [100, 150]);
  // 沒有記保養的權限、別人的機器：沒寫進總部，提醒寫原因，拿回來時不見了
  add('maintenance', { device: '26-0001', date: '2026-10-31', item: '碳粉' });
  add('readings', { device: '26-0002', date: '2026-10-31', bw: 5 });
  await s.Sync.syncNow();
  const note = s.inbox.find(m => m.title === '有 2 筆沒有送出');
  assert.ok(note, plain(s.notes).join('|'));
  assert.match(note.body, /沒有「記保養」的權限/);
  assert.match(note.body, /這台不在你負責的位置/);
  assert.equal(s.Store.list('maintenance').length, 0);
  assert.deepEqual(plain(s.Store.list('readings').map(r => r.bw)).sort(), [100, 150]);
  assert.equal(fake.values(id, '抄表').length, rows.length);
  // 沒網路時先存著，連上再送
  fake.offline = true;
  add('readings', { device: '26-0001', date: '2026-11-01', bw: 160 });
  await s.Sync.syncNow();
  assert.equal(s.Sync.state().pending, 1);
  assert.ok(s.Store.list('readings').some(r => r.bw === 160));
  fake.offline = false;
  await s.Sync.syncNow();
  assert.equal(s.Sync.state().pending, 0);
  assert.equal(fake.values(id, '抄表').at(-1)[rows[0].indexOf('黑白張數')], 160);
});

test('業務員勾了看全部：拿到所有位置和機器，別人的機器也可以記抄表', async () => {
  const { fake, d, id } = await hq();
  const amin = d.Store.list('people').find(p => p.name === '阿明');
  d.Store.update('people', amin.id, { all: true });
  await d.Sync.syncNow();
  fake.salesEmail = 'a@gmail.com';
  const s = device(fake, { token: false });
  await s.Sync.join(HQ);
  assert.equal(s.Sync.state().salesAll, true);
  assert.deepEqual(plain(s.Store.list('locations').map(p => p.name)).sort(), ['3F 會議室', '大華貿易', '長榮航運']);
  assert.equal(s.Records.shownDevices().length, 3);
  s.Store.add('readings', { ...s.Refs.blankRecord('readings'), device: '26-0002', date: '2026-10-31', bw: 300 });
  await s.Sync.syncNow();
  assert.equal(s.inbox.filter(m => /沒有送出/.test(m.title)).length, 0);
  assert.equal(fake.values(id, '抄表').at(-1)[0], '26-0002');
});

test('業務員回報問題：打開一筆抄表只改業務員回報，總部那一格前面加他的名字，其他欄不動；新增的「輸入的人」是他；管理員同步後看得到', async () => {
  const { fake, d, id } = await hq();
  fake.salesEmail = 'a@gmail.com';
  const s = device(fake, { token: false });
  await s.Sync.join(HQ);
  s.Store.add('readings', { ...s.Refs.blankRecord('readings'), device: '26-0001', date: '2026-10-31', bw: 150 });
  await s.Sync.syncNow();
  const h = fake.values(id, '抄表')[0];
  assert.equal(fake.values(id, '抄表').at(-1)[h.indexOf('輸入的人')], '阿明');
  // 管理員輸入的那筆（100）：業務員只能寫回報；就算別的欄也改了，總部只改回報那一格
  const r = s.Store.list('readings').find(x => x.bw === 100);
  assert.equal(s.Sync.salesSee('readings'), true);
  assert.equal(s.Sync.salesSee('moves'), false);
  s.Store.update('readings', r.id, { bw: 999, report: '張數打錯，應該是 120' });
  await s.Sync.syncNow();
  const row = fake.values(id, '抄表').find(x => x[h.indexOf('id')] === r.id);
  assert.equal(row[h.indexOf('業務員回報')], '阿明：張數打錯，應該是 120');
  assert.equal(row[h.indexOf('黑白張數')], 100);
  assert.equal(s.Store.get('readings', r.id).bw, 100);
  assert.equal(s.Store.get('readings', r.id).report, '阿明：張數打錯，應該是 120');
  await d.Sync.syncNow();
  assert.equal(d.Store.get('readings', r.id).report, '阿明：張數打錯，應該是 120');
  assert.equal(d.Store.list('readings').find(x => x.bw === 150).by, '阿明');
});
