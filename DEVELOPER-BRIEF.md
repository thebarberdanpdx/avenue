# Vero — Developer Brief

_Hand this to a new engineer on day one. It explains what the app is, how it's built, where the money and risk live, and exactly what to look for. Written to be honest, not to sell._

---

## 0. Read this first (the 30-second truth)
- **Vero is a LIVE production app running a real barbershop's bookings and payments** (gotvero.com, shop "Sanctuary Barber Co", ~2,973 real clients). Breakage = the shop can't book or get paid. Treat every change to money, sync, or auth as high-stakes.
- The **entire web app is ONE file: `src/App.jsx` — ~28,000 lines, ~210 components.** This is deliberate (owner's call). Don't propose splitting it as your first move.
- There are **no automated tests around the money/booking paths.** Verification is manual + a pre-flight script (`npm run ship-check`) that guards against known regressions.
- **The database schema, row-level-security (RLS) policies, and RPC functions are NOT in this repo** — they live only in Supabase. Get dashboard access before you trust anything about server-side data rules.
- There is a **verified, open issue list** in `LAUNCH-READINESS-AUDIT-2026-07-15.md`. Start there.

---

## 1. What the app is
A booking + client-management SaaS for service businesses (barbershops, salons, spas, tattoo). Think "Mangomint / Square Appointments for a small shop." Brand name in the UI is **Vero**; the repo/package is still named `avenue` for historical reasons — same app.

Two completely separate surfaces, chosen by URL + auth:
1. **Client-facing booking flow** (public, no login) — a customer picks a service, staff member, and time, books, and can manage/cancel their appointment. Component: `ClientFlow`.
2. **Owner/staff dashboard** (magic-link login) — calendar, clients, checkout/POS, reports, settings, messaging. Component: `ShopDashboard`.

It's currently single-tenant in practice (one live shop) but the data model is multi-shop: everything is keyed by `shop_id`, and there's a multi-location "Master" admin surface.

---

## 2. Stack & hosting (exact)
- **Frontend:** React 19 + Vite 8, single-page app. One source file: `src/App.jsx` (28k lines, ~210 top-level components/functions). Inline styles + CSS variables for theming (no Tailwind, no CSS-in-JS lib). Icons: `lucide-react`.
- **Backend data + auth:** **Supabase** (hosted Postgres + magic-link auth). Client in `src/supabaseClient.js` (publishable key, safe to commit).
- **Payments:** **Stripe** (live). Serverless endpoints in `api/` (11 files, Vercel's limit is 12 — watch that ceiling). Publishable key is inline in `App.jsx`; the secret key is only in Vercel env.
- **Hosting:** **Vercel** — static frontend + serverless `api/` functions. **Deploy = merge to `main`**; Vercel builds and promotes gotvero.com automatically (the Vercel CLI token in tooling is not used).
- **Native iOS:** **Capacitor 8** wraps the web app. Today the native app is a thin shell that loads the live `gotvero.com` (so web deploys reach the phone instantly). `IS_NATIVE` gates native-only behavior (push, API base URL). See `NATIVE-OFFLINE-ROLLBACK-HANDOFF.md` before touching anything native — a prior offline attempt crashed the app and was rolled back.
- **Helpers:** `lib/` (6 files) — `shop-auth.js` (server-side membership checks), `messaging.js` (email/SMS send + channel resolution), `paginate.js` (PostgREST 1000-row pagination), `ratelimit.js`, `observe.js` (Sentry).

---

## 3. Architecture: one file, state-down
- Everything is top-level components in `src/App.jsx`. State lives high (in `App` / `ShopDashboard`) and is threaded down as props (`clients/setClients`, `appts/setAppts`, etc.). Persistence to Supabase happens off those setters.
- Key components to orient by (line numbers drift — grep the name):
  - `ClientFlow` — public booking. `Checkout` — the POS/payment engine. `CalendarView` — the day calendar. `ClientList` / `ClientProfile` — the clients tab. `SettingsView` — a huge settings surface (~45 sub-editors). `PulseView` — owner home. Reports: `RevenueView`, `AppointmentsView`, etc. `ImportDataEditor` — the Mangomint importer.
- **Theming:** CSS variables (`--bg --panel --text --gold …`) driven by a `THEMES` array + `buildThemeCSS`. A design migration to a new "Onyx" look is ~2 components deep and unfinished — most screens are still the older serif theme (cosmetic debt, not broken).

---

## 4. Key data shapes (client-held state, persisted to Supabase as JSON `data` columns)
- **client:** `{ id, name, phone, email, photo, provider, visits, notes, timeline[], gallery[], family[], customDurations{}, customPrices{}, blocked, cadenceDays, smsConsent }`
- **appt:** `{ id, clientId, serviceId, providerId, bookedFor(ISO), start/end(min-from-midnight), status, price(locked at booking), paid{total,tip,paymentIntentId}, lineItems[] }`
- **service:** `{ id, name, category, price, duration, staff{providerId:{…}}, booking{}, timeRules[] }`
- **provider (staff):** `{ id, name, color, photo, hours, permissions, email, phone, pin }`
- Tables are `clients`, `appointments`, `services`, `providers`, `waitlist`, `reviews`, `shops` (settings live here), `message_log` (send idempotency), `memberships` (who can access a shop). Each row is `{ id, shop_id, data(jsonb) }`.

**Pricing/duration resolvers (~line 957-1010) — use these, don't reinvent:** `getDuration`, `getPrice`, `cutStylePrice`, `priceWithTimeRules`, `lockedApptPrice`. Note the per-client custom-price cascade is applied in the public flow but NOT in `getPrice` itself — a known inconsistency (staff-side calendar booking currently ignores custom prices).

---

## 5. Sync model (this is subtle — study it before touching it)
- The calendar is **server-authoritative**: signed-in staff pull the full client+appointment set from `api/sync-pull` in one shot (`mirrorFromServer`), and it REPLACES local state (deletion-aware). Writes go through `api/sync-pull` in `mode:"save"` (service-role, bypasses RLS after an auth check).
- There's an **offline read-cache** (`hydrateFromCache`) so a backend outage shows the last-synced calendar instead of a blank screen.
- The real outage mode that shaped this code is a **HANGING backend** (requests never resolve or reject). The defense is **timeouts/watchdogs** everywhere (`withRpcTimeout`, `mirrorWatchdog`, `loadWatchdog`). Don't remove them.
- **What to look for:** race conditions between a local edit and a server mirror; the guards that stop an empty/partial load from overwriting real data.

---

## 6. The money path (Stripe) — read carefully, this is where mistakes cost real money
- `api/stripe.js` handles `setup` / `sale_intent` / `charge` / `refund` / Tap-to-Pay terminal actions. **Do not overwrite this file.**
- In-person card entry: client mints a `sale_intent` (PaymentIntent) → confirms it client-side with Stripe Elements. Raw card numbers never touch our code/server.
- **Idempotency is the danger zone.** A retried charge must never double-charge. `charge`/`refund` carry an idempotency key; `sale_intent` is a two-step create-then-confirm, so it's guarded on the CLIENT by caching + reusing one PaymentIntent per sale (see the `sale-intent-idempotent` guard). **When you touch checkout, think: what happens if the network drops between charge and response?**
- **Known open money issues (in the audit):** out-of-band refunds/chargebacks patch the appointment but not the reporting ledger (books can diverge); refunds record the requested amount, not Stripe's returned amount; the two booking-**deposit** paths still lack the double-charge guard. Verify the Stripe **webhook signature** is checked — flagged as unaudited.

---

## 7. Messaging & reminders
- **Reminders** are a Vercel cron: `api/send-reminders.js` (runs ~every 5 min, scans upcoming appts, sends what's due). **Event messages** (booking confirmation, cancellation, review request, rebook nudge) go through `api/notify.js` on demand.
- Channels resolve in `lib/messaging.js`. **SMS is gated by the `SMS_LIVE` env var** and sends via Vonage (10DLC-registered). Email via Resend. `message_log` is the idempotency ledger — it also proves what actually sent.
- **COMPLIANCE — do not touch without instruction:** SMS consent/privacy/terms wording is under 10DLC carrier vetting. A specific consent phrase must appear an exact number of times in `App.jsx` (ship-check enforces the count). STOP/opt-out handling is a legal requirement — verify it end-to-end (flagged as unaudited).

---

## 8. Auth & access control
- Staff sign in via Supabase magic link. `lib/shop-auth.js` `canAccessShop` decides membership server-side (membership row OR provider-email OR business-email). Only members can open the dashboard (an `access-lockdown` gate shows "Not authorized" to non-members). RLS on the data tables is the real protection — **verified live that a signed-in non-member reads zero client rows.**
- **Invariant:** the login/auth gate must **fail OPEN** — a failed/slow session check can never lock the owner out. And staff email/phone must never be blanked on save (two guards enforce this). Don't weaken either.

---

## 9. How to run, verify, deploy
```bash
npm run dev          # local dev server
npm run build        # production build — the basic "does it compile" gate
npm run lint         # eslint
npm run ship-check   # pre-flight: build + unit tests + 49 regression guards + consent count + no-undef
npm run state        # prints LIVE prod truth (client count, migration status, SMS live?) — run before quoting status
npm run build && npx cap sync   # then Xcode ▶ to test the native iOS app
```
- **Deploy:** commit → PR → merge to `main` → Vercel builds and promotes → confirm `https://gotvero.com/api/version` reports your commit SHA.
- There is a **live-testing rig** in `tests/live/` (Playwright driving real Chromium against gotvero.com) for end-to-end checks.

---

## 10. ⚠️ Invariants you must NOT break (enforced by `npm run ship-check`)
`scripts/ship-check.mjs` has a `GUARDS` list (49 entries) of shipped fixes that already regressed once and cost the owner trust. If your change removes one of these code markers, ship-check FAILS the deploy. Examples: staff email/phone never blanked, login fails open, no fake demo menu on outage, checkout can't double-charge, server-authoritative sync. **When you land a fix for a painful bug, add a guard for it.**

---

## 11. Where the risk / tech-debt is (what to look for — honest)
1. **No automated test coverage on money/booking/refund.** Highest-value thing a new dev could add.
2. **Schema/RLS/RPC not in version control** — only in Supabase. Commit a `supabase db dump` so the server logic is recoverable and reviewable.
3. **28k-line single file** — intentional, but raises the odds of subtle bugs and slows the bundle.
4. **No staging environment** — merges go straight to production.
5. **Concurrency / atomic slot-guard** — booking conflict checks are client-side; whether two devices can double-book the same slot server-side is unverified.
6. **Photos stored as base64 in DB rows** — bloats reads and the offline cache; belongs in object storage.
7. **The full open-issue list with file:line evidence is in `LAUNCH-READINESS-AUDIT-2026-07-15.md`.**

---

## 12. What's verified vs still unproven (so you don't take claims on faith)
- **Verified (live, this repo's owner-agent):** the migration import is done (~2,973 clients); SMS is live and sending; RLS blocks non-members from reading client data; the double-charge and fake-"sent"-nudge fixes are shipped.
- **NOT verified / needs a human on real hardware:** a real live Stripe charge + reconciliation; native iOS behavior on a device; push-notification delivery; whether prod error alerts/backups actually fire; performance at ~3,000 clients; the Stripe webhook's signature check; STOP/opt-out SMS handling.

---

## 13. What I'd want a new hire to do first
1. Get Supabase + Vercel + Stripe dashboard access (the schema/RLS/env you can't see in the repo).
2. Read `CLAUDE.md` (the owner's working standard + protected invariants) and `LAUNCH-READINESS-AUDIT-2026-07-15.md` (the open issues).
3. Run `npm run ship-check` and `npm run state` to see the guards and the live truth.
4. Add a test harness around checkout/refund before changing anything in the money path.
5. Commit the DB schema to git.
