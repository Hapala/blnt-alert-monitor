import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore} from './engine.mjs';
import {initSubscriptions,saveSubscriber} from './subscriptions.mjs';
const home=resolve(process.env.BLNT_MONITOR_HOME??dirname(fileURLToPath(import.meta.url)));
const [id,wallet]=process.argv.slice(2);
const db=openStore(resolve(home,'data/monitor.sqlite'));db.exec('PRAGMA busy_timeout=5000');initSubscriptions(db);
try {
  const sub=saveSubscriber(db,id,wallet,Math.floor(Date.now()/1000));
  console.log(JSON.stringify({subscriberId:sub.id,enabled:Boolean(sub.enabled),consent:'Explicit user request for personal DM trial',walletStored:true}));
}finally{db.close();}
