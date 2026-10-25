// 資料存放：瀏覽器 localStorage，另可匯出／匯入 data.json
//   連結 Google 試算表時（見 sync.js）：試算表是正本，這裡是副本
//     每次修改都記在待同步清單（哪張表的哪一筆、新增修改或刪除），同步成功後清掉
//     onChange() 註冊的函式在每次修改後立刻呼叫（還在使用者點擊的當下，可以跳出登入視窗）
//   版本號（version）：資料每改一次加 1；records.js 一次整理好的資料（每台設備的紀錄…）看它要不要重新整理
const Store = (() => {
  const PREFIX = 'devmgr.'; // 這台裝置上存的東西都用這個開頭（和同一個網址底下的其他 App 分開，登出時一起清掉）
  const KEY = `${PREFIX}v1`;
  const SYNC_KEY = `${PREFIX}sync`;
  const TABLES = Object.keys(SCHEMAS);
  let available = true;

  // 全新的資料；有 seed 的表（類別的預設項目）先放好
  //   toner：匯入的 data.json 裡的最新回報（假資料用；連結 Google 時用試算表「最新回報」分頁的，見 sync.js）
  function blank() {
    const d = { version: 1, lastExportAt: null, toner: null };
    TABLES.forEach(t => { d[t] = SCHEMAS[t].seed ? SCHEMAS[t].seed() : []; });
    return d;
  }

  // 只整理結構（確保每張表是陣列、每筆有 id），不檢查內容
  function normalize(d) {
    const out = blank();
    if (d && typeof d === 'object') {
      TABLES.forEach(t => {
        if (Array.isArray(d[t])) {
          out[t] = d[t]
            .filter(r => r && typeof r === 'object')
            .map(r => ({ ...r, id: r.id || U.uid() }));
        }
      });
      if (d.lastExportAt) out.lastExportAt = d.lastExportAt;
      if (Array.isArray(d.toner)) out.toner = d.toner.filter(r => r && typeof r === 'object');
    }
    return out;
  }

  function load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      available = false;
      return blank();
    }
    if (!raw) return blank();
    try {
      return normalize(JSON.parse(raw));
    } catch (e) {
      // 資料損毀時先另存原始內容，避免被覆蓋
      try { localStorage.setItem(`${KEY}.broken.${Date.now()}`, raw); } catch (_) {}
      alert('瀏覽器內的資料無法讀取，已另存一份原始內容，目前以空白資料開始。');
      return blank();
    }
  }

  function persist() {
    if (!available) return false;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
      return true;
    } catch (e) {
      alert(`儲存失敗：${e.message}\n請先匯出 data.json 備份。`);
      return false;
    }
  }

  let data = load();

  // ---------- 待同步清單 ----------
  // pending：{ 表: { id: { del, v } } }，v 是遞增的版本號
  //   同步開始時先拍一份快照，結束後只清掉版本號沒變的（同步途中又改過的留到下一次）
  // full：匯入資料後整份要重寫
  function loadSync() {
    try {
      const s = JSON.parse(localStorage.getItem(SYNC_KEY));
      if (s && typeof s.pending === 'object') return { pending: s.pending, v: s.v || 0, full: !!s.full };
    } catch (_) {}
    return { pending: {}, v: 0, full: false };
  }
  let sync = loadSync();

  function mark(table, id, del = false) {
    (sync.pending[table] ||= {})[id] = { del, v: ++sync.v };
  }

  const listeners = [];
  let version = 0;
  const changed = () => { version++; listeners.forEach(fn => fn()); };

  return {
    PREFIX,
    get available() { return available; },
    get version() { return version; },

    list(table) {
      return data[table];
    },

    add(table, rec) {
      const r = { id: U.uid(), ...rec };
      data[table].push(r);
      mark(table, r.id);
      persist();
      changed();
      return r;
    },

    update(table, id, rec) {
      const i = data[table].findIndex(r => r.id === id);
      if (i < 0) return;
      data[table][i] = { ...data[table][i], ...rec, id };
      mark(table, id);
      persist();
      changed();
    },

    remove(table, id) {
      data[table] = data[table].filter(r => r.id !== id);
      mark(table, id, true);
      persist();
      changed();
    },

    get(table, id) {
      return data[table].find(r => r.id === id);
    },

    // 預先放的資料（seed- 開頭的 id），而且還沒改過：不算這台裝置的資料（連結雲端時不會因此詢問要不要存過去）
    isPristineSeed(table, r) {
      return String(r.id).startsWith('seed-') && !sync.pending[table]?.[r.id];
    },

    // 這台裝置上自己的資料有幾筆（不算沒改過的預設項目）
    ownCount() {
      return TABLES.reduce((n, t) => n + data[t].filter(r => !this.isPristineSeed(t, r)).length, 0);
    },

    // ---------- 匯出／匯入 ----------
    exportPayload() {
      const p = { app: 'devicemanager', version: 1, exportedAt: new Date().toISOString() };
      TABLES.forEach(t => { p[t] = data[t]; });
      if (data.toner) p.toner = data.toner;
      return p;
    },

    toner() {
      return data.toner;
    },

    lastExportAt() {
      return data.lastExportAt;
    },

    markExported() {
      data.lastExportAt = new Date().toISOString();
      persist();
    },

    // 檔案裡至少要有一張表才算是備份檔；回傳整理後的資料或 null
    parseImport(obj) {
      if (!obj || typeof obj !== 'object' || !TABLES.some(t => Array.isArray(obj[t]))) return null;
      return normalize(obj);
    },

    // 登出：清掉這台裝置上這個 App 存的所有東西（資料、待同步清單、提醒、登入資訊、壞掉時留的備份）
    //   之後由 app.js 重新載入頁面
    wipe() {
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        keys.filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
      } catch (_) {}
      data = blank();
      sync = { pending: {}, v: 0, full: false };
      version++;
    },

    // 匯入 data.json、以 Google 為主：加入檔案裡這台沒有的（[{ table, rec }]，見 records.js 的 fileOnly），標成待同步
    addAll(items) {
      items.forEach(({ table, rec }) => {
        data[table].push(rec);
        mark(table, rec.id);
      });
      persist();
      changed();
    },

    replaceAll(parsed) {
      const lastExportAt = data.lastExportAt;
      data = normalize(parsed);
      data.lastExportAt = lastExportAt;
      sync = { pending: {}, v: sync.v, full: true };
      persist();
      changed();
    },

    // ---------- 同步（sync.js 使用） ----------
    onChange(fn) {
      listeners.push(fn);
    },

    // 還沒同步的筆數；匯入後整份要重寫時是全部的筆數
    pendingCount() {
      if (sync.full) return TABLES.reduce((n, t) => n + data[t].length, 0);
      return Object.values(sync.pending).reduce((n, ids) => n + Object.keys(ids).length, 0);
    },

    pendingSnapshot() {
      const items = Object.entries(sync.pending).flatMap(([table, ids]) =>
        Object.entries(ids).map(([id, p]) => ({ table, id, del: p.del, v: p.v })));
      return { full: sync.full, items };
    },

    // 同步成功後清掉快照裡、之後沒有再改過的項目；tables 有給時只清這幾張表
    clearPending(snap, tables = null) {
      snap.items.forEach(({ table, id, v }) => {
        if (tables && !tables.includes(table)) return;
        if (sync.pending[table]?.[id]?.v === v) delete sync.pending[table][id];
      });
      if (snap.full && !tables) sync.full = false;
      persist();
    },

    // 標成要寫回試算表（試算表裡被刪掉、但使用者選擇保留的資料）
    markPending(items) {
      items.forEach(({ table, id }) => mark(table, id));
      persist();
    },

    clearAllPending() {
      sync = { pending: {}, v: sync.v, full: false };
      persist();
    },

    // 以試算表的資料為主，疊上還沒同步的修改；keep 裡的表（試算表那邊缺分頁或缺欄位）整張保留這裡的資料
    //   missing：{ 表: [欄位] } 試算表上沒有這一欄（新版加的欄位、被刪掉的欄），這幾個欄位用這裡的值
    mergeRemote(remote, keep = [], missing = {}) {
      const out = normalize(remote);
      TABLES.forEach(t => {
        if (keep.includes(t)) { out[t] = data[t]; return; }
        (missing[t] || []).forEach(key => {
          out[t].forEach(r => {
            const local = data[t].find(x => x.id === r.id);
            if (local && !(key in r)) r[key] = local[key];
          });
        });
        Object.entries(sync.pending[t] || {}).forEach(([id, p]) => {
          const i = out[t].findIndex(r => r.id === id);
          if (p.del) {
            if (i >= 0) out[t].splice(i, 1);
            return;
          }
          const local = this.get(t, id);
          if (!local) return;
          if (i >= 0) out[t][i] = local;
          else out[t].push(local);
        });
      });
      out.lastExportAt = data.lastExportAt;
      out.toner = data.toner;
      data = normalize(out);
      version++;
      persist();
    },

    // 改用試算表的資料（連結時選了雲端那一份），這台裝置的修改全部放棄
    loadRemote(remote) {
      const { lastExportAt, toner } = data;
      data = normalize(remote);
      Object.assign(data, { lastExportAt, toner });
      sync = { pending: {}, v: sync.v, full: false };
      version++;
      persist();
    },
  };
})();
