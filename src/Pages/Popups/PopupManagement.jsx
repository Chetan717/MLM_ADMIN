import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "../../Auth/AdminAuthContext";
import { GENERAL_SELECT_TYPES, MLM_SELECT_TYPES } from "../Templates/Constant";
import ImageUploadInput from "../../Utils/Imageuploadinput";
import { POPUP_PAGES, popupPreview, emptyPopupDocument } from "../../Utils/popupModel";
import { loadPopupSettings, savePopupSettings, publishPopupSettings, loadPopupCompanies, loadPopupTemplates } from "./popupRepository";
import PopupCard from "./PopupCard";
import "./PopupManagement.css";

const defaults = () => ({ id: crypto.randomUUID(), kind: "general", title: "", message: "", imageUrl: "", destination: "/subscription", buttonLabel: "Explore Now", active: true, startsAt: "", endsAt: "", priority: 0, companyId: "", templateId: "", templateMeta: null });
function localDate(value) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function shortError(error) {
  if (String(error?.code).includes("permission-denied")) return "Access denied. Check your Master Admin session and popup/popup Firestore rules.";
  if (String(error?.code).includes("not-found")) return "The existing R2 upload handler needs its update deployed. See POPUP_CDN_SETUP_HINDI.md.";
  return error?.message || "The action could not be completed.";
}
export default function PopupManagement() {
  const { session } = useAdminAuth();
  const allowed = session?.role === "Master Admin";
  const [data, setData] = useState(emptyPopupDocument);
  const [ready, setReady] = useState(false);
  const [editor, setEditor] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [companies, setCompanies] = useState([]);
  const [companyBusy, setCompanyBusy] = useState(false);
  const [catalog, setCatalog] = useState([]);
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [scope, setScope] = useState({ mainType: "General", type: "", company: "", subtype: "" });
  const lock = useRef(false);
  const catalogRequest = useRef(0);
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    loadPopupSettings(session).then(result => { if (alive) { setData(result); setReady(true); } }).catch(err => { if (alive) setError(shortError(err)); });
    return () => { alive = false; };
  }, [allowed, session]);
  const startEdit = row => {
    catalogRequest.current += 1;
    setEditor({ ...row }); setError(""); setNotice(""); setCatalog([]); setCatalogBusy(false);
    setScope({ mainType: row.templateMeta?.MainType || "General", type: row.templateMeta?.SelectType || "", company: row.templateMeta?.Company || "", subtype: row.templateMeta?.Subtype || "" });
  };
  const setField = (name, value) => setEditor(previous => ({ ...previous, [name]: value }));
  const changeScope = next => {
    catalogRequest.current += 1;
    setScope(next); setCatalog([]); setCatalogBusy(false);
    setEditor(previous => ({ ...previous, templateId: "", templateMeta: null }));
  };
  const publish = async () => {
    const result = await publishPopupSettings(session);
    setData(previous => ({ ...previous, publishedRevision: result.revision }));
    setNotice(`${result.count} active popup(s) published. Cached app feeds update on Home, usually within 5–10 minutes.`);
  };
  const work = async callback => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try { await callback(); } catch (err) { setError(shortError(err)); }
    finally { lock.current = false; setBusy(false); }
  };
  const save = shouldPublish => work(async () => {
    const next = await savePopupSettings(session, { id: editor.id, values: editor, expectedVersion: editor.version });
    setData(next); setEditor(next.campaigns[editor.id]); setNotice("Draft saved. Publish when ready to show it in the app.");
    if (shouldPublish) { await publish(); setEditor(null); }
  });
  const loadCompanies = async () => { setCompanyBusy(true); setError(""); try { setCompanies(await loadPopupCompanies(session)); } catch (err) { setError(shortError(err)); } finally { setCompanyBusy(false); } };
  const loadTemplates = async () => {
    const request = ++catalogRequest.current;
    setCatalogBusy(true); setError("");
    try {
      const items = await loadPopupTemplates(scope.mainType, scope.type, scope.company);
      if (request !== catalogRequest.current) return;
      setCatalog(items); setScope(previous => ({ ...previous, subtype: "" }));
    } catch (err) { if (request === catalogRequest.current) setError(shortError(err)); }
    finally { if (request === catalogRequest.current) setCatalogBusy(false); }
  };
  const chooseTemplate = id => {
    const row = catalog.find(item => item.id === id);
    if (!row) { setEditor(previous => ({ ...previous, templateId: "", templateMeta: null })); return; }
    const first = row.GraphicsLink?.[0];
    const templateMeta = { id, MainType: row.MainType, SelectType: row.SelectType, Company: row.Company || "", Subtype: row.Subtype || "", GraphicsLink: first ? [{ url: first.url || "", suggestionImage: first.suggestionImage || "", backgroundVideoUrl: first.backgroundVideoUrl || "" }] : [] };
    setEditor(previous => ({ ...previous, templateId: id, templateMeta, title: previous.title || `${row.Subtype || String(row.SelectType).replaceAll("_", " ")} is here!` }));
  };
  const field = (name, label, props = {}) => <div className={`pa-field ${props.wide ? "pa-wide" : ""}`}><label htmlFor={`pa-${name}`}>{label}</label>{props.options ? <select id={`pa-${name}`} value={editor[name] || ""} disabled={busy} onChange={event => setField(name, event.target.value)}>{props.options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select> : props.multiline ? <textarea id={`pa-${name}`} rows={3} value={editor[name] || ""} maxLength={400} disabled={busy} onChange={event => setField(name, event.target.value)} /> : <input id={`pa-${name}`} type={props.type || "text"} maxLength={name === "title" ? 100 : 200} value={editor[name] ?? ""} disabled={busy} onChange={event => setField(name, name === "priority" ? Number(event.target.value) : event.target.value)} />}</div>;
  if (!allowed) return <div className="popup-admin"><h1>Popup Management</h1><p>Master Admin access is required.</p></div>;
  const rows = Object.values(data.campaigns).filter(row => [row.title, row.kind, row.templateMeta?.Subtype].some(value => String(value || "").toLowerCase().includes(search.toLowerCase()))).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return <main className="popup-admin">
    <div className="pa-heading"><div><h1>App Popups</h1><p>A new design. A special offer. A moment to connect.</p></div><div className="pa-toolbar"><button className="pa-button" disabled={busy} onClick={() => work(async () => { setData(await loadPopupSettings(session, true)); setReady(true); })}>Refresh</button><button className="pa-button" disabled={busy || !ready} onClick={() => work(publish)}>Publish Changes</button><button className="pa-button pa-button-primary" disabled={busy || !ready} onClick={() => startEdit(defaults())}>＋ New Popup</button></div></div>
    {error && <div className="pa-alert pa-error" role="alert">{error}</div>}{notice && <div className="pa-alert" role="status">{notice}</div>}
    <div className="pa-status">{!ready ? "Loading popup settings…" : `${Object.keys(data.campaigns).length} campaigns · ${data.publishedRevision === data.revision ? "All changes published" : "Unpublished changes"}`} · Each popup keeps its identity when edited.</div>
    {editor ? <div className="pa-editor"><section className="pa-panel"><div className="pa-panel-title"><h2>{editor.version ? "Edit Popup" : "Create Popup"}</h2><p>Choose a message and preview exactly how it will look.</p></div><form className="pa-form" onSubmit={event => { event.preventDefault(); save(true); }}><fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}><div className="pa-grid">
      <div className="pa-kind pa-wide">{[["general", "General / Offer"], ["template", "New Template"]].map(([value, label]) => <button type="button" className={`pa-button ${editor.kind === value ? "pa-selected" : ""}`} key={value} onClick={() => setField("kind", value)}>{label}</button>)}</div>
      {field("title", "Title", { wide: true })}{field("message", "Message", { wide: true, multiline: true })}
      {editor.kind === "general" ? <>
        <div className="pa-field pa-wide"><label>Popup image</label><ImageUploadInput value={editor.imageUrl} onChange={value => setField("imageUrl", value)} storagePath={`graphics/popups/${editor.id}`} disabled={busy} /></div>
        {field("destination", "Open app page", { options: POPUP_PAGES })}{field("buttonLabel", "Button label")}
      </> : <>
        <div className="pa-field"><label htmlFor="pa-main-type">Main type</label><select id="pa-main-type" value={scope.mainType} onChange={event => changeScope({ mainType: event.target.value, type: "", company: "", subtype: "" })}><option>General</option><option>MLM</option></select></div>
        <div className="pa-field"><label htmlFor="pa-type">Template type</label><select id="pa-type" value={scope.type} onChange={event => changeScope({ ...scope, type: event.target.value, subtype: "" })}><option value="">Select type</option>{(scope.mainType === "MLM" ? MLM_SELECT_TYPES : GENERAL_SELECT_TYPES).map(item => <option key={item.value} value={item.value}>{item.name}</option>)}</select></div>
        {scope.mainType === "MLM" && <div className="pa-field pa-wide"><label htmlFor="pa-company">Company ID</label><input id="pa-company" list="pa-companies" value={scope.company} onChange={event => changeScope({ ...scope, company: event.target.value, subtype: "" })} /><datalist id="pa-companies">{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</datalist><button type="button" className="pa-button" disabled={companyBusy} onClick={loadCompanies}>{companyBusy ? "Loading…" : "Load Company Names"}</button></div>}
        <button type="button" className="pa-button pa-wide" disabled={catalogBusy} onClick={loadTemplates}>{catalogBusy ? "Loading templates…" : "Load Templates from CDN"}</button>
        {catalog.length > 0 && <><div className="pa-field"><label htmlFor="pa-subtype">Subtype</label><select id="pa-subtype" value={scope.subtype} onChange={event => { setScope(previous => ({ ...previous, subtype: event.target.value })); if (event.target.value && editor.templateMeta?.Subtype !== event.target.value) chooseTemplate(""); }}><option value="">All subtypes</option>{[...new Set(catalog.map(row => row.Subtype || ""))].map(name => <option key={name}>{name}</option>)}</select></div><div className="pa-field"><label htmlFor="pa-template">Template</label><select id="pa-template" value={editor.templateId} onChange={event => chooseTemplate(event.target.value)}><option value="">Choose template</option>{catalog.filter(row => !scope.subtype || row.Subtype === scope.subtype).map(row => <option key={row.id} value={row.id}>{row.Subtype || row.SelectType} · #{row.serial || 0} · {row.id}</option>)}</select></div></>}
        {editor.templateMeta && <div className="pa-template-info pa-wide">Selected: {editor.templateMeta.MainType} / {editor.templateMeta.SelectType} / {editor.templateMeta.Subtype || "No subtype"}. The first GraphicsLink is used for the popup preview. Create Now follows this template's normal flow.</div>}
      </>}
      <div className="pa-field"><label htmlFor="pa-start">Start (optional)</label><input id="pa-start" type="datetime-local" value={localDate(editor.startsAt)} onChange={event => setField("startsAt", event.target.value ? new Date(event.target.value).toISOString() : "")} /></div>
      <div className="pa-field"><label htmlFor="pa-end">End (optional)</label><input id="pa-end" type="datetime-local" value={localDate(editor.endsAt)} onChange={event => setField("endsAt", event.target.value ? new Date(event.target.value).toISOString() : "")} /></div>
      {field("priority", "Priority (0–100)", { type: "number" })}<label className="pa-check"><input type="checkbox" checked={editor.active} onChange={event => setField("active", event.target.checked)} />Active popup</label>
    </div></fieldset><div className="pa-form-footer"><button type="button" className="pa-button" disabled={busy} onClick={() => { if (window.confirm("Close this editor? Unsaved changes will be discarded.")) setEditor(null); }}>Close</button><button type="button" className="pa-button" disabled={busy} onClick={() => save(false)}>Save Draft</button><button type="submit" className="pa-button pa-button-primary" disabled={busy}>{busy ? "Saving / publishing…" : "Save & Publish"}</button></div></form></section><aside className="pa-preview"><p>Live app preview</p><PopupCard preview campaign={{ ...editor, imageUrl: popupPreview(editor), template: editor.templateMeta, video: editor.kind === "template" && !editor.templateMeta?.GraphicsLink?.[0]?.suggestionImage && !editor.templateMeta?.GraphicsLink?.[0]?.url && Boolean(editor.templateMeta?.GraphicsLink?.[0]?.backgroundVideoUrl) }} /></aside></div> : <>
      <div className="pa-search"><input aria-label="Search popups" placeholder="Search title, type or subtype…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      {rows.length ? <div className="pa-list">{rows.map(row => <article className="pa-list-card" key={row.id}><div className="pa-list-top">{popupPreview(row) && <img src={popupPreview(row)} alt="" />}<div><span className="pa-label">{row.kind === "template" ? "NEW TEMPLATE" : "GENERAL / OFFER"} · {row.active ? "ACTIVE" : "PAUSED"}</span><h3>{row.title}</h3><p>{row.kind === "template" ? row.templateMeta?.Subtype : POPUP_PAGES.find(page => page.value === row.destination)?.label}</p></div></div><div className="pa-card-actions"><button className="pa-button" disabled={busy} onClick={() => startEdit(row)}>Edit</button><button className="pa-button" disabled={busy} onClick={() => startEdit({ ...row, id: crypto.randomUUID(), version: undefined, createdAt: undefined })}>Copy as New</button><button className="pa-button pa-button-danger" disabled={busy} onClick={() => { if (window.confirm(`Delete "${row.title}" and publish the updated feed?`)) work(async () => { setData(await savePopupSettings(session, { id: row.id, expectedVersion: row.version, remove: true })); await publish(); }); }}>Delete</button></div></article>)}</div> : <div className="pa-empty">{ready ? "No popups yet. Create a general announcement or introduce a new template." : "Loading…"}</div>}
    </>}
  </main>;
}
