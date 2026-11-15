// Ports the pinned pool's conservative fixed-point conversions and rate curve.
export const S7=10000000n,S12=1000000000000n,PERCENT=1000000n;
export const ceilDiv=(a,b)=>{if(a<0n||b<=0n)throw Error('Invalid fixed-point division');return (a+b-1n)/b;};
export function integer(v){if(typeof v==='number'&&Number.isSafeInteger(v))v=BigInt(v);if(typeof v!=='bigint'||v<0n)throw Error('Invalid nonnegative integer');return v;}
export function decimal(v,places=6){
  const s=String(v);if(!new RegExp(`^(?:0|[1-9]\\d{0,17})(?:\\.\\d{1,${places}})?$`).test(s))throw Error(`Use a nonnegative decimal with at most ${places} decimal places`);
  const [whole,fraction='']=s.split('.');return BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0'));
}
export function formatUnits(v,places){const s=integer(v).toString().padStart(places+1,'0');return places?(s.slice(0,-places)+'.'+s.slice(-places)).replace(/\.?0+$/,''):s;}
export function validateReserve(r){
  if(!r?.config||!r?.data)throw Error('Invalid reserve schema');
  const c=r.config,d=r.data,decimals=Number(integer(c.decimals));
  if(decimals>18||integer(r.scalar)!==10n**BigInt(decimals)||integer(c.c_factor)>S7||integer(c.l_factor)>S7||integer(c.l_factor)===0n||integer(c.util)===0n||integer(c.util)>9500000n)throw Error('Invalid reserve factors');
  for(const k of ['r_base','r_one','r_two','r_three','index'])integer(c[k]);
  for(const k of ['b_rate','d_rate','b_supply','d_supply','ir_mod','last_time'])integer(d[k]);
  if(!d.b_rate||!d.d_rate||typeof c.enabled!=='boolean')throw Error('Invalid reserve data');
  return r;
}
export function borrowAprRaw(reserve){
  const {config:c,data:d}=validateReserve(reserve);
  const debt=ceilDiv(integer(d.d_supply)*integer(d.d_rate),S12),supply=integer(d.b_supply)*integer(d.b_rate)/S12;
  const util=debt===0n?0n:debt>=supply?S7:ceilDiv(debt*S7,supply),target=integer(c.util),modifier=integer(d.ir_mod);
  let apr;
  if(util<=target)apr=ceilDiv((ceilDiv(ceilDiv(util*S7,target)*integer(c.r_one),S7)+integer(c.r_base))*modifier,S7);
  else if(util<=9500000n)apr=ceilDiv((ceilDiv(ceilDiv((util-target)*S7,9500000n-target)*integer(c.r_two),S7)+integer(c.r_one)+integer(c.r_base))*modifier,S7);
  else apr=ceilDiv(ceilDiv((util-9500000n)*S7,500000n)*integer(c.r_three),S7)+ceilDiv(modifier*(integer(c.r_two)+integer(c.r_one)+integer(c.r_base)),S7);
  return {aprRaw:String(apr),aprPercent:formatUnits(apr*100n,7),utilizationRaw:String(util)};
}
export function positionEntries(values,list){
  if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Invalid position map');
  return (values instanceof Map?[...values]:Object.entries(values)).map(([key,value])=>{
    const index=Number(key),balance=integer(value);if(!Number.isInteger(index)||index<0||index>=list.length)throw Error('Unknown reserve position index');return {index,asset:list[index],balance};
  });
}
export function capacity(positions,list,reserves,prices,config){
  let collateral=0n,debt=0n,rawCollateral=0n;let decimals=null;
  for(const kind of ['collateral','liabilities'])for(const p of positionEntries(positions[kind],list)){
    if(!p.balance)continue;
    const r=validateReserve(reserves[p.asset]),price=prices[p.asset];
    if(!price||price.alertEligible!==true)throw Error('Capacity price lacks a current matching website cross-check');
    if(decimals!==null&&decimals!==price.decimals)throw Error('Mixed oracle precision');decimals=price.decimals;
    const value=integer(BigInt(price.priceRaw)),scale=integer(r.scalar);
    if(kind==='collateral'){
      const assets=p.balance*integer(r.data.b_rate)/S12;
      rawCollateral+=value*assets/scale;
      if(r.authorized!==false)collateral+=value*(assets*integer(r.config.c_factor)/S7)/scale;
    }else{
      const assets=ceilDiv(p.balance*integer(r.data.d_rate),S12),effective=ceilDiv(assets*S7,integer(r.config.l_factor));
      debt+=ceilDiv(value*effective,scale);
    }
  }
  decimals??=config.quoteDecimals;
  if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Oracle precision unavailable');
  // The contract requires a 1.0000100 minimum post-borrow health factor.
  const limit=collateral*S7/10000100n;
  const restricted=integer(config.status)>1n||collateral<integer(config.min_collateral);
  const remaining=restricted||debt>=limit?0n:limit-debt;
  return {ready:true,quoteDecimals:decimals,effectiveCollateral:String(collateral),effectiveDebt:String(debt),rawCollateral:String(rawCollateral),limit:String(limit),remaining:String(remaining),
    percentRemaining:limit?formatUnits(remaining*100n*PERCENT/limit,6):'0',relevant:rawCollateral>0n||debt>0n,restricted,
    amountRemaining:formatUnits(remaining,decimals)};
}
