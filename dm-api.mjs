import {readFileSync} from 'node:fs';

export function loadDmToken(path=process.env.BLNT_OPENCLAW_CONFIG??'/home/hermes/.openclaw/openclaw.json') {
  const c=JSON.parse(readFileSync(path,'utf8'));
  const token=c.channels?.discord?.accounts?.[process.env.BLNT_DISCORD_ACCOUNT??'default']?.token;
  if(typeof token!=='string'||!token)throw Error('Configured Discord bot credential unavailable');
  return token;
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
  async identity(){const user=await this.request('GET','/users/@me');if(!user.bot)throw Error('A bot account is required');this.botId=user.id;return user;}
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
