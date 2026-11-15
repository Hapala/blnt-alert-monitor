import test from 'node:test';
import assert from 'node:assert/strict';
import {exactPrice,validatePrice,OracleCollector} from '../oracle-collector.mjs';
import {PublicRpc,PUBLIC_PROVIDERS,selectProvider} from '../public-rpc.mjs';
import {compareWebsite,applyCrossCheck} from '../cross-check.mjs';
import {displayedRounding} from '../collector.mjs';
import {reachesThreshold,openStore,processSnapshot} from '../engine.mjs';
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(new URL('../config.json',import.meta.url),'utf8'));
test('exact prices preserve all oracle digits and validate source timestamps',()=>{
  assert.equal(exactPrice(634463536131n,7),'63446.3536131');
  assert.equal(exactPrice(2289n,7),'0.0002289');
  for(const raw of [null,{price:0n,timestamp:1000n},{price:1n,timestamp:1n},{price:1n,timestamp:2000n}])assert.throws(()=>validatePrice(raw,7,1000,900));
  assert.equal(validatePrice({price:10000000n,timestamp:900n},7,1000,900).priceExact,'1.0000000');
});
test('public RPC rejects local endpoints and transaction submission before network access',async()=>{
  assert.throws(()=>new PublicRpc('http://127.0.0.1:8000/'));
  assert.throws(()=>new PublicRpc('https://evil.test'));
  const rpc=new PublicRpc(PUBLIC_PROVIDERS[0],async()=>assert.fail('No network request allowed'));
  await assert.rejects(()=>rpc.call('sendTransaction'),/denied/);
  await assert.rejects(()=>rpc.getter('contract','transfer'),/denied/);
});
test('provider selection falls back before collection and rejects ledger disagreement',async()=>{
  const factory=url=>({url,health:async()=>{if(url===PUBLIC_PROVIDERS[0])throw Error('down');return {ledger:100,ledgerTime:1000,httpTime:1002};}});
  assert.equal((await selectProvider(PUBLIC_PROVIDERS,factory)).rpc.url,PUBLIC_PROVIDERS[1]);
  await assert.rejects(()=>selectProvider(PUBLIC_PROVIDERS,url=>({url,health:async()=>({ledger:url===PUBLIC_PROVIDERS[0]?100:120,ledgerTime:1000})})),/disagree/);
});
test('threshold crossing uses integer arithmetic beyond Number precision',()=>{
  const baseline='100000000000000000000';
  assert.equal(reachesThreshold('104999999999999999999',baseline,5,'up'),false);
  assert.equal(reachesThreshold('105000000000000000000',baseline,5,'up'),true);
  assert.equal(reachesThreshold('95000000000000000000',baseline,5,'down'),true);
});
test('website cross-check accounts for abbreviated display rounding and preserves quote',()=>{
  const primary={observedAt:1000,markets:[{id:'p'}],observations:[{pool:'p',asset:'a',price:63413,priceExact:'63413.0000000',quote:'USDC'}]};
  const website={observedAt:1001,markets:[{id:'p'}],issues:[],observations:[{pool:'p',asset:'a',price:63410,displayedPrice:'$63.41k',roundingRadius:displayedRounding('$63.41k'),observedAt:1001}]};
  assert.equal(displayedRounding('$63.41k'),5);
  const result=compareWebsite(primary,website,{...config,crossCheckTolerancePercent:0.001});
  assert.equal(result.status,'match');assert.equal(result.checks[0].quote,'USDC');
  applyCrossCheck(primary,result,config);assert.equal(primary.observations[0].alertEligible,true);
  website.observations[0].price=60000;
  const mismatch=compareWebsite(primary,website,config);
  assert.equal(mismatch.checks[0].status,'mismatch');
  applyCrossCheck(primary,mismatch,config);assert.equal(primary.observations[0].alertEligible,false);
  primary.observedAt=5000;applyCrossCheck(primary,result,config);assert.equal(primary.observations[0].alertEligible,false);
});
test('oracle collector rejects changed identities and never substitutes website prices',async()=>{
  const registry={pools:[{id:'p',oracle:'o',wasmHash:'expected',oracleWasmHash:'expected'}],symbols:{}};
  const rpc={url:PUBLIC_PROVIDERS[0],instance:async()=>({hash:'wrong',storage:{}}),health:async()=>({ledger:100,ledgerTime:1000})};
  const collector=new OracleCollector(registry,async()=>({rpc,ledger:100,ledgerTime:1000,reference:{}}));
  const result=await collector.collect(config);
  assert.equal(result.observations.length,0);assert.match(result.issues[0].reason,/identity/);
});
test('missing cross-check suppresses price alerts while retaining oracle history',()=>{
  const db=openStore(':memory:');
  for(let t=10000;t<=13600;t+=300)processSnapshot(db,{source:'oracle',observedAt:t,markets:[],issues:[],observations:[{key:'oracle',timestamp:t,price:t===13600?110:100,priceRaw:t===13600?'110':'100',quote:'USDC',alertEligible:false}]},config);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM samples').get().n,13);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE id LIKE '%:alert:%'").get().n,0);db.close();
});
