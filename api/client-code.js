// /api/client-code — request a one-time sign-in code for the booking page.
// POST { shop, email }  → emails a code  → { ok, masked }
// POST { shop, phone }  → texts a code   → { ok, masked }
// Looks up the client (service role), stores a 6-digit code with a 10-minute
// expiry, and sends it through the existing /api/notify pipe (email or SMS).
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

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

    // Find the client on file (by phone digits, or by email).
    const { data: rows, error } = await supabase.from("clients").select("id, data").eq("shop_id", shop);
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

      // Send it through the existing notify pipe. Template is pre-rendered (no tags).
      const origin = `https://${req.headers.host}`;
      // `shop` is required by /api/notify's anti-relay check (the recipient must be
      // on file for this shop). We only reach here when `hit` matched a real client,
      // so the recipient is on file and the send passes.
      const body = byPhone
        ? { shop, channel: "text", to: { phone: digits }, subject: "Your sign-in code", template: `Your sign-in code is ${code}. It expires in 10 minutes.`, context: {} }
        : { shop, channel: "email", to: { email: em }, subject: "Your sign-in code", template: `Your sign-in code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`, context: {} };
      await fetch(origin + "/api/notify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Trusted server-to-server call → skip notify's public Origin/rate-limit gate.
          "x-internal-key": process.env.INTERNAL_API_KEY || "",
        },
        body: JSON.stringify(body),
      }).catch(() => {});
    }

    // Uniform success — never reveals whether the identity matched a client.
    return res.status(200).json({ ok: true, masked: byPhone ? maskPhone(digits) : maskEmail(em) });
  } catch (e) {
    return res.status(500).json({ error: "unexpected" });
  }
}
