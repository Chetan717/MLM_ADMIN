import { Children, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { commitNativeSelection, filterSelectOptions, nextEnabledOption, sortSelectOptions } from './selectOptions.js';
import './SearchableSelect.css';
import { useActiveAdminTab } from '../Context/AdminTabContext.js';

function textOf(children) {
  let text = '';
  Children.forEach(children, child => {
    if (typeof child === 'string' || typeof child === 'number') text += child;
    else if (isValidElement(child)) text += textOf(child.props.children);
  });
  return text.trim();
}

function collectOptions(children, group = '', disabled = false, output = []) {
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      const text = textOf(child.props.children);
      output.push({ value: String(child.props.value ?? text), label: String(child.props.label ?? text),
        group, disabled: disabled || Boolean(child.props.disabled), index: output.length, selected: child.props.selected });
    } else collectOptions(child.props.children, child.type === 'optgroup' ? child.props.label : group,
      disabled || Boolean(child.props.disabled), output);
  });
  return output;
}

export default function SearchableSelect({ children, className = '', style, sortOrder = 'alphabetical',
  searchPlaceholder = 'Search options…', ...props }) {
  const generated = useId();
  const pageVisible = useActiveAdminTab();
  const visibleId = props.id || `admin-select-${generated}`;
  const listId = `${visibleId}-options`;
  const ariaLabel = props['aria-label'];
  const hostRef = useRef(null), nativeRef = useRef(null), buttonRef = useRef(null);
  const menuRef = useRef(null), searchRef = useRef(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0), [position, setPosition] = useState(null);
  const [label, setLabel] = useState(props['aria-label'] || ''), [invalidText, setInvalidText] = useState('');
  const options = useMemo(() => collectOptions(children), [children]);
  const ordered = useMemo(() => sortSelectOptions(options, sortOrder), [options, sortOrder]);
  const filtered = useMemo(() => filterSelectOptions(ordered, query), [ordered, query]);
  const [uncontrolledValue, setUncontrolledValue] = useState(() => props.defaultValue ??
    (props.multiple ? [] : (options.find(row => row.selected)?.value ?? options.find(row => !row.disabled)?.value ?? '')));
  const value = props.value !== undefined ? props.value : uncontrolledValue;
  const selectedValues = new Set((props.multiple ? (Array.isArray(value) ? value : []) : [value ?? '']).map(String));
  const selected = options.filter(row => selectedValues.has(row.value));
  const selectedLabel = selected.map(row => row.label).join(', ') || options.find(row => row.value === '')?.label || 'Select…';
  const fullWidth = /(?:^|\s)w-full(?:\s|$)/.test(className) || style?.width === '100%';
  const layoutClasses = className.split(/\s+/).filter(item => /^(?:(?:md|sm|lg):)?(?:w-|min-w-|max-w-|flex-1$|grow$|col-span-)/.test(item)).join(' ');

  useLayoutEffect(() => {
    const button = buttonRef.current;
    const related = button.labels?.[0] || hostRef.current.parentElement?.querySelector(':scope > label');
    setLabel(ariaLabel || related?.textContent?.replace(/\s+/g, ' ').trim() || props.title || props.name || 'Select option');
  }, [ariaLabel, props.title, props.name, props.id]);

  useEffect(() => {
    const form = nativeRef.current?.form;
    const reset = () => queueMicrotask(() => {
      const node = nativeRef.current;
      if (node && props.value === undefined) setUncontrolledValue(props.multiple ? [...node.selectedOptions].map(option => option.value) : node.value);
      setOpen(false); setQuery(''); setInvalidText('');
    });
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, [props.value, props.multiple]);

  useLayoutEffect(() => {
    if (props.value !== undefined || !nativeRef.current) return;
    const node = nativeRef.current;
    const next = props.multiple ? [...node.selectedOptions].map(option => option.value) : node.value;
    setUncontrolledValue(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, [options, props.value, props.multiple]);

  useLayoutEffect(() => {
    if (!open || props.disabled || !pageVisible) return;
    const viewport = window.visualViewport;
    const measure = () => {
      const node = buttonRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const topEdge = viewport?.offsetTop || 0;
      const bottomEdge = topEdge + (viewport?.height || window.innerHeight);
      const availableBelow = bottomEdge - rect.bottom - 8;
      const availableAbove = rect.top - topEdge - 8;
      const below = availableBelow >= 240 || availableBelow >= availableAbove;
      const height = Math.max(90, Math.min(330, below ? availableBelow : availableAbove));
      const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        top: below ? rect.bottom + 4 : Math.max(topEdge + 8, rect.top - height - 4), width, height,
        dark: Boolean(node.closest('.dark')), fontFamily: getComputedStyle(node).fontFamily });
    };
    const outside = event => {
      if (!hostRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const scroll = event => { if (!menuRef.current?.contains(event.target)) measure(); };
    measure();
    searchRef.current?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', scroll, true);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', scroll, true);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  }, [open, props.disabled, pageVisible]);

  useEffect(() => {
    if (!pageVisible) { setOpen(false); setQuery(''); }
  }, [pageVisible]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  const close = (focus = false) => { setOpen(false); setQuery(''); if (focus) buttonRef.current?.focus(); };
  const show = () => {
    if (props.disabled) return;
    setQuery('');
    const index = ordered.findIndex(row => selectedValues.has(row.value) && !row.disabled);
    setActiveIndex(index < 0 ? Math.max(0, nextEnabledOption(ordered, -1, 1)) : index);
    setOpen(true);
  };
  const choose = row => {
    const native = nativeRef.current;
    if (!native || !row || row.disabled || props.disabled) return;
    commitNativeSelection(native, row.value, props.multiple, selectedValues);
    setInvalidText('');
    if (!props.multiple) close(true);
  };
  const keys = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') { close(true); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const start = event.key === 'Home' ? -1 : event.key === 'End' ? filtered.length : activeIndex;
      setActiveIndex(nextEnabledOption(filtered, start, ['ArrowUp', 'End'].includes(event.key) ? -1 : 1));
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation(); choose(filtered[activeIndex]);
    }
  };

  return <span ref={hostRef} className={`admin-select-host ${layoutClasses}`} style={{ width: fullWidth ? '100%' : style?.width, flex: style?.flex }}>
    <select {...props} id={`${visibleId}-native`} ref={nativeRef} value={props.value}
      className="admin-select-native" tabIndex={-1} aria-hidden="true"
      onFocus={() => buttonRef.current?.focus()}
      onChange={event => {
        if (props.value === undefined) setUncontrolledValue(props.multiple ? [...event.target.selectedOptions].map(option => option.value) : event.target.value);
        props.onChange?.(event);
      }}
      onInvalid={event => {
        props.onInvalid?.(event); event.preventDefault();
        setInvalidText(event.target.validationMessage || 'Please select an option.');
        buttonRef.current?.focus(); show();
      }}>{children}</select>
    <button ref={buttonRef} type="button" id={visibleId} disabled={props.disabled} className={`admin-select-trigger ${className}`}
      style={style} title={props.title} role="combobox" aria-label={`${label || 'Select option'}: ${selectedLabel}`}
      aria-haspopup="listbox" aria-expanded={open && pageVisible && !props.disabled} aria-controls={open && pageVisible ? listId : undefined}
      aria-required={props.required || undefined} aria-invalid={invalidText ? true : props['aria-invalid']}
      aria-describedby={props['aria-describedby']}
      onClick={() => open ? close() : show()}
      onKeyDown={event => {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); }
      }}>
      <span className="admin-select-value">{selectedLabel}</span><span className="admin-select-chevron" aria-hidden="true">▾</span>
    </button>
    {invalidText && <span role="alert" className="admin-select-error">{invalidText}</span>}
    {open && pageVisible && !props.disabled && createPortal(<div ref={menuRef} className="admin-select-menu" data-theme={position?.dark ? 'dark' : 'light'}
      style={{ left: position?.left || 8, top: position?.top || 8, width: position?.width || 240,
        maxHeight: position?.height || 330, fontFamily: position?.fontFamily }}>
      <div className="admin-select-search-row">
        <input ref={searchRef} type="search" role="combobox" autoComplete="off" value={query}
          aria-label={`Search ${label || 'options'}`} aria-expanded="true" aria-controls={listId}
          aria-activedescendant={filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          placeholder={searchPlaceholder} onKeyDown={keys}
          onChange={event => { setQuery(event.target.value); setActiveIndex(0); }} />
      </div>
      <div id={listId} role="listbox" aria-label={label || 'Options'} aria-multiselectable={props.multiple || undefined} className="admin-select-options">
        {filtered.map((row, index) => <button key={`${row.index}:${row.value}`} id={`${listId}-${index}`} type="button" tabIndex={-1}
          role="option" aria-selected={selectedValues.has(row.value)} aria-disabled={row.disabled || undefined} disabled={row.disabled}
          data-option-index={index} data-active={index === activeIndex || undefined} className="admin-select-option"
          onPointerMove={event => { if (event.pointerType === 'mouse' && !row.disabled) setActiveIndex(index); }}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(row)}>
          <span>{row.label}{row.group && <small>{row.group}</small>}</span><span aria-hidden="true">{selectedValues.has(row.value) ? '✓' : ''}</span>
        </button>)}
        {!filtered.length && <p className="admin-select-empty" role="status">No matching options</p>}
      </div>
    </div>, document.body)}
  </span>;
}
