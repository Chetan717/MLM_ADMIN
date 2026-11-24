import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,updateDoc,deleteDoc,collection,query,where,getDocs,limit,Timestamp,serverTimestamp}=require('firebase/firestore');
let env;
const U='mobile_9999999999',OTHER='mobile_8888888888';
const context=(uid,claims={})=>env.authenticatedContext(uid,claims).firestore();
const user=()=>context(U,{mobileNo:'9999999999'});
const master=()=>context('admin_master',{panel:'admin',role:'Master Admin',actorType:'owner',tabs:[],ownerAdminId:'admin_master',name:'Master'});
const editor=()=>context('admin_editor',{panel:'admin',role:'Designer',actorType:'staff',tabs:['templates','taskmanagement'],name:'Designer'});
const marketing=(actorType='owner')=>context('marketing_owner',{panel:'marketing',mteamId:'seller',actorType,tabs:['dashboard','reports','leads','freshleads','taskmanagement'],parentMobile:'5555555555',name:'Seller'});
const seed=(db,path,data)=>setDoc(doc(db,path),data);
before(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:'))throw Error('Local emulator only');
 env=await initializeTestEnvironment({projectId:'demo-mlmlive-rules',firestore:{host:'127.0.0.1',port:8087,rules:fs.readFileSync(new URL('../firestore.rules', import.meta.url),'utf8')}});
});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  const expiresAt=Timestamp.fromMillis(Date.now()+3600000);
  await Promise.all([
   seed(db,'users/user_a',{uid:U,mobileNo:'9999999999',name:'Customer',referredByMteam:'seller',mteamCouponCode:'SAVE10',referCredit:0}),
   seed(db,'users/user_b',{uid:OTHER,mobileNo:'8888888888',name:'Other',referredByMteam:'other',mteamCouponCode:'OTHER1'}),
   seed(db,'mlmprofiles/profile_a',{mobile:'9999999999',fullName:'Customer',companyId:'company_a',companyName:'Company A'}),
   seed(db,'mlmprofiles/profile_b',{mobile:'8888888888',fullName:'Other',companyId:'company_b'}),
   seed(db,'mlmcomp/company_a',{name:'Company A',Plans:[{planId:'p1',PlanAmount:1000}]}),
   seed(db,'mteam/seller',{mobile:'7777777777',assign_coupon_id:'coupon_a',commissionPercentage:20,team:[]}),
   seed(db,'mteam/parent',{mobile:'5555555555',team:[]}),
   seed(db,'mteam/other',{mobile:'6666666666',team:[]}),
   seed(db,'couponcode/coupon_a',{code:'SAVE10',assigned_user:{id:'seller'},user_discount:10,active:true}),
   seed(db,'couponcode/coupon_b',{code:'OTHER1',assigned_user:{id:'other'},user_discount:5,active:true}),
   seed(db,'subscription/sub_a',{mobileNo:'9999999999',couponApplied:'SAVE10',Active:true}),
   seed(db,'subscription/sub_b',{mobileNo:'8888888888',couponApplied:'OTHER1',Active:true}),
   ...['admin_master','admin_editor','admin_leads','admin_companies'].map(uid=>seed(db,'_panelSessions/'+uid,{panel:'admin',expiresAt,revoked:false})),
   seed(db,'_panelSessions/marketing_owner',{panel:'marketing',expiresAt,revoked:false}),
   seed(db,'_panelSessions/revoked_admin',{panel:'admin',expiresAt,revoked:true}),
   seed(db,'_panelSessions/expired_admin',{panel:'admin',expiresAt:Timestamp.fromMillis(Date.now()-1000),revoked:false}),
   seed(db,'mlmtemplate/template_a',{name:'Template A'}),
   seed(db,'expense/expense',{schemaVersion:1,revision:1,employees:{},expenses:{},salaries:{},expenseNames:{}}),
   seed(db,'popup/popup',{schemaVersion:1,revision:1,campaigns:{}}),
   seed(db,'Taskm/task_a',{name:'Design task',taskDate:'2026-11-24',description:'Prepare template',companyName:'Company A',status:'Initiated',assignedPanel:'admin',assignedRole:'Designer',assignedRoleKey:'designer',createdByUid:'admin_editor',createdByMteamId:'',createdByName:'Designer',createdByPanel:'admin'}),
   seed(db,'reportingUser/report_a',{name:'Report'}),
  ]);
 });
});

test('customers read only their own subscriptions; direct lists must be bounded and scoped',async()=>{
 const db=user();await assertSucceeds(getDoc(doc(db,'subscription/sub_a')));await assertFails(getDoc(doc(db,'subscription/sub_b')));
 await assertSucceeds(getDocs(query(collection(db,'subscription'),where('mobileNo','==','9999999999'),limit(50))));
 await assertFails(getDocs(query(collection(db,'subscription'),where('mobileNo','==','9999999999'))));
 await assertFails(getDocs(query(collection(db,'subscription'),limit(50))));
});
test('all new payment and entitlement collections refuse forged client and Master Admin writes',async()=>{
 for(const db of [user(),master()]){
  for(const collection of ['appPlans','subscription','paymentPurchases','paymentTestSubscriptions','paymentVideoSubscriptions','paymentEntitlements','paymentCommissions','paymentStats','paymentDaily','paymentAudit','paymentlog','_razorpayOrders','_razorpayPayments','_razorpayWebhookInbox','_razorpayWebhookEvents','_paymentLimits','_paymentCheckoutLocks']){
   await assertFails(setDoc(doc(db,collection+'/forged'),{uid:U,mobileNo:'9999999999',Active:true,amountPaise:1}));
  }
 }
});
test('customer cannot change credit, identity, coupon or commission attribution',async()=>{
 const db=user();
 for(const change of [{referCredit:1000},{uid:OTHER},{mobileNo:'8888888888'},{mteamCouponCode:'OTHER1'},{referredByMteam:'other'},{Active:true}])await assertFails(updateDoc(doc(db,'users/user_a'),change));
 await assertFails(updateDoc(doc(master(),'users/user_a'),{referredByMteam:'other'}));
});
test('customer name and existing zero-read download activity still update',async()=>{
 const ref=doc(user(),'users/user_a');
 await assertSucceeds(updateDoc(ref,{name:'Customer Updated'}));
 await assertSucceeds(updateDoc(ref,{lastDownloadAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(ref,{dailyDownloadDate:'2026-11-24',dailyDownloadCount:1,dailyDownloadUpdatedAt:serverTimestamp()}));
 await assertFails(updateDoc(ref,{name:'X'}));
});
test('existing Marketing assigned-user read queries are preserved without opening other leads',async()=>{
 const db=marketing();
 await assertSucceeds(getDoc(doc(db,'users/user_a')));await assertFails(getDoc(doc(db,'users/user_b')));
 await assertSucceeds(getDocs(query(collection(db,'users'),where('referredByMteam','==','seller'))));
 await assertFails(getDocs(collection(db,'users')));
});
test('Marketing keeps own coupon and coupon-filtered dashboard/reports subscriptions',async()=>{
 const db=marketing();
 await assertSucceeds(getDoc(doc(db,'couponcode/coupon_a')));await assertFails(getDoc(doc(db,'couponcode/coupon_b')));
 await assertSucceeds(getDocs(query(collection(db,'couponcode'),where('assigned_user.id','==','seller'))));
 await assertSucceeds(getDoc(doc(db,'subscription/sub_a')));await assertFails(getDoc(doc(db,'subscription/sub_b')));
 await assertSucceeds(getDocs(query(collection(db,'subscription'),where('couponApplied','==','SAVE10'))));
 await assertFails(getDocs(collection(db,'subscription')));
});
test('Marketing Portal Users list edits remain permitted; financial edits do not',async()=>{
 const db=marketing();const ref=doc(db,'mteam/seller');
 await assertSucceeds(updateDoc(ref,{team:[{name:'Portal User',mobile:'1234567890'}],updatedAt:serverTimestamp()}));
 for(const change of [{commissionPercentage:99},{parentMteamId:'other'},{assign_coupon_id:'coupon_b'},{active:false}])await assertFails(updateDoc(ref,change));
 await assertFails(updateDoc(doc(marketing('staff'),'mteam/seller'),{team:[]}));
 await assertFails(updateDoc(doc(db,'mteam/other'),{team:[]}));
 await assertFails(updateDoc(doc(db,'couponcode/coupon_a'),{user_discount:99}));
});
test('own and parent Marketing reads retain the previous access scope',async()=>{
 const db=marketing();await assertSucceeds(getDoc(doc(db,'mteam/seller')));await assertSucceeds(getDoc(doc(db,'mteam/parent')));await assertFails(getDoc(doc(db,'mteam/other')));
 const legacy=context('legacy_owner',{panel:'marketing',mteamId:'seller',actorType:'owner'});
 await assertSucceeds(getDoc(doc(legacy,'mteam/seller')));await assertSucceeds(getDoc(doc(legacy,'couponcode/coupon_a')));
});
test('company plan prices and coupon percentages are server-only even for Master Admin',async()=>{
 for(const db of [user(),master(),marketing()]){
  await assertFails(updateDoc(doc(db,'mlmcomp/company_a'),{Plans:[{PlanAmount:1}]}));
  await assertFails(updateDoc(doc(db,'couponcode/coupon_a'),{user_discount:99}));
  await assertFails(setDoc(doc(db,'mteam/new_member'),{commissionPercentage:100}));
 }
 await assertSucceeds(getDoc(doc(user(),'mlmcomp/company_a')));
 await assertSucceeds(getDoc(doc(marketing(),'mlmcomp/company_a')));
});
test('existing profile updates stay usable while company/mobile/UID swaps are rejected',async()=>{
 const ref=doc(user(),'mlmprofiles/profile_a');
 await assertSucceeds(updateDoc(ref,{fullName:'New Name',designation:'Leader',logoURLs:[],profileImageURLs:[],topuplineURLs:[],socials:{},companyId:'company_a',companyName:'Company A',updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(ref,{companyId:'company_b'}));await assertFails(updateDoc(ref,{mobile:'8888888888'}));await assertFails(updateDoc(ref,{uid:OTHER}));
 await assertFails(getDoc(doc(user(),'mlmprofiles/profile_b')));
 await assertSucceeds(getDoc(doc(editor(),'mlmprofiles/profile_a')));
 await assertSucceeds(setDoc(doc(user(),'mlmprofiles/new_profile'),{mobile:'9999999999',fullName:'New profile',companyId:'company_a'}));
});
test('unrelated template CRUD and app template reads preserve current permissions',async()=>{
 await assertSucceeds(getDoc(doc(user(),'mlmtemplate/template_a')));
 await assertSucceeds(updateDoc(doc(editor(),'mlmtemplate/template_a'),{name:'Updated template'}));
 await assertFails(updateDoc(doc(user(),'mlmtemplate/template_a'),{name:'Forged'}));
});
test('unrelated Expense and Popup Master Admin access is preserved',async()=>{
 const db=master();await assertSucceeds(getDoc(doc(db,'expense/expense')));await assertFails(getDoc(doc(editor(),'expense/expense')));
 await assertSucceeds(updateDoc(doc(db,'expense/expense'),{revision:2,updatedAt:serverTimestamp()}));
 await assertSucceeds(updateDoc(doc(db,'popup/popup'),{revision:2,updatedAt:serverTimestamp()}));
});
test('unrelated Task Management and reports keep their original role checks',async()=>{
 await assertSucceeds(getDoc(doc(editor(),'Taskm/task_a')));
 await assertSucceeds(updateDoc(doc(editor(),'Taskm/task_a'),{status:'Working'}));
 const leads=context('admin_leads',{panel:'admin',role:'Admin',actorType:'staff',tabs:['leads']});
 await assertSucceeds(getDoc(doc(leads,'reportingUser/report_a')));
 await assertFails(getDoc(doc(user(),'reportingUser/report_a')));
});
test('unknown collections and cross-user panel sessions stay private',async()=>{
 for(const db of [user(),master(),env.unauthenticatedContext().firestore()])await assertFails(setDoc(doc(db,'unclassified/forged'),{allow:true}));
 await assertSucceeds(getDoc(doc(master(),'_panelSessions/admin_master')));
 await assertFails(getDoc(doc(master(),'_panelSessions/admin_editor')));
});
test('financial panel reads reject revoked and expired admin sessions',async()=>{
 for(const uid of ['revoked_admin','expired_admin']){
  const db=context(uid,{panel:'admin',role:'Master Admin',actorType:'owner',tabs:[]});
  await assertFails(getDoc(doc(db,'subscription/sub_a')));await assertFails(getDoc(doc(db,'users/user_a')));await assertFails(getDoc(doc(db,'mlmcomp/company_a')));
 }
});
