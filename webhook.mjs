import {discordPayloads} from './discord-format.mjs';
export function validateWebhook(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'discord.com' || parsed.port || parsed.username || parsed.password || parsed.hash || parsed.search ||
      !/^\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+$/.test(parsed.pathname)) throw Error('Invalid Discord webhook URL');
  parsed.searchParams.set('wait','true');
  return parsed.href;
}
export async function verifyWebhookTarget(secret,target,fetcher=fetch) {
  // Accept the former label during upgrades; it never proved channel privacy.
  if(!['shared','private'].includes(target?.audience)||!/^\d+$/.test(target.channelId??'')||!/^\d+$/.test(target.guildId??''))throw Error('Shared Discord channel target configuration required');
  const url=new URL(validateWebhook(secret));url.search='';
  let response;
  try {response=await fetcher(url.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch {throw Error('Discord destination verification unavailable');}
  if(!response.ok)throw Error(`Discord destination verification HTTP ${response.status}`);
  const data=await response.json();
  if(data.type!==1||data.channel_id!==target.channelId||data.guild_id!==target.guildId||data.name!==target.webhookName)throw Error('Discord webhook destination mismatch');
  // Channel privacy is configured and verified separately in Discord. Webhook
  // metadata confirms routing, but cannot prove current channel permissions.
  return {webhookId:data.id,channelId:data.channel_id,guildId:data.guild_id,name:data.name};
}
export async function deliver(db, secret, now, fetcher = fetch, audience='shared') {
  const url = validateWebhook(secret);
  if(audience==='shared')db.prepare("UPDATE outbox SET status='recorded' WHERE audience='shared' AND status='pending' AND severity>2").run();
  // A crash after sending may leave an uncertain outcome. Never resend it automatically.
  db.prepare("UPDATE outbox SET status='uncertain' WHERE status='sending' AND audience=?").run(audience);
  db.prepare("UPDATE outbox SET status='expired' WHERE status='pending' AND created<? AND audience=?").run(now - 900,audience);
  const rows = db.prepare("SELECT * FROM outbox WHERE status='pending' AND next<=? AND audience=? ORDER BY created LIMIT 5").all(now,audience);
  for (const row of rows) {
    db.prepare("UPDATE outbox SET status='sending', attempts=attempts+1 WHERE id=?").run(row.id);
    let response,accepted=0;
    try {
      for(const part of discordPayloads(JSON.parse(row.payload))){
        response = await fetcher(url, {method:'POST', redirect:'error', signal:AbortSignal.timeout(15000),
          headers:{'Content-Type':'application/json'}, body:JSON.stringify(part)});
        if(!response.ok)break;accepted++;
      }
    } catch {
      db.prepare("UPDATE outbox SET status='uncertain' WHERE id=?").run(row.id);
      break;
    }
    if (response.ok) {
      db.prepare("UPDATE outbox SET status='sent' WHERE id=?").run(row.id);
    } else if(accepted){
      db.prepare("UPDATE outbox SET status='uncertain' WHERE id=?").run(row.id);break;
    } else if (response.status === 429) {
      let retry = 60;
      try { retry = Math.min(3600,Math.max(1,Number((await response.json()).retry_after)||60)); } catch {}
      db.prepare("UPDATE outbox SET status=?,next=? WHERE id=?").run(row.attempts >= 4 ? 'failed' : 'pending', now + Math.ceil(retry),row.id);
      break; // Rate limit can apply to the whole webhook.
    } else {
      // 5xx may have accepted the request. Require review rather than risk duplicates.
      db.prepare('UPDATE outbox SET status=? WHERE id=?').run(response.status >= 500 ? 'uncertain' : 'failed',row.id);
      break;
    }
  }
}
