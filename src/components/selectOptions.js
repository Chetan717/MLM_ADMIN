const collator = new Intl.Collator(['en-IN', 'hi-IN'], { sensitivity: 'base', numeric: true });
export const compareOptionLabels = (a, b) => collator.compare(String(a ?? '').trim(), String(b ?? '').trim());
export const searchText = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

export function sortSelectOptions(options, order = 'alphabetical') {
  if (order === 'original') return [...options];
  const pinned = row => row.value === '' || ['all', 'none', '__ALL_COMPANIES__'].includes(row.value);
  return [...options].sort((a, b) => {
    if (pinned(a) !== pinned(b)) return pinned(a) ? -1 : 1;
    if (pinned(a)) return a.index - b.index;
    return compareOptionLabels(a.label, b.label) || a.index - b.index;
  });
}

export function filterSelectOptions(options, query) {
  const terms = searchText(query).split(' ').filter(Boolean);
  if (!terms.length) return options;
  return options.filter(row => {
    const content = searchText(`${row.label} ${row.value} ${row.group || ''}`);
    return terms.every(term => content.includes(term));
  });
}

export function nextEnabledOption(options, current, direction) {
  if (!options.length) return -1;
  for (let step = 1; step <= options.length; step++) {
    const index = (current + direction * step + options.length * 2) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
}

// Keep the original select as the form control and emit its normal change
// event, so existing handlers keep receiving target.value/name/selectedOptions.
export function commitNativeSelection(select, value, multiple, currentValues) {
  if (multiple) {
    const next = new Set(currentValues);
    if (next.has(value)) next.delete(value); else next.add(value);
    for (const option of select.options) option.selected = next.has(option.value);
  } else select.value = value;
  const ChangeEvent = select.ownerDocument.defaultView.Event;
  select.dispatchEvent(new ChangeEvent('change', { bubbles: true }));
}
