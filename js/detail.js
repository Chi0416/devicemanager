// 設備詳情：點設備卡片打開（見 app.js）
//   上面：設備資訊（編號、名稱、狀態、型號、主機板號碼、保管人、保固）；右上角「編輯」打開設備的表單
//   下面：一張表一列（位置、合約、抄表、保養、翻新、配件），寫最新的狀況和筆數
//     點一列打開那張表的頁面（這台設備的紀錄、右上角新增）；右邊的「＋」直接新增
//   在這裡新增紀錄時自動帶入這台設備；設備被刪掉時這一頁跟著關
const Detail = (() => {
  const dlg = document.getElementById('detail-sheet');
  const titleEl = dlg.querySelector('.sheet-title');
  const bodyEl = dlg.querySelector('.sheet-body');
  const infoEl = dlg.querySelector('.detail-info');
  const rowsEl = dlg.querySelector('.detail-rows');
  // 一張表的頁面
  const sub = document.getElementById('sub-sheet');
  const subTitle = sub.querySelector('.sheet-title');
  const subBody = sub.querySelector('.sheet-body');

  // 每一列：哪張表、名稱、最新的狀況 summary(設備) → { main, sub, warn }
  const ROWS = [
    { key: 'moves', label: '位置', summary: locationRow },
    { key: 'contracts', label: '合約', summary: contractRow },
    { key: 'readings', label: '抄表', summary: readingRow },
    { key: 'maintenance', label: '保養', summary: d => workRow(d, 'maintenance', r => r.item) },
    { key: 'refurbs', label: '翻新', summary: d => workRow(d, 'refurbs', r => Records.firstLine(r.content), Records.refurbNote) },
    { key: 'parts', label: '配件', summary: partsRow },
  ];
  const statusField = SCHEMAS.devices.fields.find(f => f.key === 'status');
  let id = null;   // 打開的設備
  let open = null; // 打開的那張表

  const device = () => (id ? Store.get('devices', id) : null);
  const code = () => device()?.code || '';

  const lists = Object.fromEntries(ROWS.map(r => [r.key, createList(r.key, SCHEMAS[r.key], {
    openForm: rid => Form.open(r.key, rid),
    rows: () => Records.of(r.key, code()),
    detail: true,
  })]));
  Object.values(lists).forEach(l => subBody.appendChild(l.el));

  // ---------- 每一列的狀況 ----------
  function locationRow(d) {
    const m = Records.latest('moves', d.code, 'date');
    return { main: d.location || '還沒有填位置', sub: m ? `${U.fmtDate(m.date)} ${m.type}` : '' };
  }

  function contractRow(d) {
    const c = Records.currentContract(d.code);
    if (!c) return { main: '還沒有合約' };
    const end = Records.endText(c);
    return { main: end?.text || `${U.fmtDate(c.signDate)} 簽約`, sub: Records.firstLine(c.content), warn: !!end?.warn };
  }

  function readingRow(d) {
    const r = Records.latest('readings', d.code, 'date');
    if (!r) return { main: '還沒有抄表' };
    const use = Records.usageNote(r);
    const main = r.month ? `${U.fmtMonth(r.month)} 帳（${U.fmtDate(r.date)} 抄）` : U.fmtDate(r.date);
    return { main, sub: use?.text || '', warn: !!use?.warn };
  }

  // 保養、翻新：最近一次那天做了什麼（同一趟換了好幾樣，全部列出來）
  function workRow(d, table, what, note = Records.workNote) {
    const r = Records.latest(table, d.code, 'date');
    if (!r) return { main: `還沒有${SCHEMAS[table].title}` };
    const day = Records.of(table, d.code).filter(x => x.date === r.date);
    const notes = day.map(x => note(x)?.text).filter(Boolean);
    return { main: `${U.fmtDate(r.date)} ${day.map(what).filter(Boolean).join('、')}`.trim(), sub: notes.join('；') };
  }

  function partsRow(d) {
    const on = Records.of('parts', d.code).filter(p => !p.removeDate).map(p => p.name);
    return { main: on.length ? on.join('、') : '沒有裝選配件' };
  }

  // ---------- 畫面 ----------
  function infoHTML(d) {
    const tone = Refs.tone('statuses', Refs.find(statusField, d.status));
    const cells = [['型號', d.model], ['主機板號碼', d.board], ['保管人', d.keeper]]
      .map(([label, v]) => `<span class="cell"><small>${label}</small><span>${U.esc(v) || '—'}</span></span>`).join('');
    const w = warrantyNote(d);
    return `
      <div class="detail-card">
        <span class="card-top">
          <span class="card-title">${U.esc(d.name)}</span>
          ${d.status ? `<span class="badge ${U.esc(tone)}">${U.esc(d.status)}</span>` : ''}
        </span>
        <span class="card-grid">${cells}</span>
        ${w ? `<span class="card-note${w.warn ? ' warn' : ''}">${U.esc(w.text)}</span>` : ''}
      </div>`;
  }

  function rowHTML(row, d) {
    const s = row.summary(d);
    const n = Records.of(row.key, d.code).length;
    const what = SCHEMAS[row.key].title;
    return `
      <li>
        <button type="button" class="list-item" data-open="${row.key}">
          <span class="row-label">${row.label}</span>
          <span class="member-info"><b class="${s.warn ? 'warn' : ''}">${U.esc(s.main)}</b>${s.sub ? `<small>${U.esc(s.sub)}</small>` : ''}</span>
          <span class="uses">${n || ''}</span><span class="go" aria-hidden="true">›</span>
        </button>
        <button type="button" class="row-add" data-add="${row.key}" aria-label="新增${what}">＋</button>
      </li>`;
  }

  function render() {
    const d = device();
    if (!d) {
      if (sub.open) sub.close();
      if (dlg.open) dlg.close();
      return;
    }
    titleEl.textContent = d.code || '設備';
    infoEl.innerHTML = infoHTML(d);
    rowsEl.innerHTML = ROWS.map(r => rowHTML(r, d)).join('');
    if (open) {
      subTitle.textContent = `${d.code} ${ROWS.find(r => r.key === open).label}`;
      lists[open].refresh();
    }
  }

  // ---------- 動作 ----------
  function show(deviceId) {
    if (!Store.get('devices', deviceId)) return;
    id = deviceId;
    render();
    if (!dlg.open) dlg.showModal();
    bodyEl.scrollTop = 0;
  }

  // 一張表的頁面：這台設備的紀錄
  function openTable(key) {
    open = key;
    Object.entries(lists).forEach(([k, l]) => { l.el.hidden = k !== key; });
    lists[key].reset();
    render();
    if (!sub.open) sub.showModal();
    subBody.scrollTop = 0;
  }

  const add = key => Form.open(key, null, { device: code() });

  // 資料改了（新增、修改、刪除、同步）：重畫；剛改的那筆紀錄閃一下
  function changed(key, rec) {
    if (!dlg.open) return;
    render();
    if (sub.open && rec && key === open) lists[key].changed(rec);
  }

  function init() {
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-act="edit"]').addEventListener('click', () => Form.open('devices', id));
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // 點背景關閉
    rowsEl.addEventListener('click', e => {
      const plus = e.target.closest('[data-add]');
      if (plus) {
        add(plus.dataset.add);
        return;
      }
      const row = e.target.closest('[data-open]');
      if (row) openTable(row.dataset.open);
    });
    sub.querySelector('[data-act="close"]').addEventListener('click', () => sub.close());
    sub.querySelector('[data-act="add"]').addEventListener('click', () => add(open));
    sub.addEventListener('click', e => { if (e.target === sub) sub.close(); });
    sub.addEventListener('close', () => { open = null; });
  }

  return { init, open: show, changed, refresh: () => changed(null, null) };
})();
