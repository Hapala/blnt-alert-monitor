export function healthFailures({shared,personal,subscriber,discovery,ledgerTime,wallTime,botId,commands}){
  const failures=[],fresh=(time,max,clock=ledgerTime)=>Number.isFinite(time)&&clock-time>=-15&&clock-time<=max;
  if(!shared.ready||!fresh(shared.observedAt,300))failures.push('Shared data unavailable or stale');
  if(!personal.active||personal.mode!=='live'||personal.botId!==botId||personal.failures!==0||!fresh(personal.heartbeatAt,180)||!fresh(personal.sourceObservedAt,300))failures.push('Personal worker stopped, stale or failing');
  if(!subscriber?.enabled)failures.push('Subscription disabled');
  if(discovery?.wallet!==subscriber?.wallet||!fresh(discovery?.checkedAt,900)||Object.values(discovery?.pools??{}).some(p=>p.stale))failures.push('Wallet discovery unavailable or stale');
  if(commands.length!==1||commands[0].name!=='blnt-alerts')failures.push('Unexpected command registry');
  return failures;
}
