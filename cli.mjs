import {readFileSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync, renameSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {WebsiteCollector} from './collector.mjs';
import {OracleCollector,SOURCE} from './oracle-collector.mjs';
import {compareWebsite,applyCrossCheck} from './cross-check.mjs';
import {openStore, getState, setState,dailyDigestSlot} from './engine.mjs';
import {collectPublicRates} from './borrow-collector.mjs';
import {deliver,verifyWebhookTarget} from './webhook.mjs';
import {prunePersonal} from './retention.mjs';
if(process.argv.includes('--check-install')){console.log('Shared entry point imports verified');process.exit(0);}

const here = dirname(fileURLToPath(import.meta.url));
const home = resolve(process.env.BLNT_MONITOR_HOME ?? here);
const data = resolve(home, 'data');
mkdirSync(data, {recursive:true, mode:0o700});
const lockPath = resolve(data,'monitor.lock');
let lock;
try {
  if(existsSync(lockPath)) {
    const pid=Number(readFileSync(lockPath,'utf8'));
    if(!Number.isInteger(pid)||pid<1) throw Error('Invalid lock');
    try { process.kill(pid,0); } catch(error) { if(error.code==='ESRCH') unlinkSync(lockPath); else throw error; }
  }
  lock = openSync(lockPath,'wx',0o600); writeFileSync(lock,String(process.pid));
}
catch { console.error('Monitor lock exists; inspect running process before removing stale lock.'); process.exit(1); }
let stopping = false;
let closeWebsite=()=>{};
const stop=()=>{stopping=true;closeWebsite();};
process.on('SIGINT',stop); process.on('SIGTERM',stop);
const db = openStore(resolve(data,'monitor.sqlite'));
if(!getState(db,'lastMode',null)) setState(db,'lastMode','dry-run');
function atomicJson(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value,null,2)+'\n',{mode:0o600}); renameSync(`${path}.tmp`,path);
}
function config() {
  const c = JSON.parse(readFileSync(resolve(home,'config.json'),'utf8'));
  if (!['dry-run','live'].includes(c.mode)) throw Error('Invalid mode');
  if(c.source!==SOURCE)throw Error('Oracle source configuration required');
  for (const k of ['pollSeconds','windowSeconds','baselineToleranceSeconds','maxGapSeconds','thresholdPercent','rearmPercent','cooldownSeconds','maxCaptureAgeSeconds','maxOracleAgeSeconds','maxCycleSeconds','maxPools','maxAssetsPerPool','retentionDays','crossCheckIntervalSeconds','crossCheckRetrySeconds','crossCheckMaxAgeSeconds','crossCheckTolerancePercent']) {
    if (!Number.isFinite(c[k]) || c[k]<=0) throw Error(`Invalid configuration: ${k}`);
  }
  if (c.pollSeconds<30 || c.rearmPercent>=c.thresholdPercent || c.windowSeconds!==3600 || c.digestHour<0 || c.digestHour>23) throw Error('Invalid monitoring configuration');
  if (c.mode==='live' && process.env.BLNT_PUBLISH_APPROVED!=='true') throw Error('Live publishing requires explicit activation');
  return c;
}
try {
  const collector = new OracleCollector();
  const website = new WebsiteCollector(process.env.BLNT_BROWSER_PATH);
  closeWebsite=()=>{void website.close().catch(()=>{});};
  const started = Math.floor(Date.now()/1000);
  setState(db,'lastStartedAt',started);
  if (!getState(db,'firstStartedAt',null)) setState(db,'firstStartedAt',started);
  do {
    const now = Math.floor(Date.now()/1000);
    let c;
    try {
      c = config();
      const previousMode=getState(db,'lastMode','dry-run');
      if(previousMode!==c.mode) {
        // Do not replay pending messages left over from an earlier live session.
        db.prepare("UPDATE outbox SET status='expired' WHERE status='pending'").run();
        setState(db,'lastMode',c.mode);
      }
      if (c.paused || existsSync(resolve(home,'PAUSED'))) {
        atomicJson(resolve(data,'status.json'),{observedAt:now,paused:true,mode:c.mode});
      } else {
        const snapshot = await collector.collect(c);
        if(stopping)break;
        let check=getState(db,'oracleWebsiteCrossCheck:ledger-clock-v1',null);
        const interval=check?.status==='match'?c.crossCheckIntervalSeconds:c.crossCheckRetrySeconds;
        if(!check||snapshot.observedAt-check.checkedAt>=interval||snapshot.observedAt<check.checkedAt) {
          // Anchor capture times to fresh ledger time plus monotonic elapsed time,
          // so host wall-clock jumps cannot corrupt the website comparison.
          const crossStarted=performance.now();
          const captureClock=()=>snapshot.observedAt+Math.floor((performance.now()-crossStarted)/1000);
          try {check=compareWebsite(snapshot,await website.collect(c,captureClock),c);}
          catch(error){if(stopping)break;check={checkedAt:snapshot.observedAt,status:'unavailable',checks:[],reason:error.message.split('\n')[0].slice(0,220)};}
          setState(db,'oracleWebsiteCrossCheck:ledger-clock-v1',check);
        }
        if(stopping)break;
        applyCrossCheck(snapshot,check,c);
        const digest=dailyDigestSlot(snapshot,c);
        // Collect all public reserve APRs only when preparing a new shared daily
        // digest. Minute-by-minute price polling does not add reserve simulations.
        if(digest.due&&!db.prepare('SELECT 1 FROM outbox WHERE id=?').get(digest.key)){
          try{snapshot.borrowRates=await collectPublicRates(collector.registry,c);setState(db,'publicBorrowRates',snapshot.borrowRates);}
          catch{snapshot.borrowRates={checkedAt:snapshot.observedAt,pools:[]};}
        }
        if(!snapshot.borrowRates){const rates=getState(db,'publicBorrowRates',null);if(rates&&snapshot.observedAt-rates.checkedAt>=-15&&snapshot.observedAt-rates.checkedAt<=180)snapshot.borrowRates=rates;}
        if(stopping)break;
        const {processSnapshot} = await import('./engine.mjs');
        processSnapshot(db,snapshot,c);
        prunePersonal(db);
        atomicJson(resolve(data,'latest.json'),snapshot);
        const status = {releaseId:process.env.BLNT_RELEASE_ID??'development',observedAt:snapshot.observedAt,mode:c.mode,ready:snapshot.issues.length===0&&snapshot.observations.length>0&&snapshot.observations.every(o=>o.alertEligible),source:SOURCE,sourceTimestampAvailable:true,
          provider:snapshot.provider,reference:snapshot.reference,ledger:snapshot.ledger,hostClockDifferenceSeconds:snapshot.hostClockDifferenceSeconds,crossCheck:snapshot.crossCheck,
          freshPrices:snapshot.observations.length,issues:snapshot.issues,
          startedAt:getState(db,'firstStartedAt',now),outbox:db.prepare('SELECT status,COUNT(*) AS count FROM outbox GROUP BY status').all()};
        atomicJson(resolve(data,'status.json'),status);
        console.log(JSON.stringify({at:snapshot.observedAt,mode:c.mode,freshPrices:status.freshPrices,issues:status.issues.length}));
        if(c.mode==='live') {
          const secret = readFileSync(process.env.DISCORD_WEBHOOK_FILE ?? resolve(home,'secrets/discord_webhook'),'utf8').trim();
          const target=JSON.parse(readFileSync(resolve(home,'discord-target.json'),'utf8'));
          await verifyWebhookTarget(secret,target);
          await deliver(db,secret,snapshot.observedAt);
        }
      }
    } catch(error) {
      // Never log network exception bodies, request headers or webhook credentials.
      const reason=error.message.split('\n')[0].slice(0,220);
      atomicJson(resolve(data,'status.json'),{observedAt:now,ready:false,error:reason,mode:c?.mode??'unknown'});
      console.error(JSON.stringify({at:now,error:reason}));
      if(process.argv.includes('--once')) process.exitCode=1;
    }
    if(process.argv.includes('--once') || stopping) break;
    for(let elapsed=0;elapsed<(c?.pollSeconds??60)&&!stopping;elapsed++) await delay(1000);
  } while(!stopping);
  await collector.close();
  await website.close();
} finally {
  db.close(); closeSync(lock); unlinkSync(lockPath);
}
