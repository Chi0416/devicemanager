// 合約頁（底部第五格）：上面六個方塊，下面搜尋和清單（卡片和其他紀錄一樣，見 list.js）
//   方塊：目前、快到期、已到期、簽約中、還沒簽回、有機器沒合約；數字是全部的（不跟著搜尋），計算見 records.js，總覽的要處理也是這些
//     快到期、已到期算在目前裡面，數字不會剛好加起來
//     點一格只列那些，再點一次回到全部；0 的不能點；正在看的一格處理完了回到全部
//     有機器沒合約列的是位置：一個位置一張卡片，點了打開位置詳情，在那裡新增合約
function createContracts() {
  const late = r => String(r.endDate) < U.today();
  const TILES = [
    { key: 'now', label: '目前', list: () => Records.contractsNow() },
    { key: 'soon', label: '快到期', warn: true, list: () => Records.contractsDue().filter(r => !late(r)) },
    { key: 'over', label: '已到期', warn: true, list: () => Records.contractsDue().filter(late) },
    { key: 'signing', label: '簽約中', list: () => Records.contractsSigning() },
    { key: 'out', label: '還沒簽回', warn: true, list: () => Records.contractsOut() },
    { key: 'none', label: '有機器沒合約', warn: true, list: () => Records.placesNoContract() },
  ];
  const tileOf = k => TILES.find(t => t.key === k) || null;
  const state = { tile: '' };
  let shown = new Set(); // 正在看的一格列了哪幾筆：存了之後不在這一格的，是處理完了還是新的

  const list = createList('contracts', SCHEMAS.contracts, {
    openForm: id => Form.open('contracts', id),
    device: r => Records.recordCells('contracts', r),
    rows: () => (state.tile && state.tile !== 'none' ? tileOf(state.tile).list() : Store.list('contracts')),
  });
  list.el.hidden = false;

  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  el.innerHTML = `
    <div class="stat-tiles contract-tiles" role="group" aria-label="篩選"></div>
    <div class="list place-list" hidden></div>`;
  const tilesEl = el.querySelector('.contract-tiles');
  const placesEl = el.querySelector('.place-list');
  el.insertBefore(list.el, placesEl);

  function placeCardHTML(p) {
    const ms = Records.machinesAt(p.code);
    const c = DetailRows.contract(null, Records.contractsAt(p.code));
    return `
      <button type="button" class="card" data-place="${U.esc(p.id)}">
        <span class="card-top"><span class="card-title">${U.esc(p.name || p.code)}</span></span>
        <span class="card-sub">${U.esc(ms.length > 1 ? `${ms.length} 台` : Records.label(ms[0]))}</span>
        <span class="card-note${c.warn ? ' warn' : ''}">${U.esc([c.main, c.sub].filter(Boolean).join('・'))}</span>
      </button>`;
  }

  // 方塊和下面那一格的內容；有機器沒合約列位置，其他交給清單
  function render(renderList = () => list.refresh()) {
    if (state.tile && !tileOf(state.tile).list().length) state.tile = '';
    tilesEl.innerHTML = TILES.map(t => {
      const n = t.list().length;
      return `
      <button type="button" class="stat-tile${t.warn && n ? ' warn' : ''}${state.tile === t.key ? ' on' : ''}" data-tile="${t.key}" aria-pressed="${state.tile === t.key}"${n ? '' : ' disabled'}>
        <span class="stat-label">${U.esc(t.label)}</span>
        <b>${n}</b>
      </button>`;
    }).join('');
    const places = state.tile === 'none';
    list.el.hidden = places;
    placesEl.hidden = !places;
    shown = new Set(state.tile ? tileOf(state.tile).list().map(r => r.id) : []);
    if (places) placesEl.innerHTML = Records.placesNoContract().map(placeCardHTML).join('');
    else renderList();
  }

  tilesEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-tile]');
    if (!btn) return;
    state.tile = state.tile === btn.dataset.tile ? '' : btn.dataset.tile;
    render();
  });
  placesEl.addEventListener('click', e => {
    const card = e.target.closest('[data-place]');
    if (card) Place.open(card.dataset.place);
  });

  // 新增或修改了合約：那一張閃一下
  //   正在看的一格裡的那筆改完不在這一格了（填了簽回日）：處理完了，留在這一格；新的、本來就不在這一格的：回到全部才看得到
  function changed(rec) {
    const t = tileOf(state.tile);
    const inTile = !!rec && !!t && t.list().some(r => r.id === rec.id);
    if (t && t.key !== 'none' && rec && !inTile && !shown.has(rec.id)) state.tile = '';
    render(() => (rec && (!state.tile || inTile) ? list.changed(rec) : list.refresh()));
  }

  function reset() {
    state.tile = '';
    render(() => list.reset());
  }

  // 從總覽跳過來：只列那一格
  function show({ tile = '' } = {}) {
    state.tile = tile;
    render();
  }

  return { el, refresh: () => render(), changed, reset, show };
}
