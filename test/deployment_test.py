"""Failure injection: no real systemctl, accounts, network or live DB access."""
import importlib.util,json,os,pathlib,sqlite3,subprocess,tempfile,types,unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('deployment',pathlib.Path(__file__).resolve().parent.parent/'deploy-isolated.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DeploymentTests(unittest.TestCase):
 def test_both_services_hide_home_and_mounts_but_keep_readonly_dns(self):
  for dm in [False,True]:
   text=m.unit_text(pathlib.Path('/opt/test-release'),dm)
   self.assertIn('User='+('blnt-alert-dm' if dm else 'blnt-alerts'),text);self.assertIn('Group=blnt-alerts',text);self.assertIn('ProtectHome=yes',text);self.assertIn('TemporaryFileSystem=/mnt:ro',text);self.assertIn('resolv.conf:/mnt/wsl/resolv.conf',text)
   self.assertIn('discord_webhook' if dm else 'discord_bot_token',text)
 def test_failed_activation_restores_both_workers_and_previous_release(self):
  with tempfile.TemporaryDirectory(prefix='blnt-rollback-test-') as tmp:
   root=pathlib.Path(tmp);runtime=root/'runtime';runtime.mkdir();(runtime/'.blnt-monitor-managed').touch();(runtime/'config.json').write_text('{}');(runtime/'data').mkdir()
   with sqlite3.connect(runtime/'data/monitor.sqlite') as db:
    db.execute('CREATE TABLE subscribers(id TEXT,wallet TEXT,preferences TEXT,enabled INTEGER)')
    db.execute('INSERT INTO subscribers VALUES (?,?,?,?)',('340645983287246858','synthetic',json.dumps({'riskRules':{'synthetic':{'capacityPercent':'50'}}}),1))
   code=root/'code';code.mkdir();(code/'activation.json').write_text('{}');old=code/'releases'/'old';old.mkdir(parents=True);candidate=code/'releases'/'candidate';candidate.mkdir();(code/'current').symlink_to(old)
   (code/'prepared.json').write_text(json.dumps({'release':str(candidate),'fingerprint':'tested','preparedAt':m.time.time()}))
   units=root/'units';units.mkdir();before={u:'previous '+u for u in m.UNITS}
   for u,t in before.items():(units/u).write_text(t)
   states={u:True for u in m.UNITS};calls=[];fail=[True]
   def fake(args,**kw):
    args=[str(a) for a in args];calls.append(args)
    if args[0]=='systemctl':
     if args[1]=='stop':states[args[2]]=False
     elif args[1]=='start':states[args[2]]=True
    return types.SimpleNamespace(returncode=0)
   def checked(args,**kw):
    if args==['systemctl','daemon-reload'] and fail[0]:fail[0]=False;raise RuntimeError('Injected activation failure')
    return fake(args,**kw)
   with patch.multiple(m,RUNTIME=runtime,CODE=code,OLD=root/'absent',BACKUPS=root/'backups',UNIT_DIR=units),patch.object(m.os,'chown'),patch.object(m,'fingerprint',return_value='tested'),patch.object(m,'active',side_effect=lambda u,legacy=False:states.get(u,False)),patch.object(m.pwd,'getpwnam',side_effect=lambda name:types.SimpleNamespace(pw_uid=os.getuid()+(1 if name==m.DM_ACCOUNT else 0),pw_gid=os.getgid())),patch.object(m,'run',side_effect=checked),patch.object(m.subprocess,'run',side_effect=fake):
    initial=m.preferences(runtime)
    with self.assertRaisesRegex(RuntimeError,'preserve-owner-rules'):m.activate()
    self.assertEqual(calls,[]);self.assertTrue(all(states.values()))
    with self.assertRaisesRegex(RuntimeError,'Injected'):m.activate(preserve_owner_rules=True)
    self.assertEqual(m.preferences(runtime),initial)
   self.assertTrue(all(states[u] for u in m.UNITS));self.assertEqual((code/'current').resolve(),old)
   for u,t in before.items():self.assertEqual((units/u).read_text(),t)
   for u in m.HEALTH_UNITS:self.assertFalse((units/u).exists())
 def test_watchdog_is_independent_isolated_and_bound_to_tested_release(self):
  units=m.health_units(pathlib.Path('/opt/release'))
  self.assertIn('/opt/release/health-watchdog.mjs',units[m.HEALTH_UNITS[0]])
  self.assertIn('discord_bot_token',units[m.HEALTH_UNITS[0]])
  self.assertIn('ProtectHome=yes',units[m.HEALTH_UNITS[0]])
  self.assertIn('UMask=0007',units[m.HEALTH_UNITS[0]])
  self.assertIn('OnUnitInactiveSec=60',units[m.HEALTH_UNITS[1]])
 def test_prepare_dependency_failure_never_stops_workers(self):
  with tempfile.TemporaryDirectory(prefix='blnt-prepare-test-') as tmp:
   root=pathlib.Path(tmp);code=root/'code';runtime=root/'runtime';calls=[]
   def fake(args,**kw):
    args=[str(a) for a in args];calls.append(args)
    if len(args)>1 and args[1].endswith('stage-release.mjs'):pathlib.Path(args[2]).mkdir()
    if 'ci' in args:raise RuntimeError('Injected dependency install failure')
    return types.SimpleNamespace(returncode=0)
   with patch.multiple(m,RUNTIME=runtime,CODE=code),patch.object(m.os,'chown'),patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())),patch.object(m,'run',side_effect=fake):
    with self.assertRaisesRegex(RuntimeError,'dependency'):m.prepare(root,root/'chrome')
   self.assertFalse(any('systemctl' in c for c in calls));self.assertFalse(any('stop' in c for c in calls))
 def test_access_migration_and_rollback_preserve_credentials_and_contents(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'data').mkdir();(root/'secrets').mkdir(mode=0o700)
   for name in ['secrets/discord_webhook','secrets/discord_bot_token','data/monitor.sqlite','config.json']:
    (root/name).write_text('synthetic');os.chmod(root/name,0o600)
   shared=types.SimpleNamespace(pw_uid=1001,pw_gid=1001);personal=types.SimpleNamespace(pw_uid=1002,pw_gid=1001)
   with patch.object(m,'RUNTIME',root),patch.object(m.os,'chown') as chown:
    saved=m.access_snapshot();m.worker_access(shared,personal)
    chown.assert_any_call(root/'secrets/discord_bot_token',1002,1001)
    chown.assert_any_call(root/'secrets/discord_webhook',1001,1001)
    self.assertEqual((root/'data').stat().st_mode&0o7777,0o2770)
    self.assertEqual((root/'data/monitor.sqlite').stat().st_mode&0o777,0o660)
    self.assertEqual((root/'secrets/discord_bot_token').stat().st_mode&0o777,0o600)
    m.restore_access(saved,shared)
    self.assertEqual((root/'secrets').stat().st_mode&0o777,0o700)
    self.assertEqual((root/'config.json').stat().st_mode&0o777,0o600)
    self.assertEqual((root/'data/monitor.sqlite').read_text(),'synthetic')
 @unittest.skipUnless(os.geteuid()==0,'requires root to exercise distinct Linux UIDs')
 def test_distinct_uids_block_credentials_through_peer_proc_root(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);os.chmod(root,0o755);peers=[]
   try:
    for name,uid in [('shared',65533),('personal',65534)]:
     path=root/name;path.write_text('synthetic');os.chown(path,uid,65533);os.chmod(path,0o600)
     peers.append(subprocess.Popen(['python3','-c','import time; time.sleep(30)'],user=uid,group=65533))
    for index,uid in enumerate([65533,65534]):
     own=root/['shared','personal'][index];other=root/['personal','shared'][index]
     code=f'import os; assert os.access({str(own)!r},os.R_OK); assert not os.access({str(other)!r},os.R_OK); assert not os.access({("/proc/"+str(peers[1-index].pid)+"/root"+str(other))!r},os.R_OK)'
     subprocess.run(['python3','-c',code],user=uid,group=65533,check=True)
   finally:
    for child in peers:child.terminate();child.wait()

if __name__=='__main__':unittest.main()
