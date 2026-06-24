# 📊 Vero — Audit Fix Tracker

Tracks **every** finding from `LAUNCH-AUDIT-2026-06.md`. Update this as items get fixed.

**Legend:** ✅ done & live · 🔶 in progress / code-ready (awaiting deploy) · ⏸ parked on purpose · ☐ not started
**Percent counts ✅ (done & live) only.** In-progress (🔶) is shown but not counted until it deploys + is verified.

---

## 🟢 Shop-launch readiness — the [NOW] list (what Dan needs before real bookings)

### Done & live: 6 / 23 → **26%**  ▓▓▓░░░░░░░
### In progress (code-ready, awaiting deploy): 0

| Status | Fix (plain English) | ID · Severity |
|---|---|---|
| ⏸ | Turn on backups (Supabase Pro) — parked to launch by choice (no real data yet) | C1 · Critical |
| 🔶 | Stop a stranger from checking if a phone/email is your client — ✅ **email sign-in path LIVE** (88365de; `/api/client-code` returns a uniform `{ok,masked}`, verified live). ☐ **Deeper find (2026-06-24):** the `lookup_client_by_phone` + `lookup_client_by_email` RPCs return a returning client's stored PII (name/email/family) to ANY anonymous caller — they power booking autofill — and the **phone** sign-in path isn't code-verified server-side (App.jsx ~4901 uses `pendingMatch` directly when `usePhone`). Proper fix = a code-gated returning-client flow, which ties into SMS (not yet live). Deferred as its own careful task — NOT a quick SQL change. | H1 · High |
| ☐ | Close the two behind-the-scenes doors still open to scripts (notify/push) — **do carefully: same code path runs inside the native iOS app; a wrong origin tightening could break native booking confirmations/push. Needs a native test, not a rushed edit.** (notify's only server caller is client-code → use internal secret.) | H2 · High |
| ☐ | Stop huge photos/text being saved into the database (caps + move images out) | H3 · High |
| ⚠️ | Switch the reminder texts/emails on (schedule the job) — **BLOCKED: needs a plan decision.** Vercel Hobby allows only 2 scheduled jobs (you have 2) and runs them once/day; reminders need ~every 15 min. Options: upgrade Vercel Pro (~$20/mo) OR wire a free external scheduler to poke the endpoint. | H4 · High |
| ✅ | Put an alarm on the money/text/background code; stop losing failed saves — **LIVE (5d13b21 + 981dd70): server crash alerts on stripe/notify/push + 3 crons; per-item cron-fail alerts; client-side lost-save capture.** | H5 · High |
| ☐ | Save a timestamped record when customers agree to texts | H6 · High |
| ✅ | Confirm the login-code can't be guessed by brute force (check in DB) — **LIVE in Supabase (2026-06-24): `verify_client_code` now caps guesses (5 wrong → code burned) via a new `client_login_codes.attempts` column. SQL in `db/hardening-2026-06-24.sql`** | H7 · High |
| ☐ | Verify Stripe receipts (webhook signatures) so they can't be faked/replayed | M1 · Medium |
| ☐ | Lock down the open "start a payment" endpoint + verify the amount | M2 · Medium |
| ✅ | Stop the calendar tool from fetching internal/secret web addresses (SSRF) — **LIVE: lib/safeFetch.js blocks private/metadata IPs + bad schemes, verified live** | M3 · Medium |
| ☐ | Make the background-job password required (not optional) | M4 · Medium |
| ✅ | Enforce "blocked client can't book" on the server, not just the screen — **LIVE in Supabase (2026-06-24): `book_public` now rejects a blocked client (matched by stored id/phone/email) with `client_blocked`. SQL recorded in `db/hardening-2026-06-24.sql`** | M5 · Medium |
| ☐ | Add length limits to typed text fields | M6 · Medium |
| ☐ | Add rate limiting so nobody can run up your text/email bill | M7 · Medium |
| ☐ | Remove the hardcoded staff password from the app | M8 · Medium |
| ☐ | Accessibility: label icon buttons, bigger tap targets | M9 · Medium |
| ☐ | Show an error when a background load fails (no more silent blanks) | M10 · Medium |
| ☐ | Trim client names/notes out of the calendar feed; make its key resettable | L1 · Low |
| ✅ | Delete the unused `sync-status` endpoint (also frees a slot) — **LIVE (b545eb5)** | L2 · Low |
| 🔶 | Strengthen HTTPS header + add a content-security policy — **HSTS includeSubDomains LIVE; full CSP still deferred (risky with the app's heavy inline styles)** | L3 · Low |
| ☐ | Trim build info from the `version` endpoint | L4 · Low |
| ✅ | Add upper limits to deposit/tip entry boxes — **LIVE (981dd70)** | L5 · Low |

---

## 🔵 SaaS readiness — the [SAAS] list (only matters when selling to other shops; later)

### Done & live: 0 / 9 → **0%**  ░░░░░░░░░░

| Status | Fix (plain English) | ID · Severity |
|---|---|---|
| ☐ | Prove + enforce the wall between shops (RLS on every table & action) | S1 · Critical (when 2nd shop) |
| ☐ | Make sure only a real owner can change team roles/access | S2 · High |
| ☐ | Build a way to actually charge other shops (subscriptions/billing) | S3 · High |
| ☐ | Make every background endpoint check the caller owns that shop | S4 · High |
| ☐ | Make the nightly jobs scale to thousands of shops (don't time out) | S5 · High |
| ☐ | Stop exposing each shop's full settings to the public | S6 · Medium |
| ☐ | Save only what changed (not the whole list) each time | S7 · Medium |
| ☐ | Enforce staff permissions on the server for untrusted staff | S8 · Medium |
| ☐ | Platform legal: customer data export, deletion, DPA, retention, per-shop policy | S9 · High |

---

_Source of detail: `LAUNCH-AUDIT-2026-06.md`. Last updated: 2026-06-23._
