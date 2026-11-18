import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../engine.mjs';
import {processPoolStatuses,poolStatus,POOL_STATUSES} from '../pool-status-alerts.mjs';
const now=1800000000,c={mode:'live'},snap=(status,t=now)=>({observedAt:t,markets:status==null?[]:[{id:'p',name:'Pool',status}]}),rows=db=>db.prepare("SELECT * FROM outbox WHERE category='pool_status'").all();
test('all pinned status codes are explicit and unknown schemas fail closed',()=>{
 for(let i=0;i<7;i++){assert.equal(poolStatus(BigInt(i)),i);assert.ok(POOL_STATUSES[i]);}
 for(const v of [7,-1,1.5,'1',undefined])assert.throws(()=>poolStatus(v));
});
test('baseline is silent, restrictions and reactivation are concise and deduplicated',()=>{
 const db=openStore(':memory:');processPoolStatuses(db,snap(1),c);assert.equal(rows(db).length,0);
 processPoolStatuses(db,snap(3,now+60),c);processPoolStatuses(db,snap(3,now+120),c);assert.equal(rows(db).length,1);
 assert.match(rows(db)[0].payload,/Active → On ice/);assert.match(rows(db)[0].payload,/New borrowing disabled/);
 db.prepare("UPDATE outbox SET status='sent'").run();processPoolStatuses(db,snap(5,now+180),c);assert.match(rows(db)[1].payload,/supplies disabled/);
 db.prepare("UPDATE outbox SET status='sent'").run();processPoolStatuses(db,snap(1,now+240),c);assert.match(rows(db)[2].payload,/borrowing enabled/);db.close();
});
test('missing data suppresses definitely unsent changes and re-arms, uncertain/sent messages never replay',()=>{
 const db=openStore(':memory:');processPoolStatuses(db,snap(1),c);processPoolStatuses(db,snap(3,now+60),c);
 processPoolStatuses(db,snap(null,now+120),c);assert.equal(rows(db)[0].status,'suppressed');
 processPoolStatuses(db,snap(3,now+180),c);assert.equal(rows(db)[0].status,'pending');
 db.prepare("UPDATE outbox SET status='uncertain'").run();processPoolStatuses(db,snap(3,now+240),c);assert.equal(rows(db).length,1);
 processPoolStatuses(db,snap(1,now+300),{...c,audienceId:'personal'});assert.equal(rows(db).length,1);db.close();
});
test('an unreported transient restriction cancels when the pool returns to its original state',()=>{
 const db=openStore(':memory:');processPoolStatuses(db,snap(1),c);processPoolStatuses(db,snap(3,now+60),c);
 processPoolStatuses(db,snap(1,now+120),c);assert.equal(rows(db)[0].status,'suppressed');assert.equal(rows(db).length,1);db.close();
});
