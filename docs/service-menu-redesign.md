# Service Menu Redesign — locked design + build spec

Status: **design locked, ready to build.** Captured by Claude overnight; not yet implemented in code (deliberately — the booking flow is live and fragile, see "Why not built yet" at the bottom).

## The real problem (the north star)
Clients book a **too-short service** — e.g. a regular Haircut when they actually get a **Skin Fade** (which takes longer). The shop runs over and the schedule is wrecked. Every decision below serves: **make the long job impossible to book as the short one.**

## Locked design

### Client storefront (stays LIGHT/clean — not the dark owner UI)
- **Services page: names only.** No prices, no durations (so nothing to reflex-pick by). Behind an owner switch.
- **Tap a service → a sheet pops up:** the description + a **read & confirm** check, then the **required cut-type choice**. Price + duration build *inside the sheet* from what they pick.
- **Cut type is required, visual (a photo per type), and time-stamped** (Skin fade · 50 min vs Scissor · 40 min) — so they see the fade costs more and it books at 50.

### Owner side (dark "working chair" / Threshold aesthetic — see mocks)
- Service editor where the service reads like a live appointment; duration is shown as time-blocks; a barber "lens" flips the same blocks to each barber's own times.
- **Cut types are a managed list** (add/rename/reorder/retire), each with photo + time + price, and **"Included" vs "Adds to price."** Adding one makes it an instant choice on every booking.
- Per-barber times apply to the service, **each cut type, and each add-on** (a master's fade can be 55, a junior's 45).

### The switches (all owner-controlled; **defaults chosen for ZERO change to existing shops**)
| Switch | Scope | Default | Effect |
|---|---|---|---|
| Require a cut type | per service | **off** | Can't book without picking scissor/fade/taper |
| Show each cut's time | per service | **off** | Shows "fade · 50 min" in the picker |
| Require read & confirm | per service | *(exists)* | Confirm description before continue |
| Hold the longest cut's time when unsure | per service | **off** | Ambiguous booking reserves the longest cut's length |
| Quiet menu (hide price + duration on list) | shop | **off** | Names-only services page |
| Description sheet on tap | shop | on when descriptions exist | Pops the read-confirm sheet |

## Key code anchors (found during tracing, `src/App.jsx`)
- **Duration resolvers (~1086–1113):** `getDuration` (per-client→per-staff→service), `cutStyleDuration`/`cutStylePrice`. **Per-barber cut-type duration already exists** via `staff.cutDur[ctId]` / `staff.cutPrice[ctId]`. Phase 3 is largely wiring, not new model.
- **Read-confirm gate (~4049–4052):** `needConfirm` + `descConfirmed`; `canContinue` already requires `picked` (a cut type) in the simple flow.
- **Cut-type cards render in several places** (~4103, 4257, 4375, 4510, 4579, 5207, 5824) — the spread that makes "show the time everywhere" a careful, multi-site change.
- **Owner booking toggles (~10438–10471):** `bookingRow(label, key, help)` + `setBooking`. New switches go here, gated on `(form.cutTypes||[]).length`.
- **Booking defaults:** `_seedBooking` (~9091), `defaultBooking` (~9934) — add new keys here (default falsy).
- **Slot engine:** `computeFreeSlots` (~2572) already respects per-item durations; `holdLongest` plugs into the effective-duration calc.
- **Client services list / selection:** the `ClientFlow` storefront (~2492+); the "quiet menu" + description sheet live here.

## Phased build (each ships independently, behind off-by-default switches)
1. **Guardrails.** Add `requireType`, `showTypeTimes`, `holdLongest` switches (owner UI + defaults). Wire `showTypeTimes` into every cut-type card. Wire `holdLongest` into the effective-duration calc (max over cut types when none locked). `requireType` is already effectively enforced in the simple flow via `picked`; verify/extend to the Atelier "who & when" flow. **This phase alone kills "regular instead of skin fade."**
2. **Quiet menu + description sheet.** Shop switches to hide price/duration on the services list; tapping a service opens the description→confirm→choose sheet (reuse `requireConfirm`/`descConfirmed`). Storefront-selection UI only.
3. **Per-barber times for cut types & add-ons.** Surface `staff.cutDur`/`cutPrice` (exists) + add `staff` per add-on option. Owner UI to set them. Engine already respects per-item durations.
4. **The menu redesign + unified options.** The dark editor UI; fold `cutTypes`/`beardTypes`/`addonGroups` into one options model with a compat reader so old data + live bookings keep working. Largest; do last.

## Data + migration
- Nothing destructive until Phase 4. A reader handles both old (`cutTypes`/`beardTypes`/`addonGroups`) and new (unified groups) shapes. Existing cut styles auto-convert; owner rebuilds nothing.

## Guardrails for building this safely
- Every new code path **strictly gated** behind its switch; the **default (off) path stays byte-for-byte unchanged** → existing shops/bookings unaffected.
- After each phase: `npm run build` clean + `npm run ship-check` green (consent phrase ×4, provider email/phone invariants, regression locks).
- Verify the live booking flow on the preview before merge.

## Why not built yet (honest note)
Built overnight while the owner slept. The booking flow is the live storefront for real customers and the cut-type/duration logic is threaded through many fragile spots. Shipping unverified surgery there overnight risked breaking real bookings — the exact failure this whole project exists to prevent. So the design + spec are locked here; implementation should be done with the owner awake to test each phase on the preview. Phase 1 is small and is the fast first win.
