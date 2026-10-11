// 詳情頁：設備詳情（Detail）、位置詳情（Place）共用 createDetail
//   上面：資訊卡；下面：一張表一列，寫最新的狀況和筆數
//     點一列打開那張表的頁面（只列這台設備、這個位置的紀錄，右上角新增）；右邊的「＋」直接新增
//   右上角「編輯」打開那一筆的表單；那一筆被刪掉時這一頁跟著關
//   設備：點設備卡片打開（見 app.js）；標題寫機型＋名稱（編號不顯示）；資訊卡上點位置打開位置詳情
//     在這裡新增紀錄時自動帶入這台設備；合約是它現在所在位置的，新增時帶入這個位置
//   位置：設定 → 清單 → 位置，點一項打開（見 lists.js）；標題寫位置名稱；資訊卡上點現在放著的機器打開設備詳情
//     機器：進出這個位置的異動；合約：包含這個位置的；抄表、保養、翻新：機器放在這裡的期間做的（照日期從異動算）
//     新增抄表、保養、翻新時，這裡只放著一台的話帶入那一台
function createDetail({ table, dlg, sub, title, infoHTML, rows, onInfoClick = () => {} }) {
  const titleEl = dlg.querySelector('.sheet-title');
  const bodyEl = dlg.querySelector('.sheet-body');
  const infoEl = dlg.querySelector('.detail-info');
  const rowsEl = dlg.querySelector('.detail-rows');
  const subTitle = sub.querySelector('.sheet-title');
  const subBody = sub.querySelector('.sheet-body');
  let id = null;   // 打開的那一筆
  let open = null; // 打開的那張表

  const current = () => (id ? Store.get(table, id) : null);
  const rowOf = key => rows.find(r => r.key === key);

  const lists = Object.fromEntries(rows.map(r => [r.key, createList(r.key, SCHEMAS[r.key], {
    openForm: rid => Form.open(r.key, rid),
    rows: () => (current() ? r.records(current()) : []),
    detail: true,
    device: r.device || null,
  })]));
  Object.values(lists).forEach(l => subBody.appendChild(l.el));

  // 每一列：summary(這一筆) → { main, sub, warn }
  function rowHTML(row, x) {
    const s = row.summary(x);
    const n = row.records(x).length;
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
    const x = current();
    if (!x) {
      if (sub.open) sub.close();
      if (dlg.open) dlg.close();
      return;
    }
    titleEl.textContent = title(x);
    infoEl.innerHTML = infoHTML(x);
    rowsEl.innerHTML = rows.map(r => rowHTML(r, x)).join('');
    if (open) {
      subTitle.textContent = `${title(x)} ${rowOf(open).label}`;
      lists[open].refresh();
    }
  }

  // ---------- 動作 ----------
  // 已經打開（被別的詳情蓋住）時重新打開，放到最上面
  function show(recId) {
    if (!Store.get(table, recId)) return;
    id = recId;
    render();
    if (dlg.open) dlg.close();
    dlg.showModal();
    bodyEl.scrollTop = 0;
  }

  // 一張表的頁面：這一筆的紀錄
  function openTable(key) {
    open = key;
    Object.entries(lists).forEach(([k, l]) => { l.el.hidden = k !== key; });
    lists[key].reset();
    render();
    if (!sub.open) sub.showModal();
    subBody.scrollTop = 0;
  }

  const add = key => Form.open(key, null, rowOf(key).preset(current()));

  // 資料改了（新增、修改、刪除、同步）：重畫；剛改的那筆紀錄閃一下
  function changed(key, rec) {
    if (!dlg.open) return;
    render();
    if (sub.open && rec && key === open) lists[key].changed(rec);
  }

  function init() {
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-act="edit"]').addEventListener('click', () => Form.open(table, id));
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // 點背景關閉
    infoEl.addEventListener('click', onInfoClick);
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
}

// 兩個詳情共用的列：合約（目前的合約到期日、合約內容第一行）、保養和翻新（最近一次那天做了什麼）
const DetailRows = {
  // c：目前的合約；all：這個位置所有的合約（提前結束、到期之後沒有新的，寫最後那一份怎麼結束的）
  contract(c, all = []) {
    if (!c && all.length) return { main: '沒有目前的合約', sub: Records.endText(all.at(-1))?.text || '' };
    if (!c) return { main: '還沒有合約' };
    const end = Records.endText(c);
    return { main: end?.text || `${U.fmtDate(c.signDate)} 簽約`, sub: Records.firstLine(c.content), warn: !!end?.warn };
  },

  reading(list) {
    const r = [...list].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.id).localeCompare(String(b.id))).at(-1);
    if (!r) return { main: '還沒有抄表' };
    const use = Records.usageNote(r);
    const main = r.month ? `${U.fmtMonth(r.month)} 帳（${U.fmtDate(r.date)} 抄）` : U.fmtDate(r.date);
    return { main, sub: use?.text || '', warn: !!use?.warn };
  },

  // 同一趟換了好幾樣，全部列出來
  work(list, table, what, note = Records.workNote) {
    const last = list.reduce((m, r) => (String(r.date ?? '') > m ? String(r.date ?? '') : m), '');
    if (!list.length) return { main: `還沒有${SCHEMAS[table].title}` };
    const day = list.filter(x => String(x.date ?? '') === last);
    const notes = day.map(x => note(x)?.text).filter(Boolean);
    return { main: `${U.fmtDate(last)} ${day.map(what).filter(Boolean).join('、')}`.trim(), sub: notes.join('；') };
  },
};

// ---------- 設備詳情 ----------
const Detail = (() => {
  const statusField = SCHEMAS.devices.fields.find(f => f.key === 'status');
  const mine = key => d => Records.of(key, d.code);
  const withDevice = d => ({ device: d.code });

  function infoHTML(d) {
    const tone = Refs.tone('statuses', Refs.find(statusField, d.status));
    const cells = [['序號', d.serial], ['機型', d.model], ['主機板號碼', d.board], ['保管人', d.keeper]]
      .map(([label, v]) => `<span class="cell"><small>${label}</small><span>${U.esc(v) || '—'}</span></span>`).join('');
    const w = warrantyNote(d);
    const p = Records.place(d.location);
    return `
      <div class="detail-card">
        <span class="card-top">
          <span class="card-title">${U.esc(d.name)}</span>
          ${d.status ? `<span class="badge ${U.esc(tone)}">${U.esc(d.status)}</span>` : ''}
        </span>
        <span class="card-grid">${cells}</span>
        ${w ? `<span class="card-note${w.warn ? ' warn' : ''}">${U.esc(w.text)}</span>` : ''}
        ${p ? `<button type="button" class="detail-link" data-place="${U.esc(p.id)}"><small>位置</small><span>${U.esc(p.name)}</span><span class="go" aria-hidden="true">›</span></button>` : ''}
      </div>`;
  }

  function locationRow(d) {
    const m = Records.latest('moves', d.code, 'date');
    return { main: Records.placeName(d.location) || '還沒有填位置', sub: m ? `${U.fmtDate(m.date)} ${m.type}` : '' };
  }

  function partsRow(d) {
    const on = Records.of('parts', d.code).filter(p => !p.removeDate).map(p => p.name);
    return { main: on.length ? on.join('、') : '沒有裝選配件' };
  }

  return createDetail({
    table: 'devices',
    dlg: document.getElementById('detail-sheet'),
    sub: document.getElementById('sub-sheet'),
    title: d => Records.label(d) || '設備',
    infoHTML,
    onInfoClick(e) {
      const link = e.target.closest('[data-place]');
      if (link) Place.open(link.dataset.place);
    },
    rows: [
      { key: 'moves', label: '位置', summary: locationRow, records: mine('moves'), preset: withDevice },
      // 合約綁位置：這台現在所在位置的合約
      { key: 'contracts', label: '合約', summary: d => DetailRows.contract(Records.deviceContract(d.code), Records.contractsAt(d.location)),
        records: d => Records.contractsAt(d.location), preset: d => ({ locations: d.location || '' }) },
      { key: 'readings', label: '抄表', summary: d => DetailRows.reading(Records.of('readings', d.code)), records: mine('readings'), preset: withDevice },
      { key: 'maintenance', label: '保養', summary: d => DetailRows.work(Records.of('maintenance', d.code), 'maintenance', r => r.item),
        records: mine('maintenance'), preset: withDevice },
      { key: 'refurbs', label: '翻新',
        summary: d => DetailRows.work(Records.of('refurbs', d.code), 'refurbs', r => Records.firstLine(r.content), Records.refurbNote),
        records: mine('refurbs'), preset: withDevice },
      { key: 'parts', label: '配件', summary: partsRow, records: mine('parts'), preset: withDevice },
    ],
  });
})();

// ---------- 位置詳情 ----------
const Place = (() => {
  // 紀錄卡片最上面寫哪一台（位置都一樣，不用寫）
  const machine = r => {
    const d = Records.device(r.device);
    return d ? { text: Records.label(d), warn: false } : { text: `${r.device || '沒有填設備'}：找不到這台設備`, warn: true };
  };
  // 這裡只放著一台時，新增紀錄帶入那一台
  const theOne = p => {
    const on = Records.machinesAt(p.code);
    return on.length === 1 ? { device: on[0].code } : {};
  };
  const at = key => p => Records.recordsAt(key, p.code);
  // 現在放著的機器：三台以內一台一個按鈕（點了打開設備詳情），多的寫幾台
  const MAX_LINKS = 3;

  function infoHTML(p) {
    const on = Records.machinesAt(p.code);
    const olds = String(p.oldNames ?? '').split('\n').map(x => x.trim()).filter(Boolean);
    const links = on.length <= MAX_LINKS ? on.map(d =>
      `<button type="button" class="detail-link" data-device="${U.esc(d.id)}"><small>現在</small><span>${U.esc(Records.label(d))}</span><span class="go" aria-hidden="true">›</span></button>`).join('')
      : `<span class="card-note">現在放著 ${on.length} 台</span>`;
    return `
      <div class="detail-card">
        <span class="card-top">
          <span class="card-title">${U.esc(p.name)}</span>
          ${p.stock ? '<span class="badge purple">倉庫</span>' : ''}
          ${p.disabled ? '<span class="badge gray">停用</span>' : ''}
        </span>
        ${olds.length ? `<span class="card-sub">以前叫：${U.esc(olds.join('、'))}</span>` : ''}
        ${p.note ? `<span class="card-sub">${U.esc(Records.firstLine(p.note))}</span>` : ''}
        ${on.length ? links : '<span class="card-note">現在沒有機器</span>'}
      </div>`;
  }

  // 機器：現在放著哪台、最近一次進出
  function machineRow(p) {
    const on = Records.machinesAt(p.code);
    const m = [...Records.movesAt(p.code)].sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? '')) || String(a.id).localeCompare(String(b.id))).at(-1);
    return {
      main: on.length > 1 ? `${on.length} 台` : on.length ? Records.label(on[0]) : '現在沒有機器',
      sub: m ? `${U.fmtDate(m.date)} ${m.type} ${Records.label(Records.device(m.device))}`.trim() : '',
    };
  }

  return createDetail({
    table: 'locations',
    dlg: document.getElementById('place-sheet'),
    sub: document.getElementById('place-sub-sheet'),
    title: p => p.name || '位置',
    infoHTML,
    onInfoClick(e) {
      const link = e.target.closest('[data-device]');
      if (link) Detail.open(link.dataset.device);
    },
    rows: [
      { key: 'moves', label: '機器', summary: machineRow, records: p => Records.movesAt(p.code), preset: p => ({ to: p.code }), device: machine },
      { key: 'contracts', label: '合約', summary: p => DetailRows.contract(Records.currentContract(p.code), Records.contractsAt(p.code)),
        records: p => Records.contractsAt(p.code), preset: p => ({ locations: p.code }) },
      { key: 'readings', label: '抄表', summary: p => DetailRows.reading(at('readings')(p)), records: at('readings'), preset: theOne, device: machine },
      { key: 'maintenance', label: '保養', summary: p => DetailRows.work(at('maintenance')(p), 'maintenance', r => r.item),
        records: at('maintenance'), preset: theOne, device: machine },
      { key: 'refurbs', label: '翻新', summary: p => DetailRows.work(at('refurbs')(p), 'refurbs', r => Records.firstLine(r.content), Records.refurbNote),
        records: at('refurbs'), preset: theOne, device: machine },
    ],
  });
})();
