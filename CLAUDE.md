# Vero — developer guide for Claude

Vero is a booking / client-management app for service businesses (barbershops, salons, spas, tattoo). Live at **gotvero.com**. Brand name in UI: "Vero". The repo/package is still named `avenue` for historical reasons — same app.

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

## Compliance — do not touch without explicit instruction

SMS consent / privacy / terms wording is under 10DLC carrier vetting. The phrase **"reminders from Sanctuary Barber Co"** must appear **exactly 4 times** in `App.jsx` (the SMS consent lines at ~4484, ~4808, ~4953, ~5589). Do not edit consent/privacy/terms copy as a side effect of other work. Verify the count before any deploy.

## Ship ritual (before deploy)

1. `npm run build` parses & bundles clean (exit 0).
2. `grep -c "reminders from Sanctuary Barber Co" src/App.jsx` → exactly **4**.
3. Sanity-check brackets / no obvious imbalance in edited regions.
4. Commit, push, `npx vercel --prod --force`. Native rebuild (`npm run build && npx cap sync` → Xcode ▶) only when testing inside the iOS app.
