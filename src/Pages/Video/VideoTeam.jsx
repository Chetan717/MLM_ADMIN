import { useEffect, useRef, useState } from "react";
import { getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../../../Firebase";
import SearchableSelect from "../../components/SearchableSelect";
import "./Video.css";
const teamApp =
  getApps().find((a) => a.name === "video-team") ||
  initializeApp(app.options, "video-team");
const teamAuth = getAuth(teamApp);
const fmt = (t) => new Date(t).toLocaleString();
const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10);
function bounds(f) {
  if (!f.from && !f.to) return {};
  if (!f.from || !f.to || f.from > f.to)
    throw Error("Select a start date and end date.");
  return {
    from: Date.parse(f.from + "T00:00:00+05:30"),
    to: Date.parse(f.to + "T23:59:59.999+05:30"),
  };
}
function preset(name) {
  const end = today(),
    days = { Today: 1, Yesterday: 2, "Last 7 days": 7, "Last 30 days": 30 };
  const from =
    name === "This month"
      ? end.slice(0, 8) + "01"
      : new Date(Date.parse(end) - (days[name] - 1) * 86400000)
          .toISOString()
          .slice(0, 10);
  return { from, to: name === "Yesterday" ? from : end };
}
function whats(r, what) {
  const number = r.mobile.length === 10 ? "91" + r.mobile : r.mobile;
  const intro = "Hello " + r.name + ", ";
  const text =
    what === "review"
      ? "your edited video is ready for review. Open it and approve it or request corrections in the MLMLive app.\nReview video: " +
        r.link
      : what === "final"
        ? "your final video is approved and ready to download.\nDownload link: " +
          r.link
        : "I am contacting you about your video editing request.";
  return (
    "https://wa.me/" +
    number +
    "?text=" +
    encodeURIComponent(
      intro + text + "\nRequest ID: " + r.id + "\nMLMLive Video Editing Team",
    )
  );
}
const ICONS = {
  film: 'M3 8h18v12H3z M3 8l-1-4 18-3 1 4z M7 3l3 4 M14 2l3 4 M10 12l5 3-5 3z',
  home: 'M3 10l9-7 9 7v11h-6v-7H9v7H3z',
  list: 'M8 4h12v17H4V4h4 M8 3h8v4H8z M8 11h8 M8 15h8',
  play: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M10 8l6 4-6 4z',
  check: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M7 12l3 3 7-7',
  repeat: 'M20 7H5l4-4 M5 7l4 4 M4 17h15l-4-4 M19 17l-4 4',
  archive: 'M3 3h18v5H3z M5 8v13h14V8 M10 12h4',
  users: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M4 21v-2a6 6 0 0 1 6-5h4a6 6 0 0 1 6 5v2',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
  menu: 'M3 6h18 M3 12h18 M3 18h18',
  arrow: 'M20 12H4 M4 12l7-7 M4 12l7 7',
  refresh: 'M20 11a8 8 0 1 0-2 6 M20 4v7h-7',
  mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
  lock: 'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3',
  calendar: 'M3 5h18v16H3z M7 2v6 M17 2v6 M3 10h18',
  chat: 'M21 11a9 9 0 0 1-9 9H4l2-5a9 9 0 1 1 15-4z M8 11h8 M8 15h5',
  exit: 'M10 4H4v16h6 M9 12h12 M17 8l4 4-4 4',
};
function Glyph({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name] || ICONS.film}/></svg>;
}
function Brand() { return <span className="vt-brand"><span className="vt-brand-icon"><Glyph name="play" size={25}/></span>MLM LIVE</span>; }
function Status({ value }) { return <span className="ve-status" data-status={value}>{value}</span>; }
function Thumb({ row }) { const duration = Number(row.duration); return <span className="vt-thumb">{row.thumbnail ? <img loading="lazy" src={row.thumbnail} alt="Raw clip thumbnail"/> : <Glyph name="film" size={25}/>} {duration>0&&<span className="vt-duration">{Math.floor(duration/60)}:{String(duration%60).padStart(2,'0')}</span>}</span>; }
function drivePreview(link) {
  try { const u = new URL(link); if (u.origin !== 'https://drive.google.com' || !/^\/file\/d\/[\w-]+\/view$/.test(u.pathname)) return ''; u.pathname = u.pathname.replace(/view$/, 'preview'); return u.href; } catch { return ''; }
}
function Timeline({ row, history }) {
  const stages = [['Submitted'], ['Assigned','Downloaded','Editing','Correction Requested'], ['Under Review'], ['Completed']];
  const current = stages.findIndex(group=>group.includes(row.status));
  return <div className="vt-timeline" aria-label="Request progress">{stages.map((group,i)=>{const h=history.find(item=>group.includes(item.status));const done=i===0||current>=i||Boolean(h);return <div key={group[0]} className={done?'reached':''}><span className="vt-step"><Glyph name={['list','film','play','check'][i]}/></span><strong>{['Request received','Assigned / editing','In review','Completed'][i]}</strong><small>{i===0?fmt(row.created):h?.time?fmt(h.time):done?'Reached':'Pending'}</small></div>})}</div>;
}
function Login() {
  const [email, set] = useState(""),
    [password, pass] = useState(""),
    [msg, say] = useState(""),
    [busy, block] = useState(false), [visible, setVisible] = useState(false);
  async function go(reset) {
    block(true);
    say("");
    try {
      if (reset) {
        await sendPasswordResetEmail(teamAuth, email);
        say("Check your email for the password reset link.");
      } else await signInWithEmailAndPassword(teamAuth, email, password);
    } catch (e) {
      say(e.code==='auth/operation-not-allowed' ? 'Email/password login is disabled. Ask your administrator to enable it in Firebase Authentication.' : e.message);
    } finally {
      block(false);
    }
  }
  return (
    <main className="ve vt-login">
      <div className="vt-login-art"><Brand/><span className="vt-login-tag">Video Editing Team</span><div className="vt-illustration"><Glyph name="film" size={108}/></div><h2>Great videos start here.</h2><p>Your dedicated workspace for professional video editing.</p></div>
      <section className="vt-login-card">
        <Brand/><h1>Video Editing Team Login</h1><p className="quiet">Sign in to manage and edit video requests</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(false);
          }}
        >
          <label>
            Email
            <span className="vt-input-icon"><Glyph name="mail"/><input placeholder="you@example.com"
              required
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => set(e.target.value)}
            /></span>
          </label>
          <label>
            Password
            <span className="vt-input-icon"><Glyph name="lock"/><input
              required
              placeholder="Enter your password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => pass(e.target.value)}
            /><button type="button" className="vt-eye" aria-label={visible?'Hide password':'Show password'} onClick={()=>setVisible(v=>!v)}>{visible?'Hide':'Show'}</button></span>
          </label>
          <div className="actions">
            <button disabled={busy} className="primary">
              <Glyph name="exit"/> {busy ? 'Please wait…' : 'Sign in'}
            </button>
            <button
              type="button"
              disabled={!email || busy}
              onClick={() => go(true)}
            >
              Forgot password?
            </button>
          </div>
        </form>
        <p role="status">{msg}</p>
      </section>
    </main>
  );
}
export default function VideoTeam({ admin = false }) {
  const [user, set] = useState(undefined);
  useEffect(
    () => (admin ? undefined : onAuthStateChanged(teamAuth, set)),
    [admin],
  );
  if (!admin && user === undefined) return <p>Checking team login…</p>;
  if (!admin && !user) return <Login />;
  return <Panel key={admin ? "admin" : user.uid} admin={admin} user={user} />;
}
const emptyFilters = {
  filter: "",
  value: "",
  editor: "",
  size: 10,
  archived: false,
  from: "",
  to: "",
  sort: "created",
};
function Panel({ admin, user }) {
  const backend = getFunctions(admin ? app : teamApp, "asia-south1");
  const call = async (action, data = {}, isMedia = false) =>
    (
      await httpsCallable(
        backend,
        isMedia ? "videoEditingMedia" : "videoEditing",
      )({ ...data, action })
    ).data;
  const [info, summary] = useState(null),
    [rows, setRows] = useState([]),
    [cursor, page] = useState(null),
    [cachedPages, setCachedPages] = useState([]),
    [pageIndex, setPageIndex] = useState(0),
    [filters, filter] = useState(emptyFilters),
    [applied, apply] = useState(emptyFilters);
  const [detail, setDetail] = useState(null),
    [team, members] = useState([]),
    [teamCursor, moreTeam] = useState(null),
    [tab, setTab] = useState("dashboard"), [menuOpen,setMenuOpen] = useState(false), [preview,setPreview] = useState(false), [advanced,setAdvanced] = useState(false);
  const [selected, selection] = useState([]),
    [editor, assignTo] = useState(""),
    [note, setNote] = useState(""),
    [link, setLink] = useState("");
  const [settings, setSettings] = useState(null);
  const [migrationCursor, setMigrationCursor] = useState(null);
  const [person, setPerson] = useState({
      name: "",
      email: "",
      mobile: "",
      role: "editor", password: "", confirmPassword: "", active: true,
    }),
    [showPassword, setShowPassword] = useState(false),
    [msg, say] = useState(""),
    [error, err] = useState(""),
    [busy, blocking] = useState(false);
  const lock = useRef(false);
  async function work(fn) {
    if (lock.current) return;
    lock.current = true;
    blocking(true);
    err("");
    say("");
    try {
      await fn();
    } catch (e) {
      err(e.message);
    } finally {
      lock.current = false;
      blocking(false);
    }
  }
  async function teamPage(next = false) {
    const res = await call("members", { cursor: next ? teamCursor : null });
    members((v) => (next ? [...v, ...res.rows] : res.rows));
    moreTeam(res.cursor);
  }
  function showPage(i, pages = cachedPages) {
    if (!pages[i]) return;
    setPageIndex(i); setRows(pages[i].rows); page(pages[i].cursor);
  }
  async function list(f, more = false) {
    if (more && cachedPages[pageIndex+1]) { showPage(pageIndex+1); return; }
    const res = await call("list", {
      ...f,
      ...bounds(f),
      from: bounds(f).from ?? null,
      to: bounds(f).to ?? null,
      cursor: more ? cursor : null,
    });
    const seen = new Set(more ? cachedPages.flatMap(p=>p.rows.map(r=>r.id)) : []);
    const result = {rows:res.rows.filter(r=>!seen.has(r.id)), cursor:res.cursor};
    if(more && !result.rows.length && !result.cursor) {
      const pages=cachedPages.map((p,i)=>i===pageIndex?{...p,cursor:null}:p);setCachedPages(pages);page(null);return;
    }
    const pages = more ? [...cachedPages,result] : [result];
    setCachedPages(pages);showPage(more?pageIndex+1:0,pages);
  }
  async function refresh(f = applied) {
    const args = { ...bounds(f), editor: f.editor, archived: f.archived };
    const [s] = await Promise.all([call("dashboard", args), list(f)]);
    summary(s);
    setSettings({
      maxRounds: s.maxRounds,
      support: s.support,
      categories: s.categories.join("\n"),
    });
    apply(f);
    selection([]);
    if (s.role !== "editor" && !info) await teamPage();
  }
  async function open(id) {
    const res = await call("details", { id });
    setDetail(res); setPreview(false);
    setLink("");
    setNote("");
  }
  useEffect(() => {
    work(() => refresh());
  }, []);
  const r = detail?.row,
    manager = info && info.role !== "editor";
  const patch = (k, v) => filter({ ...filters, [k]: v });
  const activeEditors = team.filter((p) => p.active && p.role === "editor");
  const picker = (
    <SearchableSelect
      sortOrder="original"
      aria-label="Assigned editor"
      value={editor}
      onChange={(e) => assignTo(e.target.value)}
    >
      <option value="">Choose editor</option>
      {activeEditors.map((m) => (
        <option key={m.uid} value={m.uid}>
          {m.name}
        </option>
      ))}
    </SearchableSelect>
  );
  async function command(action, data = {}, target = r.id) {
    await call(action, { id: target, op: crypto.randomUUID(), ...data });
  }
  async function change(action, data = {}) {
    await command(action, data);
    await open(r.id);
    await refresh();
  }
  async function account(e) {
    e.preventDefault();
    await work(async () => {
      if (person.password !== person.confirmPassword) throw Error("Passwords do not match.");
      const { confirmPassword, ...data } = person;
      await call("manage", data);
      await teamPage();
      say(
        "Account created. The team member can sign in using their email and password.",
      );
      setPerson({ name: "", mobile: "", email: "", role: "editor", password: "", confirmPassword: "", active: true });
    });
  }
  const displayName = admin ? 'Admin' : user?.displayName || user?.email?.split('@')[0] || 'Editor';
  const roleName = info?.role === 'admin' ? 'Administrator' : info?.role === 'manager' ? 'Video Editing Manager' : 'Video Editor';
  const count = status => info?.stats?.['s'+info.statuses.indexOf(status)] || 0;
  const goView = (view, status = '', archived = false) => {
    setMenuOpen(false); setDetail(null); setPreview(false);
    if (view === 'team' || view === 'settings') {setTab(view);return;}
    const f={...emptyFilters,archived,filter:status?'status':'',value:status};
    setTab(view);filter(f); if(JSON.stringify(f)!==JSON.stringify(applied)) work(()=>refresh(f)); else {selection([]);showPage(0);}
  };
  const nav = (label, icon, view, status='', archived=false) => <button type="button" disabled={busy} className={(tab===view && !r && (view!=='requests' || (applied.archived===archived && (status?applied.filter==='status'&&applied.value===status:applied.filter!=='status'))))?'active':''} onClick={()=>goView(view,status,archived)}><Glyph name={icon}/><span>{label}</span></button>;
  return (
    <main className={'ve vt-workspace '+(admin?'vt-admin':'vt-standalone')}>
      <header className="vt-topbar">
        <div className="vt-top-left"><button className="vt-menu" type="button" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={()=>setMenuOpen(v=>!v)}><Glyph name="menu"/></button><Brand/><span className="vt-top-title"><Glyph name="film"/> {admin?'Video Editing Service':'Video Editing Team'}</span></div>
        <div className="vt-top-right"><span className="vt-avatar">{displayName.slice(0,2).toUpperCase()}</span><span className="vt-profile"><strong>{displayName}</strong><small>{roleName}</small></span>

          <button
            disabled={busy}
            onClick={() =>
              work(async () => {
                await refresh();
                if (r) await open(r.id);
              })
            }
          >
            <Glyph name="refresh"/><span className="vt-desktop-label">Refresh</span>
          </button>
          {!admin && (
            <button aria-label="Sign out" onClick={() => signOut(teamAuth)}><Glyph name="exit"/><span className="vt-desktop-label">Sign out</span></button>
          )}
        </div>
      </header>
      <div className="vt-shell">
        <aside className={'vt-sidebar '+(menuOpen?'open':'')}>
          <small className="vt-nav-label">WORKSPACE</small>
          {nav('Dashboard','home','dashboard')}
          {nav(admin?'All requests':'My requests','list','requests')}
          {nav('In editing','play','requests','Editing')}
          {nav('In review','play','requests','Under Review')}
          {nav('Corrections','repeat','requests','Correction Requested')}
          {nav('Completed','check','requests','Completed')}
          {info?.role==='admin'&&nav('Archived requests','archive','requests','',true)}
          {manager&&<><small className="vt-nav-label">MANAGEMENT</small>{nav('Team accounts','users','team')}{info.role==='admin'&&nav('Service settings','settings','settings')}</>}
          {info?.support&&<a className="vt-support" href={'https://wa.me/'+info.support} target="_blank" rel="noreferrer"><Glyph name="chat"/> WhatsApp Support</a>}
        </aside>
        <div className="vt-content" aria-busy={busy}>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {msg && <p role="status">{msg}</p>}
      {!info && !error && <p>Loading workspace…</p>}
      {info && (
        <>
          {tab === "settings" && settings ? (
            <section className="vt-settings">
              <h1>Service settings</h1><p className="quiet">Manage video service configuration and support.</p>
              <label>
                Support WhatsApp number with country code
                <input
                  value={settings.support}
                  onChange={(e) =>
                    setSettings({ ...settings, support: e.target.value })
                  }
                />
              </label>
              <label>
                Free corrections for new requests
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={settings.maxRounds}
                  onChange={(e) =>
                    setSettings({ ...settings, maxRounds: e.target.value })
                  }
                />
              </label>
              <label>
                Categories, one per line
                <textarea
                  value={settings.categories}
                  onChange={(e) =>
                    setSettings({ ...settings, categories: e.target.value })
                  }
                />
              </label>
              <button
                disabled={busy}
                onClick={() =>
                  work(async () => {
                    await call("configure", {
                      ...settings,
                      maxRounds: Number(settings.maxRounds),
                      categories: settings.categories
                        .split("\n")
                        .map((c) => c.trim())
                        .filter(Boolean),
                    });
                    await refresh();
                    say("Service settings saved.");
                  })
                }
              >
                Save settings
              </button>
            </section>
          ) : tab === "team" ? (
            <section className="vt-accounts">
              <header>
                <div><h1>Team accounts</h1><p className="quiet">Manage editors and their workspace access.</p></div>
                <a
                  className="action"
                  href="/video-team"
                  target="_blank"
                  rel="noreferrer"
                >
                  Team login page
                </a>
              </header>
              <form onSubmit={account}>
                <fieldset disabled={busy} className="vt-account-form">
                  <legend>Create account</legend>
                  {["name", "email", "mobile"].map((k) => (
                    <label key={k}>
                      {{name:'Full name',email:'Email address',mobile:'Mobile number'}[k]}
                      <input
                        required
                        type={k === "email" ? "email" : "text"}
                        value={person[k]}
                        onChange={(e) =>
                          setPerson({ ...person, [k]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                  {["password", "confirmPassword"].map(k=><label key={k}>{k === "password" ? "Password" : "Confirm password"}<input required minLength={8} maxLength={128} autoComplete="new-password" type={showPassword ? "text" : "password"} value={person[k]} onChange={e=>setPerson({...person,[k]:e.target.value})}/></label>)}
                  <button type="button" onClick={()=>setShowPassword(!showPassword)}>{showPassword ? "Hide passwords" : "Show passwords"}</button>
                  <label><input type="checkbox" checked={person.active} onChange={e=>setPerson({...person,active:e.target.checked})}/> Active account</label>
                  <label>
                    Role{" "}
                    <SearchableSelect
                      sortOrder="original"
                      value={person.role}
                      onChange={(e) =>
                        setPerson({ ...person, role: e.target.value })
                      }
                    >
                      <option value="editor">Video editor</option>
                      {info.role === "admin" && (
                        <option value="manager">Video editing manager</option>
                      )}
                    </SearchableSelect>
                  </label>
                  <button>Create account</button>
                </fieldset>
              </form>
              {team.map((m) => (
                <article key={m.uid}>
                  <h3>
                    {m.name} · {m.role}
                  </h3>
                  <p>
                    {m.email} · {m.mobile} · {m.active ? "Active" : "Disabled"}
                  </p>
                  <div className="actions">
                    {(m.role === "editor" || info.role === "admin") && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          work(async () => {
                            await call("manage", {
                              uid: m.uid,
                              active: !m.active,
                            });
                            await teamPage();
                          })
                        }
                      >
                        {m.active ? "Deactivate" : "Activate"}
                      </button>
                    )}
                    {(m.role === "editor" || info.role === "admin") && <button disabled={busy || !m.active} onClick={()=>work(async()=>{await sendPasswordResetEmail(teamAuth,m.email);say("Password reset email requested.");})}>Reset password</button>}
                    {m.role === "editor" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          work(async () => {
                            const f = { ...emptyFilters, editor: m.uid };
                            filter(f);
                            await refresh(f);
                            setTab("requests");
                          })
                        }
                      >
                        View workload
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {teamCursor && (
                <button
                  disabled={busy}
                  onClick={() => work(() => teamPage(true))}
                >
                  More accounts
                </button>
              )}
            </section>
          ) : r ? (
            <div className="vt-detail">
              <header className="vt-page-head"><div><button className="vt-back" onClick={()=>setDetail(null)}><Glyph name="arrow"/> Back to requests</button><h1>Request details</h1><p className="quiet">{r.id}</p></div><Status value={r.status}/></header>
              <section className="vt-detail-hero"><Thumb row={r}/><div><h2>{r.category} {r.other}</h2><p>{r.name} · {fmt(r.created)}</p><p className="quiet">Assigned editor: {r.editorName || 'Unassigned'}</p></div></section>
              <section><h2>Request timeline</h2><Timeline row={r} history={detail.history}/></section>
              <div className="vt-detail-grid"><div className="vt-detail-main">
              <section><h2>Video details</h2><dl className="vt-facts"><dt>Category</dt><dd>{r.category} {r.other}</dd><dt>Submitted</dt><dd>{fmt(r.created)}</dd><dt>Assigned editor</dt><dd>{r.editorName || 'Unassigned'}</dd></dl><h3>Editing instructions</h3><p className="note vt-instructions">{r.instructions || 'No instructions provided.'}</p></section>
              <section><h2>Customer details</h2><dl className="vt-facts"><dt>Name</dt><dd>{r.name}</dd><dt>Mobile</dt><dd>{r.mobile}</dd><dt>Company</dt><dd>{r.company}</dd><dt>State</dt><dd>{r.state}</dd></dl>
              <p>
                {r.maxRounds - r.rounds} of {r.maxRounds} free corrections
                remaining · Credit {r.credit}
              </p>
              {manager && (
                <p>
                  Original plan purchase · {r.purchaseId}
                  <br />
                  Customer video credits · {detail.balance?.available || 0}{" "}
                  available · {detail.balance?.reserved || 0} reserved ·{" "}
                  {detail.balance?.used || 0} used in active plans
                </p>
              )}
              {r.correction && (
                <p className="note">Latest correction · {r.correction}</p>
              )}
              <div className="actions">
                <a
                  className="action"
                  target="_blank"
                  rel="noreferrer"
                  href={whats(r, "chat")}
                >
                  WhatsApp Customer
                </a>
                {r.status === "Under Review" && (
                  <a
                    className="action"
                    target="_blank"
                    rel="noreferrer"
                    href={whats(r, "review")}
                  >
                    Send Review Video on WhatsApp
                  </a>
                )}
                {r.status === "Completed" && (
                  <a
                    className="action"
                    target="_blank"
                    rel="noreferrer"
                    href={whats(r, "final")}
                  >
                    Send Final Video on WhatsApp
                  </a>
                )}
              </div>
              </section>
              {r.link && <section className="vt-delivery"><h2>Edited video · Version {r.version}</h2>{drivePreview(r.link)&&<button className="primary" onClick={()=>setPreview(v=>!v)}><Glyph name="play"/> {preview?'Close preview':'Preview edited video'}</button>}{preview&&drivePreview(r.link)&&<iframe title="Edited video preview" src={drivePreview(r.link)} allowFullScreen loading="lazy" referrerPolicy="no-referrer"/>}
                <a
                  className="action"
                  target="_blank"
                  rel="noreferrer"
                  href={r.link}
                >
                  Open edited version {r.version}
                </a></section>
              }
              {r.archived && <article><h3>Archived request</h3><p>Files are retained until permanent deletion. External Google Drive files are not deleted by this app.</p><div className="actions"><button disabled={busy || r.deleting} onClick={()=>work(async()=>{await command("restore");setDetail(null);await refresh();})}>Restore request</button><button disabled={busy} onClick={()=>{const mobile=prompt("Enter the registered mobile number to permanently delete this request and its R2 originals. Google Drive files remain external.");if(mobile && confirm("This cannot be undone. Permanently delete?"))work(async()=>{await call("permanentDelete",{id:r.id,mobile,confirmed:true});setDetail(null);await refresh();});}}>Permanently delete</button></div></article>}
              <fieldset disabled={busy || r.archived || r.rawCleanupPending}>
                <legend>Raw clips</legend>
                {r.rawDeleted ? (
                  <p>Raw videos deleted · {fmt(r.rawDeletedAt)}</p>
                ) : (
                  r.files.map((f, i) => (
                    <p key={i}>
                      <button
                        onClick={() => {
                          const w = window.open("about:blank", "_blank");
                          if (w) w.opener = null;
                          work(async () => {
                            try {
                              const { url } = await call(
                                "download",
                                { id: r.id, index: i },
                                true,
                              );
                              if (w) w.location.replace(url);
                              else location.assign(url);
                            } catch (e) {
                              w?.close();
                              throw e;
                            }
                          });
                        }}
                      >
                        Open clip {i + 1}
                      </button>{" "}
                      {f.name} · {(f.size / 1e6).toFixed(1)} MB
                    </p>
                  ))
                )}
                {!r.rawDeleted && (
                  <button
                    onClick={() =>
                      work(async () => {
                        const { urls } = await call(
                          "downloadAll",
                          { id: r.id },
                          true,
                        );
                        for (const url of urls) {
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = "";
                          a.rel = "noreferrer";
                          document.body.append(a);
                          a.click();
                          a.remove();
                        }
                        say(
                          "Downloads requested. Your browser may ask you to allow multiple downloads.",
                        );
                      })
                    }
                  >
                    Download all raw clips
                  </button>
                )}
              </fieldset>
              </div><aside className="vt-detail-actions"><fieldset disabled={busy || r.archived}>
                <legend>Request actions</legend>
                <div className="actions">
                  {manager &&
                    !["Completed", "Rejected", "Cancelled"].includes(
                      r.status,
                    ) && (
                      <>
                        {picker}
                        <button
                          disabled={!editor}
                          onClick={() =>
                            work(() => change("assign", { editor }))
                          }
                        >
                          Assign editor
                        </button>
                      </>
                    )}
                  {r.status === "Assigned" && (
                    <button onClick={() => work(() => change("downloaded"))}>
                      Confirm raw videos downloaded
                    </button>
                  )}
                  {["Downloaded", "Correction Requested"].includes(
                    r.status,
                  ) && (
                    <button className="primary" onClick={() => work(() => change("edit"))}>
                      Start editing
                    </button>
                  )}
                </div>
                {["Editing", "Correction Requested"].includes(r.status) && (
                  <>
                    <label>
                      Google Drive Edited Video Link
                      <input
                        type="url"
                        value={link}
                        onChange={(e) => setLink(e.target.value)}
                      />
                    </label>
                    <small>
                      Check that the customer can open the file using their
                      Google Drive permissions.
                    </small>
                    <label>
                      Editor remarks
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={!link}
                      onClick={() =>
                        work(() =>
                          change("deliver", { link, note, version: r.version }),
                        )
                      }
                    >
                      Submit for customer review
                    </button>
                  </>
                )}
                {info.role === "admin" && r.status === "Completed" && (
                  <button
                    onClick={() => {
                      const link = prompt(
                          "Replacement Google Drive link for the same approved video",
                        ),
                        note =
                          link && prompt("Reason for recovering this link");
                      if (
                        link &&
                        note &&
                        confirm(
                          "Replace the approved video link and record this action in request history?",
                        )
                      )
                        work(() =>
                          change("recoverLink", {
                            link,
                            note,
                            confirmed: true,
                          }),
                        );
                    }}
                  >
                    Recover delivery link
                  </button>
                )}
                {r.status === "Completed" && !r.rawDeleted && !r.archived && (
                  <button className="vt-danger"
                    onClick={() => {
                      if (
                        confirm(
                          "Permanently remove the original raw video files from storage?",
                        )
                      )
                        work(async () => {
                          await call(
                            "deleteRaw",
                            { id: r.id, confirmed: true },
                            true,
                          );
                          await open(r.id);
                          await refresh();
                        });
                    }}
                  >
                    Delete raw videos
                  </button>
                )}
                {manager &&
                  (!["Completed", "Rejected", "Cancelled"].includes(
                    r.status,
                  ) ? (
                    ["cancel", "reject"].map((action) => (
                      <button
                        key={action}
                        onClick={() => {
                          const reason = prompt(
                            "Enter the reason to " + action + " this request.",
                          );
                          if (reason?.trim())
                            work(() => change(action, { note: reason }));
                        }}
                      >
                        {action === "cancel"
                          ? "Cancel request"
                          : "Reject request"}
                      </button>
                    ))
                  ) : info.role === "admin" && !r.archived ? (
                    <button
                      onClick={() => {
                        const mobile = prompt(
                          "To archive, enter the customer’s registered mobile number exactly.",
                        );
                        if (mobile)
                          work(async () => {
                            await command("archive", { mobile });
                            setDetail(null);
                            await refresh();
                          });
                      }}
                    >
                      Archive request
                    </button>
                  ) : null)}
              </fieldset>
              </aside></div><section className="vt-history"><h2>Request and credit history</h2>
              <ol>
                {detail.history.map((h, i) => (
                  <li key={i}>
                    {fmt(h.time)} · {h.role} · {h.status || h.action}{" "}
                    {h.credit || ""} {h.editorName || ""}{" "}
                    {h.correction || h.reason || h.remarks || ""}{" "}
                    {h.link && (
                      <a
                        className="action"
                        target="_blank"
                        rel="noreferrer"
                        href={h.link}
                      >
                        Version {h.version}
                      </a>
                    )}
                  </li>
                ))}
              </ol>
              {detail.cursor && (
                <button
                  disabled={busy}
                  onClick={() =>
                    work(async () => {
                      const more = await call("details", {
                        id: r.id,
                        cursor: detail.cursor,
                      });
                      setDetail({
                        ...detail,
                        history: [...detail.history, ...more.history],
                        cursor: more.cursor,
                      });
                    })
                  }
                >
                  Earlier history
                </button>
              )}
            </section></div>
          ) : (
            <>
              <header className="vt-page-head"><div><h1>{tab==='dashboard'?'Welcome, '+displayName:applied.archived?'Archived requests':admin?'Video requests':'My requests'}</h1><p className="quiet">{tab==='dashboard'?'Manage your video editing workload and recent requests.':'Review and manage video editing requests.'}</p></div><span className="vt-date"><Glyph name="calendar"/>{new Date().toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'})}</span></header>
              {tab==='dashboard'&&<div className="vt-kpis">{[['Total requests',info.stats.total||0,'list','blue'],['In editing',count('Editing'),'play','orange'],['Completed',count('Completed'),'check','green'],['Corrections',count('Correction Requested'),'repeat','purple']].map(([label,value,icon,tone])=><div className={'vt-kpi '+tone} key={label}><Glyph name={icon} size={34}/><div><b>{value}</b><span>{label}</span></div></div>)}</div>}
              <section className="vt-overview">
                <h2>{applied.archived ? "Archived requests" : "Service overview"}</h2>
                {applied.archived && <button disabled={busy} onClick={()=>work(async()=>{const result=await call("reindexArchived",{cursor:migrationCursor});setMigrationCursor(result.cursor);await refresh();say(result.migrated+" old archives indexed."+(result.cursor?" Click again for next batch.":" Archive scan complete."));})}>{migrationCursor?"Index next 10 old archives":"Index older archived requests"}</button>}
                <details><summary>Detailed service metrics</summary><div className="metrics">
                  <div>
                    <b>{info.stats.total || 0}</b>Total requests
                  </div>
                  {info.statuses.map((s, i) => (
                    <div key={s}>
                      <b>{info.stats["s" + i] || 0}</b>
                      {s}
                    </div>
                  ))}
                  <div>
                    <b>{((info.stats.rawBytes || 0) / 1e6).toFixed(1)} MB</b>Raw
                    storage
                  </div>
                  <div>
                    <b>{info.stats.eligibleCleanup || 0}</b>Ready for cleanup
                  </div>
                  <div>
                    <b>
                      {info.stats.s6
                        ? (
                            (info.stats.elapsed || 0) /
                            info.stats.s6 /
                            3600000
                          ).toFixed(1)
                        : "—"}
                    </b>
                    Average hours to approval
                  </div>
                </div></details>
              </section>
              <section className="vt-request-list">
                <header><h2>{tab==='dashboard'?'Recent requests':'Requests'}</h2><div className="actions">{tab==='dashboard'&&<button onClick={()=>goView('requests')}>View all →</button>}<button onClick={()=>setAdvanced(v=>!v)} aria-expanded={advanced}>Filters {advanced?'−':'+'}</button></div></header>
                <div className="vt-quick"><div className="vt-pills">{[['All',''],['New','Submitted'],['In editing','Editing'],['In review','Under Review'],['Corrections','Correction Requested'],['Completed','Completed']].map(([label,status])=><button key={label} disabled={busy} className={(status?applied.filter==='status'&&applied.value===status:!applied.filter)?'active':''} onClick={()=>{const f={...applied,filter:status?'status':'',value:status};setTab('requests');filter(f);if(JSON.stringify(f)!==JSON.stringify(applied))work(()=>refresh(f));else showPage(0);}}>{label}</button>)}</div><form className="vt-search" onSubmit={e=>{e.preventDefault();setTab('requests');work(()=>refresh({...filters,filter:filters.filter==='search'&&filters.value.trim()?'search':'',value:filters.filter==='search'?filters.value.trim():''}));}}><input aria-label="Search requests" placeholder="Search ID, customer or company" value={filters.filter==='search'?filters.value:''} onChange={e=>filter({...filters,filter:'search',value:e.target.value})}/><button disabled={busy} type="submit">Search</button></form></div>
                <fieldset disabled={busy} hidden={!advanced} className="vt-advanced">
                  <div className="actions">
                    <SearchableSelect
                      sortOrder="original"
                      aria-label="Date range"
                      defaultValue=""
                      onChange={(e) => {
                        const v = e.target.value;
                        filter({
                          ...filters,
                          ...(v ? preset(v) : { from: "", to: "" }),
                        });
                      }}
                    >
                      <option value="">All dates</option>
                      {[
                        "Today",
                        "Yesterday",
                        "Last 7 days",
                        "Last 30 days",
                        "This month",
                      ].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </SearchableSelect>
                    <label>
                      From
                      <input
                        type="date"
                        value={filters.from}
                        onChange={(e) => patch("from", e.target.value)}
                      />
                    </label>
                    <label>
                      Through
                      <input
                        type="date"
                        value={filters.to}
                        onChange={(e) => patch("to", e.target.value)}
                      />
                    </label>
                  </div>
                  <small>
                    Dates use India time. The overview counts requests by
                    creation date. List dates follow the selected sort order.
                  </small>
                  <div className="actions">
                    <SearchableSelect
                      sortOrder="original"
                      aria-label="Filter type"
                      value={filters.filter}
                      onChange={(e) =>
                        filter({
                          ...filters,
                          filter: e.target.value,
                          value: "",
                        })
                      }
                    >
                      <option value="">All requests</option>
                      <option value="assignment">Assignment</option>
                      <option value="company">Company</option>
                      <option value="state">State</option>
                      <option value="search">
                        Search ID, customer, mobile, company or editor
                      </option>
                      <option value="status">Status</option>
                      <option value="category">Category</option>
                      <option value="raw">Raw storage</option>
                    </SearchableSelect>
                    {["search", "company", "state"].includes(filters.filter) ? (
                      <input
                        aria-label="Search prefix"
                        placeholder={
                          filters.filter === "search"
                            ? "Starts with…"
                            : "Exact name"
                        }
                        value={filters.value}
                        onChange={(e) => patch("value", e.target.value)}
                      />
                    ) : (
                      filters.filter && (
                        <SearchableSelect
                          sortOrder="original"
                          aria-label="Filter value"
                          value={filters.value}
                          onChange={(e) => patch("value", e.target.value)}
                        >
                          <option value="">Select…</option>
                          {(filters.filter === "category"
                            ? info.categories
                            : filters.filter === "status"
                              ? info.statuses
                              : filters.filter === "assignment"
                                ? ["unassigned", "assigned"]
                                : ["true", "false"]
                          ).map((v) => (
                            <option key={v} value={v}>
                              {filters.filter === "raw"
                                ? v === "true"
                                  ? "Deleted"
                                  : "Stored"
                                : v}
                            </option>
                          ))}
                        </SearchableSelect>
                      )
                    )}
                    {manager && (
                      <SearchableSelect
                        sortOrder="original"
                        aria-label="Filter by editor"
                        value={filters.editor}
                        onChange={(e) => patch("editor", e.target.value)}
                      >
                        <option value="">All editors</option>
                        {team
                          .filter((m) => m.role === "editor")
                          .map((m) => (
                            <option key={m.uid} value={m.uid}>
                              {m.name}
                            </option>
                          ))}
                      </SearchableSelect>
                    )}
                    <SearchableSelect
                      sortOrder="original"
                      aria-label="Sort requests"
                      value={filters.sort}
                      onChange={(e) => patch("sort", e.target.value)}
                    >
                      <option value="created">Newest submitted</option>
                      <option value="updated">Recently updated</option>
                    </SearchableSelect>
                    <button
                      disabled={!!filters.filter && !filters.value}
                      onClick={() => work(() => refresh(filters))}
                    >
                      Apply filters
                    </button>
                  </div>
                </fieldset>
                {manager && selected.length > 0 && (
                  <div className="actions">
                    {picker}
                    <button
                      disabled={busy || !editor}
                      onClick={() =>
                        work(async () => {
                          for (const id of selected) {
                            await command("assign", { editor }, id);
                            selection((s) => s.filter((x) => x !== id));
                          }
                          await refresh();
                        })
                      }
                    >
                      Assign {selected.length} selected
                    </button>
                  </div>
                )}
                <div className="vt-list" role="table" aria-label="Video requests">
                  <div className="vt-list-head" role="row"><span role="columnheader">Request details</span><span role="columnheader">Customer / company</span><span role="columnheader">Status</span><span role="columnheader">Editor / updated</span><span role="columnheader">Action</span></div>
                  {rows.map(row=><div className="vt-list-row" role="row" key={row.id}>
                    <div className="vt-row-request" role="cell">{manager&&!row.archived&&!['Completed','Rejected','Cancelled'].includes(row.status)&&<input aria-label={'Select '+row.id} type="checkbox" checked={selected.includes(row.id)} onChange={e=>selection(e.target.checked?[...selected,row.id]:selected.filter(i=>i!==row.id))}/>}<Thumb row={row}/><div><strong>{row.category}</strong><small>{row.id}</small><small>{fmt(row.created)} · {row.fileCount} clips</small></div></div>
                    <div className="vt-row-customer" role="cell"><strong>{row.name}</strong><small>{row.company} {row.state}</small><a href={whats(row,'chat')} target="_blank" rel="noreferrer">WhatsApp · {row.mobile}</a></div>
                    <div role="cell"><Status value={row.status}/><small>Round {row.rounds}</small></div>
                    <div className="vt-row-editor" role="cell"><strong>{row.editorName || 'Unassigned'}</strong><small>{fmt(row.updated)}</small></div>
                    <div role="cell"><button className="vt-open" disabled={busy} onClick={()=>work(()=>open(row.id))}>Open <span aria-hidden="true">›</span></button></div>
                  </div>)}
                </div>
                {!rows.length && <p>{busy?'Loading requests…':'No requests match this view.'}</p>}
                <div className="actions ve-pagination"><button disabled={busy || pageIndex===0} onClick={()=>showPage(pageIndex-1)}>Previous</button><small>Page {pageIndex+1}</small><button disabled={busy || (!cursor && !cachedPages[pageIndex+1])} onClick={()=>work(()=>list(applied,true))}>Next</button></div>
              </section>
            </>
          )}
        </>
      )}
      </div></div>
    </main>
  );
}
