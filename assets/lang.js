/**
 * MurbhaLang — bilingual AR/EN engine
 *
 * Language is determined by the URL parameter ?lang=en (English)
 * or its absence (Arabic, default). This gives genuinely separate
 * URLs for each language: hessa.html (AR) vs hessa.html?lang=en (EN).
 *
 * Supported data attributes on any element:
 *   data-en="text"           → sets textContent when EN
 *   data-en-aria-label="…"   → sets aria-label when EN
 *   data-en-placeholder="…"  → sets placeholder when EN
 *   data-en-title="…"        → sets title when EN
 *
 * For rich HTML swaps, use data-en-html ONLY with pre-authored static
 * strings (never server-provided data). A DOMParser is used to parse
 * them safely — no direct innerHTML assignment.
 *
 * html[lang] and html[dir] are set appropriately so CSS rules work.
 */
(function () {
  'use strict';

  var PARAM = 'lang';
  var STORAGE_KEY = 'murbha_lang';

  function getLang() {
    var url = new URL(window.location.href);
    var param = url.searchParams.get(PARAM);
    if (param === 'en') return 'en';
    if (param === 'ar') return 'ar';
    return localStorage.getItem(STORAGE_KEY) || 'ar';
  }

  // Safely replaces an element's children with parsed static markup.
  // Only called with data-en-html values authored in the HTML source,
  // never with server-provided or user-controlled strings.
  function safeSetHTML(el, staticMarkup) {
    var parser = new DOMParser();
    var doc = parser.parseFromString('<body>' + staticMarkup + '</body>', 'text/html');
    el.textContent = '';
    var nodes = doc.body.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      el.appendChild(nodes[i].cloneNode(true));
    }
  }

  function applyEN(root) {
    root = root || document;

    root.querySelectorAll('[data-en]').forEach(function (el) {
      el.textContent = el.getAttribute('data-en');
    });

    root.querySelectorAll('[data-en-html]').forEach(function (el) {
      safeSetHTML(el, el.getAttribute('data-en-html'));
    });

    root.querySelectorAll('[data-en-aria-label]').forEach(function (el) {
      el.setAttribute('aria-label', el.getAttribute('data-en-aria-label'));
    });

    root.querySelectorAll('[data-en-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', el.getAttribute('data-en-placeholder'));
    });

    root.querySelectorAll('[data-en-title]').forEach(function (el) {
      el.setAttribute('title', el.getAttribute('data-en-title'));
    });

    var titleEl = document.querySelector('head title');
    if (titleEl && titleEl.getAttribute('data-en')) {
      document.title = titleEl.getAttribute('data-en');
    }
  }

  function setHTMLAttrs(lang) {
    var html = document.documentElement;
    if (lang === 'en') {
      html.setAttribute('lang', 'en');
      html.setAttribute('dir', 'ltr');
    } else {
      html.setAttribute('lang', 'ar');
      html.setAttribute('dir', 'rtl');
    }
  }

  function updateInternalLinks(lang) {
    var origin = window.location.origin;
    document.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' ||
          href.startsWith('mailto:') || href.startsWith('tel:') ||
          href.startsWith('javascript:')) return;
      try {
        var u = new URL(href, window.location.href);
        if (u.origin !== origin) return;
        if (lang === 'en') {
          u.searchParams.set(PARAM, 'en');
        } else {
          u.searchParams.delete(PARAM);
        }
        a.setAttribute('href', u.pathname + (u.search || '') + (u.hash || ''));
      } catch (e) { /* ignore malformed hrefs */ }
    });
  }

  function wireLangToggle(lang) {
    var btn = document.getElementById('langToggle');
    if (!btn) return;

    var curSpan = btn.querySelector('.lang-current');
    var othSpan = btn.querySelector('.lang-other');
    if (curSpan) curSpan.textContent = lang === 'en' ? 'EN' : 'عر';
    if (othSpan) othSpan.textContent = lang === 'en' ? 'عر' : 'EN';
    btn.setAttribute('aria-label', lang === 'en' ? 'Switch to Arabic' : 'تبديل إلى الإنجليزية');

    var newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', function () {
      var targetLang = lang === 'en' ? 'ar' : 'en';
      localStorage.setItem(STORAGE_KEY, targetLang);
      var u = new URL(window.location.href);
      if (targetLang === 'en') {
        u.searchParams.set(PARAM, 'en');
      } else {
        u.searchParams.delete(PARAM);
      }
      window.location.href = u.toString();
    });
  }

  function run() {
    var lang = getLang();
    localStorage.setItem(STORAGE_KEY, lang);
    setHTMLAttrs(lang);
    if (lang === 'en') {
      applyEN(document);
    }
    updateInternalLinks(lang);
    wireLangToggle(lang);
  }

  window.MurbhaLang = {
    getLang: getLang,
    reapply: function (root) {
      var lang = getLang();
      if (lang === 'en') applyEN(root || document);
      updateInternalLinks(lang);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
}());
