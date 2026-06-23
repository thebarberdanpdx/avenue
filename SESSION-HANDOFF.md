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
  - `HARDENING-SHOP.md` — **Track A: Dan's own shop. DO NOW.** Currently **~26%**.
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
- Also confirmed safe (no fix needed): **booking photo uploads** auto-shrink + cap at 3.

## ▶️ What's NEXT on Track A (pick up here)
Open `HARDENING-SHOP.md` for the full list. The four open doors are done. Remaining, roughly in value/safety order:
1. **Stripe webhook** — keeps your books in sync if a payment is refunded/disputed/fails. NOTE: we're at Vercel's **12-function limit**, so this must be folded into an existing endpoint (or remove an unused one first), AND Dan must add the webhook + a signing secret in the Stripe dashboard.
2. **Reliability** — error monitoring; put the database design into git; schedule the reminder cron (only matters once SMS is approved).
3. **Concurrency guard** — stop two devices at the desk from overwriting each other (touches the save path — careful).
4. **Remove the hardcoded password `avenue2026`** — careful: it's wired into the login/lock screen, so a clumsy change could lock Dan out. Low real-risk (the real data is already protected by the login + database lock).
5. **STOP opt-out handler** — legally required once SMS goes live.
2. **Stripe webhook** — so refunds/chargebacks/failed payments stay in sync (pairs with the amount guard already done).
3. **Reliability** — error monitoring; schedule the appointment-reminder cron (only matters once SMS is approved); put the database schema into git.
4. **Concurrency guard** — stop two staff devices from overwriting each other.
5. **Remove the hardcoded password** `avenue2026` in the bundle (low risk, but verify the login screen still works).
6. **STOP opt-out handler** — required once SMS goes live (legal).

## ⏸ Intentionally left alone (Dan's call)
- The **"Delete all clients & data"** button in Settings — Dan is keeping it for now because he's still adding/removing **test clients** pre-launch. **Remove (or lock behind a typed confirmation) before real launch.**

---

## Handy facts
- **Shop slug:** `avenue-phi` (brand shown to customers: "Sanctuary Barber Co").
- **Business email:** `contact@sanctuarybarberco.com` (GoDaddy Microsoft 365).
- **Stack:** React single-file app (`src/App.jsx`, ~22k lines) · Supabase (Postgres + login) · Vercel (hosting + `api/` functions) · Stripe (live) · Vonage (SMS, pending).
- **Bigger picture (Track B / SaaS, later):** no subscription-billing system exists yet; cross-tenant isolation, DPA/legal, scalability all live in `HARDENING-SAAS.md`. Not needed for Dan's own single shop.

## How to start the next session (Dan can just say this)
> "Read SESSION-HANDOFF.md and HARDENING-SHOP.md, then let's keep going on Track A."
