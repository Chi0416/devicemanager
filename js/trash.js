// 回收桶：刪掉的資料放在「回收桶」表（試算表的回收桶分頁）90 天，可以還原
//   放進來：在 App 裡刪的（連同一起刪的紀錄同一組，見 form.js），在試算表或其他裝置上刪的（同步時發現少了，一次同步的同一組，見 sync.js）
//   還原：整組放回去（id 不變）；別的資料已經用了同樣的編號、名稱，或紀錄的設備不在了，就不還原，寫原因
//   清掉：超過 90 天的打開 App 時自動清；總部可以永久刪除一組、清空；改全部的只能還原；業務員看不到
//   回收桶本身的資料不會再放進回收桶
const Trash = (() => {
  const DAYS = 90;
  const SHEET = '試算表'; // 在試算表裡刪的：刪除的人寫這個

  const key = v => String(v ?? '').trim().toUpperCase();
  const time = at => new Date(String(at ?? '').replace(/-/g, '/')).getTime() || 0;
  const parse = s => { try { return JSON.parse(s); } catch (_) { return null; } };

  // 誰刪的：連結 Google 的寫帳號（業務員寫姓名），只存在這台的空白
  function who() {
    const st = typeof Sync === 'undefined' ? {} : Sync.state();
    return st.linked ? st.salesName || st.email || '' : '';
  }

  // 放進回收桶：items [{ table, rec }]，第一筆是這組的標題（使用者刪的那一筆）；回傳放進去的 [{ table: 'trash', id }]
  //   已經在回收桶裡的（同一張表、同一個 id）不再放
  function put(items, by = who()) {
    const have = new Set(Store.list('trash').map(e => `${e.table}:${e.rid}`));
    const list = items.filter(i => i.table !== 'trash' && SCHEMAS[i.table] && !have.has(`${i.table}:${i.rec.id}`));
    if (!list.length) return [];
    const at = U.fmtDateTime(new Date().toISOString());
    const group = U.uid();
    return list.map((i, n) => {
      const e = Store.add('trash', {
        id: n ? U.uid() : group, at, what: Sync.describe(i.table, i.rec), by,
        table: i.table, rid: i.rec.id, group, data: JSON.stringify(i.rec),
      });
      return { table: 'trash', id: e.id };
    });
  }

  // 在 App 裡刪一筆（表單的刪除，見 form.js）：連同處理的（見 refs.js 的 removeWith）、afterRemove 刪的一起放進回收桶，這一筆排第一
  function remove(table, rec, along = SCHEMAS[table].target ? Refs.removeAlong(table, rec) : []) {
    const removed = Store.capture(() => {
      Refs.removeWith(table, rec, along);
      Store.remove(table, rec.id);
      SCHEMAS[table].afterRemove?.(rec);
    });
    return put([{ table, rec }, ...removed.filter(x => !(x.table === table && x.rec.id === rec.id))]);
  }

  // 在試算表裡刪的（同步時這台跟著刪，見 sync.js 的 keepOrDelete）：一次同步發現的同一組
  const fromSheet = items => put(items, SHEET);

  // 一組一項，新的在前：{ id, head（標題那一筆）, list（整組）, at, by }
  function groups() {
    const by = new Map();
    Store.list('trash').forEach(e => {
      if (!by.has(e.group)) by.set(e.group, []);
      by.get(e.group).push(e);
    });
    // 同一分鐘刪的：後刪的在前
    return [...by.entries()].reverse()
      .map(([id, list]) => {
        const head = list.find(e => e.id === id) || list[0];
        return { id, head, list, at: head.at, by: head.by };
      })
      .sort((a, b) => time(b.at) - time(a.at));
  }

  // 不能還原的原因；可以時回傳空字串
  function blocked(recs) {
    for (const { table, rec } of recs) {
      for (const keys of SCHEMAS[table].unique || []) {
        if (keys.every(k => !key(rec[k]))) continue;
        const dup = Store.list(table).find(r => r.id !== rec.id && keys.every(k => key(r[k]) === key(rec[k])));
        if (dup) return `${SCHEMAS[table].title}已經有「${keys.map(k => rec[k]).filter(Boolean).join(' ')}」了，不能還原`;
      }
    }
    const codes = new Set([...Store.list('devices'), ...recs.filter(x => x.table === 'devices').map(x => x.rec)].map(d => key(d.code)));
    const lost = recs.find(x => x.table !== 'devices' && key(x.rec.device) && !codes.has(key(x.rec.device)));
    return lost ? `設備 ${lost.rec.device} 已經不在了，要先還原那台設備` : '';
  }

  // 整組放回去；回傳 { count: 放回幾筆 } 或 { error }
  //   已經有的（同一個 id，例如別台還原過）跳過；這組在回收桶裡的都拿掉（重複放進來的也拿掉）
  function restore(group) {
    const list = Store.list('trash').filter(e => e.group === group);
    if (!list.length) return { error: '回收桶裡已經沒有這筆了' };
    const recs = list.map(e => ({ table: e.table, rec: parse(e.data) }))
      .filter(x => SCHEMAS[x.table] && x.rec?.id && !Store.get(x.table, x.rec.id));
    const error = blocked(recs);
    if (error) return { error };
    recs.forEach(({ table, rec }) => Store.add(table, rec));
    // 設備的位置照異動算（見 records.js）
    if (recs.some(x => x.table === 'devices' || x.table === 'moves')) Records.syncLocations();
    const back = new Set(list.map(e => `${e.table}:${e.rid}`));
    Store.list('trash').filter(e => back.has(`${e.table}:${e.rid}`)).forEach(e => Store.remove('trash', e.id));
    return { count: recs.length };
  }

  // 永久刪除一組
  function drop(group) {
    Store.list('trash').filter(e => e.group === group).forEach(e => Store.remove('trash', e.id));
  }

  function clear() {
    [...Store.list('trash')].forEach(e => Store.remove('trash', e.id));
  }

  // 超過 90 天的清掉（打開 App 時）；回傳清掉幾筆
  function purge(now = Date.now()) {
    const old = Store.list('trash').filter(e => now - time(e.at) > DAYS * 864e5);
    old.forEach(e => Store.remove('trash', e.id));
    return old.length;
  }

  // ---------- 設定的「回收桶」頁 ----------
  //   canDrop：總部（和只存在這台的）可以永久刪除、清空；改全部的只能還原
  function render(el, { canDrop }) {
    const all = groups();
    const items = all.map(g => {
      const more = g.list.length - 1;
      const by = g.by === SHEET ? '在試算表或其他裝置上刪的' : g.by ? `${g.by} 刪的` : '';
      const sub = [g.at, by, more > 0 && `連同 ${more} 筆`].filter(Boolean).join('・');
      return `<li>
        <span class="member-info"><b>${U.esc(g.head.what || SCHEMAS[g.head.table]?.title || '')}</b><small>${U.esc(sub)}</small></span>
        <span class="trash-btns">
          <button type="button" class="text-btn" data-restore="${U.esc(g.id)}">還原</button>
          ${canDrop ? `<button type="button" class="text-btn danger" data-drop="${U.esc(g.id)}">永久刪除</button>` : ''}
        </span>
      </li>`;
    }).join('');
    el.innerHTML = `
      <p class="note muted cloud-intro">刪掉的資料放在這裡 ${DAYS} 天，過了自動清掉。還原時連同一起刪的紀錄放回去。</p>
      ${all.length ? `<ul class="member-list">${items}</ul>` : '<p class="muted">回收桶是空的</p>'}
      ${canDrop && all.length ? '<button type="button" class="wide-btn danger" data-act="clear-trash">清空回收桶</button>' : ''}`;
  }

  return { DAYS, SHEET, remove, put, fromSheet, groups, restore, drop, clear, purge, render };
})();
