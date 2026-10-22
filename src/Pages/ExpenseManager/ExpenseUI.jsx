import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

const PATHS = {
  plus: "M12 5v14m-7-7h14", close: "m6 6 12 12M6 18 18 6",
  download: "M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5",
  refresh: "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1",
  receipt: "M6 3h12v19l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h3",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M17 3a4 4 0 0 1 0 8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  card: "M3 7h18M3 11h18M5 16h4M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
  clock: "M12 7v5l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  edit: "m15 5 4 4M4 20l4-1L20 7a2.12 2.12 0 0 0-3-3L5 16l-1 4Z",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  tag: "m3 3 8 .1L22 14l-8 8L3.1 11 3 3Zm4 4h.01",
  search: "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  check: "m5 12 4 4L19 6", arrow: "M5 12h14m-5-5 5 5-5 5",
  calendar: "M8 2v4m8-4v4M3 10h18M4 4h16a1 1 0 0 1 1 1v16H3V5a1 1 0 0 1 1-1Z",
  shield: "m12 3 9 4v5c0 5-9 9-9 9S3 17 3 12V7l9-4Zm-4 9 3 3 5-6",
};
export function Icon({ name, size = 20, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={PATHS[name] || PATHS.receipt} /></svg>;
}
export function Button({ children, icon, variant = "primary", className = "", ...props }) {
  return <button type="button" className={`em-button em-${variant} ${className}`} {...props}>{icon && <Icon name={icon} size={17} />}{children}</button>;
}
export function Status({ children }) { return <span className={`em-status em-status-${String(children).toLowerCase().replaceAll(" ", "-")}`}>{children}</span>; }
export function Empty({ title, children, action }) {
  return <div className="em-empty"><span className="em-empty-icon"><Icon name="receipt" size={28} /></span><strong>{title}</strong>{children && <p>{children}</p>}{action}</div>;
}
export function Table({ headers, children, footer, minWidth = 780 }) {
  return <div className="em-table-wrap"><table className="em-table" style={{ minWidth }}><thead><tr>{headers.map((title, index) => <th scope="col" key={`${title}-${index}`} className={/Amount|Salary|Bonus|Deductions|Paid|Pending|Net/.test(title) ? "em-number" : ""}>{title}</th>)}</tr></thead><tbody>{children}</tbody>{footer && <tfoot>{footer}</tfoot>}</table></div>;
}
export function RowActions({ onEdit, onDelete, editLabel = "Edit", disabled }) {
  return <div className="em-actions"><button type="button" title={editLabel} aria-label={editLabel} className="em-icon-button" disabled={disabled} onClick={onEdit}><Icon name="edit" size={17} /></button>{onDelete && <button type="button" title="Delete" aria-label="Delete" className="em-icon-button em-danger-icon" disabled={disabled} onClick={onDelete}><Icon name="trash" size={17} /></button>}</div>;
}

export function Modal({ title, description, onClose, busy = false, wide = false, children }) {
  const headingId = useId();
  const container = useRef(null);
  const actions = useRef({ onClose, busy });
  useEffect(() => { actions.current = { onClose, busy }; }, [onClose, busy]);
  useEffect(() => {
    const previous = document.activeElement;
    const element = container.current;
    const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';
    const firstInput = element.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    (firstInput || element.querySelector(selector) || element).focus();
    const keydown = event => {
      if (event.key === "Escape") { event.preventDefault(); if (!actions.current.busy) actions.current.onClose(); }
      if (event.key !== "Tab") return;
      const focusable = [...element.querySelectorAll(selector)].filter(node => node.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (!first) { event.preventDefault(); element.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="expense-manager em-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={container} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={headingId} className={`em-modal ${wide ? "em-modal-wide" : ""}`}>
      <div className="em-modal-heading"><div><h2 id={headingId}>{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="em-icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
      {children}
    </section>
  </div>, document.body);
}

export function Field({ label, name, values, onChange, options, span = false, hint, ...props }) {
  const id = useId();
  const input = { id, name, value: values[name] ?? "", onChange: event => onChange(name, event.target.value), ...props };
  return <div className={`em-field ${span ? "em-field-wide" : ""}`}><label htmlFor={id}>{label}{props.required && <span className="em-required"> *</span>}</label>
    {options ? <select {...input}>{options.map(option => { const value = typeof option === "object" ? option.value : option; const text = typeof option === "object" ? option.label : option; return <option key={value} value={value}>{text}</option>; })}</select>
      : props.as === "textarea" ? <textarea {...input} as={undefined} rows={3} /> : <input {...input} />}
    {hint && <small>{hint}</small>}
  </div>;
}
