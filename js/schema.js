// 資料表的欄位定義（除了 optional 的欄位，全部必填）
//   type:        date | text | number | url | email | tel（網址、Email、電話都存成文字，表單上換成對應的鍵盤）
//                ref（從清單選，存的是名字）：ref 是哪張表（statuses、options、people、vendors）；
//                     options 另外寫 list（類別、位置、品牌），people、vendors 另外寫 role（用途、類型有勾這一項的才列出來）
//                multi（可以複選）：choices 是選項，存成「保管人、執行人」
//                flag（勾選）：存 true／false，試算表上是核取方塊
//   optional:    可以空白
//   format:      列表卡片上的顯示方式
//   digits:      數字顯示時最少的小數位數
//   full:        表單中佔滿整列（預設半列）
//   tight:       表單上字距縮一點（主機板號碼 15 碼在半格裡放得下）
//   section:     表單裡從這個欄位開始的一段的小標題（基本資料、機器識別…）
//   multiline:   表單上是可以換行的大格子（備註）
//   upper:       存檔時英文字母轉大寫（員工編號）
//   auto:        系統自己產生、不能改（設備的編號）：auto(這一筆) 回傳新的值；新增時存檔才給，給了就不會變
//   keep:        連續新增時保留該欄的值（一次買好幾台時，類別、品牌、購買日期不用重填）
//   default:     新增時預先填入的值；可以是函式（第一個狀態）
//   hint:        顯示在表單欄位下方的說明
//   note:        依表單目前填的內容，顯示在欄位下方的提醒：note(values) 回傳文字或 { text, warn }，不用提醒時回傳空字串
//   clean:       存檔前整理打的字：clean(打的字) 回傳要存的值（主機板號碼補上 RNP、轉大寫）
//   calc:        依表單目前填的內容先算好填上：calc(values) 回傳數字，算不出來時回傳 null
//                欄位空白、或還是上次算的數字時才填，自己改過的不蓋掉（見 form.js）
//   caps:        手機鍵盤預設大寫（編號、序號常有英文字母）
//   suggest:     表單下方的快選按鈕（預設值 + 最近輸入過的值），只是提示，不限制；有預設值時試算表也有下拉選單
//   toggle:      表單上改成左右切換的按鈕（有 toggle 時不顯示 suggest 的快選按鈕）：[{ value, label, tone, match }]
//                value 是存的值；tone 是顏色（列表上的標籤也用這個顏色）；match 是認得的寫法（試算表手打的字）
//   was:         這個欄位以前在試算表上的標題（改名前），讀得到舊標題的試算表，同步時改成新標題
//   （資料表）title:     頁面標題，也是試算表的分頁名稱
//   （資料表）formTitle: 表單標題用的名稱，沒有時用 title
//   （資料表）unit:      筆數的單位（「3 台設備」），被清單引用時的說明用
//   （資料表）card:      列表卡片：code 灰色小字、title 名稱、badge 標籤、primary 右上角、grid 卡片下方的欄位（沒有時列出其餘全部）
//   （資料表）note:      卡片最下面的一行：note(列) 回傳 { text, warn } 或 null
//   （資料表）period:    依日期篩選與分組：{ key, unit: 'month' | 'day', label }；沒有時依 sort 排序
//   （資料表）sort:      沒有 period 時的排序欄位（由小到大）
//   （資料表）filter:    列表上方的篩選按鈕（依這個欄位：toggle 的選項，或從清單選的欄位的清單，例如狀態）
//   （資料表）groups:    可以選的分組方式：[[欄位, 名稱]]
//   （資料表）search:    搜尋框找哪些欄位；沒有時找 card 的 code 和 title
//   （資料表）unique:    不能和其他筆重複的欄位組合：[[欄位, …], …]；全部空白的不算
//   （資料表）uniqueMsg: 重複時的提醒：uniqueMsg(已經有的那一筆, 欄位組合) 回傳文字
//   （資料表）noList:    不是底部分頁的列表（選項、人員、廠商在設定的「清單」裡管理，見 lists.js）
//   （資料表）target:    被其他表的 ref 欄位引用（見 refs.js）：
//                       name 名字的欄位；group 分清單的欄位（options 的 list）；roles 用途的欄位（可複選）
//                       active(列) 會不會出現在下拉選單；sub(列) 下拉選單裡名字後面的小字；off 停用時的標籤
//                       order 排序的欄位（數字小的在前，沒有時依名字排）；tone(列) 標籤的顏色（狀態）
//                       removeHint 有人在用、不能刪除時的建議
//   （資料表）seed:      全新的裝置上預先放的資料（id 用 seed- 開頭，沒改過時不算這台裝置的資料，見 storage.js）
//   （資料表）intro、empty: 列表最上面的說明、還沒有資料時列表顯示的文字

// 狀態的顏色：試算表上寫中文，畫面上換成對應的樣式（見 style.css 的 .badge.blue 等）
const COLORS = [
  { value: '藍', tone: 'blue' }, { value: '紫', tone: 'purple' }, { value: '橘', tone: 'orange' },
  { value: '綠', tone: 'green' }, { value: '灰', tone: 'gray' }, { value: '紅', tone: 'red' },
];
const toneOf = color => COLORS.find(c => c.value === String(color ?? '').trim())?.tone || '';

// 預設的狀態（出租用語）；報廢不用提醒
const DEFAULT_STATUSES = [
  { name: '出租中', color: '藍' },
  { name: '庫存', color: '紫' },
  { name: '維修中', color: '橘' },
  { name: '報廢', color: '灰', quiet: true },
];

// 只有名字的清單，都放在「選項」表，用「清單」欄分
const OPTION_LISTS = ['類別', '位置', '品牌'];
const DEFAULT_CATEGORIES = ['筆電', '桌機', '螢幕', '印表機', '網路設備', '手機', '平板'];
const PERSON_ROLES = ['保管人', '執行人', '經手人'];
const VENDOR_TYPES = ['購買', '維修'];

// 設備的編號：年份兩位數＋流水號四位數（26-0001），年份照購買日期，沒填購買日期用今年
//   同一年的取最大的號碼往下編；舊的、自己打的編號（NB-001）不影響
const CODE_RE = /^(\d{2})-(\d{4,})$/;
function nextDeviceCode(rec = {}) {
  const yy = String(U.parseDate(rec.buyDate ?? '') || U.today()).slice(2, 4);
  const max = Store.list('devices').reduce((n, r) => {
    const m = String(r.code ?? '').match(CODE_RE);
    return m && m[1] === yy ? Math.max(n, Number(m[2])) : n;
  }, 0);
  return `${yy}-${String(max + 1).padStart(4, '0')}`;
}

// 同步之後整理編號（見 sync.js）：
//   沒有編號的（在試算表裡手打、沒填編號的列）補上
//   系統給的編號重複了（手機和電腦都沒網路時各新增一台）：先新增的留著，後新增的換下一號
//   回傳改到的 [{ id, from, to, name }]；from 是空字串時是補上的
function fixDeviceCodes() {
  const out = [];
  const seen = new Set();
  // id 前段是新增的時間，照 id 排就是照新增的先後
  [...Store.list('devices')].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)).forEach(r => {
    const code = String(r.code ?? '').trim();
    if (code && !(CODE_RE.test(code) && seen.has(code))) {
      seen.add(code);
      return;
    }
    const to = nextDeviceCode(r);
    Store.update('devices', r.id, { code: to });
    seen.add(to);
    out.push({ id: r.id, from: code, to, name: r.name });
  });
  return out;
}

// 主機板號碼（事務機的 DNS 名稱）：RNP＋12 碼，例如 RNP123456789012
//   只打後面 12 碼也可以，存檔時補上 RNP；英文轉大寫、拿掉空白和分隔符號
const BOARD_RE = /^RNP[0-9A-Z]{12}$/;
function cleanBoard(v) {
  const t = U.toHalf(String(v ?? '')).trim().toUpperCase().replace(/[\s:.\-]/g, '');
  return /^[0-9A-Z]{12}$/.test(t) && !t.startsWith('RNP') ? `RNP${t}` : t;
}
// 格式不對時提醒（還是可以存，避免特殊型號被擋住）；打的和要存的不一樣時，寫會存成什麼
function boardNote(values) {
  const raw = String(values.board ?? '').trim();
  const v = cleanBoard(raw);
  if (!v) return '';
  if (!BOARD_RE.test(v)) return { text: '格式應該是 RNP＋12 碼，例如 RNP123456789012', warn: true };
  return v === raw ? '' : `會存成 ${v}`;
}

// 新增設備時預設的狀態：清單裡排第一個的
const firstStatus = () => Refs.items(SCHEMAS.devices.fields.find(f => f.key === 'status'))[0]?.name ?? '';
// 這個狀態要不要提醒（報廢、遺失這類勾了「不用提醒」的不提醒）
const quietStatus = name => !!Refs.find(SCHEMAS.devices.fields.find(f => f.key === 'status'), name)?.quiet;

// 保固：快到期（30 天內）標色，過期寫出來；不用提醒的狀態（報廢）不寫
const WARRANTY_SOON = 30;
function warrantyNote(r) {
  if (!r.warranty || quietStatus(r.status)) return null;
  const days = Math.round((Date.parse(r.warranty) - Date.parse(U.today())) / 86400000);
  const date = U.fmtDate(r.warranty);
  if (days < 0) return { text: `保固已過期（${date}）`, warn: false };
  if (days <= WARRANTY_SOON) return { text: days ? `保固剩 ${days} 天（${date}）` : `保固今天到期（${date}）`, warn: true };
  return { text: `保固到 ${date}`, warn: false };
}

// 停用的選項、廠商；離職日已經過了的人員
const notDisabled = r => !r.disabled;
const stillHere = r => !r.leaveDate || r.leaveDate > U.today();

const SCHEMAS = {
  devices: {
    title: '設備',
    unit: '台設備',
    sort: 'code',
    filter: 'status',
    groups: [['category', '類別'], ['location', '位置'], ['keeper', '保管人']],
    search: ['code', 'name', 'brand', 'model', 'serial', 'board', 'location', 'keeper'],
    card: { code: 'code', title: 'name', badge: 'status', grid: ['category', 'location', 'keeper'] },
    note: warrantyNote,
    unique: [['code'], ['board']],
    uniqueMsg: (dup, keys) => (keys[0] === 'board'
      ? `這個主機板號碼已經用在 ${dup.code} ${dup.name}`
      : `編號 ${dup.code} 已經用過了（${dup.name}）`),
    empty: '還沒有設備<br>點右上角「＋ 新增」開始記錄',
    fields: [
      // 年份照購買日期（沒填用今年），給了就不會變
      { key: 'code',     label: '編號',     type: 'text', auto: nextDeviceCode, section: '基本資料' },
      { key: 'name',     label: '名稱',     type: 'text' },
      { key: 'status',   label: '狀態',     type: 'ref', ref: 'statuses', default: () => firstStatus() },
      { key: 'category', label: '類別',     type: 'ref', ref: 'options', list: '類別', optional: true, keep: true },
      { key: 'brand',    label: '品牌',     type: 'ref', ref: 'options', list: '品牌', optional: true, keep: true },
      { key: 'model',    label: '型號',     type: 'text', optional: true, keep: true },
      { key: 'serial',   label: '序號',     type: 'text', optional: true, caps: true, section: '機器識別' },
      { key: 'board',    label: '主機板號碼', type: 'text', optional: true, caps: true, tight: true, clean: cleanBoard, note: boardNote },
      { key: 'location', label: '位置',     type: 'ref', ref: 'options', list: '位置', optional: true, keep: true, section: '放置與保管' },
      { key: 'keeper',   label: '保管人',   type: 'ref', ref: 'people', role: '保管人', optional: true },
      { key: 'buyDate',  label: '購買日期', type: 'date', optional: true, keep: true, section: '購買與保固' },
      { key: 'price',    label: '購買金額', type: 'number', optional: true, keep: true },
      { key: 'vendor',   label: '購買廠商', type: 'ref', ref: 'vendors', role: '購買', optional: true, keep: true },
      { key: 'warranty', label: '保固到期', type: 'date', optional: true, keep: true },
      { key: 'link',     label: '連結',     type: 'url', optional: true, full: true, hint: '照片、說明書或雲端硬碟資料夾的網址', section: '其他' },
      { key: 'note',     label: '備註',     type: 'text', optional: true, full: true, multiline: true },
    ],
  },

  // 狀態：出租中、庫存…，可以自己加；顏色是列表上的標籤和篩選按鈕的顏色
  statuses: {
    title: '狀態',
    noList: true,
    target: { name: 'name', order: 'order', active: notDisabled, tone: r => toneOf(r.color),
      sub: r => (r.quiet ? '不用提醒' : ''), off: '停用', removeHint: '不再使用的話，可以勾「停用」' },
    unique: [['name']],
    uniqueMsg: dup => `已經有「${dup.name}」了`,
    seed: () => DEFAULT_STATUSES.map((s, i) => ({ id: `seed-s${i + 1}`, name: s.name, color: s.color, order: i + 1, quiet: !!s.quiet, disabled: false })),
    fields: [
      { key: 'name',     label: '名稱',     type: 'text' },
      { key: 'order',    label: '順序',     type: 'number', optional: true, hint: '數字小的排前面；新增設備時預設選第一個' },
      { key: 'color',    label: '顏色',     type: 'text', full: true, default: '藍', suggest: COLORS.map(c => c.value),
        toggle: COLORS.map(c => ({ value: c.value, label: c.value, tone: c.tone, match: new RegExp(`^${c.value}$`) })) },
      { key: 'quiet',    label: '不用提醒', type: 'flag', optional: true, hint: '報廢、遺失這類：不提醒保固、保養' },
      { key: 'disabled', label: '停用',     type: 'flag', optional: true, hint: '不會出現在選單裡，已經用到的設備照常顯示' },
    ],
  },

  // 只有名字的清單（類別、位置、品牌）
  options: {
    title: '選項',
    noList: true,
    target: { name: 'name', group: 'list', active: notDisabled, off: '停用', removeHint: '不再使用的話，可以勾「停用」' },
    unique: [['list', 'name']],
    uniqueMsg: dup => `${dup.list}清單裡已經有「${dup.name}」了`,
    seed: () => DEFAULT_CATEGORIES.map((name, i) => ({ id: `seed-${i + 1}`, list: '類別', name, disabled: false })),
    fields: [
      { key: 'list',     label: '清單', type: 'text', full: true, suggest: OPTION_LISTS,
        toggle: OPTION_LISTS.map(v => ({ value: v, label: v, tone: '', match: new RegExp(`^${v}$`) })) },
      { key: 'name',     label: '名稱', type: 'text', full: true },
      { key: 'disabled', label: '停用', type: 'flag', optional: true, hint: '不會出現在選單裡，已經用到的設備照常顯示' },
    ],
  },

  // 人員：保管人、保養的執行人、異動的經手人都從這裡選（用途有勾的才列出來）
  //   不放身分證、薪資等敏感資料
  people: {
    title: '人員',
    noList: true,
    target: { name: 'name', roles: 'roles', active: stillHere, sub: r => [r.jobTitle, r.dept].filter(Boolean).join(' · '),
      off: '已離職', removeHint: '不再使用的話，可以填「離職日」' },
    unique: [['code'], ['name']],
    uniqueMsg: (dup, keys) => (keys[0] === 'code'
      ? `員工編號 ${dup.code} 已經用過了（${dup.name}）`
      : `已經有「${dup.name}」了；同名的話可以寫成「${dup.name}（部門）」`),
    fields: [
      { key: 'name',      label: '姓名',     type: 'text' },
      { key: 'code',      label: '員工編號', type: 'text', optional: true, caps: true, upper: true, hint: '有填的話不能重複' },
      { key: 'jobTitle',  label: '職稱',     type: 'text', optional: true },
      { key: 'dept',      label: '部門',     type: 'text', optional: true },
      { key: 'phone',     label: '電話',     type: 'tel', optional: true },
      { key: 'email',     label: 'Email',    type: 'email', optional: true },
      { key: 'joinDate',  label: '入職日',   type: 'date', optional: true },
      { key: 'leaveDate', label: '離職日',   type: 'date', optional: true, hint: '這天以後不會出現在選單裡' },
      { key: 'roles',     label: '用途',     type: 'multi', choices: PERSON_ROLES, full: true, hint: '勾了才會出現在那個欄位的選單裡' },
      { key: 'note',      label: '備註',     type: 'text', optional: true, full: true, multiline: true },
    ],
  },

  // 廠商：購買廠商、維修廠商都從這裡選（類型有勾的才列出來）
  vendors: {
    title: '廠商',
    noList: true,
    target: { name: 'name', roles: 'types', active: notDisabled, sub: r => [r.contact, r.phone].filter(Boolean).join(' · '),
      off: '停用', removeHint: '不再使用的話，可以勾「停用」' },
    unique: [['name']],
    uniqueMsg: dup => `已經有「${dup.name}」了`,
    fields: [
      { key: 'name',     label: '名稱',   type: 'text' },
      { key: 'types',    label: '類型',   type: 'multi', choices: VENDOR_TYPES, hint: '勾了才會出現在那個欄位的選單裡' },
      { key: 'contact',  label: '聯絡人', type: 'text', optional: true },
      { key: 'phone',    label: '電話',   type: 'tel', optional: true },
      { key: 'address',  label: '地址',   type: 'text', optional: true, full: true },
      { key: 'disabled', label: '停用',   type: 'flag', optional: true, hint: '不會出現在選單裡，已經用到的設備照常顯示' },
      { key: 'note',     label: '備註',   type: 'text', optional: true, full: true, multiline: true },
    ],
  },
};
