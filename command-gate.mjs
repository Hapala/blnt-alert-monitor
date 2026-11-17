export class CommandGate{
  constructor({maxConcurrent=2,clock=()=>performance.now()}={}){this.max=maxConcurrent;this.clock=clock;this.active=new Set();this.last=new Map();}
  enter(user,action){
    const now=this.clock(),wait=['borrowing','test'].includes(action)?60000:1500,key=`${user}:${action}`;
    for(const [k,t] of this.last)if(now-t>60000)this.last.delete(k);
    if(this.active.has(user))throw Error('Your previous command is still running. Please wait for its response.');
    if(this.active.size>=this.max)throw Error('BLNT Alerts is busy. Please try again shortly.');
    const remaining=wait-(now-(this.last.get(key)??-Infinity));
    if(remaining>0)throw Error(`Please wait ${Math.ceil(remaining/1000)} seconds before repeating this command.`);
    if(this.last.size>=2000)throw Error('Command capacity reached. Please try again shortly.');
    this.active.add(user);this.last.set(key,now);return ()=>this.active.delete(user);
  }
}
