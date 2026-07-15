// /api/client-code — request a one-time sign-in code for the booking page.
// POST { shop, email }  → emails a code  → { ok, masked }
// POST { shop, phone }  → texts a code   → { ok, masked }
// Looks up the client (service role), stores a 6-digit code with a 10-minute
// expiry, and sends it through the existing /api/notify pipe (email or SMS).
import { createClient } from "@supabase/supabase-js";
import { selectAllRows } from "../lib/paginate.js";
import { resolveChannels, sendSms, sendEmail } from "../lib/messaging.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const SMS_LIVE = process.env.SMS_LIVE === "true";

const maskEmail = (em) => {
  const [user, domain] = em.split("@");
  if (!domain) return em;
  const u = user.length <= 2 ? user[0] + "•" : user[0] + "•".repeat(Math.min(4, user.length - 2)) + user[user.length - 1];
  return `${u}@${domain}`;
};
const maskPhone = (digits) => digits.length >= 4 ? `•••-•••-${digits.slice(-4)}` : digits;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { shop, email, phone } = req.body || {};
    if (!shop) return res.status(400).json({ error: "bad request" });
    if (!SERVICE_KEY) return res.status(500).json({ error: "server not configured" });

    const byPhone = !email && phone;
    const em = String(email || "").trim().toLowerCase();
    const digits = String(phone || "").replace(/\D/g, "");
    if (byPhone ? digits.length < 10 : !/^\S+@\S+\.\S+$/.test(em)) return res.status(400).json({ error: "bad request" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Throttle: max 5 codes per identity per 15 minutes.
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const throttleQ = supabase.from("client_login_codes").select("id", { count: "exact", head: true })
      .eq("shop_id", shop).gte("created_at", since);
    const { count } = await (byPhone ? throttleQ.eq("phone", digits) : throttleQ.eq("email", em));
    if ((count || 0) >= 5) return res.status(429).json({ error: "too many requests" });

    // Find the client on file (by phone digits, or by email). Paginate — an unranged .select()
    // caps at 1000 rows, so a returning client past the first 1,000 would never be recognized
    // (their "I've been here before" login code would never send).
    const { data: rows, error } = await selectAllRows(() => supabase.from("clients").select("id, data").eq("shop_id", shop).order("id"));
    if (error) return res.status(500).json({ error: "lookup failed" });
    const hit = byPhone
      ? (rows || []).find((r) => String(r.data?.phone || "").replace(/\D/g, "") === digits && !r.data?.blocked)
      : (rows || []).find((r) => String(r.data?.email || "").trim().toLowerCase() === em && !r.data?.blocked);

    // Only generate + send a code when the client is actually on file. CRITICAL:
    // we return an IDENTICAL response below whether or not it matched, so this
    // endpoint can't be used to check who is (or isn't) a client (enumeration).
    if (hit) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const row = byPhone
        ? { shop_id: shop, phone: digits, client_id: hit.id, code, expires_at: expires }
        : { shop_id: shop, email: em, client_id: hit.id, code, expires_at: expires };
      const { error: insErr } = await supabase.from("client_login_codes").insert(row);
      if (insErr) return res.status(500).json({ error: "could not create code" });

      // login-code-transactional: a sign-in code is TRANSACTIONAL — the client just requested it by
      // entering their contact info to log in. It must send regardless of a MARKETING opt-out
      // (smsOptOut). A carrier-level STOP still blocks delivery at the network (correct), but a
      // Mangomint marketing opt-out must never stop someone from logging in to book. So we send it
      // DIRECTLY here (NOT through /api/notify, which suppresses on smsOptOut → the whole reason an
      // opted-out returning client got no code). We already verified `hit` is on file for this shop.
      const smsText = `Your sign-in code is ${code}. It expires in 10 minutes.`;
      const emailText = `Your sign-in code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`;
      const cEmail = String((hit.data && hit.data.email) || em || "").trim();
      const ch = resolveChannels({ channel: byPhone ? "text" : "email", smsLive: SMS_LIVE, email: cEmail, phone: digits, smsOptOut: false });
      try { if (ch.sms) await sendSms({ to: digits, text: smsText }); } catch (e) { /* uniform response below regardless */ }
      try { if (ch.email && cEmail) await sendEmail({ to: cEmail, subject: "Your sign-in code", text: emailText }); } catch (e) {}
    }

    // Uniform success — never reveals whether the identity matched a client.
    return res.status(200).json({ ok: true, masked: byPhone ? maskPhone(digits) : maskEmail(em) });
  } catch (e) {
    return res.status(500).json({ error: "unexpected" });
  }
}
