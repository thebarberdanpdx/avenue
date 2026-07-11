# Reliability & QA Audit — 2026-07-09

**Scope:** Head-to-toe reliability pass on Vero (`avenue`). Nine parallel read-only
auditors covered: public booking flow, auth/session + app-shell load & persistence,
calendar + appointment lifecycle, checkout/payments/refunds + `api/stripe.js`,
settings editors, clients/pulse + pricing resolvers, reports, serverless `api/`,
and cross-cutting resilience (error boundaries, offline, fake-data fallbacks).

**Method:** Static code review only. **Nothing was run against Supabase, Stripe, or
git.** There is no staging environment (single Supabase project, live Stripe), so the
dynamic "book every combination with fake data" QA was **not** executed — doing so would
write to the production DB and could fire real SMS via the 5-minute reminder cron.
See "Track B — staging spec" at the bottom for what a safe live-QA harness requires.

**Verdict: NOT SAFE YET for real business use.** Reasons are in the final section.

---

## Bug list — ranked by severity

Severity = (blast radius on money/data/customer) × (likelihood in normal shop use).
`file:line` are `src/App.jsx` unless noted.

### CRITICAL

**C1 — Card charges have no durable idempotency → double-charge on an ambiguous network failure.**
`sale_intent`/`terminal_intent` carry no idempotency key (`idemSig` returns `null`, `:887`).
The in-memory dedupe `Map` (`:872`) dies on reload/force-quit — exactly the outage path.
Flow: `confirmCardPayment` succeeds on Stripe's side but the response is lost → UI says
"didn't go through / try again" → staff taps again → a *new* PaymentIntent → **customer
charged twice.** `App.jsx:22548, :23534, :22555`. Compounded by C-adjacent: the paid
record only lives in client state (`recordSale :22675`), so a failed persist reverts the
ticket to "unpaid" and invites a re-charge.

**C2 — There is no payments "Test mode"; the app always charges live, and the settings
copy says otherwise.** Default is `live:true` (`:291`); opening the Payments card
*force-writes* `live:true` on mount (`:16662`); there is no toggle back. The card copy
reads "Test mode — nothing is charged… switch back to Test anytime." (`:19343`). A
non-engineer trusting that copy believes they're testing while **real cards are charged**
at deposits/checkout/no-show. Directly relevant to "this app is still in testing."

**C3 — Double-refund path: a Stripe-dashboard/webhook refund does not reduce the in-app
refundable balance, and there is no server-side remaining-balance guard.** Webhook patches
`appt.data.paid` (`api/stripe.js:73`); the refund sheet computes "max refundable" from a
*different* store, `client.payments[].refunded` (`App.jsx:24123`), which the webhook never
touches. Refund in the Stripe dashboard → in-app still shows full balance → staff refunds
again → **money goes out twice.** `api/stripe.js:265` accepts any amount ≤ $100k for the PI
with no server-side sum-of-existing-refunds check.

**C4 — Silent read-only trap: after a wifi blip the "changes are paused" banner clears but
saves stay blocked → staff edits are silently discarded with no warning.** On a failed
session-keyed load, `hydrateFromCache` blocks saves (`loadedRef=false`) and shows the amber
banner. The foreground/60s-poll refetch succeeds and clears the banner (`setUsingCache(false)`,
`:2218`) but **never restores `loadedRef=true`** (only set once at mount, `:2330`). Result:
fresh data, no banner, looks fully recovered — but every subsequent check-in, tip, status
change, or walk-in is shown on screen and then dropped. This defeats the honesty guarantee
the banner exists for. `App.jsx:2181, :2218, :2330`.

### HIGH

**H1 — Client SMS/email fires on the optimistic local write, before the save is confirmed.**
Booking/move/cancel handlers update state then immediately `fireApptNotify`; persistence is a
separate debounced effect that can fail. During a blip the customer gets "confirmed / moved to
3 PM," the save fails, the heartbeat reverts it → a ghost booking the customer believes is real.
`:21705, :21515, :24500, :21155`.

**H2 — Check-in / paid / done stamps are memory-only until save and are not mirrored to the
offline cache.** A crash mid-outage loses them — including money state (`paid`/`done` and the
`client.payments` ledger entry that prevents a second charge). `:21155, :21183`.

**H3 — Customer cancel/reschedule links report success even when the server RPC fails.**
`manage_cancel_by_token` / `manage_reschedule_by_token` results are not error-checked
(supabase-js returns `{error}`, doesn't throw), so a rejected cancel still shows "Appointment
released." Client thinks they cancelled; shop still holds the slot → surprise no-show.
`:8069`.

**H4 — Unauthenticated caller who knows a shopId (it's in every booking URL) can send
attacker-worded SMS/email to the owner's phone, push-spam staff devices, and code-bomb a
known client.** `originAllowed()` returns true when there's no Origin header (server-to-server
curl). `api/notify.js:59` (alert/staff), `api/push.js:83`, `api/client-code.js:33`. Real
10DLC compliance + cost risk. **Exploitability depends on env auth — see H5.**

**H5 — Cron/endpoint auth is opt-in.** `send-reminders`, `send-birthdays`, `calendar-run`
all gate on `if (process.env.CRON_SECRET)` — if it's unset in Vercel, they are world-callable
(`calendar-run` even sets `Access-Control-Allow-Origin: *`). **UNVERIFIED — needs a Vercel env
check.** `api/send-reminders.js:23`.

**H6 — Duplicate SMS/email.** `send-reminders` releases the idempotency claim on *any* send
error, including "Vonage delivered but the response was lost" → next 5-min run re-sends
(`api/send-reminders.js:136`). Birthday emails are non-atomic check-then-insert → duplicate on
any same-day re-run (`api/send-birthdays.js:82`). 10DLC risk.

**H7 — Render crashes never reach Sentry.** The custom inner `ErrorBoundary`
(`:1646`) catches every render error first and only `console.error`s — it never calls
`Sentry.captureException`, and a handled boundary doesn't re-throw, so the outer
`Sentry.ErrorBoundary` never sees it. The comment "the crash is reported automatically" is
false. The owner is blind to the single most common catastrophic failure. **One-line fix.**

**H8 — Blocking a client does nothing.** `confirmBlock` sets `client.blocked=true` but
`setBlockedNotice(true)` is never called and the public `ClientFlow` never reads `.blocked`.
A client blocked for no-shows/non-payment can still book online. UI says "blocked"; reality is
unchanged. `:26198`.

**H9 — Estimated Taxes is wrong in both directions.** Client refunds aren't subtracted
(overstates — `refundedFor` only scans `business.sales`, misses `client.payments`, `:25465`);
revenue from deleted/"anyone"/unassigned providers is dropped entirely (understates, no
catch-all row, `:25747`). RevenueView and ReportsHub report *different* revenue for the same
range whenever a client refund exists. The owner files off this number.

**H10 — Whole-blob last-writer-wins persistence clobbers concurrent edits across devices.**
`SettingsView` saves a stale full-`business` snapshot (`:19008`); `shops` is never live-refetched.
Device A editing hours at 1pm overwrites Device B's noon tipping change. Same pattern:
`api/calendar-run.js:184` clobbers the whole `shops.settings` blob; same-appt concurrent edits
are last-writer-wins (`:2105`); `send-reminders` stale client read-modify-write (`:182`).

**H11 — A stale/expired token on the shop's shared iPad can show `DEFAULT_PROVIDERS` seed
barbers on the public booking page.** `hasStoredSession()` only checks a token *key* exists,
not that it's valid (`:2047`). Stale token → null session blocks the full provider load AND the
`!hasStoredSession()` gate blocks the sanitized public feed → `providers` stays the in-code
demo seed. Same "fake data as real" class as the old `DEFAULT_SERVICES` burn, applied to staff.

**H12 — Session-keyed loads (clients/appts/providers) aren't covered by the "block saves on
incomplete load" invariant.** The gate is set only by the main shops/services routine (`:2222`),
not the session-keyed loads (`:2361`). A failed clients load → empty client list with **saving
still enabled** and no banner. `:2352`.

**H13 — Session expiry mid-use fails saves silently and never forces re-auth.** A dead refresh
token → write rejected by RLS → soft banner, but `session` isn't cleared and the user isn't
signed out. They keep working; every edit lives only in memory; a reload (or the auto-updater
firing on a deploy) drops them to login and loses it all. `:52, :2145`.

**H14 — Crash-reload loop.** Loads map `r.data` into state with no shape guard; both error
boundaries' only recovery is a full reload, which re-fetches the same bad row and crashes again
— inescapable. `:1646, :2252`.

**H15 — No offline write queue (the roadmap item).** Read side rides out an outage; write side
doesn't. In degraded mode all persistence is skipped while the UI updates optimistically, so
staff-side check-out/tip/status/walk-in appear to happen and vanish on reload. Checkout also
hard-fails on Stripe with no retry. The public booking path is the one correctly-pessimistic
flow; that pattern isn't extended staff-side. `RELIABILITY-PLAN.md §2` / `OFFLINE-PLAN.md`.

**H16 — Booking white-screens on a service missing `addonGroups`.** `lineTotal` (`:4142`) and
`describeEntry` (`:4169`) call `.addonGroups.forEach` unguarded, on every render, while sibling
code defensively writes `(… || [])`. A legacy/migrated service without the field blanks the whole
`ClientFlow` mid-booking.

**H17 — A family member's "learned time" overwrites the parent client's booking duration.**
The Pulse wrap-up tile and inline checkout save the timing suggestion to `appt.clientId` (parent)
with no `familyMemberId`, so logging the kid's 20-min cut overwrites Dad's custom duration; next
time Dad books online he gets the kid's time. `:22734, :9083, :22595`.

**H18 — Server trusts client-supplied Stripe ids and amounts.** `charge`/`refund` take
`customerId`/`paymentMethodId`/`paymentIntentId` from the client with no check that they belong
to the caller's shop; amounts are only bounded to (0, $100k]. Low blast radius at one shop; a real
hole the moment a second shop is onboarded. `api/stripe.js:225, :265`.

### MEDIUM

- **Double-submit window on the final Book for new clients** — `setBooking(true)` set after two
  network round-trips (`:4696`).
- **No email-format validation at the Book gate** — a typo'd address books fine; every
  confirmation/reminder silently bounces (`:7527`).
- **Stale reschedule slot list** — availability fetched once on mount, never refreshed (`:8005`).
- **Cancelling a paid appointment has no refund warning** — unlike Delete/Revert (`:21193`).
- **Same-appt concurrent edits: last-writer-wins, no conflict signal** (`:2105`).
- **AppointmentSheet / staff sub-screen crash on a deleted provider or empty name** —
  unguarded `provider.name` (`:25020`) / `person.name.toUpperCase()` (`:15791`).
- **A stray "." in a client price field saves the service as $0** and the public flow charges
  nothing (`:26124`).
- **Client writes use a stale-closure `setClients(clients.map…)` not a functional updater** —
  cross-call clobber of notes/gallery/overrides (`:26173`+; `setMember` runs it per keystroke).
- **Rebook/overdue radar is dead for app-native clients** — `lastVisit`/`cadenceDays` are only
  written on import, never on a live checkout (`:25918`).
- **Optimistic "Settings saved." toast fires before the debounced save runs, regardless of
  failure** (`:19008`).
- **Staff name/email/phone draft is discarded on back-nav** (commits only on "Done", `:15854`).
- **`clientType` booking restriction ("New"/"Returning") silently locks out the other half of
  clients** with a mislabeled control (`:14177`).
- **Staff can be saved with an empty name** — no validation, unlike the service editor (`:15854`).
- **Provider can be `undefined` in ConfirmationScreen on an empty providers list** → blank at the
  last booking step (`:4196, :7756`).
- **Coarse error boundaries** — one tile's render throw evacuates the whole app, not one surface.
- **Staff-side fake-data fallback** — the honest "can't load" gate is public-only; a cold cacheless
  failure shows the staff dashboard the demo menu/prices/staff (`:5149`).
- **Provider email/phone save backstop is disabled exactly when the re-read fails** (network
  trouble) — falls through un-merged (`:2091`).
- **Reschedule allows the past / off-shift hours with no warning** (`:21508, :24484`).
- **Report inaccuracies** — RevenueView POS mix double-counts walk-in service+tip (`:9712`);
  breakdowns don't net refunds; period boundaries use device-local tz vs ISO `bookedFor`;
  PerBarber occupancy renders "NaN%" on a bad start/end (`:10676`); multi-line deleted-service
  revenue drops to $0 (`:10408`).
- **send-reminders re-scans the full appointments table per shop every 5 min** (JSONB
  `bookedFor` can't be SQL-filtered) — unbounded cost/latency growth (`:62`); unbounded
  sequential fan-out can hit the Vercel timeout (`:50`).
- **notify.js anti-relay fails open** and is skipped entirely if the Supabase env is unset
  (`api/notify.js:174, :200`).
- **calendar-run weak non-crypto hash for synced-appt ids** — collision silently overwrites an
  appointment (`api/calendar-run.js:17`).

### LOW

- Dead `ManageAppointment` component with a stub phone gate and local-only writes — latent PII/
  enumeration if ever re-mounted (`:8253`).
- A legitimately empty menu (new shop) shows the "system is having a moment" outage screen (`:5149`).
- Internal Supabase error strings leaked to callers (`api/push.js:99`, `notify.js:68`, others).
- "Revert to default" clears both price and duration together (`:26233`).
- Upcoming-appt sheet shows the default price labeled "(client's price)" (`:26643`).
- New-client record shape omits `customPrices`/`family` (guarded downstream, `:25963`).

---

## Reliability gaps (systemic, not single bugs)

1. **Optimistic-everything.** UI, customer notifications, and money state all commit before the
   server confirms (C1, C4, H1, H2). The safe pattern already exists — the public booking path is
   correctly pessimistic — it just isn't extended to notifications, staff writes, or checkout.
2. **No durable server-side source of truth for "did we already collect/refund this ticket."**
   Idempotency lives in an in-memory map + a best-effort client write, both of which evaporate in
   the exact outage/crash conditions that cause the double-charge (C1, C3, H2, H18).
3. **No offline write queue** — the stated #1 roadmap priority; it's the root cause under H15, H2,
   C4, and part of C1.
4. **Whole-blob last-writer-wins persistence** across settings, appts, and the calendar-sync
   endpoint — silent cross-device data loss with no conflict detection (H10).
5. **Thin monitoring.** Render crashes are suppressed from Sentry (H7); outage signatures are
   filtered out; there is no independent uptime/health alert. Today you learn the shop is down from
   a customer complaint.
6. **Weak session-recovery.** Stale/expired tokens produce seed data (H11), silent save failures
   (H13), empty-list-with-saving-on (H12), and a crash-reload loop (H14).
7. **Endpoint auth is opt-in / send pipes are open** to anyone who knows a shopId (H4, H5, H6) —
   an active 10DLC compliance and SMS-cost exposure.
8. **Multi-tenant assumptions.** Several findings are "safe at one shop" but become serious the
   moment a second shop is onboarded (H18 Stripe-id authz, H11/staff-fake-data seed leak).

---

## Fix-first list (ordered by urgency × cheapness)

1. **[Dan, 5 min] Confirm `CRON_SECRET` and `INTERNAL_API_KEY` are set in Vercel prod.** Gates
   H4/H5. I can't see Vercel from here.
2. **[C2] Decide payments Test-mode NOW** — either make the copy truthful ("this shop is live,
   real cards are charged") or implement a real test toggle and stop force-writing `live:true`.
   You said you're testing; today you may be charging real cards.
3. **[H7] Add `Sentry.captureException` to the custom `ErrorBoundary`.** One line; restores crash
   visibility so everything else is observable.
4. **[C4] Fix the silent read-only trap** — pin the "changes paused" banner whenever
   `loadedRef===false`, so "paused" can never be hidden while saves are off.
5. **[C1 / H2] Durable card-charge idempotency** — deterministic key from ticket identity, reuse
   the same PaymentIntent on retry, never mint a new intent after a confirm whose outcome is
   unknown. Stop the double-charge.
6. **[H1 / H3] Gate customer notifications on a confirmed save; error-check the cancel/reschedule
   RPCs** before showing success.
7. **[H8] Enforce client `blocked` in the booking path** (client-side + server RPC).
8. **[H9] Fix the tax report** — net `client.payments` refunds; add an unassigned-provider row.
9. **[H16 / crash guards] Guard `addonGroups`, `provider?.name`, and resolver `!service`** —
   cheap one-liners that remove blank-screen paths.
10. **[H10] Stop whole-blob clobber** — field-merge settings on save (mirror the `calSync`
    backstop) and add per-row concurrency on appts.

Then the larger roadmap item — **the offline write queue (Route A)** — which is the structural
fix behind H15/H2/C4 and reduces the blast radius of several others.

---

## Verdict: NOT SAFE YET

For a real business, day one, the disqualifying risks are:

- **A customer can be double-charged** on ordinary bad wifi (C1), and **double-refunded** if you
  ever refund from the Stripe dashboard (C3).
- **You may be charging live right now while the app tells you it's in Test mode** (C2).
- **Staff edits silently vanish** after a wifi blip with the "paused" banner gone (C4) — during
  exactly the conditions a busy shop hits.
- **Blocked clients can still book** (H8), and **your tax number is wrong** (H9).
- **An open, unauthenticated SMS pipe to your phone** exists during active 10DLC vetting (H4/H5).

None of these are exotic; they trigger on normal shop conditions (bad wifi, a refund, a shared
iPad, a blocked regular). The good news: the worst blank-screen/fake-menu failures that motivated
this work are genuinely handled, and the fixes above are mostly small and self-contained. Ship the
fix-first list, then re-audit — this becomes "safe for a controlled soft-launch" well before the
full offline project lands.

---

## What was NOT verified (honesty section)

- **Static only.** Nothing was reproduced live — no staging, per instruction. Severities are
  code-traced, not observed.
- **Server RPCs unread** — `book_public`, `manage_cancel/reschedule_by_token`,
  `save_booking_client` live in Postgres, outside the audited files. H3/booking-race severities
  partly depend on whether those enforce slots atomically and how they signal errors.
- **Env vars unseen** — H4/H5 exploitability hinges on `CRON_SECRET`/`INTERNAL_API_KEY` being
  set in Vercel; I can't check.
- **Data-shape likelihood unknown** — crash paths (H16 addonGroups-less service, deleted-provider
  appts) require a malformed record to exist in prod; I can't confirm one does.
- **RLS not reviewed** — whether row-level security actually permits the cross-device overwrites
  assumed in H10/appts is inferred from client code, not confirmed server-side.

---

## Track B — staging spec (what a safe live-QA harness requires)

The "book every combination with fake data" QA could not run because there is one Supabase project
and live Stripe. To do it safely, in order:

1. **Second Supabase project** ("vero-staging") with the schema applied from `db/` — a real,
   separate database so no test row can touch production.
2. **Stripe test-mode keys** wired to the staging deploy (`pk_test_`/`sk_test_`), so card flows
   exercise Stripe's test cards, never live money.
3. **Disable the crons against staging** (or point `send-reminders`/`send-birthdays` at a sink) so
   synthetic bookings can't fire real SMS/email — critical during 10DLC vetting.
4. **Seeded fixtures** — a test shop, 2–3 test staff, a spread of services (with/without
   `addonGroups`, cut types, time rules), and synthetic clients (new, returning, family, blocked).
5. **A test-only auth path** — a seeded staff magic-link or a staging-only PIN, so QA can sign in
   without touching production credentials.
6. **A staging URL** on a Vercel preview/branch deploy pointed at the staging Supabase.

Only then can the matrix run (every service × duration × barber × date × time; reschedule / cancel
/ no-show / duplicate / invalid input; auth/authz for each test user) with a hard guarantee that no
real data or money is touched. This is a few hours of setup, not a test run — I can build it on
approval.
