# Vero — developer guide for Claude

Vero is a booking / client-management app for service businesses (barbershops, salons, spas, tattoo). Live at **gotvero.com**. Brand name in UI: "Vero". The repo/package is still named `avenue` for historical reasons — same app.

## ⭐ WORKING STANDARD — READ THIS FIRST, EVERY SESSION (non-negotiable)

> **Dan's standing directive — treat it as prepended to EVERY message he sends (2026-07-08, verbatim):**
> "Do this like a senior engineer: flag the risks first, design for failure, verify it live before saying it's done, and tell me what I forgot to ask about. Don't over-promise."
> He should never have to repeat this. If a reply doesn't flag risks up front, state what was/wasn't verified, and name what he didn't ask about, it doesn't meet the bar.

> **Dan's standing directive #2 (2026-07-11, verbatim): "Always find the root of the issue. I never want patches."**
> Do NOT ship a plausible-looking fix for a symptom you have not root-caused. First reproduce and prove the actual cause (read the real data/state, trace the full path), THEN fix the cause once. A day was burned on 2026-07-11 shipping patch after patch for a menu-reorder bug that was never root-caused (the real cause: services carried `undefined` order values and a stale native build kept saving them back over the fix). If you cannot yet prove the root cause, say so and keep digging — never guess-and-ship. A patch that "might fix it" is worse than honestly saying "I haven't found the cause yet."

> **Dan's standing directive #3 (2026-07-15, after repeated stale-status failures): NEVER report status — or ask Dan for anything — without checking PROD first.**
> Sessions kept telling him things that were flat wrong — "the migration isn't done," "SMS is off" — read off the markdown docs or inferred from code, and asked him for things he'd already done (his client import; SMS wiring). That destroys trust fast. Before you state what's done / what's left / a percentage / whether X is live, OR ask him to provide or do anything: run **`npm run state`** (prints live prod truth — clients, imported batches, SMS last-send, reminder config) and answer from THAT. PHASES.md, the audit docs, and even this file are NOTES that go stale — they are NOT the source of truth. If you can't verify, say "unverified" — never present an inference as a fact. (Verified 2026-07-15: migration DONE — 2,973 clients; SMS LIVE.)

Dan is the owner and is NOT an engineer. He is trusting you to be the senior SaaS engineer he can't be — to plug in the things he doesn't know to ask for. His shop runs on this app. He has been burned repeatedly by a **reactive** style (fixing only the exact thing reported, screen by screen, while foundational gaps — reliability, offline, data-loss edges — went unflagged until a crisis). **Do not work reactively. Work like a senior engineer who owns the outcome.** On EVERY task:

1. **Surface the decision before you build.** Before implementing what he asked, tell him — in plain English, briefly — the foundational choices and risks riding underneath it: reliability, data safety, security, money/payments, and what happens at scale. Give him the choice; don't silently pick a default he doesn't know he's choosing.
2. **Think in failure modes, always.** For anything you touch, ask out loud: What happens when the network/DB is down? When data is missing or half-loaded? When two people do this at once? When the app is backgrounded mid-action? When the input is malformed? Design for those, or flag them.
3. **Never show fake/seed/demo data as if it were real.** (A real bug this caused: the booking page fell back to the hardcoded `DEFAULT_SERVICES` demo menu during an outage — a client could book off a menu that isn't his.) On any load failure, show an honest "can't load right now" state, never placeholder data masquerading as real.
4. **Verify end-to-end. Never claim unverified success.** Reproduce, then confirm the fix in the deployed bundle / real data. If you can't verify (e.g. during an outage), say so and don't ship blind. Owning "I haven't verified this" beats a false "done."
5. **Protect data above all.** Backups, no accidental deletes, no writes on a failed/partial load, atomic server-side guards for anything money- or slot-related. When in doubt, refuse to write rather than risk corruption.
6. **Proactively audit.** Periodically, and whenever asked "what would a senior developer flag here that I haven't asked about?", give the honest ranked board of foundational gaps — reliability, monitoring/alerts, tests, schema-in-git, security, performance — not just the current ticket. See `RELIABILITY-PLAN.md` for the standing audit + the offline-first plan (the current top priority: the app must work through outages/bad wifi).
7. **Be honest, not agreeable.** Don't over-promise ("completely reliable", "never again", "fixed" when unverified). State real tradeoffs, costs, and what could go wrong. Under-promise and verify.

The current #1 foundational priority is **making the app offline-first** so a backend/network outage never stops the shop (see `RELIABILITY-PLAN.md` §2, Route A recommended). Treat that as the standing goal behind day-to-day work.

## Stack & hosting

- **React 19 + Vite 8** SPA. Single source file: **`src/App.jsx`** (~20k lines — see "Working in the monolith" below).
- **Supabase** — Postgres + auth (magic-link). Client in `src/supabaseClient.js` (publishable key, safe to commit).
- **Stripe** — live payments. Serverless endpoints in `api/`. Publishable key is inline in `App.jsx` (`STRIPE_PUBLISHABLE_KEY`, `pk_live_…`) — public, fine to commit. Secret key lives only in Vercel env.
- **Vercel** — hosting + serverless `api/` functions. Deploy with `npx vercel --prod`.
- **Capacitor 8 (iOS)** — wraps the web app as a native app (`ios/`, `capacitor.config.json`). `IS_NATIVE` gates native-only behavior (push notifications, API base URL → `https://gotvero.com`).
- **lucide-react** — icon set (imported throughout as `<Camera/>`, `<Calendar/>`, etc.).

## Commands

```bash
npm run dev        # Vite dev server (web)
npm run build      # production build — RUN THIS TO VERIFY A CHANGE COMPILES
npm run lint       # eslint
npx vercel --prod --force   # deploy web
npm run build && npx cap sync   # then Xcode ▶ to test inside the native iOS app
```

There is no web test runner wired into `package.json`; `gesture.test.js` is a standalone file. Verify changes with `npm run build` (esbuild parse + bundle) — a clean exit is the basic gate.

## Architecture: one file, many components

Everything lives in `src/App.jsx`. ~233 top-level declarations. It is NOT split into modules — keep it that way unless explicitly asked. `App.backup.jsx` / `App.backup2.jsx` are old snapshots — ignore them.

**Two top-level surfaces, chosen by URL/auth:**
- **Client-facing booking flow** — `ClientFlow` (~2492), the public storefront where customers book. `Storefront`, `Landing`, `ManageAppointment`, `ConfirmationScreen`. Public, no login.
- **Owner/staff dashboard** — `ShopDashboard` (~8587). Staff sign in via magic link (`StaffLogin` ~1015). Tabs: calendar, clients, services, reports, settings, etc.

**Major dashboard areas (all in App.jsx):**
- `CalendarView` (~15418) — the day calendar; drag-to-create, appointment tiles. Owns `startCheckout`, check-in, status changes, and renders `AppointmentSheet`.
- `ClientList` (~19456) / `ClientProfile` (~19658) — the clients tab. ClientProfile is the per-client card (see below).
- `PulseView` (~5688) — owner home/dashboard ("pulse"), wrap-up flow after visits.
- Reports: `RevenueView`, `AppointmentsView`, `ServiceMixView`, `PerBarberView`, `ReportsHub`, `TaxReportView`, `ClientsReportView`.
- `SettingsView` (~13749) — huge settings surface; sub-editors for menu, hours, messages, payments, branding, booking rules, staff, etc.
- `Checkout` (~16672) — the payment/checkout engine (tips, card on file, sale intent). `reopen`/`alreadyPaid` props let you re-charge an already-paid ticket. Backed by `api/stripe.js`.
- `AppointmentSheet` (~17967) — appointment detail sheet (status, elapsed time, actions).
- `ApptRefundSheet` (~17887) — full/partial refund via `api/stripe.js`.

## Key data shapes (client-held state, persisted to Supabase)

- **client** (`clients[]`): `{ id, name, phone, email, photo, provider, visits, notes (private), timeline[] ({id,text,date}), gallery[] ({id,photo,note,date}), family[] (each with own customDurations/gallery/timeline), customDurations{serviceId:min}, customPrices{serviceId:dollars}, blocked, blockReason, cadenceDays }`
- **appt** (`appts[]`): `{ id, clientId, familyMemberId, serviceId, providerId, title, bookedFor (ISO), start/end (min-from-midnight), status, price (locked at booking), note (client's booking note), hasNote, serviceStartedAt/serviceEndedAt (check-in/out timestamps → elapsed), paid ({total,totalLabel,tip,paymentIntentId,…}), lineItems[] }`
- **service** (`services[]`): `{ id, name, category, price, duration, color, staff{providerId:{duration,price,cutPrice,cutDur}}, cutTypes[], booking{…}, timeRules[] }`
- **provider** (`providers[]`): staff member `{ id, name, color, photo, hours, comp, permissions, … }`

## Pricing & duration resolvers (~957–1007) — use these, don't reinvent

- `getDuration(client, service, providerId)` — cascade: **per-client `customDurations`** → per-staff default → service default.
- `getPrice(service, providerId)` — cascade: per-staff price → service default. **Note:** does NOT take `client`, so it does not apply `customPrices`. The public booking flow applies the per-client price directly (`ClientFlow` ~2652). If you need client-aware price staff-side, thread the client in there rather than silently changing `getPrice`'s signature (many call sites).
- `cutStylePrice` / `cutStyleDuration` — when a client picks a specific cut style.
- `priceWithTimeRules(service, providerId, dateObj, startMin)` — time-of-day pricing rules.
- `lockedApptPrice(appt, service)` — the price frozen onto an appt at booking; falls back to `getPrice`.

Per-client overrides are edited on the client card (`ClientProfile`). `customDurations` + `customPrices` are written together there.

## Theming

Themeable via CSS variables — `THEMES` (~536), `buildThemeCSS` (~601), `AppearancePicker`. Components reference vars: `--bg --panel --panel2 --line --border --border2 --text --text2 --sub --faint --gold --on-gold`. `--gold` is the accent (its actual color depends on the active theme). Fonts: `'Fraunces'` serif for display/headings, `'Jost'`/`'Inter'` sans for body (`FONT_DISPLAY`, `FONT_BODY`). Prefer CSS vars over hardcoded colors so all themes keep working.

## Reusable building blocks

`Sheet` (bottom/center sheet), `Portal`, `Avatar`, `PhoneLink`/`EmailLink` (tappable contact links), `TimeScrollPicker`, `DurPick`, `StaffPhotoPicker`/`PhotoPicker`, `Toggle`/`Switch`, `Stepper`, `Segmented`, `fmtTime`/`fmtDur`/`relativeDate`/`niceDate` helpers, `imgUrl` (Unsplash id → URL, passes through data:/http).

## Conventions

- Single file — add components at top level in `App.jsx`; don't create new modules unless asked.
- State lives high (in `App`/`ShopDashboard`) and is threaded down as props (`clients/setClients`, `appts/setAppts`, etc.). Persistence to Supabase happens off these setters.
- Use existing resolvers/components; don't duplicate the booking or checkout engines.
- **Don't overwrite `api/stripe.js`** — it handles `setup`/`sale_intent`/`charge`/`refund`.
- Inline styles with CSS vars are the norm (there's no CSS-in-JS lib / Tailwind).

## ⛔ Protected invariant — staff (provider) email/phone must never be lost

This regressed and infuriated the owner 5+ times. Two guards in `App.jsx` keep staff email/phone/PIN from being blanked — **NEVER remove or weaken them:**
1. **Load gate:** the sanitized `get_public_providers` feed only applies when `!hasStoredSession()` — so a signed-in owner's `providers` come ONLY from the full `from('providers')` load, never the email/phone-stripped feed.
2. **Save backstop:** `syncList` re-reads server providers and restores any `email`/`phone`/`pin` that's `undefined` locally before upserting (an explicit `""` clear is respected) — a save can never blank server-held contact info.

`syncList('providers', …)` must remain the SOLE writer of the providers table. After ANY change near provider load/save or the staff editor, test: enter staff email+phone → Save → hard-reload → it persists. See memory `provider-email-phone-dataloss`.

**Bottom-tab navigation:** tapping any bottom tab must ALWAYS land on that tab's ROOT, even from deep in a sub-screen. `goTab()` bumps `tabNonce`; tab content that owns internal sub-state (e.g. `SettingsView`'s open card, `MessagesView`) is keyed by `tabNonce` so a re-tap remounts it to root. Don't remove the `tabNonce` bump or the keys.

**Regression lock:** `npm run ship-check` FAILS the deploy if any guarded fix is removed from `src/App.jsx` (the `GUARDS` list in `scripts/ship-check.mjs`). When you fix a painful regression you never want back, add a stable code marker for it to that list — that's how shipped fixes stay shipped.

## Compliance — do not touch without explicit instruction

SMS consent / privacy / terms wording is under 10DLC carrier vetting. The phrase **"reminders from Sanctuary Barber Co"** must appear **exactly 4 times** in `App.jsx` (the SMS consent lines at ~4484, ~4808, ~4953, ~5589). Do not edit consent/privacy/terms copy as a side effect of other work. Verify the count before any deploy.

## Ship ritual (before deploy)

1. `npm run build` parses & bundles clean (exit 0).
2. `grep -c "reminders from Sanctuary Barber Co" src/App.jsx` → exactly **4**.
3. Sanity-check brackets / no obvious imbalance in edited regions.
4. Commit, push, `npx vercel --prod --force`. Native rebuild (`npm run build && npx cap sync` → Xcode ▶) only when testing inside the iOS app.
