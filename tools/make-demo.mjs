// 產生測試用的假資料（data.json 的格式）：30 台事務機和它們的異動、合約、抄表、保養、翻新、選配件
//   設備的名稱是機身號碼（#1001…），編號是系統給的（畫面上不顯示）
//   用法：node tools/make-demo.mjs > data-demo.json，再到 App 的設定 → 匯入 data.json
//   每次產生的內容都一樣（固定的亂數種子）；日期以 2026-10-11 為準
//   data-demo.json 符合 .gitignore 的 data*.json，不會推上 GitHub
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 預設的狀態、選項（類別、保養項目、選配件）照 App 的 schema.js
const ctx = vm.createContext({});
for (const f of ['util', 'schema']) vm.runInContext(readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8'), ctx);
const { SCHEMAS } = vm.runInContext('({ SCHEMAS })', ctx);

// ---------- 固定種子的亂數 ----------
let seed = 20261011;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = list => list[int(0, list.length - 1)];
const chance = p => rand() < p;

// ---------- 日期 ----------
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const day = s => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => iso(new Date(day(s).getTime() + n * 86400000));
const addMonths = (s, n) => { const d = day(s); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };
const TODAY = '2026-10-11';

// id：前段是時間（依新增的先後），後段是流水號
let idn = 0;
const uid = () => `demo${(++idn).toString(36).padStart(5, '0')}`;

// ---------- 清單 ----------
const MODELS = ['IMC6000', 'IMC5500', 'IMC4500', 'IMC3500', 'IMC3000', 'C6004', 'C6004EX', 'C5504', 'C5504EX', 'C4504',
  'C4504EX', 'C3504', 'C3504EX', 'C3004EX', 'C3503', 'C2503', 'C5501', 'C4501', 'C3501', 'C5000',
  'C4000', 'C3300', 'IMC300', 'MP5055', 'MP5000', 'MPC4501', 'MP4055', 'MP4000B', 'MP3555', '借機'];
// 設備用到的機型（多數是新的 IM C、C xx04）
const USED = ['IMC6000', 'IMC6000', 'IMC4500', 'IMC4500', 'IMC4500', 'IMC3500', 'IMC3500', 'IMC5500', 'IMC3000', 'C4504',
  'C3504', 'C3504', 'C3504EX', 'C4504EX', 'C6004EX', 'C3501', 'C4501', 'C5501', 'C3503', 'MP5055', 'MP4055', 'C4000', 'C3300'];
const mono = m => /^MP\d/.test(m); // MP 開頭沒有 C 的是黑白機
const LOCATIONS = ['大華貿易 3F', '安心診所 櫃台', '晨光設計工作室', '宏遠建設 總務部', '興隆會計師事務所', '青山國小 教務處',
  '日新補習班 2F', '長榮物流 倉管', '和平藥局', '永豐法律事務所', '新光牙醫診所', '太平洋旅行社', '聯合工程顧問', '明德高中 圖書館',
  '福星餐飲 總部', '群益印刷', '東方汽車 業務部', '金城保險 3F', '藍海科技 研發部', '綠野建築師事務所', '中興地政事務所',
  '美好月子中心', '北辰補習班', '鼎泰國際 5F'];
const STOCK = '公司倉庫';
const PEOPLE = [
  { name: '陳志明', jobTitle: '技術組長', dept: '技術部', phone: '0912-345-678' },
  { name: '林小芳', jobTitle: '業務', dept: '業務部', phone: '0922-111-222' },
  { name: '王建宏', jobTitle: '工程師', dept: '技術部', phone: '0933-456-789' },
  { name: '張雅婷', jobTitle: '助理', dept: '管理部', phone: '' },
];
const KEEPERS = ['陳志明', '王建宏', '陳志明', '林小芳'];
const ENGINEERS = ['王建宏', '陳志明'];
const VENDORS = [
  { name: '東昇辦公設備', contact: '李先生', phone: '02-2345-6789', address: '新北市板橋區文化路一段 100 號' },
  { name: '聯合影像器材', contact: '黃小姐', phone: '04-2234-5678', address: '' },
];

const blank = t => Object.fromEntries(SCHEMAS[t].fields.map(f => [f.key,
  f.type === 'number' || f.type === 'date' ? null : f.type === 'flag' ? false : '']));
const rec = (t, over) => ({ ...blank(t), id: uid(), ...over });
const hex = n => Array.from({ length: n }, () => '0123456789ABCDEF'[int(0, 15)]).join('');

const data = {
  statuses: SCHEMAS.statuses.seed(),
  options: [
    ...SCHEMAS.options.seed(),
    { id: uid(), list: '類別', name: '多功能事務機', order: 0, disabled: false },
    { id: uid(), list: '品牌', name: 'Ricoh', order: null, disabled: false },
    ...MODELS.map((name, i) => ({ id: uid(), list: '機型', name, order: i + 1, disabled: false })),
    ...[STOCK, ...LOCATIONS].map(name => ({ id: uid(), list: '位置', name, order: null, disabled: false })),
  ],
  people: PEOPLE.map(p => rec('people', p)),
  vendors: VENDORS.map(v => rec('vendors', v)),
  devices: [], moves: [], contracts: [], readings: [], maintenance: [], refurbs: [], parts: [],
};

// ---------- 30 台設備：22 台出租中、5 台庫存、2 台維修中、1 台報廢 ----------
const STATUSES = [...Array(22).fill('出租中'), ...Array(5).fill('庫存'), '維修中', '維修中', '報廢'];
const perYear = {};
let customer = 0;
STATUSES.forEach((status, n) => {
  const model = USED[n % USED.length];
  const buyDate = `20${pick(['23', '24', '24', '25', '25', '26'])}-${pad(int(1, 12))}-${pad(int(1, 28))}`;
  const buy = buyDate < TODAY ? buyDate : '2026-03-15';
  const yy = buy.slice(2, 4);
  perYear[yy] = (perYear[yy] || 0) + 1;
  const code = `${yy}-${String(perYear[yy]).padStart(4, '0')}`;
  // 保固：買來 1 年；有 3 台在 30 天內到期
  const warranty = n === 1 || n === 7 || n === 23 ? addDays(TODAY, int(5, 28)) : addMonths(buy, 12);
  const d = rec('devices', {
    code, name: `#${1001 + n * 37}`, status, category: '多功能事務機', brand: 'Ricoh', model,
    serial: `3${int(100, 999)}R${int(100000, 999999)}`, board: `RNP${hex(12)}`, location: STOCK, keeper: pick(KEEPERS),
    buyDate: buy, price: int(4, 12) * 10000, vendor: pick(VENDORS).name, warranty, link: '', note: '',
  });
  data.devices.push(d);

  // 出租中、維修中：安裝到客戶那裡（有幾台後來移機）
  if (status === '出租中' || status === '維修中') {
    const where = LOCATIONS[customer++ % LOCATIONS.length];
    const after = addDays(buy, int(7, 40));
    const install = after < TODAY ? after : addDays(TODAY, -int(60, 120));
    data.moves.push(rec('moves', { device: code, date: install, type: '安裝', from: STOCK, to: where }));
    d.location = where;
    if (chance(0.15)) {
      const moved = LOCATIONS[(customer + 7) % LOCATIONS.length];
      const later = addDays(install, int(90, 300));
      data.moves.push(rec('moves', { device: code, date: later < TODAY ? later : addDays(TODAY, -10), type: '移機', from: where, to: moved,
        note: '客戶搬到新辦公室' }));
      d.location = moved;
    }
    // 合約：簽約日在安裝前幾天，2 年或 3 年；有 2 份快到期、1 份已經過了
    const sign = addDays(install, -int(1, 10));
    const end = n === 2 ? addDays(TODAY, 18) : n === 5 ? addDays(TODAY, 26) : n === 9 ? addDays(TODAY, -12) : addMonths(sign, pick([24, 36]));
    const rent = pick([2500, 3000, 3500, 4000, 5000]);
    data.contracts.push(rec('contracts', {
      device: code, signDate: sign, endDate: end,
      content: mono(model) ? `月租 ${rent.toLocaleString()} 元，含黑白 ${pick([3000, 5000])} 張\n碳粉、保養都包` : `月租 ${rent.toLocaleString()} 元，含黑白 ${pick([2000, 3000])} 張、彩色 ${pick([300, 500])} 張\n碳粉、保養都包`,
      billing: mono(model) ? '超過的黑白每張 0.3 元' : '超過的黑白每張 0.3 元、彩色每張 3 元',
      readDay: pick(['每月 25 日', '每月月底', '每月 5 日（抄上個月）']),
    }));

    // 抄表：2026/06～2026/09 的帳，月底或下個月初抄；有幾台 9 月還沒抄
    let bw = int(20000, 300000);
    let color = mono(model) ? null : int(5000, 80000);
    ['2026-06', '2026-07', '2026-08', '2026-09'].forEach((month, k) => {
      if (k === 3 && n % 6 === 0) return;
      const date = chance(0.5) ? `${month}-${pad(int(24, 28))}` : addDays(addMonths(`${month}-01`, 1), int(0, 5));
      if (date < install) return;
      bw += int(800, 6000);
      if (color !== null) color += int(150, 1500);
      data.readings.push(rec('readings', { device: code, date, month, bw, color, note: '' }));
      // 保養：有時候抄表那趟順便換碳粉，記張數
      if (chance(0.35)) {
        const items = mono(model) ? ['碳粉 K'] : ['碳粉 K', '碳粉 C', '碳粉 M', '碳粉 Y'];
        data.maintenance.push(rec('maintenance', { device: code, date, item: pick(items), bw, color, note: '' }));
        if (chance(0.3)) data.maintenance.push(rec('maintenance', { device: code, date, item: pick(['感光鼓', '廢粉盒', '清潔保養']), note: '' }));
      }
    });
    // 選配件：有幾台裝了送紙匣、裝訂器
    if (chance(0.35)) data.parts.push(rec('parts', { device: code, name: pick(['送紙匣', '裝訂器', '傳真卡']), serial: `PB${int(1000, 9999)}`, installDate: install }));
  }

  // 庫存：翻新過，放在倉庫
  if (status === '庫存') {
    const date = addDays(TODAY, -int(10, 70));
    data.refurbs.push(rec('refurbs', {
      device: code, date, stockDate: addDays(date, int(2, 7)), engineer: pick(ENGINEERS), serial: d.serial,
      country: pick(['日', '日', '美']), source: pick(['日本拍賣', '美國回收商', '客戶退租']), painted: chance(0.5),
      content: pick(['換外殼、清潔內部\n更換定影器', '更換感光鼓、清潔紙路', '更換主機板\n更新韌體', '換送紙滾輪、清潔']),
    }));
    if (n === 24) data.parts.push(rec('parts', { device: code, name: '送紙匣', serial: `PB${int(1000, 9999)}`, installDate: addDays(buy, 20), removeDate: date }));
  }
});

process.stdout.write(JSON.stringify({ app: 'devicemanager', version: 1, exportedAt: `${TODAY}T00:00:00.000Z`, ...data }, null, 2));
