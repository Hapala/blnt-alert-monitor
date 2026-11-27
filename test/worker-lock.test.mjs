import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync,symlinkSync,linkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {acquireWorkerLock} from '../worker-lock.mjs';

const moduleUrl=new URL('../worker-lock.mjs',import.meta.url).href;
function start(file,args=[]){
  const child=spawn(process.execPath,[file,...args],{stdio:['ignore','pipe','pipe']});
  const done=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
  const ready=new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Synthetic worker did not report readiness'));},10000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(output.split('\n')[0]));}catch(error){reject(error);}}});
    child.once('exit',()=>{clearTimeout(timer);if(!output.includes('\n'))reject(Error('Synthetic worker exited before readiness'));});
  });
  return {child,done,ready};
}
async function stop(worker,signal='SIGTERM'){
  if(worker.child.exitCode===null&&worker.child.signalCode===null)worker.child.kill(signal);
  await worker.done;
}
function fixture(dir){
 const file=join(dir,'holder.mjs');
 writeFileSync(file,`import {acquireWorkerLock} from ${JSON.stringify(moduleUrl)};import {spawn} from 'node:child_process';
 try{const release=acquireWorkerLock(process.argv[2],'cli.mjs');const child=process.argv[3]==='descendant'?spawn('/usr/bin/sleep',['60'],{stdio:'ignore'}):null;console.log(JSON.stringify({locked:true,descendant:child?.pid}));setInterval(()=>{},1000);process.on('SIGTERM',()=>{release();process.exit(0);});}
 catch(error){console.log(JSON.stringify({locked:false,code:error.code}));process.exit(73);}`);
 return file;
}
test('kernel lock excludes another descriptor and release reuses the same inode without unlinking',()=>{
 const dir=mkdtempSync(join(tmpdir(),'blnt-lock-')),path=join(dir,'monitor.lock');
 try{const release=acquireWorkerLock(path,'cli.mjs'),inode=statSync(path).ino;
 assert.throws(()=>acquireWorkerLock(path,'cli.mjs'),{code:'WORKER_LOCK_BUSY'});
 release();release();const next=acquireWorkerLock(path,'cli.mjs');assert.equal(statSync(path).ino,inode);assert.equal(Number(readFileSync(path)),process.pid);next();
 }finally{rmSync(dir,{recursive:true});}
});
test('simultaneous worker starts produce exactly one owner',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'blnt-lock-race-')),workers=[];
 try{const file=fixture(dir);for(let i=0;i<8;i++)workers.push(start(file,[join(dir,'monitor.lock')]));
 const results=await Promise.all(workers.map(w=>w.ready));assert.equal(results.filter(r=>r.locked).length,1);assert.equal(results.filter(r=>r.code==='WORKER_LOCK_BUSY').length,7);
 }finally{await Promise.all(workers.map(w=>stop(w)));rmSync(dir,{recursive:true});}
});
test('abrupt owner death releases the lock, and unrelated children do not keep ownership alive',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'blnt-lock-crash-')),path=join(dir,'monitor.lock');let owner,descendant;
 try{owner=start(fixture(dir),[path,'descendant']);descendant=(await owner.ready).descendant;assert.ok(descendant);
 await stop(owner,'SIGKILL');const release=acquireWorkerLock(path,'cli.mjs');release();
 }finally{if(owner)await stop(owner);if(descendant){try{process.kill(descendant,'SIGTERM');}catch{}}rmSync(dir,{recursive:true});}
});
test('leftover markers with a reused unrelated PID, a dead PID or partial data recover automatically',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'blnt-lock-stale-')),path=join(dir,'monitor.lock');
 const unrelated=spawn('/usr/bin/sleep',['60'],{stdio:'ignore'}),done=new Promise(resolve=>unrelated.once('exit',resolve));
 try{for(const marker of [String(unrelated.pid),'2147483647','partial','', '0']){writeFileSync(path,marker);const release=acquireWorkerLock(path,'cli.mjs');release();}
 assert.equal(unrelated.exitCode,null);
 }finally{unrelated.kill('SIGTERM');await done;rmSync(dir,{recursive:true});}
});
test('a live legacy worker blocks takeover for either role; its exit permits the stopped-writer upgrade',async()=>{
 for(const entry of ['cli.mjs','dm-worker.mjs']){
  const dir=mkdtempSync(join(tmpdir(),'blnt-lock-legacy-')),path=join(dir,'worker.lock'),file=join(dir,entry);
  writeFileSync(file,"console.log(JSON.stringify({ready:true}));setInterval(()=>{},1000);");const owner=start(file);
  try{await owner.ready;writeFileSync(path,String(owner.child.pid));assert.throws(()=>acquireWorkerLock(path,entry),{code:'WORKER_LOCK_BUSY'});assert.equal(Number(readFileSync(path)),owner.child.pid);
   await stop(owner);const release=acquireWorkerLock(path,entry);release();
  }finally{await stop(owner);rmSync(dir,{recursive:true});}
 }
});
test('symlink/hardlink locks fail closed without changing their target, and roles have independent locks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'blnt-lock-path-')),target=join(dir,'target'),alias=join(dir,'alias'),hard=join(dir,'hard');
 try{writeFileSync(target,'untouched');symlinkSync(target,alias);linkSync(target,hard);
 for(const path of [alias,hard])assert.throws(()=>acquireWorkerLock(path,'cli.mjs'),/lock unavailable/);
 assert.equal(readFileSync(target,'utf8'),'untouched');
 const shared=acquireWorkerLock(join(dir,'shared.lock'),'cli.mjs'),personal=acquireWorkerLock(join(dir,'personal.lock'),'dm-worker.mjs');personal();shared();
 }finally{rmSync(dir,{recursive:true});}
});
