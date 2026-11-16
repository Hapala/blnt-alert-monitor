import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadDmToken,loadBotTarget,DiscordApi,PERSONAL_BOT_ID,verifyCommandOrigin} from '../dm-api.mjs';
test('dedicated token loader accepts only a private plain token file and never falls back to OpenClaw',()=>{
  const dir=mkdtempSync(join(tmpdir(),'blnt-bot-')),path=join(dir,'token'),token='synthetic-token-for-unit-tests-only-'+'.'.repeat(20);
  try{
    assert.throws(()=>loadDmToken(path),/no OpenClaw fallback/);
    writeFileSync(path,token+'\n',{mode:0o600});assert.equal(loadDmToken(path),token);
    if(process.platform!=='win32'){
      chmodSync(path,0o644);assert.throws(()=>loadDmToken(path),/insecure/);chmodSync(path,0o600);
      const alias=join(dir,'alias');symlinkSync(path,alias);assert.throws(()=>loadDmToken(alias),/insecure/);
    }
    writeFileSync(path,JSON.stringify({channels:{discord:{token}}}));assert.throws(()=>loadDmToken(path),/no OpenClaw fallback/);
  }finally{rmSync(dir,{recursive:true});}
});
test('bot target rejects the personal OpenClaw identity and mismatched runtime identity',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'blnt-identity-')),path=join(dir,'bot.json'),id='111111111111111111',guildId='222222222222222222';
  try{
    writeFileSync(path,JSON.stringify({purpose:'blnt-alerts-only',applicationId:PERSONAL_BOT_ID,guildId}));assert.throws(()=>loadBotTarget(path),/identity/);
    writeFileSync(path,JSON.stringify({purpose:'blnt-alerts-only',applicationId:id,guildId}));assert.equal(loadBotTarget(path).applicationId,id);
    let user={id,bot:true};const api=new DiscordApi('synthetic',async()=>({ok:true,json:async()=>user}));
    assert.equal((await api.identity(id)).id,id);await assert.rejects(api.identity(guildId),/mismatch/);
    user={id:PERSONAL_BOT_ID,bot:true};await assert.rejects(api.identity(),/mismatch/);
  }finally{rmSync(dir,{recursive:true});}
});
test('alert commands accept only the pinned server or verified member DMs',async()=>{
  const guild='111111111111111111',user='222222222222222222';let calls=0;
  const api={request:async(method,path)=>{calls++;assert.equal(method,'GET');assert.equal(path,`/guilds/${guild}/members/${user}`);return {user:{id:user}};}};
  await verifyCommandOrigin(api,guild,user,guild);assert.equal(calls,0);
  await verifyCommandOrigin(api,guild,user,null);assert.equal(calls,1);
  await assert.rejects(verifyCommandOrigin(api,guild,user,'333333333333333333'),/configured BLNT server/);
  api.request=async()=>{throw {status:404};};await assert.rejects(verifyCommandOrigin(api,guild,user,null),/Join/);
  api.request=async()=>({user:{id:'wrong'}});await assert.rejects(verifyCommandOrigin(api,guild,user,null),/verified/);
});
