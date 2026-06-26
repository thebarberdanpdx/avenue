# 👋 START HERE — Session Handoff (for Dan + a fresh Claude session)

_Last updated: 2026-06-25 (Vonage re-review RESUBMITTED — consent checkbox deployed + form verified & sent; email deliverability FIXED; iOS still live on TestFlight)_

**New session? Read this file + `HARDENING-SHOP.md`, then continue Track A. Dan should not have to re-explain anything.**

> 👉 **The clean, plain-English list of everything STILL TO DO is [`TODO.md`](TODO.md)** — start there for "what's left."

> 🔄 **This handoff is a LIVING doc, updated by EVERY session — Dan runs more than one Claude session at a time.** Each session must log what it shipped here so nothing drifts out of date and Dan never re-explains. Two active workstreams as of 2026-06-24: **(1) launch / security + iOS** (the "🚀 LATEST SESSION" block just below) and **(2) the UI "Mangomint polish" pass** (the "🎨 UI polish pass" section further down — client booking flow done & live; owner dashboard is next). Finished work in any session? Add it here before you stop.

---

## ⭐ LATEST SESSION — 2026-06-25 (later): Customer Reviews feature — ✅ LIVE + reminder timer ON
Full v1 of a customer-review feature (Dan's ask, designed w/ subagents for usefulness + marketability). **DEPLOYED & verified live** (commit `23845d5`): reviews RPCs respond (`get_published_reviews`→`[]`, `review_lookup_by_token`→`{ok:false}`), SQL run in Supabase, frontend shipped. Reminder timer also turned ON (see below). **CRON_SECRET was ROTATED** this session (old value was unreadable/"Sensitive" in Vercel) — new value lives in Vercel env + a GitHub repo secret named `CRON_SECRET`; verified: `/api/send-reminders?key=<new>`→200, wrong key→401.

**What it does:** after a paid visit, Vero asks the client for a review (email now, SMS once `SMS_LIVE`); the client rates + comments on a public page (`/review?t=TOKEN`); the review lands **pending** in the owner's dashboard; the owner publishes the ones they want; published/featured reviews show as a **star rating + testimonials on the booking landing** (step 0) — the conversion win. Every reviewer is offered the SAME optional Google link (no star-gating — **deliberately compliant** with Google policy + the new FTC rule; building the gating version is illegal/bannable, so we didn't).

**Owner controls (Settings → Online Booking → "Customer Reviews"):** master on/off · **ask after the Nth visit** (default 2) · email/text/both · only-ask-once · Google review link · show-on-booking-page · plus the moderation list (Publish / Unpublish / Feature / Hide) right in the same card. Config persists immediately (like Discounts).

**Where it lives in code (all `src/App.jsx` unless noted):** `DEFAULT_BUSINESS.reviews` (defaults) · `DEFAULT_REVIEW_BODY` + `fireReviewRequest()` (sender, mirrors `fireApptNotify`) · trigger in `finishCheckout` (gated by visit count) · `reviews` state + session-keyed load + `syncList('reviews')` save (mirrors waitlist) · `ReviewByToken` public page + route `reviewtoken` (`/review?t=`) · `ReviewsManager` settings card (threaded `reviews/setReviews` through ShopDashboard→SettingsView) · storefront social proof in ClientFlow step 0 (`pubReviews` via `get_published_reviews`) · `{review link}` tag in `lib/messaging.js`.

**✅ ACTIVATED — `db/reviews-2026-06-25.sql` run in Supabase** (reviews table w/ RLS cloned from waitlist + 3 RPCs, all verified live). **Still to do (live test, needs Dan signed in):** Settings → Online Booking → "Customer Reviews" → turn on + set the after-visit number + (optional) paste a Google review link; then complete a returning client's checkout → review email → submit on `/review?t=` → approve in the same card → see it on the booking landing. (Couldn't be Claude-tested end-to-end — needs an owner session + a real checkout.)

**Not yet (v2 backlog):** delayed send + reminder nudge (needs a cron — Vercel 2-cron limit), per-barber rating analytics, QR/in-shop link, public owner replies, realtime so new reviews appear without a refresh.

### ⏰ Reminder timer (send-reminders) — wired via GitHub Actions (needs 1 secret + push)
The `send-reminders` cron was built but unscheduled (Vercel Hobby = 2 daily crons only). Added `.github/workflows/send-reminders.yml` — pings `https://gotvero.com/api/send-reminders?key=${{ secrets.CRON_SECRET }}` **every 15 min** (mirrors the existing `calendar-sync.yml` pattern; endpoint is idempotent via message_log). Email reminders fire as soon as it's live; SMS reminders auto-start when `SMS_LIVE=true` (Vonage).
- **🐞 Found + fixed a regression:** `calendar-sync.yml` was pinging `api/calendar-run` with **no** `CRON_SECRET` → it's returned **401 since the 2026-06-23 cron lock** (verified live: wrong-key probe → 401). So the 24/7 calendar mirror silently degraded to once-daily (the Vercel cron, which Vercel auto-auths). Added `?key=${{ secrets.CRON_SECRET }}` to that workflow too.
- **✅ ACTIVATED:** GitHub `CRON_SECRET` repo secret added + pushed. Endpoint verified (`send-reminders?key=<new>`→200, `checked:22 sent:0`; `calendar-run?key=<new>`→200). The only thing not Claude-verifiable (no `gh` CLI here): that Dan's pasted GitHub secret is character-perfect — confirm by glancing at the repo's **Actions** tab for a green check on `send-reminders` / `calendar-sync` (red = re-enter the secret).
- **Pre-launch note:** reminders now fire for any upcoming appt with an email + enabled reminder. First live run sent 0 (demo data has no real emails), so no surprise sends. SMS reminders stay off until `SMS_LIVE=true`.

---

## 📧 EARLIER SESSION — 2026-06-25: email deliverability FIXED + Vonage re-review (consent checkbox HALF-DONE)

### Business email — `contact@sanctuarybarberco.com` (Microsoft 365 via GoDaddy; **DNS lives at StellarWP** `my.stellarwp.com`, domain registered at GoDaddy)
- **Problem:** every outbound email bounced as spam (550 5.7.350). Root cause: the SPF record only authorized GoDaddy (`secureserver.net`), not Microsoft 365.
- **FIXED — all 3 email "trust badges" now live & verified by dig:**
  - **SPF** → `v=spf1 include:secureserver.net include:spf.protection.outlook.com -all`
  - **DMARC** → TXT `_dmarc` = `v=DMARC1; p=none;`
  - **DKIM** → enabled in Microsoft Defender (`security.microsoft.com/dkimv2`) + `selector1._domainkey` / `selector2._domainkey` CNAMEs at StellarWP → status "Signing DKIM signatures."
- **What's left is TIME, not config.** Brand-new domain → Gmail/etc. still flag "very low reputation" for a day or a few. **Receiving works NOW** (so Vonage/anyone can email Dan). **For urgent SENDS in the meantime, use the Gmail `sanctuarybarberco@gmail.com`.** Re-test sending ~1–2 days out. Nothing more to configure.

### Vonage toll-free RE-REVIEW — ✅ RESUBMITTED 2026-06-25 (awaiting carrier re-review)
**Both requirements met and the form was re-submitted ("Update").** What was verified before sending (triple-checked w/ subagents + live tests):
- **EIN doc** uploaded to Google Drive, sharing set to **"Anyone with the link" — confirmed PUBLIC** (curl 200 + PDF). Link: `https://drive.google.com/file/d/11rF-AZFV7iPdLEBGp8shx6KYBbIaD7OT/view` (see [[vonage-ein-doc-link]]).
- **Opt-In Consent Link** on the form = `https://gotvero.com/book?optin=1&shop=avenue-phi` (NOT the privacy policy — that's what got bounced). Verified live: loads the real Sanctuary shop + the unchecked checkbox.
- **Form fields** all match the CP575 (name/address/EIN). Address entered as `2077 NE Town Center Dr. Suite 120` to match the letter. Help Confirmation Message added.
- **Additional Information** field explains the two domains + that **Vero (gotvero.com) is the new booking app launching once the number is approved**, and sanctuarybarberco.com is the company site. ⚠️ NOTE: Dan's live website still routes "Book Now" to **Mangomint** (his current system) — he switches the public site to Vero only AFTER the number is approved. The Vonage wording was crafted so the Mangomint site doesn't contradict the application.
- **Next:** wait for Vonage. On approval, `SMS_LIVE` flips on → confirmations/reminders send. STILL TO BUILD before/at SMS go-live: STOP/HELP opt-out handler (TCPA), and schedule the `send-reminders` cron.

(Original bounce wanted TWO things — kept for reference:)

**1. Official business document — ✅ READY, Dan just uploads it.** They want an official doc showing legal business name + BRN (e.g. CP575/EIN letter). Dan HAS the ideal one:
   - **`Ein info.pdf`** (in iCloud `~/Library/Mobile Documents/com~apple~CloudDocs/`) = **IRS CP575** showing **SANCTUARY BARBER CO**, **EIN 26-1451457**, Beaverton OR. ✅
   - Action: Dan uploads it to **Google Drive → "Anyone with the link" → replies to Vonage with the link**. BRN/Tax ID if asked = **26-1451457**.
   - ⚠️ **DO NOT use the copies in `~/Downloads/` (`e0389126…`, `f34a6409…`) — those show "IRVING SUBS AND CHEESE SHOP" (Dan's OLD business).** Same-named file exists in two places; the iCloud ones are the correct (Sanctuary) ones.
   - Backup doc if ever needed: `COE_6601678.pdf` (Oregon Certificate of Existence, BRN 6601678) — valid but the EIN letter is stronger.

**2. SMS consent CHECKBOX on the booking page — ✅ DONE & DEPLOYED (2026-06-25, commit `fb4fd00`).** Live on gotvero.com booking confirm step (step 7). Unchecked by default, optional (booking works either way), exact Vonage wording, links to sanctuarybarberco.com/privacy-policy. Records `smsConsent`+`smsConsentAt` on the new client. Uses "reminders **via SMS** from…" so the locked phrase count stays exactly 4. Reviewer deep link (jumps straight to the checkbox): **`https://gotvero.com/book?optin=1&shop=avenue-phi`**.
   - **What Dan must put in the Vonage form:** (a) **Opt-In Consent Link** = the reviewer deep link above (NOT the privacy policy — that's what they bounced); (b) **Additional Information** = the EIN Google Drive link ([[vonage-ein-doc-link]]); (c) everything else on the form already matches his CP575 (verified: DAN MICHAELS / SANCTUARY BARBER CO / 2077 NE Town Center Dr Suite 120, Beaverton OR 97006 / EIN 26-1451457).
   - Original build notes (kept for reference):
**Vonage requires consent **captured via a checkbox** (not only in Terms/Privacy), **NOT pre-checked**, and **optional** (booking must still work if unchecked). Exact wording to use:
   > ☐ By checking this box, I agree to receive **appointment reminders via SMS from Sanctuary Barber Co**. Message and data rates may apply. Message frequency varies. Text HELP for help or STOP to opt out. [privacy policy link]

   **Build notes — pick up here (all line #s as of this session):**
   - Add the checkbox on the booking **confirm step**, right after the phone field + existing consent `<p>` at **`src/App.jsx:5396–5399`** (inside `ClientFlow`). (Main new-booker path; other phone-consent spots at 4903 / 5253 / 6098 if you want it everywhere.)
   - Add state `const [smsConsent, setSmsConsent] = useState(false)` near `const [phone, setPhone]` (~**line 2902**). The `Check` icon **is already imported** (used 53×) — fine to use for the tick.
   - **OPTIONAL** = do NOT gate the Continue/Book button on `smsConsent`.
   - Persist it: store `smsConsent` (+ a timestamp) on the new client object built at **`src/App.jsx:3446`** (`const newClient = {…}`).
   - ⚠️ The wording above does NOT contain the locked phrase **"reminders from Sanctuary Barber Co"** (it says "reminders **via SMS** from…"), so the must-be-exactly-**4** count stays 4. Keep it 4. Run `npm run ship-check` before deploy.
   - Once BOTH are done, Vonage said they'll prioritize the re-review.

---

## 🚀 LATEST SESSION — 2026-06-24 (evening): the iOS app is LIVE on TestFlight

### Where we are
- **The native iOS app is real and on phones.** Dan **and** Heather both have **Vero** installed via **TestFlight**, running the live site. The entire pipeline is proven end-to-end: code → gotvero.com → Xcode archive → App Store Connect → TestFlight → on a phone.
- Web app still live at gotvero.com; shop-launch security hardening is now **~26%** (3 new locks added today).

### What we just finished (this session)
1. **iOS → TestFlight — DONE.** Archived + uploaded build **1.0 (1)**; Dan installed (internal/Owner); **Heather added as Admin** (internal) → instant install, "what Dan has." Accepted Apple's **updated Developer Program License Agreement** (it was silently blocking uploads — that's what made Xcode throw "create app record" errors). Set **`aps-environment` → `production`** for release builds (commit `9a7518e`).
2. **Security — 3 new locks (tracker → 26%):**
   - **Email enumeration closed** — `/api/client-code` returns a uniform `{ok,masked}` whether or not the email matches (commit `88365de`, verified live).
   - **Blocked client can't book (server-side)** — `book_public` RPC now rejects blocked clients (LIVE in Supabase).
   - **Login-code brute-force cap** — `verify_client_code` RPC + new `attempts` column (LIVE in Supabase).
   - Both DB changes are recorded in **`db/hardening-2026-06-24.sql`** (DB changes do NOT auto-apply from the repo) and committed (`838987d`).
   - ⚠️ **DEFERRED (logged in AUDIT-TRACKER H1):** `lookup_client_by_phone` / `lookup_client_by_email` hand a returning client's PII (name/email/family) to ANY anonymous caller — they power booking autofill, and the phone sign-in isn't server-verified. Proper fix = a code-gated returning-client flow (ties into SMS, not yet live). NOT a quick SQL change.
3. **UI polish:** add-client form now **requires email**; calendar off-shift grey **softened**; Pulse account chip **repositioned** (commit `ab0a768`); **category colors** — categories show NO color, real services keep their color (matches calendar), and the editor's color picker is hidden for categories (commit `a5d9d28`).

### Key iOS facts (so nobody relearns them)
- **App Store Connect app name = "Vero Booking"** — NOT "Vero" (that's trademarked by a social app, Apple rejected it). The icon on the phone still says **Vero** (`CFBundleDisplayName`). Bundle ID + SKU = `com.gotvero.app`.
- **Apple Team:** Dan Michaels (`AQ3A2Z9WQV`). **Heather** (`barberinapdx@gmail.com`) is now an **Admin** on the Apple account.
- **Updates are automatic:** the app loads gotvero.com, so a **web deploy reaches the app with no re-upload.** Only native-shell changes (icon/name/plugins/permissions/iOS upgrade) need `npm run build && npx cap sync` → Xcode archive → re-upload.
- **TestFlight builds expire ~every 90 days** → push a fresh build roughly quarterly to keep it alive.
- **Internal vs external testers:** team members (internal) install **instantly, no review**; anyone else (external, by email/public link) needs a one-time **~1-day Apple beta review**. An external review was submitted toward a shareable **public link**.

### What's left / next
- **Push notifications — DONE, deployed & live-tested (2026-06-24).** Full chain verified: app registers + saves the device token (`save_device_token` RPC, shop_id + ios); new-booking/reschedule/check-in all call `fireStaffPush` → `/api/push`. Fixed `api/push.js` to try **PRODUCTION APNs first**, sandbox fallback (commit `2099b42`). **Proven live:** a direct test push returned `sent:5 / status 200` for all devices → the 3 Vercel keys `APNS_KEY`/`APNS_KEY_ID`/`APNS_TEAM_ID` ARE set, and **Dan confirmed the test buzzed his phone.** ⚠️ **Known iOS behavior (not a bug):** pushes don't show a banner while the Vero app is in the FOREGROUND (default Capacitor presentationOptions are unset). Background/closed delivery works. To enable foreground banners later, set `PushNotifications.presentationOptions=["badge","sound","alert"]` in `capacitor.config.json` → needs a native re-archive (not yet done; low priority since the important case — alert while app is closed — works).
- **Staff booking alerts by EMAIL/text — DONE, deployed & live-tested (2026-06-24).** Per Dan's ask: the barber an appt is for gets notified at the **email/phone saved in their staff profile**, on EVERY new-booking path (online, calendar `commitAppt`, storefront-while-signed-in, rebook). `api/notify.js` gained a server-side `staff` branch that resolves recipients with the service role (so a public booker never sees staff PII) and sends; `fireStaffNotify()` fires from the 4 sites. **Owner-set scope** in Settings → Notifications → Your team: **assigned barber (default)** / you+barber / all staff (`business.staffAlerts.bookingAlertScope` + `emailStaffOnBooking`). Commit `f98d3d2`. **Verified live:** test POST → `{sent:[{id:"dan",email:"sent"}]}`. **Email sends now; SMS is gated by `SMS_LIVE` → auto-on when Vonage clears.** Wiring confirmed: staff-editor Email/Phone → `provider.email/phone` → `providers.data` → server reads same. Bulk import + test-data seeders intentionally stay silent. **Notes in alerts (2026-06-24):** the alert carries BOTH the client's booking note (`appt.note`, already wired) AND the client's permanent profile note (`client.notes`) — the permanent note is looked up SERVER-SIDE by `clientId` in `api/push.js` and the `api/notify.js` staff branch (never sent by a public booker; booking paths just pass `clientId`). Email shows them as `Booking note:` / `Note on file:` lines. Booking notes are saved on the appt + viewable in the client's history; NOT auto-copied into the profile's main note box or timeline (offered to Dan as a follow-on if he wants them in the feed).
- **Waitlist — staff add + client multi-day (2026-06-24, deployed).** (1) Staff can now add a client to the waitlist: `WaitlistView` gained an "Add to waitlist" button + form (name/phone/service/preferred barber/up to 3 days each with a time window) — builds the same `wlEntry` shape the client join form uses, so notify/remove/display all work unchanged (commit `c446ce1`). (2) The client-side "pick up to 3 days/times" was ALREADY built (ClientFlow step 6, shows when a day is fully booked) — verified, not rebuilt. The new-client-cap one-tap shortcut stays single-day on purpose. Note: staff add-form is dashboard-only → couldn't be tested from Claude's tools; Dan to confirm by tapping it.
- **"Client since M/YY" (2026-06-24, deployed).** Shows under the client name in `AppointmentSheet` + `ClientProfile`, and the profile's "Since" stat now shows M/YY (e.g. 11/25) not year-only. New top-level helpers `clientSinceDate`/`clientSinceLabel` = earliest of the client's appointments (covers booked + imported history) with a stored creation/import-date fallback. Note: `client.since` was referenced in 2 spots but never populated — now computed at display time. New clients with no appts show nothing/"New client".
- **Rebook → optimal (no-gap) times only + "Show all times" (2026-06-24, deployed).** (1) Checkout "book next visit" Pick-a-time step now lists ONLY the gap-free anchors (`computeFreeSlots` `.best` = flush against an appt or day open/close) by default, with a bottom "Show all times" link; resets to optimal each open (Checkout, `showAllRebookTimes`). (2) Client-card rebook (`NewAppointmentForm`, `smartTimes` flag) opens the date picker first, then shows settings-aware `computeFreeSlots` optimum slots with the same "Show all available times" toggle. `best` = at shift open/close OR flush against an existing appt → empty days legitimately show few golds. Commits `d38fe68` + `ebcaa08`.
- **Discounts manager (2026-06-24, DEPLOYED).** Reusable presets `business.discounts` ([{id,name,type:"amount"|"percent",value}]) created in Settings → Payments & Checkout → Discounts (`DiscountsEditor`). Applied at checkout (`DiscountPicker` on the summary → `appt.discount` initial → net subtotal = max(0, gross−discount), tip on net, recorded on the ticket) and to any appointment (`AppointmentSheet` service block → `onUpdate(appt.id,{discount})`). Helpers `resolveDiscount`/`discountLabel`. Commits `28abb32`+`f12cc61`.
- **Selfie → $5 off (2026-06-24, DEPLOYED).** Booking detail step shows a "profile photo for $5" card ONLY when no `client.photo` on file — worded clearly as the client's own photo, NOT inspiration. Selfie → persists as `client.photo` via the always-run `save_booking_client` (covers new/returning, staff/public); a `{id:"selfie",name:"Profile photo",amount $5}` discount lands on `appt.discount` → shows on the booking summary + comes off at checkout. `selfie`/`onSelfiePick` in ClientFlow (600px compress). Commit pending deploy. Verified build + booking-flow loads clean; full click-through to the card not automatable (gated wizard) — confirm live.
- **Public link:** once the external build clears review (~1 day), turn on the group's **Public Link** for a shareable installer.
- **Checklist redesign:** mockup shown — a short **"to open your doors"** essentials list on top + the full 150-item checklist folded into an optional **"dial in every detail"** drawer. Dan to approve → then build. *(Free.)*
- **Category colors:** Dan to send a screenshot of any remaining spot still showing a category color (menu list + editor already fixed & live).
- **Launch gates (see `TODO.md`):** real shop info + menu · **backups (Supabase Pro ~$25/mo — the one paid gate)** · Stripe payout check · one real test booking · reminders (free external timer).
- **Deferred security:** the lookup-PII redesign (H1).

---

## Who + how to talk to Dan
- **Dan** owns **Sanctuary Barber Co** (a barbershop). The app is **Vero** (repo is named `avenue` for historical reasons — same app). Live at **gotvero.com**.
- Dan is **non-technical**. **Explain everything briefly and simply — like talking to a 5-year-old. No jargon.** Lead with what it means for him, not how it works. (Do the real engineering correctly under the hood; just don't narrate it in tech-speak.)

## The safety workflow we ALWAYS use (Dan trusts this)
1. Make one change → one git commit (so it's reversible).
2. Run `npm run ship-check` — one command that gates build + consent phrase ×4 + ≤12 serverless functions. Must pass (exit 0) before deploy. Chain it: `npm run ship-check && npx vercel --prod --force`.
3. Verify in the live preview (booking flow still works).
4. **Deploy to gotvero.com ONLY after Dan says "go."** Nothing goes live without his okay.
5. After deploy, prove it works (e.g., curl the live site) and bump the tracker %.
- Deploy command: `npx vercel --prod --force`

---

## 🎨 UI polish pass — 2026-06-24 (LIVE on gotvero.com)
Separate workstream from hardening: Dan wants Vero to feel as polished as **Mangomint**, done as a systemic "invisible layer" pass (motion + spacing + speed). The motion foundation was already strong, so this is surgical fixes, not bulk CSS. Shipped + verified today:
1. **Sheets** — bottom sheets now slide up / center pops / top drops (was all dropping from the top), backdrop fades in with a subtle blur, grab handle on bottom sheets. Affects every popup app-wide. (commit `80c95a3`)
2. **Booking menu** — services that have options after them (`cutTypes`) are CATEGORIES → show NO price/duration on the menu (price comes from the option picked next); single/flat services keep their `$price · duration`. Removed the floating photo strip; clean text list (Dan chose no photos on categories). (commit `9527ad5`)
3. **Snappier motion app-wide** — `.fade-up`/`.screen-swap` durations cut to ~0.3–0.36s with clean ease (no spring overshoot), stagger compressed; screens settle in ~0.5s, not ~0.8s. (in `9527ad5`)
4. **Booking details** — "Add a note or photo" heading right-sized 22→17px (was a 2-line page-title competing with the booking summary). (commit `72ce418`)
- Full client booking flow walked end-to-end & polished. **NEXT: the owner DASHBOARD** (calendar/clients — the screens Dan uses). Polishing it needs a SIGNED-IN preview or screenshots — heads-up so the next session doesn't repeat the dead-end: the dashboard hard-requires a real Supabase session (`App.jsx` ~2063), and the `avenue2026` `SHOP_PASSWORD` is only an extra lock, **NOT** a login bypass. Details in memory `mangomint-polish-direction.md`.
- Process note: per the safety workflow above, deploys normally wait for Dan's explicit "go." These went out as Dan drove each step and approved shipping.

---

## Two big things in flight

### 1) Toll-free phone number — ✅ DONE, waiting on carriers
- Dan's SMS toll-free number (**+1 833-429-5329**) was resubmitted to Vonage on 2026-06-22; status = **"Carriers review."** Nothing to do but wait for approval.
- **DO NOT touch or delete** these (they're carrier-review evidence): footer email `contact@sanctuarybarberco.com`, `public/optin.html`, `public/optin.png`, the `?optin=1` deep link in `ClientFlow`, and the SMS consent copy (must stay exactly ×4 in App.jsx).
- Sole proprietor = **no EIN needed** (Vonage doesn't collect a Tax ID for sole props). That issue is resolved.
- Details: see memory `toll-free-verification.md`.

### 2) Security hardening — 🔶 IN PROGRESS (this is the active work)
- Goal: make the app safe for Dan's own shop launch first, then (later) for selling to many shops.
- **Two trackers, both in the repo:**
  - `HARDENING-SHOP.md` — **Track A: Dan's own shop. DO NOW.** Currently **~70%**.
  - `HARDENING-SAAS.md` — Track B: multi-tenant SaaS. **Later.** (Includes all of Track A first.)
- These came out of a full audit / pen-test / threat-model done earlier in the session.

---

## ✅ What we already shipped & verified (Track A, all LIVE on gotvero.com)
1. **Confirmed the scary one is NOT real:** strangers cannot read the client list. Tested as an anonymous stranger → got 0 client/appointment rows even though data exists. RLS (the data lock) is genuinely ON. (Supabase shows `clients` has 2 RLS policies.)
2. **Price/duration guards** — service save rejects negative/garbage prices; durations clamped 5–600 min; per-barber overrides clamped too. (commit `de9f32e`)
3. **Deposit guard** — booking deposit can never be negative or exceed the ticket total. (in `de9f32e`)
4. **Stripe server-side amount guard** — `api/stripe.js` rejects amounts that are ≤0, non-numbers, or > $100k, before reaching Stripe. Tested live: negative/zero/giant all rejected. (commit `adfc1ef`)
5. **Baseline security headers** — frame/sniff/referrer/HSTS in `vercel.json`. Verified live. (commit `93add2c`)
6. **Locked the calendar "wipe" door** — `api/calendar-pull` (could add/erase synced appointments) now requires the owner to be signed in. Anonymous request → 401, tested live. (commit `c0a542d`, deployed 2026-06-23). The nightly auto-sync uses a different door (`api/calendar-run`) and is unaffected.
7. **Locked the calendar "read" feed** — `api/ical` (the .ics calendar feed) would have leaked client names once real bookings exist. Now it needs a private key in the URL; without it (or with a wrong one) it returns "Not found" (404). The owner's key is handed out only to a signed-in owner. Tested live. (commit `a478b3a`, deployed 2026-06-23).
8. **Locked the text/email + notification senders** — `api/notify` and `api/push` no longer accept requests from other websites (a foreign browser request is turned away). Your own booking page still works. Tested live. (commit `5adc05e`, deployed 2026-06-23). **All four "open doors" are now locked.**
9. **Added a pre-flight safety check** — `npm run ship-check` catches the three things that can sink a deploy (build errors, SMS-consent count ≠ 4, more than 12 serverless functions — that last one is what made today's deploy fail). Also runs automatically on GitHub. No deploy needed — it's a workshop tool. (commit `1e75d08`)
10. **Locked the last open cron** — `api/calendar-run` (the nightly auto-sync) could be triggered by anyone; now it requires the secret password Vercel already uses for the other timed jobs. Anonymous trigger → 401, tested live; the nightly run still works. **Every behind-the-scenes address that writes data now requires a lock.** (commit `e75f360`, deployed 2026-06-23)
11. **Added a browser-permissions lock** — denies device features the app never uses (camera, mic, location, etc.) so injected code couldn't reach them. Left card payments untouched. Tested live. (commit `d9cab32`, deployed 2026-06-23)

12. **Money safety net — built AND turned on** ✅ — `api/stripe.js` has a webhook so if a payment is refunded, disputed (chargeback), or fails, your app's records update to match. Dan registered the endpoint in Stripe on 2026-06-23 (confirmed **Active**, URL exact, listening to the right events). Live payments 100% untouched. (commit `de4c97f`)

13. **Error alerts now on** ✅ — Sentry is wired into the app (production-only, errors-only, no customer data sent). If anything breaks on the live site, Dan gets an email. Dan made the free account; Claude did the wiring. (commit `2b4acc7`)

14. **Database blueprint written to code** — `DATABASE.md` documents your whole backend (tables, rules, security model) so it could be rebuilt or reviewed. The full exact dump is parked for before-launch (needs database tools + your password, and there's barely any real data yet). (commit `d79d9d6`)

15. **Two-phone (concurrency) guard — TRIED then REVERTED ⏪** — appts/clients/services/providers/waitlist were ALREADY safe (per-row upserts + Supabase Realtime live-sync). The one gap was the whole-blob `shops.settings` write; a merge guard was added (1d3610b) but **reverted (84cfbc7)** out of caution after a confusing live test (see OPEN ISSUE). The rare "two people edit Settings at the same instant" gap is left as-is — fine for a 1–2 chair shop.

> **Status: ~70% done.** Dan's "let's go in order" 3-item list: ✅ (1) error alerts · 🔶 (2) DB backup (blueprint done; exact `pg_dump` + Supabase auto-backup check deferred to before-launch) · ⏪ (3) two-phone guard (reverted, see above).
- Also confirmed safe (no fix needed): **booking photo uploads** auto-shrink + cap at 3.

## ✅ RESOLVED — settings save works (was a false alarm). DO NOT re-investigate.
The previous session worried a tip-preset change "didn't persist." **2026-06-23: Dan — the owner who uses the app daily — confirmed directly: "I change the tip. It saves. I see that it saves. I have not seen it change on its own ever."** A full code trace agrees: the save path is sound (`save()` → `setBusiness(form)` → debounced `shops` upsert; the tipping editor correctly buffers to `form` and commits on "Save changes"; nothing re-pulls or clobbers the settings blob — Realtime only re-pulls list tables; the save gate was open, no "saving paused" banner). The earlier symptom was almost certainly an **unsaved draft** (tapping back/X discards it) or an **app-switch during the ~800ms save** — not a bug. **Do NOT re-open this** unless Dan reports a real, repeatable revert with his own eyes.
- **Launch heads-up (data entry, NOT a bug):** the live `shops.settings` still holds **demo/seed values** (business name "Vero", email `hello@meridianstudio.com`, address "2077 NE Town Center Dr", phone 555-0142, default tipping `[18,20,25]`). Dan simply hasn't filled in his real business info yet. Worth doing before launch — but it's a 5-minute data-entry step in Settings, not something to fix in code.

## ▶️ What's NEXT on Track A
> **NEW 2026-06-23 — full pre-launch audit done: `LAUNCH-AUDIT-2026-06.md`** (5-role + pentest + due-diligence + threat model, code-grounded). It confirmed the [NOW] list below and surfaced extra single-shop items beyond backups — top ones: schedule the `send-reminders` cron (reminders don't fire today), close the missing-Origin `curl` doors on `notify`/`push`, stop anonymous client enumeration (`lookup_client_by_phone` phone-path + `/api/client-code`), add server-side error alerts, capture+audit the DB schema/RLS/RPC dump, persist a consent record, cap photo/text sizes server-side. Multi-tenant isolation + billing + compliance = [SAAS] (later). Severity-ranked action plan is at the end of the audit file.

Open `HARDENING-SHOP.md` for the full list. **All 4 "open door" endpoints + cron + payment safety net + error alerts + pre-flight check + permissions header are DONE & live.** The scary stuff is handled. What's left splits into "anytime" work and a hard "before launch" gate (next section).

**Can do anytime (not blocking):**
1. **STOP opt-out handler** — legally required once SMS goes live (still in carrier review). Can be pre-built now (must fold into an existing `api/` function to respect the 12-function cap).
2. **Full CSP header** — later, careful (app uses heavy inline styles, needs `'unsafe-inline'` for style).
3. **Exact DB schema dump to git** — `pg_dump`/`supabase db dump` of schema/RLS/RPC bodies (needs DB tooling installed — none locally as of 2026-06-23 — + the Postgres connection string from Supabase → rotate the DB password after). Nice-to-have; the code-derived blueprint already lives in `DATABASE.md`.
- **Track B (SaaS, later):** tighten the public `shops.settings` read (currently exposes the whole settings blob to anon); scope the iCal-key endpoint to shop membership. See `HARDENING-SAAS.md`.

## 🚀 LAUNCH CHECKLIST — to open Dan's own shop
The hard engineering is done (app, live payments, security hardening, the recurring bugs fixed + regression-locked). What's left to actually open the doors:

**A. Must do before the first REAL booking (mostly Dan; quick):**
1. **⛔ TURN ON BACKUPS — #1.** Upgrade Supabase **Free → Pro (~$25/mo)**: daily backups, 7-day retention, restore anytime. Org "thebarberdanpdx's Org" is on **Free = NO backups**; Dan deferred to launch. Unrecoverable if skipped. See memory `prelaunch-backups-upgrade.md`.
2. **Real shop info + menu.** Replace the demo values in Settings ("Vero" / `hello@meridianstudio.com` / "2077 NE Town Center Dr" / 555-0142) with real Sanctuary Barber Co info; confirm real **services, prices, staff, hours**; and **clear the demo/test clients & appointments** (Delete-all button, now type-`DELETE` guarded) so reports start clean.
3. **Booking link.** Confirm the exact URL customers use to reach the shop's booking page (slug `avenue-phi`; `resolveShopId` reads `?shop=`/subdomain/path). Verify it lands on the right shop.
4. **Stripe payouts.** Confirm Dan's bank is connected + payouts enabled in Stripe (charges are live; make sure money actually reaches him).
5. **Full dry-run booking** (do together): book as a customer → pay → confirmation EMAIL arrives → shows on calendar → refund it. Final proof before real customers.

**B. Turns on after / in parallel (NOT day-1 blockers):**
6. **Text messages** (SMS confirmations + auto-STOP handler) — auto-on when Vonage approves the toll-free number (in carrier review). Email confirmations cover launch until then. STOP handler still to build (TCPA); folds into an existing `api/` function (12-fn cap).
7. **Reminders firing** — blocked by Vercel plan: Hobby allows only 2 crons, once/day; reminders need ~15 min. Decision: **Vercel Pro (~$20/mo)** OR a free external scheduler (Claude wires it). `send-reminders` cron is built, just unscheduled.
8. **Cleanups:** remove hardcoded `avenue2026` (⚠️ login/PIN lockout risk); a few audit privacy tightenings that need ~10 min Supabase access (stop client-lookup snooping, enforce blocked-clients server-side, confirm login-code brute-force cap). See `AUDIT-TRACKER.md`.

## 📱 iOS app → TestFlight (for testers) — NOT a launch blocker, do in parallel anytime
Customers book on the **web** (gotvero.com link); the native app is for **Dan + staff + testers**, so this is separate from opening the shop.
- **Status:** ✅ **DONE — LIVE on TestFlight (2026-06-24 evening).** Build 1.0(1) uploaded to app record **"Vero Booking"** (`com.gotvero.app`); **Dan + Heather both installed** (Dan internal/Owner, Heather internal/Admin). Full detail in the **🚀 LATEST SESSION** section at the top of this file. An external review is in flight to enable the shareable **public link**. The steps below are kept as reference for future re-uploads.
- **App config** (`capacitor.config.json`): appId `com.gotvero.app`, name "Vero", `server.url = https://gotvero.com` — the app loads the LIVE site, so testers always see the latest; upload the shell **once**, web updates need no re-upload.
- **Path = TestFlight** (not the public App Store). Internal testers (≤100) get builds instantly after the first upload; external testers (≤10,000 via email/link) need a one-time ~1-day Apple beta review.
- **Who does what:** Claude can prep the build (`npm run build && npx cap sync`) + write the click-by-click. Dan does the Xcode archive → upload → App Store Connect app record → add testers (GUI/account steps Claude can't drive).
- **Steps:** (1) Apple Dev account active ✅; (2) Xcode: set version/build + signing team → Product → Archive → Distribute → App Store Connect; (3) App Store Connect: create the app (`com.gotvero.app`) if needed → TestFlight → add testers; (4) testers install the **TestFlight** app + accept the beta. APNs push is already wired server-side (`api/push.js`).

---

## Handy facts
- **Shop slug:** `avenue-phi` (brand shown to customers: "Sanctuary Barber Co").
- **Business email:** `contact@sanctuarybarberco.com` (GoDaddy Microsoft 365).
- **Stack:** React single-file app (`src/App.jsx`, ~22k lines) · Supabase (Postgres + login) · Vercel (hosting + `api/` functions) · Stripe (live) · Vonage (SMS, pending).
- **Bigger picture (Track B / SaaS, later):** no subscription-billing system exists yet; cross-tenant isolation, DPA/legal, scalability all live in `HARDENING-SAAS.md`. Not needed for Dan's own single shop.

## How to start the next session (Dan can just say this)
> "Read SESSION-HANDOFF.md and HARDENING-SHOP.md, then let's keep going on Track A."
