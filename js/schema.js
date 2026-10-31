// 資料表的欄位定義（除了 optional 的欄位，全部必填）
//   type:        date | month | text | number | url | email | tel（網址、Email、電話都存成文字，表單上換成對應的鍵盤）
//                month（月份）：存 2026-09，試算表上是文字 2026/09，表單上是年月的選單
//                ref（從清單選，存的是名字）：ref 是哪張表（statuses、options、people、vendors、devices、locations）；
//                     options 另外寫 list（類別、品牌…）
//                     紀錄的「設備」欄也是 ref：存設備編號（devices 的 target 見下面）；位置存位置編號（locations）
//                     many：可以選好幾個，存成「L0001、L0002」（合約的位置）
//                     rank：下拉選單先依它排（數字小的在前），同一級再照平常的排法；rank() 回傳 (一項) → 數字
//                           每次列選單時呼叫一次，先算好要用的（異動的新位置：空的位置在最上面）
//                     only：下拉選單依表單填的內容只列一部分：only(values) 回傳 (一項) → true/false，不用篩時回傳 null（異動依類型）
//                     onlyNote：打了一項沒列出來的名字時，選單裡寫為什麼：onlyNote(values) 回傳文字
//                     noAdd：這一欄的下拉選單不能「＋ 新增」（位置的業務員：要先到人員勾業務員）
//                multi（可以複選）：choices 是選項，存成「甲、乙」
//                flag（勾選）：存 true／false，試算表上是核取方塊
//   optional:    可以空白
//   format:      列表卡片上的顯示方式
//   digits:      數字顯示時最少的小數位數
//   full:        表單中佔滿整列（預設半列）
//   tight:       表單上字距縮一點（主機板號碼 15 碼在半格裡放得下）
//   section:     表單裡從這個欄位開始的一段的小標題（基本資料、機器識別…）
//   formLabel:   表單上的名稱和試算表的標題不一樣時（紀錄的設備欄：試算表寫「設備」，表單上寫「位置」，異動寫「原位置」）
//   placeholder: 從清單選的欄位裡的灰字，沒有時寫「選擇或搜尋」
//   hidden:      表單上不顯示，由 calc 填好（異動的原位置）
//   multiline:   表單上是可以換行的大格子（備註）
//   upper:       存檔時英文字母轉大寫（員工編號、序號）
//   auto:        系統自己產生、不能改（設備的編號）：auto(這一筆) 回傳新的值；新增時存檔才給，給了就不會變
//   keep:        連續新增時保留該欄的值（一次買好幾台時，類別、品牌、購買日期不用重填）
//                可以是函式：keep(values) 為 true 時才留（設備的位置：倉庫才留）
//   default:     新增時預先填入的值；可以是函式（設備的位置：第一個倉庫）
//   hint:        顯示在表單欄位下方的說明
//   note:        依表單目前填的內容，顯示在欄位下方的提醒：note(values) 回傳文字或 { text, warn }，不用提醒時回傳空字串
//                values 是各欄位目前填的內容，另外 values.id 是正在編輯的那一筆的 id（新增時是 null）
//                位置先留好，沒有提醒時也空著（提醒出現時表單不會跳）；文字要放得進 noteLines 行，多的會被截掉
//   noteLines:   提醒留幾行（預設 1；張數的「上次…／使用量…」是 2 行，用 \n 換行）
//   clean:       存檔前整理打的字：clean(打的字, values) 回傳要存的值（主機板號碼補上 RNP、轉大寫；機型轉大寫）
//                清單的名字：下拉選單的「＋ 新增」也照它整理（見 refs.js 的 quickAdd）
//   calc:        依表單目前填的內容先填好：calc(values) 回傳要填的值，沒有時回傳空字串
//                只在依的欄位改了、算出來的值跟著變時才填；欄位空白、或還是上次填的值時才換，自己改過的不蓋掉（見 form.js）
//   lock:        舊資料不能在表單上改的原因：lock(這一筆) 回傳說明（有異動的設備，位置要新增異動），可以改時回傳空字串
//   shown:       畫面上寫的字依其他欄位算的：shown(values)（異動的原位置寫那天機器在哪裡）；回傳空字串時照平常的寫法
//                從清單選的欄位選好後、不能改的欄位都照它寫
//   check:       存檔時和其他欄位一起檢查：check(values) 回傳錯誤（寫在這一格下面、不存），沒問題時回傳空字串
//   showIf:      依其他欄位才出現：showIf(values) 為 false 時藏起來（選項的世代只有機型有）
//   caps:        手機鍵盤預設大寫（編號、序號常有英文字母）
//   suggest:     表單下方的快選按鈕（預設值 + 最近輸入過的值），只是提示，不限制；有預設值時試算表也有下拉選單
//   toggle:      表單上改成左右切換的按鈕（有 toggle 時不顯示 suggest 的快選按鈕）：[{ value, label, tone, match }]
//                value 是存的值；tone 是顏色（列表上的標籤也用這個顏色）；match 是認得的寫法（試算表手打的字）
//   was:         這個欄位以前在試算表上的標題（改名前），讀得到舊標題的試算表，同步時改成新標題
//   （資料表）title:     頁面標題，也是試算表的分頁名稱
//   （資料表）formTitle: 表單標題用的名稱，沒有時用 title；可以是函式：formTitle(這一筆或新增時帶入的值)（選項寫清單的名稱）
//   （資料表）formOrder: 表單上先排的欄位（其他照 fields 的順序）；試算表照 fields 的順序（異動：表單上類型在最上面）
//   （資料表）describe:  一筆資料的簡短說明（儲存後的提示、提醒裡用）：describe(列)；沒有時用 card 的編號、名稱、標籤
//   （資料表）unit:      筆數的單位（「3 台設備」），被清單引用時的說明用
//   （資料表）card:      列表卡片：code 灰色小字、title 名稱（可以是函式：title(列)）、sub(列) 名稱下面一行小字、badge 標籤、primary 右上角、
//                       side(列) sub 那一行的右邊（標籤下面）：{ text, tone } 或 null，tone 是 fresh 綠字／old 橘字
//                       grid 卡片下方的欄位（沒有時列出其餘全部）
//   （資料表）status:    沒有 badge 時的標籤：status(列) 回傳 { label, cls } 或 null（目前的合約、已拆除）
//   （資料表）note:      卡片最下面的一行：note(列) 回傳 { text, warn } 或 null
//   （資料表）period:    依日期篩選與分組：{ key, unit: 'month' | 'day', label }，新到舊；沒有時依 order 或 sort 排序
//                       fallback：key 空白時照哪個欄位排（抄表：結算月份空白的照抄表日期）；emptyHead：空白的那一組的標題
//   （資料表）order:     沒有 period 時的排序：order(a, b)，和陣列的 sort 一樣
//   （資料表）sort:      沒有 period、order 時的排序欄位（由小到大）
//   （資料表）filter:    列表上方的篩選按鈕（依這個欄位：toggle 的選項，或從清單選的欄位的清單，例如狀態）
//   （資料表）groups:    可以選的分組方式：[[欄位, 名稱]]
//   （資料表）search:    搜尋框找哪些欄位；沒有時找 card 的 code 和 title
//   （資料表）searchText: 另外讓搜尋找得到的字：searchText(列)（紀錄的設備名稱、位置）
//   （資料表）searchHint: 搜尋框裡的灰字；沒有時寫 search 前兩個欄位
//   （資料表）unique:    不能和其他筆重複的欄位組合：[[欄位, …], …]；全部空白的不算
//   （資料表）uniqueMsg: 重複時的提醒：uniqueMsg(已經有的那一筆, 欄位組合) 回傳文字
//   （資料表）noList:    不是底部分頁的列表（選項、人員、廠商在設定的「清單」裡管理，見 lists.js）
//   （資料表）target:    被其他表的 ref 欄位引用（見 refs.js）：
//                       name 名字的欄位；group 分清單的欄位（options 的 list）
//                       active(列) 會不會出現在下拉選單；sub(列) 下拉選單裡名字後面的小字；off 停用時的標籤
//                       order 排序的欄位（數字小的在前，沒有時依名字排）；tone(列) 標籤的顏色（狀態）
//                       label(列) 下拉選單和欄位上顯示的字，和存的名字不一樣時（設備：顯示位置、存編號；位置：顯示名稱、存編號）
//                         有 label 的不列在「不在清單裡」（存的是編號，不能用打的字加進清單），下拉選單依 label 排
//                       addAs 下拉選單裡「＋ 新增」時打的字放在哪個欄位（位置：名稱；沒有時放 name 的欄位）
//                       also(列) 下拉選單裡打字時另外找得到的字（位置：以前的名字）
//                       removeHint 有人在用、不能刪除時的建議
//                       noAdd 下拉選單裡不能「＋ 新增」、不列在「不在清單裡」（設備：紀錄的設備欄只能選已經有的設備）
//                       cascade 刪除時連同用到它的紀錄一起刪（先問），不是擋下來（設備）
//   （資料表）copy:      編輯時表單下面的「以這筆為底新增」按鈕（合約的「重新簽約」）：
//                       { label 按鈕上的字, keys 帶過去的欄位, watch 改了這些欄位時 note 變橘色, note 按鈕下面的說明 }
//   （資料表）action:    編輯時表單下面另一個按鈕（和 copy 同一個位置，人員的「複製邀請連結」）：
//                       { key, label 按鈕上的字, show(這一筆) 要不要出現, note(這一筆) 按鈕下面的說明 }；按了交給 app.js（Form.init 的 action）
//   （資料表）history:   編輯時表單最下面的修改紀錄：history(這一筆) 回傳 [{ date, text }]
//   （資料表）once:      新增時沒有「儲存，再新增一筆」（異動、抄表、翻新、合約：一次一筆，連續輸入很容易同一台機器多存一筆）
//   （資料表）next:      新增好按「儲存」後接著打開的表單：next(存好的那一筆) 回傳 { table, preset, message } 或 null（安裝、撤機後抄表）
//   （資料表）afterSave、afterRemove: 新增、修改、刪除之後要跟著改的（異動改了，設備的位置跟著算）：
//                       afterSave(改之前（新增時是 null）, 改之後)、afterRemove(刪掉的那一筆)
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

// 只有名字的清單，都放在「選項」表，用「清單」欄分（位置以前也在這裡，2026-10-11 搬到自己的「位置」表）
const OPTION_LISTS = ['類別', '品牌', '機型', '保養項目', '選配件'];
// 機型的世代（快選按鈕）：總覽依世代分組；空白時照型號猜（見 records.js 的 guessGen）
const GENERATIONS = ['IM C', 'C xx04', 'C xx03', 'C xx01', 'C xx00', '黑白 MP', '其他'];
// 可以自己排順序的清單（設定 → 清單 →「排序」，↑ ↓ 移動）；其他的依名字排（品牌）
const SORTED_LISTS = ['類別', '機型', '保養項目', '選配件'];
// 機型存大寫（imc6000 → IMC6000）；其他清單照打的存（品牌 Ricoh）
const cleanOption = (v, values) => (values.list === '機型' ? U.toHalf(v).toUpperCase() : v);
// 預設項目（沒改過時不算這台裝置的資料），照寫的順序排；id 的開頭：類別是 seed-1…，其他加上清單的代號
const DEFAULT_OPTIONS = [
  { list: '類別', id: '', names: ['事務機', '打卡鐘', '碎紙機'] },
  // 感光鼓、加熱組預設壽命 10 萬張（提前回收保養，不等故障）；碳粉空白，用這個客戶的平均
  { list: '保養項目', id: 'mt', names: ['碳粉 K', '碳粉 C', '碳粉 M', '碳粉 Y', '感光鼓', '加熱組', '廢粉盒', '清潔保養'],
    extra: { 感光鼓: { life: 100000 }, 加熱組: { life: 100000 } } },
  { list: '選配件', id: 'part', names: ['送紙匣', '裝訂器', '傳真卡', '底座'] },
];

// 左右切換的選項：[{ value, tone }] → toggle 的寫法
const toggleOf = list => list.map(o => ({ value: o.value, label: o.value, tone: o.tone, match: new RegExp(`^${o.value}$`) }));
const MOVE_TYPES = [{ value: '安裝', tone: 'blue' }, { value: '撤機', tone: 'gray' }, { value: '移機', tone: 'purple' }, { value: '其他', tone: '' }];
const COUNTRIES = [{ value: '美', tone: '' }, { value: '日', tone: '' }]; // 翻新的國別
const PAGE_KINDS = [{ value: '全部', tone: '' }, { value: '彩色', tone: '' }]; // 保養項目算哪種張數（全部＝黑白加彩色）
// 合約的抄表週期（總覽的「該抄表了」照它算，空白當每月，見 records.js 的 readingsDue）
const READ_CYCLES = ['每月', '雙月', '每季', '半年', '每年'].map(value => ({ value, tone: '' }));
// 業務員的權限（人員勾了業務員才有；新的業務員預設全部打開，見 PLAN.md 的業務員）：只能新增，不能改、不能刪
const SALES_PERMS = ['記抄表', '記保養'];

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

// 位置的編號：L＋流水號四位數（L0001），取最大的號碼往下編
const LOC_RE = /^L(\d{4,})$/;
function nextLocationCode() {
  const max = Store.list('locations').reduce((n, r) => {
    const m = String(r.code ?? '').match(LOC_RE);
    return m ? Math.max(n, Number(m[1])) : n;
  }, 0);
  return `L${String(max + 1).padStart(4, '0')}`;
}

// 同步之後整理編號（見 sync.js）：
//   沒有編號的（在試算表裡手打、沒填編號的列）補上
//   系統給的編號重複了（手機和電腦都沒網路時各新增一台）：先新增的留著，後新增的換下一號
//   回傳改到的 [{ id, from, to, name }]；from 是空字串時是補上的
function fixCodes(table, re, next) {
  const out = [];
  const seen = new Set();
  // id 前段是新增的時間，照 id 排就是照新增的先後
  [...Store.list(table)].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1)).forEach(r => {
    const code = String(r.code ?? '').trim();
    if (code && !(re.test(code) && seen.has(code))) {
      seen.add(code);
      return;
    }
    const to = next(r);
    Store.update(table, r.id, { code: to });
    seen.add(to);
    out.push({ id: r.id, from: code, to, name: r.name });
  });
  return out;
}
const fixDeviceCodes = () => fixCodes('devices', CODE_RE, nextDeviceCode);
const fixLocationCodes = () => fixCodes('locations', LOC_RE, nextLocationCode);

// 主機板號碼（事務機的 DNS 名稱）：RNP＋12 碼，例如 RNP123456789012
//   只打後面 12 碼也可以，存檔時補上 RNP；英文轉大寫、拿掉空白和分隔符號
//   不提醒格式：有人只打後六碼，照打的存
function cleanBoard(v) {
  const t = U.toHalf(String(v ?? '')).trim().toUpperCase().replace(/[\s:.\-]/g, '');
  return /^[0-9A-Z]{12}$/.test(t) && !t.startsWith('RNP') ? `RNP${t}` : t;
}

// 狀態清單裡排第一個的（設備的狀態帶不出庫存、出租中時用，見 records.js 的 deviceStatus）
const firstStatus = () => Refs.items(SCHEMAS.devices.fields.find(f => f.key === 'status'))[0]?.name ?? '';
// 新增設備時預設的位置：選單裡排第一個的倉庫；沒有倉庫時空白
const firstStock = () => Refs.items(SCHEMAS.devices.fields.find(f => f.key === 'location')).find(p => p.stock)?.code ?? '';
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

// 紀錄（異動、合約、抄表、保養、翻新、選配件）共用的欄位；計算見 records.js
//   設備：存設備編號（24-0001）；表單上寫「位置」，打位置找設備（一個位置放一台），下面寫編號和名稱
//   選好後寫那天機器在哪裡（撤機那天的抄表寫原來的客戶，不是剛撤回的倉庫）
const deviceField = (more = {}) => ({
  key: 'device', label: '設備', formLabel: '位置', placeholder: '打位置找設備', type: 'ref', ref: 'devices', full: true,
  note: v => Records.deviceNote(v.device), shown: v => (v.date ? Records.placeName(Records.locationAt(v.device, v.date)) : ''), ...more,
});
const dateField = (key, label, more = {}) => ({ key, label, type: 'date', default: () => U.today(), ...more });
const noteField = () => ({ key: 'note', label: '備註', type: 'text', optional: true, full: true, multiline: true });
// 張數：下面寫上一次的張數和使用量，比上一次少時提醒
const countField = (key, label, more = {}) => ({
  key, label, type: 'number', optional: true, note: v => Records.countNote(v, key), noteLines: 2, ...more,
});
// 紀錄列表上方選月份；同一個月裡照日期排，新的在上面（同一天的照新增的先後）
const recordMonth = key => ({ key, unit: 'month', label: '月份', then: key });
// 位置：存位置編號（L0001），畫面上寫名稱（見 records.js 的 placeName）
const placeField = (key, label, more = {}) => ({
  key, label, type: 'ref', ref: 'locations', format: v => Records.placeName(v), ...more,
});

const SCHEMAS = {
  //   編號（24-0001）是系統用來對紀錄的，畫面上不顯示；認機器看「機型＋名稱」（名稱填機身號碼 #1234）
  devices: {
    title: '設備',
    unit: '台設備',
    order: (a, b) => Records.deviceOrder(a, b), // 照機型清單的順序，同一個機型依名稱
    filter: 'status',
    groups: [['category', '類別'], ['model', '機型'], ['location', '位置'], ['keeper', '保管人']],
    search: ['serial', 'name', 'brand', 'model', 'board', 'keeper'],
    searchText: r => Records.placeText(r.location),
    searchHint: '搜尋序號、名稱或位置',
    // 標題寫機型＋名稱（IMC6000 #1001），下面一行寫機器序號（查機器、印紀錄時最常用）
    //   序號那一行的右邊（狀態標籤下面）寫最新回報多久以前（今天 08:30、5 天前）；沒回報過的不寫（見 records.js 的 reportNote）
    card: { title: r => Records.label(r), sub: r => (r.serial ? `序號 ${r.serial}` : ''), side: r => Records.reportNote(r), badge: 'status', grid: ['location', 'keeper'] },
    note: warrantyNote,
    describe: r => Records.label(r),
    unique: [['code'], ['board']],
    uniqueMsg: (dup, keys) => (keys[0] === 'board'
      ? `這個主機板號碼已經用在 ${Records.label(dup)}`
      : `編號 ${dup.code} 已經用過了（${Records.label(dup)}）`),
    // 紀錄的「設備」欄從這裡選：顯示位置、存編號（沒填位置的顯示機型＋名稱）；刪除設備時連同它的紀錄一起刪（見 form.js）
    // 業務員模式：選單只列放在他位置的（以前放過、已經搬走的不列，見 records.js 的 isShown）
    target: { name: 'code', label: r => Records.placeName(r.location) || Records.label(r), sub: r => Records.fullLabel(r), noAdd: true, cascade: true,
      active: r => Records.isShown(r) },
    empty: '還沒有設備<br>點右上角「＋ 新增」開始記錄',
    fields: [
      // 年份照購買日期（沒填用今年），給了就不會變；表單上不顯示
      { key: 'code',     label: '編號',     type: 'text', auto: nextDeviceCode, hidden: true, section: '基本資料' },
      // 機身號碼（#1234）；同機型已經有一樣的名稱時提醒（還是可以存）
      { key: 'name',     label: '名稱',     type: 'text', note: v => Records.nameNote(v) },
      // 跟著位置帶：倉庫帶庫存、客戶的位置帶出租中；自己改過的不蓋掉
      { key: 'status',   label: '狀態',     type: 'ref', ref: 'statuses', calc: v => Records.deviceStatus(v) },
      { key: 'category', label: '類別',     type: 'ref', ref: 'options', list: '類別', optional: true, keep: true },
      { key: 'brand',    label: '品牌',     type: 'ref', ref: 'options', list: '品牌', optional: true, keep: true },
      // 機型從清單選，清單的順序就是總覽的順序（以前叫「型號」，是自己打的字）
      { key: 'model',    label: '機型',     was: ['型號'], type: 'ref', ref: 'options', list: '機型', optional: true, keep: true, caps: true },
      { key: 'serial',   label: '序號',     type: 'text', optional: true, caps: true, upper: true, section: '機器識別' },
      { key: 'board',    label: '主機板號碼', type: 'text', optional: true, caps: true, tight: true, clean: cleanBoard },
      // 有異動之後，位置＝最新一筆異動的新位置（見 records.js），表單上只顯示；那裡已經有別台機器時提醒（倉庫不提醒）
      // 新增時先放倉庫（剛買的機器）；連續新增時，倉庫才留著（客戶的位置一格一台）
      placeField('location', '位置', { optional: true, default: () => firstStock(), keep: v => Records.isStock(v.location), section: '放置與保管',
        lock: r => (Records.hasMoves(r.code) ? '要換位置請新增異動' : ''), note: v => Records.slotNote(v.location, v.code) }),
      { key: 'keeper',   label: '保管人',   type: 'ref', ref: 'people', optional: true },
      { key: 'buyDate',  label: '購買日期', type: 'date', optional: true, keep: true, section: '購買與保固' },
      { key: 'price',    label: '購買金額', type: 'number', optional: true, keep: true },
      { key: 'vendor',   label: '購買廠商', type: 'ref', ref: 'vendors', optional: true, keep: true },
      { key: 'warranty', label: '保固到期', type: 'date', optional: true, keep: true },
      { key: 'link',     label: '連結',     type: 'url', optional: true, full: true, hint: '照片、說明書或雲端硬碟資料夾的網址', section: '其他' },
      { key: 'note',     label: '備註',     type: 'text', optional: true, full: true, multiline: true },
    ],
  },

  // 位置：擺一台機器的一格（「大華公司 3F」），同一格同時只放一台；倉庫、維修中心勾「倉庫」，可以放好幾台（見 PLAN.md 第 4-3 節）
  //   編號（L0001）系統給的、不會變：設備、異動、合約存的都是編號，畫面上只顯示名稱
  //   改名時舊名字自動加一行到「以前的名字」（records.js 的 keepOldName）；搜尋時以前的名字也找得到
  locations: {
    title: '位置',
    unit: '個位置',
    noList: true,
    target: { name: 'code', addAs: 'name', label: r => r.name || r.code, sub: r => Records.placeSub(r), also: r => r.oldNames,
      active: notDisabled, off: '停用', removeHint: '不再使用的話，可以勾「停用」' },
    unique: [['code'], ['name']],
    uniqueMsg: (dup, keys) => (keys[0] === 'name' ? `已經有「${dup.name}」了` : `編號 ${dup.code} 已經用過了`),
    describe: r => r.name,
    afterSave: (before, after) => Records.keepOldName(before, after),
    fields: [
      { key: 'code',     label: '編號',       type: 'text', auto: nextLocationCode, hidden: true },
      { key: 'name',     label: '名稱',       type: 'text', full: true, hint: '寫到分得出是哪一格，例如「大華公司 3F」' },
      { key: 'oldNames', label: '以前的名字', type: 'text', optional: true, full: true, multiline: true, hint: '改名時自動記下來' },
      { key: 'stock',    label: '倉庫',       type: 'flag', optional: true, hint: '倉庫、維修中心這類，可以放好幾台' },
      // 負責的業務員：只列勾了業務員的人員；倉庫只有管理員看，不用填
      { key: 'sales',    label: '業務員',     type: 'ref', ref: 'people', optional: true, full: true, noAdd: true, showIf: v => v.stock !== 'true',
        only: () => p => !!p.sales, onlyNote: () => '沒有勾「業務員」，先到人員勾', check: v => Records.salesCheck(v) },
      // 還放著機器的不能停用（先撤機）
      { key: 'disabled', label: '停用',       type: 'flag', optional: true, hint: '不會出現在選單裡，已經用到的資料照常顯示',
        check: v => Records.disableCheck(v) },
      { key: 'note',     label: '備註',       type: 'text', optional: true, full: true, multiline: true },
    ],
  },

  // ---------- 紀錄：每一筆的「設備」欄寫設備編號（計算見 records.js） ----------
  // 異動：位置歷程，設備目前的位置＝最新一筆的新位置
  //   類型在最上面（一整列），先選類型，下面的選單只列合得上的：安裝 倉庫 → 客戶、撤機 客戶 → 倉庫、移機 客戶 → 客戶，其他不限
  //   表單上的「原位置」是打位置找設備（存設備編號），選好後寫那天機器在哪裡；編輯時鎖住（選錯機器就刪掉重新新增）
  //     存的原位置（藏起來的 from）＝前一筆的新位置，存檔、刪除後自動接上（見 records.js 的 syncLocations）
  //   新位置的選單：空的位置在最上面，再來是倉庫，最後是已經放著機器的
  //   狀態：撤機先帶庫存、安裝先帶出租中，可以改（失火選報廢、故障選維修中）；存了最新一筆時設備的狀態跟著改
  moves: {
    title: '異動',
    // 表單上：類型一整列（手機上四個按鈕才不擠），下面日期和狀態一列（狀態跟著類型帶）；試算表照下面欄位的順序
    formOrder: ['type', 'date', 'status'],
    once: true,
    period: recordMonth('date'),
    card: { title: r => Records.moveTitle(r), badge: 'type', grid: [] },
    note: r => Records.noteLine(r.note),
    describe: r => Records.describe('moves', r),
    search: ['device', 'note'],
    searchText: r => [Records.placeText(r.from), Records.placeText(r.to), Records.deviceText(r.device)].join(' '),
    searchHint: '搜尋位置',
    afterSave: (before, after) => [...Records.syncLocations(before ? [before] : []), ...Records.applyMoveStatus(before, after)],
    // 安裝、撤機存好後接著打開抄表
    next: r => Records.readingAfterMove(r),
    afterRemove: r => Records.syncLocations([r]),
    fields: [
      deviceField({ formLabel: '原位置', only: v => Records.moveDevices(v), onlyNote: v => Records.moveDevicesNote(v),
        check: v => Records.moveDeviceCheck(v), lock: () => '選錯機器的話，刪掉這筆重新新增',
        shown: v => Records.placeName(Records.placeBefore(v.device, v.date, v.id)) }),
      // 日期打錯（比最近一筆早、在今天之後）時提醒
      dateField('date', '日期', { note: v => Records.moveDateNote(v), noteLines: 2 }),
      { key: 'type', label: '類型', type: 'text', full: true, toggle: toggleOf(MOVE_TYPES), check: v => Records.moveTypeCheck(v) },
      placeField('from', '原位置', { optional: true, hidden: true, calc: v => Records.placeBefore(v.device, v.date, v.id) }),
      // 一格一台：那裡已經有別台機器時提醒（換機時兩筆異動先輸入哪一筆都可以，所以只提醒）；撤機、安裝時提醒合約
      placeField('to', '新位置', { full: true, rank: () => Records.freeFirst(), only: v => Records.movePlaces(v),
        onlyNote: v => Records.movePlacesNote(v), check: v => Records.moveToCheck(v),
        note: v => Records.moveToNote(v), noteLines: 2 }),
      { key: 'status', label: '狀態', type: 'ref', ref: 'statuses', optional: true,
        calc: v => Records.moveStatus(v), hint: '存檔後設備改成這個狀態' },
      noteField(),
    ],
  },

  // 合約：綁位置、不綁機器（一次租三台是一份合約寫三個位置）；機器目前的合約＝它現在所在位置的合約，換機時不用改
  //   一個位置目前的合約：包含它的合約裡簽約日最新的那一份（提前結束了的話沒有）
  //   重簽、續約、改條件都按「重新簽約」新增一份；修改只用來改打錯的，改了什麼記在合約修改紀錄（見 records.js）
  //   兩個日期、抄表週期之外都是自由輸入的文字
  contracts: {
    title: '合約',
    once: true,
    period: recordMonth('signDate'),
    card: { title: r => Records.firstLine(r.content) || '合約', grid: [] },
    status: r => (Records.isCurrentContract(r) ? { label: '目前', cls: 'blue' } : null),
    note: r => Records.contractNote(r),
    describe: r => Records.describe('contracts', r),
    search: ['content', 'billing'],
    searchText: r => Records.contractPlaces(r).map(Records.placeText).join(' '),
    searchHint: '搜尋位置或合約內容',
    copy: {
      label: '重新簽約',
      keys: ['locations', 'content', 'billing', 'readDay', 'cycle'],
      watch: ['locations', 'signDate', 'endDate', 'billing'],
      note: '重新簽約、續約、改條件都按這裡，會新增一份；上面只用來改打錯的地方',
    },
    history: r => Records.contractHistory(r.id),
    afterSave: (before, after) => Records.logContract(before, after),
    afterRemove: r => Records.dropContractLog(r),
    fields: [
      placeField('locations', '位置', { many: true, full: true, placeholder: '選擇或搜尋，可以選好幾個' }),
      // 不預設今天：補登舊合約忘了改日期，會變成這個位置目前的合約
      { key: 'signDate', label: '簽約日', type: 'date' },
      { key: 'endDate', label: '到期日', type: 'date', optional: true },
      { key: 'earlyEnd', label: '提前結束日', type: 'date', optional: true, hint: '違約、提前結束時才填' },
      { key: 'content', label: '合約內容', type: 'text', optional: true, full: true, multiline: true },
      { key: 'billing', label: '計費方式', type: 'text', optional: true, full: true, multiline: true },
      { key: 'readDay', label: '抄表日期', type: 'text', optional: true, full: true },
      { key: 'cycle', label: '抄表週期', type: 'text', optional: true, full: true, toggle: toggleOf(READ_CYCLES), hint: '空白＝每月' },
    ],
  },

  // 合約修改紀錄：修改合約時自動記（在試算表裡改的，同步時記），編輯合約的表單最下面列出來；不用自己填
  //   合約寫合約的 id；改之前、改之後是畫面上看到的字（位置寫名稱、日期寫 2026/10/11）
  contractLog: {
    title: '合約修改紀錄',
    noList: true,
    fields: [
      { key: 'contract', label: '合約', type: 'text' },
      { key: 'date',     label: '日期', type: 'date' },
      { key: 'field',    label: '欄位', type: 'text' },
      { key: 'before',   label: '改之前', type: 'text', optional: true, multiline: true },
      { key: 'after',    label: '改之後', type: 'text', optional: true, multiline: true },
    ],
  },

  // 抄表：本期用量＝這次減上一次（保養、翻新填的張數一起排，依抄表日期）
  //   結算月份：是幾月的帳款，自己選（請假、放假、臨時去抄都有，不預設）；列表依結算月份分組
  //     空白不算帳：機器放到這個位置後第一次抄的是起點（下一次從它算起），其他的是順便抄（見 records.js 的 isStart）
  readings: {
    title: '抄表',
    once: true,
    // 結算月份空白的（起點、順便抄）：照抄表日期排，標題寫「結算月份空白」
    period: { key: 'month', unit: 'month', label: '結算月份', then: 'date', fallback: 'date', emptyHead: '結算月份空白' },
    // 卡片：標題寫哪天抄（列表依結算月份分組），右上角裝機抄表、順便抄；下面黑白、彩色兩欄（使用量、計數器），最下面備註
    card: { title: r => (r.date ? `${U.fmtDate(r.date)} 抄` : '抄表'), grid: [], cols: r => Records.readingCols(r) },
    status: r => Records.readingTag(r),
    note: r => Records.noteLine(r.note),
    describe: r => Records.describe('readings', r),
    search: ['device', 'note'],
    searchText: r => Records.deviceText(r.device, r.date),
    searchHint: '搜尋位置',
    fields: [
      deviceField(),
      dateField('date', '抄表日期'),
      { key: 'month', label: '結算月份', type: 'month', optional: true, note: v => Records.monthNote(v) },
      countField('bw', '黑白張數', { optional: false }),
      countField('color', '彩色張數'),
      noteField(),
    ],
  },

  // 保養：在哪裡換了哪個；一筆記一個項目（從保養項目清單選），同一趟換了好幾樣，用「儲存，再新增一筆」接著填（日期留著）
  maintenance: {
    title: '保養',
    period: recordMonth('date'),
    // 卡片：標題寫項目；下面黑白、彩色兩欄（使用量：上次換同一項到這次，計數器），跟抄表卡片一樣排；最下面備註
    card: { title: r => r.item || '保養', grid: [], cols: r => Records.workCols(r) },
    note: r => Records.noteLine(r.note),
    describe: r => Records.describe('maintenance', r),
    search: ['device', 'item', 'note'],
    searchText: r => Records.deviceText(r.device, r.date),
    searchHint: '搜尋位置或項目',
    fields: [
      deviceField(),
      dateField('date', '日期', { keep: true }),
      // 下面寫這台上次換這一項是哪天、到現在印了幾張（換得太快時提醒）
      { key: 'item', label: '項目', type: 'ref', ref: 'options', list: '保養項目', note: v => Records.itemNote(v), noteLines: 2 },
      // 張數下面只寫上次的（使用量看項目下面的，見 records.js 的 countNote）
      countField('bw', '黑白張數', { note: v => Records.countNote(v, 'bw', false) }),
      countField('color', '彩色張數', { note: v => Records.countNote(v, 'color', false) }),
      noteField(),
    ],
  },

  // 翻新：翻新項目自由輸入；工程師從人員選；序號先帶入設備現在的序號，不一樣時提醒（不會去改設備）
  refurbs: {
    title: '翻新',
    once: true,
    period: recordMonth('date'),
    card: { title: r => Records.firstLine(r.content) || '翻新', grid: [] },
    note: r => Records.refurbNote(r),
    describe: r => Records.describe('refurbs', r),
    search: ['device', 'content', 'engineer', 'serial', 'source', 'note'],
    searchText: r => Records.deviceText(r.device, r.date),
    searchHint: '搜尋位置或翻新項目',
    fields: [
      deviceField(),
      dateField('date', '翻新日期'),
      { key: 'stockDate', label: '入庫日', type: 'date', optional: true },
      { key: 'engineer',  label: '工程師', type: 'ref', ref: 'people', optional: true },
      { key: 'serial',    label: '序號', type: 'text', optional: true, caps: true, upper: true,
        calc: v => Records.device(v.device)?.serial || '', note: v => Records.serialNote(v) },
      { key: 'country',   label: '國別', type: 'text', optional: true, toggle: toggleOf(COUNTRIES) },
      { key: 'source',    label: '廠商或來源', was: ['原廠商'], type: 'text', optional: true },
      { key: 'painted',   label: '噴漆', type: 'flag', optional: true },
      { key: 'content',   label: '翻新項目', type: 'text', full: true, multiline: true },
      noteField(),
    ],
  },

  // 選配件：送紙匣、裝訂器…；拆除日期空白的是目前裝著的（碳粉這類耗材記在保養）
  parts: {
    title: '選配件',
    order: (a, b) => Records.partOrder(a, b),
    card: { title: 'name', grid: [] },
    status: r => (r.removeDate ? { label: '已拆除', cls: 'gray' } : null),
    note: r => Records.partNote(r),
    describe: r => Records.describe('parts', r),
    fields: [
      deviceField(),
      { key: 'name',        label: '名稱',     type: 'ref', ref: 'options', list: '選配件' },
      { key: 'serial',      label: '序號',     type: 'text', optional: true, caps: true, upper: true },
      // 不預設今天：補登以前裝的，會被記成今天才裝
      { key: 'installDate', label: '安裝日期', type: 'date', optional: true },
      { key: 'removeDate',  label: '拆除日期', type: 'date', optional: true },
      noteField(),
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

  // 只有名字的清單（類別、品牌、機型、保養項目、選配件）
  //   順序：可以排序的清單在清單頁用 ↑ ↓ 排（存 1、2、3…），表單上不顯示；沒有順序的排在後面、依名字排
  options: {
    title: '選項',
    formTitle: r => r?.list || '選項', // 「編輯保養項目」「新增機型」
    noList: true,
    formOrder: ['list', 'name', 'gen', 'life', 'pages'],
    target: { name: 'name', group: 'list', order: 'order', active: notDisabled, off: '停用', removeHint: '不再使用的話，可以勾「停用」' },
    unique: [['list', 'name']],
    uniqueMsg: dup => `${dup.list}清單裡已經有「${dup.name}」了`,
    seed: () => DEFAULT_OPTIONS.flatMap(o => o.names.map((name, i) => ({
      id: `seed-${o.id}${i + 1}`, list: o.list, name, order: i + 1, disabled: false, ...(o.extra?.[name] || {}),
    }))),
    fields: [
      // 屬於哪一份清單：都是從那份清單裡新增、編輯（或下拉選單的「＋ 新增」），表單上不顯示，免得以為是要選什麼
      { key: 'list',     label: '清單', type: 'text', full: true, hidden: true, suggest: OPTION_LISTS,
        toggle: OPTION_LISTS.map(v => ({ value: v, label: v, tone: '', match: new RegExp(`^${v}$`) })) },
      { key: 'name',     label: '名稱', type: 'text', full: true, clean: cleanOption },
      { key: 'order',    label: '順序', type: 'number', optional: true, hidden: true },
      { key: 'disabled', label: '停用', type: 'flag', optional: true, hint: '不會出現在選單裡，已經用到的設備照常顯示' },
      // 只有機型有：總覽依世代分組，汰舊換新時看得出舊的還有幾台；空白時照型號猜，猜不到的放「其他」
      //   試算表上排在最後（後來加的欄），表單上在名稱下面（formOrder）
      { key: 'gen',      label: '世代', type: 'text', optional: true, full: true, suggest: GENERATIONS,
        showIf: v => v.list === '機型', note: v => Records.genNote(v) },
      // 只有保養項目有：壽命幾張（有設定用設定的，空白時用這個客戶的平均）、算哪種張數（空白時照名稱，碳粉 C、M、Y 只算彩色）
      { key: 'life',     label: '壽命（張）', type: 'number', optional: true,
        showIf: v => v.list === '保養項目', hint: '空白時用這個客戶的平均' },
      { key: 'pages',    label: '算哪種張數', type: 'text', optional: true, toggle: toggleOf(PAGE_KINDS),
        showIf: v => v.list === '保養項目', note: v => Records.pagesNote(v) },
    ],
  },

  // 人員：設備的保管人、翻新的工程師從這裡選（抄表、保養、異動都是保管人做，不另外記）
  //   不放身分證、薪資等敏感資料；試算表上舊的「用途」欄 App 不讀，留著不動
  people: {
    title: '人員',
    noList: true,
    // 業務員：存好之後表單下面有「複製邀請連結」（見 app.js 的 invite）
    action: { key: 'invite', label: '複製邀請連結', show: r => !!(r?.sales && String(r.email ?? '').trim() && stillHere(r)),
      note: r => `傳給${r.name}，用 ${r.email} 登入；這個 Gmail 要先加進 Google Cloud 的測試使用者` },
    target: { name: 'name', active: stillHere, sub: r => [r.jobTitle, r.dept, r.sales && '業務員'].filter(Boolean).join(' · '),
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
      { key: 'email',     label: 'Email',    type: 'email', optional: true, hint: '業務員用這個 Gmail 登入',
        check: v => (v.sales === 'true' && !String(v.email ?? '').trim() ? '業務員要填 Email' : '') },
      { key: 'sales',     label: '業務員',   type: 'flag', optional: true, hint: '負責的客戶在位置上選' },
      { key: 'perms',     label: '權限',     type: 'multi', choices: SALES_PERMS, optional: true, full: true, hint: '只能新增，不能改、不能刪',
        showIf: v => v.sales === 'true', calc: v => (v.sales === 'true' ? SALES_PERMS.join('、') : '') },
      { key: 'all',       label: '看全部',   type: 'flag', optional: true, hint: '看得到所有的客戶，不只自己負責的（主管用）',
        showIf: v => v.sales === 'true' },
      { key: 'joinDate',  label: '入職日',   type: 'date', optional: true },
      { key: 'leaveDate', label: '離職日',   type: 'date', optional: true, hint: '這天以後不會出現在選單裡' },
      { key: 'note',      label: '備註',     type: 'text', optional: true, full: true, multiline: true },
    ],
  },

  // 廠商：設備的購買廠商從這裡選；試算表上舊的「類型」欄 App 不讀，留著不動
  vendors: {
    title: '廠商',
    noList: true,
    target: { name: 'name', active: notDisabled, sub: r => [r.contact, r.phone].filter(Boolean).join(' · '),
      off: '停用', removeHint: '不再使用的話，可以勾「停用」' },
    unique: [['name']],
    uniqueMsg: dup => `已經有「${dup.name}」了`,
    fields: [
      { key: 'name',     label: '名稱',   type: 'text' },
      { key: 'contact',  label: '聯絡人', type: 'text', optional: true },
      { key: 'phone',    label: '電話',   type: 'tel', optional: true },
      { key: 'address',  label: '地址',   type: 'text', optional: true, full: true },
      { key: 'disabled', label: '停用',   type: 'flag', optional: true, hint: '不會出現在選單裡，已經用到的設備照常顯示' },
      { key: 'note',     label: '備註',   type: 'text', optional: true, full: true, multiline: true },
    ],
  },
};
