import {readdirSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export function stageRelease(destination,source=dirname(fileURLToPath(import.meta.url))){
  destination=resolve(destination);source=resolve(source);
  if(destination===source||existsSync(destination))throw Error('A new release directory is required');
  mkdirSync(destination,{recursive:true,mode:0o755});mkdirSync(join(destination,'test'));
  const files=readdirSync(source).filter(name=>name.endsWith('.mjs')||name.endsWith('.md')&&name!=='OPENCLAW_HANDOFF.md'||['package.json','package-lock.json','markets.json','config.json','deploy-isolated.py'].includes(name));
  for(const name of files)copyFileSync(join(source,name),join(destination,name));
  for(const name of readdirSync(join(source,'test')).filter(n=>n.endsWith('.test.mjs')||n.endsWith('_test.py')))copyFileSync(join(source,'test',name),join(destination,'test',name));
  return files;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){stageRelease(process.argv[2]);console.log('Complete source release staged; no runtime secrets copied');}
