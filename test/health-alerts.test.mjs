import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../engine.mjs';
import {monitoringIssues,processMonitoringHealth} from '../health-alerts.mjs';
const now=1800000000,c={mode:'live'},rows=db=>db.prepare('SELECT * FROM outbox ORDER BY created').all();
const tick=(db,t,issues=[],paused=false)=>processMonitoringHealth(db,{now:t,issues,paused},c);
test('health checks include freshness, failed cycles and complete public-rate coverage without leaking diagnostics',()=>{
 const good={now,shared:{ready:true,observedAt:now},personal:{active:true,failures:0,heartbeatAt:now,sourceObservedAt:now},rates:{checkedAt:now,pools:[{id:'p',available:true}]},expectedPools:['p']};
 assert.deepEqual(monitoringIssues(good),[]);
 assert.deepEqual(monitoringIssues({...good,shared:{ready:false,error:'private detail'}}),['Price checks']);
 assert.deepEqual(monitoringIssues({...good,rates:{checkedAt:now-601,pools:[]}}),['Borrow-rate checks']);
 assert.deepEqual(monitoringIssues({...good,personal:{active:true,failures:1,heartbeatAt:now}}),['Personal alert checks']);
 assert.deepEqual(monitoringIssues({...good,shared:{ready:true,observedAt:now+16}}),['Price checks']);
});
test('one warning after five minutes, recovery after two checks, no initial all-clear or transient noise',()=>{
 const db=openStore(':memory:');tick(db,now);tick(db,now+60);assert.equal(rows(db).length,0);
 tick(db,now+120,['Price checks']);tick(db,now+360,['Price checks']);assert.equal(rows(db).length,0);
 tick(db,now+420,['Price checks']);tick(db,now+480,['Price checks']);assert.equal(rows(db).length,1);
 db.prepare("UPDATE outbox SET status='sent'").run();tick(db,now+540);assert.equal(rows(db).length,1);
 tick(db,now+600);assert.equal(rows(db).length,2);assert.match(rows(db)[1].payload,/Monitoring restored/);
 db.prepare("UPDATE outbox SET status='sent'").run();tick(db,now+660);assert.equal(rows(db).length,2);db.close();
});
test('definitely unsent warnings cancel, expired warnings regenerate, uncertain outcomes never replay',()=>{
 const db=openStore(':memory:');tick(db,now,['Price checks']);tick(db,now+300,['Price checks']);
 db.prepare("UPDATE outbox SET status='expired'").run();tick(db,now+360,['Price checks']);assert.equal(rows(db)[0].status,'pending');
 db.prepare("UPDATE outbox SET status='uncertain'").run();tick(db,now+420,['Price checks']);assert.equal(rows(db)[0].status,'uncertain');
 tick(db,now+480);tick(db,now+540);assert.equal(rows(db).length,1);db.close();
});
test('pause is quiet and a host gap is reported only after returning',()=>{
 const db=openStore(':memory:');tick(db,now);tick(db,now+700);assert.match(rows(db)[0].payload,/resumed/);
 tick(db,now+800,['Price checks'],true);tick(db,now+1200,['Price checks'],true);assert.equal(rows(db).length,1);db.close();
});
