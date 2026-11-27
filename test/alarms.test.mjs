import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openStore,processSnapshot} from '../engine.mjs';
import {observeAlarm,markMissingAlarms,pruneAlarms,activeAlarms} from '../alarms.mjs';
import {processPublicRateAlerts} from '../public-rate-alerts.mjs';
import {processLiquidity,reserveLiquidity} from '../liquidity-alerts.mjs';
import {processPoolStatuses} from '../pool-status-alerts.mjs';
import {processMonitoringHealth} from '../health-alerts.mjs';
const now=1800000000,config={...JSON.parse(readFileSync(new URL('../config.json',import.meta.url))),mode:'live',trial:false};
const observation=(overrides={})=>({mode:'live',key:'one',category:'price',label:'Public pool · TEST',detail:'3%',severity:3,condition:'active',now,...overrides});
test('alarm episodes persist across restart, severity changes and notification-independent evaluation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'blnt-alarms-')),path=join(dir,'db.sqlite');let db=openStore(path);
 try{observeAlarm(db,observation());db.close();db=openStore(path);observeAlarm(db,observation({severity:1,now:now+60}));
 let row=activeAlarms(db,'live',now+60)[0];assert.equal(row.openedAt,now);assert.equal(row.episode,1);assert.equal(row.severity,1);
 observeAlarm(db,observation({severity:2,now:now+120}));row=activeAlarms(db,'live',now+120)[0];assert.equal(row.episode,1);assert.equal(row.severity,2);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM outbox').get().n,0);
 observeAlarm(db,observation({condition:'resolved',now:now+180}));assert.equal(activeAlarms(db,'live',now+180).length,0);
 observeAlarm(db,observation({now:now+240}));row=activeAlarms(db,'live',now+240)[0];assert.equal(row.episode,2);assert.equal(row.openedAt,now+240);
 }finally{db.close();rmSync(dir,{recursive:true});}
});
test('missing/stale data never clears an alarm, old observations cannot rewind it, and recovery requires fresh evidence',()=>{
 const db=openStore(':memory:');observeAlarm(db,observation());markMissingAlarms(db,'live','price',[],now+60);
 let row=activeAlarms(db,'live',now+60)[0];assert.equal(row.status,'unknown');assert.equal(row.openedAt,now);
 observeAlarm(db,observation({condition:'resolved',now:now-1}));assert.equal(activeAlarms(db,'live',now+60)[0].status,'unknown');
 observeAlarm(db,observation({condition:'hold',now:now+120}));assert.equal(activeAlarms(db,'live',now+120)[0].status,'active');
 assert.equal(activeAlarms(db,'live',now+421)[0].status,'unknown');
 pruneAlarms(db,'live',now+9*86400);assert.equal(activeAlarms(db,'live',now+9*86400).length,1);
 observeAlarm(db,observation({condition:'resolved',now:now+10*86400}));assert.equal(activeAlarms(db,'live',now+10*86400).length,0);db.close();
});
test('mode isolation and timed informational events have explicit expiry without reopening on the same event',()=>{
 const db=openStore(':memory:');observeAlarm(db,observation({mode:'dry-run'}));assert.equal(activeAlarms(db,'live',now).length,0);
 observeAlarm(db,observation({severity:4,eventId:'e',expiresAt:now+3600}));
 observeAlarm(db,observation({severity:4,eventId:'e',expiresAt:now+3660,now:now+60}));assert.equal(activeAlarms(db,'live',now+60)[0].expiresAt,now+3600);
 assert.equal(activeAlarms(db,'live',now+3600).length,0);pruneAlarms(db,'live',now+3600);
 observeAlarm(db,observation({severity:4,eventId:'e',expiresAt:now+7200,now:now+3601}));assert.equal(activeAlarms(db,'live',now+3601).length,0);
 assert.throws(()=>observeAlarm(db,observation({audience:'111111111111111111'})),/Only shared/);db.close();
});
test('shared price alarms track silent/muted conditions and missing verification; personal processing adds no shared alarm',()=>{
 const db=openStore(':memory:'),c={...config,mutedCategories:['price']};
 const feed=(t,price,eligible=true,settings=c)=>processSnapshot(db,{observedAt:t,markets:[],observations:[{key:'p:a',pool:'p',poolName:'Pool',asset:'a',symbol:'TEST',quote:'USD',price,timestamp:t,alertEligible:eligible}]},settings);
 for(let t=now-3600;t<now;t+=60)feed(t,100);
 feed(now,103);assert.equal(activeAlarms(db,'live',now)[0].severity,3);assert.equal(db.prepare('SELECT COUNT(*) n FROM outbox').get().n,0);
 feed(now+60,100,false);assert.equal(activeAlarms(db,'live',now+60)[0].status,'unknown');
 feed(now+120,100);assert.equal(activeAlarms(db,'live',now+120).length,0);
 const before=db.prepare('SELECT * FROM alarms').all();feed(now+180,110,true,{...config,audienceId:'111111111111111111'});assert.deepEqual(db.prepare('SELECT * FROM alarms').all(),before);db.close();
});
const rateSnapshot=(t,raw='1100000')=>({observedAt:t,markets:[{id:'p'}],borrowRates:{checkedAt:t,pools:[{id:'p',name:'Pool',available:true,rates:[{asset:'a',symbol:'TEST',aprRaw:raw,aprPercent:String(Number(raw)/100000)}]}]}});
test('a stopped collector cannot keep a price alarm verified beyond its website-check expiry',()=>{
 const db=openStore(':memory:'),snap=(t,price)=>({observedAt:t,markets:[],observations:[{key:'a',pool:'p',poolName:'Pool',asset:'a',symbol:'TEST',quote:'USD',price,timestamp:t,alertEligible:true}]});
 for(let t=now-3600;t<now;t+=60)processSnapshot(db,snap(t,100),config);
 processSnapshot(db,{...snap(now,103),crossCheck:{checkedAt:now-config.crossCheckMaxAgeSeconds+10}},config);
 assert.equal(activeAlarms(db,'live',now+10)[0].status,'active');assert.equal(activeAlarms(db,'live',now+11)[0].status,'unknown');db.close();
});
test('high APR holds through hysteresis and stale coverage, then resolves independently of notification history',()=>{
 const db=openStore(':memory:');processPublicRateAlerts(db,rateSnapshot(now),config);
 assert.equal(activeAlarms(db,'live',now)[0].severity,2);
 processPublicRateAlerts(db,{observedAt:now+60,markets:[]},config);assert.equal(activeAlarms(db,'live',now+60)[0].status,'unknown');
 processPublicRateAlerts(db,rateSnapshot(now+120,'950000'),config);assert.ok(activeAlarms(db,'live',now+120).some(r=>r.key.startsWith('high-apr:')));
 processPublicRateAlerts(db,rateSnapshot(now+180,'900000'),config);assert.ok(!activeAlarms(db,'live',now+180).some(r=>r.key.startsWith('high-apr:')));db.close();
});
test('liquidity downgrades within an episode and a verified empty reserve resolves a prior warning',()=>{
 const db=openStore(':memory:'),snap=(t,debt,supply)=>({observedAt:t,markets:[{id:'p'}],borrowRates:{checkedAt:t,pools:[{id:'p',name:'Pool',available:true,rates:[{asset:'a',symbol:'TEST',liquidity:reserveLiquidity({config:{decimals:0},data:{b_supply:BigInt(supply),d_supply:BigInt(debt),b_rate:1000000000000n,d_rate:1000000000000n}})}]}]}});
 processLiquidity(db,snap(now,95,100),config);processLiquidity(db,snap(now+60,92,100),config);
 assert.equal(activeAlarms(db,'live',now+60)[0].severity,2);assert.equal(activeAlarms(db,'live',now+60)[0].episode,1);
 processLiquidity(db,snap(now+120,0,0),config);assert.equal(activeAlarms(db,'live',now+120).length,0);db.close();
});
test('an initially restricted pool is active silently and missing status cannot falsely resolve it',()=>{
 const db=openStore(':memory:');processPoolStatuses(db,{observedAt:now,markets:[{id:'p',name:'Pool',status:5}]},config);
 assert.equal(activeAlarms(db,'live',now)[0].severity,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM outbox').get().n,0);
 processPoolStatuses(db,{observedAt:now+60,markets:[]},config);assert.equal(activeAlarms(db,'live',now+60)[0].status,'unknown');
 processPoolStatuses(db,{observedAt:now+120,markets:[{id:'p',name:'Pool',status:1}]},config);assert.equal(activeAlarms(db,'live',now+120).length,0);db.close();
});
test('monitoring alarm debounce, pause uncertainty and fresh recovery are independent of delivery',()=>{
 const db=openStore(':memory:');processMonitoringHealth(db,{now,issues:['Price checks']},config);
 assert.equal(activeAlarms(db,'live',now).length,0);processMonitoringHealth(db,{now:now+300,issues:['Price checks']},config);
 assert.equal(activeAlarms(db,'live',now+300)[0].severity,2);
 processMonitoringHealth(db,{now:now+360,issues:[],paused:true},config);assert.equal(activeAlarms(db,'live',now+360)[0].status,'unknown');
 processMonitoringHealth(db,{now:now+420,issues:[]},config);processMonitoringHealth(db,{now:now+480,issues:[]},config);
 assert.equal(activeAlarms(db,'live',now+480).length,0);db.close();
});
