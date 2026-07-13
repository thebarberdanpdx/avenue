# Vero — Phases & live status (single source of truth)

**New session? Read this + `CLAUDE.md` and you're up to speed.** Updated 2026-07-13.

Dan's rule: **not going live until all 4 phases are done.**

| Phase | What it means | Status |
|---|---|---|
| **1 · Foundation/reliability** | crash-hardening, payment security, key rotation, sales-can't-vanish | ✅ **Done** |
| **2 · Prove it** | live-testing rig + Dan's on-device book→checkout dry run | ✅ **Done** |
| **3 · Offline-first** | shop keeps working through a backend outage / bad wifi | 🔄 **~65%** |
| **4 · Migration off Mangomint** | export → import night → 2-week overlap (`MIGRATION-GUIDE.md`) | ⬜ **Not started** |

**Overall ≈ 60%.** The remaining ~40% is weighted toward things that need **Dan + real calendar time** (migration, airplane-mode on his device), not solo code.

---

## Phase 3 — offline-first (current work)

The real outage mode is a **HANGING backend** (Supabase compute exhausted: requests never resolve *or* reject). The fix class = **timeouts / watchdogs** that fall back to an honest state or the offline cache. A per-call timeout on a fetch isn't enough — the auth refresh hangs first.

**Done + deployed + verified live on gotvero.com:**
- Public **menu** on outage → honest "can't load — call us" (never the demo menu). `[load watchdog]`
- Public **booking submit** on outage → honest "couldn't confirm — tap again" (no infinite spinner). `[book_public timeout]`
- **Manage-appointment link** on outage → honest error (no stuck "Loading…"). `[withRpcTimeout]`
- **Staff calendar mirror** on outage → honest "showing last synced" banner. `[mirrorWatchdog]` — banner verified live; the cached-appts *re-display* is unverified (see pre-migration note).

**Not done:**
- **Checkout charge** (`stripeApi`) on outage — no timeout. Staff-side + money path → careful, verify with the key.
- Low-impact public paths (reviews, waitlist) — no timeout. Minor.
- **True airplane-mode** (zero signal) — **DEFERRED**, needs Dan's iPhone + Xcode. This is what broke the app before — read `NATIVE-OFFLINE-ROLLBACK-HANDOFF.md` first, never ship native offline from the cloud unverified.

## ⚠️ Pre-migration investigation (before Phase 4)

On `vero-test`, the **STAFF calendar loads EMPTY even on a healthy load** (appts never reach state; offline cache stays empty), and **250+ phantom appts** (Sanctuary's, `sync_*` ids) reappeared after a purge. Could be a real **new-shop sync bug** (would bite the Mangomint import) or just test-shop contamination. **Investigate on a clean shop before migrating** — don't assume it's only test mess.

---

## Operational facts (any session)

- **Deploy** = merge to `main` → `deploy.yml` builds on Vercel, promotes gotvero.com, verifies `/api/version` reports the commit. (The Vercel CLI token in the sandbox is invalid — **merge is the deploy path**, not `vercel --prod`.)
- **Service key**: set in the environment config as `SUPABASE_SERVICE_ROLE_KEY` (loads at session start, not mid-session). **Rotate it the day before real go-live.** Test scripts read `SUPABASE_SERVICE_ROLE_KEY` (fallback `SUPABASE_SERVICE_KEY`) + default the URL, so they run with nothing to source once the env var is present.
- **Uptime/error alerts**: already done — `uptime-check.yml` (site+DB, emails on outage) + Sentry (`src/main.jsx` + `lib/observe.js`). Don't re-flag as missing.
- **Backups**: daily scheduled backups ON (Supabase Pro). PITR not enabled; Storage objects (photos) not in backups.
- **Live-testing rig**: `tests/live/` (see its README). `driver.mjs` = Playwright→Chromium through the proxy (TLS capped at 1.2, telemetry blocked). Outage drills: `outage-drill`, `booking-submit-hang`, `manage-outage-drill`, `authed-outage-drill`.
- **Test shop**: `vero-test` (isolated, Test-mode, login `vero-livetest@vero.test`). NEVER drive mutations against the real `sanctuary` shop.

## What's next (my solo lane vs needs-Dan)

- **Solo, now**: checkout-charge timeout (with the key), minor public paths, this doc.
- **Needs Dan**: airplane-mode (his iPhone + Xcode), the migration itself (Phase 4), and the pre-migration sync investigation on a clean shop.
