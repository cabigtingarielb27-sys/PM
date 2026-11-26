// Pending-action queue (IndexedDB). When a server-dependent action is attempted
// offline, the request is saved here with an idempotency key and "pending"
// status. On reconnect, offlineSync replays each entry against the REAL server
// function and records the actual server response. Nothing is ever faked.
//
// Each entry: { id, key, type, payload, label, status, attempts, createdAt,
// updatedAt, syncedAt, error, response }
// status: "pending" | "syncing" | "synced" | "failed"

const DB_NAME = "padalapay-sync";
const STORE = "queue";
const VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getStore(mode) {
  const db = await openDb();
  return db.transaction(STORE, mode).objectStore(STORE);
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue({ type, payload, label }) {
  const id = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const now = Date.now();
  const entry = {
    id,
    key: `${type}:${id}`,
    type,
    payload,
    label: label || type,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
    error: "",
    response: null,
  };
  const store = await getStore("readwrite");
  await reqToPromise(store.put(entry));
  return entry;
}

export async function listAll() {
  try {
    const store = await getStore("readonly");
    return (await reqToPromise(store.getAll())) || [];
  } catch {
    return [];
  }
}

export async function update(id, patch) {
  const store = await getStore("readwrite");
  const existing = await reqToPromise(store.get(id));
  if (!existing) return null;
  const next = { ...existing, ...patch, updatedAt: Date.now() };
  await reqToPromise(store.put(next));
  return next;
}

export async function removeEntry(id) {
  try {
    const store = await getStore("readwrite");
    await reqToPromise(store.delete(id));
  } catch {}
}

export async function clearCompleted() {
  const all = await listAll();
  await Promise.all(all.filter((e) => e.status === "synced").map((e) => removeEntry(e.id)));
}

export async function counts() {
  const all = await listAll();
  return {
    pending: all.filter((e) => e.status === "pending").length,
    syncing: all.filter((e) => e.status === "syncing").length,
    synced: all.filter((e) => e.status === "synced").length,
    failed: all.filter((e) => e.status === "failed").length,
    total: all.length,
  };
}