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

// True if `user` is a member of `shop`, used to gate money-out actions (charge /
// refund). Two ways to qualify, either is sufficient:
//   1) AUTHORITATIVE — the user has a membership row in the account that owns the
//      shop. This is what fixes owners whose LOGIN email isn't on a provider
//      record (e.g. a personal Gmail) being wrongly blocked from taking payment.
//   2) LEGACY — the user's login email matches a provider record's email on file.
// Fails CLOSED on any missing input or DB error, so a service-role money action
// is never let through on doubt (a blocked action is retryable; a bad charge isn't).
export async function isShopMember(user, shop) {
  if (!user || !shop || typeof shop !== "string" || !SERVICE_KEY) return false;
  const email = String(user.email || "").trim().toLowerCase();
  const sid = String(shop).toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!sid) return false;
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    // 1) Membership in the account that owns this shop (authoritative).
    if (user.id) {
      const { data: shopRow } = await supabase.from("shops").select("account_id").eq("id", sid).maybeSingle();
      if (shopRow && shopRow.account_id) {
        const { data: mem } = await supabase.from("memberships").select("id").eq("account_id", shopRow.account_id).eq("user_id", user.id).limit(1);
        if (mem && mem.length) return true;
      }
    }
    // 2) Legacy fallback: login email matches a provider record's email on file.
    if (email) {
      const { data: rows, error } = await supabase.from("providers").select("data").eq("shop_id", sid);
      if (!error && (rows || []).some((r) => r && r.data && String(r.data.email || "").trim().toLowerCase() === email)) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// Broader gate for read-only sync: provider-email match OR get_my_shops membership
// OR shop contact email OR micro-shop (≤8 staff) with a valid login session.
// iPad was showing Cloud: 0 via direct because sync-pull 403'd (provider emails
// not on file) and RLS returned empty rows on the direct Supabase path.
export async function canAccessShop(user, shop, bearerToken) {
  if (!user || !shop || !SERVICE_KEY) return false;
  const email = String(user.email || "").trim().toLowerCase();
  const sid = String(shop).toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!sid || !email) return false;

  if (await isShopMember(user, shop)) return true;

  const anon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_aGX3akW7VfHO6Lm-FsZmEA_sf95Nu2i";
  if (bearerToken && anon) {
    try {
      const userClient = createClient(SUPABASE_URL, anon, {
        global: { headers: { Authorization: `Bearer ${bearerToken}` } },
      });
      const { data, error } = await userClient.rpc("get_my_shops");
      if (!error && Array.isArray(data) && data.some((s) => s && String(s.shop_id || "").toLowerCase().replace(/[^a-z0-9-]/g, "") === sid)) {
        return true;
      }
    } catch (e) { /* fall through */ }
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: shopRow } = await supabase.from("shops").select("settings").eq("id", sid).maybeSingle();
    if (!shopRow) return false;
    const settings = shopRow.settings || {};
    const bizEmails = [settings.email, settings.ownerEmail, settings.contactEmail, settings.businessEmail]
      .concat(settings.owner && settings.owner.email ? [settings.owner.email] : [])
      .map((e) => String(e || "").trim().toLowerCase())
      .filter(Boolean);
    if (bizEmails.includes(email)) return true;
  } catch (e) { /* deny */ }
  // NOTE: no "small shop → any login" bypass. Access requires a real match above
  // (provider email, get_my_shops membership, or business email). A non-member —
  // including any client who reaches the staff login — is denied here (403).

  return false;
}
