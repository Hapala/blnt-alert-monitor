import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {openStore,getState,setState} from './engine.mjs';
import {getSubscriber,selectedPools} from './subscriptions.mjs';
import {collectBorrowing} from './borrow-collector.mjs';
import {hasRiskRules} from './borrow-alerts.mjs';
const home=process.env.BLNT_MONITOR_HOME??process.cwd(),db=openStore(resolve(home,'data/monitor.sqlite'));
try{
  const id=process.argv[2],sub=getSubscriber(db,id);if(!sub?.enabled)throw Error('Active subscription required');
  const snapshot=JSON.parse(readFileSync(resolve(home,'data/latest.json'))),config=JSON.parse(readFileSync(resolve(home,'config.json'))),registry=JSON.parse(readFileSync(new URL('./markets.json',import.meta.url)));
  const report=await collectBorrowing(sub,selectedPools(sub,getState(db,`discovery:${id}`,null),snapshot.observedAt),snapshot,registry,config);
  setState(db,`borrowing:${id}`,report);
  console.log(JSON.stringify({checkedAt:report.checkedAt,rulesEnabled:hasRiskRules(sub),messagesSent:0,
    pools:Object.entries(report.pools).map(([id,p])=>({name:registry.pools.find(v=>v.id===id)?.name,stale:p.stale,reason:p.reason,capacityReady:p.capacity?.ready,capacityReason:p.capacity?.reason,quote:p.quote,borrowedReserves:p.rates?.filter(r=>r.borrowed).length}))},null,2));
  if(!Object.keys(report.pools).length||Object.values(report.pools).some(p=>p.stale||!p.capacity?.ready))process.exitCode=1;
}catch(error){console.error(error.message);process.exitCode=1;}finally{db.close();}
