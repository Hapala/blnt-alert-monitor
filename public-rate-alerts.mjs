import {getState,setState,enqueue,message,reconcileAlert} from './engine.mjs';
import {decimal,PERCENT,S7} from './borrow-math.mjs';

export function publicRateSettings(config){
  const rules=config.publicBorrowRates;
  if(!rules?.enabled)return null;
  const high=decimal(String(rules.highApr)),recovery=decimal(String(rules.recoveryApr));
  if(high<=recovery||high>100000n*PERCENT||!Number.isInteger(rules.pollSeconds)||rules.pollSeconds<300||
    !Number.isInteger(rules.cooldownSeconds)||rules.cooldownSeconds<3600)throw Error('Invalid public borrow-rate rules');
  return {...rules,high,recovery};
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
        const value=BigInt(rate.aprRaw)*100n*PERCENT;
        const high=value>=rules.high*S7,recovered=value<=rules.recovery*S7;
        const queue=(kind,title,description,color)=>{
          const payload=message(title,description);
          Object.assign(payload.embeds[0],{color,timestamp:new Date(report.checkedAt*1000).toISOString(),url:'https://blnt.trade/',footer:{text:'Variable annual borrow rate · Public pool data'}});
          const id=`${key}:${kind}:${state.sequence}`;
          enqueue(db,id,now,payload,config.mode,{audience:'shared',category:'borrow_rate',pool:pool.id});
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
        setState(db,key,state);
      }
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
