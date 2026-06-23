# 🟢 Hardening — Track A: Your Shop (Sanctuary)

**Purpose:** make Vero safe and solid enough to run your own real shop on.
**Do:** now (before/around launch). **Owner:** Dan. **Driver:** Claude.

## Ground rules (so nothing breaks)
- ❌ Never touch: the toll-free assets (footer email, `optin.html`/`optin.png`, `?optin=1`), the SMS consent copy (must stay exactly ×4), or the live booking/dashboard/checkout flows.
- ✅ Every fix = its own git commit → instantly revertible.
- ✅ Every deploy passes the ship ritual: `npm run build` clean → consent count = 4 → booking + checkout verified in preview → then deploy.

## Status legend
`✅ done` · `🔶 in progress` · `🟦 next` · `🟨 queued` · `☐ not started`

## Overall: ~40%  ▓▓▓▓░░░░░░

| Status | Item | Why it matters for ONE shop |
|---|---|---|
| ✅ | Audit + threat model | Done — we know exactly what to fix |
| 🔶 | Lock open API endpoints — ✅ **LIVE** `calendar-pull` wipe/sync requires owner login (commit c0a542d; tested: anon POST → 401) · ✅ **LIVE** `ical` feed requires a per-shop key (commit a478b3a; tested: no/wrong key → 404, key-issuing door → 401) · ☐ `notify`/`push` relay (public-booking path — needs gentle guard/rate-limit, NOT login) | Anyone could read your clients / abuse your SMS / wipe your calendar |
| 🔶 | Payment integrity — ✅ **LIVE** server-side amount guard (deployed 2026-06-23, commit adfc1ef; tested: rejects negative/zero/giant) · ☐ Stripe webhook | Stop price-tampering at checkout; keep books in sync with Stripe |
| 🔶 | Safe cleanups — ✅ **LIVE** price/duration + deposit + per-barber-override guards (deployed 2026-06-23, commit de9f32e) · ✅ booking photo upload already safe (auto-shrinks, caps at 3) · ⏸ "delete all" button — **kept on purpose for now** (owner uses it to clear test clients pre-launch; REMOVE before real launch) | Prevent accidental data wipe + garbage data |
| 🟨 | Reliability (error monitoring, schedule reminder cron, schema→git, CI build gate) | Know when things break; reminders actually send |
| 🟨 | Concurrency data-loss guard | Two devices at the desk won't overwrite each other |
| 🔶 | Security headers — ✅ **LIVE** frame/sniff/referrer/HSTS (deployed 2026-06-23) · ☐ full CSP (later, careful) · ☐ remove hardcoded password `avenue2026` | Basic web hardening |
| 🟨 | STOP opt-out handler | Required once SMS goes live (TCPA) |

## Next action
🟦 Last open door: `notify` (email/SMS sender) + `push` (staff alerts). These run on the PUBLIC booking path, so they CANNOT require login. Add a gentle guard that doesn't break booking: an `Origin`/`Referer` allowlist (gotvero.com + native) to stop cross-site browser abuse, a sane per-request cap/validation, and rely on existing gates (SMS is still behind `SMS_LIVE`, email is a fixed from-address). True rate-limiting needs a KV store (defer — note it). Each = its own revertible commit, booking verified first.

## Diagnostics log
- **2026-06-23 — `ical` feed locked & LIVE (commit a478b3a):** feed now requires `?k=<token>` (HMAC of the server-only service secret); missing/wrong key → **404 "Not found"** (verified live on `/api/ical/avenue-phi/dan.ics`). The key is issued only to a signed-in owner via `/api/calendar-pull` `mode:"icaltoken"` (folded into that existing owner-only endpoint to stay at Vercel's 12-function cap — a standalone `api/ical-token.js` was tried first and blocked the deploy). Key-issuing door with no login → **401**. Dashboard (`StaffMembersView`) fetches the key once and shows a ready-to-paste link (placeholder until loaded). Owner happy-path not curl-testable (needs a login session) but code path is straightforward + no real appointments exist yet. **Track B:** key endpoint issues for any shop a signed-in user names — scope to membership before multi-tenant.
- **2026-06-23 — `calendar-pull` locked & LIVE (commit c0a542d):** endpoint now requires a valid Supabase session token (same `getUser()` guard as `api/stripe.js`); client attaches the owner's token via new `authedHeaders()` helper on all 3 call sites; `Authorization` added to CORS allow-list. Verified on gotvero.com: anonymous `POST /api/calendar-pull` → **401 "Not authorized"** (was an open calendar-wipe), booking site → 200, preflight allow-headers now include `Authorization`. Daily cron (`/api/calendar-run`) unaffected (separate path). Booking flow re-verified in preview (consent ×4, footer email, card step all intact).
- **2026-06-23 — anonymous read test (public key, no login):**
  - `clients` → 0 rows · `appointments` → 0 rows → no PII returned to a stranger ✅
  - `providers` → 6 · `services` → 4 → readable by design (public booking needs them) ✅
  - ✅ **CONFIRMED 2026-06-23:** Supabase shows `clients` has 2 RLS policies AND contains 1 real row ("Dan") — yet the anonymous read returned 0. The lock is genuinely ON and filtering. The "anyone can read your client list" finding is **CLOSED** for the anon path. (Cross-tenant logged-in isolation = Track B, only relevant once a 2nd shop exists.)
- **2026-06-23 — iCal feed (`/api/ical/avenue-phi/<provider>.ics`):** open with no token, but currently returns 0 appointments / 0 names (no data to leak yet). Structural fix still needed (add a secret token) **before real appointments exist.** Real shop slug = `avenue-phi` (brand: Sanctuary Barber Co).
