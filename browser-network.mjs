// The cross-check browser needs only the public website and its data providers.
// All other origins, local/private literals, cleartext and redirects are denied.
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
const hosts=new Set(['blnt.trade','mainnet.sorobanrpc.com','soroban-rpc.mainnet.stellar.gateway.fm','rpc.lightsail.network','horizon.stellar.org','soroban-rpc.creit.tech']);
export function publicAddress(address){
  if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19,51].includes(b)||a===203&&b===0);}
  // The allowed hosts currently resolve to global IPv6 unicast when IPv6 is used.
  return isIP(address)===6&&/^[23][0-9a-f]{3}:/i.test(address)&&!address.toLowerCase().startsWith('2001:db8:');
}
export async function allowedBrowserUrl(value,resolver=lookup){
  try{const url=new URL(value);if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||!hosts.has(url.hostname))return false;
    const records=await resolver(url.hostname,{all:true});return records.length>0&&records.every(r=>publicAddress(r.address));
  }catch{return false;}
}
