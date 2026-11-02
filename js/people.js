// 人員頁（更多裡一格，電腦版在側欄）：每個人一張卡片，點了打開人員表單
//   照名稱排；卡片：姓名、職稱部門、電話，勾了業務員有標籤（職稱已經寫業務員的不加，見 schema.js 的 card）
//   上面搜尋（姓名、員工編號、職稱、部門、電話、Email），篩選：在職／業務員／已離職
function createPeople() {
  const FILTERS = [['', '在職'], ['sales', '業務員'], ['off', '已離職']];
  const state = { keyword: '', filter: '', flashId: null };

  const el = document.createElement('section');
  el.className = 'panel people';
  el.hidden = true;
  el.innerHTML = `
    <div class="filterbar">
      <div class="filterbar-row">
        <input class="f-keyword" type="search" placeholder="搜尋姓名、部門或電話" autocomplete="off" enterkeyhint="search">
      </div>
      <div class="filter-chips" role="group" aria-label="篩選"></div>
    </div>
    <div class="list"></div>`;
  const keywordInput = el.querySelector('.f-keyword');
  const chipsEl = el.querySelector('.filter-chips');
  const listEl = el.querySelector('.list');

  const rows = () => Store.list('people').slice().sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-Hant', { numeric: true }));
  const here = r => Refs.active('people', r);
  const textOf = r => [r.name, r.code, r.jobTitle, r.dept, r.phone, r.email].map(v => v ?? '').join(' ').toLowerCase();
  const inKind = (r, f) => (f === 'off' ? !here(r) : f === 'sales' ? here(r) && !!r.sales : here(r));

  function cardHTML(r) {
    const off = !here(r);
    const sub = SCHEMAS.people.card.sub(r);
    return `
      <button type="button" class="card place-card${off ? ' off' : ''}${r.id === state.flashId ? ' flash' : ''}" data-id="${U.esc(r.id)}">
        <span class="card-top">
          <span class="card-title">${U.esc(r.name)}</span>
          ${off ? '<span class="badge gray">已離職</span>' : SCHEMAS.people.card.salesTag(r) ? '<span class="badge blue">業務員</span>' : ''}
        </span>
        ${sub ? `<span class="card-sub">${U.esc(sub)}</span>` : ''}
        ${r.phone ? `<span class="card-sub">電話：${U.esc(r.phone)}</span>` : ''}
      </button>`;
  }

  function render() {
    const all = rows();
    const kw = state.keyword.trim().toLowerCase();
    const matched = kw ? all.filter(r => textOf(r).includes(kw)) : all;
    chipsEl.innerHTML = FILTERS.map(([f, label]) => `
      <button type="button" class="chip filter${state.filter === f ? ' on' : ''}" data-filter="${f}" aria-pressed="${state.filter === f}">${label}<span>${matched.filter(r => inKind(r, f)).length}</span></button>`).join('');
    const list = matched.filter(r => inKind(r, state.filter));
    listEl.innerHTML = list.length ? list.map(cardHTML).join('')
      : `<p class="empty">${all.length ? '沒有符合條件的人員' : '還沒有人員<br>點右上角「＋ 新增人員」開始建立'}</p>`;
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
    if (card) Form.open('people', card.dataset.id);
  });

  // 新增或修改了人員：那一張閃一下；被篩選、搜尋藏起來的話先清掉
  function changed(rec) {
    const r = rec && Store.get('people', rec.id);
    if (r) {
      if (!inKind(r, state.filter)) state.filter = here(r) ? '' : 'off';
      if (state.keyword && !textOf(r).includes(state.keyword.trim().toLowerCase())) {
        state.keyword = '';
        keywordInput.value = '';
      }
      state.flashId = r.id;
    }
    render();
  }

  function reset() {
    Object.assign(state, { keyword: '', filter: '', flashId: null });
    keywordInput.value = '';
    render();
  }

  return { el, refresh: render, changed, reset, show: reset };
}
