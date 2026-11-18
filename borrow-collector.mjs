import {Address} from '@stellar/stellar-sdk';
import {selectProvider,symbolKey} from './public-rpc.mjs';
import {capacity,borrowAprRaw,positionEntries,validateReserve,integer} from './borrow-math.mjs';
import {reserveLiquidity} from './liquidity-alerts.mjs';
// Public reserve data only: no wallet positions, subscriptions or alert rules.
export async function collectPublicRates(registry,config,selector=selectProvider){
  const selected=await selector(config.publicRpcProviders),{rpc}=selected,pools=[];
  for(const pool of registry.pools){
    try{
      const instance=await rpc.instance(pool.id);
      if(instance.hash!==pool.wasmHash||instance.storage.Config?.oracle!==pool.oracle)throw Error('Pool identity changed');
      const list=await rpc.data(pool.id,symbolKey('ResList'));
      if(!Array.isArray(list)||!list.length||list.length>config.maxAssetsPerPool||new Set(list).size!==list.length)throw Error('Invalid reserve coverage');
      const rates=[];let disabledReserves=0;
      for(const asset of list){
        const reserve=validateReserve(await rpc.getter(pool.id,'get_reserve',[new Address(asset).toScVal()]));
        if(reserve.asset!==asset||list[Number(integer(reserve.config.index))]!==asset)throw Error('Reserve binding changed');
        const at=Number(integer(reserve.data.last_time));
        if(at<selected.ledgerTime-15||at>selected.ledgerTime+config.maxCycleSeconds)throw Error('Stale reserve preview');
        if(!reserve.config.enabled){disabledReserves++;continue;}
        rates.push({asset,symbol:registry.symbols[asset]??asset.slice(0,12),observedAt:at,...borrowAprRaw(reserve),liquidity:reserveLiquidity(reserve)});
      }
      pools.push({id:pool.id,name:pool.name,available:true,rates,disabledReserves});
    }catch{pools.push({id:pool.id,name:pool.name,available:false,rates:[]});}
  }
  const end=await rpc.health();
  if(end.ledger<selected.ledger||end.ledgerTime-selected.ledgerTime>config.maxCycleSeconds)throw Error('Public rate collection span invalid');
  // Reject a long/invalid preview instead of presenting old rates as current.
  for(const pool of pools)if(pool.rates.some(r=>r.observedAt>end.ledgerTime+15||end.ledgerTime-r.observedAt>180)){pool.available=false;pool.rates=[];}
  return {checkedAt:end.ledgerTime,ledger:end.ledger,provider:rpc.url,pools};
}
export async function collectBorrowing(sub,poolIds,snapshot,registry,config,selector=selectProvider){
  const selected=await selector(config.publicRpcProviders),{rpc}=selected,pools={};
  if(selected.ledgerTime-snapshot.observedAt>180||snapshot.observedAt>selected.ledgerTime+15)throw Error('Fresh primary snapshot required for borrowing checks');
  for(const pool of registry.pools.filter(p=>poolIds.includes(p.id))){
    try{
      const instance=await rpc.instance(pool.id),oracle=await rpc.instance(pool.oracle);
      if(instance.hash!==pool.wasmHash||instance.storage.Config?.oracle!==pool.oracle||oracle.hash!==pool.oracleWasmHash)throw Error('Borrowing pool identity changed');
      const base=await rpc.getter(pool.oracle,'base'),quoteDecimals=Number(await rpc.getter(pool.oracle,'decimals'));
      if(JSON.stringify(base)!==JSON.stringify(pool.quote))throw Error('Borrowing quote changed');
      const list=await rpc.data(pool.id,symbolKey('ResList'));
      if(!Array.isArray(list)||!list.length||list.length>config.maxAssetsPerPool||new Set(list).size!==list.length)throw Error('Invalid reserve coverage');
      const positions=await rpc.getter(pool.id,'get_positions',[new Address(sub.wallet).toScVal()]);
      const collateral=positionEntries(positions.collateral,list).filter(p=>p.balance>0n),borrowed=positionEntries(positions.liabilities,list).filter(p=>p.balance>0n);
      const rule=sub.preferences.riskRules?.[pool.id]??{},all=rule.rateScope==='selected-pools';
      const targets=new Set([...collateral,...borrowed].map(p=>p.asset));if(all)for(const asset of list)targets.add(asset);
      const reserves={},rates=[];
      for(const asset of targets){
        const reserve=validateReserve(await rpc.getter(pool.id,'get_reserve',[new Address(asset).toScVal()]));
        if(reserve.asset!==asset||list[Number(integer(reserve.config.index))]!==asset)throw Error('Reserve binding changed');
        if(integer(reserve.data.last_time)>BigInt(selected.ledgerTime+120)||integer(reserve.data.last_time)<BigInt(selected.ledgerTime-15))throw Error('Stale reserve preview');
        if(collateral.some(p=>p.asset===asset)){
          try{reserve.authorized=await rpc.getter(asset,'authorized',[new Address(pool.id).toScVal()]);if(typeof reserve.authorized!=='boolean')throw Error('Invalid authorization result');}
          catch(error){if(error.simulationFailed)reserve.authorized=true;else throw error;} // Same optional SEP-41 extension fallback as Reserve::is_authorized.
        }
        reserves[asset]=reserve;
        if(borrowed.some(p=>p.asset===asset)||(all&&reserve.config.enabled))rates.push({asset,symbol:registry.symbols[asset]??asset.slice(0,12),borrowed:borrowed.some(p=>p.asset===asset),...borrowAprRaw(reserve)});
      }
      const prices=Object.fromEntries(snapshot.observations.filter(o=>o.pool===pool.id&&o.oracle===pool.oracle&&o.quote===pool.quoteLabel&&o.decimals===quoteDecimals).map(o=>{
        if(o.timestamp>selected.ledgerTime+15||selected.ledgerTime-o.timestamp>config.maxOracleAgeSeconds)return [o.asset,{...o,alertEligible:false}];return [o.asset,o];
      }));
      let headroom;try{headroom=capacity(positions,list,reserves,prices,{...instance.storage.Config,quoteDecimals});}
      catch(error){headroom={ready:false,reason:error.message.slice(0,160)};}
      const again=await rpc.getter(pool.id,'get_positions',[new Address(sub.wallet).toScVal()]);
      const serialize=value=>JSON.stringify(value,(_k,v)=>typeof v==='bigint'?String(v):v instanceof Map?Object.fromEntries(v):v);
      if(serialize(positions)!==serialize(again))throw Error('Wallet positions changed during collection');
      pools[pool.id]={stale:false,name:pool.name,quote:pool.quoteLabel,capacity:headroom,rates};
    }catch(error){pools[pool.id]={stale:true,reason:error.message.slice(0,160)};}
  }
  const end=await rpc.health();
  if(end.ledger<selected.ledger||end.ledgerTime-selected.ledgerTime>120)throw Error('Borrowing collection span invalid');
  return {checkedAt:end.ledgerTime,sourceObservedAt:snapshot.observedAt,ledger:end.ledger,provider:rpc.url,wallet:sub.wallet,pools};
}
