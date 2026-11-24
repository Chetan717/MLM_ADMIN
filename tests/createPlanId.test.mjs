import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { createPlanId } from '../src/Utils/createPlanId.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

test('browsers without randomUUID use random bytes and produce distinct valid plan IDs', () => {
  const legacyCrypto = { getRandomValues: bytes => webcrypto.getRandomValues(bytes) };
  const ids = Array.from({ length: 1000 }, () => createPlanId(legacyCrypto));
  assert(ids.every(id => uuid.test(id)));
  assert.equal(new Set(ids).size, ids.length);
});

test('without Web Crypto, plan IDs stay distinct even if time and Math.random are constant', () => {
  const helper = fs.readFileSync(new URL('../src/Utils/createPlanId.js', import.meta.url), 'utf8').replace('export function', 'function');
  const context = vm.createContext({ crypto: undefined, Date: { now: () => 42 }, Math: { random: () => 0.5 } });
  vm.runInContext(helper + '\nthis.generate = createPlanId;', context);
  const ids = Array.from({ length: 1000 }, () => context.generate());
  assert.equal(new Set(ids).size, ids.length);
  assert(ids.every(id => /^[A-Za-z0-9_-]{1,128}$/.test(id)));
});

for (const name of ['AddCompanies', 'EditCompanies']) {
  test(`${name} initializes its actual plan defaults without randomUUID or a global crypto object`, () => {
    const helper = fs.readFileSync(new URL('../src/Utils/createPlanId.js', import.meta.url), 'utf8').replace('export function', 'function');
    const form = fs.readFileSync(new URL(`../src/Pages/companies/Forms/${name}.jsx`, import.meta.url), 'utf8');
    const stop = name === 'AddCompanies' ? form.indexOf('// ── Shared style constants') : form.indexOf('const normalisePlans');
    assert(stop > 0);
    const initializers = form.slice(0, stop).replace(/^import\s[\s\S]*?;\s*$/gm, '');
    for (const crypto of [undefined, { getRandomValues: bytes => webcrypto.getRandomValues(bytes) }]) {
      const context = vm.createContext({ crypto, Math, Date, Uint8Array });
      vm.runInContext(helper + '\n' + initializers + '\nthis.plan = emptyPlan();', context);
      assert.match(context.plan.planId, /^[A-Za-z0-9_-]{1,128}$/);
      assert.equal(context.plan.serviceType, 'poster');
      assert.equal(context.plan.PlanAmount, '');
      if (name === 'AddCompanies') {
        assert.match(vm.runInContext('INITIAL_STATE.Plans[0].planId', context), /^[A-Za-z0-9_-]{1,128}$/);
      }
    }
  });
}
