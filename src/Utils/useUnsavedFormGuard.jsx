import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

/** Guards form edits and unsaved uploads. Never deletes R2 objects. */
export default function useUnsavedFormGuard({ form, ready = true, saving = false, saved = false }) {
  const navigate = useNavigate();
  const baseline = useRef(null);
  const readyRef = useRef(false);
  const allowed = useRef(false);
  const [pending, setPending] = useState(null);
  const [saveThenLeave, setSaveThenLeave] = useState(false);
  const snapshot = JSON.stringify(form ?? null);

  useEffect(() => {
    if (!ready || readyRef.current) return;
    baseline.current = snapshot;
    readyRef.current = true;
  }, [ready, snapshot]);

  const dirty = ready && readyRef.current && snapshot !== baseline.current && !saved;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savingRef = useRef(saving);
  savingRef.current = saving;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const requestLeave = useCallback((destination) => {
    if (savingRef.current) return;
    if (!dirtyRef.current) {
      allowed.current = true;
      navigate(destination);
      return;
    }
    setPending(destination);
  }, [navigate]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  // Catch ordinary sidebar/header links, including nested icon/text clicks.
  useEffect(() => {
    const intercept = (event) => {
      if (allowed.current || !dirtyRef.current || savingRef.current || event.defaultPrevented) return;
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor || anchor.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      event.preventDefault();
      event.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    document.addEventListener('click', intercept, true);
    return () => document.removeEventListener('click', intercept, true);
  }, []);

  // Allow shared admin navigation buttons to respect this form's guard.
  useEffect(() => {
    const handleRouteRequest = (event) => {
      if (!dirtyRef.current || allowed.current) return;
      event.preventDefault();
      if (!savingRef.current) setPending(event.detail?.destination || '/');
    };
    window.addEventListener('admin:route-request', handleRouteRequest);
    return () => window.removeEventListener('admin:route-request', handleRouteRequest);
  }, []);

  // A history sentinel keeps browser/mobile Back within the editor until a choice is made.
  useEffect(() => {
    if (!dirty) return;
    const marker = { ...(window.history.state || {}), __mlmUnsavedGuard: true };
    window.history.pushState(marker, '', window.location.href);
    const onPop = () => {
      if (allowed.current || !dirtyRef.current) return;
      window.history.pushState(marker, '', window.location.href);
      setPending(window.location.pathname.startsWith('/companies') ? '/companies' : window.location.pathname.startsWith('/graphics') ? '/graphics' : '/templates');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [dirty]);

  useEffect(() => {
    if (saved && saveThenLeave && pendingRef.current) {
      const target = pendingRef.current;
      allowed.current = true;
      setPending(null);
      navigate(target);
    }
  }, [saved, saveThenLeave, navigate]);

  const modal = pending ? (
    <div role="presentation" className="fixed inset-0 z-[99999] bg-black/60 flex items-center justify-center p-4">
      <section role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title" className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-2xl p-6 space-y-4">
        <h2 id="unsaved-title" className="text-lg font-bold text-gray-900 dark:text-white">Unsaved changes</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">You have unsaved changes or uploaded media. Save before leaving, or discard changes to this form. Discard does not delete files from R2.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => { setSaveThenLeave(false); setPending(null); }}>Continue Editing</button>
          <button type="button" disabled={saving} className="rounded-lg border border-red-300 text-red-700 px-3 py-2 text-sm disabled:opacity-50" onClick={() => { const destination = pending; allowed.current = true; setPending(null); navigate(destination); }}>Discard</button>
          <button type="button" disabled={saving} className="rounded-lg bg-violet-600 text-white px-4 py-2 text-sm disabled:opacity-50" onClick={() => { setSaveThenLeave(true); document.querySelector('form[data-admin-edit-form="true"]')?.requestSubmit(); }}>Save</button>
        </div>
      </section>
    </div>
  ) : null;

  return { requestLeave, modal, dirty };
}
