import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,enqueue,message,getState,setState} from '../engine.mjs';
import {initSubscriptions,saveSubscriber,getSubscriber,lendingExposure,backstopExposure,selectedPools,mergeDiscovery,suppressUnwanted,processSubscriber,discoverWallet,BACKSTOP,BACKSTOP_HASH} from '../subscriptions.mjs';
import {applyCommand} from '../subscription-commands.mjs';
import {deliverDms,subscriptionTick} from '../dm-runtime.mjs';
import {DiscordApi} from '../dm-api.mjs';
import {deliver} from '../webhook.mjs';
const registry=JSON.parse(readFileSync(new URL('../markets.json',import.meta.url)));
const config={...JSON.parse(readFileSync(new URL('../config.json',import.meta.url))),mode:'live'};
const A='111111111111111111',B='222222222222222222',wallet='GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';
const [P,Q]=registry.pools.map(p=>p.id),now=1800000000;
const setup=()=>{const db=openStore(':memory:');initSubscriptions(db);saveSubscriber(db,A,wallet,now);return db;};
const discovery={checkedAt:now,pools:{[P]:{associated:true,stale:false},[Q]:{associated:false,stale:false}}};
const queue=(db,id,audience=A,category='price',pool=P)=>enqueue(db,id,now,message('test','test'),'live',{audience,category,pool});
const state=(db,id)=>db.prepare('SELECT status FROM outbox WHERE id=?').get(id).status;

test('discovers supply, collateral, debt, backstop shares and queued withdrawals; rejects malformed balances',()=>{
  assert.deepEqual(lendingExposure({supply:{0:3n},collateral:new Map([[1,2n]]),liabilities:{2:1n}}),['supply','collateral','liabilities']);
  assert.deepEqual(lendingExposure({supply:{},collateral:{},liabilities:{}}),[]);
  assert.equal(backstopExposure({shares:0n,q4w:[{amount:1n}]}),true);
  assert.equal(backstopExposure({shares:1n,q4w:[]}),true);
  assert.equal(backstopExposure({shares:0n,q4w:[]}),false);
  assert.throws(()=>lendingExposure({supply:{0:1n,1:-1n},collateral:{},liabilities:{}}));
  assert.throws(()=>backstopExposure({shares:1n,q4w:[{amount:'1'}]}));
});
test('automatic pools, optional extras and mutes; stale associations fail closed and confirmed zero removes them',()=>{
  const db=setup();let sub=getSubscriber(db,A);
  assert.deepEqual(selectedPools(sub,discovery,now),[P]);
  applyCommand(db,A,'add-pool',{pool:Q},registry,now);sub=getSubscriber(db,A);
  assert.deepEqual(selectedPools(sub,discovery,now),[P,Q]);
  applyCommand(db,A,'mute',{pool:P},registry,now);sub=getSubscriber(db,A);
  assert.deepEqual(selectedPools(sub,discovery,now),[Q]);
  const stale=mergeDiscovery(discovery,{checkedAt:now,pools:{[P]:{stale:true},[Q]:{associated:false,stale:false}}});
  assert.equal(stale.pools[P].associated,true);
  assert.deepEqual(selectedPools({...sub,preferences:{...sub.preferences,mutedPools:[],extraPools:[]}},stale,now),[]);
  const cleared=mergeDiscovery(discovery,{checkedAt:now,pools:{[P]:{associated:false,stale:false}}});
  assert.equal(cleared.pools[P].associated,false);db.close();
});
test('commands change only the actor subscription and preserve preferences across restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'blnt-subs-')),path=join(dir,'db.sqlite');let db=openStore(path);initSubscriptions(db);
  applyCommand(db,A,'subscribe',{wallet},registry,now);applyCommand(db,B,'subscribe',{wallet},registry,now);
  applyCommand(db,A,'mute',{category:'price'},registry,now);
  assert.deepEqual(getSubscriber(db,B).preferences.mutedCategories,[]);
  assert.throws(()=>applyCommand(db,A,'add-pool',{pool:'unknown'},registry,now));
  assert.throws(()=>applyCommand(db,A,'subscribe',{wallet:'SSECRET'},registry,now));
  db.close();db=openStore(path);assert.deepEqual(getSubscriber(db,A).preferences.mutedCategories,['price']);db.close();rmSync(dir,{recursive:true});
});
test('mute, pause, snooze and unsubscribe cancel queued personal notifications',()=>{
  const db=setup();queue(db,'p');queue(db,'shared','shared');
  applyCommand(db,A,'mute',{category:'price'},registry,now);assert.equal(state(db,'p'),'suppressed');assert.equal(state(db,'shared'),'pending');
  applyCommand(db,A,'snooze',{minutes:10},registry,now);assert.deepEqual(selectedPools(getSubscriber(db,A),discovery,now+599),[]);
  applyCommand(db,A,'resume',{},registry,now);assert.deepEqual(selectedPools(getSubscriber(db,A),discovery,now),[P]);
  queue(db,'p2');applyCommand(db,A,'pause',{},registry,now);assert.equal(state(db,'p2'),'suppressed');
  applyCommand(db,A,'unsubscribe',{},registry,now);assert.equal(getSubscriber(db,A).enabled,0);assert.throws(()=>applyCommand(db,A,'resume',{},registry,now));db.close();
});
test('selection changes cancel multi-pool digests queued under an older selection',()=>{
  const db=setup(),sub=getSubscriber(db,A);suppressUnwanted(db,sub,[P,Q],now);queue(db,'digest',A,'digest',null);
  suppressUnwanted(db,sub,[P],now);assert.equal(state(db,'digest'),'suppressed');db.close();
});
test('subscriber messages contain only selected pools and never enter shared snapshot history',()=>{
  const db=setup(),observations=registry.pools.map(p=>({key:p.id,pool:p.id,poolName:p.name,asset:'asset',symbol:'TEST',quote:'USD',price:1,priceExact:'1',timestamp:now,observedAt:now,alertEligible:true}));
  processSubscriber(db,getSubscriber(db,A),discovery,{observedAt:now,source:'oracle',observations,markets:registry.pools.map(p=>({...p,reserves:[]})),issues:[]},config,registry);
  const rows=db.prepare('SELECT * FROM outbox').all();assert.ok(rows.length);
  assert.ok(rows.every(r=>r.audience===A));assert.ok(rows.every(r=>!r.payload.includes(registry.pools[1].name)));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,0);db.close();
});
test('shared webhook and DM workers cannot consume or recover each other’s messages',async()=>{
  const db=setup();saveSubscriber(db,B,wallet,now);setState(db,`discovery:${A}`,discovery);
  queue(db,'a');queue(db,'b',B);queue(db,'s','shared');queue(db,'b-sending',B);db.prepare("UPDATE outbox SET status='sending' WHERE id='b-sending'").run();
  const sent=[];await deliverDms(db,{send:async(id)=>{sent.push(id);return {messageId:'m',channelId:'d'};}},A,now,registry);
  assert.deepEqual(sent,[A]);assert.equal(state(db,'b'),'pending');assert.equal(state(db,'b-sending'),'sending');assert.equal(state(db,'s'),'pending');
  await deliver(db,'https://discord.com/api/webhooks/123456/test_token',now,async()=>({ok:true}));
  assert.equal(state(db,'s'),'sent');assert.equal(state(db,'b'),'pending');assert.equal(state(db,'b-sending'),'sending');db.close();
});
test('closed DMs block further attempts, rate limits retry with bounds, and uncertain sends never replay',async()=>{
  for(const [error,expected] of [[{code:50007,status:403},'blocked'],[{status:429,retryAfter:10},'pending'],[{uncertain:true},'uncertain']]) {
    const db=setup();setState(db,`discovery:${A}`,discovery);queue(db,'a');let calls=0;
    const api={send:async()=>{calls++;throw error;}};await deliverDms(db,api,A,now,registry);assert.equal(state(db,'a'),expected);
    await deliverDms(db,api,A,now+1,registry);assert.equal(calls,1);
    if(expected==='pending'){db.prepare("UPDATE outbox SET attempts=4,next=0 WHERE id='a'").run();await deliverDms(db,api,A,now+20,registry);assert.equal(state(db,'a'),'failed');}
    db.close();
  }
});
test('Discord transport rejects group/wrong-recipient channels and disables mentions in verified DMs',async()=>{
  const requests=[];let channel={id:'dm',type:1,recipients:[{id:A}]};
  const api=new DiscordApi('fake',async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>url.endsWith('/users/@me/channels')?channel:{id:'receipt',channel_id:'dm'}};});
  await api.send(A,message('test','test'));assert.equal(requests[1].body.username,undefined);assert.deepEqual(requests[1].body.allowed_mentions,{parse:[]});
  for(const invalid of [{...channel,type:3},{...channel,recipients:[{id:B}]}]){channel=invalid;await assert.rejects(api.send(A,message('test','test')),/recipient verification/);}
});
test('discovery verifies pinned identities and all lending/backstop getters; one failed pool remains stale',async()=>{
  const calls=[],rpc={url:'mock',health:async()=>({ledgerTime:now,ledger:5}),instance:async id=>{
    if(id===BACKSTOP)return {hash:BACKSTOP_HASH};
    const p=registry.pools.find(p=>p.id===id);return {hash:p.wasmHash,storage:{Config:{oracle:p.oracle},Backstop:BACKSTOP}};
  },getter:async(id,method,args)=>{
    calls.push({id,method,args});if(id===Q)throw Error('unavailable');
    return method==='get_positions'?{supply:{0:1n},collateral:{},liabilities:{}}:{shares:0n,q4w:[]};
  }};
  const result=await discoverWallet(wallet,registry,async()=>({rpc}));
  assert.equal(result.pools[P].associated,true);assert.equal(result.pools[Q].stale,true);
  assert.equal(calls.filter(c=>c.method==='user_balance').length,3);
  assert.equal(calls.find(c=>c.method==='get_positions').args.length,1);
  rpc.instance=async()=>({hash:'changed',storage:{}});
  const changed=await discoverWallet(wallet,registry,async()=>({rpc}));assert.ok(Object.values(changed.pools).every(p=>p.stale));
});
test('subscription cycle caches fresh discovery, isolates failures and rejects a stale primary snapshot',async()=>{
  const db=setup(),snapshot={observedAt:now,source:'oracle',observations:[],markets:[],issues:[]};let reads=0,sends=0;
  const discover=async()=>{reads++;return discovery;},clock=async()=>({ledgerTime:now}),api={send:async()=>{sends++;return {messageId:'m',channelId:'d'};}};
  const result=await subscriptionTick(db,api,snapshot,config,registry,discover,clock);assert.equal(result.enabled,1);assert.equal(result.failures,0);assert.ok(result.heartbeatAt>=now);
  await subscriptionTick(db,api,snapshot,config,registry,discover,clock);assert.equal(reads,1);assert.equal(sends,1);
  await assert.rejects(subscriptionTick(db,api,{...snapshot,observedAt:now-901},config,registry,discover,clock),/stale/);db.close();
});
test('pilot capacity rejects new enrolment without stopping existing subscribers',()=>{
  const db=setup();for(let i=1;i<20;i++)saveSubscriber(db,String(BigInt(A)+BigInt(i)),wallet,now);
  assert.throws(()=>saveSubscriber(db,B,wallet,now),/pilot is full/);
  saveSubscriber(db,A,wallet,now);assert.equal(getSubscriber(db,A).enabled,1);db.close();
});
