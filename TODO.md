# ✅ Vero — What's left to do (Dan's master list)

_Last updated: 2026-07-02. The single, plain-English list of everything still wanted. Deeper detail lives in `AUDIT-TRACKER.md` (security items), `HARDENING-SHOP.md`, `HARDENING-SAAS.md`, and `SESSION-HANDOFF.md` (full history + how-to)._

**What we're doing, in one breath:** getting Vero safe + solid + polished enough to **(1) open your own shop**, and in parallel **(2) get it on TestFlight for testers.** The "sell it to other shops" path is a separate, much bigger someday-project (kept at the bottom).

**Already done (the heavy lifting):** the app works (booking, live payments, calendar, clients, reports); the dangerous security holes are closed + locked; and the recurring bugs (staff email/phone vanishing, tab nav, accidental data wipe) are fixed **and regression-locked** so they can't silently come back. Full done-list: `SESSION-HANDOFF.md`.

Status legend: ☐ not started · ⏳ waiting on someone/something · ✅ done

---

## 1) 🚪 To OPEN your shop — the real finish line
- ☐ **Turn on backups** — upgrade Supabase Free → **Pro (~$25/mo)**. The #1 gate; without it a data wipe is unrecoverable. *You, ~10 min.*
- ☐ **Real shop info + menu** — replace the demo name/email/address/phone in Settings; confirm your real **services, prices, staff, hours**; clear the demo/test clients so reports start clean. *You, ~15 min.*
- ☐ **Booking link** — confirm the exact web address customers use lands on *your* shop (slug `avenue-phi`). *You + me.*
- ☐ **Stripe pays you** — confirm your bank is connected + payouts are on in Stripe (charges are already live). *You, ~5 min.*
- ☐ **One real test booking** — book as a customer → pay → confirmation email → shows on your calendar → refund it. The final proof. *Together, ~30 min.*
- ☐ **Reminders firing** — decide: Vercel **Pro (~$20/mo)** OR a free timer I set up; then I switch them on. *(Email confirmations already work without this.)*
- ⏳ **Texts (SMS) + auto-STOP** — turn on automatically when **Vonage approves your toll-free number** (in carrier review). I build the auto-STOP piece then. *Waiting on Vonage — nothing to do.*

## 2) 📱 iOS app → TestFlight (for testers) — parallel, NOT a launch blocker
Customers book on the **web**; the app is for you, staff, and testers.
- ✅ **Upload to TestFlight + add testers — DONE 2026-06-24.** App is live on TestFlight as **"Vero Booking"** (`com.gotvero.app`); **you + Heather both have it installed.** App loads the live site, so every web change appears automatically — no re-upload except rare native changes (and TestFlight builds expire ~every 90 days, so a fresh upload roughly quarterly).
- ⏳ **Public download link** — an external review is in flight (~1 day); once Apple approves, flip on the group's **Public Link** to share with anyone. *(I'll walk you through it.)*

## 3) ✨ Make it feel premium — UI polish
- ☐ **Owner dashboard polish** (calendar + clients — the screens you live in), Mangomint-grade. The client booking flow is already polished + live. Needs a signed-in preview or screenshots to do well. See memory `mangomint-polish-direction`.

## 4) 🛡️ Tighten soon (real for one shop, but NOT open-the-doors blockers)
- ☐ Stop a stranger checking whether a phone/email is your client; enforce "blocked client can't book" on the server; confirm the email login-code can't be brute-forced. *(Need ~10 min of your Supabase access.)*
- ☐ Rate-limit the text/email senders; verify Stripe receipts by signature; store a timestamped consent record; cap photo/text sizes on the server.
- ☐ Remove the leftover hardcoded password `avenue2026` (careful — touches login).
- Full technical list + live status: **`AUDIT-TRACKER.md`**.

## 5) 🏢 SOMEDAY — only if you decide to SELL Vero to other shops
**Not needed to run your own shop.** A separate, much bigger build:
- A proven wall between shops (multi-tenant isolation) · a real billing/subscription system · making it scale to thousands of shops · platform legal (data agreements, customer data export/delete). See **`HARDENING-SAAS.md`**.

## 6) 💡 Feature ideas — parked (revisit when ready, not a blocker)
- ☐ **Require prepay by service + barber + returning-only.** Make certain services (e.g. the 30-min Standard Haircut) charge the **full price up front** when booked online — but only for **Dan's** bookings (not Heather's), and only for **returning clients** (new clients still just add a card, no charge). *Investigated 2026-07-02 with 3 subagents — findings below so we don't re-dig.*
  - **Why it's not possible today:** the service editor already shows a **"Charge the full amount when booking online"** toggle, but it's a **dead switch** — the online booking flow ignores it and uses only the one shop-wide card/deposit setting. There is **no per-barber** payment rule anywhere. (Easy part: the app already knows a client is returning at the payment step.)
  - **How it would work:** three independent switches on a service — (1) require payment ON/OFF, (2) which barbers it applies to (Dan on / Heather off), (3) returning clients only vs everyone. Mockup: **https://claude.ai/code/artifact/875b7d6e-1ceb-497e-bc48-b210310514c4**
  - **Build breadcrumbs (skip re-investigating):** client card/deposit step is `src/App.jsx` ~6504–6560 (`needsCard` / `depositAmt`, currently reads only `business.booking`). Per-service `service.booking.requirePayment` already exists (editor ~line 11816) but is never read — wire it in here. Add a new per-service-per-barber flag (no per-provider payment field exists today; `service.staff[providerId]` holds only price/duration/cut overrides). Returning signal = `matched` (set at code-verify, before the payment step); the new-client path leaves `matched = null`, which naturally means "new client = no prepay." Charging the full amount = a real charge via the existing `StripeCardSheet` "payment" mode (already used for deposits).
  - **Effort:** moderate + contained (one code area + one small setting). Touches **live payments** → must be tested with real test bookings before shipping.

---
_Resume next session with: "Read TODO.md and let's keep going."_
