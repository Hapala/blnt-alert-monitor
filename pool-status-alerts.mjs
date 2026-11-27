import {getState,setState,enqueue,message} from './engine.mjs';
export const POOL_STATUSES=['Active (admin)','Active','On ice (admin)','On ice','Frozen (admin)','Frozen','Setup'];
export function poolStatus(value){
  if(!['number','bigint'].includes(typeof value))throw Error('Invalid pool status');
  const status=Number(value);if(!Number.isInteger(status)||status<0||status>=POOL_STATUSES.length)throw Error('Unknown pool status');return status;
}
export function processPoolStatuses(db,snapshot,config){
  if(config.audienceId&&config.audienceId!=='shared')return;
  const now=snapshot.observedAt,valid=snapshot.markets.filter(p=>Number.isInteger(p.status)&&p.status>=0&&p.status<POOL_STATUSES.length);
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of db.prepare("SELECT id,pool FROM outbox WHERE audience='shared' AND category='pool_status' AND status='pending'").all())if(!valid.some(p=>p.id===row.pool))db.prepare("UPDATE outbox SET status='suppressed' WHERE id=?").run(row.id);
    for(const pool of valid){
      const key=`pool-status:${config.mode}:${pool.id}`,state=getState(db,key,{value:pool.status,sequence:0});
      const cancel=()=>{if(state.pendingId)db.prepare("UPDATE outbox SET status='suppressed' WHERE id=? AND status='pending'").run(state.pendingId);};
      let row=state.pendingId?db.prepare('SELECT status,attempts FROM outbox WHERE id=?').get(state.pendingId):null;
      if(state.pendingId&&(!row||['sent','recorded','sending','uncertain','failed','preview'].includes(row.status))){state.value=state.pendingValue;delete state.pendingId;row=null;}
      if(state.value===pool.status){cancel();delete state.pendingId;}
      else{
        if(state.pendingId&&state.pendingValue!==pool.status){cancel();delete state.pendingId;row=null;}
        if(row?.status!=='pending'&&!(row?.attempts>=4)){
          const label=pool.status<=1?'Pool active; borrowing enabled.':pool.status<=3?'New borrowing disabled.':'New borrowing and supplies disabled.';
          const payload=message(`Pool status · ${pool.name}`,`**${POOL_STATUSES[state.value]} → ${POOL_STATUSES[pool.status]}**\n${label}`);
          Object.assign(payload.embeds[0],{color:pool.status<=1?0x22C55E:pool.status<=3?0xF59E0B:0xEF4444,timestamp:new Date(now*1000).toISOString(),url:'https://blnt.trade/',footer:{text:'On-chain pool status · Other transaction checks still apply'}});
          if(!state.pendingId){state.sequence++;state.pendingId=`${key}:${state.sequence}`;}
          state.pendingValue=pool.status;
          enqueue(db,state.pendingId,now,payload,config.mode,{audience:'shared',category:'pool_status',pool:pool.id,severity:pool.status>=4?1:pool.status>=2||state.value>=2?2:4});
        }
      }
      setState(db,key,state);
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
