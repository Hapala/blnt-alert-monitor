# Personal Discord DM subscriptions

The user chose DMs for personal alerts on November 15, 2026. Shared updates continue through the existing private #price-alerts webhook. Personal queues are recipient-scoped and cannot be consumed by that webhook. No per-subscriber channels are created.

The dedicated BLNT Alerts bot delivers personal messages and owns /blnt-alerts. It uses its own private token file and pinned application identity, with no OpenClaw credential fallback. The service is denied access to personal OpenClaw files and listens only for slash-command interactions, with no privileged intents or message-content access. See DEDICATED_BOT.md for installation, isolation and migration details.

## User controls

- `/blnt-alerts subscribe wallet:<public Stellar address>` opts the calling Discord user into personal DMs.
- `/blnt-alerts status` or `pools` privately lists their settings and discovery status.
- `/blnt-alerts add-pool pool:<choice>` follows an extra supported pool; `remove-pool` removes only that manual addition.
- `/blnt-alerts mute pool:<choice>` excludes a pool even if automatically discovered or manually added. Use `unmute` to reverse.
- `/blnt-alerts mute category:<choice>` mutes price, digest, reserve_updates, format_preview or subscription_status. Category `all` pauses personal notifications.
- `/blnt-alerts pause`, `resume`, `snooze minutes:<number>` and `unsubscribe` control delivery. Resume also retries future eligible delivery after DMs were blocked; old blocked messages are not replayed.
- `/blnt-alerts test` requests a labelled DM delivery test.

The caller ID comes from the authenticated Discord interaction, never from a recipient argument. Settings responses are ephemeral. The user-provided wallet is a public address, not proof of wallet ownership; this service reads public state and cannot sign transactions. An invalid/secret address is rejected. First-subscriber registration via `bootstrap-subscriber.mjs` is an operator-only path requiring explicit consent and a verified Discord ID.

## Discovery and delivery

Every five minutes, unsigned public-RPC simulations read `get_positions(wallet)` in both pinned V3 pools and `user_balance(tier,pool,wallet)` on the pinned backstop. Positive supply, collateral, liabilities, backstop shares or queued withdrawals associate a pool. Fixed includes FirstLoss/SecondLoss/ThirdLoss; YieldBlent includes FirstLoss/SecondLoss. Identity hashes, oracle/backstop bindings and getter result schemas are checked. A failed read preserves the previous association as stale, suppresses automatic selection for that pool and retries after one minute. Confirmed zero exposure removes an association. Explicit extra pools remain optional; a pool mute always wins. Discovery older than 15 minutes fails closed. Newly deployed pools need registry review.

Price messages reuse the primary oracle and website-cross-check gating. Only selected pools enter personal snapshots. Personal state, wallet addresses, receipts and consent are stored under the host's private data directory. No balances or wallet addresses are added to the shared snapshot. Pending messages are cancelled when preferences or selected pools change, including multi-pool digests. Disabling a subscription cancels pending delivery. Discord DM channel type and recipient are verified before every send, mentions are disabled, and message/channel receipts are recorded.

Closed DMs stop retries until explicit resume. Rate limits have bounded retries; transport/5xx/crash uncertainty never automatically replays. Messages expire after 15 minutes. There is a 20-enabled-subscriber pilot limit pending provider-capacity review. WSL/Windows must remain awake. Personal borrowing-capacity and borrow-APR rules are supported and default off. See BORROWING_ALERTS.md for exact definitions and commands.

## Operations

`bash deploy-subscriptions.sh` updates only the managed monitor, preserving its live config and shared webhook credential. It stops both SQLite writers for backup/migration, installs pinned dependencies, runs the suite, restarts shared monitoring and installs the separate `blnt-dm-alerts.service`. Start the DM unit only after registering an explicitly consenting subscriber.

`node inspect-subscriber.mjs <Discord user ID>` reports discovery and delivery receipts without printing the wallet or bot token. `data/dm-status.json` reports worker health. Stop personal delivery with `systemctl --user stop blnt-dm-alerts`; shared monitoring continues. To pause both services use the monitor's PAUSED file or config flag. No RPC/Core/PM2 services are changed.
