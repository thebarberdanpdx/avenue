// lib/safeFetch.js — SSRF-resistant fetch for user/owner-supplied URLs (calendar feeds).
//
// The calendar importers fetch a URL the caller provides. Without guarding, an attacker
// could point them at internal/cloud-metadata addresses (e.g. http://169.254.169.254/…)
// — a classic SSRF. This validates that the target host (and EVERY redirect hop) resolves
// only to public IP addresses before fetching, caps redirects, and adds a timeout.
//
// Note: this blocks the practical threat (direct private-IP targets + redirect-to-internal).
// It does not defend against deliberate DNS-rebinding (resolve public on check, private on
// fetch); pinning the resolved IP would be the next step if ever needed.

import dns from "dns/promises";
import net from "net";

// Is this resolved IP in a private / loopback / link-local / reserved range we must never reach?
function ipIsPrivate(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) {
    const p = ip.split(".").map(Number);
    const [a, b] = p;
    if (a === 0 || a === 127) return true;                 // "this host" / loopback
    if (a === 10) return true;                             // private
    if (a === 172 && b >= 16 && b <= 31) return true;      // private
    if (a === 192 && b === 168) return true;               // private
    if (a === 169 && b === 254) return true;               // link-local (cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT
    if (a >= 224) return true;                             // multicast / reserved
    return false;
  }
  if (fam === 6) {
    const x = ip.toLowerCase();
    if (x === "::1" || x === "::") return true;            // loopback / unspecified
    if (x.startsWith("fe80")) return true;                // link-local
    if (x.startsWith("fc") || x.startsWith("fd")) return true; // unique-local
    if (x.startsWith("::ffff:")) return ipIsPrivate(x.slice(7)); // IPv4-mapped
    return false;
  }
  return true; // unparseable → treat as unsafe
}

// Throw unless `raw` is an http(s) URL whose host resolves ONLY to public addresses.
async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { throw new Error("bad url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad scheme");
  let addrs;
  try { addrs = await dns.lookup(u.hostname, { all: true }); } catch (e) { throw new Error("dns"); }
  if (!addrs || !addrs.length) throw new Error("dns");
  for (const a of addrs) { if (ipIsPrivate(a.address)) throw new Error("blocked host"); }
  return u;
}

// SSRF-safe fetch: re-validates the target on every redirect hop. Drop-in for fetch()
// where the URL is caller-supplied. Throws on a blocked host / bad URL / too many redirects.
export async function safeFetch(rawUrl, opts = {}) {
  const { headers = {}, maxRedirects = 3, timeoutMs = 10000 } = opts;
  let url = String(rawUrl || "");
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, timeoutMs);
    let r;
    try { r = await fetch(url, { headers, redirect: "manual", signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      url = new URL(r.headers.get("location"), url).toString(); // resolve + re-validate next loop
      continue;
    }
    return r;
  }
  throw new Error("too many redirects");
}
