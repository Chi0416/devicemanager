// 總覽：各機型有幾台（計算見 records.js 的 modelCounts）
//   上面先選狀態（出租中、庫存…，和設備頁一樣的按鈕），預設第一個狀態，這台裝置記住上次選的
//   下面照機型清單的順序，一格一個機型，由上往下、再往右排（手機兩欄，寬螢幕多欄）；最上面寫總計
//   點一個機型：到設備頁，篩好狀態和機型（onPick，見 app.js）；沒填機型的那一格不能點
function createOverview({ onPick }) {
  const KEY = `${Store.PREFIX}overview.status`;
  const statusField = SCHEMAS.devices.fields.find(f => f.key === 'status');
  let status = null; // 選的狀態；'' 是全部；null 是還沒選過（用第一個狀態）
  try { status = localStorage.getItem(KEY); } catch (_) {}

  const el = document.createElement('section');
  el.className = 'panel overview';
  el.hidden = true;
  el.innerHTML = `
    <div class="filterbar"><div class="filter-chips" role="group" aria-label="狀態"></div></div>
    <div class="overview-body"></div>`;
  const chipsEl = el.querySelector('.filter-chips');
  const bodyEl = el.querySelector('.overview-body');

  // 狀態按鈕：全部、清單裡沒停用的狀態（停用了但還有設備在用的也列）、不在清單裡的狀態
  function options() {
    const used = new Set(Store.list('devices').map(Records.statusOf).filter(Boolean));
    const listed = Refs.items(statusField, { all: true }).filter(r => Refs.active('statuses', r) || used.has(r.name));
    const names = listed.map(r => r.name);
    return [
      { value: '', label: '全部', tone: '' },
      ...listed.map(r => ({ value: r.name, label: r.name, tone: Refs.tone('statuses', r) })),
      ...[...used].filter(v => !names.includes(v)).map(v => ({ value: v, label: v, tone: '' })),
    ];
  }

  function render() {
    const opts = options();
    if (status === null || !opts.some(o => o.value === status)) status = opts[1]?.value ?? '';
    const devices = Store.list('devices');
    const count = v => devices.filter(d => !v || Records.statusOf(d) === v).length;
    chipsEl.innerHTML = opts.map(o => `
      <button type="button" class="chip filter ${U.esc(o.tone)}${status === o.value ? ' on' : ''}" data-status="${U.esc(o.value)}"
        aria-pressed="${status === o.value}">${U.esc(o.label)}<span>${count(o.value)}</span></button>`).join('');

    const rows = Records.modelCounts(status);
    const total = rows.reduce((n, r) => n + r.count, 0);
    if (!devices.length) {
      bodyEl.innerHTML = '<p class="empty">還沒有設備<br>到「設備」新增</p>';
      return;
    }
    if (!rows.length) {
      bodyEl.innerHTML = `<p class="empty">沒有${U.esc(status)}的設備</p>`;
      return;
    }
    bodyEl.innerHTML = `
      <p class="overview-total"><b>${total}</b> 台<span>${U.esc(status || '全部')}・${rows.length} 種機型</span></p>
      <ul class="model-grid">${rows.map(r => {
        const inner = `<span class="model-name">${U.esc(r.model || '未填機型')}</span><span class="model-count">${r.count}</span>`;
        return r.model
          ? `<li><button type="button" class="model-cell" data-model="${U.esc(r.model)}">${inner}</button></li>`
          : `<li><div class="model-cell empty-model">${inner}</div></li>`;
      }).join('')}</ul>`;
  }

  chipsEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    status = btn.dataset.status;
    try { localStorage.setItem(KEY, status); } catch (_) {}
    render();
  });
  bodyEl.addEventListener('click', e => {
    const row = e.target.closest('[data-model]');
    if (row) onPick(status, row.dataset.model);
  });

  return { el, refresh: render, changed: render, reset: render };
}
