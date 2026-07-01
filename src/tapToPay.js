// Tap to Pay on iPhone — Stripe Terminal via @capacitor-community/stripe-terminal.
// iOS native only. The plugin is dynamically imported so the web bundle stays lean
// and this code never executes for a browser client. Callers must gate on IS_NATIVE.
//
// Flow (per Stripe Terminal): initialize (answering the SDK's connection-token
// request from our /api/stripe endpoint) → discover + connect the built-in Tap to
// Pay reader → create a card_present PaymentIntent → collect (client taps) → confirm.

let _initialized = false;   // SDK initialize() done
let _connecting = null;     // in-flight connect promise (dedupe)

async function loadPlugin() {
  // Dynamic import → its own chunk; only pulled in when Tap to Pay is actually used.
  const mod = await import("@capacitor-community/stripe-terminal");
  return { St: mod.StripeTerminal, ConnectTypes: mod.TerminalConnectTypes, Events: mod.TerminalEventsEnum };
}

async function postStripe(apiBase, authToken, payload) {
  const res = await fetch((apiBase || "") + "/api/stripe", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: "Bearer " + authToken } : {}) },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out && out.error ? out.error : "Payment service error.");
  return out;
}

// Ensure the SDK is initialized and the iPhone's Tap to Pay reader is connected.
async function ensureConnected({ live, apiBase, authToken, onStatus }) {
  const { St, ConnectTypes, Events } = await loadPlugin();

  if (!_initialized) {
    // The SDK asks for a connection token whenever it needs one; hand it ours.
    await St.addListener(Events.RequestedConnectionToken, async () => {
      try {
        const { secret } = await postStripe(apiBase, authToken, { action: "connection_token" });
        if (secret) await St.setConnectionToken({ token: secret });
      } catch (e) { /* SDK will surface a connection error */ }
    });
    await St.initialize({ isTest: !live });
    _initialized = true;
  }

  const conn = await St.getConnectedReader().catch(() => ({ reader: null }));
  if (conn && conn.reader) return { St, Events };

  if (!_connecting) {
    _connecting = (async () => {
      onStatus && onStatus("Finding reader…");
      const { readers } = await St.discoverReaders({ type: ConnectTypes.TapToPay });
      if (!readers || !readers.length) throw new Error("Tap to Pay isn't available on this device.");
      onStatus && onStatus("Connecting…");
      await St.connectReader({ reader: readers[0], merchantDisplayName: "Sanctuary Barber Co" });
    })();
  }
  try { await _connecting; } finally { _connecting = null; }
  return { St, Events };
}

// Charge `amount` dollars in person. Resolves { id } on success; throws on failure/cancel.
export async function tapToPayCharge({ amount, description, live, apiBase, authToken, onStatus }) {
  const { St } = await ensureConnected({ live, apiBase, authToken, onStatus });
  onStatus && onStatus("Starting…");
  const intent = await postStripe(apiBase, authToken, { action: "terminal_intent", amount, description });
  if (!intent.clientSecret) throw new Error(intent.error || "Couldn't start the charge.");
  onStatus && onStatus("Tap card or phone…");
  await St.collectPaymentMethod({ paymentIntent: intent.clientSecret });
  onStatus && onStatus("Processing…");
  await St.confirmPaymentIntent();
  return { id: intent.id };
}

export async function tapToPayDisconnect() {
  try { const { St } = await loadPlugin(); await St.disconnectReader(); } catch (e) {}
  _initialized = false;
}
