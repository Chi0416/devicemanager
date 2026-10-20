// 和 Google 試算表同步：試算表是正本，這台裝置上存的是副本
//   連結：第一次登入時找這個 App 之前建立的試算表；沒有就建立一份，寫入這台裝置的資料
//   同步：確認試算表還在（不見了就用這台裝置的資料重建）→ 讀回全部分頁 →
//         以試算表的資料為主、疊上這台裝置還沒送出的修改 → 把修改寫回試算表
//         寫回時用 id 找到那一列再改，不靠列號；在試算表裡手動輸入、沒有 id 的列會補上 id
//         試算表缺了選填的欄（新版加的欄位）：補在最後面，用這台裝置的資料填上
//         在試算表裡改了清單的名字（狀態、選項、人員、廠商）：用到舊名字的資料一起改，同一次寫回去
//         設備、位置沒有編號的補上、系統給的編號重複的換下一號（見 schema.js 的 fixCodes），用到它的資料跟著換，同一次寫回去
//         在試算表裡改了設備、位置編號：用到它的資料一起改；在試算表裡加了異動：設備的位置跟著算（見 records.js），同一次寫回去
//         在試算表裡打了位置的名字（不是編號）：換成編號，沒有這個位置就建一個（見 records.js 的 fixPlaceRefs）
//         在試算表裡改了位置的名字：舊名字記在「以前的名字」；改了合約：記在合約修改紀錄（和在 App 裡改的一樣）
//   時機：打開 App、從背景切回來、修改資料後（等幾秒一起送），登入還有效就自動同步
//         登入過期時，修改資料的那一下順便跳出 Google 視窗（沒有網路時不跳）；沒成功就顯示「同步」按鈕讓使用者按
//   登出：先同步一次，確定試算表已經有這台裝置的全部資料，才清掉這台裝置上的資料（換帳號時不會混在一起）
const Sync = (() => {
  const CLOUD_KEY = `${Store.PREFIX}cloud`;
  const MARK = 'devicemanager'; // 試算表上的標記（雲端硬碟的 appProperties），用來找回這份試算表
  const NAME = '設備管理';      // 試算表的檔名，也是訊息裡的稱呼
  const MASS_DELETE = 5; // 試算表裡一次少了這麼多筆時，先問使用者再跟著刪除
  const LIST_MAX = 10;   // 跟著刪除時，提醒裡最多列出幾筆
  const TABLES = Object.keys(SCHEMAS);
  const api = Google.api;
  const enc = encodeURIComponent;

  // 'title'!A1 的寫法（分頁名稱用單引號包起來，中文名稱也沒問題）；沒有 ref 時是整個分頁
  const a1 = (title, ref = '') => `'${title.replace(/'/g, "''")}'${ref ? `!${ref}` : ''}`;
  const titleOf = t => Sheet.TAB[t].title;
  // 試算表上有幾筆資料（預先放的類別不算：只有那幾筆時，當作雲端還沒有資料）
  const countRecords = d => TABLES.reduce((n, t) => n + (d[t] || []).filter(r => !String(r.id).startsWith('seed-')).length, 0);

  // ---------- 連結狀態：{ email, spreadsheetId, url, lastSyncAt, meterUrl, meterReadAt } ----------
  //   meterUrl：自動抄表的讀信網址，存在試算表的 _meta 分頁，同步時讀回來（其他裝置貼的也看得到）
  //   meterReadAt：試算表上的程式上次看完信箱的時間（程式寫在 _meta，同步時讀回來；同步前叫它讀信時也直接回傳）
  let cloud = null;
  try { cloud = JSON.parse(localStorage.getItem(CLOUD_KEY)); } catch (_) {}

  function saveCloud() {
    try {
      if (cloud) localStorage.setItem(CLOUD_KEY, JSON.stringify(cloud));
      else localStorage.removeItem(CLOUD_KEY);
    } catch (_) {}
  }

  // ---------- 狀態與通知畫面 ----------
  let running = false;
  let again = false;
  let againMail = false; // 排在後面的那一次要不要先讀信
  let error = '';
  let offline = false; // 上次同步時沒有網路（連上後自動再同步）
  let problems = [];
  let problemsAt = 0; // 這次打開 App 後，最近一次檢查試算表內容的時間（提醒用來判斷問題解決了沒）
  let okAt = 0;       // 這次打開 App 後，最近一次同步成功的時間
  let incomplete = []; // 上次同步時試算表缺欄位、沒辦法寫回去的表：這幾張表 App 裡的資料比試算表完整
  let lastRunAt = 0;
  let timer = null;
  let autoLoginTried = false;
  let loggingOut = false;
  let idleWaiters = []; // 等同步跑完的人（登出用）
  // notify：重要的事留在提醒（{ title, body }）；onLogout：登出、清掉資料之後（app.js 重新載入頁面）
  let hooks = { onData() {}, onStatus() {}, toast() {}, notify() {}, onLogout() {} };

  function state() {
    return {
      configured: Google.configured(),
      linked: !!cloud,
      email: cloud?.email || '',
      url: cloud?.url || '',
      meterUrl: cloud?.meterUrl || '',
      meterReadAt: cloud?.meterReadAt || '',
      lastSyncAt: cloud?.lastSyncAt || null,
      running,
      error,
      // 登入過期就不會自動同步、也不會再試網路：瀏覽器說連上網路了，就不再顯示「沒有網路」，改請使用者按「同步」
      offline: offline && (Google.hasToken() || !navigator.onLine),
      problems,
      problemsAt,
      okAt,
      loggingOut,
      needLogin: !!cloud && !Google.hasToken(),
      pending: Store.pendingCount(),
    };
  }

  const emit = () => hooks.onStatus(state());

  // ---------- 找到、建立試算表 ----------
  async function findSpreadsheet() {
    const q = `appProperties has { key='${MARK}' and value='1' } and trashed=false`
      + " and mimeType='application/vnd.google-apps.spreadsheet'";
    const r = await api(`${Google.DRIVE}/files?q=${enc(q)}&orderBy=createdTime&fields=files(id)`);
    return r.files?.[0]?.id || null;
  }

  // 試算表的網址和各分頁的 id；在垃圾桶裡或找不到時回傳 null
  async function info(id) {
    try {
      const f = await api(`${Google.DRIVE}/files/${id}?fields=trashed`);
      if (f.trashed) return null;
      const s = await api(`${Google.SHEETS}/${id}?fields=spreadsheetUrl,sheets.properties(sheetId,title)`);
      const sheetIds = Object.fromEntries(s.sheets.map(x => [x.properties.title, x.properties.sheetId]));
      return { id, url: s.spreadsheetUrl, sheetIds };
    } catch (e) {
      if (e.code === 'not_found') return null;
      throw e;
    }
  }

  // 清空每個分頁後寫入全部資料（建立試算表、匯入資料後用）
  async function writeAll(id, data) {
    const values = Sheet.toValues(data);
    const titles = Object.keys(values);
    await api(`${Google.SHEETS}/${id}/values:batchClear`, {
      method: 'POST',
      body: { ranges: titles.map(t => a1(t)) },
    });
    await api(`${Google.SHEETS}/${id}/values:batchUpdate`, {
      method: 'POST',
      body: {
        valueInputOption: 'RAW',
        data: [
          ...titles.map(t => ({ range: a1(t, 'A1'), values: values[t] })),
          { range: a1(Sheet.META.title, 'A1'), values: Sheet.metaValues() },
        ],
      },
    });
  }

  async function createSpreadsheet(data) {
    const s = await api(Google.SHEETS, { method: 'POST', body: Sheet.createBody(NAME) });
    // 先標記再寫資料：中途失敗時，下次還找得到這份試算表
    await api(`${Google.DRIVE}/files/${s.spreadsheetId}?fields=id`, {
      method: 'PATCH',
      body: { appProperties: { [MARK]: '1' } },
    });
    await api(`${Google.SHEETS}/${s.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: { requests: Sheet.setupRequests() },
    });
    await writeAll(s.spreadsheetId, data);
    return info(s.spreadsheetId);
  }

  // 被刪掉或改名的分頁補建回來（含格式），之後當作空分頁寫入這台裝置的資料
  //   隱藏的 _meta（格式版本）不見時也補建，讀不到版本時當作版本 1（見 sheet.js）
  async function ensureTabs(meta) {
    const need = Sheet.readRanges().filter(t => meta.sheetIds[t] === undefined);
    const noMeta = meta.sheetIds[Sheet.META.title] === undefined;
    if (!need.length && !noMeta) return;
    const r = await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
      method: 'POST',
      body: {
        requests: [
          ...need.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })),
          ...(noMeta ? [{ addSheet: { properties: { title: Sheet.META.title, hidden: true } } }] : []),
        ],
      },
    });
    r.replies.forEach(x => { meta.sheetIds[x.addSheet.properties.title] = x.addSheet.properties.sheetId; });
    if (!need.length) return;
    await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
      method: 'POST',
      body: { requests: Sheet.setupRequests(Object.fromEntries(need.map(t => [t, meta.sheetIds[t]]))) },
    });
  }

  // 找到這次要同步的試算表（每次都重新確認：分頁可能被刪、試算表可能被丟到垃圾桶）
  async function locate() {
    let meta = cloud.spreadsheetId ? await info(cloud.spreadsheetId) : null;
    if (!meta) {
      const id = await findSpreadsheet();
      if (id) meta = await info(id);
    }
    if (!meta) return null;
    await ensureTabs(meta);
    cloud.spreadsheetId = meta.id;
    cloud.url = meta.url;
    saveCloud();
    return meta;
  }

  async function pull(meta) {
    const titles = [...Sheet.readRanges(), Sheet.META.title];
    const ranges = titles.map(t => `ranges=${enc(a1(t))}`).join('&');
    const r = await api(`${Google.SHEETS}/${meta.id}/values:batchGet?${ranges}`
      + '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER');
    return Object.fromEntries(titles.map((t, i) => [t, r.valueRanges[i].values || []]));
  }

  // ---------- 讀回、合併、寫回 ----------
  // 一筆資料的簡短說明（提醒用），例如「設備：NB-001 會議室筆電 使用中」「選項：位置 3F 會議室」「異動：24-0001 2026/10/11 移機」
  function describe(t, r) {
    if (SCHEMAS[t].describe) return `${SCHEMAS[t].title}：${SCHEMAS[t].describe(r)}`;
    const { code, title, badge } = SCHEMAS[t].card || {};
    const date = SCHEMAS[t].period && SCHEMAS[t].fields.find(f => f.key === SCHEMAS[t].period.key);
    const tg = Refs.targetOf(t);
    const parts = SCHEMAS[t].card
      ? [date && U.fmtDate(r[date.key]), code && r[code], title && r[title], badge && r[badge]]
      : [tg?.group && r[tg.group], tg ? Refs.nameOf(t, r) : r.id];
    return `${SCHEMAS[t].title}：${parts.filter(Boolean).join(' ')}`;
  }

  // 試算表裡少了的資料（在試算表或其他裝置上刪掉了）：這台也跟著刪除，在提醒留一則，列出是哪幾筆
  //   一次少了很多筆（可能是不小心選取一大片刪掉）：先問要跟著刪除，還是保留並寫回試算表
  //   選保留時，這幾筆標成待同步並加進這次的快照，接下來和其他修改一起寫回去
  function keepOrDelete(parsed, skip, snap) {
    const pending = new Set(snap.items.map(i => `${i.table}:${i.id}`));
    const gone = TABLES.filter(t => !skip.includes(t)).flatMap(t => {
      const remote = new Set(parsed.data[t].map(r => r.id));
      return Store.list(t)
        .filter(r => !remote.has(r.id) && !pending.has(`${t}:${r.id}`))
        .map(r => ({ table: t, id: r.id, text: describe(t, r) }));
    });
    if (!gone.length) return;
    const shown = gone.slice(0, LIST_MAX).map(g => g.text);
    if (gone.length > LIST_MAX) shown.push(`…等 ${gone.length} 筆`);
    const undo = '不小心刪的話，可以在試算表的「檔案 → 版本記錄」找回來，下次同步就會回來。';
    if (gone.length < MASS_DELETE) {
      hooks.notify({
        title: `試算表刪了 ${gone.length} 筆，這台也跟著刪了`,
        body: `在試算表或其他裝置上刪掉的：\n${shown.join('\n')}\n${undo}`,
        action: { type: 'sheet' },
      });
      return;
    }
    const lines = TABLES.map(t => [t, gone.filter(g => g.table === t).length])
      .filter(([, n]) => n).map(([t, n]) => `${SCHEMAS[t].title} ${n} 筆`).join('、');
    const del = confirm(`試算表裡少了 ${gone.length} 筆資料（${lines}），可能是在試算表或其他裝置上刪除了。\n\n`
      + '按「確定」：這台裝置也跟著刪除。\n按「取消」：保留這些資料，並寫回試算表。');
    hooks.notify({
      title: `試算表裡少了 ${gone.length} 筆資料`,
      body: `${lines}。你選擇：${del ? '這台裝置也跟著刪除' : '保留，並寫回試算表'}。\n${shown.join('\n')}${del ? `\n${undo}` : ''}`,
      action: del ? { type: 'sheet' } : null,
    });
    if (del) return;
    Store.markPending(gone);
    const items = new Map(Store.pendingSnapshot().items.map(i => [`${i.table}:${i.id}`, i]));
    gone.forEach(g => snap.items.push(items.get(`${g.table}:${g.id}`)));
  }

  // 在試算表或其他裝置上改了名字的清單（選項、人員、廠商）、設備編號：同一個 id，名字不一樣
  //   這台裝置自己也改了的（還沒同步）以這台的為準，不算
  function remoteRenames(parsed, skip, snap) {
    const pending = new Set(snap.items.map(i => `${i.table}:${i.id}`));
    return TABLES.filter(t => Refs.isTarget(t) && !skip.includes(t)).flatMap(t => parsed.data[t]
      .map(after => ({ t, before: Store.get(t, after.id), after }))
      .filter(({ t: table, before, after }) => before && !pending.has(`${table}:${after.id}`)
        && Refs.nameOf(table, before) !== Refs.nameOf(table, after)));
  }

  // 在試算表或其他裝置上改了的位置、合約（同一個 id）：記下改之前的，合併之後記舊名字、修改紀錄
  //   這台裝置自己也改了的（還沒同步）以這台的為準，不算
  function remoteEdits(parsed, skip, snap) {
    const pending = new Set(snap.items.map(i => `${i.table}:${i.id}`));
    return ['locations', 'contracts'].filter(t => !skip.includes(t)).flatMap(t => parsed.data[t]
      .filter(after => Store.get(t, after.id) && !pending.has(`${t}:${after.id}`))
      .map(after => ({ t, id: after.id, before: { ...Store.get(t, after.id) } })));
  }

  // 改名的位置：舊名字加到「以前的名字」；改過的合約：記修改紀錄；改到的加進這次的快照
  function keepEdits(edits, snap) {
    addToSnap(edits.flatMap(({ t, id, before }) => (t === 'locations'
      ? Records.keepOldName(before, Store.get(t, id))
      : Records.logContract(before, Store.get(t, id)))), snap);
  }

  // 用到舊名字的資料一起改；改到的加進這次的快照，和其他修改一起寫回去
  function cascade(renames, snap) {
    addToSnap(renames.flatMap(({ t, before, after }) => Refs.renameRefs(t, before, after)), snap);
  }

  // 合併之後才改的資料（[{ table, id }]）加進這次的快照：同一次寫回試算表
  function addToSnap(changed, snap) {
    if (!changed.length) return;
    const items = new Map(Store.pendingSnapshot().items.map(i => [`${i.table}:${i.id}`, i]));
    const inSnap = new Set(snap.items.map(i => `${i.table}:${i.id}`));
    changed.forEach(c => {
      const k = `${c.table}:${c.id}`;
      if (inSnap.has(k)) snap.items = snap.items.map(i => (`${i.table}:${i.id}` === k ? items.get(k) : i));
      else {
        snap.items.push(items.get(k));
        inSnap.add(k);
      }
    });
  }

  // 設備、位置的編號：沒有的補上、重複的換下一號，這台裝置上新增的資料跟著換（見 records.js 的 followCodes）
  //   編號只在系統裡用、畫面上看不到（認機器看機型＋名稱，位置看名稱），所以換號不用提醒
  function fixCodes(snap, skip) {
    const local = new Set(snap.items.map(i => `${i.table}:${i.id}`));
    const isLocal = (t, id) => local.has(`${t}:${id}`);
    [['devices', fixDeviceCodes], ['locations', fixLocationCodes]].filter(([t]) => !skip.includes(t)).forEach(([t, fix]) => {
      const fixed = fix();
      addToSnap([...fixed.map(f => ({ table: t, id: f.id })), ...Records.followCodes(fixed, isLocal, t)], snap);
    });
  }

  // 回傳這次處理到的表；缺欄位的表不處理，修改留在待同步清單
  async function exchange(meta, snap) {
    const byTitle = await pull(meta);
    const parsed = Sheet.fromValues(byTitle);
    cloud.meterUrl = parsed.meterUrl;
    cloud.meterReadAt = parsed.meterReadAt;
    // 手動輸入、沒有 id 的列：剛給的 id 先寫回試算表，寫好了才放進這台裝置
    //   寫的時候斷線就整次停下來：這台裝置不會留著試算表上沒有的 id（下次讀回來會是另一個 id，改過的話同一筆會變兩筆）
    const ids = [
      ...parsed.addIdHeader.map(({ tab, col }) => ({ range: a1(tab, `${Sheet.colLetter(col)}1`), values: [[Sheet.ID]] })),
      ...parsed.idFixes.map(({ tab, row, col, id }) => ({ range: a1(tab, `${Sheet.colLetter(col)}${row}`), values: [[id]] })),
    ];
    if (ids.length) {
      await api(`${Google.SHEETS}/${meta.id}/values:batchUpdate`, {
        method: 'POST',
        body: { valueInputOption: 'RAW', data: ids },
      });
    }
    problems = parsed.problems;
    problemsAt = Date.now();

    // 整個分頁是空的（剛補建或被清空）：用這台裝置的資料整張寫回去；缺欄位的表先不動
    //   這次就會寫好，「分頁是空的」不算看不懂的地方
    const empty = TABLES.filter(t => !byTitle[titleOf(t)].length);
    problems = problems.filter(p => !empty.some(t => titleOf(t) === p.tab));
    const skip = [...new Set([...parsed.broken, ...empty])];
    keepOrDelete(parsed, skip, snap);
    const renames = remoteRenames(parsed, skip, snap);
    const edits = remoteEdits(parsed, skip, snap);
    Store.mergeRemote(parsed.data, skip, parsed.missing);
    cascade(renames, snap);
    keepEdits(edits, snap);
    fixCodes(snap, skip);
    // 試算表裡打的位置名字換成編號（異動改了的話，下面設備的位置跟著算）
    if (!skip.includes('locations')) addToSnap(Records.fixPlaceRefs(), snap);
    // 設備的位置＝最新一筆異動的新位置、異動的原位置接上前一筆（在試算表或其他裝置上改了異動）
    if (!skip.includes('devices') && !skip.includes('moves')) addToSnap(Records.syncLocations(), snap);
    hooks.onData();

    const local = Store.exportPayload();
    const all = Sheet.toValues(local);
    const writes = [];
    const appends = {};
    const deletes = [];
    const done = TABLES.filter(t => !parsed.broken.includes(t) || empty.includes(t));
    incomplete = TABLES.filter(t => !done.includes(t));

    empty.forEach(t => writes.push({ range: a1(titleOf(t), 'A1'), values: all[titleOf(t)] }));
    const handled = t => done.includes(t) && !empty.includes(t);

    const overwritten = new Set(); // 這次用這台裝置的版本整列寫回的列
    const put = (t, rec) => {
      const title = titleOf(t);
      const row = parsed.rowOf[title]?.[rec.id];
      const values = Sheet.encodeRow(t, rec, parsed.headers[title]);
      if (row) {
        writes.push({ range: a1(title, `A${row}`), values: [values] });
        overwritten.add(`${title}:${row}`);
      } else {
        (appends[title] ||= []).push(values);
      }
    };

    snap.items.forEach(({ table: t, id, del }) => {
      if (!handled(t)) return;
      const title = titleOf(t);
      if (del) {
        const row = parsed.rowOf[title]?.[id];
        if (row) deletes.push({ sheetId: meta.sheetIds[title], row });
        return;
      }
      const rec = Store.get(t, id);
      if (rec) put(t, rec);
    });
    // 在 App 裡改好、這次整列寫回的資料，試算表上原本看不懂的地方已經不算問題了
    problems = problems.filter(p => !(p.row && overwritten.has(`${p.tab}:${p.row}`)));

    // 改名的標題寫回那一格，和其他修改同一次寫入
    parsed.rewrites
      .filter(c => handled(c.table) && !overwritten.has(`${c.tab}:${c.row}`))
      .forEach(c => writes.push({ range: a1(c.tab, `${Sheet.colLetter(c.col)}${c.row}`), values: [[c.value]] }));

    // 補上的欄：標題和每一列的值（這次整列寫回的不用另外寫），格式之後再設
    const added = parsed.addColumns.filter(c => handled(c.table));
    added.forEach(({ table: t, tab, key, col }) => {
      const letter = Sheet.colLetter(col);
      writes.push({ range: a1(tab, `${letter}1`), values: [[Sheet.TAB[t].fields.find(f => f.key === key).label]] });
      Object.entries(parsed.rowOf[tab] || {}).forEach(([id, row]) => {
        const rec = Store.get(t, id);
        if (rec && !overwritten.has(`${tab}:${row}`)) writes.push({ range: a1(tab, `${letter}${row}`), values: [[Sheet.encodeCell(t, key, rec)]] });
      });
    });

    // 順序：先改既有的列（不影響列號）→ 由下往上刪（前面的列號才不會跑掉）→ 最後才新增
    if (writes.length) {
      await api(`${Google.SHEETS}/${meta.id}/values:batchUpdate`, {
        method: 'POST',
        body: { valueInputOption: 'RAW', data: writes },
      });
    }
    if (deletes.length) {
      deletes.sort((a, b) => b.row - a.row);
      await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
        method: 'POST',
        body: {
          requests: deletes.map(d => ({
            deleteDimension: { range: { sheetId: d.sheetId, dimension: 'ROWS', startIndex: d.row - 1, endIndex: d.row } },
          })),
        },
      });
    }
    if (added.length) {
      await api(`${Google.SHEETS}/${meta.id}:batchUpdate`, {
        method: 'POST',
        body: { requests: added.flatMap(c => Sheet.addColumnRequests(meta.sheetIds[c.tab], c.table, c.key, c.col)) },
      });
    }
    // 新增的列最後才加：可能插在中間（試算表裡有空白列時），之後就不能再依列號操作
    for (const [title, rows] of Object.entries(appends)) {
      await api(`${Google.SHEETS}/${meta.id}/values/${enc(a1(title, 'A1'))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: { values: rows },
      });
    }
    // 每張表都讀得到、改好了，才記成新的格式版本
    if (parsed.version < Sheet.VERSION && TABLES.every(t => done.includes(t))) {
      await api(`${Google.SHEETS}/${meta.id}/values:batchUpdate`, {
        method: 'POST',
        body: { valueInputOption: 'RAW', data: [{ range: a1(Sheet.META.title, 'A1'), values: Sheet.metaValues() }] },
      });
    }
    return done;
  }

  // ---------- 讀信（自動抄表） ----------
  // 叫試算表上的程式讀一次信（讀信網址，見 apps-script/meter.gs 的 doGet），回 { count, fixed, at }；讀信失敗回 { failed: true }
  async function readMail() {
    try {
      const res = await fetch(cloud.meterUrl, { signal: AbortSignal.timeout(30000) });
      const r = await res.json();
      if (r.at) cloud.meterReadAt = r.at;
      return r;
    } catch (_) {
      return { failed: true };
    }
  }

  // 「寫進 2 筆、補上 1 筆的設備」；都沒有時是空字串
  const mailText = r => [r?.count && `寫進 ${r.count} 筆`, r?.fixed && `補上 ${r.fixed} 筆的設備`].filter(Boolean).join('、');

  // ---------- 同步一次 ----------
  // 登入過期時不跳出視窗（要使用者點按鈕），只更新狀態；manual 為 true 時完成後提示
  //   mail：有讀信網址時先叫程式讀信，讀到的這次就一起拿回來（打開 App、切回來、按「同步」；改資料後的自動同步不讀）
  //     讀信失敗照樣同步（抄表頁「上次讀信」的時間不會更新），按「同步」時才提示；程式沒回傳時間的是舊版，按「同步」時也提示
  async function run({ manual = false, mail = false } = {}) {
    if (!cloud) return;
    if (running) {
      again = true;
      againMail ||= mail;
      return;
    }
    if (!Google.hasToken()) { emit(); return; }
    running = true;
    error = '';
    offline = false;
    lastRunAt = Date.now();
    emit();
    try {
      const mailed = mail && cloud.meterUrl ? await readMail() : null;
      const snap = Store.pendingSnapshot();
      let meta = await locate();
      if (!meta) {
        // 試算表被刪掉或丟進垃圾桶：不小心的話重建；想重新開始的話取消連結
        const rebuild = confirm(`雲端的「${NAME}」試算表找不到了，可能被刪除或丟進垃圾桶。\n\n`
          + '按「確定」：用這台裝置的資料重新建立一份。\n按「取消」：取消連結，這台裝置的資料會保留。');
        if (!rebuild) {
          disconnect();
          hooks.toast('已取消連結');
          hooks.notify({ title: '已取消連結', body: '雲端的試算表不見了，你選擇取消連結。這台裝置的資料還在，之後可以再連結。' });
          return;
        }
        meta = await createSpreadsheet(Store.exportPayload());
        Store.clearPending(snap);
        problems = [];
        incomplete = [];
        problemsAt = Date.now();
        cloud.spreadsheetId = meta.id;
        cloud.url = meta.url;
        hooks.toast('已用這台裝置的資料重新建立試算表');
        hooks.notify({ title: '已重新建立試算表', body: '雲端的試算表不見了，已用這台裝置的資料重新建立一份。' });
      } else if (snap.full) {
        await writeAll(meta.id, Store.exportPayload());
        Store.clearPending(snap);
        problems = [];
        incomplete = [];
        problemsAt = Date.now();
      } else {
        Store.clearPending(snap, await exchange(meta, snap));
      }
      cloud.lastSyncAt = new Date().toISOString();
      saveCloud();
      okAt = Date.now();
      if (manual && mailed?.failed) hooks.toast('已同步，但讀信失敗：確認讀信網址對、部署時「誰可以存取」選了「任何人」', 'error');
      else if (manual && mailed && !mailed.at) hooks.toast('已同步，但試算表上的程式是舊版：重貼程式、存檔，再到「管理部署作業」換新版本', 'error');
      else if (manual) hooks.toast(mailText(mailed) ? `已同步（${mailText(mailed)}）` : '已同步');
    } catch (e) {
      if (e.code === 'network') offline = true;
      else if (e.code !== 'need_login') error = e.message || String(e);
      if (manual && offline) hooks.toast('目前沒有網路，連上後會自動同步');
      else if (manual && error) hooks.toast(`同步失敗：${error}`, 'error');
    } finally {
      running = false;
      emit();
      if (again) {
        const m = againMail;
        again = againMail = false;
        run({ mail: m });
      }
      if (!running) idleWaiters.splice(0).forEach(fn => fn());
    }
  }

  function schedule(ms = 3000) {
    clearTimeout(timer);
    timer = setTimeout(() => run(), ms);
  }

  // ---------- 連結 ----------
  async function link() {
    running = true;
    emit();
    try {
      const about = await api(`${Google.DRIVE}/about?fields=user(emailAddress)`);
      const email = about.user.emailAddress;
      const local = Store.exportPayload();
      let meta = null;
      let meterUrl = '';
      let meterReadAt = '';
      const found = await findSpreadsheet();
      if (found) meta = await info(found);

      // 雲端還沒有資料時，這台裝置的資料會寫過去：先確認是這個帳號（例如之前留著別人的資料）
      const localCount = Store.ownCount();
      const upload = () => !localCount || confirm(`這台裝置上有 ${localCount} 筆資料，會存到 ${email} 的 Google 試算表。\n\n`
        + '按「確定」：存過去並連結。\n按「取消」：先不連結。');
      if (!meta) {
        if (!upload()) return;
        meta = await createSpreadsheet(local);
        Store.clearAllPending();
      } else {
        await ensureTabs(meta);
        const parsed = Sheet.fromValues(await pull(meta));
        ({ meterUrl, meterReadAt } = parsed);
        const remoteCount = countRecords(parsed.data);
        if (!remoteCount) {
          if (!upload()) return;
          await writeAll(meta.id, local);
          Store.clearAllPending();
        } else {
          if (localCount) {
            const lines = TABLES.map(t => [t, countRecords({ [t]: parsed.data[t] })]).filter(([, n]) => n)
              .map(([t, n]) => `${SCHEMAS[t].title} ${n} 筆`).join('、');
            const ok = confirm(`你的 Google 雲端硬碟裡已經有一份「${NAME}」（${lines}）。\n\n`
              + `按「確定」改用雲端的資料，這台裝置目前的 ${localCount} 筆資料會被取代（建議先匯出 data.json 備份）。\n`
              + '按「取消」先不連結。');
            if (!ok) return;
            hooks.notify({ title: '已改用雲端的資料', body: `連結時雲端已經有資料（${lines}），這台裝置原本的 ${localCount} 筆資料被取代了。` });
          }
          Store.loadRemote(parsed.data);
          hooks.onData();
        }
      }
      cloud = { email, spreadsheetId: meta.id, url: meta.url, lastSyncAt: new Date().toISOString(), meterUrl, meterReadAt };
      saveCloud();
      hooks.toast('已連結 Google 帳號');
    } catch (e) {
      hooks.toast(`連結失敗：${e.message || e}`, 'error');
    } finally {
      running = false;
      emit();
    }
    // 補上在試算表裡手動輸入的資料缺的 id 等
    if (cloud) await run();
  }

  // ---------- 自動抄表的讀信網址 ----------
  // 寫在 _meta 分頁第 2 列（第 1 列是格式版本，不動）；空字串是清掉。登入過期時丟出 need_login，請使用者先按「同步」
  async function setMeterUrl(url) {
    if (!cloud?.spreadsheetId) return;
    await api(`${Google.SHEETS}/${cloud.spreadsheetId}/values:batchUpdate`, {
      method: 'POST',
      body: { valueInputOption: 'RAW', data: [{ range: a1(Sheet.META.title, 'A2'), values: [[Sheet.METER_KEY, url]] }] },
    });
    cloud.meterUrl = url;
    saveCloud();
    emit();
  }

  // ---------- 按鈕 ----------
  // 必須在使用者點擊的當下呼叫：登入過期時要先跳出 Google 視窗
  function login(after) {
    return Google.requestToken({ hint: cloud?.email || '' }).then(
      () => {
        autoLoginTried = false;
        return after === 'link' ? link() : run({ manual: true, mail: true });
      },
      e => {
        if (e.code === 'popup_failed_to_open') {
          Google.redirectLogin({ hint: cloud?.email || '', after });
          return;
        }
        if (e.code !== 'popup_closed' && e.code !== 'superseded') hooks.toast(e.message, 'error');
        emit();
      },
    );
  }

  const startLink = () => login('link');

  function syncNow() {
    if (Google.hasToken()) return run({ manual: true, mail: true });
    if (!navigator.onLine) {
      noNetwork();
      hooks.toast('目前沒有網路，連上網路後再按「同步」');
      return Promise.resolve();
    }
    return login('sync');
  }

  // 登入過期又沒有網路：Google 的登入視窗載不出來，不跳；提示列顯示沒有網路
  function noNetwork() {
    offline = true;
    emit();
  }

  // 彈出視窗在某些手機上不能用時，改成整頁跳轉登入
  function loginByRedirect() {
    Google.redirectLogin({ hint: cloud?.email || '', after: cloud ? 'sync' : 'link' });
  }

  function disconnect() {
    cloud = null;
    error = '';
    offline = false;
    problems = [];
    incomplete = [];
    saveCloud();
    return Google.signOut();
  }

  // ---------- 登出 ----------
  // 等目前的同步（和排在後面的那一次）都跑完
  const idle = () => (running ? new Promise(fn => idleWaiters.push(fn)) : Promise.resolve());

  // 不能登出的原因（試算表還沒有這台裝置的全部資料）；可以登出時回傳空字串
  //   ok：這次同步成功了
  function logoutBlocker(ok) {
    const lines = [];
    if (!ok) {
      lines.push(offline ? '目前沒有網路，連上網路後再按一次「登出」。'
        : error ? `同步失敗：${error}\n請稍後再按一次「登出」。`
        : '還沒同步完成，請再按一次「登出」。');
    } else if (incomplete.length) {
      // 缺欄位的表沒辦法寫回試算表（見 exchange）；改回標題的說明在 problems 裡
      const tabs = incomplete.map(titleOf);
      const fix = problems.filter(p => tabs.includes(p.tab) && p.row === 1).map(Sheet.problemText);
      lines.push(`試算表的標題被改過，「${tabs.join('」「')}」的資料沒辦法寫回試算表：`,
        ...(fix.length ? fix : ['請到「提醒」看要改回哪個標題']), '改回來之後，再按一次「登出」。');
    } else if (Store.pendingCount()) {
      lines.push(`還有 ${Store.pendingCount()} 筆沒有同步完成，請再按一次「登出」。`);
    }
    return lines.length ? `還不能登出：要先確定試算表裡有這台裝置的全部資料，登出才不會遺失。\n\n${lines.join('\n')}` : '';
  }

  // 必須在使用者點擊的當下呼叫：登入過期時要先跳出 Google 視窗（第一個 await 之前）
  async function logout() {
    if (!cloud || loggingOut) return;
    loggingOut = true;
    emit();
    let wiped = false;
    try {
      if (!Google.hasToken()) await Google.requestToken({ hint: cloud.email });
      wiped = await finishLogout();
    } catch (e) {
      if (e.code === 'popup_failed_to_open') hooks.toast('登入視窗打不開，請先用「改用整頁登入」同步，再按「登出」', 'error');
      else if (e.code !== 'popup_closed' && e.code !== 'superseded') hooks.toast(e.message || String(e), 'error');
    } finally {
      // 清掉資料之後不再更新畫面（提醒會把舊的訊息寫回去），交給 app.js 重新載入頁面
      if (wiped) hooks.onLogout();
      else {
        loggingOut = false;
        emit();
      }
    }
  }

  // 回傳是否已經清掉資料
  async function finishLogout() {
    autoLoginTried = false;
    clearTimeout(timer);
    await idle();
    const start = Date.now();
    await run();
    await idle();
    if (!cloud) return false; // 同步時發現試算表不見了、選擇取消連結：資料留在這台裝置
    const blocker = logoutBlocker(okAt >= start && !error && !offline);
    if (blocker) {
      alert(blocker);
      return false;
    }
    if (!confirm(`登出後，這台裝置上的資料會清除。\n資料都存在 ${cloud.email} 的 Google 試算表裡，下次登入會再抓回來。\n\n確定登出？`)) return false;
    await disconnect();
    Store.wipe();
    return true;
  }

  // 資料改了：登入有效就等幾秒後一起送出；過期了，趁這次點擊（儲存、刪除）跳出 Google 視窗
  //   每次打開 App 只自動跳一次，被關掉或失敗就改顯示「同步」按鈕，不一直打擾；沒有網路時不跳
  function changed() {
    if (!cloud) return;
    if (Google.hasToken()) {
      emit();
      schedule();
      return;
    }
    if (!navigator.onLine) {
      noNetwork();
      return;
    }
    emit();
    if (autoLoginTried || !Google.ready()) return;
    autoLoginTried = true;
    Google.requestToken({ hint: cloud.email }).then(() => { autoLoginTried = false; run(); }, () => emit());
  }

  // ---------- 啟動 ----------
  function init(h) {
    hooks = { ...hooks, ...h };
    Store.onChange(changed);

    const back = Google.consumeRedirect();
    if (back?.error) hooks.toast(back.error, 'error');
    else if (back?.after === 'link') link();
    else if (cloud) run({ manual: back?.after === 'sync', mail: true });

    // 從背景切回來時抓一次最新資料（可能在試算表或另一台裝置改過），也更新「上次同步是幾小時前」的提示
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      emit();
      if (cloud && Google.hasToken() && Date.now() - lastRunAt > 30000) run({ mail: true });
    });
    // 網路恢復時馬上同步；登入過期時沒辦法自動同步，提示列改成請使用者按「同步」
    window.addEventListener('online', () => {
      if (cloud && Google.hasToken()) run();
      else emit();
    });
    emit();
  }

  return { init, state, startLink, syncNow, loginByRedirect, logout, setMeterUrl };
})();
