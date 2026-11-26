import { useEffect, useState } from "react";
import { RefreshCw, Wifi, WifiOff, Check, CloudOff, Trash2, AlertTriangle, Clock, Loader2, RotateCw } from "lucide-react";
import { cacheList, cacheClear, CACHE_KEYS } from "@/lib/offlineCache";
import { listAll, update, clearCompleted, removeEntry, counts as queueCounts } from "@/lib/offlineQueue";
import { syncNow } from "@/lib/offlineSync";
import useOnlineStatus from "@/hooks/useOnlineStatus";
import { getMyApplication, getWalletBalance } from "@/lib/server-fns";
import { listWalletTransactions } from "@/lib/wallet-transaction-fns";
import { cacheWrite } from "@/lib/offlineCache";
import { toast } from "sonner";
import BottomNav from "@/components/dashboard/BottomNav";
import SubPageHeader from "@/components/dashboard/SubPageHeader";

const READ_LABELS = {
  [CACHE_KEYS.application]: "Account application",
  [CACHE_KEYS.walletBalance]: "Wallet balance",
  [CACHE_KEYS.walletTransactions]: "Transaction history",
};

const STATUS = {
  pending: { label: "Pending", cls: "bg-amber-100 text-amber-700 ring-amber-200", icon: Clock },
  syncing: { label: "Syncing", cls: "bg-blue-100 text-blue-700 ring-blue-200", icon: Loader2 },
  synced: { label: "Synced", cls: "bg-emerald-100 text-emerald-700 ring-emerald-200", icon: Check },
  failed: { label: "Failed", cls: "bg-rose-100 text-rose-700 ring-rose-200", icon: AlertTriangle },
};

export default function SyncDashboard() {
  const online = useOnlineStatus();
  const [reads, setReads] = useState([]);
  const [queue, setQueue] = useState([]);
  const [stats, setStats] = useState({ pending: 0, syncing: 0, synced: 0, failed: 0, total: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    const [r, q, c] = await Promise.all([cacheList(), listAll(), queueCounts()]);
    setReads(r);
    setQueue(q.sort((a, b) => b.createdAt - a.createdAt));
    setStats(c);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const refreshReads = async () => {
    if (!online) {
      toast.error("You're offline. Reconnect to refresh from the server.");
      return;
    }
    setRefreshing(true);
    try {
      const [app, bal, txPage] = await Promise.all([
        getMyApplication().catch(() => null),
        getWalletBalance().catch(() => null),
        listWalletTransactions({ data: {} }).catch(() => null),
      ]);
      if (app) await cacheWrite(CACHE_KEYS.application, app);
      if (bal) await cacheWrite(CACHE_KEYS.walletBalance, bal);
      if (txPage) await cacheWrite(CACHE_KEYS.walletTransactions, txPage.items || []);
      await load();
      toast.success("Data refreshed and saved for offline use.");
    } catch (e) {
      toast.error(e.message || "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  };

  const runSync = async () => {
    if (!online) {
      toast.error("You're offline. Pending actions sync automatically when you reconnect.");
      return;
    }
    setSyncing(true);
    try {
      const res = await syncNow(async ({ phase }) => {
        if (phase === "synced" || phase === "failed") await load();
      });
      await load();
      if (res.ok) toast.success(`Synced ${res.processed} pending action${res.processed === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e.message || "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const retryOne = async (id) => {
    if (!online) return toast.error("You're offline.");
    await update(id, { status: "pending", error: "" });
    await runSync();
  };

  const dismissOne = async (id) => {
    await removeEntry(id);
    await load();
  };

  const clearSynced = async () => {
    await clearCompleted();
    await load();
    toast.success("Cleared synced actions.");
  };

  const lastReadSync = reads.length ? Math.max(...reads.map((e) => e.savedAt)) : null;
  const lastWriteSync = queue.length ? Math.max(...queue.map((e) => e.syncedAt || e.updatedAt)) : null;
  const pendingTotal = stats.pending + stats.failed;

  return (
    <div className="min-h-screen bg-[#F4F8FF] pb-24">
      <SubPageHeader title="Offline & sync" subtitle="Browse offline, queue actions, auto-sync on reconnect." />
      <main className="mx-auto -mt-6 max-w-md space-y-4 px-4">
        {/* Status + progress */}
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center gap-3">
            <span className={`flex h-11 w-11 items-center justify-center rounded-2xl ${online ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
              {online ? <Wifi className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
            </span>
            <div className="flex-1">
              <p className="text-[14px] font-bold text-[#0A1F44]">{online ? "Online" : "Offline"}</p>
              <p className="text-[11px] text-[#587396]">
                {online ? "Connected. Actions process live; pending ones auto-sync." : "Browsing saved data. New actions are queued and sync when you reconnect."}
              </p>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ring-1 ${online ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}>
              {online ? (pendingTotal ? "Syncing" : "Synced") : "Offline"}
            </span>
          </div>

          {/* progress bar */}
          {stats.total > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-[#587396]">
                <span>Sync progress</span>
                <span>{stats.synced}/{stats.total} done · {pendingTotal} pending</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#EAF0F7]">
                <div className="h-full rounded-full bg-gradient-to-r from-[#0056B3] to-[#0097FF] transition-all" style={{ width: `${stats.total ? Math.round((stats.synced / stats.total) * 100) : 0}%` }} />
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-[#F4F8FF] p-3 ring-1 ring-black/5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#587396]">Last data sync</p>
              <p className="text-[12px] font-semibold text-[#0A1F44]">{lastReadSync ? new Date(lastReadSync).toLocaleString("en-US", { timeZone: "Asia/Manila" }) : "Never"}</p>
            </div>
            <div className="rounded-2xl bg-[#F4F8FF] p-3 ring-1 ring-black/5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#587396]">Last action sync</p>
              <p className="text-[12px] font-semibold text-[#0A1F44]">{lastWriteSync ? new Date(lastWriteSync).toLocaleString("en-US", { timeZone: "Asia/Manila" }) : "Never"}</p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button type="button" onClick={refreshReads} disabled={refreshing || !online} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0056B3] to-[#0097FF] text-[13px] font-semibold text-white disabled:opacity-40">
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> {refreshing ? "Syncing…" : "Refresh data"}
            </button>
            <button type="button" onClick={runSync} disabled={syncing || !online || pendingTotal === 0} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[#0056B3]/30 bg-white text-[13px] font-semibold text-[#0056B3] disabled:opacity-40">
              <RotateCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : `Sync actions${pendingTotal ? ` (${pendingTotal})` : ""}`}
            </button>
          </div>
        </section>

        {/* Status indicators */}
        <section className="grid grid-cols-4 gap-2">
          {[["Synced", stats.synced, "bg-emerald-50 text-emerald-700 ring-emerald-200"], ["Pending", stats.pending, "bg-amber-50 text-amber-700 ring-amber-200"], ["Syncing", stats.syncing, "bg-blue-50 text-blue-700 ring-blue-200"], ["Failed", stats.failed, "bg-rose-50 text-rose-700 ring-rose-200"]].map(([label, n, cls]) => (
            <div key={label} className={`rounded-2xl p-3 text-center ring-1 ${cls}`}>
              <p className="text-[18px] font-bold">{n}</p>
              <p className="text-[9px] font-semibold uppercase tracking-wide">{label}</p>
            </div>
          ))}
        </section>

        {/* Pending action queue */}
        <section className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="flex items-center gap-2 border-b border-black/5 p-4">
            <CloudOff className="h-4 w-4 text-[#0056B3]" />
            <p className="flex-1 text-[13px] font-semibold text-[#0A1F44]">Queued actions</p>
            {stats.synced > 0 && (
              <button type="button" onClick={clearSynced} className="rounded-full bg-[#F4F8FF] px-2.5 py-1 text-[10px] font-semibold text-[#587396]">Clear synced</button>
            )}
          </div>
          {queue.length === 0 ? (
            <p className="p-5 text-[12px] text-[#587396]">No queued actions. When you do something offline, it appears here and syncs automatically on reconnect.</p>
          ) : (
            queue.map((e, i) => {
              const s = STATUS[e.status] || STATUS.pending;
              const Icon = s.icon;
              return (
                <div key={e.id} className={`flex items-center gap-3 p-4 ${i < queue.length - 1 ? "border-b border-black/5" : ""}`}>
                  <span className={`flex h-8 w-8 items-center justify-center rounded-xl ring-1 ${s.cls}`}>
                    <Icon className={`h-4 w-4 ${e.status === "syncing" ? "animate-spin" : ""}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-[#0A1F44]">{e.label}</p>
                    <p className="truncate text-[11px] text-[#587396]">
                      {new Date(e.createdAt).toLocaleString("en-US", { timeZone: "Asia/Manila" })}
                      {e.status === "failed" && e.error ? ` · ${e.error}` : ""}
                      {e.attempts > 0 ? ` · attempt ${e.attempts}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ring-1 ${s.cls}`}>{s.label}</span>
                  {e.status === "failed" && (
                    <button type="button" onClick={() => retryOne(e.id)} disabled={!online} className="rounded-full bg-[#0056B3] px-2.5 py-1 text-[10px] font-semibold text-white disabled:opacity-40">Retry</button>
                  )}
                  {(e.status === "synced" || e.status === "failed") && (
                    <button type="button" onClick={() => dismissOne(e.id)} aria-label="Dismiss" className="text-[#8898AA] hover:text-[#0A1F44]">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </section>

        {/* Saved read datasets */}
        <section className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="flex items-center gap-2 border-b border-black/5 p-4">
            <CloudOff className="h-4 w-4 text-[#0056B3]" />
            <p className="text-[13px] font-semibold text-[#0A1F44]">Saved for offline viewing</p>
          </div>
          {reads.length === 0 ? (
            <p className="p-5 text-[12px] text-[#587396]">Nothing saved yet. Tap "Refresh data" above while online so your data is available offline.</p>
          ) : (
            reads.map((e, i) => (
              <div key={e.key} className={`flex items-center gap-3 p-4 ${i < reads.length - 1 ? "border-b border-black/5" : ""}`}>
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <Check className="h-4 w-4" />
                </span>
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-[#0A1F44]">{READ_LABELS[e.key] || e.key}</p>
                  <p className="text-[11px] text-[#587396]">{e.count} record{e.count === 1 ? "" : "s"} · {new Date(e.savedAt).toLocaleString("en-US", { timeZone: "Asia/Manila" })}</p>
                </div>
              </div>
            ))
          )}
          {reads.length > 0 && (
            <button type="button" onClick={async () => { await cacheClear(); await load(); toast.success("Offline cache cleared."); }} className="flex w-full items-center justify-center gap-2 border-t border-black/5 py-3 text-[12px] font-semibold text-rose-600">
              <Trash2 className="h-4 w-4" /> Clear offline cache
            </button>
          )}
        </section>

        <p className="px-2 text-[11px] leading-relaxed text-[#8898AA]">
          Offline mode keeps your data and queues non-financial actions (like support tickets) to process for real when
          you reconnect. Money transfers, cash-in and loan payments require a connection so each one is processed live —
          they are never simulated or queued. The installed app opens and browses offline; pending actions sync
          automatically the moment you're back online.
        </p>
      </main>
      <BottomNav />
    </div>
  );
}