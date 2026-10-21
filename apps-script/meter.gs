// 自動抄表：機器每月寄來的張數信（服務模式 SP 5-866），每小時看一次信箱，寫進這份試算表的「抄表」分頁
//   裝在 App 建立的「設備管理」試算表上（擴充功能 → Apps Script），貼上後執行一次 install；App 同步時讀進來（id 由 App 補上）
//   急著看的時候：試算表上方選單「自動抄表」→「現在讀信」；部署成網頁應用程式的話，App 打開、按「同步」時也會先叫它讀信（見 doGet）
//   信要寄到登入 App 的那個帳號的 Gmail（SP 5-866-121）：這支程式只讀得到自己帳號的信
//   信的樣子（主旨「Page Counter : 序號」，用 SP 5-866-112 測試寄的主旨前面有 [TEST]）：
//     Serial No.: 313CM615862
//     Date: Tue Oct 20 09:50:53 2026
//     Total_Color:2862
//     Total_BW:122957
//   設備：用序號到「設備」分頁找設備編號；找不到的空白、備註寫序號，之後 App 登記了這個序號，下次讀信時自動補上
//   照信裡的時間由舊到新寫（Gmail 搜尋是新的在前），試算表上的順序就是機器寄信的順序
//   結算月份：抄表日期的上一個月（11/1 寄來的算 10 月的帳）；測試寄的空白（App 當作起點，不算帳）
//   備註「自動抄表 09:50」（測試的「自動抄表（測試）09:50」），時間是信裡寫的機器寄出時間；抄表日期欄只有日期
//   寫過的信記在指令碼屬性（信件編號），試算表不多一欄；同一台每個月的信 Gmail 會串成一串，所以不用標籤
//   每次看完信箱（每小時那次、選單、App 叫的都算）把時間記在 _meta 分頁第 3 列，App 同步後在抄表頁寫「上次讀信」
//   客戶電腦上的抄表腳本（用 SNMP 問機器）每天把張數、碳粉 POST 到同一個網址，寫進「最新回報」，不算帳（見 doPost），要帶密語

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
//   「密語」：抄表腳本要填的密語
function onOpen() {
  SpreadsheetApp.getUi().createMenu('自動抄表')
    .addItem('現在讀信', 'readNow')
    .addItem('密語', 'showKey')
    .addToUi();
}

// 抄表腳本要用的密語：第一次看時產生一組，之後都是同一組；存在指令碼屬性，試算表裡看不到
function showKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('key');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 16).match(/.{4}/g).join('-');
    props.setProperty('key', key);
  }
  const html = HtmlService.createHtmlOutput(
    `<input value="${key}" readonly onclick="this.select()" style="font:18px monospace;width:100%;padding:8px;box-sizing:border-box">` +
    '<p style="font:13px sans-serif;color:#555">點一下全選，複製到抄表腳本</p>'
  ).setWidth(320).setHeight(110);
  SpreadsheetApp.getUi().showModalDialog(html, '密語');
}

function readNow() {
  SpreadsheetApp.getActive().toast(resultText_(checkMail()));
}

// 「寫進 2 筆、補上 1 筆的設備」
function resultText_({ count, fixed }) {
  const parts = [count && `寫進 ${count} 筆`, fixed && `補上 ${fixed} 筆的設備`].filter(Boolean);
  return parts.length ? parts.join('、') : '沒有新的信';
}

// App 同步前的讀信：部署成網頁應用程式（執行身分：我，誰可以存取：任何人）後，App 打這個網址
//   只回 { count: 寫了幾筆, fixed: 補了幾筆的設備, at: 讀完的時間 }，不回任何資料；改了程式要到「管理部署作業」換成新版本，網址不變
function doGet() {
  return json_(checkMail());
}

// 抄表腳本送來的回報：{ key: 密語, readings: [{ serial, bw, color, rnp, toner: { K, Y, M, C }, date: '2026-10-21', time: '08:30', test }] }
//   客戶電腦上背景每天一次、客戶在視窗按「提交計數器」都送這個；密語對不上就不收
//   寫進「最新回報」分頁：一台一列，只留最新一次（再送的蓋過那一列），試算表不會越來越大；沒有這個分頁時自己建
//     App 同步時讀這個分頁（設備詳情的最新回報卡），要抄表時從那裡帶入張數
//   不寫「抄表」、不算帳；不留每天的紀錄（以前的「回報」「碳粉」分頁不再寫，可以刪掉）
//   回 { results: [{ serial, device: 設備編號（對不到時空白） }] }，出錯回 { error }
//   測試（test: true）照舊只在「抄表」寫一筆起點（結算月份空白，App 不算帳），備註「自動抄表（腳本測試）08:30」，不寫最新回報
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const key = PropertiesService.getScriptProperties().getProperty('key');
    if (!key) return json_({ error: '還沒有密語：試算表上方「自動抄表」→「密語」' });
    if (body.key !== key) return json_({ error: '密語不對' });
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      return json_({ results: writePosted_(Array.isArray(body.readings) ? body.readings : []) });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

const LATEST = '最新回報';
const LATEST_HEAD = ['序號', '設備', '主機板號碼', '日期', '時間', '黑白張數', '彩色張數', '碳粉K', '碳粉Y', '碳粉M', '碳粉C'];

function writePosted_(list) {
  const { ss, readings, col, codeOf } = sheets_();
  const tz = Session.getScriptTimeZone();
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-M-d-HH:mm').split('-');
  const today = now.slice(0, 3).map(Number);
  let latest = null;
  return list.map(r => {
    const serial = String(r.serial || '').trim();
    const bw = Number(r.bw);
    if (!serial || !Number.isInteger(bw) || bw < 0) return { serial, error: '沒有序號或黑白張數' };
    const color = count_(r.color);
    const d = String(r.date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const [y, m, day] = d ? d.slice(1).map(Number) : today;
    const code = codeOf[serial.toUpperCase()] || '';
    const time = /^\d{1,2}:\d{2}$/.test(String(r.time || '')) ? String(r.time).padStart(5, '0') : now[3];
    if (r.test === true) {
      return { serial, device: append_(readings, col, codeOf, { serial, y, m, d: day, bw, color, test: true, note: `自動抄表（腳本測試）${time}` }) };
    }
    latest = latest || tab_(ss, LATEST, LATEST_HEAD, { 'A:C': '@', 'D:D': 'yyyy/mm/dd', 'E:E': '@' });
    const t = 'KYMC'.split('').map(c => count_((r.toner || {})[c]));
    writeLatest_(latest, [serial, code, String(r.rnp || ''), serial_(y, m, day), time, bw, color, ...t]);
    return { serial, device: code };
  });
}

// 0 以上的整數，其他（沒有這一項、碳粉讀不到時的負數）空白
function count_(v) {
  return Number.isInteger(v) && v >= 0 ? v : '';
}

// 「最新回報」分頁和它的欄位；沒有時建一個，formats 是各欄的格式（{ 'A:A': 'yyyy/mm/dd' }）
//   App 只讀不寫，同步不會動到
function tab_(ss, name, heads, formats) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, heads.length).setValues([heads]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    Object.keys(formats).forEach(a1 => sheet.getRange(a1).setNumberFormat(formats[a1]));
  }
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const col = heads.map(h => {
    const i = head.indexOf(h);
    if (i < 0) throw new Error(`「${name}」分頁找不到「${h}」這一欄`);
    return i;
  });
  return { sheet, col, width: head.length };
}

// 寫一列最新回報：同一台（序號）已經有的蓋過去，沒有的加在最下面
function writeLatest_({ sheet, col, width }, values) {
  const row = new Array(width).fill('');
  values.forEach((v, i) => { row[col[i]] = v; });
  const last = sheet.getLastRow();
  let at = 0;
  if (last >= 2) {
    const serials = sheet.getRange(2, col[0] + 1, last - 1, 1).getValues();
    const i = serials.findIndex(r => String(r[0]).trim().toUpperCase() === values[0].toUpperCase());
    if (i >= 0) at = i + 2;
  }
  if (at) sheet.getRange(at, 1, 1, width).setValues([row]);
  else sheet.appendRow(row);
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

// 「抄表」分頁、它的欄位、序號 → 設備編號
function sheets_() {
  const ss = SpreadsheetApp.getActive();
  const readings = ss.getSheetByName('抄表');
  const devices = ss.getSheetByName('設備');
  if (!readings || !devices) throw new Error('找不到「抄表」或「設備」分頁：這支程式要裝在 App 建立的「設備管理」試算表上');
  return { ss, readings, col: columns_(readings), codeOf: serialMap_(devices) };
}

// 在「抄表」最下面加一列，回傳設備編號；對不到設備的空白、備註寫序號（之後 fillDevices_ 補上）
function append_(sheet, col, codeOf, { serial, y, m, d, bw, color, test, note }) {
  const code = codeOf[serial.toUpperCase()] || '';
  const row = new Array(sheet.getLastColumn()).fill('');
  row[col['設備']] = code;
  row[col['抄表日期']] = serial_(y, m, d);
  row[col['結算月份']] = test ? '' : lastMonth_(y, m);
  row[col['黑白張數']] = bw;
  row[col['彩色張數']] = color;
  row[col['備註']] = [note, code ? '' : `序號 ${serial} 對不到設備`].filter(Boolean).join('；');
  sheet.appendRow(row);
  sheet.getRange(sheet.getLastRow(), col['抄表日期'] + 1).setNumberFormat('yyyy/mm/dd');
  return code;
}

function readMail_() {
  const { ss, readings, col, codeOf } = sheets_();
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
    const hm = `${String(when[3]).padStart(2, '0')}:${String(when[4]).padStart(2, '0')}`; // 信裡的時間（機器寄出的時間）
    const note = test ? `自動抄表（測試）${hm}` : `自動抄表 ${hm}`;
    append_(readings, col, codeOf, { serial: r.serial, y, m, d, bw: r.bw, color: r.color, test, note });
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
