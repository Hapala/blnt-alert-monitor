import {chromium} from 'playwright-core';

const origin='https://blnt.trade';
const contract=/^C[A-Z2-7]{55}$/;
async function publicText(url) {
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`BLNT website HTTP ${response.status}`);
  return response.text();
}
export async function configuredWebsitePools() {
  const html=await publicText(origin+'/');
  const path=html.match(/src="([^" ]*\/pages\/_app-[a-z0-9]+\.js)"/)?.[1];
  if(!path?.startsWith('/_next/'))throw Error('BLNT website app bundle unavailable');
  const bundle=await publicText(new URL(path,origin).href);
  const literal=bundle.match(/'\[(\{"id":"C[A-Z2-7]{55}"[^']+)\]'/)?.[0];
  if(!literal)throw Error('BLNT website configured market schema changed');
  const pools=JSON.parse(literal.slice(1,-1));
  if(pools.some(p=>!contract.test(p.id)||p.version!=='V3'||typeof p.name!=='string'))throw Error('Unexpected website market configuration');
  return pools;
}
export function marketLink(href,kind) {
  const url=new URL(href,origin);
  if(url.origin!==origin||url.pathname!==`/${kind}/`) throw Error('Unexpected BLNT market link');
  const pool=url.searchParams.get('poolId'),asset=url.searchParams.get('assetId');
  if(!contract.test(pool??'')||(kind==='supply'&&!contract.test(asset??''))) throw Error('Invalid asset identity in website link');
  return {pool,asset,url:url.href};
}
export function parseDisplayedPrice(text) {
  const match=text.trim().match(/^\$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)([kMB])?$/);
  if(!match) throw Error('Website price format unsupported');
  const value=Number(match[1].replaceAll(',',''))*({k:1e3,M:1e6,B:1e9}[match[2]]??1);
  if(!Number.isFinite(value)||value<=0) throw Error('Website price unavailable');
  return value;
}
export function displayedRounding(text) {
  parseDisplayedPrice(text);
  const match=text.trim().match(/^\$([\d,.]+)([kMB])?$/);
  return 0.5*10**(-(match[1].split('.')[1]?.length??0))*({k:1e3,M:1e6,B:1e9}[match[2]]??1);
}
export async function websitePrice(page, pool, asset, now) {
  const url=`${origin}/asset/?poolId=${pool.id}&assetId=${asset.id}`;
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  const priceLabel=page.getByText('Oracle Price',{exact:true});
  await priceLabel.waitFor({state:'visible',timeout:45000});
  await page.waitForFunction(()=>{
    const label=[...document.querySelectorAll('p')].find(el=>el.textContent.trim()==='Oracle Price');
    const block=label?.parentElement?.parentElement;
    return block && [...block.children].some(el=>el.tagName==='P'&&/^\$[\d,.]+[kMB]?$/.test(el.textContent.trim()));
  },null,{timeout:45000});
  const displayed=await priceLabel.evaluate(el=>{
    const block=el.parentElement.parentElement;
    return [...block.children].filter(child=>child.tagName==='P').map(child=>child.textContent.trim());
  });
  if(displayed.length!==1) throw Error('Ambiguous website price field');
  await page.getByRole('heading',{name:'Enabled',exact:true}).waitFor({state:'visible',timeout:5000});
  const heading=await page.getByRole('heading',{name:/^Asset\s/}).innerText({timeout:5000});
  const symbol=heading.replace(/^Asset\s+/,'').trim();
  if(!symbol||symbol.length>40) throw Error('Website asset label unavailable');
  const capturedAt=now();
  return {key:`website:v2:${pool.id}:${asset.id}`,pool:pool.id,poolName:pool.name,asset:asset.id,symbol,
    quote:'website-dollar-label',price:parseDisplayedPrice(displayed[0]),displayedPrice:displayed[0],roundingRadius:displayedRounding(displayed[0]),
    timestamp:capturedAt,observedAt:capturedAt,sourceTimestamp:null,
    freshness:'Website captured now; underlying oracle timestamp not exposed',
    sourceKind:'BLNT.trade displayed Oracle Price',sourceUrl:url};
}
export class WebsiteCollector {
  constructor(executablePath,launcher=options=>chromium.launch(options)) { this.executablePath=executablePath;this.launcher=launcher; }
  async start() {
    this.browser=await this.launcher({headless:true,executablePath:this.executablePath});
  }
  async close() { const browser=this.browser;this.browser=null;await browser?.close(); }
  async collect(config,now=()=>Math.floor(Date.now()/1000)) {
    try{return await this.collectOnce(config,now);}
    catch(error){await this.close().catch(()=>{});throw error;}
  }
  async collectOnce(config,now) {
    const wallClock=now, wallStart=now(), monotonicStart=performance.now();
    now=()=>{
      const wall=wallClock();
      if(Math.abs((wall-wallStart)-(performance.now()-monotonicStart)/1000)>30) throw Error('Host clock changed during website sweep; captures rejected');
      return wall;
    };
    if(!this.browser?.isConnected()) await this.start();
    const context=await this.browser.newContext({serviceWorkers:'block'});
    const deadline=setTimeout(()=>context.close().catch(()=>{}),config.maxCycleSeconds*1000);
    const observations=[],issues=[],markets=[];
    const startedAt=now();
    try {
    await context.route('**/*',async route=>{
      const u=new URL(route.request().url());
      if(['localhost','127.0.0.1','[::1]','0.0.0.0'].includes(u.hostname)||u.protocol==='file:') return route.abort();
      return route.continue();
    });
    const page=await context.newPage();
      // Read the UI's public configured V3 registry. No tab-selection, wallet or
      // consent clicks are needed; each price still comes from rendered UI text.
      const pools=await configuredWebsitePools();
      if(!pools.length||pools.length>config.maxPools) throw Error('Unexpected website pool coverage');
      for(const configured of pools) {
        const id=configured.id;
        try {
          const dashboard=`${origin}/dashboard/?poolId=${id}`;
          await page.goto(dashboard,{waitUntil:'domcontentloaded',timeout:30000});
          await page.locator('a[href*="/supply/?poolId="][href*="assetId="]').first().waitFor({state:'visible',timeout:60000});
          const name=await page.locator('#pool-dropdown-button').innerText();
          const assetLinks=await page.locator('a[href*="/supply/?poolId="][href*="assetId="]').evaluateAll(els=>els.filter(el=>el.getClientRects().length).map(el=>el.href));
          const assets=[...new Set(assetLinks.map(href=>{
            const parsed=marketLink(href,'supply');if(parsed.pool!==id)throw Error('Cross-pool website link');return parsed.asset;
          }))];
          if(!assets.length||assets.length>config.maxAssetsPerPool) throw Error('Unexpected website asset coverage');
          const pool={id,name:name.replace(/\s+/g,' ').trim(),reserves:assets,sourceUrl:dashboard};
          markets.push(pool);
          for(const asset of assets) {
            try {observations.push(await websitePrice(page,pool,{id:asset},now));}
            catch(error) {
              const reason=error.message.split('\n')[0].slice(0,220);
              issues.push({pool:id,asset,reason});
              console.warn(JSON.stringify({source:'BLNT.trade',asset,error:reason}));
            }
          }
        } catch {issues.push({pool:id,reason:'Website market failed to load or its layout changed'});}
      }
      const observedAt=now();
      const validTime=o=>observedAt-o.observedAt>=-15&&observedAt-o.observedAt<=config.maxCaptureAgeSeconds;
      const fresh=observations.filter(validTime);
      for(const o of observations.filter(o=>!validTime(o))) issues.push({pool:o.pool,asset:o.asset,reason:'Website capture time invalid or exceeded age limit'});
      return {observedAt,startedAt,source:origin,sourceTimestampAvailable:false,observations:fresh,issues,markets};
    } finally {clearTimeout(deadline);await context.close();}
  }
}
