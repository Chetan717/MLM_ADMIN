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
function Login() {
  const [email, set] = useState(""),
    [password, pass] = useState(""),
    [msg, say] = useState(""),
    [busy, block] = useState(false);
  async function go(reset) {
    block(true);
    say("");
    try {
      if (reset) {
        await sendPasswordResetEmail(teamAuth, email);
        say("Check your email for the password reset link.");
      } else await signInWithEmailAndPassword(teamAuth, email, password);
    } catch (e) {
      say(e.message);
    } finally {
      block(false);
    }
  }
  return (
    <main className="ve">
      <section>
        <h1>Video editing team</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            go(false);
          }}
        >
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => set(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => pass(e.target.value)}
            />
          </label>
          <div className="actions">
            <button disabled={busy} className="primary">
              Sign in
            </button>
            <button
              type="button"
              disabled={!email || busy}
              onClick={() => go(true)}
            >
              Reset password
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
  return <Panel key={admin ? "admin" : user.uid} admin={admin} />;
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
function Panel({ admin }) {
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
    [tab, setTab] = useState("requests");
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
  useEffect(() => {
    if (
      filters.filter !== "search" ||
      !filters.value.trim() ||
      tab !== "requests" ||
      detail
    )
      return;
    const timer = setTimeout(() => work(() => refresh(filters)), 450);
    return () => clearTimeout(timer);
  }, [filters.value, filters.filter]);
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
    setDetail(res);
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
  return (
    <main className="ve">
      <header>
        <h1>Video editing team</h1>
        <div className="actions">
          <button
            disabled={busy}
            onClick={() =>
              work(async () => {
                await refresh();
                if (r) await open(r.id);
              })
            }
          >
            Refresh
          </button>
          {!admin && (
            <button onClick={() => signOut(teamAuth)}>Sign out</button>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {msg && <p role="status">{msg}</p>}
      {!info && !error && <p>Loading workspace…</p>}
      {info && (
        <>
          <div className="actions">
            {info.role === "admin" && (
              <button
                onClick={() => {
                  setTab("settings");
                  setDetail(null);
                }}
              >
                Service settings
              </button>
            )}
            <button
              onClick={() => {
                setTab("requests");
                setDetail(null);
                if (applied.archived) { const f={...emptyFilters}; filter(f); work(()=>refresh(f)); }
              }}
            >
              Requests
            </button>
            {info.role === "admin" && <button disabled={busy} onClick={()=>{setTab("requests");setDetail(null);const f={...emptyFilters,archived:true};filter(f);work(()=>refresh(f));}}>Archived requests</button>}
            {manager && (
              <button
                onClick={() => {
                  setTab("team");
                  setDetail(null);
                }}
              >
                Team accounts
              </button>
            )}
          </div>
          {tab === "settings" && settings ? (
            <section>
              <h2>Service settings</h2>
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
            <section>
              <header>
                <h2>Team accounts</h2>
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
                <fieldset disabled={busy}>
                  <legend>Create account</legend>
                  {["name", "email", "mobile"].map((k) => (
                    <label key={k}>
                      {k}
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
            <section>
              <header>
                <h2>
                  {r.name} · {r.status}
                </h2>
                <button onClick={() => setDetail(null)}>
                  Back to requests
                </button>
              </header>
              <p>
                {r.id} · {r.mobile} · {r.company} · {r.state}
              </p>
              <p>
                {r.category} {r.other} · {fmt(r.created)}
              </p>
              <p className="note">{r.instructions}</p>
              <p>Assigned editor · {r.editorName || "Unassigned"}</p>
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
              {r.link && (
                <a
                  className="action"
                  target="_blank"
                  rel="noreferrer"
                  href={r.link}
                >
                  Open edited version {r.version}
                </a>
              )}
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
              <fieldset disabled={busy || r.archived}>
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
                    <button onClick={() => work(() => change("edit"))}>
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
                  <button
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
              <h3>Request and credit history</h3>
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
            </section>
          ) : (
            <>
              <section>
                <h2>{applied.archived ? "Archived requests" : "Service overview"}</h2>
                {applied.archived && <button disabled={busy} onClick={()=>work(async()=>{const result=await call("reindexArchived",{cursor:migrationCursor});setMigrationCursor(result.cursor);await refresh();say(result.migrated+" old archives indexed."+(result.cursor?" Click again for next batch.":" Archive scan complete."));})}>{migrationCursor?"Index next 10 old archives":"Index older archived requests"}</button>}
                <div className="metrics">
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
                </div>
              </section>
              <section>
                <h2>Requests</h2>
                <fieldset disabled={busy}>
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
                <div className="ve-team-cards">{rows.map(row=><article key={row.id} className="ve-team-card"><div className="ve-thumb">{row.thumbnail?<img loading="lazy" src={row.thumbnail} alt="Raw clip preview"/>:"▶"}</div><div className="ve-card-copy"><strong>{row.category}</strong><p>{row.name} · {row.editorName || "Unassigned"}</p><small>{row.id} · {fmt(row.created)}</small></div><div className="ve-card-end"><b className="ve-status" data-status={row.status}>{row.status}</b><button disabled={busy} onClick={()=>work(()=>open(row.id))}>Details</button></div></article>)}</div>
                <div className="wrap ve-team-table">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "Request",
                          "Customer",
                          "Company / state",
                          "Status",
                          "Editor",
                          "Updated",
                        ].map((k) => (
                          <th key={k}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            {manager &&
                              !["Completed", "Rejected", "Cancelled"].includes(
                                row.status,
                              ) && (
                                <input
                                  aria-label={"Select " + row.id}
                                  type="checkbox"
                                  checked={selected.includes(row.id)}
                                  onChange={(e) =>
                                    selection(
                                      e.target.checked
                                        ? [...selected, row.id]
                                        : selected.filter((i) => i !== row.id),
                                    )
                                  }
                                />
                              )}{" "}
                            <button
                              disabled={busy}
                              onClick={() => work(() => open(row.id))}
                            >
                              {row.id}
                            </button>
                            <br />
                            {row.thumbnail && <img loading="lazy" src={row.thumbnail} alt="Raw clip preview" className="ve-table-thumb"/>}
                            {row.category} · {row.fileCount} clips
                            <br />
                            {fmt(row.created)}
                          </td>
                          <td>
                            {row.name}
                            <br />
                            {row.mobile}{" "}
                            <a
                              target="_blank"
                              rel="noreferrer"
                              href={whats(row, "chat")}
                            >
                              WhatsApp
                            </a>
                          </td>
                          <td>
                            {row.company} {row.state}
                          </td>
                          <td>
                            {row.status} · round {row.rounds}
                          </td>
                          <td>{row.editorName || "Unassigned"}</td>
                          <td>{fmt(row.updated)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rows.length && <p>No requests match this view.</p>}
                <div className="actions ve-pagination"><button disabled={busy || pageIndex===0} onClick={()=>showPage(pageIndex-1)}>Previous</button><small>Page {pageIndex+1}</small><button disabled={busy || (!cursor && !cachedPages[pageIndex+1])} onClick={()=>work(()=>list(applied,true))}>Next</button></div>
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
}
