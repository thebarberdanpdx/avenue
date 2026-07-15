// npm run state [shop]  —  prints the LIVE prod ground truth for a shop.
//
// WHY THIS EXISTS (read this): sessions repeatedly reported STALE or GUESSED status to Dan —
// "the migration isn't done", "SMS is off" — read off the docs or inferred from code, when prod
// said the opposite. They also asked Dan for things he'd already done. That destroys trust.
//
// THE RULE (also in CLAUDE.md): before telling Dan what's done / what's left / a percentage /
// whether something is live — OR asking him to provide or do anything — run THIS and answer from
// it. The status docs (PHASES.md, audit docs, this repo's markdown) are NOTES that go stale. This
// script is the truth. If you can't run it, say "unverified" — never present an inference as fact.
//
// Read-only. Needs SUPABASE_SERVICE_ROLE_KEY in the env (loads at session start). Touches nothing.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL || "https://iufgznminbujcabqeesk.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error("No SUPABASE_SERVICE_ROLE_KEY in env — cannot read prod state. (It loads at session start.)"); process.exit(2); }
const sb = createClient(URL, KEY, { auth: { persistSession: false } });
const SHOP = process.argv[2] || "sanctuary";

const cnt = async (t) => { const { count, error } = await sb.from(t).select("*", { count: "exact", head: true }).eq("shop_id", SHOP); return error ? `err:${error.message}` : count; };

(async () => {
  console.log(`\n=== LIVE STATE · ${SHOP} · pulled from prod just now ===\n`);

  const [clients, appts] = [await cnt("clients"), await cnt("appointments")];
  console.log(`clients: ${clients}    appointments: ${appts}`);

  // Import status + contact gaps (one read over clients)
  const { data: crows, error: cErr } = await sb.from("clients").select("data").eq("shop_id", SHOP);
  if (cErr) console.log(`clients read err: ${cErr.message}`);
  else {
    const imported = crows.filter((r) => r.data && r.data._import);
    const batches = [...new Set(imported.map((r) => r.data._import))];
    const noContact = crows.filter((r) => { const d = r.data || {}; return (d.phone || "").replace(/\D/g, "").length < 10 && !(d.email || "").includes("@"); });
    console.log(`MIGRATION: ${imported.length > 0 ? `DONE — ${imported.length} clients imported (batches: ${batches.join(", ")})` : "NOT started (no _import markers)"}`);
    console.log(`clients with NO phone AND NO email: ${noContact.length}`);
  }

  // SMS live? message_log with a via containing "sms" is proof real texts went out.
  const { data: smsRows } = await sb.from("message_log").select("via, sent_at").eq("shop_id", SHOP).ilike("via", "%sms%").order("sent_at", { ascending: false }).limit(1);
  const { data: anyRows } = await sb.from("message_log").select("via, sent_at").eq("shop_id", SHOP).order("sent_at", { ascending: false }).limit(1);
  const smsLive = !!(smsRows && smsRows.length);
  console.log(`\nSMS: ${smsLive ? "LIVE — real texts are sending" : "no SMS sends found in message_log (may be off, or just none due)"}`);
  if (smsLive) console.log(`  last real SMS send: ${smsRows[0].sent_at}`);
  if (anyRows && anyRows.length) console.log(`  last message of any kind: ${anyRows[0].sent_at} (via=${anyRows[0].via})`);

  // Reminder config
  const { data: shopRow } = await sb.from("shops").select("settings").eq("id", SHOP).maybeSingle();
  const msgs = (shopRow && shopRow.settings && shopRow.settings.messages) || [];
  console.log(`\nreminders (${msgs.filter((m) => m.enabled).length} enabled of ${msgs.length}):`);
  for (const m of msgs) console.log(`  [${m.enabled ? "ON " : "off"}] ${(m.timing || "-").padEnd(18)} ${String(m.channel).padEnd(6)} "${(m.label || "").slice(0, 28)}"`);

  console.log(`\n⚠️  This is prod truth as of NOW. PHASES.md / audit docs can be stale — trust THIS, not them.\n`);
  process.exit(0);
})().catch((e) => { console.error("state read failed:", e.message); process.exit(2); });
