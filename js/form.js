// 新增／編輯表單：從底部彈出的 sheet，各資料表共用
//   新增時按「儲存」存好就關；按最下面的「儲存，再新增一筆」留在表單接著填（keep 的欄位保留，編號跳下一號）
//     schema 的 once（異動、抄表、翻新、合約）沒有這個按鈕：一次一筆
//   系統產生的欄位（auto，設備的編號）：不能改，新增時寫「存檔後自動產生：26-0003」，存檔時才給
//   從清單選的欄位（ref，見 refs.js）：可以打字搜尋的下拉選單，只能選清單裡的；找不到時點「＋ 新增」馬上加進清單
//     舊資料裡不在清單上的值（試算表手打的），沒改的話照常可以存；紀錄的設備欄只能選已經有的設備
//     顯示的字和存的值不一樣的（target 有 label：紀錄的設備欄顯示位置、存設備編號；位置顯示名稱、存位置編號）：打位置找得到，存的值放在藏起來的欄位
//     可以選好幾個的（many，合約的位置）：表單上列出全部，點了另外開一個小視窗改（見下面的 Picker）
//   藏起來的欄位（hidden，異動的原位置）：不顯示，由 calc 填好
//   不能改的舊值（lock，有異動的設備的位置）：只顯示，下面寫原因
//   以這筆為底新增（schema 的 copy，合約的「重新簽約」）：編輯時才有；改過還沒存時不能按
//   同一個位置的另一種按鈕（schema 的 action，人員的「複製邀請連結」）：編輯時、show(這一筆) 為 true 才有，按了交給 app.js（init 的 action）
//   業務員模式（見 sync.js）：只能新增他有權限的（抄表、保養），不能修改、刪除；清單的下拉選單不能「＋ 新增」
//     打開一筆抄表、保養（view）：每一欄都只顯示，只有「業務員回報」可以寫
//   修改紀錄（schema 的 history，合約）：編輯時列在下面
//   刪除：按第一次在按鈕下面寫會刪掉什麼，再按一次才刪；不用瀏覽器的確認視窗（有些環境不會跳出來，按了就像沒反應）
//     設備有紀錄的：寫出有幾筆、建議改成報廢，真的要刪就連同紀錄一起刪（schema 的 target.cascade）
const Form = (() => {
  const dlg = document.getElementById('form-sheet');
  const titleEl = dlg.querySelector('.sheet-title');
  const closeBtn = dlg.querySelector('[data-act="close"]');
  const saveBtn = dlg.querySelector('[data-act="save"]');
  const delBtn = dlg.querySelector('[data-act="delete"]');
  const delNote = dlg.querySelector('.delete-note');
  const anotherBtn = dlg.querySelector('[data-act="another"]');
  const copyBtn = dlg.querySelector('[data-act="copy"]');
  const copyNote = dlg.querySelector('.copy-note');
  const historyEl = dlg.querySelector('.form-history');
  const bodyEl = dlg.querySelector('.sheet-body');
  const statusEl = dlg.querySelector('.sheet-status');
  const fieldsEl = dlg.querySelector('.fields');

  let ctx = null;     // { tableKey, schema, id, count, fields, preset }
  let inputs = [];
  let locked = [];    // 不能改的欄位（schema 的 lock）：true 時只顯示
  let chipBoxes = []; // 各欄位的快選按鈕容器（沒有快選的欄位為 null）
  let noteEls = [];   // 各欄位的提醒（schema 的 note；沒有的欄位為 null）
  let combos = [];    // 從清單選的欄位：{ list, info, open }（不是的欄位為 null）
  let manys = [];     // 可以選好幾個的欄位：表單上列出全部的那一塊（不是的欄位為 null）
  let autos = [];     // 系統產生的欄位：顯示值的那一格（不是的欄位為 null）
  let heads = [];     // 小標題（schema 的 section）：{ el, from, to }，從第 from 個欄位到 to 之前是這一段
  let initial = [];   // 開啟或連續新增後的欄位值，用來判斷是否有未儲存的內容
  let original = [];  // 打開表單時的值（不在清單上的舊值，沒改的話照常可以存）
  let calcked = [];   // 各欄位上次自動算出來的值（schema 的 calc）；算出來的值變了、欄位還是上次的值時才跟著換
  let hooks = { toast() {}, onChanged() {}, action() {} };
  let closeLabel = '取消'; // 左上角按鈕平常的字（連續新增後是「完成」）
  let leaveUntil = 0;      // 有還沒儲存的內容時按了一次「取消」：這個時間之前再按一次就關掉
  let leaveTimer = null;
  let deleteUntil = 0;     // 按了一次「刪除這筆」：這個時間之前再按一次才刪
  let deleteTimer = null;

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
  //   在設備詳情裡新增紀錄時，設備先帶好（「儲存，再新增一筆」也照樣帶）
  // message：打開時寫在最上面的一行（安裝、撤機後接著抄表時說要填什麼）
  function open(tableKey, id, preset = {}, { message = '' } = {}) {
    const sales = typeof Sync !== 'undefined' && Sync.isSales();
    if (sales && (id ? !Sync.salesSee(tableKey) : !Sync.salesCan(tableKey))) return;
    const schema = SCHEMAS[tableKey];
    const rec = id ? Store.get(tableKey, id) : null;
    if (id && !rec) return;
    // 表單上的順序（schema 的 formOrder 寫的先排，異動的類型在最上面）；試算表照 fields 的順序
    const first = schema.formOrder || [];
    const fields = [...first.map(k => schema.fields.find(f => f.key === k)), ...schema.fields.filter(f => !first.includes(f.key))];
    ctx = { tableKey, schema, id, count: 0, fields, preset, view: sales && !!id };
    // 標題：選項寫它屬於哪一份清單（「編輯保養項目」），其他寫表的名稱
    const name = typeof schema.formTitle === 'function' ? schema.formTitle(rec || preset) : schema.formTitle || schema.title;
    ctx.name = name;
    titleEl.textContent = ctx.view ? `${name}・回報問題` : `${id ? '編輯' : '新增'}${name}`;
    setCloseLabel('取消');
    resetDelete();
    delBtn.hidden = !id || ctx.view;
    anotherBtn.hidden = !!id || !!schema.once;
    const extra = schema.copy || schema.action;
    copyBtn.hidden = copyNote.hidden = !(id && (schema.copy || schema.action?.show(rec)));
    if (extra) {
      copyBtn.textContent = extra.label;
      copyNote.textContent = (typeof extra.note === 'function' ? extra.note(rec || {}) : extra.note) || '';
    }
    renderHistory(rec);
    statusEl.textContent = message;
    statusEl.hidden = !message;
    buildFields(rec, preset);
    dlg.style.height = '';
    dlg.showModal();
    bodyEl.scrollTop = 0;
    // 打開後固定高度：表單貼著畫面底部、依內容長高，之後出現錯誤或提醒時整張會往上跳；固定後多出來的在裡面捲動
    dlg.style.height = `${dlg.getBoundingClientRect().height}px`;
  }

  const fieldIndex = key => ctx.fields.findIndex(f => f.key === key);

  // 修改紀錄（合約）：舊到新，日期在前
  function renderHistory(rec) {
    const lines = rec && ctx.schema.history ? ctx.schema.history(rec) : [];
    historyEl.hidden = !lines.length;
    historyEl.innerHTML = lines.length ? `<h3 class="form-section">修改紀錄</h3><ul>${lines.map(l =>
      `<li><small>${U.esc(U.fmtDate(l.date))}</small><span>${U.esc(l.text)}</span></li>`).join('')}</ul>` : '';
  }

  const INPUT_TYPE = { date: 'date', month: 'month', url: 'url', email: 'email', tel: 'tel' };

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
    if (f.type === 'month') inp.placeholder = '2026/09'; // 不支援月份選單的瀏覽器（電腦版 Safari、Firefox）要自己打
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
    manys = fields.map(() => null);
    autos = fields.map(() => null);
    locked = fields.map(f => !!(rec && ((ctx.view && f.key !== 'report') || (f.lock && f.lock(rec)))));
    heads = [];
    inputs = fields.map((f, i) => {
      // 一段的小標題（schema 的 section），佔滿整列
      if (f.section) {
        const head = document.createElement('h3');
        head.className = 'form-section';
        head.textContent = f.section;
        fieldsEl.appendChild(head);
        heads.push({ el: head, from: i });
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
      label.textContent = f.formLabel || f.label;
      wrap.append(label);
      if (f.hidden) {
        wrap.hidden = true;
        inp.type = 'hidden';
        wrap.appendChild(inp);
      } else if (locked[i]) {
        // 不能改：和系統產生的欄位一樣只顯示（多行的備註是 textarea，藏起來）
        label.removeAttribute('for');
        if (inp.tagName === 'TEXTAREA') inp.hidden = true;
        else inp.type = 'hidden';
        autos[i] = document.createElement('div');
        autos[i].className = 'auto-value';
        wrap.append(inp, autos[i]);
      } else if (f.toggle || f.type === 'multi') {
        label.removeAttribute('for');
        const opts = f.toggle || f.choices.map(c => ({ value: c, label: c, tone: '' }));
        const seg = document.createElement('div');
        seg.className = `seg toggle${f.type === 'multi' ? ' multi' : ''}`;
        // 選項多的排成兩排，一排 3 個（選項的清單、狀態的顏色）；5 個都是兩個字以內的放一排（抄表週期）
        const rows = opts.length > 5 || (opts.length > 4 && opts.some(o => String(o.label).length > 2));
        seg.style.gridTemplateColumns = `repeat(${rows ? 3 : opts.length}, 1fr)`;
        if (rows) seg.classList.add('rows');
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', f.label);
        seg.innerHTML = opts.map(o => `<button type="button" class="${U.esc(o.tone || 'plain')}" data-${f.type === 'multi' ? 'multi' : 'toggle'}="${i}"` +
          ` data-v="${U.esc(o.value)}" aria-pressed="false">${U.esc(o.label)}</button>`).join('');
        wrap.append(inp, seg);
      } else if (f.type === 'ref' && f.many) {
        wrap.appendChild(buildMany(f, i, inp));
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
      const hintText = locked[i] ? (f.lock ? f.lock(rec) : '') : f.hint;
      if (hintText) {
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = hintText;
        wrap.appendChild(hint);
      }
      if (combos[i]) wrap.appendChild(combos[i].info);
      if (f.note) {
        // 提醒的位置先留好（noteLines 行），出現、變長時下面的欄位不會被推動
        noteEls[i] = document.createElement('div');
        noteEls[i].className = `note lines-${f.noteLines || 1}`;
        wrap.appendChild(noteEls[i]);
      }
      const err = document.createElement('div');
      err.className = 'err';
      wrap.appendChild(err);
      fieldsEl.appendChild(wrap);
      return inp;
    });
    heads.forEach((h, k) => { h.to = heads[k + 1]?.from ?? fields.length; });
    fields.forEach((f, i) => setVal(i, rec ? editValue(rec[f.key]) : f.key in preset ? editValue(preset[f.key]) : defaultValue(f)));
    syncTexts();
    // 修改舊資料：先記下現在算出來的值，之後依的欄位改了才跟著換（打開舊資料時不會被填上）；新增時馬上填
    calcked = fields.map(f => (rec && f.calc ? calcText(f) : null));
    renderAllChips();
    renderToggles();
    renderNotes();
    combos.forEach((c, i) => c && renderCombo(i));
    initial = inputs.map((_, i) => getVal(i));
    original = [...initial];
    renderCopyNote();
  }

  // 系統產生的欄位：已經有值就顯示；新增（或舊資料沒有值）時寫存檔後會是什麼（購買日期改了跟著變）
  //   不能改的欄位（lock）：只顯示現在的值
  //   顯示的字：位置寫名稱（不是編號）；有 shown 的照它寫（異動的原位置寫當時的位置，不是機器現在的）
  function renderAutos() {
    autos.forEach((el, i) => {
      if (!el) return;
      const f = ctx.fields[i];
      const v = inputs[i].value.trim();
      // 數字欄的值是打的字（36400），換成數字才排得出千分位
      const shown = locked[i] && f.shown ? f.shown(formValues()) : v && U.display(f, f.type === 'number' ? U.parseNum(v) : v);
      el.innerHTML = v || locked[i] ? `<b>${U.esc(shown || '—')}</b>`
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
  //   點一下列出整份清單（停用的不列），打字時篩選；找不到時最下面是「＋ 新增」（紀錄的設備欄沒有）
  //   下拉選單蓋在下面的欄位上，表單不會跟著變長變短
  const listName = f => (f.list ? `${f.list}清單` : SCHEMAS[f.ref].title);
  const canAdd = f => !f.noAdd && !Refs.targetOf(f.ref).noAdd && !(typeof Sync !== 'undefined' && Sync.isSales());

  //   顯示的字和存的值不一樣時（設備：顯示位置、存編號），另外一格給人看、打字搜尋，存的值放在藏起來的 inputs[i]
  const labelOf = f => Refs.targetOf(f.ref).label || null;
  // 存的值 → 顯示的字（設備編號 → 位置）；找不到時照原本的字
  //   有 shown 的照它寫（異動的原位置：那天機器在哪裡，不是現在在哪裡）
  function shownText(i, v) {
    const f = ctx.fields[i];
    const label = labelOf(f);
    const hit = label && v ? Refs.find(f, v) : null;
    if (!hit) return v;
    return (f.shown && f.shown({ ...formValues(), [f.key]: v })) || label(hit);
  }
  // 存的值改了之後，給人看的那一格跟著換
  function syncText(i) {
    const c = combos[i];
    if (c && c.text !== inputs[i]) c.text.value = shownText(i, inputs[i].value);
  }
  // 從清單選的欄位、可以選好幾個的欄位：存的值改了之後畫面跟著換
  const syncTexts = () => {
    combos.forEach((c, i) => c && syncText(i));
    manys.forEach((m, i) => m && renderMany(i));
  };

  // ---------- 可以選好幾個的欄位（合約的位置）：表單上列出全部，點了打開小視窗改 ----------
  const picked = i => Refs.valuesOf(ctx.fields[i], inputs[i].value);
  // 一項的名字和小字（位置：現在放著哪台）；找不到時照原本的字
  function pickedItem(f, v) {
    const r = Refs.find(f, v);
    return r ? { name: Refs.labelOf(f.ref, r), sub: Refs.sub(f.ref, r) } : { name: v, sub: '' };
  }

  function buildMany(f, i, inp) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'many-box';
    btn.id = inp.id;
    inp.removeAttribute('id');
    inp.type = 'hidden';
    btn.addEventListener('click', () => Picker.open(f, picked(i), vals => {
      inputs[i].value = vals.join('、');
      renderMany(i);
      setError(i, '');
      renderNotes();
    }, `${ctx.name}的${f.label}`));
    manys[i] = btn;
    const box = document.createElement('div');
    box.append(inp, btn);
    return box;
  }

  // 表單上最多列 5 個，多的寫「…還有 15 個」（合約有 20 台時表單不會太長；全部在小視窗裡看）
  const MANY_ROWS = 5;
  function renderMany(i) {
    const f = ctx.fields[i];
    const vals = picked(i);
    const more = vals.length - MANY_ROWS;
    manys[i].innerHTML = vals.length
      ? `<span class="many-rows">${vals.slice(0, MANY_ROWS).map(v => {
        const it = pickedItem(f, v);
        return `<span class="many-row"><b>${U.esc(it.name)}</b>${it.sub ? `<small>${U.esc(it.sub)}</small>` : ''}</span>`;
      }).join('')}${more > 0 ? `<span class="many-more">…還有 ${more} 個</span>` : ''}</span><span class="many-edit">修改 ›</span>`
      : `<span class="many-empty">選擇${U.esc(f.label)}</span><span class="many-edit">›</span>`;
  }

  function buildCombo(f, i, inp) {
    const box = document.createElement('div');
    box.className = 'combo';
    // 給人看的那一格；存的值不一樣時另外做一格，原本的那格藏起來
    const text = labelOf(f) ? document.createElement('input') : inp;
    if (text !== inp) {
      text.type = 'text';
      text.id = inp.id;
      inp.removeAttribute('id');
      inp.type = 'hidden';
      text.autocomplete = 'off';
      text.spellcheck = false;
      text.setAttribute('enterkeyhint', 'next');
      box.appendChild(inp);
    }
    text.setAttribute('role', 'combobox');
    text.setAttribute('aria-autocomplete', 'list');
    text.setAttribute('aria-expanded', 'false');
    text.placeholder = f.placeholder || '選擇或搜尋';
    inp = text;
    const list = document.createElement('div');
    list.className = 'combo-list';
    list.id = `combo-${f.key}`;
    list.setAttribute('role', 'listbox');
    list.hidden = true;
    inp.setAttribute('aria-controls', list.id);
    const info = document.createElement('div');
    info.className = 'note combo-info';
    box.append(inp, list);
    combos[i] = { list, info, text, open: false, typed: false }; // typed：這次點進來之後打過字

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
      resolveText(i);
      renderCombo(i);
      renderNotes();
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
        hooks.toast(`已加入${listName(f)}：${Refs.labelOf(f.ref, rec)}`);
      }
    });
    return box;
  }

  // 打的字對到清單裡的哪一個：一樣（大小寫、全形半形不同）就換成清單裡的寫法
  //   顯示的字和存的值不一樣的（設備）：打的是位置或編號，剛好對到一台就選那台；對不到時留著打的字（存檔時提醒）
  function resolveText(i) {
    const f = ctx.fields[i];
    const c = combos[i];
    if (c.text === inputs[i]) {
      const hit = Refs.find(f, inputs[i].value);
      if (hit) inputs[i].value = Refs.nameOf(f.ref, hit);
      return;
    }
    const t = c.text.value.trim();
    if (t === shownText(i, inputs[i].value)) return;
    const label = labelOf(f);
    const hits = Refs.items(f, { all: true }).filter(r => [Refs.nameOf(f.ref, r), label(r)].some(x => Refs.norm(x) === Refs.norm(t)));
    inputs[i].value = hits.length === 1 ? Refs.nameOf(f.ref, hits[0]) : t;
    syncText(i);
  }

  // 選好了：依這一格算的欄位跟著填（選了設備，原位置帶入那台設備目前的位置）
  function pick(i, name) {
    inputs[i].value = name;
    syncText(i);
    combos[i].open = false;
    combos[i].typed = false;
    setError(i, '');
    renderCombo(i);
    renderNotes();
  }

  function renderCombo(i) {
    const f = ctx.fields[i];
    const c = combos[i];
    const inp = c.text;
    const q = inp.value.trim();
    // 有 only 的欄位依表單填的內容只列一部分（異動：安裝只列倉庫裡的機器、撤機的新位置只列倉庫）
    const values = f.only ? formValues() : null;
    const all = Refs.items(f, { values });
    const value = inputs[i].value.trim();
    const hit = value ? Refs.find(f, value) : null;
    const n = Refs.norm(q);
    const name = r => Refs.nameOf(f.ref, r);
    // 選單上寫的字：設備寫位置（編號、名稱寫在小字）
    const label = labelOf(f) || name;
    const also = Refs.targetOf(f.ref).also || (() => '');
    // 打的字剛好是清單裡的一項（沒有的話才有「＋ 新增」）
    const exact = q ? Refs.items(f, { all: true }).find(r => [name(r), label(r)].some(x => Refs.norm(x) === n)) : null;
    // 空白、或已經選好還沒打字時列出全部；打字時列出名字或小字（以前的名字）裡有這些字的
    const listed = !q || (hit && !c.typed) ? all : all.filter(r =>
      [name(r), label(r), Refs.sub(f.ref, r), also(r)].some(x => Refs.norm(x).includes(n)));
    // 打的剛好是一項、但沒列出來：停用了，或這個類型不能選；寫在選單最下面
    const off = Refs.targetOf(f.ref).off || '停用';
    const why = exact && !listed.includes(exact) && c.typed
      ? (!Refs.active(f.ref, exact) ? `「${q}」已經${off.replace(/^已/, '')}` : f.onlyNote?.(values) || '') : '';
    c.list.innerHTML = listed.slice(0, 60).map(r => {
      const on = hit && r.id === hit.id;
      const sub = Refs.sub(f.ref, r);
      const tone = Refs.tone(f.ref, r);
      return `<button type="button" class="combo-opt${on ? ' on' : ''}" role="option" aria-selected="${!!on}" data-pick="${U.esc(name(r))}">` +
        `${tone ? `<i class="dot ${U.esc(tone)}" aria-hidden="true"></i>` : ''}<span>${U.esc(label(r) || name(r))}</span>${sub ? `<small>${U.esc(sub)}</small>` : ''}</button>`;
    }).join('') +
      (q && !exact && canAdd(f) ? `<button type="button" class="combo-add" data-add>＋ 新增${U.esc(Refs.scopeName(f))}「${U.esc(q)}」</button>` : '') +
      (why ? `<p class="combo-empty">${U.esc(why)}</p>` : '') +
      (q && !listed.length && !canAdd(f) && !why ? `<p class="combo-empty">找不到「${U.esc(q)}」</p>` : '') +
      (!q && !all.length ? `<p class="combo-empty">${canAdd(f) ? `${U.esc(listName(f))}還是空的，打字後點「＋ 新增」` : `還沒有${U.esc(listName(f))}`}</p>` : '');
    c.list.hidden = !c.open || !c.list.innerHTML;
    inp.setAttribute('aria-expanded', String(!c.list.hidden));
    // 不在清單上的值（舊資料、試算表手打的）：寫在欄位下面；選單打開時不用寫
    const outside = q && !hit && !c.open;
    c.info.textContent = !outside ? ''
      : !canAdd(f) ? `找不到${listName(f)}「${q}」${q === original[i] ? '，可以照常儲存' : '，請從選單選'}`
      : q === original[i] ? `「${q}」不在${listName(f)}裡，可以照常儲存；點欄位可以「＋ 新增」`
      : `「${q}」不在${listName(f)}裡，請從選單選，或點欄位後「＋ 新增」`;
  }

  // 第 k 個欄位（只顯示的、藏起來的跳過）；左右切換、複選的欄位改成第一個按鈕
  function focusField(k) {
    while (k < ctx.fields.length && (locked[k] || ctx.fields[k].auto || ctx.fields[k].hidden)) k++;
    const f = ctx.fields[k];
    const btn = (f?.toggle || f?.type === 'multi') && inputs[k].parentElement.querySelector('[data-toggle], [data-multi]');
    (btn || combos[k]?.text || manys[k] || inputs[k])?.focus();
  }

  // 各欄位目前填的內容（日期轉成 2025-06-05，看不懂時是空字串）；id 是正在編輯的那一筆（新增時是 null）
  const formValues = () => ({
    ...Object.fromEntries(ctx.fields.map((f, i) => {
      const raw = String(getVal(i)).trim();
      return [f.key, f.type === 'date' ? U.parseDate(raw) || '' : f.type === 'month' ? U.parseMonth(raw) || '' : raw];
    })),
    id: ctx.id,
  });
  const calcText = f => {
    const c = f.calc(formValues());
    return c === null || c === undefined ? '' : String(c);
  };

  // 自動填的欄位：算出來的值變了（依的欄位改了），欄位空白、或還是上次填的值時，換成這次算的
  function recalc() {
    ctx.fields.forEach((f, i) => {
      if (!f.calc || locked[i]) return;
      const c = calcText(f);
      if (c === calcked[i]) return;
      const cur = inputs[i].value.trim();
      if (!cur || cur === calcked[i]) {
        inputs[i].value = c;
        if (c) setError(i, '');
        if (f.toggle || f.type === 'multi') renderToggles();
        if (combos[i]) {
          syncText(i);
          renderCombo(i);
        }
      }
      calcked[i] = c;
    });
  }

  // 欄位下方的提醒，依目前填的內容重新產生；自動填的欄位先填好
  function renderNotes() {
    recalc();
    // 依其他欄位才出現的欄位（機型的世代）
    if (ctx.fields.some(f => f.showIf)) {
      const v = formValues();
      ctx.fields.forEach((f, i) => { if (f.showIf) inputs[i].closest('.field').hidden = !f.showIf(v); });
      // 一段的欄位全部藏起來時（新增合約時的提前結束日），小標題也藏
      heads.forEach(h => { h.el.hidden = inputs.slice(h.from, h.to).every(inp => inp.closest('.field').hidden); });
    }
    // 顯示的字依其他欄位算的（異動的原位置依日期）：沒有在打字時跟著換
    combos.forEach((c, i) => { if (c && ctx.fields[i].shown && !c.open) syncText(i); });
    renderAutos();
    renderCopyNote();
    if (!noteEls.some(Boolean)) return;
    const values = formValues();
    noteEls.forEach((el, i) => {
      if (!el) return;
      const n = ctx.fields[i].note(values) || '';
      el.textContent = typeof n === 'string' ? n : n.text;
      el.classList.toggle('warn', !!n.warn);
    });
  }

  // 「重新簽約」下面的說明：改了位置、日期、計費方式時變橘色（和打開表單時的值比）
  function renderCopyNote() {
    const copy = ctx.id && ctx.schema.copy;
    if (copy) copyNote.classList.toggle('warn', initial.length === inputs.length && copy.watch.some(k => getVal(fieldIndex(k)) !== initial[fieldIndex(k)]));
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
    const values = formValues();
    let firstBad = null;
    ctx.fields.forEach((f, i) => {
      const raw = String(getVal(i)).trim();
      let v = raw;
      let msg = '';
      if (f.auto || locked[i] || f.hidden) {
        // 系統產生的新值等其他欄位讀好之後才算（年份照購買日期）；不能改的照原本的；藏起來的照 calc 填的、照原本的（選項的順序）
        rec[f.key] = f.type === 'number' ? U.parseNum(raw) : raw;
        return;
      }
      if (f.type === 'flag') {
        v = raw === 'true';
      } else if (!raw) {
        if (f.optional) v = f.type === 'number' || f.type === 'date' ? null : '';
        else msg = f.toggle ? `請選${f.toggle.map(o => o.label).join('、')}其中一個`
          : f.type === 'multi' || f.many ? '至少選一個' : '必填';
      } else if (f.type === 'number' && (v = U.parseNum(raw)) === null) msg = '請輸入數字';
      else if (f.type === 'date' && (v = U.parseDate(raw)) === null) msg = '日期格式如 2025/06/05';
      else if (f.type === 'month' && (v = U.parseMonth(raw)) === null) msg = '月份格式如 2026/09';
      else if (f.type === 'ref' && f.many) {
        // 每一個都要在清單裡（舊資料裡本來就有的照常可以存）
        const old = Refs.valuesOf(f, original[i]);
        const vals = Refs.valuesOf(f, raw).map(x => {
          const hit = Refs.find(f, x);
          if (!hit && !old.includes(x)) msg ||= `找不到${listName(f)}「${x}」，請從選單選`;
          return hit ? Refs.nameOf(f.ref, hit) : x;
        });
        v = vals.join('、');
        if (!vals.length && !f.optional) msg = '至少選一個';
      } else if (f.type === 'ref') {
        const hit = Refs.find(f, raw);
        if (hit) v = Refs.nameOf(f.ref, hit);
        else if (raw !== original[i]) msg = canAdd(f) ? `${listName(f)}裡沒有「${raw}」，請從選單選，或點「＋ 新增」` : `找不到${listName(f)}「${raw}」，請從選單選`;
      } else if (f.clean) v = f.clean(raw, values);
      else if (f.upper) v = U.toHalf(raw).toUpperCase();
      // 和其他欄位一起看才知道對不對的（異動的類型和位置、還放著機器的位置不能停用）
      if (!msg && f.check) msg = f.check(values) || '';
      setError(i, msg);
      if (msg && !firstBad) {
        firstBad = f.toggle || f.type === 'multi' ? inputs[i].parentElement.querySelector('[data-toggle], [data-multi]') : combos[i]?.text || manys[i] || inputs[i];
      }
      rec[f.key] = v;
    });
    ctx.fields.forEach(f => { if (f.auto && !rec[f.key]) rec[f.key] = f.auto(rec); });
    return { rec, firstBad };
  }

  // 儲存後的提示，例如「NB-001 會議室筆電 使用中」「位置 3F 會議室」「24-0001 2026/10/11 移機」
  function summary(rec) {
    if (ctx.schema.describe) return ctx.schema.describe(rec);
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
  // 存不了時捲到那一格；從清單選的欄位不放游標（下拉選單會打開，蓋住下面寫的原因）
  function showBad(el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (el.getAttribute('role') !== 'combobox') el.focus({ preventScroll: true });
  }

  // again：新增後留在表單，接著填下一筆
  function save(again = false) {
    combos.forEach((c, i) => { if (c?.open) { c.open = false; renderCombo(i); } });
    const { rec, firstBad } = collect();
    if (firstBad) {
      showBad(firstBad);
      return;
    }
    // 已經有了（編號、名稱重複）：寫在那一格下面，不存
    const found = duplicateOf(rec);
    if (found) {
      const i = fieldIndex(found.keys[found.keys.length - 1]);
      setError(i, ctx.schema.uniqueMsg?.(found.dup, found.keys) || `${ctx.schema.title}裡已經有一樣的了`);
      const el = combos[i]?.text || inputs[i];
      showBad(el);
      return;
    }

    if (ctx.id) {
      const before = { ...Store.get(ctx.tableKey, ctx.id) };
      Store.update(ctx.tableKey, ctx.id, rec);
      const after = Store.get(ctx.tableKey, ctx.id);
      // 清單改了名字：用到舊名字的設備一起改
      const renamed = Refs.isTarget(ctx.tableKey) ? Refs.renameRefs(ctx.tableKey, before, after) : [];
      ctx.schema.afterSave?.(before, after);
      dlg.close();
      hooks.onChanged(ctx.tableKey, { ...rec, id: ctx.id });
      hooks.toast(renamed.length ? `已儲存，用到舊名字的 ${renamed.length} 筆資料一起改了` : '已儲存');
      return;
    }

    const saved = Store.add(ctx.tableKey, rec);
    ctx.schema.afterSave?.(null, saved);
    ctx.count++;
    hooks.onChanged(ctx.tableKey, saved);
    if (!again) {
      dlg.close();
      hooks.toast(ctx.count > 1 ? `已新增 ${ctx.count} 筆` : `已新增：${summary(saved)}`);
      // 接著打開下一張表單（安裝、撤機後抄表，見 schema 的 next）
      const next = ctx.schema.next?.(saved);
      if (next) setTimeout(() => open(next.table, null, next.preset, next), 0);
      return;
    }
    // 連續新增：保留 keep 欄位，其他換回預設值（編號跳下一號）；設備詳情裡帶入的設備照樣帶
    const values = formValues();
    const kept = ctx.fields.map(f => (typeof f.keep === 'function' ? !!f.keep(values) : !!f.keep));
    ctx.fields.forEach((f, i) => { if (!kept[i]) setVal(i, f.key in ctx.preset ? editValue(ctx.preset[f.key]) : defaultValue(f)); });
    syncTexts();
    calcked = ctx.fields.map(() => null);
    renderAllChips();
    renderNotes();
    renderToggles();
    combos.forEach((c, i) => c && renderCombo(i));
    initial = inputs.map((_, i) => getVal(i));
    original = [...initial];
    setCloseLabel('完成');
    statusEl.textContent = `已新增：${summary(saved)}（本次共 ${ctx.count} 筆）`;
    statusEl.hidden = false;
    bodyEl.scrollTop = 0;
    // 手機上收起鍵盤；電腦上直接跳到下一筆的第一個要填的欄位
    if (matchMedia('(pointer: fine)').matches) {
      focusField(Math.max(kept.indexOf(false), 0));
    } else if (document.activeElement) {
      document.activeElement.blur();
    }
  }

  // 刪除按鈕下面的說明
  function showDeleteNote(text) {
    delNote.textContent = text;
    delNote.hidden = !text;
    if (text) delNote.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function resetDelete() {
    deleteUntil = 0;
    clearTimeout(deleteTimer);
    delBtn.textContent = '刪除這筆';
    showDeleteNote('');
  }

  const DELETE_MS = 10000; // 設備的說明比較長，留時間看
  function remove() {
    const rec = Store.get(ctx.tableKey, ctx.id);
    const tg = ctx.schema.target;
    // 設備：有紀錄的建議改成報廢；真的要刪就連同紀錄一起刪
    const uses = tg?.cascade ? [...new Map(Refs.usesOf(ctx.tableKey, rec).map(u => [`${u.table}:${u.id}`, u])).values()] : [];
    // 清單裡有人在用的不能刪（見 refs.js）
    const block = Refs.isTarget(ctx.tableKey) && !tg.cascade ? Refs.removeBlock(ctx.tableKey, rec) : '';
    if (block) {
      showDeleteNote(block);
      return;
    }
    // 第一次：寫會刪掉什麼，等第二次
    if (Date.now() >= deleteUntil) {
      deleteUntil = Date.now() + DELETE_MS;
      delBtn.textContent = '再按一次，確定刪除';
      showDeleteNote(uses.length
        ? `${summary(rec)} 有 ${Refs.usesText(ctx.tableKey, rec)}，會一起刪除。不再使用的話，建議把狀態改成「報廢」，紀錄會留著。`
        : `會刪除這筆${ctx.schema.title}：${summary(rec)}`);
      clearTimeout(deleteTimer);
      deleteTimer = setTimeout(resetDelete, DELETE_MS);
      return;
    }
    uses.forEach(u => Store.remove(u.table, u.id));
    Store.remove(ctx.tableKey, ctx.id);
    ctx.schema.afterRemove?.(rec);
    dlg.close();
    hooks.onChanged(ctx.tableKey, null);
    hooks.toast(uses.length ? `已刪除，連同 ${uses.length} 筆紀錄` : '已刪除');
  }

  function isDirty() {
    return inputs.some((_, i) => getVal(i) !== initial[i] && (ctx.id || !ctx.fields[i].keep));
  }

  // 左上角按鈕：平常是「取消」（連續新增後是「完成」）
  function setCloseLabel(label) {
    closeLabel = label;
    leaveUntil = 0;
    clearTimeout(leaveTimer);
    closeBtn.textContent = label;
    closeBtn.classList.remove('danger');
  }

  // 有還沒儲存的內容：按第一次變成紅字「不存，關掉」，4 秒內再按一次才關
  //   不用瀏覽器的確認視窗：有些環境不會跳出來，直接當作按了取消，表單就關不掉
  const LEAVE_MS = 4000;
  function requestClose() {
    if (!isDirty() || Date.now() < leaveUntil) {
      dlg.close();
      return;
    }
    leaveUntil = Date.now() + LEAVE_MS;
    closeBtn.textContent = '不存，關掉';
    closeBtn.classList.add('danger');
    hooks.toast('還沒儲存，再按一次「不存，關掉」就關掉');
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => setCloseLabel(closeLabel), LEAVE_MS);
  }

  // 以這筆為底新增（合約的「重新簽約」）：帶入 copy.keys 的欄位，其他是新增時的預設值；改過還沒存時先存或取消
  function copyAsNew() {
    if (isDirty()) {
      hooks.toast('這裡改過還沒儲存，先按「儲存」或「取消」');
      return;
    }
    const rec = Store.get(ctx.tableKey, ctx.id);
    const { tableKey, schema } = ctx;
    dlg.close();
    open(tableKey, null, Object.fromEntries(schema.copy.keys.map(k => [k, rec[k]])));
  }

  // ---------- 事件 ----------
  saveBtn.addEventListener('click', () => save());
  copyBtn.addEventListener('click', () => (ctx.schema.copy ? copyAsNew() : hooks.action(ctx.tableKey, Store.get(ctx.tableKey, ctx.id))));
  anotherBtn.addEventListener('click', () => save(true));
  closeBtn.addEventListener('click', requestClose);
  delBtn.addEventListener('click', remove);
  dlg.addEventListener('cancel', e => { e.preventDefault(); requestClose(); });
  dlg.addEventListener('close', () => {
    setCloseLabel(closeLabel);
    resetDelete();
  });

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
