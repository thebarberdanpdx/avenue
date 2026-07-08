# Reliability & Foundations — plan + honest audit
_2026-07-08, written during a Supabase outage after the calendar + booking flow went blank._

## 0. Why the booking flow looked "different" during the outage (Dan's report)
Root cause found in code, not a guess:

- **`services` initializes to `DEFAULT_SERVICES`** — a hardcoded DEMO menu baked into the app (`src/App.jsx:550`). It's meant only as a first-paint placeholder before the real menu loads.
- During the outage the **real services failed to load**, so the app kept showing that **demo menu instead of your real one** → "the flow seems different," and your real Gentleman's Facial / real cut styles weren't there.
- **Cut-style images are NOT a Supabase thing** — they're served from the Unsplash CDN (`imgUrl`, `src/App.jsx:87`). They vanished only because the *services* they attach to didn't load, so there was nothing to hang them on. Not an image bug — a data-load bug.
- **The real flaw a senior dev would flag hard:** the app silently shows fake DEMO data to a real client when the real data can't load. That's worse than a blank screen — a client could try to book off a menu that isn't yours. The correct behavior is an honest "can't load the menu right now — try again shortly or call us," never seed data masquerading as real.

This is the same disease as the blank calendar: **no offline resilience.** Today's cache work covered the staff app; the public booking flow still degrades to demo/blank. Both are fixed by the plan below.

## 1. Senior-developer audit — what I'd flag that you haven't asked about (ranked by what matters for running a real shop)

| # | Concern | Status | Notes |
|---|---|---|---|
| 1 | **Survives outages / bad shop wifi** | ❌ being fixed | The big one. App must work offline and sync later. See §2. |
| 2 | **You're alerted when something's down — before your clients notice** | ❌ | You found out about this outage from blank screens, not an alert. A 1-minute health-check monitor should text/email YOU the instant the app or DB is unreachable. Cheap, high value. |
| 3 | **Database *structure* is in version control** | ⚠️ | Your DATA is backed up (Supabase Pro daily backups). But the schema, RLS policies, and RPC function bodies live ONLY inside Supabase. If the project were deleted/corrupted, rebuilding the logic would be painful. Fix: commit a `supabase db dump` to git. One-time, then automated. |
| 4 | **Automated tests on booking / checkout / refund** | ⚠️ | Every change is hand-verified + `ship-check` (build + regression guards). No automated test suite around the money-critical paths, so a subtle regression could slip. Add tests around booking, checkout, refunds. |
| 5 | **Photos stored as base64 inside DB rows** | ⚠️ | Bloats every appointment/client read and the offline cache. Belongs in object storage / a CDN, not in the row. Performance + cost. |
| 6 | **No staging environment** | ⚠️ | Changes deploy straight to production on merge. A staging gate would catch regressions before clients hit them. |
| 7 | **~26k-line single file (`App.jsx`)** | ⚠️ | Intentional in this project, but it raises the odds of subtle bugs and slows the bundle. Worth knowing. |
| 8 | Some tables anon-readable (needed for the booking page) | ✅ low risk | Tighten to a sanitized public view before multi-location. |

Things that are **already solid** (so you know the whole board): card/payment security (cards never touch the app — straight to Stripe), the server-side double-book lock (verified today), data backups (Pro), server error monitoring (Sentry wired), and — as of today — the app refuses to write during an outage so it can't corrupt/delete data.

## 2. The reliability plan — offline-first (the fix for #1)

**Destination (non-negotiable):** the app runs off a database *on the device*. It works with no internet / no server / dead wifi — view, book, check out, edit — and syncs automatically when the connection returns. Once opened even once, no backend outage can blank it again. This is what every field app you trust (Square, Mangomint) actually does.

Two honest routes to get there:

### Route A — add a proven offline-sync layer on top of what you have (RECOMMENDED)
- Tools built for exactly this: **PowerSync** or **ElectricSQL** — they add local-first offline sync to an existing Postgres/Supabase app. The app reads/writes a local SQLite DB on the device; the engine keeps it in sync with Postgres and handles conflicts.
- **Keeps** all your current work, your data (it never moves — same Postgres), and most of your logic.
- **Effort:** meaningful but incremental — not a rewrite. Roughly 2–4 weeks of focused work, shipped in stages (offline *viewing* first, then offline booking/checkout).
- **Risk:** lower — no vendor migration, no data move.

### Route B — rebuild on Google Firebase
- Firestore is offline-first by default (Google's SDK, battle-tested at massive scale) on top of Google's infrastructure.
- **Full migration:** data layer, auth, and every server function → Cloud Functions + security rules, plus moving your live data.
- **Effort:** meaningfully larger; **Risk:** higher (migration bugs).
- **Same end result** as Route A: the shop never goes dark.

**My recommendation: Route A.** Same "never dark" outcome, keeps everything you've built, lower risk, faster. I'd only switch to Route B if the Route-A diligence turns up a real blocker.

### How your data + current app stay safe during the work (non-negotiable)
- Your **current app keeps running untouched** the entire time.
- The offline layer is built and tested **in parallel** against a copy of your real data.
- We **only cut over once it's proven** to survive a full outage with the lights on.
- Route A moves **no data** (same Postgres) — your bookings never leave where they are.

## 3. Immediate wins I'll ship first (days, not weeks — so you're safer now)
Shipped **once Supabase is stable enough to verify each one** (I will not ship blind during an outage and risk making it worse):
1. **Stop the demo-menu masquerade** — during any load failure, the booking page shows an honest "can't load right now" state (+ your phone to call), never fake seed services. Also extend today's offline cache to the public booking flow so it shows your *real* last-synced menu.
2. **Uptime monitor + alert to you** — a health check every minute that texts/emails you the moment the app or DB is unreachable (fixes "I got no email that Supabase was down").
3. **Commit the DB schema to git** — a structural backup so the logic is recoverable, not just the data.

These three make you materially safer within days while the full offline-first work (§2) proceeds.
