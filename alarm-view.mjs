import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {activeAlarms} from './alarms.mjs';
import {monitoringClock} from './health-alerts.mjs';

const text=value=>String(value).replace(/[\r\n]+/g,' ').replace(/([\\`*_~|<>])/g,'\\$1');
const minutes=seconds=>`${Math.max(0,Math.floor(seconds/60))}m`;
function read(db,mode,now){
  try{return {available:true,rows:activeAlarms(db,mode,now),tracked:db.prepare('SELECT COUNT(*) n FROM alarms WHERE mode=?').get(mode).n};}
  catch{return {available:false,rows:[],tracked:0};}
}
export function sharedAlarmReport({main,health,mode,now,page=1,clockAvailable=true,paused=false}){
  if(!['live','dry-run'].includes(mode)||!Number.isSafeInteger(now)||!Number.isInteger(page)||page<1||page>1000)throw Error('Invalid alarm view request');
  const shared=read(main,mode,now),monitor=read(health,mode,now);
  const rows=[...shared.rows,...monitor.rows].map(row=>({...row,status:!clockAvailable||paused?'unknown':row.status}));
  const sort=(a,b)=>a.severity-b.severity||a.openedAt-b.openedAt||a.key.localeCompare(b.key);
  const conditions=rows.filter(r=>r.expiresAt==null).sort(sort),events=rows.filter(r=>r.expiresAt!=null).sort(sort);
  const all=[...conditions,...events],pages=Math.max(1,Math.ceil(all.length/10));page=Math.min(page,pages);
  const lines=[`**Shared alarms · ${mode}**`,`Conditions: **${conditions.length}** (${conditions.filter(r=>r.status==='unknown').length} unknown) · Recent events: **${events.length}** · Page **${page}/${pages}**`];
  if(!shared.available)lines.push('⚠️ Shared alarm state unavailable.');
  else if(!shared.tracked)lines.push('Shared rules have not been evaluated yet.');
  if(!monitor.available)lines.push('⚠️ Monitoring alarm state unavailable.');
  else if(!monitor.tracked)lines.push('Monitoring rules have not been evaluated yet.');
  if(!clockAvailable)lines.push('⚠️ Source clock unavailable; values are last known.');
  if(paused)lines.push('Monitoring paused; conditions are last known.');
  if(!all.length)lines.push('No active conditions or recent events recorded. This is not an all-clear.');
  for(const row of all.slice((page-1)*10,page*10)){
    const icon={1:'🔴',2:'🟠',3:'🔵',4:'⚪'}[row.severity];
    const state=row.status==='unknown'?`**Unknown** · last verified ${minutes(now-row.lastObservedAt)} ago`:row.expiresAt!=null?`event · expires in ${minutes(row.expiresAt-now)}`:`open ${minutes(now-row.openedAt)}`;
    lines.push(`${icon} **Sev ${row.severity} · ${text(row.label)}**\n${text(row.detail)} · ${state}`);
  }
  if(pages>1)lines.push('Use `/blnt-alerts active page:<number>` for other pages.');
  lines.push('Shared pool data only. Unknown does not mean resolved; recent events expire after one hour.');
  return lines.join('\n\n');
}
export function readSharedAlarmReport(home,page=1,hostNow=Math.floor(Date.now()/1000)){
  let main,health;
  try{
    const config=JSON.parse(readFileSync(resolve(home,'config.json')));let snapshot;
    try{snapshot=JSON.parse(readFileSync(resolve(home,'data/latest.json')));}catch{}
    const clockAvailable=Number.isFinite(snapshot?.observedAt)&&Number.isFinite(snapshot?.hostObservedAt)&&hostNow>=snapshot.hostObservedAt-15;
    try{main=new DatabaseSync(resolve(home,'data/monitor.sqlite'),{readOnly:true});}catch{}
    try{health=new DatabaseSync(resolve(home,'data/health.sqlite'),{readOnly:true});}catch{}
    return sharedAlarmReport({main,health,mode:config.mode,now:monitoringClock(snapshot,hostNow),page,clockAvailable,paused:config.paused||existsSync(resolve(home,'PAUSED'))});
  }catch{return 'Shared alarm view unavailable. No settings were changed.';}
  finally{main?.close();health?.close();}
}
