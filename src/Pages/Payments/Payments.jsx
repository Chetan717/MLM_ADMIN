import { useCallback, useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { collection, getDocs } from "firebase/firestore";
import { functions, db, auth } from "../../../Firebase";
import { adminReadCache } from "../../Utils/adminReadCache";
import { useAdminAuth } from "../../Auth/AdminAuthContext";
import SearchableSelect from "../../components/SearchableSelect";

const money = (value) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(value || 0) / 100,
  );
const formatDate = (value) =>
  value ? new Date(value).toLocaleString("en-IN") : "—";
const inputClass =
  "px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm";
const overview = httpsCallable(functions, "panelPaymentOverview");
const closeUncreated = httpsCallable(functions, "panelCloseUncreatedPayment", {
  timeout: 60000,
});
const reconcile = httpsCallable(functions, "panelReconcilePayment", {
  timeout: 60000,
});

export default function Payments() {
  const { session } = useAdminAuth();
  const [companies, setCompanies] = useState([]),
    [companyId, setCompanyId] = useState(""),
    [status, setStatus] = useState("");
  const [data, setData] = useState({ summary: {}, items: [], cursor: null }),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState("");
  const [error, setError] = useState(""),
    [selected, setSelected] = useState(null),
    [recoveryOrder, setRecoveryOrder] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const generation = useRef(0);
  const authorized =
    session?.role === "Master Admin" ||
    session?.assigntab?.includes("userdashboard");
  const master = session?.role === "Master Admin";
  useEffect(() => {
    if (!authorized) return;
    let cancelled = false;
    adminReadCache
      .get(auth.currentUser?.uid, "payment-company-directory", async () =>
        (await getDocs(collection(db, "mlmcomp"))).docs.map((d) => ({
          id: d.id,
          name: d.data().name,
        })),
      )
      .then((rows) => {
        if (!cancelled) setCompanies(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authorized]);
  const load = useCallback(
    async (cursor = null, force = false) => {
      if (!authorized) return;
      const run = ++generation.current;
      setLoading(true);
      setError("");
      try {
        const query = { companyId, status, ...(cursor ? { cursor } : {}) };
        const next = await adminReadCache.get(
          auth.currentUser?.uid,
          `payment-page:${JSON.stringify(query)}`,
          async () => (await overview(query)).data,
          { force },
        );
        if (run === generation.current)
          setData((previous) => ({
            ...next,
            items: cursor
              ? [
                  ...previous.items,
                  ...next.items.filter(
                    (row) => !previous.items.some((old) => old.id === row.id),
                  ),
                ]
              : next.items,
          }));
      } catch (error) {
        if (run === generation.current)
          setError(error.message || "Payment data could not load.");
      } finally {
        if (run === generation.current) setLoading(false);
      }
    },
    [companyId, status, authorized],
  );
  useEffect(() => {
    setData({ summary: {}, items: [], cursor: null });
    load();
    return () => {
      generation.current++;
    };
  }, [load]);
  async function check(row) {
    if (busy) return;
    setBusy(row.id);
    setError("");
    try {
      const result = (
        await reconcile({
          purchaseId: row.id,
          ...(!row.orderId && recoveryOrder
            ? { orderId: recoveryOrder.trim() }
            : {}),
        })
      ).data;
      setSelected(null);
      setRecoveryOrder("");
      await load(null, true);
      if (["pending", "creation_unknown"].includes(result.status))
        setError(
          "Provider confirmation is still pending. Do not mark this payment paid manually.",
        );
    } catch (error) {
      setError(error.message || "Reconciliation failed.");
    } finally {
      setBusy("");
    }
  }
  async function closeMissing(row) {
    if (busy || closeReason.trim().length < 12) return;
    setBusy(row.id);
    setError("");
    try {
      await closeUncreated({ purchaseId: row.id, reason: closeReason.trim() });
      setSelected(null);
      setCloseReason("");
      await load(null, true);
    } catch (error) {
      setError(error.message || "Checkout could not be closed.");
    } finally {
      setBusy("");
    }
  }
  if (!authorized)
    return (
      <div className="p-8">Subscription Dashboard permission is required.</div>
    );
  const totals = data.summary;
  return (
    <div className="p-4 md:p-6 space-y-5 text-gray-900 dark:text-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-bold text-2xl">Razorpay payments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Verified payment totals, refunds and company plans
          </p>
        </div>
        <button
          disabled={loading}
          onClick={() => load(null, true)}
          className="px-4 py-2.5 rounded-xl bg-violet-600 text-white font-semibold text-sm"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <div className="flex flex-wrap gap-3">
        <SearchableSelect
          aria-label="Filter payments by company"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className={`${inputClass} min-w-52`}
        >
          <option value="">All companies</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
            </option>
          ))}
        </SearchableSelect>
        <SearchableSelect
          aria-label="Filter payment status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={inputClass}
        >
          <option value="">All statuses</option>
          {[
            "created",
            "creation_unknown",
            "failed",
            "paid",
            "refunded",
            "partially_refunded",
            "disputed",
          ].map((value) => (
            <option key={value} value={value}>
              {value.replaceAll("_", " ")}
            </option>
          ))}
        </SearchableSelect>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ["Captured", money(totals.capturedPaise)],
          ["Refunded", money(totals.refundedPaise)],
          ["Net received", money(totals.netReceivedPaise)],
          ["Paid orders", totals.paidOrders || 0],
          ["Plan base", money(totals.basePaise)],
          ["Discounts", money(totals.discountPaise)],
          ["GST collected", money(totals.gstPaise)],
          ["Marketing payable", money(totals.marketingPayablePaise)],
        ].map(([title, value]) => (
          <div
            key={title}
            className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
          >
            <p className="text-xs text-gray-500">{title}</p>
            <p className="text-lg font-bold mt-2 break-words">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        Totals include payments recorded by this integration. Status filters
        apply to the list; totals cover the selected company. Gateway fees and
        settlement amounts are available in Razorpay.
      </p>
      {error && (
        <p
          role="status"
          className="rounded-xl p-4 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 text-sm"
        >
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-[1050px] w-full text-sm text-left bg-white dark:bg-gray-900">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs uppercase text-gray-500">
            <tr>
              {[
                "Date / receipt",
                "Customer",
                "Company / plan",
                "Base",
                "Discount",
                "GST",
                "Total",
                "Refunded",
                "Status",
                "Action",
              ].map((title) => (
                <th key={title} className="px-4 py-3">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {data.items.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <p>{formatDate(row.createdAtMs)}</p>
                  <p className="font-mono text-[10px] text-gray-400 mt-1">
                    {row.id}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-semibold">{row.userName}</p>
                  <p className="text-xs text-gray-400">{row.mobileNo}</p>
                </td>
                <td className="px-4 py-3">
                  <p>{row.companyName}</p>
                  <p className="text-xs text-gray-400">{row.plan.PlanName}</p>
                </td>
                <td className="px-4 py-3">{money(row.price.basePaise)}</td>
                <td className="px-4 py-3">{money(row.price.discountPaise)}</td>
                <td className="px-4 py-3">{money(row.price.gstPaise)}</td>
                <td className="px-4 py-3 font-bold">
                  {money(row.price.totalPaise)}
                </td>
                <td className="px-4 py-3">{money(row.refundedPaise)}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      row.status === "paid"
                        ? "text-emerald-600 font-bold"
                        : "text-amber-600"
                    }
                  >
                    {row.status.replaceAll("_", " ")}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => {
                      setSelected(row);
                      setRecoveryOrder("");
                      setCloseReason("");
                    }}
                    className="text-violet-600 font-semibold"
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
            {!data.items.length && (
              <tr>
                <td colSpan={10} className="text-center py-10 text-gray-400">
                  {loading ? "Loading payments…" : "No payments found."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {data.cursor && (
        <button
          disabled={loading}
          onClick={() => load(data.cursor)}
          className="px-5 py-3 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-bold"
        >
          {loading ? "Loading…" : "Load older payments"}
        </button>
      )}
      {selected && (
        <div className="fixed inset-0 z-[90] bg-black/50 p-4 flex items-center justify-center">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Payment details"
            className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 p-6 rounded-3xl"
          >
            <div className="flex justify-between gap-3">
              <h2 className="text-lg font-bold">Payment details</h2>
              <button
                aria-label="Close payment details"
                disabled={Boolean(busy)}
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
            </div>
            <dl className="text-sm space-y-2 mt-5">
              {[
                ["Receipt", selected.id],
                ["Company", selected.companyName],
                ["Plan", selected.plan.PlanName],
                ["Customer", `${selected.userName} · ${selected.mobileNo}`],
                ["Order ID", selected.orderId || "Confirmation pending"],
                ["Payment ID", selected.paymentId || "Not captured"],
                ["Coupon", selected.couponCode || "None"],
                ["Taxable amount", money(selected.price.taxablePaise)],
                ["Total", money(selected.price.totalPaise)],
                ["Starts", formatDate(selected.startsAtMs)],
                ["Expires", formatDate(selected.subscriptionExpiresAtMs)],
              ].map(([title, value]) => (
                <div
                  key={title}
                  className="flex justify-between gap-4 border-b border-gray-100 dark:border-gray-800 py-2"
                >
                  <dt className="text-gray-500 shrink-0">{title}</dt>
                  <dd className="text-right break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <h3 className="font-bold text-sm mt-5">Marketing allocation</h3>
            {selected.commissions.length ? (
              selected.commissions.map((row) => (
                <p
                  key={row.memberId}
                  className="text-xs flex justify-between py-2 gap-3"
                >
                  <span>
                    {row.memberId} · {row.kind} · {row.rateBps / 100}%
                  </span>
                  <strong>{money(row.amountPaise)}</strong>
                </p>
              ))
            ) : (
              <p className="text-xs text-gray-400 mt-2">No coupon commission</p>
            )}
            {master && (
              <div className="mt-5">
                {!selected.orderId && (
                  <label className="text-xs text-gray-500 block">
                    Original order ID from Razorpay Dashboard
                    <input
                      className={`${inputClass} w-full mt-2`}
                      value={recoveryOrder}
                      onChange={(e) => setRecoveryOrder(e.target.value)}
                      placeholder="order_…"
                    />
                  </label>
                )}
                <button
                  disabled={Boolean(busy)}
                  onClick={() => check(selected)}
                  className="w-full mt-3 py-3 rounded-xl bg-violet-600 text-white text-sm font-bold"
                >
                  {busy
                    ? "Verifying with Razorpay…"
                    : "Reconcile with Razorpay"}
                </button>
                <p className="text-xs text-gray-400 mt-2">
                  Reconciliation verifies the original provider order and
                  captured amount.
                </p>
                {!selected.orderId && !selected.paymentId && (
                  <div className="border-t border-gray-200 dark:border-gray-700 mt-5 pt-4">
                    <label className="text-xs text-gray-500 block">
                      Close an uncreated checkout (at least one hour old)
                      <input
                        value={closeReason}
                        onChange={(e) => setCloseReason(e.target.value)}
                        placeholder="Review reason (minimum 12 characters)"
                        className={`${inputClass} w-full mt-2`}
                        maxLength={500}
                      />
                    </label>
                    <p className="text-xs text-gray-400 mt-2">
                      The server checks Razorpay by receipt. This only releases
                      a missing order; it cannot mark a payment paid.
                    </p>
                    <button
                      disabled={
                        Boolean(busy) ||
                        closeReason.trim().length < 12 ||
                        selected.createdAtMs > Date.now() - 3600000
                      }
                      onClick={() => closeMissing(selected)}
                      className="w-full mt-3 py-3 rounded-xl border border-amber-300 text-amber-700 text-sm font-bold disabled:opacity-40"
                    >
                      Close uncreated checkout
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
