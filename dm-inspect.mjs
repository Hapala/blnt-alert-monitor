import {DiscordApi,loadDmToken} from './dm-api.mjs';
try {
  const api=new DiscordApi(loadDmToken());const me=await api.identity();
  const guilds=await api.request('GET','/users/@me/guilds');
  const commands=await api.request('GET',`/applications/${me.id}/commands`);
  console.log(JSON.stringify({botId:me.id,username:me.username,guilds:guilds.map(g=>({id:g.id,name:g.name})),commands:commands.map(c=>c.name)},null,2));
}catch{console.error('Redacted bot inspection failed');process.exitCode=1;}
