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

  // ─── CSRF helper ────────────────────────────────────────────────
  const _readCookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  };
  // One-time bootstrap: ensure the CSRF cookie is set before any state-changing call.
  let _csrfReady = null;
  const _ensureCsrf = async () => {
    if (_readCookie('mrb_csrf')) return;
    if (!_csrfReady) {
      _csrfReady = fetch('/healthz', { credentials: 'same-origin' }).catch(() => {});
    }
    await _csrfReady;
  };

  // ─── Platform settings auto-populate ────────────────────────────
  // Any element with data-setting="path" gets its textContent replaced
  // with the live value from /app/settings. Path is dot-delimited:
  //   data-setting="support.hotline"  → settings.support.hotline
  //   data-setting="social.twitter"   → settings.social.twitter
  // Tel/mailto hrefs containing the same path get their href rewritten too.
  let _settingsCache = null;
  const _fetchSettings = async () => {
    if (_settingsCache) return _settingsCache;
    try {
      const r = await fetch('/app/settings', { credentials: 'same-origin' });
      if (r.ok) _settingsCache = await r.json();
    } catch (e) {}
    return _settingsCache;
  };
  const _readPath = (obj, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
  const _applySettings = (settings) => {
    if (!settings) return;
    document.querySelectorAll('[data-setting]').forEach(el => {
      const v = _readPath(settings, el.dataset.setting);
      if (v !== undefined && v !== null && v !== '') {
        el.textContent = v;
        // If the element is inside an <a href="tel:..."> or mailto, update the href too
        const link = el.closest('a[href^="tel:"], a[href^="mailto:"]');
        if (link) {
          const prefix = link.href.startsWith('tel:') ? 'tel:' : 'mailto:';
          link.href = prefix + v;
        }
      }
    });
  };
  if (typeof document !== 'undefined') {
    const _run = async () => _applySettings(await _fetchSettings());
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _run);
    else _run();
  }

  // ─── A11y: focus trap helper for modals + sheets ────────────────
  // Usage:
  //   const release = App.trapFocus(modalEl);
  //   // ...later when closing:
  //   release();
  // Captures Tab + Shift+Tab inside the root, restores prior focus and
  // unbinds on release. Also closes on Esc when an onClose is given.
  const trapFocus = (root, { onClose } = {}) => {
    const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const prev = document.activeElement;
    document.body.classList.add('modal-open');
    const focusables = () => Array.from(root.querySelectorAll(FOCUSABLE)).filter(el => el.offsetParent !== null);
    const first = focusables()[0];
    if (first) first.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables(); if (!list.length) return;
      const f = list[0], l = list[list.length - 1];
      if (e.shiftKey && document.activeElement === f) { e.preventDefault(); l.focus(); }
      else if (!e.shiftKey && document.activeElement === l) { e.preventDefault(); f.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      if (prev && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
    };
  };

  // ─── Theme (light / dark) ───────────────────────────────────────
  const THEME_KEY = 'mrb_theme';
  const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  };
  const getTheme = () => {
    try { return localStorage.getItem(THEME_KEY) || 'light'; } catch { return 'light'; }
  };
  const setTheme = (theme) => {
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    applyTheme(theme);
  };
  // Apply early so first paint matches saved preference.
  if (typeof document !== 'undefined') applyTheme(getTheme());

  // ─── Tiny safe Markdown renderer ────────────────────────────────
  // Supports: # / ## / ### headings, **bold**, *italic*, `code`,
  // [text](url) links (http/https only), unordered/ordered lists,
  // and paragraph breaks. Everything passes through escapeHtml first so
  // user input can't inject markup; the regex pass then replaces only
  // the safe markdown sentinels. Output is a string of safe HTML.
  const renderMarkdown = (src) => {
    if (!src) return '';
    let s = escapeHtml(String(src));
    s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/((?:^- .+\n?)+)/gm, (block) => {
      const items = block.trim().split(/\n/).map(l => '<li>' + l.replace(/^- /, '') + '</li>').join('');
      return '<ul>' + items + '</ul>';
    });
    s = s.replace(/((?:^\d+\. .+\n?)+)/gm, (block) => {
      const items = block.trim().split(/\n/).map(l => '<li>' + l.replace(/^\d+\. /, '') + '</li>').join('');
      return '<ol>' + items + '</ol>';
    });
    s = s.split(/\n{2,}/).map(p => /^<(?:h\d|ul|ol|pre|blockquote)/.test(p.trim()) ? p : '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('');
    return s;
  };

  // ─── Cookie consent banner (loaded once) ────────────────────────
  if (typeof document !== 'undefined') {
    const s = document.createElement('script');
    s.src = '/cookie-consent.js';
    s.async = true;
    document.head.appendChild(s);
  }

  // ─── Service worker registration (PWA) ──────────────────────────
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        // PWA is enhancement-only; log but never block.
        console.warn('[pwa] sw register failed:', err.message);
      });
    });
  }

  // ─── Tiny fetch wrapper ─────────────────────────────────────────
  const api = async (method, path, body) => {
    const mutating = method !== 'GET' && method !== 'HEAD';
    if (mutating) await _ensureCsrf();
    const opts = {
      method,
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    };
    if (mutating) {
      const tok = _readCookie('mrb_csrf');
      if (tok) opts.headers['X-CSRF-Token'] = tok;
    }
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

  // ─── Enhanced button styles (cross-page polish) ───────────────────
  const BTN_STYLES = `
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:15px 24px;font-family:'Cairo','Tajawal',system-ui,sans-serif;font-size:15px;font-weight:800;letter-spacing:-0.01em;line-height:1.2;border-radius:14px;border:1.5px solid transparent;cursor:pointer;text-decoration:none;transition:transform .12s cubic-bezier(.2,.9,.2,1.2),background .18s,border-color .18s,box-shadow .18s,color .18s;white-space:nowrap;min-height:50px;user-select:none;-webkit-user-select:none;position:relative;isolation:isolate}
    html[lang="en"] .btn{letter-spacing:0.01em}
    .btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(176,136,64,0.45),0 4px 14px rgba(10,77,54,0.25)}
    .btn:active{transform:scale(0.97)}
    .btn svg{width:18px;height:18px;stroke-width:2.2;flex-shrink:0}
    .btn-primary{background:linear-gradient(180deg,#0a4d36 0%,#07412d 100%);color:#fbf6ea;box-shadow:0 6px 18px -4px rgba(10,77,54,0.45),inset 0 1px 0 rgba(255,255,255,0.08)}
    .btn-primary:hover{background:linear-gradient(180deg,#0e5b41 0%,#0a4d36 100%);box-shadow:0 10px 24px -4px rgba(10,77,54,0.55),inset 0 1px 0 rgba(255,255,255,0.12)}
    .btn-primary:active{background:#062b1e}
    .btn-gold{background:linear-gradient(180deg,#b08840 0%,#9a7635 100%);color:#fff;box-shadow:0 6px 18px -4px rgba(176,136,64,0.45),inset 0 1px 0 rgba(255,255,255,0.18)}
    .btn-gold:hover{background:linear-gradient(180deg,#c69850 0%,#b08840 100%);box-shadow:0 10px 24px -4px rgba(176,136,64,0.55),inset 0 1px 0 rgba(255,255,255,0.22)}
    .btn-gold:active{background:#9a7635}
    .btn-ghost{background:rgba(13,22,18,0.05);color:#0d1612;border-color:rgba(13,22,18,0.08)}
    .btn-ghost:hover{background:rgba(13,22,18,0.09);border-color:rgba(13,22,18,0.14)}
    .btn-nafath{background:linear-gradient(180deg,#00a651 0%,#008a44 100%);color:#fff;font-weight:800;box-shadow:0 6px 18px -4px rgba(0,166,81,0.45),inset 0 1px 0 rgba(255,255,255,0.18)}
    .btn-nafath:hover{background:linear-gradient(180deg,#00bd5b 0%,#009a4c 100%);box-shadow:0 10px 24px -4px rgba(0,166,81,0.55)}
    .btn-nafath:active{background:#008a44}
    .btn-block{width:100%}
    .btn-sm{padding:10px 16px;font-size:13px;min-height:40px;border-radius:11px;gap:6px}
    .btn[disabled],.btn:disabled{opacity:0.55;cursor:not-allowed;pointer-events:none;filter:grayscale(0.2)}
  `;

  // ─── Floating support FAB (WhatsApp + Live chat) ──────────────────
  const SUPPORT_WA_NUMBER = '966501234567'; // TODO: replace with real number
  const SUPPORT_WA_TEXT_AR = 'مرحباً، أريد الاستفسار عن مُرابحة';
  const SUPPORT_WA_TEXT_EN = 'Hi, I have a question about Murbha';

  const FAB_STYLES = `
    .fab-wrap{position:fixed;inset-block-end:calc(var(--tabbar-h,70px) + env(safe-area-inset-bottom,0px) + 14px);inset-inline-start:14px;z-index:9000;display:flex;flex-direction:column-reverse;align-items:flex-start;gap:10px}
    .fab-main{width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#0a4d36 0%,#062b1e 100%);color:#d4ac6e;border:none;box-shadow:0 8px 22px -4px rgba(6,43,30,0.5),0 2px 6px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .2s,background .2s;position:relative}
    .fab-main:hover{transform:scale(1.05)}
    .fab-main:active{transform:scale(0.96)}
    .fab-main svg{width:26px;height:26px;stroke-width:2}
    .fab-main .fab-pulse{position:absolute;inset:-4px;border-radius:50%;border:2px solid rgba(176,136,64,0.5);animation:fab-pulse 2.2s ease-out infinite;pointer-events:none}
    @keyframes fab-pulse{0%{transform:scale(0.85);opacity:0.9}100%{transform:scale(1.45);opacity:0}}
    .fab-actions{display:flex;flex-direction:column;gap:8px;opacity:0;transform:translateY(10px) scale(0.92);pointer-events:none;transition:opacity .22s,transform .22s}
    .fab-wrap.open .fab-actions{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}
    .fab-wrap.open .fab-main{background:#0d1612}
    .fab-wrap.open .fab-main .fab-pulse{display:none}
    .fab-wrap.open .fab-main .icon-chat{display:none}
    .fab-wrap.open .fab-main .icon-close{display:block}
    .fab-main .icon-close{display:none}
    .fab-action{display:inline-flex;align-items:center;gap:10px;background:#fff;color:#0d1612;border:1px solid rgba(13,22,18,0.10);border-radius:999px;padding:10px 18px 10px 12px;text-decoration:none;font:800 13px 'Cairo','Tajawal',sans-serif;box-shadow:0 6px 18px -4px rgba(6,43,30,0.22);cursor:pointer;white-space:nowrap;transition:transform .15s}
    .fab-action:hover{transform:translateX(-4px)}
    .fab-action .fab-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0}
    .fab-action.whatsapp .fab-icon{background:#25D366}
    .fab-action.chat .fab-icon{background:#b08840}
    .fab-action small{display:block;font:600 10px 'Tajawal',sans-serif;color:#6b7268;margin-top:1px}
    .chat-sheet-overlay{position:fixed;inset:0;background:rgba(6,43,30,0.55);z-index:9500;opacity:0;pointer-events:none;transition:opacity .25s}
    .chat-sheet-overlay.open{opacity:1;pointer-events:auto}
    .chat-sheet{position:fixed;inset-inline:0;inset-block-end:0;background:#fbf6ea;border-radius:22px 22px 0 0;padding:18px 18px calc(22px + env(safe-area-inset-bottom,0px));z-index:9600;transform:translateY(110%);transition:transform .35s;max-width:480px;margin-inline:auto;box-shadow:0 -10px 40px rgba(0,0,0,0.25)}
    .chat-sheet.open{transform:translateY(0)}
    .chat-sheet-handle{width:36px;height:4px;background:rgba(13,22,18,0.10);border-radius:99px;margin:0 auto 14px}
    .chat-sheet h3{font:900 18px 'Cairo',sans-serif;color:#062b1e;margin-block-end:6px}
    .chat-sheet .agent{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#fff;border-radius:14px;margin-block-start:12px;border:1px solid rgba(13,22,18,0.10)}
    .chat-sheet .agent-avatar{width:36px;height:36px;border-radius:50%;background:#0a4d36;color:#d4ac6e;display:flex;align-items:center;justify-content:center;font:900 14px 'Cairo',sans-serif}
    .chat-sheet .agent-meta b{font:800 13px 'Cairo',sans-serif;display:block}
    .chat-sheet .agent-meta small{font:500 11px 'Tajawal',sans-serif;color:#6b7268}
    .chat-sheet .agent-status{margin-inline-start:auto;background:rgba(15,110,58,0.12);color:#0f6e3a;padding:4px 10px;border-radius:999px;font:800 10px 'Tajawal',sans-serif}
  `;

  // Trusted, author-baked markup (no user input flows here). Parsed via
  // <template> rather than assigned via innerHTML on a live element.
  const FAB_MARKUP_TEMPLATE = `
    <div class="fab-wrap" id="fabWrap">
      <button class="fab-main" id="fabMain" type="button" aria-label="فتح خيارات الدعم" data-en-aria-label="Open support options" aria-expanded="false">
        <span class="fab-pulse"></span>
        <svg class="icon-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        <svg class="icon-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="fab-actions" id="fabActions" role="menu">
        <a class="fab-action whatsapp" id="fabWhatsapp" target="_blank" rel="noopener" role="menuitem">
          <span class="fab-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"/></svg></span>
          <span><span data-en="WhatsApp">واتساب</span><small data-en="Instant reply · within minutes">رد فوري · خلال دقائق</small></span>
        </a>
        <button class="fab-action chat" id="fabChat" type="button" role="menuitem">
          <span class="fab-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></span>
          <span><span data-en="Live chat">محادثة مباشرة</span><small data-en="Support team is online">فريق الدعم متّصل الآن</small></span>
        </button>
      </div>
    </div>
    <div class="chat-sheet-overlay" id="chatOverlay"></div>
    <div class="chat-sheet" id="chatSheet" role="dialog" aria-label="محادثة مباشرة" data-en-aria-label="Live chat">
      <div class="chat-sheet-handle"></div>
      <h3 data-en="Live chat with support">محادثة مباشرة مع فريق الدعم</h3>
      <small style="color:#6b7268;font:600 12px 'Tajawal',sans-serif" data-en="Average response time: 2 minutes">متوسط وقت الاستجابة: دقيقتان</small>
      <div class="agent">
        <div class="agent-avatar" data-en="S">س</div>
        <div class="agent-meta">
          <b data-en="Sara Al-Otaibi">سارة العتيبي</b>
          <small data-en="Customer support consultant">مستشارة دعم العملاء</small>
        </div>
        <div class="agent-status" data-en="● Online">● متّصلة</div>
      </div>
    </div>
  `;

  const _injectSupportFab = () => {
    if (document.getElementById('fabWrap')) return;
    if (document.body && document.body.dataset.fab === 'off') return;

    if (!document.getElementById('mrb-fab-styles')) {
      const s = document.createElement('style');
      s.id = 'mrb-fab-styles';
      s.textContent = FAB_STYLES;
      document.head.appendChild(s);
    }
    if (!document.getElementById('mrb-btn-styles')) {
      const s = document.createElement('style');
      s.id = 'mrb-btn-styles';
      s.textContent = BTN_STYLES;
      document.head.appendChild(s);
    }

    const tpl = document.createElement('template');
    tpl.innerHTML = FAB_MARKUP_TEMPLATE;
    document.body.appendChild(tpl.content);

    const waUrl   = `https://wa.me/${SUPPORT_WA_NUMBER}?text=${encodeURIComponent(SUPPORT_WA_TEXT_AR)}`;
    const waUrlEn = `https://wa.me/${SUPPORT_WA_NUMBER}?text=${encodeURIComponent(SUPPORT_WA_TEXT_EN)}`;

    const wrap   = document.getElementById('fabWrap');
    const fabMain = document.getElementById('fabMain');
    const fabChat = document.getElementById('fabChat');
    const fabWa   = document.getElementById('fabWhatsapp');
    const sheet   = document.getElementById('chatSheet');
    const overlay = document.getElementById('chatOverlay');

    fabWa.dataset.hrefAr = waUrl;
    fabWa.dataset.hrefEn = waUrlEn;
    const swapWaLang = () => {
      fabWa.href = (document.documentElement.lang === 'en') ? fabWa.dataset.hrefEn : fabWa.dataset.hrefAr;
    };
    swapWaLang();

    fabMain.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !wrap.classList.contains('open');
      wrap.classList.toggle('open', open);
      fabMain.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) wrap.classList.remove('open');
      if (e.target.closest && e.target.closest('#langToggle')) setTimeout(swapWaLang, 0);
    });
    fabChat.addEventListener('click', () => {
      wrap.classList.remove('open');
      if (window.Tawk_API && typeof window.Tawk_API.toggle === 'function') {
        window.Tawk_API.toggle();
        return;
      }
      sheet.classList.add('open');
      overlay.classList.add('open');
    });
    overlay.addEventListener('click', () => {
      sheet.classList.remove('open');
      overlay.classList.remove('open');
    });
  };

  // ─── Cookie consent (PDPL-friendly) ───────────────────────────
  const CONSENT_KEY = 'mrb_consent_v1';
  const _getConsent = () => {
    try { return JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); } catch { return null; }
  };
  const _setConsent = (c) => {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ ...c, at: Date.now() })); } catch {}
  };
  const _renderConsent = () => {
    if (_getConsent()) return;
    if (document.getElementById('consentBanner')) return;
    const html = document.documentElement.lang === 'en' || document.documentElement.dataset.langOverride === 'en';
    const banner = document.createElement('div');
    banner.id = 'consentBanner';
    banner.style.cssText = 'position:fixed;bottom:14px;inset-inline-start:14px;inset-inline-end:14px;max-width:560px;margin:0 auto;background:#0a4d36;color:#fbf6ea;border-radius:16px;padding:16px 18px;font-family:Tajawal,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,0.25);z-index:9998;font-size:13px;line-height:1.7;';
    const txt = document.createElement('div');
    txt.textContent = html
      ? 'We use essential cookies for the platform to work. Optional analytics help us improve. You can change this anytime.'
      : 'نستخدم ملفات تعريف ارتباط أساسية ليعمل النظام، وأخرى اختيارية للتحليلات لتحسين تجربتك. يمكنك تغيير اختيارك في أي وقت.';
    txt.style.marginBottom = '12px';
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
    const mkBtn = (label, primary, onclick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = 'flex:1;min-width:110px;padding:10px 14px;border-radius:999px;border:0;font:800 12px Cairo,sans-serif;cursor:pointer;' +
        (primary ? 'background:#d4ac6e;color:#062b1e;' : 'background:transparent;color:#fbf6ea;border:1px solid rgba(255,255,255,0.25);');
      b.onclick = onclick;
      return b;
    };
    const accept = mkBtn(html ? 'Accept all' : 'قبول الكل', true, () => {
      _setConsent({ essential: true, analytics: true });
      banner.remove();
    });
    const reject = mkBtn(html ? 'Essential only' : 'الأساسية فقط', false, () => {
      _setConsent({ essential: true, analytics: false });
      banner.remove();
    });
    const learn = document.createElement('a');
    learn.href = '/cookies.html';
    learn.textContent = html ? 'Learn more' : 'تفاصيل';
    learn.style.cssText = 'color:#d4ac6e;text-decoration:underline;font:700 11px Tajawal,sans-serif;align-self:center;padding:0 6px;';
    btns.append(accept, reject, learn);
    banner.append(txt, btns);
    document.body.appendChild(banner);
  };

  // ─── PWA install prompt ────────────────────────────────────────
  const PWA_DISMISS_KEY = 'mrb_pwa_dismissed_at';
  let _deferredInstall = null;

  const _isStandalone = () =>
    window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const _isiOSSafari = () => {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
  };

  const _renderInstallBanner = (mode) => {
    if (document.getElementById('pwaInstall')) return;
    const banner = document.createElement('div');
    banner.id = 'pwaInstall';
    banner.style.cssText = 'position:fixed;bottom:14px;inset-inline-end:14px;max-width:340px;background:#062b1e;color:#fbf6ea;border-radius:14px;padding:14px 16px;font-family:Tajawal,system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,0.25);z-index:9997;font-size:13px;line-height:1.6;';
    const t = document.createElement('div');
    t.style.cssText = 'font:800 13px Cairo,sans-serif;color:#d4ac6e;margin-bottom:4px;';
    t.textContent = '⬇ ثبّت تطبيق مُرابحة';
    const p = document.createElement('div');
    p.textContent = mode === 'ios'
      ? 'لتثبيت التطبيق على iPhone: اضغط زر المشاركة ⤴ ثم اختر "إضافة إلى الشاشة الرئيسية".'
      : 'استثمر بسرعة أكبر وتلقّى الإشعارات الفورية. التثبيت لا يأخذ ثانية.';
    p.style.marginBottom = '10px';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;';
    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.textContent = 'لاحقاً';
    dismissBtn.style.cssText = 'flex:1;padding:9px 12px;border:1px solid rgba(255,255,255,0.18);background:transparent;color:#fbf6ea;border-radius:999px;font:800 12px Cairo,sans-serif;cursor:pointer;';
    dismissBtn.onclick = () => {
      try { localStorage.setItem(PWA_DISMISS_KEY, String(Date.now())); } catch {}
      banner.remove();
    };
    row.appendChild(dismissBtn);
    if (mode === 'native' && _deferredInstall) {
      const installBtn = document.createElement('button');
      installBtn.type = 'button';
      installBtn.textContent = 'تثبيت الآن';
      installBtn.style.cssText = 'flex:1;padding:9px 12px;background:#d4ac6e;color:#062b1e;border:0;border-radius:999px;font:800 12px Cairo,sans-serif;cursor:pointer;';
      installBtn.onclick = async () => {
        try {
          await _deferredInstall.prompt();
          await _deferredInstall.userChoice;
          _deferredInstall = null;
          banner.remove();
        } catch (e) { banner.remove(); }
      };
      row.appendChild(installBtn);
    }
    banner.append(t, p, row);
    document.body.appendChild(banner);
  };

  const _maybeShowInstallPrompt = () => {
    if (_isStandalone()) return;
    let dismissedAt = 0;
    try { dismissedAt = +localStorage.getItem(PWA_DISMISS_KEY) || 0; } catch {}
    // Don't nag within 7 days of dismiss
    if (dismissedAt && (Date.now() - dismissedAt) < 7 * 24 * 60 * 60 * 1000) return;
    if (_deferredInstall) _renderInstallBanner('native');
    else if (_isiOSSafari()) _renderInstallBanner('ios');
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _deferredInstall = e;
    // Delay so it doesn't appear instantly on cold load
    setTimeout(_maybeShowInstallPrompt, 8000);
  });

  // ─── Maintenance banner (poll once on load) ────────────────────
  const _checkMaintenance = async () => {
    try {
      const r = await fetch('/app/public/maintenance', { credentials: 'same-origin' });
      if (!r.ok) return;
      const d = await r.json();
      if (!d.active || document.getElementById('maintBanner')) return;
      const banner = document.createElement('div');
      banner.id = 'maintBanner';
      banner.style.cssText = 'position:fixed;top:0;inset-inline-start:0;inset-inline-end:0;z-index:9999;background:linear-gradient(90deg,#c54a3a,#b08840);color:#fff;text-align:center;padding:10px 16px;font:700 13px Cairo,Tajawal,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.15);';
      const txt = document.createElement('span');
      txt.textContent = '🛠 ' + (d.message || 'النظام تحت الصيانة حالياً.');
      banner.appendChild(txt);
      if (d.eta) {
        const eta = document.createElement('small');
        eta.style.cssText = 'margin-inline-start:10px;opacity:0.85;font-weight:500;';
        eta.textContent = '· نعود حوالي ' + new Date(d.eta).toLocaleString('ar-SA');
        banner.appendChild(eta);
      }
      document.body.appendChild(banner);
      document.body.style.paddingTop = (banner.offsetHeight + (parseInt(document.body.style.paddingTop || 0) || 0)) + 'px';
    } catch (e) {}
  };

  document.addEventListener('DOMContentLoaded', () => {
    _wireActions();
    _wireHeaderAuth();
    _wireLangToggle();
    _injectSupportFab();
    if (!location.pathname.includes('cookies.html')) _renderConsent();
    if (!location.pathname.includes('admin')) _checkMaintenance();
    // iOS Safari has no beforeinstallprompt; show its hint after delay.
    if (_isiOSSafari() && !location.pathname.includes('admin')) setTimeout(_maybeShowInstallPrompt, 12000);
  });

  window.App = {
    api, me, meSync, requireAuth, logout,
    toast,
    fmt: { sar, arNum, date, dateTime, relTime },
    storage, on, qs, escapeHtml, renderMarkdown,
    getTheme, setTheme,
    getConsent: _getConsent, setConsent: _setConsent,
    trapFocus,
    refreshHeader: _wireHeaderAuth,
  };
})();
