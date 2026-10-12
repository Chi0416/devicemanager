// 位置頁（底部第二格）：每個位置一張卡片，點了打開位置詳情（見 detail.js 的 Place）
//   卡片：名稱、現在放的機器（空著寫最後一次搬走，倉庫寫幾台）、合約（快到期、已到期標色）、最近一期用量（跟前一期比）
//   上面搜尋（名稱、以前的名字、放著的機器的機型名稱序號都找得到），篩選：全部（沒停用的）／有機器／空著／倉庫／停用
//   用量、合約一次算好全部的位置（見 records.js 的 usageByPlace、currentContracts）
function createPlaces() {
  const FILTERS = [['', '全部'], ['on', '有機器'], ['empty', '空著'], ['stock', '倉庫'], ['off', '停用']];
  const state = { keyword: '', filter: '', flashId: null };

  const el = document.createElement('section');
  el.className = 'panel places';
  el.hidden = true;
  el.innerHTML = `
    <div class="filterbar">
      <div class="filterbar-row">
        <input class="f-keyword" type="search" placeholder="搜尋位置或機器" autocomplete="off" enterkeyhint="search">
      </div>
      <div class="filter-chips" role="group" aria-label="篩選"></div>
    </div>
    <div class="list"></div>`;
  const keywordInput = el.querySelector('.f-keyword');
  const chipsEl = el.querySelector('.filter-chips');
  const listEl = el.querySelector('.list');

  const norm = v => Refs.norm(v);
  const kindOf = (p, n) => (p.disabled ? 'off' : p.stock ? 'stock' : n ? 'on' : 'empty');
  const shortDate = iso => (String(iso).slice(0, 4) === U.today().slice(0, 4) ? U.fmtDate(iso).slice(5) : U.fmtDate(iso));
  const num = v => U.fmtNum(v);

  // 全部的位置和要寫在卡片上的東西
  function rows() {
    const machines = new Map();
    Store.list('devices').forEach(d => {
      const k = norm(d.location);
      if (!k) return;
      if (!machines.has(k)) machines.set(k, []);
      machines.get(k).push(d);
    });
    const usage = Records.usageByPlace();
    const contracts = Records.currentContracts();
    return Store.list('locations')
      .map(p => {
        const on = machines.get(norm(p.code)) || [];
        return { p, on, kind: kindOf(p, on.length), usage: usage.get(norm(p.code)) || [], contract: contracts.get(norm(p.code)) || null };
      })
      .sort((a, b) => String(a.p.name ?? '').localeCompare(String(b.p.name ?? ''), 'zh-Hant', { numeric: true }));
  }

  const searchText = x => [Records.placeText(x.p.code), ...x.on.map(d => `${Records.label(d)} ${d.serial || ''}`)].join(' ');
  const inFilter = x => (state.filter ? x.kind === state.filter : x.kind !== 'off');

  // 名稱下面那一行：現在放的機器；空著寫最後一次搬走；倉庫（或一格放了好幾台）寫幾台、哪幾種
  function subText(x) {
    if (x.on.length > 1 || (x.p.stock && x.on.length)) {
      const kinds = new Map();
      x.on.forEach(d => kinds.set(d.model || '未填機型', (kinds.get(d.model || '未填機型') || 0) + 1));
      const list = [...kinds].map(([m, n]) => (n > 1 ? `${m} ×${n}` : m));
      return `${x.on.length} 台：${list.slice(0, 4).join('、')}${list.length > 4 ? '…' : ''}`;
    }
    if (x.on.length) return Records.fullLabel(x.on[0]);
    if (x.p.stock) return '現在沒有機器';
    const m = Records.lastMoveAt(x.p.code);
    return m ? `${shortDate(m.date)} ${m.type || ''} ${Records.label(Records.device(m.device))}`.replace(/\s+/g, ' ').trim() : '還沒有放過機器';
  }

  function cellsHTML(x) {
    if (x.p.stock) return '';
    const c = Records.contractShort(x.contract);
    const u = Records.usageSummary(x.usage);
    const cell = (label, main, sub, cls = '') =>
      `<span class="cell"><small>${U.esc(label)}</small><span class="${cls}">${main}</span>${sub ? `<em>${U.esc(sub)}</em>` : ''}</span>`;
    const contract = c ? cell('合約', U.esc(c.text), c.sub, c.warn ? 'warn' : '') : cell('合約', '沒有合約', '', 'muted');
    let use;
    if (u) {
      const ch = u.change === null ? '' : ` <i>${u.change >= 0 ? '↑' : '↓'}${Math.abs(Math.round(u.change * 100))}%</i>`;
      const parts = [u.bw !== null && `黑白 ${num(u.bw)}`, u.color !== null && `彩色 ${num(u.color)}`].filter(Boolean);
      const sub = u.months > 1 ? `每月約 ${num(u.perMonth)}・${parts.join('・')}` : parts.join('・');
      use = cell(`${u.label}用量`, `${num(u.total)} 張${ch}`, sub);
    } else {
      use = cell('用量', '還沒有抄表', '', 'muted');
    }
    return `<span class="card-grid place-grid">${contract}${use}</span>`;
  }

  function cardHTML(x) {
    const badge = { empty: ['空著', 'gray'], stock: ['倉庫', 'purple'], off: ['停用', 'gray'] }[x.kind];
    return `
      <button type="button" class="card place-card${x.kind === 'off' ? ' off' : ''}${x.p.id === state.flashId ? ' flash' : ''}" data-id="${U.esc(x.p.id)}">
        <span class="card-top">
          <span class="card-title">${U.esc(x.p.name || x.p.code)}</span>
          ${badge ? `<span class="badge ${badge[1]}">${badge[0]}</span>` : ''}
        </span>
        <span class="card-sub">${U.esc(subText(x))}</span>
        ${cellsHTML(x)}
      </button>`;
  }

  function render() {
    const all = rows();
    const kw = state.keyword.trim().toLowerCase();
    const matched = kw ? all.filter(x => searchText(x).toLowerCase().includes(kw)) : all;
    const count = f => matched.filter(x => (f ? x.kind === f : x.kind !== 'off')).length;
    chipsEl.innerHTML = FILTERS.map(([f, label]) => `
      <button type="button" class="chip filter${state.filter === f ? ' on' : ''}" data-filter="${f}" aria-pressed="${state.filter === f}">${label}<span>${count(f)}</span></button>`).join('');
    const list = matched.filter(inFilter);
    listEl.innerHTML = list.length ? list.map(cardHTML).join('')
      : `<p class="empty">${all.length ? '沒有符合條件的位置' : '還沒有位置<br>點右上角「＋ 新增位置」開始建立'}</p>`;
    state.flashId = null;
  }

  keywordInput.addEventListener('input', () => { state.keyword = keywordInput.value; render(); });
  chipsEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    render();
  });
  listEl.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (card) Place.open(card.dataset.id);
  });

  // 新增或修改了位置：那一張閃一下；被篩選、搜尋藏起來的話先清掉
  function changed(rec) {
    if (rec && Store.get('locations', rec.id)) {
      const x = rows().find(r => r.p.id === rec.id);
      if (x && !inFilter(x)) state.filter = '';
      if (x && state.keyword && !searchText(x).toLowerCase().includes(state.keyword.trim().toLowerCase())) {
        state.keyword = '';
        keywordInput.value = '';
      }
      state.flashId = rec.id;
    }
    render();
  }

  function reset() {
    Object.assign(state, { keyword: '', filter: '', flashId: null });
    keywordInput.value = '';
    render();
  }

  // 從別的地方帶著篩選打開（總覽的「空著的位置」）
  function show({ filter = '' } = {}) {
    state.filter = filter;
    state.keyword = '';
    keywordInput.value = '';
    render();
  }

  return { el, refresh: render, changed, reset, show };
}
