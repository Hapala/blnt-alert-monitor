import {getState,setState,enqueue,message} from './engine.mjs';
import {decimal,formatUnits,S7,PERCENT} from './borrow-math.mjs';
export function validateRiskRules(rules,registry){
  if(!rules||typeof rules!=='object'||Array.isArray(rules))throw Error('Invalid borrowing rules');
  for(const [pool,r] of Object.entries(rules)){
    if(!registry.pools.some(p=>p.id===pool)||!r||typeof r!=='object')throw Error('Unsupported borrowing pool');
    if(r.capacityPercent!=null&&decimal(r.capacityPercent)>100n*PERCENT)throw Error('Capacity percentage must be 0–100');
    if(r.capacityAmount!=null)decimal(r.capacityAmount,7);
    if(r.borrowApr!=null&&decimal(r.borrowApr)>100000n*PERCENT)throw Error('Borrow APR threshold must be 0–100000%');
    if(r.rateScope!=null&&!['borrowed','selected-pools'].includes(r.rateScope))throw Error('Unknown borrow-rate scope');
    if(!Number.isInteger(r.version)||r.version<1)throw Error('Invalid rule revision');
  }
}
export function hasRiskRules(sub){return Object.values(sub.preferences.riskRules??{}).some(r=>r.capacityPercent!=null||r.capacityAmount!=null||r.borrowApr!=null);}
export function suppressRiskPending(db,id,pool,category){
  db.prepare("UPDATE outbox SET status='suppressed' WHERE audience=? AND pool=? AND category=? AND status='pending'").run(id,pool,category);
}
export function processBorrowing(db,sub,report,selected,config){
  const now=report.checkedAt,allowed=new Set(selected);
  if(!sub.enabled||sub.preferences.paused||sub.preferences.snoozeUntil>now||report.wallet!==sub.wallet)return;
  for(const [pool,data] of Object.entries(report.pools)){
    const rule=sub.preferences.riskRules?.[pool]??{};
    const eligible=allowed.has(pool)&&!data.stale&&now-report.sourceObservedAt<=180;
    for(const category of ['capacity','borrow_rate'])if(!eligible||sub.preferences.mutedCategories.includes(category))suppressRiskPending(db,sub.id,pool,category);
    if(!eligible)continue;
    const notify=(kind,category,breach,recovered,title,description)=>{
      if(sub.preferences.mutedCategories.includes(category))return;
      const key=`risk:${sub.id}:${sub.wallet}:${config.mode}:${pool}:${rule.version}:${kind}`;
      const state=getState(db,key,{armed:true,last:0,sequence:0});
      if(!breach)for(const row of db.prepare("SELECT id FROM outbox WHERE audience=? AND pool=? AND category=? AND status='pending'").all(sub.id,pool,category))if(row.id.startsWith(key+':'))db.prepare("UPDATE outbox SET status='suppressed' WHERE id=?").run(row.id);
      if(recovered)state.armed=true;
      if(breach&&state.armed&&now-state.last>=3600){
        state.sequence++;
        const payload=message(`${config.trial?'[PRIVATE TRIAL] ':''}${category==='capacity'?'⚠️':'📈'} ${title}`,
          description+`\n\n**Pool:** ${data.name}\nManage with \`/blnt-alerts capacity\`, \`rate\` or \`mute\`.`);
        payload.embeds[0].color=category==='capacity'?0xF59E0B:0xEF4444;
        payload.embeds[0].timestamp=new Date(now*1000).toISOString();
        payload.embeds[0].footer={text:'BLNT • Borrowing alerts'};
        enqueue(db,`${key}:${state.sequence}`,now,payload,config.mode,{audience:sub.id,category,pool});
        state.armed=false;state.last=now;
      }
      setState(db,key,state);
    };
    const c=data.capacity;
    if(c?.ready&&c.relevant){
      const remaining=BigInt(c.remaining),limit=BigInt(c.limit),scale=10n**BigInt(c.quoteDecimals);
      const details=`Remaining risk-adjusted borrowing headroom: **${c.amountRemaining} ${data.quote}** (**${c.percentRemaining}%** of your limit).\n\nThis is a risk-adjusted credit measure; the amount of a particular token you can borrow also depends on its liability factor, available liquidity and pool restrictions.`;
      if(rule.capacityPercent!=null){const t=decimal(rule.capacityPercent),lhs=remaining*100n*PERCENT;
        const recovery=t+2n*PERCENT>100n*PERCENT?100n*PERCENT:t+2n*PERCENT;
        notify('capacity-percent','capacity',limit===0n?t>0n:lhs<limit*t,limit>0n&&lhs>=limit*recovery,'Low borrowing capacity',`Your remaining capacity is below **${rule.capacityPercent}%**.\n${details}`);
      }
      if(rule.capacityAmount!=null){const threshold=decimal(rule.capacityAmount,7),lhs=remaining*10000000n,rhs=threshold*scale;
        notify('capacity-amount','capacity',lhs<rhs,lhs>=rhs+((rhs/10n)>scale*10000000n?rhs/10n:scale*10000000n),'Low borrowing capacity',`Your remaining capacity is below **${rule.capacityAmount} ${data.quote}**.\n${details}`);
      }
    }else suppressRiskPending(db,sub.id,pool,'capacity');
    const activeRateKeys=new Set();
    if(rule.borrowApr!=null)for(const rate of data.rates??[]){
      if(rule.rateScope!=='selected-pools'&&!rate.borrowed)continue;
      const t=decimal(rule.borrowApr),value=BigInt(rate.aprRaw)*100n*PERCENT;
      const kind=`rate:${rate.asset}`;activeRateKeys.add(kind);
      const margin=t/10n<PERCENT?t/10n:PERCENT;
      notify(kind,'borrow_rate',value>t*S7,value<=(t-margin)*S7,'High borrow interest rate',`**${rate.symbol}** borrow APR is **${rate.aprPercent}%**, above your **${rule.borrowApr}%** threshold.\n\n${rate.borrowed?'You have an outstanding borrow in this reserve.':'This is an offered rate in a pool you chose to watch; it is not a charge on your wallet.'}\nAPR is annualized and variable, not APY.\nAsset: \`${rate.asset}\``);
    }
    // A rate queued before repayment is no longer a personal borrowing alert.
    for(const row of db.prepare("SELECT id FROM outbox WHERE audience=? AND pool=? AND category='borrow_rate' AND status='pending'").all(sub.id,pool))if(![...activeRateKeys].some(kind=>row.id.includes(`:${kind}:`)))db.prepare("UPDATE outbox SET status='suppressed' WHERE id=?").run(row.id);
  }
}
export function borrowingStatus(sub,report,registry,now){
  const p=sub.preferences;
  const delivery=!sub.enabled?'Stopped — subscription disabled':p.paused?'Paused — no personal alerts will be sent':p.snoozeUntil>now?'Snoozed — personal alerts are temporarily paused':'Active — configured, unmuted rules can send DMs';
  const lines=[`**Personal alert delivery:** ${delivery}.\n**Not enabled** means no threshold is set; it does not mean the pool or borrowing is disabled. Amounts use each pool’s quote (USD or USDC), without conversion.`];
  for(const pool of registry.pools){
    const r=sub.preferences.riskRules?.[pool.id]??{},data=report?.wallet===sub.wallet?report.pools[pool.id]:null;
    lines.push(`\n**${pool.name}**\n• Capacity percentage: ${r.capacityPercent==null?'Not enabled':`Alert below **${r.capacityPercent}%** remaining`}.\n• Capacity amount: ${r.capacityAmount==null?'Not enabled':`Alert below **${r.capacityAmount} ${pool.quoteLabel}** remaining`}.\n• Borrow interest: ${r.borrowApr==null?'Not enabled':`Alert above **${r.borrowApr}% APR**`}.`);
    if(r.borrowApr!=null)lines.push(`Rate scope: ${r.rateScope==='selected-pools'?'all enabled borrowing assets in this pool':'only assets you currently borrow'}.`);
    if(p.mutedPools.includes(pool.id))lines.push('**Pool muted:** its alerts will not be sent.');
    else {const muted=['capacity','borrow_rate'].filter(v=>p.mutedCategories.includes(v));if(muted.length)lines.push('**Muted:** '+muted.map(v=>v==='capacity'?'capacity alerts':'interest-rate alerts').join(', ')+'.');}
    if(!report){lines.push('Live data not refreshed in this response; use `/blnt-alerts borrowing`.');continue;}
    if(now-report.checkedAt>180||report.checkedAt>now+15||data?.stale){lines.push('Current data unavailable or stale; no new borrowing alert is triggered from it.');continue;}
    if(!data){lines.push('Current data not requested for this pool.');continue;}
    if(data?.capacity?.ready&&!data.capacity.relevant)lines.push('No collateral or debt positions; capacity alerts do not apply.');
    else if(data?.capacity?.ready)lines.push(`**Remaining headroom:** ${data.capacity.amountRemaining} ${pool.quoteLabel} (${data.capacity.percentRemaining}% of your risk-adjusted limit).`);
    else lines.push('Capacity unavailable: incomplete or stale cross-check inputs.');
    if(data?.rates?.length)lines.push('Borrow APR: '+data.rates.map(v=>`${v.symbol} ${v.aprPercent}%${v.borrowed?' (borrowed)':''}`).join(', '));
    else lines.push('No borrowing assets in the current rate scope.');
  }
  lines.push('\nConfigure with `/blnt-alerts capacity` or `/blnt-alerts rate`; saving one rule leaves the others unchanged.');
  return lines.join('\n');
}
