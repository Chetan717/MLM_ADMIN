// Safely compose the supplied boundary with current production rules.
// Never deploys, guesses collection aliases, or weakens an existing boundary.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [currentPath, outputPath = path.join(root, 'firestore.rules')] = process.argv.slice(2);
if (!currentPath) throw new Error('Usage: node tools/install-payment-rules.mjs /path/to/exported-current.rules [output.rules]');
const current = fs.readFileSync(currentPath, 'utf8');
const boundary = fs.readFileSync(path.join(root, 'firestore.payment.rules'), 'utf8');
// Mask comments/strings while preserving character offsets for brace parsing.
function mask(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, value => value.replace(/[^\n]/g, ' '));
}
function blocks(source) {
  const clean = mask(source), result = [], re = /\bmatch\s+([^\s]+)\s*\{/g;
  for (const match of clean.matchAll(re)) {
    let depth = 1, end = match.index + match[0].length;
    while (depth && end < clean.length) { if (clean[end] === '{') depth++; if (clean[end] === '}') depth--; end++; }
    if (depth) throw new Error('Unbalanced rules; refusing to write.');
    result.push({ path: match[1], start: match.index, bodyStart: match.index + match[0].length, end });
  }
  return result;
}
const additions = blocks(boundary), main = additions.find(b => b.path === '/databases/{database}/documents');
const matches = additions.filter(b => b.start > main.start && b.end < main.end);
const protectedNames = new Set(matches.map(b => b.path.split('/')[1]));
const existing = blocks(current), documents = existing.find(b => b.path === '/databases/{database}/documents');
if (!documents) throw new Error('Expected one Firestore documents match. Export your current rules without changing their structure.');
if (/\bfunction\s+payment(?:Panel|Tab|OwnMobile)\b/.test(current)) throw new Error('Payment rules are already installed; review the existing rules instead of merging twice.');
const deletes = [];
for (const block of existing) {
  if (block === documents || block.start < documents.bodyStart || block.end > documents.end) continue;
  const collection = block.path.split('/')[1];
  if (collection?.includes('{')) {
    const body = current.slice(block.bodyStart, block.end - 1).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    const permissions = [...body.matchAll(/\ballow\s+[^:]+:\s*if\s+([^;]+);/g)];
    if (permissions.some(permission => permission[1].trim() !== 'false')) throw new Error(`Broad wildcard ${block.path} overlaps payment collections. Scope it to named non-payment collections before installing.`);
  }
  if (protectedNames.has(collection)) {
    // Replace the complete old collection block, including nested grants.
    if (!deletes.some(parent => block.start >= parent.start && block.end <= parent.end)) deletes.push(block);
  }
}
let out = current;
for (const block of deletes.sort((a, b) => b.start - a.start)) out = out.slice(0, block.start) + out.slice(block.end);
const target = blocks(out).find(b => b.path === '/databases/{database}/documents');
const inserted = boundary.slice(main.bodyStart, main.end - 1);
out = out.slice(0, target.end - 1) + '\n' + inserted + '\n' + out.slice(target.end - 1);
fs.writeFileSync(outputPath, out);
console.log(`Created ${path.resolve(outputPath)}. Review, test in Emulator, then deploy rules and indexes before enabling payments.`);
