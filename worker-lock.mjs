import {constants,openSync,closeSync,fstatSync,readSync,ftruncateSync,writeSync,readFileSync,readlinkSync,statSync} from 'node:fs';
import {basename} from 'node:path';
import {spawnSync} from 'node:child_process';

function legacyOwnerActive(pid,entry){
  if(!Number.isSafeInteger(pid)||pid<1||pid>2147483647||pid===process.pid)return false;
  try{process.kill(pid,0);}catch(error){if(['ESRCH','EPERM'].includes(error.code))return false;throw error;}
  try{
    if(statSync(`/proc/${pid}`).uid!==process.getuid())return false;
    if(!['node','nodejs'].includes(basename(readlinkSync(`/proc/${pid}/exe`)).replace(/ \(deleted\)$/,'')))return false;
    return readFileSync(`/proc/${pid}/cmdline`,'utf8').split('\0').slice(1).some(arg=>basename(arg)===entry);
  }catch(error){if(['ENOENT','ESRCH'].includes(error.code))return false;throw error;}
}

// flock acts on the inherited open-file description. The parent keeps that
// descriptor after the short helper exits. Never unlink the inode on release:
// contenders must all lock the same file, including after an abrupt shutdown.
export function acquireWorkerLock(path,entry){
  if(process.platform!=='linux'||!['cli.mjs','dm-worker.mjs'].includes(entry))throw Error('Worker locking requires Linux and util-linux flock');
  let fd;
  try{
    fd=openSync(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o660);
    const meta=fstatSync(fd);if(!meta.isFile()||meta.nlink!==1)throw Error('Unsafe lock file');
    const result=spawnSync('/usr/bin/flock',['--exclusive','--nonblock','--conflict-exit-code','73','3'],{stdio:['ignore','ignore','ignore',fd],timeout:5000});
    if(result.status===73){const error=Error('Another worker owns this lock');error.code='WORKER_LOCK_BUSY';throw error;}
    if(result.error||result.status!==0)throw Error('Kernel lock unavailable');
    const bytes=Buffer.alloc(64),count=readSync(fd,bytes,0,bytes.length,0),marker=bytes.subarray(0,count).toString().trim();
    if(/^\d+$/.test(marker)&&legacyOwnerActive(Number(marker),entry)){
      const error=Error('A legacy worker is still running');error.code='WORKER_LOCK_BUSY';throw error;
    }
    // Numeric metadata allows a stopped-writer rollback to the old release.
    // Ownership itself is kernel-held; PID reuse cannot create a stale lock.
    ftruncateSync(fd,0);writeSync(fd,String(process.pid),0,'utf8');
    let released=false;
    return ()=>{if(!released){released=true;closeSync(fd);}};
  }catch(error){if(fd!==undefined)closeSync(fd);if(error.code==='WORKER_LOCK_BUSY')throw error;throw Error('Worker lock unavailable; refusing an unlocked start');}
}
