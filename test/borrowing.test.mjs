import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {capacity,borrowAprRaw,decimal,formatUnits} from '../borrow-math.mjs';
import {collectBorrowing} from '../borrow-collector.mjs';
import {processBorrowing} from '../borrow-alerts.mjs';
import {monitoringIssues} from '../health-alerts.mjs';
import {openStore,setState} from '../engine.mjs';
import {initSubscriptions,saveSubscriber,getSubscriber} from '../subscriptions.mjs';
import {applyCommand,commandDefinition} from '../subscription-commands.mjs';
import {subscriptionTick} from '../dm-runtime.mjs';
const registry=JSON.parse(readFileSync(new URL('../markets.json',import.meta.url))),P=registry.pools[0].id;
const config={...JSON.parse(readFileSync(new URL('../config.json',import.meta.url))),mode:'live'};
const id='111111111111111111',wallet='GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H',now=1800000000;
function reserve(index=0){return {asset:'a',scalar:10000000n,authorized:true,config:{index,decimals:7,c_factor:7500000,l_factor:7500000,util:7500000,r_base:100000,r_one:500000,r_two:5000000,r_three:15000000,enabled:true},data:{b_rate:1000000000000n,d_rate:1000000000000n,b_supply:1000000000n,d_supply:750000000n,ir_mod:10000000n,last_time:BigInt(now)}};}
const positions={supply:{},collateral:{0:1001234567n,2:250000n},liabilities:{0:15000000n,1:50987654321n}};
const setup=()=>{const db=openStore(':memory:');initSubscriptions(db);saveSubscriber(db,id,wallet,now);return db;};
const outbox=db=>db.prepare("SELECT * FROM outbox WHERE category IN ('capacity','borrow_rate')").all();
const snapshot={source:'oracle',observedAt:now,observations:[],markets:[],issues:[]};
function report(t=now,remaining='10',apr='1100000'){
  return {wallet,checkedAt:t,sourceObservedAt:t,pools:{[P]:{name:'Fixed V3',quote:'USD',stale:false,capacity:{ready:true,relevant:true,remaining:String(BigInt(remaining)*10000000n),limit:'1000000000',quoteDecimals:7,amountRemaining:remaining,percentRemaining:remaining},rates:[{asset:'a',symbol:'TEST',borrowed:true,aprRaw:apr,aprPercent:String(Number(apr)/100000)}]}}};
}

test('worker health exposes stale pools and incomplete configured checks, while muted or irrelevant rules stay quiet',async()=>{
 for(const kind of ['stale','missing','capacity','muted-capacity','rate-only','no-positions']){
  const db=setup();applyCommand(db,id,'capacity',{pool:P,percent:20},registry,now);
  if(kind==='muted-capacity')applyCommand(db,id,'mute',{category:'capacity'},registry,now);
  if(kind==='rate-only'){applyCommand(db,id,'capacity',{pool:P,clear:true},registry,now);applyCommand(db,id,'rate',{pool:P,apr:10},registry,now);}
  setState(db,`discovery:${id}`,{wallet,checkedAt:now,pools:{[P]:{associated:true,stale:false}}});
  const result=await subscriptionTick(db,{},snapshot,config,registry,undefined,async()=>({ledgerTime:now}),async()=>{
   const r=report();if(kind==='stale')r.pools[P]={stale:true};
   if(kind==='missing')delete r.pools[P];
   if(['capacity','muted-capacity','rate-only'].includes(kind))r.pools[P].capacity={ready:false};
   if(kind==='no-positions'){r.pools[P].capacity.relevant=false;r.pools[P].rates=[];}
   return r;
  },()=>0);
  const failed=['stale','missing','capacity'].includes(kind);assert.equal(result.failures>0,failed,kind);
  const issues=monitoringIssues({shared:{ready:true,observedAt:now},personal:{active:true,...result,sourceObservedAt:now},ratesEnabled:false,now});
  assert.equal(issues.includes('Personal alert checks'),failed,kind);db.close();
 }
});
test('capacity reproduces contract health-factor fixture with mixed token decimals and conservative rounding',()=>{
  const a=reserve(),b=reserve(1),c=reserve(2);
  b.scalar=1000000000n;b.config.decimals=9;b.config.c_factor=8500000;b.config.l_factor=8000000;b.data.b_rate=1100000000000n;b.data.d_rate=1150000000000n;
  c.scalar=1000000n;c.config.decimals=6;c.data.b_rate=1001100000000n;c.data.d_rate=1001200000000n;
  const prices={a:{priceRaw:'10000000',decimals:7,alertEligible:true},b:{priceRaw:'25000000',decimals:7,alertEligible:true},c:{priceRaw:'10000000000',decimals:7,alertEligible:true}};
  const result=capacity(positions,['a','b','c'],{a,b,c},prices,{status:0,min_collateral:10000000n,quoteDecimals:7});
  // Expected effective balances are from the pinned Rust health_factor fixture.
  assert.equal(result.effectiveCollateral,'2627985925');assert.equal(result.effectiveDebt,'1852368828');
  assert.equal(result.rawCollateral,'3503984567');assert.ok(BigInt(result.limit)<BigInt(result.effectiveCollateral));
  c.authorized=false;
  assert.equal(capacity(positions,['a','b','c'],{a,b,c},prices,{status:0,min_collateral:0n,quoteDecimals:7}).effectiveCollateral,'750925925');
});
test('APR matches the three-segment curve, boundaries and unmodified high-utilization surcharge',()=>{
  const r=reserve();for(const [debt,apr] of [[0n,'100000'],[750000000n,'600000'],[850000000n,'3100000'],[950000000n,'5600000'],[1000000000n,'20600000']]){r.data.d_supply=debt;assert.equal(borrowAprRaw(r).aprRaw,apr);}
  r.data.ir_mod=20000000n;assert.equal(borrowAprRaw(r).aprRaw,'26200000');
  r.data.b_supply=0n;assert.equal(borrowAprRaw(r).utilizationRaw,'10000000');
});
test('zero collateral and supply-only wallets avoid false low-capacity alarms; restrictions and missing prices fail safely',()=>{
  const empty={collateral:{},liabilities:{},supply:{0:1n}};
  assert.equal(capacity(empty,['a'],{}, {},{status:0,min_collateral:0n,quoteDecimals:7}).relevant,false);
  const p={collateral:{0:100000000n},liabilities:{}},r=reserve(),price={a:{priceRaw:'10000000',decimals:7,alertEligible:true}};
  assert.equal(capacity(p,['a'],{a:r},price,{status:2,min_collateral:0n,quoteDecimals:7}).remaining,'0');
  assert.throws(()=>capacity(p,['a'],{a:r},{},{status:0,min_collateral:0n,quoteDecimals:7}),/cross-check/);
  assert.throws(()=>capacity({...p,liabilities:{9:1n}},['a'],{a:r},price,{status:0,min_collateral:0n,quoteDecimals:7}),/index/);
});
test('threshold commands default off, persist independent pool rules, validate exact decimals and clear only the chosen rule',()=>{
  const db=setup();assert.deepEqual(getSubscriber(db,id).preferences.riskRules,{});
  applyCommand(db,id,'capacity',{pool:P,percent:20,amount:'100.0000001'},registry,now);
  applyCommand(db,id,'rate',{pool:P,apr:10},registry,now);let r=getSubscriber(db,id).preferences.riskRules[P];
  assert.equal(r.capacityAmount,'100.0000001');assert.equal(r.borrowApr,'10');assert.equal(r.rateScope,'borrowed');
  for(const args of [{percent:101},{amount:'1e3'},{amount:'0.00000001'},{percent:-1}])assert.throws(()=>applyCommand(db,id,'capacity',{pool:P,...args},registry,now));
  assert.throws(()=>applyCommand(db,id,'rate',{pool:P,apr:-1},registry,now));
  applyCommand(db,id,'capacity',{pool:P,clear:true},registry,now);r=getSubscriber(db,id).preferences.riskRules[P];assert.equal(r.capacityPercent,null);assert.equal(r.borrowApr,'10');
  applyCommand(db,id,'rate',{pool:P,clear:true},registry,now);assert.equal(getSubscriber(db,id).preferences.riskRules[P].borrowApr,null);
  assert.ok(commandDefinition(registry).options.some(v=>v.name==='capacity'));db.close();
});
test('percentage and amount thresholds trigger independently, strictly below capacity and strictly above APR',()=>{
  const db=setup();applyCommand(db,id,'capacity',{pool:P,percent:10,amount:'10'},registry,now);applyCommand(db,id,'rate',{pool:P,apr:10},registry,now);
  processBorrowing(db,getSubscriber(db,id),report(now,'10','1000000'),[P],config);assert.equal(outbox(db).length,0);
  processBorrowing(db,getSubscriber(db,id),report(now+1,'9','1000001'),[P],config);assert.equal(outbox(db).length,3);
  assert.ok(outbox(db).every(row=>row.audience===id&&row.pool===P));assert.ok(outbox(db).every(row=>!row.payload.includes(wallet)));db.close();
});
test('capacity and APR alerts deduplicate, cancel recovered pending alerts and require hysteresis plus cooldown',()=>{
  const db=setup();applyCommand(db,id,'capacity',{pool:P,percent:20},registry,now);
  processBorrowing(db,getSubscriber(db,id),report(),[P],config);processBorrowing(db,getSubscriber(db,id),report(now+60),[P],config);assert.equal(outbox(db).length,1);
  processBorrowing(db,getSubscriber(db,id),report(now+120,'23'),[P],config);assert.equal(outbox(db)[0].status,'suppressed');
  // The cancelled warning was never delivered, so a new breach is eligible.
  processBorrowing(db,getSubscriber(db,id),report(now+180),[P],config);assert.equal(outbox(db).length,2);
  processBorrowing(db,getSubscriber(db,id),report(now+3601),[P],config);assert.equal(outbox(db).length,2);db.close();
});
test('unconfigured, muted, paused, unselected, stale and wrong-wallet borrowing reports never send',()=>{
  const db=setup();processBorrowing(db,getSubscriber(db,id),report(),[P],config);assert.equal(outbox(db).length,0);
  applyCommand(db,id,'capacity',{pool:P,percent:20},registry,now);applyCommand(db,id,'mute',{category:'capacity'},registry,now);
  processBorrowing(db,getSubscriber(db,id),report(),[P],config);assert.equal(outbox(db).length,0);
  applyCommand(db,id,'unmute',{category:'capacity'},registry,now);const sub=getSubscriber(db,id);
  for(const [s,r,selected] of [[{...sub,enabled:0},report(),[P]],[{...sub,preferences:{...sub.preferences,paused:true}},report(),[P]],[sub,report(),[]],[sub,{...report(),wallet:'other'},[P]],[sub,{...report(),sourceObservedAt:now-181},[P]]])processBorrowing(db,s,r,selected,config);
  assert.equal(outbox(db).length,0);db.close();
});
test('rate scope follows current borrows by default and cancels queued rate alerts after repayment',()=>{
  const db=setup();applyCommand(db,id,'rate',{pool:P,apr:10},registry,now);const sub=getSubscriber(db,id),r=report();
  processBorrowing(db,sub,r,[P],config);assert.equal(outbox(db).length,1);
  r.pools[P].rates[0].borrowed=false;processBorrowing(db,sub,r,[P],config);assert.equal(outbox(db)[0].status,'suppressed');
  applyCommand(db,id,'rate',{pool:P,scope:'selected-pools'},registry,now);processBorrowing(db,getSubscriber(db,id),r,[P],config);assert.equal(outbox(db).length,2);db.close();
});
test('collector verifies bindings and simulates current reserves; rejects changes and separates rates from price failures',async()=>{
  const asset=Object.keys(registry.symbols)[0],pool=registry.pools[0],r=reserve();r.asset=asset;
  const pos={supply:{},collateral:{0:100000000n},liabilities:{0:10000000n}};
  const rpc={url:'mock',health:async()=>({ledger:10,ledgerTime:now}),instance:async key=>key===pool.id?{hash:pool.wasmHash,storage:{Config:{oracle:pool.oracle,status:0,min_collateral:0n}}}:{hash:pool.oracleWasmHash},data:async()=>[asset],getter:async(_id,method)=>({base:pool.quote,decimals:7,get_positions:pos,get_reserve:r,authorized:true})[method]};
  const sub={wallet,preferences:{riskRules:{}}},snap={...snapshot,observations:[{pool:P,asset,oracle:pool.oracle,quote:pool.quoteLabel,decimals:7,priceRaw:'10000000',timestamp:now,alertEligible:true}]};
  const collect=()=>collectBorrowing(sub,[P],snap,registry,config,async()=>({rpc,ledger:10,ledgerTime:now}));
  let result=await collect();assert.equal(result.pools[P].stale,false);assert.equal(result.pools[P].capacity.ready,true);assert.equal(result.pools[P].rates.length,1);
  snap.observations[0].alertEligible=false;result=await collect();assert.equal(result.pools[P].capacity.ready,false);assert.equal(result.pools[P].rates.length,1);
  rpc.instance=async()=>({hash:'changed',storage:{}});result=await collect();assert.equal(result.pools[P].stale,true);
});
test('risk collector is skipped until a rule is set and failures suppress old pending risk messages',async()=>{
  const db=setup(),discovery={wallet,checkedAt:now,pools:{[P]:{associated:true,stale:false}}};setState(db,`discovery:${id}`,discovery);
  const clock=async()=>({ledgerTime:now}),api={send:async()=>({messageId:'m',channelId:'d'})};let calls=0;
  const collector=async()=>{calls++;throw Error('provider unavailable');};
  await subscriptionTick(db,api,snapshot,config,registry,undefined,clock,collector);assert.equal(calls,0);
  applyCommand(db,id,'capacity',{pool:P,percent:20},registry,now);processBorrowing(db,getSubscriber(db,id),report(),[P],config);
  const result=await subscriptionTick(db,api,snapshot,config,registry,undefined,clock,collector);assert.equal(calls,1);assert.equal(result.failures,1);assert.equal(outbox(db)[0].status,'suppressed');db.close();
});
test('decimal thresholds and formatting preserve precision beyond floating point',()=>{
  assert.equal(decimal('99999999999999999.1234567',7),999999999999999991234567n);
  assert.equal(formatUnits(1000000000n,7),'100');assert.equal(formatUnits(0n,7),'0');assert.throws(()=>decimal('NaN'));
});
test('capacity near 100% and fractional APR thresholds can recover and re-arm',()=>{
  const db=setup();applyCommand(db,id,'capacity',{pool:P,percent:99},registry,now);applyCommand(db,id,'rate',{pool:P,apr:0.5},registry,now);const sub=getSubscriber(db,id);
  processBorrowing(db,sub,report(now,'98','60000'),[P],config);assert.equal(outbox(db).length,2);
  processBorrowing(db,sub,report(now+60,'100','45000'),[P],config);
  processBorrowing(db,sub,report(now+3601,'98','60000'),[P],config);assert.equal(outbox(db).length,4);db.close();
});
