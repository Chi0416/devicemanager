// 總覽：最上面寫共幾台、幾種機型；下面是狀態方塊、要處理、各機型有幾台（計算見 records.js）
//   狀態方塊：全部和每一種狀態各一格，寫幾台；點一格，下面的機型只算那個狀態（預設第一個狀態，這台裝置記住上次選的）
//   要處理：合約到期、快到期，保固 30 天內到期，空著的位置；依資料算，處理掉就自己不見，沒有的那一列不列
//     點一列打開那份清單（#todo-sheet），點一項打開那份合約、那台設備、那個位置
//   機型：依世代分組（機型清單的「世代」，空白時照型號猜），每組寫小計；組裡兩欄、照機型清單的順序，細長條是台數
//     點一個到設備頁，篩好狀態和機型（onPick，見 app.js）
function createOverview({ onPick }) {
  const KEY = `${Store.PREFIX}overview.status`;
  const statusField = SCHEMAS.devices.fields.find(f => f.key === 'status');
  let status = null; // 選的狀態；'' 是全部；null 是還沒選過（用第一個狀態）
  try { status = localStorage.getItem(KEY); } catch (_) {}

  const el = document.createElement('section');
  el.className = 'panel overview';
  el.hidden = true;
  el.innerHTML = '<div class="overview-body"></div>';
  const bodyEl = el.querySelector('.overview-body');

  const todoDlg = document.getElementById('todo-sheet');
  const todoTitle = todoDlg.querySelector('.sheet-title');
  const todoRows = todoDlg.querySelector('.todo-rows');
  const todoEmpty = todoDlg.querySelector('.todo-empty');
  let todo = null; // 打開的那份清單（TODOS 的 key）

  const ICONS = {
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
    pin: '<path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

  // 要處理的每一種：list 算出來的資料；summary 總覽那一列的小字；row 清單裡一項的大字、小字；open 點了打開什麼
  const TODOS = [
    {
      key: 'contracts', title: '合約到期、快到期', icon: 'doc', tone: 'warn',
      list: () => Records.contractsDue(),
      summary: list => {
        const late = list.filter(r => String(r.endDate) < U.today()).length;
        return [late && `${late} 份已到期`, list.length - late && `${list.length - late} 份 30 天內`].filter(Boolean).join('・');
      },
      row: r => ({ title: Records.contractPlaces(r).join('、') || '沒有填位置', sub: [Records.endText(r)?.text, Records.firstLine(r.content)].filter(Boolean).join('・') }),
      open: r => Form.open('contracts', r.id),
    },
    {
      key: 'warranty', title: '保固 30 天內到期', icon: 'shield', tone: 'warn',
      list: () => Records.warrantyDue(),
      summary: list => `最近一台 ${U.fmtDate(list[0].warranty)}`,
      row: d => ({ title: Records.label(d), sub: [Records.placeName(d.location), warrantyNote(d)?.text].filter(Boolean).join('・') }),
      open: d => Detail.open(d.id),
    },
    {
      key: 'places', title: '空著的位置', icon: 'pin', tone: 'blue',
      list: () => Records.emptyPlaces(),
      summary: () => '等安裝，或客戶不租了要停用',
      row: p => {
        const m = Records.lastMoveAt(p.code);
        return { title: p.name, sub: m ? `${U.fmtDate(m.date)} ${m.type || ''} ${Records.label(Records.device(m.device))}`.replace(/\s+/g, ' ').trim() : '還沒有放過機器' };
      },
      open: p => Place.open(p.id),
    },
  ];
  const todoOf = k => TODOS.find(t => t.key === k);

  // 狀態方塊：全部、清單裡沒停用的狀態（停用了但還有設備在用的也列）、不在清單裡的狀態
  function options() {
    const used = new Set(Store.list('devices').map(Records.statusOf).filter(Boolean));
    const listed = Refs.items(statusField, { all: true }).filter(r => Refs.active('statuses', r) || used.has(r.name));
    const names = listed.map(r => r.name);
    return [
      { value: '', label: '全部', tone: '' },
      ...listed.map(r => ({ value: r.name, label: r.name, tone: Refs.tone('statuses', r) })),
      ...[...used].filter(v => !names.includes(v)).map(v => ({ value: v, label: v, tone: '' })),
    ];
  }

  function tilesHTML(opts, count) {
    return `<div class="stat-tiles" role="group" aria-label="狀態">${opts.map(o => `
      <button type="button" class="stat-tile${status === o.value ? ' on' : ''}" data-status="${U.esc(o.value)}" aria-pressed="${status === o.value}">
        <span class="stat-label">${o.value ? `<i class="dot ${U.esc(o.tone)}" aria-hidden="true"></i>` : ''}${U.esc(o.label)}</span>
        <b>${count(o.value)}</b>
      </button>`).join('')}</div>`;
  }

  function todoHTML() {
    const rows = TODOS.map(t => ({ t, list: t.list() })).filter(x => x.list.length);
    return `<h3 class="section-head">要處理</h3>${rows.length ? `<ul class="member-list todo-list">${rows.map(({ t, list }) => `
      <li><button type="button" class="list-item todo-item" data-todo="${t.key}">
        <span class="todo-icon ${t.tone}">${icon(t.icon)}</span>
        <span class="member-info"><b>${U.esc(t.title)}</b><small>${U.esc(t.summary(list))}</small></span>
        <span class="todo-count ${t.tone}">${list.length}</span><span class="go" aria-hidden="true">›</span>
      </button></li>`).join('')}</ul>` : '<p class="todo-none">目前沒有要處理的事</p>'}`;
  }

  // 機型：依世代分組（見 records.js 的 modelGroups），每組寫小計；組裡兩欄，名字、台數，下面細長條（和最多的那種比）
  function modelsHTML(groups) {
    const total = groups.reduce((n, g) => n + g.count, 0);
    const max = Math.max(1, ...groups.flatMap(g => g.rows.map(r => r.count)));
    const head = `<h3 class="section-head split"><span>機型</span><span>${U.esc(status || '全部')} ${total} 台</span></h3>`;
    if (!groups.length) return `${head}<p class="todo-none">沒有${U.esc(status)}的設備</p>`;
    const cell = r => {
      const inner = `<span class="model-line"><span class="model-name">${U.esc(r.model || '未填機型')}</span><span class="model-count">${r.count}</span></span>` +
        `<span class="model-bar"><i style="width:${Math.round(r.count / max * 100)}%"></i></span>`;
      return r.model
        ? `<li><button type="button" class="model-cell" data-model="${U.esc(r.model)}">${inner}</button></li>`
        : `<li><div class="model-cell empty-model">${inner}</div></li>`;
    };
    return `${head}<div class="model-list">${groups.map(g => `
      <div class="gen-head"><span>${U.esc(g.gen)}</span><span>${g.count} 台</span></div>
      <ul class="gen-rows">${g.rows.map(cell).join('')}</ul>`).join('')}</div>`;
  }

  function render() {
    const devices = Store.list('devices');
    if (!devices.length) {
      bodyEl.innerHTML = '<p class="empty">還沒有設備<br>到「設備」新增</p>';
      renderTodo();
      return;
    }
    const opts = options();
    if (status === null || !opts.some(o => o.value === status)) status = opts[1]?.value ?? '';
    const count = v => devices.filter(d => !v || Records.statusOf(d) === v).length;
    bodyEl.innerHTML = `
      <p class="overview-total"><b>${devices.length}</b> 台設備・${Records.modelCounts('').filter(r => r.model).length} 種機型</p>
      ${tilesHTML(opts, count)}
      ${todoHTML()}
      ${modelsHTML(Records.modelGroups(status))}`;
    renderTodo();
  }

  // 要處理的一份清單（打開時跟著資料重畫：續約了、裝了機器就不見）
  function renderTodo() {
    if (!todo || !todoDlg.open) return;
    const t = todoOf(todo);
    const list = t.list();
    todoTitle.textContent = t.title;
    todoRows.hidden = !list.length;
    todoEmpty.hidden = !!list.length;
    todoRows.innerHTML = list.map(r => {
      const x = t.row(r);
      return `<li><button type="button" class="list-item" data-id="${U.esc(r.id)}">
        <span class="member-info"><b>${U.esc(x.title)}</b>${x.sub ? `<small>${U.esc(x.sub)}</small>` : ''}</span>
        <span class="go" aria-hidden="true">›</span></button></li>`;
    }).join('');
  }

  function openTodo(k) {
    todo = k;
    if (!todoDlg.open) todoDlg.showModal();
    renderTodo();
  }

  bodyEl.addEventListener('click', e => {
    const tile = e.target.closest('[data-status]');
    if (tile) {
      status = tile.dataset.status;
      try { localStorage.setItem(KEY, status); } catch (_) {}
      render();
      return;
    }
    const t = e.target.closest('[data-todo]');
    if (t) {
      openTodo(t.dataset.todo);
      return;
    }
    const row = e.target.closest('[data-model]');
    if (row) onPick(status, row.dataset.model);
  });
  todoDlg.querySelector('[data-act="close"]').addEventListener('click', () => todoDlg.close());
  todoRows.addEventListener('click', e => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    const t = todoOf(todo);
    const r = t.list().find(x => x.id === btn.dataset.id);
    if (r) t.open(r);
  });

  return { el, refresh: render, changed: render, reset: render };
}
