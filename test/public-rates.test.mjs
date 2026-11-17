import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectPublicRates} from '../borrow-collector.mjs';
import {dailyStatusMessage,dailyDigestSlot} from '../engine.mjs';
import {borrowingStatus} from '../borrow-alerts.mjs';
const registry=JSON.parse(readFileSync(new URL('../markets.json',import.meta.url))),pool=registry.pools[0],asset=Object.keys(registry.symbols)[0],now=1800000000;
const config=JSON.parse(readFileSync(new URL('../config.json',import.meta.url)));
function fixture(){
 const reserve={asset,scalar:10000000n,config:{index:0,decimals:7,c_factor:7500000,l_factor:7500000,util:7500000,r_base:100000,r_one:500000,r_two:5000000,r_three:15000000,enabled:true},data:{b_rate:1000000000000n,d_rate:1000000000000n,b_supply:1000000000n,d_supply:750000000n,ir_mod:10000000n,last_time:BigInt(now)}};
 const rpc={url:'mock',instance:async()=>({hash:pool.wasmHash,storage:{Config:{oracle:pool.oracle}}}),data:async()=>[asset],getter:async(_id,method)=>{assert.equal(method,'get_reserve','Public rates must never query wallet positions');return reserve;},health:async()=>({ledger:10,ledgerTime:now})};
 return {reserve,rpc,collect:()=>collectPublicRates({...registry,pools:[pool]},config,async()=>({rpc,ledger:10,ledgerTime:now}))};
}
test('public APR collection uses reserve-only getters and rejects stale, changed and incomplete pool data',async()=>{
 const f=fixture();let result=await f.collect();assert.equal(result.pools[0].rates[0].aprPercent,'6');assert.equal(result.pools[0].available,true);assert.equal(result.wallet,undefined);
 f.reserve.config.enabled=false;result=await f.collect();assert.deepEqual(result.pools[0].rates,[]);assert.equal(result.pools[0].disabledReserves,1);
 f.reserve.data.last_time=BigInt(now-1000);assert.equal((await f.collect()).pools[0].available,false);
 f.reserve.data.last_time=BigInt(now);f.reserve.asset=registry.pools[0].id;assert.equal((await f.collect()).pools[0].available,false);
 f.rpc.instance=async()=>({hash:'changed',storage:{}});assert.equal((await f.collect()).pools[0].available,false);
});
test('daily APR fields respect selected pools, disclose missing rates and never turn missing data into zero',()=>{
 const other=registry.pools[1];const snapshot={source:'oracle',observedAt:now,markets:[{id:pool.id,name:pool.name}],issues:[],observations:[],borrowRates:{checkedAt:now,pools:[{id:pool.id,available:true,rates:[{symbol:'TEST',aprPercent:'12.3456789'}]},{id:other.id,available:true,rates:[{symbol:'UNSELECTED',aprPercent:'9'}]}]}};
 let payload=dailyStatusMessage(snapshot,config);assert.match(JSON.stringify(payload),/12.3456789% APR/);assert.doesNotMatch(JSON.stringify(payload),/UNSELECTED/);assert.match(payload.embeds[0].description,/not APY/);
 snapshot.borrowRates.checkedAt=now-181;payload=dailyStatusMessage(snapshot,config);assert.match(JSON.stringify(payload),/Unavailable/);assert.doesNotMatch(JSON.stringify(payload),/12.3456789|0% APR/);
 const observations=[{pool:pool.id,poolName:pool.name,symbol:'TEST',priceExact:'1',quote:'USD'}];
 const before={...snapshot,observations,observedAt:Date.parse('2026-11-16T08:59:00Z')/1000},after={...before,observedAt:Date.parse('2026-11-16T09:00:00Z')/1000},schedule={...config,sharedDigestEnabled:true,digestTimezone:'UTC'};
 assert.equal(dailyDigestSlot(before,schedule).due,false);assert.equal(dailyDigestSlot(after,schedule).due,true);assert.match(dailyDigestSlot(after,schedule).key,/2026-11-16$/);
});
test('shared daily report is disabled and pending shared digests are suppressed without changing personal delivery',async()=>{
 const {openStore,processSnapshot,enqueue,message}=await import('../engine.mjs');
 const db=openStore(':memory:');enqueue(db,'shared-digest',now,message('old report','queued'),'live',{audience:'shared',category:'digest'});
 enqueue(db,'personal-digest',now,message('personal','queued'),'live',{audience:'synthetic',category:'digest'});
 const snapshot={observedAt:now,source:'oracle',observations:[{symbol:'TEST',pool:pool.id,poolName:pool.name,price:1,quote:'USD',key:'test',timestamp:now}],markets:[],issues:[]};
 processSnapshot(db,snapshot,{...config,mode:'live'});
 assert.equal(dailyDigestSlot(snapshot,config).due,false);
 assert.equal(db.prepare("SELECT status FROM outbox WHERE id='shared-digest'").get().status,'suppressed');
 assert.equal(db.prepare("SELECT status FROM outbox WHERE id='personal-digest'").get().status,'pending');
 assert.equal(dailyDigestSlot(snapshot,{...config,audienceId:'synthetic',digestHour:0}).due,true);db.close();
});
test('borrowing responses separate disabled thresholds from configured rules and effective mute controls',()=>{
 const sub={enabled:1,wallet:'synthetic',preferences:{riskRules:{},paused:false,snoozeUntil:0,mutedPools:[],mutedCategories:[]}};
 let text=borrowingStatus(sub,null,registry,now);assert.match(text,/Capacity percentage: Not enabled/);assert.match(text,/Capacity amount: Not enabled/);assert.match(text,/Borrow interest: Not enabled/);assert.doesNotMatch(text,/off.*\/.*off/);assert.ok(text.length<=2000);
 sub.preferences.riskRules[pool.id]={capacityPercent:'20',borrowApr:'10',rateScope:'borrowed'};sub.preferences.mutedPools=[pool.id];text=borrowingStatus(sub,null,registry,now);
 assert.match(text,/below \*\*20%/);assert.match(text,/above \*\*10% APR/);assert.match(text,/Pool muted/);assert.match(text,/only assets you currently borrow/);assert.ok(text.length<=2000);
});

test('compact digest pairs each price with its own pool/asset APR and retains rates without prices',()=>{
 const snapshot={observedAt:now,markets:[{id:pool.id,name:pool.name}],issues:[],crossCheck:{status:'match'},
 observations:[{pool:pool.id,poolName:pool.name,asset,symbol:'TEST',priceExact:'1.002',quote:'USD'}],
 borrowRates:{checkedAt:now,pools:[{id:pool.id,available:true,rates:[{asset,symbol:'TEST',aprPercent:'12'},{asset:'missing',symbol:'OTHER',aprPercent:'4'}]}]}};
 const embed=dailyStatusMessage(snapshot,config).embeds[0],text=JSON.stringify(embed);
 assert.match(text,/TEST\*\* 1.002 · \*\*12% APR/);assert.match(text,/OTHER\*\* price unavailable/);
 assert.doesNotMatch(text,/PRIVATE TRIAL|Data checks|not a wallet-specific/);assert.ok(embed.description.length<100);
 snapshot.borrowRates.checkedAt=now+16;
 assert.match(JSON.stringify(dailyStatusMessage(snapshot,config)),/APR unavailable/);
 assert.doesNotMatch(JSON.stringify(dailyStatusMessage(snapshot,config)),/12% APR/);
});
