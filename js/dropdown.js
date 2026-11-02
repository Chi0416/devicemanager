// 下拉選單：全站的 <select> 和選人員的下拉選單同一個樣子（清單共用 form.js 的 combo 的樣子），不能打字，點了直接選
//   <select> 留著、不顯示：值、選項、change 事件都照舊，用的地方把它當一般的 select；寬度也由它撐開（照最長的選項，選了別項不會忽寬忽窄）
//   畫面上是一顆按鈕和按了才出現的清單：點旁邊、按 Esc 收起來；上下鍵移動，Enter 選
const Dropdown = (() => {
  // 包好之後回傳外面那一格；sel 已經放在畫面上的話原地換掉
  function attach(sel) {
    const box = document.createElement('div');
    box.className = 'combo dropdown';
    sel.replaceWith(box);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dropdown-btn';
    btn.setAttribute('role', 'combobox');
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    // 表單的標籤（for）、篩選列的說明（aria-label）改到按鈕上
    if (sel.id) {
      btn.id = sel.id;
      sel.removeAttribute('id');
    }
    if (sel.hasAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
    const list = document.createElement('div');
    list.className = 'combo-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    box.append(sel, btn, list);

    const show = () => {
      btn.textContent = sel.selectedOptions[0]?.textContent ?? '';
      btn.classList.toggle('empty', !sel.value);
    };
    // 程式改了值：按鈕上的字跟著換；要放游標時放在按鈕上（select 不顯示，放不上去）
    const { get, set } = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(sel, 'value', { get: () => get.call(sel), set: v => { set.call(sel, v); show(); } });
    sel.focus = options => btn.focus(options);

    const optionHTML = o => `<button type="button" class="combo-opt${o.selected ? ' on' : ''}" role="option" aria-selected="${o.selected}" data-v="${U.esc(o.value)}">${U.esc(o.textContent)}</button>`;
    const groupHTML = g => `<div class="dropdown-head">${U.esc(g.label)}</div>${[...g.children].map(optionHTML).join('')}`;

    const outside = e => { if (!box.contains(e.target)) close(); };
    function close(refocus) {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', outside, true);
      if (refocus) btn.focus({ preventScroll: true });
    }
    function open() {
      list.innerHTML = [...sel.children].map(c => (c.tagName === 'OPTGROUP' ? groupHTML(c) : optionHTML(c))).join('');
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outside, true);
      // 選中的那一項放在清單中間；表單最下面的欄位，整張清單捲進畫面
      const on = list.querySelector('.on') || list.querySelector('.combo-opt');
      list.scrollTop = on.offsetTop - (list.clientHeight - on.offsetHeight) / 2;
      list.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      on.focus({ preventScroll: true });
    }

    btn.addEventListener('click', () => (list.hidden ? open() : close(true)));
    btn.addEventListener('keydown', e => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      if (list.hidden) open();
    });
    list.addEventListener('click', e => {
      const opt = e.target.closest('[data-v]');
      if (!opt) return;
      const changed = opt.dataset.v !== sel.value;
      sel.value = opt.dataset.v;
      close(true);
      if (changed) ['input', 'change'].forEach(t => sel.dispatchEvent(new Event(t, { bubbles: true })));
    });
    list.addEventListener('keydown', e => {
      const opts = [...list.querySelectorAll('.combo-opt')];
      const at = opts.indexOf(document.activeElement);
      const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: opts.length - 1 }[e.key];
      if (to !== undefined) {
        e.preventDefault();
        opts[to]?.focus();
      } else if (e.key === 'Escape') {
        // Esc 收起下拉選單（不要連表單一起關掉）
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'Tab') close(true);
    });

    show();
    return box;
  }

  return { attach };
})();
