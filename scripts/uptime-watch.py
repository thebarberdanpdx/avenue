#!/usr/bin/env python3
"""Vero uptime watchdog (run by .github/workflows/uptime-check.yml).

Checks the website + database from OUTSIDE every 5 minutes. When something is
unreachable it sends the OWNER a clean "Vero is DOWN" alert (email + text) via
the app's own messaging system (/api/notify alert mode) — the channel proven to
reach Dan. It alerts only ONCE per outage: it reads this workflow's own history
and stays quiet if the previous run was already failing, so a multi-hour outage
doesn't text every 5 minutes. A recovery run (success) naturally resets that, so
the next outage alerts again.

The run still exits non-zero when down, so GitHub logs it and its own failure
email fires as a BACKUP path — important because if the whole SITE is down, the
/api/notify alert can't send (it lives on the same host), and GitHub's email is
then the only channel left.

The anon key in DB_URL is the public key already shipped in the app bundle.
"""
import json, os, sys, time, urllib.request, urllib.error

SITE_URL = "https://gotvero.com"
DB_URL = ("https://iufgznminbujcabqeesk.supabase.co/rest/v1/services"
          "?select=id&limit=1&shop_id=eq.sanctuary"
          "&apikey=sb_publishable_aGX3akW7VfHO6Lm-FsZmEA_sf95Nu2i")
NOTIFY_URL = "https://gotvero.com/api/notify"
SHOP = "sanctuary"
OWNER_PROVIDER = "dan"   # Dan's staff record — resolves to his on-file email + phone
WORKFLOW_FILE = "uptime-check.yml"


def http_status(url, timeout=25):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code          # server answered (e.g. 503) — reachable but erroring
    except Exception:
        return 0               # connection failed / timed out — unreachable


def probe(url, expect=200, tries=3):
    code = 0
    for i in range(tries):
        code = http_status(url)
        if code == expect:
            return True, code
        if i < tries - 1:
            time.sleep(10)     # ride out a transient blip before crying wolf
    return False, code


def prev_conclusion():
    """Conclusion of the most recent COMPLETED run (the current run is still in
    progress, so it's excluded). 'failure' => we were already down => don't re-alert."""
    repo, tok = os.environ.get("GITHUB_REPOSITORY", ""), os.environ.get("GITHUB_TOKEN", "")
    if not repo or not tok:
        return "unknown"
    url = f"https://api.github.com/repos/{repo}/actions/workflows/{WORKFLOW_FILE}/runs?status=completed&per_page=1"
    try:
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {tok}",
                                                   "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            runs = json.load(r).get("workflow_runs", [])
        return runs[0]["conclusion"] if runs else "none"
    except Exception as e:
        print(f"  (couldn't read run history: {e}) — treating as not-previously-down")
        return "unknown"


def send_alert(subject, message):
    body = json.dumps({"shop": SHOP,
                       "alert": {"shopId": SHOP, "providerId": OWNER_PROVIDER},
                       "subject": subject, "message": message}).encode()
    try:
        req = urllib.request.Request(NOTIFY_URL, data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=25) as r:
            print(f"  alert POST -> HTTP {r.status}: {r.read(300).decode(errors='replace')}")
            return True
    except Exception as e:
        print(f"  alert POST FAILED (site may be down; GitHub email is the backup): {e}")
        return False


def main():
    # Manual test: send a clearly-labeled test alert and exit clean.
    if os.environ.get("TEST_ALERT", "no").strip().lower() == "yes":
        print("TEST_ALERT: sending a test downtime alert to the owner…")
        ok = send_alert("Vero downtime alarm — TEST",
                        "This is a TEST of your downtime alarm. Nothing is wrong; if you got this "
                        "(text and/or email), real outage alerts will reach you the same way.")
        sys.exit(0 if ok else 1)

    site_ok, site_code = probe(SITE_URL)
    db_ok, db_code = probe(DB_URL)
    down = [name for name, ok in (("the website", site_ok), ("the database", db_ok)) if not ok]
    current = "down" if down else "up"
    prev_c = prev_conclusion()
    prev = "down" if prev_c == "failure" else "up"
    print(f"site={'OK' if site_ok else site_code}  db={'OK' if db_ok else db_code}  "
          f"current={current}  prev={prev} (last conclusion={prev_c})")

    if current == "down":
        if prev != "down":
            what = " and ".join(down)
            what = what[0].upper() + what[1:]
            verb = "are" if len(down) > 1 else "is"
            send_alert("Vero is DOWN",
                       f"{what} {verb} unreachable — clients may not be able to book right now. "
                       "Automated alert from your uptime watchdog. Check gotvero.com.")
        else:
            print("  already alerted for this outage — staying quiet (no re-spam).")
        sys.exit(1)   # fail the run: logs it + GitHub's own email as backup channel
    print("  all systems up.")
    sys.exit(0)


if __name__ == "__main__":
    main()
