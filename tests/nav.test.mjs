// 分頁：底部 6 格、更多裡一格一個、電腦版的側欄全部展開（index.html、js/app.js）；表單的位置欄、連點
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const html = read('index.html');
const app = read('js/app.js');
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));

const tabbar = between(html, 'class="tabbar-inner"', '</nav>');
const buttons = [...tabbar.matchAll(/<button [^>]*>/g)].map(m => m[0]);
const tabOf = b => b.match(/data-tab="([^"]+)"/)?.[1];
const more = between(html, 'id="more-panel"', '<!-- 新增／編輯表單 -->');

test('手機底部 6 格：總覽、客戶、位置、設備、抄表、更多', () => {
  const phone = buttons.filter(b => !b.includes('side-only') && !b.includes('side-settings')).map(b => tabOf(b) || b.match(/id="([^"]+)"/)[1]);
  assert.deepEqual(phone, ['overview', 'customers', 'locations', 'devices', 'readings', 'btn-more']);
});

test('更多裡的頁，電腦版的側欄全部都有，一樣的順序', () => {
  const inMore = [...more.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]);
  const inSide = buttons.filter(b => b.includes('side-only')).map(tabOf);
  assert.deepEqual(inMore, ['contracts', 'maintenance', 'refurbs', 'moves', 'people']);
  assert.deepEqual(inSide, inMore);
  // 這些頁打開時底部的更多要亮著
  assert.deepEqual(JSON.parse(app.match(/const IN_MORE = (\[.*?\]);/)[1].replace(/'/g, '"')), inMore);
});

test('更多和側欄都能到設定；右上角的 ⋯、紀錄那一格、上方切換都拿掉了', () => {
  assert.match(more, /id="more-settings"/);
  assert.match(tabbar, /id="side-settings"/);
  for (const gone of ['btn-menu', 'id="subtabs"', 'data-tab="records"']) assert.ok(!html.includes(gone), gone);
  assert.ok(!read('css/style.css').includes('.subtabs'));
});

test('業務員看不到人員：更多、側欄都藏起來，也不會停在人員頁', () => {
  const people = [...html.matchAll(/<button [^>]*data-tab="people"[^>]*>/g)].map(m => m[0]);
  assert.equal(people.length, 2);
  for (const b of people) assert.ok(b.includes('admin-only'), b);
  assert.match(app, /key === 'people' && Sync\.isSales\(\)/);
  // 側欄的按鈕是 display: flex，要贏得過
  assert.match(read('css/style.css'), /\.sales \.tabbar button\.admin-only \{ display: none; \}/);
});

test('畫面變寬成側欄時更多會關掉，不然頁面卡住不能捲', () => {
  assert.match(app, /matchMedia\('\(min-width: 960px\)'\)\.addEventListener\('change', e => \{ if \(e\.matches\) setMore\(false\); \}\)/);
});

test('人員不列在設定的清單裡，廠商還在', () => {
  assert.match(app, /!\['locations', 'customers', 'people'\]\.includes\(l\.table\)/);
  assert.match(app, /\['廠商', \['vendors'\]\]/);
});

test('詳情最上面寫是哪一種，名稱寫在下面的卡片', () => {
  for (const [id, word] of [['detail-sheet', '設備'], ['place-sheet', '位置'], ['customer-sheet', '客戶']]) {
    assert.match(between(html, `<dialog id="${id}"`, '</dialog>'), new RegExp(`<h2 class="sheet-title">${word}</h2>`), id);
  }
});

test('打了字馬上按儲存：先換成打的值才檢查，不會存到原本的', () => {
  const save = between(read('js/form.js'), 'function save(again = false)', 'const { rec, firstBad } = collect();');
  assert.match(save, /resolveText\(i\)/);
  assert.match(save, /renderNotes\(\)/); // 依這一格算的欄位（設備的狀態）也要跟著換
});

test('從設備詳情新增紀錄，位置欄不能改；其他地方進來的可以改', () => {
  const detail = read('js/detail.js');
  assert.match(detail, /const add = key => Form\.open\(key, null, rowOf\(key\)\.preset\(current\(\)\), table === 'devices' \? \{ fixed: \['device'\] \} : \{\}\)/);
  // 確認張數、帶入最新回報也是這一台
  assert.equal([...detail.matchAll(/Form\.open\('readings', null, [\s\S]*?fixed: \['device'\] \}\)/g)].length, 2);
  // 不能改的還是要檢查（報廢的機器不能安裝）
  assert.match(read('js/form.js'), /if \(ctx\.fixed\.includes\(f\.key\)\) \{\s+msg = f\.check\?\.\(values\)/);
});

test('連點：彈出的頁面剛開、剛關時不接受點擊，程式自己按的不擋', () => {
  assert.match(app, /attributeFilter: \['open'\]/);
  assert.match(app, /!e\.isTrusted \|\| performance\.now\(\) - sheetAt >= 350/);
  // 更多沒有開關時不算（底部快速切換不會被擋）
  assert.match(app, /function setMore\(open\) \{\s+if \(morePanel\.hidden !== open\) return;\s+sheetMoved\(\);/);
});

test('總覽分成資料錯誤、待處理、機器回報：資料錯誤、機器回報的每一項都在清單裡，文字不再寫「要處理」', () => {
  const overview = read('js/overview.js');
  const errors = overview.match(/const ERRORS = \[([^\]]+)\]/)[1].match(/'[^']+'/g).map(k => k.slice(1, -1));
  const keys = [...overview.matchAll(/key: '([^']+)', title:/g)].map(m => m[1]);
  assert.deepEqual(errors, ['crowded', 'mismatch', 'contractIssues', 'noReading']);
  errors.forEach(k => assert.ok(keys.includes(k), k));
  // 抄表程式、張數信送上來的另外一區，不和手輸入的資料算出來的混在一起
  const reported = overview.match(/const REPORTED = \[([^\]]+)\]/)[1].match(/'[^']+'/g).map(k => k.slice(1, -1));
  assert.deepEqual(reported, ['confirms', 'toner', 'waste', 'reports']);
  reported.forEach(k => assert.ok(keys.includes(k) && !errors.includes(k), k));
  assert.ok(["section('資料錯誤'", "section('待處理'", "section('機器回報'"].every(t => overview.includes(t)));
  assert.ok(!between(html, '<body', '</body>').replace(/<!--[\s\S]*?-->/g, '').includes('「要處理」'));
});
