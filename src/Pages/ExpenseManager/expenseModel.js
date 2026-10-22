// This module deliberately has no Firebase or UI dependency. All money totals,
// payroll links and conflict checks use the same rules in the UI and transactions.
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const PAYMENT_MODES = ["Bank", "UPI", "Cash", "Card", "Cheque", "Other"];
export const CATEGORIES = ["Rent", "Salary", "Marketing", "Software", "Utilities", "Office", "Travel", "Other"];
export const DOCUMENT_BUDGET = 800 * 1024; // Conservative headroom under Firestore's 1 MiB document limit.
const MAPS = ["employees", "expenseNames", "expenses", "salaries"];
const DEFAULT_NAMES = [
  ["office-rent", "Office Rent", "Rent"], ["facebook-ads", "Facebook Ads", "Marketing"],
  ["hosting", "Hosting", "Software"], ["electricity", "Electricity", "Utilities"],
  ["office-supplies", "Office Supplies", "Office"], ["travel", "Travel", "Travel"],
];

export function emptyExpenseDocument() {
  return {
    schemaVersion: 1, revision: 0, employees: {}, expenses: {}, salaries: {},
    expenseNames: Object.fromEntries(DEFAULT_NAMES.map(([id, name, category]) => [id, {
      id, name, category, defaultAmount: 0, monthly: false, dueDay: 1,
      paymentMode: "Bank", vendor: "", active: true, version: 1,
    }])),
  };
}

export function normalizeExpenseDocument(raw) {
  if (raw == null) return emptyExpenseDocument();
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("Expense document format is invalid. Please check the setup guide.");
  if (raw.schemaVersion != null && raw.schemaVersion !== 1) throw new Error("This expense document uses an unsupported version. Update the panel before editing it.");
  const data = { ...emptyExpenseDocument(), ...raw };
  for (const key of MAPS) {
    const value = data[key];
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(row => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new Error(`The ${key} field must be a map. Existing data has not been changed.`);
    }
    data[key] = Object.fromEntries(Object.entries(value).map(([id, row]) => [id, { ...row, id }]));
  }
  return data;
}

export function indiaToday(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
export function sumMoney(values) { return values.reduce((total, value) => total + Math.round((Number(value) || 0) * 100), 0) / 100; }
export function formatMoney(value) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(money(value)); }
export function formatDate(value) {
  return validDate(value) ? new Date(`${value}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";
}
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validMonth(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || ""); }
export function monthTitle(value) { return validMonth(value) ? `${MONTHS[Number(value.slice(5)) - 1]} ${value.slice(0, 4)}` : "Selected month"; }
export function payrollId(employeeId, month) { return `salary-${employeeId}-${month}`; }
export function canManageExpenses(session) { return session?.role === "Master Admin"; }

function text(value, label, required = false, limit = 180) {
  const result = String(value ?? "").trim();
  if (required && !result) throw new Error(`${label} is required.`);
  if (result.length > limit) throw new Error(`${label} must be ${limit} characters or fewer.`);
  return result;
}
function amount(value, label, allowZero = false) {
  const str = String(value ?? "").trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(str) || (!allowZero && Number(str) <= 0)) throw new Error(`${label} must be ${allowZero ? "zero or a positive amount" : "a positive amount"} with up to 2 decimal places.`);
  return money(str);
}
function checkedDate(value, label, optional = false) {
  if (optional && !value) return "";
  if (!validDate(value)) throw new Error(`${label} must be a valid date.`);
  return value;
}
function paymentMode(value) {
  if (!PAYMENT_MODES.includes(value)) throw new Error("Select a valid payment mode.");
  return value;
}
function checkVersion(row, expectedVersion) {
  if (!row) throw new Error("This record no longer exists. Refresh and try again.");
  if ((row.version || 1) !== expectedVersion) throw new Error("This record was changed in another session. Refresh and open it again before saving.");
}
function uniqueName(rows, id, field, value, label) {
  if (Object.values(rows).some(row => row.id !== id && String(row[field] || "").toLowerCase() === value.toLowerCase())) throw new Error(`${label} already exists.`);
}
function saveRow(data, collection, id, payload, command, context) {
  if (!/^[a-zA-Z0-9_-]{1,150}$/.test(id || "")) throw new Error("Invalid record ID.");
  const previous = data[collection][id];
  if (command.expectedVersion != null) checkVersion(previous, command.expectedVersion);
  else if (previous) throw new Error("This record already exists. Refresh and try again.");
  data[collection][id] = { ...previous, ...payload, id, version: (previous?.version || 0) + 1, createdAt: previous?.createdAt || context.now, updatedAt: context.now, updatedBy: context.actor };
}

export function employeeForMonth(employee, month) {
  if (!validMonth(month)) return false;
  const from = employee.joiningDate?.slice(0, 7) || "0000-01";
  const until = employee.leavingDate?.slice(0, 7) || "9999-12";
  return from <= month && until >= month && (employee.active !== false || Boolean(employee.leavingDate));
}
export function salaryNet(row) { return money(money(row.baseSalary) + money(row.bonus) - money(row.deductions)); }
export function salaryPaid(row) { return sumMoney(Object.values(row.payments || {}).map(payment => payment.amount)); }
export function salaryBalance(row) { return money(salaryNet(row) - salaryPaid(row)); }
export function salaryStatus(row) { return salaryBalance(row) <= 0 ? "Paid" : salaryPaid(row) > 0 ? "Partial" : "Pending"; }
export function payrollRows(data, month) {
  const saved = Object.values(data.salaries).filter(row => row.month === month).map(row => ({ ...row, prepared: true }));
  const represented = new Set(saved.map(row => row.employeeId));
  const unsaved = Object.values(data.employees).filter(employee => employeeForMonth(employee, month) && !represented.has(employee.id)).map(employee => ({
    id: payrollId(employee.id, month), employeeId: employee.id, employeeName: employee.name, month,
    baseSalary: employee.monthlySalary, bonus: 0, deductions: 0, payments: {}, prepared: false,
  }));
  return [...saved, ...unsaved].sort((a, b) => String(a.employeeName).localeCompare(String(b.employeeName)));
}
export function ledgerRows(data) {
  const expenses = Object.values(data.expenses).map(row => ({ ...row, ledgerId: row.id, kind: "expense", status: row.status || "Paid", date: row.status === "Pending" ? row.date : row.paymentDate || row.date }));
  const salaries = Object.values(data.salaries).flatMap(salary => Object.values(salary.payments || {}).map(payment => ({
    ...payment, ledgerId: `${salary.id}:${payment.id}`, kind: "salary", salaryId: salary.id, salaryVersion: salary.version,
    name: `Salary · ${monthTitle(salary.month)}`, category: "Salary", payee: salary.employeeName,
    employeeId: salary.employeeId, status: "Paid", payrollMonth: salary.month,
  })));
  return [...expenses, ...salaries].sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.ledgerId.localeCompare(b.ledgerId));
}
export function filterLedger(rows, { month, category = "", search = "" }) {
  const query = search.trim().toLowerCase();
  return rows.filter(row => row.date?.startsWith(month) && (!category || row.category === category) && (!query || [row.name, row.category, row.payee, row.paymentMode, row.reference, row.notes, row.status].some(value => String(value || "").toLowerCase().includes(query))));
}
export function monthSummary(data, month) {
  const rows = filterLedger(ledgerRows(data), { month });
  const paid = rows.filter(row => row.status === "Paid");
  return {
    total: sumMoney(paid.map(row => row.amount)), salaryPaid: sumMoney(paid.filter(row => row.kind === "salary").map(row => row.amount)),
    otherExpenses: sumMoney(paid.filter(row => row.kind === "expense").map(row => row.amount)),
    pendingSalary: sumMoney(payrollRows(data, month).map(salaryBalance)),
    pendingExpenses: sumMoney(rows.filter(row => row.status === "Pending").map(row => row.amount)),
  };
}
export function recurringCandidates(data, month) {
  return Object.values(data.expenseNames).filter(row => row.active !== false && row.monthly && money(row.defaultAmount) > 0 && !Object.values(data.expenses).some(expense => expense.recurringKey === `${row.id}:${month}`));
}
export function documentBytes(data) { return new TextEncoder().encode(JSON.stringify(data)).length; }

export function applyExpenseCommand(raw, command, { now = new Date().toISOString(), actor = "" } = {}) {
  const source = normalizeExpenseDocument(raw);
  const data = { ...source };
  for (const key of MAPS) data[key] = { ...source[key] };
  const context = { now, actor };
  const form = command.values || {};
  const id = command.id;
  switch (command.type) {
    case "saveEmployee": {
      const name = text(form.name, "Employee name", true);
      const employeeCode = text(form.employeeCode, "Employee code", false, 40);
      if (employeeCode) uniqueName(data.employees, id, "employeeCode", employeeCode, "Employee code");
      const mobile = text(form.mobile, "Mobile", true, 10);
      if (!/^\d{10}$/.test(mobile)) throw new Error("Mobile must contain 10 digits.");
      const email = text(form.email, "Email");
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
      const pan = text(form.pan, "PAN", false, 10).toUpperCase();
      if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) throw new Error("Enter a valid PAN number.");
      const ifsc = text(form.ifsc, "IFSC", false, 11).toUpperCase();
      if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new Error("Enter a valid IFSC code.");
      const accountNumber = text(form.accountNumber, "Bank account number", false, 30);
      if (accountNumber && !/^\d{6,30}$/.test(accountNumber)) throw new Error("Bank account number must contain 6–30 digits.");
      const joiningDate = checkedDate(form.joiningDate, "Joining date");
      const leavingDate = checkedDate(form.leavingDate, "Leaving date", true);
      if (leavingDate && leavingDate < joiningDate) throw new Error("Leaving date cannot be before joining date.");
      const fields = ["alternateMobile", "designation", "department", "employmentType", "gender", "maritalStatus", "city", "emergencyContact", "bankName", "branch", "accountHolder", "upiId", "uan", "esiNumber"];
      const details = Object.fromEntries(fields.map(key => [key, text(form[key], key)]));
      saveRow(data, "employees", id, {
        ...details, name, employeeCode, mobile, email, pan, ifsc, accountNumber, joiningDate, leavingDate,
        dateOfBirth: checkedDate(form.dateOfBirth, "Date of birth", true),
        monthlySalary: amount(form.monthlySalary, "Monthly salary", true), active: form.active !== false,
        address: text(form.address, "Address", false, 600), notes: text(form.notes, "Notes", false, 1000),
      }, command, context);
      break;
    }
    case "deleteEmployee": {
      checkVersion(data.employees[id], command.expectedVersion);
      if (Object.values(data.expenses).some(row => row.employeeId === id) || Object.values(data.salaries).some(row => row.employeeId === id)) throw new Error("This employee has linked expenses or payroll. Set the employee to Inactive instead to preserve history.");
      delete data.employees[id];
      break;
    }
    case "saveName": {
      const name = text(form.name, "Expense name", true, 100);
      uniqueName(data.expenseNames, id, "name", name, "Expense name");
      const category = text(form.category, "Category", true, 60);
      if (category.toLowerCase() === "salary") throw new Error("Record employee salary from the Salary tab so it is counted once.");
      const dueDay = Number(form.dueDay || 1);
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) throw new Error("Due day must be between 1 and 31.");
      const defaultAmount = amount(form.defaultAmount || 0, "Default amount", true);
      if (form.monthly && !defaultAmount) throw new Error("Set a default amount for a monthly expense.");
      saveRow(data, "expenseNames", id, { name, category, defaultAmount, monthly: Boolean(form.monthly), dueDay, paymentMode: paymentMode(form.paymentMode), vendor: text(form.vendor, "Vendor"), active: form.active !== false }, command, context);
      break;
    }
    case "deleteName": {
      checkVersion(data.expenseNames[id], command.expectedVersion);
      if (Object.values(data.expenses).some(row => row.nameId === id)) throw new Error("This expense name is in use. Set it to Inactive to preserve history.");
      delete data.expenseNames[id];
      break;
    }
    case "saveExpense": {
      const template = data.expenseNames[form.nameId];
      if (!template) throw new Error("Add or select a valid expense name first.");
      const employee = form.employeeId ? data.employees[form.employeeId] : null;
      if (form.employeeId && !employee) throw new Error("The selected employee no longer exists.");
      if (!["Paid", "Pending"].includes(form.status)) throw new Error("Select a valid expense status.");
      saveRow(data, "expenses", id, {
        nameId: template.id, name: template.name, category: template.category,
        date: checkedDate(form.date, "Expense date"), status: form.status,
        paymentDate: form.status === "Paid" ? checkedDate(form.paymentDate || form.date, "Payment date") : "",
        employeeId: employee?.id || "", payee: employee?.name || text(form.payee, "Employee / vendor", true),
        amount: amount(form.amount, "Amount"), paymentMode: paymentMode(form.paymentMode),
        reference: text(form.reference, "Payment reference"), notes: text(form.notes, "Notes", false, 1000),
      }, command, context);
      break;
    }
    case "deleteExpense":
      checkVersion(data.expenses[id], command.expectedVersion);
      delete data.expenses[id];
      break;
    case "preparePayroll": {
      if (!validMonth(command.month)) throw new Error("Select a valid payroll month.");
      for (const row of payrollRows(data, command.month).filter(row => !row.prepared)) {
        saveRow(data, "salaries", row.id, { ...row, notes: "", payments: {} }, {}, context);
        delete data.salaries[row.id].prepared;
      }
      break;
    }
    case "saveSalary": {
      const employee = data.employees[form.employeeId];
      if (!employee) throw new Error("Select a valid employee.");
      if (!validMonth(form.month)) throw new Error("Select a valid salary month.");
      const salaryId = payrollId(employee.id, form.month);
      if (id !== salaryId) throw new Error("Employee and payroll month cannot be changed for an existing salary record.");
      if (!data.salaries[id] && !employeeForMonth(employee, form.month)) throw new Error("This employee was not employed in the selected month. Check joining / leaving dates.");
      const existing = data.salaries[id];
      const payload = { employeeId: employee.id, employeeName: existing?.employeeName || employee.name, month: form.month,
        baseSalary: amount(form.baseSalary, "Base salary", true), bonus: amount(form.bonus || 0, "Bonus", true),
        deductions: amount(form.deductions || 0, "Deductions", true), notes: text(form.notes, "Notes", false, 1000), payments: existing?.payments || {},
      };
      if (salaryNet(payload) < 0) throw new Error("Deductions cannot exceed base salary plus bonus.");
      if (salaryBalance(payload) < 0) throw new Error("Net salary cannot be lower than payments already recorded.");
      saveRow(data, "salaries", id, payload, command, context);
      break;
    }
    case "deleteSalary":
      checkVersion(data.salaries[id], command.expectedVersion);
      if (Object.keys(data.salaries[id].payments || {}).length) throw new Error("Remove salary payments before deleting a salary record.");
      delete data.salaries[id];
      break;
    case "addSalaryPayment": {
      const salary = data.salaries[id];
      if (!salary) throw new Error("Save or prepare the salary record before recording a payment.");
      const paymentId = command.paymentId;
      if (!/^[a-zA-Z0-9_-]{1,150}$/.test(paymentId || "")) throw new Error("Invalid payment ID.");
      if (salary.payments?.[paymentId]) throw new Error("This payment was already recorded. Refresh to see it.");
      const paymentAmount = amount(form.amount, "Payment amount");
      if (paymentAmount > salaryBalance(salary)) throw new Error("Payment exceeds the remaining salary balance. Refresh and check existing payments.");
      const payment = { id: paymentId, amount: paymentAmount, date: checkedDate(form.date, "Payment date"), paymentMode: paymentMode(form.paymentMode), reference: text(form.reference, "Payment reference"), notes: text(form.notes, "Notes", false, 1000), createdAt: now, createdBy: actor };
      saveRow(data, "salaries", id, { payments: { ...salary.payments, [paymentId]: payment } }, { expectedVersion: salary.version || 1 }, context);
      break;
    }
    case "deleteSalaryPayment": {
      const salary = data.salaries[id];
      checkVersion(salary, command.expectedVersion);
      if (!salary.payments?.[command.paymentId]) throw new Error("This payment no longer exists. Refresh and try again.");
      const payments = { ...salary.payments };
      delete payments[command.paymentId];
      saveRow(data, "salaries", id, { payments }, command, context);
      break;
    }
    case "generateRecurring": {
      if (!validMonth(command.month)) throw new Error("Select a valid month.");
      for (const template of recurringCandidates(data, command.month)) {
        const expenseId = `monthly-${template.id}-${command.month}`;
        if (data.expenses[expenseId]) continue;
        const lastDay = new Date(Number(command.month.slice(0, 4)), Number(command.month.slice(5)), 0).getDate();
        const date = `${command.month}-${String(Math.min(template.dueDay || 1, lastDay)).padStart(2, "0")}`;
        saveRow(data, "expenses", expenseId, { nameId: template.id, name: template.name, category: template.category, date, status: "Pending", paymentDate: "", employeeId: "", payee: template.vendor || template.name, amount: template.defaultAmount, paymentMode: template.paymentMode || "Bank", reference: "", notes: "", recurringKey: `${template.id}:${command.month}` }, {}, context);
      }
      break;
    }
    default: throw new Error("Unknown expense action.");
  }
  data.schemaVersion = 1;
  data.revision = (Number(source.revision) || 0) + 1;
  data.updatedAt = now;
  data.updatedBy = actor;
  if (documentBytes(data) > DOCUMENT_BUDGET && documentBytes(data) >= documentBytes(source)) throw new Error("The expense document is nearly full. Export and remove older records before adding more. No changes were saved.");
  return data;
}
