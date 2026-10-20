// 自動抄表：機器每月寄來的張數信（服務模式 SP 5-866），每小時看一次信箱，寫進這份試算表的「抄表」分頁
//   裝在 App 建立的「設備管理」試算表上（擴充功能 → Apps Script），貼上後執行一次 install；App 同步時讀進來（id 由 App 補上）
//   急著看的時候：試算表上方選單「自動抄表」→「現在讀信」
//   信要寄到登入 App 的那個帳號的 Gmail（SP 5-866-121）：這支程式只讀得到自己帳號的信
//   信的樣子（主旨「Page Counter : 序號」，用 SP 5-866-112 測試寄的主旨前面有 [TEST]）：
//     Serial No.: 313CM615862
//     Date: Tue Oct 20 09:50:53 2026
//     Total_Color:2862
//     Total_BW:122957
//   設備：用序號到「設備」分頁找設備編號；找不到的空白、備註寫序號
//   結算月份：抄表日期的上一個月（11/1 寄來的算 10 月的帳）；測試寄的空白（App 當作起點，不算帳）
//   寫過的信記在指令碼屬性（信件編號），試算表不多一欄；同一台每個月的信 Gmail 會串成一串，所以不用標籤

const QUERY = 'subject:"Page Counter" newer_than:7d';
const KEEP_DAYS = 14; // 寫過的信記多久（比搜尋的 7 天長）
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NEED = ['設備', '抄表日期', '結算月份', '黑白張數', '彩色張數', '備註'];

// 第一次執行這個：授權、設定每小時跑一次 checkMail，並馬上看一次信箱（重複執行不會多出觸發條件）
function install() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'checkMail')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkMail').timeBased().everyHours(1).create();
  checkMail();
}

// 打開試算表時在上方加「自動抄表」選單：急著看的時候按「現在讀信」，不用等每小時那一次（只有電腦的瀏覽器看得到）
function onOpen() {
  SpreadsheetApp.getUi().createMenu('自動抄表').addItem('現在讀信', 'readNow').addToUi();
}

function readNow() {
  const n = checkMail();
  SpreadsheetApp.getActive().toast(n ? `寫進 ${n} 筆` : '沒有新的信');
}

// 找最近 7 天的張數信，沒寫過的加在「抄表」最下面；回傳寫了幾筆
function checkMail() {
  const ss = SpreadsheetApp.getActive();
  const readings = ss.getSheetByName('抄表');
  const devices = ss.getSheetByName('設備');
  if (!readings || !devices) throw new Error('找不到「抄表」或「設備」分頁：這支程式要裝在 App 建立的「設備管理」試算表上');
  const col = columns_(readings);
  const codeOf = serialMap_(devices);
  const props = PropertiesService.getScriptProperties();
  const done = JSON.parse(props.getProperty('done') || '{}');
  const now = Date.now();
  for (const id of Object.keys(done)) if (now - done[id] > KEEP_DAYS * 864e5) delete done[id];
  let count = 0;

  for (const thread of GmailApp.search(QUERY)) {
    for (const msg of thread.getMessages()) {
      const id = msg.getId();
      if (done[id]) continue;
      const r = parse_(msg.getPlainBody());
      if (!r) continue;
      // 內文沒有日期時用收信的日期
      const [y, m, d] = r.ymd || Utilities.formatDate(msg.getDate(), Session.getScriptTimeZone(), 'yyyy-M-d').split('-').map(Number);
      const test = msg.getSubject().includes('[TEST]');
      const code = codeOf[r.serial.toUpperCase()] || '';
      const row = new Array(readings.getLastColumn()).fill('');
      row[col['設備']] = code;
      row[col['抄表日期']] = serial_(y, m, d);
      row[col['結算月份']] = test ? '' : lastMonth_(y, m);
      row[col['黑白張數']] = r.bw;
      row[col['彩色張數']] = r.color;
      row[col['備註']] = [test ? '自動抄表（測試）' : '自動抄表', code ? '' : `序號 ${r.serial} 對不到設備`].filter(Boolean).join('；');
      readings.appendRow(row);
      readings.getRange(readings.getLastRow(), col['抄表日期'] + 1).setNumberFormat('yyyy/mm/dd');
      // 每寫一封就記下來：中途出錯時，下次不會重複寫
      done[id] = now;
      props.setProperty('done', JSON.stringify(done));
      count++;
    }
  }
  props.setProperty('done', JSON.stringify(done));
  return count;
}

// 信的內文 → { serial, ymd: [2026, 10, 20], bw, color }；沒有序號或黑白張數時回傳 null
function parse_(body) {
  const get = re => (body.match(re) || [])[1] || '';
  const serial = get(/Serial No\.:\s*(\S+)/);
  const bw = get(/Total_BW:\s*(\d+)/);
  if (!serial || !bw) return null;
  const color = get(/Total_Color:\s*(\d+)/);
  const d = body.match(/Date:\s*\w{3}\s+(\w{3})\s+(\d{1,2})\s+[\d:]+\s+(\d{4})/);
  const m = d ? MONTHS.indexOf(d[1]) + 1 : 0;
  return { serial, ymd: m ? [Number(d[3]), m, Number(d[2])] : null, bw: Number(bw), color: color === '' ? '' : Number(color) };
}

// 日期寫成試算表的日期序號（從 1899-12-30 起算的天數），和 App 寫的一樣，不帶時間、不受時區影響
function serial_(y, m, d) {
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5;
}

// 上一個月，寫成 App 的格式 2026/09
function lastMonth_(y, m) {
  return m === 1 ? `${y - 1}/12` : `${y}/${String(m - 1).padStart(2, '0')}`;
}

// 「抄表」第一列的標題 → 第幾欄（從 0 起算）；缺欄時停下來
function columns_(sheet) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const col = {};
  for (const name of NEED) {
    col[name] = head.indexOf(name);
    if (col[name] < 0) throw new Error(`「抄表」分頁找不到「${name}」這一欄`);
  }
  return col;
}

// 「設備」分頁：序號（大寫）→ 設備編號
function serialMap_(sheet) {
  const rows = sheet.getDataRange().getValues();
  const head = rows[0].map(String);
  const s = head.indexOf('序號');
  const c = head.indexOf('編號');
  if (s < 0 || c < 0) throw new Error('「設備」分頁找不到「序號」或「編號」這一欄');
  const map = {};
  for (const r of rows.slice(1)) {
    const serial = String(r[s]).trim().toUpperCase();
    if (serial && !map[serial]) map[serial] = String(r[c]);
  }
  return map;
}
