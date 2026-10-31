// 進入點：分頁、列表、表單、設備詳情、位置詳情、客戶詳情、清單、Google 雲端硬碟同步、提醒、資料備份
//   底部 5 格：總覽｜位置｜設備｜抄表｜紀錄（見 GROUPS）；紀錄裡切換保養｜翻新｜合約｜異動（所有設備的放在一起看）
(() => {
  // 舊資料轉換（位置獨立成表、合約綁位置，見 records.js 的 upgrade）：畫任何東西之前先做
  Records.upgrade();
  const TAB_KEY = `${Store.PREFIX}tab`;
  const LOGOUT_KEY = `${Store.PREFIX}loggedOut`; // 登出後重新載入頁面時顯示「已登出」（sessionStorage，登出清資料時不會被清掉）
  const $ = id => document.getElementById(id);

  // 用手指、滑鼠操作時不畫焦點外框：小視窗打開、關掉時，瀏覽器會把焦點放到裡面的按鈕或剛才點的卡片上，
  //   畫出外框（顏色是系統的強調色，例如橘色），看起來像被選中；按 Tab 用鍵盤時照常畫（見 style.css 的 .pointer）
  document.addEventListener('pointerdown', () => document.documentElement.classList.add('pointer'), true);
  document.addEventListener('keydown', e => { if (e.key === 'Tab') document.documentElement.classList.remove('pointer'); }, true);

  // ---------- 提示訊息（有開啟的 sheet 時顯示在最上面那一層） ----------
  const toastEl = $('toast');
  let toastTimer;
  function toast(msg, kind = '') {
    ([...document.querySelectorAll('dialog[open]')].at(-1) || document.body).appendChild(toastEl);
    toastEl.textContent = msg;
    toastEl.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = ''; }, kind === 'error' ? 3500 : 1800);
  }

  // ---------- 頁面 ----------
  // 各種紀錄的頁：[資料表, 上方切換的名稱, 新增按鈕上寫的]；抄表在底部自己一格，其他在「紀錄」裡
  const RECORD_PAGES = [['maintenance', '保養', '保養'], ['refurbs', '翻新', '翻新'], ['readings', '抄表', '抄表'], ['contracts', '合約', '合約'], ['moves', '異動', '異動']];
  const PAGES = {
    overview: { title: '總覽' },
    locations: { title: '位置' },
    devices: SCHEMAS.devices,
    ...Object.fromEntries(RECORD_PAGES.map(([k]) => [k, SCHEMAS[k]])),
  };
  const lists = {
    // 總覽：各型號有幾台（見 overview.js）；點一個型號到設備頁，篩好狀態和型號
    overview: createOverview({
      onPick(status, model) {
        showTab('devices');
        lists.devices.show({ filter: status, keyword: model });
        window.scrollTo(0, 0);
      },
      // 要處理的「空著的位置」：到位置頁，篩好空著的
      onPlaces(filter) {
        showTab('locations');
        lists.locations.show({ filter });
        window.scrollTo(0, 0);
      },
    }),
    // 位置：每個位置一張卡片（見 places.js），點了打開位置詳情
    locations: createPlaces(),
    // 點設備卡片打開詳情（見 detail.js）
    devices: createList('devices', SCHEMAS.devices, { openForm: id => Detail.open(id), rows: () => Records.shownDevices() }),
    // 紀錄：卡片最上面那一排寫位置、設備，和設備卡片一樣小標題在上，下面才是內容（依紀錄的種類，見 records.js 的 recordCells）
    ...Object.fromEntries(RECORD_PAGES.map(([k]) => [k, createList(k, SCHEMAS[k], {
      openForm: id => Form.open(k, id),
      device: r => Records.recordCells(k, r),
    })])),
  };
  Object.values(lists).forEach(l => $('panels').appendChild(l.el));
  let current = 'devices';

  // 沒在看的頁先記著，切過去時才重畫（每存一筆不用把每一頁都畫一次）
  const stale = new Set();
  const refreshList = (k, l) => (l.el.hidden ? stale.add(k) : l.refresh());

  // 新增、修改、刪除之後：那一頁重畫，剛改的那筆閃一下；其他頁也重畫（清單改名時設備跟著改、異動改了設備的位置跟著改）
  function onChanged(key, rec) {
    Object.entries(lists).forEach(([k, l]) => (k === key ? l.changed(rec) : refreshList(k, l)));
    Detail.changed(key, rec);
    Place.changed(key, rec);
    Customer.changed(key, rec);
    Lists.refresh();
    if (menu.open) renderListsMenu();
  }
  // 人員表單的「複製邀請連結」（schema 的 action，見 invite）
  Form.init({ toast, onChanged, action: (t, rec) => { if (t === 'people' && rec) invite(rec); } });
  Picker.init({ toast, onChanged });
  // 清單裡點一個位置、客戶：打開位置詳情、客戶詳情（其他打開表單）
  const DETAILS = { locations: Place, customers: Customer };
  Lists.init({ toast, onChanged, openItem: (t, id) => (DETAILS[t] ? DETAILS[t].open(id) : Form.open(t, id)) });
  Detail.init();
  Place.init();
  Customer.init();

  // ---------- 分頁 ----------
  // 底部的每一格（key）和裡面的頁（pages：[頁面, 上方切換的名稱]）；只有一頁的不顯示上方切換
  const GROUPS = [
    { key: 'overview', label: '總覽', pages: [['overview', '總覽']] },
    { key: 'locations', label: '位置', pages: [['locations', '位置']] },
    { key: 'devices', label: '設備', pages: [['devices', '設備']] },
    { key: 'readings', label: '抄表', pages: [['readings', '抄表']] },
    { key: 'records', label: '紀錄', pages: RECORD_PAGES.filter(([k]) => k !== 'readings').map(([k, label]) => [k, label]) },
  ];
  const groupOf = key => GROUPS.find(g => g.key === key || g.pages.some(([k]) => k === key));
  // 新增按鈕：這一頁新增到哪張表、按鈕上寫什麼；總覽沒有新增按鈕
  const ADD = { locations: ['locations', '位置'], devices: ['devices', '設備'], ...Object.fromEntries(RECORD_PAGES.map(([k, , what]) => [k, [k, what]])) };
  const tabBtns = [...document.querySelectorAll('.tabbar [data-tab]')];
  const subtabsEl = $('subtabs');
  const addBtn = $('btn-add');
  const addWhat = addBtn.querySelector('.add-what');

  // key：底部的一格或其中一頁；提醒也會直接指定某一頁
  //   有兩頁以上的格子：標題寫格子的名稱，下面切換是哪一頁
  function showTab(key) {
    const group = groupOf(key) || GROUPS[0];
    if (group.key === key) key = group.pages[0][0];
    if (!lists[key]) key = 'devices';
    current = key;
    $('page-title').textContent = group.pages.length > 1 ? group.label : PAGES[key].title;
    subtabsEl.hidden = group.pages.length < 2;
    subtabsEl.innerHTML = group.pages.length < 2 ? '' : group.pages.map(([k, label]) =>
      `<button type="button" role="tab" data-page="${k}" aria-selected="${k === key}">${label}</button>`).join('');
    // 業務員只能新增抄表、保養（照權限，見 records.js 的 canAdd）
    const add = ADD[key] && Records.canAdd(ADD[key][0]) ? ADD[key] : null;
    addBtn.disabled = !add;
    if (add) {
      addWhat.textContent = add[1];
      addBtn.setAttribute('aria-label', `新增${add[1]}`);
    }
    tabBtns.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === group.key)));
    Object.entries(lists).forEach(([k, l]) => { l.el.hidden = k !== key; });
    if (stale.delete(key)) lists[key].refresh();
    try { localStorage.setItem(TAB_KEY, key); } catch (_) {}
  }

  tabBtns.forEach(b => b.addEventListener('click', () => {
    if (groupOf(current).key !== b.dataset.tab) showTab(b.dataset.tab);
    window.scrollTo(0, 0);
  }));
  subtabsEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.dataset.page === current) return;
    showTab(btn.dataset.page);
    window.scrollTo(0, 0);
  });
  addBtn.addEventListener('click', () => { if (ADD[current]) Form.open(ADD[current][0], null); });

  const refreshAll = () => {
    Object.entries(lists).forEach(([k, l]) => refreshList(k, l));
    Detail.refresh();
    Place.refresh();
    Customer.refresh();
  };

  // ---------- 設定：清單（見 lists.js）、資料備份 ----------
  const menu = $('menu-sheet');
  const listsMenu = $('lists-menu');

  // 每一份清單一列：名稱、幾項；有不在清單裡的值時寫出來
  function renderListsMenu() {
    // 位置有自己的一頁（底部第二格），這裡不列
    listsMenu.innerHTML = Refs.lists().filter(l => l.table !== 'locations').map(l => {
      const n = Refs.listItems(l).length;
      const miss = new Set(Lists.missingOf(l).flatMap(x => x.values)).size;
      return `
        <li>
          <button type="button" class="list-item" data-list="${U.esc(l.key)}">
            <span class="member-info"><b>${U.esc(l.title)}</b>${miss ? `<small class="warn-text">${miss} 個不在清單裡</small>` : ''}</span>
            <span class="uses">${n} 項</span><span class="go" aria-hidden="true">›</span>
          </button>
        </li>`;
    }).join('');
  }
  listsMenu.addEventListener('click', e => {
    const btn = e.target.closest('[data-list]');
    if (btn) Lists.open(btn.dataset.list);
  });

  function renderBackupInfo() {
    $('stats').innerHTML = Object.entries(SCHEMAS).map(([k, s]) =>
      `<div><dt>${s.title}</dt><dd>${Store.list(k).length}</dd></div>`).join('');
    const t = Store.lastExportAt();
    $('last-export').textContent = t ? `上次匯出：${U.fmtDateTime(t)}` : '尚未匯出過備份';
  }

  function openMenu() {
    renderListsMenu();
    renderBackupInfo();
    if (!menu.open) menu.showModal();
  }

  $('btn-menu').addEventListener('click', () => openMenu());
  menu.querySelector('[data-act="close"]').addEventListener('click', () => menu.close());
  menu.addEventListener('click', e => { if (e.target === menu) menu.close(); }); // 點背景關閉

  function download(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('btn-export').addEventListener('click', async () => {
    const json = JSON.stringify(Store.exportPayload(), null, 2);
    const file = new File([json], 'data.json', { type: 'application/json' });
    // 手機優先用分享選單（可「儲存到檔案」或傳到雲端），不支援時改成直接下載
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (e) {
        if (e.name === 'AbortError') return;
        download(file);
      }
    } else {
      download(file);
    }
    Store.markExported();
    renderBackupInfo();
    toast('已匯出 data.json');
  });

  // ---------- 以哪邊為主（匯入 data.json、連結 Google） ----------
  //   瀏覽器的「確定／取消」看不出按了會怎樣：每個按鈕寫出選哪邊、會做什麼
  //   options：[{ key, label, note }]；回傳選的 key，按 cancel 那顆、點背景、按 Esc 是 null
  const chooser = $('choose-sheet');
  let chosen = null;
  function choose({ title, text = '', options, cancel = '取消' }) {
    chooser.querySelector('.sheet-title').textContent = title;
    chooser.querySelector('.choose-text').textContent = text;
    chooser.querySelector('.choose-btns').innerHTML = [
      ...options.map(o => `<button type="button" class="wide-btn choice" data-key="${U.esc(o.key)}">
        <b>${U.esc(o.label)}</b>${o.note ? `<small>${U.esc(o.note)}</small>` : ''}</button>`),
      `<button type="button" class="wide-btn" data-key="">${U.esc(cancel)}</button>`,
    ].join('');
    chosen = null;
    chooser.showModal();
    return new Promise(resolve => chooser.addEventListener('close', () => resolve(chosen), { once: true }));
  }
  chooser.addEventListener('click', e => {
    const btn = e.target.closest('[data-key]');
    if (btn) chosen = btn.dataset.key || null;
    if (btn || e.target === chooser) chooser.close(); // 點背景關閉＝取消
  });

  const fileInput = $('file-import');
  $('btn-import').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;

    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch (e) {
      toast('無法讀取：不是有效的 JSON 檔', 'error');
      return;
    }
    const parsed = Store.parseImport(obj);
    if (!parsed) {
      toast('檔案內容不是設備管理的備份格式', 'error');
      return;
    }

    // 連結了 Google 時選哪邊為主：以檔案為主會整份改寫試算表（其他裝置或試算表裡新增、還沒同步到這台的也會不見）；
    //   以 Google 為主只加入檔案裡多的（見 records.js 的 fileOnly）
    const linked = Sync.state().linked;
    const extra = linked ? Records.fileOnly(parsed) : [];
    const count = of => Object.keys(SCHEMAS).reduce((n, k) => n + of(k).length, 0);
    const pick = await choose({
      title: '匯入 data.json',
      text: `「${file.name}」有 ${count(k => parsed[k])} 筆資料，這台目前有 ${count(k => Store.list(k))} 筆。`,
      options: linked ? [
        { key: 'file', label: '以檔案為主', note: '這台和 Google 都換成檔案的內容。Google 有、檔案沒有的會不見' },
        { key: 'cloud', label: '以 Google 為主', note: `Google 的資料不動，只加入檔案裡 Google 沒有的（${extra.length} 筆）` },
      ] : [
        { key: 'file', label: '匯入', note: '這台的資料換成檔案的內容' },
      ],
    });
    if (!pick) return;

    if (pick === 'file') Store.replaceAll(parsed);
    else Store.addAll(extra);
    Records.upgrade();
    Object.values(lists).forEach(l => l.reset());
    renderListsMenu();
    renderBackupInfo();
    toast(pick === 'file' ? '匯入完成' : extra.length ? `已加入 ${extra.length} 筆` : '檔案裡沒有 Google 沒有的資料');
  });

  // ---------- Google 雲端硬碟（同步的流程見 sync.js） ----------
  const cloudEl = $('cloud');
  const syncBar = $('sync-bar');
  const syncText = syncBar.querySelector('.sync-text');
  const syncBtn = syncBar.querySelector('.sync-btn');
  let syncAction = null;

  // 「3 小時前」；超過這麼久沒同步、登入又過期時，上方提示列提醒按「同步」
  const STALE = 60 * 60000;
  function ago(iso) {
    const min = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 60000));
    if (min < 60) return `${min} 分鐘前`;
    const h = Math.floor(min / 60);
    return h < 24 ? `${h} 小時前` : `${Math.floor(h / 24)} 天前`;
  }

  // 登入過期時連上網路也不會自動同步，要按「同步」重新登入
  const offlineText = st => {
    if (st.needLogin) return st.pending ? `目前沒有網路，${st.pending} 筆資料還沒同步，連上網路後請按「同步」` : '目前沒有網路';
    return st.pending ? `目前沒有網路，${st.pending} 筆資料會在連上網路後自動同步` : '目前沒有網路，連上後會自動同步';
  };

  function syncStatusText(st) {
    if (st.running) return '同步中…';
    if (st.offline) return offlineText(st);
    if (st.error) return `同步失敗：${st.error}`;
    if (st.pending && st.needLogin) return `有 ${st.pending} 筆還沒同步，請按「同步」`;
    if (st.needLogin) return '登入已過期，按「同步」可以抓試算表的最新資料';
    if (st.pending) return `有 ${st.pending} 筆等待同步`;
    return '已是最新';
  }

  const redirectNote = '<p class="note muted">登入視窗打不開時，可以'
    + '<button type="button" class="link-btn" data-act="redirect">改用整頁登入</button>。</p>';

  function renderCloud(st) {
    $('cloud-head').textContent = st.sales ? '業務員' : 'Google 雲端硬碟';
    if (st.sales) {
      cloudEl.innerHTML = `
        <ul class="member-list cloud-info">
          <li><span class="member-info"><small>姓名</small><b>${U.esc(st.salesName || '—')}</b></span></li>
          <li><span class="member-info"><small>帳號</small><b>${U.esc(st.email || '還沒登入')}</b></span></li>
          <li><span class="member-info"><small>可以做</small><b>${U.esc(salesCanText(st) ? `新增${salesCanText(st)}` : '只能看')}${st.salesAll ? '・看全部' : ''}</b></span></li>
          <li><span class="member-info"><small>總部</small><b>${U.esc(st.admin || '—')}</b></span></li>
          <li><span class="member-info"><small>總部網址</small><b>${U.esc(hqTail(st.hq))}</b></span></li>
          <li><span class="member-info"><small>上次更新</small><b>${st.lastSyncAt ? U.fmtDateTime(st.lastSyncAt) : '—'}</b></span></li>
          <li><span class="member-info"><small>狀態</small><b class="${st.error ? 'warn' : ''}">${U.esc(salesStatusText(st))}</b></span></li>
        </ul>
        <button type="button" class="wide-btn primary" data-act="sync" ${st.running ? 'disabled' : ''}>${st.running ? '更新中…' : '更新'}</button>
        ${redirectNote}
        <button type="button" class="text-btn danger cloud-logout" data-act="leave">離開</button>
        <p class="note muted cloud-logout-note">${st.salesAll ? '看得到全部的客戶' : '只看得到你負責的客戶'}；新增的會送到總部，送出後不能改、不能刪。離開會清掉這台的資料，總部的資料不會動。</p>`;
      return;
    }
    if (!st.configured && !st.linked) {
      cloudEl.innerHTML = '<p class="note muted cloud-intro">雲端同步還沒設定好，目前資料只存在這台裝置。建議定期匯出 data.json 備份。</p>';
      return;
    }
    if (!st.linked) {
      cloudEl.innerHTML = `
        <p class="note muted cloud-intro">連結後，資料會存到你自己的 Google 雲端硬碟（一份試算表）。手機和電腦登入同一個帳號，就能看到同一份資料，也可以直接用 Google 試算表查看、修改。</p>
        <button type="button" class="wide-btn primary" data-act="link" ${st.running ? 'disabled' : ''}>${st.running ? '連結中…' : '連結 Google 帳號'}</button>
        ${redirectNote}`;
      return;
    }
    cloudEl.innerHTML = `
      <ul class="member-list cloud-info">
        <li><span class="member-info"><small>帳號</small><b>${U.esc(st.email)}</b></span></li>
        <li><span class="member-info"><small>上次同步</small><b>${st.lastSyncAt ? U.fmtDateTime(st.lastSyncAt) : '—'}</b></span></li>
        <li><span class="member-info"><small>狀態</small><b class="${st.error ? 'warn' : ''}">${U.esc(syncStatusText(st))}</b></span></li>
      </ul>
      ${st.problems.length ? `
        <p class="note warn-text">試算表裡有 ${st.problems.length} 個地方看不懂，這幾筆可能不正確。
          哪一列、哪一格請看<button type="button" class="link-btn" data-act="inbox">提醒</button>。</p>` : ''}
      <button type="button" class="wide-btn primary" data-act="sync" ${st.running ? 'disabled' : ''}>${st.running ? '同步中…' : '同步'}</button>
      ${st.url ? `<a class="wide-btn" href="${U.esc(st.url)}" target="_blank" rel="noopener">開啟試算表</a>` : ''}
      ${redirectNote}
      <button type="button" class="text-btn danger cloud-logout" data-act="logout" ${st.running || st.loggingOut ? 'disabled' : ''}>${st.loggingOut ? '登出中…' : '登出'}</button>
      <p class="note muted cloud-logout-note">登出會清除這台裝置上的資料，資料都還在試算表裡。要換別的 Google 帳號時先登出。</p>`;
  }

  // 業務員：沒有要送的資料，只有拿資料
  function salesStatusText(st) {
    if (st.running) return '更新中…';
    if (st.denied) return st.error || '你現在不是業務員，請找管理員';
    if (st.offline) return st.pending ? `目前沒有網路，${st.pending} 筆會在連上網路後送出` : '目前沒有網路，看的是上次拿到的資料';
    if (st.error) return `更新失敗：${st.error}`;
    if (st.needLogin && st.pending) return `有 ${st.pending} 筆還沒送出，按「更新」重新登入`;
    if (st.needLogin) return st.lastSyncAt ? '登入已過期，按「更新」重新登入' : '還沒登入，按「更新」登入';
    if (st.pending) return `有 ${st.pending} 筆等待送出`;
    return '已是最新';
  }

  // 「同步」要在點擊的當下呼叫（登入過期時會跳出 Google 視窗）
  cloudEl.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'link') Sync.startLink();
    else if (act === 'sync') Sync.syncNow();
    else if (act === 'redirect') Sync.loginByRedirect();
    else if (act === 'logout') Sync.logout();
    else if (act === 'leave') {
      const n = Sync.state().pending;
      const lost = n ? `還有 ${n} 筆新增的沒有送出，離開就沒了。\n` : '';
      if (confirm(`${lost}離開後，這台的資料會清掉，總部的資料不會動。之後要再看，請管理員重新傳邀請連結。\n\n確定離開？`)) Sync.leave();
    }
    else if (act === 'inbox') {
      menu.close();
      Inbox.open();
    }
  });

  // ---------- 自動抄表：機器把張數寄到 Gmail，試算表上的小程式（apps-script/meter.gs）寫進「抄表」；客戶電腦上的抄表程式每天或每週回報，寫進「最新回報」 ----------
  //   「說明」打開 index.html 的 #meter-help：兩種送法、抄表程式怎麼用、出問題時
  //   每個人貼在自己的試算表上：App 只能碰自己建立的檔案，沒辦法替使用者裝；按鈕直接複製程式，不會貼到舊版
  const meterEl = $('meter');
  let meterCode = null;
  // 先抓好程式：iPhone 只在點擊的當下准許寫入剪貼簿，按了才去抓會被擋
  const loadMeterCode = () => meterCode ||= fetch('apps-script/meter.gs')
    .then(r => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
    .catch(e => { meterCode = null; throw e; });

  // 讀信網址：試算表上的程式部署成網頁應用程式的網址（公司帳號是 /a/macros/網域/s/…）；存在試算表裡，其他裝置同步後也有（見 sync.js）
  const METER_URL = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/;
  let meterKey = '';

  // 只在帳號、試算表、讀信網址變了才重畫：同步狀態一直在變，重畫會清掉正在打的網址、收起打開的步驟
  function renderMeter(st) {
    const key = [st.linked, st.sales, st.email, st.url, st.meterUrl].join('|');
    if (key === meterKey) return;
    meterKey = key;
    if (st.sales) {
      meterEl.innerHTML = ''; // 業務員看不到這一段（index.html 的 admin-only）
      return;
    }
    const help = '<button type="button" class="link-btn" data-act="meter-help">說明</button>';
    if (!st.linked) {
      meterEl.innerHTML = `<p class="note muted cloud-intro">連結 Google 帳號後才能設定。${help}</p>`;
      return;
    }
    loadMeterCode().catch(() => {});
    const ready = !!st.meterUrl;
    meterEl.innerHTML = `
      <p class="note muted cloud-intro">機器自己寄信，試算表上的小程式寫進「抄表」；客戶電腦上的抄表程式每天或每週回報，寫進「最新回報」。${help}</p>
      <details class="steps-box" ${ready ? '' : 'open'}>
        <summary>設定步驟（用電腦做）</summary>
        <ol class="steps muted">
          <li>機器：按「<button type="button" class="link-btn" data-act="machine">機器設定</button>」照著設；最上面的寄信用 Gmail 一定要填，程式只讀它寄來的信</li>
          <li>「${st.url ? `<a class="link-btn" href="${U.esc(st.url)}" target="_blank" rel="noopener">打開試算表</a>` : '打開試算表'}」（右上角頭像要是 ${U.esc(st.email)}），選「擴充功能」→「Apps Script」</li>
          <li>刪掉裡面原本的內容，按「<button type="button" class="link-btn" data-act="copy-meter">複製程式</button>」貼上，存檔</li>
          <li>上方選 install，按「執行」，照畫面允許（「進階」→「前往」）</li>
          <li>App 打開、按「同步」時讀信，還有抄表程式、業務員，都要用這個網址（第 3 步貼好、存檔後再做，部署會固定當下的程式）：「部署」→「新增部署作業」→ 類型選「網頁應用程式」、誰可以存取選「任何人」→「部署」，複製網址貼到下面</li>
          <li>用抄表程式的：試算表重新整理，上方「自動抄表」→「密語」，和讀信網址一起填進程式的「設定.txt」</li>
        </ol>
        <div class="field meter-url">
          <label for="meter-url">讀信網址</label>
          <input id="meter-url" type="url" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec" value="${U.esc(st.meterUrl)}">
        </div>
        <button type="button" class="wide-btn" data-act="save-meter-url">儲存網址</button>
        <p class="note muted">之後改了程式：按「<button type="button" class="link-btn" data-act="copy-meter">複製程式</button>」重貼、存檔，執行一次 install（有跳權限就允許），再「部署」→「管理部署作業」→ 鉛筆 → 版本選「新版本」→「部署」，網址不變。不要按「新增部署作業」，那會換一個新網址。</p>
      </details>
      <p class="note muted">5-866-112 寄測試信（結算月份空白，不算帳）。</p>`;
  }

  // 抄表頁最上面一排小字：上次讀信的時間（試算表上的程式每次看完信箱都記下來，同步時讀回來）
  //   有讀信網址時，打開 App、切回來、按「同步」會先讀信再同步（見 sync.js 的 run）；同步中寫「同步中…」，同步完換回時間
  const meterLine = document.createElement('p');
  meterLine.className = 'meter-line';
  lists.readings.el.querySelector('.list').before(meterLine);
  function renderMeterLine(st) {
    meterLine.hidden = !st.linked || !(st.meterUrl || st.meterReadAt);
    // 還沒填寄信用 Gmail：程式不讀信，請管理員去填（業務員不用管）
    const noSender = st.meterNoSender && !st.sales;
    meterLine.classList.toggle('warn-text', noSender && !st.running);
    meterLine.textContent = st.running ? '同步中…' : noSender ? '沒有讀信：先到「設定 → 自動抄表 → 機器設定」填寄信用 Gmail'
      : `上次讀信 ${st.meterReadAt ? U.fmtDateTime(st.meterReadAt) : '—'}`;
  }

  async function saveMeterUrl() {
    const url = $('meter-url').value.trim();
    if (url && !METER_URL.test(url)) {
      toast('網址不對：要是 https://script.google.com/… 開頭、/exec 結尾', 'error');
      return;
    }
    try {
      await Sync.setMeterUrl(url);
      toast(url ? '已儲存，其他裝置同步後也有' : '已清除');
    } catch (e) {
      toast(e.code === 'need_login' ? '登入已過期，先按上面的「同步」再儲存' : `儲存失敗：${e.message || e}`, 'error');
    }
  }

  // 機器設定（index.html 的 #machine-sheet）：最上面填寄信用 Gmail，用到的列跟著打的字寫出來，離開那一格時存進試算表；121 寫登入 App 的那個 Gmail
  const machine = $('machine-sheet');
  const senderInput = $('sender-mail');
  const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function fillSender() {
    const mail = senderInput.value.trim();
    machine.querySelectorAll('[data-sender]').forEach(el => {
      el.textContent = !mail ? '先填上面的寄信用 Gmail' : el.dataset.sender === 'name' ? mail.split('@')[0] : mail;
      el.classList.toggle('muted', !mail);
    });
  }
  function openMachine() {
    const st = Sync.state();
    senderInput.value = st.senderMail;
    fillSender();
    machine.querySelectorAll('[data-email]').forEach(el => { el.textContent = st.email || '—'; });
    machine.showModal();
    machine.querySelector('.sheet-body').scrollTop = 0;
  }
  senderInput.addEventListener('input', fillSender);
  senderInput.addEventListener('change', async () => {
    const mail = senderInput.value.trim();
    if (mail === Sync.state().senderMail) return;
    if (mail && !MAIL.test(mail)) {
      toast('寄信用 Gmail 不對：要像 meter.abc@gmail.com', 'error');
      return;
    }
    if (!Sync.state().linked) {
      toast('連結 Google 後才會記住', 'error');
      return;
    }
    try {
      await Sync.setSenderMail(mail);
      toast(mail ? '已儲存，其他裝置同步後也有' : '已清除');
    } catch (e) {
      toast(e.code === 'need_login' ? '登入已過期，先按設定裡的「同步」再填' : `儲存失敗：${e.message || e}`, 'error');
    }
  });
  machine.querySelector('[data-act="close"]').addEventListener('click', () => machine.close());
  machine.addEventListener('click', e => { if (e.target === machine) machine.close(); }); // 點背景關閉

  // 自動抄表說明（index.html 的 #meter-help）：裡面的「機器設定」疊在上面打開，返回後回到說明
  const meterHelp = $('meter-help');
  function openMeterHelp() {
    meterHelp.showModal();
    meterHelp.querySelector('.sheet-body').scrollTop = 0;
  }
  meterHelp.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close' || e.target === meterHelp) meterHelp.close();
    else if (act === 'machine') openMachine();
  });

  meterEl.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    if (act === 'save-meter-url') saveMeterUrl();
    else if (act === 'machine') openMachine();
    else if (act === 'meter-help') openMeterHelp();
    else if (act === 'copy-meter') {
      try {
        await navigator.clipboard.writeText(await loadMeterCode());
        toast('已複製，到 Apps Script 貼上');
      } catch (_) {
        toast('複製失敗，請改用電腦的瀏覽器', 'error');
      }
    }
  });

  // 畫面上方的提示列：只在需要使用者處理時出現；自動同步進行中不出現，免得一直閃
  function renderSyncBar(st) {
    let text = '';
    let btn = '';
    syncAction = null;
    const invite = joinUrl();
    if (invite && st.sales && invite === st.hq) dropJoin();
    if (invite && st.sales && invite !== st.hq) {
      // 已經是業務員，又打開另一個總部的邀請連結：問要不要換過去（這台的資料會換成新總部的）
      text = `收到另一個總部的邀請連結（${hqTail(invite)}），現在連的是 ${hqTail(st.hq)}`;
      btn = '換過去';
      syncAction = () => {
        const lost = st.pending ? `還有 ${st.pending} 筆新增的沒有送出，換過去就沒了。\n` : '';
        if (!confirm(`${lost}換到新的總部後，這台的資料會換成新總部的。\n\n確定換過去？`)) return;
        dropJoin();
        Sync.join(invite);
      };
    } else if (invite && !st.sales) {
      // 收到邀請：這個瀏覽器現在是別人的資料時，先登出（資料留在試算表）或清掉（只存在這台的）
      if (st.linked) {
        text = `收到業務員邀請。要換成業務員，這個瀏覽器的 ${st.email} 會先登出`;
        btn = '換成業務員';
        syncAction = () => Sync.logout(`換成業務員之前，會先同步，再清掉這台的資料。\n資料都留在 ${st.email} 的試算表裡，之後可以再登入。\n\n確定換成業務員？`);
      } else if (Store.ownCount()) {
        text = '收到業務員邀請。這台的資料只存在這台，換成業務員會清掉';
        btn = '清掉';
        syncAction = () => {
          if (!confirm('這台的資料沒有存到 Google，清掉就沒了；要留的話，先到設定「匯出 data.json」。\n\n確定清掉，換成業務員？')) return;
          Store.wipe();
          location.reload();
        };
      } else {
        text = '收到業務員邀請：用你的 Gmail 登入，看得到你負責的客戶';
        btn = '登入';
        syncAction = () => {
          dropJoin();
          Sync.join(invite);
        };
      }
    } else if (st.sales && st.denied) {
      text = st.error || '你現在不是業務員，請找管理員';
    } else if (st.sales && st.needLogin && !st.lastSyncAt && !st.running) {
      text = '業務員：還沒登入';
      btn = '登入';
      syncAction = Sync.syncNow;
    } else if (!st.linked) {
      text = '';
    } else if (st.running) {
      if (syncBar.hidden) return;
      text = '同步中…';
    } else if (st.offline) {
      text = offlineText(st);
    } else if (st.error) {
      text = `${st.sales ? '更新' : '同步'}失敗：${st.error}`;
      btn = '重試';
      syncAction = Sync.syncNow;
    } else if (st.pending && st.needLogin) {
      text = `有 ${st.pending} 筆還沒${st.sales ? '送出' : '同步'}`;
      btn = st.sales ? '更新' : '同步';
      syncAction = Sync.syncNow;
    } else if (st.needLogin && (!st.lastSyncAt || Date.now() - Date.parse(st.lastSyncAt) > STALE)) {
      // 登入過期就不會自動同步：試算表或其他裝置改過的資料，要按「同步」才看得到
      text = st.lastSyncAt ? `上次${st.sales ? '更新' : '同步'}是 ${ago(st.lastSyncAt)}` : '還沒有同步過';
      btn = st.sales ? '更新' : '同步';
      syncAction = Sync.syncNow;
    }
    syncBar.hidden = !text;
    syncText.textContent = text;
    syncBtn.hidden = !btn;
    syncBtn.textContent = btn;
  }

  syncBtn.addEventListener('click', () => { if (syncAction) syncAction(); });

  // ---------- 業務員（見 sync.js 的業務員） ----------
  //   管理員在人員表單按「複製邀請連結」：App 的網址加 ?join=總部試算表上的程式的網址（就是讀信網址，部署一次大家共用）
  const JOIN_KEY = `${Store.PREFIX}join`;
  // 總部網址只寫最後幾個字（…ImyHkzWyw）：手機、電腦一比就知道是不是連到同一個
  const hqTail = url => { const m = String(url ?? '').match(/\/s\/([\w-]+)\/exec/); return m ? `…${m[1].slice(-9)}` : '—'; };
  async function invite(rec) {
    const url = Sync.state().meterUrl;
    if (!url) {
      toast('先到設定的「自動抄表」，把試算表上的程式部署好、填上讀信網址', 'error');
      return;
    }
    const link = `${location.origin}${location.pathname}?join=${encodeURIComponent(url)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast(`已複製，傳給${rec.name}`);
    } catch (_) {
      toast('複製失敗，請改用電腦的瀏覽器', 'error');
    }
  }
  //   業務員打開邀請連結：網址記在這個分頁（重新載入、登出後還在），網址列拿掉；上方提示列請他登入（見 renderSyncBar）
  const joinUrl = () => { try { return sessionStorage.getItem(JOIN_KEY) || ''; } catch (_) { return ''; } };
  const dropJoin = () => { try { sessionStorage.removeItem(JOIN_KEY); } catch (_) {} };
  (() => {
    const params = new URLSearchParams(location.search);
    const url = params.get('join');
    if (url === null) return;
    params.delete('join');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
    if (!METER_URL.test(url)) {
      toast('邀請連結不完整，請管理員重新複製', 'error');
      return;
    }
    try { sessionStorage.setItem(JOIN_KEY, url); } catch (_) {}
  })();
  //   業務員模式：最上面寫是誰、可以做什麼，編輯的按鈕藏起來（style.css 的 .sales），新增只有抄表、保養（照權限）
  //   換了模式、權限、看全部時全部重畫（設備頁、總覽只算他的，新增按鈕跟著權限）
  const salesCanText = st => [st.salesPerms.includes('記抄表') && '抄表', st.salesPerms.includes('記保養') && '保養'].filter(Boolean).join('、');
  let salesKey = null;
  document.body.classList.toggle('sales', Sync.isSales());
  function showSales(st) {
    // 最上面寫是誰：業務員寫姓名和可以做什麼；管理員（連結了 Google）寫人員裡 Email 一樣的那個人，沒有的寫帳號；只存在這台的不寫
    const line = $('sales-line');
    line.hidden = !st.linked;
    const can = salesCanText(st);
    const me = Store.list('people').find(p => st.email && String(p.email ?? '').trim().toLowerCase() === st.email.toLowerCase())?.name;
    line.textContent = st.sales ? [`業務員${st.salesName ? `：${st.salesName}` : ''}`, st.salesAll && '看全部', can ? `可以新增${can}` : '只能看'].filter(Boolean).join('・')
      : st.linked ? `管理員：${me || st.email}` : '';
    const k = [st.sales, st.salesAll, st.salesPerms.join()].join('|');
    const first = salesKey === null;
    if (k === salesKey) return;
    salesKey = k;
    if (first) return; // 打開 App 時已經照存著的狀態畫好了
    document.body.classList.toggle('sales', st.sales);
    refreshAll();
    Lists.refresh();
    checkLists();
    checkReports();
    showTab(current);
  }

  // ---------- 啟動 ----------
  if (!Store.available) {
    const banner = $('banner');
    banner.textContent = '這個瀏覽器目前不允許儲存資料（可能是無痕模式或隱私設定），輸入的資料關掉頁面後就會消失。';
    banner.hidden = false;
  }
  // 請瀏覽器盡量不要自動清掉這個網站的資料
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  refreshAll();
  // 換日後回到這個頁面（例如手機隔天從背景切回來）時全部重畫：快到期的提醒跟著今天的日期變
  let renderedDay = U.today();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || U.today() === renderedDay) return;
    renderedDay = U.today();
    refreshAll();
  });
  let savedTab = 'devices';
  try { savedTab = localStorage.getItem(TAB_KEY) || 'devices'; } catch (_) {}
  showTab(savedTab);
  try {
    if (sessionStorage.getItem(LOGOUT_KEY)) {
      sessionStorage.removeItem(LOGOUT_KEY);
      toast('已登出，這台裝置上的資料已清除');
    }
  } catch (_) {}

  // ---------- 提醒（見 inbox.js） ----------
  // 點提醒：打開那一筆資料、打開試算表、切到相關頁面或同步
  Inbox.init({
    onAction(a) {
      if (a.type === 'record') {
        if (!Store.get(a.table, a.id)) {
          toast('這筆資料已經不在了');
          return;
        }
        showTab(a.table);
        Form.open(a.table, a.id);
      } else if (a.type === 'device') {
        // 保固快到期：打開設備詳情
        if (!Store.get('devices', a.id)) {
          toast('這台設備已經不在了');
          return;
        }
        Detail.open(a.id);
      } else if (a.type === 'tab') {
        showTab(a.tab);
        window.scrollTo(0, 0);
      } else if (a.type === 'sheet') {
        const url = Sync.state().url;
        if (url) window.open(url, '_blank', 'noopener');
        else toast('還沒有連結 Google 試算表');
      } else if (a.type === 'sync') {
        Sync.syncNow();
      } else if (a.type === 'list-import') {
        // 不在清單裡的值：一次加進清單
        const n = Refs.importMissing(a.scope);
        onChanged(Refs.listOfScope(a.scope)?.table, null);
        toast(n ? `已加入 ${n} 項到清單` : '都已經在清單裡了');
      } else if (a.type === 'list-open') {
        const l = Refs.listOfScope(a.scope);
        if (l) Lists.open(l.key);
      }
    },
  });

  // 設備裡填過、但不在清單裡的值（試算表手打的、清單做好之前填的）：每個範圍一則提醒，附「加入清單」
  //   找不到設備的紀錄（在試算表裡打錯了設備編號）、找不到的位置編號：各一則提醒，列出是哪幾筆
  function checkLists() {
    // 業務員只拿到一部分（別的位置、清單外的人都不在），不提醒找不到、不在清單裡
    const sales = Sync.isSales();
    const lostPlaces = Records.lostPlaces();
    Inbox.reconcile('lostplace:', lostPlaces.length ? [{
      key: 'lostplace:all',
      title: `有 ${lostPlaces.length} 筆資料找不到位置`,
      body: `${lostPlaces.slice(0, 10).map(o => `${SCHEMAS[o.table].title}：${SCHEMAS[o.table].describe?.(o.rec) || ''}（${o.value}）`).join('\n')}`
        + `${lostPlaces.length > 10 ? `\n…等 ${lostPlaces.length} 筆` : ''}\n可能是試算表裡的位置編號打錯了，改成正確的編號或位置的名稱就好。`,
    }] : []);
    const lost = Records.orphans();
    Inbox.reconcile('orphan:', lost.length ? [{
      key: 'orphan:records',
      title: `有 ${lost.length} 筆紀錄找不到設備`,
      body: `${lost.slice(0, 10).map(o => `${SCHEMAS[o.table].title}：${Records.describe(o.table, o.rec) || '沒有填設備'}`).join('\n')}`
        + `${lost.length > 10 ? `\n…等 ${lost.length} 筆` : ''}\n可能是設備編號打錯了，改成正確的編號就好。`,
    }] : []);
    Inbox.reconcile('notinlist:', (sales ? [] : Refs.missing()).map(m => ({
      key: `notinlist:${m.key}`,
      title: `有 ${m.values.length} 個${m.name}不在清單裡`,
      body: `${m.values.slice(0, 10).join('、')}${m.values.length > 10 ? `…等 ${m.values.length} 個` : ''}\n加進清單後，選單裡就選得到。`,
      buttons: [
        { label: '加入清單', action: { type: 'list-import', scope: m.key } },
        { label: '打開清單', action: { type: 'list-open', scope: m.key } },
      ],
    })));
  }
  checkLists();
  Store.onChange(checkLists);

  // 合約到期、快到期，保固 30 天內到期：一份合約、一台設備各一則（計算見 records.js，總覽的「要處理」也是這些）
  //   處理掉（重新簽約、填提前結束日、保固過了）就變成「已解決」；內容只寫日期，天數每天變不會每天重新標成未讀
  function checkDue() {
    Inbox.reconcile('contract:', Records.contractsDue().map(c => ({
      key: `contract:${c.id}`,
      title: `${String(c.endDate) < U.today() ? '合約已到期' : '合約快到期'}：${Records.contractPlaces(c).join('、') || '沒有填位置'}`,
      body: `到期日 ${U.fmtDate(c.endDate)}`,
      action: { type: 'record', table: 'contracts', id: c.id },
    })));
    Inbox.reconcile('warranty:', Records.warrantyDue().map(d => ({
      key: `warranty:${d.id}`,
      title: `保固快到期：${Records.label(d)}`,
      body: `保固到 ${U.fmtDate(d.warranty)}${d.location ? `（${Records.placeName(d.location)}）` : ''}`,
      action: { type: 'device', id: d.id },
    })));
  }
  checkDue();
  Store.onChange(checkDue);

  // 業務員回報的問題（抄表、保養的「業務員回報」）：一筆一則，點了打開那一筆；管理員清空就變成已解決；業務員自己那邊不提醒
  function checkReports() {
    const list = Sync.isSales() ? [] : ['readings', 'maintenance'].flatMap(t => Store.list(t)
      .filter(r => String(r.report ?? '').trim()).map(r => ({ t, r })));
    Inbox.reconcile('report:', list.map(({ t, r }) => ({
      key: `report:${t}:${r.id}`,
      title: `業務員回報：${Records.describe(t, r)}`,
      body: `${String(r.report).trim()}\n改好後把「業務員回報」清空。`,
      action: { type: 'record', table: t, id: r.id },
    })));
  }
  checkReports();
  Store.onChange(checkReports);

  // 試算表的資料讀回來之後，全部重畫
  Sync.init({
    toast,
    choose,
    notify: Inbox.add,
    onData() {
      refreshAll();
      Lists.refresh();
      checkLists();
      checkDue();
      checkReports();
      if (menu.open) {
        renderListsMenu();
        renderBackupInfo();
      }
    },
    onStatus(st) {
      showSales(st);
      renderSyncBar(st);
      renderCloud(st);
      renderMeter(st);
      renderMeterLine(st);
      Inbox.syncStatus(st);
    },
    // 登出：這台裝置的資料已經清掉，重新載入頁面，畫面和記在記憶體裡的東西全部從空白開始
    onLogout() {
      try { sessionStorage.setItem(LOGOUT_KEY, '1'); } catch (_) {}
      location.reload();
    },
  });

  // 離線也打得開（見 sw.js）：版本號跟著這個檔案網址後面的 ?v=，換版本時存在手機裡的那份也一起換
  if ('serviceWorker' in navigator) {
    const v = new URL(document.currentScript?.src || location.href).searchParams.get('v') || '';
    navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(v)}`).catch(() => {});
  }
})();
