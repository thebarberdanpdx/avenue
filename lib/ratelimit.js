// lib/ratelimit.js — small DB-backed rate limiter for the public send endpoints.
//
// notify.js / push.js are callable by anyone who can reach the URL (a public booker
// has no login), so the Origin check alone can't stop a scripted flood — an attacker
// simply sets the Origin header. This bounds abuse (SMS toll-fraud, staff spam/phish)
// by counting recent hits per (endpoint, shop, IP) in a tiny `rate_limits` table.
//
// Fails OPEN on any error: a limiter hiccup must never drop a real booking
// confirmation. The goal is to stop casual floods, not to be a hard security wall.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Best-effort caller IP from Vercel's forwarding header.
export function clientIp(req) {
  const xf = (req.headers["x-forwarded-for"] || "").toString();
  return (xf.split(",")[0] || "").trim()
    || (req.socket && req.socket.remoteAddress)
    || "unknown";
}

// true = allowed, false = over the limit. `bucket` is a stable key like
// `notify:<shop>:<ip>`. Prunes its own stale rows so the table stays small.
export async function allowRequest(bucket, max, windowMs) {
  if (!SERVICE_KEY) return true; // not configured → don't block sends
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const since = new Date(Date.now() - windowMs).toISOString();
    // Drop this bucket's expired rows, then count what's left in the window.
    await supa.from("rate_limits").delete().eq("bucket", bucket).lt("created_at", since);
    const { count } = await supa
      .from("rate_limits")
      .select("*", { count: "exact", head: true })
      .eq("bucket", bucket)
      .gte("created_at", since);
    if ((count || 0) >= max) return false;
    await supa.from("rate_limits").insert({ bucket });
    return true;
  } catch (e) {
    return true; // fail open
  }
}
