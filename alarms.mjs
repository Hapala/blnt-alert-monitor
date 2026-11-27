import {severityLevel} from './severity.mjs';

export function initAlarms(db){
  db.exec(`CREATE TABLE IF NOT EXISTS alarms (
    mode TEXT NOT NULL, key TEXT NOT NULL, category TEXT NOT NULL, pool TEXT, asset TEXT,
    label TEXT NOT NULL, detail TEXT NOT NULL, severity INTEGER NOT NULL CHECK(severity BETWEEN 1 AND 4),
    status TEXT NOT NULL, lastKnownStatus TEXT NOT NULL, openedAt INTEGER, lastObservedAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL, resolvedAt INTEGER, episode INTEGER NOT NULL, validUntil INTEGER NOT NULL,
    expiresAt INTEGER, eventId TEXT, PRIMARY KEY(mode,key))`);
}
export function observeAlarm(db,input){
  const {mode,key,category,pool=null,asset=null,label,detail='',severity,condition,now,validUntil=now+300,eventId=null}=input;
  if(!['live','dry-run'].includes(mode)||!['active','resolved','hold'].includes(condition)||!Number.isSafeInteger(now)||!Number.isSafeInteger(validUntil)||validUntil<now||!key||!label)throw Error('Invalid shared alarm observation');
  if(input.audience&&input.audience!=='shared')throw Error('Only shared public alarm state is supported');
  severityLevel(severity);
  const previous=db.prepare('SELECT * FROM alarms WHERE mode=? AND key=?').get(mode,key);
  if(previous&&now<previous.updatedAt)return previous;
  const newEvent=eventId!==null&&eventId!==previous?.eventId;
  const expiresAt=eventId===null?null:(!newEvent?previous.expiresAt:input.expiresAt);
  if(eventId!==null&&(!Number.isSafeInteger(expiresAt)||(newEvent&&expiresAt<=now)))throw Error('Invalid alarm event expiry');
  const status=expiresAt!==null&&expiresAt<=now?'resolved':condition==='hold'?(previous?.lastKnownStatus??'resolved'):condition;
  const opened=status==='active'&&(previous?.lastKnownStatus!=='active'||newEvent);
  const openedAt=opened?now:(previous?.openedAt??null),episode=(previous?.episode??0)+(opened?1:0);
  const resolvedAt=status==='active'?null:previous?.lastKnownStatus==='active'?now:(previous?.resolvedAt??null);
  db.prepare(`INSERT OR REPLACE INTO alarms VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    mode,key,category,pool,asset,String(label).slice(0,160),String(detail).slice(0,512),severity,status,status,openedAt,now,now,resolvedAt,episode,eventId===null?validUntil:expiresAt,expiresAt,eventId);
  return db.prepare('SELECT * FROM alarms WHERE mode=? AND key=?').get(mode,key);
}
export function markMissingAlarms(db,mode,category,verifiedKeys,now){
  const keys=new Set(verifiedKeys);
  for(const row of db.prepare('SELECT key,updatedAt FROM alarms WHERE mode=? AND category=? AND expiresAt IS NULL').all(mode,category))
    if(!keys.has(row.key)&&now>=row.updatedAt)db.prepare("UPDATE alarms SET status='unknown',updatedAt=?,validUntil=? WHERE mode=? AND key=?").run(now,now,mode,row.key);
}
export function pruneAlarms(db,mode,now,retentionDays=8){
  db.prepare("UPDATE alarms SET status='resolved',lastKnownStatus='resolved',resolvedAt=expiresAt WHERE mode=? AND expiresAt<=? AND lastKnownStatus='active'").run(mode,now);
  db.prepare("DELETE FROM alarms WHERE mode=? AND lastKnownStatus='resolved' AND lastObservedAt<?").run(mode,now-retentionDays*86400);
}
export function activeAlarms(db,mode,now){
  return db.prepare("SELECT * FROM alarms WHERE mode=? AND lastKnownStatus='active' AND (expiresAt IS NULL OR expiresAt>?) ORDER BY severity,openedAt,key").all(mode,now).map(row=>({...row,status:row.status==='unknown'||now>row.validUntil||now<row.lastObservedAt-15?'unknown':'active'}));
}
