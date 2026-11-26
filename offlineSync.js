// Offline sync engine. A registry maps each queued action type to the REAL
// server function that processes it. When the device reconnects, syncNow()
// replays every pending/failed entry, calls the real server fn, and records
// the actual response or error. Never simulates success.
import { enqueue, listAll, update } from "@/lib/offlineQueue";

const HANDLERS = {};

export function registerAction(type, handler) {
  HANDLERS[type] = handler;
}

export function isOnline() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

// If online: run the live call immediately and return its real result.
// If offline: save the request locally as pending and return { pending: true }.
// The caller shows a clear pending status; the real processing happens later.
export async function runOrEnqueue(type, payload, { label, live } = {}) {
  if (isOnline() && live) {
    return { pending: false, result: await live() };
  }
  const entry = await enqueue({ type, payload, label });
  return { pending: true, entry };
}

let running = false;

// Replay all pending/failed entries against their real server functions.
// Returns { ok, processed, results }. Safe to call repeatedly.
export async function syncNow(onProgress) {
  if (running) return { ok: false, busy: true };
  if (!isOnline()) return { ok: false, offline: true };
  running = true;
  const all = await listAll();
  const pending = all.filter((e) => e.status === "pending" || e.status === "failed");
  let processed = 0;
  for (const entry of pending) {
    const handler = HANDLERS[entry.type];
    if (!handler) {
      await update(entry.id, { status: "failed", error: "No handler registered for this action." });
      onProgress?.({ entry, phase: "failed" });
      continue;
    }
    await update(entry.id, { status: "syncing" });
    onProgress?.({ entry, phase: "syncing" });
    try {
      const result = await handler(entry.payload);
      await update(entry.id, { status: "synced", syncedAt: Date.now(), response: result, error: "" });
      onProgress?.({ entry, phase: "synced", result });
    } catch (err) {
      await update(entry.id, {
        status: "failed",
        attempts: (entry.attempts || 0) + 1,
        error: err?.message || String(err),
      });
      onProgress?.({ entry, phase: "failed", error: err?.message });
    }
    processed++;
  }
  running = false;
  return { ok: true, processed };
}

// Auto-sync the moment the device comes back online.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    syncNow().catch(() => {});
  });
}