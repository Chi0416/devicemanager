// 提醒：右上角的鈴鐺，把需要注意的事收在一起（只存在這台裝置）
//   兩種提醒：
//     事件（event）：發生過的事，例如重新建立試算表、取消連結、大量刪除時的選擇；留著備查
//     問題（issue）：目前還存在的問題，例如試算表裡看不懂的格子、同步失敗
//       每個問題有固定的 key，同一個問題不會重複新增；內容變了或又出現時重新標成未讀
//       問題不見了（修好了）就標成「已解決」變灰，不會直接刪掉
//   打開提醒、關掉時全部算已讀；最多留 100 則，超過時從最舊的刪起（還沒解決的問題不刪）
//   點有動作的提醒：打開那一筆資料、打開試算表、切到相關頁面或同步（由 app.js 處理）
//   有些問題帶著自己的按鈕（buttons），點了不會關掉提醒，可以接著處理下一則
const Inbox = (() => {
  const KEY = `${Store.PREFIX}inbox`;
  const MAX = 100;
  const $ = id => document.getElementById(id);

  let items = load(); // [{ key, kind, title, body, action, buttons, at, read, resolved }]
  let els = null;     // 畫面元素（init 之後才有；測試時沒有畫面）
  let hooks = { onAction() {} };

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(v) ? v : [];
    } catch (_) {
      return [];
    }
  }

  // 看過而且處理完的：看過的事件、已解決的問題
  const done = m => m.read && (m.kind === 'event' || m.resolved);

  // 超過上限時從最舊的刪起：先刪處理完的，不夠再刪還沒看的事件和已解決的問題
  //   還沒解決的問題不刪（代表資料現在真的有問題；刪了下次檢查也會再出現）
  function trim() {
    if (items.length <= MAX) return;
    const oldest = [...items].sort((a, b) => a.at - b.at);
    const drop = new Set();
    for (const pass of [done, m => m.kind === 'event' || m.resolved]) {
      for (const m of oldest) {
        if (items.length - drop.size <= MAX) break;
        if (pass(m)) drop.add(m);
      }
    }
    items = items.filter(m => !drop.has(m));
  }

  function save() {
    trim();
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (_) {}
    render();
  }

  // ---------- 新增提醒 ----------
  // 事件：每次都新增一則
  function add({ title, body = '', action = null }) {
    items.push({
      key: `event:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      kind: 'event', title, body, action, at: Date.now(), read: false,
    });
    save();
  }

  // 問題：list 是這一類（key 都以 prefix 開頭）目前存在的問題
  //   新的問題新增；又出現或內容變了的重新標成未讀；不在 list 裡的標成已解決
  //   buttons（自己的按鈕）也算內容，變了也重新標成未讀
  function reconcile(prefix, list) {
    const now = Date.now();
    const current = new Set(list.map(i => i.key));
    const extra = i => ({ action: i.action || null, buttons: i.buttons || null });
    const same = (m, i) => m.title === i.title && m.body === (i.body || '') &&
      JSON.stringify(m.buttons || null) === JSON.stringify(i.buttons || null);
    let changed = false;
    list.forEach(i => {
      const m = items.find(x => x.key === i.key);
      if (!m) {
        items.push({ key: i.key, kind: 'issue', title: i.title, body: i.body || '', ...extra(i), at: now, read: false, resolved: false });
        changed = true;
      } else if (m.resolved || !same(m, i)) {
        Object.assign(m, { title: i.title, body: i.body || '', ...extra(i), at: now, read: false, resolved: false });
        changed = true;
      }
    });
    items.forEach(m => {
      if (m.kind === 'issue' && m.key.startsWith(prefix) && !m.resolved && !current.has(m.key)) {
        m.resolved = true;
        changed = true;
      }
    });
    if (changed) save();
  }

  // ---------- 同步 ----------
  //   失敗時留一則（同樣的錯誤不重複），之後同步成功就標成已解決
  //   試算表裡看不懂的格子：每個分頁一則；要等這次打開 App 後真的讀過試算表才更新，避免剛打開時誤判成已解決
  let seenOkAt = 0;
  let seenProblemsAt = 0;

  function syncStatus(st) {
    if (!st.linked) {
      reconcile('sync:', []);
      reconcile('sheet:', []);
      return;
    }
    if (st.error && !st.running) {
      reconcile('sync:', [{ key: 'sync:error', title: '同步失敗', body: st.error, action: { type: 'sync' } }]);
    } else if (st.okAt && st.okAt !== seenOkAt) {
      seenOkAt = st.okAt;
      reconcile('sync:', []);
    }
    if (st.problemsAt && st.problemsAt !== seenProblemsAt) {
      seenProblemsAt = st.problemsAt;
      const byTab = new Map();
      st.problems.forEach(p => byTab.set(p.tab, [...(byTab.get(p.tab) || []), p]));
      reconcile('sheet:', [...byTab].map(([tab, list]) => ({
        key: `sheet:${tab}`,
        title: `試算表「${tab}」有 ${list.length} 個地方看不懂`,
        body: list.slice(0, 5).map(p => `${p.row ? `第 ${p.row} 列：` : ''}${p.msg}`).join('\n')
          + (list.length > 5 ? `\n…還有 ${list.length - 5} 個` : ''),
        action: { type: 'sheet' },
      })));
    }
  }

  // ---------- 已讀、清除 ----------
  const unread = () => items.filter(m => !m.read).length;

  function markAllRead() {
    if (!unread()) return;
    items.forEach(m => { m.read = true; });
    save();
  }

  // 還沒解決的問題不清（清掉也會在下次檢查時再出現）
  function clearRead() {
    items = items.filter(m => !done(m));
    save();
  }

  // ---------- 畫面 ----------
  function timeText(ms) {
    const d = new Date(ms);
    const hm = `${U.pad2(d.getHours())}:${U.pad2(d.getMinutes())}`;
    const day = `${d.getFullYear()}-${U.pad2(d.getMonth() + 1)}-${U.pad2(d.getDate())}`;
    return day === U.today() ? `今天 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }

  const buttonsHTML = m => `
    <span class="msg-actions">${m.buttons.map((b, j) =>
      `<button type="button" class="msg-btn${j ? '' : ' primary'}" data-key="${U.esc(m.key)}" data-btn="${j}">${U.esc(b.label)}</button>`).join('')}
    </span>`;

  function msgHTML(m) {
    // 帶著自己按鈕的提醒整則不能點，免得點到按鈕以外的地方也觸發
    const choices = !m.resolved && m.buttons;
    const go = !choices && m.action && !m.resolved;
    const tag = go ? 'button' : 'div';
    return `
      <li>
        <${tag}${go ? ' type="button"' : ''} class="msg${m.read ? '' : ' unread'}${m.resolved ? ' resolved' : ''}" data-key="${U.esc(m.key)}">
          <span class="msg-head"><b>${U.esc(m.title)}</b><time>${timeText(m.at)}</time></span>
          ${m.body ? `<span class="msg-body">${U.esc(m.body)}</span>` : ''}
          ${choices ? buttonsHTML(m) : ''}
          ${m.resolved ? '<span class="msg-tag">已解決</span>' : ''}
          ${go ? '<span class="msg-go" aria-hidden="true">›</span>' : ''}
        </${tag}>
      </li>`;
  }

  function render() {
    if (!els) return;
    const n = unread();
    els.count.textContent = n > 99 ? '99+' : String(n);
    els.count.hidden = !n;
    els.bell.setAttribute('aria-label', n ? `提醒（${n} 則未讀）` : '提醒');
    els.clear.disabled = !items.some(done);
    els.list.innerHTML = [...items].sort((a, b) => b.at - a.at).map(msgHTML).join('');
    els.empty.hidden = items.length > 0;
  }

  // 寬螢幕時像下拉選單一樣出現在鈴鐺下方；手機上和其他 sheet 一樣從下方出現
  function open() {
    render();
    const wide = matchMedia('(min-width: 700px)').matches;
    const r = els.bell.getBoundingClientRect();
    els.dlg.style.marginTop = wide ? `${Math.round(r.bottom + 8)}px` : '';
    els.dlg.style.marginRight = wide ? `${Math.max(16, Math.round(innerWidth - r.right))}px` : '';
    if (!els.dlg.open) els.dlg.showModal();
  }

  function init(h) {
    hooks = { ...hooks, ...h };
    els = {
      bell: $('btn-inbox'),
      count: $('inbox-count'),
      dlg: $('inbox-sheet'),
      list: $('inbox-list'),
      empty: $('inbox-empty'),
      clear: $('inbox-clear'),
    };
    els.bell.addEventListener('click', open);
    els.dlg.querySelector('[data-act="close"]').addEventListener('click', () => els.dlg.close());
    els.dlg.addEventListener('click', e => { if (e.target === els.dlg) els.dlg.close(); }); // 點背景關閉
    els.dlg.addEventListener('close', markAllRead);
    els.clear.addEventListener('click', clearRead);
    // 「同步」要在點擊的當下呼叫（登入過期時會跳出 Google 視窗），所以直接在這裡處理
    els.list.addEventListener('click', e => {
      // 提醒自己的按鈕：留在提醒，可以接著處理下一則
      const choice = e.target.closest('[data-btn]');
      if (choice) {
        const m = items.find(x => x.key === choice.dataset.key);
        if (m) hooks.onAction(m.buttons[+choice.dataset.btn].action);
        return;
      }
      const btn = e.target.closest('button[data-key]');
      const m = btn && items.find(x => x.key === btn.dataset.key);
      if (!m?.action) return;
      els.dlg.close();
      hooks.onAction(m.action);
    });
    render();
  }

  return { init, open, render, add, reconcile, syncStatus, unread, markAllRead, clearRead, list: () => items };
})();
