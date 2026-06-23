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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// --- Staff-only guard --------------------------------------------------------
// "charge" (pull a saved card) and "refund" (send money out) move money and are
// only ever triggered by signed-in staff in the dashboard. We require a valid
// Supabase session token for those two actions so the endpoint can't be used as
// an open proxy to the Stripe account. "setup" and "sale_intent" stay open —
// they're also called from the public booking page, where there is no login.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const STAFF_ONLY = new Set(["charge", "refund"]);

// Reject a bad money amount before it ever reaches Stripe. `amount` is in
// dollars. It must be a real number, greater than zero, and under a sane
// ceiling — so a tampered browser value or a fat-fingered entry can never
// create a negative, zero, or absurdly large charge on the live account.
const MAX_AMOUNT = 100000; // $100,000 — far above any real salon transaction
function validAmount(amount) {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0 && n <= MAX_AMOUNT;
}

async function getStaffUser(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !SERVICE_KEY) return null;
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return data.user;
  } catch (e) {
    return null;
  }
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

export default async function handler(req, res) {
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
    if (STAFF_ONLY.has(action)) {
      const user = await getStaffUser(req);
      if (!user) {
        return res.status(401).json({ error: "Not authorized — please sign in again." });
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

    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    // Card declined, expired, needs authentication, etc. all surface here.
    return res.status(400).json({ error: err.message, code: err.code || null, type: err.type || null });
  }
}
