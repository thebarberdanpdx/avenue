# Running costs — the one honest ledger

_Every service the app needs, what it does, and what it costs. Update this whenever a service is added, upgraded, or dropped — Dan should never have to "lose count" again. Amounts marked ⚠️ are from session notes, not read off a bill; the billing page is the truth. Last updated 2026-07-08._

| Service | What it does for the shop | Cost | Verdict |
|---|---|---|---|
| Supabase **Pro** | The database: every client, appointment, service + **daily backups**. Includes ~$10/mo compute credit → the **Micro** instance (upgraded 2026-07-08 after the NANO-exhaustion outage) is covered by it. | ⚠️ ~$25/mo | KEEP — this line item is the data + its backups. Never downgrade to Free (no backups, auto-pause). |
| Vercel **Pro** | Hosting + serverless api/ + the `*/5` cron that makes reminder texts fire on time (Hobby's cron is ~daily/throttled — it's what broke reminders in June). Also lifts the deploys/day cap. | ⚠️ ~$20/mo | KEEP while SMS reminders matter. Re-evaluate only if reminders move elsewhere. |
| Apple Developer Program | The iOS app's existence (signing, TestFlight, push, Tap to Pay entitlement). | $99/yr (≈$8/mo) | KEEP while the native app is wanted. |
| Vonage | The actual SMS sends — toll-free number, ~0.8¢ per 160-char segment; a full day of reminders ≈ pennies. | usage (~$1–5/mo) + small number rental | KEEP — costs follow usage, nothing to trim. |
| Stripe | Card processing (checkout, card-on-file, Tap to Pay, refunds). No subscription — per-transaction % + fixed fee. At real revenue this is the biggest money line in the stack, but it scales with income, not time. | $0/mo + per-swipe | KEEP — it's the payment rails. |
| Domain gotvero.com | The address. | ⚠️ ~$15–20/yr | KEEP. |
| GitHub | Code, history, the deploy robot (Actions), regression guards. | free tier | KEEP — free. |
| Sentry | Server error alarms (wired into api/). | ⚠️ believed free tier — CONFIRM on the Sentry dashboard | KEEP if free; revisit if it's billing. |
| ~~PowerSync~~ **DROPPED** | ~~The offline-sync engine.~~ **NOT IN USE.** Tried 2026-07-10, crashed the iOS app (WASM in WKWebView), fully reverted. No offline feature ships today. | **$0 — not subscribed.** No paid tier was ever confirmed. | STALE line kept for history. **Action for Dan:** if a PowerSync cloud project/account was created pointing at prod Supabase, delete it; remove `VITE_POWERSYNC_URL` from Vercel env if set; drop any `powersync_*` Postgres replication slots (but KEEP `supabase_realtime`). See NATIVE-OFFLINE-ROLLBACK-HANDOFF.md. |

**Total believed run-rate today: ≈ $55/mo** + per-use pennies (SMS) + per-swipe (Stripe).
Reference point: Mangomint alone starts ≈ $165/mo — the whole independent stack is about a third of that, owned outright.

## Rules
1. **No new paid service ships without Dan seeing the price first** — free tiers preferred while building; paid only when real usage demands it, with the numbers shown.
2. Any upgrade (compute size, plan tier) gets logged here the day it happens, with the reason.
3. Anything marked ⚠️ CONFIRM gets verified against the real billing page next time Dan has it open.
