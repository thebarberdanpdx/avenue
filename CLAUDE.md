# Vero — developer guide for Claude

Vero is a booking / client-management app for service businesses (barbershops, salons, spas, tattoo). Live at **gotvero.com**. Brand name in UI: "Vero". The repo/package is still named `avenue` for historical reasons — same app.

## Stack & hosting

- **React 19 + Vite 8** SPA. Single source file: **`src/App.jsx`** (~22k lines, ~249 top-level declarations — see "Architecture" below).
- **Supabase** — Postgres + auth (magic-link). Client in `src/supabaseClient.js` (publishable key, safe to commit). Server-side `api/` functions use the **service-role** key (Vercel env only) to bypass RLS.
- **Stripe** — live payments. Serverless endpoints in `api/`. Publishable key is inline in `App.jsx` (`STRIPE_PUBLISHABLE_KEY` ~701, `pk_live_…`) — public, fine to commit. Secret key lives only in Vercel env.
- **Vercel** — hosting + serverless `api/` functions + Cron (reminder sender). Deploy with `npx vercel --prod`.
- **Capacitor 8 (iOS)** — wraps the web app as a native app (`ios/`, `capacitor.config.json`). `IS_NATIVE` (~19) gates native-only behavior (push notifications, API base URL → `https://gotvero.com`).
- **Messaging** — Resend (email) + Vonage (SMS). Shared core in `lib/messaging.js`; reminders via Vercel Cron, event sends on demand (see "Serverless API" below).
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

Everything lives in `src/App.jsx` (~22k lines, ~249 top-level declarations). It is NOT split into modules — keep it that way unless explicitly asked. `App.backup.jsx` / `App.backup2.jsx` are old snapshots — ignore them. Line numbers below are approximate (the file shifts as it grows) — grep the symbol name to find the current line.

**Two top-level surfaces, chosen by URL/auth:**
- **Client-facing booking flow** — `ClientFlow` (~2593), the public storefront where customers book. `Storefront` (~2014), `ManageAppointment` (~5733), `ConfirmationScreen` (~5394). Public, no login (client email codes via `api/client-code.js`).
- **Owner/staff dashboard** — `ShopDashboard` (~8890). Staff sign in via magic link (`StaffLogin` ~1064). Tabs: calendar, clients, services, reports, settings, etc.

**Major dashboard areas (all in App.jsx):**
- `CalendarView` (~16639) — the day calendar; drag-to-create, appointment tiles. Owns `startCheckout`, check-in, status changes, and renders `AppointmentSheet`.
- `ClientList` (~20903) / `ClientProfile` (~21191) — the clients tab. ClientProfile is the per-client card (see below).
- `PulseView` (~5871) — owner home/dashboard ("pulse"), wrap-up flow after visits (prominent "Wrap up" card when cuts are waiting to log).
- Reports: `RevenueView` (~6954), `AppointmentsView` (~7322), `ClientsReportView` (~7485), `ServiceMixView` (~7730), `PerBarberView` (~8011), `GrowthView` (~6744), `ReportsView` (~20712), `ReportsHub` (~20156), `TaxReportView` (~20588).
- `SettingsView` (~14981) — huge settings surface; sub-editors for menu, hours, messages, payments, branding, booking rules, staff. `StaffMembersView` (~12342) is the "My Team" editor.
- `Checkout` (~17914) — the payment/checkout engine (tips, card on file, sale intent). `reopen`/`alreadyPaid` props let you re-charge an already-paid ticket. Backed by `api/stripe.js`. `RegisterView` (~18821) and `PaymentsView` (~18578) are the register / payments surfaces.
- `AppointmentSheet` (~19275) — appointment detail sheet (status, elapsed time, actions).
- `ApptRefundSheet` (~19195) — full/partial refund via `api/stripe.js`.
- **Calendar migration** — `CalendarSyncTool` (~12133) + `reconcileCalendarSync` (~12048) mirror a competitor's `.ics` feed into Vero (add/move/cancel, silently, no client notifications). Reads through `api/calendar-sync.js`. `MigrationImport` (~12271) wraps the spreadsheet + calendar import doors behind one toggle in Settings.

## Serverless API (`api/` — Vercel functions, Node)

- `stripe.js` — payments engine: `setup` / `sale_intent` / `charge` / `refund`. **Don't overwrite it.**
- `notify.js` — on-demand **event** messages (booking confirmation, cancel, reschedule, deposit receipt, waitlist, "we're ready"). App POSTs at the moment the event happens.
- `send-reminders.js` — **Vercel Cron** target (~every 15 min). Scans upcoming appts across all shops, sends due reminders. Idempotent via the `message_log` table (no double-fire).
- `lib/messaging.js` — shared messaging core used by both `notify.js` and `send-reminders.js` (Resend email + Vonage SMS, `{client}`/`{service}`/`{provider}`/`{business}`/`{date}`/`{time}` template fill). Top-level `lib/`, not under `api/`.
- `push.js` — Apple Push (APNs) to a shop's signed-in staff devices when a booking is created.
- `client-code.js` — one-time 6-digit email sign-in code for the booking page.
- `calendar-sync.js` — READ-ONLY `.ics` feed fetch+parse (server-side, dodges CORS). `POST { url } → { events:[…] }`. Never writes.
- `ical/[shop]/[file].js` — READ-ONLY iCal feed of a provider's upcoming appts (`GET /api/ical/{shop}/{providerId}.ics`) so staff can subscribe in Apple/Google Calendar.

Server functions read `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, APNs/Vonage creds from Vercel env — never commit secrets.

## Key data shapes (client-held state, persisted to Supabase)

- **client** (`clients[]`): `{ id, name, phone, email, photo, provider, visits, notes (private), timeline[] ({id,text,date}), gallery[] ({id,photo,note,date}), family[] (each with own customDurations/gallery/timeline), customDurations{serviceId:min}, customPrices{serviceId:dollars}, blocked, blockReason, cadenceDays }`
- **appt** (`appts[]`): `{ id, clientId, familyMemberId, serviceId, providerId, title, bookedFor (ISO), start/end (min-from-midnight), status, price (locked at booking), note (client's booking note), hasNote, serviceStartedAt/serviceEndedAt (check-in/out timestamps → elapsed), paid ({total,totalLabel,tip,paymentIntentId,…}), lineItems[] }`
- **service** (`services[]`): `{ id, name, category, price, duration, color, staff{providerId:{duration,price,cutPrice,cutDur}}, cutTypes[], booking{…}, timeRules[] }`
- **provider** (`providers[]`): staff member `{ id, name, color, photo, hours, comp, permissions, … }`

## Pricing & duration resolvers (~993–1041) — use these, don't reinvent

- `getDuration(client, service, providerId)` (~993) — cascade: **per-client `customDurations`** → per-staff default → service default.
- `getPrice(service, providerId)` (~1000) — cascade: per-staff price → service default. **Note:** does NOT take `client`, so it does not apply `customPrices`. The public booking flow applies the per-client price directly (`ClientFlow`). If you need client-aware price staff-side, thread the client in there rather than silently changing `getPrice`'s signature (many call sites).
- `cutStylePrice` (~1008) / `cutStyleDuration` (~1015) — when a client picks a specific cut style.
- `priceWithTimeRules(service, providerId, dateObj, startMin)` (~1023) — time-of-day pricing rules.
- `lockedApptPrice(appt, service)` (~1041) — the price frozen onto an appt at booking; falls back to `getPrice`.

Per-client overrides are edited on the client card (`ClientProfile`). `customDurations` + `customPrices` are written together there.

## Theming

Themeable via CSS variables — `THEMES` (~554), `buildThemeCSS` (~619), `AppearancePicker`. Components reference vars: `--bg --panel --panel2 --line --border --border2 --text --text2 --sub --faint --gold --on-gold`. `--gold` is the accent (its actual color depends on the active theme). Fonts: `'Fraunces'` serif for display/headings, `'Jost'`/`'Inter'` sans for body (`FONT_DISPLAY`, `FONT_BODY`). Prefer CSS vars over hardcoded colors so all themes keep working.

## Reusable building blocks

`Sheet` (bottom/center sheet), `Portal`, `Avatar`, `PhoneLink`/`EmailLink` (tappable contact links), `TimeScrollPicker`, `DurPick`, `StaffPhotoPicker`/`PhotoPicker`, `Toggle`/`Switch`, `Stepper`, `Segmented`, `fmtTime`/`fmtDur`/`relativeDate`/`niceDate` helpers, `imgUrl` (Unsplash id → URL, passes through data:/http).

## Conventions

- Single file — add components at top level in `App.jsx`; don't create new modules unless asked.
- State lives high (in `App`/`ShopDashboard`) and is threaded down as props (`clients/setClients`, `appts/setAppts`, etc.). Persistence to Supabase happens off these setters.
- Use existing resolvers/components; don't duplicate the booking or checkout engines.
- **Don't overwrite `api/stripe.js`** — it handles `setup`/`sale_intent`/`charge`/`refund`.
- Inline styles with CSS vars are the norm (there's no CSS-in-JS lib / Tailwind).

## Compliance — do not touch without explicit instruction

SMS consent / privacy / terms wording is under 10DLC carrier vetting. The phrase **"reminders from Sanctuary Barber Co"** must appear **exactly 4 times** in `App.jsx` (the SMS consent lines at ~4630, ~4954, ~5099, ~5772). Do not edit consent/privacy/terms copy as a side effect of other work. Verify the count before any deploy.

Note: a shop-neutral copy pass replaced "barber" → "staff member"/"staff" across the UI, but this consent phrase is a fixed legal string — leave it exactly as-is. Several internal symbols still carry the old name (`PerBarberView`, `onOpenBarbers`); don't rename them as a side effect.

## `sanctuary-site/` — separate marketing site (not the app)

A standalone marketing/announcements site for Sanctuary Barber Co in the "Studio" theme — **plain HTML/CSS/vanilla JS, no build step**, unrelated to the React app. `index.html` (site) + `admin.html`/`admin.js` (announcements editor) + `data.js` (store, currently localStorage; can be pointed at Supabase). Run with `python3 -m http.server` from that folder. Don't pull these files into the `App.jsx` monolith or apply the app's build/deploy ritual to them.

## Ship ritual (before deploy)

1. `npm run build` parses & bundles clean (exit 0).
2. `grep -c "reminders from Sanctuary Barber Co" src/App.jsx` → exactly **4**.
3. Sanity-check brackets / no obvious imbalance in edited regions.
4. Commit, push, `npx vercel --prod --force`. Native rebuild (`npm run build && npx cap sync` → Xcode ▶) only when testing inside the iOS app.
