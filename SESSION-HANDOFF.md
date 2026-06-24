# 👋 START HERE — Session Handoff (for Dan + a fresh Claude session)

_Last updated: 2026-06-23_

**New session? Read this file + `HARDENING-SHOP.md`, then continue Track A. Dan should not have to re-explain anything.**

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

## 🚀 PRE-LAUNCH CHECKLIST — must do before the first REAL client books
Fine to leave today; MUST be handled before going live. (Dan asked these be tracked so they're not forgotten.)
1. **⛔ TURN ON BACKUPS — #1 priority.** Upgrade Supabase **Free → Pro (~$25/mo)** for daily automatic backups (7-day retention, restore anytime). Confirmed 2026-06-23: org "thebarberdanpdx's Org" is on **Free = NO backups**. Dan chose to wait until launch (no real data to lose yet). **A wipe with no backup is unrecoverable — this gates launch.** See memory `prelaunch-backups-upgrade.md`. (In-app launch checklist already has a matching `safety_backups` line.)
2. **"Delete all clients & data" button** — ✅ **now gated behind type-to-confirm (must type `DELETE`), LIVE 2026-06-23.** Button disabled until it matches + `nukeAll()` hard-guards on it (fails safe). Owner can still clear test data; an accidental tap can't wipe everything. (Full removal still optional at real launch.)
3. **Fill in real business info** in Settings — name/email/address/phone still show **demo values** ("Vero" / `hello@meridianstudio.com` / "2077 NE Town Center Dr" / 555-0142). 5-minute data-entry step (not a code bug — see RESOLVED section above).
4. **Remove the hardcoded password `avenue2026`** — ⚠️ wired into login/PIN-lock (lockout risk); low real-risk since login + RLS already protect data. Do carefully.
5. **STOP opt-out handler live** — required the moment SMS is approved (TCPA).

---

## Handy facts
- **Shop slug:** `avenue-phi` (brand shown to customers: "Sanctuary Barber Co").
- **Business email:** `contact@sanctuarybarberco.com` (GoDaddy Microsoft 365).
- **Stack:** React single-file app (`src/App.jsx`, ~22k lines) · Supabase (Postgres + login) · Vercel (hosting + `api/` functions) · Stripe (live) · Vonage (SMS, pending).
- **Bigger picture (Track B / SaaS, later):** no subscription-billing system exists yet; cross-tenant isolation, DPA/legal, scalability all live in `HARDENING-SAAS.md`. Not needed for Dan's own single shop.

## How to start the next session (Dan can just say this)
> "Read SESSION-HANDOFF.md and HARDENING-SHOP.md, then let's keep going on Track A."
