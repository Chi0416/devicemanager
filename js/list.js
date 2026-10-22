// 列表：卡片列表，點卡片開啟編輯表單（設備是打開詳情，見 app.js）
//   有 schema.period 時依日期分組（新到舊，同一天新增的在前；period.then 是同一組裡再依哪個欄位排），上方可以選年、月
//     依月份分組的（抄表的結算月份）標題寫 2026/09；沒有 period 時依 schema.order 或 schema.sort 排序
//   schema.filter：上方一排篩選按鈕（依那個欄位的 toggle 或清單，例如設備的狀態），寫著每一種有幾筆
//   schema.groups：上方的分組選單（不分組、依類別、依位置…），這台裝置記住上次選的
//   schema.note：卡片最下面的一行（例如保固快到期）
//   schema.card.cols(列)：標題下面左右兩格 [{ label, main, sub, tone }]（抄表的黑白、彩色：本期粗體、計數器灰字）
//   schema.total 存在時，列表上方顯示合計
//   rows：要列的資料（設備詳情裡只列這台設備的紀錄）；沒有時列整張表
//   detail：放在設備詳情裡，不要搜尋框和月份、分組選單（篩選按鈕照常）
//   device(列)：卡片最上面那一排寫在哪裡、哪一台設備（底部「紀錄」分頁，和設備卡片一樣小標題在上、內容在下），下面才是紀錄的內容
//     回傳 [{ label, value, warn }]（位置、設備）
function createList(tableKey, schema, { openForm, rows = null, detail = false, device = null }) {
  const fields = schema.fields;
  const byKey = Object.fromEntries(fields.map(f => [f.key, f]));
  const period = schema.period || null;
  const card = schema.card;
  const { code, title, badge, primary, grid } = card;
  const titleOf = r => (typeof title === 'function' ? title(r) : r[title]);
  const gridFields = grid
    ? grid.map(k => byKey[k])
    : fields.filter(f => ![period?.key, code, title, badge, primary].includes(f.key) && !f.multiline);
  const searchKeys = schema.search || [code, title].filter(k => typeof k === 'string');
  const getRows = rows || schema.rows || (() => Store.list(tableKey));
  const filterField = schema.filter ? byKey[schema.filter] : null;
  const groups = schema.groups || [];
  const GROUP_KEY = `${Store.PREFIX}group.${tableKey}`;
  let savedGroup = '';
  try { savedGroup = localStorage.getItem(GROUP_KEY) || ''; } catch (_) {}
  const state = { period: null, keyword: '', flashId: null, filter: '', group: groups.some(([k]) => k === savedGroup) ? savedGroup : '' };

  // key 空白時照 fallback 的欄位（抄表：結算月份空白的照抄表日期）
  const periodOf = r => {
    const d = String(r[period.key] || (period.fallback && r[period.fallback]) || '');
    return period.unit === 'month' ? d.slice(0, 7) : d;
  };
  // 篩選值可以是年（2025）、年月（2025-08）或單日（2025-06-30）
  const inPeriod = r => {
    if (!period || !state.period) return true;
    const p = periodOf(r);
    return p === state.period || p.startsWith(`${state.period}-`);
  };
  const periodLabel = p => (p.length === 4 ? `${p} 年` : U.fmtDate(p));
  const matchKeyword = r => [...searchKeys.map(k => r[k] ?? ''), schema.searchText?.(r) ?? '']
    .join(' ').toLowerCase().includes(state.keyword.trim().toLowerCase());
  // 篩選按鈕：toggle 的哪一個（試算表手打的字也認得）；從清單選的欄位：清單裡的哪一項（大小寫、全形半形不同也認得）
  const filterOf = r => {
    const v = String(r[filterField.key] ?? '').trim();
    if (filterField.toggle) return filterField.toggle.find(o => o.match.test(v))?.value ?? '';
    const hit = Refs.find(filterField, v);
    return hit ? Refs.nameOf(filterField.ref, hit) : v;
  };
  // 篩選按鈕的選項：toggle 的選項；從清單選的欄位是清單裡沒停用的，加上停用了但還有設備在用的、不在清單裡的值
  function filterOptions(rows) {
    if (filterField.toggle) return filterField.toggle;
    const used = new Set(rows.map(filterOf).filter(Boolean));
    const listed = Refs.items(filterField, { all: true }).filter(r => Refs.active(filterField.ref, r) || used.has(Refs.nameOf(filterField.ref, r)));
    const names = listed.map(r => Refs.nameOf(filterField.ref, r));
    return [
      ...listed.map(r => ({ value: Refs.nameOf(filterField.ref, r), label: Refs.nameOf(filterField.ref, r), tone: Refs.tone(filterField.ref, r) })),
      ...[...used].filter(v => !names.includes(v)).map(v => ({ value: v, label: v, tone: '' })),
    ];
  }
  const inFilter = r => !state.filter || filterOf(r) === state.filter;
  const show = (f, v) => U.esc(U.display(f, v)) || '—';
  const cardLabel = f => f.cardLabel || f.label;
  // 標籤的顏色：照 toggle 的 tone，或清單裡那一項的顏色（設備的狀態）
  const badgeField = badge && byKey[badge];
  const tone = v => (badgeField?.type === 'ref'
    ? Refs.tone(badgeField.ref, Refs.find(badgeField, v))
    : badgeField?.toggle?.find(o => o.match.test(v))?.tone || '');
  const statusOf = r => (schema.status ? schema.status(r) : null);
  const introHTML = schema.intro ? `<p class="list-intro">${U.esc(schema.intro)}</p>` : '';
  const placeholder = schema.searchHint || `搜尋${searchKeys.slice(0, 2).map(k => byKey[k]?.label).filter(Boolean).join('或')}`;
  const byText = (a, b) => String(a).localeCompare(String(b), 'zh-Hant', { numeric: true });

  // ---------- DOM ----------
  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  const searchRow = `
      <div class="filterbar-row">
        ${period ? `<select class="f-period" aria-label="${period.label}"></select>` : ''}
        ${groups.length ? `<select class="f-group" aria-label="分組">
          <option value="">不分組</option>
          ${groups.map(([k, label]) => `<option value="${k}">依${U.esc(label)}</option>`).join('')}
        </select>` : ''}
        <input class="f-keyword" type="search" placeholder="${U.esc(placeholder)}" autocomplete="off" enterkeyhint="search">
        ${filterField ? '' : '<span class="count"></span>'}
      </div>`;
  el.innerHTML = `
    ${detail && !filterField ? '' : `<div class="filterbar">
      ${detail ? '' : searchRow}
      ${filterField ? '<div class="filter-chips" role="group" aria-label="篩選"></div>' : ''}
    </div>`}
    <div class="list"></div>`;

  const periodSel = el.querySelector('.f-period');
  const groupSel = el.querySelector('.f-group');
  const keywordInput = el.querySelector('.f-keyword');
  const countEl = el.querySelector('.count');
  const chipsEl = el.querySelector('.filter-chips');
  const listEl = el.querySelector('.list');

  periodSel?.addEventListener('change', () => { state.period = periodSel.value; renderList(); });
  if (groupSel) {
    groupSel.value = state.group;
    groupSel.addEventListener('change', () => {
      state.group = groupSel.value;
      try { localStorage.setItem(GROUP_KEY, state.group); } catch (_) {}
      renderList();
    });
  }
  keywordInput?.addEventListener('input', () => { state.keyword = keywordInput.value; renderList(); });
  chipsEl?.addEventListener('click', e => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    renderList();
  });
  listEl.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (card) openForm(card.dataset.id);
  });

  // ---------- 畫面 ----------
  function renderPeriods() {
    if (!period || !periodSel) return;
    const periods = [...new Set(getRows().map(periodOf).filter(Boolean))].sort().reverse();
    const years = period.unit === 'month' ? [...new Set(periods.map(p => p.slice(0, 4)))] : [];
    if (state.period === null || (state.period && ![...years, ...periods].includes(state.period))) state.period = '';
    const opts = list => list.map(p => `<option value="${U.esc(p)}">${U.esc(periodLabel(p))}</option>`).join('');
    periodSel.innerHTML = `<option value="">全部${period.label}</option>` +
      (years.length ? `<optgroup label="年">${opts(years)}</optgroup><optgroup label="月">${opts(periods)}</optgroup>` : opts(periods));
    periodSel.value = state.period;
  }

  // 篩選按鈕的數字跟著搜尋走（搜尋「筆電」時，寫的是筆電裡各狀態有幾台）
  function renderChips(rows) {
    if (!chipsEl) return;
    const count = v => rows.filter(r => !v || filterOf(r) === v).length;
    const opts = [{ value: '', label: '全部', tone: '' }, ...filterOptions(rows)];
    chipsEl.innerHTML = opts.map(o => `
      <button type="button" class="chip filter ${U.esc(o.tone)}${state.filter === o.value ? ' on' : ''}" data-filter="${U.esc(o.value)}"
        aria-pressed="${state.filter === o.value}">${U.esc(o.label)}<span>${count(o.value)}</span></button>`).join('');
  }

  function cardHTML(r) {
    const pf = primary && byKey[primary];
    const cells = gridFields.map(f =>
      `<span class="cell"><small>${cardLabel(f)}</small><span>${show(f, r[f.key])}</span></span>`).join('');
    // 標籤：有 badge 欄位用欄位的值；沒有時用狀態標籤
    const st = statusOf(r);
    const tag = badge ? r[badge] && { label: r[badge], cls: tone(r[badge]) } : st;
    const note = schema.note ? schema.note(r) : null;
    const sub = card.sub?.(r) || '';
    const side = card.side?.(r);
    const sideHTML = side ? `<span class="card-side ${side.tone}">${U.esc(side.text)}</span>` : '';
    const dev = device ? device(r) : [];
    const devCells = dev.map(c => `<span class="cell"><small>${U.esc(c.label)}</small><span class="${c.warn ? 'warn' : ''}">${U.esc(c.value) || '—'}</span></span>`).join('');
    const cols = (card.cols?.(r) || []).map(c =>
      `<span class="cell"><small>${U.esc(c.label)}</small><b class="${U.esc(c.tone || '')}">${U.esc(c.main)}</b><em>${U.esc(c.sub)}</em></span>`).join('');
    return `
      <button type="button" class="card${r.id === state.flashId ? ' flash' : ''}${st?.pending ? ' pending' : ''}" data-id="${U.esc(r.id)}">
        ${devCells ? `<span class="card-grid rec cols-${dev.length}">${devCells}</span>` : ''}
        <span class="card-top">
          <span class="card-title">${code && r[code] ? `<span class="card-code">${U.esc(r[code])}</span>` : ''}${U.esc(titleOf(r))}</span>
          ${tag ? `<span class="badge ${tag.cls}">${U.esc(tag.label)}</span>` : ''}
          ${pf ? `<span class="card-primary"><small>${cardLabel(pf)}</small><b>${show(pf, r[primary])}</b></span>` : ''}
        </span>
        ${sideHTML ? `<span class="card-sub split"><span>${U.esc(sub)}</span>${sideHTML}</span>` : sub ? `<span class="card-sub">${U.esc(sub)}</span>` : ''}
        ${cells ? `<span class="card-grid">${cells}</span>` : ''}
        ${cols ? `<span class="card-grid count-grid">${cols}</span>` : ''}
        ${note ?`<span class="card-note${note.warn ? ' warn' : ''}">${U.esc(note.text)}</span>` : ''}
      </button>`;
  }

  // 合計目前篩選範圍內的數字；算不出來（空白）的列不計入
  function summaryHTML(rows) {
    const { key, label } = schema.total;
    const counted = rows.filter(r => typeof r[key] === 'number');
    const total = U.round(counted.reduce((s, r) => s + r[key], 0));
    const scope = (state.period && periodLabel(state.period)) || '全部';
    return `
      <div class="summary">
        <small>${U.esc(scope)} ${label}合計</small>
        <b>${U.fmtNum(total)}</b>
      </div>`;
  }

  const desc = (x, y) => (x < y ? 1 : x > y ? -1 : 0);
  const compare = schema.order || ((a, b) => {
    const k = period ? period.key : schema.sort;
    if (!k) return 0;
    const x = period ? periodOf(a) : String(a[k] ?? ''), y = period ? periodOf(b) : String(b[k] ?? '');
    // 日期新到舊，同一天新增的在前（id 前段是新增的時間）；其他（編號）由小到大，數字照大小排（NB-2 在 NB-10 前面）
    const then = period?.then ? desc(String(a[period.then] ?? ''), String(b[period.then] ?? '')) : 0;
    return period ? desc(x, y) || then || desc(String(a.id), String(b.id)) : byText(x, y);
  });

  // 分組：依日期（有 period 時）或依選的欄位；欄位空白的放最後（「未填類別」）
  //   存編號的欄位（位置）依畫面上寫的字分組（欄位的 format）
  function grouped(rows) {
    if (state.group) {
      const label = groups.find(([k]) => k === state.group)[1];
      const gf = byKey[state.group];
      const map = new Map();
      rows.forEach(r => {
        const raw = String(r[state.group] ?? '').trim();
        const g = raw && gf.format ? String(gf.format(raw)).trim() : raw;
        if (!map.has(g)) map.set(g, []);
        map.get(g).push(r);
      });
      return [...map].sort(([a], [b]) => (!a) - (!b) || byText(a, b))
        .map(([g, list]) => ({ head: `${g || `未填${label}`}`, count: list.length, rows: list }));
    }
    if (period) {
      const out = [];
      rows.forEach(r => {
        const raw = String(r[period.key] ?? '');
        const g = raw || `empty:${periodOf(r)}`;
        const head = !raw ? period.emptyHead || '沒有日期' : byKey[period.key].type === 'month' ? U.fmtMonth(raw) : `${U.fmtDate(raw)} ${U.weekday(raw)}`;
        if (out.at(-1)?.key !== g) out.push({ key: g, head, rows: [] });
        out.at(-1).rows.push(r);
      });
      return out;
    }
    return [{ head: '', rows }];
  }

  function renderList() {
    const all = getRows();
    const kw = state.keyword.trim();
    const matched = all.filter(r => inPeriod(r) && (!kw || matchKeyword(r)));
    renderChips(matched);
    // 同一天維持輸入順序（sort 為穩定排序）
    const rows = matched.filter(inFilter).sort(compare);

    // 有篩選按鈕時，筆數寫在按鈕上
    if (countEl) countEl.textContent = rows.length === all.length ? `${all.length} 筆` : `${rows.length}／${all.length} 筆`;

    if (!rows.length) {
      listEl.innerHTML = all.length
        ? `${introHTML}<p class="empty">沒有符合條件的資料</p>`
        : `<p class="empty">${detail ? `還沒有${U.esc(schema.title)}` : schema.empty || '還沒有資料<br>點右上角「＋ 新增」開始記錄'}</p>`;
    } else {
      listEl.innerHTML = introHTML + (schema.total ? summaryHTML(rows) : '') + grouped(rows).map(g =>
        (g.head ? `<h3 class="group-head">${U.esc(g.head)}${g.count ? `<span>${g.count}</span>` : ''}</h3>` : '') +
        g.rows.map(cardHTML).join('')).join('');
    }
    state.flashId = null;
  }

  function refresh() {
    renderPeriods();
    renderList();
  }

  // 新增或修改後呼叫：確保那筆在目前篩選條件下看得到，並短暫標亮
  function changed(rec) {
    if (rec) {
      if (period && !inPeriod(rec)) state.period = periodOf(rec);
      if (state.keyword && !matchKeyword(rec)) {
        state.keyword = '';
        keywordInput.value = '';
      }
      if (!inFilter(rec)) state.filter = '';
      state.flashId = rec.id;
    }
    refresh();
  }

  function reset() {
    Object.assign(state, { period: null, keyword: '', flashId: null, filter: '' });
    if (keywordInput) keywordInput.value = '';
    refresh();
  }

  // 從別的地方帶著條件打開（總覽點一個型號）：篩選按鈕、搜尋框換成給的，分組不動
  function showWith({ filter = '', keyword = '' } = {}) {
    state.filter = filter;
    state.keyword = keyword;
    if (keywordInput) keywordInput.value = keyword;
    refresh();
  }

  return { el, refresh, changed, reset, show: showWith };
}
