# Phase 2 — where we are & what's left (plain English, for Dan)

Status after the reliability-hardening session (2026-07-11). Written so nothing
built this session gets forgotten on a branch.

The big plan: **fix the foundation → prove it → then add features.** We are at the
**Phase 1 → Phase 2 handoff**: the foundation is solid and mostly live; the next
phase is proving it in real use.

---

## ✅ Done & live (confirmed on Dan's phone unless noted)

- All 3 owner logins work and can take card payments
- Payment security tightened (only real shop members can charge/refund)
- Leaked Supabase service-role key **rotated** — old key confirmed dead
- **Payments Test/Live toggle** — and in Test mode, *nothing* is ever charged
  (every card path was fixed to honor Test — it used to charge real cards)
- **Crash-hardening** on the daily screens (calendar, clients, appointments) —
  a half-loaded record can't white-screen the app
- **White-screen crashes now report to Sentry** (they were silently swallowed) →
  you get emailed when the app breaks
- Outage read-cache + honest banners; the scary raw error was removed from the
  save-failed banner
- **Outage auto-recovery** — when the backend comes back, saving turns itself
  back on (fixed a silent read-only trap). Shipped on reasoning (see parked #2).
- Monitoring **confirmed working**: both the "shop is down" alarm and Sentry
  "app errored" alerts reach your inbox (you have the test emails).
- **Sales can't fall out of the reports anymore.** Every checkout/register sale
  now saves to the server the *instant* it's rung up. Before, it waited ~1 sec —
  so if the app got swiped away or crashed in that sliver, Stripe still charged
  the card and the appointment still showed paid, but the sale could vanish from
  your revenue report. (Fixed the appointment checkout AND the register.)
- **Double-tap on "Book" can't create two appointments** — the confirm button is
  now guarded against a fast double-press.

## ⏸️ Parked — needs YOU (a few minutes each, no rush)

1. **Card-reader double-charge test.** The fix is built and waiting on branch
   `claude/checkout-double-charge`. Once your reader is hooked up: tell me → I
   deploy it → you run one real ~$1 charge, hit "Try again", we confirm it only
   charged once, then refund. (Covers Tap-to-Pay + card reader "Try again".)
2. **Outage-recovery fix** — already shipped (couldn't be drilled; airplane mode
   can't fake "internet up, database down"). Will prove itself in a real outage.
3. **Test vs Live** — you're currently on **Live** (real cards charge). Flip to
   **Test** (Settings → Payments & checkout → Payments & tips → Payments) if you
   want to poke around for free while testing.

## 🅿️ Deferred on purpose (Phase 3 — later, together)

- **True airplane-mode offline** — needs a native rebuild + slow device testing.
  This is the part that broke the app before; not worth it until you're running
  daily and can test with me. (The outage-while-online case is already handled.)
- New features.

## 🔧 Optional hardening (on me, not blocking)

- Automated test safety net — biggest long-term win; stops future changes from
  quietly breaking things. A real investment; scope it when ready. **← this is the
  next big decision; everything else in "on me" is now done.**
- ~~Contain a crash to one screen instead of the whole app.~~ **DONE & live** — a
  crash in one dashboard tab now shows a recoverable panel and the tab bar keeps
  working, instead of white-screening the whole app (still emails you via Sentry).
- Surface the payment Live/Test mode more prominently (today it's 3 taps deep).

## The real Phase 2 work — only you can do this

Run the app **alongside** whatever you use now, for ~a week. Book, check in,
check out **real** clients — but **don't rely on it yet.** Screenshot anything
that looks off and send it. Real-use bugs are the ones no code review finds.
Phase 2 is "done" when *you've run enough real days that you trust it* — not a
checkbox.

---

### Branches holding built-but-unmerged work
- `claude/checkout-double-charge` — sale_intent + card-present double-charge
  fixes (held for the reader test above).
