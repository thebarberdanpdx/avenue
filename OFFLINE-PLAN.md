# Offline-first build plan — native on-device SQLite on the existing Supabase (Route A, revised)

> **STATUS (2026-07-10): Stage 1 READING shipped behind `OFFLINE_NATIVE = false`.** Native SQLite store seeds on every successful sync; boots + fails over from on-device copy when flag is ON. Stage 2 (offline writes / outbox replay) NOT started. Dan must flip the flag + Xcode rebuild to test on iPhone/iPad before any cutover.
>
> **PowerSync was removed from production.** Its browser/WASM SQLite crashed the iPhone app inside Capacitor's WKWebView. The revised route below uses **native** on-device SQLite instead — see "Why native SQLite" — and keeps sync on the app's existing server-authoritative `api/sync-pull` contract. Do not retry the PowerSync/WASM path.

_Direction locked 2026-07-08 with Dan after the second Supabase outage in two days (root cause of that day's: NANO compute exhausted — upgraded to Micro the same morning). Revised 2026-07-10 to drop PowerSync after the WKWebView crash. This file is the working plan; update it as stages land. Read `RELIABILITY-PLAN.md` §2 for the original route comparison._

## Destination (what "done" means — no weasel room)
The app runs off a local database **on the device**. With no internet / no Supabase / dead shop wifi you can still: open the app, see the real calendar + clients + menu, book, edit, check people in/out, take cash sales — and it all syncs automatically and safely when the connection returns. A backend outage becomes a non-event for the shop. **Cutover happens only after a full-outage drill passes in front of Dan** (network cut live; every flow above exercised; sync verified clean on reconnect).

## Why native SQLite (Route A, revised) — not PowerSync, not a Firebase rebuild
- **PowerSync is out.** Its client keeps a local SQLite copy via a **WASM** SQLite build that runs inside the webview. In Capacitor's iOS **WKWebView** that build crashed the iPhone app. It has been removed from production. Betting the offline layer on the exact component that just crashed the app is not acceptable.
- **Native SQLite instead.** Use a **native** iOS SQLite store (via `@capacitor-community/sqlite`), which runs as a native plugin outside the webview's WASM sandbox — the thing that failed. The app reads/writes the local copy first.
- **Sync stays on what we already have.** The app already ships a **server-authoritative sync contract** (`api/sync-pull`: pull replaces idle tables; `mode:"save"` writes via service role and returns fresh tables; edits are gated by `tableHasUnsavedWork`). We **extend** that with a local store + a durable **upload queue (outbox)** that replays writes through the existing `api/sync-pull` save path on reconnect. No new sync vendor, no data migration, all current guards survive.
- **Firebase rebuild:** still rejected — vendor migration + data move + rewriting every guard. **ElectricSQL:** still rejected — its model syncs reads and leaves the write path to you, which is the hard half of our problem.

## The honest risks, flagged up front (not discovered later)
1. **Our rows are JSONB blobs** — each client/appointment is one "index card" (whole object in a `data` column), not split fields. Naive sync = row-level last-write-wins → one device's reconnect can clobber another's edit on the same record (the exact disease behind the staff-email/phone data-loss saga). **Mitigation for the offline write path: the outbox carries per-field / per-operation patches (status, paid stamp, a moved time), NOT whole-row blob replaces** — merged server-side through the existing write-path guards (merge-don't-blank, delete-verification). Splitting hot fields into real columns is a later option if real conflicts persist.
2. **Slot integrity can't be guaranteed offline.** The server-side double-book lock cannot run with no server. Two offline devices CAN book the same 2:00. Policy decision below (Dan's call).
3. **Money can't move offline.** Stripe (cards, Tap to Pay) requires network — no exceptions. Offline checkout is cash-record-now / card-queue-or-refuse. Policy decision below (Dan's call).
4. **Photos-as-base64 bloat the local DB** (audit item #5). Syncing multi-MB blobs to every device is slow + heavy. Likely forcing function to finally move photos to object storage; if not, the local seed must exclude/trim gallery payloads for v1.
5. **Auth during an outage:** an already-signed-in device keeps working offline off its stored session. A **fresh sign-in during a full auth outage stays impossible** (the magic-link/code email needs the backend anyway). Honest limit — mitigated by long-lived sessions, not solved.
6. **A local store + upload queue is new moving machinery.** Bugs in the seed, the queue, or the merge can drop or duplicate writes. Every stage below has a verification gate; the write path keeps the "refuse rather than corrupt" posture.

## Dan's two policy decisions (needed before Stage 2 ships; recommendations ready)
- **D1 — Offline double-booking:** RECOMMENDED: offline bookings show as **"pending — confirming"** until the server accepts them on reconnect; a clash flags loudly for staff to resolve (rebook/call). Never silently double-book, never silently drop. Alternative (not recommended): trust-last-write.
- **D2 — Offline checkout:** RECOMMENDED: **cash records fully offline; card checkouts queue as "charge when back online"** with a clear "not charged yet" state and a decline-later workflow (client card on file → retry/notify). Alternative: refuse card checkouts offline entirely (simpler, harsher on the shop).

## How it stays off production until cutover (dark-ship)
- All offline code sits behind a **runtime flag, default OFF** in production. The live app's behavior is unchanged with the flag off.
- The swap is gated at the **data-access / sync boundary** — one thin abstraction the components call — **not** scattered through `App.jsx`. Keeps the monolith almost untouched during the build.
- Dan flips the flag only on his own test device, per stage. Cutover = flip the default after the drill; an instant rollback flag stays for **at least two weeks**.

## Stages (each independently shippable, verified, and reversible)
### Stage 0 — Groundwork — DONE (flag OFF)
- [x] `@capacitor-community/sqlite` added behind `OFFLINE_NATIVE` flag
- [x] `outbox` table created in local DB (schema only — Stage 2 wires replay)
- [ ] **Schema/RLS/RPC dump committed to git** (`db/schema.sql`) — still pending
- [ ] **Prove native SQLite on device** — needs Dan: flip flag, `npx cap sync`, Xcode rebuild, airplane-mode drill
- [ ] **Privacy probe** — verify local seed never exposed outside staff app sandbox

### Stage 1 — Offline READING — SHIPPED (dark, flag OFF)
- App boots from the local SQLite store and renders calendar/clients/menu instantly; network only freshens it. Replaces the snapshot-cache stopgap (`hydrateFromCache`) with a real always-current local DB — the cache stays as fallback until cutover, then retires.
- Public booking page reads the menu from the local copy on repeat visits; first-ever visit during an outage gets the honest "can't load the menu right now — call us" screen (never the demo menu).
- Gate (live drill): airplane-mode the device → force-quit → reopen: full real calendar + clients + menu render. Cut Supabase reachability mid-scroll: no blank, no demo data. Staff banner shows "offline — showing local data".

### Stage 2 — Offline WRITES (book/edit/check-in/out offline, sync later)
- Writes land in the local DB + a durable **upload queue (outbox)** on disk; UI marks queued items "pending sync". On reconnect the queue replays through the existing **`api/sync-pull` `mode:"save"`** path, carrying **per-field/operation patches** (risk #1) so a reconnect can't blank a concurrent edit. The email/phone/pin merge-guards and delete-verification run on the upload path. Queue survives force-quit/reboot.
- Gate (live drill): offline: create/move/edit appts on two devices incl. the same record → reconnect → both converge, nothing blanked, nothing resurrected, deletes stay deleted; kill the app mid-queue → queue completes on next open.

### Stage 3 — Slot integrity + money policies (D1 + D2 wired)
- Server accept/reject step for offline-created bookings (reuses the existing atomic slot-lock RPC on reconnect); clash → loud staff flag. Checkout per D2 with explicit not-yet-charged states.
- Gate (live drill): two devices offline-book the same slot → reconnect → exactly one confirmed, one flagged, both visible; offline cash sale records; offline card sale charges on reconnect or surfaces the decline path.

### Cutover — only after a full-outage drill (all gates re-run back-to-back on production data with Supabase actually unreachable) passes in front of Dan. Old path stays behind a flag for instant rollback for at least two weeks.

## Standing safety rules for this whole build
- The live app keeps running untouched; every stage ships dark/parallel behind the OFF flag first.
- No data migration ever — Postgres stays the source of truth; devices hold copies.
- Never claim a stage done without its live drill. Cost/effort claims re-verified before Dan commits.
- Rough effort: ~4–8 weeks of focused engineering on the native path (the PowerSync shortcut is invalid).

## Related "never again" work (parallel, cheap)
- **Uptime monitor → alerts Dan (SHIPPED, email-only):** an **external GitHub Actions watchdog** (`scripts/uptime-watch.py`, every 5 min) probes the website + database + **sign-in** from outside and **emails** Dan a "Vero is DOWN" alert via `/api/notify` alert mode — **email only, no text** (PR #274). It alerts once per outage. Because it's an external workflow, it did **not** consume an `api/` serverless slot (the Vercel function cap concern). GitHub Actions' own failure email is the last-resort backup when the whole site is down.
- **Login fails open** (shipped 2026-07-08, guard-locked `login-fail-open`): a dead/slow session check can never again brick the sign-in button.
- **Compute headroom**: Micro as of 2026-07-08. Watch memory %; >70% sustained → recommend Small with data in hand.
