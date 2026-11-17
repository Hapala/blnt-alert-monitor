import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,symlinkSync,rmSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openStore,setState,enqueue,dailyStatusMessage} from '../engine.mjs';
import {initSubscriptions,saveSubscriber,getSubscriber,processSubscriber} from '../subscriptions.mjs';
import {applyCommand} from '../subscription-commands.mjs';
import {processBorrowing} from '../borrow-alerts.mjs';
import {subscriptionTick} from '../dm-runtime.mjs';
import {DiscordApi,verifyCommandOrigin} from '../dm-api.mjs';
import {discordPayloads,privateReply} from '../discord-format.mjs';
import {CommandGate} from '../command-gate.mjs';
import {stageRelease} from '../stage-release.mjs';
import {allowedBrowserUrl,publicAddress} from '../browser-network.mjs';
import {healthFailures} from '../health.mjs';
import {forgetSubscriber,prunePersonal} from '../retention.mjs';
const registry=JSON.parse(readFileSync(new URL('../markets.json',import.meta.url))),P=registry.pools[0].id,Q=registry.pools[1].id;
const config={...JSON.parse(readFileSync(new URL('../config.json',import.meta.url))),mode:'live',digestTimezone:'UTC'};
const now=Date.parse('2026-11-16T12:00:00Z')/1000,id='111111111111111111',wallet='GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';
const discovery={wallet,checkedAt:now,pools:{[P]:{associated:true,stale:false},[Q]:{associated:false,stale:false}}};
const snapshot={source:'oracle',observedAt:now,observations:[{pool:P,poolName:'Fixed V3',asset:'a',symbol:'TEST',key:'a',price:1,priceExact:'1',quote:'USD',timestamp:now,alertEligible:true}],markets:[{id:P,name:'Fixed V3',reserves:['a']}],issues:[]};
const setup=()=>{const db=openStore(':memory:');initSubscriptions(db);saveSubscriber(db,id,wallet,now);setState(db,`discovery:${id}`,discovery);return db;};
const report={wallet,checkedAt:now,sourceObservedAt:now,pools:{[P]:{stale:false,name:'Fixed V3',quote:'USD',capacity:{ready:true,relevant:true,remaining:'100000000',limit:'1000000000',quoteDecimals:7,amountRemaining:'10',percentRemaining:'10'},rates:[]}}};

test('unrelated mutes preserve pending digests and risk warnings, selection rebuilds only unsent digests',()=>{
 const db=setup();applyCommand(db,id,'capacity',{pool:P,percent:20},registry,now);
 processBorrowing(db,getSubscriber(db,id),report,[P],config);processSubscriber(db,getSubscriber(db,id),discovery,snapshot,config,registry);
 applyCommand(db,id,'mute',{category:'price'},registry,now);
 assert.equal(db.prepare("SELECT status FROM outbox WHERE category='digest'").get().status,'pending');
 assert.equal(db.prepare("SELECT status FROM outbox WHERE category='capacity'").get().status,'pending');
 applyCommand(db,id,'mute',{category:'digest'},registry,now);
 assert.equal(db.prepare("SELECT status FROM outbox WHERE category='capacity'").get().status,'pending');
 applyCommand(db,id,'unmute',{category:'digest'},registry,now);processSubscriber(db,getSubscriber(db,id),discovery,{...snapshot,observedAt:now+60},config,registry);
 assert.equal(db.prepare("SELECT status FROM outbox WHERE category='digest'").get().status,'pending');
 db.prepare("UPDATE outbox SET status='sent' WHERE category='digest'").run();
 processSubscriber(db,getSubscriber(db,id),discovery,{...snapshot,observedAt:now+120},config,registry);
 assert.equal(db.prepare("SELECT status FROM outbox WHERE category='digest'").get().status,'sent');db.close();
});
test('cancelled and expired unsent breaches re-arm while accepted or uncertain sends never replay',()=>{
 for(const status of ['suppressed','expired','sent','uncertain']){
  const db=setup();applyCommand(db,id,'capacity',{pool:P,percent:20},registry,now);processBorrowing(db,getSubscriber(db,id),report,[P],config);
  db.prepare("UPDATE outbox SET status=? WHERE category='capacity'").run(status);
  processBorrowing(db,getSubscriber(db,id),{...report,checkedAt:now+60},[P],config);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE category='capacity' AND status='pending'").get().n,['suppressed','expired'].includes(status)?1:0);db.close();
 }
});
test('later recipients cannot receive stale data and busy cycles rotate fairly',async()=>{
 const db=setup(),other='222222222222222222';saveSubscriber(db,other,wallet,now);setState(db,`discovery:${other}`,discovery);let ms=0,sends=0;
 const api={send:async()=>{sends++;ms+=1000000;return {messageId:'m',channelId:'d'};}};
 await subscriptionTick(db,api,snapshot,config,registry,undefined,async()=>({ledgerTime:now}),undefined,()=>ms);
 assert.equal(sends,1);assert.equal(db.prepare("SELECT value FROM state WHERE key='dm-cycle-cursor'").get().value,JSON.stringify(id));db.close();
});
test('confirmed membership removal stops delivery but transient errors preserve subscription consent',async()=>{
 for(const status of [404,503]){const db=setup();let sent=0;
  await subscriptionTick(db,{verifyMembership:async()=>{throw {status};},send:async()=>{sent++;}},snapshot,{...config,guildId:'333333333333333333'},registry,undefined,async()=>({ledgerTime:now}));
  assert.equal(sent,0);assert.equal(getSubscriber(db,id).enabled,status===404?0:1);db.close();
 }
 await verifyCommandOrigin({request:async()=>{throw {status:404};}},'333333333333333333',id,null,'unsubscribe');
});
test('command gates bound concurrent work, preserve per-user exclusion and enforce cooldowns',()=>{
 let now=0;const gate=new CommandGate({clock:()=>now,maxConcurrent:1}),release=gate.enter(id,'borrowing');
 assert.throws(()=>gate.enter(id,'status'),/previous command/);assert.throws(()=>gate.enter('other','borrowing'),/busy/);release();
 assert.throws(()=>gate.enter(id,'borrowing'),/60 seconds/);now=60001;gate.enter(id,'borrowing')();
});
test('payload pagination respects all Discord budgets and keeps command followups ephemeral',async()=>{
 const large={...snapshot,observations:Array.from({length:20},(_,i)=>({...snapshot.observations[0],symbol:'UNKNOWN_CONTRACT_'+i})),markets:registry.pools.map(p=>({id:p.id,name:p.name})),borrowRates:{checkedAt:now,pools:registry.pools.map(p=>({id:p.id,available:true,rates:Array.from({length:50},(_,i)=>({symbol:'UNKNOWN_CONTRACT_'+i,aprPercent:'123456.1234567'}))}))}};
 const parts=discordPayloads(dailyStatusMessage(large,config));assert.ok(parts.length>1);
 for(const p of parts){assert.deepEqual(p.allowed_mentions,{parse:[]});const e=p.embeds[0];assert.ok(e.fields.length<=25);assert.ok(e.fields.every(f=>f.value.length<=1024));assert.ok((e.title?.length??0)+(e.description?.length??0)+(e.footer?.text.length??0)+e.fields.reduce((n,f)=>n+f.name.length+f.value.length,0)<=6000);}
 const replies=[];await privateReply({editReply:async p=>replies.push(p),followUp:async p=>replies.push(p)},'x'.repeat(5000));assert.equal(replies.length,3);assert.ok(replies.every(p=>p.content.length<=2000));assert.ok(replies.slice(1).every(p=>p.flags===64));
});
test('partial multi-message delivery is uncertain, including a later rate-limit rejection',async()=>{
 let posts=0;const api=new DiscordApi('fake',async(_url,options)=>{
  const body=JSON.parse(options.body??'{}');if(body.recipient_id)return {ok:true,json:async()=>({id:'d',type:1,recipients:[{id}]})};
  posts++;return posts===1?{ok:true,json:async()=>({id:'m',channel_id:'d'})}:{ok:false,status:429,json:async()=>({retry_after:5})};
 });
 await assert.rejects(api.send(id,{content:'x'.repeat(4000)}),error=>error.status===429&&error.uncertain===true);
});
test('browser policy rejects private addresses, unapproved origins, redirects and DNS-to-private results',async()=>{
 for(const address of ['127.0.0.2','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','::1','fc00::1','::ffff:127.0.0.1'])assert.equal(publicAddress(address),false);
 const resolver=async()=>[{address:'1.1.1.1'}];assert.equal(await allowedBrowserUrl('https://blnt.trade/asset/',resolver),true);
 for(const url of ['file:///etc/passwd','http://blnt.trade','https://localhost','https://internal.example','https://blnt.trade:444'])assert.equal(await allowedBrowserUrl(url,resolver),false);
 assert.equal(await allowedBrowserUrl('https://blnt.trade',async()=>[{address:'127.0.0.2'}]),false);
});
test('health verifier rejects stopped/stale workers and historical-receipt false positives',()=>{
 const healthy={shared:{ready:true,observedAt:now},personal:{active:true,mode:'live',botId:'bot',failures:0,heartbeatAt:now,sourceObservedAt:now},subscriber:{enabled:1,wallet},discovery,ledgerTime:now,wallTime:now,botId:'bot',commands:[{name:'blnt-alerts'}]};
 assert.deepEqual(healthFailures(healthy),[]);
 for(const patch of [{active:false},{heartbeatAt:now-181},{failures:undefined},{mode:'dry-run'}])assert.ok(healthFailures({...healthy,personal:{...healthy.personal,...patch}}).length);
});
test('clean staged release resolves both executable dependency graphs without reading credentials',()=>{
 const parent=mkdtempSync(join(tmpdir(),'blnt-install-test-')),stage=join(parent,'release'),source=fileURLToPath(new URL('../',import.meta.url));
 try{stageRelease(stage,source);assert.ok(existsSync(join(stage,'borrow-collector.mjs')));assert.ok(!existsSync(join(stage,'secrets')));symlinkSync(join(source,'node_modules'),join(stage,'node_modules'),'dir');
  for(const entry of ['cli.mjs','dm-worker.mjs']){const result=spawnSync(process.execPath,[entry,'--check-install'],{cwd:stage,encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
 }finally{rmSync(parent,{recursive:true});}
});
test('deployment failure injection restores both workers without touching real services',()=>{
 const result=spawnSync('python3',[fileURLToPath(new URL('./deployment_test.py',import.meta.url))],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
});
test('explicit deletion affects only the stopped caller and pruning removes orphan receipts',()=>{
 const db=setup(),other='222222222222222222';saveSubscriber(db,other,wallet,now);
 assert.throws(()=>forgetSubscriber(db,id,'DELETE'),/unsubscribe/);
 db.prepare('INSERT INTO dm_receipts(outboxId,messageId,channelId) VALUES (?,?,?)').run('orphan','m','d');prunePersonal(db);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dm_receipts').get().n,0);
 applyCommand(db,id,'unsubscribe',{},registry,now);assert.throws(()=>forgetSubscriber(db,id,'no'),/DELETE/);
 forgetSubscriber(db,id,'DELETE');assert.equal(getSubscriber(db,id),null);assert.equal(getSubscriber(db,other).enabled,1);db.close();
});
test('operator inspection works with runtime data separate from immutable source registry',()=>{
 const runtime=mkdtempSync(join(tmpdir(),'blnt-inspection-test-'));mkdirSync(join(runtime,'data'));
 try{const db=openStore(join(runtime,'data/monitor.sqlite'));initSubscriptions(db);saveSubscriber(db,id,wallet,now);setState(db,`discovery:${id}`,discovery);db.close();
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../inspect-subscriber.mjs',import.meta.url)),id],{env:{...process.env,BLNT_MONITOR_HOME:runtime},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.ok(JSON.parse(result.stdout).pools.some(p=>p.pool==='Fixed V3'));assert.ok(!existsSync(join(runtime,'markets.json')));
 }finally{rmSync(runtime,{recursive:true});}
});
