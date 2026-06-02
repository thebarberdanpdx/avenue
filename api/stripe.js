// Vero — Stripe engine (Vercel serverless function)
// ---------------------------------------------------------------------------
// This file goes in your project at:  ~/Desktop/avenue/api/stripe.js
// It reads your SECRET key from a Vercel environment variable (STRIPE_SECRET_KEY).
// The secret key is NEVER written in this file or shipped to the browser.
//
// It handles two actions the app will call:
//   • "setup"  → start saving a client's card on file (no charge)
//   • "charge" → charge a saved card later (e.g. a no-show fee)
// ---------------------------------------------------------------------------
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: "Stripe isn't configured yet (STRIPE_SECRET_KEY is missing in Vercel)." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { action } = body;

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
      const { customerId, paymentMethodId, amount, description } = body;
      if (!customerId || !paymentMethodId || !amount) {
        return res.status(400).json({ error: "Missing customerId, paymentMethodId, or amount." });
      }
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(Number(amount) * 100),
        currency: "usd",
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: description || "Vero — no-show fee",
      });
      return res.status(200).json({ status: pi.status, id: pi.id });
    }

    // --- One-time sale (register) -------------------------------------------
    // Charges a card that's entered right now — no saved customer needed.
    // Returns a clientSecret the app confirms with the card field.
    if (action === "sale_intent") {
      const { amount, description } = body;
      if (!amount) {
        return res.status(400).json({ error: "Missing amount." });
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
      const { paymentIntentId, amount } = body;
      if (!paymentIntentId) {
        return res.status(400).json({ error: "Missing paymentIntentId." });
      }
      const params = { payment_intent: paymentIntentId };
      if (amount) params.amount = Math.round(Number(amount) * 100);
      const r = await stripe.refunds.create(params);
      return res.status(200).json({ status: r.status, id: r.id, amount: (r.amount || 0) / 100 });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    // Card declined, expired, needs authentication, etc. all surface here.
    return res.status(400).json({ error: err.message, code: err.code || null, type: err.type || null });
  }
}
