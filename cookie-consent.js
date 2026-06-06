/**
 * Cookie consent banner (PDPL-aligned).
 *
 * Shows once until user accepts or declines; choice persisted in
 * localStorage. Loaded by app.js on every page; no-op when a choice
 * exists already.
 */
'use strict';

(function () {
  if (typeof document === 'undefined') return;
  const KEY = 'mrb_cookie_consent';
  const existing = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  if (existing === 'accepted' || existing === 'declined') return;

  const insert = () => {
    if (document.getElementById('mrb-cookie-banner')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mrb-cookie-banner';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'موافقة الكوكيز');
    wrap.style.cssText = 'position:fixed;inset-inline-start:14px;inset-inline-end:14px;inset-block-end:calc(env(safe-area-inset-bottom,0px) + 14px);z-index:9500;background:#062b1e;color:#fbf6ea;border-radius:14px;padding:16px 18px;box-shadow:0 16px 40px rgba(0,0,0,0.25);display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-family:Tajawal,Cairo,sans-serif;max-width:760px;margin-inline:auto;';

    const text = document.createElement('div');
    text.style.cssText = 'flex:1;min-width:240px;font-size:13px;line-height:1.7;';
    const t1 = document.createElement('div'); t1.style.cssText='font:800 13px Cairo,sans-serif;color:#fff;margin-bottom:4px;';
    t1.textContent = '🍪 نستخدم الكوكيز لتجربة أفضل';
    const t2 = document.createElement('div'); t2.style.cssText='color:rgba(251,246,234,0.78);font-size:12px;';
    t2.append(document.createTextNode('نحفظ كوكيز جلسة وتفضيلات لتشغيل المنصة. لمعرفة المزيد، راجع '));
    const lnk = document.createElement('a'); lnk.href = 'cookies.html'; lnk.textContent = 'سياسة الكوكيز';
    lnk.style.cssText = 'color:#d4ac6e;font-weight:800;text-decoration:underline;';
    t2.appendChild(lnk); t2.appendChild(document.createTextNode('.'));
    text.append(t1, t2);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-shrink:0;';
    const decline = document.createElement('button');
    decline.type = 'button';
    decline.style.cssText = 'background:transparent;color:rgba(251,246,234,0.85);border:1px solid rgba(251,246,234,0.25);padding:9px 16px;border-radius:10px;font:800 12px Cairo,sans-serif;cursor:pointer;';
    decline.textContent = 'رفض غير الأساسي';
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.style.cssText = 'background:#b08840;color:#fff;border:0;padding:9px 18px;border-radius:10px;font:800 12px Cairo,sans-serif;cursor:pointer;';
    accept.textContent = 'موافق';

    const setAndClose = (choice) => {
      try { localStorage.setItem(KEY, choice); } catch {}
      wrap.style.transition = 'opacity .2s, transform .2s';
      wrap.style.opacity = '0';
      wrap.style.transform = 'translateY(20px)';
      setTimeout(() => wrap.remove(), 220);
    };
    accept.onclick = () => setAndClose('accepted');
    decline.onclick = () => setAndClose('declined');

    actions.append(decline, accept);
    wrap.append(text, actions);
    document.body.appendChild(wrap);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', insert);
  else insert();
})();
