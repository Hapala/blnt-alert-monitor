import {DatabaseSync} from 'node:sqlite';
import {severityLevel,defaultSeverity,severityPayload} from './severity.mjs';
import {initAlarms,observeAlarm,markMissingAlarms,pruneAlarms} from './alarms.mjs';

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS samples (key TEXT, t INTEGER, observed INTEGER, price REAL, PRIMARY KEY(key,t));
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, created INTEGER, status TEXT, payload TEXT, attempts INTEGER DEFAULT 0, next INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS runs (t INTEGER PRIMARY KEY, snapshot TEXT);`);
  if(!db.prepare('PRAGMA table_info(samples)').all().some(c=>c.name==='priceRaw'))db.exec('ALTER TABLE samples ADD COLUMN priceRaw TEXT');
  const outboxColumns=new Set(db.prepare('PRAGMA table_info(outbox)').all().map(c=>c.name));
  for(const [name,type] of [['audience',"TEXT NOT NULL DEFAULT 'shared'"],['category',"TEXT NOT NULL DEFAULT 'uncategorized'"],['pool','TEXT'],['severity','INTEGER NOT NULL DEFAULT 2']])if(!outboxColumns.has(name))db.exec(`ALTER TABLE outbox ADD COLUMN ${name} ${type}`);
  initAlarms(db);return db;
}
export function reachesThreshold(currentRaw,baselineRaw,percent,direction) {
  const current=BigInt(currentRaw),baseline=BigInt(baselineRaw);
  const delta=direction==='up'?current-baseline:baseline-current;
  return delta*100000000n>=baseline*BigInt(Math.round(percent*1000000));
}
export function getState(db, key, fallback) {
  const row = db.prepare('SELECT value FROM state WHERE key=?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function setState(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO state VALUES (?,?)').run(key, JSON.stringify(value));
}
export function enqueue(db, id, now, payload, mode, routing={}) {
  const audience=routing.audience??'shared',severity=severityLevel(routing.severity??defaultSeverity(routing.category));
  db.prepare(`INSERT INTO outbox(id,created,status,payload,audience,category,pool,severity) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET created=excluded.created,status=excluded.status,payload=excluded.payload,severity=excluded.severity
    WHERE outbox.status IN ('suppressed','expired') AND outbox.attempts<4`)
    .run(id, now, mode === 'live' ? 'pending' : 'preview', JSON.stringify(audience==='shared'?severityPayload(payload,severity):payload),audience,routing.category??'uncategorized',routing.pool??null,severity);
}
// Only definitely unsent cancellations may re-arm a condition. Never replay an
// uncertain/in-flight/accepted delivery, even after preferences change.
export function reconcileAlert(db,state){
  if(state.pendingId){
    const row=db.prepare('SELECT status FROM outbox WHERE id=?').get(state.pendingId);
    if(row&&['suppressed','expired'].includes(row.status)){state.armed=true;state.last=state.beforeQueuedLast??0;if('beforeQueuedLevel' in state)state.lastLevel=state.beforeQueuedLevel;delete state.pendingId;}
    else if(['sent','recorded'].includes(row?.status))delete state.pendingId;
  }
  return state;
}
export function message(title, description, fields = []) {
  return {username: 'BLNT Alerts', allowed_mentions: {parse: []}, embeds: [{title, description, fields, color: 3447003}]};
}
export function dailyDigestSlot(snapshot,c){
  const local=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:c.digestTimezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(snapshot.observedAt*1000)).map(p=>[p.type,p.value]));
  const enabled=c.audienceId&&c.audienceId!=='shared'||c.sharedDigestEnabled!==false;
  return {due:Boolean(enabled)&&Number(local.hour)>=c.digestHour&&snapshot.observations.length>0,key:`${snapshot.source??'website'}:${c.mode}:digest:${local.year}-${local.month}-${local.day}`};
}
export function priceAlertSettings(c,audience='shared'){
  const rules=audience==='shared'?c.publicPriceAlerts:null;
  if(!rules)return {thresholdPercent:c.thresholdPercent,rearmPercent:c.rearmPercent,cooldownSeconds:c.cooldownSeconds};
  for(const k of ['thresholdPercent','rearmPercent','cooldownSeconds','largePercent','largeCooldownSeconds','escalationSeconds'])if(!Number.isFinite(rules[k])||rules[k]<=0)throw Error('Invalid public price rules');
  if(rules.rearmPercent>=rules.thresholdPercent||rules.thresholdPercent>=rules.largePercent||rules.cooldownSeconds<3600||rules.largeCooldownSeconds<3600||rules.escalationSeconds<300)throw Error('Invalid public price tiers');
  return rules;
}
export function dailyStatusMessage(snapshot,c,{preview=false,personal=false}={}) {
  const groups=new Map(),shown=snapshot.observations.slice(0,20);
  const report=snapshot.borrowRates,rateFresh=report&&report.checkedAt<=snapshot.observedAt+15&&snapshot.observedAt-report.checkedAt<=180;
  for(const o of shown){
    const name=`${o.poolName} · ${o.quote}`;
    if(!groups.has(name))groups.set(name,[]);
    const pool=rateFresh?report.pools.find(p=>p.id===o.pool&&p.available):null;
    const rate=pool?.rates.find(r=>r.asset===o.asset);
    groups.get(name).push(`**${o.symbol}** ${o.priceExact??o.price.toPrecision(8)} · ${rate?`**${rate.aprPercent}% APR**`:'APR unavailable'}${o.alertEligible===false?' · price unverified':''}`);
  }
  const fields=[];
  for(const [name,lines] of groups){
    let value='';for(const line of lines){if(value.length+line.length+1>1024){fields.push({name,value,inline:false});value='';}value+=(value?'\n':'')+line;}
    if(value)fields.push({name,value,inline:false});
  }
  // Rates without a price still belong in the digest; never hide failed price coverage.
  for(const pool of snapshot.markets){
    const data=rateFresh?report.pools.find(p=>p.id===pool.id):null,name=`${pool.name} · Borrow APR`;
    if(!data?.available){if(!shown.some(o=>o.pool===pool.id))fields.push({name,value:'Unavailable',inline:false});continue;}
    const lines=data.rates.filter(r=>!shown.some(o=>o.pool===pool.id&&o.asset===r.asset)).map(r=>`**${r.symbol}** price unavailable · **${r.aprPercent}% APR**`);
    let value='';for(const line of lines){if(value.length+line.length+1>1024){fields.push({name,value,inline:false});value='';}value+=(value?'\n':'')+line;}
    if(value)fields.push({name,value,inline:false});
  }
  if(snapshot.issues.length||snapshot.crossCheck?.status!=='match')fields.push({name:'Data',value:`${snapshot.issues.length} exclusions · Website: ${snapshot.crossCheck?.status??'not checked'}`,inline:false});
  const omitted=snapshot.observations.length-shown.length;
  const payload=message(`${preview?'[SAMPLE] ':''}${personal?'Your':'BLNT'} daily update`,
    `${preview?'Sample — no alert triggered.\n':''}Price per asset · variable borrow APR (not APY).${omitted?` ${omitted} more prices omitted.`:''}`,fields);
  Object.assign(payload.embeds[0],{color:0x3B82F6,timestamp:new Date(snapshot.observedAt*1000).toISOString(),url:'https://blnt.trade/',footer:{text:`Oracle reference prices · Rates ${rateFresh?new Date(report.checkedAt*1000).toISOString():'unavailable'}`}});
  return payload;
}
export function processSnapshot(db, snapshot, c) {
  const now = snapshot.observedAt;
  const prefix='';
  const audience=c.audienceId??'shared',scope=audience==='shared'?'':`subscriber:${audience}:`;
  const priceRules=priceAlertSettings(c,audience);
  const allowed=category=>!(c.mutedCategories??[]).includes(category);
  const queue=(id,payload,category,pool=null,severity)=>{if(allowed(category))enqueue(db,scope+id,now,payload,c.mode,{audience,category,pool,severity});};
  db.exec('BEGIN IMMEDIATE');
  try {
    const trackedPriceKeys=[];
    // A known-unsent price warning must not outlive verified asset coverage.
    const verified=snapshot.observations.filter(o=>allowed('price')&&o.alertEligible!==false&&o.timestamp<=now+15&&now-o.timestamp<=(o.priceRaw?c.maxOracleAgeSeconds:c.maxCaptureAgeSeconds));
    for(const row of db.prepare("SELECT id FROM outbox WHERE audience=? AND category='price' AND status='pending'").all(audience))
      if(!verified.some(o=>['up','down'].some(direction=>row.id.startsWith(`${scope}${c.mode}:alert:${o.key}:${direction}:`))))db.prepare("UPDATE outbox SET status='suppressed' WHERE id=?").run(row.id);
    if(audience==='shared'&&c.sharedDigestEnabled===false)db.prepare("UPDATE outbox SET status='suppressed' WHERE audience='shared' AND category='digest' AND status='pending'").run();
    if(audience==='shared')db.prepare('INSERT OR REPLACE INTO runs VALUES (?,?)').run(now, JSON.stringify(snapshot));
    for (const o of snapshot.observations) {
      if(o.timestamp>now+15||now-o.timestamp>(o.priceRaw?c.maxOracleAgeSeconds:c.maxCaptureAgeSeconds))continue;
      db.prepare('INSERT OR IGNORE INTO samples(key,t,observed,price,priceRaw) VALUES (?,?,?,?,?)').run(o.key, o.timestamp, now, o.price,o.priceRaw??null);
      if(o.alertEligible===false||(!allowed('price')&&audience!=='shared'))continue;
      const rows = db.prepare('SELECT t,price,priceRaw FROM samples WHERE key=? AND t>=? AND t<=? ORDER BY t')
        .all(o.key, now - c.windowSeconds - c.baselineToleranceSeconds, now);
      const target = now - c.windowSeconds;
      const baseline = rows.filter(r => r.t <= target).at(-1);
      if (!baseline || target - baseline.t > c.baselineToleranceSeconds) continue;
      const window = rows.filter(r => r.t >= baseline.t);
      if (window.some((r, i) => i > 0 && r.t - window[i - 1].t > c.maxGapSeconds) || now - window.at(-1).t > c.maxGapSeconds) continue;
      const change = (o.price / baseline.price - 1) * 100;
      for (const direction of ['up', 'down']) {
        const stateKey = `${scope}${c.mode}:alert:${o.key}:${direction}`;
        const state = reconcileAlert(db,getState(db, stateKey, {armed: true, last: 0}));
        const signed = direction === 'up' ? change : -change;
        const exact=Boolean(o.priceRaw&&baseline.priceRaw);
        const rearm=exact?!reachesThreshold(o.priceRaw,baseline.priceRaw,priceRules.rearmPercent,direction):signed<priceRules.rearmPercent;
        const triggered=exact?reachesThreshold(o.priceRaw,baseline.priceRaw,priceRules.thresholdPercent,direction):signed>=priceRules.thresholdPercent;
        const large=priceRules.largePercent!=null&&(exact?reachesThreshold(o.priceRaw,baseline.priceRaw,priceRules.largePercent,direction):signed>=priceRules.largePercent);
        const level=large?'large':'small',cooldown=large?priceRules.largeCooldownSeconds:priceRules.cooldownSeconds;
        const escalation=large&&state.lastLevel==='small'&&now-state.last>=priceRules.escalationSeconds;
        if(audience==='shared'){
          const key=`price:${o.key}:${direction}`;trackedPriceKeys.push(key);
          const validUntil=Math.min(now+300,o.timestamp+(o.priceRaw?c.maxOracleAgeSeconds:c.maxCaptureAgeSeconds),Number.isFinite(snapshot.crossCheck?.checkedAt)?snapshot.crossCheck.checkedAt+c.crossCheckMaxAgeSeconds:Infinity);
          observeAlarm(db,{mode:c.mode,key,category:'price',pool:o.pool,asset:o.asset,label:`${o.poolName} · ${o.symbol} price ${direction}`,detail:`${change>=0?'+':''}${change.toFixed(2)}% over ~1h · ${o.priceExact??o.price} ${o.quote}`,severity:large?2:3,condition:triggered?'active':rearm?'resolved':'hold',now,validUntil});
        }
        if(!allowed('price'))continue;
        if (rearm) state.armed = true;
        if (triggered && (state.armed&&now-state.last>=cooldown||escalation)) {
          if(escalation&&state.pendingId)db.prepare("UPDATE outbox SET status='suppressed' WHERE id=? AND status='pending'").run(state.pendingId);
          const payload=message(`${prefix}${direction==='up'?'📈':'📉'} ${o.symbol}: ${change >= 0 ? '+' : ''}${change.toFixed(2)}% over ~1 hour${large?' · large move':''}`,
            `**${o.poolName}** · **${o.priceExact??o.price.toPrecision(8)} ${o.quote}**\nPreviously ${baseline.price} ${o.quote} · ${Math.round((o.timestamp-baseline.t)/60)} min`);
          Object.assign(payload.embeds[0],{color:direction==='up'?(large?0xF59E0B:0x22C55E):0xEF4444,url:o.sourceUrl,timestamp:new Date(o.timestamp*1000).toISOString(),footer:{text:'Pool oracle reference price'}});
          const id=`${c.mode}:alert:${o.key}:${direction}:${o.timestamp}`;
          queue(id,payload,'price',o.pool,audience!=='shared'||large?2:3);
          state.beforeQueuedLast=state.last;state.beforeQueuedLevel=state.lastLevel??null;state.pendingId=scope+id;
          state.armed = false; state.last = now;state.lastLevel=level;
        }
        setState(db, stateKey, state);
      }
    }
    if(audience==='shared')markMissingAlarms(db,c.mode,'price',trackedPriceKeys,now);
    const marketKey = `${scope}${snapshot.source??'website'}:${c.mode}:markets`;
    const previous = getState(db, marketKey, {});
    for (const market of snapshot.markets) {
      const before = previous[market.id];
      if (before) for (const asset of market.reserves.filter(a => !before.includes(a))) {
        if(audience==='shared')observeAlarm(db,{mode:c.mode,key:`reserve-added:${market.id}:${asset}`,category:'reserve_updates',pool:market.id,asset,label:`${market.name} · reserve added`,detail:asset,severity:4,condition:'active',now,eventId:`${market.id}:${asset}:${now}`,expiresAt:now+3600});
        queue(`${c.mode}:reserve:${market.id}:${asset}:${now}`,
          message(`${prefix}Pool reserve added`, `**Pool:** ${market.name}\n**New reserve:** \`${asset}\`\n**Observed (UTC):** ${new Date(now*1000).toISOString()}\nhttps://blnt.trade/`),'reserve_updates',market.id);
      }
      previous[market.id] = market.reserves;
    }
    setState(db, marketKey, previous);
    const digest=dailyDigestSlot(snapshot,c);
    if (digest.due) {
      queue(digest.key,dailyStatusMessage(snapshot,c,{personal:audience!=='shared'}),'digest');
    }
    if(c.mode==='live'&&c.trial) {
      const o=snapshot.observations.find(o=>o.alertEligible&&o.priceExact);
      // Preserve the historic deduplication ID so cleanup does not repost a sample.
      if(o)queue(`${snapshot.source}:private-trial:format-preview:v1`,
        message('[SAMPLE] Price alert',
          `Sample — no price-movement threshold triggered.\n**${o.poolName} · ${o.symbol}** ${o.priceExact} ${o.quote}`),'format_preview',o.pool);
    }
    const cutoff = now - c.retentionDays * 86400;
    if(audience==='shared')pruneAlarms(db,c.mode,now,c.retentionDays);
    db.prepare('DELETE FROM samples WHERE t<?').run(cutoff);
    db.prepare('DELETE FROM runs WHERE t<?').run(cutoff);
    // Retain bounded episode evidence until the rate state releases it.
    db.prepare(`DELETE FROM outbox WHERE created<? AND status IN ('preview','sent','recorded','expired','suppressed') AND id NOT IN (
      SELECT json_extract(value,'$.highId') FROM state WHERE key LIKE 'public-rate:%' AND json_extract(value,'$.highId') IS NOT NULL
      UNION SELECT json_extract(value,'$.recoveryId') FROM state WHERE key LIKE 'public-rate:%' AND json_extract(value,'$.recoveryId') IS NOT NULL
    )`).run(cutoff);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
