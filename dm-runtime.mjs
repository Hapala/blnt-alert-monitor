import {getState,setState,message} from './engine.mjs';
import {getSubscriber,discoverWallet,mergeDiscovery,selectedPools,suppressUnwanted,processSubscriber,disableSubscriber} from './subscriptions.mjs';
import {selectProvider} from './public-rpc.mjs';
import {collectBorrowing} from './borrow-collector.mjs';
import {hasRiskRules,processBorrowing,suppressRiskPending} from './borrow-alerts.mjs';

export async function deliverDms(db,api,id,now,registry,{freshNow=()=>now,snapshot,maxAge=900}={}) {
  let sub=getSubscriber(db,id);if(!sub?.enabled||getState(db,`dm-delivery:${id}`,{}).blocked)return;
  const discovery=getState(db,`discovery:${id}`,null);
  suppressUnwanted(db,sub,selectedPools(sub,discovery,now),now);
  db.prepare("UPDATE outbox SET status='uncertain' WHERE audience=? AND status='sending'").run(id);
  db.prepare("UPDATE outbox SET status='expired' WHERE audience=? AND status='pending' AND created<?").run(id,now-900);
  const rows=db.prepare("SELECT * FROM outbox WHERE audience=? AND status='pending' AND next<=? ORDER BY created LIMIT 5").all(id,now);
  for(const row of rows) {
    now=freshNow();
    if(snapshot&&(now-snapshot.observedAt>maxAge||snapshot.observedAt>now+15))break;
    if(now-row.created>900||row.created>now+15){db.prepare("UPDATE outbox SET status='expired' WHERE id=?").run(row.id);continue;}
    sub=getSubscriber(db,id);suppressUnwanted(db,sub,selectedPools(sub,discovery,now),now);
    if(db.prepare('SELECT status FROM outbox WHERE id=?').get(row.id).status!=='pending')continue;
    db.prepare("UPDATE outbox SET status='sending',attempts=attempts+1 WHERE id=?").run(row.id);
    try {
      const receipt=await api.send(id,JSON.parse(row.payload));
      db.prepare('INSERT OR REPLACE INTO dm_receipts(outboxId,messageId,channelId,botId,sentAt) VALUES (?,?,?,?,?)').run(row.id,receipt.messageId,receipt.channelId,receipt.botId??null,freshNow());
      db.prepare("UPDATE outbox SET status='sent' WHERE id=?").run(row.id);
      setState(db,`dm-delivery:${id}`,{blocked:false,lastSentAt:now});
    }catch(error) {
      if(error.uncertain){db.prepare("UPDATE outbox SET status='uncertain' WHERE id=?").run(row.id);}
      else if(error.code===50007||error.status===403) {
        setState(db,`dm-delivery:${id}`,{blocked:true,reason:'Discord DMs unavailable; use /blnt-alerts resume after allowing DMs'});
        db.prepare("UPDATE outbox SET status='blocked' WHERE audience=? AND status='pending'").run(id);
        db.prepare("UPDATE outbox SET status='blocked' WHERE id=?").run(row.id);
      }else if(error.status===429&&row.attempts<4)db.prepare("UPDATE outbox SET status='pending',next=? WHERE id=?").run(now+Math.min(3600,Math.max(1,Number(error.retryAfter)||60)),row.id);
      else db.prepare('UPDATE outbox SET status=? WHERE id=?').run(error.uncertain?'uncertain':'failed',row.id);
      break;
    }
  }
}
export async function subscriptionTick(db,api,snapshot,config,registry,discover=discoverWallet,clock=selectProvider,riskCollector=collectBorrowing,monotonic=()=>performance.now()) {
  const subs=db.prepare('SELECT id FROM subscribers WHERE enabled=1 ORDER BY id LIMIT 21').all();
  if(!subs.length)return {enabled:0,failures:0,heartbeatAt:snapshot.observedAt};
  if(subs.length>20)throw Error('Subscriber limit reached; review provider capacity before expanding');
  const reference=await clock(config.publicRpcProviders),began=monotonic();let now=reference.ledgerTime;
  const freshNow=()=>reference.ledgerTime+Math.max(0,Math.floor((monotonic()-began)/1000));
  if(now-snapshot.observedAt>config.maxOracleAgeSeconds||snapshot.observedAt>now+15)throw Error('Primary oracle snapshot unavailable or stale');
  let failures=0;
  const cursor=getState(db,'dm-cycle-cursor',null),index=subs.findIndex(s=>s.id===cursor);
  if(index>=0)subs.push(...subs.splice(0,index+1));
  for(const {id} of subs) {
    now=freshNow();
    if(now-snapshot.observedAt>config.maxOracleAgeSeconds||now-reference.ledgerTime>180)break;
    setState(db,'dm-cycle-cursor',id);
    try {
      if(config.guildId){
        try{await api.verifyMembership(id);}catch(error){if(error.status===404)disableSubscriber(db,id);throw error;}
      }
      let sub=getSubscriber(db,id),discovery=getState(db,`discovery:${id}`,null);
      if(sub.preferences.paused||sub.preferences.snoozeUntil>now){suppressUnwanted(db,sub,[],now);continue;}
      const interval=discovery&&Object.values(discovery.pools).some(p=>p.stale)?60:300;
      if(!discovery||discovery.wallet!==sub.wallet||now-discovery.checkedAt>=interval||now<discovery.checkedAt) {
        let fresh;
        try {fresh=await discover(sub.wallet,registry,undefined,config.publicRpcProviders);}
        catch {fresh={checkedAt:now,pools:Object.fromEntries(registry.pools.map(p=>[p.id,{stale:true}]))};}
        if(getSubscriber(db,id).wallet!==sub.wallet)continue;
        discovery={...mergeDiscovery(discovery,fresh),wallet:sub.wallet};setState(db,`discovery:${id}`,discovery);
      }
      sub=getSubscriber(db,id);
      processSubscriber(db,sub,discovery,snapshot,config,registry);
      if(hasRiskRules(sub)){
        const pools=selectedPools(sub,discovery,now);
        try{
          const report=await riskCollector(sub,pools,snapshot,registry,config),current=getSubscriber(db,id);
          if(current.wallet!==sub.wallet||current.revision!==sub.revision)continue;
          setState(db,`borrowing:${id}`,report);
          processBorrowing(db,current,report,selectedPools(current,getState(db,`discovery:${id}`,null),report.checkedAt),config);
        }catch{
          failures++;setState(db,`borrowing:${id}`,{wallet:sub.wallet,checkedAt:now,pools:Object.fromEntries(pools.map(pool=>[pool,{stale:true}]))});
          for(const pool of pools)for(const category of ['capacity','borrow_rate'])suppressRiskPending(db,id,pool,category);
        }
      }
      if(config.mode==='live')await deliverDms(db,api,id,freshNow(),registry,{freshNow,snapshot,maxAge:config.maxOracleAgeSeconds});
    }catch {failures++;}
  }
  return {enabled:subs.length,failures,heartbeatAt:freshNow()};
}
