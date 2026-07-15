# Vero — Phases & live status (single source of truth)

**New session? Read this + `CLAUDE.md` and you're up to speed.** Updated 2026-07-15.

Dan's rule: **not going live until all 4 phases are done.**

| Phase | What it means | Status |
|---|---|---|
| **1 · Foundation/reliability** | crash-hardening, payment security, key rotation, sales-can't-vanish, access control | ✅ **Done** |
| **2 · Prove it** | live-testing rig + Dan's on-device book→checkout dry run | ✅ **Done** |
| **3 · Offline-first** | shop keeps working through a backend outage / bad wifi | ✅ **Done for launch** (every hang/timeout path + staff cached-calendar re-display verified live). **True zero-signal airplane-mode DEFERRED by Dan's decision 2026-07-15** — high-risk native rewrite (it crashed the app before), rare scenario, and it costs the instant-web-update model; his real failure mode (backend outage / bad wifi) is fully covered. Revisitable later if real dead zones show up. |
| **4 · Migration off Mangomint** | export → import night → 2-week overlap (`MIGRATION-GUIDE.md`) | ✅ **Import DONE** — Dan already imported: 2,973 clients live in `sanctuary` (998 tagged `_import`), ~308 appts. Verify with `npm run state`. Remaining is the real-world overlap/confidence period, NOT the import. |

**Overall ≈ 90% for launch scope** (airplane-mode descoped 2026-07-15). **The migration is DONE and SMS reminders are LIVE** — both verified against prod (run `npm run state`; do not trust this line without re-checking). The remaining gate is the audit's verified bug-fixes (`LAUNCH-READINESS-AUDIT-2026-07-15.md`): double-charge ✅ and fake-nudge ✅ are shipped; hardcoded password, per-barber report crash, blocked-client-can-still-book, and the booking-deposit double-charge are still open. Plus a short pre-launch checklist (service-key rotation, one real live-card check, legal basis for the 55 imported clients with no phone AND no email).

> ⛔ **Before quoting ANY number or status above to Dan, run `npm run state`.** These figures are a snapshot and go stale — sessions have burned trust reporting stale/guessed status. Prod is the only truth. (directive #3 in CLAUDE.md)

**Recent foundation hardening (2026-07-15, shipped + verified live on gotvero.com):**
- **Access-lockdown** — only shop members (`canAccessShop`) can open the business dashboard; a signed-in non-member gets an honest "Not authorized" screen, not the dashboard shell. Fail-open so a real owner is never locked out (verified all 3 Sanctuary owner emails pass; a transient 403 can't block an email that has loaded before; "Try again" reload for a first-load blip). Root-caused + fixed a first-cut miss the live test caught (the gate was coupled to the opportunistic data mirror, which bails on unsaved work → never saw the 403; now a dedicated `mode:"access"` probe decides it). Live E2E: member in, non-member blocked (`tests/live/access-lockdown.mjs`). Confirmed via RLS probe that a non-member reads **zero** client/appt/waitlist/review rows regardless — PII was never exposed.
- **1000-row truncation** — staff client list + MasterCalendar now paginate (`selectAllRows` / `.range()`), so a shop past 1,000 clients/appts no longer silently hides the overflow.
- **Design pass** (Onyx-Ivory) — client card/list + storefront/login restyled, slimmer calendar banner. UX polish, not a phase gate.

---

## Phase 3 — offline-first (current work)

The real outage mode is a **HANGING backend** (Supabase compute exhausted: requests never resolve *or* reject). The fix class = **timeouts / watchdogs** that fall back to an honest state or the offline cache. A per-call timeout on a fetch isn't enough — the auth refresh hangs first.

**Done + deployed + verified live on gotvero.com:**
- Public **menu** on outage → honest "can't load — call us" (never the demo menu). `[loadWatchdog]`
- Public **booking submit** on outage → honest "couldn't confirm — tap again". `[bookTimeout + PREBOOK_RPC_TIMEOUT_MS]` — verified live under a FULL hang (all pre-book RPCs *and* book_public): honest error at ~50s, spinner released, no dead button. NOTE: the earlier `bookTimeout`-only fix was **unreachable** in a real hang — commitBooking awaits the dedup lookups + `save_booking_client` BEFORE book_public, so the submit froze on the earliest hanging call. Time-boxing those pre-book RPCs (8s) is what makes the honest error actually fire. `tests/live/booking-submit-hang-all.mjs`.
- **Manage-appointment link** (lookup/cancel/reschedule/check-in) on outage → honest error. `[withRpcTimeout]`
- **Checkout charge** (`stripeApi`) on outage → honest "couldn't reach the payment server". `[withRpcTimeout]` — idempotency key is KEPT on an unknown outcome, so a retry of a charge that actually landed reuses the same key → Stripe dedupes → never a double charge.
- **Review link** on outage → honest error. `[withRpcTimeout]`
- **Staff calendar mirror** on outage → honest "showing last synced" banner + cached calendar. `[mirrorWatchdog]` — **fully verified live**: seeding the offline cache with a today appt then hanging the backend, the reloaded dashboard re-shows the cached appt (Pulse projects its price; the tile renders on the calendar; "1 booked") AND the honest banner, no blank screen. `tests/live/outage-cache-redisplay.mjs`.

**Safe by design (no timeout needed — verified by reading the control flow):**
- `get_availability` hang → the public picker just shows all-slots-open; book_public's server-side slot guard rejects a truly-taken slot at submit (`slot_taken`). Soft degradation, not a spinner.
- Waitlist join / selfie-discount / device-token / phone-conflict check → fire-and-forget with a catch; a hang silently no-ops and never blocks the UI.

**Known rough edge (flagged, deliberately NOT changed):** during a full hang the honest booking error takes ~50s (8s×3 pre-book + 25s book_public), and the "CONFIRMING…" spinner only appears after the pre-book calls — so ~24s of apparent non-response first. It's terminating + honest (the bar is met), but the outage UX could be smoothed by moving `setBooking(true)` to the tap. Left alone because it touches the single most critical path and adds re-entrancy surface — do it only if Dan asks.

**Not done (needs Dan):**
- **True airplane-mode** (zero signal) — **DEFERRED**, needs Dan's iPhone + Xcode. This is what broke the app before — read `NATIVE-OFFLINE-ROLLBACK-HANDOFF.md` first, never ship native offline from the cloud unverified.

## Phase 4 readiness (assessed 2026-07-13)

- **Migration PLAN**: `MIGRATION-GUIDE.md` is thorough (Phases 0–5, edge cases, rollback).
- **Importer**: **built + verified end-to-end + scale-tested** — `ImportDataEditor` (src/App.jsx ~15823), via Reports → Reports (Filter/view/export) → Import data (3 stages: upload → map → preview, direct DB inserts of `imp_<batch>_*` rows, clean **Undo this import** by id prefix). Does phone→email dedup, quoted-comma service names, service/staff name matching, and populates the retention engine (visits/lastVisit/cadence). CSV foundation unit-tested (`tests/resolvers.test.mjs`); **whole feature** locked by a portable live regression (`tests/live/importer-e2e.mjs`, runs against vero-mig).
  - **Scale-tested** (2026-07-13): a synthetic full-shop history — **500 clients / 3730 appointments (309 KB)** — imported cleanly on vero-mig: dedup 3730 rows→500 people, home-barber a perfect `{dan:250, heather:250}` split, 350 notes carried, 0 clients without a provider. **build ~0.6s, commit ~5.7s** — no performance concern at real-shop volume.
  - **Silent-loss gap found + fixed** (shipped + verified live): the importer used to **drop any row whose date it couldn't parse with ZERO indication** (the scale test's first run lost ~1864 appts to a bad time format before I caught it). Now `build()` counts unreadable rows and BOTH the preview and the done screen warn ("N rows couldn't be read — those appointments won't import; check MM/DD/YYYY"). Clients + readable visits still import; Undo → fix → re-import captures the rest. No silent data loss on migration night.
- **Fixed during this assessment**: removed the automatic "test day" fake-appointment seed (shipped) — it showed/could-write 10 fake clients into any shop's live calendar. An explicit opt-in **"Test data"** tool (Reports → Data) remains for practice.
- **Guide's 2 optional importer tweaks — DONE + verified live** (both shipped): (1) client **notes / color formulas** carry over (new "Notes / formula" column in the mapper; merges fill blank notes only, never overwrite); (2) each client's **home barber is derived from their imported visit history** (most-seen barber, ties→most recent) instead of everyone defaulting to one staff member. End-to-end drill on vero-mig: a client seen 2× Heather / 1× Dan → home barber Heather (overrode Default=Dan); notes carried; retention populated. Now the importer does dedup + quoted-comma + retention + notes + home-barber, all verified.

### ⚠️ The real Phase-4 gate = a dry-run with REAL data (Dan)
Phase 4 completes only with the actual migration — Dan's Mangomint CSV export, a clean throwaway shop, one import, and confirming the calendar displays it (Phase-0 dry-run in the guide). Solo verification can't substitute for real-data edge cases.

Note on test shops: a staff sync-pull capture on `vero-test`/`vero-mig` showed **no `/api/sync-pull` calls** and empty calendars — but these test shops are polluted / the test login isn't a real provider, and the real Sanctuary shop syncs fine daily, so this is almost certainly test-account-specific, not a general bug. Confirm on the clean dry-run shop.

**Phantom-appts mystery — SOLVED (2026-07-13):** vero-mig showed 255 appointments when only 2 were seeded. Investigated: **253 of them share one id prefix `sync_fe73vnl_*`** — they are events from a single **iCal calendar feed** connected to the shop during earlier testing, synced in exactly per the `"sync_" + feedId + "_" + hash(uid)` pattern (`api/calendar-run.js`). NOT phantom data, NOT the importer spawning garbage. A fresh migration shop with no calendar feed connected will not have them. The importer only ever writes `imp_<batch>_*` rows (cleanly undoable by prefix).

---

## Operational facts (any session)

- **Deploy** = merge to `main` → `deploy.yml` builds on Vercel, promotes gotvero.com, verifies `/api/version` reports the commit. (The Vercel CLI token in the sandbox is invalid — **merge is the deploy path**, not `vercel --prod`.)
- **Service key**: set in the environment config as `SUPABASE_SERVICE_ROLE_KEY` (loads at session start, not mid-session). **Rotate it the day before real go-live.** Test scripts read `SUPABASE_SERVICE_ROLE_KEY` (fallback `SUPABASE_SERVICE_KEY`) + default the URL, so they run with nothing to source once the env var is present.
- **Uptime/error alerts**: already done — `uptime-check.yml` (site+DB, emails on outage) + Sentry (`src/main.jsx` + `lib/observe.js`). Don't re-flag as missing.
- **Backups**: daily scheduled backups ON (Supabase Pro). PITR not enabled; Storage objects (photos) not in backups.
- **Live-testing rig**: `tests/live/` (see its README). `driver.mjs` = Playwright→Chromium through the proxy (TLS capped at 1.2, telemetry blocked). Outage drills: `outage-drill`, `booking-submit-hang` (book_public only), `booking-submit-hang-all` (FULL hang — the real outage; proves the pre-book timeout), `manage-outage-drill`, `authed-outage-drill`. NOTE: `vero-test`'s account now shows a "Choose a location" chooser first — public-flow drills must click the location before the storefront.
- **Test shop**: `vero-test` (isolated, Test-mode, login `vero-livetest@vero.test`). NEVER drive mutations against the real `sanctuary` shop.

## What's next (my solo lane vs needs-Dan)

- **Solo lane is essentially drained.** All user-blocking hang/timeout coverage is shipped + verified. What's left solo is optional polish (the ~50s outage-UX smoothing, flagged above) and the 2 optional importer tweaks (home-barber-from-history, Notes column) — none end-to-end verifiable without Dan's real data.
- **Needs Dan**: airplane-mode (his iPhone + Xcode), the migration itself (Phase 4 — his Mangomint export), and the pre-migration sync investigation on a clean shop.
