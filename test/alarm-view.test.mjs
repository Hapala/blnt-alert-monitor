import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../engine.mjs';
import {observeAlarm} from '../alarms.mjs';
import {sharedAlarmReport,readSharedAlarmReport} from '../alarm-view.mjs';
import {commandDefinition,applyCommand} from '../subscription-commands.mjs';
import {verifyCommandOrigin} from '../dm-api.mjs';
import {initSubscriptions,saveSubscriber,getSubscriber} from '../subscriptions.mjs';
const now=1800000000,put=(db,key,severity=3,extra={})=>observeAlarm(db,{mode:'live',key,category:'price',label:key,detail:'3% change',severity,condition:'active',now,...extra});
test('read-only view combines all severity levels, shows stale uncertainty and never includes private state',()=>{
 const main=openStore(':memory:'),health=openStore(':memory:');
 for(const severity of [1,2,3,4])put(main,'Public '+severity,severity);
 put(health,'Monitoring delayed',2,{category:'monitor_health'});
 main.prepare('INSERT INTO state VALUES (?,?)').run('subscriber:private',JSON.stringify({wallet:'DO_NOT_EXPOSE',amount:'PRIVATE_AMOUNT'}));
 const before=main.prepare('SELECT * FROM alarms').all(),output=sharedAlarmReport({main,health,mode:'live',now:now+301});
 for(const severity of [1,2,3,4])assert.match(output,new RegExp('Sev '+severity));
 assert.match(output,/Monitoring delayed/);assert.match(output,/Unknown/);assert.ok(!output.includes('DO_NOT_EXPOSE'));assert.ok(!output.includes('PRIVATE_AMOUNT'));
 assert.deepEqual(main.prepare('SELECT * FROM alarms').all(),before);assert.equal(main.prepare('SELECT COUNT(*) n FROM outbox').get().n,0);main.close();health.close();
});
test('view paginates all records, distinguishes timed events and reports unavailable coverage',()=>{
 const main=openStore(':memory:');for(let i=0;i<21;i++)put(main,'Alarm '+String(i).padStart(2,'0'));
 put(main,'Reserve event',4,{eventId:'e',expiresAt:now+3600});
 const page1=sharedAlarmReport({main,mode:'live',now}),page3=sharedAlarmReport({main,mode:'live',now,page:3});
 assert.match(page1,/Page \*\*1\/3/);assert.match(page3,/Page \*\*3\/3/);assert.match(page3,/event · expires/);assert.match(page1,/Monitoring alarm state unavailable/);
 assert.ok(!page1.includes('Alarm 20'));assert.ok(page3.includes('Alarm 20'));
 assert.ok(!sharedAlarmReport({main,mode:'live',now:now+3600,page:3}).includes('Reserve event'));
 assert.throws(()=>sharedAlarmReport({main,mode:'live',now,page:0}));main.close();
});
test('empty or missing alarm sources never claim all clear and do not invent another mode’s alarms',()=>{
 const main=openStore(':memory:');put(main,'Dry-run only',1,{mode:'dry-run'});
 const output=sharedAlarmReport({main,mode:'live',now});assert.match(output,/not an all-clear/);assert.match(output,/not been evaluated/);assert.ok(!output.includes('Dry-run only'));main.close();
});
test('filesystem view uses ledger-anchored time, handles bad health data, and leaves personal preferences untouched',()=>{
 const home=mkdtempSync(join(tmpdir(),'blnt-alarm-view-'));mkdirSync(join(home,'data'));
 const main=openStore(join(home,'data/monitor.sqlite'));
 try{
  initSubscriptions(main);saveSubscriber(main,'111111111111111111','GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H',now);
  const registry=JSON.parse(readFileSync(new URL('../markets.json',import.meta.url)));
  applyCommand(main,'111111111111111111','capacity',{pool:registry.pools[0].id,percent:47},registry,now);
  const before=getSubscriber(main,'111111111111111111');put(main,'Public condition',2);
  writeFileSync(join(home,'config.json'),JSON.stringify({mode:'live'}));writeFileSync(join(home,'data/latest.json'),JSON.stringify({observedAt:now,hostObservedAt:now+3600}));
  writeFileSync(join(home,'data/health.sqlite'),'synthetic invalid database');
  const output=readSharedAlarmReport(home,1,now+3600);assert.match(output,/open 0m/);assert.match(output,/Monitoring alarm state unavailable/);
  assert.match(readSharedAlarmReport(home,1,now),/Source clock unavailable/);
  assert.deepEqual(getSubscriber(main,'111111111111111111'),before);
  assert.equal(main.prepare('SELECT COUNT(*) n FROM outbox').get().n,0);
 }finally{main.close();rmSync(home,{recursive:true});}
});
test('active command is available without subscription but remains behind existing server/member authorization',async()=>{
 const registry=JSON.parse(readFileSync(new URL('../markets.json',import.meta.url))),command=commandDefinition(registry).options.find(o=>o.name==='active');
 assert.ok(command);assert.equal(command.options[0].name,'page');assert.equal(command.options[0].min_value,1);
 const api={request:async()=>{throw {status:404};}};
 await assert.rejects(verifyCommandOrigin(api,'111111111111111111','222222222222222222',null,'active'),/Join/);
 await assert.rejects(verifyCommandOrigin(api,'111111111111111111','222222222222222222','333333333333333333','active'),/configured BLNT server/);
 await verifyCommandOrigin(api,'111111111111111111','222222222222222222','111111111111111111','active');
});
