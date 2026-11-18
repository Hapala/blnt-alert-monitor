# Dedicated BLNT Alerts Discord application

The dedicated **BLNT Alerts** bot owns alert commands and personal DMs. The personal OpenClaw bot remains private. Shared updates use the BLNT Alerts webhook in #price-alerts, visible to BLNT Trade members. Its canonical routing label is `audience:shared`; this metadata does not configure channel permissions.

## Identity and permissions

Create a separate Discord developer application named BLNT Alerts, install it in the BLNT Trade server using only the `bot` and `applications.commands` scopes, and request **zero server permissions**. Administrator, Manage Channels, Manage Webhooks, Message Content, Server Members and Presence privileged intents are unnecessary. Its slash command is `/blnt-alerts`; do not register OpenClaw tools or commands on this application. Guild installation enables users in that server to reach the application; private DMs still depend on each user's privacy settings and opt-in subscription.

Copy `discord-bot.example.json` to the runtime `discord-bot.json`, pin the new application ID and guild ID, and store only the new bot token in runtime `secrets/discord_bot_token` (directory 0700, file 0600). Host-specific identity files and all secrets are ignored by Git. The loader rejects missing/insecure/symlinked token files and never reads OpenClaw configuration. The personal OpenClaw bot ID is explicitly rejected; the worker also verifies its actual application ID and membership in the pinned BLNT server before registering commands or sending notifications.

Commands are accepted only in the pinned server or in DMs from a verified member of that server. Other servers and nonmember DMs are rejected before subscription changes, except that former members retain unsubscribe and confirmed local-data deletion controls in DMs. This check also applies if someone installs the application elsewhere.

Shared/watchdog services use `blnt-alerts`; the DM service uses a distinct `blnt-alert-dm` UID. Neither account has a login shell or capabilities. They share private data through the `blnt-alerts` group; credentials are owned only by their respective worker and remain mode 0600. Distinct UIDs prevent access through another worker's `/proc/PID/root`, beyond direct-path masks. They have read-only filesystems except their private data directory, private temporary/device views, and hidden personal homes/Windows mounts. Startup fails if personal OpenClaw configuration is readable. No privileged Discord intents, message-content listeners, AI or arbitrary execution handlers are present. The website browser permits only verified public HTTPS origins used by the cross-check; WebSockets and unrelated wallet integrations are blocked. The permission migration occurs only during stopped-writer activation, with rollback restoring prior credential access.

Immutable releases live under `/opt/blnt-alert-monitor/releases`; runtime config/data/credentials live under `/var/lib/blnt-alert-monitor`. `deploy-isolated.py --prepare <source>` tests without stopping workers; `--activate` switches to the tested release with failure recovery. See README.md for current system-service and retention commands.

## Migration sequence

1. Verify the new application/token/server binding before touching the live worker. Never add the alert bot's token to OpenClaw's accounts.
2. Back up SQLite with both writers stopped, preserving subscriptions, preferences, consent, samples and sent-message deduplication. Do not enable any borrowing rules during the migration.
3. Run the dedicated-bot-aware deployment script. It preserves live config and shared webhook credentials. It refuses migration without a dedicated identity/token.
4. Confirm `/blnt-alerts` is registered on the dedicated application, test a real opt-in subscriber DM, and test an authenticated slash-command response. Existing sent messages must not replay.
5. Remove only the alert monitor's `/blnt-alerts` command from the former personal application, leaving every OpenClaw command intact. Keep the old worker stopped throughout the cutover, so it cannot restore that command.
6. Verify personal OpenClaw's Discord DM and guild sender policies restrict the default personal account to the owner. Other configured bot accounts remain unchanged. Treat stored pairing approvals as part of the effective access list.
7. Verify the new bot exposes only alert commands, is never loaded into OpenClaw, and its process cannot read personal OpenClaw files. Record identity and delivery evidence without printing credentials.

Preserve the shared channel's server-member visibility and opt-in personal DMs. Update the pinned command guide when commands or requirements change. See SYSTEM_SPEC.md for accepted requirements and remaining operational work.
