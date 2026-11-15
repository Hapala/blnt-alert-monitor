export function compareWebsite(primary,website,config) {
  if(Math.abs(website.observedAt-primary.observedAt)>config.maxCaptureAgeSeconds)throw Error('Website capture time differs from public ledger time');
  const checks=primary.observations.map(o=>{
    const w=website.observations.find(w=>w.pool===o.pool&&w.asset===o.asset);
    if(!w)return {pool:o.pool,asset:o.asset,status:'unavailable'};
    const difference=Math.abs(o.price-w.price),deltaPercent=difference/o.price*100;
    const allowance=w.roundingRadius+o.price*config.crossCheckTolerancePercent/100;
    return {pool:o.pool,asset:o.asset,status:difference<=allowance?'match':'mismatch',
      oraclePrice:o.priceExact,quote:o.quote,websiteDisplay:w.displayedPrice,websiteCapturedAt:w.observedAt,
      roundingRadius:w.roundingRadius,deltaPercent,websiteUrl:w.sourceUrl,
      denominationNote:o.quote==='USDC'?'Website dollar-style display compared to its USDC oracle value; no USD conversion performed':undefined};
  });
  const known=new Set(primary.markets.map(m=>m.id));
  return {checkedAt:primary.observedAt,status:checks.length&&checks.every(c=>c.status==='match')?'match':'degraded',checks,
    websiteIssues:website.issues,untrackedWebsitePools:website.markets.filter(m=>!known.has(m.id)).map(m=>m.id)};
}
export function applyCrossCheck(snapshot,check,config) {
  snapshot.crossCheck=check;
  const age=check?snapshot.observedAt-check.checkedAt:Infinity;
  for(const o of snapshot.observations) {
    const match=check?.checks?.find(c=>c.pool===o.pool&&c.asset===o.asset);
    o.alertEligible=age>=-15&&age<=config.crossCheckMaxAgeSeconds&&match?.status==='match';
  }
  return snapshot;
}
