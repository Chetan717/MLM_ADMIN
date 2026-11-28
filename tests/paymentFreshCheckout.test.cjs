const test=require('node:test'),assert=require('node:assert/strict');
const {createPaymentService}=require('../functions/paymentService');const D=require('../functions/paymentDomain');
function setup({status='created',paymentItems=[],amountPaid=0,providerStatus='created',offline=false}={}){
 const time=1800000000000,uid='mobile_9999999999',id='p_old',keyId='rzp_test_example';
 const row={id,uid,mode:'test',keyId,plan:{planId:'old'},quoteId:'a'.repeat(64),price:{totalPaise:29382},orderId:'order_old',status,createdAtMs:time-10000,expiresAtMs:time+1800000};
 const data=new Map([['paymentPurchases/'+id,row],['_paymentCheckoutLocks/'+D.hash(`test:${uid}:app:mlmlive`),{purchaseId:id}]]);let providerPosts=0,updates=[];
 const snap=(k)=>({exists:data.has(k),data:()=>data.get(k)});
 const doc=(k)=>({k,get:async()=>snap(k)});
 const db={collection:c=>({doc:k=>doc(c+'/'+k)}),runTransaction:fn=>fn({get:async r=>snap(r.k),set:(r,v)=>data.set(r.k,{...data.get(r.k),...v}),update:(r,v)=>{updates.push([r.k,v]);data.set(r.k,{...data.get(r.k),...v});}})};
 const gateway={keyId,fetchOrder:async()=>{if(offline)throw Error('offline');return {id:row.orderId,amount:29382,currency:'INR',status:providerStatus,amount_paid:amountPaid};},fetchOrderPayments:async()=>({items:paymentItems}),createOrder:async()=>{providerPosts++;throw Error('unexpected POST');}};
 const service=createPaymentService({db,FieldValue:{},Timestamp:{fromMillis:v=>v},getConfig:()=>({mode:'test',keyId,keySecret:'secret',enabled:true}),now:()=>time,gatewayFactory:()=>gateway});
 const req=(data)=>({data,auth:{uid,token:{mobileNo:'9999999999'}},rawRequest:{ip:'127.0.0.1'}});
 return {service,req,data,time,updates,providerPosts:()=>providerPosts};
}
test('real status callable closes unpaid order early and schedules one safety check',async()=>{const s=setup();const out=await s.service.status(s.req({purchaseId:'p_old',closeUnpaid:true}));assert.equal(out.status,'expired');const row=s.data.get('paymentPurchases/p_old');assert.equal(row.checkoutClosedAtMs,s.time);assert.equal(row.nextReconcileAtMs,s.time+3600000);assert.equal(row.paymentConfirmationRequired,false);});
test('real status callable returns failed for confirmed declined payment',async()=>{const s=setup({providerStatus:'attempted',paymentItems:[{status:'failed'}]});const out=await s.service.status(s.req({purchaseId:'p_old',closeUnpaid:true}));assert.equal(out.status,'failed');});
test('authorized or uncertain provider payment cannot be closed',async()=>{for(const options of [{providerStatus:'attempted',paymentItems:[{status:'authorized'}]},{providerStatus:'paid',amountPaid:29382},{providerStatus:'attempted',paymentItems:[{status:'created'}]}]){const s=setup(options);const out=await s.service.status(s.req({purchaseId:'p_old',closeUnpaid:true}));assert.equal(out.status,'pending');assert.equal(s.data.get('paymentPurchases/p_old').paymentConfirmationRequired,true);assert.equal(s.data.get('paymentPurchases/p_old').checkoutClosedAtMs,undefined);}});
test('network failure cannot mark checkout closed',async()=>{const s=setup({offline:true});await assert.rejects(s.service.status(s.req({purchaseId:'p_old',closeUnpaid:true})),/offline/);assert.equal(s.data.get('paymentPurchases/p_old').status,'created');});
test('new request cannot reuse old order even with same quote; no provider POST',async()=>{const s=setup();await assert.rejects(s.service.create(s.req({planId:'old',quoteId:'a'.repeat(64),requestId:'fresh',couponCode:''})),e=>e.code==='failed-precondition'&&e.details.pendingCheckout.purchaseId==='p_old');assert.equal(s.providerPosts(),0);});
test('new quote cannot reuse old order; no provider POST',async()=>{const s=setup();await assert.rejects(s.service.create(s.req({planId:'new',quoteId:'b'.repeat(64),requestId:'fresh',couponCode:''})),e=>e.code==='failed-precondition'&&e.details.pendingCheckout.price.totalPaise===29382);assert.equal(s.providerPosts(),0);});
