import {getState,setState,enqueue,message} from './engine.mjs';

export function monitoringClock(snapshot,hostNow){
  const ledger=snapshot?.observedAt,captured=snapshot?.hostObservedAt;
  if(Number.isFinite(ledger)&&Number.isFinite(captured))return ledger+Math.max(0,hostNow-captured);
  return hostNow;
}

export function monitoringIssues({shared={},personal={},rates,expectedPools=[],now,ratesEnabled=true}){
  const fresh=(t,age)=>Number.isFinite(t)&&now-t>=-15&&now-t<=age;
  const issues=[];
  if(!shared.ready||!fresh(shared.observedAt,300))issues.push('Price checks');
  if(!personal.active||personal.ready===false||personal.error||personal.failures!==0||!fresh(personal.heartbeatAt,300)||!fresh(personal.sourceObservedAt,300))issues.push('Personal alert checks');
  if(ratesEnabled&&(!rates||!fresh(rates.checkedAt,600)||!expectedPools.every(id=>rates.pools?.some(p=>p.id===id&&p.available))))issues.push('Borrow-rate checks');
  return issues;
}

export function processMonitoringHealth(db,{now,issues,paused=false},config){
  const key=`monitor-health:${config.mode}`,state=getState(db,key,{sequence:0,lastCheck:null,badSince:null,goodSince:null});
  const status=id=>id?db.prepare('SELECT status FROM outbox WHERE id=?').get(id)?.status:null;
  const cancel=id=>{if(id)db.prepare("UPDATE outbox SET status='suppressed' WHERE id=? AND status='pending'").run(id);};
  const queue=(id,title,description,color)=>{
    const payload=message(title,description);Object.assign(payload.embeds[0],{color,timestamp:new Date(now*1000).toISOString(),footer:{text:'BLNT Alerts · Monitoring status'}});
    enqueue(db,id,now,payload,config.mode,{audience:'shared',category:'monitor_health'});
  };
  db.exec('BEGIN IMMEDIATE');
  try{
    if(['sent','uncertain'].includes(status(state.recoveryId))){delete state.warningId;delete state.recoveryId;state.badSince=null;state.goodSince=null;}
    if(paused){cancel(state.warningId);cancel(state.recoveryId);state.badSince=null;state.goodSince=null;delete state.warningId;delete state.recoveryId;}
    else if(issues.length){
      state.goodSince=null;cancel(state.recoveryId);
      if(state.badSince==null||now<state.badSince)state.badSince=now;
      if(now-state.badSince>=300){
        if(!state.warningId){state.sequence++;state.warningId=`${key}:warning:${state.sequence}`;}
        queue(state.warningId,'⚠️ Monitoring delayed',`**${issues.join(' · ')}** unavailable.\nSome alerts may be delayed.`,0xF59E0B);
      }
    }else{
      cancel(state.warningId);
      if(state.goodSince==null||now<state.goodSince)state.goodSince=now;
      if(now-state.goodSince>=60){
        if(status(state.warningId)==='sent'){
          state.recoveryId=`${key}:recovery:${state.sequence}`;
          queue(state.recoveryId,'✅ Monitoring restored','**Price, rate and personal checks** are updating again.',0x22C55E);
        }else{state.badSince=null;delete state.warningId;delete state.recoveryId;}
      }
      // A local watchdog cannot post while its host is off. Report a long check
      // gap only on return, clearly separating it from a live outage warning.
      if(!state.warningId&&!state.recoveryId&&state.lastCheck!=null&&now-state.lastCheck>600)queue(`${key}:gap:${state.lastCheck}`,'Monitoring resumed',`Checks resumed after a **${Math.floor((now-state.lastCheck)/60)}-minute gap**.\nAlerts may have been delayed.`,0x3B82F6);
    }
    state.lastCheck=now;setState(db,key,state);
    db.prepare("DELETE FROM outbox WHERE created<? AND status IN ('sent','preview','expired','suppressed') AND id NOT IN (?,?)").run(now-(config.retentionDays??8)*86400,state.warningId??'',state.recoveryId??'');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
