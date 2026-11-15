#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target_dir="$HOME/blnt-alert-monitor"
if [[ ! -f "$source_dir/discord-target.json" && ! -f "$target_dir/discord-target.json" ]]; then
  echo 'Copy discord-target.example.json to discord-target.json and configure the private destination first.' >&2; exit 1
fi
if [[ -e "$target_dir" && ! -e "$target_dir/.blnt-monitor-managed" ]]; then
  echo 'Refusing to overwrite an unmanaged monitor directory' >&2; exit 1
fi
if [[ $(node --version) != v24.* ]]; then echo 'Node 24 required' >&2; exit 1; fi
if [[ -e "$target_dir/config.json" ]] && ! node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1]));process.exit(c.mode==="dry-run"?0:1)' "$target_dir/config.json"; then
  echo 'Refusing to redeploy over a live monitor' >&2; exit 1
fi
mkdir -p "$target_dir" "$target_dir/data" "$target_dir/secrets" "$target_dir/test"
chmod 700 "$target_dir/data" "$target_dir/secrets"
touch "$target_dir/.blnt-monitor-managed"
if systemctl --user is-active --quiet blnt-alert-monitor.service; then systemctl --user stop blnt-alert-monitor.service; fi
for file in package.json package-lock.json cli.mjs collector.mjs oracle-collector.mjs public-rpc.mjs cross-check.mjs markets.json engine.mjs webhook.mjs check-discord.mjs report.mjs README.md; do
  install -m 0644 "$source_dir/$file" "$target_dir/$file"
done
for file in discord-target.json OPENCLAW_HANDOFF.md; do
  if [[ -f "$source_dir/$file" ]]; then install -m 0644 "$source_dir/$file" "$target_dir/$file"; fi
done
if [[ ! -e "$target_dir/config.json" ]] || node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1]));process.exit(c.maxLedgerAgeSeconds?0:1)' "$target_dir/config.json"; then
  install -m 0644 "$source_dir/config.json" "$target_dir/config.json"
fi
node -e 'const fs=require("fs"),p=process.argv[1],c=JSON.parse(fs.readFileSync(p));if(!c.maxCycleSeconds){c.maxCycleSeconds=240;fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")}' "$target_dir/config.json"
node -e 'const fs=require("fs"),p=process.argv[1],c=JSON.parse(fs.readFileSync(p)),d=JSON.parse(fs.readFileSync(process.argv[2]));if(c.source!==d.source){for(const k of ["source","publicRpcProviders","pollSeconds","maxOracleAgeSeconds","crossCheckIntervalSeconds","crossCheckRetrySeconds","crossCheckMaxAgeSeconds","crossCheckTolerancePercent"])c[k]=d[k];fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")}' "$target_dir/config.json" "$source_dir/config.json"
install -m 0644 "$source_dir/test/monitor.test.mjs" "$target_dir/test/monitor.test.mjs"
install -m 0644 "$source_dir/test/oracle.test.mjs" "$target_dir/test/oracle.test.mjs"
cd "$target_dir"
npm ci --ignore-scripts --no-audit --no-fund
npm test
node_bin="$(command -v node)"
browser_bin="${BLNT_BROWSER_PATH:-$HOME/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome}"
if [[ ! -x "$browser_bin" ]]; then echo 'Set BLNT_BROWSER_PATH to an installed Chrome/Chromium executable' >&2; exit 1; fi
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/blnt-alert-monitor.service" <<EOF
[Unit]
Description=BLNT public oracle monitor with website cross-check (dry run)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$target_dir
ExecStart=$node_bin $target_dir/cli.mjs
Environment=BLNT_MONITOR_HOME=$target_dir
Environment=BLNT_BROWSER_PATH=$browser_bin
Restart=on-failure
RestartSec=30
TimeoutStopSec=120
UMask=0077
NoNewPrivileges=true
MemoryMax=1G
CPUQuota=100%
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now blnt-alert-monitor.service
systemctl --user status blnt-alert-monitor.service --no-pager
