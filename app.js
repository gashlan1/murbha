/**
 * Murabaha — shared front-end runtime.
 *
 * Exposes window.App with:
 *   - api(method, path, body?)          → fetch wrapper, JSON in/out
 *   - me()                              → current user (cached) or null
 *   - requireAuth(redirect='/login.html')→ redirect if not logged in
 *   - logout()                          → clears session, redirects home
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
      const { user } = await api('GET', '/app/auth/me');
      _meCache = user || null;
    } catch { _meCache = null; }
    return _meCache;
  };
  const meSync = () => _meCache;

  const requireAuth = async (redirect = '/login.html') => {
    const u = await me();
    if (!u) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.replace(`${redirect}?next=${next}`);
      return null;
    }
    return u;
  };

  const logout = async () => {
    try { await api('POST', '/app/auth/logout'); } catch {}
    _meCache = null;
    location.replace('/hessa.html');
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
    return _isEn() ? (s + ' SAR') : (arNum(s) + ' ر.س.');
  };
  const date = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }).format(d);
    } catch { return iso; }
  };
  const dateTime = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
    } catch { return iso; }
  };
  const relTime = (iso) => {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
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
    document.querySelectorAll('[data-bind="user.name"]').forEach(el => {
      if (user) el.textContent = user.name;
    });
    document.querySelectorAll('[data-bind="user.balance"]').forEach(el => {
      if (user) el.textContent = sar(user.balance || 0);
    });
    document.querySelectorAll('[data-bind="user.initial"]').forEach(el => {
      if (user) el.textContent = (user.name || '?').trim().charAt(0);
    });
  };

  // ─── data-action="logout" wiring ───────────────────────────────
  const _wireActions = () => {
    on('[data-action="logout"]', 'click', (e) => {
      e.preventDefault();
      logout();
    });
  };

  // ─── Language Translation Toggle ──────────────────────────────────
  const _wireLangToggle = () => {
    const btn = document.getElementById('langToggle');
    if (!btn) return;
    const KEY = 'murbha.lang';
    const cur = btn.querySelector('.lang-current');
    const oth = btn.querySelector('.lang-other');

    function setLabels(lang) {
      if (!cur || !oth) return;
      if (lang === 'en') {
        cur.textContent = 'EN';
        oth.textContent = 'عربي';
      } else {
        cur.textContent = 'عربي';
        oth.textContent = 'EN';
      }
    }

    function cacheArabicText(node) {
      if (node.dataset.ar === undefined) node.dataset.ar = node.textContent;
    }
    function cacheArabicChildren(node) {
      if (node.__arChildren) return;
      node.__arChildren = Array.from(node.childNodes).map(n => n.cloneNode(true));
    }
    function replaceChildrenWithMarkup(node, markup) {
      const tpl = document.createElement('template');
      tpl.innerHTML = markup;
      node.replaceChildren(tpl.content);
    }

    function applyLang(lang) {
      const root = document.documentElement;
      root.lang = lang;
      root.dir = lang === 'en' ? 'ltr' : 'rtl';
      document.body && document.body.classList.toggle('lang-en', lang === 'en');

      document.querySelectorAll('[data-en]').forEach(node => {
        cacheArabicText(node);
        node.textContent = lang === 'en' ? node.dataset.en : node.dataset.ar;
      });
      document.querySelectorAll('[data-en-html]').forEach(node => {
        cacheArabicChildren(node);
        if (lang === 'en') {
          replaceChildrenWithMarkup(node, node.dataset.enHtml);
        } else {
          node.replaceChildren(...node.__arChildren.map(n => n.cloneNode(true)));
        }
      });

      document.querySelectorAll('[data-en-aria-label]').forEach(node => {
        if (node.dataset.arAriaLabel === undefined) node.dataset.arAriaLabel = node.getAttribute('aria-label') || '';
        node.setAttribute('aria-label', lang === 'en' ? node.dataset.enAriaLabel : node.dataset.arAriaLabel);
      });
      document.querySelectorAll('[data-en-placeholder]').forEach(node => {
        if (node.dataset.arPlaceholder === undefined) node.dataset.arPlaceholder = node.getAttribute('placeholder') || '';
        node.setAttribute('placeholder', lang === 'en' ? node.dataset.enPlaceholder : node.dataset.arPlaceholder);
      });
    }

    const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
    const initial = saved === 'en' ? 'en' : 'ar';
    setLabels(initial);
    if (initial === 'en') applyLang('en');

    btn.addEventListener('click', () => {
      const current = document.documentElement.lang === 'en' ? 'en' : 'ar';
      const next = current === 'ar' ? 'en' : 'ar';
      try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
      setLabels(next);
      applyLang(next);
      
      // Page specific rerenders if defined
      if (window.MurbhaLang && typeof window.MurbhaLang.rerenderProjects === 'function') {
        window.MurbhaLang.rerenderProjects();
      }
      if (typeof window.recalc === 'function') {
        const slider = document.getElementById('calcSlider');
        if (slider) window.recalc(+slider.value);
      }
    });

    window.MurbhaLang = window.MurbhaLang || {};
    window.MurbhaLang.reapply = () => applyLang(document.documentElement.lang === 'en' ? 'en' : 'ar');
  };

  document.addEventListener('DOMContentLoaded', () => {
    _wireActions();
    _wireHeaderAuth();
    _wireLangToggle();
  });

  window.App = {
    api, me, meSync, requireAuth, logout,
    toast,
    fmt: { sar, arNum, date, dateTime, relTime },
    storage, on, qs, escapeHtml,
    refreshHeader: _wireHeaderAuth,
  };
})();
