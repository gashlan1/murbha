/**
 * Murabaha — shared front-end runtime.
 *
 * Exposes window.App with:
 *   - api(method, path, body?)          → fetch wrapper, JSON in/out
 *   - me()                              → current user (cached) or null
 *   - requireAuth(redirect='/login')    → redirect if not logged in
 *   - logout()                          → clears session, redirects to /login
 *   - toast(msg, kind='info')           → bottom toast
 *   - fmt.sar(n), fmt.arNum(n), fmt.date(s)
 *   - storage (namespaced helpers)
 *   - on(selector, event, handler)      → delegated event listener
 *
 * Load on every page:  <script src="app.js" defer></script>
 */
(function () {
  'use strict';

  // ─── Tiny fetch wrapper ─────────────────────────────────────────
  const api = async (method, path, body) => {
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.message) || `HTTP ${res.status}`);
      err.code   = data?.error;
      err.status = res.status;
      err.data   = data;
      throw err;
    }
    return data;
  };

  // ─── Auth helpers ──────────────────────────────────────────────
  let _meCache = undefined;
  const me = async (force = false) => {
    if (!force && _meCache !== undefined) return _meCache;
    try {
      const { user } = await api('GET', '/api/auth/me');
      _meCache = user || null;
    } catch { _meCache = null; }
    return _meCache;
  };
  const meSync = () => _meCache;

  const requireAuth = async (redirect = '/login') => {
    const u = await me();
    if (!u) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.replace(`${redirect}?next=${next}`);
      return null;
    }
    return u;
  };

  const logout = async () => {
    try { await api('POST', '/api/auth/logout'); } catch {}
    _meCache = null;
    location.replace('/login');
  };

  // ─── Toast ─────────────────────────────────────────────────────
  let _toastEl = null;
  const _ensureToast = () => {
    if (_toastEl) return _toastEl;
    _toastEl = document.createElement('div');
    _toastEl.id = 'app-toast';
    Object.assign(_toastEl.style, {
      position: 'fixed', insetInlineStart: '50%', bottom: 'calc(env(safe-area-inset-bottom,0) + 24px)',
      transform: 'translateX(-50%) translateY(120%)',
      background: '#062b1e', color: '#fbf6ea', padding: '14px 22px',
      borderRadius: '14px', fontFamily: 'inherit', fontWeight: '700', fontSize: '14px',
      boxShadow: '0 12px 36px rgba(0,0,0,0.35)', zIndex: '99999',
      transition: 'transform .35s cubic-bezier(.2,.9,.2,1.2), opacity .35s',
      maxWidth: 'min(92vw, 460px)', textAlign: 'center', opacity: '0',
      pointerEvents: 'none', direction: 'rtl',
    });
    document.body.appendChild(_toastEl);
    return _toastEl;
  };
  let _toastTimer = null;
  const toast = (msg, kind = 'info') => {
    const el = _ensureToast();
    const palette = {
      info:    { bg: '#062b1e', fg: '#fbf6ea' },
      success: { bg: '#0f6e3a', fg: '#fbf6ea' },
      error:   { bg: '#8a1d1d', fg: '#fbf6ea' },
      warn:    { bg: '#7a5a10', fg: '#fbf6ea' },
    }[kind] || { bg: '#062b1e', fg: '#fbf6ea' };
    el.style.background = palette.bg;
    el.style.color      = palette.fg;
    el.textContent      = msg;
    el.style.transform  = 'translateX(-50%) translateY(0)';
    el.style.opacity    = '1';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      el.style.transform = 'translateX(-50%) translateY(120%)';
      el.style.opacity   = '0';
    }, 3200);
  };

  // ─── Formatters ────────────────────────────────────────────────
  const _arDigits = '٠١٢٣٤٥٦٧٨٩';
  const _isEn = () => (document.documentElement.lang || 'ar') === 'en';
  const arNum = (n) => _isEn() ? String(n) : String(n).replace(/\d/g, d => _arDigits[+d]);
  const sar = (n) => {
    if (typeof n !== 'number') n = Number(n) || 0;
    const s = Math.round(n).toLocaleString('en-US');
    return _isEn() ? ('SAR ' + s) : (arNum(s) + ' ر.س.');
  };
  const date = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const locale = _isEn() ? 'en-GB' : 'ar-SA';
      return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
    } catch { return iso; }
  };
  const dateTime = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const locale = _isEn() ? 'en-GB' : 'ar-SA';
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    } catch { return iso; }
  };
  const relTime = (iso) => {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (_isEn()) {
      if (diff < 60)      return 'just now';
      if (diff < 3600)    return Math.floor(diff / 60)    + ' min ago';
      if (diff < 86400)   return Math.floor(diff / 3600)  + ' hr ago';
      if (diff < 86400*7) return Math.floor(diff / 86400) + ' days ago';
      return date(iso);
    }
    if (diff < 60)       return 'منذ لحظات';
    if (diff < 3600)     return 'منذ ' + arNum(Math.floor(diff / 60))   + ' دقيقة';
    if (diff < 86400)    return 'منذ ' + arNum(Math.floor(diff / 3600)) + ' ساعة';
    if (diff < 86400*7)  return 'منذ ' + arNum(Math.floor(diff / 86400))+ ' يوم';
    return date(iso);
  };

  // ─── Namespaced storage ────────────────────────────────────────
  const storage = {
    get: (k, def = null) => {
      try { const v = localStorage.getItem('mrb_' + k); return v === null ? def : JSON.parse(v); }
      catch { return def; }
    },
    set: (k, v) => { try { localStorage.setItem('mrb_' + k, JSON.stringify(v)); } catch {} },
    del: (k)    => { try { localStorage.removeItem('mrb_' + k); } catch {} },
  };

  // ─── Delegated events ──────────────────────────────────────────
  const on = (selector, event, handler) => {
    document.addEventListener(event, (e) => {
      const target = e.target.closest(selector);
      if (target) handler(e, target);
    });
  };

  // ─── Query params ──────────────────────────────────────────────
  const qs = (k) => new URLSearchParams(location.search).get(k);

  // ─── HTML escape ───────────────────────────────────────────────
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])
  );

  // ─── Inject "logout" / "login" link into header if present ─────
  const _wireHeaderAuth = async () => {
    const user = await me();
    document.querySelectorAll('[data-auth="logged-in"]').forEach(el => {
      el.style.display = user ? '' : 'none';
    });
    document.querySelectorAll('[data-auth="logged-out"]').forEach(el => {
      el.style.display = user ? 'none' : '';
    });
    const displayName = user ? (user.full_name || user.name || user.username || '') : '';
    document.querySelectorAll('[data-bind="user.name"]').forEach(el => {
      if (user) el.textContent = displayName;
    });
    document.querySelectorAll('[data-bind="user.balance"]').forEach(el => {
      if (user) el.textContent = sar(user.balance || 0);
    });
    document.querySelectorAll('[data-bind="user.initial"]').forEach(el => {
      if (user) el.textContent = (displayName || '?').trim().charAt(0);
    });
  };

  // ─── data-action="logout" wiring ───────────────────────────────
  const _wireActions = () => {
    on('[data-action="logout"]', 'click', (e) => {
      e.preventDefault();
      logout();
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    _wireActions();
    _wireHeaderAuth();
  });

  window.App = {
    api, me, meSync, requireAuth, logout,
    toast,
    fmt: { sar, arNum, date, dateTime, relTime },
    storage, on, qs, escapeHtml,
    refreshHeader: _wireHeaderAuth,
  };
})();
