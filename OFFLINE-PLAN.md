> # ⛔ SUPERSEDED / STALE — DO NOT FOLLOW THIS PLAN AS WRITTEN (stamped 2026-07-12)
> **PowerSync was TRIED and DROPPED.** Its WASM (`@powersync/web` + `wa-sqlite`) crashed the
> iOS app on launch in Capacitor/WKWebView (commits `3770d66` → `fa8d9fd` → `caf4b7b`, ~12 min of
> production life). The fallback — native `@capacitor-community/sqlite` — then broke the iOS UI
> (viewport zoom, stale Xcode bundles) and was fully reverted (`31046c7` → pre-offline `f0f19d4`).
> **There is NO working offline feature in production.** Nothing offline is in `main`.
>
> The authoritative account + the "never repeat this" rules live in **`NATIVE-OFFLINE-ROLLBACK-HANDOFF.md`** — read that FIRST.
>
> **Do NOT re-add PowerSync (or any device-DB sync engine) without first proving it renders and runs
> in Capacitor iOS on a real device.** Offline-first is a NATIVE problem that cannot be built or
> verified from a cloud agent — it needs Dan on the phone with Xcode at every stage.
>
> Keep **Supabase Realtime** (the 5-table publication = cross-device calendar sync). That is NOT
> PowerSync and must stay. The risk analysis + policy questions below are still useful reference, but
> the engine choice and stages are void.

---

# Offline-first build plan — PowerSync on the existing Supabase (Route A)  ⟨HISTORICAL — see banner above⟩

_Decision locked 2026-07-08 with Dan, after the second Supabase outage in two days (root cause of today's: NANO compute exhausted — upgraded to Micro the same morning). This file is the working plan; update it as stages land. Read `RELIABILITY-PLAN.md` §2 for the original route comparison._

## Destination (what "done" means — no weasel room)
The app runs off a local database **on the device**. With no internet / no Supabase / dead shop wifi you can still: open the app, see the real calendar + clients + menu, book, edit, check people in/out, take cash sales — and it all syncs automatically and safely when the connection returns. A backend outage becomes a non-event for the shop. **Cutover happens only after a full-outage drill passes in front of Dan** (network cut live; every flow above exercised; sync verified clean on reconnect).

## Why PowerSync (Route A) and not a Firebase rebuild
- Snaps onto the **existing** Supabase/Postgres — no vendor migration, no data move, all current code + guards survive.
- The client keeps a local SQLite copy in sync; app reads/writes local first. This is the same architecture Square-class field apps use.
- Free tier while building; ~$49/mo at go-live (re-verify price before paying).
- ElectricSQL was evaluated and dropped: its current model syncs reads and leaves the write path to you — that's the hard half of our problem.

## The honest risks, flagged up front (not discovered later)
1. **Our rows are JSONB blobs** — each client/appointment is one "index card" (whole object in a `data` column), not split fields. Naive sync = row-level last-write-wins → one device's reconnect can clobber another's edit on the same record (the exact disease behind the staff-email/phone data-loss saga). Mitigations: keep write-path guards (merge-don't-blank, `syncList`-style reconciliation) in the new path; consider splitting hot fields (status, paid stamp) later if real conflicts appear.
2. **Slot integrity can't be guaranteed offline.** The server-side double-book lock cannot run with no server. Two offline devices CAN book the same 2:00. Policy decision below (Dan's call).
3. **Money can't move offline.** Stripe (cards, Tap to Pay) requires network — no exceptions. Offline checkout is cash-record-now / card-queue-or-refuse. Policy decision below (Dan's call).
4. **Photos-as-base64 bloat the local DB** (audit item #5). Syncing multi-MB blobs to every device is slow + heavy. Likely forcing function to finally move photos to object storage; if not, sync buckets must exclude/trim gallery payloads for v1.
5. **Auth during an outage:** PowerSync tokens are minted via Supabase auth. Already-signed-in staff keep working offline; a **fresh sign-in during a full auth outage stays impossible** (magic-link email needs the backend anyway). Honest limit — mitigated by long-lived sessions, not solved.
6. **A sync engine is new moving machinery.** Bugs in bucket rules or the upload queue can drop or duplicate writes. Every stage below has a verification gate; the write path keeps the "refuse rather than corrupt" posture.

## Dan's two policy decisions (needed before Stage 2 ships; recommendations ready)
- **D1 — Offline double-booking:** RECOMMENDED: offline bookings show as **"pending — confirming"** until the server accepts them on reconnect; a clash flags loudly for staff to resolve (rebook/call). Never silently double-book, never silently drop. Alternative (not recommended): trust-last-write.
- **D2 — Offline checkout:** RECOMMENDED: **cash records fully offline; card checkouts queue as "charge when back online"** with a clear "not charged yet" state and a decline-later workflow (client card on file → retry/notify). Alternative: refuse card checkouts offline entirely (simpler, harsher on the shop).

## Stages (each independently shippable, verified, and reversible)
### Stage 0 — Groundwork (no behavior change)
- [ ] **Schema/RLS/RPC dump committed to git** (`db/schema.sql`) — needed for PowerSync bucket design anyway; also closes audit item #3 (structure not in version control). Dan runs the dump or pastes creds into the Supabase CLI flow — instructions in `db/`.
- [ ] Dan creates the **PowerSync account** (free tier) + a dev instance pointed at Supabase (read-only publication; PowerSync needs no write access to Postgres).
- [ ] Enable logical replication / publication for the 6 tables (SQL for Dan to paste, like the realtime SQL he's run before).
- [ ] Define **sync buckets** = per-shop (`shop_id='sanctuary'`) slices of: shops(settings), services, providers (SANITIZED — the public feed's fields only, never email/phone/pin), appointments, clients (staff-only bucket), waitlist. Bucket rules enforce the same privacy walls RLS does today — verify with an anon token that private buckets are unreachable.
- Gate: dev instance syncs a copy of real data; privacy probe passes; production app untouched.

### Stage 1 — Offline READING (kills the blank-screen class of outage for good)
- App boots from the local DB and renders calendar/clients/menu instantly; network only freshens it. Replaces the snapshot-cache stopgap (`hydrateFromCache`) with a real always-current local DB — the cache stays as fallback until cutover, then retires.
- Public booking page reads the menu from the local copy on repeat visits; first-ever visit during an outage gets the honest "can't load the menu right now — call us" screen (never the demo menu).
- Gate (live drill): airplane-mode the device → force-quit → reopen: full real calendar + clients + menu render. Cut Supabase reachability mid-scroll: no blank, no demo data. Staff banner shows "offline — showing local data".
### Stage 2 — Offline WRITES (book/edit/check-in/out offline, sync later)
- Writes land in the local DB + PowerSync upload queue; UI marks queued items "pending sync". The email/phone/pin merge-guards and delete-verification move into the upload path. Queue survives force-quit/reboot (it's on disk).
- Gate (live drill): offline: create/move/edit appts on two devices incl. the same record → reconnect → both converge, nothing blanked, nothing resurrected, deletes stay deleted; kill the app mid-queue → queue completes on next open.
### Stage 3 — Slot integrity + money policies (D1 + D2 wired)
- Server accept/reject step for offline-created bookings (reuses the existing atomic slot lock RPC on reconnect); clash → loud staff flag. Checkout per D2 with explicit not-yet-charged states.
- Gate (live drill): two devices offline-book the same slot → reconnect → exactly one confirmed, one flagged, both visible; offline cash sale records; offline card sale charges on reconnect or surfaces the decline path.
### Cutover — only after a full-outage drill (all gates re-run back-to-back on production data with Supabase actually unreachable) passes in front of Dan. Old path stays behind a flag for instant rollback for at least two weeks.

## Standing safety rules for this whole build
- The live app keeps running untouched; every stage ships dark/parallel first.
- No data migration ever — Postgres stays the source of truth; devices hold copies.
- Never claim a stage done without its live drill. Cost/price claims re-verified before Dan pays anything.

## Related "never again" work (parallel, cheap)
- **Uptime monitor → alerts Dan** (he found today's outage from blank screens + an unclickable login). One health endpoint probing a real DB query + a 1-min external pinger that texts/emails him. ⚠️ api/ function count is at 11/12 (Vercel cap) — fold the health check into an existing endpoint, don't add a 13th file.
- **Login fails open** (shipped 2026-07-08, guard-locked `login-fail-open`): a dead/slow session check can never again brick the sign-in button.
- **Compute headroom**: Micro as of 2026-07-08. Watch memory %; >70% sustained → recommend Small with data in hand.
