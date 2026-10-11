// 共用小工具：格式轉換、跳脫、產生 id
const U = {
  pad2(n) {
    return String(n).padStart(2, '0');
  },

  // 全形數字與符號轉半形（注音輸入法全形模式打出來的 ２，０００）
  toHalf(s) {
    return String(s).replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  },

  // 接受 2025/06/05、2025-6-5、2025.06.05、20250605，回傳 2025-06-05；格式不對回傳 null
  parseDate(s) {
    const t = U.toHalf(s).trim();
    const m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/) || t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return `${y}-${U.pad2(mo)}-${U.pad2(d)}`;
  },

  fmtDate(iso) {
    return iso ? String(iso).replace(/-/g, '/') : '';
  },

  // 今天（裝置的當地日期），格式 2026-10-03
  today() {
    const d = new Date();
    return `${d.getFullYear()}-${U.pad2(d.getMonth() + 1)}-${U.pad2(d.getDate())}`;
  },

  // 去掉千分位逗號與空白後轉成數字；不是數字回傳 null
  parseNum(s) {
    const t = U.toHalf(s).replace(/[,\s]/g, '');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
    return Number(t);
  },

  // 去掉浮點誤差（0.866 × 30000 會得到 25979.999999999996）
  round(n, digits = 4) {
    const p = 10 ** digits;
    return Math.round(n * p) / p;
  },

  // 千分位顯示；minDigits 為最少小數位，最多顯示 4 位
  fmtNum(n, minDigits = 0) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '';
    return n.toLocaleString('zh-TW', {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: Math.max(minDigits, 4),
    });
  },

  weekday(iso) {
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d) ? '' : `週${'日一二三四五六'[d.getDay()]}`;
  },

  // 依欄位型別轉成顯示用文字
  display(f, v) {
    if (f.format) return f.format(v);
    if (f.type === 'date') return U.fmtDate(v);
    if (f.type === 'number') return U.fmtNum(v, f.digits || 0);
    return v ?? '';
  },

  fmtDateTime(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}/${U.pad2(d.getMonth() + 1)}/${U.pad2(d.getDate())} ${U.pad2(d.getHours())}:${U.pad2(d.getMinutes())}`;
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  },

  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },
};
