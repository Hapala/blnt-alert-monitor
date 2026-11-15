import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const home=resolve(process.env.BLNT_MONITOR_HOME??dirname(fileURLToPath(import.meta.url)));
const db=new DatabaseSync(resolve(home,'data/monitor.sqlite'),{readOnly:true});
const config=JSON.parse(readFileSync(resolve(home,'config.json'),'utf8'));
const latest=JSON.parse(readFileSync(resolve(home,'data/status.json'),'utf8'));
const rows=db.prepare('SELECT t,snapshot FROM runs ORDER BY t').all().map(r=>({...JSON.parse(r.snapshot),t:r.t}));
const oracle=rows.filter(r=>r.source===config.source);
const healthy=oracle.filter(r=>r.observations.length>0&&r.issues.length===0&&r.observations.every(o=>o.alertEligible));
const gaps=[];
for(let i=1;i<healthy.length;i++) if(healthy[i].t-healthy[i-1].t>config.maxGapSeconds)gaps.push({from:healthy[i-1].t,to:healthy[i].t,seconds:healthy[i].t-healthy[i-1].t});
const series=db.prepare("SELECT key,COUNT(*) AS captures,MIN(t) AS firstCapture,MAX(t) AS lastCapture FROM samples WHERE key LIKE 'oracle:v1:%' GROUP BY key").all();
console.log(JSON.stringify({source:config.source,mode:config.mode,latest,oracleSweeps:oracle.length,healthySweeps:healthy.length,
  firstHealthyCapture:healthy[0]?.t??null,lastHealthyCapture:healthy.at(-1)?.t??null,
  elapsedHealthySpanSeconds:healthy.length?healthy.at(-1).t-healthy[0].t:0,gaps,series,
  underlyingPriceTimestampsAvailable:true,
  outbox:db.prepare('SELECT status,COUNT(*) AS count FROM outbox GROUP BY status').all()},null,2));
db.close();
