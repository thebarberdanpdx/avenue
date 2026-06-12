// /api/client-code — request a one-time email sign-in code for the booking page.
// POST { shop, email } → { found: true, masked } | { found: false }
// Looks up the client by email (service role), stores a 6-digit code with a
// 10-minute expiry, and sends it through the existing /api/notify email pipe.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const mask = (em) => {
  const [user, domain] = em.split("@");
  if (!domain) return em;
  const u = user.length <= 2 ? user[0] + "•" : user[0] + "•".repeat(Math.min(4, user.length - 2)) + user[user.length - 1];
  return `${u}@${domain}`;
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { shop, email } = req.body || {};
    const em = String(email || "").trim().toLowerCase();
    if (!shop || !/^\S+@\S+\.\S+$/.test(em)) return res.status(400).json({ error: "bad request" });
    if (!SERVICE_KEY) return res.status(500).json({ error: "server not configured" });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Throttle: max 5 codes per address per 15 minutes.
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count } = await supabase.from("client_login_codes").select("id", { count: "exact", head: true })
      .eq("shop_id", shop).eq("email", em).gte("created_at", since);
    if ((count || 0) >= 5) return res.status(429).json({ error: "too many requests" });

    // Find the client by email on file.
    const { data: rows, error } = await supabase.from("clients").select("id, data").eq("shop_id", shop);
    if (error) return res.status(500).json({ error: "lookup failed" });
    const hit = (rows || []).find((r) => String(r.data?.email || "").trim().toLowerCase() === em && !r.data?.blocked);
    if (!hit) return res.status(200).json({ found: false });

    // Generate + store the code (10-minute expiry).
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: insErr } = await supabase.from("client_login_codes").insert({
      shop_id: shop, email: em, client_id: hit.id, code, expires_at: expires,
    });
    if (insErr) return res.status(500).json({ error: "could not create code" });

    // Send it through the existing email pipe. Template is pre-rendered (no tags).
    const origin = `https://${req.headers.host}`;
    await fetch(origin + "/api/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "email",
        to: { email: em },
        subject: "Your sign-in code",
        template: `Your sign-in code is ${code}. It expires in 10 minutes. If you didn't request this, you can ignore this email.`,
        context: {},
      }),
    }).catch(() => {});

    return res.status(200).json({ found: true, masked: mask(em) });
  } catch (e) {
    return res.status(500).json({ error: "unexpected" });
  }
}
