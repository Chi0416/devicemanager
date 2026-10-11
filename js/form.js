// 新增／編輯表單：從底部彈出的 sheet，各資料表共用
const Form = (() => {
  const dlg = document.getElementById('form-sheet');
  const titleEl = dlg.querySelector('.sheet-title');
  const closeBtn = dlg.querySelector('[data-act="close"]');
  const saveBtn = dlg.querySelector('[data-act="save"]');
  const delBtn = dlg.querySelector('[data-act="delete"]');
  const bodyEl = dlg.querySelector('.sheet-body');
  const statusEl = dlg.querySelector('.sheet-status');
  const fieldsEl = dlg.querySelector('.fields');

  let ctx = null;     // { tableKey, schema, id, count, fields }
  let inputs = [];
  let chipBoxes = []; // 各欄位的快選按鈕容器（沒有快選的欄位為 null）
  let noteEls = [];   // 各欄位的提醒（schema 的 note；沒有的欄位為 null）
  let initial = [];   // 開啟或連續新增後的欄位值，用來判斷是否有未儲存的內容
  let calcked = [];   // 各欄位上次自動算出來的數字（schema 的 calc）；欄位還是這個數字時才跟著重算
  let hooks = { toast() {}, onChanged() {} };

  // 注音等輸入法選字時按的 Enter 不算
  const isEnter = e => e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;
  const editValue = v => (v == null ? '' : String(v));
  const defaultValue = f => editValue(f.default);

  function init(h) {
    hooks = h;
  }

  // preset：新增時先帶入的值（{ 欄位: 值 }）
  function open(tableKey, id, preset = {}) {
    const schema = SCHEMAS[tableKey];
    const rec = id ? Store.get(tableKey, id) : null;
    if (id && !rec) return;
    ctx = { tableKey, schema, id, count: 0, fields: schema.fields };
    titleEl.textContent = `${id ? '編輯' : '新增'}${schema.formTitle || schema.title}`;
    closeBtn.textContent = '取消';
    delBtn.textContent = schema.remove?.label || '刪除這筆';
    delBtn.hidden = !id;
    statusEl.hidden = true;
    buildFields(rec, preset);
    dlg.showModal();
    bodyEl.scrollTop = 0;
  }

  const fieldIndex = key => ctx.fields.findIndex(f => f.key === key);

  function makeInput(f, last) {
    if (f.multiline) {
      const area = document.createElement('textarea');
      area.rows = 3;
      area.spellcheck = false;
      return area;
    }
    const inp = document.createElement('input');
    inp.type = f.toggle ? 'hidden' // 值放在藏起來的欄位，畫面上是左右切換的按鈕（見 renderToggles）
      : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text';
    if (f.type === 'number') inp.inputMode = 'decimal';
    if (f.caps) inp.setAttribute('autocapitalize', 'characters');
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.setAttribute('enterkeyhint', last ? 'done' : 'next');
    return inp;
  }

  function buildFields(rec, preset = {}) {
    const fields = ctx.fields;
    fieldsEl.innerHTML = '';
    chipBoxes = fields.map(() => null);
    noteEls = fields.map(() => null);
    inputs = fields.map((f, i) => {
      const wrap = document.createElement('div');
      wrap.className = `field${f.full ? ' full' : ''}`;
      const inp = makeInput(f, i === fields.length - 1);
      inp.id = `fld-${f.key}`;
      inp.value = rec ? editValue(rec[f.key]) : f.key in preset ? editValue(preset[f.key]) : defaultValue(f);

      const label = document.createElement('label');
      label.htmlFor = inp.id;
      label.textContent = f.label;
      wrap.append(label, inp);
      if (f.toggle) {
        label.removeAttribute('for');
        const seg = document.createElement('div');
        seg.className = 'seg toggle';
        seg.style.gridTemplateColumns = `repeat(${f.toggle.length}, 1fr)`;
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', f.label);
        seg.innerHTML = f.toggle.map(o => `<button type="button" class="${U.esc(o.tone)}" data-toggle="${i}"` +
          ` data-v="${U.esc(o.value)}" aria-pressed="false">${U.esc(o.label)}</button>`).join('');
        wrap.appendChild(seg);
      } else if (f.suggest) {
        chipBoxes[i] = document.createElement('div');
        chipBoxes[i].className = 'chips';
        wrap.appendChild(chipBoxes[i]);
      }
      if (f.hint) {
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = f.hint;
        wrap.appendChild(hint);
      }
      if (f.note) {
        noteEls[i] = document.createElement('div');
        noteEls[i].className = 'note';
        wrap.appendChild(noteEls[i]);
      }
      const err = document.createElement('div');
      err.className = 'err';
      wrap.appendChild(err);
      fieldsEl.appendChild(wrap);
      return inp;
    });
    // 修改舊資料：存的數字和算出來的一樣，就當作是自動算的，之後會跟著重算；不一樣的是自己填的，不動
    calcked = fields.map(f => {
      const c = f.calc ? f.calc(formValues()) : null;
      return c !== null && U.parseNum(inputs[fieldIndex(f.key)].value) === c ? c : null;
    });
    renderAllChips();
    renderToggles();
    renderNotes();
    initial = inputs.map(inp => inp.value);
  }

  // 左右切換的按鈕（設備的狀態）：值認得是哪一邊就亮哪一邊
  function renderToggles() {
    ctx.fields.forEach((f, i) => {
      if (!f.toggle) return;
      const v = inputs[i].value.trim();
      inputs[i].parentElement.querySelectorAll('[data-toggle]').forEach(b => {
        const o = f.toggle.find(x => x.value === b.dataset.v);
        b.setAttribute('aria-pressed', String(!!v && o.match.test(v)));
      });
    });
  }

  // 第 k 個欄位；左右切換的欄位改成第一個按鈕
  function focusField(k) {
    const toggle = ctx.fields[k]?.toggle && inputs[k].parentElement.querySelector('[data-toggle]');
    (toggle || inputs[k])?.focus();
  }

  // 各欄位目前填的內容（日期轉成 2025-06-05，看不懂時是空字串）
  const formValues = () => Object.fromEntries(ctx.fields.map((f, i) => {
    const raw = inputs[i].value.trim();
    return [f.key, f.type === 'date' ? U.parseDate(raw) || '' : raw];
  }));

  // 自動算的欄位：空白、或還是上次算的數字時，換成這次算的；算不出來時清掉上次算的
  function recalc() {
    ctx.fields.forEach((f, i) => {
      if (!f.calc) return;
      const c = f.calc(formValues());
      const cur = inputs[i].value.trim();
      if (cur && U.parseNum(cur) !== calcked[i]) return;
      inputs[i].value = c === null ? '' : String(c);
      calcked[i] = c;
      if (c !== null) setError(i, '');
    });
  }

  // 欄位下方的提醒，依目前填的內容重新產生；自動算的欄位先算好
  function renderNotes() {
    recalc();
    if (!noteEls.some(Boolean)) return;
    const values = formValues();
    noteEls.forEach((el, i) => { if (el) el.textContent = ctx.fields[i].note(values) || ''; });
  }

  // ---------- 快選按鈕：本表最近輸入過的在前，再補上預設值 ----------
  function suggestions(f) {
    const seen = new Set();
    Store.list(ctx.tableKey).slice().reverse().forEach(r => { if (r[f.key]) seen.add(String(r[f.key])); });
    f.suggest.forEach(v => seen.add(v));
    return [...seen].slice(0, 12);
  }

  const chipHTML = (i, value, on) =>
    `<button type="button" class="chip${on ? ' on' : ''}" data-i="${i}" data-v="${U.esc(value)}">${U.esc(value)}</button>`;

  function renderChips(i) {
    const f = ctx.fields[i];
    const box = chipBoxes[i];
    if (!box) return;
    const all = suggestions(f);
    const q = inputs[i].value.trim();
    // 空白或剛好選中某個值時列出全部，打字時只列出包含該文字的
    const list = !q || all.includes(q) ? all : all.filter(v => v.includes(q));
    box.innerHTML = list.slice(0, 8).map(v => chipHTML(i, v, v === q)).join('');
  }

  function renderAllChips() {
    inputs.forEach((_, i) => renderChips(i));
  }

  // ---------- 讀取欄位：只擋空白（optional 除外）、非數字、日期格式 ----------
  function setError(i, msg) {
    const wrap = inputs[i].parentElement;
    wrap.classList.toggle('invalid', !!msg);
    wrap.querySelector('.err').textContent = msg;
  }

  function collect() {
    const rec = {};
    let firstBad = null;
    ctx.fields.forEach((f, i) => {
      const raw = inputs[i].value.trim();
      let v = raw;
      let msg = '';
      if (!raw) {
        if (f.optional) v = f.type === 'number' || f.type === 'date' ? null : '';
        else msg = f.toggle ? `請選${f.toggle.map(o => o.label).join('、')}其中一個` : '必填';
      } else if (f.type === 'number' && (v = U.parseNum(raw)) === null) msg = '請輸入數字';
      else if (f.type === 'date' && (v = U.parseDate(raw)) === null) msg = '日期格式如 2025/06/05';
      setError(i, msg);
      if (msg && !firstBad) firstBad = f.toggle ? inputs[i].parentElement.querySelector('[data-toggle]') : inputs[i];
      rec[f.key] = v;
    });
    return { rec, firstBad };
  }

  // 儲存後的提示，例如「NB-001 會議室筆電」
  function summary(rec) {
    const { code, title, badge } = ctx.schema.card;
    return [code && rec[code], rec[title], badge && rec[badge]].filter(Boolean).join(' ');
  }

  // schema.unique 的欄位和別筆一樣（編號重複）時，回傳那一筆
  function duplicateOf(rec) {
    const keys = ctx.schema.unique;
    if (!keys) return null;
    const norm = v => U.toHalf(v ?? '').trim().toUpperCase();
    return Store.list(ctx.tableKey).find(r => r.id !== ctx.id && keys.every(k => norm(r[k]) === norm(rec[k]))) || null;
  }

  // ---------- 動作 ----------
  function save() {
    const { rec, firstBad } = collect();
    if (firstBad) {
      firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
      firstBad.focus({ preventScroll: true });
      return;
    }
    // 已經有了（編號重複）：寫在那一格下面，不存
    const dup = duplicateOf(rec);
    if (dup) {
      const i = fieldIndex(ctx.schema.unique[0]);
      setError(i, ctx.schema.uniqueMsg?.(dup) || `${ctx.schema.title}裡已經有一樣的了`);
      inputs[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
      inputs[i].focus({ preventScroll: true });
      return;
    }

    if (ctx.id) {
      Store.update(ctx.tableKey, ctx.id, rec);
      dlg.close();
      hooks.onChanged(ctx.tableKey, { ...rec, id: ctx.id });
      hooks.toast('已儲存');
      return;
    }

    // 新增後表單不關閉，保留 keep 欄位，方便連續輸入好幾筆；只設定一次的存好就關
    const saved = Store.add(ctx.tableKey, rec);
    ctx.count++;
    hooks.onChanged(ctx.tableKey, saved);
    if (ctx.schema.closeOnAdd) {
      dlg.close();
      hooks.toast('已儲存');
      return;
    }
    inputs.forEach((inp, i) => {
      const f = ctx.fields[i];
      if (!f.keep) inp.value = defaultValue(f);
    });
    calcked = ctx.fields.map(() => null);
    renderAllChips();
    renderNotes();
    initial = inputs.map(inp => inp.value);
    renderToggles();
    closeBtn.textContent = '完成';
    statusEl.textContent = `已新增：${summary(saved)}（本次共 ${ctx.count} 筆）`;
    statusEl.hidden = false;
    bodyEl.scrollTop = 0;
    // 手機上收起鍵盤；電腦上直接跳到下一筆的第一個要填的欄位
    if (matchMedia('(pointer: fine)').matches) {
      focusField(Math.max(ctx.fields.findIndex(f => !f.keep), 0));
    } else if (document.activeElement) {
      document.activeElement.blur();
    }
  }

  function remove() {
    const rec = Store.get(ctx.tableKey, ctx.id);
    const what = ctx.schema.remove ? ctx.schema.remove.label : `刪除這筆${ctx.schema.title}`;
    if (!confirm(`確定${what}：${summary(rec || {})}？`)) return;
    Store.remove(ctx.tableKey, ctx.id);
    dlg.close();
    hooks.onChanged(ctx.tableKey, null);
    hooks.toast(ctx.schema.remove?.done || '已刪除');
  }

  function isDirty() {
    return inputs.some((inp, i) => inp.value !== initial[i] && (ctx.id || !ctx.fields[i].keep));
  }

  function requestClose() {
    if (isDirty() && !confirm('有尚未儲存的內容，確定離開？')) return;
    dlg.close();
  }

  // ---------- 事件 ----------
  saveBtn.addEventListener('click', save);
  closeBtn.addEventListener('click', requestClose);
  delBtn.addEventListener('click', remove);
  dlg.addEventListener('cancel', e => { e.preventDefault(); requestClose(); });

  fieldsEl.addEventListener('click', e => {
    // 左右切換：已經是這一邊（例如試算表手打的字）就保留原本的字
    const tog = e.target.closest('[data-toggle]');
    if (tog) {
      const i = +tog.dataset.toggle;
      const o = ctx.fields[i].toggle.find(x => x.value === tog.dataset.v);
      if (!o.match.test(inputs[i].value)) inputs[i].value = o.value;
      setError(i, '');
      renderToggles();
      renderNotes();
      return;
    }
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const i = +chip.dataset.i;
    inputs[i].value = chip.dataset.v;
    setError(i, '');
    renderAllChips();
    renderNotes();
  });

  fieldsEl.addEventListener('input', e => {
    const i = inputs.indexOf(e.target);
    if (i < 0) return;
    setError(i, '');
    renderChips(i);
    renderNotes();
  });
  // 日期有些瀏覽器只送 change
  fieldsEl.addEventListener('change', renderNotes);

  // Enter（手機鍵盤的「下一項」）跳下一格；最後一格（鍵盤上是「完成」）只收起鍵盤，不會儲存
  //   一定要按右上角的「儲存」才存：按「完成」多半只是想收鍵盤，直接存起來會嚇一跳
  //   可以換行的大格子（備註）照常換行
  fieldsEl.addEventListener('keydown', e => {
    const i = inputs.indexOf(e.target);
    if (i < 0 || !isEnter(e) || ctx.fields[i].multiline) return;
    e.preventDefault();
    if (i < inputs.length - 1) focusField(i + 1);
    else e.target.blur();
  });

  return { init, open };
})();
