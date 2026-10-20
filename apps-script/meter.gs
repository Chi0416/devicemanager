// 自動抄表：機器每月寄來的張數信（服務模式 SP 5-866），每小時看一次信箱，寫進這份試算表的「抄表」分頁
//   裝在 App 建立的「設備管理」試算表上（擴充功能 → Apps Script），貼上後執行一次 install；App 同步時讀進來（id 由 App 補上）
//   急著看的時候：試算表上方選單「自動抄表」→「現在讀信」；或部署成網頁應用程式，在 App 設定裡按「現在讀信」（見 doGet）
//   信要寄到登入 App 的那個帳號的 Gmail（SP 5-866-121）：這支程式只讀得到自己帳號的信
//   信的樣子（主旨「Page Counter : 序號」，用 SP 5-866-112 測試寄的主旨前面有 [TEST]）：
//     Serial No.: 313CM615862
//     Date: Tue Oct 20 09:50:53 2026
//     Total_Color:2862
//     Total_BW:122957
//   設備：用序號到「設備」分頁找設備編號；找不到的空白、備註寫序號，之後 App 登記了這個序號，下次讀信時自動補上
//   照信裡的時間由舊到新寫（Gmail 搜尋是新的在前），試算表上的順序就是機器寄信的順序
//   結算月份：抄表日期的上一個月（11/1 寄來的算 10 月的帳）；測試寄的空白（App 當作起點，不算帳）
//   寫過的信記在指令碼屬性（信件編號），試算表不多一欄；同一台每個月的信 Gmail 會串成一串，所以不用標籤
//   每次看完信箱（每小時那次、選單、App 按的都算）把時間記在 _meta 分頁第 3 列，App 同步後在抄表頁寫「上次讀信」

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
  SpreadsheetApp.getActive().toast(resultText_(checkMail()));
}

// 「寫進 2 筆、補上 1 筆的設備」
function resultText_({ count, fixed }) {
  const parts = [count && `寫進 ${count} 筆`, fixed && `補上 ${fixed} 筆的設備`].filter(Boolean);
  return parts.length ? parts.join('、') : '沒有新的信';
}

// App 的「讀信」：部署成網頁應用程式（執行身分：我，誰可以存取：任何人）後，App 打這個網址
//   只回 { count: 寫了幾筆, fixed: 補了幾筆的設備, at: 讀完的時間 }，不回任何資料；改了程式要到「管理部署作業」換成新版本，網址不變
function doGet() {
  return ContentService.createTextOutput(JSON.stringify(checkMail())).setMimeType(ContentService.MimeType.JSON);
}

// 先補上之前對不到的設備，再找最近 7 天的張數信，沒寫過的加在「抄表」最下面；回傳 { count, fixed, at }
function checkMail() {
  // 每小時那次和按鈕剛好同時跑時，等前一個跑完，同一封信不會寫兩次
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return readMail_();
  } finally {
    lock.releaseLock();
  }
}

function readMail_() {
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
  const fixed = fillDevices_(readings, col, codeOf);

  // 這次要寫的信，照信裡的時間由舊到新排好；內文沒有時間的用收信的時間
  const mails = [];
  for (const thread of GmailApp.search(QUERY)) {
    for (const msg of thread.getMessages()) {
      if (done[msg.getId()]) continue;
      const r = parse_(msg.getPlainBody());
      if (r) mails.push({ msg, r, when: r.when || received_(msg) });
    }
  }
  const at = t => Date.UTC(t[0], t[1] - 1, t[2], t[3], t[4], t[5]);
  mails.sort((a, b) => at(a.when) - at(b.when));

  for (const { msg, r, when } of mails) {
    const [y, m, d] = when;
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
    done[msg.getId()] = now;
    props.setProperty('done', JSON.stringify(done));
  }
  props.setProperty('done', JSON.stringify(done));
  return { count: mails.length, fixed, at: stamp_(ss) };
}

// 看完信箱的時間記在 _meta 分頁第 3 列（第 1、2 列是 App 的格式版本、讀信網址）；存成文字，試算表不會改成日期
function stamp_(ss) {
  const at = new Date().toISOString();
  const meta = ss.getSheetByName('_meta');
  if (meta) meta.getRange('A3:B3').setNumberFormat('@').setValues([['meterReadAt', at]]);
  return at;
}

// 之前對不到設備的列（設備空白、備註寫「序號 X 對不到設備」）：「設備」分頁現在有這個序號了，就補上設備、拿掉那句；回傳補了幾筆
function fillDevices_(sheet, col, codeOf) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  let n = 0;
  sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues().forEach((r, i) => {
    const note = String(r[col['備註']]);
    const m = note.match(/序號 (\S+) 對不到設備/);
    const code = m && !String(r[col['設備']]).trim() && codeOf[m[1].toUpperCase()];
    if (!code) return;
    sheet.getRange(i + 2, col['設備'] + 1).setValue(code);
    sheet.getRange(i + 2, col['備註'] + 1).setValue(note.split('；').filter(x => x !== m[0]).join('；'));
    n++;
  });
  return n;
}

// 收信的時間（這份試算表的時區）：[年, 月, 日, 時, 分, 秒]
function received_(msg) {
  return Utilities.formatDate(msg.getDate(), Session.getScriptTimeZone(), 'yyyy-M-d-H-m-s').split('-').map(Number);
}

// 信的內文 → { serial, when: [2026, 10, 20, 9, 50, 53], bw, color }；沒有序號或黑白張數時回傳 null
function parse_(body) {
  const get = re => (body.match(re) || [])[1] || '';
  const serial = get(/Serial No\.:\s*(\S+)/);
  const bw = get(/Total_BW:\s*(\d+)/);
  if (!serial || !bw) return null;
  const color = get(/Total_Color:\s*(\d+)/);
  const d = body.match(/Date:\s*\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})/);
  const m = d ? MONTHS.indexOf(d[1]) + 1 : 0;
  const when = m ? [Number(d[6]), m, Number(d[2]), Number(d[3]), Number(d[4]), Number(d[5])] : null;
  return { serial, when, bw: Number(bw), color: color === '' ? '' : Number(color) };
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
