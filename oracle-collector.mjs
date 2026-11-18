import {readFileSync} from 'node:fs';
import {PublicRpc,selectProvider,symbolKey,reserveConfigKey,oracleAsset} from './public-rpc.mjs';
import {poolStatus} from './pool-status-alerts.mjs';

export const SOURCE='pool-oracles-public-rpc-v1';
export function exactPrice(raw,decimals) {
  const value=BigInt(raw);
  if(value<=0n||!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Invalid oracle price precision');
  const digits=value.toString().padStart(decimals+1,'0');
  return decimals?digits.slice(0,-decimals)+'.'+digits.slice(-decimals):digits;
}
export function validatePrice(raw,decimals,ledgerTime,maxAge) {
  if(!raw||typeof raw.price!=='bigint'||typeof raw.timestamp!=='bigint')throw Error('Invalid oracle price record');
  const timestamp=Number(raw.timestamp);
  if(!Number.isSafeInteger(timestamp)||timestamp<=0||timestamp>ledgerTime+15||ledgerTime-timestamp>maxAge)throw Error('Oracle price stale or future-dated');
  return {timestamp,priceRaw:String(raw.price),priceExact:exactPrice(raw.price,decimals),price:Number(raw.price)/10**decimals};
}
export class OracleCollector {
  constructor(registry=JSON.parse(readFileSync(new URL('./markets.json',import.meta.url),'utf8')),selector=selectProvider) {
    this.registry=registry;this.selector=selector;
  }
  async close() {}
  async collect(config) {
    const selected=await this.selector(config.publicRpcProviders);
    const {rpc}=selected;
    const observations=[],issues=[],markets=[],pending=[];
    const startedAt=selected.ledgerTime;
    for(const pool of this.registry.pools) {
      try {
        const instance=await rpc.instance(pool.id),oracleInstance=await rpc.instance(pool.oracle);
        if(instance.hash!==pool.wasmHash||instance.storage.Config?.oracle!==pool.oracle||oracleInstance.hash!==pool.oracleWasmHash)throw Error('Pool or oracle identity changed');
        const reserves=await rpc.data(pool.id,symbolKey('ResList'));
        if(!Array.isArray(reserves)||!reserves.length||reserves.length>config.maxAssetsPerPool)throw Error('Invalid on-chain reserve coverage');
        const quote=await rpc.getter(pool.oracle,'base'),decimals=Number(await rpc.getter(pool.oracle,'decimals'));
        if(JSON.stringify(quote)!==JSON.stringify(pool.quote))throw Error('Oracle quote currency changed');
        if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Invalid oracle decimals');
        const status=poolStatus(instance.storage.Config.status);
        markets.push({id:pool.id,name:pool.name,status,oracle:pool.oracle,reserves,quote:pool.quoteLabel,sourceUrl:pool.evidenceUrl});
        for(const asset of reserves) {
          try {
            if((await rpc.data(pool.id,reserveConfigKey(asset))).enabled!==true)throw Error('Reserve disabled');
            const record=await rpc.getter(pool.oracle,'lastprice',[oracleAsset(asset)]);
            pending.push({pool,asset,decimals,record});
          } catch(error){issues.push({pool:pool.id,asset,reason:error.message});}
        }
      } catch(error){issues.push({pool:pool.id,reason:error.message});}
    }
    const end=await rpc.health();
    if(end.ledger<selected.ledger||end.ledgerTime-startedAt>config.maxCycleSeconds)throw Error('Public RPC collection span invalid');
    for(const {pool,asset,decimals,record} of pending) {
      try {
        const price=validatePrice(record,decimals,end.ledgerTime,config.maxOracleAgeSeconds);
        observations.push({...price,key:`oracle:v1:${pool.id}:${pool.oracle}:${pool.quoteLabel}:${decimals}:${asset}`,
          pool:pool.id,poolName:pool.name,oracle:pool.oracle,oracleWasmHash:pool.oracleWasmHash,asset,
          symbol:this.registry.symbols[asset]??asset.slice(0,12),quote:pool.quoteLabel,quoteAsset:pool.quote,decimals,
          observedAt:end.ledgerTime,sourceTimestamp:price.timestamp,ledger:end.ledger,provider:rpc.url,
          sourceKind:'pool oracle',sourceUrl:`https://stellar.expert/explorer/public/contract/${pool.oracle}`,
          websiteUrl:`https://blnt.trade/asset/?poolId=${pool.id}&assetId=${asset}`});
      }catch(error){issues.push({pool:pool.id,asset,reason:error.message});}
    }
    return {source:SOURCE,sourceTimestampAvailable:true,observedAt:end.ledgerTime,startedAt,ledger:end.ledger,
      provider:rpc.url,reference:selected.reference,hostObservedAt:Math.floor(Date.now()/1000),
      hostClockDifferenceSeconds:Math.floor(Date.now()/1000)-end.ledgerTime,observations,issues,markets};
  }
}
