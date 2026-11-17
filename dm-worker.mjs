import {Client,MessageFlags} from 'discord.js';
import {readFileSync,mkdirSync,writeFileSync,renameSync,openSync,closeSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {openStore,message,getState,setState} from './engine.mjs';
import {initSubscriptions,getSubscriber,selectedPools} from './subscriptions.mjs';
import {collectBorrowing} from './borrow-collector.mjs';
import {borrowingStatus} from './borrow-alerts.mjs';
import {commandDefinition,applyCommand} from './subscription-commands.mjs';
import {DiscordApi,loadDmToken,loadBotTarget,verifyCommandOrigin} from './dm-api.mjs';
import {subscriptionTick} from './dm-runtime.mjs';
import {CommandGate} from './command-gate.mjs';
import {privateReply} from './discord-format.mjs';
if(process.argv.includes('--check-install')){console.log('DM entry point imports verified');process.exit(0);}
const home=resolve(process.env.BLNT_MONITOR_HOME??dirname(fileURLToPath(import.meta.url))),data=resolve(home,'data');
mkdirSync(data,{recursive:true,mode:0o700});
const lockPath=resolve(data,'dm-worker.lock');
let lock;
try {
  if(existsSync(lockPath)) {const pid=Number(readFileSync(lockPath,'utf8'));if(!Number.isInteger(pid)||pid<1)throw Error('Invalid lock');try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')unlinkSync(lockPath);else throw e;}}
  lock=openSync(lockPath,'wx',0o600);writeFileSync(lock,String(process.pid));
}catch{console.error('DM worker lock exists; inspect the running process before recovery');process.exit(1);}
const db=openStore(resolve(data,'monitor.sqlite'));db.exec('PRAGMA busy_timeout=5000');initSubscriptions(db);
const registry=JSON.parse(readFileSync(new URL('./markets.json',import.meta.url),'utf8'));
const botTarget=loadBotTarget(),botToken=loadDmToken();
const api=new DiscordApi(botToken);
api.guildId=botTarget.guildId;
const gate=new CommandGate();
const client=new Client({intents:[],allowedMentions:{parse:[]}});
let stopping=false;
const status=value=>{writeFileSync(resolve(data,'dm-status.json.tmp'),JSON.stringify({releaseId:process.env.BLNT_RELEASE_ID??'development',...value},null,2)+'\n',{mode:0o600});renameSync(resolve(data,'dm-status.json.tmp'),resolve(data,'dm-status.json'));};
client.on('error',()=>console.error('DM gateway connection error; credential not displayed'));
client.on('interactionCreate',async interaction=>{
  if(!interaction.isChatInputCommand()||interaction.commandName!=='blnt-alerts')return;
  let release;
  try {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    const name=interaction.options.getSubcommand(),id=interaction.user.id,args={};
    release=gate.enter(id,name);
    await verifyCommandOrigin(api,botTarget.guildId,id,interaction.guildId,name);
    for(const key of ['wallet','pool','category','amount','scope','confirm'])args[key]=interaction.options.getString(key);
    args.minutes=interaction.options.getInteger('minutes');
    args.percent=interaction.options.getNumber('percent');args.apr=interaction.options.getNumber('apr');args.clear=interaction.options.getBoolean('clear');
    const now=Math.floor(interaction.createdTimestamp/1000);
    if(name==='borrowing'){
      const sub=getSubscriber(db,id);if(!sub?.enabled)throw Error('Subscribe first');
      const c=JSON.parse(readFileSync(resolve(home,'config.json'),'utf8'));
      const snapshot=JSON.parse(readFileSync(resolve(data,'latest.json'),'utf8'));
      const report=await collectBorrowing(sub,selectedPools(sub,getState(db,`discovery:${id}`,null),snapshot.observedAt),snapshot,registry,c);
      const current=getSubscriber(db,id);if(current.wallet!==sub.wallet||current.revision!==sub.revision)throw Error('Subscription changed; run borrowing again');
      setState(db,`borrowing:${id}`,report);
      await privateReply(interaction,borrowingStatus(current,report,registry,report.checkedAt));return;
    }
    const result=applyCommand(db,id,name,args,registry,now);
    if(result==='test') {
      await api.send(id,message('[PRIVATE TRIAL] BLNT DM delivery test','This is your requested delivery test. No market threshold is asserted. Your subscription settings are managed with /blnt-alerts.'));
      await interaction.editReply('Your DM delivery test was sent.');
    }else await privateReply(interaction,result);
  }catch(error){
    const safe=error.status||error.uncertain?'Discord delivery unavailable. Check your DM privacy settings, then try /blnt-alerts resume.':error.message;
    try {if(interaction.deferred||interaction.replied)await interaction.editReply({content:safe,allowedMentions:{parse:[]}});else await interaction.reply({content:safe,flags:MessageFlags.Ephemeral});}catch{}
  }finally{release?.();}
});
try {
  const me=await api.identity(botTarget.applicationId);
  const guilds=await api.request('GET','/users/@me/guilds');
  if(!guilds.some(g=>g.id===botTarget.guildId))throw Error('Dedicated bot is not installed in its pinned BLNT server');
  // Upsert only our command on the dedicated application.
  const definition=commandDefinition(registry),commandPath=`/applications/${me.id}/commands`;
  const ensureCommand=async(update=false)=>{
    const commands=await api.request('GET',commandPath),existing=commands.find(c=>c.name===definition.name);
    if(existing&&existing.description!==definition.description)throw Error('Discord command name is already owned by another integration');
    if(existing&&update)return await api.request('PATCH',`${commandPath}/${existing.id}`,definition);
    return existing??await api.request('POST',commandPath,definition);
  };
  const command=await ensureCommand(true);let lastRegistrationCheck=performance.now();
  await client.login(botToken);
  console.log(JSON.stringify({botId:me.id,commandId:command.id,privilegedIntents:false}));
  const stop=()=>{stopping=true;client.destroy();};process.on('SIGINT',stop);process.on('SIGTERM',stop);
  do {
    try {
      // Repair only this application's command if it disappears.
      if(performance.now()-lastRegistrationCheck>=300000){await ensureCommand();lastRegistrationCheck=performance.now();}
      const config=JSON.parse(readFileSync(resolve(home,'config.json'),'utf8'));
      if(config.mode==='live'&&process.env.BLNT_PUBLISH_APPROVED!=='true')throw Error('DM publishing approval missing');
      if(config.paused||existsSync(resolve(home,'PAUSED')))status({active:true,paused:true});
      else {
        const snapshot=JSON.parse(readFileSync(resolve(data,'latest.json'),'utf8'));
        const result=await subscriptionTick(db,api,snapshot,{...config,guildId:botTarget.guildId},registry);
        status({active:true,mode:config.mode,heartbeatAt:Math.floor(Date.now()/1000),botId:me.id,commandId:command.id,sourceObservedAt:snapshot.observedAt,...result});
      }
    }catch{status({active:true,ready:false,error:'Subscription cycle failed; review source readiness or bot configuration'});}
    if(process.argv.includes('--once'))break;
    for(let i=0;i<60&&!stopping;i++)await delay(1000);
  }while(!stopping);
}catch{console.error('DM worker startup failed; credential not displayed');process.exitCode=1;}
finally{client.destroy();db.close();closeSync(lock);unlinkSync(lockPath);}
