import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {createPlanId} from '../src/Utils/createPlanId.js';
test('older browsers generate unique app plan UUIDs using random bytes',()=>{
 const api={getRandomValues:v=>webcrypto.getRandomValues(v)};
 const ids=Array.from({length:1000},()=>createPlanId(api));
 assert.equal(new Set(ids).size,ids.length);
 assert(ids.every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
});
test('no-Web-Crypto fallback keeps public IDs unique without extra dependencies',()=>{
 const helper=fs.readFileSync(new URL('../src/Utils/createPlanId.js',import.meta.url),'utf8').replace('export function','function');
 const c=vm.createContext({Date:{now:()=>42},Math:{random:()=>0.5},crypto:undefined});
 vm.runInContext(helper+'\nthis.generate=createPlanId;',c);
 const ids=Array.from({length:1000},()=>c.generate());assert.equal(new Set(ids).size,1000);
});
test('central App Plans initializes its actual default row without randomUUID',()=>{
 const helper=fs.readFileSync(new URL('../src/Utils/createPlanId.js',import.meta.url),'utf8').replace('export function','function');
 const source=fs.readFileSync(new URL('../src/Pages/Plans/AppPlans.jsx',import.meta.url),'utf8');
 const initializer=source.split('\n').find(line=>line.startsWith('const emptyPlan ='));
 assert(initializer);
 for(const crypto of [undefined,{getRandomValues:v=>webcrypto.getRandomValues(v)}]){
  const c=vm.createContext({crypto,Math,Date,Uint8Array});vm.runInContext(helper+'\n'+initializer+'\nthis.plan=emptyPlan();',c);
  assert.match(c.plan.planId,/^[A-Za-z0-9_-]{1,128}$/);assert.equal(c.plan.serviceType,'poster');assert.equal('companyId' in c.plan,false);
 }
});
test('company forms no longer expose plan creation or submit company plan fields',()=>{
 for(const name of ['AddCompanies','EditCompanies']){
  const source=fs.readFileSync(new URL(`../src/Pages/companies/Forms/${name}.jsx`,import.meta.url),'utf8');
  assert.doesNotMatch(source,/form\.Plans|emptyPlan|PlansField|PlanServiceFields/);
 }
});
