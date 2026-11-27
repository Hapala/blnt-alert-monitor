import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,enqueue,message,processSnapshot} from '../engine.mjs';
import {severityLevel} from '../severity.mjs';
import {deliver} from '../webhook.mjs';
import {deliverDms} from '../dm-runtime.mjs';
import {initSubscriptions,saveSubscriber,getSubscriber} from '../subscriptions.mjs';
const url='https://discord.com/api/webhooks/123456/test_token',now=1800000000;
test('a silently recorded small price move still escalates once to a delivered large move',async()=>{
 const db=openStore(':memory:'),config={...JSON.parse(readFileSync(new URL('../config.json',import.meta.url))),mode:'live',trial:false};
 const feed=(t,price)=>processSnapshot(db,{observedAt:t,markets:[],observations:[{key:'p:a',pool:'p',poolName:'Pool',asset:'a',symbol:'TEST',quote:'USD',price,timestamp:t,alertEligible:true}]},config);
 for(let t=now-3600;t<now;t+=60)feed(t,100);
 feed(now,103);let sent=0;const send=async()=>{sent++;return {ok:true};};await deliver(db,url,now,send);assert.equal(sent,0);
 feed(now+300,106);await deliver(db,url,now+300,send);assert.equal(sent,1);
 const rows=db.prepare('SELECT severity,status FROM outbox ORDER BY created').all();
 assert.deepEqual(rows.map(r=>[r.severity,r.status]),[[3,'recorded'],[2,'sent']]);db.close();
});
test('shared delivery posts only severity 1/2 and records advisory/informational without retry or replay',async()=>{
 const db=openStore(':memory:');
 for(const severity of [1,2,3,4])enqueue(db,`s${severity}`,now,message('test','test'),'live',{severity});
 const sent=[];await deliver(db,url,now,async(_u,opt)=>{sent.push(JSON.parse(opt.body));return {ok:true};});
 assert.equal(sent.length,2);assert.match(sent[0].embeds[0].footer.text,/Sev 1/);
 for(const id of ['s3','s4']){const row=db.prepare('SELECT * FROM outbox WHERE id=?').get(id);assert.equal(row.status,'recorded');assert.equal(row.attempts,0);}
 await deliver(db,url,now+60,async()=>{throw Error('Must not replay');});
 assert.equal(db.prepare("SELECT COUNT(*) n FROM outbox WHERE status='uncertain'").get().n,0);db.close();
});
test('severity does not filter personal DMs, mutate payloads or change subscription settings',async()=>{
 const db=openStore(':memory:');initSubscriptions(db);const id='111111111111111111';
 saveSubscriber(db,id,'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H',now);
 const before=getSubscriber(db,id),payload=message('Personal','unchanged');
 enqueue(db,'dm',now,payload,'live',{audience:id,category:'subscription_status',severity:4});
 let sent=0;await deliverDms(db,{send:async(_id,p)=>{sent++;assert.deepEqual(p,payload);return {messageId:'m',channelId:'d'};}},id,now,{pools:[]});
 assert.equal(sent,1);assert.deepEqual(getSubscriber(db,id),before);assert.equal(payload.embeds[0].footer,undefined);
 for(const value of [0,5,1.5,'2',null])assert.throws(()=>severityLevel(value));db.close();
});
test('legacy queue migration keeps existing deliveries at severity 2',()=>{
 const dir=mkdtempSync(join(tmpdir(),'blnt-severity-')),path=join(dir,'db.sqlite');
 try{const old=new DatabaseSync(path);old.exec("CREATE TABLE outbox(id TEXT PRIMARY KEY,created INTEGER,status TEXT,payload TEXT,attempts INTEGER DEFAULT 0,next INTEGER DEFAULT 0); INSERT INTO outbox(id,created,status,payload) VALUES ('old',1,'pending','{}')");old.close();
 const db=openStore(path);assert.equal(db.prepare("SELECT severity FROM outbox WHERE id='old'").get().severity,2);db.close();
 }finally{rmSync(dir,{recursive:true});}
});
