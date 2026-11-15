import {readFileSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyWebhookTarget} from './webhook.mjs';
const home=resolve(process.env.BLNT_MONITOR_HOME??dirname(fileURLToPath(import.meta.url)));
try {
  const target=JSON.parse(readFileSync(resolve(home,'discord-target.json'),'utf8'));
  const config=JSON.parse(readFileSync(resolve(home,'config.json'),'utf8'));
  const secretFile=process.env.DISCORD_WEBHOOK_FILE??resolve(home,'secrets/discord_webhook');
  const result=await verifyWebhookTarget(readFileSync(secretFile,'utf8').trim(),target);
  console.log(JSON.stringify({...result,audience:target.audience,mode:config.mode,
    credentialMode:(statSync(secretFile).mode&0o777).toString(8),messagesSentByThisCheck:0},null,2));
}catch {console.error('Discord destination check failed; credential not displayed');process.exitCode=1;}
