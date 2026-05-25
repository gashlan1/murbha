/**
 * ═══════════════════════════════════════════════════════
 *   مُرابحة — Shared JavaScript
 *   Global utilities used across all pages
 * ═══════════════════════════════════════════════════════
 */

/* eslint-disable no-unused-vars */

// ─── Arabic digit utilities ─────────────────────────────
const ARABIC_DIGITS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];

function toArabic(n) {
  return String(n).replace(/\d/g, d => ARABIC_DIGITS[+d]);
}

function toLatinDigits(str) {
  return String(str).replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => ARABIC_DIGITS.indexOf(d));
}

function formatCurrency(amount, currency = 'ر.س') {
  const formatted = Number(amount).toLocaleString('en-US');
  return toArabic(formatted) + ' ' + currency;
}

function formatPercent(n, decimals = 1) {
  return toArabic(Number(n).toFixed(decimals)) + '٪';
}

// ─── Date utilities ─────────────────────────────────────
function toHijriDate() {
  try {
    const d = new Date();
    const parts = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
      year: 'numeric', month: 'long', day: 'numeric'
    }).formatToParts(d);

    const get = type => parts.find(p => p.type === type)?.value || '';
    return `${get('day')} ${get('month')} ${get('year')} هـ`;
  } catch {
    return '٢٤ شعبان ١٤٤٧ هـ';
  }
}

// ─── Toast system ───────────────────────────────────────
const Toast = (() => {
  let container;

  function _getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function show(message, type = 'default', duration = 3500) {
    const c = _getContainer();
    const el = document.createElement('div');
    el.className = 'toast' + (type !== 'default' ? ' ' + type : '');

    const icon = {
      success: '✓',
      error:   '⚠',
      warning: '⚠',
      default: 'ℹ',
    }[type] || '';

    el.innerHTML = `<span style="font-size:16px">${icon}</span><span>${message}</span>`;
    c.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      el.style.transition = '0.3s';
      setTimeout(() => el.remove(), 320);
    }, duration);
  }

  return {
    success: (msg, d) => show(msg, 'success', d),
    error:   (msg, d) => show(msg, 'error', d),
    warning: (msg, d) => show(msg, 'warning', d),
    info:    (msg, d) => show(msg, 'default', d),
  };
})();

// ─── Bottom Sheet manager ────────────────────────────────
const Sheet = (() => {
  let active = null;

  function open(idOrEl) {
    close();

    const el = typeof idOrEl === 'string'
      ? document.getElementById('sheet-' + idOrEl) || document.getElementById(idOrEl)
      : idOrEl;

    if (!el) return;

    active = el;
    el.classList.add('active');
    document.body.style.overflow = 'hidden';

    const overlay = document.getElementById('sheetOverlay');
    if (overlay) overlay.classList.add('active');

    // Reset to step 1
    el.querySelectorAll('.verify-step').forEach(s => s.classList.remove('active'));
    const first = el.querySelector('[data-step="1"]');
    if (first) first.classList.add('active');

    // Focus first input
    setTimeout(() => {
      const inp = el.querySelector('input:not([disabled])');
      if (inp) inp.focus();
    }, 380);
  }

  function close() {
    if (!active) return;
    active.classList.remove('active');
    active.style.transform = '';
    active = null;
    document.body.style.overflow = '';

    const overlay = document.getElementById('sheetOverlay');
    if (overlay) overlay.classList.remove('active');
  }

  function goStep(sheetOrBtn, n) {
    const sheet = sheetOrBtn.closest ? sheetOrBtn.closest('.sheet') : sheetOrBtn;
    if (!sheet) return;
    sheet.querySelectorAll('.verify-step').forEach(s => s.classList.remove('active'));
    const target = sheet.querySelector(`[data-step="${n}"]`);
    if (target) target.classList.add('active');
  }

  function initDragToDismiss() {
    let startY = 0, currentY = 0, dragging = false;

    document.querySelectorAll('.sheet-handle').forEach(handle => {
      handle.addEventListener('touchstart', e => {
        const s = handle.closest('.sheet');
        startY = e.touches[0].clientY;
        dragging = true;
        s.style.transition = 'none';
      }, { passive: true });
    });

    document.addEventListener('touchmove', e => {
      if (!dragging || !active) return;
      currentY = e.touches[0].clientY - startY;
      if (currentY > 0) active.style.transform = `translateY(${currentY}px)`;
    }, { passive: true });

    document.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      if (active) {
        active.style.transition = '';
        if (currentY > 100) close();
        else active.style.transform = '';
      }
      currentY = 0;
    });
  }

  return { open, close, goStep, initDragToDismiss, get active() { return active; } };
})();

// Global shorthand
function openSheet(name)    { Sheet.open(name); }
function closeSheet()       { Sheet.close(); }
function goStep(btn, n)     { Sheet.goStep(btn, n); }

// ─── Form helpers ────────────────────────────────────────
function togglePwd(id) {
  const el = document.getElementById(id);
  if (el) el.type = el.type === 'password' ? 'text' : 'password';
}

function showFieldError(inputEl, message) {
  if (!inputEl) return;
  inputEl.classList.add('error');
  let err = inputEl.parentNode.querySelector('.form-error');
  if (!err) {
    err = document.createElement('p');
    err.className = 'form-error';
    inputEl.parentNode.insertBefore(err, inputEl.nextSibling);
  }
  err.textContent = message;

  setTimeout(() => {
    inputEl.classList.remove('error');
    if (err.parentNode) err.parentNode.removeChild(err);
  }, 4000);
}

function startResendTimer(linkEl, seconds = 30) {
  linkEl.classList.add('disabled');
  linkEl.style.pointerEvents = 'none';
  linkEl.style.color = 'var(--muted)';
  let t = seconds;
  const timer = setInterval(() => {
    linkEl.textContent = `إعادة الإرسال (${toArabic(t--)})`;
    if (t < 0) {
      clearInterval(timer);
      linkEl.textContent = 'إعادة الإرسال';
      linkEl.classList.remove('disabled');
      linkEl.style.pointerEvents = '';
      linkEl.style.color = '';
    }
  }, 1000);
}

// ─── Tab bar navigation ──────────────────────────────────
function initTabBar() {
  const page = window.location.pathname.replace(/^\//, '') || 'hessa.html';
  const tabs = document.querySelectorAll('.tab[data-page]');
  tabs.forEach(tab => {
    if (page === tab.dataset.page || page.startsWith(tab.dataset.page?.replace('.html', ''))) {
      tab.classList.add('active');
    }
  });
}

// ─── Scroll-based header ─────────────────────────────────
function initScrollHeader(headerId = 'stickyHeader', threshold = 10) {
  const header = document.getElementById(headerId);
  if (!header) return;

  const update = () => {
    header.classList.toggle('scrolled', window.scrollY > threshold);
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

// ─── Intersection observer animations ────────────────────
function initScrollAnimations() {
  if (!('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.animate-in').forEach(el => observer.observe(el));
}

// ─── Hijri date injection ────────────────────────────────
function injectHijriDates() {
  const date = toHijriDate();
  document.querySelectorAll('[data-hijri]').forEach(el => {
    el.textContent = date;
  });
}

// ─── PWA Install prompt ──────────────────────────────────
const PWA = (() => {
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;

    const banner = document.getElementById('pwa-banner');
    if (banner && !localStorage.getItem('pwa-dismissed')) {
      banner.classList.add('visible');
    }
  });

  function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(choice => {
      if (choice.outcome === 'accepted') {
        Toast.success('تم إضافة التطبيق إلى شاشتك الرئيسية');
      }
      deferredPrompt = null;
      dismiss();
    });
  }

  function dismiss() {
    localStorage.setItem('pwa-dismissed', '1');
    const banner = document.getElementById('pwa-banner');
    if (banner) banner.classList.remove('visible');
  }

  return { install, dismiss };
})();

// ─── Service Worker registration ─────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW registration failed — non-critical
      });
    });
  }
}

// ─── Copy to clipboard ───────────────────────────────────
async function copyToClipboard(text, successMsg = 'تم النسخ') {
  try {
    await navigator.clipboard.writeText(text);
    Toast.success(successMsg);
  } catch {
    // Fallback
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    Toast.success(successMsg);
  }
}

// ─── Lazy image loading ──────────────────────────────────
function initLazyImages() {
  if (!('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
        }
        observer.unobserve(img);
      }
    });
  });

  document.querySelectorAll('img[data-src]').forEach(img => observer.observe(img));
}

// ─── Share API ───────────────────────────────────────────
async function shareProject(title, url) {
  const shareData = {
    title: 'مُرابحة — ' + title,
    text:  'فرصة استثمارية شرعية على منصة مُرابحة',
    url:   url || window.location.href,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch { /* user cancelled */ }
  } else {
    await copyToClipboard(shareData.url, 'تم نسخ الرابط');
  }
}

// ─── Auto-init on DOM ready ──────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Sheet.initDragToDismiss();
  initTabBar();
  injectHijriDates();
  initScrollAnimations();
  initLazyImages();
  registerSW();
});

// Expose globals
window.Toast         = Toast;
window.Sheet         = Sheet;
window.PWA           = PWA;
window.toArabic      = toArabic;
window.toLatinDigits = toLatinDigits;
window.formatCurrency = formatCurrency;
window.formatPercent  = formatPercent;
window.openSheet      = openSheet;
window.closeSheet     = closeSheet;
window.goStep         = goStep;
window.togglePwd      = togglePwd;
window.showFieldError = showFieldError;
window.startResendTimer = startResendTimer;
window.copyToClipboard  = copyToClipboard;
window.shareProject     = shareProject;
