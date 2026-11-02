// 清單管理：設定 → 清單 → 狀態、類別、品牌、機型、保養項目、選配件、廠商（見 refs.js 的 lists）
//   位置、客戶、人員有自己的一頁，不列在設定裡；提醒的「打開清單」還是打開這裡
//   列出這份清單的每一項：名字、小字（職稱、部門；聯絡人、電話；位置現在放著哪台）、幾台設備（幾筆紀錄）在用、停用的標籤
//   點一項打開編輯表單（改名時用到舊名字的設備一起改，見 form.js）；位置、客戶打開位置詳情、客戶詳情（見 detail.js）；右上角新增
//   設備裡填過、但不在清單裡的值（試算表手打的、清單做好之前填的）：最上面寫出來，一鍵全部加進清單
//   可以排序的清單（狀態、機型…）：按「排序」，按住每一項右邊的 ≡ 拖拉，右上角「完成」；下拉選單、總覽照這個順序
const Lists = (() => {
  const $ = id => document.getElementById(id);
  const dlg = $('lists-sheet');
  const titleEl = dlg.querySelector('.sheet-title');
  const bodyEl = dlg.querySelector('.lists-body');
  const searchEl = dlg.querySelector('.lists-search');
  const addBtn = dlg.querySelector('[data-act="add"]');
  let current = null; // Refs.lists() 的一項
  let opened = false;  // 這次打開後已經畫過了
  let sorting = false; // 排序中
  let movedId = null;  // 剛移動的那一項（閃一下）
  let drag = null;     // 拖拉中的那一項（見 dragStart）
  let hooks = { toast() {}, onChanged() {}, openItem: (t, id) => Form.open(t, id) };

  // 這份清單的「不在清單裡」：選項是那一份清單，其他是整張表
  const missingOf = l => Refs.missing().filter(s => (l.list ? s.key === `options:${l.list}` : s.ref === l.table));

  function itemHTML(r) {
    const t = current.table;
    const tg = Refs.targetOf(t);
    const subs = Refs.sub(t, r);
    const uses = Refs.usesText(t, r);
    const off = !Refs.active(t, r);
    const tone = Refs.tone(t, r);
    return `
      <li>
        <button type="button" class="list-item${off ? ' off' : ''}" data-id="${U.esc(r.id)}">
          ${tone ? `<i class="dot ${U.esc(tone)}" aria-hidden="true"></i>` : ''}
          <span class="member-info"><b>${U.esc(Refs.labelOf(t, r))}</b>${subs ? `<small>${U.esc(subs)}</small>` : ''}</span>
          ${off ? `<span class="badge gray">${U.esc(tg.off || '停用')}</span>` : ''}
          <span class="uses">${uses ? U.esc(uses) : '沒有在用'}</span>
        </button>
      </li>`;
  }

  // 總覽也照這個順序的清單
  const byOverview = l => ['機型', '世代'].includes(l.list);

  // 排序中：只列沒停用的，每一項右邊有 ≡
  function sortHTML() {
    const t = current.table;
    const on = Refs.listItems(current).filter(r => Refs.active(t, r));
    return `<p class="note muted lists-sort-hint">按住 ≡ 拖到想要的位置，下拉選單${byOverview(current) ? '和總覽' : ''}都照這個順序。好了按右上角「完成」。</p>
      <ul class="member-list list-items sorting">${on.map(r => `
        <li class="${r.id === movedId ? 'moved' : ''}" data-sort="${U.esc(r.id)}"><span class="sort-name">${U.esc(Refs.labelOf(t, r))}</span><span class="drag-handle" aria-hidden="true">≡</span></li>`).join('')}
      </ul>`;
  }

  // 拖拉排序：按住 ≡ 拖，經過的項目讓出位置；拖到畫面上下邊緣時自己捲動；放開時存新的順序
  //   只有 ≡ 不會捲動畫面（touch-action: none），在其他地方滑動照常捲動
  const scroller = dlg.querySelector('.sheet-body');
  function dragStart(e) {
    const handle = e.target.closest('.drag-handle');
    if (!handle || drag) return;
    e.preventDefault();
    const li = handle.closest('li');
    const items = [...li.parentElement.children];
    const top = scroller.scrollTop;
    const mids = items.map(x => { const r = x.getBoundingClientRect(); return r.top + top + r.height / 2; });
    const from = items.indexOf(li);
    drag = { li, items, mids, from, to: from, y: e.clientY, at: e.clientY, top, h: li.getBoundingClientRect().height, raf: 0 };
    handle.setPointerCapture(e.pointerId);
    li.classList.add('dragging');
    drag.raf = requestAnimationFrame(dragFrame);
  }
  // 每一格畫面：拖到上下邊緣時捲動
  function dragFrame() {
    if (!drag) return;
    const box = scroller.getBoundingClientRect();
    const EDGE = 56;
    const over = drag.at < box.top + EDGE ? drag.at - box.top - EDGE : drag.at > box.bottom - EDGE ? drag.at - box.bottom + EDGE : 0;
    if (over) scroller.scrollTop += Math.sign(over) * Math.min(14, Math.abs(over) / 4);
    dragMove();
    drag.raf = requestAnimationFrame(dragFrame);
  }
  // 照手指的位置移動拖著的那一項，經過的項目讓出位置，算出放開時會排在第幾個
  function dragMove() {
    const { mids, from } = drag;
    const dy = Math.max(mids[0] - mids[from], Math.min(mids.at(-1) - mids[from], drag.at - drag.y + scroller.scrollTop - drag.top));
    const mid = mids[from] + dy;
    let to = from;
    drag.items.forEach((x, j) => {
      const shift = j > from && mid >= mids[j] ? -1 : j < from && mid <= mids[j] ? 1 : 0; // 拖到頭（最多到第一項、最後一項的中間）也算經過
      if (j !== from) x.style.transform = shift ? `translateY(${shift * drag.h}px)` : '';
      to -= shift;
    });
    drag.to = to;
    drag.li.style.transform = `translateY(${dy}px)`;
  }
  function dragEnd(save) {
    if (!drag) return;
    dragMove(); // 放開前最後移動的那一下還沒畫到
    const { li, items, from, to, raf } = drag;
    cancelAnimationFrame(raf);
    drag = null;
    items.forEach(x => { x.style.transform = ''; });
    li.classList.remove('dragging');
    if (save && to !== from && Refs.moveTo(current, li.dataset.sort, to)) {
      movedId = li.dataset.sort;
      hooks.onChanged(current.table, null);
    }
  }

  function render() {
    if (!current) return;
    dragEnd(false); // 拖到一半資料變了（同步回來）：放掉，照新的資料重畫
    titleEl.textContent = current.title;
    addBtn.textContent = sorting ? '完成' : '新增';
    if (sorting) {
      searchEl.hidden = true;
      bodyEl.innerHTML = sortHTML();
      movedId = null;
      return;
    }
    const q = Refs.norm(searchEl.value);
    const all = Refs.listItems(current);
    const also = Refs.targetOf(current.table).also || (() => '');
    const items = q ? all.filter(r => Refs.norm(`${Refs.labelOf(current.table, r)} ${Refs.sub(current.table, r)} ${also(r) ?? ''}`).includes(q)) : all;
    if (!opened) searchEl.hidden = all.length < 8; // 項目少時不用搜尋；打開後不再變，新增到第 8 項時畫面不會跳
    opened = true;
    const canSort = current.sortable && !q && all.filter(r => Refs.active(current.table, r)).length > 1;
    const miss = missingOf(current);
    const values = [...new Set(miss.flatMap(s => s.values))];
    bodyEl.innerHTML = (canSort ? '<div class="lists-tools"><button type="button" class="text-btn" data-act="sort">↕ 排序</button></div>' : '') +
      (values.length ? `
        <div class="lists-missing">
          <p>${current.list === '世代' ? '機型用到' : '設備裡填過'}、但不在清單裡的有 ${values.length} 個：${U.esc(values.slice(0, 8).join('、'))}${values.length > 8 ? '…' : ''}</p>
          <button type="button" class="wide-btn" data-act="import">全部加進清單</button>
        </div>` : '') +
      (items.length ? `<ul class="member-list list-items">${items.map(itemHTML).join('')}</ul>`
        : `<p class="empty">${q ? '沒有符合的項目' : `${U.esc(current.title)}還是空的<br>點右上角「新增」開始建立`}</p>`) +
      `<p class="note muted">${U.esc(noteOf(current))}</p>`;
  }

  // 清單最下面的說明
  const USED_BY = { 保養項目: '保養的項目', 選配件: '選配件的名稱', 世代: '機型的世代（沒選時照型號猜）' };
  function noteOf(l) {
    if (l.table === 'locations') return '設備、異動、合約的位置從這裡選。一個位置放一台機器，倉庫可以放好幾台。改名時舊名字會記在「以前的名字」。點一項看這個位置的機器、合約和紀錄。';
    if (l.table === 'customers') return '位置的客戶從這裡選。改名時，用到舊名字的位置會一起改。點一項看這個客戶的資料、位置和合約。';
    if (l.table === 'people') return '設備的保管人、翻新的工程師、位置的業務員、客戶的主要業務員從這裡選。填了離職日，那天以後就不會出現在選單裡。';
    if (l.table === 'vendors') return '設備的購買廠商從這裡選。';
    if (l.table === 'statuses') return '設備的狀態從這裡選，照這裡的順序排（按「排序」調整），新增設備時預設選第一個。勾了「不用提醒」的（報廢這類）不提醒保固、保養。改名時，用到舊名字的設備會一起改。';
    const order = l.sortable ? `照這裡的順序排${byOverview(l) ? '（總覽也是）' : ''}，按「排序」調整。` : '';
    return `${USED_BY[l.list] || `設備的${l.list}`}從這裡選，${order}改名時，用到舊名字的資料會一起改；不再使用的可以勾「停用」。`;
  }

  function open(key) {
    current = Refs.lists().find(l => l.key === key) || null;
    if (!current) return;
    searchEl.value = '';
    opened = false;
    sorting = false;
    render();
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('.sheet-body').scrollTop = 0;
  }

  function refresh() {
    if (dlg.open) render();
  }

  function importAll() {
    const n = missingOf(current).reduce((sum, s) => sum + Refs.importMissing(s.key), 0);
    if (!n) return;
    hooks.onChanged(current.table, null);
    hooks.toast(`已加入 ${n} 項到${current.title}`);
  }

  function init(h) {
    hooks = { ...hooks, ...h };
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    // 右上角：平常是「新增」，排序中是「完成」
    addBtn.addEventListener('click', () => {
      if (sorting) {
        sorting = false;
        opened = false;
        render();
        return;
      }
      Form.open(current.table, null, current.list ? { list: current.list } : {});
    });
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // 點背景關閉
    searchEl.addEventListener('input', render);
    bodyEl.addEventListener('pointerdown', dragStart);
    bodyEl.addEventListener('pointermove', e => { if (drag) { drag.at = e.clientY; dragMove(); } });
    bodyEl.addEventListener('pointerup', e => { if (drag) drag.at = e.clientY; dragEnd(true); });
    bodyEl.addEventListener('pointercancel', () => dragEnd(false));
    bodyEl.addEventListener('click', e => {
      if (e.target.closest('[data-act="import"]')) {
        importAll();
        return;
      }
      if (e.target.closest('[data-act="sort"]')) {
        sorting = true;
        render();
        return;
      }
      const item = e.target.closest('[data-id]');
      if (item) hooks.openItem(current.table, item.dataset.id);
    });
  }

  return { init, open, refresh, missingOf };
})();
