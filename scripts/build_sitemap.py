#!/usr/bin/env python3
"""Rebuild sitemap.xml from the editions in the repo.

Runs automatically on every push (see .github/workflows/sitemap.yml), so new
editions land in the sitemap without anyone remembering to add them.

Rules:
- Every quiz-*.html with an EDITION_DATE constant is listed, newest first.
- Editions dated after today (Pacific) are left out until their day arrives.
- Any page carrying a robots noindex tag is never listed.
- The homepage and archive get the newest live edition's date as lastmod.
"""
import datetime as dt
import glob
import os
import re
import sys
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://10everyday.com"
STATIC_PAGES = [  # (path, changefreq), only pages meant for search
    ("", "daily"),
    ("archive.html", "daily"),
    ("games.html", "monthly"),
    ("pricing.html", "monthly"),
    ("work.html", "monthly"),
]
DATE_RE = re.compile(r'const EDITION_DATE = "(\d{4}-\d{2}-\d{2})"')
NOINDEX_RE = re.compile(r'<meta name="robots" content="[^"]*noindex', re.I)


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def main():
    today = dt.datetime.now(ZoneInfo("America/Los_Angeles")).date()
    editions = []
    for path in glob.glob(os.path.join(ROOT, "quiz-*.html")):
        name = os.path.basename(path)
        html = read(name)
        if NOINDEX_RE.search(html):
            continue
        m = DATE_RE.search(html)
        if m:
            d = dt.date.fromisoformat(m.group(1))
        else:
            # The first July 2026 editions predate the EDITION_DATE constant.
            fm = re.fullmatch(r"quiz-([a-z]+)-(\d+)\.html", name)
            if not fm:
                continue
            d = dt.datetime.strptime(f"{fm.group(1)} {fm.group(2)} 2026", "%B %d %Y").date()
        if d <= today:
            editions.append((d, name))
    if not editions:
        sys.exit("No editions found; refusing to write an empty sitemap.")
    editions.sort(reverse=True)
    newest = editions[0][0].isoformat()

    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for path, freq in STATIC_PAGES:
        if path and NOINDEX_RE.search(read(path)):
            continue
        lastmod = f"<lastmod>{newest}</lastmod>" if freq == "daily" else ""
        lines.append(f"  <url><loc>{SITE}/{path}</loc>{lastmod}<changefreq>{freq}</changefreq></url>")
    for d, name in editions:
        lines.append(f"  <url><loc>{SITE}/{name}</loc><lastmod>{d.isoformat()}</lastmod><changefreq>never</changefreq></url>")
    lines.append("</urlset>")

    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"sitemap.xml: {len(STATIC_PAGES)} pages + {len(editions)} editions, newest {newest}")


if __name__ == "__main__":
    main()
