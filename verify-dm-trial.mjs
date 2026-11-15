import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {DiscordApi,loadDmToken} from './dm-api.mjs';
import {selectProvider} from './public-rpc.mjs';
const home=process.env.BLNT_MONITOR_HOME??process.cwd(),id=process.argv[2];
const db=new DatabaseSync(resolve(home,'data/monitor.sqlite'),{readOnly:true});
try {
  const status=JSON.parse(readFileSync(resolve(home,'data/status.json'))),dm=JSON.parse(readFileSync(resolve(home,'data/dm-status.json')));
  const sub=db.prepare('SELECT wallet,enabled,preferences FROM subscribers WHERE id=?').get(id);
  if(!sub)throw Error('Subscriber missing');
  const state=key=>JSON.parse(db.prepare('SELECT value FROM state WHERE key=?').get(key)?.value??'null');
  const registry=JSON.parse(readFileSync(resolve(home,'markets.json'))),discovery=state(`discovery:${id}`);
  const api=new DiscordApi(loadDmToken()),me=await api.identity(),commands=await api.request('GET',`/applications/${me.id}/commands`);
  const reference=await selectProvider();
  const report={checkedAt:reference.ledgerTime,shared:{ready:status.ready,crossCheck:status.crossCheck?.status,freshPrices:status.freshPrices,snapshotAgeSeconds:reference.ledgerTime-status.observedAt},
    personal:{active:dm.active,mode:dm.mode,cycleFailures:dm.failures,enabled:Boolean(sub.enabled),
      pools:Object.entries(discovery?.pools??{}).map(([pool,p])=>({name:registry.pools.find(v=>v.id===pool)?.name,associated:p.associated,stale:p.stale})),
      sent:db.prepare("SELECT o.category,r.messageId,r.channelId FROM outbox o JOIN dm_receipts r ON r.outboxId=o.id WHERE audience=? AND status='sent'").all(id),
      pending:db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE audience=? AND status='pending'").get(id).n,
      blocked:Boolean(state(`dm-delivery:${id}`)?.blocked)},
    commands:{blntPresent:commands.some(c=>c.name==='blnt-alerts'),openClawHelpPresent:commands.some(c=>c.name==='help'),total:commands.length},
    privacy:{walletInSharedPayloads:db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE audience='shared' AND instr(payload,?)>0").get(sub.wallet).n,
      walletInSharedRunHistory:db.prepare('SELECT COUNT(*) AS n FROM runs WHERE instr(snapshot,?)>0').get(sub.wallet).n}};
  console.log(JSON.stringify(report,null,2));
  if(!report.shared.ready||report.shared.snapshotAgeSeconds>300||!report.commands.blntPresent||!report.personal.sent.length||report.personal.blocked||report.personal.cycleFailures||report.privacy.walletInSharedPayloads||report.privacy.walletInSharedRunHistory)process.exitCode=1;
}catch {console.error('DM trial verification failed; credentials not displayed');process.exitCode=1;}
finally{db.close();}
