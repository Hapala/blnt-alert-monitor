import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openStore,processSnapshot,enqueue,message} from '../engine.mjs';
import {deliver,validateWebhook,verifyWebhookTarget} from '../webhook.mjs';
import {parseDisplayedPrice,marketLink,WebsiteCollector} from '../collector.mjs';

const config={...JSON.parse(readFileSync(new URL('../config.json',import.meta.url),'utf8')),mode:'dry-run'};
const start=1800000000;
const assetId='CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA';
test('a failed website browser is closed and recreated on the next cross-check',async()=>{
  let starts=0,closes=0;
  const collector=new WebsiteCollector('mock',async()=>{starts++;return {isConnected:()=>true,newContext:async()=>{throw Error('browser unavailable');},close:async()=>{closes++;}};});
  await assert.rejects(collector.collect(config),/browser unavailable/);await assert.rejects(collector.collect(config),/browser unavailable/);
  assert.equal(starts,2);assert.equal(closes,2);
});
function observation(t,price=100) {
  return {key:'website:pool:asset',pool:'pool',poolName:'Pool',asset:'asset',symbol:'TEST',quote:'USD',
    price,timestamp:t,observedAt:t,sourceUrl:'https://blnt.trade/'};
}
function record(db,t,price,c=config) {
  processSnapshot(db,{observedAt:t,observations:[observation(t,price)],markets:[],issues:[]},c);
}
function warm(db,end=start+3600) {for(let t=start;t<end;t+=60) record(db,t,100);}
function alerts(db){return db.prepare("SELECT * FROM outbox WHERE id LIKE '%:alert:%'").all();}
test('requires a full continuous one-hour price window; dry-run only previews',()=>{
  const db=openStore(':memory:');record(db,start,100);record(db,start+60,110);assert.equal(alerts(db).length,0);
  warm(db);record(db,start+3600,106);assert.equal(alerts(db).length,1);assert.equal(alerts(db)[0].status,'preview');db.close();
});
test('gap suppresses alerts even with two valid endpoints',()=>{
  const db=openStore(':memory:');record(db,start,100);record(db,start+3600,106);assert.equal(alerts(db).length,0);db.close();
});
test('future or expired capture timestamps never enter alert history',()=>{
  const db=openStore(':memory:');
  processSnapshot(db,{observedAt:start,observations:[observation(start+3600),observation(start-3600)],markets:[],issues:[]},config);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM samples').get().n,0);db.close();
});
test('private trial labels real updates and queues only one explicitly marked format preview',()=>{
  const db=openStore(':memory:');
  const o={...observation(start),priceExact:'100.0000000',alertEligible:true};
  for(const t of [start,start+60])processSnapshot(db,{source:'oracle',observedAt:t,observations:[{...o,timestamp:t}],markets:[],issues:[],crossCheck:{status:'match'}},{...config,mode:'live',trial:true});
  const previews=db.prepare("SELECT payload FROM outbox WHERE id LIKE '%format-preview%'").all();
  assert.equal(previews.length,1);
  assert.match(JSON.parse(previews[0].payload).embeds[0].description,/no price-movement threshold/);
  assert.match(JSON.parse(previews[0].payload).embeds[0].title,/PRIVATE TRIAL/);db.close();
});
test('repeated crossings require re-arm and cooldown',()=>{
  const db=openStore(':memory:');warm(db);record(db,start+3600,106);record(db,start+3660,107);
  record(db,start+3720,101);record(db,start+3780,108);assert.equal(alerts(db).length,1);db.close();
});
test('dry-run state does not suppress future live alerts or promote previews',()=>{
  const db=openStore(':memory:');warm(db);record(db,start+3600,106);record(db,start+3660,107,{...config,mode:'live'});
  assert.deepEqual(alerts(db).map(x=>x.status),['preview','pending']);db.close();
});
test('website cross-check parser handles rounding and rejects invalid prices',()=>{
  assert.equal(parseDisplayedPrice('$0.1379358'),0.1379358);
  assert.equal(parseDisplayedPrice('$1,234.56'),1234.56);
  assert.equal(parseDisplayedPrice('$63.41k'),63410);
  for(const input of ['--','$0','NaN','$1.2z','$1,23.45','€1.00','$1 APY 5%','-$1']) assert.throws(()=>parseDisplayedPrice(input));
});
test('market identity uses same-origin contract IDs and rejects lookalike sites',()=>{
  const pool='CAUTPSQDAJEUV5XEU3EXFVYRGDJLEJGVTFJCFZCSPTDCREAMZ573VF4D';
  const path=`/supply/?poolId=${pool}&assetId=${assetId}`;
  assert.equal(marketLink(path,'supply').asset,assetId);
  assert.throws(()=>marketLink('https://evil.test'+path,'supply'));
  assert.throws(()=>marketLink('/supply/?poolId=XLM&assetId=USDC','supply'));
  assert.throws(()=>marketLink(path.replace('/supply/','/borrow/'),'supply'));
});
const webhook='https://discord.com/api/webhooks/123456/test_token';
test('destination verification rejects a webhook for a different channel',async()=>{
  const target={audience:'private',channelId:'123',guildId:'456',webhookName:'BLNT Alerts'};
  const metadata={type:1,id:'789',channel_id:'123',guild_id:'456',name:'BLNT Alerts'};
  const fetcher=async(_url,request)=>{assert.equal(request.method,'GET');return {ok:true,json:async()=>metadata};};
  assert.equal((await verifyWebhookTarget(webhook,target,fetcher)).channelId,'123');
  metadata.channel_id='999';await assert.rejects(()=>verifyWebhookTarget(webhook,target,fetcher),/mismatch/);
  await assert.rejects(()=>verifyWebhookTarget(webhook,{...target,audience:'public'},fetcher),/Private/);
});
test('destination verification never reveals credential-bearing network errors',async()=>{
  const target={audience:'private',channelId:'123',guildId:'456',webhookName:'BLNT Alerts'};
  await assert.rejects(()=>verifyWebhookTarget(webhook,target,async()=>{throw Error(webhook);}),error=>!error.message.includes('test_token'));
});
test('webhook is restricted to Discord HTTPS and disables mentions',()=>{
  for(const url of ['http://discord.com/api/webhooks/1/a','https://evil.test/api/webhooks/1/a',webhook+'?x=1'])assert.throws(()=>validateWebhook(url));
  assert.deepEqual(message('title','@everyone').allowed_mentions,{parse:[]});
});
test('previews never send; uncertain outcomes never auto-retry',async()=>{
  const db=openStore(':memory:');enqueue(db,'preview',start,message('a','b'),'dry-run');
  enqueue(db,'live',start,message('a','b'),'live');let calls=0;
  const fail=async()=>{calls++;throw Error('secret URL must not be logged');};
  await deliver(db,webhook,start,fail);await deliver(db,webhook,start+60,fail);
  assert.equal(calls,1);assert.equal(db.prepare("SELECT status FROM outbox WHERE id='live'").get().status,'uncertain');db.close();
});
test('rate limit stops whole batch, honors retry delay, and resumes',async()=>{
  const db=openStore(':memory:');for(const id of ['a','b'])enqueue(db,id,start,message('a','b'),'live');let calls=0;
  await deliver(db,webhook,start,async()=>{calls++;return {status:429,ok:false,json:async()=>({retry_after:120})};});
  assert.equal(calls,1);assert.equal(db.prepare("SELECT next FROM outbox WHERE id='a'").get().next,start+120);
  await deliver(db,webhook,start+120,async()=>({ok:true,status:200}));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status='sent'").get().n,2);db.close();
});
test('crash during delivery becomes uncertain; old pending messages expire',async()=>{
  const db=openStore(':memory:');enqueue(db,'a',start,message('a','b'),'live');enqueue(db,'b',start,message('a','b'),'live');
  db.prepare("UPDATE outbox SET status='sending' WHERE id='a'").run();
  await deliver(db,webhook,start+1000,async()=>{assert.fail('Must not send');});
  assert.equal(db.prepare("SELECT status FROM outbox WHERE id='a'").get().status,'uncertain');
  assert.equal(db.prepare("SELECT status FROM outbox WHERE id='b'").get().status,'expired');db.close();
});
