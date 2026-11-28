const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../functions/paymentDomain');const V=require('../functions/video/domain');const H=require('../functions/video/hardening');
test('batch signing bounds all parts and rejects duplicates or out of range',()=>{assert.deepEqual(H.validateParts([1,2,3,4,5,6],18),[1,2,3,4,5,6]);for(const parts of [[],[0],[19],[1,1],[1,2,3,4,5,6,7],[1.2],null,['1']])assert.throws(()=>H.validateParts(parts,18));});
test('instance burst limit isolates users and permits cleanup after upload throttling',()=>{let now=0;const limit=H.makeBurstLimiter(()=>now);for(let i=0;i<120;i++)assert.equal(limit('u','parts'),true);assert.equal(limit('u','parts'),false);assert.equal(limit('u','discard'),true);assert.equal(limit('v','parts'),true);now=60000;assert.equal(limit('u','parts'),true);});
test('new poster and combo plans unlimited, video credits unchanged',()=>{const plan={PlanName:'Pro',PlanAmount:499,Day_value:30,Launch:true,downloads:10,videoCredits:5};const catalog=D.appPlans({Plans:['poster','combo','video'].map(serviceType=>({...plan,serviceType,planId:serviceType}))});assert.equal(catalog[0].unlimitedDownloads,true);assert.equal(catalog[0].downloads,0);assert.equal(catalog[1].unlimitedDownloads,true);assert.equal(catalog[1].videoCredits,5);assert.equal(catalog[2].videoCredits,5);const value={scope:'app',grants:[{purchaseId:'old',serviceType:'poster',startsAtMs:0,expiresAtMs:1000,remainingDownloads:0,unlimitedDownloads:false}]};assert.equal(D.entitlementSummary(value,500).services.poster.status,'active');assert.equal(D.purchaseEligibility(value,500).poster,false);assert.equal(D.entitlementSummary(value,1001).services.poster.status,'expired');});
test('revoked credit cannot be consumed but can be released by cancellation',()=>{const grant={purchaseId:'p1',serviceType:'video',revoked:true,remainingCredits:1,reservedVideoCredits:1};const ledger={grants:[grant]};assert.throws(()=>V.credit(ledger,'consume',1,'p1'));assert.equal(V.credit(ledger,'release',1,'p1').ledger.grants[0].reservedVideoCredits,0);});
test('150 MB accepted and one byte more rejected',()=>{const clip={type:'video/mp4',name:'clip.mp4',size:150000000};assert.equal(V.manifest(Array(5).fill(clip)).length,5);assert.throws(()=>V.manifest([{...clip,size:150000001}]));});
const fs=require('node:fs');const serviceSrc=fs.readFileSync(require.resolve('../functions/paymentService'),'utf8');
test('reconciliation processes pending first and keeps total queue <= 25',async()=>{
  const body=serviceSrc.slice(serviceSrc.indexOf('  async function scheduledReconcile()'),serviceSrc.indexOf('\n  return {\n    catalog,'));
  const queries=[],processed=[],updates=[];let time=1800000000000;
  const make=(i,status)=>{const row={id:status+i,status,createdAtMs:time-1000,orderId:'order',paymentId:status==='paid'?'pay':'',subscriptionExpiresAtMs:time+100000};const ref={get:async()=>({data:()=>row}),update:async v=>updates.push(v)};return {data:()=>row,ref};};
  const query=(status)=>({where(k,o,v){return query(k==='status'?v:status);},orderBy(){return this;},limit(n){queries.push([status,n]);return {get:async()=>{const docs=Array.from({length:n},(_,i)=>make(i,status.includes('creating')?'pending':'paid'));return {docs,size:docs.length};}};}});
  const db={collection:()=>query([]),runTransaction:fn=>fn({get:r=>r.get(),update:(_r,v)=>updates.push(v)})};
  const run=new Function('db','PURCHASES','getConfig','now','reconcile','D','FieldValue','audit',body+'\nreturn scheduledReconcile;')(db,'paymentPurchases',()=>({mode:'live'}),()=>time,async row=>{processed.push(row.status);},D,{delete:()=>null},()=>{});
  await run();assert.deepEqual(queries.map(x=>x[1]),[20,5]);assert.equal(processed.length,25);assert.deepEqual(processed.slice(0,20),Array(20).fill('pending'));assert.equal(updates.length,25);
});
test('won/closed dispute flags review without a reversal; a lost dispute holds access',async()=>{
  const body=serviceSrc.slice(serviceSrc.indexOf('  async function webhook('),serviceSrc.indexOf('  async function adminSummary('));
  const purchase={id:'p_'+'a'.repeat(36),uid:'u',paymentId:'pay_abc',orderId:'order_abc',status:'paid'};
  const reversals=[],updates=[],events=new Set();
  const ref=(collection,id)=>({id,get:async()=>({exists:collection==='paymentPurchases'||events.has(id),data:()=>purchase}),set:async()=>events.add(id)});
  const gateway=()=>({fetchPayment:async()=>({id:'pay_abc',order_id:'order_abc',status:'captured',amount_refunded:0}),fetchOrder:async()=>({notes:{purchaseId:purchase.id}})});
  const db={runTransaction:fn=>fn({get:r=>r.get(),update:(_r,v)=>updates.push(v)})};
  const run=new Function('ref','D','gateway','PURCHASES','attachOrder','settle','db','snapshotData','auditRow','now','applyReversal','Timestamp',body+'\nreturn webhook;')(ref,D,gateway,'paymentPurchases',async()=>purchase,async()=>({status:'paid'}),db,s=>s.data(),()=>{},()=>500000,async(...args)=>reversals.push(args),{fromMillis:v=>v});
  for(const [i,event] of ['payment.dispute.won','payment.dispute.closed','payment.dispute.lost'].entries())await run({event,created_at:100+i,payload:{payment:{entity:{id:'pay_abc'}}}},'e'+i);
  assert.equal(updates.length,2);assert.ok(updates.every(x=>x.needsReview&&x.disputeReviewRequired));assert.equal(updates[0].disputeEventAtMs,100000);assert.equal(reversals.length,1);assert.equal(reversals[0][2],true);
});
test('draft cancellation first locks the matching draft, deletes only its clips, then deletes metadata; failures remain retryable',async()=>{
  const s=fs.readFileSync(require.resolve('../functions/video/functions'),'utf8');const body=s.slice(s.indexOf('  async function cleanup('),s.indexOf('  function call('));
  const initial={id:'draft1',expires:Date.now()+100000,stage:'open',files:[{key:'owner/raw1'},{key:'owner/raw2'}]};let row=structuredClone(initial);const ops=[];const ref={};const db={runTransaction:fn=>fn({get:async()=>({data:()=>row}),update:(_ref,v)=>{row={...row,...v};ops.push('lock');},delete:()=>{row=null;ops.push('delete-metadata');}})};
  const run=new Function('db',body+'\nreturn cleanup;')(db);const store={abort:async f=>ops.push('abort:'+f.key),remove:async f=>ops.push('remove:'+f.key)};
  assert.equal(await run(ref,store,'different'),false);assert.deepEqual(ops,[]);assert.equal(await run(ref,store,'draft1'),true);assert.deepEqual(ops,['lock','abort:owner/raw1','remove:owner/raw1','abort:owner/raw2','remove:owner/raw2','delete-metadata']);assert.equal(row,null);
  row=structuredClone(initial);await assert.rejects(run(ref,{...store,remove:async()=>{throw Error('temporary R2 failure');}},'draft1'));assert.equal(row.stage,'cleaning');assert.equal(await run(ref,store,'draft1'),true);
});
