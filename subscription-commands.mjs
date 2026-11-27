import {defaults,saveSubscriber,getSubscriber,updatePreferences,disableSubscriber,CATEGORIES} from './subscriptions.mjs';
import {getState,setState} from './engine.mjs';
import {borrowingStatus} from './borrow-alerts.mjs';
import {forgetSubscriber} from './retention.mjs';
const text=(name,description,required=false,choices)=>({type:3,name,description,required,...(choices?{choices}: {})});
export function commandDefinition(registry) {
  const pools=registry.pools.map(p=>({name:p.name,value:p.id}));
  const sub=(name,description,options=[])=>({type:1,name,description,options});
  const muteOptions=[text('category','Notification category or all',false,[...CATEGORIES,'all'].map(v=>({name:v,value:v}))),text('pool','Pool to mute',false,pools)];
  return {name:'blnt-alerts',description:'Private BLNT wallet subscriptions and notifications',type:1,contexts:[0,1],integration_types:[0],options:[
    sub('subscribe','Opt in to DM alerts for a public wallet',[text('wallet','Public Stellar address; never a secret key',true)]),
    sub('active','View shared alarms and recent events at all severities',[{type:4,name:'page',description:'Results page (10 entries each)',min_value:1,max_value:1000}]),
    sub('status','Show your private subscription settings'),sub('pools','Show automatic, extra and muted pools'),
    sub('add-pool','Follow another supported pool',[text('pool','Additional pool',true,pools)]),
    sub('remove-pool','Remove a manually added pool',[text('pool','Additional pool',true,pools)]),
    sub('mute','Mute a category or a pool',muteOptions),sub('unmute','Unmute a category or a pool',muteOptions),
    sub('pause','Pause all personal alerts'),sub('resume','Resume personal alerts'),
    sub('snooze','Temporarily pause personal alerts',[{type:4,name:'minutes',description:'Minutes to pause',required:true,min_value:1,max_value:10080}]),
    sub('unsubscribe','Stop personal notifications'),sub('forget','Delete your stopped subscription and local history',[text('confirm','Choose DELETE after unsubscribing',true,[{name:'DELETE my stopped subscription data',value:'DELETE'}])]),sub('test','Send a private delivery test'),
    sub('borrowing','Show your borrowing data and configured thresholds'),
    sub('capacity','Set low remaining borrowing-capacity thresholds for one pool',[
      text('pool','Pool and quote currency',true,pools),
      {type:10,name:'percent',description:'Alert below this percent remaining, 0–100 (up to 6 decimals)',min_value:0,max_value:100},
      text('amount','Alert below this amount in the pool quote, up to 7 decimals'),
      {type:5,name:'clear',description:'Turn off both capacity thresholds for this pool'}]),
    sub('rate','Set the high annual borrow APR threshold for one pool',[
      text('pool','Pool to monitor',true,pools),
      {type:10,name:'apr',description:'Alert above this annual percentage rate (APR)',min_value:0,max_value:100000},
      text('scope','Default: only reserves you currently borrow',false,[{name:'My borrowed assets',value:'borrowed'},{name:'All enabled assets in this selected pool',value:'selected-pools'}]),
      {type:5,name:'clear',description:'Turn off the borrow APR threshold for this pool'}]),
  ]};
}
export function applyCommand(db,id,name,args,registry,now) {
  if(name==='forget')return forgetSubscriber(db,id,args.confirm);
  const current=getSubscriber(db,id);
  if(name==='subscribe') {
    saveSubscriber(db,id,args.wallet,now);setState(db,`dm-delivery:${id}`,{blocked:false});
    return 'Subscribed. Your public wallet will be checked for supply, collateral, debt and backstop exposure. Extra pools are optional. Personal messages are sent only to your DMs.';
  }
  if(!current)throw Error('Use /blnt-alerts subscribe first');
  if(name==='capacity'||name==='rate'){
    if(!args.pool||!registry.pools.some(p=>p.id===args.pool))throw Error('Choose a supported pool');
    if(args.clear&&(args.percent!=null||args.amount!=null||args.apr!=null||args.scope!=null))throw Error('Use clear alone with the pool choice');
    if(!args.clear&&(name==='capacity'?args.percent==null&&args.amount==null:args.apr==null&&args.scope==null))throw Error('Provide a threshold or clear:true');
    const changed=updatePreferences(db,id,p=>{
      const r={...(p.riskRules[args.pool]??{capacityPercent:null,capacityAmount:null,borrowApr:null,rateScope:'borrowed',version:0})};
      if(name==='capacity'){
        if(args.clear){r.capacityPercent=null;r.capacityAmount=null;}
        else {if(args.percent!=null)r.capacityPercent=String(args.percent);if(args.amount!=null)r.capacityAmount=String(args.amount);}
      }else if(args.clear)r.borrowApr=null;
      else {if(args.apr!=null)r.borrowApr=String(args.apr);if(args.scope!=null)r.rateScope=args.scope;}
      r.version++;p.riskRules[args.pool]=r;
    },registry);
    return '**Borrowing rule saved.** Other thresholds are unchanged.\n'+borrowingStatus(changed,null,registry,now);
  }
  if(name==='borrowing')return borrowingStatus(current,getState(db,`borrowing:${id}`,null),registry,now);
  if(name==='unsubscribe'){disableSubscriber(db,id);return 'Unsubscribed. Pending personal notifications were suppressed.';}
  if(name==='resume') {
    if(!current.enabled)throw Error('Use subscribe again to renew consent after unsubscribing');
    updatePreferences(db,id,p=>{p.paused=false;p.snoozeUntil=0;},registry);setState(db,`dm-delivery:${id}`,{blocked:false});return 'Personal alerts resumed. Blocked delivery will be retried.';
  }
  if(name==='pause'){updatePreferences(db,id,p=>{p.paused=true;},registry);return 'Personal alerts paused.';}
  if(name==='snooze') {
    if(!Number.isInteger(args.minutes)||args.minutes<1||args.minutes>10080)throw Error('Choose 1–10080 minutes');
    updatePreferences(db,id,p=>{p.snoozeUntil=now+args.minutes*60;},registry);return `Personal alerts snoozed for ${args.minutes} minutes.`;
  }
  if(['add-pool','remove-pool'].includes(name)) {
    updatePreferences(db,id,p=>{p.extraPools=name==='add-pool'?[...new Set([...p.extraPools,args.pool])]:p.extraPools.filter(v=>v!==args.pool);},registry);
    return name==='add-pool'?'Extra pool added. A pool mute still takes precedence.':'Extra pool removed. An active wallet position can still automatically follow it; use mute to exclude it.';
  }
  if(['mute','unmute'].includes(name)) {
    if(Boolean(args.pool)===Boolean(args.category))throw Error('Choose exactly one category or pool');
    const mute=name==='mute';
    updatePreferences(db,id,p=>{
      if(args.category==='all')p.paused=mute;
      else {const key=args.pool?'mutedPools':'mutedCategories',value=args.pool??args.category;p[key]=mute?[...new Set([...p[key],value])]:p[key].filter(v=>v!==value);}
    },registry);return mute?'Mute saved. Pending personal notifications were suppressed.':'Unmuted. New eligible alerts can be delivered.';
  }
  if(name==='status'||name==='pools') {
    const discovery=getState(db,`discovery:${id}`,null),names=ids=>ids.map(v=>registry.pools.find(p=>p.id===v)?.name??v).join(', ')||'none';
    const automatic=Object.entries(discovery?.pools??{}).filter(([,p])=>p.associated).map(([v])=>v);
    const stale=Object.values(discovery?.pools??{}).some(p=>p.stale);
    return `**Wallet:** ${current.wallet}\n**Subscription:** ${current.enabled?'Subscribed':'Unsubscribed'}\n**Personal alerts:** ${current.preferences.paused?'Paused':'Not paused'}\n**Automatic pools:** ${names(automatic)}${stale?' (discovery incomplete/stale)':''}\n**Extra pools:** ${names(current.preferences.extraPools)}\n**Muted pools:** ${names(current.preferences.mutedPools)}\n**Muted categories:** ${current.preferences.mutedCategories.join(', ')||'none'}\n**Snooze:** ${current.preferences.snoozeUntil>now?'Until '+new Date(current.preferences.snoozeUntil*1000).toISOString():'Not snoozed'}\n**DM delivery:** ${getState(db,`dm-delivery:${id}`,{}).blocked?'Blocked — allow DMs, then use /blnt-alerts resume':'Not blocked'}\n**Discovery time:** ${discovery?new Date(discovery.checkedAt*1000).toISOString():'Not checked yet'}\n**Borrowing alerts:** ${Object.values(current.preferences.riskRules??{}).some(r=>r.capacityPercent!=null||r.capacityAmount!=null||r.borrowApr!=null)?'Thresholds configured; pause and mute settings still apply.':'Not enabled — no capacity or interest-rate thresholds set.'} Use /blnt-alerts borrowing for each pool’s rules.`;
  }
  if(name==='test'){if(!current.enabled)throw Error('Subscribe again before requesting a test');return 'test';}
  throw Error('Unknown BLNT subscription command');
}
