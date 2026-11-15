import {Account,Address,Contract,Networks,TransactionBuilder,scValToNative,xdr} from '@stellar/stellar-sdk';

export const PUBLIC_PROVIDERS=['https://mainnet.sorobanrpc.com','https://soroban-rpc.mainnet.stellar.gateway.fm','https://rpc.lightsail.network/'];
const allowed=new Set(['getNetwork','getHealth','getLedgerEntries','simulateTransaction']);
export class PublicRpc {
  constructor(url,fetcher=fetch) {
    if(!PUBLIC_PROVIDERS.includes(url))throw Error('Unapproved public RPC endpoint');
    this.url=url;this.fetcher=fetcher;
  }
  async call(method,params={}) {
    if(!allowed.has(method))throw Error('Read-only RPC method denied');
    let response;
    try {response=await this.fetcher(this.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});}
    catch {throw Error('Public RPC connection unavailable');}
    if(!response.ok)throw Error(`Public RPC HTTP ${response.status}`);
    const body=await response.json();
    if(body.error||!body.result)throw Error(`Public RPC ${method} failed`);
    if(response.headers?.get('date'))this.httpTime=Math.floor(Date.parse(response.headers.get('date'))/1000);
    return body.result;
  }
  async health() {
    if((await this.call('getNetwork')).passphrase!==Networks.PUBLIC)throw Error('Public RPC network mismatch');
    const health=await this.call('getHealth');
    const ledgerTime=Number(health.latestLedgerCloseTime),ledger=Number(health.latestLedger);
    if(health.status!=='healthy'||!Number.isSafeInteger(ledgerTime)||!Number.isSafeInteger(ledger)||!Number.isFinite(this.httpTime)||this.httpTime-ledgerTime>60||ledgerTime-this.httpTime>15)throw Error('Public RPC ledger stale or invalid');
    return {ledger,ledgerTime,httpTime:this.httpTime};
  }
  async entry(id,key) {
    const encoded=xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({contract:new Address(id).toScAddress(),key,durability:xdr.ContractDataDurability.persistent})).toXdr('base64');
    const result=await this.call('getLedgerEntries',{keys:[encoded]});
    if(result.entries?.length!==1)throw Error('Contract state unavailable');
    const decoded=xdr.LedgerEntryData.fromXdr(result.entries[0].xdr,'base64');
    if(decoded.type!=='contractData')throw Error('Invalid contract state');
    return {val:decoded.contractData.val,ledger:result.latestLedger};
  }
  async instance(id) {
    const {val,ledger}=await this.entry(id,xdr.ScVal.scvLedgerKeyContractInstance());
    if(val.type!=='scvContractInstance'||val.instance.executable.type!=='contractExecutableWasm')throw Error('Invalid WASM contract instance');
    return {hash:val.instance.executable.wasmHash.toString(),ledger,
      storage:Object.fromEntries((val.instance.storage??[]).map(e=>[scValToNative(e.key),scValToNative(e.val)]))};
  }
  async data(id,key) {return scValToNative((await this.entry(id,key)).val);}
  async getter(id,method,args=[]) {
    if(!['base','decimals','resolution','lastprice','get_positions','user_balance','get_reserve','authorized'].includes(method))throw Error('Read-only getter denied');
    const account=new Account('GANXGJV2RNOFMOSQ2DTI3RKDBAVERXUVFC27KW3RLVQCLB3RYNO3AAI4','0');
    const tx=new TransactionBuilder(account,{fee:'100',networkPassphrase:Networks.PUBLIC}).addOperation(new Contract(id).call(method,...args)).setTimeout(60).build();
    if(tx.signatures.length)throw Error('Unsigned simulation required');
    const result=await this.call('simulateTransaction',{transaction:tx.toXDR()});
    if(result.error){const error=Error(`Read-only getter ${method} unavailable`);error.simulationFailed=true;throw error;}
    if(result.results?.length!==1)throw Error(`Invalid read-only getter ${method} result`);
    return scValToNative(xdr.ScVal.fromXdr(result.results[0].xdr,'base64'));
  }
}
export const symbolKey=name=>xdr.ScVal.scvSymbol(name);
export const reserveConfigKey=id=>xdr.ScVal.scvVec([symbolKey('ResConfig'),new Address(id).toScVal()]);
export const oracleAsset=id=>xdr.ScVal.scvVec([symbolKey('Stellar'),new Address(id).toScVal()]);
export async function selectProvider(urls=PUBLIC_PROVIDERS,factory=url=>new PublicRpc(url)) {
  const results=[];
  for(const url of urls) {
    const rpc=factory(url);
    try {results.push({rpc,...await rpc.health()});} catch {}
    if(results.length>=2)break;
  }
  if(results.length<2)throw Error('Two healthy public RPC providers required');
  if(Math.abs(results[0].ledger-results[1].ledger)>5||Math.abs(results[0].ledgerTime-results[1].ledgerTime)>30)throw Error('Public RPC providers disagree on ledger freshness');
  return {...results[0],reference:{provider:results[1].rpc.url,ledger:results[1].ledger,ledgerTime:results[1].ledgerTime}};
}
