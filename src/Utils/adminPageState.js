export const ADMIN_PAGE_PATHS = ['/', '/companies', '/templates', '/graphics', '/marketing', '/removebg',
  '/userdashboard', '/leads', '/templatedata', '/adminmanagement', '/security', '/taskmanagement',
  '/notifications', '/delete-requests', '/expense', '/popups'];
export function canonicalAdminPage(pathname) {
  const path = pathname === '/' ? '/' : String(pathname || '').replace(/\/+$/, '');
  if (path === '/dashboard') return '/templates';
  return ADMIN_PAGE_PATHS.includes(path) ? path : null;
}
export function adminWorkspaceKey(session) {
  return JSON.stringify([session?.uid || '', session?.id || '', session?.ownerAdminId || '', session?.role || '',
    session?.actorType || '', [...(session?.assigntab || [])].sort()]);
}
export function adminNavigationId(pathname) {
  if (pathname === '/') return 'dashboard';
  if (pathname === '/dashboard') return 'templates';
  const first = pathname.split('/')[1];
  return first === 'graphics' ? 'Graphics' : first === 'delete-requests' ? 'delete_requests' : first || 'dashboard';
}
