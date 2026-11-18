import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore,setState} from '../engine.mjs';
import {reserveLiquidity,processLiquidity,liquiditySettings,liquidityChecksDue} from '../liquidity-alerts.mjs';
const now=1800000000,c={mode:'live'};
const reserve=(debt='90',supply='100')=>({config:{decimals:7},data:{b_supply:BigInt(supply)*10000000n,d_supply:BigInt(debt)*10000000n,b_rate:1000000000000n,d_rate:1000000000000n}});
const snap=(t=now,debt='90',supply='100')=>({observedAt:t,markets:[{id:'p'}],borrowRates:{checkedAt:t,pools:[{id:'p',name:'Pool',available:true,rates:[{asset:'a',symbol:'TEST',liquidity:reserveLiquidity(reserve(debt,supply))}]}]}});
const rows=db=>db.prepare("SELECT * FROM outbox WHERE category='liquidity'").all();
test('liquidity estimates use conservative mixed-decimal accounting and never call empty zero-debt reserves tight',()=>{
 const r=reserve();r.config.decimals=2;r.data.b_supply=10001n;r.data.d_supply=9000n;r.data.d_rate=1000000000001n;
 const l=reserveLiquidity(r);assert.equal(l.supplyRaw,'10001');assert.equal(l.debtRaw,'9001');assert.equal(l.unborrowedRaw,'1000');assert.equal(l.decimals,2);
 assert.equal(reserveLiquidity(reserve('0','0')).ready,false);assert.equal(reserveLiquidity(reserve('1','0')).emptyWithDebt,true);
 assert.throws(()=>liquiditySettings({liquidityAlerts:{enabled:true,warningPercent:'95',criticalPercent:'90',recoveryPercent:'85',cooldownSeconds:21600}}));
});
test('90% warns once, 95% escalates, 85% recovers and high warnings have a six-hour cooldown',()=>{
 const db=openStore(':memory:');processLiquidity(db,snap(now,'89'),c);assert.equal(rows(db).length,0);
 processLiquidity(db,snap(now+300),c);processLiquidity(db,snap(now+600,'92'),c);assert.equal(rows(db).length,1);
 assert.match(rows(db)[0].payload,/90% of supply borrowed/);assert.match(rows(db)[0].payload,/10 TEST/);
 db.prepare("UPDATE outbox SET status='sent'").run();processLiquidity(db,snap(now+900,'95'),c);assert.equal(rows(db).length,2);assert.match(rows(db)[1].payload,/very tight/);
 db.prepare("UPDATE outbox SET status='sent'").run();processLiquidity(db,snap(now+1200,'85'),c);assert.equal(rows(db).length,3);assert.match(rows(db)[2].payload,/Liquidity improved/);
 db.prepare("UPDATE outbox SET status='sent'").run();processLiquidity(db,snap(now+1500),c);assert.equal(rows(db).length,3);
 processLiquidity(db,snap(now+22500),c);assert.equal(rows(db).length,4);db.close();
});
test('stale/unavailable/disabled and personal contexts suppress or skip warnings; unsent messages rearm without uncertain replay',()=>{
 const db=openStore(':memory:');processLiquidity(db,snap(),c);
 const bad=snap(now+60);bad.borrowRates.checkedAt-=181;processLiquidity(db,bad,c);assert.equal(rows(db)[0].status,'suppressed');
 processLiquidity(db,snap(now+120),c);assert.equal(rows(db).filter(r=>r.status==='pending').length,1);
 db.prepare("UPDATE outbox SET status='uncertain' WHERE status='pending'").run();processLiquidity(db,snap(now+180),c);assert.equal(rows(db).filter(r=>r.status==='pending').length,0);
 processLiquidity(db,snap(now+300,'95'),{...c,audienceId:'personal'});assert.equal(rows(db).filter(r=>r.status==='pending').length,0);
 processLiquidity(db,snap(now+300),{...c,liquidityAlerts:{enabled:false}});db.close();
});
test('empty reserves are quiet and a zero-supply outstanding debt gets an explicit warning without invented percentage',()=>{
 const db=openStore(':memory:');processLiquidity(db,snap(now,'0','0'),c);assert.equal(rows(db).length,0);
 processLiquidity(db,snap(now+300,'1','0'),c);assert.match(rows(db)[0].payload,/No supplied liquidity/);assert.doesNotMatch(rows(db)[0].payload,/100%/);db.close();
});
test('liquidity checks keep the five-minute reserve schedule when borrow-rate alerts are disabled',()=>{
 const db=openStore(':memory:'),config={publicBorrowRates:{enabled:false}};
 assert.equal(liquidityChecksDue(db,now,config),true);setState(db,'publicRatesLastAttempt',now);
 assert.equal(liquidityChecksDue(db,now+299,config),false);assert.equal(liquidityChecksDue(db,now+300,config),true);
 assert.equal(liquidityChecksDue(db,now+300,{...config,liquidityAlerts:{enabled:false}}),false);db.close();
});
test('display rounding cannot move a below-boundary ratio across the exact warning threshold',()=>{
 const db=openStore(':memory:'),snapshot=snap(),r=reserve();r.data.d_supply=899999999n;
 snapshot.borrowRates.pools[0].rates[0].liquidity=reserveLiquidity(r);
 assert.equal(snapshot.borrowRates.pools[0].rates[0].liquidity.utilizationRaw,'9000000');
 processLiquidity(db,snapshot,c);assert.equal(rows(db).length,0);db.close();
});
test('a cancelled unsent escalation retains recovery for the warning already delivered',()=>{
 const db=openStore(':memory:');processLiquidity(db,snap(),c);db.prepare("UPDATE outbox SET status='sent'").run();
 processLiquidity(db,snap(now+300,'95'),c);processLiquidity(db,snap(now+600,'85'),c);
 assert.equal(rows(db)[1].status,'suppressed');assert.match(rows(db)[2].payload,/Liquidity improved/);db.close();
});
