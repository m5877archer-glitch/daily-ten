#!/usr/bin/env python3
"""Download any photo listed in img/photos.json that isn't in the repo yet.

Runs on GitHub's servers (the fetch-photos workflow), resizes each photo to
1200px wide and saves it as a JPG, so quiz pages never depend on another
site to load an image.
"""
import io, json, os, re, sys, urllib.request
from PIL import Image

MANIFEST = "img/photos.json"
WIDTH = 1200

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0 Safari/537.36")

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    return urllib.request.urlopen(req, timeout=60).read()

def candidates(p):
    # 1. The photo page's og:image, which points at images.unsplash.com.
    yield "page", None
    # 2. Unsplash's public download link.
    yield "download", "https://unsplash.com/photos/%s/download?force=true" % p["unsplash_id"]

def fetch(p):
    errs = []
    for how, url in candidates(p):
        try:
            if how == "page":
                html = get(p["page"]).decode("utf-8", "replace")
                m = re.search(r'property="og:image" content="([^"]+)"', html) or \
                    re.search(r'(https://images\.unsplash\.com/photo-[^"?\s]+)', html)
                if not m:
                    raise ValueError("no og:image on page")
                url = m.group(1).split("?")[0] + "?w=1600&fm=jpg&q=85"
            return get(url)
        except Exception as e:
            errs.append("%s: %s" % (how, e))
    raise RuntimeError("; ".join(errs))

def main():
    with open(MANIFEST) as fh:
        photos = json.load(fh)["photos"]
    report = []
    for p in photos:
        out = p["file"]
        if os.path.exists(out):
            continue
        try:
            im = Image.open(io.BytesIO(fetch(p))).convert("RGB")
            if im.width > WIDTH:
                im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            im.save(out, quality=82, optimize=True, progressive=True)
            print("saved", out, im.size)
        except Exception as e:
            print("FAILED", out, e)
            report.append("%s  %s" % (out, e))
    # Leave a readable report in the repo so failures are visible without
    # opening the Actions log.
    with open("img/photos-report.txt", "w") as fh:
        fh.write("\n".join(report) + "\n" if report else "All photos present.\n")

if __name__ == "__main__":
    main()
