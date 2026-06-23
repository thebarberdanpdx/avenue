# 🟢 Hardening — Track A: Your Shop (Sanctuary)

**Purpose:** make Vero safe and solid enough to run your own real shop on.
**Do:** now (before/around launch). **Owner:** Dan. **Driver:** Claude.

## Ground rules (so nothing breaks)
- ❌ Never touch: the toll-free assets (footer email, `optin.html`/`optin.png`, `?optin=1`), the SMS consent copy (must stay exactly ×4), or the live booking/dashboard/checkout flows.
- ✅ Every fix = its own git commit → instantly revertible.
- ✅ Every deploy passes the ship ritual: `npm run build` clean → consent count = 4 → booking + checkout verified in preview → then deploy.

## Status legend
`✅ done` · `🔶 in progress` · `🟦 next` · `🟨 queued` · `☐ not started`

## Overall: ~13%  ▓▓░░░░░░░░

| Status | Item | Why it matters for ONE shop |
|---|---|---|
| ✅ | Audit + threat model | Done — we know exactly what to fix |
| 🟦 | Lock open API endpoints (`ical` PII leak, `notify`/`push` relay, `calendar-pull` wipe) | Anyone can read your clients / abuse your SMS / wipe your calendar today |
| 🟨 | Payment integrity (server-side amount check + Stripe webhook) | Stop price-tampering at checkout; keep books in sync with Stripe |
| 🔶 | Safe cleanups — ✅ price/duration + deposit + per-barber-override guards (verified, pending deploy) · ✅ booking photo upload already safe (auto-shrinks, caps at 3) · ☐ remove "delete all" button | Prevent accidental data wipe + garbage data |
| 🟨 | Reliability (error monitoring, schedule reminder cron, schema→git, CI build gate) | Know when things break; reminders actually send |
| 🟨 | Concurrency data-loss guard | Two devices at the desk won't overwrite each other |
| 🟨 | Security headers / CSP + remove hardcoded password | Basic web hardening |
| 🟨 | STOP opt-out handler | Required once SMS goes live (TCPA) |

## Next action
🟦 Lock the open API endpoints — as separate revertible commits, booking flow verified in preview first.

## Diagnostics log
- **2026-06-23 — anonymous read test (public key, no login):**
  - `clients` → 0 rows · `appointments` → 0 rows → no PII returned to a stranger ✅
  - `providers` → 6 · `services` → 4 → readable by design (public booking needs them) ✅
  - ✅ **CONFIRMED 2026-06-23:** Supabase shows `clients` has 2 RLS policies AND contains 1 real row ("Dan") — yet the anonymous read returned 0. The lock is genuinely ON and filtering. The "anyone can read your client list" finding is **CLOSED** for the anon path. (Cross-tenant logged-in isolation = Track B, only relevant once a 2nd shop exists.)
- **2026-06-23 — iCal feed (`/api/ical/avenue-phi/<provider>.ics`):** open with no token, but currently returns 0 appointments / 0 names (no data to leak yet). Structural fix still needed (add a secret token) **before real appointments exist.** Real shop slug = `avenue-phi` (brand: Sanctuary Barber Co).
