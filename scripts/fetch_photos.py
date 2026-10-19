#!/usr/bin/env python3
"""Download any photo listed in img/photos.json that isn't in the repo yet.

Runs on GitHub's servers (the fetch-photos workflow), resizes each photo to
1200px wide and saves it as a JPG, so quiz pages never depend on another
site to load an image.
"""
import io, json, os, sys, urllib.request
from PIL import Image

MANIFEST = "img/photos.json"
WIDTH = 1200

def main():
    with open(MANIFEST) as fh:
        photos = json.load(fh)["photos"]
    failed = []
    for p in photos:
        out = p["file"]
        if os.path.exists(out):
            continue
        url = "https://unsplash.com/photos/%s/download?force=true" % p["unsplash_id"]
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "10everyday-photo-fetch"})
            data = urllib.request.urlopen(req, timeout=60).read()
            im = Image.open(io.BytesIO(data)).convert("RGB")
            if im.width > WIDTH:
                im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            im.save(out, quality=82, optimize=True, progressive=True)
            print("saved", out, im.size)
        except Exception as e:
            print("FAILED", out, e)
            failed.append(out)
    if failed:
        sys.exit(1)

if __name__ == "__main__":
    main()
