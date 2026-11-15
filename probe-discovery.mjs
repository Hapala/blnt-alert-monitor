import {Address,xdr} from '@stellar/stellar-sdk';
import {selectProvider} from './public-rpc.mjs';
import {readFileSync} from 'node:fs';
const registry=JSON.parse(readFileSync(new URL('./markets.json',import.meta.url),'utf8'));
const {rpc}=await selectProvider();
// Published deployment operator address, used only as a read-only schema probe.
const wallet='GDEA2WMOWYQ3T56A2PZH5QYYEQBAORW2AUUJYX4FFD5GDPESAICTFTAL';
for(const pool of registry.pools) {
  const instance=await rpc.instance(pool.id);
  const positions=await rpc.getter(pool.id,'get_positions',[new Address(wallet).toScVal()]);
  const result={pool:pool.id,keys:Object.keys(instance.storage),positions};
  for(const [key,value] of Object.entries(instance.storage))if(/back|bstop|tier/i.test(key))result[key]=value;
  if(instance.storage.Backstop) {
    result.backstopHash=(await rpc.instance(instance.storage.Backstop)).hash;
    result.tiers=[];
    for(const name of ['FirstLoss','SecondLoss','ThirdLoss']) {
      try {result.tiers.push({tier:name,balance:await rpc.getter(instance.storage.Backstop,'user_balance',[xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(name)]),new Address(pool.id).toScVal(),new Address(wallet).toScVal()])});}
      catch{result.tiers.push({tier:name,unavailable:true});}
    }
  }
  console.log(JSON.stringify(result,(_k,v)=>typeof v==='bigint'?String(v):v instanceof Map?Object.fromEntries(v):v,2));
}
