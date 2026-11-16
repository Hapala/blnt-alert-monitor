import {DatabaseSync} from 'node:sqlite';

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS samples (key TEXT, t INTEGER, observed INTEGER, price REAL, PRIMARY KEY(key,t));
    CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, created INTEGER, status TEXT, payload TEXT, attempts INTEGER DEFAULT 0, next INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS runs (t INTEGER PRIMARY KEY, snapshot TEXT);`);
  if(!db.prepare('PRAGMA table_info(samples)').all().some(c=>c.name==='priceRaw'))db.exec('ALTER TABLE samples ADD COLUMN priceRaw TEXT');
  const outboxColumns=new Set(db.prepare('PRAGMA table_info(outbox)').all().map(c=>c.name));
  for(const [name,type] of [['audience',"TEXT NOT NULL DEFAULT 'shared'"],['category',"TEXT NOT NULL DEFAULT 'uncategorized'"],['pool','TEXT']])if(!outboxColumns.has(name))db.exec(`ALTER TABLE outbox ADD COLUMN ${name} ${type}`);
  return db;
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
  db.prepare('INSERT OR IGNORE INTO outbox(id,created,status,payload,audience,category,pool) VALUES (?,?,?,?,?,?,?)')
    .run(id, now, mode === 'live' ? 'pending' : 'preview', JSON.stringify(payload),routing.audience??'shared',routing.category??'uncategorized',routing.pool??null);
}
export function message(title, description, fields = []) {
  return {username: 'BLNT Alerts', allowed_mentions: {parse: []}, embeds: [{title, description, fields, color: 3447003}]};
}
export function dailyDigestSlot(snapshot,c){
  const local=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:c.digestTimezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(snapshot.observedAt*1000)).map(p=>[p.type,p.value]));
  return {due:Number(local.hour)>=c.digestHour&&snapshot.observations.length>0,key:`${snapshot.source??'website'}:${c.mode}:digest:${local.year}-${local.month}-${local.day}`};
}
export function dailyStatusMessage(snapshot,c,{preview=false,personal=false}={}) {
  const groups=new Map(),shown=snapshot.observations.slice(0,20);
  for(const o of shown){
    const name=`${o.poolName} · ${o.quote} per asset`;
    if(!groups.has(name))groups.set(name,[]);
    groups.get(name).push(`**${o.symbol}** — **${o.priceExact??o.price.toPrecision(8)}** ${o.quote}${o.alertEligible===false?' · cross-check unavailable':''}`);
  }
  const fields=[{name:'Data checks',value:`**${snapshot.observations.length}** price observations · **${snapshot.issues.length}** data-quality exclusions\nWebsite cross-check: **${snapshot.crossCheck?.status??'not checked'}**`,inline:false}];
  for(const [name,lines] of groups){
    let value='';for(const line of lines){if(value.length+line.length+1>1024){fields.push({name,value,inline:false});value='';}value+=(value?'\n':'')+line;}
    if(value)fields.push({name,value,inline:false});
  }
  const report=snapshot.borrowRates,rateFresh=report&&Math.abs(report.checkedAt-snapshot.observedAt)<=180;
  for(const pool of snapshot.markets){
    const data=rateFresh?report.pools.find(p=>p.id===pool.id):null,name=`${pool.name} · Borrow interest (APR)`;
    if(!data?.available){fields.push({name,value:'**Unavailable** — current reserve rates could not be verified. No rate is assumed.',inline:false});continue;}
    const lines=data.rates.map(r=>`**${r.symbol}** — **${r.aprPercent}% APR**`);
    if(data.disabledReserves)lines.push(`${data.disabledReserves} disabled reserve(s) excluded.`);
    if(!lines.length)lines.push('No enabled borrowing reserves.');
    let value='';for(const line of lines){if(value.length+line.length+1>1024){fields.push({name,value,inline:false});value='';}value+=(value?'\n':'')+line;}
    if(value)fields.push({name,value,inline:false});
  }
  if(rateFresh)fields.push({name:'Rate snapshot (UTC)',value:new Date(report.checkedAt*1000).toISOString(),inline:false});
  const omitted=snapshot.observations.length-shown.length;
  const payload=message(`${c.trial?'[PRIVATE TRIAL] ':''}${preview?'[SAMPLE] ':''}${personal?'Your':'BLNT'} daily pool status`,
    `${preview?'**Format preview using current public pool data.** This is an extra sample; the daily schedule is unchanged.\n\n':''}**Pool oracle reference prices and borrow APRs**${omitted?` · ${omitted} additional price observations not shown`:''}\nFixed V3 quotes **USD**; YieldBlent quotes **USDC**. These quote currencies are not treated as interchangeable.\n**Borrow APR** is the current variable annualized borrowing rate for each asset, **not APY** or a wallet-specific charge.\n\nTrading volume and liquidity are not included. Data checks describe the feeds, not pool safety.`,fields);
  Object.assign(payload.embeds[0],{color:0x3B82F6,timestamp:new Date(snapshot.observedAt*1000).toISOString(),url:'https://blnt.trade/',footer:{text:'BLNT • Daily snapshot • Oracle references, not execution prices'}});
  return payload;
}
export function processSnapshot(db, snapshot, c) {
  const now = snapshot.observedAt;
  const prefix=c.trial?'[PRIVATE TRIAL] ':'';
  const audience=c.audienceId??'shared',scope=audience==='shared'?'':`subscriber:${audience}:`;
  const allowed=category=>!(c.mutedCategories??[]).includes(category);
  const queue=(id,payload,category,pool=null)=>{if(allowed(category))enqueue(db,scope+id,now,payload,c.mode,{audience,category,pool});};
  db.exec('BEGIN IMMEDIATE');
  try {
    if(audience==='shared')db.prepare('INSERT OR REPLACE INTO runs VALUES (?,?)').run(now, JSON.stringify(snapshot));
    for (const o of snapshot.observations) {
      if(o.timestamp>now+15||now-o.timestamp>(o.priceRaw?c.maxOracleAgeSeconds:c.maxCaptureAgeSeconds))continue;
      db.prepare('INSERT OR IGNORE INTO samples(key,t,observed,price,priceRaw) VALUES (?,?,?,?,?)').run(o.key, o.timestamp, now, o.price,o.priceRaw??null);
      if(o.alertEligible===false||!allowed('price'))continue;
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
        const state = getState(db, stateKey, {armed: true, last: 0});
        const signed = direction === 'up' ? change : -change;
        const exact=Boolean(o.priceRaw&&baseline.priceRaw);
        const rearm=exact?!reachesThreshold(o.priceRaw,baseline.priceRaw,c.rearmPercent,direction):signed<c.rearmPercent;
        const triggered=exact?reachesThreshold(o.priceRaw,baseline.priceRaw,c.thresholdPercent,direction):signed>=c.thresholdPercent;
        if (rearm) state.armed = true;
        if (triggered && state.armed && now - state.last >= c.cooldownSeconds) {
          const payload=message(`${prefix}${direction==='up'?'📈':'📉'} ${o.symbol}: ${change >= 0 ? '+' : ''}${change.toFixed(2)}% over ~1 hour`,
            `**Pool:** ${o.poolName}\n**Price:** ${o.priceExact??o.price.toPrecision(8)} **${o.quote} per ${o.symbol}**\n**Move:** **${change>=0?'+':''}${change.toFixed(2)}%**\nPool oracle reference price; not an execution price.`, [
              {name: 'Asset contract', value: o.asset},
              {name: 'Oracle price time (UTC)', value: new Date(o.timestamp * 1000).toISOString()},
              {name: 'Comparison interval', value: `${Math.round((o.timestamp-baseline.t)/60)} minutes between oracle timestamps`},
              {name: 'Read at (UTC)', value: new Date(o.observedAt * 1000).toISOString()},
              {name: 'Source', value: o.sourceUrl},
            ]);
          Object.assign(payload.embeds[0],{color:direction==='up'?0x22C55E:0xEF4444,timestamp:new Date(o.timestamp*1000).toISOString(),footer:{text:'BLNT • Price movement • Green = rise; red = fall'}});
          queue(`${c.mode}:alert:${o.key}:${direction}:${o.timestamp}`,payload,'price',o.pool);
          state.armed = false; state.last = now;
        }
        setState(db, stateKey, state);
      }
    }
    const marketKey = `${scope}${snapshot.source??'website'}:${c.mode}:markets`;
    const previous = getState(db, marketKey, {});
    for (const market of snapshot.markets) {
      const before = previous[market.id];
      if (before) for (const asset of market.reserves.filter(a => !before.includes(a))) {
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
      if(o)queue(`${snapshot.source}:private-trial:format-preview:v1`,
        message('[PRIVATE TRIAL] Price alert format preview',
          `Format preview only — no price-movement threshold is asserted by this message.\n${o.poolName}: ${o.priceExact} ${o.quote} per ${o.symbol}.\nLive trial alerts use the configured +/-${c.thresholdPercent}% over approximately one hour, with cooldowns and website cross-checks.`,[
            {name:'Asset contract',value:o.asset},
            {name:'Oracle price time (UTC)',value:new Date(o.timestamp*1000).toISOString()},
            {name:'Source',value:o.sourceUrl},
          ]),'format_preview',o.pool);
    }
    const cutoff = now - c.retentionDays * 86400;
    db.prepare('DELETE FROM samples WHERE t<?').run(cutoff);
    db.prepare('DELETE FROM runs WHERE t<?').run(cutoff);
    db.prepare("DELETE FROM outbox WHERE created<? AND status IN ('preview','sent','expired','suppressed')").run(cutoff);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
