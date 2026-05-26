/* Murbaha landing — lightweight bilingual (AR/EN) i18n.
 * Marks: data-i18n="key" (textContent), data-i18n-html="key" (innerHTML),
 *        data-i18n-attr="attr:key" (attribute, e.g. aria-label).
 * setLang(lang) swaps strings, sets <html lang/dir>, persists to localStorage.
 * Default language is Arabic. The HTML ships with Arabic as the source text,
 * so EN translations live here and AR falls back to the in-DOM source.
 * Dictionary values are developer-authored static strings (trusted), so the
 * data-i18n-html path intentionally assigns innerHTML to swap inline markup
 * (the same trust level as the page's own source HTML). Untrusted, API-driven
 * card text is escaped separately in hessa.html via App.escapeHtml().
 */
(function () {
  'use strict';

  var DICT = {
    nav_login:   { en: 'Sign in' },
    date_pill:   { en: '<b>May 27</b>\n2026' },

    hero_eyebrow: { en: 'Islamic investment platform — launching soon' },
    hero_h1: {
      ar: 'شارك في تنفيذ <span class="accent">عقود حقيقية</span> بعقد <span class="underline">مرابحة</span>.',
      en: 'Help fund <span class="accent">real contracts</span> through a <span class="underline">Murabaha</span> sale.'
    },
    hero_lede: {
      ar: '<b>مُرابحة</b> تربطك بعقود <b>حكومية وخاصة</b> مُسندة لشركات سعودية معتمّدة، تحتاج إلى معدات ومواد وخدمات لتنفيذها. أنت تدخل بصفتك <b>بائعاً</b> بعقد مرابحة شرعي واضح — تستردّ رأس مالك + ربحاً معلوماً خلال <b>٦ أو ١٢ أو ١٨ شهراً</b>.',
      en: '<b>Murbaha</b> connects you to <b>government and private</b> contracts awarded to certified Saudi companies that need equipment, materials and services to deliver them. You enter as a <b>seller</b> under a clear, Sharia-compliant Murabaha contract — recovering your capital plus a known profit over <b>6, 12 or 18 months</b>.'
    },
    cta_signup: { en: 'Create an account' },
    cta_login:  { en: 'Sign in' },
    cta_how:    { en: 'How it works' },

    stat_sharia: { en: 'Sharia compliant' },
    stat_scholars_unit: { en: 'scholars' },
    stat_board:  { en: 'on the Sharia board' },
    currency_sar:{ ar: 'ر.س', en: 'SAR' },
    stat_min:    { en: 'Target minimum' },
    stat_riba:   { en: 'Interest (riba)' },
    stat_pdpl:   { en: 'Saudi data protection' },

    trust_doc:    { en: 'Secure e-documentation' },
    trust_sharia: { en: 'Independent Sharia board' },
    trust_zatca:  { en: 'ZATCA' },
    trust_kpmg:   { en: 'KPMG Saudi — auditor' },
    trust_sdaia:  { en: 'SDAIA' },
    trust_vision: { en: 'Vision 2030' },

    vision_title: { en: 'We help deliver our nation’s projects' },
    vision_body: {
      ar: 'عقود <b>تشغيل وصيانة</b>، توريد، مقاولات وخدمات مُسندة لشركات سعودية معتمَدة من جهات حكومية وخاصة منسجمة مع برامج رؤية المملكة ٢٠٣٠.',
      en: '<b>Operations & maintenance</b>, supply, contracting and service contracts awarded to certified Saudi companies by government and private entities — aligned with Saudi Vision 2030 programmes.'
    },

    how_eyebrow: { en: 'How Murbaha works' },
    how_title:   { ar: 'من عقد مُسند —<br/>إلى ربح معلوم.', en: 'From an awarded contract —<br/>to a known profit.' },
    how_sub:     { en: 'One Murabaha cycle, four clear stages linking the investor, the executing company and the contracting entity.' },
    step1_h:   { en: 'A company wins a contract' },
    step1_p:   { en: 'A Saudi company is awarded an operations, supply or maintenance contract by a government or private entity, and lists it on Murbaha.' },
    step1_tag: { en: 'Verified contract' },
    step2_h:   { en: 'The Sharia board reviews' },
    step2_p:   { en: 'The board studies the contract and the goods and services required, then approves the Murabaha sale at a known profit and a fixed term.' },
    step2_tag: { en: 'Fatwa' },
    step3_h:   { en: 'You enter a Murabaha contract' },
    step3_p:   { ar: 'تشتري حصّتك من السلع/الخدمات وتبيعها للشركة المنفّذة <b>بثمن مؤجّل + ربح معلوم</b>. توقيع إلكتروني موثّق.', en: 'You buy your share of the goods/services and sell them to the executing company at a <b>deferred price plus a known profit</b>. Documented e-signature.' },
    step3_tag: { en: 'A real commodity' },
    step4_h:   { en: 'You recover capital + profit' },
    step4_p:   { ar: 'دفعات الجهة المتعاقدة تتدفّق لحسابك عبر سداد خلال <b>٦ أو ١٢ أو ١٨ شهراً</b>، حسب مدّة العقد.', en: 'The contracting entity’s payments flow to your account via SADAD over <b>6, 12 or 18 months</b>, depending on the contract term.' },
    step4_tag: { en: 'Clear schedule' },

    projects_title:            { en: 'Current investment opportunities' },
    projects_all:              { ar: 'عرض الكل ←', en: 'View all →' },
    projects_loading_live:     { en: 'Loading investment opportunities…' },
    projects_completed_title:  { en: 'Alangary Contracting — completed projects (O&M)' },
    projects_completed_sub:    { en: 'Here we review past projects that were fully funded and delivered, returned attractive profits to investors, and were settled 100%.' },
    projects_loading_completed:{ en: 'Loading completed projects…' },

    testi_eyebrow: { en: 'What our clients say' },
    testi_title:   { ar: 'سعوديون يثقون<br/>بـ <span style="color:var(--gold);font-style:italic;font-family:\'Amiri\',serif;">مُرابحة</span>.', en: 'Saudis trust<br/><span style="color:var(--gold);font-style:italic;font-family:\'Amiri\',serif;">Murbaha</span>.' },

    cta_blessing: { ar: '﴿ وَأَن لَّيْسَ لِلْإِنسَانِ إِلَّا مَا سَعَىٰ ﴾', en: '“And that man shall have nothing but what he strives for.”' },
    cta_h2:       { ar: 'كن جزءاً من<br/>نهضة <span class="accent">المملكة</span>.', en: 'Be part of<br/>the Kingdom’s <span class="accent">renaissance</span>.' },
    cta_p:        { en: 'Open your account online in two minutes and start from your first SAR 500 in a project you choose — God willing.' },
    cta_register: { en: 'Register now' },
    cta_view:     { en: 'See the Kingdom’s projects' },

    foot_tagline: { en: 'The Kingdom’s first investment-partnership platform. Licensed to serve the Saudi investor.' },
    foot_hq:      { ar: '<b>المقر الرئيسي</b>\nحي العليا، طريق الملك فهد، الرياض ١٢٢٤١', en: '<b>Head office</b>\nAl Olaya, King Fahd Road, Riyadh 12241' },
    foot_branch:  { ar: '<b>الفرع الغربي</b>\nحي الزهراء، طريق الكورنيش، جدة ٢٣٤٢١', en: '<b>Western branch</b>\nAl Zahraa, Corniche Road, Jeddah 23421' },
    foot_terms:     { en: 'Terms & Conditions' },
    foot_privacy:   { en: 'Privacy Policy' },
    foot_risk:      { en: 'Risk Disclosure' },
    foot_aml:       { en: 'Anti-Money Laundering' },
    foot_fatwa:     { en: 'Sharia Fatwa' },
    foot_complaints:{ en: 'Complaints' },
    foot_contract:  { en: 'Murabaha Contract' },
    foot_help:      { en: 'Help' },
    foot_bottom:  { ar: '© ٢٠٢٦ مُرابحة المالية • س.ت ١٠١٠XXXXXX<br/>صُنعت في المملكة العربية السعودية 🇸🇦', en: '© 2026 Murbaha Financial • CR 1010XXXXXX<br/>Made in the Kingdom of Saudi Arabia 🇸🇦' },

    tab_home:      { en: 'Home' },
    tab_projects:  { en: 'Projects' },
    tab_invest:    { en: 'Invest' },
    tab_portfolio: { en: 'Portfolio' },
    tab_profile:   { en: 'Account' }
  };

  var arCache = {};
  function cacheAr() {
    document.querySelectorAll('[data-i18n],[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n') || el.getAttribute('data-i18n-html');
      if (key && !(key in arCache)) {
        var isHtml = el.hasAttribute('data-i18n-html');
        arCache[key] = isHtml ? el.innerHTML.trim() : el.textContent.trim();
      }
    });
  }

  function str(key, lang) {
    var entry = DICT[key];
    if (lang === 'en' && entry && entry.en != null) return entry.en;
    if (entry && entry.ar != null) return entry.ar;
    return arCache[key];
  }

  function setLang(lang) {
    lang = (lang === 'en') ? 'en' : 'ar';
    var html = document.documentElement;
    html.setAttribute('lang', lang);
    html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = str(el.getAttribute('data-i18n'), lang);
      if (v != null) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var v = str(el.getAttribute('data-i18n-html'), lang);
      if (v != null) el.innerHTML = v;
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(',').forEach(function (pair) {
        var bits = pair.split(':');
        var attr = bits[0].trim(), key = bits[1] && bits[1].trim();
        var v = str(key, lang);
        if (v != null) el.setAttribute(attr, v);
      });
    });

    document.title = lang === 'en'
      ? 'Murbaha — Your partner in Saudi Vision 2030'
      : 'مُرابحة — شريكك في رؤية المملكة 2030';

    try { localStorage.setItem('murbaha_lang', lang); } catch (e) {}

    if (window.renderHomeProjects && window.__homeProjects) {
      window.renderHomeProjects(window.__homeProjects);
    }
  }
  window.setLang = setLang;

  function init() {
    cacheAr();
    var saved;
    try { saved = localStorage.getItem('murbaha_lang'); } catch (e) {}
    setLang(saved === 'en' ? 'en' : 'ar');
    var btn = document.getElementById('langToggle');
    if (btn) {
      btn.addEventListener('click', function () {
        setLang(document.documentElement.lang === 'ar' ? 'en' : 'ar');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
