import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../Firebase";
import { useAdminAuth } from "../Auth/AdminAuthContext";
const when = value => value ? new Date(value).toLocaleString() : "—";

export default function SecuritySessions() {
  const { logout } = useAdminAuth();
  const [rows, setRows] = useState([]), [current, setCurrent] = useState("");
  const [cursor, setCursor] = useState(null), [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false), [error, setError] = useState("");
  const revision = useRef(0);
  const load = useCallback(async (nextCursor = null) => {
    const version = ++revision.current;
    if (nextCursor) setLoadingMore(true); else { setLoading(true); setCursor(null); }
    setError("");
    try {
      const result = await httpsCallable(functions, "panelListSessions")({ cursor: nextCursor });
      if (version !== revision.current) return;
      setRows(previous => nextCursor
        ? [...new Map([...previous, ...(result.data.sessions || [])].map(row => [row.id, row])).values()]
        : result.data.sessions || []);
      setCurrent(result.data.currentSessionId || "");
      setCursor(result.data.nextCursor || null);
    } catch { if (version === revision.current) setError("Session activity load नहीं हुई।"); }
    finally { if (version === revision.current) { setLoading(false); setLoadingMore(false); } }
  }, []);
  useEffect(() => { void load(); return () => { revision.current += 1; }; }, [load]);
  const revoke = async id => {
    if (!confirm("इस session को logout करना है?")) return;
    try {
      const result = await httpsCallable(functions, "panelRevokeSession")({ sessionId: id });
      if (result.data.current) { await logout(); location.href = "/login"; } else await load();
    } catch { setError("Session logout नहीं हुआ। दोबारा कोशिश करें।"); }
  };
  return <div className="p-5 md:p-8 max-w-6xl mx-auto">
    <div className="flex justify-between gap-3 items-center mb-6"><div><h1 className="text-2xl font-bold">Login Activity</h1><p className="text-sm text-gray-500">Owner को अपने और sub-users के सभी devices दिखते हैं।</p></div>
      <button disabled={loading || loadingMore} onClick={() => load()} className="px-4 py-2 rounded-xl bg-violet-600 text-white">Refresh</button></div>
    {error && <p className="text-red-600">{error}</p>}
    {loading ? <p>Loading…</p> : <div className="grid gap-3">{rows.map(session => <div key={session.id} className="bg-white dark:bg-gray-900 border dark:border-gray-800 rounded-2xl p-4 grid md:grid-cols-[1.2fr_1fr_1fr_auto] gap-3 items-center">
      <div><b>{session.actorName || "User"} {session.id === current && <span className="text-xs text-green-600">(This device)</span>}</b><p className="text-sm text-gray-500">{session.device?.label || "Unknown device"}</p></div>
      <div className="text-sm"><p>IP: {session.ip || "Unavailable"}</p><p>{session.location || "Location unavailable"}</p></div>
      <div className="text-sm text-gray-500"><p>Login: {when(session.createdAt)}</p><p>Last active: {when(session.lastSeenAt)}</p><p>Expires: {when(session.expiresAt)}</p></div>
      <button disabled={session.revoked} onClick={() => revoke(session.id)} className="px-3 py-2 rounded-xl border border-red-300 text-red-600 disabled:opacity-40">{session.revoked ? "Logged out" : "Logout device"}</button>
    </div>)}</div>}
    {!loading && cursor && <button disabled={loadingMore} onClick={() => load(cursor)} className="mt-4 px-4 py-2 rounded-xl bg-violet-600 text-white">{loadingMore ? "Loading…" : "Load older sessions"}</button>}
  </div>;
}
