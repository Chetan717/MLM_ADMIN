import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sortSelectOptions, filterSelectOptions, nextEnabledOption, searchText } from '../src/components/selectOptions.js';

const rows = values => values.map(([value, label, disabled = false], index) => ({ value, label, disabled, index }));
test('select choices sort by displayed name A–Z without changing IDs or the original list', () => {
  const options = rows([['z-id', 'Zulu'], ['b-id', 'beta'], ['a-id', 'Alpha'], ['2', 'Rank 2'], ['10', 'Rank 10']]);
  const before = JSON.stringify(options);
  assert.deepEqual(sortSelectOptions(options).map(row => row.label), ['Alpha', 'beta', 'Rank 2', 'Rank 10', 'Zulu']);
  assert.equal(sortSelectOptions(options)[0].value, 'a-id');
  assert.equal(JSON.stringify(options), before);
});
test('All, None, placeholders and all-company shortcuts stay available at the top', () => {
  const options = rows([['all', 'All companies'], ['none', 'No coupon'], ['', 'Select…'], ['__ALL_COMPANIES__', 'Copy to all'], ['z', 'Zulu'], ['a', 'Alpha']]);
  assert.deepEqual(sortSelectOptions(options).map(row => row.value), ['all', 'none', '', '__ALL_COMPANIES__', 'a', 'z']);
});
test('date, month and duration controls can preserve their meaningful original order', () => {
  const options = rows([['01', 'January'], ['02', 'February'], ['03', 'March']]);
  assert.deepEqual(sortSelectOptions(options, 'original'), options);
});
test('search matches names, IDs, mixed case, accents, Hindi and multiple terms', () => {
  const options = rows([['id-1', 'Éclair Company'], ['id-2', 'Alpha India'], ['id-3', 'तारा कंपनी']]);
  assert.equal(filterSelectOptions(options, 'ECLAIR')[0].value, 'id-1');
  assert.equal(filterSelectOptions(options, 'india alpha')[0].value, 'id-2');
  assert.equal(filterSelectOptions(options, 'id-3')[0].label, 'तारा कंपनी');
  assert.equal(filterSelectOptions(options, 'तारा')[0].value, 'id-3');
  assert.deepEqual(filterSelectOptions(options, 'unavailable'), []);
  assert.deepEqual(filterSelectOptions(options, '  '), options);
  assert.equal(searchText('  A   B '), 'a b');
});
test('keyboard navigation wraps and skips disabled choices', () => {
  const options = rows([['', 'Choose', true], ['a', 'Alpha'], ['b', 'Beta', true], ['z', 'Zulu']]);
  assert.equal(nextEnabledOption(options, -1, 1), 1);
  assert.equal(nextEnabledOption(options, 1, 1), 3);
  assert.equal(nextEnabledOption(options, 3, 1), 1);
  assert.equal(nextEnabledOption(options, 1, -1), 3);
  assert.equal(nextEnabledOption([], -1, 1), -1);
  assert.equal(nextEnabledOption(rows([['a', 'Unavailable', true]]), -1, 1), -1);
});
test('Admin pages use the shared searchable control rather than leaving native selects behind', () => {
  const source = fileURLToPath(new URL('../src/', import.meta.url));
  let migrated = 0;
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.[jt]sx?$/.test(entry.name) && entry.name !== 'SearchableSelect.jsx') {
        const text = fs.readFileSync(file, 'utf8');
        assert.doesNotMatch(text, /<select(?:\s|>)/, file);
        migrated += (text.match(/<SearchableSelect(?:\s|>)/g) || []).length;
      }
    }
  };
  walk(source);
  assert.equal(migrated, 52);
});
