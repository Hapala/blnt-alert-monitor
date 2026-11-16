import {readFileSync,lstatSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const monitorHome=()=>resolve(process.env.BLNT_MONITOR_HOME??dirname(fileURLToPath(import.meta.url)));
export const PERSONAL_BOT_ID='1477387518939893871';
export function loadDmToken(path=process.env.DISCORD_BOT_TOKEN_FILE??resolve(monitorHome(),'secrets/discord_bot_token')) {
  try{
    const meta=lstatSync(path);
    if(!meta.isFile()||meta.isSymbolicLink()||meta.size>512||(process.platform!=='win32'&&(meta.mode&0o077)!==0))throw Error('Invalid credential file');
    const token=readFileSync(path,'utf8').trim();
    if(!/^[A-Za-z0-9._-]{40,200}$/.test(token))throw Error('Invalid credential');
    return token;
  }catch{throw Error('Dedicated BLNT bot credential unavailable or insecure; no OpenClaw fallback is allowed');}
}
export function loadBotTarget(path=resolve(monitorHome(),'discord-bot.json')){
  const target=JSON.parse(readFileSync(path,'utf8'));
  if(target.purpose!=='blnt-alerts-only'||!/^\d{15,22}$/.test(target.applicationId??'')||target.applicationId===PERSONAL_BOT_ID||!/^\d{15,22}$/.test(target.guildId??''))throw Error('Dedicated BLNT bot identity must be pinned');
  return target;
}
export async function verifyCommandOrigin(api,guildId,userId,interactionGuildId){
  if(!/^\d{15,22}$/.test(userId))throw Error('Invalid Discord caller');
  if(interactionGuildId){if(interactionGuildId!==guildId)throw Error('BLNT Alerts is available only in its configured BLNT server and member DMs');return;}
  let member;
  try{member=await api.request('GET',`/guilds/${guildId}/members/${userId}`);}
  catch(error){if(error.status===403||error.status===404)throw Error('Join the configured BLNT server before using personal alerts');throw Error('Server membership check unavailable; please try again later');}
  if(member.user?.id!==userId)throw Error('Discord caller membership could not be verified');
}
export class DiscordApi {
  constructor(token,fetcher=fetch){this.token=token;this.fetcher=fetcher;}
  async request(method,path,body) {
    let response;
    try {response=await this.fetcher('https://discord.com/api/v10'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bot ${this.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
    catch {const e=Error('Discord request outcome uncertain');e.uncertain=true;throw e;}
    let data={};try{data=await response.json();}catch{}
    if(!response.ok){const e=Error(`Discord HTTP ${response.status}`);e.status=response.status;e.code=data.code;e.retryAfter=data.retry_after;e.uncertain=response.status>=500;throw e;}
    return data;
  }
  async identity(expectedId){const user=await this.request('GET','/users/@me');if(!user.bot||user.id===PERSONAL_BOT_ID||(expectedId&&user.id!==expectedId))throw Error('Dedicated BLNT bot identity mismatch');this.botId=user.id;return user;}
  async dmChannel(userId) {
    if(!/^\d{15,22}$/.test(userId))throw Error('Invalid Discord recipient');
    const channel=await this.request('POST','/users/@me/channels',{recipient_id:userId});
    if(channel.type!==1||!Array.isArray(channel.recipients)||!channel.recipients.some(r=>r.id===userId)||channel.recipients.some(r=>r.id!==userId&&r.id!==this.botId))throw Error('DM recipient verification failed');
    return channel.id;
  }
  async send(userId,payload) {
    const channelId=await this.dmChannel(userId);
    const {username,...message}=payload;
    const sent=await this.request('POST',`/channels/${channelId}/messages`,{...message,allowed_mentions:{parse:[]}});
    if(sent.channel_id!==channelId||!sent.id)throw Error('DM receipt verification failed');
    return {channelId,messageId:sent.id};
  }
}
