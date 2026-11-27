import {getState,setState,enqueue,message,reconcileAlert} from './engine.mjs';
import {decimal,PERCENT,S7,formatUnits} from './borrow-math.mjs';
import {observeAlarm,markMissingAlarms} from './alarms.mjs';

export function publicRateSettings(config){
  const rules=config.publicBorrowRates;
  if(!rules?.enabled)return null;
  const high=decimal(String(rules.highApr)),recovery=decimal(String(rules.recoveryApr));
  if(high<=recovery||high>100000n*PERCENT||!Number.isInteger(rules.pollSeconds)||rules.pollSeconds<300||
    !Number.isInteger(rules.cooldownSeconds)||rules.cooldownSeconds<3600)throw Error('Invalid public borrow-rate rules');
  const movement=decimal(String(rules.changeAprPoints??'1')),changeCooldownSeconds=rules.changeCooldownSeconds??3600;
  if(movement<=0n||!Number.isInteger(changeCooldownSeconds)||changeCooldownSeconds<3600)throw Error('Invalid public rate-change rules');
  return {...rules,high,recovery,movement,changeCooldownSeconds};
}
function rateMovement(db,state,key,rate,pool,report,now,rules,config){
  const raw=BigInt(rate.aprRaw);
  if(state.changeId){
    const row=db.prepare('SELECT status,created,attempts FROM outbox WHERE id=?').get(state.changeId);
    if(row&&['sent','recorded','uncertain','sending','failed'].includes(row.status)){
      state.baselineRaw=state.changeRaw;state.lastChange=row.created;delete state.changeId;
    }
  }
  if(state.baselineRaw==null||now-(state.lastSeen??now)>900){
    if(state.changeId)db.prepare("UPDATE outbox SET status='suppressed' WHERE id=? AND status='pending'").run(state.changeId);
    state.baselineRaw=rate.aprRaw;delete state.changeId;
  }
  state.lastSeen=now;
  const episodePending=[state.highId,state.recoveryId].filter(Boolean).some(id=>['pending','sending'].includes(db.prepare('SELECT status FROM outbox WHERE id=?').get(id)?.status));
  const delta=raw-BigInt(state.baselineRaw),absolute=delta<0n?-delta:delta;
  const qualifies=absolute*100n*PERCENT>=rules.movement*S7;
  if(state.changeId){
    const row=db.prepare('SELECT status,attempts FROM outbox WHERE id=?').get(state.changeId);
    const previousDelta=BigInt(state.changeRaw)-BigInt(state.baselineRaw);
    if(!qualifies||episodePending||(previousDelta<0n)!==(delta<0n))db.prepare("UPDATE outbox SET status='suppressed' WHERE id=? AND status='pending'").run(state.changeId);
    else if(row?.status==='pending')return;
    if(row?.attempts>=4)return;
  }
  if(!qualifies||episodePending||now-(state.lastChange??0)<rules.changeCooldownSeconds)return;
  const rising=delta>0n,payload=message(`Borrow APR ${rising?'↑':'↓'} · ${rate.symbol}`,
    `**${pool.name}**\n**${formatUnits(BigInt(state.baselineRaw)*100n,7)}% → ${rate.aprPercent}% APR**\n**${rising?'+':'−'}${formatUnits(absolute*100n,7)} percentage point${absolute===100000n?'':'s'}**`);
  Object.assign(payload.embeds[0],{color:rising?0xF59E0B:0x22C55E,timestamp:new Date(report.checkedAt*1000).toISOString(),url:'https://blnt.trade/',footer:{text:'Variable borrow APR · Change since last rate update'}});
  if(!state.changeId){state.changeSequence=(state.changeSequence??0)+1;state.changeId=`${key}:change:${state.changeSequence}`;}
  state.changeRaw=rate.aprRaw;
  enqueue(db,state.changeId,now,payload,config.mode,{audience:'shared',category:'borrow_rate',pool:pool.id,severity:3});
  observeAlarm(db,{mode:config.mode,key:`rate-change:${pool.id}:${rate.asset}`,category:'borrow_rate',pool:pool.id,asset:rate.asset,label:`${pool.name} · ${rate.symbol} APR change`,detail:payload.embeds[0].description,severity:3,condition:'active',now,eventId:state.changeId,expiresAt:now+3600});
}
export function publicRatesDue(db,now,config){
  const rules=publicRateSettings(config);if(!rules)return false;
  const last=getState(db,'publicRatesLastAttempt',null);
  return last===null||now<last||now-last>=rules.pollSeconds;
}

// Shared reserve rates only. Never reads or changes subscriptions or wallet rules.
export function processPublicRateAlerts(db,snapshot,config){
  const rules=publicRateSettings(config);
  if(!rules||config.audienceId&&config.audienceId!=='shared')return;
  const now=snapshot.observedAt,report=snapshot.borrowRates;
  const fresh=report&&report.checkedAt<=now+15&&now-report.checkedAt<=180;
  db.exec('BEGIN IMMEDIATE');
  try{
    const tracked=[];
    // Drop definitely unsent warnings whose asset is no longer verifiable.
    const valid=new Set();
    if(fresh)for(const pool of report.pools.filter(p=>p.available&&snapshot.markets.some(m=>m.id===p.id)))
      for(const rate of pool.rates)valid.add(`${pool.id}:${rate.asset}`);
    for(const row of db.prepare("SELECT id,pool FROM outbox WHERE audience='shared' AND category='borrow_rate' AND status='pending'").all()){
      const asset=row.id.split(':')[3];
      if(!valid.has(`${row.pool}:${asset}`))db.prepare("UPDATE outbox SET status='suppressed' WHERE id=?").run(row.id);
    }
    if(fresh)for(const pool of report.pools.filter(p=>p.available&&snapshot.markets.some(m=>m.id===p.id))){
      for(const rate of pool.rates){
        const key=`public-rate:${config.mode}:${pool.id}:${rate.asset}`;
        const state=reconcileAlert(db,getState(db,key,{armed:true,last:0,sequence:0}));
        if(state.recoveryId&&db.prepare('SELECT status FROM outbox WHERE id=?').get(state.recoveryId)?.status==='sent'){
          delete state.highId;delete state.recoveryId;
        }
        const value=BigInt(rate.aprRaw)*100n*PERCENT;
        const high=value>=rules.high*S7,recovered=value<=rules.recovery*S7;
        const alarmKey=`high-apr:${pool.id}:${rate.asset}`;tracked.push(alarmKey);
        observeAlarm(db,{mode:config.mode,key:alarmKey,category:'borrow_rate',pool:pool.id,asset:rate.asset,label:`${pool.name} · ${rate.symbol} high APR`,detail:`${rate.aprPercent}% APR`,severity:2,condition:high?'active':recovered?'resolved':'hold',now,validUntil:report.checkedAt+180});
        const queue=(kind,title,description,color)=>{
          const payload=message(title,description);
          Object.assign(payload.embeds[0],{color,timestamp:new Date(report.checkedAt*1000).toISOString(),url:'https://blnt.trade/',footer:{text:'Variable annual borrow rate · Public pool data'}});
          const id=`${key}:${kind}:${state.sequence}`;
          enqueue(db,id,now,payload,config.mode,{audience:'shared',category:'borrow_rate',pool:pool.id});
          const row=db.prepare('SELECT status,created FROM outbox WHERE id=?').get(id);
          if(row.created===now&&['pending','preview'].includes(row.status)){
            if(state.changeId)db.prepare("UPDATE outbox SET status='suppressed' WHERE id=? AND status='pending'").run(state.changeId);
            delete state.changeId;state.baselineRaw=rate.aprRaw;state.lastChange=now;
          }
          return id;
        };
        if(!high&&state.highId)db.prepare("UPDATE outbox SET status='suppressed' WHERE id=? AND status='pending'").run(state.highId);
        if(!recovered&&state.recoveryId)db.prepare("UPDATE outbox SET status='suppressed' WHERE id=? AND status='pending'").run(state.recoveryId);
        if(recovered&&(!state.armed||state.recoveryId)){
          // A recovery is meaningful only after a confirmed delivered warning.
          const warned=state.highId&&db.prepare('SELECT status FROM outbox WHERE id=?').get(state.highId)?.status==='sent';
          if(warned)state.recoveryId=queue('recovery',`Borrow rate eased · ${rate.symbol}`,`**${pool.name}** · **${rate.aprPercent}% APR**\nBack at or below ${rules.recoveryApr}%.`,0x22C55E);
          state.armed=true;delete state.pendingId;
        }
        if(high&&state.armed&&now-state.last>=rules.cooldownSeconds){
          delete state.recoveryId;
          state.sequence++;
          state.highId=queue('high',`Borrow rate high · ${rate.symbol}`,`**${pool.name}** · **${rate.aprPercent}% APR**\nPublic alert: ${rules.highApr}% or higher.`,0xF59E0B);
          state.beforeQueuedLast=state.last;state.pendingId=state.highId;state.last=now;state.armed=false;
        }
        rateMovement(db,state,key,rate,pool,report,now,rules,config);
        setState(db,key,state);
      }
    }
    markMissingAlarms(db,config.mode,'borrow_rate',tracked,now);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
