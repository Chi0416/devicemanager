// 選好幾個的小視窗（合約的位置）：照股票記錄簿「新增觀察的股票」的樣子
//   上面打字搜尋，點一項加進來（已經選的不列；找不到時「＋ 新增」馬上加進清單）
//   下面「目前的位置（3 個）」列出選了的，每一個可以移除：按第一次變成「確定移除」，4 秒內再按一次才拿掉（誤觸一次不會怎樣）
//   按「完成」才改到表單，「取消」全部不算（表單還是要按「儲存」才存，見 form.js）
//   存的順序照清單的順序：拿掉再加回來還是一樣，不會被當成改過（合約修改紀錄）
const Picker = (() => {
  const dlg = document.getElementById('pick-sheet');
  const titleEl = dlg.querySelector('.sheet-title');
  const labelEl = dlg.querySelector('.pick-label');
  const searchEl = dlg.querySelector('.pick-search');
  const listEl = dlg.querySelector('.combo-list');
  const headEl = dlg.querySelector('.pick-head');
  const rowsEl = dlg.querySelector('.pick-rows');
  const REMOVE_MS = 4000;
  // 選單剛打開的這段時間點到的不算：點搜尋框的那一下，手機上可能落在剛出現的第一個選項上（誤加一個）
  const SETTLE_MS = 400;
  let openedAt = 0;
  let field = null;   // 哪一個欄位（schema 的欄位）
  let vals = [];      // 小視窗裡目前選的（存的值，位置是編號）
  let done = null;    // 按「完成」時把選好的交回表單
  let removing = '';  // 按了一次「移除」的那一個
  let removeTimer = null;
  let hooks = { toast() {}, onChanged() {} };

  const name = r => Refs.nameOf(field.ref, r);
  const label = r => Refs.labelOf(field.ref, r);
  const also = r => (Refs.targetOf(field.ref).also || (() => ''))(r) || '';
  const what = () => field.label;

  // 照清單的順序排；不在清單裡的（找不到的編號）排最後
  function sorted(list) {
    const order = Refs.items(field, { all: true }).map(r => Refs.norm(name(r)));
    const rank = x => (order.includes(Refs.norm(x)) ? order.indexOf(Refs.norm(x)) : Infinity);
    return [...list].sort((a, b) => rank(a) - rank(b));
  }

  // ---------- 下面：目前選的 ----------
  function renderRows() {
    headEl.textContent = `目前的${what()}（${vals.length} 個）`;
    rowsEl.innerHTML = vals.length ? vals.map(v => {
      const r = Refs.find(field, v);
      const sub = r ? Refs.sub(field.ref, r) : '找不到這個位置';
      const sure = removing === v;
      return `
        <li>
          <span class="member-info"><b>${U.esc(r ? label(r) : v)}</b>${sub ? `<small>${U.esc(sub)}</small>` : ''}</span>
          <button type="button" class="text-btn danger${sure ? ' sure' : ''}" data-remove="${U.esc(v)}">${sure ? '確定移除' : '移除'}</button>
        </li>`;
    }).join('') : `<li class="pick-empty">還沒有選${U.esc(what())}，在上面打名稱加進來</li>`;
  }

  // ---------- 上面：搜尋、加進來 ----------
  function renderList(open = true) {
    const q = searchEl.value.trim();
    const n = Refs.norm(q);
    const chosen = new Set(vals.map(Refs.norm));
    const all = Refs.items(field).filter(r => !chosen.has(Refs.norm(name(r))));
    const listed = !q ? all : all.filter(r => [label(r), name(r), Refs.sub(field.ref, r), also(r)].some(x => Refs.norm(x).includes(n)));
    const exact = q && Refs.items(field, { all: true }).some(r => [label(r), name(r)].some(x => Refs.norm(x) === n));
    const canAdd = !Refs.targetOf(field.ref).noAdd;
    listEl.innerHTML = listed.slice(0, 60).map(r => {
      const sub = Refs.sub(field.ref, r);
      return `<button type="button" class="combo-opt" role="option" data-pick="${U.esc(name(r))}"><span>${U.esc(label(r))}</span>${sub ? `<small>${U.esc(sub)}</small>` : ''}</button>`;
    }).join('') +
      (q && !exact && canAdd ? `<button type="button" class="combo-add" data-add>＋ 新增${U.esc(what())}「${U.esc(q)}」</button>` : '') +
      (q && !listed.length && (exact || !canAdd) ? `<p class="combo-empty">找不到「${U.esc(q)}」，或已經選了</p>` : '');
    const was = listEl.hidden;
    listEl.hidden = !open || !listEl.innerHTML;
    if (was && !listEl.hidden) openedAt = Date.now();
    searchEl.setAttribute('aria-expanded', String(!listEl.hidden));
  }

  function add(v) {
    if (!vals.some(x => Refs.norm(x) === Refs.norm(v))) vals = sorted([...vals, v]);
    searchEl.value = '';
    renderRows();
    renderList(false);
    searchEl.blur(); // 手機上收起鍵盤，看得到加進來的那一個
  }

  function resetRemove() {
    removing = '';
    clearTimeout(removeTimer);
  }

  // ---------- 打開、關掉 ----------
  // f：欄位；current：現在選的；onDone(選好的)：按「完成」時；title：標題（合約的位置）
  function open(f, current, onDone, title = f.label) {
    field = f;
    vals = sorted(current);
    done = onDone;
    resetRemove();
    titleEl.textContent = title;
    labelEl.textContent = `加入${f.label}`;
    searchEl.value = '';
    searchEl.placeholder = '打名稱搜尋';
    renderRows();
    renderList(false);
    dlg.showModal();
  }

  function init(h) {
    hooks = { ...hooks, ...h };
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-act="done"]').addEventListener('click', () => {
      dlg.close();
      done?.(vals);
    });
    dlg.addEventListener('close', resetRemove);
    searchEl.addEventListener('focus', () => renderList());
    searchEl.addEventListener('input', e => { if (!e.isComposing) renderList(); });
    searchEl.addEventListener('compositionend', () => renderList());
    searchEl.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== searchEl) renderList(false); }, 150));
    // Enter：加第一個符合的
    searchEl.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      const first = listEl.querySelector('[data-pick]');
      if (first && searchEl.value.trim()) add(first.dataset.pick);
    });
    // 點選項時不要先讓輸入框失去焦點（不然選單會先收起來）
    listEl.addEventListener('mousedown', e => e.preventDefault());
    listEl.addEventListener('click', e => {
      if (Date.now() - openedAt < SETTLE_MS) return;
      const opt = e.target.closest('[data-pick]');
      if (opt) {
        add(opt.dataset.pick);
        return;
      }
      if (e.target.closest('[data-add]')) {
        const rec = Refs.quickAdd(field, searchEl.value.trim());
        add(name(rec));
        hooks.onChanged(field.ref, rec);
        hooks.toast(`已加入${what()}：${label(rec)}`);
      }
    });
    // 移除：按兩次
    rowsEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      const v = btn.dataset.remove;
      if (removing !== v) {
        removing = v;
        clearTimeout(removeTimer);
        removeTimer = setTimeout(() => { resetRemove(); renderRows(); }, REMOVE_MS);
      } else {
        resetRemove();
        vals = vals.filter(x => x !== v);
      }
      renderRows();
    });
  }

  return { init, open };
})();
