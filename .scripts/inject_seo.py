#!/usr/bin/env python3
"""
Idempotent SEO/PWA meta injector for the Murabaha platform.

Inserts (or updates) a managed block of meta tags right before </head>:
  - meta description
  - canonical URL
  - Open Graph tags
  - Twitter Card
  - favicon (svg)
  - apple-touch-icon
  - web manifest

The block is fenced with HTML comments so re-running this script
will REPLACE the previous block instead of duplicating it.

Usage:  python3 .scripts/inject_seo.py
"""
import re, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://murabaha.example.sa"  # canonical/OG base URL — update on deploy

START = "<!-- BEGIN: managed-seo-meta (do not edit by hand) -->"
END   = "<!-- END: managed-seo-meta -->"

# Page-specific titles & descriptions (Arabic)
PAGES = {
    "hessa.html": (
        "مُرابحة — منصّة الاستثمار الإسلامي",
        "منصّة استثمار إسلامية متوافقة مع الشريعة. شارك في مشاريع رؤية ٢٠٣٠ عبر عقود المرابحة، تحقّق نفاذ، وإشراف هيئة شرعية معتمدة.",
    ),
    "projects.html": (
        "المشاريع — مُرابحة",
        "أُولى الفرص الاستثمارية المتوافقة مع الشريعة على منصّة مُرابحة تُعلَن قريباً. سجّل في قائمة الانتظار لتكون من أوائل المستثمرين.",
    ),
    "project.html": (
        "نموذج فرصة استثمارية — مُرابحة",
        "نموذج توضيحي لشكل فرصة الاستثمار على منصّة مُرابحة: العائد المتوقّع، المدة، الضمانات، والفتوى الشرعية. الفرص الفعلية تُعلَن قريباً.",
    ),
    "auth.html": (
        "تسجيل الدخول والتسجيل — مُرابحة",
        "سجّل الدخول إلى مُرابحة عبر نفاذ بكل أمان، أو أنشئ حساباً جديداً لتكون من أوائل المستثمرين فور إطلاق الفرص الاستثمارية.",
    ),
    "portfolio.html": (
        "محفظتي — مُرابحة",
        "تابع استثماراتك، أرباحك المتوقّعة، رصيدك، وحركاتك المالية في لوحة المحفظة الموحّدة.",
    ),
    "profile.html": (
        "حسابي — مُرابحة",
        "إعدادات الحساب، الأمان، الوثائق، والتفضيلات. أدِر بياناتك الشخصية وحسابك البنكي بكل خصوصية.",
    ),
    "notifications.html": (
        "الإشعارات — مُرابحة",
        "آخر التحديثات على استثماراتك، فرص جديدة، توزيعات أرباح، وتنبيهات الحساب.",
    ),
    "contract.html": (
        "عقد المرابحة — مُرابحة",
        "نموذج عقد المرابحة المعتمد من الهيئة الشرعية، عشر مواد متوافقة مع الشريعة الإسلامية والتوقيع عبر نفاذ.",
    ),
    "help.html": (
        "المساعدة والدعم — مُرابحة",
        "تواصل معنا عبر واتساب أو الهاتف، أو استعرض الأسئلة الشائعة لإيجاد إجابات سريعة.",
    ),
    "legal.html": (
        "الوثائق القانونية — مُرابحة",
        "سياسة الخصوصية، الشروط والأحكام، الإفصاح عن المخاطر، الفتوى الشرعية، وإجراءات الشكاوى.",
    ),
    "privacy.html": (
        "اتفاقية الخصوصية — مُرابحة",
        "سياسة الخصوصية المتوافقة مع نظام حماية البيانات الشخصية (PDPL) في المملكة العربية السعودية.",
    ),
    "data-protection.html": (
        "سياسة حماية البيانات — مُرابحة",
        "سياسة الاحتفاظ بالبيانات وحمايتها، حقوقك كصاحب بيانات، وآليات الإفصاح والتصحيح.",
    ),
    "terms.html": (
        "الشروط والأحكام — مُرابحة",
        "الشروط والأحكام التي تحكم استخدامك لمنصّة مُرابحة وعمليات الاستثمار من خلالها.",
    ),
    "risk.html": (
        "الإفصاح عن المخاطر — مُرابحة",
        "إفصاح المخاطر المالية والاستثمارية وفق إرشادات هيئة السوق المالية. اقرأها قبل اتخاذ أي قرار استثماري.",
    ),
    "sharia.html": (
        "الفتوى الشرعية — مُرابحة",
        "الفتوى الصادرة عن الهيئة الشرعية بعضوية أربعة علماء، تشمل عقد المرابحة، المضاربة، والإجارة.",
    ),
    "aml.html": (
        "مكافحة غسل الأموال — مُرابحة",
        "سياسة مكافحة غسل الأموال وتمويل الإرهاب وفق أنظمة المملكة العربية السعودية.",
    ),
    "kyc.html": (
        "اعرف عميلك (KYC) — مُرابحة",
        "إجراءات التحقّق من هوية العملاء وفق متطلبات الجهات التنظيمية في المملكة.",
    ),
    "complaints.html": (
        "الشكاوى وتسوية النزاعات — مُرابحة",
        "آليات تقديم الشكاوى ومعالجتها، ومسارات تسوية النزاعات بشكل عادل وسريع.",
    ),
    "cookies.html": (
        "سياسة ملفات تعريف الارتباط — مُرابحة",
        "كيف نستخدم ملفات تعريف الارتباط (Cookies)، أنواعها، وكيفية التحكّم بها.",
    ),
}

def render_block(slug: str, title: str, desc: str) -> str:
    canonical = f"{SITE}/{slug}"
    og_image  = f"{SITE}/og-image.svg"
    desc_attr = desc.replace('"', '&quot;')
    title_attr = title.replace('"', '&quot;')
    return f"""{START}
    <meta name="description" content="{desc_attr}" />
    <meta name="author" content="مُرابحة" />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="{canonical}" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="مُرابحة" />
    <meta property="og:locale" content="ar_SA" />
    <meta property="og:title" content="{title_attr}" />
    <meta property="og:description" content="{desc_attr}" />
    <meta property="og:url" content="{canonical}" />
    <meta property="og:image" content="{og_image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="مُرابحة — منصّة الاستثمار الإسلامي" />

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{title_attr}" />
    <meta name="twitter:description" content="{desc_attr}" />
    <meta name="twitter:image" content="{og_image}" />

    <!-- Icons & PWA -->
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/favicon.svg" />
    <link rel="manifest" href="/manifest.webmanifest" />
    {END}"""

BLOCK_RE = re.compile(re.escape(START) + r".*?" + re.escape(END), re.DOTALL)

def process(path: str, slug: str, title: str, desc: str) -> str:
    src = open(path, encoding="utf-8").read()
    block = render_block(slug, title, desc)

    # Replace existing managed block if present
    if START in src:
        new_src = BLOCK_RE.sub(block, src)
        return new_src, "updated"

    # Otherwise, inject before </head>
    if "</head>" not in src:
        return src, "skipped (no </head>)"

    # Indent block to match surrounding code (best effort: use 4 spaces)
    new_src = src.replace("</head>", f"    {block}\n  </head>", 1)
    return new_src, "inserted"

def main():
    changed = 0
    for slug, (title, desc) in PAGES.items():
        path = os.path.join(ROOT, slug)
        if not os.path.exists(path):
            print(f"  [skip] {slug} — file not found")
            continue
        new_src, action = process(path, slug, title, desc)
        original = open(path, encoding="utf-8").read()
        if new_src != original:
            open(path, "w", encoding="utf-8").write(new_src)
            changed += 1
        print(f"  [{action:<8}] {slug}")
    print(f"\n  Total files modified: {changed}/{len(PAGES)}")

if __name__ == "__main__":
    main()
