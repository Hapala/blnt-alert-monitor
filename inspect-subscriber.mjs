import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {openStore,getState} from './engine.mjs';
import {initSubscriptions,getSubscriber} from './subscriptions.mjs';
const home=process.env.BLNT_MONITOR_HOME??process.cwd(),db=openStore(resolve(home,'data/monitor.sqlite'));
initSubscriptions(db);
try {
  const id=process.argv[2],sub=getSubscriber(db,id),discovery=getState(db,`discovery:${id}`,null);
  const registry=JSON.parse(readFileSync(new URL('./markets.json',import.meta.url)));
  console.log(JSON.stringify({enabled:Boolean(sub?.enabled),preferences:sub?.preferences,
    pools:discovery?Object.entries(discovery.pools).map(([pool,p])=>({pool:registry.pools.find(v=>v.id===pool)?.name,...p})):null,
    checkedAt:discovery?.checkedAt,delivery:getState(db,`dm-delivery:${id}`,{}),
    messages:db.prepare('SELECT o.id,o.category,o.status,r.messageId,r.channelId FROM outbox o LEFT JOIN dm_receipts r ON r.outboxId=o.id WHERE o.audience=? ORDER BY o.created DESC LIMIT 10').all(id)},null,2));
}finally{db.close();}
