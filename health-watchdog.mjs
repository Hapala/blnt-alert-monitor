import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {openStore,getState} from './engine.mjs';
import {monitoringIssues,processMonitoringHealth} from './health-alerts.mjs';
import {verifyWebhookTarget,deliver} from './webhook.mjs';
if(process.argv.includes('--check-install')){console.log('Health watchdog imports verified');process.exit(0);}
const home=resolve(process.env.BLNT_MONITOR_HOME??dirname(fileURLToPath(import.meta.url)));
const json=path=>{try{return JSON.parse(readFileSync(resolve(home,path)));}catch{return {};}};
const config=json('config.json');
if(!['live','dry-run'].includes(config.mode))throw Error('Invalid watchdog mode');
if(config.mode==='live'&&process.env.BLNT_PUBLISH_APPROVED!=='true')throw Error('Health publishing approval required');
const now=Math.floor(Date.now()/1000),registry=JSON.parse(readFileSync(new URL('./markets.json',import.meta.url)));
let rates,source;
try{source=new DatabaseSync(resolve(home,'data/monitor.sqlite'),{readOnly:true});rates=getState(source,'publicBorrowRates',null);}catch{}finally{source?.close();}
const issues=monitoringIssues({now,shared:json('data/status.json'),personal:json('data/dm-status.json'),rates,expectedPools:registry.pools.map(p=>p.id),ratesEnabled:Boolean(config.publicBorrowRates?.enabled)});
const db=openStore(resolve(home,'data/health.sqlite'));
try{
 processMonitoringHealth(db,{now,issues,paused:config.paused||existsSync(resolve(home,'PAUSED'))},config);
 if(config.mode==='live'){
  const secret=readFileSync(resolve(home,'secrets/discord_webhook'),'utf8').trim();
  await verifyWebhookTarget(secret,json('discord-target.json'));await deliver(db,secret,now);
 }
 console.log(JSON.stringify({checkedAt:now,issues:issues.length,releaseId:process.env.BLNT_RELEASE_ID??'development'}));
}catch{console.error('Health check/delivery unavailable; no private diagnostics published');process.exitCode=1;}finally{db.close();}
