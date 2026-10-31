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
//   業務員的 App 也 POST 到同一個網址拿資料（見 salesData_）、新增抄表和保養（見 salesAdd_）：帶 Google 登入的權杖，不用密語，只碰得到他負責的客戶

const QUERY = 'subject:"Page Counter" newer_than:7d';
const KEEP_DAYS = 14; // 寫過的信記多久（比搜尋的 7 天長）
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NEED = ['設備', '抄表日期', '結算月份', '黑白張數', '彩色張數', '備註'];

// 第一次執行這個：授權、設定每小時跑一次 checkMail，並馬上看一次信箱（重複執行不會多出觸發條件）
//   Google 只問這次執行用到的權限：業務員拿資料要問 Google 是誰（連到外部服務），這裡先用一下，執行 install 時一起問
function install() {
  UrlFetchApp.getRequest('https://www.google.com');
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

// 「寫進 2 筆、補上 1 筆的設備」；還沒填寄件人時寫要去哪裡填
function resultText_({ count, fixed, noSender }) {
  if (noSender) return '沒有讀信：先到 App「設定 → 自動抄表 → 機器設定」填寄信用 Gmail';
  const parts = [count && `寫進 ${count} 筆`, fixed && `補上 ${fixed} 筆的設備`].filter(Boolean);
  return parts.length ? parts.join('、') : '沒有新的信';
}

// App 同步前的讀信：部署成網頁應用程式（執行身分：我，誰可以存取：任何人）後，App 打這個網址
//   只回 { count: 寫了幾筆, fixed: 補了幾筆的設備, at: 讀完的時間, noSender: 還沒填寄件人 }，不回任何資料；改了程式要到「管理部署作業」換成新版本，網址不變
function doGet() {
  return json_(checkMail());
}

// 抄表腳本送來的回報：{ key: 密語, readings: [{ serial, bw, color, rnp, toner: { K, Y, M, C }, ip: '192.168.1.20', date: '2026-10-21', time: '08:30', test }] }
//   客戶電腦上背景每天一次、客戶在視窗按「提交計數器」都送這個；密語對不上就不收
//   寫進「最新回報」分頁：一台一列，只留最新一次（再送的蓋過那一列），試算表不會越來越大；沒有這個分頁時自己建
//     App 同步時讀這個分頁（設備詳情的最新回報卡），要抄表時從那裡帶入張數
//   不寫「抄表」、不算帳；不留每天的紀錄（以前的「回報」「碳粉」分頁不再寫，可以刪掉）
//   回 { results: [{ serial, device: 設備編號（對不到時空白） }] }，出錯回 { error }
//   測試（test: true）照舊只在「抄表」寫一筆起點（結算月份空白，App 不算帳），備註「自動抄表（腳本測試）08:30」，不寫最新回報
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.action === 'data') return json_(salesData_(body.token));
    if (body.action === 'add') return json_(salesAdd_(body.token, body.items));
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
const LATEST_HEAD = ['序號', '設備', '主機板號碼', '日期', '時間', '黑白張數', '彩色張數', '碳粉K', '碳粉Y', '碳粉M', '碳粉C', 'IP'];
const LATEST_FORMATS = { 序號: '@', 設備: '@', 主機板號碼: '@', 日期: 'yyyy/mm/dd', 時間: '@', IP: '@' };

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
    latest = latest || tab_(ss, LATEST, LATEST_HEAD, LATEST_FORMATS);
    const t = 'KYMC'.split('').map(c => count_((r.toner || {})[c]));
    writeLatest_(latest, [serial, code, String(r.rnp || ''), serial_(y, m, day), time, bw, color, ...t, String(r.ip || '').trim()]);
    return { serial, device: code };
  });
}

// 0 以上的整數，其他（沒有這一項、碳粉讀不到時的負數）空白
function count_(v) {
  return Number.isInteger(v) && v >= 0 ? v : '';
}

// 「最新回報」分頁和它的欄位；沒有時建一個，formats 是各欄的格式（{ 日期: 'yyyy/mm/dd' }）
//   以前建的分頁少了後來加的欄（IP）：加在最後面，格式跟著設
//   App 只讀不寫，同步不會動到
function tab_(ss, name, heads, formats) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.setFrozenRows(1);
  }
  const head = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String) : [];
  const add = heads.filter(h => !head.includes(h));
  if (add.length) {
    const more = head.length + add.length - sheet.getMaxColumns();
    if (more > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), more);
    sheet.getRange(1, head.length + 1, 1, add.length).setValues([add]).setFontWeight('bold');
    add.forEach((h, i) => {
      if (formats[h]) sheet.getRange(1, head.length + i + 1, sheet.getMaxRows(), 1).setNumberFormat(formats[h]);
    });
    head.push(...add);
  }
  return { sheet, col: heads.map(h => head.indexOf(h)), width: head.length };
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
  const from = senders_(ss);
  if (!from.length) return { count: 0, fixed, at: stamp_(ss), noSender: true };

  // 這次要寫的信，照信裡的時間由舊到新排好；內文沒有時間的用收信的時間
  const mails = [];
  for (const thread of GmailApp.search(`${QUERY} from:(${from.join(' OR ')})`)) {
    for (const msg of thread.getMessages()) {
      if (done[msg.getId()] || !from.includes(senderOf_(msg))) continue;
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

// 只讀這幾個寄件人寄來的張數信：App「機器設定」最上面的寄信用 Gmail（存在 _meta 分頁 senderMail 那一列，好幾個用逗號分開）
//   不寫在程式裡（repo 是公開的）；還沒填時不讀信（不然任何人寄一封假的張數信都會被寫進來），回 noSender
//   假冒寄件人的信 Gmail 會丟進垃圾郵件（SPF、DKIM、DMARC 對不上），搜尋不會讀到垃圾郵件
function senders_(ss) {
  const meta = ss.getSheetByName('_meta');
  const row = meta ? meta.getDataRange().getValues().find(r => String(r[0]).trim() === 'senderMail') : null;
  return String(row ? row[1] : '').split(/[,，、;；\s]+/).map(x => x.trim().toLowerCase()).filter(x => x.includes('@'));
}
// 信的寄件人（「名字 <a@gmail.com>」只取信箱），小寫
function senderOf_(msg) {
  const from = String(msg.getFrom());
  return (from.match(/<([^>]+)>/) || [null, from])[1].trim().toLowerCase();
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

// ---------- 業務員：向總部拿資料（App 的業務員模式） ----------
//   { action: 'data', token: Google 登入給 App 的存取權杖 } → { name: 人員的姓名, perms: 權限, all: 看全部, email, admin: 總部的帳號, values: { 分頁名稱: [標題列, ...列] } }
//   權杖先問 Google 是不是設備管理這個 App 拿到的、是誰（雲端硬碟的 about，App 本來就有這個權限），再對「人員」：Email 一樣、勾了業務員、沒離職
//   只回他看得到的列（見 salesRows_）；日期換成試算表的序號，App 用讀試算表的同一套讀法（sheet.js 的 fromValues）
//   出錯回 { error }；登入過期的另外有 login: true（App 請他重新登入），不是業務員的有 denied: true（App 清掉手機上的資料）
//   第一次加這段要重新授權（會用到 UrlFetchApp）：上方選 install 按「執行」，照畫面允許，再到「管理部署作業」換新版本
//   不用 Session 拿總部的帳號：那要另外一個權限（userinfo.email），授權時不一定問得到，拿不到會讓整個失敗
const CLIENT_ID = '460486615404-n7j6akqvhec4at7dt0f4937posghfr4p.apps.googleusercontent.com'; // App 的 OAuth 用戶端 ID（js/config.js）
const SALES_TABS = ['位置', '客戶', '設備', '異動', '合約', '合約修改紀錄', '抄表', '保養', '翻新', '選配件', '狀態', '選項', '人員', '廠商', LATEST];

//   回傳時另外寫 read：{ via: 怎麼讀的（service／api／sheets，見 readTabs_）, ms: { who, read, total } 各花幾毫秒 }，查慢的時候看
function salesData_(token) {
  const start = Date.now();
  const email = whoIs_(token);
  if (!email) return { error: '登入已過期，請重新登入', login: true };
  const who = Date.now() - start;
  const ss = SpreadsheetApp.getActive();
  const values = readTabs_(ss, SALES_TABS);
  const read = Date.now() - start - who;
  const person = salesPerson_(values['人員'], email, today_(ss));
  if (!person) return { error: `${email} 不是業務員，請找管理員`, denied: true };
  const out = { ...person, email, admin: owner_(ss), values: salesRows_(values, person) };
  return { ...out, read: { via: readVia_, ms: { who, read, total: Date.now() - start } } };
}

// 業務員送來的抄表、保養：{ action: 'add', token, items: [{ tab: '抄表' 或 '保養', head: App 用的標題列, row: 照 head 排的那一列（日期是序號） }] }
//   試算表還沒有這個 id：新增（要有權限、這台現在放在他的位置，看全部的有這台就好），加在分頁最下面，「輸入的人」寫他的名字
//   已經有這個 id：只改那一筆的「業務員回報」（業務員不能改別的、不能刪），前面加他的名字；要是他看得到的那一筆
//   檢查見 salesPlan_；回 { results: [{ id, ok: true } 或 { id, error: 原因 }] }
const SALES_ADD = { 抄表: '記抄表', 保養: '記保養' };
const BY = '輸入的人';
const REPORT = '業務員回報';
function salesAdd_(token, items) {
  const email = whoIs_(token);
  if (!email) return { error: '登入已過期，請重新登入', login: true };
  const ss = SpreadsheetApp.getActive();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const values = readTabs_(ss, ['人員', '位置', '設備', '異動', '抄表', '保養']);
    const person = salesPerson_(values['人員'], email, today_(ss));
    if (!person) return { error: `${email} 不是業務員，請找管理員`, denied: true };
    return { results: (Array.isArray(items) ? items : []).map(item => {
      const plan = salesPlan_(values, person, item);
      if (plan.error) return plan;
      return plan.kind === 'add' ? appendSales_(ss, item, plan) : reportSales_(ss, item.tab, plan);
    }) };
  } finally {
    lock.releaseLock();
  }
}

// 這一筆要怎麼處理（只看資料，不碰試算表）：{ id, kind: 'add', by, report } 或 { id, kind: 'report', report } 或 { id, error }
//   values 是 { 分頁名稱: [標題列, ...列] }（要有位置、設備、異動、抄表、保養）
function salesPlan_(values, person, { tab, head, row } = {}) {
  const at = h => (Array.isArray(head) ? head.indexOf(h) : -1);
  const cells = Array.isArray(row) ? row : [];
  const id = String(cells[at('id')] ?? '').trim();
  const need = SALES_ADD[tab];
  if (!need) return { id, error: '業務員只能新增抄表、保養' };
  if (!id) return { id, error: '資料不完整' };
  const report = reportText_(person.name, cells[at(REPORT)]);
  const ids = rows => {
    const c = (rows[0] || []).indexOf('id');
    return new Set(rows.slice(1).map(r => String(r[c] ?? '').trim()));
  };
  if (ids(values[tab] || []).has(id)) {
    if (!ids(salesRows_(values, person)[tab] || []).has(id)) return { id, error: '這一筆不在你負責的位置' };
    return { id, kind: 'report', report };
  }
  if (!person.perms.includes(need)) return { id, error: `沒有「${need}」的權限，請找管理員` };
  const device = codeKey_(cells[at('設備')]);
  if (!device) return { id, error: '資料不完整' };
  if (!salesScope_(values, person).now.has(device)) return { id, error: '這台不在你負責的位置' };
  return { id, kind: 'add', by: person.name, report };
}

// 業務員回報的字：前面加他的名字（「阿明：張數打錯」），本來就有的名字不重複加；空白就是清掉
function reportText_(name, v) {
  const head = `${name}：`;
  let t = String(v ?? '').trim();
  while (t.startsWith(head)) t = t.slice(head.length).trim();
  return t ? head + t : '';
}

// 加在分頁最下面：照試算表現在的標題排；文字欄設成純文字（2026/10 不會變成日期）、日期欄設成日期
function appendSales_(ss, { tab, head, row }, { id, by, report }) {
  const sheet = ss.getSheetByName(tab);
  if (!sheet) return { id, error: `總部的試算表找不到「${tab}」分頁` };
  const cols = ensureCols_(sheet, [BY, REPORT]);
  if (!cols.includes('id')) return { id, error: `「${tab}」分頁找不到 id 欄` };
  const out = cols.map(h => {
    if (h === BY) return by;
    if (h === REPORT) return report;
    const v = head.indexOf(h) < 0 ? undefined : row[head.indexOf(h)];
    return v === undefined || v === null ? '' : v;
  });
  const dateHead = tab === '抄表' ? '抄表日期' : '日期';
  const formats = out.map((v, i) => (cols[i] === dateHead ? 'yyyy/mm/dd' : typeof v === 'number' ? '#,##0' : '@'));
  const last = sheet.getLastRow();
  if (last + 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
  const range = sheet.getRange(last + 1, 1, 1, cols.length);
  range.setNumberFormats([formats]);
  range.setValues([out]);
  return { id, ok: true };
}

// 改那一筆的「業務員回報」：只動這一格
function reportSales_(ss, tab, { id, report }) {
  const sheet = ss.getSheetByName(tab);
  if (!sheet) return { id, error: `總部的試算表找不到「${tab}」分頁` };
  const cols = ensureCols_(sheet, [BY, REPORT]);
  const idCol = cols.indexOf('id');
  const last = sheet.getLastRow();
  const i = idCol < 0 || last < 2 ? -1 : sheet.getRange(2, idCol + 1, last - 1, 1).getValues().findIndex(r => String(r[0]).trim() === id);
  if (i < 0) return { id, error: '總部找不到這一筆' };
  const cell = sheet.getRange(i + 2, cols.indexOf(REPORT) + 1);
  cell.setNumberFormat('@');
  cell.setValue(report);
  return { id, ok: true };
}

// 分頁的標題列；缺了這幾欄就補在最後面（管理員的 App 同步時也會補，誰先補都一樣）
function ensureCols_(sheet, names) {
  const cols = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  names.filter(n => !cols.includes(n)).forEach(n => {
    cols.push(n);
    sheet.getRange(1, cols.length).setValue(n);
  });
  return cols;
}

// 讀幾個分頁：{ 分頁名稱: [標題列, ...列] }，日期換成序號；沒有的分頁不列
//   用試算表的 API 一次讀完（和 App 讀試算表一樣，日期本來就是序號），一個一個分頁讀很慢（十幾個分頁要十秒）：
//     service：Apps Script 左邊「服務」加了 Google Sheets API（Sheets）時用它，最快
//     api：沒加的話直接打試算表 API（Google 給的預設專案常常沒開這個 API，會被擋）
//     sheets：都不行時一個一個讀
//   用了哪一種記在 readVia_（業務員拿資料時回傳，查慢的時候看）
let readVia_ = '';
function readTabs_(ss, names) {
  const have = new Set(ss.getSheets().map(s => s.getName()));
  const list = names.filter(n => have.has(n));
  if (!list.length) return {};
  const quoted = list.map(n => `'${n.replace(/'/g, "''")}'`);
  const opts = { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' };
  if (typeof Sheets !== 'undefined') {
    try {
      const r = Sheets.Spreadsheets.Values.batchGet(ss.getId(), { ...opts, ranges: quoted });
      readVia_ = 'service';
      return valuesOf_(list, r);
    } catch (_) { /* 改用下面的 */ }
  }
  const ranges = quoted.map(q => `ranges=${encodeURIComponent(q)}`).join('&');
  const res = UrlFetchApp.fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${ss.getId()}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`,
    { headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }, muteHttpExceptions: true },
  );
  if (res.getResponseCode() === 200) {
    readVia_ = 'api';
    return valuesOf_(list, JSON.parse(res.getContentText()));
  }
  readVia_ = 'sheets';
  const tz = ss.getSpreadsheetTimeZone();
  const values = {};
  list.forEach(n => { values[n] = ss.getSheetByName(n).getDataRange().getValues().map(row => row.map(v => cell_(v, tz))); });
  return values;
}

// batchGet 回的 valueRanges（順序和 ranges 一樣）→ { 分頁名稱: [標題列, ...列] }；空的分頁是 []
function valuesOf_(list, json) {
  const values = {};
  (json.valueRanges || []).forEach((r, i) => { if (list[i]) values[list[i]] = r.values || []; });
  return values;
}

const today_ = ss => cell_(new Date(), ss.getSpreadsheetTimeZone());

// 總部的帳號（試算表的擁有者），業務員的設定裡寫；拿不到時空白，不影響拿資料
//   第一次拿到後記在指令碼屬性，之後不再問（每次問要多等）
function owner_(ss) {
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('owner');
  if (saved) return saved;
  try {
    const email = ss.getOwner().getEmail();
    if (email) props.setProperty('owner', email);
    return email;
  } catch (_) {
    return '';
  }
}

// 權杖是誰的；不是這個 App 拿到的、過期的回空字串
//   問到的記在快取（權杖剩多久就記多久），同一個登入下次不用再問 Google 兩次
function whoIs_(token) {
  if (!token) return '';
  const cache = CacheService.getScriptCache();
  const key = `who:${Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token))}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const get = (url, headers) => UrlFetchApp.fetch(url, { headers: headers || {}, muteHttpExceptions: true });
  const info = get(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (info.getResponseCode() !== 200) return '';
  const t = JSON.parse(info.getContentText());
  if (t.aud !== CLIENT_ID && t.azp !== CLIENT_ID) return '';
  const about = get('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { Authorization: `Bearer ${token}` });
  if (about.getResponseCode() !== 200) return '';
  const email = String(JSON.parse(about.getContentText()).user.emailAddress || '');
  const left = Math.min(3000, Number(t.expires_in) || 0) - 60;
  if (email && left > 0) cache.put(key, email, left);
  return email;
}

// 日期換成試算表的序號（1899/12/30 是 0，和 App 讀試算表時一樣）；其他照原本的
function cell_(v, tz) {
  if (!(v instanceof Date)) return v;
  const [y, m, d, h, mi, s] = Utilities.formatDate(v, tz, 'yyyy,M,d,H,m,s').split(',').map(Number);
  return (Date.UTC(y, m - 1, d, h, mi, s) - Date.UTC(1899, 11, 30)) / 864e5;
}

// 勾選：核取方塊是 true／false；手打的「是」「v」「1」也算有勾（和 App 一樣）
const yes_ = v => v === true || /^(是|true|v|✓|✔|y|yes|1)$/i.test(String(v ?? '').trim());
const codeKey_ = v => String(v ?? '').trim().toUpperCase();

// 人員：Email 一樣（不分大小寫）、勾了業務員、沒填離職日或還沒到那天
//   回傳 { name: 姓名, perms: 權限（['記抄表', '記保養']）, all: 勾了看全部 }；不是業務員時回傳 null；today 是今天的序號
function salesPerson_(rows, email, today) {
  if (!rows || !rows.length) return null;
  const col = h => rows[0].indexOf(h);
  const mail = String(email).trim().toLowerCase();
  const left = v => typeof v === 'number' && Math.floor(v) <= Math.floor(today);
  const hit = rows.slice(1).find(r => String(r[col('Email')] ?? '').trim().toLowerCase() === mail
    && yes_(r[col('業務員')]) && !left(r[col('離職日')]) && String(r[col('姓名')] ?? '').trim());
  if (!hit) return null;
  const perms = String(hit[col('權限')] ?? '').split(/[、,，;；\n]+/).map(x => x.trim()).filter(Boolean);
  return { name: String(hit[col('姓名')]).trim(), perms, all: yes_(hit[col('看全部')]) };
}

// 業務員看得到的列：values 是 { 分頁名稱: [標題列, ...列] }（日期是序號），回傳同樣的樣子
//   他的位置：位置的「業務員」是他、不是倉庫（停用的也算）
//   現在放在他位置的機器：這幾台的全部紀錄（包括搬來之前的）
//   以前放過、已經搬走的機器：只給放在他位置那段時間的紀錄（搬進來那天到搬走那天，看異動），設備那一列也給（App 才寫得出是哪一台）
//   合約：綁了他的位置的；合約修改紀錄跟著合約；最新回報：現在放在他位置的機器
//   客戶：他的位置的客戶（位置的「客戶」寫客戶名稱，不分大小寫）
//   狀態、選項、廠商：全部；人員：只給姓名
//   別的位置、倉庫都不給（App 寫「其他位置」）
//   勾了看全部的：全部都給（人員一樣只給姓名）
function salesRows_(values, person) {
  const tab = n => values[n] || [];
  const head = n => tab(n)[0] || [];
  const rows = n => tab(n).slice(1);
  const col = (n, h) => head(n).indexOf(h);
  const pick = (n, keep) => (tab(n).length ? [head(n), ...rows(n).filter(keep)] : []);
  const nameCol = col('人員', '姓名');
  const idCol = col('人員', 'id');
  const people = tab('人員').length ? [['姓名', 'id'], ...rows('人員').map(r => [r[nameCol], r[idCol]])] : [];
  if (person.all) {
    const out = {};
    Object.keys(values).forEach(n => { out[n] = tab(n); });
    return { ...out, 人員: people };
  }

  const { mine, now } = salesScope_(values, person);

  // 異動依日期排（同一天照列的順序）：搬進他的位置那天開始，到這台下一筆異動那天為止
  const stays = {};
  const moves = rows('異動').map((r, i) => ({ device: codeKey_(r[col('異動', '設備')]), date: Number(r[col('異動', '日期')]) || 0, to: codeKey_(r[col('異動', '新位置')]), i }))
    .filter(m => m.device).sort((a, b) => a.date - b.date || a.i - b.i);
  const open = {};
  moves.forEach(m => {
    if (open[m.device]) {
      open[m.device][1] = m.date;
      delete open[m.device];
    }
    if (mine.has(m.to)) {
      const stay = [m.date, Infinity];
      (stays[m.device] = stays[m.device] || []).push(stay);
      open[m.device] = stay;
    }
  });
  const DATE = { 異動: '日期', 抄表: '抄表日期', 保養: '日期', 翻新: '翻新日期', 選配件: '安裝日期' };
  const seen = (n, r) => {
    const device = codeKey_(r[col(n, '設備')]);
    if (now.has(device)) return true;
    const date = Number(r[col(n, DATE[n])]);
    return (stays[device] || []).some(([from, to]) => date >= Math.floor(from) && date < Math.floor(to) + 1);
  };
  const devices = new Set([...now, ...Object.keys(stays)]);

  const places = r => String(r[col('合約', '位置')] ?? '').split(/[、,，;；\n]+/).map(codeKey_).filter(Boolean);
  const contracts = pick('合約', r => places(r).some(p => mine.has(p)));
  const contractIds = new Set(contracts.slice(1).map(r => String(r[col('合約', 'id')] ?? '').trim()));

  const name = v => String(v ?? '').trim().toLowerCase();
  const customers = new Set(rows('位置').filter(r => mine.has(codeKey_(r[col('位置', '編號')]))).map(r => name(r[col('位置', '客戶')])).filter(Boolean));

  const out = {
    位置: pick('位置', r => mine.has(codeKey_(r[col('位置', '編號')]))),
    客戶: pick('客戶', r => customers.has(name(r[col('客戶', '名稱')]))),
    設備: pick('設備', r => devices.has(codeKey_(r[col('設備', '編號')]))),
    合約: contracts,
    合約修改紀錄: pick('合約修改紀錄', r => contractIds.has(String(r[col('合約修改紀錄', '合約')] ?? '').trim())),
    狀態: tab('狀態'),
    選項: tab('選項'),
    廠商: tab('廠商'),
    人員: people,
  };
  Object.keys(DATE).forEach(n => { out[n] = pick(n, r => seen(n, r)); });
  if (tab(LATEST).length) out[LATEST] = pick(LATEST, r => now.has(codeKey_(r[col(LATEST, '設備')])));
  return out;
}

// 他的位置（mine：位置的「業務員」是他、不是倉庫）、現在放在那裡的機器（now）：位置編號、設備編號都是大寫
//   勾了看全部的：mine 是空的，now 是設備分頁的每一台
function salesScope_(values, person) {
  const tab = n => values[n] || [];
  const col = (n, h) => (tab(n)[0] || []).indexOf(h);
  const rows = n => tab(n).slice(1);
  if (person.all) return { mine: new Set(), now: new Set(rows('設備').map(r => codeKey_(r[col('設備', '編號')])).filter(Boolean)) };
  const mine = new Set(rows('位置')
    .filter(r => String(r[col('位置', '業務員')] ?? '').trim() === person.name && !yes_(r[col('位置', '倉庫')]))
    .map(r => codeKey_(r[col('位置', '編號')])).filter(Boolean));
  const now = new Set(rows('設備').filter(r => mine.has(codeKey_(r[col('設備', '位置')])))
    .map(r => codeKey_(r[col('設備', '編號')])).filter(Boolean));
  return { mine, now };
}
