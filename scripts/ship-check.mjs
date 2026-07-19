#!/usr/bin/env node
// Pre-flight check — run BEFORE every production deploy.
//   npm run ship-check
//
// Catches the three things that can break a deploy or compliance, in one shot:
//   1) The production build compiles (vite build exits clean).
//   2) The SMS-consent phrase appears EXACTLY 4 times in src/App.jsx
//      (10DLC / toll-free carrier vetting requires this — drift can jeopardize
//      the SMS verification).
//   3) The api/ folder has AT MOST 12 serverless functions (Vercel Hobby plan
//      limit — exceeding it makes the production deploy FAIL, as happened
//      2026-06-23 when a 13th function was briefly added).
//   4) No secret keys are hardcoded in src/ or api/ (Stripe secret/restricted/
//      webhook keys, Supabase secret key). These must live ONLY in Vercel env —
//      shipping one in source would expose it to anyone who views the bundle.
//      (Public keys like pk_live_ / sb_publishable_ are fine and NOT flagged.)
//
// Exits 0 only if all pass, non-zero otherwise — so it's safe to chain:
//   npm run ship-check && npx vercel --prod --force
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONSENT_PHRASE = "reminders from Sanctuary Barber Co";
const CONSENT_REQUIRED = 4;
const MAX_FUNCTIONS = 12;

const results = [];
const record = (ok, label, detail) => results.push({ ok, label, detail });

// 1) Production build compiles.
try {
  execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
  record(true, "Build compiles", "vite build exited clean");
} catch (e) {
  const out = ((e.stdout?.toString() || "") + (e.stderr?.toString() || "")).trim();
  const tail = out.split("\n").slice(-6).join("\n");
  record(false, "Build compiles", "vite build FAILED:\n" + tail);
}

// 1b) Unit tests pass — the money/logic resolver safety net (pricing, duration, order, cancel-window).
//     Runs the real resolver code extracted live from src/App.jsx; a regression here blocks the deploy.
try {
  execSync("node --test tests/*.test.mjs", { cwd: ROOT, stdio: "pipe" });
  record(true, "Unit tests pass", "resolver safety net green");
} catch (e) {
  const out = ((e.stdout?.toString() || "") + (e.stderr?.toString() || "")).trim();
  const fails = out.split("\n").filter((l) => l.trim().startsWith("not ok")).slice(0, 10).join("\n");
  record(false, "Unit tests pass", "node --test FAILED:\n" + (fails || out.split("\n").slice(-10).join("\n")));
}

// 2) Consent phrase appears exactly N times.
try {
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const count = app.split(CONSENT_PHRASE).length - 1;
  record(count === CONSENT_REQUIRED, `Consent phrase ×${CONSENT_REQUIRED}`,
    `found ${count}× "${CONSENT_PHRASE}"` + (count === CONSENT_REQUIRED ? "" : ` — expected exactly ${CONSENT_REQUIRED}`));
} catch (e) {
  record(false, `Consent phrase ×${CONSENT_REQUIRED}`, "could not read src/App.jsx: " + e.message);
}

// 3) api/ serverless function count within the plan limit.
const countApiFiles = (dir) => {
  let n = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) n += countApiFiles(p);
    else if (entry.endsWith(".js")) n += 1;
  }
  return n;
};
try {
  const fnCount = countApiFiles(join(ROOT, "api"));
  record(fnCount <= MAX_FUNCTIONS, `Serverless functions ≤ ${MAX_FUNCTIONS}`,
    `${fnCount} function file(s) under api/` + (fnCount <= MAX_FUNCTIONS ? "" : ` — over the limit by ${fnCount - MAX_FUNCTIONS}; fold one into an existing endpoint`));
} catch (e) {
  record(false, `Serverless functions ≤ ${MAX_FUNCTIONS}`, "could not scan api/: " + e.message);
}

// 4) No hardcoded secret keys in source (src/ + api/). Public keys (pk_live_,
//    sb_publishable_) are intentionally inline and are NOT in this list.
const SECRET_PATTERNS = [
  { re: /\bsk_live_[A-Za-z0-9]/, label: "Stripe LIVE secret key (sk_live_)" },
  { re: /\bsk_test_[A-Za-z0-9]/, label: "Stripe test secret key (sk_test_)" },
  { re: /\brk_live_[A-Za-z0-9]/, label: "Stripe restricted key (rk_live_)" },
  { re: /\bwhsec_[A-Za-z0-9]/, label: "Stripe webhook signing secret (whsec_)" },
  { re: /\bsb_secret_[A-Za-z0-9]/, label: "Supabase secret key (sb_secret_)" },
];
const CODE_EXTS = [".js", ".jsx", ".ts", ".tsx", ".mjs"];
const walkCode = (dir) => {
  let files = [];
  let entries;
  try { entries = readdirSync(dir); } catch (e) { return files; }
  for (const entry of entries) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) files = files.concat(walkCode(p));
    else if (CODE_EXTS.some((x) => entry.endsWith(x))) files.push(p);
  }
  return files;
};
try {
  const findings = [];
  for (const d of ["src", "api"]) {
    for (const f of walkCode(join(ROOT, d))) {
      const txt = readFileSync(f, "utf8");
      for (const { re, label } of SECRET_PATTERNS) {
        if (re.test(txt)) findings.push(`${label} in ${f.replace(ROOT + "/", "")}`);
      }
    }
  }
  record(findings.length === 0, "No hardcoded secrets in source",
    findings.length ? findings.join(" · ") : "scanned src/ + api/ — clean");
} catch (e) {
  record(false, "No hardcoded secrets in source", "scan error: " + e.message);
}

// 5) Regression lock — previously-shipped fixes that already regressed and cost the owner trust.
//    Each marker is STABLE CODE that must stay present in src/App.jsx; if a future edit removes one,
//    this check FAILS and blocks the deploy, so a "done" fix can't silently un-ship. Add to this list
//    whenever you fix a painful regression you never want to come back.
const GUARDS = [
  { needle: "table === 'providers' && rows.length", label: "staff email/phone save-backstop (never blank on save)" },
  { needle: "!hasStoredSession()", label: "staff email/phone load-gate (sanitized feed can't overwrite owner)" },
  { needle: "setTabNonce(", label: "bottom-tab tap resets to tab root" },
  { needle: "per-barber-pricing-lock", label: "per-barber price/time overrides on library questions & add-ons (service editor)" },
  { needle: "apptHoldsSlot", label: "single busy-slot rule — a shown booking time is always bookable (no false 'just taken')" },
  { needle: "pendingSaveRef", label: "flush pending saves on app-background (a checkout/edit can't be lost to an iOS swipe-away)" },
  { needle: "onCommit(appt.id, summary)", label: "checkout commits done+paid the moment 'All done' shows (not after the closing dwell)" },
  { needle: "tableBusy(", label: "session-keyed loads can't clobber a mid-save local edit (uid-keyed + busy guard)" },
  { needle: "hydrateFromCache(", label: "offline read-cache — an outage shows the last-synced calendar, never a blank screen" },
  { needle: "GUARD: login-fail-open", label: "login/auth gate fails OPEN — a failed/slow/timed-out session check can never grey out the sign-in button or brick the app" },
  { needle: "GUARD: cancel-window-lock", label: "client change/cancel window enforced everywhere — one resolver (12h default; leadTimeMin:0 can't zero it) + re-checks at action time, not just render" },
  { needle: "GUARD: conflict-next-slot-from-start", label: "conflict popup suggests the TRUE next opening — scan from the attempted start with the moved appt excluded (9:20-instead-of-9:10 bug)" },
  { needle: "outage-honest-menu", label: "public booking shows an honest 'can't load — call us' state on a failed menu load, never the DEFAULT_SERVICES demo menu masquerading as the shop's real one" },
  { needle: "loadWatchdog", label: "initial-load hang watchdog — a HANGING backend (compute-exhausted outage: requests never resolve OR reject) still forces a terminal state so the honest-menu gate fires, instead of sitting on the demo menu forever" },
  { needle: "bookTimeout", label: "booking-submit hang timeout — book_public is raced against a timeout so a hanging backend surfaces the honest 'couldn't confirm — tap again' error instead of a 'CONFIRMING…' spinner that never ends" },
  { needle: "PREBOOK_RPC_TIMEOUT_MS", label: "pre-book RPC hang timeout — the lookups + save_booking_client that run BEFORE book_public are time-boxed, so the earliest hang can't strand the submit before the book_public honest-error timeout is ever reached (root cause: bookTimeout was unreachable during a real hang)" },
  { needle: "withRpcTimeout", label: "shared RPC hang timeout — the manage-your-appointment link (lookup/cancel/reschedule/check-in) races Supabase against a timeout, so a hanging backend surfaces the honest error instead of an endless spinner (root-cause fix for the no-timeout hang class)" },
  { needle: "mirrorWatchdog", label: "staff-calendar mirror hang watchdog — a hanging backend (auth refresh / sync-pull / direct reads all hang) still reaches hydrateFromCache so staff see the last-synced calendar + an honest 'showing last synced' banner instead of being stranded mid-load" },
  { needle: "cross-device-sync", label: "staff cold-start never seeds demo appts / block the first server pull (iPad must see iPhone bookings)" },
  { needle: "fetchStaffTable", label: "staff table reads refresh stale iOS JWT before pull (iPad empty calendar/clients)" },
  { needle: "Sync problem on this device", label: "sync-gap banner when cloud has data but device shows empty" },
  { needle: "mirrorFromServer", label: "staff calendar mirrors server via api/sync-pull" },
  { needle: "blocked empty save", label: "never push empty clients/appts when server has rows" },
  { needle: "the whole shop shares one calendar", label: "all staff see every chair by default (Heather sees Dan bookings)" },
  { needle: "sync-pull allows read for valid login on small shops", label: "micro-shop sync-pull auth for Dan+Heather without provider emails on file" },
  { needle: "mergeLocalOverServer", label: "non-calendar tables still merge on refetch (waitlist/services)" },
  { needle: "flushApptsNow", label: "check-in/book/checkout save to server immediately" },
  { needle: "time blocks must flush immediately", label: "time block confirm flushes to server immediately (2s mirror stomp)" },
  { needle: "apptsRef.current", label: "server mirror merges against latest local appts (stale-closure guard)" },
  { needle: 'mode: "save"', label: "appointments/clients save via api/sync-pull service-role (iPad RLS write fix)" },
  { needle: "deletion-aware merge", label: "server mirror respects local deletes and server deletes (no resurrect)" },
  { needle: "server-authoritative-sync", label: "idle calendar sync replaces from server — no client merge" },
  { needle: "syncGuardRef", label: "auto-refresh waits for unsaved work before hard-reload during saves" },
  { needle: "mergeApptRow", label: "completed checkout beats stale in-service on cross-device sync" },
  { needle: "card-on-file-verified-only", label: "a saved card-on-file (brand + last-4) shows ONLY to a verified/signed-in client — never to an unverified booker who typed a matching phone (card disclosure + enumeration hole)" },
  { needle: "GUARD: calendar-sync-contract", label: "calendar sync contract comment block (server-authoritative model)" },
  { needle: "applyServerMirror = applyServerAuthoritative", label: "mirror pull uses authoritative replace, not merge" },
  { needle: "scheduleRtMirror", label: "realtime calendar pulls debounced when idle" },
  { needle: 'tableHasUnsavedWork("appointments") || tableHasUnsavedWork("clients")', label: "mirror skips while calendar edits are pending" },
  { needle: "deleteAppt flushes immediately", label: "deleteAppt calls flushApptsNow (cross-device delete)" },
  { needle: "service-order-dataloss", label: "services save never blanks an `order` the server has (stale device can't revert/reshuffle the menu)" },
  { needle: "byServiceOrder", label: "one deterministic menu sort (order + id tiebreak) — a missing order can't reshuffle the menu across loads" },
  { needle: "Home barber from history", label: "migration importer derives each client's home barber from their imported visit history (most-seen barber, ties→most recent) instead of defaulting everyone to one staff member — verified live on vero-mig, no unit test covers it" },
  { needle: "impPhone(p.phone)", label: "imported client phones normalized to 10-digit (impPhone) so returning-client recognition — the login-code lookup that matches on raw digits — works; a country-code prefix would silently break 'I've been here before' for every migrated client" },
  { needle: "owner-access-fail-safe", label: "the owner NEVER loses the Settings tab to a degraded providers load — the sanitized get_public_providers feed omits pulseRole, so isOwner must fall back to a confirmed-owner flag when the feed contains no owner at all (the 'my Settings vanished' lockout)" },
  { needle: "PGREST_PAGINATE_ALL", label: "MasterCalendar pages appointments with .range() — an unranged PostgREST .select() caps at 1000 rows, so a shop past 1,000 total appts would silently miss days (same 1000-row truncation that hid clients past 1,000 in the staff list)" },
  { needle: "GUARD: access-lockdown", label: "only shop members (canAccessShop) can open the business dashboard — a sync-pull 403 shows the AccessDenied screen instead of the dashboard shell, with a per-email fail-open (any email that ever loaded is never blocked) so a transient 403 can't lock a real owner out" },
  { needle: "GUARD: sale-intent-idempotent", label: "in-person card sale (CardChargeInline + Register) caches ONE PaymentIntent per amount and reuses it on retry, so a Charge tapped again after a dropped/uncertain response re-confirms the same intent (no-op once succeeded) instead of double-charging the client" },
  { needle: "GUARD: nudge-real-send", label: "the rebook 'Nudge' actually POSTs to /api/notify and only marks the client handled + toasts 'sent' on a real success — it used to toast a false 'Rebook text sent' and hide the client while sending nothing" },
  { needle: "GUARD: report-deleted-service-safe", label: "Per-Barber report resolves the top-service display NAME at the source (falls back to 'Removed service' when services.find is undefined), so a service deleted from the menu after being booked can't white-screen the report on r.topService.svc.name" },
  { needle: "import-consent-from-column", label: "the migration importer reads SMS consent from the export's marketing-texts column (Yes → consent, blank/no → opt-out, no column → unknown) — it must NEVER fabricate smsConsent:true for everyone (10DLC/TCPA: forged consent records)" },
  { needle: "consent-reenables-sms", label: "when a returning client (incl. an imported no-consent client) checks the SMS box at booking, both re-book paths (existing-reuse AND matched) clear smsOptOut and record fresh consent — without this the ~700 non-opted-in imports stay permanently un-textable even after they opt in (resolveChannels gates on !smsOptOut, not on consent)" },
  { needle: "cut-styles-toggle", label: "each service has an 'Offers cut styles' toggle that adds/removes the shared cut question — turning it on seeds the styles from another haircut service (defined once), off removes the group; it persists immediately so the hub toggle sticks. Removing this loses per-service control over which services show cut styles." },
  { needle: "cut-styles-global", label: "cut styles are shared across haircut services — saving a service propagates its style DEFINITIONS (label/desc/+price/+time, by option id) to every other service that offers cut styles, so they're defined once. It never touches per-barber overrides (staff.answerPrice/answerDur) and never adds/removes the group. Removing this makes styles drift out of sync per service again." },
  { needle: "cut-styles-clean", label: "cut styles have a clean first-class editor that RE-SKINS the existing 'cutchoice' question — it reads/writes the same addonGroup.options + staff.answerPrice/answerDur so the pricing engine (answerPriceFor/answerDuration → locked appt.price) is untouched, and the cut question is hidden from the bulky add-ons view so it isn't edited twice. Removing this reverts to the confusing question/answer form." },
  { needle: "addon-required-default", label: "a required add-on QUESTION on the booking cut-flow blocks Continue unless it's EXPLICITLY optional (required:false) — same default as choice questions and the staff side. Without this, a legacy/library add-on with required:undefined (e.g. 'Hot towel finish?') let clients skip the screen without answering. Removing it re-opens the 'book without answering a required question' gap." },
  { needle: "sms-consent-optional", label: "SMS consent is OPTIONAL at booking — only the cancellation policy gates the booking. The SMS toggle still LOOKS required (label + styling) to nudge opt-in but must never block a booking, so an opted-out/privacy client can still book & rebook. A new client who DECLINES is recorded smsOptOut:true so we never text without consent. Removing this either re-blocks opt-out clients from booking OR texts a non-consenter (10DLC/TCPA)." },
  { needle: "GUARD: cancel-notify-wired", label: "a client cancellation (home-screen AND manage-link paths) emails the client the 'canceled' notice AND fires a biz in-app push — it used to notify no one on the home cancel and only the client on the manage-link cancel" },
  { needle: "GUARD: cancel-bell-through-sync", label: "a cancellation rings the owner's in-app bell even when it arrives via sync — a client canceling online must land in the feed, not be silently swallowed by the mirror-flood suppression that gates other change kinds" },
  { needle: "fire-staff-channels", label: "every staff alert routes to the owner's chosen channels — fireStaffPush sends in-app push AND (per teamCh) emails/texts the barber only for the channels turned on per event; it must never revert to push-only (drops the barber's email/text) or always-send (surprise SMS charges + spam)" },
  { needle: "sale-recover-succeeded", label: "the dropped-response double-charge window is closed — before re-charging a held intent (checkout, Register, deposit manual + wallet), recoverSucceededIntent() asks Stripe if it ALREADY succeeded and records it as paid instead of minting/confirming a second charge; removing this reopens a real double-bill when the network drops mid-confirm" },
  { needle: "outbox-payment-durable", label: "a sale's ledger record is backed by a durable localStorage outbox that survives reload/kill and re-lands on reconnect, and paidForAppt/startCheckout read it — so a payment whose write failed can never let a reopened ticket re-charge the client; removing it reopens the offline-save double-charge gap" },
  { needle: "calendar-custom-price", label: "booking a client from the day calendar (commitAppt) applies their per-client customPrices — it used to ignore them and lock the DEFAULT price onto the appt, charging a custom-rate client the wrong price at checkout (duration honored the override but price didn't)" },
  { needle: "refund-record-actual", label: "a card refund records the amount STRIPE ACTUALLY refunded (res.amount), not the amount typed — both refund paths; the authoritative figure was being discarded, so the ledger could silently drift from the processor" },
  { needle: "provider-photo-hours-revert", label: "providers/services/waitlist use LIVE refs (providersRef/servicesRef/waitlistRef) in localTableState — a realtime refetch used to merge a STALE closure over the server and re-save it, reverting a just-saved staff photo/hours edit; reverting this reopens the 'edits don't stick' bug (appts/clients already use refs for the same reason)" },
  { needle: "sheet-dvh-scroll", label: "_SHEET.wrap sizes to 100dvh (not inset:0) so the pinned foot/Save button stays on-screen on iOS mobile web — inset:0 resolves against the tall layout viewport and pushes Save below the visible area with no way to scroll to it (the calendar Edit-hours / TimeBlock sheets)" },
  { needle: "hours-sheet-stable-identity", label: "DayEditSheet + RepeatPopup are MODULE-LEVEL components (stable identity), rendered with a per-day key — so a background realtime re-render of StaffMembersView can't remount them mid-edit and silently wipe the in-progress staff-hours draft / reset scroll; inlining them again (const X = () => {}) reopens that edit-loss bug" },
  { needle: "function smsLink(number, body, isIOS)", label: "running-late tap-to-text: the sms: deep-link builder (iOS &body= vs Android ?body=, US +1 normalize, body always encodeURIComponent'd) — pure + platform-explicit so it's unit-tested in tests/smslink.test.mjs; removing it breaks the barber-texts-from-their-own-phone running-late flow" },
  { needle: "running-late-taptext", label: "the running-late 'let them know' prompts (Pulse in-chair card AND the appointment sheet) open the BARBER's own Messages app pre-typed — the barber hits send. NOTHING is sent automatically, so it deliberately never gates on smsOptOut (a human texting from their own phone isn't our automated marketing). Reverting to fireRunningLate/api-notify re-introduces the opt-out gate and the false-'Sent' class of bug" },
  { needle: "visit-stamp", label: "a completed checkout stamps the client — advances lastVisit + bumps visits ONCE per appt (gated by visitCountedAt so a reopened/re-paid ticket never double-counts; lastVisit only moves forward). Both commit paths (commitCheckout + commitCheckoutLite) use stampVisitOnClient. Without it the rebook/overdue radar never builds from live checkouts (only imported clients had lastVisit). Unit-tested in tests/visit-stamp.test.mjs" },
  { needle: "cadence-auto", label: "a client's rebook cadence (cadenceDays) is auto-derived from their visit gaps at checkout (deriveCadenceForClient — same formula as the importer/card/checkout), so the overdue/rebook radar fires for live clients who never had one set. Only writes when derivable (>=2 visits) so it never nulls an existing cadence. Removing it leaves live clients invisible to the radar forever" },
  { needle: "g.type === \"choice\" && g.setsPrice", label: "new-menu pricing engine: a choice group flagged setsPrice makes the SELECTED cut style's ABSOLUTE per-barber price/time REPLACE the base (each cut its own total — no base, no add-on increment, kills the doubling bug). Wired identically at all 4 compute sites (online lineTotal, staff booking display, staff commitAppt, appt-edit staffItemCalc); resolvers choiceStylePrice/choiceStyleDuration are unit-tested. Removing any wiring makes a migrated service price differently in different places" },
  { needle: "promote-inline-addons", label: "any hand-built inline add-on auto-folds into the ONE shared Add-ons library (shows in the list + attachable to any service) via promoteInlineAddOns — self-healing on owner load, add-on-ONLY (never touches the cut-style/setsPrice choice group), preserves price/time AND re-keys per-barber overrides (addonPrice/addonDur) old id → lib- id so a barber's custom price can't be orphaned, backs up _preAddonLib. Also: consolidateBookingLibraries must SKIP id 'cutchoice'/setsPrice choice groups so the broad fold can't reprice cuts. Removing either reopens 'add-ons don't sync to the list' or silently reprices" },
  { needle: "taptopay-tap-then-tip", label: "Tap to Pay on iPhone uses TAP-THEN-TIP like the card reader — startMethod routes an in-person 'tap' to authorize the base first (runTapToPayAuth → tapToPayAuthorize, MANUAL capture, sets the same readerAuth), THEN the tip screen, THEN capture base+tip via the shared captureReaderTip. Reverting 'tap' to an immediate tapToPayCharge puts the tip screen BEFORE the tap again. Money path — an abandoned hold expires on its own; a PaymentIntent captures once, so no double-charge" },
  { needle: "newappt-null-service", label: "the calendar '+ New' appointment form opens with NO service picked (service === null); its baseDur/basePrice must stay guarded (`!service ? 0 : …`) because getDuration/getPrice/priceWithTimeRules read service.* and throw on null. Removing the guard crashes the whole New-appointment screen on open (getDuration/getPrice are now also null-safe as a backstop, but the call-site guard is the fix)" },
  { needle: "usual-full-duration", label: "the returning-client 'book your usual' screen sizes its offered slot to the FULL visit — lineTotal(usualEntry).min (base + cut style + add-ons) + overdue courtesy — not the bare service length. Reverting to getDuration(base) reopens the bug where the offered opening is too short for what actually gets booked (real reservation uses effMin, which includes the cut style + add-on minutes)" },
  { needle: "perbarber-migrate", label: "opening a cut service in the editor migrates it to the per-barber ABSOLUTE model (migrateCutServiceToPerBarber): every (barber, style) gets its CURRENT effective price+time written into staff.choicePrice/choiceDur and the group flagged setsPrice, using the SAME resolvers the live engine uses so NOT ONE price/time moves. Proven in scripts/perbarber-migration.test.mjs. Removing it means the editor reads nothing for per-barber styles (blank/reset prices)" },
  { needle: "perbarber-save", label: "save() preserves the per-barber absolutes the editor edits (flagCutStyleSetsPrice only flags the cut group setsPrice; it must NOT recompute prices from a shared base). Reverting to a base+add recompute on save would WIPE each barber's own price → mischarge. The booking/checkout engine reads staff.choicePrice/choiceDur when setsPrice is set" },
  { needle: "addon-lib-perbarber", label: "an add-on's per-barber price/time is set ONCE in the Add-ons library (business.addOnsLibrary[i].staff), stamped onto every service's lib- group as item.staff, and addonPriceFor/addonDuration read item.staff[pid] FIRST (before the legacy per-service staff.addonPrice and the shop-wide item.price). All 4 sites that build a lib- add-on group's item (AddOnsEditor.materialize, consolidateBookingLibraries, NewAppointmentForm, promoteInlineAddOns) must carry item.staff or a re-materialize silently drops per-barber → shop-wide charge. Provider-known displays (client confirm sheets, staff form) resolve via addonPriceFor so shown price == charged price. Unit-tested in tests/resolvers.test.mjs" },
  { needle: "perbarber-fallback", label: "choiceStylePrice/choiceStyleDuration fall back to base + the style's increment (getPrice + opt.price / getDuration + opt.min) when a barber has NO per-barber absolute for that style — a brand-new style, a new hire, or an 'anyone' booking. Reverting to returning the bare opt.price/opt.min charges $0 for a standard cut / books a 0-minute appt (caught by the money-path review pre-launch). Seeded per-barber absolutes still win first, so migrated prices are unchanged. Unit-tested in tests/perbarber-migration.test.mjs" },
  { needle: "addon-no-autosheet", label: "picking an ADD-ON in online booking never auto-opens the read-first pickConfirm modal — the client answers Yes/No inline like a bare add-on (e.g. 'Want a facial?'). The selection is recorded independently, so the popup was purely informational; its removal changes nothing charged. Cut styles (pickChoice) keep the read-first sheet on purpose. Re-adding a setPickConfirm call to answerRequired reopens the 'add-ons pop a window' annoyance Dan flagged" },
  { needle: "blocked-online-guard", label: "a client the owner blocked from online booking can't book — the public booking ALWAYS hands book_public a p_client identity (id/phone/email) so its server-side blocked-client guard fires, and a client_blocked error shows the discreet 'booking unavailable' notice. Root cause it fixes: a blocked client already on file can't sign in, books as 'new', the phone/email lookup returns their id, and the app used to send p_client=null → the guard (`if p_client is not null`) was skipped → they booked. Removing this reopens that hole (server-side belt: db/block-online-appts-guard-2026-07-16.sql adds the p_appts.clientId check)" },
  { needle: "calendar-locked-header", label: "the calendar day-strip + staff-name band stays LOCKED at the top while only the appointment grid scrolls. Root cause it fixes: document-level position:sticky drifted mid-scroll in the iOS app and let grid content bleed ABOVE the strip. The calendar frame is now a fixed-height flex column (calFrameH = viewport − frame top, re-measured on resize) whose header band is flex-shrink:0 and whose grid lives in its OWN flex:1 overflow-y:auto scroller — so the header is physically un-scrollable on every engine. Paired with the tab wrapper dropping its 120px bottom padding for the calendar tab so the page itself can't scroll. Reverting to sticky reopens the drifting-dates bug Dan flagged" },
  { needle: "checkout-price-currency", label: "the checkout line-item 'Edit price' field reads like money ($-prefixed) and never shows a raw leading-zero value like '042' — PriceEditField sanitizes the DISPLAY draft (digits + one decimal, leading zeros stripped) while committing a defensively-parsed number (Math.max(0, Number())), so display formatting can never corrupt the saved price. Reverting to the raw <input type=number> reopens the '042' ugliness Dan flagged" },
  { needle: "status-revert-guard", label: "a checked-in / in-service appointment can't silently revert to 'confirmed'. Root cause: a server mirror (point-in-time READ) that started BEFORE a local status write lands late and REPLACEs the fresh status with its stale snapshot (TOCTOU). applyServerAuthoritative now takes guardSince (the mirror's read-start time) and DROPS the apply if a local write landed/pending after it (tableHasUnsavedWork OR lastSaveAt > guardSince); the SAVE path applies without guardSince so its own fresh copy always wins. Dropped stale mirror reconverges on the next heartbeat. Do NOT switch to a 'higher-stage-wins' merge — that breaks legitimate backward moves (a refund resets done→confirmed)" },
  { needle: "photo-import-safe", label: "taking a client-card photo can't white-screen the app. importImageFile decodes the File directly (no giant base64), downsamples via createImageBitmap, and guards EVERY failure (onerror/try-catch) so a huge iPhone photo can't jetsam-kill the WKWebView, and a failure shows a toast instead of crashing. All three capture paths (client photo, gallery, wrap-up timeline) use it. Reverting to the raw FileReader+new Image()+drawImage reopens the crash Dan hit" },
  { needle: "calendar-status-colors", label: "calendar tiles are colored by STATUS (Mango-style): teal=confirmed, purple=in-lobby/checked-in, pink=in-service, grey=done/paid — not by per-service color. Dan explicitly asked to clone Mango's status colors; reverting to service-color tiles undoes it" },
  { needle: "client-name-tap", label: "tapping a client's name in the appointment sheet opens their client card for a saved client, and shows an honest 'walk-in/guest — no saved card' toast otherwise, instead of a silent dead tap (Dan: 'nothing happens'). The buttons are enabled whenever onOpenClient exists (not only when a client record resolves)" },
  { needle: "mirror-noop-skip", label: "a server mirror/save-response that returns data IDENTICAL to what's on screen (the echo of your own write, or the idle 30s heartbeat) must NOT replace state — applyServerAuthoritative only calls setClients/setAppts when sameRowset says the rows actually changed. Root cause it fixes: an unconditional setClients(2977)+setAppts(886) forced a full calendar re-render + ~5MB re-serialize on every sync tick, so a status tap took ~10s to recolor and the calendar was slow to open. sameRowset is order-insensitive on object keys (JSONB reorders them) and order-sensitive on rows; a real change always applies. Reverting to the unconditional replace reopens the calendar-freeze Dan flagged" },
  { needle: "staff-load-paginate", label: "the degraded fallback staff load (fetchStaffTable) PAGES through every row instead of stopping at PostgREST's 1000-row cap. ROOT: an unranged .select() silently truncates to 1000, so past ~1000 appts a degraded-connection load would drop rows — and a truncated synced set flowing into api/calendar-pull's delete step could mass-DELETE real synced/paid appointments beyond the cap. Paired defense-in-depth: api/calendar-pull mode:'sync' has a delete-rail (never removes > max(5, ~34%) of synced rows in one call — a big toDelete can only be truncation since the client reconcile keeps everything on a genuine big removal). Removing the paging reopens the silent data-loss-at-scale. Unit-tested in tests/staff-load-paginate.test.mjs" },
  { needle: "synced-appt-preserve", label: "an imported (iCal) appointment you've WORKED — a client attached, a non-'confirmed' status (checked in / in service / done / no-show), checked in/out, paid, or line items — is a REAL appointment that a re-import (daily cron api/calendar-run.js OR in-app Sync) must NEVER overwrite or delete. ROOT: toAppt in reconcileFeed (src/App.jsx) + reconcileFeedServer (api/calendar-run.js) rebuilt every existing synced appt from scratch (clientId:null, status:'confirmed'), so marking a synced appt done — or checking a client out on one — reverted to 'confirmed' and lost the checkout/client on the very next sync. Fix preserves a worked appt verbatim on re-import and keeps (never cancels) a worked appt whose outside event vanished. BOTH copies must stay in lockstep (the toAppt comment says so). Unit-tested in tests/synced-appt-preserve.test.mjs. Removing it reopens the done→confirmed revert + checkout/client data-loss on synced appts" },
  { needle: "checkin-durable", label: "a checked-in / in-progress visit can never be silently lost — check-ins get the SAME durability the payment outbox gives a sale. Root cause (Dan, 2026-07-18, 40 min wiped): check-in was a fire-and-forget save; when that write was blocked (cache-degraded mode, loadedRef=false) or dropped (flaky wifi), the in-service status + start time lived only in memory and the next server-authoritative mirror rolled the appt back to 'confirmed'. A durable localStorage record (reconcileCheckinOutbox) of any in-service visit the server baseline hasn't acknowledged is OVERLAID onto every server→local appt apply (applyServerAuthoritative, hydrateFromCache, refetchTable) so a stale read can't downgrade a live visit, and a drain re-saves until the server confirms it. The pending set is DERIVED from live state, so a deliberate reset/checkout/cancel drops itself and a reset/paid ticket is never resurrected (money-safe). Unit-tested in tests/checkin-durable.test.mjs. Complements status-revert-guard (that closes the short TOCTOU window; this closes the write-never-landed gap). Removing it reopens the vanishing-timer bug" },
  { needle: "timer-reset-on-revert", label: "moving an appt BACK to a pre-service status (confirmed / in-lobby / unconfirmed) clears the running-timer fields (serviceStartedAt/serviceEndedAt/pendingDurationSave) via statusPatch. Root cause (Dan): the elapsed timer derives purely from serviceStartedAt, and the check-in path only stamps it when `!serviceStartedAt`; a revert that left the old timestamp meant the next 'Start service' KEPT it, so the timer continued instead of restarting. reconcileCheckinOutbox respects the deliberate local downgrade so the durable-checkin overlay won't resurrect the old start. Matches the reset the refund→confirmed paths already do. Removing it reopens the 'timer won't start over after going back to Confirmed' bug" },
  { needle: "done-durable", label: "a COMPLETED (status 'done') appointment can never silently revert to 'confirmed' on a deploy/reload. Root cause (dry run, owner): a 'done'/checkout status write persists only via flushApptsNow/debounce, both gated on loadedRef+session+staffApptsLoaded — so in cache-degraded mode (loadedRef=false) or on a dropped write the 'done' lives only in memory, and the reload's applyServerAuthoritative REPLACES it with the server's stale 'confirmed' (reconcileCheckinOutbox protects only in-service; it treats 'done' as landed). Same fix shape as checkin-durable but for the terminal state: a durable localStorage record (reconcileDoneOutbox) of any locally-'done' appt the server baseline hasn't stored as done is OVERLAID onto every server→local apply (applyServerAuthoritative, hydrateFromCache, refetchTable) and re-saved by a drain until the server confirms it. DERIVED from live state so a refund/undo (no longer 'done' locally) drops itself — a legitimate done→confirmed is never blocked — and a 24h DONE_PROTECT_MS cap lets a genuine cross-device reversal reconverge. Money (paid) is untouched (its own outbox). Unit-tested in tests/done-durable.test.mjs. Removing it reopens the deploy-reload done→confirmed revert" },
];
try {
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const missing = GUARDS.filter((g) => !app.includes(g.needle)).map((g) => g.label);
  record(missing.length === 0, "Regression lock (shipped fixes intact)",
    missing.length ? "REMOVED: " + missing.join(" · ") + " — a shipped fix was deleted; restore it before deploy" : `all ${GUARDS.length} guarded fixes still present`);
} catch (e) {
  record(false, "Regression lock (shipped fixes intact)", "could not read src/App.jsx: " + e.message);
}

// 6) Calendar sync contract — structural checks beyond string needles (the #1 shop-critical path).
try {
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const syncPull = readFileSync(join(ROOT, "api/sync-pull.js"), "utf8");
  const calFails = [];
  const authFn = app.match(/const applyServerAuthoritative = \(payload(?:, guardSince)?\) => \{[\s\S]*?\n  \};/);
  if (!authFn || authFn[0].includes("mergeLocalOverServer")) {
    calFails.push("applyServerAuthoritative must REPLACE server rows (no mergeLocalOverServer)");
  }
  if (!/server-authoritative-sync: appointments\/clients replace from server when idle/.test(app)) {
    calFails.push("refetchTable must replace appts/clients from server when idle");
  }
  if (!/if \(table === "appointments" \|\| table === "clients"\)[\s\S]*?deleteIds: toDelete/.test(app)) {
    calFails.push("appointments/clients saves must go through api/sync-pull mode:save with deleteIds");
  }
  if (!syncPull.includes('mode === "save"') || !syncPull.includes("const clients =") || !syncPull.includes("const appointments =")) {
    calFails.push("api/sync-pull save must return fresh clients + appointments after write");
  }
  if (!/const deleteAppt[\s\S]*?flushApptsNow/.test(app)) {
    calFails.push("deleteAppt must call flushApptsNow");
  }
  if (!/const confirmBlock[\s\S]*?flushApptsNow/.test(app)) {
    calFails.push("confirmBlock must call flushApptsNow");
  }
  record(calFails.length === 0, "Calendar sync contract (structural)",
    calFails.length ? calFails.join(" · ") : "server-authoritative read/write/delete path intact");
} catch (e) {
  record(false, "Calendar sync contract (structural)", "check error: " + e.message);
}

// 6b) Declaration-order guard (temporal dead zone). `cutsScreen` builds its JSX eagerly and CALLS
//     backBar() the moment its const initializes, so `backBar` MUST be declared before it. A backBar
//     declared later is a runtime ReferenceError ("Cannot access 'backBar' before initialization")
//     that crashes the whole Services editor on open — shipped once on 2026-07-16, invisible to both
//     the build and eslint no-undef (the var IS defined, just used too early). This locks the order.
try {
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const bb = app.indexOf("const backBar =");
  const cs = app.indexOf("const cutsScreen =");
  const ok = bb !== -1 && cs !== -1 && bb < cs;
  record(ok, "No TDZ in Services editor (backBar before cutsScreen)",
    ok ? "backBar is declared before its eager use in cutsScreen"
       : "backBar is missing or declared AFTER cutsScreen — temporal-dead-zone crash on the Services page; move the backBar declaration above cutsScreen");
} catch (e) {
  record(false, "No TDZ in Services editor (backBar before cutsScreen)", "check error: " + e.message);
}

// 6b-ii) Same class of TDZ: `cutsBody` is an IIFE that runs the moment its const initializes (for any
//     service offering cut styles) and references the `microLbl` style object. `microLbl` MUST be declared
//     before cutsBody or opening a cut-style service (Haircut) throws "Cannot access 'microLbl' before
//     initialization" and crashes the whole Settings screen — shipped once, invisible to build + eslint
//     no-undef. Locks the order. [menu-editor-microlbl-tdz]
try {
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const ml = app.indexOf("const microLbl =");
  const cb = app.indexOf("const cutsBody =");
  const ok = ml !== -1 && cb !== -1 && ml < cb;
  record(ok, "No TDZ in Services editor (microLbl before cutsBody)",
    ok ? "microLbl is declared before its eager use in cutsBody"
       : "microLbl is missing or declared AFTER cutsBody — temporal-dead-zone crash opening a cut-style service; move the microLbl declaration above cutsBody");
} catch (e) {
  record(false, "No TDZ in Services editor (microLbl before cutsBody)", "check error: " + e.message);
}

// 6c) Reachability guard for the service-editor drill-in sections. The editor renders sub-screens as
//     `{drill ? (section === "X" ? Xscreen : …) : mainForm}`. If a section is DISPATCHED but missing
//     from the `drill` OR-chain, tapping into it silently re-renders the main form and the editor is
//     unreachable. Shipped once on 2026-07-17: the "Offers cut styles → Edit" button set section
//     "cuts", the dispatch mapped "cuts" → cutsScreen, but `drill` omitted "cuts" — so cut styles
//     couldn't be edited at all. Build + eslint both passed (it's a logic gap, not a syntax/undef bug).
//     This asserts every dispatched section is also permitted by the gate.
try {
  const app = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
  const drillLine = app.split("\n").find((l) => l.includes("const drill = section ===")) || "";
  const drillSections = [...drillLine.matchAll(/section === "([a-z]+)"/g)].map((m) => m[1]);
  const start = app.indexOf("{drill ? (");
  const dispatch = start !== -1 ? app.slice(start, start + 600) : "";
  const dispatchSections = [...dispatch.matchAll(/section === "([a-z]+)"/g)].map((m) => m[1]);
  const unreachable = dispatchSections.filter((s) => !drillSections.includes(s));
  const ok = drillLine && dispatch && unreachable.length === 0 && drillSections.includes("cuts");
  record(ok, "Service-editor sections reachable (drill gate covers dispatch)",
    ok ? "every dispatched sub-screen is permitted by the drill gate (incl. 'cuts')"
       : (unreachable.length ? `dispatched but not in drill gate — unreachable: ${unreachable.join(", ")}` : "drill gate / dispatch not found or missing 'cuts' — the cut-styles editor may be unreachable"));
} catch (e) {
  record(false, "Service-editor sections reachable (drill gate covers dispatch)", "check error: " + e.message);
}

// 7) No out-of-scope variable references (eslint no-undef). This is the EXACT class of bug
//    that crashed the Settings tab on 2026-07-11 — a variable used where it isn't in scope
//    (a prop not passed down). `npm run build` does NOT catch it: it only throws when that
//    component actually renders. eslint does catch it, so gate the deploy on it. The config
//    (eslint.config.js) whitelists real globals (Node in api/lib, __BUILD_VERSION__), so any
//    no-undef here is a genuine render-crash risk, not noise.
try {
  // Use --format json (stable, in-core). eslint exits non-zero when ANY rule errors, so the
  // results come back on stdout even then — we catch and read stdout. JSON.parse throwing means
  // eslint truly failed to run (config/parse error), which we treat as a FAILED check, never a
  // false "clean". We count ONLY no-undef (the render-crash class) — other rules don't gate.
  let raw = "";
  try {
    raw = execSync("npx eslint src api lib --format json", { cwd: ROOT, stdio: "pipe", maxBuffer: 64 * 1024 * 1024 }).toString();
  } catch (e) {
    raw = e.stdout?.toString() || "";
  }
  const parsed = JSON.parse(raw); // throws → caught below → check FAILS (safe)
  const hits = [];
  for (const file of parsed) {
    for (const m of file.messages || []) {
      if (m.ruleId === "no-undef") hits.push(`${file.filePath.replace(ROOT + "/", "")}:${m.line} — ${m.message}`);
    }
  }
  record(hits.length === 0, "No out-of-scope variables (no-undef)",
    hits.length
      ? `${hits.length} undefined-variable reference(s) — would crash at render:\n` + hits.slice(0, 6).join("\n")
      : "eslint no-undef clean across src/ api/ lib/");
} catch (e) {
  record(false, "No out-of-scope variables (no-undef)", "lint gate could not run eslint: " + String(e.message || e).slice(0, 160));
}

// Report.
console.log("\n  Pre-flight check\n  " + "─".repeat(40));
for (const r of results) {
  console.log(`  ${r.ok ? "✅" : "❌"}  ${r.label}`);
  if (r.detail) for (const line of r.detail.split("\n")) console.log(`        ${line}`);
}
const failed = results.filter((r) => !r.ok);
console.log("  " + "─".repeat(40));
if (failed.length) {
  console.log(`  ❌ ${failed.length} check(s) FAILED — do NOT deploy until fixed.\n`);
  process.exit(1);
}
console.log("  ✅ All checks passed — safe to deploy.\n");
process.exit(0);
