// 清單：ref 欄位（設備的類別、位置、保管人…）從哪裡選、找得到找不到、新增、改名時一起改
//   被引用的表（狀態、選項、人員、廠商、設備、位置）在 schema 裡有 target（見 schema.js）；ref 欄位存的是名字，不是 id
//     設備、位置存的是系統給的編號（target 的 name 是 code），畫面上顯示 target 的 label（位置、名稱）
//   一個 ref 欄位的範圍（scope）：選項依「清單」分（類別、品牌…）；狀態、人員、廠商、設備、位置整張表都是
//   可以選好幾個的欄位（many，合約的位置）：存成「L0001、L0002」，每一個各自對到清單
const Refs = (() => {
  const TABLES = Object.keys(SCHEMAS);
  const targetOf = t => SCHEMAS[t]?.target || null;
  const isTarget = t => !!targetOf(t);

  // 比對名字：全形轉半形、去掉前後空白、英文不分大小寫
  const norm = v => U.toHalf(String(v ?? '')).trim().toLowerCase();
  // 可複選的欄位：「保管人、執行人」→ ['保管人', '執行人']
  const multi = v => String(v ?? '').split(/[、,，;；\n]+/).map(s => s.trim()).filter(Boolean);
  const byName = (a, b) => String(a).localeCompare(String(b), 'zh-Hant', { numeric: true });

  // 所有 ref 欄位：[{ table, field }]
  const refFields = () => TABLES.flatMap(table => SCHEMAS[table].fields.filter(f => f.type === 'ref').map(field => ({ table, field })));

  // 範圍的 key 和名稱：options:位置、people:；名稱用在「＋ 新增位置」「＋ 新增人員」、提醒的標題
  const scopeKey = f => `${f.ref}:${f.list || ''}`;
  const scopeName = f => (f.list || SCHEMAS[f.ref].title);

  // 這一筆屬於這個欄位的範圍嗎（位置清單裡的）
  function inScope(f, r) {
    const tg = targetOf(f.ref);
    return tg.group ? r[tg.group] === f.list : true;
  }

  const nameOf = (t, r) => String(r?.[targetOf(t).name] ?? '');
  // 畫面上寫的字：有 label 的（設備、位置）用 label，其他就是名字
  const labelOf = (t, r) => (targetOf(t).label ? String(targetOf(t).label(r) ?? '') : nameOf(t, r));
  const active = (t, r) => (targetOf(t).active ? targetOf(t).active(r) : true);
  // 欄位裡存的值：可以選好幾個的拆開（「L0001、L0002」→ ['L0001', 'L0002']），其他是一個
  const valuesOf = (f, v) => (f.many ? multi(v) : String(v ?? '').trim() ? [String(v).trim()] : []);

  // 排序：有 order 的（狀態）依順序，數字小的在前、沒填的在後；其他依畫面上寫的字（位置依名稱）
  function compare(t) {
    const key = targetOf(t).order;
    const num = r => (typeof r[key] === 'number' ? r[key] : Infinity);
    return (a, b) => (key && num(a) !== num(b) ? num(a) - num(b) : byName(labelOf(t, a), labelOf(t, b)));
  }

  // 下拉選單要列的：範圍內、沒停用的（all 為 true 時連停用的也列）
  //   欄位有 rank 的（異動的新位置：空的位置在最上面）先依它排，同一級再照平常的排法
  //   values 是表單目前填的內容：欄位有 only 的依它只列一部分（異動依類型）；all 為 true 時不篩
  function items(f, { all = false, values = null } = {}) {
    const rank = f.rank ? f.rank() : () => 0;
    const only = !all && values && f.only ? f.only(values) : null;
    const cmp = compare(f.ref);
    return Store.list(f.ref)
      .filter(r => inScope(f, r) && (all || active(f.ref, r)) && nameOf(f.ref, r) && (!only || only(r)))
      .sort((a, b) => rank(a) - rank(b) || cmp(a, b));
  }

  // 依名字找（停用的也找得到：舊資料照常認得）
  function find(f, name) {
    const n = norm(name);
    if (!n) return null;
    return items(f, { all: true }).find(r => norm(nameOf(f.ref, r)) === n) || null;
  }

  // 名字後面的小字（職稱、部門；聯絡人、電話）、標籤的顏色（狀態）
  const sub = (t, r) => (targetOf(t).sub ? targetOf(t).sub(r) : '');
  const tone = (t, r) => (r && targetOf(t)?.tone ? targetOf(t).tone(r) : '');

  // 一筆空白的資料：每個欄位都有值（有預設值的用預設值，其他文字是 ''、數字和日期是 null、勾選是 false）
  function blankRecord(t) {
    return Object.fromEntries(SCHEMAS[t].fields.map(f => [f.key,
      f.default !== undefined && typeof f.default !== 'function' ? f.default
        : f.type === 'number' || f.type === 'date' ? null : f.type === 'flag' ? false : '']));
  }

  // 表單裡點「＋ 新增」：馬上加進清單（選項加進那一份清單）
  //   位置：打的字是名稱（target 的 addAs），編號由系統給（schema 的 auto）
  function quickAdd(f, name) {
    const tg = targetOf(f.ref);
    const rec = { ...blankRecord(f.ref), [tg.addAs || tg.name]: String(name).trim() };
    if (tg.group) rec[tg.group] = f.list;
    SCHEMAS[f.ref].fields.forEach(x => { if (x.auto && !rec[x.key]) rec[x.key] = x.auto(rec); });
    return Store.add(f.ref, rec);
  }

  // 指到這張表的 ref 欄位：[{ table, field }]
  const refsTo = t => refFields().filter(({ field }) => field.ref === t);

  // 用到這一筆的資料（名字一樣、而且在那個欄位的範圍內）：[{ table, id, key }]
  function usesOf(t, rec) {
    const n = norm(nameOf(t, rec));
    if (!n) return [];
    return refsTo(t)
      .filter(({ field }) => inScope(field, rec))
      .flatMap(({ table, field }) => Store.list(table)
        .filter(r => valuesOf(field, r[field.key]).some(v => norm(v) === n))
        .map(r => ({ table, id: r.id, key: field.key })));
  }

  // 「3 台設備」；同一台設備在兩個欄位用到只算一次
  function usesText(t, rec) {
    const list = usesOf(t, rec);
    return TABLES.map(table => [table, new Set(list.filter(u => u.table === table).map(u => u.id)).size])
      .filter(([, n]) => n)
      .map(([table, n]) => `${n} ${SCHEMAS[table].unit || `筆${SCHEMAS[table].title}`}`)
      .join('、');
  }

  // 刪除前檢查：有人在用就不能刪，回傳原因；可以刪時回傳空字串
  function removeBlock(t, rec) {
    const text = usesText(t, rec);
    return text ? `還有 ${text}用到「${labelOf(t, rec)}」，不能刪除。${targetOf(t).removeHint || ''}` : '';
  }

  // 改名：用到舊名字的資料一起改成新名字；回傳改到的 [{ table, id }]
  //   before、after 是同一筆改名前後（在 App 裡改的，或在試算表裡改、同步時讀回來的）
  //   範圍跟著改名前的（例如位置清單裡的「3F」改名，只改位置欄位）
  function renameRefs(t, before, after) {
    if (!before || !after || nameOf(t, before) === nameOf(t, after) || !nameOf(t, after)) return [];
    const next = nameOf(t, after);
    const old = norm(nameOf(t, before));
    const changed = new Map();
    usesOf(t, before).forEach(({ table, id, key }) => {
      const k = `${table}:${id}`;
      const field = SCHEMAS[table].fields.find(f => f.key === key);
      const value = field.many ? valuesOf(field, Store.get(table, id)[key]).map(v => (norm(v) === old ? next : v)).join('、') : next;
      changed.set(k, { table, id, patch: { ...(changed.get(k)?.patch || {}), [key]: value } });
    });
    changed.forEach(({ table, id, patch }) => Store.update(table, id, patch));
    return [...changed.values()].map(({ table, id }) => ({ table, id }));
  }

  // 用過、但不在清單裡的值（在試算表裡手打的、清單功能做好之前填的）：[{ key, ref, name, field, values }]
  //   每個範圍一組；同一個範圍有好幾個欄位時合在一起
  //   存編號的（紀錄的設備欄、位置）不算：打的字不能當編號加進清單；找不到的另外提醒（見 records.js 的 orphans、lostPlaces）
  function missing() {
    const scopes = new Map();
    refFields().filter(({ field }) => !targetOf(field.ref).noAdd && !targetOf(field.ref).label).forEach(({ table, field }) => {
      const key = scopeKey(field);
      if (!scopes.has(key)) scopes.set(key, { key, ref: field.ref, name: scopeName(field), field, values: new Set() });
      Store.list(table).forEach(r => {
        valuesOf(field, r[field.key]).forEach(v => { if (!find(field, v)) scopes.get(key).values.add(v); });
      });
    });
    return [...scopes.values()].filter(s => s.values.size).map(s => ({ ...s, values: [...s.values].sort(byName) }));
  }

  // 把這個範圍用過、但不在清單裡的值一次加進來；回傳加了幾個
  function importMissing(key) {
    const s = missing().find(x => x.key === key);
    if (!s) return 0;
    s.values.forEach(v => quickAdd(s.field, v));
    return s.values.length;
  }

  // 設定裡的「清單」：每一份清單一列（狀態一列，選項依清單分，人員、廠商各一列）
  //   sortable：可以在清單頁用 ↑ ↓ 排順序（狀態、SORTED_LISTS 裡的選項）
  function lists() {
    const options = OPTION_LISTS.map(list => ({ key: `options:${list}`, table: 'options', list, title: list, sortable: SORTED_LISTS.includes(list) }));
    return [
      { key: 'statuses', table: 'statuses', title: SCHEMAS.statuses.title, sortable: true },
      // 位置排在類別後面（以前在選項裡也是這個順序）
      ...options.slice(0, 1),
      { key: 'locations', table: 'locations', title: SCHEMAS.locations.title },
      ...options.slice(1),
      { key: 'people', table: 'people', title: SCHEMAS.people.title },
      { key: 'vendors', table: 'vendors', title: SCHEMAS.vendors.title },
    ];
  }

  // 這份清單裡的資料，和下拉選單同一個順序（停用的排在後面）
  function listItems(l) {
    const cmp = compare(l.table);
    return Store.list(l.table)
      .filter(r => !l.list || r.list === l.list)
      .sort((a, b) => (active(l.table, b) - active(l.table, a)) || cmp(a, b));
  }

  // 排序：把這份清單裡的一項往前（dir 是 -1）或往後（+1）移一格，沒停用的重新編成 1、2、3…（停用的排在後面）
  //   只改順序有變的；回傳有沒有移動
  function move(l, id, dir) {
    const key = targetOf(l.table).order;
    const all = listItems(l);
    const on = all.filter(r => active(l.table, r));
    const i = on.findIndex(r => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= on.length) return false;
    [on[i], on[j]] = [on[j], on[i]];
    [...on, ...all.filter(r => !active(l.table, r))].forEach((r, k) => {
      if (r[key] !== k + 1) Store.update(l.table, r.id, { [key]: k + 1 });
    });
    return true;
  }

  // 範圍的 key（options:位置、people:）對到設定裡的哪一份清單
  const listOfScope = key => lists().find(l => l.key === key || l.key === key.split(':')[0]) || null;

  return {
    isTarget, targetOf, norm, multi, inScope, items, find, nameOf, labelOf, valuesOf, active, sub, tone, blankRecord, quickAdd,
    refsTo, usesOf, usesText, removeBlock, renameRefs, missing, importMissing, scopeKey, scopeName, lists, listItems, move, listOfScope,
  };
})();
