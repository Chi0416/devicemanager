// 產生測試用的假資料（data.json 的格式）：30 台事務機和它們的位置、異動、合約、抄表、保養、翻新、選配件、最新回報
//   設備的名稱是機身號碼（#1001…），編號是系統給的（畫面上不顯示）
//   位置存編號（L0001…）：一個位置放一台，公司倉庫是倉庫；合約綁位置（鼎泰國際 3F、4F、5F 是同一份合約）
//   有幾台跟著客戶搬到新辦公室：新的位置另簽一份合約，舊的那份提前結束
//   大華貿易 3F 換過三次機（看位置的異動）
//   用法：node tools/make-demo.mjs > data-demo.json，再到 App 的設定 → 匯入 data.json
//   每次產生的內容都一樣（固定的亂數種子）；日期以 2026-10-11 為準（最新回報的日期照產生那天）
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
  '鼎泰國際 3F', '鼎泰國際 4F', '鼎泰國際 5F'];
const GROUP = '鼎泰國際'; // 一次租三台：一份合約寫三個位置
// 改過名字的位置：以前的名字
const OLD_NAMES = { '金城保險 3F': '金城產險 3F（到 2026/03/01）' };
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
    { id: uid(), list: '品牌', name: 'Ricoh', order: null, disabled: false },
    ...MODELS.map((name, i) => ({ id: uid(), list: '機型', name, order: i + 1, disabled: false })),
  ],
  locations: [],
  people: PEOPLE.map(p => rec('people', p)),
  vendors: VENDORS.map(v => rec('vendors', v)),
  devices: [], moves: [], contracts: [], contractLog: [], readings: [], maintenance: [], refurbs: [], parts: [],
};

// 位置：L0001 起編號；名字 → 編號
const place = name => {
  let p = data.locations.find(x => x.name === name);
  if (!p) {
    p = rec('locations', { code: `L${String(data.locations.length + 1).padStart(4, '0')}`, name, oldNames: OLD_NAMES[name] || '', stock: name === STOCK });
    data.locations.push(p);
  }
  return p.code;
};
[STOCK, ...LOCATIONS].forEach(place);
const terms = model => {
  const rent = pick([2500, 3000, 3500, 4000, 5000]);
  return {
    content: mono(model) ? `月租 ${rent.toLocaleString()} 元，含黑白 ${pick([3000, 5000])} 張\n碳粉、保養都包` : `月租 ${rent.toLocaleString()} 元，含黑白 ${pick([2000, 3000])} 張、彩色 ${pick([300, 500])} 張\n碳粉、保養都包`,
    billing: mono(model) ? '超過的黑白每張 0.3 元' : '超過的黑白每張 0.3 元、彩色每張 3 元',
    readDay: pick(['每月 25 日', '每月月底', '每月 5 日（抄上個月）']),
  };
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
    code, name: `#${1001 + n * 37}`, status, category: '事務機', brand: 'Ricoh', model,
    serial: `3${int(100, 999)}R${int(100000, 999999)}`, board: `RNP${hex(12)}`, location: place(STOCK), keeper: pick(KEEPERS),
    buyDate: buy, price: int(4, 12) * 10000, vendor: pick(VENDORS).name, warranty, link: '', note: '',
  });
  data.devices.push(d);

  // 出租中、維修中：安裝到客戶那裡（有幾台後來移機）
  if (status === '出租中' || status === '維修中') {
    const where = LOCATIONS[customer++ % LOCATIONS.length];
    const after = addDays(buy, int(7, 40));
    const install = after < TODAY ? after : addDays(TODAY, -int(60, 120));
    data.moves.push(rec('moves', { device: code, date: install, type: '安裝', from: place(STOCK), to: place(where) }));
    d.location = place(where);
    // 合約：簽約日在安裝前幾天，2 年或 3 年；有 2 份快到期、1 份已經過了；鼎泰國際三個位置同一份
    const sign = addDays(install, -int(1, 10));
    const end = n === 2 ? addDays(TODAY, 18) : n === 5 ? addDays(TODAY, 26) : n === 9 ? addDays(TODAY, -12) : addMonths(sign, pick([24, 36]));
    const shared = where.startsWith(GROUP) && data.contracts.find(c => c.group);
    if (shared) shared.locations += `、${place(where)}`;
    else data.contracts.push(rec('contracts', { locations: place(where), signDate: sign, endDate: end, ...terms(model), ...(where.startsWith(GROUP) ? { group: true } : {}) }));
    // 有幾台跟著客戶搬到新辦公室：新的位置另簽一份合約，舊的那份提前結束
    if (!where.startsWith(GROUP) && chance(0.15)) {
      const moved = `${where.split(' ')[0]} 新辦公室`;
      const later = addDays(install, int(90, 300));
      const date = later < TODAY ? later : addDays(TODAY, -10);
      data.moves.push(rec('moves', { device: code, date, type: '移機', from: place(where), to: place(moved), note: '客戶搬到新辦公室' }));
      d.location = place(moved);
      data.contracts.at(-1).earlyEnd = date;
      data.contracts.push(rec('contracts', { locations: place(moved), signDate: date, endDate: addMonths(date, 24), ...terms(model) }));
    }

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

// ---------- 看耗材用：長榮物流 新辦公室那台換成一年多的抄表和換耗材紀錄（備註寫「假資料（看耗材）」） ----------
//   2025/06～2026/09 每月 5 日抄上個月（年底多、二月少）；碳粉、感光鼓、加熱組換的時候都有記張數
//   2026/08/20 路過順便抄一次（結算月份空白）：不算帳，8 月那期照樣從 8/5 算到 9/5
//   結果：碳粉 C 快用完（橘）、加熱組超過 10 萬（紅）、感光鼓 71%、碳粉 M 40%、Y 60%、K 26%
const FOCUS = '長榮物流 新辦公室';
const focus = data.devices.find(d => d.location === place(FOCUS));
if (focus) {
  const NOTE = '假資料（看耗材）';
  const code = focus.code;
  const moveIn = data.moves.filter(m => m.device === code && m.to === place(FOCUS)).at(-1);
  if (moveIn && moveIn.date > '2024-06-01') throw new Error(`${FOCUS} 那台太晚搬進來（${moveIn.date}），耗材紀錄會算到別的位置`);
  data.readings = data.readings.filter(r => r.device !== code);
  data.maintenance = data.maintenance.filter(r => r.device !== code);
  const USE = [[4200, 1000], [4300, 1050], [4600, 1150], [4800, 1180], [4700, 1120], [5100, 1250], [5700, 1450], [5300, 1350],
    [3500, 850], [4700, 1150], [4400, 1080], [4600, 1120], [4500, 1100], [4800, 1180], [4400, 1120], [4600, 1150]];
  let bw = 115800;
  let color = 14000;
  const points = USE.map(([b, c], k) => {
    const month = addMonths('2025-06-01', k).slice(0, 7);
    bw += b;
    color += c;
    return rec('readings', { device: code, date: `${addMonths(`${month}-01`, 1).slice(0, 7)}-05`, month, bw, color, note: NOTE });
  });
  data.readings.push(...points);
  // 張數 → 哪一天（前後兩次抄表之間照比例；比第一次抄表還早的，照前三個月的速度往回推）；那天的黑白、彩色張數
  const val = (p, kind) => (kind === 'color' ? p.color : p.bw + p.color);
  const t = s => day(s).getTime();
  const when = (kind, v) => {
    const [p, q] = v < val(points[0], kind) ? [points[0], points[3]]
      : points.slice(0, -1).map((p, i) => [p, points[i + 1]]).find(([p, q]) => v >= val(p, kind) && v <= val(q, kind));
    return t(p.date) + (v - val(p, kind)) / (val(q, kind) - val(p, kind)) * (t(q.date) - t(p.date));
  };
  const countsAt = ms => {
    const i = points.findIndex(p => t(p.date) >= ms);
    const [p, q] = i <= 0 ? [points[0], points[3]] : [points[i - 1], points[i]];
    const lerp = c => Math.round(p[c] + (q[c] - p[c]) * (ms - t(p.date)) / (t(q.date) - t(p.date)));
    return { bw: lerp('bw'), color: lerp('color') };
  };
  const last = points.at(-1);
  // 每一項換的時候的張數：最近一次抄表往回推（一支印幾張）
  [
    ['碳粉 K', 'total', [3000, 14500, 26200, 37700]],
    ['碳粉 C', 'color', [8500, 17700, 26500]],
    ['碳粉 M', 'color', [4000, 14000, 24000]],
    ['碳粉 Y', 'color', [5700, 15200, 24700]],
    ['感光鼓', 'total', [71000]],
    ['加熱組', 'total', [104000]],
  ].forEach(([item, kind, backs]) => backs.forEach(back => {
    const ms = when(kind, val(last, kind) - back);
    data.maintenance.push(rec('maintenance', { device: code, date: iso(new Date(ms)), item, ...countsAt(ms), note: NOTE }));
  }));
  data.readings.push(rec('readings', { device: code, date: '2026-08-20', month: '', ...countsAt(t('2026-08-20')), note: '假資料（順便抄）' }));
}

// ---------- 看位置的異動用：大華貿易 3F 在現在這台之前換過三台（用倉庫裡的機器，換機那天先撤機再安裝） ----------
//   2024/03 裝 IMC6000 #1889 → 2025/01 常卡紙換 IMC3500 #2074 → 2025/08 主機板燒壞換 IMC4500 #1926 → 2026/03 換成現在的新機
//   合約：2024/03 簽的那份 2 年，到期後換新機時重新簽約
const SWAP = '大華貿易 3F';
const swapIn = data.moves.find(m => m.to === place(SWAP));
const swapOld = ['24-0008', '24-0010', '24-0009'].map(c => data.devices.find(d => d.code === c));
if (swapIn && swapOld.every(d => d && d.location === place(STOCK))) {
  const STEPS = [['2024-03-05'], ['2025-01-10', '常卡紙，換一台'], ['2025-08-15', '主機板燒壞，換一台'], [swapIn.date, '換新機']];
  swapOld.forEach((d, i) => {
    const [from, [to, why]] = [STEPS[i], STEPS[i + 1]];
    if (d.buyDate > from[0]) throw new Error(`${d.code} ${d.buyDate} 才買，不能在 ${from[0]} 裝到 ${SWAP}`);
    data.moves.push(rec('moves', { device: d.code, date: from[0], type: '安裝', from: place(STOCK), to: place(SWAP) }));
    data.moves.push(rec('moves', { device: d.code, date: to, type: '撤機', from: place(SWAP), to: place(STOCK), note: why }));
  });
  // 同一天照 id 排：現在這台的安裝排在最後一次撤機之後
  swapIn.id = uid();
  data.contracts.push(rec('contracts', { locations: place(SWAP), signDate: '2024-03-01', endDate: '2026-03-01', ...terms('IMC6000') }));
}

// ---------- 最新回報：抄表程式回報的張數、碳粉剩幾 %（試算表的「最新回報」分頁；沒連結 Google 時 App 用這份） ----------
//   [設備編號, 幾天前回報, 時間, K, Y, M, C]；讀不到的是 null，黑白機只有 K
//   張數：這台最後一次抄表的再多印一點（越久以前回報的多得越少），黑白機沒有彩色
//   日期照產生那天往回推（固定日期的話，過幾天全部變成「N 天前」）
const TONER = [
  ['26-0001', 0, '08:12', 70, 50, 60, 40], ['25-0001', 0, '08:20', 90, 80, 10, 70], ['25-0002', 0, '08:31', 20, 60, 50, 60],
  ['23-0001', 0, '08:05', 60, 30, 40, 50], ['24-0001', 1, '17:45', 40, 70, 70, 80], ['23-0002', 0, '07:58', 80, 90, 90, 90],
  ['24-0002', 5, '09:10', 50, 40, 60, 30], ['23-0003', 0, '08:30', 80, 40, 60, 10], ['25-0003', 0, '08:44', 30, 50, 20, 40],
  ['25-0004', 0, '09:02', 100, 100, 100, 100], ['26-0002', 0, '08:15', 60, 70, 80, 60], ['24-0003', 0, '08:40', 10, 50, 60, 70],
  ['24-0004', 0, '07:50', 50, 60, 40, 50], ['25-0005', 12, '16:20', 70, 20, 30, 40], ['24-0005', 0, '08:25', 40, 50, 50, 50],
  ['25-0006', 0, '08:08', 30, 30, 30, 30], ['24-0006', 0, '08:36', 90, 60, 70, 80], ['25-0007', 0, '08:50', 70, 0, 40, 60],
  ['24-0007', 0, '08:18', 50, 60, 70, 60], ['26-0003', 0, '08:27', 10, null, null, null], ['26-0004', 0, '08:33', 60, null, null, null],
  ['25-0008', 0, '08:41', 80, null, 60, 70], ['26-0005', 7, '11:05', 40, 30, 50, 20], ['25-0012', 0, '08:22', 60, 70, 70, 60],
];
const NOW = iso(new Date(Date.now() - new Date().getTimezoneOffset() * 60000));
data.toner = TONER.map(([device, ago, time, K, Y, M, C]) => {
  const d = data.devices.find(x => x.code === device);
  if (!d) throw new Error(`最新回報：找不到設備 ${device}`);
  const last = data.readings.filter(r => r.device === device).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const bw = last ? Number(last.bw) + 1200 - ago * 60 : null;
  const color = last && Y !== null ? Number(last.color || 0) + 300 - ago * 15 : null;
  return { serial: d.serial, device, date: addDays(NOW, -ago), time, bw, color, K, Y, M, C };
});

// 合約修改紀錄：第一份合約的抄表日期打錯過
const first = data.contracts[0];
data.contractLog.push(rec('contractLog', { contract: first.id, date: addDays(first.signDate, 3), field: '抄表日期', before: '每月 52 日', after: first.readDay }));
data.contracts.forEach(c => { delete c.group; });

process.stdout.write(JSON.stringify({ app: 'devicemanager', version: 1, exportedAt: `${TODAY}T00:00:00.000Z`, ...data }, null, 2));
