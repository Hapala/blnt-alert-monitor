import {getState,setState,enqueue,message,reconcileAlert} from './engine.mjs';
import {integer,ceilDiv,formatUnits,decimal,PERCENT,S7,S12} from './borrow-math.mjs';
export function reserveLiquidity(reserve){
  const supply=integer(reserve.data.b_supply)*integer(reserve.data.b_rate)/S12;
  const debt=ceilDiv(integer(reserve.data.d_supply)*integer(reserve.data.d_rate),S12);
  return {ready:supply>0n||debt>0n,emptyWithDebt:supply===0n&&debt>0n,decimals:Number(integer(reserve.config.decimals)),
    supplyRaw:String(supply),debtRaw:String(debt),unborrowedRaw:String(supply>debt?supply-debt:0n),utilizationRaw:supply>0n?String(ceilDiv(debt*S7,supply)):null};
}
export function liquiditySettings(config){
  const rules=config.liquidityAlerts??{enabled:true,warningPercent:'90',criticalPercent:'95',recoveryPercent:'85',cooldownSeconds:21600};
  if(!rules.enabled)return null;
  const warning=decimal(rules.warningPercent),critical=decimal(rules.criticalPercent),recovery=decimal(rules.recoveryPercent);
  if(recovery>=warning||warning>=critical||critical>100n*PERCENT||!Number.isInteger(rules.cooldownSeconds)||rules.cooldownSeconds<3600)throw Error('Invalid liquidity thresholds');
  return {...rules,warning,critical,recovery};
}
export function liquidityChecksDue(db,now,config){
  if(!liquiditySettings(config))return false;
  const last=getState(db,'publicRatesLastAttempt',null);
  return last==null||now<last||now-last>=300;
}
export function processLiquidity(db,snapshot,config){
  if(config.audienceId&&config.audienceId!=='shared')return;
  const rules=liquiditySettings(config),now=snapshot.observedAt,report=snapshot.borrowRates;
  const fresh=rules&&report&&report.checkedAt<=now+15&&now-report.checkedAt<=180;
  const valid=[];
  if(fresh)for(const pool of report.pools.filter(p=>p.available&&snapshot.markets.some(m=>m.id===p.id)))for(const rate of pool.rates)if(rate.liquidity?.ready)valid.push({pool,rate});
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of db.prepare("SELECT id,pool FROM outbox WHERE audience='shared' AND category='liquidity' AND status='pending'").all())if(!valid.some(({pool,rate})=>pool.id===row.pool&&rate.asset===row.id.split(':')[3]))db.prepare("UPDATE outbox SET status='suppressed' WHERE id=?").run(row.id);
    for(const {pool,rate} of valid){
      const l=rate.liquidity,supply=BigInt(l.supplyRaw),debt=BigInt(l.debtRaw),lhs=debt*100n*PERCENT;
      const warning=l.emptyWithDebt||lhs>=supply*rules.warning,critical=l.emptyWithDebt||lhs>=supply*rules.critical,recovered=!l.emptyWithDebt&&lhs<=supply*rules.recovery;
      const level=critical?2:warning?1:0,key=`liquidity:${config.mode}:${pool.id}:${rate.asset}`;
      let state=reconcileAlert(db,getState(db,key,{armed:true,last:0,lastLevel:0,sequence:0}));
      if(state.warningId&&db.prepare('SELECT status FROM outbox WHERE id=?').get(state.warningId)?.status==='sent')state.wasWarned=true;
      const cancel=id=>{if(id)db.prepare("UPDATE outbox SET status='suppressed' WHERE id=? AND status='pending'").run(id);};
      const queue=(kind,title,color)=>{
        const utilization=l.emptyWithDebt?'**No supplied liquidity**':`**${formatUnits((BigInt(l.utilizationRaw)+500n)/1000n,2)}% of supply borrowed**`;
        const payload=message(`${title} · ${rate.symbol}`,`**${pool.name}** · ${utilization}\nEst. unborrowed supply: **${formatUnits(BigInt(l.unborrowedRaw),l.decimals)} ${rate.symbol}**`);
        Object.assign(payload.embeds[0],{color,timestamp:new Date(report.checkedAt*1000).toISOString(),url:'https://blnt.trade/',footer:{text:'Supply/debt estimate · Not guaranteed withdrawable'}});
        const id=`${key}:${kind}:${state.sequence}`;enqueue(db,id,now,payload,config.mode,{audience:'shared',category:'liquidity',pool:pool.id});return id;
      };
      if(warning&&!critical&&state.lastLevel===2&&db.prepare('SELECT status FROM outbox WHERE id=?').get(state.warningId)?.status==='pending'){
        cancel(state.warningId);state=reconcileAlert(db,state);
      }
      if(!warning)cancel(state.warningId);
      if(!recovered)cancel(state.recoveryId);
      if(recovered&&(!state.armed||state.recoveryId||state.wasWarned)){
        if(state.wasWarned)state.recoveryId=queue('recovery','Liquidity improved',0x22C55E);
        state.armed=true;delete state.pendingId;
      }
      const escalation=critical&&state.lastLevel===1;
      if(warning&&(state.armed&&now-state.last>=rules.cooldownSeconds||escalation)){
        if(!escalation)state.wasWarned=false;
        cancel(state.warningId);cancel(state.recoveryId);delete state.recoveryId;state.sequence++;
        state.warningId=queue('warning',critical?'Liquidity very tight':'Liquidity tight',critical?0xEF4444:0xF59E0B);
        state.beforeQueuedLast=state.last;state.beforeQueuedLevel=state.lastLevel;state.pendingId=state.warningId;state.last=now;state.lastLevel=level;state.armed=false;
      }
      setState(db,key,state);
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
