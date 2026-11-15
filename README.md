# BLNT alert monitor

Self-hosted pool monitoring and opt-in Discord alerts for BLNT.trade. Prices come from the pinned pool oracles through hosted public Stellar RPC providers. The website is a cross-check. This repository does not run or use a private/local RPC, sign transactions, or trade.

Shared updates use a webhook in a private Discord channel. Personal alerts use verified one-to-one bot DMs, with wallet-based pool discovery, optional extra pools, category/pool mutes, pause, snooze and unsubscribe. Borrowing-capacity and borrow-APR thresholds are customizable per pool and default off.

- [Personal subscriptions and operations](DM_SUBSCRIPTIONS.md)
- [Borrowing-capacity definitions and threshold commands](BORROWING_ALERTS.md)

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

The checked-in `config.json` is a dry-run template. Copy `discord-target.example.json` to `discord-target.json` and set the intended private channel/guild IDs. Verify channel privacy in Discord: webhook metadata confirms routing, but cannot prove channel permissions. Keep the channel unsynced from public category permissions.

The shared webhook URL belongs in `secrets/discord_webhook`, directory mode 0700, file mode 0600. The DM worker reads an existing bot credential from the `default` Discord account in OpenClaw's configuration; override the configuration path with `BLNT_OPENCLAW_CONFIG` and account with `BLNT_DISCORD_ACCOUNT`. Never commit credentials. The bot needs to be accessible to subscribers; the pilot uses an existing mutual server. It needs no privileged gateway intents and reads no message content.

```sh
BLNT_BROWSER_PATH=/path/to/chrome node cli.mjs --once
# Existing managed WSL deployment:
bash deploy-dry-run.sh
bash deploy-subscriptions.sh
```

`deploy-dry-run.sh` installs the shared collector under `$HOME/blnt-alert-monitor` and refuses to overwrite a live config. `deploy-subscriptions.sh` upgrades that managed installation, stops both database writers for a SQLite/WAL backup, preserves the live config and shared webhook, runs tests and restores active services. Host-specific target configuration and operator handoff notes are excluded from Git. Source and runtime configuration are separate: never overwrite a live configuration with the source dry-run template.

To activate real messages, explicitly authorize the destination, set runtime `mode=live`, and supply `BLNT_PUBLISH_APPROVED=true` to the appropriate service. Trial messages use `trial=true` labels. Activation is a deliberate operator action; installing source does not constitute consent from a subscriber. Use `/blnt-alerts subscribe` for self-service opt-in, or the operator-only `bootstrap-subscriber.mjs <verified Discord ID> <public address>` after explicit consent. New borrowing thresholds remain off until the user configures them.

```sh
systemctl --user status blnt-alert-monitor blnt-dm-alerts
cat "$HOME/blnt-alert-monitor/data/status.json"
cat "$HOME/blnt-alert-monitor/data/dm-status.json"
cd "$HOME/blnt-alert-monitor"
node report.mjs
node inspect-subscriber.mjs <Discord-user-ID>
node verify-borrowing.mjs <Discord-user-ID>
```

`verify-borrowing.mjs` performs read-only current-state verification and caches personal results privately; it sends no messages and does not enable rules. `/blnt-alerts borrowing` refreshes personal results through Discord with an ephemeral response.

## Alert behavior and limits

Price defaults are +/-5% over approximately one hour, one-hour cooldown, re-arm below 3%, continuous-history requirements and a 15-minute maximum source gap. Website checks run initially and every 30 minutes, retrying failures after five minutes. Rounding plus a configurable 0.5% asynchronous-feed allowance is accepted. An unavailable/missing/mismatched/expired check suppresses affected price alerts and capacity calculations; oracle history continues and reserve APR can still be evaluated separately. Website prices never replace oracle prices.

Samples and shared run history use eight-day retention. Personal settings, wallet associations and receipts live in the private runtime database, separate from shared message payloads. Pending messages expire after 15 minutes. Rate-limit retries are bounded. Network/5xx/crash uncertainty requires review and never automatically replays, so exactly-once delivery is not promised.

A pool mute wins over automatic discovery and extra pools. Failed discovery retains the previous association as stale and suppresses automatic selection. A changed selection cancels pending multi-pool digests. Closed DMs stop retries until explicit resume. The pilot is limited to 20 enabled subscribers pending public-provider capacity review.

Set `paused=true` in runtime config or create the runtime `PAUSED` file to pause both services' delivery. Stop personal alerts independently with `systemctl --user stop blnt-dm-alerts`; shared collection continues. Never copy a running SQLite database without its backup API; deployment scripts stop writers before copying SQLite/WAL files.

Continuous operation requires the host and WSL to remain awake. Public-provider uptime and rate limits remain trial dependencies. Oracle references are not execution prices. Available borrowing headroom is a risk-adjusted credit measure, not guaranteed cash or a guarantee that a proposed borrow succeeds. Trading volume/liquidity, arbitrary news and trading execution are outside this project.
