import test from "node:test";
import assert from "node:assert/strict";
import { applyExpenseCommand, normalizeExpenseDocument, emptyExpenseDocument, ledgerRows, monthSummary, payrollRows, payrollId, salaryNet, salaryPaid, salaryBalance, employeeForMonth, recurringCandidates, filterLedger, sumMoney, validDate, indiaToday, DOCUMENT_BUDGET } from "../src/Pages/ExpenseManager/expenseModel.js";
import { createExpenseStore, CACHE_TTL } from "../src/Pages/ExpenseManager/expenseStore.js";

const context = { now: "2026-10-22T10:00:00.000Z", actor: "test-admin" };
const employee = { name: "Test Employee", employeeCode: "E001", mobile: "9000000000", monthlySalary: "30000", joiningDate: "2026-09-01", active: true, pan: "ABCDE1234F", ifsc: "SBIN0001234", accountNumber: "001234567890" };
const run = (data, command) => applyExpenseCommand(data, command, context);
function company() { return run(null, { type: "saveEmployee", id: "employee-1", values: employee }); }
function salary(data = company(), month = "2026-10") { return run(data, { type: "saveSalary", id: payrollId("employee-1", month), values: { employeeId: "employee-1", month, baseSalary: 30000, bonus: 500, deductions: 250 } }); }
function payment(data, id, value, date = "2026-10-05") { return run(data, { type: "addSalaryPayment", id: payrollId("employee-1", "2026-10"), paymentId: id, values: { amount: value, date, paymentMode: "Bank" } }); }
const expenseValues = { nameId: "office-rent", date: "2026-10-01", status: "Paid", amount: "20000", payee: "Office owner", paymentMode: "Bank" };

test("empty Firestore document gives usable expense names without sample transactions", () => {
  const data = normalizeExpenseDocument({ placeholder: "keep" });
  assert.equal(data.placeholder, "keep");
  assert.ok(data.expenseNames["office-rent"]);
  assert.equal(ledgerRows(data).length, 0);
  assert.equal(Object.keys(data.employees).length, 0);
});
test("employee banking strings retain leading zeroes and mutations preserve unrelated document fields", () => {
  const original = { ...emptyExpenseDocument(), customConfig: { keep: true } };
  const next = run(original, { type: "saveEmployee", id: "employee-1", values: employee });
  assert.equal(next.employees["employee-1"].accountNumber, "001234567890");
  assert.deepEqual(next.customConfig, { keep: true });
  assert.equal(Object.keys(original.employees).length, 0);
  assert.equal(next.updatedBy, "test-admin");
});
test("bad PAN, IFSC, phone, negative salary and leaving date fail before data changes", () => {
  for (const invalid of [{ pan: "bad" }, { ifsc: "123" }, { mobile: "123" }, { monthlySalary: "-1" }, { leavingDate: "2026-08-31" }]) {
    assert.throws(() => run(null, { type: "saveEmployee", id: "employee-1", values: { ...employee, ...invalid } }));
  }
});
test("employee code is unique and linked employees cannot be deleted", () => {
  const data = company();
  assert.throws(() => run(data, { type: "saveEmployee", id: "employee-2", values: employee }), /already exists/);
  assert.throws(() => run(salary(data), { type: "deleteEmployee", id: "employee-1", expectedVersion: 1 }), /Inactive/);
});
test("stale employee edits cannot silently replace newer edits", () => {
  const data = company();
  const latest = run(data, { type: "saveEmployee", id: "employee-1", expectedVersion: 1, values: { ...employee, name: "New name" } });
  assert.throws(() => run(latest, { type: "saveEmployee", id: "employee-1", expectedVersion: 1, values: employee }), /another session/);
  assert.equal(latest.employees["employee-1"].name, "New name");
});
test("calendar validation rejects rolled-over dates and India date is used at the UTC boundary", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(indiaToday(new Date("2026-10-21T20:00:00Z")), "2026-10-22");
});
test("money totals are exact to paise", () => {
  assert.equal(sumMoney([0.1, 0.2, 0.3]), 0.6);
  assert.equal(salaryNet({ baseSalary: 100.1, bonus: 0.2, deductions: 0.3 }), 100);
});
test("partial salary payments appear once in the cash ledger and pending salary falls", () => {
  const data = payment(salary(), "payment-1", "10000.25");
  const row = data.salaries[payrollId("employee-1", "2026-10")];
  assert.equal(salaryPaid(row), 10000.25);
  assert.equal(salaryBalance(row), 20249.75);
  assert.equal(ledgerRows(data).length, 1);
  assert.deepEqual(monthSummary(data, "2026-10"), { total: 10000.25, salaryPaid: 10000.25, otherExpenses: 0, pendingSalary: 20249.75, pendingExpenses: 0 });
});
test("multiple salary payments keep their individual dates and do not move old cash between months", () => {
  let data = payment(salary(), "payment-1", 10000, "2026-10-31");
  data = payment(data, "payment-2", 20250, "2026-11-03");
  assert.equal(monthSummary(data, "2026-10").salaryPaid, 10000);
  assert.equal(monthSummary(data, "2026-11").salaryPaid, 20250);
  assert.equal(monthSummary(data, "2026-10").pendingSalary, 0);
  assert.equal(ledgerRows(data).length, 2);
});
test("overpayments, duplicate payment retries and negative payments are rejected", () => {
  const data = payment(salary(), "payment-1", 20000);
  assert.throws(() => payment(data, "payment-2", 10250.01), /exceeds/);
  assert.throws(() => payment(data, "payment-1", 1), /already recorded/);
  assert.throws(() => payment(data, "payment-2", -1), /positive/);
});
test("salary edits cannot make net pay less than payments; employee salary edits preserve older payroll", () => {
  let data = payment(salary(), "payment-1", 20000);
  const id = payrollId("employee-1", "2026-10");
  assert.throws(() => run(data, { type: "saveSalary", id, expectedVersion: data.salaries[id].version, values: { ...data.salaries[id], baseSalary: 1000 } }), /lower than payments/);
  data = run(data, { type: "saveEmployee", id: "employee-1", expectedVersion: 1, values: { ...employee, monthlySalary: 40000 } });
  assert.equal(data.salaries[id].baseSalary, 30000);
  assert.equal(payrollRows(data, "2026-11")[0].baseSalary, 40000);
});
test("deleting a payment atomically removes its expense and restores salary pending", () => {
  const data = payment(salary(), "payment-1", 20000);
  const id = payrollId("employee-1", "2026-10");
  const next = run(data, { type: "deleteSalaryPayment", id, paymentId: "payment-1", expectedVersion: data.salaries[id].version });
  assert.equal(ledgerRows(next).length, 0);
  assert.equal(monthSummary(next, "2026-10").pendingSalary, 30250);
  assert.equal(ledgerRows(data).length, 1);
});
test("preparing payroll is idempotent and respects employee employment months", () => {
  const data = company();
  assert.equal(payrollRows(data, "2026-08").length, 0);
  const first = run(data, { type: "preparePayroll", month: "2026-10" });
  const second = run(first, { type: "preparePayroll", month: "2026-10" });
  assert.equal(Object.keys(second.salaries).length, 1);
  assert.equal(second.salaries[payrollId("employee-1", "2026-10")].version, 1);
  assert.equal(employeeForMonth({ ...employee, active: false, leavingDate: "2026-10-15" }, "2026-09"), true);
  assert.equal(employeeForMonth({ ...employee, active: false, leavingDate: "2026-10-15" }, "2026-11"), false);
});
test("pending bills are excluded from paid cards and payment date controls cash month", () => {
  let data = run(null, { type: "saveExpense", id: "bill-1", values: { ...expenseValues, status: "Pending" } });
  assert.equal(monthSummary(data, "2026-10").total, 0);
  assert.equal(monthSummary(data, "2026-10").pendingExpenses, 20000);
  data = run(data, { type: "saveExpense", id: "bill-1", expectedVersion: 1, values: { ...expenseValues, paymentDate: "2026-11-02" } });
  assert.equal(monthSummary(data, "2026-10").total, 0);
  assert.equal(monthSummary(data, "2026-11").total, 20000);
});
test("monthly bills are idempotent, clamp due day for February and remain pending", () => {
  let data = run(null, { type: "saveName", id: "monthly-rent", values: { name: "Monthly rent", category: "Rent", defaultAmount: 20000, monthly: true, dueDay: 31, paymentMode: "Bank", vendor: "Owner", active: true } });
  data = run(data, { type: "generateRecurring", month: "2026-02" });
  data = run(data, { type: "generateRecurring", month: "2026-02" });
  assert.equal(Object.keys(data.expenses).length, 1);
  assert.equal(Object.values(data.expenses)[0].date, "2026-02-28");
  assert.equal(Object.values(data.expenses)[0].status, "Pending");
  assert.equal(recurringCandidates(data, "2026-02").length, 0);
});
test("names in use cannot be deleted and reserved salary category avoids duplicate payroll entries", () => {
  const data = run(null, { type: "saveExpense", id: "bill-1", values: expenseValues });
  assert.throws(() => run(data, { type: "deleteName", id: "office-rent", expectedVersion: 1 }), /Inactive/);
  assert.throws(() => run(null, { type: "saveName", id: "salary", values: { name: "Team Salary", category: "Salary", defaultAmount: 0, paymentMode: "Bank" } }), /Salary tab/);
});
test("search and category filtering operate entirely on ledger data", () => {
  let data = run(salary(), { type: "saveExpense", id: "bill-1", values: expenseValues });
  data = payment(data, "payment-1", 10000);
  assert.equal(filterLedger(ledgerRows(data), { month: "2026-10", category: "Rent", search: "owner" }).length, 1);
  assert.equal(filterLedger(ledgerRows(data), { month: "2026-10", search: "test employee" }).length, 1);
});
test("unknown schemas and malformed maps fail without overwriting data", () => {
  assert.throws(() => normalizeExpenseDocument({ schemaVersion: 2 }), /unsupported/);
  assert.throws(() => normalizeExpenseDocument({ expenses: [] }), /map/);
  assert.throws(() => normalizeExpenseDocument({ employees: { bad: "text" } }), /map/);
});
test("single document capacity guard rejects growth but permits cleanup of an oversized existing document", () => {
  const data = { ...company(), legacyField: "x".repeat(DOCUMENT_BUDGET) };
  assert.throws(() => run(data, { type: "saveExpense", id: "bill-1", values: expenseValues }), /nearly full/);
  const next = run(data, { type: "deleteEmployee", id: "employee-1", expectedVersion: 1 });
  assert.equal(Object.keys(next.employees).length, 0);
});

const admin = { uid: "uid-1", id: "test-admin", role: "Master Admin" };
function mockStore() {
  let raw = null, uid = admin.uid, time = 1_790_000_000_000, reads = 0, writes = 0, failRead = false, failWrite = false;
  const store = createExpenseStore({ getUid: () => uid, clock: () => time,
    readDocument: async () => { reads += 1; if (failRead) throw new Error("Offline"); return structuredClone(raw); },
    transact: async mutate => { if (failWrite) throw new Error("Offline"); const next = mutate(structuredClone(raw)); raw = structuredClone(next); writes += 1; return next; },
  });
  return { store, get reads() { return reads; }, get writes() { return writes; }, get raw() { return raw; }, setUid: value => { uid = value; }, advance: value => { time += value; }, failRead: () => { failRead = true; }, failWrite: () => { failWrite = true; } };
}
test("cache deduplicates StrictMode reads, reuses data for five minutes, refreshes on expiry or force", async () => {
  const api = mockStore();
  await Promise.all([api.store.load(admin), api.store.load(admin)]);
  assert.equal(api.reads, 1);
  assert.equal(api.writes, 0);
  assert.equal((await api.store.load(admin)).fromCache, true);
  assert.equal(api.reads, 1);
  api.advance(CACHE_TTL + 1);
  await api.store.load(admin);
  assert.equal(api.reads, 2);
  await api.store.load(admin, true);
  assert.equal(api.reads, 3);
});
test("cache is scoped to the signed-in Master Admin and clear removes cached bank data", async () => {
  const api = mockStore();
  await api.store.load(admin);
  assert.equal(api.store.cached({ ...admin, role: "Admin" }), null);
  await assert.rejects(api.store.load({ ...admin, role: "Admin" }), /Master Admin/);
  api.setUid("uid-2");
  assert.equal(api.store.cached(admin), null);
  await assert.rejects(api.store.save(admin, {}), /Master Admin/);
  api.store.clear(); api.setUid(admin.uid);
  assert.equal(api.store.cached(admin), null);
});
test("save updates cache without a second fetch, failed writes keep the last confirmed cache", async () => {
  const api = mockStore();
  await api.store.load(admin);
  await api.store.save(admin, { type: "saveEmployee", id: "employee-1", values: employee });
  assert.equal(api.reads, 1); assert.equal(api.writes, 1);
  assert.equal((await api.store.load(admin)).data.employees["employee-1"].monthlySalary, 30000);
  api.failWrite();
  await assert.rejects(api.store.save(admin, { type: "deleteEmployee", id: "employee-1", expectedVersion: 1 }), /Offline/);
  assert.ok(api.store.cached(admin).data.employees["employee-1"]);
});
test("an old refresh cannot replace a newer successful save in cache", async () => {
  let resolveRead;
  const store = createExpenseStore({ getUid: () => admin.uid, readDocument: () => new Promise(resolve => { resolveRead = resolve; }), transact: async mutate => mutate(null) });
  const pending = store.load(admin);
  await store.save(admin, { type: "saveEmployee", id: "employee-1", values: employee });
  resolveRead(null);
  const result = await pending;
  assert.ok(result.data.employees["employee-1"]);
});
test("signout invalidates in-flight reads and failed refresh retains known-good cached data", async () => {
  let resolveRead;
  const store = createExpenseStore({ getUid: () => admin.uid, readDocument: () => new Promise(resolve => { resolveRead = resolve; }), transact: async mutate => mutate(null) });
  const pending = store.load(admin);
  store.clear(); resolveRead(null);
  await assert.rejects(pending, /session changed/);
  assert.equal(store.cached(admin), null);
  const api = mockStore(); await api.store.load(admin); api.failRead();
  await assert.rejects(api.store.load(admin, true), /Offline/);
  assert.ok(api.store.cached(admin));
});
