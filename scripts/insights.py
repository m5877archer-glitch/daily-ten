#!/usr/bin/env python3
"""Read-only pull of Cloudflare Web Analytics for growth analysis.

Writes insights/cf.json: page loads for the last N days grouped by
Pacific date, path, referrer host, country and device type. Used by
the Insights workflow; changes nothing on the site.
"""
import json, os, sys, urllib.request
from datetime import datetime, timedelta, timezone

ACCOUNT = "548962cab0a1c41df6c1579dbe54006f"
SITE_TAG = "259c91d975754d27b31d01b53491c005"
OUT = sys.argv[1] if len(sys.argv) > 1 else "insights"
DAYS = int(os.environ.get("DAYS_BACK", "30"))
TOKEN = os.environ["CF_API_TOKEN"]

Q = """
query($account: String!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
  viewer { accounts(filter: {accountTag: $account}) {
    rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 10000) {
      count
      sum { visits }
      dimensions { date requestPath refererHost countryName deviceType }
    }
  } }
}"""


def gql(variables):
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/graphql",
        data=json.dumps({"query": Q, "variables": variables}).encode(),
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        body = json.load(r)
    if body.get("errors"):
        raise RuntimeError(json.dumps(body["errors"])[:800])
    return body["data"]["viewer"]["accounts"][0]["rumPageloadEventsAdaptiveGroups"]


def main():
    os.makedirs(OUT, exist_ok=True)
    now = datetime.now(timezone.utc)
    t = now - timedelta(days=DAYS)
    rows, errors = [], []
    while t < now:
        t2 = min(t + timedelta(days=2), now)
        f = {"AND": [
            {"datetime_geq": t.strftime("%Y-%m-%dT%H:%M:%SZ")},
            {"datetime_lt": t2.strftime("%Y-%m-%dT%H:%M:%SZ")},
            {"siteTag": SITE_TAG},
        ]}
        try:
            for r in gql({"account": ACCOUNT, "filter": f}):
                d = r["dimensions"]
                rows.append({"date": d["date"], "path": d["requestPath"] or "",
                             "ref": d["refererHost"] or "", "country": d["countryName"] or "",
                             "device": d["deviceType"] or "", "n": r["count"] or 0,
                             "visits": (r.get("sum") or {}).get("visits") or 0})
        except Exception as e:
            errors.append(f"{t.isoformat()}: {e}")
        t = t2
    with open(os.path.join(OUT, "cf.json"), "w") as fh:
        json.dump({"rows": rows, "errors": errors}, fh)
    print(f"{len(rows)} rows, {len(errors)} errors")
    for e in errors:
        print("  ", e)


if __name__ == "__main__":
    main()
