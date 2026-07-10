// PowerSync local-first sync — Stage 0/1 groundwork.
// Connects signed-in staff to the PowerSync instance; watches shop tables into React state.
// Writes still go through syncList → Supabase until Stage 2 wires uploadData.
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/web';
import { supabase } from './supabaseClient';

const POWERSYNC_URL = import.meta.env.VITE_POWERSYNC_URL || '';

const shopTable = () => new Table({
  shop_id: column.text,
  data: column.text,
});

const AppSchema = new Schema({
  clients: shopTable(),
  appointments: shopTable(),
  services: shopTable(),
  providers: shopTable(),
  waitlist: shopTable(),
});

const FATAL_UPLOAD_CODES = [/^22/, /^23/, /^42501$/];

let db = null;
let connector = null;
let connectedShopId = null;

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

  // Stage 2 will upload queued local writes. Read-only Stage 1 leaves the queue empty.
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
  return !!POWERSYNC_URL;
}

export function getPowerSyncDb() {
  if (!powerSyncEnabled()) return null;
  if (!db) {
    db = new PowerSyncDatabase({
      schema: AppSchema,
      database: { dbFilename: 'vero_powersync.db' },
      flags: { enableMultiTabs: typeof SharedWorker !== 'undefined' },
    });
  }
  return db;
}

export async function connectPowerSync(shopId) {
  if (!powerSyncEnabled() || !shopId) return { ok: false, reason: 'disabled' };
  const psDb = getPowerSyncDb();
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

/** Live query — calls onUpdate whenever the local table changes. Returns cleanup fn. */
export function watchShopTable(shopId, table, onUpdate) {
  const psDb = getPowerSyncDb();
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

/** One-shot read from local SQLite (instant boot even if sync is still catching up). */
export async function readShopTable(shopId, table) {
  const psDb = getPowerSyncDb();
  if (!psDb || !shopId) return [];
  const rows = await psDb.getAll(
    `SELECT id, shop_id, data FROM ${table} WHERE shop_id = ?`,
    [shopId],
  );
  return parseShopRows(rows);
}
