import {selectProvider,symbolKey,oracleAsset} from './public-rpc.mjs';
const selected=await selectProvider();
const pools=['CACSQWCMKG45TUHCQ3LXHOB7YEEJH4W376ZHQPXH2IZ3TE4NJHFZMCY7','CAUTPSQDAJEUV5XEU3EXFVYRGDJLEJGVTFJCFZCSPTDCREAMZ573VF4D'];
const output={provider:selected.rpc.url,ledger:selected.ledger,ledgerTime:selected.ledgerTime,reference:selected.reference,pools:[]};
for(const id of pools) {
  const instance=await selected.rpc.instance(id);
  const oracle=instance.storage.Config.oracle;
  const reserves=await selected.rpc.data(id,symbolKey('ResList'));
  const metadata={base:await selected.rpc.getter(oracle,'base'),decimals:await selected.rpc.getter(oracle,'decimals')};
  try {metadata.resolution=await selected.rpc.getter(oracle,'resolution');}catch{metadata.resolution=null;}
  const prices=[];
  for(const asset of reserves) {
    try {prices.push({asset,...await selected.rpc.getter(oracle,'lastprice',[oracleAsset(asset)])});}
    catch(error){prices.push({asset,error:error.message});}
  }
  output.pools.push({id,hash:instance.hash,oracle,oracleHash:(await selected.rpc.instance(oracle)).hash,metadata,prices});
}
console.log(JSON.stringify(output,(_key,value)=>typeof value==='bigint'?String(value):value,2));
