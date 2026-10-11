// 資料表的欄位定義（除了 optional 的欄位，全部必填）
//   type:        date | text | number | url（網址，存成文字，表單上是網址鍵盤）
//   optional:    可以空白
//   format:      列表卡片上的顯示方式
//   digits:      數字顯示時最少的小數位數
//   full:        表單中佔滿整列（預設半列）
//   multiline:   表單上是可以換行的大格子（備註）
//   keep:        連續新增時保留該欄的值
//   default:     新增時預先填入的值
//   hint:        顯示在表單欄位下方的說明
//   note:        依表單目前填的內容，顯示在欄位下方的提醒：note(values) 回傳文字，不用提醒時回傳空字串
//   calc:        依表單目前填的內容先算好填上：calc(values) 回傳數字，算不出來時回傳 null
//                欄位空白、或還是上次算的數字時才填，自己改過的不蓋掉（見 form.js）
//   caps:        手機鍵盤預設大寫（編號、序號常有英文字母）
//   suggest:     表單下方的快選按鈕（預設值 + 最近輸入過的值），只是提示，不限制；有預設值時試算表也有下拉選單
//   toggle:      表單上改成左右切換的按鈕（有 toggle 時不顯示 suggest 的快選按鈕）：[{ value, label, tone, match }]
//                value 是存的值；tone 是顏色（列表上的標籤也用這個顏色）；match 是認得的寫法（試算表手打的字）
//   was:         這個欄位以前在試算表上的標題（改名前），讀得到舊標題的試算表，同步時改成新標題
//   （資料表）title:     頁面標題，也是試算表的分頁名稱
//   （資料表）formTitle: 表單標題用的名稱，沒有時用 title
//   （資料表）card:      列表卡片：code 灰色小字、title 名稱、badge 標籤、primary 右上角、grid 卡片下方的欄位（沒有時列出其餘全部）
//   （資料表）period:    依日期篩選與分組：{ key, unit: 'month' | 'day', label }；沒有時不分組，依 sort 排序
//   （資料表）sort:      沒有 period 時的排序欄位（由小到大）
//   （資料表）search:    搜尋框找哪些欄位；沒有時找 card 的 code 和 title
//   （資料表）unique:    不能和其他筆重複的欄位，儲存時擋下來
//   （資料表）uniqueMsg: 重複時的提醒：uniqueMsg(已經有的那一筆) 回傳文字
//   （資料表）closeOnAdd: 新增後關閉表單（預設不關，方便連續記好幾筆）
//   （資料表）intro、empty: 列表最上面的說明、還沒有資料時列表顯示的文字

// 設備的狀態：表單上左右切換，列表的標籤用同樣的顏色
const DEVICE_STATUS = [
  { value: '使用中', label: '使用中', tone: 'use', match: /使用/ },
  { value: '閒置', label: '閒置', tone: 'idle', match: /閒置/ },
  { value: '維修中', label: '維修中', tone: 'fix', match: /維修/ },
  { value: '報廢', label: '報廢', tone: 'gone', match: /報廢/ },
];

const SCHEMAS = {
  devices: {
    title: '設備',
    sort: 'code',
    search: ['code', 'name', 'brand', 'model', 'serial', 'location', 'keeper'],
    card: { code: 'code', title: 'name', badge: 'status', grid: ['category', 'location', 'keeper'] },
    unique: ['code'],
    uniqueMsg: dup => `編號 ${dup.code} 已經用過了（${dup.name}）`,
    empty: '還沒有設備<br>點右上角「＋ 新增」開始記錄',
    fields: [
      { key: 'code',     label: '編號',     type: 'text', caps: true, hint: '不能重複，例如 NB-001' },
      { key: 'name',     label: '名稱',     type: 'text' },
      { key: 'status',   label: '狀態',     type: 'text', full: true, default: '使用中', suggest: DEVICE_STATUS.map(s => s.value), toggle: DEVICE_STATUS },
      { key: 'category', label: '類別',     type: 'text', optional: true, suggest: ['筆電', '桌機', '螢幕', '印表機', '網路設備', '手機', '平板'] },
      { key: 'brand',    label: '品牌',     type: 'text', optional: true, suggest: [] },
      { key: 'model',    label: '型號',     type: 'text', optional: true },
      { key: 'serial',   label: '序號',     type: 'text', optional: true, caps: true },
      { key: 'location', label: '位置',     type: 'text', optional: true, suggest: [] },
      { key: 'keeper',   label: '保管人',   type: 'text', optional: true, suggest: [] },
      { key: 'buyDate',  label: '購買日期', type: 'date', optional: true },
      { key: 'price',    label: '購買金額', type: 'number', optional: true },
      { key: 'vendor',   label: '購買廠商', type: 'text', optional: true, suggest: [] },
      { key: 'warranty', label: '保固到期', type: 'date', optional: true },
      { key: 'link',     label: '連結',     type: 'url', optional: true, full: true, hint: '照片、說明書或雲端硬碟資料夾的網址' },
      { key: 'note',     label: '備註',     type: 'text', optional: true, full: true, multiline: true },
    ],
  },
};
