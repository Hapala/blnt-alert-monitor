import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore,setState} from '../engine.mjs';
import {processPublicRateAlerts,publicRatesDue,publicRateSettings} from '../public-rate-alerts.mjs';
const now=1800000000,config={mode:'live',publicBorrowRates:{enabled:true,highApr:'10',recoveryApr:'9',pollSeconds:300,cooldownSeconds:21600}};
function snapshot(t=now,raw='1000000'){
 return {observedAt:t,markets:[{id:'pool',name:'Pool'}],borrowRates:{checkedAt:t,pools:[{id:'pool',name:'Pool',available:true,rates:[{asset:'asset',symbol:'TEST',aprRaw:raw,aprPercent:String(Number(raw)/100000)}]}]}};
}
const rows=db=>db.prepare("SELECT * FROM outbox WHERE audience='shared'").all();
test('public rates use exact 10% boundary, deduplicate sustained rates, recover at 9% and cool down',()=>{
 const db=openStore(':memory:');processPublicRateAlerts(db,snapshot(now,'999999'),config);assert.equal(rows(db).length,0);
 processPublicRateAlerts(db,snapshot(),config);assert.equal(rows(db).length,1);
 db.prepare("UPDATE outbox SET status='sent'").run();
 processPublicRateAlerts(db,snapshot(now+300,'1100000'),config);assert.equal(rows(db).length,1);
 processPublicRateAlerts(db,snapshot(now+600,'900001'),config);assert.equal(rows(db).length,1);
 processPublicRateAlerts(db,snapshot(now+900,'900000'),config);assert.equal(rows(db).length,2);
 assert.match(rows(db)[1].payload,/Borrow rate eased/);db.prepare("UPDATE outbox SET status='sent'").run();
 processPublicRateAlerts(db,snapshot(now+1200),config);assert.equal(rows(db).length,2);
 processPublicRateAlerts(db,snapshot(now+21600),config);assert.equal(rows(db).length,3);db.close();
});
test('unavailable/future/stale/unselected rates cancel unsent warnings and rearm without losing or replaying accepted warnings',()=>{
 for(const invalid of [s=>s.borrowRates.checkedAt-=181,s=>s.borrowRates.checkedAt+=16,s=>s.borrowRates.pools[0].available=false,s=>s.markets=[]]){
  const db=openStore(':memory:');processPublicRateAlerts(db,snapshot(),config);
  const bad=snapshot(now+60);invalid(bad);processPublicRateAlerts(db,bad,config);assert.equal(rows(db)[0].status,'suppressed');
  processPublicRateAlerts(db,snapshot(now+120),config);assert.equal(rows(db).filter(r=>r.status==='pending').length,1);
  db.prepare("UPDATE outbox SET status='uncertain' WHERE status='pending'").run();
  processPublicRateAlerts(db,snapshot(now+22000),config);assert.equal(rows(db).filter(r=>r.status==='pending').length,0);db.close();
 }
});
test('no recovery for an unsent high alert; a cancelled recovery can be regenerated without replaying a sent recovery',()=>{
 const db=openStore(':memory:');processPublicRateAlerts(db,snapshot(),config);
 processPublicRateAlerts(db,snapshot(now+300,'800000'),config);assert.equal(rows(db).length,1);assert.equal(rows(db)[0].status,'suppressed');
 processPublicRateAlerts(db,snapshot(now+21600),config);db.prepare("UPDATE outbox SET status='sent' WHERE status='pending'").run();
 processPublicRateAlerts(db,snapshot(now+21900,'800000'),config);assert.match(rows(db).at(-1).id,/:recovery:/);
 const bad=snapshot(now+21960);bad.borrowRates.pools=[];processPublicRateAlerts(db,bad,config);assert.equal(rows(db).at(-1).status,'suppressed');
 processPublicRateAlerts(db,snapshot(now+22200,'800000'),config);assert.equal(rows(db).at(-1).status,'pending');
 db.prepare("UPDATE outbox SET status='sent'").run();processPublicRateAlerts(db,snapshot(now+22500,'800000'),config);assert.equal(rows(db).at(-1).status,'sent');db.close();
});
test('public scheduling is bounded and public rules never run for personal audiences or query subscribers',()=>{
 const db=openStore(':memory:');assert.equal(publicRatesDue(db,now,config),true);setState(db,'publicRatesLastAttempt',now);
 assert.equal(publicRatesDue(db,now+299,config),false);assert.equal(publicRatesDue(db,now+300,config),true);
 processPublicRateAlerts(db,snapshot(),{...config,audienceId:'subscriber'});assert.equal(rows(db).length,0);
 processPublicRateAlerts(db,snapshot(),{...config,publicBorrowRates:{enabled:false}});assert.equal(rows(db).length,0);
 assert.throws(()=>publicRateSettings({...config,publicBorrowRates:{...config.publicBorrowRates,pollSeconds:60}}));db.close();
});
