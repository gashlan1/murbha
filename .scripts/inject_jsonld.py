#!/usr/bin/env python3
"""
Inject JSON-LD structured data into every page.

Each page receives:
  - Organization (FinancialService) schema  ← global, identical
  - BreadcrumbList schema                   ← per-page

The block is fenced with HTML comments so re-running this script
REPLACES the previous block (no duplicates).
"""
import json, os, glob, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://murabaha.example.sa"

START = "<!-- BEGIN: managed-jsonld (do not edit by hand) -->"
END   = "<!-- END: managed-jsonld -->"

# Page label for breadcrumbs (Arabic)
PAGES = {
    "hessa.html":           "الرئيسية",
    "projects.html":        "المشاريع",
    "project.html":         "تفاصيل المشروع",
    "auth.html":            "تسجيل الدخول",
    "portfolio.html":       "المحفظة",
    "profile.html":         "حسابي",
    "notifications.html":   "الإشعارات",
    "contract.html":        "عقد المرابحة",
    "help.html":            "المساعدة",
    "legal.html":           "الوثائق القانونية",
    "privacy.html":         "اتفاقية الخصوصية",
    "data-protection.html": "حماية البيانات",
    "terms.html":           "الشروط والأحكام",
    "risk.html":            "الإفصاح عن المخاطر",
    "sharia.html":          "الفتوى الشرعية",
    "aml.html":             "مكافحة غسل الأموال",
    "kyc.html":             "اعرف عميلك",
    "complaints.html":      "الشكاوى",
    "cookies.html":         "ملفات تعريف الارتباط",
}

ORGANIZATION = {
    "@context": "https://schema.org",
    "@type": "FinancialService",
    "@id": f"{SITE}/#organization",
    "name": "مُرابحة",
    "alternateName": "Murabaha",
    "url": SITE,
    "logo": f"{SITE}/favicon.svg",
    "image": f"{SITE}/og-image.svg",
    "description": "منصّة استثمار إسلامية متوافقة مع الشريعة، تتيح المشاركة في مشاريع رؤية ٢٠٣٠ عبر عقود المرابحة بإشراف هيئة شرعية.",
    "areaServed": {"@type": "Country", "name": "Saudi Arabia"},
    "availableLanguage": ["ar", "en"],
    "currenciesAccepted": "SAR",
    "paymentAccepted": ["Mada", "Apple Pay", "STC Pay", "Sadad"],
}

WEBSITE = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": f"{SITE}/#website",
    "url": SITE,
    "name": "مُرابحة",
    "inLanguage": "ar-SA",
    "publisher": {"@id": f"{SITE}/#organization"},
}

def breadcrumb(slug: str, label: str) -> dict:
    items = [
        {"@type": "ListItem", "position": 1, "name": "الرئيسية", "item": f"{SITE}/hessa.html"},
    ]
    if slug != "hessa.html":
        items.append({"@type": "ListItem", "position": 2, "name": label, "item": f"{SITE}/{slug}"})
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": items,
    }

def render(slug: str, label: str) -> str:
    crumbs = breadcrumb(slug, label)
    parts = [
        '<script type="application/ld+json">',
        json.dumps(ORGANIZATION, ensure_ascii=False, indent=2),
        '</script>',
        '<script type="application/ld+json">',
        json.dumps(WEBSITE, ensure_ascii=False, indent=2),
        '</script>',
        '<script type="application/ld+json">',
        json.dumps(crumbs, ensure_ascii=False, indent=2),
        '</script>',
    ]
    return f"{START}\n" + "\n".join(parts) + f"\n{END}"

BLOCK_RE = re.compile(re.escape(START) + r".*?" + re.escape(END), re.DOTALL)

def main():
    changed = 0
    for slug, label in PAGES.items():
        path = os.path.join(ROOT, slug)
        if not os.path.exists(path):
            print(f"  [skip] {slug}")
            continue
        src = open(path, encoding='utf-8').read()
        block = render(slug, label)

        if START in src:
            new = BLOCK_RE.sub(block, src)
            action = 'updated'
        elif '</head>' in src:
            new = src.replace('</head>', f'    {block}\n  </head>', 1)
            action = 'inserted'
        else:
            print(f"  [skip] {slug} — no </head>")
            continue

        if new != src:
            open(path, 'w', encoding='utf-8').write(new)
            changed += 1
        print(f"  [{action:<8}] {slug}")
    print(f"\n  Total modified: {changed}/{len(PAGES)}")

if __name__ == '__main__':
    main()
