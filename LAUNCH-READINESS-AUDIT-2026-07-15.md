# Vero — Launch-readiness audit (2026-07-15)

Ran an 18-subagent adversarial audit of the whole app, then **personally verified the top claims** against the code and live DB. Tags below:
- **[VERIFIED]** — I re-opened the exact line / ran a live test and confirmed it.
- **[CODE-READ]** — a subagent cited a specific file:line; I trust it (5/5 of the ones I spot-checked were exact) but did not personally re-open every one.
- **[LIVE]** — observed in a real browser/DB probe this session.
- **[DISPROVED]** — claimed as a risk but I tested it and it's NOT real.
- **[UNKNOWN]** — could not be verified from the repo/sandbox; needs prod or a device.

## Honest correction on my "90%"
My earlier 82% → 90% measured **"features exist and render."** On the real bar — **"safe to put real clients and real money through"** — it's lower, because there are verified money, compliance, and trust holes below. Measuring build-completeness and calling it launch-readiness is exactly the mistake that eroded trust. This board is the corrected view.

## Good news I verified first (so the list isn't all fear)
- **[DISPROVED] Client PII is NOT exposed.** The scariest audit finding was "a signed-in non-member might read all 2,973 clients via the direct DB path." I signed in as a real non-member and attempted the exact read against the live `sanctuary` shop: **0 rows** from clients, appointments, waitlist, providers, reviews. Row-level security holds. Data is protected.
- The **public booking flow renders in clean, consistent Onyx design** (verified in live screenshots) — the client-facing look is not the problem.
- The **sync/persistence guards** (no empty-save, no provider-contact blanking, deletion-aware merge, access-lockdown) are intact.

---

## MUST FIX before real money / real clients

### Money
1. **[VERIFIED] In-person card sale can double-charge on a bad-wifi retry.** `sale_intent`/`terminal_intent` create a fresh PaymentIntent with **no idempotency key** (`api/stripe.js:256,325`), and the client sends none (`idemSig` returns null for sale_intent, `src/App.jsx:958`). If Stripe succeeds but the response is lost and staff tap Charge again → second charge. The no-show `charge` and `refund` right next to it *do* have the key — this path was just missed. → Attach a stable idempotency key + reuse the same intent on retry.
2. **[CODE-READ] A charge that succeeds but whose local record is lost → reopening the ticket re-charges full price.** `src/App.jsx:23643/23741-23761/23809`; heal effect only fires when `paid>0` (`22233`). → Persist `paymentIntentId` atomically with the charge, or block reopen when a recent unsettled intent exists. *(I confirmed the idempotency gap that underlies it; the full reopen path is my next thing to re-verify.)*
3. **[CODE-READ] Per-client custom price ignored when staff book from the calendar.** `commitAppt` honors custom *duration* but not custom *price* (`22759-22760`); the public flow does it right (`5022`). Client charged standard rate; wrong price locks onto the appt.
4. **[CODE-READ] Refunds record the typed amount, not Stripe's returned amount, and test-mode skips the real refund** (`api/stripe.js:281` vs `24380/25268`, gate at `25264`).
5. **[CODE-READ] Out-of-band refunds/chargebacks desync the books.** The Stripe webhook patches the appointment (`api/stripe.js:82-85`) but revenue reports read a separate `client.payments`/`business.sales` ledger the webhook never touches → refunded money keeps counting as revenue.

### Legal / compliance (blocks the migration specifically)
6. **[VERIFIED] Every imported client is force-stamped `smsConsent:true` with today's date** (`src/App.jsx:16104`, verbatim). That's fabricated consent while Vero is under 10DLC vetting — a TCPA/carrier landmine the moment a reminder texts them. → Import as consent-unknown; **legal check before any bulk import touches SMS.**
7. **[CODE-READ + needs you] Text reminders don't actually send.** All SMS is gated behind `SMS_LIVE==='true'` (`api/send-reminders.js:33`, `api/notify.js:39`), which isn't set; text falls back to email only if an email exists. Your 156 phone-only clients get **nothing**, while the booking copy promises texts. → Needs Vonage number + 10DLC approval + `SMS_LIVE=true`, then a real test text.
8. **[UNKNOWN] STOP / opt-out inbound handling was never audited** — it's a hard 10DLC requirement. Needs a look.

### Trust (the "false done" class you specifically hate)
9. **[VERIFIED] The "Rebook sent" nudge is fake.** `sendNudge()` shows "Rebook text sent to [name]" and hides the client from your follow-up list, but makes **no network call at all** (`src/App.jsx:27101-27110`). You'd think you re-engaged a lapsing client; they hear nothing. → Route through `/api/notify`, only toast on real success.
10. **[CODE-READ] The overdue / "It's been a while" radar is inert for clients created in-app** — visit count / last-visit aren't written on checkout (`20641`), so the nudges only ever work for imported clients.

### Security
11. **[VERIFIED] Hardcoded master code `"avenue2026"` ships in the public JS bundle** (`src/App.jsx:2094`) and unlocks the staff-PIN gate. Anyone can view-source it. → Move to a per-shop secret or delete the dead gate.

### Client-facing bugs
12. **[LIVE] Booking bounces to the Staff Sign-In screen mid-flow** on `vero-mig` (screenshot `book-03.png`). A real client could abandon here. → I need a clean reproduction to confirm it's user-facing vs a multi-location routing quirk, then fix.
13. **[CODE-READ] The demo menu (`DEFAULT_SERVICES`) can flash and be tappable on the public booking page during a slow first load** (`2178`, no `!dataLoaded` gate before `ClientFlow`) — the exact "fake menu masquerading as real" failure that burned you in the outage.
14. **[CODE-READ] Per-barber report white-screens** when a barber's top service was later deleted (`11612/11764`, missing the null-guard its sibling reports have). Trivial fix.
15. **[CODE-READ] A blocked client can still book online** — your own launch checklist already flags it (`20640`); blocking isn't enforced in the booking path.

---

## Design (your #1 complaint) — the honest scope
- **[VERIFIED] The redesign reached ~2 of ~233 components** (client list + client card). ~298 `Fraunces` serif call-sites everywhere else. So the new look is a thin slice; calendar, checkout, settings, reports, pulse, import are all still the **old serif design**.
- Important nuance: the old design is **coherent, not broken** — on its own theme it reads fine, and the client-facing booking flow is fully on the new Onyx look. So this is **owner/staff-facing polish debt, not a client-facing embarrassment.**
- Two real glitches: the redesigned card hardcodes a white palette, so on a **dark theme it's a blinding white island** (`27131`); and every sheet opened *from* it (checkout, reschedule, add-family) **reverts to old serif** (`876-880`) — so one interaction flip-flops old/new.

---

## Still UNKNOWN — the audit itself couldn't check these (don't assume OK)
- **[UNKNOWN] Concurrent double-booking / atomic server-side slot guard.** CLAUDE.md demands it; the audit only found client-side conflict checks. Two people booking the same slot at once was never tested.
- **[UNKNOWN] Stripe webhook signature verification** — is the payment-mutating webhook forgery/replay-protected?
- **[UNKNOWN] Live write paths never observed working.** The sandbox browser couldn't reach `sync-pull` ("Failed to fetch"), so no checkout / save / appt-create was seen succeeding live. Almost certainly a sandbox artifact (the real shop syncs daily), but unproven here.
- **[UNKNOWN] Native iOS app** — the actual shipping surface — was audited from source only, never run on a device.
- **[UNKNOWN] Monitoring/alerts/backups actually firing in prod**, and **performance at 2,973 clients**.

---

## Split: what only YOU can do vs. what I fix in code
**You (or with me on a device):** 10DLC + Vonage + `SMS_LIVE` (so reminders work) · legal sign-off on import consent · a real live-card charge test · the real Mangomint export dry-run · on-device native test.

**Me, solo, in priority order:** double-charge idempotency (#1) → forged-consent import fix (#6) → fake-nudge (#9) → demo-menu flash gate (#13) → per-barber crash (#14) → blocked-client booking (#15) → custom-price-on-calendar (#3) → refund amount/reconcile (#4,#5) → hardcoded password (#11) → the design consistency pass.

**Do not run the migration or take real card payments until #1, #6, and #7 are resolved.**
