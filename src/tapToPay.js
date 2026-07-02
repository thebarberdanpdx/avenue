// Tap to Pay on iPhone — Stripe Terminal via @capacitor-community/stripe-terminal.
// iOS native only. The plugin is dynamically imported so the web bundle stays lean
// and this code never executes for a browser client. Callers must gate on IS_NATIVE.
//
// Flow (per Stripe Terminal): initialize (answering the SDK's connection-token
// request from our /api/stripe endpoint) → fetch the Terminal Location → discover +
// connect the built-in Tap to Pay reader → create a card_present PaymentIntent →
// collect (client taps) → confirm.
//
// ⚠️ Tap to Pay REQUIRES a Stripe Terminal Location. The native plugin force-unwraps
// the locationId passed to discoverReaders (crashes if nil), so we fetch it from the
// server and pass it in. The connection token is ALSO scoped to that Location server-side.
//
// Reliability contract: this module must NEVER hang the UI silently. Every step that
// can stall (init, location fetch, discover, connect, the connection-token fetch, the
// intent fetch) is time-boxed and turns into a readable Error. The only intentionally
// unbounded waits are collectPaymentMethod (waits for the customer to physically tap)
// and confirmPaymentIntent (an in-flight charge must never be interrupted).

const MERCHANT = "Sanctuary Barber Co";

// Timeouts (ms). Connect is generous because native reader bring-up is slow.
const INIT_TIMEOUT_MS = 20000;    // SDK initialize()
const CONNECT_TIMEOUT_MS = 45000; // discover + connect the reader
const TOKEN_TIMEOUT_MS = 20000;   // connection_token / terminal_location fetch
const INTENT_TIMEOUT_MS = 20000;  // terminal_intent fetch

let _initialized = false;   // SDK initialize() done
let _listenerAdded = false; // RequestedConnectionToken listener registered (once, ever)
let _connecting = null;     // in-flight connect promise (dedupe)
let _tokenError = null;     // last connection-token fetch failure, surfaced if connect stalls/fails
let _creds = { apiBase: "", authToken: null }; // latest creds for the token listener closure

async function loadPlugin() {
  // Dynamic import → its own chunk; only pulled in when Tap to Pay is actually used.
  const mod = await import("@capacitor-community/stripe-terminal");
  return { St: mod.StripeTerminal, ConnectTypes: mod.TerminalConnectTypes, Events: mod.TerminalEventsEnum };
}

// Race a promise against a timeout that rejects with a readable error. `makeError`
// may be an Error or a function returning one (so the message can be computed late —
// e.g. to prefer a captured connection-token error over a generic "timed out").
function withTimeout(promise, ms, makeError) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(typeof makeError === "function" ? makeError() : makeError), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// POST to our Stripe backend. When `timeoutMs` is given the request is aborted (and
// turned into a readable error) if it stalls, so a dead network can't hang a caller.
// Thrown messages are plain reason fragments; callers add user-facing context.
async function postStripe(apiBase, authToken, payload, timeoutMs) {
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetch((apiBase || "") + "/api/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(authToken ? { Authorization: "Bearer " + authToken } : {}) },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (e) {
    if (ctrl && ctrl.signal.aborted) throw new Error("timed out reaching the payment service.");
    throw new Error((e && e.message) || "network error.");
  } finally {
    if (timer) clearTimeout(timer);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out && out.error ? out.error : "Payment service error.");
  return out;
}

// Ensure the SDK is initialized and the iPhone's Tap to Pay reader is connected.
async function ensureConnected({ live, apiBase, authToken, onStatus, mode = "tap" }) {
  const { St, ConnectTypes, Events } = await loadPlugin();
  _creds = { apiBase, authToken }; // token listener reads the freshest creds on retries

  // Register the connection-token listener exactly once for the app's lifetime, so a
  // retry (which skips re-init) never stacks duplicate listeners. CRITICAL: capture any
  // fetch failure into `_tokenError` AND hand the SDK an empty token — otherwise the
  // native side keeps a pending completion open and connectReader hangs forever.
  if (!_listenerAdded) {
    await St.addListener(Events.RequestedConnectionToken, async () => {
      _tokenError = null;
      try {
        const { secret } = await postStripe(_creds.apiBase, _creds.authToken, { action: "connection_token" }, TOKEN_TIMEOUT_MS);
        if (!secret) throw new Error("no connection token was returned.");
        await St.setConnectionToken({ token: secret });
      } catch (e) {
        _tokenError = new Error("Payment service: " + ((e && e.message) || "couldn't authorize the reader."));
        // Fail the SDK's pending token request instead of leaving it to hang.
        try { await St.setConnectionToken({ token: "" }); } catch (e2) { /* best effort */ }
      }
    });
    _listenerAdded = true;
  }

  if (!_initialized) {
    await withTimeout(
      St.initialize({ isTest: !live }),
      INIT_TIMEOUT_MS,
      new Error("Couldn't start the payment reader — initialization timed out."),
    );
    _initialized = true;
  }

  const conn = await St.getConnectedReader().catch(() => ({ reader: null }));
  if (conn && conn.reader) return { St, Events };

  if (!_connecting) {
    _connecting = (async () => {
      _tokenError = null; // fresh slate for this connect attempt
      onStatus && onStatus("Finding reader…");

      // A Stripe Terminal Location is required — the native plugin force-unwraps it on connect
      // (can't be nil), and Bluetooth/Internet readers are assigned to it. Fetch it first.
      let locationId;
      try {
        ({ location: locationId } = await postStripe(apiBase, authToken, { action: "terminal_location" }, TOKEN_TIMEOUT_MS));
      } catch (e) {
        throw new Error("Couldn't set up the reader: " + ((e && e.message) || "no payment location."));
      }
      if (!locationId) throw new Error("Payments aren't set up yet — create a Location in Stripe (Terminal → Locations).");

      let readers = [];
      if (mode === "reader") {
        // Physical reader — model-agnostic: try internet-registered readers first (Stripe Reader
        // S700, Verifone P400…), then fall back to a Bluetooth scan (WisePad 3, Stripe M2…). This
        // way the exact model doesn't have to be known up front — whatever's registered/paired wins.
        try { ({ readers } = await St.discoverReaders({ type: ConnectTypes.Internet, locationId })); } catch (e) { readers = []; }
        if (!readers || !readers.length) {
          onStatus && onStatus("Scanning for a reader…");
          try { ({ readers } = await St.discoverReaders({ type: ConnectTypes.Bluetooth, locationId, timeout: 12 })); } catch (e) { readers = []; }
        }
        if (!readers || !readers.length) throw new Error("No card reader found. Make sure it's powered on, paired to this iPhone (or on the same network), and registered to your Stripe Location.");
      } else {
        try {
          ({ readers } = await St.discoverReaders({ type: ConnectTypes.TapToPay, locationId }));
        } catch (e) {
          throw new Error("Couldn't find a Tap to Pay reader: " + ((e && e.message) || "discovery failed."));
        }
        if (!readers || !readers.length) throw new Error("Tap to Pay isn't available on this device.");
      }
      onStatus && onStatus("Connecting…");
      try {
        await St.connectReader({ reader: readers[0], locationId, merchantDisplayName: MERCHANT });
      } catch (e) {
        // A connection-token fetch failure is the real cause the SDK hides behind a
        // generic connection error — surface it if we captured one.
        throw _tokenError || new Error("Couldn't connect to the reader: " + ((e && e.message) || "unknown error."));
      }
    })();
  }

  const connecting = _connecting;
  try {
    // If connect stalls (commonly because the token fetch failed and the SDK is stuck
    // waiting), throw the captured token error when we have one, else a readable timeout.
    await withTimeout(
      connecting,
      CONNECT_TIMEOUT_MS,
      () => _tokenError || new Error("Connecting to the reader timed out — check your connection and try again."),
    );
  } catch (e) {
    connecting.catch(() => {}); // it may still settle later; don't raise an unhandled rejection
    throw e;
  } finally {
    _connecting = null;
  }
  return { St, Events };
}

// Charge `amount` dollars in person. Resolves { id } on success; throws on failure/cancel.
export async function tapToPayCharge({ amount, description, live, apiBase, authToken, onStatus }) {
  const { St } = await ensureConnected({ live, apiBase, authToken, onStatus });
  onStatus && onStatus("Starting…");
  let intent;
  try {
    intent = await postStripe(apiBase, authToken, { action: "terminal_intent", amount, description }, INTENT_TIMEOUT_MS);
  } catch (e) {
    throw new Error("Couldn't start the charge: " + ((e && e.message) || "payment service error."));
  }
  if (!intent.clientSecret) throw new Error(intent.error || "Couldn't start the charge.");
  onStatus && onStatus("Tap card or phone…");
  // No timeout — this legitimately blocks until the customer taps their card/phone.
  await St.collectPaymentMethod({ paymentIntent: intent.clientSecret });
  onStatus && onStatus("Processing…");
  // No timeout — never interrupt an in-flight charge confirmation.
  await St.confirmPaymentIntent();
  return { id: intent.id };
}

// Charge `amount` dollars on a paired PHYSICAL reader (Bluetooth or internet-connected).
// Identical intent → collect → confirm flow as Tap to Pay; only reader discovery/connect differs
// (handled by ensureConnected mode:"reader"). Resolves { id } on success; throws on failure/cancel.
export async function cardReaderCharge({ amount, description, live, apiBase, authToken, onStatus }) {
  const { St } = await ensureConnected({ live, apiBase, authToken, onStatus, mode: "reader" });
  onStatus && onStatus("Starting…");
  let intent;
  try {
    intent = await postStripe(apiBase, authToken, { action: "terminal_intent", amount, description }, INTENT_TIMEOUT_MS);
  } catch (e) {
    throw new Error("Couldn't start the charge: " + ((e && e.message) || "payment service error."));
  }
  if (!intent.clientSecret) throw new Error(intent.error || "Couldn't start the charge.");
  onStatus && onStatus("Insert, tap, or swipe on the reader…");
  await St.collectPaymentMethod({ paymentIntent: intent.clientSecret });
  onStatus && onStatus("Processing…");
  await St.confirmPaymentIntent();
  return { id: intent.id };
}

export async function tapToPayDisconnect() {
  try { const { St } = await loadPlugin(); await St.disconnectReader(); } catch (e) {}
  _initialized = false;
  _connecting = null;
  // Keep _listenerAdded true — the token listener survives disconnect/reconnect and
  // re-reads _creds each time, so it stays valid without being re-registered.
}
