#!/usr/bin/env python3
"""
Idempotent injector for:
  1. <link rel="stylesheet" href="/assets/site.css"> in <head>
  2. <a class="skip-link" href="#main">…</a> right after <body>

Runs over every *.html in the project root.  Safe to re-run.
"""
import re, os, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS_TAG  = '<link rel="stylesheet" href="/assets/site.css" />'
SKIP_TAG = '<a class="skip-link" href="#main">تخطّي إلى المحتوى الرئيسي</a>'

def patch(html: str) -> str:
    # 1. inject site.css before </head> if not present
    if 'href="/assets/site.css"' not in html and '</head>' in html:
        html = html.replace('</head>', f'    {CSS_TAG}\n  </head>', 1)

    # 2. inject skip-link right after <body> (any attributes) if not present
    if 'class="skip-link"' not in html:
        html = re.sub(r'(<body\b[^>]*>)', r'\1\n' + SKIP_TAG, html, count=1)

    return html

def main():
    changed = 0
    for path in sorted(glob.glob(os.path.join(ROOT, '*.html'))):
        original = open(path, encoding='utf-8').read()
        new = patch(original)
        action = 'unchanged'
        if new != original:
            open(path, 'w', encoding='utf-8').write(new)
            changed += 1
            action = 'patched'
        print(f"  [{action:<9}] {os.path.basename(path)}")
    print(f"\n  Total files patched: {changed}")

if __name__ == '__main__':
    main()
