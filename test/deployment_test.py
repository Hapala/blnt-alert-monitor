"""Failure injection: no real systemctl, accounts, network or live DB access."""
import importlib.util,json,os,pathlib,sqlite3,subprocess,tempfile,types,unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('deployment',pathlib.Path(__file__).resolve().parent.parent/'deploy-isolated.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DeploymentTests(unittest.TestCase):
 def test_both_services_hide_home_and_mounts_but_keep_readonly_dns(self):
  for dm in [False,True]:
   text=m.unit_text(pathlib.Path('/opt/test-release'),dm)
   self.assertIn('User=blnt-alerts',text);self.assertIn('ProtectHome=yes',text);self.assertIn('TemporaryFileSystem=/mnt:ro',text);self.assertIn('resolv.conf:/mnt/wsl/resolv.conf',text)
   self.assertIn('discord_webhook' if dm else 'discord_bot_token',text)
 def test_failed_activation_restores_both_workers_and_previous_release(self):
  with tempfile.TemporaryDirectory(prefix='blnt-rollback-test-') as tmp:
   root=pathlib.Path(tmp);runtime=root/'runtime';runtime.mkdir();(runtime/'.blnt-monitor-managed').touch();(runtime/'config.json').write_text('{}');(runtime/'data').mkdir()
   with sqlite3.connect(runtime/'data/monitor.sqlite') as db:db.execute('CREATE TABLE subscribers(id TEXT,wallet TEXT,preferences TEXT,enabled INTEGER)')
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
   with patch.multiple(m,RUNTIME=runtime,CODE=code,OLD=root/'absent',BACKUPS=root/'backups',UNIT_DIR=units),patch.object(m,'fingerprint',return_value='tested'),patch.object(m,'active',side_effect=lambda u,legacy=False:states[u]),patch.object(m.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())),patch.object(m,'run',side_effect=checked),patch.object(m.subprocess,'run',side_effect=fake):
    with self.assertRaisesRegex(RuntimeError,'Injected'):m.activate()
   self.assertTrue(all(states.values()));self.assertEqual((code/'current').resolve(),old)
   for u,t in before.items():self.assertEqual((units/u).read_text(),t)
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

if __name__=='__main__':unittest.main()
