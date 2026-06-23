# 🔍 Vero — Pre-Launch Audit (2026-06-23)

Comprehensive security / infra / SaaS / product / compliance audit of `src/App.jsx` + `api/*` + `DATABASE.md` + `public/*` + `vercel.json`, performed as five roles (SaaS architect, security engineer, DevOps, QA lead, CTO) plus a pentest pass, a due-diligence pass, and a threat model. Grounded in the real code (file:line evidence). Read-only — nothing was changed.

> **How to read this.** Every finding is tagged **[NOW]** (matters for Dan's own one-shop launch — fix before real bookings) or **[SAAS]** (only matters once a 2nd+ paying shop exists — the "sell it to thousands" future). **Most of the scary-sounding items are [SAAS].** For launching *one* shop, the real list is shorter — see "Bottom line" first.
>
> **Confidence note.** The actual tenant-isolation enforcement (RLS policy SQL + the 27 `SECURITY DEFINER` RPC function bodies) lives **only in Supabase and is not in the repo** (per `DATABASE.md`). So several Critical/High items are **CONDITIONAL** — confirmed as *reachable* from the code, but whether they're *exploitable* depends on database SQL no one has captured or reviewed. Those are marked **⚠️ VERIFY-IN-DB**. Capturing that SQL (`supabase db dump`) is itself a top action.

---

## Bottom line (the honest two-lens summary)

**Lens 1 — Dan's own single shop, launching now:** The dangerous, classic holes are genuinely closed (anonymous users can't read the client list; the four API "doors" were locked; payment amount guards exist; security headers are on). **But the audit found ~8 real [NOW] issues that a single shop should still fix before taking real bookings** — they are NOT just "backups." Highest: no backups, reminders don't actually fire, no server-side error alerts, anonymous client-list enumeration, and a couple of API endpoints that still answer to `curl`.

**Lens 2 — selling to 10,000 shops (the SaaS dream):** Not ready, and that's expected — it was never built for that yet. The blocker is that **multi-tenant isolation is unproven** (the thing keeping shop A's data away from shop B is un-versioned database SQL that's never been tested for a logged-in attacker), there's **no subscription-billing system at all**, and the **legal/compliance scaffolding for a platform** (DPA, data export, deletion, multi-tenant privacy policy) doesn't exist.

**One-line verdict:** *Good shape for one shop after a short, concrete fix list; a real distance from a sellable multi-tenant SaaS.*

---

## Severity-ranked master list

### 🔴 CRITICAL
| ID | Finding | Tag | Confirmed? |
|---|---|---|---|
| C1 | **No database backups** (Supabase Free = none). A drop/corruption/bad-write = permanent, unrecoverable loss of all client & appointment & payment data. | [NOW] | ✅ Confirmed |
| C2 | **Multi-tenant isolation is unproven.** Every dashboard read/write is keyed on a shop id the user fully controls via URL; the only fence is RLS + RPC bodies that aren't in the repo and were never tested for a *logged-in* cross-tenant attacker. If any one policy is loose, a free self-signup session can read/wipe **every** shop's data. | [SAAS] (auditing the RLS is [NOW]) | ⚠️ VERIFY-IN-DB |

### 🟠 HIGH — [NOW]
| ID | Finding | Evidence |
|---|---|---|
| H1 | **Anonymous client-list enumeration / PII oracle.** `lookup_client_by_phone` (phone path) prefills name/phone with **no code check**; `/api/client-code` returns `{found:true, masked}` vs `{found:false}`. An attacker sweeps phone numbers / emails against `?shop=avenue-phi` and harvests who your clients are. | App.jsx:2865-2871, 4800; api/client-code.js:36-37,61 — exact PII returned ⚠️ VERIFY-IN-DB |
| H2 | **"Locked" API doors still answer to `curl`.** `notify.js`/`push.js` allow requests with **no Origin header** (`!origin || allowed`). So `notify` = send arbitrary email from your verified domain to anyone (spam/phish relay); `push` = fire arbitrary push alerts to your staff's iPhones. Origin checks only stop *browsers*. | api/notify.js:24-39; api/push.js:25-28,77-101 |
| H3 | **Photos stored as base64 text inside Postgres rows + public booking can write unbounded blobs.** Every save re-uploads all images; rows balloon; the "max 3 / shrink" cap is client-side only — a direct `book_public` call can inject huge payloads anonymously. | App.jsx:1548,2891-2903,3375,3440 |
| H4 | **Appointment reminders never fire.** `send-reminders` cron is **not in `vercel.json`** — the core advertised feature is dead in production. | vercel.json crons; api/send-reminders.js:2 |
| H5 | **No server-side error monitoring.** Sentry only watches the browser; `main.jsx` even ignores `Failed to fetch`. The money path (`stripe.js`), messaging, and all crons can fail silently — and the owner is non-technical, so silent = never noticed. Plus failed dashboard saves only show a dismissible banner (navigate away → edit lost, no alert). | main.jsx:14-29; api/* (no @sentry); App.jsx:1570-1572 |
| H6 | **No stored consent record.** SMS/ToS consent copy is shown but nothing timestamped is persisted (only an opt-*out* flag). 10DLC carriers / TCPA want demonstrable proof a given person consented. (TFN is in carrier review now.) | App.jsx:2109-2110,4795; no `consentAt` persisted |
| H7 | **Client self-service brute-force defense unverified.** A 6-digit code (1e6 space) with a 10-min window; issuance is throttled but the *verification* attempt-cap lives in `verify_client_code` (not in repo). If there's no attempt cap, a triggered code is brute-forceable → take over a client's self-service (view/cancel appts). | api/client-code.js:40-41; ⚠️ VERIFY-IN-DB |

### 🟡 MEDIUM — [NOW]
| ID | Finding | Evidence |
|---|---|---|
| M1 | **Stripe webhook has no signature verification** — it trusts `body.object==="event"` and re-fetches via `events.retrieve`. Forged ids are blocked (good), but **real past events can be replayed** to re-stamp refunded/disputed/failed on tickets; no event-dedup. | api/stripe.js:84-94,150-155 |
| M2 | **`sale_intent` is open + trusts the client amount.** No login, no shop binding, amount only bounded 0<n≤$100k; never re-derived from the booking. An open PaymentIntent factory on your live account. (Self-limiting since the customer charges their own card, but abusable.) | api/stripe.js:30-44; App.jsx:18525 |
| M3 | **SSRF in `calendar-sync.js`.** Unauthenticated; server fetches any `http(s)` URL with `redirect:follow`, no private-IP block → reachable `169.254.169.254` (cloud metadata) / internal hosts. | api/calendar-sync.js:83-89 |
| M4 | **`CRON_SECRET` guard is optional** (skips if env unset) and accepted as a `?key=` query param (leaks to logs). Confirm it's actually set in Vercel; move to a header. | api/send-reminders.js:21-27; calendar-run.js:141-147 |
| M5 | **"Blocked client" is UI-only.** The public `book_public` path never re-checks `blocked` — a blocked client can still book. The settings checklist *claims* this is enforced. | App.jsx:3318-3440 vs 4800 |
| M6 | **No length caps on text fields** (`maxLength` count = 0). The public booking note is the live risk (bloat / abuse); staff fields compound the base64 bloat. | App.jsx (grep maxLength → 0) |
| M7 | **No rate limiting anywhere** (no KV store; idempotency key is client-generated). `notify`/`push`/`sale_intent`/`calendar-sync`/`client-code` are floodable → Resend/Vonage spend + Stripe noise. | api/* (no limiter) |
| M8 | **Hardcoded `avenue2026`** ships in the public JS bundle and bypasses the per-staff PIN lock; also `#staff` opens the dashboard curtain with no password at all. (Real data is still protected by the magic-link session + RLS, so this is a soft gate — but it fully defeats the PIN feature.) | App.jsx:1329,1346-1352,1382,9287 |
| M9 | **Accessibility gaps** — icon-only buttons mostly unlabeled (aria-label sparse), many tap targets ~20px (< 44px). ADA exposure for a commercial booking site; App Store scrutiny. | App.jsx:2322,2391; minHeight:44 appears once |
| M10 | **~81 silent empty `catch {}` blocks** — read failures (client lookup, my-appointments, availability) fail invisibly to stale/empty UI. | App.jsx (grep) |

### 🟢 LOW — [NOW]
| ID | Finding | Evidence |
|---|---|---|
| L1 | **iCal feed exposes client name + note** to anyone holding the bearer URL, and the token can't be rotated independently of `SERVICE_KEY`. (Token itself is strong — per-shop HMAC, constant-time compare.) | api/ical/[shop]/[file].js:14-19,63-92 |
| L2 | **`sync-status.js` is unauthenticated** (leaks per-shop appointment counts to any guessable slug) **and wastes 1 of the 12 function slots.** It's unused by the app — delete it. | api/sync-status.js:7,17-51 |
| L3 | **HSTS lacks `includeSubDomains`/`preload`; no CSP header.** | vercel.json |
| L4 | `version.js` reveals deploy cadence (git SHA) to anyone (minor). | api/version.js |
| L5 | Fixed-deposit / time-rule / custom-tip inputs lack an upper clamp (server caps charges at $100k, so low impact). | App.jsx:13930,10201,18885 |

### 🔵 SAAS — only relevant once you sell to a 2nd+ shop
| ID | Finding |
|---|---|
| S1 | **Cross-tenant read/write** if any RLS policy on `clients/appointments/waitlist/providers/services/shops` is loose on *any* verb (SELECT/INSERT/UPDATE/DELETE). Becomes **Critical** the instant shop #2 onboards. ⚠️ VERIFY-IN-DB. |
| S2 | **Privilege-escalation via owner RPCs** (`set_member_role`, `set_member_shops`, `remove_member`, `invite_member`) — they take an attacker-suppliable `p_account_id`; whether they re-check the caller is an owner lives in the un-reviewed RPC body. ⚠️ VERIFY-IN-DB. |
| S3 | **No subscription-billing system exists.** There is no way to actually charge the shops you'd sell to, no trials, no plans, no dunning. |
| S4 | **Service-role `api/` endpoints ignore tenancy** — `calendar-pull` (calendar wipe/inject), `push`, `sync-status` trust a request-supplied `shop` and bypass RLS. Even perfect RLS leaves these cross-tenant. |
| S5 | **Crons fan out O(shops × rows)** — at 10k shops the reminder/birthday crons do tens of thousands of unbounded reads serially in one invocation; it times out and later shops silently get nothing. |
| S6 | **`shops.settings` is anonymously readable** — at scale, anyone can scrape every shop's config + business email. |
| S7 | **Whole-array saves + Realtime full-table re-pull** — write amplification (rename one client → rewrite all rows); degrades per-shop now, acute at scale. |
| S8 | **Staff permission gates are UI-only** (price-edit, refund, PIN) — fine for trusted staff, not for untrusted multi-tenant staff. |
| S9 | **Compliance scaffolding missing:** no customer data export, no self-serve deletion (and current deletion leaves PII inside past appointments), no retention enforcement, no DPA / subprocessor list, single-tenant privacy/ToS that names only "Sanctuary Barber Co." |

---

## Penetration test — attack scenarios, ranked by (severity × likelihood)

> "✅ blocked" = the code already stops it. "⚠️ conditional" = works only if the un-reviewed DB SQL is loose.

**P1 — Harvest the live shop's client list (HIGH sev / HIGH likelihood, [NOW])**
1. Open `https://gotvero.com/?shop=avenue-phi` (no login).
2. From the console, loop `supabase.rpc('lookup_client_by_phone',{p_shop:'avenue-phi',p_phone:N})` over a list of local-area-code numbers — or POST `/api/client-code {shop, email}` over an email list.
3. Hits return a match (and the booking phone-path prefills name/phone with no code check); `/api/client-code` returns `{found:true, masked}`.
4. Result: enumerate who banks with this shop + partial PII. **Fix:** make those return a boolean/opaque token only and require the emailed code first; throttle by shop+IP. *(Exact PII depends on the RPC's SELECT — ⚠️ verify.)*

**P2 — Open mail/SMS relay + staff push phishing (HIGH / HIGH, [NOW])**
1. `curl -X POST https://gotvero.com/api/notify` **with no Origin header**, body `{to:{email:victim}, ...arbitrary content}` → email sent from your verified domain.
2. `curl .../api/push {shopId:'avenue-phi', title:'Verify your account', body:'tap https://evil…'}` → phishing push to staff iPhones.
3. Result: your domain/sender reputation is abused; staff are phished. **Fix:** require auth/internal secret; don't allow missing-Origin; bind recipients to real bookings; rate-limit.

**P3 — Client self-service takeover via code brute-force (HIGH / MED, [NOW], ⚠️ conditional)**
1. Trigger one sign-in code for a victim email.
2. Brute-force `verify_client_code` (1e6 space, 10-min window) **if it has no attempt cap**.
3. Result: read/cancel the victim's appointments, append family members. **Fix:** confirm/added attempt-cap + single-use in the RPC.

**P4 — Database bloat / cost attack (MED / MED, [NOW])**
1. Script `book_public` with `photoData` = several large base64 strings (cap is client-side only).
2. Repeat. Result: Postgres rows balloon, storage + egress cost climb, dashboards slow. **Fix:** enforce count/size server-side; move images to Storage.

**P5 — SSRF to cloud metadata (MED-HIGH / MED, [NOW])**
1. `curl .../api/calendar-sync {url:'http://169.254.169.254/latest/meta-data/...'}` (or an internal host); endpoint fetches it, follows redirects.
2. Result: blind SSRF / potential metadata reach. **Fix:** block private/link-local IPs, re-check after redirects, allow-list providers.

**P6 — Stripe abuse (MED / MED, [NOW])**
1. `curl .../api/sale_intent {amount:...}` repeatedly → mint PaymentIntents on the live account; or replay a real `evt_…` to `/api/stripe` to re-stamp payment flags. **Fix:** scope/rate-limit `sale_intent`, re-derive amount; verify webhook signatures + dedup events.

**P7 — Cross-tenant data theft (CRITICAL / —, [SAAS], ⚠️ conditional)**
1. Self-signup a magic-link account (no invite needed).
2. Raw `GET /rest/v1/clients?shop_id=eq.<victim-slug>&select=data` with your session token.
3. **If** any clients/appointments RLS policy is `USING(true)` / "authenticated can read all" → exfiltrate or `upsert`/`delete` every other shop's data. **Fix:** membership-scoped RLS on all four verbs; live-test as a foreign tenant.

**P8 — Privilege escalation to owner (HIGH / —, [SAAS], ⚠️ conditional)**
1. Console: `supabase.rpc('set_member_role',{p_account_id:victim, p_user_id:self, p_role:'owner'})`.
2. **If** the RPC doesn't assert caller-is-owner-of-account → take over the tenant. **Fix:** assert ownership inside every management RPC.

**Blocked / well-built (credit where due):** anonymous reads of `clients`/`appointments` return 0 rows (RLS on for anon ✅); `charge`/`refund` require a verified session ✅; the iCal token is per-shop HMAC + constant-time ✅; no `dangerouslySetInnerHTML`/`eval` anywhere (React escaping holds — no classic XSS) ✅; no committed secrets ✅; SVG logo is rasterized so no stored-XSS ✅; deposit clamped to cart total ✅.

---

## SaaS due-diligence — what an acquirer would flag

**Deal-blockers (must fix before acquisition):**
1. **Tenant isolation unproven & un-versioned.** The control that separates customers lives in DB SQL that isn't in source control, isn't reviewed, and was never tested for a logged-in attacker. An acquirer's security team will not clear this without the schema dump + a passing cross-tenant test on all four verbs.
2. **No backups / no DR.** Holding many businesses' customer PII with zero recovery is an existential, likely breach-notifiable risk.
3. **No subscription billing.** There is no revenue mechanism — the thing being acquired can't charge its customers.
4. **Compliance gaps for a processor:** no DPA, no subprocessor list, no data export/erasure, single-tenant legal docs. GDPR Art. 28/15/17 + CCPA exposure across the whole customer base.
5. **Bus factor / maintainability:** one ~20k-line `App.jsx` file holds the entire frontend; the security model is split between RLS and service-role endpoints with **inconsistent enforcement** (the #1 thing a code review misses).

**Yellow flags:** full-table loads + cron fan-out won't scale; no server-side observability; no staging environment / no CI beyond `ship-check`; reminders (a headline feature) don't fire; base64-in-DB storage model.

**Green:** clean dependency audit (0 prod vulns), no secrets leaked, payment *amount* guards + webhook reconciliation present, error monitoring on the client, the booking/checkout core works.

---

## Threat model + data-flow review (the part ordinary code review misses)

**Actors:** anonymous booker · authenticated staff/owner · attacker-anon · attacker-authed (free self-signup) · malicious/curious staff · external services (Stripe, Vonage, Resend, Supabase, Vercel).

**Trust boundaries & the key structural insight:** there are **two parallel paths to the same data with *different* enforcement**:
- **Path A (browser ↔ Supabase directly):** guarded by **RLS**. Anonymous is correctly fenced (0 rows). Logged-in cross-tenant = ⚠️ unverified.
- **Path B (browser/cron ↔ `api/*` ↔ Supabase via service-role):** **bypasses RLS entirely** and mostly trusts a client-supplied `shop`. So even if Path A's RLS is perfect, Path B (`calendar-pull`, `push`, `sync-status`, `notify`) is a second, weaker door to tenant-scoped actions. **Consistency between these two paths is the core problem.**

**Data flows reviewed:**
- *Booking (anon):* browser → public RPCs (`lookup_*`, `save_booking_client`, `book_public`) → DB. Risks: enumeration (H1), blob writes (H3), no blocked-check (M5), amount trust (M2).
- *Checkout:* browser → `stripe.js` (`setup`/`sale_intent` open; `charge`/`refund` session-gated) → Stripe; Stripe → `stripe.js` webhook → DB. Risks: webhook replay (M1), open intents (M2).
- *Dashboard (staff):* browser → direct table reads under RLS. Risks: cross-tenant (C2/S1), UI-only permissions (S8).
- *Reminders/birthdays (cron):* Vercel cron → DB full scans → Vonage/Resend. Risks: not scheduled (H4), fan-out (S5), silent half-fail/no-alert (H5/M4).
- *Calendar sync:* owner/cron → external iCal fetch → DB. Risks: SSRF (M3), cross-tenant calendar wipe via `calendar-pull` (S4).

**STRIDE quick map:** Spoofing → missing-Origin bypass (H2), no webhook signature (M1). Tampering → client-trusted amounts (M2), whole-blob settings last-writer-wins. Repudiation → no consent record (H6), no audit log. Info-disclosure → client enumeration (H1), anon `shops.settings` (S6), iCal PII (L1). DoS → no rate limiting (M7), base64 bloat (H3), SSRF (M3). Elevation → owner RPCs (S2), UI-only gates (S8).

---

## "Things a first-time SaaS founder would never think to check"

1. **Your reminder texts/emails aren't actually turned on.** The feature is fully built and looks done — but nothing schedules it, so in production it never sends. (H4)
2. **"It's in the cloud" is not a backup.** The free database tier keeps *zero* backups. One bad delete and the customer data is gone forever. (C1)
3. **Your error alarm only watches half the building.** Sentry watches the customer's browser; it does **not** watch your payment/SMS/cron code on the server. The money path can fail silently and you'd never know. (H5)
4. **The lock between one customer's data and another's isn't in your code** — it's database settings you can't see in your repo, can't code-review, and can't restore if lost. A one-line mistake there silently exposes everyone. (C2/S1)
5. **Your "locked" API doors still open for a script.** The locks only check *browsers*; a plain `curl` with no Origin header walks right through `notify`/`push`. (H2)
6. **A stranger can ask "is this phone number one of your clients?" and get a yes + a name** — no login required. Competitors can size your book; bad actors can target your clients. (H1)
7. **A "blocked" client can still book** — blocking only hides them in your screen, the server doesn't enforce it. (M5)
8. **Your privacy policy promises things the app can't do on demand** (give a customer their data / delete it) — and "deleting" a client still leaves their name & phone inside past appointments. (S9)
9. **You're not keeping proof that customers agreed to texts.** Carriers and the law want a timestamped record, not just the words on your booking page — especially with your text number in carrier review. (H6)
10. **Photos are stored as text *inside* the database rows.** Every save re-uploads everything; rows bloat; your bill and your app's speed quietly degrade. (H3)
11. **The staff password is printed in plain text inside the app anyone can download.** (M8)
12. **The app loads every client and all history into the phone's memory when it opens.** Fine at 50 clients; painful at 5,000; a problem across thousands of shops. (S5/S7)
13. **There's no "undo" for bad data** — you can roll back *code*, but a buggy save that mangles data is permanent (made worse by #2). (DR)
14. **One outage = whole business offline**, including customers who can't even log in (their email codes depend on the same vendor). (single point of failure)
15. **A public endpoint will fetch any web address you hand it**, including your own cloud's internal admin address (SSRF). (M3)
16. **Nobody is rate-limiting your text/email bill.** Someone can run it up for fun. (M7)
17. **The whole front-end is one 20,000-line file.** It works, but any engineer you hire (or acquirer who reviews it) will wince — and it raises the odds of a subtle break under change.
18. **The moment a second shop signs up, your legal docs are wrong for them** (they name only your shop) — and you still have no way to bill them.
19. **Your Stripe webhook trusts events without checking the signature** — replayable. (M1)
20. **"Works for me at the front desk" ≠ "works at 2am when a job times out halfway through."** Several jobs silently stop partway and the later work just never happens. (S5/M4)

---

## Recommended priority order

### Do before YOU take real bookings (the [NOW] list)
1. **C1 — Turn on backups** (Supabase Pro) — already your #1 pre-launch gate.
2. **H4 — Schedule the `send-reminders` cron** (one line in `vercel.json`) so reminders actually send. *(SMS still gated on carrier approval; email works once scheduled.)*
3. **H2 — Close the `curl` doors** on `notify`/`push` (reject missing-Origin; require an internal secret) — quick, high-value.
4. **H1 — Stop anonymous client enumeration** (booking phone-path + `/api/client-code` generic responses) — needs an RPC tweak; pair with the DB-dump step.
5. **H5 — Add server-side error alerts** to `api/*` + capture failed saves to Sentry.
6. **H7 / C2 partial — Capture the DB schema** (`supabase db dump`) and audit `verify_client_code` (brute-force cap) + the RLS policies. This unblocks several ⚠️ items.
7. **H6 — Persist a consent record** at booking (timestamp + version) — cheap TCPA insurance.
8. **H3 / M6 — Cap photo count/size + text length server-side** in the public RPCs.
9. Then the Mediums: M1 (webhook signature), M3 (SSRF guard), M5 (server-side blocked-check), M8 (`avenue2026`), M2 (sale_intent), L2 (delete `sync-status.js`).

### Do before you sell to a 2nd shop (the [SAAS] list)
S1/S4 tenant isolation (RLS on all verbs + `assertMember()` on every `api/` shop param) · S2 owner-RPC ownership checks · S3 build subscription billing · S9 compliance (export, deletion, DPA, multi-tenant policy, retention) · S5 cron sharding · S6 sanitized public settings · S7 incremental saves/sync.

---

*Generated by a multi-pass code-grounded audit on 2026-06-23. Items marked ⚠️ VERIFY-IN-DB require the Supabase schema/RLS/RPC dump to confirm — that dump is itself action #6 above.*
