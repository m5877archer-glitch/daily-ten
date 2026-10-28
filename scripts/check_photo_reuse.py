#!/usr/bin/env python3
"""Fail if a quiz edition reuses a stock photo from any earlier edition.

Usage: python3 scripts/check_photo_reuse.py quiz-october-29.html
Matt's rule (Oct 28, 2026): find new pictures every day. Product photos
(img/products/) are exempt, since the shop only has a handful of items.
"""
import datetime, glob, re, sys

MONTHS = {m.lower(): i for i, m in enumerate(
    ["January","February","March","April","May","June","July","August",
     "September","October","November","December"], 1)}

def edition_date(path):
    s = open(path, encoding="utf-8").read()
    m = re.search(r'const EDITION_DATE = "(\d{4}-\d{2}-\d{2})"', s)
    if m:
        return datetime.date.fromisoformat(m.group(1))
    m = re.match(r"quiz-([a-z]+)-(\d+)\.html", path.split("/")[-1])
    return datetime.date(2026, MONTHS[m.group(1)], int(m.group(2))) if m else None

def photos(path):
    return set(re.findall(r'img/photos/[A-Za-z0-9._-]+', open(path, encoding="utf-8").read()))

target = sys.argv[1]
d = edition_date(target)
used = {}
for f in glob.glob("quiz-*.html"):
    if f == target:
        continue
    fd = edition_date(f)
    if fd and fd < d:
        for p in photos(f):
            used.setdefault(p, []).append(f)
bad = {p: used[p] for p in photos(target) if p in used}
for p, fs in sorted(bad.items()):
    print("REUSED PHOTO %s (already in %s)" % (p, ", ".join(sorted(fs))))
print("photo reuse check: %s" % ("FAIL" if bad else "ok, %d fresh photos" % len(photos(target))))
sys.exit(1 if bad else 0)
