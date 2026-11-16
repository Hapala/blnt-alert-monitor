#!/usr/bin/env bash
set -euo pipefail
umask 077
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target_dir="$HOME/blnt-alert-monitor"
[[ -f "$target_dir/.blnt-monitor-managed" && -f "$target_dir/config.json" ]] || { echo 'Existing managed monitor required'; exit 1; }
[[ $(node --version) == v24.* ]] || { echo 'Node 24 required'; exit 1; }
if [[ ! -f "$target_dir/discord-bot.json" || ! -f "$target_dir/secrets/discord_bot_token" ]]; then
  echo 'Configure the dedicated BLNT bot identity and private token file before migration; personal OpenClaw credentials are not accepted.' >&2; exit 1
fi
cd "$source_dir"
BLNT_MONITOR_HOME="$target_dir" node --input-type=module -e 'import {loadDmToken,loadBotTarget} from "./dm-api.mjs";loadBotTarget();loadDmToken();'
npm test
dm_was_active=false
if systemctl --user is-active --quiet blnt-dm-alerts.service; then dm_was_active=true; fi
systemctl --user stop blnt-dm-alerts.service 2>/dev/null || true
systemctl --user stop blnt-alert-monitor.service
# Both database writers are stopped: copy SQLite plus any WAL before migration.
backup_dir="$target_dir/backups/subscriptions-$(date +%s)"
mkdir -p "$backup_dir" "$target_dir/test"
for f in monitor.sqlite monitor.sqlite-wal monitor.sqlite-shm; do
  if [[ -e "$target_dir/data/$f" ]]; then cp -p "$target_dir/data/$f" "$backup_dir/$f"; fi
done
# Keep shared monitoring recoverable if a dependency or test fails.
trap 'systemctl --user start blnt-alert-monitor.service' EXIT
for f in package.json package-lock.json cli.mjs collector.mjs oracle-collector.mjs public-rpc.mjs cross-check.mjs markets.json engine.mjs webhook.mjs subscriptions.mjs dm-api.mjs subscription-commands.mjs dm-runtime.mjs dm-worker.mjs borrow-math.mjs borrow-collector.mjs borrow-alerts.mjs bootstrap-subscriber.mjs inspect-subscriber.mjs verify-borrowing.mjs README.md DM_SUBSCRIPTIONS.md BORROWING_ALERTS.md DEDICATED_BOT.md; do
  install -m 0644 "$source_dir/$f" "$target_dir/$f"
done
if [[ -f "$source_dir/OPENCLAW_HANDOFF.md" ]]; then install -m 0644 "$source_dir/OPENCLAW_HANDOFF.md" "$target_dir/OPENCLAW_HANDOFF.md"; fi
for f in "$source_dir"/test/*.test.mjs; do install -m 0644 "$f" "$target_dir/test/$(basename "$f")"; done
cd "$target_dir"
npm ci --ignore-scripts --no-audit --no-fund
npm test
node_bin="$(command -v node)"
cat > "$HOME/.config/systemd/user/blnt-dm-alerts.service" <<EOF
[Unit]
Description=BLNT opt-in personal Discord DM alerts
After=network-online.target blnt-alert-monitor.service

[Service]
Type=simple
WorkingDirectory=$target_dir
ExecStart=$node_bin $target_dir/dm-worker.mjs
Environment=BLNT_MONITOR_HOME=$target_dir
Environment=BLNT_PUBLISH_APPROVED=true
ExecStartPre=/usr/bin/test ! -r $HOME/.openclaw/openclaw.json
PrivateUsers=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=$target_dir/data
InaccessiblePaths=-$HOME/.openclaw -$HOME/.ssh -$HOME/.aws -$target_dir/secrets/discord_webhook
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictSUIDSGID=yes
Restart=on-failure
RestartSec=30
TimeoutStopSec=90
UMask=0077
NoNewPrivileges=true
MemoryMax=512M
CPUQuota=50%
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user start blnt-alert-monitor.service
systemctl --user enable blnt-dm-alerts.service
if [[ "$dm_was_active" == true ]]; then
  systemctl --user start blnt-dm-alerts.service
  echo 'Updated DM worker and restored personal delivery.'
else
  echo 'Installed DM worker; bootstrap an explicitly consenting subscriber before starting it.'
fi
