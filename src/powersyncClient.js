// PowerSync local-first sync — Stage 0/1 groundwork.
// Lazy-loaded: @powersync/web (WASM + workers) must NEVER load on Capacitor iOS —
// it crashed the native shell on 2026-07-10. Web/desktop only until verified on device.
import { supabase } from './supabaseClient';

const POWERSYNC_URL = import.meta.env.VITE_POWERSYNC_URL || '';

const IS_NATIVE = typeof window !== 'undefined' && (
  window.location.protocol === 'capacitor:' ||
  window.location.protocol === 'ionic:' ||
  !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform())
);

let psMod = null;
let AppSchema = null;
let db = null;
let connector = null;
let connectedShopId = null;

const FATAL_UPLOAD_CODES = [/^22/, /^23/, /^42501$/];

async function loadPowerSyncModule() {
  if (psMod) return psMod;
  psMod = await import('@powersync/web');
  const { Schema, Table, column } = psMod;
  const shopTable = () => new Table({
    shop_id: column.text,
    data: column.text,
  });
  AppSchema = new Schema({
    clients: shopTable(),
    appointments: shopTable(),
    services: shopTable(),
    providers: shopTable(),
    waitlist: shopTable(),
  });
  return psMod;
}

class VeroConnector {
  async fetchCredentials() {
    const { data } = await supabase.auth.getSession();
    let sess = data?.session;
    if (!sess) return null;
    const expMs = (sess.expires_at || 0) * 1000;
    if (Date.now() >= expMs - 60000) {
      try {
        const { data: refreshed } = await supabase.auth.refreshSession();
        if (refreshed?.session) sess = refreshed.session;
      } catch (e) { /* use existing token */ }
    }
    return { endpoint: POWERSYNC_URL, token: sess.access_token };
  }

  async uploadData(database) {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    let lastOp = null;
    try {
      for (const op of transaction.crud) {
        lastOp = op;
        const table = supabase.from(op.table);
        let error = null;
        if (op.op === 'PUT') {
          const record = { ...op.opData, id: op.id };
          if (typeof record.data === 'string') {
            try { record.data = JSON.parse(record.data); } catch (e) { /* keep string */ }
          }
          ({ error } = await table.upsert(record));
        } else if (op.op === 'PATCH') {
          const patch = { ...op.opData };
          if (typeof patch.data === 'string') {
            try { patch.data = JSON.parse(patch.data); } catch (e) { /* keep string */ }
          }
          ({ error } = await table.update(patch).eq('id', op.id));
        } else if (op.op === 'DELETE') {
          ({ error } = await table.delete().eq('id', op.id));
        }
        if (error) throw error;
      }
      await transaction.complete();
    } catch (ex) {
      const code = ex && ex.code;
      if (typeof code === 'string' && FATAL_UPLOAD_CODES.some((re) => re.test(code))) {
        console.error('[vero] PowerSync upload discarded (fatal):', lastOp, ex);
        await transaction.complete();
      } else {
        throw ex;
      }
    }
  }
}

export function powerSyncEnabled() {
  // Native shell uses the existing mirrorFromServer path until PowerSync is proven on WKWebView.
  return !!POWERSYNC_URL && !IS_NATIVE;
}

export async function getPowerSyncDb() {
  if (!powerSyncEnabled()) return null;
  if (!db) {
    const { PowerSyncDatabase } = await loadPowerSyncModule();
    db = new PowerSyncDatabase({
      schema: AppSchema,
      database: { dbFilename: 'vero_powersync.db' },
      flags: { enableMultiTabs: false },
    });
  }
  return db;
}

export async function connectPowerSync(shopId) {
  if (!powerSyncEnabled() || !shopId) return { ok: false, reason: 'disabled' };
  const psDb = await getPowerSyncDb();
  if (!psDb) return { ok: false, reason: 'no-db' };
  if (connectedShopId === shopId && psDb.connected) return { ok: true, connected: true };
  connector = new VeroConnector();
  await psDb.connect(connector);
  connectedShopId = shopId;
  return { ok: true, connected: true };
}

export async function disconnectPowerSync() {
  if (!db) return;
  try { await db.disconnect(); } catch (e) { /* best-effort */ }
  connectedShopId = null;
}

export function parseShopRows(rows) {
  return (rows || []).map((r) => {
    if (!r) return null;
    try {
      const raw = r.data;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== 'object') return null;
      if (parsed.id == null && r.id != null) parsed.id = r.id;
      return parsed;
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

export async function watchShopTable(shopId, table, onUpdate) {
  const psDb = await getPowerSyncDb();
  if (!psDb || !shopId) return () => {};
  let alive = true;
  psDb.watch(
    `SELECT id, shop_id, data FROM ${table} WHERE shop_id = ?`,
    [shopId],
    {
      onResult: (result) => {
        if (!alive) return;
        const rows = result?.rows?._array ?? result?.rows ?? [];
        onUpdate(parseShopRows(rows));
      },
    },
  );
  return () => { alive = false; };
}

export async function readShopTable(shopId, table) {
  const psDb = await getPowerSyncDb();
  if (!psDb || !shopId) return [];
  const rows = await psDb.getAll(
    `SELECT id, shop_id, data FROM ${table} WHERE shop_id = ?`,
    [shopId],
  );
  return parseShopRows(rows);
}
