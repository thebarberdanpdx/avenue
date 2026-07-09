// Staff calendar mirror — returns the shop's full clients + appointments using the
// service-role key so a device whose direct Supabase reads fail (stale JWT, RLS
// quirks, Capacitor WebView) can still hydrate from the authoritative server copy.
// Auth: Bearer JWT + isShopMember (same guard as calendar-pull / stripe).
import { createClient } from "@supabase/supabase-js";
import { getStaffUser, canAccessShop } from "../lib/shop-auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const normShop = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9-]/g, "");

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!SERVICE_KEY) return res.status(500).json({ error: "server not configured" });

  const user = await getStaffUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized — please sign in again." });
  const bearerToken = (() => {
    const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
    return h.startsWith("Bearer ") ? h.slice(7) : null;
  })();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const shop = normShop(body.shop);
    if (!shop) return res.status(400).json({ error: "missing shop" });
    if (!(await canAccessShop(user, shop, bearerToken))) {
      return res.status(403).json({ error: "Not authorized for this shop.", email: user.email || null });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const [clRes, apRes] = await Promise.all([
      supabase.from("clients").select("data").eq("shop_id", shop),
      supabase.from("appointments").select("data").eq("shop_id", shop),
    ]);
    if (clRes.error) return res.status(502).json({ error: clRes.error.message });
    if (apRes.error) return res.status(502).json({ error: apRes.error.message });

    const clients = (clRes.data || []).map((r) => r.data).filter(Boolean);
    const appointments = (apRes.data || []).map((r) => r.data).filter(Boolean);

    return res.status(200).json({
      ok: true,
      shop,
      email: user.email || null,
      clients,
      appointments,
      counts: { clients: clients.length, appointments: appointments.length },
    });
  } catch (e) {
    return res.status(500).json({ error: (e && e.message) || "sync-pull failed" });
  }
}
