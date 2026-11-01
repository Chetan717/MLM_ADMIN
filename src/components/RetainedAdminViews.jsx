import { Suspense, useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router';
import { AdminTabContext, useActiveAdminTab } from '../Context/AdminTabContext.js';
import { canonicalAdminPage } from '../Utils/adminPageState.js';
import './RetainedAdminViews.css';

// Visit-only mounting: hidden pages retain their data, filters and DOM. No
// page is fetched merely because its route exists in the sidebar.
export function RetainedAdminRoutes({ pages, children }) {
  const location = useLocation();
  const activePath = canonicalAdminPage(location.pathname);
  const activePage = pages.find(page => page.path === activePath);
  const [visited, setVisited] = useState([]);
  useEffect(() => {
    if (!activePage) return;
    setVisited(previous => {
      const old = previous.find(entry => entry.path === activePage.path);
      if (old?.location === location) return previous;
      const entry = { path: activePage.path, location };
      return old ? previous.map(item => item.path === entry.path ? entry : item) : [...previous, entry];
    });
  }, [activePage, location]);
  const entries = activePage && !visited.some(entry => entry.path === activePage.path)
    ? [...visited, { path: activePage.path, location }] : visited;
  return <>
    {entries.map(entry => {
      const page = pages.find(item => item.path === entry.path);
      if (!page) return null;
      const visible = entry.path === activePath;
      return <AdminTabContext.Provider key={entry.path} value={visible}>
        <section className="admin-retained-page" data-admin-page={entry.path} hidden={!visible} inert={!visible} aria-hidden={!visible}>
          <Suspense fallback={<div className="p-6">Loading…</div>}>
            <Routes location={visible ? location : entry.location}>
              {[page.path, ...(page.aliases || [])].map(path => <Route key={path} path={path} element={page.element} />)}
            </Routes>
          </Suspense>
        </section>
      </AdminTabContext.Provider>;
    })}
    {!activePage && <div className="admin-retained-form">{children}</div>}
  </>;
}

export function RetainedAdminPanels({ activeId, panels, className = '' }) {
  const parentVisible = useActiveAdminTab();
  const activePanel = panels.find(panel => panel.id === activeId);
  const [visited, setVisited] = useState([]);
  useEffect(() => {
    if (activePanel) setVisited(previous => previous.includes(activeId) ? previous : [...previous, activeId]);
  }, [activeId, activePanel]);
  const entries = activePanel && !visited.includes(activeId) ? [...visited, activeId] : visited;
  return entries.map(id => {
    const panel = panels.find(item => item.id === id);
    if (!panel) return null;
    const visible = parentVisible && id === activeId;
    return <AdminTabContext.Provider key={id} value={visible}>
      <div className={`admin-retained-panel ${className}`} data-admin-panel={id} hidden={!visible} inert={!visible} aria-hidden={!visible}>{panel.element}</div>
    </AdminTabContext.Provider>;
  });
}
