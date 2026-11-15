#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target_dir="$HOME/blnt-alert-monitor"
[[ -f "$target_dir/.blnt-monitor-managed" ]] || { echo 'Managed monitor not found' >&2; exit 1; }
cd "$target_dir"
node check-discord.mjs
systemctl --user stop blnt-alert-monitor.service
install -m 0644 "$source_dir/engine.mjs" "$target_dir/engine.mjs"
install -m 0644 "$source_dir/test/monitor.test.mjs" "$target_dir/test/monitor.test.mjs"
npm test
node -e 'const fs=require("fs"),p="config.json",c=JSON.parse(fs.readFileSync(p));c.mode="live";c.trial=true;c.paused=false;fs.writeFileSync(p+".tmp",JSON.stringify(c,null,2)+"\n",{mode:0o600});fs.renameSync(p+".tmp",p)'
if [[ -e "$target_dir/PAUSED" ]]; then echo 'PAUSED marker exists; remove it only if intentionally resuming this monitor' >&2; exit 1; fi
mkdir -p "$HOME/.config/systemd/user/blnt-alert-monitor.service.d"
cat > "$HOME/.config/systemd/user/blnt-alert-monitor.service.d/private-trial.conf" <<'EOF'
[Unit]
Description=BLNT private Discord posting trial

[Service]
Environment=BLNT_PUBLISH_APPROVED=true
EOF
systemctl --user daemon-reload
systemctl --user start blnt-alert-monitor.service
systemctl --user status blnt-alert-monitor.service --no-pager
