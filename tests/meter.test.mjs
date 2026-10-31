// 試算表上的程式（apps-script/meter.gs）：業務員拿資料時只給他看得到的列
//   meter.gs 放進 vm 執行；只測不碰 Google 的部分（salesPerson_、salesRows_），日期用試算表的序號
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../apps-script/meter.gs', import.meta.url), 'utf8'), ctx, { filename: 'meter.gs' });
const { salesPerson_, salesRows_, salesScope_, salesCheck_ } = vm.runInContext('({ salesPerson_, salesRows_, salesScope_, salesCheck_ })', ctx);
const plain = v => JSON.parse(JSON.stringify(v));

const PEOPLE = [
  ['姓名', '員工編號', '職稱', '部門', '電話', 'Email', '業務員', '權限', '看全部', '入職日', '離職日', '備註', 'id'],
  ['阿明', '', '', '', '', ' A@Gmail.com ', true, '記抄表', false, '', '', '', 'p1'],
  ['小華', '', '', '', '', 'x@gmail.com', false, '', false, '', '', '', 'p2'],
  ['老王', '', '', '', '', 'w@gmail.com', true, '', false, '', 100, '', 'p3'],
  ['未來', '', '', '', '', 'f@gmail.com', 'v', '記抄表、記保養', true, '', 300, '', 'p4'],
];

test('業務員是誰：Email 一樣（不分大小寫）、勾了業務員、還沒離職；帶權限、看全部；不是的回 null', () => {
  assert.deepEqual(plain(salesPerson_(PEOPLE, 'a@gmail.com', 200)), { name: '阿明', perms: ['記抄表'], all: false });
  assert.equal(salesPerson_(PEOPLE, 'x@gmail.com', 200), null); // 沒勾業務員
  assert.equal(salesPerson_(PEOPLE, 'w@gmail.com', 200), null); // 離職日過了
  assert.equal(salesPerson_(PEOPLE, 'w@gmail.com', 100), null); // 離職那天就不行
  // 手打的 v 也算勾了；離職日還沒到；勾了看全部
  assert.deepEqual(plain(salesPerson_(PEOPLE, 'f@gmail.com', 200)), { name: '未來', perms: ['記抄表', '記保養'], all: true });
  assert.equal(salesPerson_(PEOPLE, 'nobody@gmail.com', 200), null);
  assert.equal(salesPerson_([], 'a@gmail.com', 200), null);
});

// 阿明負責大華（L0001）、舊客戶（L0004，停用了）；小華負責長榮（L0002）；L0003 是倉庫
//   26-0001：現在在大華（之前的抄表也給）；26-0002：在大華待過 100～200，現在回倉庫
//   26-0003：一直在長榮；26-0004：在大華待過 50～80，現在在長榮
const VALUES = {
  位置: [
    ['編號', '名稱', '以前的名字', '倉庫', '業務員', '停用', '備註', 'id'],
    ['L0001', '大華', '', false, '阿明', false, '', 'l1'],
    ['L0002', '長榮', '', false, '小華', false, '', 'l2'],
    ['L0003', '倉庫', '', true, '阿明', false, '', 'l3'],
    ['L0004', '舊客戶', '', false, '阿明', true, '', 'l4'],
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
};
const ids = (out, tab) => plain(out[tab].slice(1).map(r => r.at(-1)));

test('業務員看得到的列：他的位置、現在在那裡的機器的全部紀錄、以前放過的機器在他那裡那段；別的位置、倉庫不給', () => {
  const out = salesRows_(VALUES, { name: '阿明', perms: [], all: false });
  assert.deepEqual(ids(out, '位置'), ['l1', 'l4']); // 倉庫勾了業務員也不給
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
  assert.equal(out.狀態, VALUES.狀態); // 清單整份給
  // 標題列照原本的，App 用同一套讀法
  assert.deepEqual(plain(out.抄表[0]), VALUES.抄表[0]);
});

test('沒有負責任何位置的業務員：只拿到清單，沒有位置、機器、紀錄', () => {
  const out = salesRows_(VALUES, { name: '沒人', perms: [], all: false });
  ['位置', '設備', '異動', '抄表', '合約'].forEach(t => assert.equal(out[t].length, 1, t)); // 只有標題列
  assert.equal(out.選項.length, 2);
});

test('看全部：全部的位置、機器、紀錄都給（包括倉庫），人員一樣只給姓名', () => {
  const out = salesRows_(VALUES, { name: '未來', perms: [], all: true });
  assert.deepEqual(ids(out, '位置'), ['l1', 'l2', 'l3', 'l4']);
  assert.deepEqual(ids(out, '設備'), ['d1', 'd2', 'd3', 'd4']);
  assert.equal(out.抄表.length, VALUES.抄表.length);
  assert.deepEqual(plain(out.人員[0]), ['姓名', 'id']);
});

test('業務員新增抄表、保養前的檢查：要有權限、這台現在放在他的位置（看全部的：有這台就好）；其他分頁不行', () => {
  const head = ['設備', '抄表日期', '結算月份', '黑白張數', '彩色張數', '備註', 'id'];
  const item = (tab, device, id = 'n1') => ({ tab, head, row: [device, 300, '', 1, '', '', id] });
  const amin = { name: '阿明', perms: ['記抄表'], all: false };
  const mine = salesScope_(VALUES, amin).now;
  assert.deepEqual([...mine], ['26-0001']);
  assert.deepEqual(plain(salesCheck_(amin, mine, item('抄表', '26-0001'))), { id: 'n1' });
  assert.equal(salesCheck_(amin, mine, item('抄表', '26-0002')).error, '這台不在你負責的位置'); // 以前放過、已經搬走的不行
  assert.equal(salesCheck_(amin, mine, item('保養', '26-0001')).error, '沒有「記保養」的權限，請找管理員');
  assert.equal(salesCheck_(amin, mine, item('異動', '26-0001')).error, '業務員只能新增抄表、保養');
  assert.equal(salesCheck_(amin, mine, item('抄表', '26-0001', '')).error, '資料不完整');
  assert.equal(salesCheck_(amin, mine, {}).error, '業務員只能新增抄表、保養');
  const boss = { name: '未來', perms: ['記抄表', '記保養'], all: true };
  const all = salesScope_(VALUES, boss).now;
  assert.equal(all.size, 4);
  assert.deepEqual(plain(salesCheck_(boss, all, item('保養', '26-0003'))), { id: 'n1' });
});
