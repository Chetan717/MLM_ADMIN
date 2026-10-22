import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminAuth } from "../../Auth/AdminAuthContext";
import { cachedExpenses, expenseError, loadExpenses, saveExpenseCommand } from "./expenseRepository";
import {
  MONTHS, canManageExpenses, emptyExpenseDocument, indiaToday, monthTitle, formatMoney, formatDate,
  filterLedger, ledgerRows, monthSummary, payrollRows, salaryNet, salaryPaid, salaryBalance, salaryStatus,
  recurringCandidates, sumMoney, applyExpenseCommand,
} from "./expenseModel";
import ExpenseForm from "./ExpenseForms";
import { Button, Empty, Icon, Modal, RowActions, Status, Table } from "./ExpenseUI";
import "./ExpenseManager.css";

const TABS = ["Overview", "Expenses", "Employees", "Salary", "Expense Names"];
const PAGE_SIZE = 25;

function StatCard({ label, value, icon, color = "violet", description }) {
  return <div className={`em-stat em-stat-${color}`}><span className="em-stat-icon"><Icon name={icon} size={24} /></span><div><div className="em-stat-label">{label}</div><strong title={formatMoney(value)}>{formatMoney(value)}</strong><small>{description}</small></div></div>;
}
function Pagination({ count, page, onPage }) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  if (count <= PAGE_SIZE) return null;
  return <div className="em-pagination"><span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, count)} of {count}</span><div className="em-toolbar"><Button variant="secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button><span>{page + 1} / {pages}</span><Button variant="secondary" disabled={page + 1 === pages} onClick={() => onPage(page + 1)}>Next</Button></div></div>;
}

export default function ExpenseManager() {
  const { session } = useAdminAuth();
  const allowed = canManageExpenses(session);
  const [snapshot, setSnapshot] = useState(() => cachedExpenses(session));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("Expenses");
  const [month, setMonth] = useState(() => indiaToday().slice(0, 7));
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [confirmError, setConfirmError] = useState("");
  const saving = useRef(false);
  const data = useMemo(() => snapshot?.data || emptyExpenseDocument(), [snapshot]);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    loadExpenses(session).then(result => { if (active) { setSnapshot(result); setError(""); } }).catch(err => { if (active) setError(expenseError(err)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowed, session]);

  const ledger = useMemo(() => ledgerRows(data), [data]);
  const summary = useMemo(() => monthSummary(data, month), [data, month]);
  const payroll = useMemo(() => payrollRows(data, month), [data, month]);
  const filteredLedger = useMemo(() => filterLedger(ledger, { month, category, search }), [ledger, month, category, search]);
  const employees = useMemo(() => Object.values(data.employees).sort((a, b) => a.name.localeCompare(b.name)), [data]);
  const names = useMemo(() => Object.values(data.expenseNames).sort((a, b) => a.name.localeCompare(b.name)), [data]);
  const query = search.trim().toLowerCase();
  const employeeRows = employees.filter(row => [row.name, row.employeeCode, row.mobile, row.email, row.department, row.designation, row.city].some(value => String(value || "").toLowerCase().includes(query)));
  const salaryRows = payroll.filter(row => [row.employeeName, data.employees[row.employeeId]?.employeeCode, salaryStatus(row)].some(value => String(value || "").toLowerCase().includes(query)));
  const nameRows = names.filter(row => [row.name, row.category, row.vendor].some(value => String(value || "").toLowerCase().includes(query)));
  const categories = [...new Set([...names.map(row => row.category), ...ledger.map(row => row.category)])].sort();
  const year = month.slice(0, 4);
  const currentYear = Number(indiaToday().slice(0, 4));
  const years = [...new Set([year, ...Array.from({ length: 10 }, (_, index) => String(currentYear - 6 + index)), ...ledger.map(row => row.date?.slice(0, 4)), ...Object.values(data.salaries).map(row => row.month?.slice(0, 4))])].filter(Boolean).sort().reverse();
  const activeRows = tab === "Employees" ? employeeRows : tab === "Salary" ? salaryRows : tab === "Expense Names" ? nameRows : filteredLedger;
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(activeRows.length / PAGE_SIZE) - 1));
  const visible = activeRows.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);
  const disabled = busy || !snapshot;

  const selectTab = next => { setTab(next); setSearch(""); setCategory(""); setPage(0); };
  const openForm = (kind, record = null) => { setError(""); setNotice(""); setModal({ kind, record }); };
  const ask = (title, description, command, success, items) => { setConfirmError(""); setConfirmation({ title, description, command, success, items }); };
  const execute = async (command, success = "Changes saved.") => {
    if (saving.current) throw new Error("Another save is still in progress.");
    saving.current = true; setBusy(true); setError(""); setNotice("");
    try {
      // Validate before contacting Firestore; the transaction validates again
      // against the current server document for concurrent edits.
      applyExpenseCommand(data, command, { actor: session.id || session.uid });
      const result = await saveExpenseCommand(session, command);
      setSnapshot(result); setNotice(success);
      return result.data;
    } catch (err) { const message = expenseError(err); setError(message); throw new Error(message); }
    finally { saving.current = false; setBusy(false); }
  };
  const refresh = async () => {
    if (busy || loading) return;
    setLoading(true); setError(""); setNotice("");
    try { setSnapshot(await loadExpenses(session, true)); setNotice("Latest expense data loaded."); }
    catch (err) { setError(expenseError(err)); }
    finally { setLoading(false); }
  };
  const confirm = async () => {
    try { await execute(confirmation.command, confirmation.success); setConfirmation(null); }
    catch (err) { setConfirmError(err.message); }
  };
  const exportExcel = async () => {
    setExporting(true); setError("");
    try {
      const { exportExpenseWorkbook } = await import("./expenseExport");
      await exportExpenseWorkbook(data, { month, category: tab === "Expenses" || tab === "Overview" ? category : "", search: tab === "Expenses" || tab === "Overview" ? search : "" });
      setNotice("Excel exported: Summary, Expenses, Employees, Salary and Expense Names.");
    } catch (err) { setError(err.message || "Excel export failed."); }
    finally { setExporting(false); }
  };
  const paySalary = async row => {
    if (row.prepared) { openForm("payment", row); return; }
    try {
      const next = await execute({ type: "saveSalary", id: row.id, values: row }, "Salary prepared. Record the payment to continue.");
      openForm("payment", next.salaries[row.id]);
    } catch { /* execute displays the error */ }
  };
  const deleteLedgerRow = row => {
    if (row.kind === "salary") ask("Delete salary payment?", `${formatMoney(row.amount)} paid to ${row.payee} on ${formatDate(row.date)} will be removed. The salary balance will increase by this amount.`, { type: "deleteSalaryPayment", id: row.salaryId, paymentId: row.id, expectedVersion: row.salaryVersion }, "Salary payment removed.");
    else ask("Delete expense?", `Remove ${row.name} · ${formatMoney(row.amount)}?`, { type: "deleteExpense", id: row.id, expectedVersion: row.version || 1 }, "Expense removed.");
  };
  const annual = MONTHS.map((name, index) => {
    const period = `${year}-${String(index + 1).padStart(2, "0")}`;
    return { name, month: period, total: sumMoney(ledger.filter(row => row.date?.startsWith(period) && row.status === "Paid").map(row => row.amount)) };
  });
  const annualMax = Math.max(1, ...annual.map(row => row.total));
  const categoryTotals = categories.map(name => ({ name, amount: sumMoney(ledger.filter(row => row.date?.startsWith(month) && row.category === name && row.status === "Paid").map(row => row.amount)) })).filter(row => row.amount > 0).sort((a, b) => b.amount - a.amount);

  if (!allowed) return <div className="expense-manager em-page"><Empty title="Expense Manager · Master Admin only">Sign in with the existing Master Admin account to manage company expenses, employee bank details and payroll.</Empty></div>;

  const quickPanels = <div className="em-quick-grid">
    <section className="em-quick"><div><div className="em-quick-title"><Icon name="people" size={24} /><h2>Employees</h2></div><p>Name, contact, joining date, salary, PAN &amp; bank details</p><p>{employees.length} employee{employees.length === 1 ? "" : "s"} · {employees.filter(row => row.active !== false).length} active</p></div><Button icon="plus" disabled={disabled} onClick={() => openForm("employee")}>Add Employee</Button></section>
    <section className="em-quick"><div><div className="em-quick-title"><Icon name="tag" size={24} /><h2>Expense Names</h2></div><div className="em-chips">{[...new Set(names.filter(row => row.active !== false).map(row => row.category))].slice(0, 5).map(name => <button type="button" className="em-chip" key={name} onClick={() => { selectTab("Expenses"); setCategory(name); }}>{name}</button>)}</div></div><Button icon="plus" disabled={disabled} onClick={() => openForm("name")}>Add Name</Button></section>
  </div>;

  const expenseTable = (rows, paginated = true) => rows.length ? <>
    <Table headers={["Date", "Expense Name", "Category", "Employee / Vendor", "Payment Mode", "Amount", "Status", "Actions"]} minWidth={950} footer={<tr><td colSpan={5}>Total{category || search ? " · filtered" : ""}<small className="em-secondary-line">Pending bills are excluded from paid totals.</small></td><td className="em-number">{formatMoney(sumMoney(rows.filter(row => row.status === "Paid").map(row => row.amount)))}<small className="em-secondary-line">Pending: {formatMoney(sumMoney(rows.filter(row => row.status === "Pending").map(row => row.amount)))}</small></td><td colSpan={2} /></tr>}>
      {(paginated ? visible : rows.slice(0, 6)).map(row => <tr key={row.ledgerId}>
        <td className="em-nowrap">{formatDate(row.date)}</td><td><strong>{row.name}</strong>{row.reference && <small className="em-secondary-line">{row.reference}</small>}</td><td>{row.category}</td><td>{row.payee || "—"}</td><td>{row.paymentMode}</td><td className="em-number"><strong>{formatMoney(row.amount)}</strong></td><td><Status>{row.status}</Status></td>
        <td><RowActions disabled={busy} editLabel={row.kind === "salary" ? "View salary payments" : `Edit ${row.name}`} onEdit={() => row.kind === "salary" ? setModal({ kind: "history", recordId: row.salaryId }) : openForm("expense", data.expenses[row.id])} onDelete={() => deleteLedgerRow(row)} /></td>
      </tr>)}
    </Table>{paginated && <Pagination count={rows.length} page={pageIndex} onPage={setPage} />}
  </> : <Empty title="No expenses found">{search || category ? "Try a different search or category." : "Add an expense or record a salary payment to see it here."}</Empty>;

  return <main className="expense-manager em-page">
    <div className="em-heading"><div><h1>Expense Manager</h1><p className="em-subtitle">Manage company expenses, employees and salaries</p></div><div className="em-toolbar">
      <Button variant="secondary" icon="refresh" disabled={busy || loading} onClick={refresh}>{loading ? "Loading…" : "Refresh"}</Button>
      <Button icon="plus" disabled={disabled} onClick={() => openForm("expense")}>Add Expense</Button>
      <Button variant="secondary" icon="download" disabled={!snapshot || exporting} onClick={exportExcel}>{exporting ? "Exporting…" : "Export Excel"}</Button>
    </div></div>

    {error && <div className="em-alert em-alert-error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError("")}><Icon name="close" size={16} /></button></div>}
    {notice && <div className="em-alert em-alert-success" role="status">{notice}<button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}><Icon name="close" size={16} /></button></div>}
    <div className="em-stats" aria-busy={loading}>
      <StatCard label={`${MONTHS[Number(month.slice(5)) - 1]} Expense`} value={summary.total} icon="receipt" description="Payments this month" />
      <StatCard label="Salary Paid" value={summary.salaryPaid} icon="people" color="green" description="By payment date" />
      <StatCard label="Other Expenses" value={summary.otherExpenses} icon="card" color="amber" description="Paid expenses" />
      <StatCard label="Pending Salary" value={summary.pendingSalary} icon="clock" color="red" description={`Payroll · ${monthTitle(month)}`} />
    </div>
    <div className="em-tabs" role="tablist" aria-label="Expense Manager sections">{TABS.map(name => <button type="button" key={name} id={`em-tab-${name.replaceAll(" ", "-")}`} role="tab" aria-selected={tab === name} aria-controls="em-tab-panel" className="em-tab" onClick={() => selectTab(name)} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const index = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (TABS.indexOf(name) + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length; selectTab(TABS[index]); document.getElementById(`em-tab-${TABS[index].replaceAll(" ", "-")}`)?.focus(); }} tabIndex={tab === name ? 0 : -1}>{name}</button>)}</div>
    <div className="em-filters" style={tab === "Employees" || tab === "Expense Names" ? { gridTemplateColumns: "1fr" } : undefined}>
      {tab !== "Employees" && tab !== "Expense Names" && <>
        <div className="em-field"><label htmlFor="em-year">Year</label><select id="em-year" value={year} onChange={event => { setMonth(`${event.target.value}-${month.slice(5)}`); setPage(0); }}>{years.map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="em-field"><label htmlFor="em-month">Month</label><select id="em-month" value={month.slice(5)} onChange={event => { setMonth(`${year}-${event.target.value}`); setPage(0); }}>{MONTHS.map((name, index) => <option key={name} value={String(index + 1).padStart(2, "0")}>{name}</option>)}</select></div>
        <div className="em-field"><label htmlFor="em-category">Category</label><select id="em-category" value={category} disabled={tab === "Salary"} onChange={event => { setCategory(event.target.value); setPage(0); }}><option value="">All categories</option>{categories.map(name => <option key={name}>{name}</option>)}</select></div>
      </>}
      <div className="em-field"><label htmlFor="em-search">Search{tab === "Employees" ? " employees" : tab === "Expense Names" ? " expense names" : ""}</label><input id="em-search" type="search" placeholder={tab === "Employees" ? "Name, mobile, employee code, department…" : tab === "Salary" ? "Search employee or salary status…" : "Search expense…"} value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div>
    </div>
    {snapshot && <div id="em-tab-panel" role="tabpanel" aria-labelledby={`em-tab-${tab.replaceAll(" ", "-")}`}>
      {tab === "Expenses" && <>
        <section className="em-panel"><div className="em-section-heading"><div><h2>{monthTitle(month)} · Expense Details</h2><p>{filteredLedger.length} record{filteredLedger.length === 1 ? "" : "s"} · Salaries appear automatically when paid</p></div><div className="em-toolbar"><span className="em-sync"><span className="em-sync-dot" />{snapshot.fromCache ? "Cached" : "Updated"} {new Date(snapshot.loadedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</span><Button variant="secondary" icon="calendar" disabled={disabled} onClick={() => { const candidates = recurringCandidates(data, month); if (!candidates.length) { setNotice("No new monthly expenses to add. Mark expense names as monthly and set their default amounts."); return; } ask("Add monthly expenses?", `Create ${candidates.length} pending bill(s) for ${monthTitle(month)}. Existing monthly bills will not be duplicated.`, { type: "generateRecurring", month }, "Monthly expenses added as Pending.", candidates.map(row => `${row.name} · ${formatMoney(row.defaultAmount)}`)); }}>Add Monthly Expenses</Button></div></div>{expenseTable(filteredLedger)}</section>
        {quickPanels}
      </>}
      {tab === "Employees" && <section className="em-panel"><div className="em-section-heading"><div><h2>Company Employees</h2><p>{employees.length} total · Employee details are independent of the selected month</p></div><Button icon="plus" disabled={disabled} onClick={() => openForm("employee")}>Add Employee</Button></div>
        {employeeRows.length ? <><Table headers={["Employee", "Contact", "Department", "Joining Date", "Monthly Salary", "Bank Account", "Status", "Actions"]} minWidth={1000}>{visible.map(row => <tr key={row.id}>
          <td><strong>{row.name}</strong><small className="em-secondary-line">{row.employeeCode || "No code"}{row.designation ? ` · ${row.designation}` : ""}</small></td><td>{row.mobile}<small className="em-secondary-line">{row.email || "—"}</small></td><td>{row.department || "—"}</td><td>{formatDate(row.joiningDate)}</td><td className="em-number">{formatMoney(row.monthlySalary)}</td><td>{row.accountNumber ? `•••• ${row.accountNumber.slice(-4)}` : "—"}<small className="em-secondary-line">{row.bankName || "Bank not set"}</small></td><td><Status>{row.active === false ? "Inactive" : "Active"}</Status></td><td><RowActions disabled={busy} editLabel={`Edit ${row.name}`} onEdit={() => openForm("employee", row)} onDelete={() => ask("Delete employee?", `Remove ${row.name}? Employees with linked expenses or payroll must be made Inactive instead.`, { type: "deleteEmployee", id: row.id, expectedVersion: row.version || 1 }, "Employee removed.")} /></td>
        </tr>)}</Table><Pagination count={employeeRows.length} page={pageIndex} onPage={setPage} /></> : <Empty title={search ? "No matching employees" : "Add your first employee"}>Manage contact details, salary, PAN and bank information in one place.</Empty>}
      </section>}
      {tab === "Salary" && <section className="em-panel"><div className="em-section-heading"><div><h2>{monthTitle(month)} · Salary</h2><p>Monthly salary snapshots · Bonus, deductions and partial payments</p></div><div className="em-toolbar"><Button variant="secondary" icon="calendar" disabled={disabled || !payroll.some(row => !row.prepared)} onClick={() => ask("Prepare monthly salary?", `Create salary records for ${payroll.filter(row => !row.prepared).length} employee(s) for ${monthTitle(month)}. Existing salary records and payments stay as saved.`, { type: "preparePayroll", month }, "Monthly salary records prepared.")}>Prepare Monthly Salary</Button><Button icon="plus" disabled={disabled || !employees.length} onClick={() => openForm("salary")}>Add Salary</Button></div></div>
        {salaryRows.length ? <><Table headers={["Employee", "Base Salary", "Bonus", "Deductions", "Net Salary", "Paid", "Pending", "Status", "Actions"]} minWidth={1130} footer={<tr><td colSpan={4}>Total · selected payroll month</td><td className="em-number">{formatMoney(sumMoney(salaryRows.map(salaryNet)))}</td><td className="em-number">{formatMoney(sumMoney(salaryRows.map(salaryPaid)))}</td><td className="em-number">{formatMoney(sumMoney(salaryRows.map(salaryBalance)))}</td><td colSpan={2} /></tr>}>{visible.map(row => <tr key={row.id}>
          <td><strong>{row.employeeName}</strong>{!row.prepared && <small className="em-secondary-line">Not prepared</small>}</td><td className="em-number">{formatMoney(row.baseSalary)}</td><td className="em-number">{formatMoney(row.bonus)}</td><td className="em-number">{formatMoney(row.deductions)}</td><td className="em-number"><strong>{formatMoney(salaryNet(row))}</strong></td><td className="em-number">{formatMoney(salaryPaid(row))}</td><td className="em-number">{formatMoney(salaryBalance(row))}</td><td><Status>{salaryStatus(row)}</Status></td><td><div className="em-actions">{salaryBalance(row) > 0 && <Button variant="ghost" disabled={busy} onClick={() => paySalary(row)}>Pay</Button>}{row.prepared && <Button variant="ghost" disabled={busy} onClick={() => setModal({ kind: "history", recordId: row.id })}>History</Button>}<RowActions disabled={busy} editLabel={`Edit salary for ${row.employeeName}`} onEdit={() => openForm("salary", row)} onDelete={row.prepared ? () => ask("Delete salary record?", `Remove the ${monthTitle(row.month)} salary record for ${row.employeeName}? Records with payments cannot be deleted.`, { type: "deleteSalary", id: row.id, expectedVersion: row.version || 1 }, "Salary record removed.") : undefined} /></div></td>
        </tr>)}</Table><Pagination count={salaryRows.length} page={pageIndex} onPage={setPage} /></> : <Empty title="No salary records for this month">Add employees with their joining dates and monthly salaries, then prepare payroll for the selected month.</Empty>}
      </section>}
      {tab === "Expense Names" && <section className="em-panel"><div className="em-section-heading"><div><h2>Expense Names</h2><p>Custom names, categories, default amounts and monthly bills</p></div><Button icon="plus" disabled={disabled} onClick={() => openForm("name")}>Add Name</Button></div>
        {nameRows.length ? <><Table headers={["Expense Name", "Category", "Default Amount", "Monthly", "Vendor", "Status", "Actions"]} minWidth={850}>{visible.map(row => <tr key={row.id}>
          <td><strong>{row.name}</strong></td><td>{row.category}</td><td className="em-number">{formatMoney(row.defaultAmount)}</td><td>{row.monthly ? `Yes · Day ${row.dueDay}` : "—"}</td><td>{row.vendor || "—"}</td><td><Status>{row.active === false ? "Inactive" : "Active"}</Status></td><td><RowActions disabled={busy} editLabel={`Edit ${row.name}`} onEdit={() => openForm("name", row)} onDelete={() => ask("Delete expense name?", `Remove ${row.name}? Names already used in expenses can be made Inactive instead.`, { type: "deleteName", id: row.id, expectedVersion: row.version || 1 }, "Expense name removed.")} /></td>
        </tr>)}</Table><Pagination count={nameRows.length} page={pageIndex} onPage={setPage} /></> : <Empty title="No matching expense names">Add a name with its category and default amount.</Empty>}
      </section>}
      {tab === "Overview" && <>
        <div className="em-overview-grid"><section className="em-panel"><div className="em-section-heading"><div><h2>Monthly Spending · {year}</h2><p>Paid expenses and salary payments</p></div><strong>{formatMoney(sumMoney(annual.map(row => row.total)))}</strong></div><div className="em-chart" role="img" aria-label={`Monthly paid expenses in ${year}: ${annual.map(row => `${row.name} ${formatMoney(row.total)}`).join(", ")}`}>{annual.map(row => <div className="em-bar-item" key={row.month} title={`${row.name}: ${formatMoney(row.total)}`}><div className="em-bar-track"><div className={`em-bar ${row.month === month ? "em-bar-current" : ""}`} style={{ height: `${row.total / annualMax * 100}%` }} /></div><small>{row.name.slice(0, 3)}</small></div>)}</div></section>
          <section className="em-panel"><div className="em-section-heading"><div><h2>Expense Breakdown</h2><p>{monthTitle(month)} · Paid amounts by category</p></div></div>{categoryTotals.length ? <div className="em-category-list">{categoryTotals.map(row => <div key={row.name}><div className="em-category-line"><span>{row.name}</span><strong>{formatMoney(row.amount)}</strong></div><div className="em-progress"><span style={{ width: `${row.amount / Math.max(summary.total, 1) * 100}%` }} /></div></div>)}</div> : <Empty title="No paid expenses yet">Paid expenses will appear here.</Empty>}<div className="em-overview-note">Pending bills: <strong>{formatMoney(summary.pendingExpenses)}</strong></div></section></div>
        <section className="em-panel"><div className="em-section-heading"><h2>Recent Expenses · {monthTitle(month)}</h2><Button variant="ghost" onClick={() => selectTab("Expenses")}>View All <Icon name="arrow" size={14} /></Button></div>{expenseTable(filteredLedger, false)}</section>{quickPanels}
      </>}
    </div>}
    {!snapshot && !loading && <Empty title="Expense data could not be loaded" action={<Button icon="refresh" variant="secondary" onClick={refresh}>Try Again</Button>}>Check the error above and use Refresh to try again.</Empty>}
    {!snapshot && loading && <Empty title="Loading expense data…">Reading your expense document.</Empty>}

    {modal && modal.kind !== "history" && <ExpenseForm key={`${modal.kind}-${modal.record?.id || "new"}`} kind={modal.kind} record={modal.record} data={data} month={month} busy={busy} onClose={() => setModal(null)} onSave={async command => { await execute(command); setModal(null); }} />}
    {modal?.kind === "history" && data.salaries[modal.recordId] && (() => {
      const salary = data.salaries[modal.recordId];
      const payments = Object.values(salary.payments || {}).sort((a, b) => b.date.localeCompare(a.date));
      return <Modal title="Salary Payment History" description={`${salary.employeeName} · ${monthTitle(salary.month)}`} onClose={() => setModal(null)} busy={busy} wide>
        <div className="em-history-summary"><div><small>Net Salary</small><strong>{formatMoney(salaryNet(salary))}</strong></div><div><small>Paid</small><strong>{formatMoney(salaryPaid(salary))}</strong></div><div><small>Pending</small><strong>{formatMoney(salaryBalance(salary))}</strong></div></div>
        <div className="em-payment-history">{payments.length ? <Table headers={["Date", "Payment Mode", "Reference", "Amount", "Actions"]} minWidth={580}>{payments.map(payment => <tr key={payment.id}><td>{formatDate(payment.date)}</td><td>{payment.paymentMode}</td><td>{payment.reference || "—"}</td><td className="em-number">{formatMoney(payment.amount)}</td><td><button type="button" className="em-icon-button em-danger-icon" title="Delete salary payment" aria-label="Delete salary payment" disabled={busy} onClick={() => { setModal(null); ask("Delete salary payment?", `Remove ${formatMoney(payment.amount)} paid on ${formatDate(payment.date)}? The salary balance will increase.`, { type: "deleteSalaryPayment", id: salary.id, paymentId: payment.id, expectedVersion: salary.version || 1 }, "Salary payment removed."); }}><Icon name="trash" size={16} /></button></td></tr>)}</Table> : <Empty title="No payments recorded yet" />}</div>
        <div className="em-modal-footer"><Button variant="secondary" onClick={() => setModal(null)}>Close</Button>{salaryBalance(salary) > 0 && <Button icon="plus" disabled={busy} onClick={() => openForm("payment", salary)}>Record Payment</Button>}</div>
      </Modal>;
    })()}
    {confirmation && <Modal title={confirmation.title} busy={busy} onClose={() => { if (!busy) setConfirmation(null); }}><div className="em-confirm-body"><p>{confirmation.description}</p>{confirmation.items && <ul>{confirmation.items.map(item => <li key={item}>{item}</li>)}</ul>}{confirmError && <div className="em-alert em-alert-error" role="alert">{confirmError}</div>}</div><div className="em-modal-footer"><Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button><Button variant={confirmation.command.type.startsWith("delete") ? "danger" : "primary"} disabled={busy} onClick={confirm}>{busy ? "Saving…" : "Confirm"}</Button></div></Modal>}
  </main>;
}
