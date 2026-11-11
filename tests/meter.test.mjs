// 試算表上的程式（apps-script/meter.gs）：業務員拿資料時只給他看得到的列
//   meter.gs 放進 vm 執行；只測不碰 Google 的部分（salesPerson_、salesRows_），日期用試算表的序號
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../apps-script/meter.gs', import.meta.url), 'utf8'), ctx, { filename: 'meter.gs' });
const { salesPerson_, salesRows_, salesScope_, salesPlan_, reportText_, senders_, senderOf_, resultText_, valuesOf_, readTabs_, tab_, writeLatest_, sheetPathOk_ } = vm.runInContext('({ salesPerson_, salesRows_, salesScope_, salesPlan_, reportText_, senders_, senderOf_, resultText_, valuesOf_, readTabs_, tab_, writeLatest_, sheetPathOk_ })', ctx);
const plain = v => JSON.parse(JSON.stringify(v));

const PEOPLE = [
  ['姓名', '員工編號', '職稱', '部門', '電話', 'Email', '業務員', '權限', '看全部', '入職日', '離職日', '備註', 'id', '改全部'],
  ['阿明', '', '', '', '', ' A@Gmail.com ', true, '記抄表', false, '', '', '', 'p1', false],
  ['小華', '', '', '', '', 'x@gmail.com', false, '', false, '', '', '', 'p2', true],
  ['老王', '', '', '', '', 'w@gmail.com', true, '', false, '', 100, '', 'p3', false],
  ['未來', '', '', '', '', 'f@gmail.com', 'v', '記抄表、記保養', true, '', 300, '', 'p4', true],
];

test('業務員是誰：Email 一樣（不分大小寫）、勾了業務員、還沒離職；帶權限、看全部、改全部；不是的回 null', () => {
  assert.deepEqual(plain(salesPerson_(PEOPLE, 'a@gmail.com', 200)), { name: '阿明', perms: ['記抄表'], all: false, edit: false });
  assert.equal(salesPerson_(PEOPLE, 'x@gmail.com', 200), null); // 沒勾業務員（勾了改全部也不算）
  assert.equal(salesPerson_(PEOPLE, 'w@gmail.com', 200), null); // 離職日過了
  assert.equal(salesPerson_(PEOPLE, 'w@gmail.com', 100), null); // 離職那天就不行
  // 手打的 v 也算勾了；離職日還沒到；勾了看全部、改全部
  assert.deepEqual(plain(salesPerson_(PEOPLE, 'f@gmail.com', 200)), { name: '未來', perms: ['記抄表', '記保養'], all: true, edit: true });
  assert.equal(salesPerson_(PEOPLE, 'nobody@gmail.com', 200), null);
  assert.equal(salesPerson_([], 'a@gmail.com', 200), null);
  // 舊的試算表沒有改全部這一欄：當作沒勾
  assert.equal(salesPerson_(PEOPLE.map(r => r.slice(0, 13)), 'f@gmail.com', 200).edit, false);
});

test('改全部的代讀寫：只收 App 同步用到的那幾種寫法，碰不到別的試算表', () => {
  const tab = encodeURIComponent("'抄表'");
  [
    '?fields=spreadsheetUrl,sheets.properties(sheetId,title,gridProperties.rowCount)',
    `/values:batchGet?ranges=${tab}&ranges=${encodeURIComponent("'_meta'")}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
    '/values:batchUpdate', '/values:batchClear', ':batchUpdate',
    `/values/${encodeURIComponent("'抄表'!A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
  ].forEach(p => assert.equal(sheetPathOk_(p), true, p));
  [
    '', '/', '/../other-id', '/..%2Fother-id/values:batchGet', '/values:batchGet/../../x', '/values/a/b:append?x=1',
    '/values/%2E%2E:append?x', '/developerMetadata', ':copyTo', 'https://example.com', undefined, null, 1,
  ].forEach(p => assert.equal(sheetPathOk_(p), false, String(p)));
});

// 阿明負責大華（L0001）、舊客戶（L0004，停用了）；小華負責長榮（L0002）；L0003 是倉庫
//   客戶：大華貿易（主要業務員是小華，還是給阿明）、長榮物流、舊客戶公司（位置上寫的大小寫、空白不一樣）、沒有位置的集團
//   26-0001：現在在大華（之前的抄表也給）；26-0002：在大華待過 100～200，現在回倉庫
//   26-0003：一直在長榮；26-0004：在大華待過 50～80，現在在長榮
const VALUES = {
  位置: [
    ['編號', '名稱', '以前的名字', '倉庫', '客戶', '業務員', '停用', '備註', 'id'],
    ['L0001', '大華', '', false, '大華貿易', '阿明', false, '', 'l1'],
    ['L0002', '長榮', '', false, '長榮物流', '小華', false, '', 'l2'],
    ['L0003', '倉庫', '', true, '', '阿明', false, '', 'l3'],
    ['L0004', '舊客戶', '', false, ' old co ', '阿明', true, '', 'l4'],
  ],
  客戶: [
    ['名稱', '統一編號', '主要業務員', '母公司', 'id'],
    ['大華貿易', '12345678', '小華', '', 'cu1'],
    ['長榮物流', '', '小華', '', 'cu2'],
    ['Old Co', '', '', '', 'cu3'],
    ['某集團', '', '', '', 'cu4'],
  ],
  設備: [
    ['編號', '名稱', '位置', 'id'],
    ['26-0001', '#1', 'L0001', 'd1'],
    ['26-0002', '#2', 'L0003', 'd2'],
    ['26-0003', '#3', 'L0002', 'd3'],
    ['26-0004', '#4', 'L0002', 'd4'],
  ],
  異動: [
    ['設備', '日期', '類型', '原位置', '新位置', '狀態', '備註', 'id'],
    ['26-0002', 200, '撤機', 'L0001', 'L0003', '', '', 'm2'],
    ['26-0002', 100, '安裝', 'L0003', 'L0001', '', '', 'm1'],
    ['26-0001', 210, '安裝', 'L0003', 'L0001', '', '', 'm3'],
    ['26-0004', 50, '安裝', 'L0003', 'L0001', '', '', 'm4'],
    ['26-0004', 80, '移機', 'L0001', 'L0002', '', '', 'm5'],
    ['26-0003', 60, '安裝', 'L0003', 'L0002', '', '', 'm6'],
  ],
  抄表: [
    ['設備', '抄表日期', '結算月份', '黑白張數', '彩色張數', '備註', 'id'],
    ['26-0001', 150, '', 10, '', '', 'r1'],
    ['26-0001', 220, '', 20, '', '', 'r2'],
    ['26-0002', 99, '', 1, '', '', 'r3'],
    ['26-0002', 150, '', 2, '', '', 'r4'],
    ['26-0002', 200.5, '', 3, '', '', 'r5'],
    ['26-0002', 250, '', 4, '', '', 'r6'],
    ['26-0003', 100, '', 5, '', '', 'r7'],
    ['26-0004', 70, '', 6, '', '', 'r8'],
    ['26-0004', 90, '', 7, '', '', 'r9'],
  ],
  保養: [['設備', '日期', '項目', '黑白張數', '彩色張數', '備註', 'id'], ['26-0003', 70, '碳粉', '', '', '', 'w1'], ['26-0001', 70, '碳粉', '', '', '', 'w2']],
  翻新: [['設備', '翻新日期', '入庫日', '工程師', '序號', 'id'], ['26-0002', 50, '', '', '', 'f1']],
  選配件: [['設備', '名稱', '序號', '安裝日期', '拆除日期', '備註', 'id'], ['26-0002', '小卡', '', 120, '', '', 'o1']],
  合約: [
    ['位置', '簽約日', '到期日', '提前結束日', '合約內容', '計費方式', '抄表日期', '抄表週期', 'id'],
    ['L0001、L0002', 1, 400, '', '', '', '', '', 'c1'],
    ['L0002', 1, 400, '', '', '', '', '', 'c2'],
  ],
  合約修改紀錄: [['合約', '日期', '欄位', '改之前', '改之後', 'id'], ['c1', 5, '到期日', '', '', 'g1'], ['c2', 5, '到期日', '', '', 'g2']],
  狀態: [['名稱', 'id'], ['出租中', 's1']],
  選項: [['清單', '名稱', 'id'], ['機型', 'IMC4500', 'o1']],
  廠商: [['名稱', 'id']],
  人員: PEOPLE,
  最新回報: [['序號', '設備', '日期'], ['A1', '26-0001', 220], ['A3', '26-0003', 220]],
  待確認抄表: [['序號', '設備', '日期'], ['A1', '26-0001', 221], ['A3', '26-0003', 221]],
};
const ids = (out, tab) => plain(out[tab].slice(1).map(r => r.at(-1)));

test('業務員看得到的列：他的位置、現在在那裡的機器的全部紀錄、以前放過的機器在他那裡那段；別的位置、倉庫不給', () => {
  const out = salesRows_(VALUES, { name: '阿明', perms: [], all: false });
  assert.deepEqual(ids(out, '位置'), ['l1', 'l4']); // 倉庫勾了業務員也不給
  assert.deepEqual(ids(out, '客戶'), ['cu1', 'cu3']); // 他的位置的客戶（主要業務員是別人也給）
  assert.deepEqual(ids(out, '設備'), ['d1', 'd2', 'd4']);
  // 26-0001 搬來之前的也給；26-0002 只給 100～200（搬走那天有時間的也算）；26-0004 只給 50～80
  assert.deepEqual(ids(out, '抄表'), ['r1', 'r2', 'r4', 'r5', 'r8']);
  assert.deepEqual(ids(out, '異動'), ['m2', 'm1', 'm3', 'm4', 'm5']);
  assert.deepEqual(ids(out, '保養'), ['w2']);
  assert.deepEqual(ids(out, '翻新'), []); // 搬來之前的翻新
  assert.deepEqual(ids(out, '選配件'), ['o1']);
  assert.deepEqual(ids(out, '合約'), ['c1']);
  assert.deepEqual(ids(out, '合約修改紀錄'), ['g1']);
  assert.deepEqual(plain(out.人員), [['姓名', 'id'], ['阿明', 'p1'], ['小華', 'p2'], ['老王', 'p3'], ['未來', 'p4']]);
  assert.deepEqual(plain(out.最新回報), [['序號', '設備', '日期'], ['A1', '26-0001', 220]]);
  assert.deepEqual(plain(out.待確認抄表), [['序號', '設備', '日期'], ['A1', '26-0001', 221]]);
  assert.equal(out.狀態, VALUES.狀態); // 清單整份給
  // 標題列照原本的，App 用同一套讀法
  assert.deepEqual(plain(out.抄表[0]), VALUES.抄表[0]);
});

test('沒有負責任何位置的業務員：只拿到清單，沒有位置、機器、紀錄', () => {
  const out = salesRows_(VALUES, { name: '沒人', perms: [], all: false });
  ['位置', '客戶', '設備', '異動', '抄表', '合約'].forEach(t => assert.equal(out[t].length, 1, t)); // 只有標題列
  assert.equal(out.選項.length, 2);
});

test('看全部：全部的位置、機器、紀錄都給（包括倉庫），人員一樣只給姓名', () => {
  const out = salesRows_(VALUES, { name: '未來', perms: [], all: true });
  assert.deepEqual(ids(out, '位置'), ['l1', 'l2', 'l3', 'l4']);
  assert.deepEqual(ids(out, '客戶'), ['cu1', 'cu2', 'cu3', 'cu4']);
  assert.deepEqual(ids(out, '設備'), ['d1', 'd2', 'd3', 'd4']);
  assert.equal(out.抄表.length, VALUES.抄表.length);
  assert.deepEqual(plain(out.人員[0]), ['姓名', 'id']);
});

test('業務員送來的抄表、保養：新的要有權限、這台現在在他的位置（看全部的有這台就好）；已經有的只能改業務員回報，要是他看得到的那一筆', () => {
  const head = ['設備', '抄表日期', '結算月份', '黑白張數', '彩色張數', '備註', '業務員回報', 'id'];
  const item = (tab, device, id = 'n1', report = '') => ({ tab, head, row: [device, 300, '', 1, '', '', report, id] });
  const amin = { name: '阿明', perms: ['記抄表'], all: false };
  assert.deepEqual(plain(salesPlan_(VALUES, amin, item('抄表', '26-0001'))), { id: 'n1', kind: 'add', by: '阿明', report: '' });
  assert.equal(salesPlan_(VALUES, amin, item('抄表', '26-0002')).error, '這台不在你負責的位置'); // 以前放過、已經搬走的不能新增
  assert.equal(salesPlan_(VALUES, amin, item('保養', '26-0001')).error, '沒有「記保養」的權限，請找管理員');
  assert.equal(salesPlan_(VALUES, amin, item('異動', '26-0001')).error, '業務員只能新增抄表、保養');
  assert.equal(salesPlan_(VALUES, amin, item('抄表', '26-0001', '')).error, '資料不完整');
  assert.equal(salesPlan_(VALUES, amin, {}).error, '業務員只能新增抄表、保養');
  // 已經有的：回報他看得到的（以前放過的機器在他那裡那段也算），名字加在前面；沒有記保養的權限也可以回報
  assert.deepEqual(plain(salesPlan_(VALUES, amin, item('抄表', '26-0002', 'r4', '張數打錯'))), { id: 'r4', kind: 'report', report: '阿明：張數打錯' });
  assert.equal(salesPlan_(VALUES, amin, item('抄表', '26-0003', 'r7', '看看')).error, '這一筆不在你負責的位置');
  assert.equal(salesPlan_(VALUES, amin, item('保養', '26-0001', 'w2', '')).kind, 'report'); // 清掉回報
  const boss = { name: '未來', perms: ['記抄表', '記保養'], all: true };
  assert.equal(salesScope_(VALUES, boss).now.size, 4);
  assert.equal(salesPlan_(VALUES, boss, item('保養', '26-0003')).kind, 'add');
  assert.equal(salesPlan_(VALUES, boss, item('抄表', '26-0003', 'r7', 'x')).kind, 'report');
});

test('業務員回報的字：前面加名字，不重複加；空白是清掉', () => {
  assert.equal(reportText_('阿明', ' 張數打錯 '), '阿明：張數打錯');
  assert.equal(reportText_('阿明', '阿明：阿明： 張數打錯'), '阿明：張數打錯');
  assert.equal(reportText_('阿明', '  '), '');
  assert.equal(reportText_('阿明', null), '');
});

test('讀信只讀寄信用 Gmail（_meta 的 senderMail，好幾個用逗號分開）寄來的信；還沒填時不讀，選單寫要去哪裡填', () => {
  const ss = rows => ({ getSheetByName: n => (n === '_meta' && rows ? { getDataRange: () => ({ getValues: () => rows }) } : null) });
  const meta = v => [['version', 1], ['meterUrl', 'https://x'], ['meterReadAt', ''], ['senderMail', v]];
  assert.deepEqual(plain(senders_(ss(meta(' METER.abc@gmail.com, meter@gmail.com ')))), ['meter.abc@gmail.com', 'meter@gmail.com']);
  assert.deepEqual(plain(senders_(ss(meta('')))), []);
  assert.deepEqual(plain(senders_(ss(null))), []); // 沒有 _meta 分頁
  assert.equal(senderOf_({ getFrom: () => 'RICOH <Meter.ABC@gmail.com>' }), 'meter.abc@gmail.com');
  assert.equal(senderOf_({ getFrom: () => 'meter.abc@gmail.com' }), 'meter.abc@gmail.com');
  assert.equal(resultText_({ count: 0, fixed: 0, noSender: true }), '沒有讀信：先到 App「設定 → 自動抄表 → 機器設定」填寄信用 Gmail');
  assert.equal(resultText_({ count: 2, fixed: 0 }), '2 封張數信待確認');
});

test('一次讀完的分頁（試算表 API 的 batchGet，順序和要的分頁一樣）：沒有資料的分頁是空的', () => {
  const json = { valueRanges: [{ range: "'位置'!A1:H3", values: [['編號', '名稱'], ['L0001', '大華']] }, { range: "'設備'!A1:Z1000" }] };
  assert.deepEqual(plain(valuesOf_(['位置', '設備'], json)), { 位置: [['編號', '名稱'], ['L0001', '大華']], 設備: [] });
  assert.deepEqual(plain(valuesOf_([], {})), {});
});

test('讀分頁：Apps Script 加了 Google Sheets API 服務時一次讀完（記下用了 service），只讀試算表有的分頁', () => {
  const asked = [];
  ctx.Sheets = { Spreadsheets: { Values: { batchGet: (id, opts) => {
    asked.push({ id, ...opts });
    return { valueRanges: [{ values: [['編號'], ['L0001']] }, {}] };
  } } } };
  const ss = { getId: () => 'sheet1', getSheets: () => ['位置', "客戶's"].map(n => ({ getName: () => n })) };
  assert.deepEqual(plain(readTabs_(ss, ['位置', '設備', "客戶's"])), { 位置: [['編號'], ['L0001']], "客戶's": [] });
  assert.deepEqual(plain(asked), [{ id: 'sheet1', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER', ranges: ["'位置'", "'客戶''s'"] }]);
  assert.equal(vm.runInContext('readVia_', ctx), 'service');
  delete ctx.Sheets;
});

// 假的分頁：只有 tab_、writeLatest_ 用到的幾個方法；grid 是全部格子，formats 記每一欄設的格式
function fakeSheet(grid, maxColumns = 26) {
  const sheet = {
    grid, formats: {}, frozen: 0, maxColumns,
    getLastColumn: () => Math.max(0, ...grid.map(r => r.length)),
    getLastRow: () => grid.length,
    getMaxColumns: () => sheet.maxColumns,
    getMaxRows: () => 1000,
    getDataRange: () => ({ getValues: () => grid.map(r => [...r]) }),
    insertColumnsAfter: (after, n) => { sheet.maxColumns += n; },
    setFrozenRows: n => { sheet.frozen = n; },
    appendRow: row => grid.push([...row]),
    getRange: (row, col, rows = 1, cols = 1) => {
      if (col + cols - 1 > sheet.maxColumns) throw new Error('超出分頁的欄數');
      const range = {
        getValues: () => Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => grid[row - 1 + i]?.[col - 1 + j] ?? '')),
        setValues: values => {
          values.forEach((r, i) => r.forEach((v, j) => { (grid[row - 1 + i] ||= [])[col - 1 + j] = v; }));
          return range;
        },
        setFontWeight: () => range,
        setNumberFormat: f => { if (rows > 1) sheet.formats[col] = f; return range; },
      };
      return range;
    },
  };
  return sheet;
}

test('最新回報分頁：沒有時建一個（標題、格式照名稱）；以前建的少了 IP、廢粉欄時加在最後面；寫一列時照標題找欄', () => {
  const LATEST_HEAD = plain(vm.runInContext('LATEST_HEAD', ctx));
  const FORMATS = vm.runInContext('LATEST_FORMATS', ctx);
  assert.deepEqual(LATEST_HEAD.slice(-2), ['IP', '廢粉']);
  const sheets = {};
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = fakeSheet([])) };

  const made = tab_(ss, '最新回報', LATEST_HEAD, FORMATS);
  assert.deepEqual(sheets.最新回報.grid[0], LATEST_HEAD);
  assert.equal(sheets.最新回報.frozen, 1);
  assert.deepEqual(plain(sheets.最新回報.formats), { 1: '@', 2: '@', 3: '@', 4: 'yyyy/mm/dd', 5: '@', 12: '@' });
  writeLatest_(made, ['A1', '26-0001', 'RNP1', 46326, '08:30', 100, 20, 50, 40, 30, 20, '192.168.1.20', 35]);
  assert.deepEqual(sheets.最新回報.grid[1], ['A1', '26-0001', 'RNP1', 46326, '08:30', 100, 20, 50, 40, 30, 20, '192.168.1.20', 35]);

  // 以前的程式建的分頁：沒有 IP、廢粉欄，只有 11 欄寬（欄數不夠時先加欄）；原本的列不動，同一台蓋過去時 IP、廢粉寫在新的欄
  const old = LATEST_HEAD.slice(0, -2);
  sheets.最新回報 = fakeSheet([[...old], ['B2', '26-0002', '', 46320, '09:00', 5, '', 10, '', '', '']], 11);
  const t = tab_(ss, '最新回報', LATEST_HEAD, FORMATS);
  assert.deepEqual(sheets.最新回報.grid[0], LATEST_HEAD);
  assert.equal(sheets.最新回報.maxColumns, 13);
  assert.deepEqual(plain(sheets.最新回報.formats), { 12: '@' });
  assert.equal(t.width, 13);
  writeLatest_(t, ['b2', '26-0002', '', 46326, '10:00', 9, '', 8, '', '', '', '10.0.0.5', 92]);
  assert.deepEqual(sheets.最新回報.grid.slice(1), [['b2', '26-0002', '', 46326, '10:00', 9, '', 8, '', '', '', '10.0.0.5', 92]]);

  // 上一版建的分頁：有 IP、沒有廢粉：廢粉加在 IP 後面，原本的列不動
  sheets.最新回報 = fakeSheet([LATEST_HEAD.slice(0, -1), ['D4', '', '', 46320, '09:00', 5, '', 10, '', '', '', '10.0.0.7']], 12);
  const u = tab_(ss, '最新回報', LATEST_HEAD, FORMATS);
  assert.deepEqual(sheets.最新回報.grid[0], LATEST_HEAD);
  assert.equal(sheets.最新回報.maxColumns, 13);
  assert.equal(u.width, 13);
  assert.deepEqual(sheets.最新回報.grid[1], ['D4', '', '', 46320, '09:00', 5, '', 10, '', '', '', '10.0.0.7']);

  // 欄位順序被人換過：照標題找欄
  sheets.最新回報 = fakeSheet([['IP', ...old]]);
  const moved = tab_(ss, '最新回報', LATEST_HEAD, FORMATS);
  writeLatest_(moved, ['C3', '', '', 46326, '11:00', 1, '', '', '', '', '', '10.0.0.9', 60]);
  assert.deepEqual(sheets.最新回報.grid[1], ['10.0.0.9', 'C3', '', '', 46326, '11:00', 1, '', '', '', '', '', 60]);
});

// 試算表上的程式要用的 Google 服務：假的試算表（抄表、設備、_meta）、時區、指令碼屬性、Gmail
function fakeGoogle(mails = []) {
  const sheets = {
    抄表: fakeSheet([['設備', '抄表日期', '結算月份', '黑白張數', '彩色張數', '備註']]),
    設備: fakeSheet([['編號', '序號'], ['26-0001', 'A1']]),
    _meta: { getDataRange: () => ({ getValues: () => [['senderMail', 'meter.abc@gmail.com']] }), getRange: () => ({ setNumberFormat() { return this; }, setValues() { return this; } }) },
  };
  const props = {};
  const queries = [];
  Object.assign(ctx, {
    SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = fakeSheet([])) }) },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    Utilities: { formatDate: () => '2026-11-1-08:30' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    GmailApp: {
      search: (q, at) => { queries.push(q); return at ? [] : [{}]; },
      getMessagesForThreads: threads => threads.map(() => mails),
    },
  });
  return { sheets, props, queries, done: () => ['SpreadsheetApp', 'Session', 'Utilities', 'PropertiesService', 'GmailApp'].forEach(k => delete ctx[k]) };
}

test('抄表程式送來的：都寫最新回報；客戶按提交的（manual）另外寫待確認抄表，背景的不寫；測試的只寫待確認；都不寫抄表', () => {
  const CONFIRM_HEAD = plain(vm.runInContext('CONFIRM_HEAD', ctx));
  const g = fakeGoogle();
  const res = vm.runInContext('writePosted_', ctx)([
    { serial: 'A1', bw: 100, color: 20, date: '2026-11-01', time: '08:30', toner: {}, waste: 35 }, // 背景
    { serial: 'B2', bw: 50, date: '2026-11-01', time: '09:00', manual: true, waste: 92 },         // 客戶按提交（對不到設備）
    { serial: 'A1', bw: 101, color: 21, date: '2026-11-01', time: '10:00', manual: true, waste: -3 }, // 同一台再按一次：蓋過去；廢粉沒有百分比的空白
    { serial: 'C3', bw: 7, date: '2026-11-01', time: '11:00', test: true },
  ]);
  assert.deepEqual(plain(res), [{ serial: 'A1', device: '26-0001' }, { serial: 'B2', device: '' }, { serial: 'A1', device: '26-0001' }, { serial: 'C3', device: '' }]);
  assert.deepEqual(plain(g.sheets.最新回報.grid.slice(1).map(r => [r[0], r[5], r[12]])), [['A1', 101, ''], ['B2', 50, 92]]);
  assert.deepEqual(plain(g.sheets.待確認抄表.grid), [
    CONFIRM_HEAD,
    ['B2', '', 46327, '09:00', 50, '', '客戶提交'],
    ['A1', '26-0001', 46327, '10:00', 101, 21, '客戶提交'],
    ['C3', '', 46327, '11:00', 7, '', '抄表程式（測試）'],
  ]);
  assert.equal(g.sheets.抄表.grid.length, 1);
  g.done();
});

test('讀信：寄信用 Gmail 寄來的張數信寫進待確認抄表（一台只留最新一封，測試的寫張數信（測試）），別人寄的不讀；不寫抄表、記下讀到哪一封', () => {
  const body = (serial, bw, day, hm) => `Serial No.: ${serial}\nDate: Sun Nov  ${day} ${hm}:53 2026\nTotal_Color:20\nTotal_BW:${bw}\n`;
  const mail = (got, from, subject, text) => ({ getDate: () => new Date(got), getFrom: () => from, getSubject: () => subject, getPlainBody: () => text });
  const mails = [
    mail(2000, 'Meter <meter.abc@gmail.com>', 'Page Counter : A1', body('A1', 600, 2, '09:50')),
    mail(1000, 'meter.abc@gmail.com', 'Page Counter : A1', body('A1', 500, 1, '09:50')),
    mail(4000, 'someone@gmail.com', 'Page Counter : A1', body('A1', 1, 2, '10:00')), // 別人寄的假信
    mail(3000, 'meter.abc@gmail.com', '[TEST] Page Counter : B2', body('B2', 7, 1, '08:00')),
  ];
  const g = fakeGoogle(mails);
  const readMail = vm.runInContext('readMail_', ctx);
  const r = readMail();
  assert.equal(r.count, 3);
  assert.deepEqual(plain(g.sheets.待確認抄表.grid.slice(1)), [
    ['B2', '', 46327, '08:00', 7, 20, '張數信（測試）'], // 照信裡的時間由舊到新寫
    ['A1', '26-0001', 46328, '09:50', 600, 20, '張數信'], // 11/1 那封不寫，只寫 11/2 的
  ]);
  assert.equal(g.sheets.抄表.grid.length, 1);
  // 第一次找最近 7 天的；記到最後看的那一封（別人寄的也算看過）
  assert.match(g.queries[0], /newer_than:7d from:\(meter\.abc@gmail\.com\)$/);
  assert.equal(g.props.mailAt, '4000');

  // 下一次：只找那之後的，讀過的不再寫；新來的一封接著寫
  mails.push(mail(5500, 'meter.abc@gmail.com', 'Page Counter : A1', body('A1', 700, 3, '09:50')));
  const again = readMail();
  assert.equal(again.count, 1);
  assert.match(g.queries.at(-1), / after:4 from:/);
  assert.deepEqual(plain(g.sheets.待確認抄表.grid[2]), ['A1', '26-0001', 46329, '09:50', 700, 20, '張數信']);
  assert.equal(g.props.mailAt, '5500');
  assert.equal(readMail().count, 0);
  assert.equal(g.props.mailAt, '5500');
  g.done();
});

test('讀信：以前每封信記一筆的（done）換成只記讀到哪裡，從最後讀的那次接著算；看不完的下次接著看', () => {
  const body = (serial, bw) => `Serial No.: ${serial}\nDate: Sun Nov  1 09:50:53 2026\nTotal_BW:${bw}\n`;
  const mail = (got, serial, bw) => ({ getDate: () => new Date(got), getFrom: () => 'meter.abc@gmail.com', getSubject: () => 'Page Counter', getPlainBody: () => body(serial, bw) });
  const g = fakeGoogle([mail(8000, 'A1', 1), mail(9500, 'A1', 2), mail(9900, 'B2', 3)]);
  g.props.done = JSON.stringify({ m1: 7000, m2: 9000 });
  const readMail = vm.runInContext('readMail_', ctx);
  assert.equal(readMail().count, 2); // 9000 之前的讀過了
  assert.match(g.queries[0], / after:9 from:/);
  assert.equal(g.props.done, undefined);
  assert.equal(g.props.mailAt, '9900');

  // 時間不夠：只看第一封，記到第二封前面，下次從第二封接著
  g.props.mailAt = '7999';
  const clock = vm.runInContext('Date', ctx); // 程式用的是它自己那邊的 Date
  const now = clock.now;
  let t = 0;
  clock.now = () => (t += 100000);
  try {
    assert.equal(readMail().count, 1);
  } finally {
    clock.now = now;
  }
  assert.equal(g.props.mailAt, '9499');
  assert.equal(readMail().count, 2);
  assert.equal(g.props.mailAt, '9900');
  g.done();
});

test('App 叫讀信（doGet）：一分鐘內讀過就不再讀，回上一次的時間、count 是 0', () => {
  const g = fakeGoogle([]);
  const cache = {};
  const made = [];
  let reads = 0;
  Object.assign(ctx, {
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v, sec) => { cache[k] = v; made.push(sec); } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }), MimeType: { JSON: 'json' } },
  });
  ctx.GmailApp.search = () => { reads++; return []; };
  try {
    const doGet = vm.runInContext('doGet', ctx);
    const first = doGet();
    assert.equal(reads, 1);
    assert.deepEqual(made, [60]);
    const again = doGet();
    assert.equal(reads, 1);
    assert.equal(again.at, first.at);
    assert.equal(again.count, 0);
  } finally {
    ['CacheService', 'LockService', 'ContentService'].forEach(k => delete ctx[k]);
    g.done();
  }
});

test('每天備份：複製整份試算表到備份資料夾（沒有就建一個、記下 id），丟掉超過 30 天的，時間記在 _meta 第 5 列；下次用同一個資料夾', () => {
  const now = Date.now();
  const props = {};
  const made = [];
  const trashed = [];
  const meta = [];
  const file = (name, days) => ({ getName: () => name, getDateCreated: () => new Date(now - days * 864e5), setTrashed: v => trashed.push([name, v]) });
  const files = [file('設備管理 備份 2026-09-01 0300', 40), file('設備管理 備份 2026-10-08 0300', 29), file('自己放的檔案', 90)];
  const folder = { created: 0, getId: () => 'f1', isTrashed: () => false, getFiles: () => {
    const list = [...files, ...made];
    let i = 0;
    return { hasNext: () => i < list.length, next: () => list[i++] };
  } };
  Object.assign(ctx, {
    SpreadsheetApp: { getActive: () => ({
      getName: () => '設備管理', getId: () => 'ss1', getSpreadsheetTimeZone: () => 'Asia/Taipei',
      getSheetByName: n => (n === '_meta' ? { getRange: a1 => ({ setNumberFormat() { return this; }, setValues: v => meta.push([a1, v]) }) } : null),
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    DriveApp: {
      createFolder: name => { folder.created++; folder.name = name; return folder; },
      getFolderById: id => { if (id !== 'f1') throw new Error('找不到'); return folder; },
      getFileById: id => ({ makeCopy: (name, to) => {
        assert.equal(id, 'ss1');
        assert.equal(to, folder);
        made.push(file(name, 0));
      } }),
    },
    Utilities: { formatDate: () => '2026-11-07 0300' },
  });
  try {
    const backup = vm.runInContext('backup', ctx);
    assert.deepEqual(plain(backup()), { removed: 1 });
    assert.equal(folder.name, '設備管理 備份');
    assert.equal(props.backupFolder, 'f1');
    assert.equal(made[0].getName(), '設備管理 備份 2026-11-07 0300');
    assert.deepEqual(trashed, [['設備管理 備份 2026-09-01 0300', true]]); // 29 天的、別的檔案、剛複製的都不動
    assert.equal(meta[0][0], 'A5:B5');
    assert.equal(meta[0][1][0][0], 'backupAt');
    backup();
    assert.equal(folder.created, 1);
    // 資料夾被刪掉了：再建一個
    props.backupFolder = 'gone';
    backup();
    assert.equal(folder.created, 2);
  } finally {
    ['SpreadsheetApp', 'PropertiesService', 'DriveApp', 'Utilities'].forEach(k => delete ctx[k]);
  }
});
