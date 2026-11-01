import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_PAGE_PATHS, canonicalAdminPage, adminWorkspaceKey, adminNavigationId } from '../src/Utils/adminPageState.js';

test('only the bounded sidebar pages are retained; edit/create forms are never cached as separate records', () => {
  assert.equal(new Set(ADMIN_PAGE_PATHS).size, 16);
  for (const path of ADMIN_PAGE_PATHS) assert.equal(canonicalAdminPage(path), path);
  for (const path of ['/companies/add', '/companies/edit/one', '/templates/edit/two', '/graphics/add', '/login', '/unknown']) {
    assert.equal(canonicalAdminPage(path), null);
  }
});
test('template aliases share data, and trailing slashes do not create new page instances', () => {
  assert.equal(canonicalAdminPage('/dashboard'), '/templates');
  assert.equal(canonicalAdminPage('/templates/'), '/templates');
  assert.equal(canonicalAdminPage('/companies/'), '/companies');
});
test('account, role or permission changes clear page state; permission-array ordering alone does not', () => {
  const session = { uid: 'a', id: 'admin-a', ownerAdminId: 'owner', role: 'Admin', assigntab: ['companies', 'leads'] };
  const initial = adminWorkspaceKey(session);
  assert.equal(initial, adminWorkspaceKey({ ...session, assigntab: ['leads', 'companies'] }));
  assert.notEqual(initial, adminWorkspaceKey({ ...session, uid: 'b' }));
  assert.notEqual(initial, adminWorkspaceKey({ ...session, role: 'Master Admin' }));
  assert.notEqual(initial, adminWorkspaceKey({ ...session, assigntab: ['companies'] }));
  assert.notEqual(initial, adminWorkspaceKey(null));
  assert.deepEqual(session.assigntab, ['companies', 'leads']);
});
test('sidebar/header selection follows direct links and browser navigation, including edit pages', () => {
  assert.equal(adminNavigationId('/'), 'dashboard');
  assert.equal(adminNavigationId('/dashboard'), 'templates');
  assert.equal(adminNavigationId('/companies/edit/id'), 'companies');
  assert.equal(adminNavigationId('/graphics/edit/id'), 'Graphics');
  assert.equal(adminNavigationId('/delete-requests'), 'delete_requests');
});
