// 離線用的 service worker（sw.js）：存的檔案、版本號
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// 在 GitHub Pages 上的樣子：https://帳號.github.io/repo/sw.js?v=版本號
function load(v = '2026.10.11.1') {
  const ctx = vm.createContext({
    self: { addEventListener() {} },
    location: { href: `https://example.github.io/devicemanager/sw.js?v=${v}` },
    URL,
  });
  vm.runInContext(read('sw.js'), ctx, { filename: 'sw.js' });
  return vm.runInContext('({ VERSION, PREFIX, CACHE, ROOT, PAGES, refs })', ctx);
}

test('存的那份跟著版本號：換版本就是新的一份', () => {
  const sw = load('2026.10.11.7');
  assert.equal(sw.VERSION, '2026.10.11.7');
  assert.equal(sw.CACHE, 'devmgr-2026.10.11.7');
  assert.equal(sw.ROOT, 'https://example.github.io/devicemanager/');
});

test('快取名稱和同一個網址底下的其他 App 分開（只刪 devmgr- 開頭的）', () => {
  const sw = load();
  assert.equal(sw.PREFIX, 'devmgr-');
  assert.match(read('sw.js'), /k\.startsWith\(PREFIX\) && k !== CACHE/);
});

test('首頁載入的每個 css、js、manifest、圖示都會存起來（新增 js 不用改 sw.js）', () => {
  const sw = load();
  const html = read('index.html');
  const saved = new Set(sw.refs(html));
  const local = [...html.matchAll(/(?:src|href)="((?:js\/|css\/|icons\/|manifest\.json)[^"]*)"/g)].map(m => m[1]);
  assert.ok(local.length > 10);
  for (const f of local) assert.ok(saved.has(f), f);
  // 外站（Google 登入）不存
  assert.ok([...saved].every(f => !f.includes('//')));
});

test('存的頁面都在', () => {
  const sw = load();
  for (const page of sw.PAGES) assert.ok(read(page === './' ? 'index.html' : page).length > 0, page);
});

test('app.js 登記 service worker 時帶著自己網址上的版本號', () => {
  const app = read('js/app.js');
  assert.match(app, /serviceWorker\.register\(`sw\.js\?v=\$\{encodeURIComponent\(v\)\}`\)/);
  assert.match(app, /document\.currentScript\?\.src/);
});
