import { useEffect, useState } from 'react';
import { useActiveAdminTab } from '../Context/AdminTabContext.js';
const EVENT = 'admin:tab-data-changed';
export function notifyAdminTabUpdates(...tabs) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: { tabs } }));
}
// A confirmed write refreshes its already-loaded list once on return. Ordinary
// tab changes do not refresh. Unvisited/unfetched lists stay on demand.
export function useAdminTabUpdates(tab, load, ready = true) {
  const visible = useActiveAdminTab();
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const changed = event => { if (ready && event.detail?.tabs?.includes(tab)) setDirty(true); };
    window.addEventListener(EVENT, changed);
    return () => window.removeEventListener(EVENT, changed);
  }, [tab, ready]);
  useEffect(() => {
    if (!visible || !ready || !dirty) return;
    setDirty(false);
    void load();
  }, [visible, ready, dirty, load]);
}
