// Staff calendar sync — pull AND save clients + appointments with the service-role key
// so devices whose direct Supabase reads/writes fail (stale JWT, RLS quirks, iPad
// WebView) still stay in sync with the authoritative server copy.
//
// POST { shop } — pull full clients + appointments (default)
// POST { shop, mode: "save", table, upserts: [{id,data}], deleteIds: [...] }
//
// Auth: Bearer JWT + canAccessShop (same gate as pull — personal Gmail logins OK).
import { createClient } from "@supabase/supabase-js";
import { getStaffUser, canAccessShop } from "../lib/shop-auth.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const normShop = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
const SAVE_TABLES = new Set(["appointments", "clients"]);
const CHUNK = 10;

async function saveTable(supabase, shop, table, upserts, deleteIds) {
  const rows = (upserts || [])
    .map((u) => {
      if (!u || u.id == null || u.data == null) return null;
      return { id: String(u.id), shop_id: shop, data: u.data };
    })
    .filter(Boolean);

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + CHUNK));
    if (error) return { error };
  }

  const dels = (deleteIds || []).map((id) => String(id)).filter(Boolean);
  if (dels.length) {
    const { data: deleted, error: delErr } = await supabase
      .from(table)
      .delete()
      .eq("shop_id", shop)
      .in("id", dels)
      .select("id");
    if (delErr) return { error: delErr };
    if ((deleted || []).length < dels.length) {
      const got = new Set((deleted || []).map((r) => String(r.id)));
      const missing = dels.filter((id) => !got.has(id));
      const { data: still } = await supabase.from(table).select("id").eq("shop_id", shop).in("id", missing);
      if ((still || []).length) {
        return { error: new Error(`delete blocked on '${table}': ${(still || []).length} row(s) refused`) };
      }
    }
  }

  return { ok: true, upserted: rows.length, deleted: dels.length };
}

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
    const mode = body.mode || "pull";

    if (mode === "save") {
      const table = String(body.table || "");
      if (!SAVE_TABLES.has(table)) return res.status(400).json({ error: "invalid table" });
      const result = await saveTable(supabase, shop, table, body.upserts, body.deleteIds);
      if (result.error) {
        const msg = String((result.error && result.error.message) || result.error);
        return res.status(502).json({ error: msg, email: user.email || null });
      }
      return res.status(200).json({
        ok: true,
        mode: "save",
        shop,
        table,
        email: user.email || null,
        upserted: result.upserted,
        deleted: result.deleted,
      });
    }

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
      mode: "pull",
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
