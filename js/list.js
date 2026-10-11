// 列表：卡片列表，點卡片開啟編輯表單
//   有 schema.period 時依日期分組（新到舊），上方可以選年、月；沒有時依 schema.sort 排序、不分組
//   schema.total 存在時，列表上方顯示合計
function createList(tableKey, schema, { openForm }) {
  const fields = schema.fields;
  const byKey = Object.fromEntries(fields.map(f => [f.key, f]));
  const period = schema.period || null;
  const { code, title, badge, primary, grid } = schema.card;
  const gridFields = grid
    ? grid.map(k => byKey[k])
    : fields.filter(f => ![period?.key, code, title, badge, primary].includes(f.key) && !f.multiline);
  const searchKeys = schema.search || [code, title].filter(Boolean);
  const getRows = schema.rows || (() => Store.list(tableKey));
  const state = { period: null, keyword: '', flashId: null };

  const periodOf = r => {
    const d = String(r[period.key] ?? '');
    return period.unit === 'month' ? d.slice(0, 7) : d;
  };
  // 篩選值可以是年（2025）、年月（2025-08）或單日（2025-06-30）
  const inPeriod = r => {
    if (!period || !state.period) return true;
    const p = periodOf(r);
    return p === state.period || p.startsWith(`${state.period}-`);
  };
  const periodLabel = p => (p.length === 4 ? `${p} 年` : U.fmtDate(p));
  const matchKeyword = r =>
    searchKeys.map(k => r[k] ?? '').join(' ').toLowerCase().includes(state.keyword.trim().toLowerCase());
  const show = (f, v) => U.esc(U.display(f, v)) || '—';
  const cardLabel = f => f.cardLabel || f.label;
  // 標籤的顏色：照 toggle 的 tone（設備的狀態）
  const badgeField = badge && byKey[badge];
  const tone = v => badgeField?.toggle?.find(o => o.match.test(v))?.tone || '';
  const statusOf = r => (schema.status ? schema.status(r) : null);
  const introHTML = schema.intro ? `<p class="list-intro">${U.esc(schema.intro)}</p>` : '';
  const placeholder = `搜尋${searchKeys.slice(0, 2).map(k => byKey[k]?.label).filter(Boolean).join('或')}`;

  // ---------- DOM ----------
  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  el.innerHTML = `
    <div class="filterbar">
      ${period ? `<select class="f-period" aria-label="${period.label}"></select>` : ''}
      <input class="f-keyword" type="search" placeholder="${U.esc(placeholder)}" autocomplete="off" enterkeyhint="search">
      <span class="count"></span>
    </div>
    <div class="list"></div>`;

  const periodSel = el.querySelector('.f-period');
  const keywordInput = el.querySelector('.f-keyword');
  const countEl = el.querySelector('.count');
  const listEl = el.querySelector('.list');

  periodSel?.addEventListener('change', () => { state.period = periodSel.value; renderList(); });
  keywordInput.addEventListener('input', () => { state.keyword = keywordInput.value; renderList(); });
  listEl.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (card) openForm(card.dataset.id);
  });

  // ---------- 畫面 ----------
  function renderPeriods() {
    if (!period) return;
    const periods = [...new Set(getRows().map(periodOf).filter(Boolean))].sort().reverse();
    const years = period.unit === 'month' ? [...new Set(periods.map(p => p.slice(0, 4)))] : [];
    if (state.period === null || (state.period && ![...years, ...periods].includes(state.period))) state.period = '';
    const opts = list => list.map(p => `<option value="${U.esc(p)}">${U.esc(periodLabel(p))}</option>`).join('');
    periodSel.innerHTML = `<option value="">全部${period.label}</option>` +
      (years.length ? `<optgroup label="年">${opts(years)}</optgroup><optgroup label="月">${opts(periods)}</optgroup>` : opts(periods));
    periodSel.value = state.period;
  }

  function cardHTML(r) {
    const pf = primary && byKey[primary];
    const cells = gridFields.map(f =>
      `<span class="cell"><small>${cardLabel(f)}</small><span>${show(f, r[f.key])}</span></span>`).join('');
    // 標籤：有 badge 欄位用欄位的值；沒有時用狀態標籤
    const st = statusOf(r);
    const tag = badge ? r[badge] && { label: r[badge], cls: tone(r[badge]) } : st;
    return `
      <button type="button" class="card${r.id === state.flashId ? ' flash' : ''}${st?.pending ? ' pending' : ''}" data-id="${U.esc(r.id)}">
        <span class="card-top">
          <span class="card-title">${code && r[code] ? `<span class="card-code">${U.esc(r[code])}</span>` : ''}${U.esc(r[title])}</span>
          ${tag ? `<span class="badge ${tag.cls}">${U.esc(tag.label)}</span>` : ''}
          ${pf ? `<span class="card-primary"><small>${cardLabel(pf)}</small><b>${show(pf, r[primary])}</b></span>` : ''}
        </span>
        ${cells ? `<span class="card-grid">${cells}</span>` : ''}
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

  const compare = (a, b) => {
    const k = period ? period.key : schema.sort;
    if (!k) return 0;
    const x = String(a[k] ?? ''), y = String(b[k] ?? '');
    // 日期新到舊；其他（編號）由小到大，數字照大小排（NB-2 在 NB-10 前面）
    return period ? (x < y ? 1 : x > y ? -1 : 0) : x.localeCompare(y, 'zh-Hant', { numeric: true });
  };

  function renderList() {
    const all = getRows();
    const kw = state.keyword.trim();
    // 同一天維持輸入順序（sort 為穩定排序）
    const rows = all.filter(r => inPeriod(r) && (!kw || matchKeyword(r))).sort(compare);

    countEl.textContent = rows.length === all.length ? `${all.length} 筆` : `${rows.length}／${all.length} 筆`;

    if (!rows.length) {
      listEl.innerHTML = all.length
        ? `${introHTML}<p class="empty">沒有符合條件的資料</p>`
        : `<p class="empty">${schema.empty || '還沒有資料<br>點右上角「＋ 新增」開始記錄'}</p>`;
    } else {
      let html = introHTML + (schema.total ? summaryHTML(rows) : '');
      let group = null;
      rows.forEach(r => {
        if (period) {
          const g = String(r[period.key] ?? '');
          if (g !== group) {
            group = g;
            html += `<h3 class="group-head">${U.esc(U.fmtDate(g))} ${U.weekday(g)}</h3>`;
          }
        }
        html += cardHTML(r);
      });
      listEl.innerHTML = html;
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
      state.flashId = rec.id;
    }
    refresh();
  }

  function reset() {
    Object.assign(state, { period: null, keyword: '', flashId: null });
    keywordInput.value = '';
    refresh();
  }

  return { el, refresh, changed, reset };
}
