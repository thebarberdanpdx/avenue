// Vero — Stripe engine (Vercel serverless function)
// ---------------------------------------------------------------------------
// This file goes in your project at:  ~/Desktop/avenue/api/stripe.js
// It reads your SECRET key from a Vercel environment variable (STRIPE_SECRET_KEY).
// The secret key is NEVER written in this file or shipped to the browser.
//
// It handles two actions the app will call:
//   • "setup"  → start saving a client's card on file (no charge)
//   • "charge" → charge a saved card later (e.g. a no-show fee)
//
// CROSS-ORIGIN ACCESS (why the headers below exist):
// The website and this server share an address (gotvero.com), so web calls
// just work. The iOS/Android app lives at a DIFFERENT address, so the browser
// engine sends a quick "is it OK to call you?" check (an OPTIONS request)
// before the real call. Without the headers below, that check fails and the
// app sees "Load failed" — the call never reaches Stripe. These headers say
// "yes, the app may call me" and answer the pre-check so charges go through
// from the phone too. No credentials/cookies are used here, so allowing any
// origin is safe — the secret key still lives only on the server.
// ---------------------------------------------------------------------------
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getStaffUser, isShopMember } from "../lib/shop-auth.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Staff-only guard --------------------------------------------------------
// "charge" (pull a saved card) and "refund" (send money out) move money and are
// only ever triggered by signed-in staff in the dashboard. We require a valid
// Supabase session token for those two actions so the endpoint can't be used as
// an open proxy to the Stripe account. "setup" and "sale_intent" stay open —
// they're also called from the public booking page, where there is no login.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STAFF_ONLY = new Set(["charge", "refund", "connection_token", "terminal_intent", "terminal_location", "payouts", "payout_detail", "transactions", "instant_payout"]);
// Money-OUT actions must ALSO belong to the caller's shop, not just any valid
// session. `charge` pulls a saved card; `refund` sends money out. On top of the
// staff-session gate above, the signed-in email must match a provider of the
// shop named in the request — so a valid session for one shop can never move
// money in another once Vero is multi-tenant. (Terminal actions stay behind the
// session gate only; they mint account-scoped intents, not shop-specific ones.)
const SHOP_SCOPED = new Set(["charge", "refund", "instant_payout"]);

// Tap to Pay on iPhone requires the reader to be tied to a Terminal Location.
// Resolve one: prefer a pinned env id, else the account's first existing Location.
// Returns null if the account has none (caller surfaces a clear "create one" error).
async function terminalLocationId(stripe) {
  const pinned = process.env.STRIPE_TERMINAL_LOCATION_ID || null;
  if (pinned) return pinned;
  const locs = await stripe.terminal.locations.list({ limit: 1 });
  return locs.data && locs.data.length ? locs.data[0].id : null;
}

// Reject a bad money amount before it ever reaches Stripe. `amount` is in
// dollars. It must be a real number, greater than zero, and under a sane
// ceiling — so a tampered browser value or a fat-fingered entry can never
// create a negative, zero, or absurdly large charge on the live account.
const MAX_AMOUNT = 100000; // $100,000 — far above any real salon transaction
function validAmount(amount) {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT;
}


// --- Webhook: keep our records in sync with Stripe ---------------------------
// Stripe calls us when something happens out-of-band — a refund issued from the
// Stripe dashboard, a chargeback/dispute, or a saved-card charge that failed.
// We DON'T trust the POST body: we re-fetch the event from Stripe by its id
// (using the secret key) so a forged request can't fake a refund. Then we patch
// the matching appointment's payment record. Everything here is best-effort and
// always replies 200 so Stripe doesn't retry-storm. Isolated from the action
// handlers — normal app calls never reach this code.
async function applyToAppt(piId, patch) {
  if (!piId || !SERVICE_KEY) return { matched: false };
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    // Small DB (one shop today): scan + match in JS. Track B: index data->paid->>paymentIntentId.
    const { data: rows } = await supabase.from("appointments").select("id, shop_id, data");
    const hit = (rows || []).find((r) => r.data && r.data.paid && r.data.paid.paymentIntentId === piId);
    if (!hit) return { matched: false };
    const next = { ...hit.data, paid: { ...hit.data.paid, ...patch } };
    await supabase.from("appointments").update({ data: next }).eq("id", hit.id).eq("shop_id", hit.shop_id);
    return { matched: true, id: hit.id, shop: hit.shop_id };
  } catch (e) {
    return { matched: false, error: e.message };
  }
}

async function handleStripeWebhook(req, res, body) {
  try {
    const evId = body && body.id;
    if (typeof evId !== "string" || !evId.startsWith("evt_")) {
      return res.status(200).json({ received: true, ignored: "no event id" });
    }
    // Re-fetch from Stripe to verify authenticity. If we can't (forged id, or a
    // dashboard "test" event), we simply take no action and still reply 200.
    let event;
    try { event = await stripe.events.retrieve(evId); }
    catch (e) { return res.status(200).json({ received: true, ignored: "unverified" }); }

    const ts = new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString();
    const obj = (event.data && event.data.object) || {};
    let result = { matched: false };

    if (event.type === "charge.refunded") {
      result = await applyToAppt(obj.payment_intent, {
        refunded: true,
        refundedAmount: (obj.amount_refunded || 0) / 100,
        refundFull: (obj.amount_refunded || 0) >= (obj.amount || 0),
        refundedAt: ts,
      });
    } else if (event.type === "charge.dispute.created") {
      result = await applyToAppt(obj.payment_intent, {
        disputed: true,
        disputeAmount: (obj.amount || 0) / 100,
        disputeStatus: obj.status || null,
        disputedAt: ts,
      });
    } else if (event.type === "payment_intent.payment_failed") {
      result = await applyToAppt(obj.id, {
        chargeFailed: true,
        failReason: (obj.last_payment_error && obj.last_payment_error.message) || null,
        failedAt: ts,
      });
    }
    return res.status(200).json({ received: true, type: event.type, applied: !!result.matched });
  } catch (e) {
    return res.status(200).json({ received: true, error: "handler" });
  }
}

import { withErrorReporting } from "../lib/observe.js";
export default withErrorReporting(handler, "stripe");
async function handler(req, res) {
  // --- Allow the app (a different address) to call this server -------------
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400"); // cache the pre-check for a day

  // Answer the browser's pre-check immediately so the real POST can follow.
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: "Stripe isn't configured yet (STRIPE_SECRET_KEY is missing in Vercel)." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { action } = body;

    // Stripe webhook? Real webhook POSTs carry a Stripe-Signature header and an
    // event-shaped body ({object:"event", id:"evt_..."}); the app's own calls
    // carry {action} and neither of these, so they never enter this branch.
    if (req.headers["stripe-signature"] || (body && body.object === "event")) {
      return handleStripeWebhook(req, res, body);
    }

    // Money-moving actions require a signed-in staff member.
    let staffUser = null;
    if (STAFF_ONLY.has(action)) {
      staffUser = await getStaffUser(req);
      if (!staffUser) {
        return res.status(401).json({ error: "Not authorized — please sign in again." });
      }
    }

    // …and money-OUT actions (charge / refund) must also belong to the shop named
    // in the request. charge/refund ⊂ STAFF_ONLY, so staffUser is already set here.
    // Blocks a valid session for one shop from moving money in another (multi-tenant).
    if (SHOP_SCOPED.has(action)) {
      const ok = await isShopMember(staffUser, body.shop);
      if (!ok) {
        return res.status(403).json({ error: "Not authorized for this shop." });
      }
    }

    // --- Save a card on file -------------------------------------------------
    // Creates (or reuses) a Stripe customer for this client and returns a
    // SetupIntent secret the app uses to securely collect the card. No charge.
    if (action === "setup") {
      const { customerId, name, email, phone } = body;
      let customer = customerId;
      if (!customer) {
        const c = await stripe.customers.create({ name, email, phone });
        customer = c.id;
      }
      const intent = await stripe.setupIntents.create({
        customer,
        payment_method_types: ["card"],
        usage: "off_session", // lets you charge later without the client present
      });
      return res.status(200).json({ clientSecret: intent.client_secret, customerId: customer });
    }

    // --- Charge a saved card -------------------------------------------------
    // Used for a no-show fee. `amount` is in dollars; Stripe works in cents.
    if (action === "charge") {
      const { customerId, paymentMethodId, amount, description, idempotencyKey } = body;
      if (!customerId || !paymentMethodId) {
        return res.status(400).json({ error: "Missing customerId or paymentMethodId." });
      }
      if (!validAmount(amount)) {
        return res.status(400).json({ error: "Invalid amount." });
      }
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(Number(amount) * 100),
        currency: "usd",
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: description || "Vero — no-show fee",
      }, idempotencyKey ? { idempotencyKey } : undefined); // dedupe retries of the same charge
      return res.status(200).json({ status: pi.status, id: pi.id });
    }

    // --- One-time sale (register) -------------------------------------------
    // Charges a card that's entered right now — no saved customer needed.
    // Returns a clientSecret the app confirms with the card field.
    if (action === "sale_intent") {
      const { amount, description } = body;
      if (!validAmount(amount)) {
        return res.status(400).json({ error: "Invalid amount." });
      }
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(Number(amount) * 100),
        currency: "usd",
        payment_method_types: ["card"],
        description: description || "Vero — sale",
      });
      return res.status(200).json({ clientSecret: pi.client_secret, id: pi.id });
    }

    // --- Refund a charge ----------------------------------------------------
    // Full refund if `amount` is omitted; partial refund (also used to give a
    // discount after the fact) when `amount` (in dollars) is provided.
    if (action === "refund") {
      const { paymentIntentId, amount, idempotencyKey } = body;
      if (!paymentIntentId) {
        return res.status(400).json({ error: "Missing paymentIntentId." });
      }
      const params = { payment_intent: paymentIntentId };
      if (amount) {
        if (!validAmount(amount)) {
          return res.status(400).json({ error: "Invalid refund amount." });
        }
        params.amount = Math.round(Number(amount) * 100);
      }
      const r = await stripe.refunds.create(params, idempotencyKey ? { idempotencyKey } : undefined); // dedupe retries of the same refund
      return res.status(200).json({ status: r.status, id: r.id, amount: (r.amount || 0) / 100 });
    }

    // --- Tap to Pay on iPhone: Terminal connection token --------------------
    // The native Stripe Terminal SDK exchanges this short-lived token to connect
    // the iPhone's built-in reader (Tap to Pay). Staff-only; moves no money.
    // Requires Terminal enabled on the Stripe account AND the app's Apple
    // "Tap to Pay on iPhone" entitlement + native SDK on the device.
    if (action === "connection_token") {
      // Tap to Pay on iPhone REQUIRES the reader to be tied to a Terminal Location.
      // Scope the token to one so the native connect doesn't stall. (The client also
      // passes the same location into discoverReaders — the plugin force-unwraps it.)
      const locationId = await terminalLocationId(stripe);
      if (!locationId) {
        return res.status(400).json({
          error: "No Stripe Terminal Location exists. Create one in the Stripe Dashboard (Terminal → Locations) before using Tap to Pay.",
        });
      }
      const ct = await stripe.terminal.connectionTokens.create({ location: locationId });
      return res.status(200).json({ secret: ct.secret, location: locationId });
    }

    // --- Tap to Pay: which Terminal Location to connect the reader to ----------
    // The native plugin force-unwraps the locationId passed to discoverReaders, so
    // the app fetches it here BEFORE discovering. Staff-only; moves no money.
    if (action === "terminal_location") {
      const locationId = await terminalLocationId(stripe);
      if (!locationId) {
        return res.status(400).json({
          error: "No Stripe Terminal Location exists. Create one in the Stripe Dashboard (Terminal → Locations) before using Tap to Pay.",
        });
      }
      return res.status(200).json({ location: locationId });
    }

    // --- Tap to Pay: card-present PaymentIntent -----------------------------
    // Terminal charges an in-person (card_present) intent that the native SDK
    // collects and confirms when the client taps their card/phone. `amount` is
    // in dollars. Auto-captures so the sale completes on tap.
    if (action === "terminal_intent") {
      const { amount, description } = body;
      if (!validAmount(amount)) {
        return res.status(400).json({ error: "Invalid amount." });
      }
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(Number(amount) * 100),
        currency: "usd",
        payment_method_types: ["card_present"],
        capture_method: "automatic",
        description: description || "Vero — Tap to Pay",
      });
      return res.status(200).json({ clientSecret: pi.client_secret, id: pi.id });
    }

    // --- Payouts, balance & payout schedule (read-only) ----------------------
    // Powers the Settings → Payouts screen: current Stripe balance, the account's
    // automatic-payout schedule, and recent payouts. Staff-only (see STAFF_ONLY).
    // All amounts are returned in CENTS; the app formats them.
    if (action === "payouts") {
      const limit = Math.min(24, Math.max(1, Number(body.limit) || 10));
      const [balance, payoutList, account] = await Promise.all([
        stripe.balance.retrieve(),
        stripe.payouts.list({ limit }),
        stripe.accounts.retrieve().catch(() => null), // no id → the key's own account
      ]);
      const sumBy = (arr) => (arr || []).reduce((s, b) => s + (b.amount || 0), 0);
      const sched = account && account.settings && account.settings.payouts ? account.settings.payouts.schedule : null;
      const curr = (balance.available && balance.available[0] && balance.available[0].currency)
        || (balance.pending && balance.pending[0] && balance.pending[0].currency) || "usd";
      return res.status(200).json({
        currency: curr,
        available: sumBy(balance.available),               // cents, settled & ready to pay out
        pending: sumBy(balance.pending),                   // cents, still clearing
        instantAvailable: sumBy(balance.instant_available), // cents eligible for an instant payout (0 if none)
        payoutsEnabled: account ? !!(account.payouts_enabled) : null,
        schedule: sched ? {
          interval: sched.interval,          // "daily" | "weekly" | "monthly" | "manual"
          delayDays: sched.delay_days,
          weeklyAnchor: sched.weekly_anchor || null,
          monthlyAnchor: sched.monthly_anchor || null,
        } : null,
        payouts: (payoutList.data || []).map((p) => ({
          id: p.id,
          amount: p.amount,                  // cents
          currency: p.currency,
          status: p.status,                  // paid | pending | in_transit | canceled | failed
          arrivalDate: p.arrival_date,       // unix seconds — when it lands in the bank
          created: p.created,                // unix seconds
          method: p.method,                  // standard | instant
          description: p.description || p.statement_descriptor || "",
        })),
      });
    }

    // --- One payout's breakdown: the charges/refunds/fees that composed it ----
    // balanceTransactions filtered by payout id → every ticket that rolled into
    // that deposit, plus Stripe's fee and your net. Staff-only, read-only.
    if (action === "payout_detail") {
      const { payoutId } = body;
      if (!payoutId) return res.status(400).json({ error: "Missing payoutId." });
      const txns = await stripe.balanceTransactions.list({ payout: payoutId, limit: 100 });
      const rows = (txns.data || []).filter((t) => t.type !== "payout" && t.type !== "payout_cancel");
      const items = rows.map((t) => ({
        id: t.id, type: t.type, amount: t.amount, fee: t.fee, net: t.net,
        currency: t.currency, created: t.created, description: t.description || "",
      }));
      return res.status(200).json({
        items,
        gross: items.reduce((s, i) => s + (i.amount || 0), 0),
        fees: items.reduce((s, i) => s + (i.fee || 0), 0),
        net: items.reduce((s, i) => s + (i.net || 0), 0),
        count: items.length,
      });
    }

    // --- Transactions ledger: every charge / refund / fee on the account -------
    // Powers "View all transactions" + CSV export. Cursor-paginated. Read-only.
    if (action === "transactions") {
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
      const params = { limit };
      if (body.startingAfter) params.starting_after = body.startingAfter;
      const txns = await stripe.balanceTransactions.list(params);
      return res.status(200).json({
        items: (txns.data || []).map((t) => ({
          id: t.id, type: t.type, amount: t.amount, fee: t.fee, net: t.net,
          currency: t.currency, created: t.created, available: t.available_on,
          description: t.description || "",
        })),
        hasMore: !!txns.has_more,
        nextCursor: txns.data && txns.data.length ? txns.data[txns.data.length - 1].id : null,
      });
    }

    // --- "Pay me now": an instant payout to the linked debit card --------------
    // Money-OUT → staff-only AND shop-scoped (see STAFF_ONLY / SHOP_SCOPED). Never
    // the default; the app surfaces it as a secondary action with the fee shown.
    // Omitting amount pays out the full instant-eligible balance. Stripe charges a
    // fee and requires an eligible debit card; if not eligible it errors clearly.
    if (action === "instant_payout") {
      let cents;
      if (body.amount != null && body.amount !== "") {
        if (!validAmount(body.amount)) return res.status(400).json({ error: "Invalid amount." });
        cents = Math.round(Number(body.amount) * 100);
      } else {
        const bal = await stripe.balance.retrieve();
        cents = (bal.instant_available || []).reduce((s, b) => s + (b.amount || 0), 0);
      }
      if (!cents || cents <= 0) {
        return res.status(400).json({ error: "No funds are available for an instant payout right now." });
      }
      const currency = (body.currency || "usd").toLowerCase();
      const opts = body.idempotencyKey ? { idempotencyKey: body.idempotencyKey } : {};
      const payout = await stripe.payouts.create({ amount: cents, currency, method: "instant" }, opts);
      return res.status(200).json({ id: payout.id, amount: payout.amount, status: payout.status, arrivalDate: payout.arrival_date });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    // Card declined, expired, needs authentication, etc. all surface here.
    return res.status(400).json({ error: err.message, code: err.code || null, type: err.type || null });
  }
}
