// 新增／編輯表單：從底部彈出的 sheet，各資料表共用
//   新增時按「儲存」存好就關；按最下面的「儲存，再新增一筆」留在表單接著填（keep 的欄位保留，編號跳下一號）
//   系統產生的欄位（auto，設備的編號）：不能改，新增時寫「存檔後自動產生：26-0003」，存檔時才給
//   從清單選的欄位（ref，見 refs.js）：可以打字搜尋的下拉選單，只能選清單裡的；找不到時點「＋ 新增」馬上加進清單
//     舊資料裡不在清單上的值（試算表手打的），沒改的話照常可以存
const Form = (() => {
  const dlg = document.getElementById('form-sheet');
  const titleEl = dlg.querySelector('.sheet-title');
  const closeBtn = dlg.querySelector('[data-act="close"]');
  const saveBtn = dlg.querySelector('[data-act="save"]');
  const delBtn = dlg.querySelector('[data-act="delete"]');
  const anotherBtn = dlg.querySelector('[data-act="another"]');
  const bodyEl = dlg.querySelector('.sheet-body');
  const statusEl = dlg.querySelector('.sheet-status');
  const fieldsEl = dlg.querySelector('.fields');

  let ctx = null;     // { tableKey, schema, id, count, fields }
  let inputs = [];
  let chipBoxes = []; // 各欄位的快選按鈕容器（沒有快選的欄位為 null）
  let noteEls = [];   // 各欄位的提醒（schema 的 note；沒有的欄位為 null）
  let combos = [];    // 從清單選的欄位：{ list, info, open }（不是的欄位為 null）
  let autos = [];     // 系統產生的欄位：顯示值的那一格（不是的欄位為 null）
  let initial = [];   // 開啟或連續新增後的欄位值，用來判斷是否有未儲存的內容
  let original = [];  // 打開表單時的值（不在清單上的舊值，沒改的話照常可以存）
  let calcked = [];   // 各欄位上次自動算出來的數字（schema 的 calc）；欄位還是這個數字時才跟著重算
  let hooks = { toast() {}, onChanged() {} };

  // 注音等輸入法選字時按的 Enter 不算
  const isEnter = e => e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;
  const editValue = v => (v == null || v === false ? '' : v === true ? 'true' : String(v));
  const defaultValue = f => editValue(typeof f.default === 'function' ? f.default() : f.default);
  // 勾選的欄位是核取方塊（checked），其他是 value
  const getVal = i => (ctx.fields[i].type === 'flag' ? (inputs[i].checked ? 'true' : '') : inputs[i].value);
  function setVal(i, v) {
    if (ctx.fields[i].type === 'flag') inputs[i].checked = v === 'true';
    else inputs[i].value = v;
  }

  function init(h) {
    hooks = h;
  }

  // preset：新增時先帶入的值（{ 欄位: 值 }，例如在位置清單裡新增時，清單先選好位置）
  function open(tableKey, id, preset = {}) {
    const schema = SCHEMAS[tableKey];
    const rec = id ? Store.get(tableKey, id) : null;
    if (id && !rec) return;
    ctx = { tableKey, schema, id, count: 0, fields: schema.fields };
    titleEl.textContent = `${id ? '編輯' : '新增'}${schema.formTitle || schema.title}`;
    closeBtn.textContent = '取消';
    delBtn.textContent = schema.remove?.label || '刪除這筆';
    delBtn.hidden = !id;
    anotherBtn.hidden = !!id;
    statusEl.hidden = true;
    buildFields(rec, preset);
    dlg.showModal();
    bodyEl.scrollTop = 0;
  }

  const fieldIndex = key => ctx.fields.findIndex(f => f.key === key);

  const INPUT_TYPE = { date: 'date', url: 'url', email: 'email', tel: 'tel' };

  function makeInput(f, last) {
    if (f.multiline) {
      const area = document.createElement('textarea');
      area.rows = 3;
      area.spellcheck = false;
      return area;
    }
    const inp = document.createElement('input');
    if (f.type === 'flag') {
      inp.type = 'checkbox';
      inp.setAttribute('role', 'switch');
      return inp;
    }
    // 左右切換、複選：值放在藏起來的欄位，畫面上是按鈕（見 renderToggles）
    inp.type = f.toggle || f.type === 'multi' || f.auto ? 'hidden' : INPUT_TYPE[f.type] || 'text';
    if (f.type === 'number') inp.inputMode = 'decimal';
    if (f.caps) inp.setAttribute('autocapitalize', 'characters');
    if (f.tight) inp.classList.add('tight');
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.setAttribute('enterkeyhint', last ? 'done' : 'next');
    return inp;
  }

  // 勾選：整列是開關，說明寫在開關左邊
  function flagWrap(f, inp) {
    const wrap = document.createElement('div');
    wrap.className = 'field full flag-field';
    const label = document.createElement('label');
    label.className = 'switch-row';
    label.innerHTML = `<span class="switch-text"><b>${U.esc(f.label)}</b>${f.hint ? `<small>${U.esc(f.hint)}</small>` : ''}</span>`;
    label.appendChild(inp);
    const err = document.createElement('div');
    err.className = 'err';
    wrap.append(label, err);
    return wrap;
  }

  function buildFields(rec, preset = {}) {
    const fields = ctx.fields;
    fieldsEl.innerHTML = '';
    chipBoxes = fields.map(() => null);
    noteEls = fields.map(() => null);
    combos = fields.map(() => null);
    autos = fields.map(() => null);
    inputs = fields.map((f, i) => {
      // 一段的小標題（schema 的 section），佔滿整列
      if (f.section) {
        const head = document.createElement('h3');
        head.className = 'form-section';
        head.textContent = f.section;
        fieldsEl.appendChild(head);
      }
      const inp = makeInput(f, i === fields.length - 1);
      inp.id = `fld-${f.key}`;
      if (f.type === 'flag') {
        fieldsEl.appendChild(flagWrap(f, inp));
        return inp;
      }
      const wrap = document.createElement('div');
      wrap.className = `field${f.full ? ' full' : ''}`;
      const label = document.createElement('label');
      label.htmlFor = inp.id;
      label.textContent = f.label;
      wrap.append(label);
      if (f.toggle || f.type === 'multi') {
        label.removeAttribute('for');
        const opts = f.toggle || f.choices.map(c => ({ value: c, label: c, tone: '' }));
        const seg = document.createElement('div');
        seg.className = `seg toggle${f.type === 'multi' ? ' multi' : ''}`;
        seg.style.gridTemplateColumns = `repeat(${opts.length}, 1fr)`;
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', f.label);
        seg.innerHTML = opts.map(o => `<button type="button" class="${U.esc(o.tone || 'plain')}" data-${f.type === 'multi' ? 'multi' : 'toggle'}="${i}"` +
          ` data-v="${U.esc(o.value)}" aria-pressed="false">${U.esc(o.label)}</button>`).join('');
        wrap.append(inp, seg);
      } else if (f.type === 'ref') {
        wrap.appendChild(buildCombo(f, i, inp));
      } else if (f.auto) {
        label.removeAttribute('for');
        autos[i] = document.createElement('div');
        autos[i].className = 'auto-value';
        wrap.append(inp, autos[i]);
      } else {
        wrap.appendChild(inp);
        if (f.suggest) {
          chipBoxes[i] = document.createElement('div');
          chipBoxes[i].className = 'chips';
          wrap.appendChild(chipBoxes[i]);
        }
      }
      if (f.hint) {
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = f.hint;
        wrap.appendChild(hint);
      }
      if (combos[i]) wrap.appendChild(combos[i].info);
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
    fields.forEach((f, i) => setVal(i, rec ? editValue(rec[f.key]) : f.key in preset ? editValue(preset[f.key]) : defaultValue(f)));
    // 修改舊資料：存的數字和算出來的一樣，就當作是自動算的，之後會跟著重算；不一樣的是自己填的，不動
    calcked = fields.map(f => {
      const c = f.calc ? f.calc(formValues()) : null;
      return c !== null && U.parseNum(inputs[fieldIndex(f.key)].value) === c ? c : null;
    });
    renderAllChips();
    renderToggles();
    renderNotes();
    combos.forEach((c, i) => c && renderCombo(i));
    initial = inputs.map((_, i) => getVal(i));
    original = [...initial];
  }

  // 系統產生的欄位：已經有值就顯示；新增（或舊資料沒有值）時寫存檔後會是什麼（購買日期改了跟著變）
  function renderAutos() {
    autos.forEach((el, i) => {
      if (!el) return;
      const v = inputs[i].value.trim();
      el.innerHTML = v ? `<b>${U.esc(v)}</b>`
        : `<b>${U.esc(ctx.fields[i].auto(formValues()))}</b><small>存檔後產生</small>`;
      el.classList.toggle('pending', !v);
    });
  }

  // 左右切換的按鈕（設備的狀態）：值認得是哪一邊就亮哪一邊；複選的按鈕：有勾的都亮
  function renderToggles() {
    ctx.fields.forEach((f, i) => {
      if (f.toggle) {
        const v = inputs[i].value.trim();
        inputs[i].parentElement.querySelectorAll('[data-toggle]').forEach(b => {
          const o = f.toggle.find(x => x.value === b.dataset.v);
          b.setAttribute('aria-pressed', String(!!v && o.match.test(v)));
        });
      } else if (f.type === 'multi') {
        const on = Refs.multi(inputs[i].value);
        inputs[i].parentElement.querySelectorAll('[data-multi]').forEach(b => {
          b.setAttribute('aria-pressed', String(on.includes(b.dataset.v)));
        });
      }
    });
  }

  // ---------- 從清單選的欄位：可以打字搜尋的下拉選單 ----------
  //   點一下列出整份清單（停用的不列），打字時篩選；找不到時最下面是「＋ 新增」
  //   下拉選單蓋在下面的欄位上，表單不會跟著變長變短
  const listName = f => (f.list ? `${f.list}清單` : SCHEMAS[f.ref].title);

  function buildCombo(f, i, inp) {
    const box = document.createElement('div');
    box.className = 'combo';
    inp.setAttribute('role', 'combobox');
    inp.setAttribute('aria-autocomplete', 'list');
    inp.setAttribute('aria-expanded', 'false');
    inp.placeholder = '選擇或搜尋';
    const list = document.createElement('div');
    list.className = 'combo-list';
    list.id = `combo-${f.key}`;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    inp.setAttribute('aria-controls', list.id);
    const info = document.createElement('div');
    info.className = 'note combo-info';
    box.append(inp, list);
    combos[i] = { list, info, open: false, typed: false }; // typed：這次點進來之後打過字

    inp.addEventListener('focus', () => {
      combos[i].open = true;
      combos[i].typed = false;
      renderCombo(i);
      // 已經選好時全選，直接打字就會取代（點下去之後已經開始打字的話不選）
      const before = inp.value;
      if (before) setTimeout(() => { if (inp.value === before) inp.select(); }, 0);
      // 手機上把這一格捲到表單上方，下拉選單才不會被鍵盤擋住
      if (matchMedia('(pointer: coarse)').matches) {
        setTimeout(() => { if (combos[i]?.open) box.parentElement.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 300);
      }
    });
    // 注音選字途中先不搜尋，選好字才搜尋
    const onType = () => {
      combos[i].open = true;
      combos[i].typed = true;
      setError(i, '');
      renderCombo(i);
    };
    inp.addEventListener('input', e => { if (!e.isComposing) onType(); });
    inp.addEventListener('compositionend', onType);
    // 離開這格時收起來；打的字和清單裡的一樣（大小寫、全形半形不同）就換成清單裡的寫法
    inp.addEventListener('blur', () => setTimeout(() => {
      if (!combos[i] || document.activeElement === inp) return;
      combos[i].open = false;
      const hit = Refs.find(f, inp.value);
      if (hit) inp.value = Refs.nameOf(f.ref, hit);
      renderCombo(i);
    }, 150));
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape' && combos[i].open) {
        // Esc 收起下拉選單（不要連表單一起關掉）
        e.preventDefault();
        e.stopPropagation();
        combos[i].open = false;
        renderCombo(i);
        return;
      }
      if (!isEnter(e)) return;
      // Enter：打的字剛好是清單裡的就選那個，不然選第一個符合的；都沒有就留著（要點「＋ 新增」才會加進清單）
      e.preventDefault();
      const opt = list.querySelector('.combo-opt.on') || list.querySelector('[data-pick]');
      if (opt) pick(i, opt.dataset.pick);
      focusField(i + 1);
    });
    // 點選項時不要先讓輸入框失去焦點（不然選單會先收起來）
    list.addEventListener('mousedown', e => e.preventDefault());
    list.addEventListener('click', e => {
      const opt = e.target.closest('[data-pick]');
      if (opt) {
        pick(i, opt.dataset.pick);
        inp.blur(); // 選好了，手機上收起鍵盤
        return;
      }
      if (e.target.closest('[data-add]')) {
        const rec = Refs.quickAdd(f, inp.value.trim());
        pick(i, Refs.nameOf(f.ref, rec));
        inp.blur();
        hooks.onChanged(f.ref, rec);
        hooks.toast(`已加入${listName(f)}：${Refs.nameOf(f.ref, rec)}`);
      }
    });
    return box;
  }

  function pick(i, name) {
    inputs[i].value = name;
    combos[i].open = false;
    combos[i].typed = false;
    setError(i, '');
    renderCombo(i);
  }

  function renderCombo(i) {
    const f = ctx.fields[i];
    const c = combos[i];
    const inp = inputs[i];
    const q = inp.value.trim();
    const all = Refs.items(f);
    const hit = q ? Refs.find(f, q) : null;
    const n = Refs.norm(q);
    // 空白、或已經選好還沒打字時列出全部；打字時列出名字或小字裡有這些字的
    const shown = !q || (hit && !c.typed) ? all : all.filter(r =>
      Refs.norm(Refs.nameOf(f.ref, r)).includes(n) || Refs.norm(Refs.sub(f.ref, r)).includes(n));
    const name = r => Refs.nameOf(f.ref, r);
    c.list.innerHTML = shown.slice(0, 60).map(r => {
      const on = hit && r.id === hit.id;
      const sub = Refs.sub(f.ref, r);
      const tone = Refs.tone(f.ref, r);
      return `<button type="button" class="combo-opt${on ? ' on' : ''}" role="option" aria-selected="${!!on}" data-pick="${U.esc(name(r))}">` +
        `${tone ? `<i class="dot ${U.esc(tone)}" aria-hidden="true"></i>` : ''}<span>${U.esc(name(r))}</span>${sub ? `<small>${U.esc(sub)}</small>` : ''}</button>`;
    }).join('') +
      (q && !hit ? `<button type="button" class="combo-add" data-add>＋ 新增${U.esc(Refs.scopeName(f))}「${U.esc(q)}」</button>` : '') +
      (!q && !all.length ? `<p class="combo-empty">${U.esc(listName(f))}還是空的，打字後點「＋ 新增」</p>` : '');
    c.list.hidden = !c.open || !c.list.innerHTML;
    inp.setAttribute('aria-expanded', String(!c.list.hidden));
    // 不在清單上的值（舊資料、試算表手打的）：寫在欄位下面；選單打開時不用寫
    const outside = q && !hit && !c.open;
    c.info.textContent = !outside ? ''
      : q === original[i] ? `「${q}」不在${listName(f)}裡，可以照常儲存；點欄位可以「＋ 新增」`
      : `「${q}」不在${listName(f)}裡，請從選單選，或點欄位後「＋ 新增」`;
  }

  // 第 k 個欄位；左右切換、複選的欄位改成第一個按鈕
  function focusField(k) {
    const f = ctx.fields[k];
    const btn = (f?.toggle || f?.type === 'multi') && inputs[k].parentElement.querySelector('[data-toggle], [data-multi]');
    (btn || inputs[k])?.focus();
  }

  // 各欄位目前填的內容（日期轉成 2025-06-05，看不懂時是空字串）
  const formValues = () => Object.fromEntries(ctx.fields.map((f, i) => {
    const raw = String(getVal(i)).trim();
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
    renderAutos();
    if (!noteEls.some(Boolean)) return;
    const values = formValues();
    noteEls.forEach((el, i) => {
      if (!el) return;
      const n = ctx.fields[i].note(values) || '';
      el.textContent = typeof n === 'string' ? n : n.text;
      el.classList.toggle('warn', !!n.warn);
    });
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

  // ---------- 讀取欄位：擋空白（optional 除外）、非數字、日期格式、不在清單上的值 ----------
  function setError(i, msg) {
    const wrap = inputs[i].closest('.field');
    wrap.classList.toggle('invalid', !!msg);
    wrap.querySelector('.err').textContent = msg;
  }

  function collect() {
    const rec = {};
    let firstBad = null;
    ctx.fields.forEach((f, i) => {
      const raw = String(getVal(i)).trim();
      let v = raw;
      let msg = '';
      if (f.auto) {
        rec[f.key] = raw; // 新的值等其他欄位讀好之後才算（年份照購買日期）
        return;
      }
      if (f.type === 'flag') {
        v = raw === 'true';
      } else if (!raw) {
        if (f.optional) v = f.type === 'number' || f.type === 'date' ? null : '';
        else msg = f.toggle ? `請選${f.toggle.map(o => o.label).join('、')}其中一個`
          : f.type === 'multi' ? '至少選一個' : '必填';
      } else if (f.type === 'number' && (v = U.parseNum(raw)) === null) msg = '請輸入數字';
      else if (f.type === 'date' && (v = U.parseDate(raw)) === null) msg = '日期格式如 2025/06/05';
      else if (f.type === 'ref') {
        const hit = Refs.find(f, raw);
        if (hit) v = Refs.nameOf(f.ref, hit);
        else if (raw !== original[i]) msg = `${listName(f)}裡沒有「${raw}」，請從選單選，或點「＋ 新增」`;
      } else if (f.clean) v = f.clean(raw);
      else if (f.upper) v = U.toHalf(raw).toUpperCase();
      setError(i, msg);
      if (msg && !firstBad) {
        firstBad = f.toggle || f.type === 'multi' ? inputs[i].parentElement.querySelector('[data-toggle], [data-multi]') : inputs[i];
      }
      rec[f.key] = v;
    });
    ctx.fields.forEach(f => { if (f.auto && !rec[f.key]) rec[f.key] = f.auto(rec); });
    return { rec, firstBad };
  }

  // 儲存後的提示，例如「NB-001 會議室筆電 使用中」「位置 3F 會議室」
  function summary(rec) {
    const card = ctx.schema.card;
    const tg = ctx.schema.target;
    const parts = card ? [card.code && rec[card.code], rec[card.title], card.badge && rec[card.badge]]
      : [tg?.group && rec[tg.group], tg && rec[tg.name]];
    return parts.filter(Boolean).join(' ');
  }

  // schema.unique 的欄位組合和別筆一樣時，回傳 { dup: 那一筆, keys }；全部空白的組合不算
  function duplicateOf(rec) {
    const norm = v => U.toHalf(v ?? '').trim().toUpperCase();
    for (const keys of ctx.schema.unique || []) {
      if (keys.every(k => !norm(rec[k]))) continue;
      const dup = Store.list(ctx.tableKey).find(r => r.id !== ctx.id && keys.every(k => norm(r[k]) === norm(rec[k])));
      if (dup) return { dup, keys };
    }
    return null;
  }

  // ---------- 動作 ----------
  // again：新增後留在表單，接著填下一筆
  function save(again = false) {
    combos.forEach((c, i) => { if (c?.open) { c.open = false; renderCombo(i); } });
    const { rec, firstBad } = collect();
    if (firstBad) {
      firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
      firstBad.focus({ preventScroll: true });
      return;
    }
    // 已經有了（編號、名稱重複）：寫在那一格下面，不存
    const found = duplicateOf(rec);
    if (found) {
      const i = fieldIndex(found.keys[found.keys.length - 1]);
      setError(i, ctx.schema.uniqueMsg?.(found.dup, found.keys) || `${ctx.schema.title}裡已經有一樣的了`);
      inputs[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
      inputs[i].focus({ preventScroll: true });
      return;
    }

    if (ctx.id) {
      const before = { ...Store.get(ctx.tableKey, ctx.id) };
      Store.update(ctx.tableKey, ctx.id, rec);
      // 清單改了名字：用到舊名字的設備一起改
      const renamed = Refs.isTarget(ctx.tableKey) ? Refs.renameRefs(ctx.tableKey, before, Store.get(ctx.tableKey, ctx.id)) : [];
      dlg.close();
      hooks.onChanged(ctx.tableKey, { ...rec, id: ctx.id });
      hooks.toast(renamed.length ? `已儲存，用到舊名字的 ${renamed.length} 筆資料一起改了` : '已儲存');
      return;
    }

    const saved = Store.add(ctx.tableKey, rec);
    ctx.count++;
    hooks.onChanged(ctx.tableKey, saved);
    if (!again) {
      dlg.close();
      hooks.toast(ctx.count > 1 ? `已新增 ${ctx.count} 筆` : `已新增：${summary(saved)}`);
      return;
    }
    // 連續新增：保留 keep 欄位，其他換回預設值（編號跳下一號）
    ctx.fields.forEach((f, i) => { if (!f.keep) setVal(i, defaultValue(f)); });
    calcked = ctx.fields.map(() => null);
    renderAllChips();
    renderNotes();
    renderToggles();
    combos.forEach((c, i) => c && renderCombo(i));
    initial = inputs.map((_, i) => getVal(i));
    original = [...initial];
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
    // 清單裡有人在用的不能刪（見 refs.js）
    const block = Refs.isTarget(ctx.tableKey) ? Refs.removeBlock(ctx.tableKey, rec) : '';
    if (block) {
      alert(block);
      return;
    }
    const what = ctx.schema.remove ? ctx.schema.remove.label : `刪除這筆${ctx.schema.title}`;
    if (!confirm(`確定${what}：${summary(rec || {})}？`)) return;
    Store.remove(ctx.tableKey, ctx.id);
    dlg.close();
    hooks.onChanged(ctx.tableKey, null);
    hooks.toast(ctx.schema.remove?.done || '已刪除');
  }

  function isDirty() {
    return inputs.some((_, i) => getVal(i) !== initial[i] && (ctx.id || !ctx.fields[i].keep));
  }

  function requestClose() {
    if (isDirty() && !confirm('有尚未儲存的內容，確定離開？')) return;
    dlg.close();
  }

  // ---------- 事件 ----------
  saveBtn.addEventListener('click', () => save());
  anotherBtn.addEventListener('click', () => save(true));
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
    // 複選：點一下勾、再點一下取消；存的順序照選項的順序
    const mul = e.target.closest('[data-multi]');
    if (mul) {
      const i = +mul.dataset.multi;
      const on = new Set(Refs.multi(inputs[i].value));
      if (!on.delete(mul.dataset.v)) on.add(mul.dataset.v);
      inputs[i].value = ctx.fields[i].choices.filter(c => on.has(c)).join('、');
      setError(i, '');
      renderToggles();
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
    if (i < 0 || combos[i]) return;
    setError(i, '');
    renderChips(i);
    renderNotes();
  });
  // 日期有些瀏覽器只送 change
  fieldsEl.addEventListener('change', renderNotes);

  // Enter（手機鍵盤的「下一項」）跳下一格；最後一格（鍵盤上是「完成」）只收起鍵盤，不會儲存
  //   一定要按右上角的「儲存」才存：按「完成」多半只是想收鍵盤，直接存起來會嚇一跳
  //   可以換行的大格子（備註）照常換行；從清單選的欄位自己處理 Enter（見 buildCombo）
  fieldsEl.addEventListener('keydown', e => {
    const i = inputs.indexOf(e.target);
    if (i < 0 || !isEnter(e) || ctx.fields[i].multiline || combos[i] || ctx.fields[i].type === 'flag') return;
    e.preventDefault();
    if (i < inputs.length - 1) focusField(i + 1);
    else e.target.blur();
  });

  return { init, open };
})();
