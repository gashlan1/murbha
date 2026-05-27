/* Murbha landing — lightweight bilingual (AR/EN) i18n.
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
    brand:       { en: 'Murbha' },
    skip_link:   { en: 'Skip to main content' },
    nav_login:   { en: 'Sign in' },
    date_pill:   { en: '<b>May 27</b>\n2026' },

    hero_eyebrow: { en: 'Islamic investment platform — launching soon' },
    hero_h1: {
      ar: 'شارك في تنفيذ <span class="accent">عقود حقيقية</span> بعقد <span class="underline">مرابحة</span>.',
      en: 'Help fund <span class="accent">real contracts</span> through a <span class="underline">Murabaha</span> sale.'
    },
    hero_lede: {
      ar: '<b>مُرابحة</b> تربطك بعقود <b>حكومية وخاصة</b> مُسندة لشركات سعودية معتمّدة، تحتاج إلى معدات ومواد وخدمات لتنفيذها. أنت تدخل بصفتك <b>بائعاً</b> بعقد مرابحة شرعي واضح — تستردّ رأس مالك + ربحاً معلوماً خلال <b>٦ أو ١٢ أو ١٨ شهراً</b>.',
      en: '<b>Murbha</b> connects you to <b>government and private</b> contracts awarded to certified Saudi companies that need equipment, materials and services to deliver them. You enter as a <b>seller</b> under a clear, Sharia-compliant Murabaha contract — recovering your capital plus a known profit over <b>6, 12 or 18 months</b>.'
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

    how_eyebrow: { en: 'How Murbha works' },
    how_title:   { ar: 'من عقد مُسند —<br/>إلى ربح معلوم.', en: 'From an awarded contract —<br/>to a known profit.' },
    how_sub:     { en: 'One Murabaha cycle, four clear stages linking the investor, the executing company and the contracting entity.' },
    step1_h:   { en: 'A company wins a contract' },
    step1_p:   { en: 'A Saudi company is awarded an operations, supply or maintenance contract by a government or private entity, and lists it on Murbha.' },
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
    testi_title:   { ar: 'سعوديون يثقون<br/>بـ <span style="color:var(--gold);font-style:italic;font-family:\'Amiri\',serif;">مُرابحة</span>.', en: 'Saudis trust<br/><span style="color:var(--gold);font-style:italic;font-family:\'Amiri\',serif;">Murbha</span>.' },

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
    foot_bottom:  { ar: '© ٢٠٢٦ مُرابحة المالية • س.ت ١٠١٠XXXXXX<br/>صُنعت في المملكة العربية السعودية 🇸🇦', en: '© 2026 Murbha Financial • CR 1010XXXXXX<br/>Made in the Kingdom of Saudi Arabia 🇸🇦' },

    tab_home:      { en: 'Home' },
    tab_projects:  { en: 'Projects' },
    tab_invest:    { en: 'Invest' },
    tab_portfolio: { en: 'Portfolio' },
    tab_profile:   { en: 'Account' },

    // ─── Milestones ticker ───
    tick_soon:      { en: '🚀 <b>Murbha</b>: help fund real contracts <span class="ticker-amt">soon</span>' },
    tick_seller:    { en: '📜 The investor is a <b>seller</b> under a Murabaha contract <span class="ticker-amt">— deferred price + profit</span>' },
    tick_board:     { en: '☚ An independent Sharia board of <span class="ticker-amt">four scholars</span>' },
    tick_contracts: { en: '🏢 Government and private contracts awarded to <span class="ticker-amt">verified</span> Saudi companies' },
    tick_terms:     { en: '⏱ Fixed terms: <span class="ticker-amt">6, 12 or 18 months</span>' },
    tick_verify:    { en: '🔐 Verify your identity electronically in seconds' },
    tick_pdpl:      { en: '🇸🇦 Your data is protected under Saudi <span class="ticker-amt">PDPL</span>' },
    tick_waitlist:  { en: '👥 Join the <span class="ticker-amt">waitlist</span> to be among the first investors' },

    // ─── Illustrative example ───
    ex_eyebrow:    { en: 'Illustrative example' },
    ex_title:      { en: 'This is what an opportunity<br/>on Murbha looks like.' },
    ex_badge:      { en: '📌 Illustrative example — not an investment offer' },
    ex_card_title: { en: 'Operations & maintenance contract — an administrative building in Riyadh' },
    ex_meta_city:  { en: '📍 Riyadh' },
    ex_meta_sector:{ en: 'Sector: Operations & maintenance' },
    ex_meta_term:  { en: 'Term: 12 months' },
    ex_l_party:    { en: 'Contracting entity' },
    ex_v_party:    { en: 'A certified private entity' },
    ex_l_company:  { en: 'Executing company' },
    ex_v_company:  { en: 'A Saudi services company' },
    ex_l_scope:    { en: 'Contract scope' },
    ex_v_scope:    { en: '48 floors • 150 staff per month' },
    ex_l_need:     { en: 'Delivery requirements' },
    ex_v_need:     { en: 'Equipment • uniforms • consumables • services' },
    ex_l_recovery: { en: 'Capital recovery period' },
    ex_v_recovery: { en: '12 months (monthly payments)' },
    ex_l_form:     { en: 'Contract structure' },
    ex_v_form:     { en: '☚ Murabaha at a known profit' },
    ex_flow1:      { en: 'You buy a share of the goods/services the contract needs.' },
    ex_flow2:      { en: 'You sell them to the executing company at a deferred price plus a known profit.' },
    ex_flow3:      { en: 'The contracting entity’s payments flow to your account monthly.' },
    ex_foot:       { en: '⚠️ This example is for illustration only. Actual opportunities and their detailed figures will be announced on the <a href="projects.html">Projects</a> page after Sharia-board approval and regulatory licensing.' },

    // ─── Testimonials ───
    testi1_text: { en: 'I’ve followed <b>Murbha</b> since the very first announcement. What sets them apart is how clear they are — they don’t over-promise. The Sharia board is well known, and the idea of an electronic Murabaha contract is genuinely advanced. I’m ready to be one of the first investors.' },
    testi1_role: { en: 'Engineer · Riyadh' },
    testi2_text: { en: 'I liked the platform’s philosophy from the start: <b>halal</b>, transparent investing without complexity. I’ve long looked for an option that eases the conscience and respects my time, and the automatic e-documentation makes the experience very smooth.' },
    testi2_role: { en: 'Teacher · Jeddah' },
    testi3_text: { en: 'It’s hard to find an Arabic platform handling electronic contracts this clearly. The team answered all my questions in plain language and showed me a summary of the Sharia board’s fatwa. I truly value this level of quality.' },
    testi3_role: { en: 'Entrepreneur · Dammam' },
    testi4_text: { en: 'I was glad to see the Sharia board is real and not just a name. I’ll start with a small minimum at launch to try it out, and I think offering a halal investment option at a genuine Islamic profit rate is wonderful.' },
    testi4_role: { en: 'Employee · Makkah' },

    // ─── Portfolio teaser ───
    port_eyebrow:      { en: 'Investor dashboard' },
    port_title:        { en: 'Your portfolio in plain sight —<br/>live and transparent.' },
    port_sub:          { en: 'Track every investment, your accumulated profits and upcoming payments in a dashboard built for any Saudi investor to understand.' },
    port_preview_pill: { en: 'Preview' },
    port_preview_text: { en: 'This is how your portfolio will look after launch' },
    port_received:     { en: 'Profits received <b>—</b>' },
    port_next:         { en: 'Next payment <b>—</b>' },
    port_empty:        { en: '🏗️ Your investments will appear here as soon as the first opportunity goes live.' },
    port_waitlist:     { en: 'Join the waitlist' },

    // ─── Payment methods ───
    pay_heading:      { en: 'Accepted payment methods' },
    pay_mada:         { en: 'Mada card' },
    pay_stc:          { en: 'STC wallet' },
    pay_urpay:        { en: 'urpay' },
    pay_sadad:        { en: 'SADAD' },
    pay_transfer_logo:{ ar: '🏦 تحويل', en: '🏦 Transfer' },
    pay_banks:        { en: 'Saudi banks' },

    // ─── Compliance & Sharia ───
    comp_eyebrow:  { en: 'Compliance & governance' },
    comp_title:    { en: 'Built on Saudi regulations —<br/>from the ground up.' },
    comp_vision_h: { en: 'Saudi Vision 2030' },
    comp_vision_p: { en: 'Aligned with the Vision’s goals and targets' },
    comp_sharia_h: { en: 'Sharia compliant' },
    comp_sharia_p: { en: 'Independent Sharia board — quarterly review' },
    comp_edoc_h:   { en: 'Electronic documentation' },
    comp_edoc_p:   { en: 'Identity and data verified electronically' },
    comp_econ_h:   { en: 'Electronic contracts' },
    comp_econ_p:   { en: 'Under the Electronic Transactions Law' },
    sharia_stamp:  { en: '☪ Sharia approved' },
    sharia_h:      { en: 'Your money grows in line with Islamic Sharia' },
    sharia_p:      { en: 'Every contract on Murbha is built on approved Islamic transaction structures, free of riba and gharar. Each deal is reviewed by the independent Sharia supervisory board before it is offered to investors.' },
    ct_murabaha:   { en: '<b>Murabaha</b>\nSale at a known profit' },
    ct_musharaka:  { en: '<b>Musharaka</b>\nProfit-sharing partnership' },
    ct_ijara:      { en: '<b>Ijara</b>\nLease-to-own' },
    board_title:   { en: 'Sharia supervisory board' },
    board_m1:      { en: 'Dr. Abdullah Al-Mania — Board Chairman' },
    board_m2:      { en: 'Dr. Yusuf Al-Shubaily — Member' },
    board_m3:      { en: 'Dr. Mohammed Al-Qari — Member' },
    escrow_h:      { en: 'Invest with Sharia peace of mind' },
    escrow_p:      { en: 'Every Murabaha contract on the platform is reviewed and approved by the independent Sharia board chaired by His Excellency Sheikh Dr. Abdullah Al-Mania, with an independent quarterly review.' },
    doc_contract_h:{ en: 'Murabaha contract' },
    doc_contract_p:{ en: 'Full contract template' },
    doc_legal_h:   { en: 'Legal documents' },
    doc_legal_p:   { en: '7 regulatory policies' },

    // ─── Support ───
    support_eyebrow: { en: 'Customer service' },
    support_title:   { en: 'Our team is here for you<br/>all week long.' },
    support_card_h:  { en: 'Saudi support team' },
    support_card_p:  { en: 'Customer service in Saudi hands — they understand your market and speak your language.' },
    support_toll:    { en: '📞 Toll-free number' },
    support_whatsapp:{ en: '💬 WhatsApp' },
    proj_search_ph:   { en: 'Search a project, sector or city…' },
    proj_filter:      { en: 'Filter' },
    proj_chip_all:         { en: 'All' },
    proj_chip_residential: { en: 'Residential' },
    proj_chip_tourism:     { en: 'Tourism & leisure' },
    proj_chip_private:     { en: 'Private companies' },
    proj_chip_tech:        { en: 'Technology' },
    proj_chip_industrial:  { en: 'Industrial' },
    proj_cs_badge:    { en: '🚀 Coming soon' },
    proj_cs_title:    { en: 'The first opportunities are about to be announced' },
    proj_cs_lede:     { en: '<b>Murbha</b> opportunities mean entering as a <b>seller</b> in Murabaha contracts on the goods and services Saudi companies need to deliver <b>contracts awarded</b> to them by government and private entities. You recover your capital plus a known profit over <b>6, 12 or 18 months</b>.' },
    proj_cs_p1:       { en: 'Awarded, documented contracts from government and private entities' },
    proj_cs_p2:       { en: 'A Sharia board that approves the Murabaha sale for each opportunity' },
    proj_cs_p3:       { en: 'A known profit and a fixed term from signing — no gharar' },
    proj_cs_p4:       { en: 'Identity verification and a documented e-signature' },
    proj_cs_email_label: { en: 'Your email' },
    proj_cs_email_ph: { en: 'Your email' },
    proj_cs_notify:   { en: 'Notify me at launch' },
    proj_cs_note:     { en: '✓ You’re on the list. We’ll email you the moment the first opportunity is available.' },
    proj_cs_fatwa:    { en: 'Read the Sharia board fatwa →' },
    proj_cs_contact:  { en: 'Contact us →' },
    proj_why_title:   { en: 'What sets Murbha apart?' },
    proj_why1_t:      { en: 'Awarded contracts' },
    proj_why1_d:      { en: 'Every opportunity rests on a real contract won by a certified Saudi company.' },
    proj_why2_t:      { en: 'A sound Murabaha sale' },
    proj_why2_d:      { en: 'A real good/service sold at a known profit and a fixed term — no interest-bearing riba.' },
    proj_why3_t:      { en: 'A clear schedule' },
    proj_why3_d:      { en: 'Monthly payments tied to the contracting entity’s dues over 6, 12 or 18 months.' },
    proj_why4_t:      { en: 'Electronic documentation' },
    proj_why4_d:      { en: 'Identity verification and a documented e-signature on the Murabaha contract at the highest security standards.' },
    proj_live_title:    { en: 'Opportunities available now' },
    proj_live_loading:  { en: '…Loading opportunities' },
    proj_completed_title: { en: 'Alangary Contracting — completed projects (O&M)' },
    notif_title:      { en: 'Notifications' },

    // ─── Project detail page ───
    pdetail_demo:        { en: '⚠️ <b>Illustrative demo</b> — this page shows what an investment opportunity looks like on Murbha. Actual opportunities will be <b>announced soon</b>.' },
    pdetail_target:      { en: 'Target' },
    pdetail_investor:    { en: 'investors' },
    pdetail_remaining:   { en: 'Remaining' },
    pdetail_raised:      { en: 'Raised so far' },
    pdetail_st_return:   { en: 'Expected annual return' },
    pdetail_st_return_sub: { en: 'Distributed quarterly' },
    pdetail_st_term:     { en: 'Investment term' },
    pdetail_st_term_sub: { en: '3 years' },
    pdetail_st_min:      { en: 'Minimum' },
    pdetail_st_min_sub:  { en: 'to participate' },
    pdetail_st_form:     { en: 'Contract structure' },
    pdetail_st_form_v:   { en: 'Murabaha' },
    pdetail_st_form_sub: { en: 'Deferred-price sale' },
    pdetail_about:       { en: 'About the project' },
    pdetail_timeline:    { en: 'Timeline' },
    pdetail_calc:        { en: 'Calculate your returns' },
    pdetail_calc_amt:    { en: 'Amount to invest' },
    pdetail_calc_capital:{ en: 'Capital' },
    pdetail_calc_yearly: { en: 'Annual profit (9.2%)' },
    pdetail_calc_total:  { en: 'Total profit over 36 months' },
    pdetail_calc_final:  { en: 'Final amount at maturity' },
    pdetail_risks:       { en: 'Risks' },
    pdetail_risks_intro: { en: 'Every investment carries risk, and we disclose it with full transparency before you participate.' },
    pdetail_risk1_t:     { en: 'Delivery-delay risk' },
    pdetail_risk1_d:     { en: 'A possible delay in handing over the residential units due to operational conditions could postpone profit distribution by a quarter or two.' },
    pdetail_risk2_t:     { en: 'Real-estate market risk' },
    pdetail_risk2_d:     { en: 'Fluctuations in Riyadh property prices, mitigated by pre-sale contracts secured at 27%.' },
    pdetail_risk3_t:     { en: 'Liquidity risk' },
    pdetail_risk3_d:     { en: 'The investment cannot be liquidated before the 36-month term ends (there is no secondary market).' },
    pdetail_risk_link:   { en: 'Read the full risk disclosure →' },
    pdetail_docs:        { en: 'Documents' },
    pdetail_doc1:        { en: 'Sample Murabaha contract' },
    pdetail_doc1_size:   { en: 'PDF · 12 pages' },
    pdetail_doc2:        { en: 'Detailed offering prospectus' },
    pdetail_doc2_size:   { en: 'PDF · 34 pages' },
    pdetail_doc3:        { en: 'Sharia compliance certificate' },
    pdetail_doc3_size:   { en: 'PDF · 4 pages' },
    pdetail_doc4:        { en: 'Financial feasibility study' },
    pdetail_doc4_size:   { en: 'PDF · 22 pages' },
    pdetail_investors:   { en: 'Investors' },
    pdetail_investors_sub: { en: '847 Saudi investors participated in this opportunity' },
    pdetail_faq:         { en: 'Frequently asked questions' },
    pdetail_faq1_q:      { en: 'When do I receive the first profit payment?' },
    pdetail_faq1_a:      { en: 'After the round closes successfully and all investors sign, the contract term begins officially, and the first payment is distributed after 90 days (the first quarter).' },
    pdetail_faq2_q:      { en: 'How is the project’s Sharia compliance verified?' },
    pdetail_faq2_a:      { en: 'Murbha’s independent Sharia board (Dr. Abdullah Al-Mania, Dr. Yusuf Al-Shubaily, Dr. Mohammed Al-Qari) reviewed the contract and structure and issued Sharia compliance certificate no. SH-2026/01.' },
    pdetail_faq3_q:      { en: 'Can I withdraw before 36 months?' },
    pdetail_faq3_a:      { en: 'No, the investment cannot be liquidated before the term ends. This is normal for real-estate Murabaha contracts. We encourage investing an amount you will not need during this period.' },
    pdetail_faq4_q:      { en: 'How is my money safeguarded before the project starts?' },
    pdetail_faq4_a:      { en: 'Funds remain held within a secure track and are only released to the beneficiary after the round reaches 100% and all investors sign the Murabaha contracts electronically.' },
    pdetail_faq5_q:      { en: 'What if the round doesn’t complete?' },
    pdetail_faq5_a:      { en: 'If we don’t reach the target within 45 days, all amounts are returned to investors within 3 business days at no fees.' },
    pdetail_cta_label:   { en: 'Expected return' },
    pdetail_save:        { en: 'Save' },
    pdetail_invest_now:  { en: 'Invest now' },
    pdetail_sheet_title: { en: 'Choose your investment amount' },
    pdetail_sheet_sub:   { en: 'Phase three of Al-Fursan Suburb' },

    // Timeline events on the project detail page
    pdetail_tl1_t: { en: 'Round opens' },
    pdetail_tl1_d: { en: '1 Sha‘ban 1447 AH' },
    pdetail_tl2_t: { en: '73% of target reached' },
    pdetail_tl2_d: { en: '24 Sha‘ban 1447 AH — today' },
    pdetail_tl3_t: { en: 'Expected round close' },
    pdetail_tl3_d: { en: '12 days remaining' },
    pdetail_tl4_t: { en: 'First profit distribution (Q1)' },
    pdetail_tl4_d: { en: '90 days after close' },
    pdetail_tl5_t: { en: 'End of contract term + capital return' },
    pdetail_tl5_d: { en: 'After 36 months' },
    pdetail_opt_min:     { en: 'Minimum' },
    pdetail_opt_popular: { en: 'Popular' },
    pdetail_sum_amt:     { en: 'Investment amount' },
    pdetail_sum_fee:     { en: 'Platform fee (1.5%)' },
    pdetail_sum_total:   { en: 'Total to pay now' },
    pdetail_continue_sign: { en: 'Continue to sign the contract' },

    support_hours:   { en: '🕐 Sun – Thu: 8 AM — 8 PM  |  Fri – Sat: 10 AM — 4 PM' }
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
      ? 'Murbha — Your partner in Saudi Vision 2030'
      : 'مُرابحة — شريكك في رؤية المملكة 2030';

    try { localStorage.setItem('murbaha_lang', lang); } catch (e) {}

    if (window.renderHomeProjects && window.__homeProjects) {
      window.renderHomeProjects(window.__homeProjects);
    }
    // Per-page dynamic re-render hooks (projects/portfolio/notifications/project detail).
    ['renderProjectsPage', 'renderPortfolioPage', 'renderNotificationsPage', 'renderProjectDetailPage']
      .forEach(function (fn) { if (typeof window[fn] === 'function') window[fn](); });
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
