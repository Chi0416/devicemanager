// Google 登入與 API
//   權限只要 drive.file：只能存取這個 App 自己建立的檔案，碰不到使用者雲端硬碟裡的其他檔案
//   登入用 Google 的彈出視窗；彈出視窗打不開時改成整頁跳轉到 Google，登入後帶著權杖跳回來
//   權杖有效 1 小時，存在這台裝置；過期後要使用者點一下才能重新取得（瀏覽器只允許點擊時跳出視窗）
const Google = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const TOKEN_KEY = 'devmgr.google.token';
  const STATE_KEY = 'devmgr.google.state';
  const AFTER_KEY = 'devmgr.google.after';
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
  const DRIVE = 'https://www.googleapis.com/drive/v3';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };

  // code：need_login（要重新登入）、network、not_found、popup_closed、popup_failed_to_open 等
  class GoogleError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  const ERRORS = {
    popup_failed_to_open: '登入視窗打不開',
    popup_closed: '登入視窗被關掉了',
    access_denied: '沒有允許存取，所以無法連結',
    not_loaded: 'Google 登入元件還沒載入，請確認網路後再試一次',
  };
  const errorText = code => ERRORS[code] || `Google 登入失敗（${code}）`;

  // ---------- 權杖 ----------
  let token = null; // { accessToken, expiresAt }
  try { token = JSON.parse(store.get(TOKEN_KEY)); } catch (_) {}

  // 剩不到 1 分鐘就當作過期，避免同步到一半失效
  const hasToken = () => !!token && token.expiresAt > Date.now() + 60000;

  function saveToken(accessToken, expiresIn) {
    token = { accessToken, expiresAt: Date.now() + Number(expiresIn) * 1000 };
    store.set(TOKEN_KEY, JSON.stringify(token));
  }

  function clearToken() {
    token = null;
    store.del(TOKEN_KEY);
  }

  // ---------- 彈出視窗登入 ----------
  let client = null;
  let waiting = null; // { resolve, reject }

  const ready = () => !!window.google?.accounts?.oauth2;
  // 還沒設定 OAuth 用戶端 ID（見 config.js）時不能登入
  const configured = () => !!CONFIG.googleClientId;

  function settle(err) {
    const w = waiting;
    waiting = null;
    if (w) err ? w.reject(err) : w.resolve();
  }

  // 一定要在使用者點擊的當下呼叫（中間不能有 await），否則瀏覽器會擋掉彈出視窗
  // hint：上次登入的帳號（不用再選帳號）；沒有時讓使用者選帳號
  function requestToken({ hint = '' } = {}) {
    return new Promise((resolve, reject) => {
      if (!configured()) {
        reject(new GoogleError('雲端同步還沒設定', 'not_configured'));
        return;
      }
      if (!ready()) {
        reject(new GoogleError(errorText('not_loaded'), 'not_loaded'));
        return;
      }
      if (!client) {
        client = google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.googleClientId,
          scope: SCOPE,
          callback(r) {
            if (r.error) return settle(new GoogleError(errorText(r.error), r.error));
            if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
              return settle(new GoogleError('沒有勾選存取雲端硬碟的權限，請再試一次並允許', 'scope'));
            }
            saveToken(r.access_token, r.expires_in);
            settle();
          },
          error_callback(e) {
            settle(new GoogleError(errorText(e.type), e.type));
          },
        });
      }
      settle(new GoogleError('已重新開始登入', 'superseded'));
      waiting = { resolve, reject };
      client.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: 'select_account' });
    });
  }

  // ---------- 整頁跳轉登入（彈出視窗打不開時） ----------
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');

  // after：跳回來之後要接著做的事（'link' 或 'sync'）
  function redirectLogin({ hint = '', after = '' } = {}) {
    if (!configured()) return;
    const state = U.uid();
    store.set(STATE_KEY, state);
    store.set(AFTER_KEY, after);
    const p = new URLSearchParams({
      client_id: CONFIG.googleClientId,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: SCOPE,
      include_granted_scopes: 'true',
      state,
    });
    if (hint) p.set('login_hint', hint);
    else p.set('prompt', 'select_account');
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
  }

  // 從 Google 跳回來時網址 # 後面帶著權杖或錯誤；回傳 { after } 或 { error }，不是跳回來的回傳 null
  function consumeRedirect() {
    if (!/(^#|&)(access_token|error)=/.test(location.hash)) return null;
    const h = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    const expected = store.get(STATE_KEY);
    const after = store.get(AFTER_KEY) || '';
    store.del(STATE_KEY);
    store.del(AFTER_KEY);
    if (h.get('error')) return { error: errorText(h.get('error')) };
    if (!expected || h.get('state') !== expected) return { error: '登入後跳回來時對不上原本的頁面，請再試一次' };
    if (!(h.get('scope') || '').split(' ').includes(SCOPE)) return { error: '沒有勾選存取雲端硬碟的權限，請再試一次並允許' };
    saveToken(h.get('access_token'), h.get('expires_in'));
    return { after };
  }

  // ---------- API ----------
  async function api(url, { method = 'GET', body } = {}) {
    if (!hasToken()) throw new GoogleError('需要重新連線 Google', 'need_login');
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token.accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_) {
      throw new GoogleError('連不上網路，請確認網路後再試一次', 'network');
    }
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) {}
    if (res.status === 401) {
      clearToken();
      throw new GoogleError('需要重新連線 Google', 'need_login');
    }
    if (!res.ok) {
      const msg = json.error?.message || text.slice(0, 120);
      throw new GoogleError(`Google 回應錯誤（${res.status}）：${msg}`, res.status === 404 ? 'not_found' : 'api');
    }
    return json;
  }

  // 試算表上的程式（網頁應用程式，業務員向總部拿資料）：帶著權杖 POST 過去，回傳程式回的 JSON
  //   不加標題（是 text/plain），瀏覽器不用先問能不能跨網域；程式說登入過期時清掉權杖，要使用者重新登入
  async function script(url, data) {
    if (!hasToken()) throw new GoogleError('需要重新連線 Google', 'need_login');
    let res;
    try {
      res = await fetch(url, { method: 'POST', body: JSON.stringify({ ...data, token: token.accessToken }) });
    } catch (_) {
      throw new GoogleError('連不上網路，請確認網路後再試一次', 'network');
    }
    let json;
    try { json = await res.json(); } catch (_) {
      // 回來的不是 JSON：網址不對，或部署時「誰可以存取」不是「任何人」（Google 回登入頁）
      throw new GoogleError('總部的網址打不開，請找管理員確認試算表上的程式有部署好', 'api');
    }
    if (json.login) {
      clearToken();
      throw new GoogleError(json.error || '需要重新連線 Google', 'need_login');
    }
    return json;
  }

  // 取消連結、登出：撤銷這次的授權，下次連結時會重新詢問
  //   回傳的 Promise 在 Google 回覆後完成（最多等 3 秒），登出時等它再清資料、重新載入頁面
  function signOut() {
    const t = token;
    clearToken();
    if (!t || !ready()) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      const done = () => { clearTimeout(timer); resolve(); };
      try { google.accounts.oauth2.revoke(t.accessToken, done); } catch (_) { done(); }
    });
  }

  return { SHEETS, DRIVE, ready, configured, hasToken, requestToken, redirectLogin, consumeRedirect, api, script, signOut };
})();
