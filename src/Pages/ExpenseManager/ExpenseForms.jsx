import { useEffect, useState } from "react";
import { Button, Field, Modal, Icon } from "./ExpenseUI";
import { CATEGORIES, PAYMENT_MODES, indiaToday, money, formatMoney, salaryNet, salaryBalance, payrollId, monthTitle } from "./expenseModel";

function newRecordId() { return globalThis.crypto.randomUUID(); }
const defaults = {
  employee: { name: "", employeeCode: "", mobile: "", alternateMobile: "", email: "", designation: "", department: "", employmentType: "Full-time", joiningDate: "", leavingDate: "", monthlySalary: "", dateOfBirth: "", gender: "", maritalStatus: "", city: "", address: "", emergencyContact: "", pan: "", bankName: "", branch: "", accountHolder: "", accountNumber: "", ifsc: "", upiId: "", uan: "", esiNumber: "", active: true, notes: "" },
  expense: { nameId: "", date: "", amount: "", employeeId: "", payee: "", status: "Paid", paymentDate: "", paymentMode: "Bank", reference: "", notes: "" },
  name: { name: "", category: "Office", defaultAmount: 0, monthly: false, dueDay: 1, vendor: "", paymentMode: "Bank", active: true },
  salary: { employeeId: "", month: "", baseSalary: 0, bonus: 0, deductions: 0, notes: "" },
  payment: { amount: "", date: "", paymentMode: "Bank", reference: "", notes: "" },
};
const commandTypes = { employee: "saveEmployee", expense: "saveExpense", name: "saveName", salary: "saveSalary", payment: "addSalaryPayment" };
const titles = { employee: "Employee", expense: "Expense", name: "Expense Name", salary: "Salary", payment: "Salary Payment" };

function initialValues(kind, record, month) {
  const today = indiaToday();
  const initial = { ...defaults[kind], ...record };
  if (kind === "employee") initial.joiningDate ||= today;
  if (kind === "expense") { initial.date ||= `${month}-${today.startsWith(month) ? today.slice(-2) : "01"}`; initial.paymentDate ||= initial.date; }
  if (kind === "salary") initial.month ||= month;
  if (kind === "payment") return { ...defaults.payment, amount: salaryBalance(record), date: today };
  return initial;
}

export default function ExpenseForm({ kind, record, data, month, busy, onSave, onClose }) {
  const [initial] = useState(() => initialValues(kind, record, month));
  const [values, setValues] = useState(initial);
  const [error, setError] = useState("");
  const [recordId] = useState(() => kind === "payment" ? newRecordId() : record?.id || newRecordId());
  const dirty = JSON.stringify(initial) !== JSON.stringify(values);
  const editing = Boolean(record?.version) && kind !== "payment";
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, busy]);
  const close = () => { if (!busy && (!dirty || window.confirm("Discard unsaved changes to this form?"))) onClose(); };
  const change = (name, value) => {
    setError("");
    setValues(previous => {
      const next = { ...previous, [name]: value };
      if (["pan", "ifsc"].includes(name)) next[name] = value.toUpperCase();
      if (kind === "expense" && name === "nameId") {
        const template = data.expenseNames[value];
        if (template) { next.amount = template.defaultAmount || ""; next.payee = template.vendor || ""; next.paymentMode = template.paymentMode || "Bank"; }
      }
      if (kind === "salary" && name === "employeeId") next.baseSalary = data.employees[value]?.monthlySalary || 0;
      return next;
    });
  };
  const field = (name, label, props = {}) => <Field name={name} label={label} values={values} onChange={change} disabled={busy} maxLength={180} {...props} />;
  const section = title => <h3 className="em-form-section">{title}</h3>;
  const submit = async event => {
    event.preventDefault();
    if (busy) return;
    setError("");
    try {
      const id = kind === "salary" ? payrollId(values.employeeId, values.month) : recordId;
      await onSave({ type: commandTypes[kind], id: kind === "payment" ? record.id : id, values,
        ...(editing ? { expectedVersion: record.version || 1 } : {}),
        ...(kind === "payment" ? { paymentId: recordId } : {}),
      });
    } catch (err) { setError(err.message || "Could not save. Please try again."); }
  };
  const employeeOptions = [{ value: "", label: "Select employee" }, ...Object.values(data.employees).filter(employee => employee.active !== false || employee.id === values.employeeId).map(employee => ({ value: employee.id, label: `${employee.name}${employee.employeeCode ? ` · ${employee.employeeCode}` : ""}` }))];
  const nameOptions = [{ value: "", label: "Select expense name" }, ...Object.values(data.expenseNames).filter(name => name.active !== false || name.id === values.nameId).map(name => ({ value: name.id, label: `${name.name} · ${name.category}` }))];
  const amountProps = { type: "number", min: 0, max: 999999999.99, step: "0.01", maxLength: undefined };
  return <Modal title={`${editing ? "Edit" : kind === "payment" ? "Record" : "Add"} ${titles[kind]}`} description={kind === "payment" ? `${record.employeeName} · ${monthTitle(record.month)} · Remaining ${formatMoney(salaryBalance(record))}` : kind === "employee" ? "Personal, employment, salary and bank details" : undefined} onClose={close} busy={busy} wide={kind === "employee"}>
    <form onSubmit={submit} autoComplete="off">
      <div className="em-form-body"><fieldset disabled={busy} className="em-fieldset">
        <div className="em-form-grid">
          {kind === "employee" && <>
            {section("Personal details")}
            {field("name", "Full name", { required: true })}{field("employeeCode", "Employee code", { maxLength: 40 })}
            {field("mobile", "Mobile", { required: true, type: "tel", inputMode: "numeric", pattern: "[0-9]{10}", maxLength: 10 })}{field("email", "Email", { type: "email" })}
            {field("alternateMobile", "Alternate mobile", { type: "tel" })}{field("dateOfBirth", "Date of birth", { type: "date", max: indiaToday() })}
            {field("gender", "Gender", { options: [{ value: "", label: "Select" }, "Male", "Female", "Other"] })}{field("maritalStatus", "Marital status", { options: [{ value: "", label: "Select" }, "Married", "Unmarried"] })}
            {field("city", "City")}{field("emergencyContact", "Emergency contact")}
            {field("address", "Address", { as: "textarea", maxLength: 600, span: true })}
            {section("Employment & salary")}
            {field("designation", "Designation")}{field("department", "Department")}
            {field("employmentType", "Employment type", { options: ["Full-time", "Part-time", "Contract", "Intern"] })}{field("joiningDate", "Joining date", { type: "date", required: true })}
            {field("monthlySalary", "Monthly base salary (₹)", { ...amountProps, required: true })}{field("leavingDate", "Leaving date", { type: "date", min: values.joiningDate, hint: "Set a leaving date when making an employee inactive to retain past payroll eligibility." })}
            <label className="em-check"><input type="checkbox" checked={values.active} onChange={event => change("active", event.target.checked)} />Active employee</label>
            {section("Bank & tax details")}
            {field("pan", "PAN", { maxLength: 10, pattern: "[A-Za-z]{5}[0-9]{4}[A-Za-z]", placeholder: "ABCDE1234F" })}{field("accountHolder", "Account holder name")}
            {field("bankName", "Bank name")}{field("branch", "Bank branch")}
            {field("accountNumber", "Bank account number", { type: "text", inputMode: "numeric", maxLength: 30, pattern: "[0-9]{6,30}" })}{field("ifsc", "IFSC code", { maxLength: 11, pattern: "[A-Za-z]{4}0[A-Za-z0-9]{6}", placeholder: "SBIN0001234" })}
            {field("upiId", "UPI ID")}{field("uan", "UAN / PF number")}{field("esiNumber", "ESI number")}
            {field("notes", "Notes", { as: "textarea", maxLength: 1000, span: true })}
          </>}
          {kind === "expense" && <>
            {field("nameId", "Expense name", { options: nameOptions, required: true, span: true, hint: "Add custom names and categories from Expense Names." })}
            <div className="em-form-note em-field-wide"><Icon name="tag" size={16} />Category: {data.expenseNames[values.nameId]?.category || "Select an expense name"}</div>
            {field("date", "Expense / bill date", { type: "date", required: true })}{field("amount", "Amount (₹)", { ...amountProps, min: "0.01", required: true })}
            {field("employeeId", "Employee (optional)", { options: [{ value: "", label: "Vendor / other" }, ...employeeOptions.slice(1)] })}{field("payee", "Employee / vendor", { required: !values.employeeId, disabled: busy || Boolean(values.employeeId), value: values.employeeId ? data.employees[values.employeeId]?.name || "" : values.payee })}
            {field("status", "Status", { options: ["Paid", "Pending"] })}{field("paymentMode", "Payment mode", { options: PAYMENT_MODES })}
            {values.status === "Paid" && field("paymentDate", "Payment date", { type: "date", required: true })}
            {field("reference", "Payment / invoice reference")}{field("notes", "Notes", { as: "textarea", maxLength: 1000, span: true })}
          </>}
          {kind === "name" && <>
            {field("name", "Expense name", { required: true, maxLength: 100 })}{field("category", "Category", { required: true, maxLength: 60, list: "em-category-list", hint: "Choose a suggestion or type a custom category." })}
            <datalist id="em-category-list">{CATEGORIES.filter(category => category !== "Salary").map(category => <option key={category} value={category} />)}</datalist>
            {field("defaultAmount", "Default amount (₹)", amountProps)}{field("vendor", "Default vendor")}
            {field("paymentMode", "Default payment mode", { options: PAYMENT_MODES })}{field("dueDay", "Monthly due day", { type: "number", min: 1, max: 31, step: 1 })}
            <label className="em-check em-field-wide"><input type="checkbox" checked={values.monthly} onChange={event => change("monthly", event.target.checked)} />Repeat as a monthly expense</label>
            {values.monthly && <p className="em-form-note em-field-wide">Use “Add Monthly Expenses” to prepare this bill once per month. It stays Pending until paid.</p>}
            <label className="em-check em-field-wide"><input type="checkbox" checked={values.active} onChange={event => change("active", event.target.checked)} />Active expense name</label>
          </>}
          {kind === "salary" && <>
            {field("employeeId", "Employee", { options: employeeOptions, required: true, disabled: busy || editing || Boolean(record?.employeeId), span: true })}
            {field("month", "Salary month", { type: "month", required: true, disabled: busy || editing || Boolean(record?.employeeId) })}
            {field("baseSalary", "Base salary (₹)", { ...amountProps, required: true })}{field("bonus", "Bonus / allowances (₹)", amountProps)}{field("deductions", "Deductions (₹)", amountProps)}
            <div className="em-form-summary em-field-wide"><span>Net salary</span><strong>{formatMoney(salaryNet(values))}</strong></div>
            <p className="em-form-note em-field-wide">Base salary is a monthly snapshot. Record actual payments separately; partial payments are supported.</p>
            {field("notes", "Notes", { as: "textarea", maxLength: 1000, span: true })}
          </>}
          {kind === "payment" && <>
            {field("amount", "Payment amount (₹)", { ...amountProps, min: "0.01", max: money(salaryBalance(record)), required: true })}{field("date", "Payment date", { type: "date", required: true })}
            {field("paymentMode", "Payment mode", { options: PAYMENT_MODES })}{field("reference", "Payment reference")}
            {field("notes", "Notes", { as: "textarea", maxLength: 1000, span: true })}
            <p className="em-form-note em-field-wide">This payment appears automatically in Expenses on its payment date.</p>
          </>}
        </div>
        {error && <div className="em-alert em-alert-error" role="alert">{error}</div>}
      </fieldset></div>
      <div className="em-modal-footer"><Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button><Button type="submit" icon={busy ? undefined : "check"} disabled={busy}>{busy ? "Saving…" : kind === "payment" ? "Record Payment" : "Save Changes"}</Button></div>
    </form>
  </Modal>;
}
