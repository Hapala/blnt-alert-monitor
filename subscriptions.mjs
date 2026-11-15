import {StrKey,Address,xdr} from '@stellar/stellar-sdk';
import {getState,setState,enqueue,message,processSnapshot} from './engine.mjs';
import {selectProvider} from './public-rpc.mjs';
import {validateRiskRules} from './borrow-alerts.mjs';

export const CATEGORIES=['price','digest','reserve_updates','format_preview','subscription_status','capacity','borrow_rate'];
export const BACKSTOP='CAHCUKBPTW5DR5RNXOHCTJD5U76A6EEZXYZAQFRQEEQRXQ3CRUZ6Z3MO';
export const BACKSTOP_HASH='0469cfb445bedd87478274f265c8776b32cde1e8840fca4684ffa1dc4d5a750f';
export function initSubscriptions(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS subscribers (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, preferences TEXT NOT NULL, enabled INTEGER NOT NULL, consentAt INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS dm_receipts (outboxId TEXT PRIMARY KEY, messageId TEXT, channelId TEXT);`);
}
export const defaults=()=>({extraPools:[],mutedPools:[],mutedCategories:[],paused:false,snoozeUntil:0,riskRules:{}});
export function validWallet(wallet){return StrKey.isValidEd25519PublicKey(wallet)||StrKey.isValidContract(wallet);}
export function getSubscriber(db,id) {
  const row=db.prepare('SELECT * FROM subscribers WHERE id=?').get(id);
  return row?{...row,preferences:{...defaults(),...JSON.parse(row.preferences)}}:null;
}
export function saveSubscriber(db,id,wallet,now) {
  if(!/^\d{15,22}$/.test(id)||!validWallet(wallet))throw Error('Valid Discord user ID and public Stellar wallet required');
  const previous=getSubscriber(db,id),changed=previous&&previous.wallet!==wallet;
  if(!previous?.enabled&&db.prepare('SELECT COUNT(*) AS n FROM subscribers WHERE enabled=1').get().n>=20)throw Error('The DM pilot is full; existing subscribers remain active');
  const preferences=previous?.preferences??defaults();
  db.prepare(`INSERT INTO subscribers(id,wallet,preferences,enabled,consentAt,revision) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET wallet=excluded.wallet,preferences=excluded.preferences,enabled=1,consentAt=excluded.consentAt,revision=excluded.revision`)
    .run(id,wallet,JSON.stringify(preferences),1,now,(previous?.revision??0)+1);
  if(changed)setState(db,`discovery:${id}`,null);
  suppressAll(db,id);
  return getSubscriber(db,id);
}
export function suppressAll(db,id) {db.prepare("UPDATE outbox SET status='suppressed' WHERE audience=? AND status='pending'").run(id);}
export function updatePreferences(db,id,change,registry) {
  const sub=getSubscriber(db,id);if(!sub)throw Error('Subscribe first');
  const prefs=structuredClone(sub.preferences);change(prefs);
  const known=new Set(registry.pools.map(p=>p.id));
  for(const key of ['extraPools','mutedPools'])if(!Array.isArray(prefs[key])||prefs[key].some(p=>!known.has(p)))throw Error('Unknown or unsupported pool');
  if(prefs.mutedCategories.some(c=>!CATEGORIES.includes(c)))throw Error('Unknown notification category');
  validateRiskRules(prefs.riskRules,registry);
  db.prepare('UPDATE subscribers SET preferences=?,revision=revision+1 WHERE id=?').run(JSON.stringify(prefs),id);
  suppressAll(db,id);return getSubscriber(db,id);
}
export function disableSubscriber(db,id) {db.prepare('UPDATE subscribers SET enabled=0 WHERE id=?').run(id);suppressAll(db,id);}
function amount(value){if(typeof value!=='bigint'||value<0n)throw Error('Invalid position amount');return value;}
export function lendingExposure(positions) {
  const reasons=[];
  for(const field of ['supply','collateral','liabilities']) {
    const values=positions?.[field];
    if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Invalid positions schema');
    const entries=values instanceof Map?[...values]:Object.entries(values);
    if(entries.map(([,v])=>amount(v)).some(v=>v>0n))reasons.push(field);
  }
  return reasons;
}
export function backstopExposure(balance) {
  if(!balance||!Array.isArray(balance.q4w))throw Error('Invalid backstop balance');
  const shares=amount(balance.shares),queued=balance.q4w.map(q=>amount(q.amount));
  return shares>0n||queued.some(v=>v>0n);
}
export async function discoverWallet(wallet,registry,selector=selectProvider,providers) {
  if(!validWallet(wallet))throw Error('Public wallet required');
  const {rpc}=await selector(providers),pools={};
  let backstopVerified=false;
  for(const pool of registry.pools) {
    try {
      const instance=await rpc.instance(pool.id);
      if(instance.hash!==pool.wasmHash||instance.storage.Config?.oracle!==pool.oracle||instance.storage.Backstop!==BACKSTOP)throw Error('Pool identity changed');
      if(!backstopVerified) {if((await rpc.instance(BACKSTOP)).hash!==BACKSTOP_HASH)throw Error('Backstop identity changed');backstopVerified=true;}
      const positions=await rpc.getter(pool.id,'get_positions',[new Address(wallet).toScVal()]);
      const reasons=lendingExposure(positions);
      const tiers=pool.backstopTiers;
      if(!Array.isArray(tiers)||tiers.some(t=>!['FirstLoss','SecondLoss','ThirdLoss'].includes(t)))throw Error('Unverified backstop tier schema');
      for(const tier of tiers) {
        const balance=await rpc.getter(BACKSTOP,'user_balance',[xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(tier)]),new Address(pool.id).toScVal(),new Address(wallet).toScVal()]);
        if(backstopExposure(balance))reasons.push(`backstop:${tier}`);
      }
      pools[pool.id]={associated:reasons.length>0,reasons,stale:false};
    }catch {pools[pool.id]={stale:true,reason:'Position read or identity verification failed'};}
  }
  const health=await rpc.health();
  return {checkedAt:health.ledgerTime,ledger:health.ledger,provider:rpc.url,pools};
}
export function mergeDiscovery(previous,current) {
  const pools={};
  for(const [id,result] of Object.entries(current.pools))pools[id]=result.stale?{...previous?.pools?.[id],...result}:result;
  return {...current,pools};
}
export function selectedPools(sub,discovery,now,maxAge=900) {
  if(!sub.enabled||sub.preferences.paused||sub.preferences.snoozeUntil>now)return [];
  const associated=Object.entries(discovery?.pools??{}).filter(([,p])=>p.associated&&!p.stale&&now-(discovery.checkedAt??0)>=-15&&now-discovery.checkedAt<=maxAge).map(([id])=>id);
  return [...new Set([...associated,...sub.preferences.extraPools])].filter(id=>!sub.preferences.mutedPools.includes(id));
}
export function suppressUnwanted(db,sub,pools,now) {
  const selection=[...pools].sort(),key=`dm-selection:${sub.id}`;
  const previous=getState(db,key,null);
  // A pending digest may contain multiple pools. Cancel it when membership
  // changes rather than delivering content selected under an older preference.
  if(previous&&JSON.stringify(previous)!==JSON.stringify(selection))suppressAll(db,sub.id);
  setState(db,key,selection);
  const selected=new Set(pools);
  for(const row of db.prepare("SELECT id,pool,category FROM outbox WHERE audience=? AND status='pending'").all(sub.id)) {
    if(!sub.enabled||sub.preferences.paused||sub.preferences.snoozeUntil>now||sub.preferences.mutedCategories.includes(row.category)||(row.pool&&!selected.has(row.pool)))db.prepare("UPDATE outbox SET status='suppressed' WHERE id=?").run(row.id);
  }
}
export function processSubscriber(db,sub,discovery,snapshot,config,registry) {
  const pools=selectedPools(sub,discovery,snapshot.observedAt),selected=new Set(pools);
  suppressUnwanted(db,sub,pools,snapshot.observedAt);
  if(!sub.enabled||sub.preferences.paused||sub.preferences.snoozeUntil>snapshot.observedAt)return;
  processSnapshot(db,{...snapshot,observations:snapshot.observations.filter(o=>selected.has(o.pool)),
    markets:snapshot.markets.filter(p=>selected.has(p.id)),issues:snapshot.issues.filter(i=>selected.has(i.pool))},
    {...config,audienceId:sub.id,mutedCategories:sub.preferences.mutedCategories});
  if(discovery&&!sub.preferences.mutedCategories.includes('subscription_status')&&!Object.values(discovery.pools).some(p=>p.stale)) {
    const names=pools.map(id=>registry.pools.find(p=>p.id===id)?.name??id);
    enqueue(db,`subscriber:${sub.id}:subscription-status:${sub.revision}`,snapshot.observedAt,
      message('[PRIVATE TRIAL] Your BLNT subscription',`Following: ${names.join(', ')||'no active pools found'}.\nAutomatic wallet discovery plus optional extra pools, with pool/category mutes applied.\nManage with /blnt-alerts status, pools, add-pool, mute, pause or unsubscribe.\nNo wallet keys or transaction signing are used.`),config.mode,
      {audience:sub.id,category:'subscription_status'});
  }
}
