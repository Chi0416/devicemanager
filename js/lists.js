// 清單管理：設定 → 清單 → 狀態、類別、位置、品牌、機型、保養項目、選配件、人員、廠商（見 refs.js 的 lists）
//   列出這份清單的每一項：名字、小字（職稱、部門；聯絡人、電話）、幾台設備（幾筆紀錄）在用、停用的標籤
//   點一項打開編輯表單（改名時用到舊名字的設備一起改，見 form.js）；右上角新增
//   設備裡填過、但不在清單裡的值（試算表手打的、清單做好之前填的）：最上面寫出來，一鍵全部加進清單
//   可以排序的清單（狀態、機型…）：按「排序」，每一項旁邊有 ↑ ↓，右上角「完成」；下拉選單、總覽照這個順序
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
  let hooks = { toast() {}, onChanged() {} };

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
          <span class="member-info"><b>${U.esc(Refs.nameOf(t, r))}</b>${subs ? `<small>${U.esc(subs)}</small>` : ''}</span>
          ${off ? `<span class="badge gray">${U.esc(tg.off || '停用')}</span>` : ''}
          <span class="uses">${uses ? U.esc(uses) : '沒有在用'}</span>
        </button>
      </li>`;
  }

  // 排序中：只列沒停用的，每一項旁邊有 ↑ ↓
  function sortHTML() {
    const t = current.table;
    const on = Refs.listItems(current).filter(r => Refs.active(t, r));
    const btn = (r, dir, off) => `<button type="button" class="sort-btn" data-move="${dir}" data-id="${U.esc(r.id)}"` +
      ` aria-label="${U.esc(Refs.nameOf(t, r))}往${dir < 0 ? '上' : '下'}移"${off ? ' disabled' : ''}>${dir < 0 ? '↑' : '↓'}</button>`;
    return `<p class="note muted lists-sort-hint">點 ↑ ↓ 移動，下拉選單${current.list === '機型' ? '和總覽' : ''}都照這個順序。好了按右上角「完成」。</p>
      <ul class="member-list list-items sorting">${on.map((r, i) => `
        <li class="${r.id === movedId ? 'moved' : ''}"><span class="sort-name">${U.esc(Refs.nameOf(t, r))}</span>${btn(r, -1, i === 0)}${btn(r, 1, i === on.length - 1)}</li>`).join('')}
      </ul>`;
  }

  function render() {
    if (!current) return;
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
    const items = q ? all.filter(r => Refs.norm(`${Refs.nameOf(current.table, r)} ${Refs.sub(current.table, r)}`).includes(q)) : all;
    if (!opened) searchEl.hidden = all.length < 8; // 項目少時不用搜尋；打開後不再變，新增到第 8 項時畫面不會跳
    opened = true;
    const canSort = current.sortable && !q && all.filter(r => Refs.active(current.table, r)).length > 1;
    const miss = missingOf(current);
    const values = [...new Set(miss.flatMap(s => s.values))];
    bodyEl.innerHTML = (canSort ? '<div class="lists-tools"><button type="button" class="text-btn" data-act="sort">↕ 排序</button></div>' : '') +
      (values.length ? `
        <div class="lists-missing">
          <p>設備裡填過、但不在清單裡的有 ${values.length} 個：${U.esc(values.slice(0, 8).join('、'))}${values.length > 8 ? '…' : ''}</p>
          <button type="button" class="wide-btn" data-act="import">全部加進清單</button>
        </div>` : '') +
      (items.length ? `<ul class="member-list list-items">${items.map(itemHTML).join('')}</ul>`
        : `<p class="empty">${q ? '沒有符合的項目' : `${U.esc(current.title)}還是空的<br>點右上角「新增」開始建立`}</p>`) +
      `<p class="note muted">${U.esc(noteOf(current))}</p>`;
  }

  // 清單最下面的說明
  const USED_BY = { 保養項目: '保養的項目', 選配件: '選配件的名稱', 位置: '設備和異動的位置' };
  function noteOf(l) {
    if (l.table === 'people') return '設備的保管人、翻新的工程師從這裡選。填了離職日，那天以後就不會出現在選單裡。';
    if (l.table === 'vendors') return '設備的購買廠商從這裡選。';
    if (l.table === 'statuses') return '設備的狀態從這裡選，依「順序」排，新增設備時預設選第一個。勾了「不用提醒」的（報廢這類）不提醒保固、保養。改名時，用到舊名字的設備會一起改。';
    const order = l.sortable ? `照這裡的順序排${l.list === '機型' ? '（總覽也是）' : ''}，按「排序」調整。` : '';
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
      const mv = e.target.closest('[data-move]');
      if (mv) {
        if (Refs.move(current, mv.dataset.id, +mv.dataset.move)) {
          movedId = mv.dataset.id;
          hooks.onChanged(current.table, null);
        }
        return;
      }
      const item = e.target.closest('[data-id]');
      if (item) Form.open(current.table, item.dataset.id);
    });
  }

  return { init, open, refresh, missingOf };
})();
