// 客戶頁（底部第二格）：每個客戶一張卡片，點了打開客戶詳情（見 detail.js 的 Customer）
//   照名稱排；卡片：名稱、幾個位置幾台機器（母公司寫旗下幾間）、合約（快到期、已到期的有幾份）、主要業務員；裡面有位置狀態不對時加橘色「狀態不對」
//   上面搜尋（名稱、統編、母公司、聯絡人、電話、傳真），篩選：全部／有機器（它的位置至少一個放著機器）／沒有機器（母公司、還沒裝、不租了的）
//   最下面：還沒選客戶的位置（倉庫、停用的不算），點了展開，點一個打開位置的表單選客戶；補完就不見；業務員不能改，不列
function createCustomers() {
  const FILTERS = [['', '全部'], ['on', '有機器'], ['none', '沒有機器']];
  const state = { keyword: '', filter: '', flashId: null, open: false };

  const el = document.createElement('section');
  el.className = 'panel customers';
  el.hidden = true;
  el.innerHTML = `
    <div class="filterbar">
      <div class="filterbar-row">
        <input class="f-keyword" type="search" placeholder="搜尋客戶、統編或電話" autocomplete="off" enterkeyhint="search">
      </div>
      <div class="filter-chips" role="group" aria-label="篩選"></div>
    </div>
    <div class="list"></div>`;
  const keywordInput = el.querySelector('.f-keyword');
  const chipsEl = el.querySelector('.filter-chips');
  const listEl = el.querySelector('.list');

  const norm = v => Refs.norm(v);
  const cell = (label, main, sub, cls = '') =>
    `<span class="cell"><small>${U.esc(label)}</small><span class="${cls}">${main}</span>${sub ? `<em>${U.esc(sub)}</em>` : ''}</span>`;

  // 全部的客戶和要寫在卡片上的東西：位置（停用的不算）、現在放著的機器、目前的合約、旗下公司
  function rows() {
    const contracts = Records.currentContracts();
    const wrong = new Set(Records.statusMismatch().filter(x => x.place).map(x => norm(x.place.code)));
    return Store.list('customers')
      .map(c => {
        const places = Records.customerPlaces(c).filter(p => !p.disabled);
        const n = places.reduce((sum, p) => sum + Records.machinesAt(p.code).length, 0);
        return {
          c, places, n, kids: Records.childrenOf(c).length,
          contracts: [...new Set(places.map(p => contracts.get(norm(p.code))).filter(Boolean))],
          wrong: places.some(p => wrong.has(norm(p.code))),
        };
      })
      .sort((a, b) => String(a.c.name ?? '').localeCompare(String(b.c.name ?? ''), 'zh-Hant', { numeric: true }));
  }

  const kindOf = x => (x.n ? 'on' : 'none');
  const inFilter = x => !state.filter || kindOf(x) === state.filter;

  // 名稱下面那一行：幾個位置幾台機器；母公司加旗下幾間；都沒有時寫還沒有位置
  function subText(x) {
    const parts = [x.places.length && `${x.places.length} 個位置・${x.n ? `${x.n} 台機器` : '沒有機器'}`, x.kids && `旗下 ${x.kids} 間`];
    return parts.filter(Boolean).join('・') || '還沒有位置';
  }

  // 合約：這些位置目前的合約（一份寫好幾個位置的算一份），有到期、快到期的寫幾份
  function cellsHTML(x) {
    const ends = x.contracts.map(Records.contractShort);
    const over = ends.filter(e => e.text === '已到期').length;
    const soon = ends.filter(e => e.warn).length - over;
    const contract = !x.contracts.length ? cell('合約', '沒有合約', '', 'muted')
      : over || soon ? cell('合約', over ? `${over} 份已到期` : `${soon} 份快到期`, x.contracts.length > 1 ? `共 ${x.contracts.length} 份` : '', 'warn')
        : cell('合約', `${x.contracts.length} 份`, '');
    const sales = cell('主要業務員', x.c.sales ? U.esc(x.c.sales) : '—', '', x.c.sales ? '' : 'muted');
    return `<span class="card-grid place-grid">${contract}${sales}</span>`;
  }

  function cardHTML(x) {
    return `
      <button type="button" class="card place-card${x.c.id === state.flashId ? ' flash' : ''}" data-id="${U.esc(x.c.id)}">
        <span class="card-top">
          <span class="card-title">${U.esc(x.c.name)}</span>
          ${x.wrong ? '<span class="badge orange">狀態不對</span>' : ''}
        </span>
        <span class="card-sub">${U.esc(subText(x))}</span>
        ${cellsHTML(x)}
      </button>`;
  }

  // 還沒選客戶的位置：一行，點了展開；展開後一個位置一列（名稱、放的機器），點了打開位置的表單
  function missingHTML() {
    const list = Records.noCustomerPlaces();
    if (!list.length || (typeof Sync !== 'undefined' && Sync.isSales())) return '';
    const sub = p => {
      const ms = Records.machinesAt(p.code);
      return ms.length > 1 ? `${ms.length} 台` : ms.length ? Records.label(ms[0]) : '空著';
    };
    const rows = state.open ? list.map(p => `
      <button type="button" class="cust-row" data-place="${U.esc(p.id)}">
        <span class="cust-main"><b>${U.esc(p.name || p.code)}</b><small>${U.esc(sub(p))}</small></span><span class="go" aria-hidden="true">›</span>
      </button>`).join('') : '';
    return `
      <div class="nocust">
        <button type="button" class="nocust-head" data-act="nocust" aria-expanded="${state.open}">
          <span>還沒選客戶的位置 ${list.length} 個</span><span class="go" aria-hidden="true">›</span>
        </button>
        ${state.open ? `<p class="note muted">點一個位置，在表單選客戶</p>${rows}` : ''}
      </div>`;
  }

  function render() {
    const all = rows();
    const kw = state.keyword.trim().toLowerCase();
    const matched = kw ? all.filter(x => Records.customerText(x.c).toLowerCase().includes(kw)) : all;
    const count = f => matched.filter(x => !f || kindOf(x) === f).length;
    chipsEl.innerHTML = FILTERS.map(([f, label]) => `
      <button type="button" class="chip filter${state.filter === f ? ' on' : ''}" data-filter="${f}" aria-pressed="${state.filter === f}">${label}<span>${count(f)}</span></button>`).join('');
    const list = matched.filter(inFilter);
    listEl.innerHTML = (list.length ? list.map(cardHTML).join('')
      : `<p class="empty">${all.length ? '沒有符合條件的客戶' : '還沒有客戶<br>點右上角「＋ 新增客戶」開始建立'}</p>`)
      + (kw || state.filter ? '' : missingHTML());
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
    if (e.target.closest('[data-act="nocust"]')) {
      state.open = !state.open;
      render();
      return;
    }
    const place = e.target.closest('[data-place]');
    if (place) {
      Form.open('locations', place.dataset.place);
      return;
    }
    const card = e.target.closest('.card');
    if (card) Customer.open(card.dataset.id);
  });

  // 新增或修改了客戶：那一張閃一下；被篩選、搜尋藏起來的話先清掉
  function changed(rec) {
    if (rec && Store.get('customers', rec.id)) {
      const x = rows().find(r => r.c.id === rec.id);
      if (x && !inFilter(x)) state.filter = '';
      if (x && state.keyword && !Records.customerText(x.c).toLowerCase().includes(state.keyword.trim().toLowerCase())) {
        state.keyword = '';
        keywordInput.value = '';
      }
      state.flashId = rec.id;
    }
    render();
  }

  function reset() {
    Object.assign(state, { keyword: '', filter: '', flashId: null, open: false });
    keywordInput.value = '';
    render();
  }

  return { el, refresh: render, changed, reset, show: reset };
}
