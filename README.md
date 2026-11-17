# BLNT alert monitor

Self-hosted pool monitoring and opt-in Discord alerts for BLNT.trade. Prices come from the pinned pool oracles through hosted public Stellar RPC providers. The website is a cross-check. This repository does not run or use a private/local RPC, sign transactions, or trade.

Shared updates use a channel webhook. The latest user decision is a channel visible to BLNT Trade server members; alignment of legacy private-trial labels/configuration is tracked in [SYSTEM_SPEC.md](SYSTEM_SPEC.md). Personal alerts use verified one-to-one bot DMs, with wallet-based pool discovery, optional extra pools, category/pool mutes, pause, snooze and unsubscribe. Borrowing-capacity and borrow-APR thresholds are customizable per pool and default off.

- [Agent workflow and review instructions](AGENTS.md)
- [System requirements, acceptance checks and known gaps](SYSTEM_SPEC.md)
- [Personal subscriptions and operations](DM_SUBSCRIPTIONS.md)
- [Borrowing-capacity definitions and threshold commands](BORROWING_ALERTS.md)

## Shared alerts

| Update | Rule |
| --- | --- |
| Price move | At least ±5% over about one hour; one-hour cooldown, rearm below 3%. |
| High borrow rate | At least 10% APR per asset; check every five minutes. One warning per episode, at least six hours between warnings. Rearm at 9% or below; recovery posts require a confirmed delivered warning. Already-high rates can alert on activation. |
| Reserve added | A new asset detected in an already tracked pool. |
| Daily update | 09:00 America/Vancouver: price and variable borrow APR together for each asset. |

Only verified fresh public data can trigger these rules. Public rate rules use `publicBorrowRates` in the runtime config; failure retries are bounded to five minutes. These shared rules do not enable anyone's personal borrowing alerts. Samples are labelled; normal posts contain the pool, key value and trigger, with source/time in embed metadata.

## Development

Requires Node 24. An installed Chrome/Chromium executable is required for website checks. Dependencies are pinned; installation does not download a browser.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Tests use synthetic public wallet fixtures and fake Discord delivery. They do not access a wallet, sign transactions, or post real messages. Tests cover fixed-point precision, the published contract's mixed-decimal collateral/liability fixture, the rate curve, threshold boundaries, data freshness, identity changes, browser recovery, recipient isolation and delivery failures.

## Sources

`markets.json` pins the Fixed V3 and YieldBlent deployment IDs, pool/oracle WASM hashes, oracle bindings and quote currencies. Fixed quotes USD; YieldBlent quotes USDC. No peg or conversion is assumed. New pools require registry review. Unknown asset symbols use contract-ID labels.

Public RPC candidates are `https://mainnet.sorobanrpc.com`, `https://soroban-rpc.mainnet.stellar.gateway.fm` and `https://rpc.lightsail.network/`, from Stellar's [provider list](https://developers.stellar.org/docs/data/apis/rpc/providers). Two healthy mainnet providers must agree within five ledgers and 30 seconds. Endpoint and method allowlists exclude local/private RPC and transaction submission. Collection uses ledger time because host clocks can jump. Identity/binding changes fail closed pending review.

Only network/health checks, ledger reads and unsigned simulations of allowlisted getters are used. `get_reserve` previews accrued state without committing writes. Borrowing math follows the pinned [contract revision](https://github.com/BLNT-Protocol/blnt-contracts-v3/tree/771059f6dd232fd35ea29b7b2a987f0e13bb2372); detailed units and limitations are in BORROWING_ALERTS.md.

## Configure and run

The checked-in `config.json` is a dry-run template. Runtime destination IDs and credentials remain private operator configuration. Verify actual channel permissions in Discord: webhook metadata confirms routing, not privacy. The source currently has a legacy private-audience declaration; see the explicit visibility-alignment gap in SYSTEM_SPEC.md before changing that declaration. Do not restore a private channel contrary to the latest user decision.

The shared webhook URL belongs in `secrets/discord_webhook`, directory mode 0700, file mode 0600. The DM worker uses a separate BLNT Alerts bot. Its token belongs in `secrets/discord_bot_token` (0600); copy `discord-bot.example.json` to the ignored runtime `discord-bot.json` to pin its application and guild IDs. There is no OpenClaw credential fallback. Never commit credentials. Install the bot in the intended server with only bot/application-command scopes and zero requested server permissions. It needs no privileged gateway intents and reads no message content. See DEDICATED_BOT.md for migration and service isolation.

```sh
BLNT_BROWSER_PATH=/path/to/chrome node cli.mjs --once
# Existing managed WSL deployment:
bash deploy-dry-run.sh
bash deploy-subscriptions.sh
```

Deployment requires administrator access. Both scripts use `deploy-isolated.py` to stage a complete immutable release under `/opt/blnt-alert-monitor/releases`, install locked dependencies without package scripts, run tests and verify executable imports. A real website cross-check runs under live service restrictions before activation. The account is `blnt-alerts`, with no login shell; runtime files live under `/var/lib/blnt-alert-monitor`. Both system services deny access to personal home directories and Windows mounts. The DM service masks the shared webhook credential; the shared service masks the bot token.

`deploy-dry-run.sh` installs only a new dry-run shared collector and refuses existing configurations. `deploy-subscriptions.sh` prepares and tests before stopping workers, backs up both stopped database writers, then switches units to the tested release. Activation verifies fresh heartbeats, source readiness and unchanged preferences. Failure restores the previous release and both previously active workers. First migration retains the old private runtime temporarily for rollback and disables its user services after success. No OpenClaw files are copied or modified. Never overwrite live config with the source template.

If the owner explicitly approves retaining existing borrowing thresholds, activate the prepared release with `python3 deploy-isolated.py --activate --preserve-owner-rules`. This preserves existing settings; it does not configure or enable a rule. Without that explicit option, configured owner rules block activation before services stop.

To activate real messages, explicitly authorize the destination, set runtime `mode=live`, and supply `BLNT_PUBLISH_APPROVED=true` to the appropriate service. `trial=true` permits a one-time labelled format sample; normal alerts omit trial labels. Activation is a deliberate operator action; installing source does not constitute consent from a subscriber. Use `/blnt-alerts subscribe` for self-service opt-in, or the operator-only `bootstrap-subscriber.mjs <verified Discord ID> <public address>` after explicit consent. New borrowing thresholds remain off until the user configures them.

```sh
sudo systemctl status blnt-alert-monitor blnt-dm-alerts
sudo cat /var/lib/blnt-alert-monitor/data/status.json
sudo cat /var/lib/blnt-alert-monitor/data/dm-status.json
sudo -u blnt-alerts env BLNT_MONITOR_HOME=/var/lib/blnt-alert-monitor node /opt/blnt-alert-monitor/current/report.mjs
sudo -u blnt-alerts env BLNT_MONITOR_HOME=/var/lib/blnt-alert-monitor node /opt/blnt-alert-monitor/current/inspect-subscriber.mjs <Discord-user-ID>
sudo -u blnt-alerts env BLNT_MONITOR_HOME=/var/lib/blnt-alert-monitor node /opt/blnt-alert-monitor/current/verify-borrowing.mjs <Discord-user-ID>
```

`verify-borrowing.mjs` performs read-only current-state verification and caches personal results privately; it sends no messages and does not enable rules. `/blnt-alerts borrowing` refreshes personal results through Discord with an ephemeral response.

## Alert behavior and limits

The shared daily status includes each enabled reserve's current variable borrow APR, grouped by pool. Rates are read once when preparing that day's shared digest, using public reserve getters and the same fixed-point rate curve as personal borrowing alerts. No wallet or subscription is needed. APR is annualized, not APY or a personalized charge. Changed pool identities, incomplete reserve coverage and stale previews are shown as unavailable, never as zero. APR availability is independent of the oracle-price website cross-check. Each daily post carries a separate rate timestamp. Personal rules remain off until explicitly configured; command replies spell out percentage, quote-amount and APR thresholds separately.

Price defaults are +/-5% over approximately one hour, one-hour cooldown, re-arm below 3%, continuous-history requirements and a 15-minute maximum source gap. Website checks run initially and every 30 minutes, retrying failures after five minutes. Rounding plus a configurable 0.5% asynchronous-feed allowance is accepted. An unavailable/missing/mismatched/expired check suppresses affected price alerts and capacity calculations; oracle history continues and reserve APR can still be evaluated separately. Website prices never replace oracle prices.

Samples and shared run history use eight-day retention. Personal settings, wallet associations and receipts live in the private runtime database, separate from shared message payloads. Pending messages expire after 15 minutes. Rate-limit retries are bounded. Network/5xx/crash uncertainty requires review and never automatically replays, so exactly-once delivery is not promised.

A pool mute wins over automatic discovery and extra pools. Failed discovery retains the previous association as stale and suppresses automatic selection. A changed selection cancels pending multi-pool digests. Closed DMs stop retries until explicit resume. The pilot is limited to 20 enabled subscribers pending public-provider capacity review.

Set `paused=true` in runtime config or create the runtime `PAUSED` file to pause scheduled delivery. Stop personal alerts independently with `sudo systemctl stop blnt-dm-alerts`; shared collection continues. Never copy a running SQLite database without its backup API; deployment stops writers before copying SQLite/WAL files.

Preference edits cancel only affected messages. Definitely unsent cancelled/expired warnings can re-arm; sent, in-flight and uncertain outcomes never automatically replay. Borrowing/test commands have per-user cooldowns and a global work limit. Scheduled delivery revalidates server membership (cached at most one minute); confirmed removal disables the subscription. Former members retain unsubscribe/erase controls. A monotonic ledger-anchored clock rechecks freshness between recipients and sends; long cycles yield fairly. Oversized messages are paginated; partial sends become uncertain.

After unsubscribing, `/blnt-alerts forget confirm:DELETE` erases current local subscription/history; Discord messages remain. Root-owned rollback backups are retained at most 30 days/10 snapshots by `blnt-alert-retention.timer`; legacy runtime data/secrets/backups retire after 30 days. Orphan receipts and obsolete rule state are pruned. Uncertain delivery evidence remains for review unless the user explicitly erases their data. Independent off-host backups/heartbeat hosting and a full 20-user load exercise remain operational follow-up work.

Continuous operation requires the host and WSL to remain awake. Public-provider uptime and rate limits remain trial dependencies. Oracle references are not execution prices. Available borrowing headroom is a risk-adjusted credit measure, not guaranteed cash or a guarantee that a proposed borrow succeeds. Trading volume/liquidity, arbitrary news and trading execution are outside this project.
