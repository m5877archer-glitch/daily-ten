#!/usr/bin/env python3
"""Pull daily 10Everyday numbers from Cloudflare Web Analytics.

Writes stats/daily.json keyed by Pacific date:
  visits        real people (same as the dashboard's Visits)
  pageviews     raw page views (inflated by tracking events)
  done          finished quizzes (/done-MMDD paths)
  merch_view    saw the shop page before the score
  merch_click   tapped "Visit the shop" on that page
  shop          went through any /shop link
  shop_q        tapped the product link inside a quiz question
  signups       email signups, split into signup_mid / signup_results / signup_merch
  share_pressed tapped "Challenge a Friend" on the score card
  email, share, reddit, facebook, pt   visits arriving on /e, /s, /r, /f, /pt
Also writes stats/last-run.json with any errors, so problems are visible
without opening the Actions log.
"""
import json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ACCOUNT = "548962cab0a1c41df6c1579dbe54006f"
SITE_TAG = "259c91d975754d27b31d01b53491c005"
PT = ZoneInfo("America/Los_Angeles")
OUT = sys.argv[1] if len(sys.argv) > 1 else "stats"
DAYS_BACK = int(os.environ.get("DAYS_BACK", "30"))
TOKEN = os.environ["CF_API_TOKEN"]

ENTRY = {"/e": "email", "/s": "share", "/r": "reddit", "/f": "facebook", "/pt": "pt"}
COUNTED = {"/merch-view": "merch_view", "/merch-click": "merch_click", "/shop": "shop", "/shop-q": "shop_q",
           "/signup-mid": "signup_mid", "/signup-results": "signup_results", "/signup-merch": "signup_merch",
           "/share-pressed": "share_pressed"}

errors = []

def gql(query, variables):
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/graphql",
        data=json.dumps({"query": query, "variables": variables}).encode(),
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.load(r)
    if body.get("errors"):
        raise RuntimeError(json.dumps(body["errors"])[:800])
    return body["data"]["viewer"]["accounts"][0]["rumPageloadEventsAdaptiveGroups"]

Q = """
query($account: String!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
  viewer { accounts(filter: {accountTag: $account}) {
    rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 10000) {
      count
      sum { visits }
      dimensions { datetimeHour requestPath }
    }
  } }
}"""

def fetch(start, end, with_bot_filter):
    f = {"AND": [
        {"datetime_geq": start.strftime("%Y-%m-%dT%H:%M:%SZ")},
        {"datetime_lt": end.strftime("%Y-%m-%dT%H:%M:%SZ")},
        {"siteTag": SITE_TAG},
    ]}
    if with_bot_filter:
        f["AND"].append({"bot": 0})
    return gql(Q, {"account": ACCOUNT, "filter": f})

def pacific_day(hour_iso):
    t = datetime.fromisoformat(hour_iso.replace("Z", "+00:00"))
    return t.astimezone(PT).date().isoformat()

def main():
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "daily.json")
    try:
        with open(path) as fh:
            data = json.load(fh)
    except Exception:
        data = {}

    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    # Start at Pacific midnight so the first day is complete.
    first = (now.astimezone(PT) - timedelta(days=DAYS_BACK)).replace(hour=0)
    start = first.astimezone(timezone.utc)
    fresh = {}
    bot_filter = True
    t = start
    while t < now:
        t2 = min(t + timedelta(days=3), now)
        try:
            rows = fetch(t, t2, bot_filter)
        except RuntimeError as e:
            if bot_filter and "bot" in str(e):
                bot_filter = False
                errors.append("bot filter not accepted; counting without it")
                continue
            errors.append(f"{t.isoformat()}: {e}")
            t = t2
            continue
        for r in rows:
            d = pacific_day(r["dimensions"]["datetimeHour"])
            p = r["dimensions"]["requestPath"] or ""
            day = fresh.setdefault(d, {"visits": 0, "pageviews": 0, "done": 0,
                                       "merch_view": 0, "merch_click": 0, "shop": 0, "shop_q": 0,
                                       "email": 0, "share": 0, "reddit": 0, "facebook": 0, "pt": 0,
                                       "signups": 0, "signup_mid": 0, "signup_results": 0, "signup_merch": 0})
            v = (r.get("sum") or {}).get("visits") or 0
            n = r.get("count") or 0
            day["visits"] += v
            day["pageviews"] += n
            if p.startswith("/done-"):
                day["done"] += n
            key = COUNTED.get(p.rstrip("/").replace(".html", ""))
            if key:
                day[key] += n
                if key.startswith("signup_"):
                    day["signups"] += n
            key = ENTRY.get(p.rstrip("/").replace(".html", ""))
            if key:
                day[key] += v
        t = t2

    today = now.astimezone(PT).date().isoformat()
    for d, v in fresh.items():
        v["partial"] = d == today
        data[d] = v
    data = dict(sorted(data.items()))
    with open(path, "w") as fh:
        json.dump(data, fh, indent=1)
    with open(os.path.join(OUT, "last-run.json"), "w") as fh:
        json.dump({"ran_at": now.isoformat(), "days_updated": len(fresh),
                   "bot_filter": bot_filter, "errors": errors}, fh, indent=1)
    print(f"Updated {len(fresh)} days; {len(errors)} errors")
    for e in errors:
        print("  ", e)
    if errors and not fresh:
        sys.exit(1)

if __name__ == "__main__":
    main()
