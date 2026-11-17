export function prunePersonal(db){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dm_receipts'").get())return;
  db.prepare('DELETE FROM dm_receipts WHERE NOT EXISTS (SELECT 1 FROM outbox WHERE id=dm_receipts.outboxId)').run();
  for(const row of db.prepare("SELECT key,value FROM state WHERE key LIKE 'risk:%'").all()){
    const [,id,wallet,,pool,version]=row.key.split(':'),sub=db.prepare('SELECT wallet,preferences FROM subscribers WHERE id=?').get(id);
    const current=sub&&sub.wallet===wallet&&String(JSON.parse(sub.preferences).riskRules?.[pool]?.version)===version;
    const condition=JSON.parse(row.value),pending=condition.pendingId&&db.prepare('SELECT status FROM outbox WHERE id=?').get(condition.pendingId);
    if(!current&&!pending)db.prepare('DELETE FROM state WHERE key=?').run(row.key);
  }
}
export function forgetSubscriber(db,id,confirmation){
  if(confirmation!=='DELETE')throw Error('Choose confirm:DELETE to erase your stopped subscription data.');
  const sub=db.prepare('SELECT enabled FROM subscribers WHERE id=?').get(id);
  if(sub?.enabled)throw Error('Use /blnt-alerts unsubscribe before requesting deletion.');
  db.exec('BEGIN IMMEDIATE');
  try{
    db.prepare('DELETE FROM dm_receipts WHERE outboxId IN (SELECT id FROM outbox WHERE audience=?)').run(id);
    db.prepare('DELETE FROM outbox WHERE audience=?').run(id);
    for(const {key} of db.prepare('SELECT key FROM state').all())if(key.startsWith(`risk:${id}:`)||key.startsWith(`subscriber:${id}:`)||['discovery','borrowing','dm-delivery','dm-selection'].some(prefix=>key===`${prefix}:${id}`))db.prepare('DELETE FROM state WHERE key=?').run(key);
    db.prepare('DELETE FROM subscribers WHERE id=?').run(id);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return 'Your stopped subscription, wallet association and local delivery history were deleted. Existing Discord messages are not deleted. Operator rollback backups expire within 30 days.';
}
