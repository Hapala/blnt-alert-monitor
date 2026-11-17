"""Prepare/test immutable releases, then activate under a dedicated OS account.

Run as root. --prepare performs tests without stopping live workers. --activate
only accepts the prepared release; failures restore both prior worker states.
No OpenClaw configuration or credentials are copied or modified.
"""
import argparse,hashlib,json,os,pathlib,pwd,shutil,sqlite3,subprocess,time,uuid

ACCOUNT='blnt-alerts'
RUNTIME=pathlib.Path('/var/lib/blnt-alert-monitor')
CODE=pathlib.Path('/opt/blnt-alert-monitor')
OLD=pathlib.Path('/home/hermes/blnt-alert-monitor')
BACKUPS=pathlib.Path('/var/backups/blnt-alert-monitor')
UNITS=['blnt-alert-monitor.service','blnt-dm-alerts.service']
UNIT_DIR=pathlib.Path('/etc/systemd/system')
NODE='/usr/local/bin/node'

def run(args,**kw):
    return subprocess.run([str(a) for a in args],check=True,**kw)

def userctl(*args,check=True):
    return subprocess.run(['runuser','-u','hermes','--','env','XDG_RUNTIME_DIR=/run/user/1000','systemctl','--user',*args],check=check,capture_output=True,text=True)

def active(unit,legacy=False):
    return (userctl('is-active','--quiet',unit,check=False) if legacy else subprocess.run(['systemctl','is-active','--quiet',unit])).returncode==0

def fingerprint(root):
    h=hashlib.sha256()
    for path in sorted(root.rglob('*')):
        if path.is_file() and 'node_modules' not in path.parts:
            h.update(str(path.relative_to(root)).encode());h.update(path.read_bytes())
    return h.hexdigest()

def preferences(root):
    path=root/'data/monitor.sqlite'
    if not path.exists():return {'digest':None,'borrowingRulesEnabled':0,'ownerBorrowingRulesEnabled':False}
    with sqlite3.connect(f'file:{path}?mode=ro',uri=True) as db:
        rows=db.execute('SELECT id,wallet,preferences,enabled FROM subscribers ORDER BY id').fetchall()
    enabled=sum(any(r.get(k) is not None for k in ('capacityPercent','capacityAmount','borrowApr')) for row in rows for r in json.loads(row[2]).get('riskRules',{}).values())
    owner=any(row[0]=='340645983287246858' and any(any(r.get(k) is not None for k in ('capacityPercent','capacityAmount','borrowApr')) for r in json.loads(row[2]).get('riskRules',{}).values()) for row in rows)
    return {'digest':hashlib.sha256(json.dumps(rows).encode()).hexdigest(),'borrowingRulesEnabled':enabled,'ownerBorrowingRulesEnabled':owner}

def properties(dm=False):
    return [f'User={ACCOUNT}',f'Group={ACCOUNT}','NoNewPrivileges=yes','ProtectSystem=strict','ProtectHome=yes','PrivateTmp=yes','PrivateDevices=yes','ProtectProc=invisible','ProtectKernelTunables=yes','ProtectKernelModules=yes','ProtectControlGroups=yes','RestrictSUIDSGID=yes','LockPersonality=yes','CapabilityBoundingSet=',f'ReadWritePaths={RUNTIME}/data',
            'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
            'TemporaryFileSystem=/mnt:ro',f'BindReadOnlyPaths={CODE}/resolv.conf:/mnt/wsl/resolv.conf',
            f'InaccessiblePaths=-/media -{RUNTIME}/secrets/'+('discord_webhook' if dm else 'discord_bot_token')]

def unit_text(release,dm):
    entry='dm-worker.mjs' if dm else 'cli.mjs'
    return '\n'.join(['[Unit]','Description=Isolated BLNT '+('personal alerts' if dm else 'shared monitoring'),'After=network-online.target','Wants=network-online.target','','[Service]','Type=simple',*properties(dm),f'WorkingDirectory={RUNTIME}',f'ExecStart={NODE} {release}/{entry}',f'Environment=BLNT_RELEASE_ID={release.name}',f'Environment=BLNT_MONITOR_HOME={RUNTIME}',f'Environment=BLNT_BROWSER_PATH={CODE}/browser/chrome',f'Environment=XDG_CONFIG_HOME={RUNTIME}/data/browser-config',f'Environment=XDG_CACHE_HOME={RUNTIME}/data/browser-cache','Environment=BLNT_PUBLISH_APPROVED=true','ExecStartPre=/usr/bin/test ! -r /home/hermes/.openclaw/openclaw.json','UMask=0077','Restart=on-failure','RestartSec=30','TimeoutStopSec=150','MemoryMax='+('512M' if dm else '1G'),'CPUQuota='+('50%' if dm else '100%'),'','[Install]','WantedBy=multi-user.target',''])

def private_copy(src,dst,uid,gid):
    shutil.copy2(src,dst);os.chmod(dst,0o600);os.chown(dst,uid,gid)

def prune_backups():
    if not BACKUPS.exists():return
    directories=sorted((p for p in BACKUPS.iterdir() if p.is_dir() and not p.is_symlink()),key=lambda p:p.stat().st_mtime,reverse=True)
    for index,path in enumerate(directories):
        if path.resolve().parent!=BACKUPS.resolve():raise RuntimeError('Backup path escaped managed directory')
        if index>=10 or time.time()-path.stat().st_mtime>30*86400:shutil.rmtree(path)
    # The original private runtime is a rollback archive, not another active DB.
    marker=CODE/'activation.json'
    if marker.exists() and time.time()>json.loads(marker.read_text()).get('legacyRetireAt',float('inf')) and (OLD/'.blnt-monitor-managed').exists():
        for name in ['data','secrets','backups']:
            path=OLD/name
            if path.exists() and not path.is_symlink() and path.resolve().parent==OLD.resolve():shutil.rmtree(path)

def prepare(source,browser):
    try:account=pwd.getpwnam(ACCOUNT)
    except KeyError:
        run(['useradd','--system','--user-group','--home-dir',RUNTIME,'--shell','/usr/sbin/nologin',ACCOUNT]);account=pwd.getpwnam(ACCOUNT)
    if RUNTIME.exists() and not (RUNTIME/'.blnt-monitor-managed').exists():raise RuntimeError('Refusing unmanaged runtime')
    RUNTIME.mkdir(mode=0o750,exist_ok=True);os.chown(RUNTIME,0,account.pw_gid)
    (RUNTIME/'.blnt-monitor-managed').touch(mode=0o600)
    data=RUNTIME/'data';data.mkdir(mode=0o700,exist_ok=True);os.chown(data,account.pw_uid,account.pw_gid)
    CODE.mkdir(mode=0o755,exist_ok=True);(CODE/'releases').mkdir(exist_ok=True)
    # /etc/resolv.conf is a WSL symlink under /mnt. Expose only that public
    # resolver file inside an otherwise empty /mnt view, never host drives.
    shutil.copyfile('/etc/resolv.conf',CODE/'resolv.conf');os.chmod(CODE/'resolv.conf',0o644)
    release=CODE/'releases'/('release-'+str(int(time.time()))+'-'+uuid.uuid4().hex[:8])
    run([NODE,source/'stage-release.mjs',release])
    for p in [release,*release.rglob('*')]:os.chown(p,account.pw_uid,account.pw_gid)
    # A fresh dependency tree and executable import smoke catch incomplete packaging.
    run(['runuser','-u',ACCOUNT,'--','env',f'npm_config_cache={RUNTIME}/data/npm-cache','npm','ci','--ignore-scripts','--no-audit','--no-fund'],cwd=release)
    run(['runuser','-u',ACCOUNT,'--',NODE,'cli.mjs','--check-install'],cwd=release)
    run(['runuser','-u',ACCOUNT,'--',NODE,'dm-worker.mjs','--check-install'],cwd=release)
    run(['runuser','-u',ACCOUNT,'--','npm','test'],cwd=release)
    if not (CODE/'browser/chrome').exists():
        if not browser.is_file() or browser.name!='chrome':raise RuntimeError('Installed Chromium executable required')
        shutil.copytree(browser.parent,CODE/'browser')
    for p in [release,*release.rglob('*')]:
        os.chown(p,0,0)
        if p.is_file():os.chmod(p,0o755 if os.access(p,os.X_OK) else 0o644)
        elif p.is_dir():os.chmod(p,0o755)
    args=['systemd-run','--wait','--pipe','--collect','--unit','blnt-release-check-'+uuid.uuid4().hex[:8]]
    for prop in properties():args+=['--property',prop]
    cached=CODE/'smoke-snapshot.json'
    existing=RUNTIME if (RUNTIME/'data/latest.json').exists() else OLD
    if (existing/'data/latest.json').exists():
        shutil.copy2(existing/'data/latest.json',cached);os.chmod(cached,0o644) # public pool observations only
    if cached.exists():args+=['--setenv',f'BLNT_SMOKE_SNAPSHOT={cached}']
    args+=['--setenv',f'BLNT_BROWSER_PATH={CODE}/browser/chrome','--setenv',f'XDG_CONFIG_HOME={RUNTIME}/data/browser-config','--setenv',f'XDG_CACHE_HOME={RUNTIME}/data/browser-cache',NODE,release/'website-smoke.mjs']
    run(args)
    # Test the actual service account's inability to read personal/Windows files.
    probe=['systemd-run','--wait','--pipe','--collect','--unit','blnt-isolation-check-'+uuid.uuid4().hex[:8]]
    for prop in properties():probe+=['--property',prop]
    probe+=['/usr/bin/python3','-c',"import os; assert not os.access('/home/hermes/.openclaw/openclaw.json',os.R_OK); assert not os.access('/mnt/c/Users/micha',os.R_OK); print('Personal configuration and Windows mounts inaccessible')"]
    run(probe)
    marker={'release':str(release),'fingerprint':fingerprint(release),'preparedAt':int(time.time()),'source':str(source)}
    (CODE/'prepared.json').write_text(json.dumps(marker)+'\n');os.chmod(CODE/'prepared.json',0o600)
    print(json.dumps({'prepared':True,'release':str(release),'servicesStopped':False}))

def activate():
    marker=json.loads((CODE/'prepared.json').read_text());release=pathlib.Path(marker['release']).resolve()
    if release.parent!=CODE/'releases' or fingerprint(release)!=marker['fingerprint']:raise RuntimeError('Prepared release differs from tested code')
    if time.time()-marker['preparedAt']>86400:raise RuntimeError('Prepared release expired; retest')
    account=pwd.getpwnam(ACCOUNT);migration=(OLD/'config.json').exists() and not (CODE/'activation.json').exists()
    source=OLD if migration else RUNTIME
    if not (source/'.blnt-monitor-managed').exists():raise RuntimeError('Existing managed monitor required for live migration')
    before=preferences(source)
    if before['ownerBorrowingRulesEnabled']:raise RuntimeError('The owner requested borrowing rules remain off; found configured owner rules')
    prior={unit:active(unit,legacy=migration) for unit in UNITS}
    unit_paths={unit:UNIT_DIR/unit for unit in UNITS}
    saved_units={u:p.read_text() if p.exists() else None for u,p in unit_paths.items()}
    old_activation=(CODE/'activation.json').read_text() if (CODE/'activation.json').exists() else None
    maintenance={UNIT_DIR/n:(UNIT_DIR/n).read_text() if (UNIT_DIR/n).exists() else None for n in ['blnt-alert-retention.service','blnt-alert-retention.timer']}
    BACKUPS.mkdir(mode=0o700,parents=True,exist_ok=True);backup=BACKUPS/('before-'+str(int(time.time()))+'-'+uuid.uuid4().hex[:8]);backup.mkdir(mode=0o700)
    stopped=False
    try:
        stopped=True
        for unit in UNITS:
            if migration:userctl('stop',unit)
            else:run(['systemctl','stop',unit])
        shutil.copytree(source/'data',backup/'data')
        if migration:
            for name in ['config.json','discord-target.json','discord-bot.json']:
                private_copy(source/name,RUNTIME/name,account.pw_uid,account.pw_gid)
            secrets=RUNTIME/'secrets';secrets.mkdir(mode=0o700,exist_ok=True);os.chown(secrets,account.pw_uid,account.pw_gid)
            for name in ['discord_webhook','discord_bot_token']:private_copy(source/'secrets'/name,secrets/name,account.pw_uid,account.pw_gid)
            shutil.copytree(source/'data',RUNTIME/'data',dirs_exist_ok=True)
            for p in [RUNTIME/'data',*(RUNTIME/'data').rglob('*')]:os.chown(p,account.pw_uid,account.pw_gid)
        current=CODE/'current';old_current=os.readlink(current) if current.is_symlink() else None
        backup.joinpath('prior.json').write_text(json.dumps({'units':saved_units,'current':old_current,'priorStates':prior,'migration':migration}))
        pending=CODE/'current.pending';pending.unlink(missing_ok=True);pending.symlink_to(release);os.replace(pending,current)
        for unit in UNITS:unit_paths[unit].write_text(unit_text(release,unit==UNITS[1]))
        run(['systemctl','daemon-reload'])
        for unit in UNITS:
            if prior[unit]:run(['systemctl','start',unit])
        deadline=time.monotonic()+240
        while time.monotonic()<deadline:
            try:
                # Verify only previously active workers; intentionally stopped
                # workers must not be enabled as a side effect of an upgrade.
                shared_ok=not prior[UNITS[0]]
                personal_ok=not prior[UNITS[1]]
                if not shared_ok:
                    path=RUNTIME/'data/status.json';shared=json.loads(path.read_text());shared_ok=shared.get('releaseId')==release.name and shared.get('ready') and active(UNITS[0])
                if not personal_ok:
                    path=RUNTIME/'data/dm-status.json';dm=json.loads(path.read_text());personal_ok=dm.get('releaseId')==release.name and dm.get('active') and dm.get('failures')==0 and active(UNITS[1])
                if shared_ok and personal_ok:break
            except (OSError,ValueError):pass
            time.sleep(2)
        else:raise RuntimeError('New workers did not reach verified readiness')
        after=preferences(RUNTIME)
        if before!=after:raise RuntimeError('Subscriber preferences changed during migration')
        run(['systemctl','enable',*UNITS])
        if migration:
            for unit in UNITS:userctl('disable',unit)
        legacy_retire=json.loads(old_activation).get('legacyRetireAt',time.time()+30*86400) if old_activation else time.time()+30*86400
        receipt={'activated':True,'release':str(release),'dedicatedUser':ACCOUNT,'preferencesUnchanged':True,'borrowingRulesEnabled':after['borrowingRulesEnabled'],'ownerBorrowingRulesEnabled':False,'rollbackDirectory':str(backup),'legacyRetireAt':legacy_retire}
        (CODE/'activation.json').write_text(json.dumps(receipt,indent=2)+'\n');os.chmod(CODE/'activation.json',0o600)
        # Root-owned maintenance code cannot be modified by either alert worker.
        (UNIT_DIR/'blnt-alert-retention.service').write_text('[Unit]\nDescription=BLNT rollback backup retention\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 '+str(release/'deploy-isolated.py')+' --prune-backups\n')
        (UNIT_DIR/'blnt-alert-retention.timer').write_text('[Unit]\nDescription=Daily BLNT backup retention\n[Timer]\nOnCalendar=daily\nPersistent=true\n[Install]\nWantedBy=timers.target\n')
        run(['systemctl','daemon-reload']);run(['systemctl','enable','--now','blnt-alert-retention.timer']);prune_backups();print(json.dumps(receipt))
    except BaseException:
        for unit in UNITS:subprocess.run(['systemctl','stop',unit],capture_output=True)
        for unit,path in unit_paths.items():
            if saved_units[unit] is None:path.unlink(missing_ok=True)
            else:path.write_text(saved_units[unit])
        for path,content in maintenance.items():
            if content is None:path.unlink(missing_ok=True)
            else:path.write_text(content)
        if old_activation is None:(CODE/'activation.json').unlink(missing_ok=True)
        else:(CODE/'activation.json').write_text(old_activation)
        if 'old_current' in locals():
            current=CODE/'current';current.unlink(missing_ok=True)
            if old_current is not None:current.symlink_to(old_current)
        subprocess.run(['systemctl','daemon-reload'],capture_output=True)
        if stopped:
            # Schema migrations here are additive; preserve any preferences changed
            # while candidate workers were active rather than restoring an old DB.
            if migration and (RUNTIME/'data/monitor.sqlite').exists():
                shutil.copytree(RUNTIME/'data',OLD/'data',dirs_exist_ok=True)
                owner=pwd.getpwnam('hermes')
                with sqlite3.connect(OLD/'data/monitor.sqlite') as db:
                    columns=[r[1] for r in db.execute('PRAGMA table_info(dm_receipts)')]
                    if len(columns)>3:
                        db.executescript('ALTER TABLE dm_receipts RENAME TO dm_receipts_new_release; CREATE TABLE dm_receipts(outboxId TEXT PRIMARY KEY,messageId TEXT,channelId TEXT); INSERT INTO dm_receipts SELECT outboxId,messageId,channelId FROM dm_receipts_new_release; DROP TABLE dm_receipts_new_release;')
                for p in [OLD/'data',*(OLD/'data').rglob('*')]:os.chown(p,owner.pw_uid,owner.pw_gid)
            for unit in UNITS:
                if prior[unit]:
                    if migration:userctl('start',unit,check=False)
                    else:subprocess.run(['systemctl','start',unit],capture_output=True)
        raise

def init_dry_run():
    if (RUNTIME/'config.json').exists() or (OLD/'config.json').exists():raise RuntimeError('Existing configuration present; use the tested upgrade path')
    marker=json.loads((CODE/'prepared.json').read_text());release=pathlib.Path(marker['release']).resolve()
    if release.parent!=CODE/'releases' or fingerprint(release)!=marker['fingerprint']:raise RuntimeError('Prepared release differs from tested code')
    account=pwd.getpwnam(ACCOUNT);private_copy(release/'config.json',RUNTIME/'config.json',account.pw_uid,account.pw_gid)
    config=json.loads((RUNTIME/'config.json').read_text())
    if config['mode']!='dry-run':raise RuntimeError('Initial configuration must be dry-run')
    (CODE/'current').symlink_to(release)
    (UNIT_DIR/UNITS[0]).write_text(unit_text(release,False));run(['systemctl','daemon-reload']);run(['systemctl','enable','--now',UNITS[0]])
    print(json.dumps({'installed':True,'mode':'dry-run','personalWorkerStarted':False,'messagesEnabled':False}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--prepare',type=pathlib.Path);parser.add_argument('--browser',type=pathlib.Path,default=pathlib.Path('/home/hermes/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome'));parser.add_argument('--activate',action='store_true');parser.add_argument('--init-dry-run',action='store_true');parser.add_argument('--prune-backups',action='store_true');args=parser.parse_args()
    if os.geteuid()!=0:raise SystemExit('Run as root to install isolated system services')
    try:
        if args.prepare:prepare(args.prepare.resolve(),args.browser.resolve())
        elif args.prune_backups:prune_backups()
        elif args.init_dry_run:init_dry_run()
        elif args.activate:
            marker_activation=time.time();activate()
        else:parser.error('Choose --prepare or --activate')
    except Exception:
        print('Isolated deployment failed; credentials not displayed. Prior worker states restored when activation had begun.',flush=True);raise SystemExit(1)
