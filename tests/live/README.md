# Live testing without a phone (`tests/live/`)

Drive the **real** Vero app (gotvero.com) headlessly from a cloud session so
changes can be verified without Dan on his iPhone. Built during the
`claude/live-testing-setup` session.

## What this gives you

- Load and **screenshot any screen** of the live app (public + authed).
- **Log into the staff dashboard** headlessly (no magic-link email round-trip)
  via a minted Supabase session.
- A **throwaway, isolated test shop** (`vero-test`) where mutation flows
  (booking, checkout) run safely — separate `shop_id`, **Test-payment mode**
  (never charges a card), fake phone numbers (no real SMS).
- End-to-end proof: a **public booking driven entirely headless** creates a real
  appointment (verified in the DB).

## Safety rails (do not remove)

- **Only ever mutate `shop_id='vero-test'`.** Sanctuary is LIVE (real payments,
  ~300 real appts). Never drive mutations against it. The seed/cleanup scripts
  are all scoped to `vero-test`.
- **Telemetry is blocked in the test browser** (`driver.mjs` → `isTelemetryHost`)
  so a test-induced error can't fire a Sentry alert to Dan's inbox. A read-only
  login once did exactly that before this was added.
- **The service-role key is never committed.** It lives only in a session file
  outside the repo and is read from `SUPABASE_SERVICE_KEY`. `ship-check` also
  scans for `sb_secret_`.
- Server-side `api/` errors still report to Sentry (can't be blocked from the
  browser) — keep test flows valid; warn Dan before exercising an error path.

## Setup

```bash
npm install --ignore-scripts          # sharp's postinstall is blocked by the proxy; it isn't needed
npm install --no-save --ignore-scripts playwright-core
# put the service key in a file OUTSIDE the repo, e.g. the session scratchpad:
#   export SUPABASE_URL=https://iufgznminbujcabqeesk.supabase.co
#   export SUPABASE_SERVICE_KEY=sb_secret_...
source <scratchpad>/.vero-secret
```

## Scripts

| Script | What it does |
|---|---|
| `driver.mjs` | Shared browser launcher. Routes through the agent proxy, caps TLS at 1.2 (the proxy resets Chromium's TLS 1.3), runs in `America/Los_Angeles`, blocks telemetry. `import { launch }`. |
| `public-smoke.mjs [baseUrl] [shop]` | Loads the public booking page, screenshots it. No login, no writes. |
| `seed-test-shop.mjs` | Stands up / refreshes the isolated `vero-test` shop (account + login + membership + shop in Test mode + cloned services/providers + a fake client). Idempotent. |
| `authed-smoke.mjs [email] [shop]` | Logs into the dashboard headlessly and reports whether writes succeed (no RLS 403 / "couldn't save" banner). Screenshots. |

```bash
node tests/live/seed-test-shop.mjs                          # create/refresh vero-test
node tests/live/authed-smoke.mjs vero-livetest@vero.test vero-test
node tests/live/public-smoke.mjs https://gotvero.com vero-test
```

Screenshots go to `$SHOTS` (defaults to the session scratchpad `shots/`).

## How login works (no email needed)

The app stores its Supabase session in `localStorage` under
`sb-<ref>-auth-token` and shows the dashboard when a session lands with
`localStorage.vero_login_intent='staff'`. So: mint a magic link with the
service key (`auth.admin.generateLink`), set the staff-intent flag on
gotvero.com, then navigate the browser to the magic link — the app's own client
consumes it and renders the dashboard. Membership is enforced **server-side by
RLS**, not a client gate.

## Data / ownership model (learned this session)

- Tables: `shops` (`{id,name,slug,settings,account_id}`), and `providers` /
  `services` / `clients` / `appointments` / `waitlist` as `{id, shop_id, data}`.
  (Local state calls appointments `appts`; the DB table is `appointments`.)
- **Writes are gated by membership:** a user must have a `memberships` row for
  the `accounts` row that owns the shop (`shops.account_id`). `avenue-phi` has
  `account_id=null`, so nobody can write to it (that's why it 403s).
- Row PK is composite **`(shop_id, id)`** — ids repeat across shops, so writes
  scoped to `vero-test` can never touch another shop's rows.

## Known gotchas

- **Timezone:** the sandbox is UTC; the shop is Pacific. `driver.mjs` pins the
  context to `America/Los_Angeles`. Without it, a booked "9 AM" stores as 9 AM
  UTC (2 AM Pacific) — the known off-tz-booker issue.
- **Initial-load race:** a row inserted via the service key may not appear in
  the staff UI on first paint; a `page.reload()` (or the app's ~60s refetch)
  surfaces it. Wait for the row's text before interacting.
- **Calendar tiles are virtualized, unstyled divs** (no test IDs). Opening an
  appointment tile is flaky to automate. The single biggest improvement to
  staff-side testability would be a stable `data-testid` on appointment tiles
  (and key action buttons), or a way to deep-link an appointment.

## Cleanup / teardown

Everything is scoped to `vero-test` and the `vero-livetest@vero.test` user:

```js
await sb.from(t).delete().eq('shop_id','vero-test'); // for each table
await sb.from('shops').delete().eq('id','vero-test');
// + delete the account/membership/auth user if fully tearing down
```
