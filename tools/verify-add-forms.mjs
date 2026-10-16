import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const forms = [
  "src/Pages/Templates/Forms/AddTemplate.jsx",
  "src/Pages/companies/Forms/AddCompanies.jsx",
  "src/Pages/Graphics/Form/AddGraphics.jsx",
];
let failed = false;
for (const relativePath of forms) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) {
    console.error(`FAIL: Missing source: ${relativePath}`);
    failed = true;
    continue;
  }
  const source = fs.readFileSync(file, "utf8");
  const componentStart = source.search(/export\s+default\s+function\s+\w+\s*\(/);
  const body = componentStart < 0 ? "" : source.slice(componentStart);
  const hook = body.search(/const\s+unsavedGuard\s*=\s*useUnsavedFormGuard\s*\(/);
  const loading = body.search(/const\s*\[\s*loading\s*,\s*setLoading\s*\]\s*=\s*useState\s*\(/);
  const success = body.search(/const\s*\[\s*success\s*,\s*setSuccess\s*\]\s*=\s*useState\s*\(/);
  const form = body.search(/const\s*\[\s*form\s*,\s*setForm\s*\]\s*=\s*useState\s*\(/);
  if (componentStart < 0 || [hook, loading, success, form].some((v) => v < 0) || !(form < hook && loading < hook && success < hook)) {
    failed = true;
    console.error(`FAIL: ${relativePath}: guard is reading state before declaration, or expected code is missing.`);
  } else {
    console.log(`PASS: ${relativePath}: state is initialized before guard.`);
  }
}
if (failed) {
  console.error("\nSTOP: Admin Add Form TDZ check failed. Do not deploy this build.");
  process.exitCode = 1;
} else {
  console.log("\nPASS: The three known Add Form TDZ crashes are fixed in this SOURCE. Live deployment must still be checked.");
}
