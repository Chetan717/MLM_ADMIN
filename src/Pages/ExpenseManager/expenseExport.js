import { filterLedger, ledgerRows, monthSummary, monthTitle, payrollRows, salaryNet, salaryPaid, salaryBalance, salaryStatus } from "./expenseModel";

export async function exportExpenseWorkbook(data, filters) {
  // Lazy loading keeps spreadsheet code off the login and normal admin pages.
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const summary = monthSummary(data, filters.month);
  const add = (name, rows, headers) => {
    const sheet = XLSX.utils.json_to_sheet(rows, headers ? { header: headers } : {});
    const keys = headers || Object.keys(rows[0] || {});
    sheet["!cols"] = keys.map(key => ({ wch: Math.min(45, Math.max(16, key.length + 3)) }));
    if (rows.length) sheet["!autofilter"] = { ref: sheet["!ref"] };
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };
  add("Summary", [
    { Item: "Month", Value: monthTitle(filters.month) },
    { Item: "Expenses sheet filters", Value: [filters.category || "All categories", filters.search || "No search filter"].join(" · ") },
    { Item: "Paid expenses (whole month)", Value: summary.total },
    { Item: "Salary paid (payment date)", Value: summary.salaryPaid },
    { Item: "Other expenses paid", Value: summary.otherExpenses },
    { Item: "Pending salary (payroll month)", Value: summary.pendingSalary },
    { Item: "Pending bills", Value: summary.pendingExpenses },
  ]);
  add("Expenses", filterLedger(ledgerRows(data), filters).map(row => ({
    Date: row.date, "Expense Name": row.name, Category: row.category, "Employee / Vendor": row.payee,
    "Payment Mode": row.paymentMode, Amount: row.amount, Status: row.status,
    Reference: row.reference || "", Notes: row.notes || "", "Payroll Month": row.payrollMonth || "",
  })), ["Date", "Expense Name", "Category", "Employee / Vendor", "Payment Mode", "Amount", "Status", "Reference", "Notes", "Payroll Month"]);
  add("Employees", Object.values(data.employees).map(row => ({
    Code: row.employeeCode, Name: row.name, Mobile: row.mobile, Email: row.email, "Alternate Mobile": row.alternateMobile,
    Designation: row.designation, Department: row.department, "Employment Type": row.employmentType,
    "Joining Date": row.joiningDate, "Leaving Date": row.leavingDate, "Date of Birth": row.dateOfBirth,
    Gender: row.gender, "Marital Status": row.maritalStatus, City: row.city, Address: row.address,
    "Emergency Contact": row.emergencyContact, "Monthly Salary": row.monthlySalary, PAN: row.pan,
    "Account Holder": row.accountHolder, "Bank Name": row.bankName, Branch: row.branch,
    "Account Number": String(row.accountNumber || ""), IFSC: row.ifsc, "UPI ID": row.upiId,
    UAN: row.uan, "ESI Number": row.esiNumber, Status: row.active === false ? "Inactive" : "Active", Notes: row.notes,
  })), ["Code", "Name", "Mobile", "Email", "Alternate Mobile", "Designation", "Department", "Employment Type", "Joining Date", "Leaving Date", "Date of Birth", "Gender", "Marital Status", "City", "Address", "Emergency Contact", "Monthly Salary", "PAN", "Account Holder", "Bank Name", "Branch", "Account Number", "IFSC", "UPI ID", "UAN", "ESI Number", "Status", "Notes"]);
  add("Salary", payrollRows(data, filters.month).map(row => ({
    Month: row.month, Employee: row.employeeName, "Base Salary": row.baseSalary, Bonus: row.bonus, Deductions: row.deductions,
    "Net Salary": salaryNet(row), Paid: salaryPaid(row), Pending: salaryBalance(row), Status: salaryStatus(row),
    Prepared: row.prepared ? "Yes" : "No", Notes: row.notes || "",
  })), ["Month", "Employee", "Base Salary", "Bonus", "Deductions", "Net Salary", "Paid", "Pending", "Status", "Prepared", "Notes"]);
  add("Expense Names", Object.values(data.expenseNames).map(row => ({
    Name: row.name, Category: row.category, "Default Amount": row.defaultAmount, "Repeat Monthly": row.monthly ? "Yes" : "No",
    "Due Day": row.dueDay, Vendor: row.vendor, "Payment Mode": row.paymentMode, Status: row.active === false ? "Inactive" : "Active",
  })), ["Name", "Category", "Default Amount", "Repeat Monthly", "Due Day", "Vendor", "Payment Mode", "Status"]);
  XLSX.writeFile(workbook, `MLMLIVE_Expense_Manager_${filters.month}.xlsx`);
}
