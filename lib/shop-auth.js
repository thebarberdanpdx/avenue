// lib/shop-auth.js
// Shared server-side auth for the service-role API endpoints (Stripe money-out,
// calendar sync). These endpoints write with the service-role key, bypassing
// RLS, so they MUST answer "is this caller a signed-in member of the shop they
// named?" themselves. Keeping that answer in ONE place stops the money endpoint
// and the calendar endpoint from drifting apart on the security-critical check.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Resolve the signed-in Supabase user from the request's Bearer token, or null.
export async function getStaffUser(req) {
  const header = (req.headers && (req.headers.authorization || req.headers.Authorization)) || "";
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

// True only if `user`'s login email matches a provider record of `shop` — the
// SAME identity rule the app uses to know "who am I" at the register
// (App.jsx: norm(provider.email) === login email). Fails closed on any missing
// input or DB error, so a service-role write is never let through on doubt
// (a blocked action is retryable; a cross-shop write isn't).
export async function isShopMember(user, shop) {
  if (!user || !shop || typeof shop !== "string" || !SERVICE_KEY) return false;
  const email = String(user.email || "").trim().toLowerCase();
  if (!email) return false;
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: rows, error } = await supabase.from("providers").select("data").eq("shop_id", shop);
    if (error) return false;
    return (rows || []).some((r) => r && r.data && String(r.data.email || "").trim().toLowerCase() === email);
  } catch (e) {
    return false;
  }
}

// Broader gate for read-only sync: provider-email match OR get_my_shops membership
// (same rule the location switcher uses). Fixes iPad sessions where the login is
// valid but provider.email on file doesn't match exactly.
export async function canAccessShop(user, shop, bearerToken) {
  if (!user || !shop) return false;
  if (await isShopMember(user, shop)) return true;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_aGX3akW7VfHO6Lm-FsZmEA_sf95Nu2i";
  if (!bearerToken || !anon) return false;
  try {
    const userClient = createClient(SUPABASE_URL, anon, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
    });
    const { data, error } = await userClient.rpc("get_my_shops");
    if (error || !Array.isArray(data)) return false;
    const sid = String(shop).toLowerCase().replace(/[^a-z0-9-]/g, "");
    return data.some((s) => s && String(s.shop_id || "").toLowerCase().replace(/[^a-z0-9-]/g, "") === sid);
  } catch (e) {
    return false;
  }
}
