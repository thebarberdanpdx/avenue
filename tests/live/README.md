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
# The scripts read the service key from SUPABASE_SERVICE_ROLE_KEY (falling back to
# SUPABASE_SERVICE_KEY), and default SUPABASE_URL to the project URL — so if the
# key is set as a SECRET ENV VAR in this environment's config (the right place —
# never chat, never committed), the rig just works with nothing to source.
# Otherwise put it in a file OUTSIDE the repo and source it:
#   export SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
source <scratchpad>/.vero-secret   # only if not already in the environment
```

## Scripts

| Script | What it does |
|---|---|
| `driver.mjs` | Shared browser launcher. Routes through the agent proxy, caps TLS at 1.2 (the proxy resets Chromium's TLS 1.3), runs in `America/Los_Angeles`, blocks telemetry. `import { launch }`. |
| `public-smoke.mjs [baseUrl] [shop]` | Loads the public booking page, screenshots it. No login, no writes. |
| `seed-test-shop.mjs` | Stands up / refreshes the isolated `vero-test` shop (account + login + membership + shop in Test mode + cloned services/providers + a fake client). Idempotent. |
| `authed-smoke.mjs [email] [shop]` | Logs into the dashboard headlessly and reports whether writes succeed (no RLS 403 / "couldn't save" banner). Screenshots. |
| `appt-flow.mjs` | Full staff-side flow: open an appointment by deep-link, **CHECK-IN → CHECKOUT (Cash, Test mode)**, verifying each step in the DB. Prints PASS/FAIL. |
| `booking-guards.mjs` | Server-side backstops in `book_public` via the ANON key: double-book rejected, blocked client rejected, insert-only (can't overwrite an existing appt). The guards that protect real bookings even if the UI is bypassed. Prints PASS/FAIL per guard. |
| `public-book-e2e.mjs` | **THE core customer journey**, driven entirely through the real UI: storefront → first-time → pick service → barber → day → time → details → **BOOK**. Verifies the row persisted AND that `bookedFor` is the picked wall-clock time **in Pacific** (the tz-correctness backstop). Handles both the plain and guided-"Choose your cut" service paths. Cleans up after itself. `SVC_NAME`/`SVC_ID` env pick the service (default Beard Trim). |
| `importer-e2e.mjs` | **Migration importer regression** (Phase 4), against **`vero-mig`** (needs providers Dan + Heather). Staff login → Settings → Reports → Import data → upload an in-memory CSV → preview → import, then asserts the whole feature in the DB: phone/email **dedup**, **home barber from history** (2 Heather / 1 Dan → Heather, overriding Default=Dan), **notes/formula** carry-over, **retention** (visits), **quoted-comma** service names, and **skip-surfacing** (a row with an unreadable date is warned in preview + done, never silently dropped). Cleans up its `imp_` rows. |
| **Outage / hang drills** (Phase 3) | `outage-drill` (public menu), `booking-submit-hang` (book_public only), `booking-submit-hang-all` (**FULL hang** — proves the pre-book timeout), `manage-outage-drill`, `authed-outage-drill` (staff calendar), `outage-cache-redisplay` (staff calendar **re-displays** the last-synced schedule from cache during a hang — seeds the cache, then proves the appt re-appears + honest banner). Each makes the backend HANG (never resolves) and asserts an honest state, not an endless spinner. |

```bash
node tests/live/seed-test-shop.mjs                          # create/refresh vero-test
node tests/live/authed-smoke.mjs vero-livetest@vero.test vero-test
node tests/live/public-smoke.mjs https://gotvero.com vero-test
node tests/live/booking-guards.mjs                          # server guards (book_public)
node tests/live/public-book-e2e.mjs                         # full customer booking, UI → DB
SVC_NAME=Haircut SVC_ID=cut node tests/live/public-book-e2e.mjs   # guided-choice variant
```

**Entry URL matters:** `gotvero.com/<slug>` is the real **client** booking entry
(resolves the shop *and* lands on the booking flow). `?shop=<slug>` is the
**staff/dashboard** entry (shows staff sign-in). `public-book-e2e.mjs` uses the
pretty-slug URL so it drives exactly what a real customer sees.

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
- **No realtime / WebSockets from the cloud.** The agent proxy blocks WebSocket
  upgrades, and Supabase realtime runs over WS — so headless sessions here
  **never receive realtime pushes**. They fall back to the HTTP refetch, which
  is why a fresh insert only shows after a `page.reload()`. This means realtime
  freshness (a new booking popping onto an open calendar in ~1s) **cannot be
  tested from this rig** — it's a device-only check. Don't mistake the
  reload-to-see behavior for an app bug; on a real device (no proxy) realtime
  works.
- **Initial-load race:** because of the above, a row inserted via the service
  key only appears after a `page.reload()` (or the app's ~60s heartbeat). Wait
  for the row's text, and reload if needed, before interacting.
- **Calendar tiles are virtualized, unstyled divs** (no test IDs), so
  tile-clicking is flaky. **Solved by the `?appt=<id>` deep-link** (shipped in
  `src/App.jsx`): it opens the appointment sheet directly, no tile-clicking.
  `appt-flow.mjs` uses it to drive check-in → checkout reliably. Combine with the
  reload trick above to defeat the initial-load race.

## Cleanup / teardown

Everything is scoped to `vero-test` and the `vero-livetest@vero.test` user:

```js
await sb.from(t).delete().eq('shop_id','vero-test'); // for each table
await sb.from('shops').delete().eq('id','vero-test');
// + delete the account/membership/auth user if fully tearing down
```
