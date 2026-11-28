"use strict";
const { randomUUID } = require('node:crypto');
const validEmail = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
function createVideoMailWorker({db, panelRef, root, emailSender, emailPassword, createTransport, now = Date.now}) {
  async function deliver(ref) {
    const lease = randomUUID();
    const job = await db.runTransaction(async tx => {
      const row = (await tx.get(ref)).data();
      if (!row || row.sentAt || row.failedAt || !Number.isFinite(row.nextAttemptAt) || row.nextAttemptAt > now()) return null;
      if ((row.attempts || 0) >= 10 || now() - row.created > 86400000) {
        tx.update(ref, { nextAttemptAt: 8640000000000000, failedAt: now(), lease: null });
        return null;
      }
      tx.update(ref, { lease, nextAttemptAt: now()+180000, attempts: (row.attempts || 0)+1 });
      return row;
    });
    if (!job) return;
    try {
      const account = (await panelRef().get()).data();
      const sender = emailSender.value(), password = emailPassword.value();
      if (!account?.active || !validEmail(account.email) || !validEmail(sender) || !password) throw Error('MAIL_OR_PANEL_NOT_CONFIGURED');
      const transport = (createTransport || require('nodemailer').createTransport)({host:'smtp.gmail.com',port:465,secure:true,auth:{user:sender,pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000});
      const mode = ref.parent.parent.id;
      await transport.sendMail({from:sender,to:account.email,subject:`${mode==='test'?'[TEST] ':''}MLMLive: New video editing request`,text:`A new video editing request has been submitted.\n\nRequest ID: ${job.id}\nCategory: ${job.category}\n\nOpen the Video Editing Panel to view the request and begin editing.\nhttps://mlm-admin-smoky.vercel.app/video-team\n\nMLMLive`,messageId:`<${mode}.${job.id}@mlmlive.in>`});
      await db.runTransaction(async tx=>{const live=(await tx.get(ref)).data();if(live?.lease===lease)tx.set(ref,{id:job.id,created:job.created,sentAt:now(),attempts:(job.attempts||0)+1});});
    } catch (e) {
      console.error('Video notification deferred', {code:e.code || e.name});
      await db.runTransaction(async tx=>{const live=(await tx.get(ref)).data();if(live?.lease===lease)tx.update(ref,{nextAttemptAt:now()+Math.min(3600000,60000*2**Math.min(job.attempts||0,6)),lease:null});});
    }
  }
  async function retry() {
    for (const mode of ['live','test']) {
      const due = await root(mode).collection('newRequestMail').where('nextAttemptAt','<=',now()).orderBy('nextAttemptAt').limit(10).get();
      // Bounded batches and low concurrency to protect the existing mail account.
      for(let i=0;i<due.docs.length;i+=2) await Promise.allSettled(due.docs.slice(i,i+2).map(doc=>deliver(doc.ref)));
    }
  }
  return {deliver,retry};
}
module.exports={createVideoMailWorker};
