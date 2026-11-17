import {WebsiteCollector} from './collector.mjs';
import {OracleCollector} from './oracle-collector.mjs';
import {compareWebsite} from './cross-check.mjs';
import {readFileSync} from 'node:fs';
import {selectProvider} from './public-rpc.mjs';
const config=JSON.parse(readFileSync(new URL('./config.json',import.meta.url))),website=new WebsiteCollector(process.env.BLNT_BROWSER_PATH);
try{
 const cached=process.env.BLNT_SMOKE_SNAPSHOT;
 const oracle=cached?JSON.parse(readFileSync(cached)):await new OracleCollector().collect(config),began=performance.now(),clock=()=>oracle.observedAt+Math.floor((performance.now()-began)/1000);
 if(cached){const reference=await selectProvider(config.publicRpcProviders);if(reference.ledgerTime-oracle.observedAt>180||oracle.observedAt>reference.ledgerTime+15)throw Error('Smoke snapshot is stale');}
 const check=compareWebsite(oracle,await website.collect(config,clock),config);
 console.log(JSON.stringify({status:check.status,prices:check.checks.length,issues:check.websiteIssues,failed:check.checks.filter(c=>c.status!=='match').map(c=>({asset:c.asset,status:c.status,deltaPercent:c.deltaPercent}))}));
 if(check.status!=='match'||check.websiteIssues.length)process.exitCode=1;
}finally{await website.close();}
