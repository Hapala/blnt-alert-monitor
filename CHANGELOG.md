# Changes

## 2026-11-27 — Optional startup before Windows sign-in

Add a dedicated limited-privilege S4U boot task that launches existing Ubuntu services and keeps WSL alive without storing a password or depending on a checkout script. A fixed profile-free PowerShell command supplies native handles for WSL. Before installation, test the actual noninteractive principal's WSL access, enabled/running units, public RPC health and Discord HTTPS access using the deployed Node network implementation. Preserve the personal OpenClaw sign-in task and all alert settings. Add Windows argument-safety checks; document installation, removal and the separate full-reboot acceptance check.

Installed and read back the running boot task after its actual S4U readiness test passed. Both workers remained healthy, website/data/watchdog checks passed and private settings fingerprints were unchanged. Windows PowerShell checks and 128 Node tests passed. A full Windows reboot without sign-in remains untested. See [verification and operating instructions](WINDOWS_BOOT.md).

## 2026-11-27 — Worker-lock recovery deployed

Activated `release-1795791180-c5384b8b` from `a08144e` after 128 tests and passing CI. Both deployed workers recovered automatically from controlled SIGKILL tests without manual lock cleanup; post-recovery kernel probes refused duplicate acquisition. Fresh data, watchdog health, credential isolation and unchanged configuration/subscriber fingerprints passed. Full Windows reboot testing remains outstanding; existing WSL startup is after sign-in. See [deployment verification](DEPLOYMENT_LOCKS_2026-11-27.md).

## 2026-11-27 — Kernel-held worker locks

Replace PID-only shared/DM locks with nonblocking kernel file locks held for process lifetime and released on graceful exit, crash or reboot. Preserve lock inodes and numeric inspection metadata; reject genuine legacy owners during upgrades and fail closed on unsafe/unavailable locks. Preparation checks util-linux flock before activation. Add real-process concurrency, SIGKILL/descriptor inheritance, reused-PID, partial metadata, legacy-owner and unsafe-path regressions. Personal settings and delivery semantics are unchanged. Deployment verification is recorded separately.

## 2026-11-27 — Severity and active alarms deployed

Activated `release-1795788626-d9167749` from `e410989` after 122 tests, all executable imports, a 13-price website match and isolation checks. Live checks confirmed advancing worker heartbeats, 13 reserve APRs across both pools, fresh discovery, SQLite integrity, zero watchdog/personal failures and unchanged personal/configuration fingerprints. Both alarm stores are populated, the read-only view works under the DM service account, and Discord has the expected 17 subcommands including `active`. Direct and peer-process credential restrictions passed in both directions. A deployed-code in-memory/fake-transport smoke test confirmed Sev 1/2 delivery attempts and Sev 3/4 recording without real test messages. Initial preparation correctly stopped on stale data: the old collector's PID-only lock referred to `agetty` after PID reuse, with no collector running. The exact obsolete lock was removed after verification, restoring collection before preparation/activation. Price-move conditions must rebuild a continuous hourly history after that gap; other public conditions are evaluated. Restart-safe lock hardening remains a follow-up, recorded in the spec.

## 2026-11-26 — Read-only shared alarm command

Add `/blnt-alerts active`, with ephemeral ten-entry result pages, no personal subscription requirement and existing server/member authorization. Combine shared and independent watchdog state without querying personal records; show all severities, unknown values, durations and explicit recent-event expiry. Database/clock unavailability and empty state never claim an all-clear. Make newly created watchdog data group-private for the read-only view, retaining credential isolation. Added view, authorization, paging and custom-personal-threshold preservation tests. No automatic board, personal-default migration or live deployment included.

## 2026-11-26 — Persistent shared alarm episodes

Track public price, high APR, liquidity, pool restrictions and monitoring conditions independently of notification state. Persist episode/timestamps/value/severity; stale or missing inputs become unknown instead of resolving. Use existing trigger/recovery thresholds, and retain unresolved episodes beyond ordinary history retention. Recent APR/reserve/status/gap events have an explicit one-hour lifetime. Watchdog state remains independent, and personal results/preferences are excluded. Added lifecycle, collector, restart, expiry and privacy regressions. Source only; not deployed.

## 2026-11-26 — Severity and shared delivery policy

Add four severity levels and shared embed labels. Shared Sev 3/4 events are recorded silently; only Sev 1/2 automatically post. Keep personal payloads, settings and delivery unchanged. Preserve legacy queued warnings at Sev 2 and make recorded outcomes terminal without calling them delivered. Update movement baselines and pool transitions for recorded events. Added filtering, legacy migration and personal-preservation regressions. Source only; not deployed.

## 2026-11-19 — Six review fixes deployed and verified

Activated immutable release `release-1795095774-6da01a87` from source `d1e8443`, containing all six separately reviewed fixes. Preparation passed 104 tests, executable import checks, a matching 13-price website cross-check and access probes. Live verification confirmed advancing release-specific heartbeats, 13 reserve APRs across both pools, fresh discovery, SQLite integrity, initialized subscription generations and zero watchdog/personal-check failures. Shared and DM workers use distinct UIDs; both direct and peer-process credential paths were checked in both directions. Read-only Discord checks verified the shared destination, dedicated bot identity and 16 subcommands. Configuration/subscriber fingerprints matched before and after activation, preserving existing approved thresholds and consent. Rollback backup and maintenance timers are available. No forced Discord test messages were sent; simulated fault-path regression tests were not repeated against real users or protocol state.

## 2026-11-18 — Windows OpenClaw startup helper

Add a separate current-user Windows sign-in task to launch the existing Ubuntu OpenClaw gateway and keep WSL running without a visible console. Document verification, removal and the after-login boundary. No OpenClaw credentials, models, access policies, BLNT subscriptions or unrelated tasks are changed. A real reboot test remains separate from a manual startup test.

## 2026-11-18 — Long-running APR recovery evidence

Retain the high/recovery outbox records referenced by each public rate episode beyond ordinary eight-day history retention. Release references after confirmed recovery so old evidence can be pruned without replaying a recovery. At most two records per tracked rate state receive this exception; thresholds/settings are unchanged. Add a continuous nine-day episode regression covering recovery, evidence cleanup and no replay after later retention.

## 2026-11-18 — Liquidity retry severity

Cancel an unsent critical liquidity warning when the latest verified preview is below the critical threshold. If no warning was delivered, replace it with the current ordinary severity; an already delivered warning retains its cooldown and recovery history. Sent/uncertain outcomes never replay. Add rate-limit, downgrade, recovery/cooldown and uncertain-send regressions. Thresholds are unchanged.

## 2026-11-18 — Personal monitoring health coverage

Aggregate stale/missing borrowing pool results and incomplete configured capacity/rate checks into personal-worker health instead of counting exceptions alone. Unmuted discovery failures also mark the cycle degraded. Unconfigured/muted checks and valid wallets without positions do not invent failures. Shared health posts keep generic component labels. Add worker-to-watchdog regression tests; no user rules or thresholds change.

## 2026-11-18 — Cancel prices when verification is withdrawn

Cancel definitely unsent price alerts when current verified asset coverage is missing, stale or fails the website cross-check. Cancelled warnings can rearm when verification returns; sent/uncertain messages and other audiences remain untouched. Add rate-limit retry and audience-isolation regressions. Price events remain timestamped historical changes; recovery alone does not withdraw a verified event.

## 2026-11-18 — Deletion during in-flight checks

Revalidate subscription consent, revision and a unique enrolment generation after asynchronous discovery/borrowing work, including failure handlers. Confirmed deletion cannot be undone by a late result, even if the same wallet is immediately re-enrolled. Late DM results cannot recreate erased receipts or delivery state. Add regressions for successful/failed collection, discovery, re-enrolment and delivery. Existing settings remain unchanged; an already in-flight Discord request may still complete remotely.

## 2026-11-18 — Credential process isolation

Separate the DM worker's Linux UID from shared/watchdog workers. Tokens remain owner-only; the existing private data is shared through a restricted group. Stopped-writer activation migrates ownership and permissions, and rollback restores prior credential access without changing settings. Add permission/rollback checks and a root-only synthetic test proving opposite credentials cannot be accessed directly or through a peer process root. Source change; deployment is separate.

## 2026-11-18 — Shared-channel wording cleanup

Use `audience:shared` for the shared webhook target. The historical `private` label remains accepted for safe upgrades, with identical destination verification; neither label changes Discord permissions. Examples and current guides use the shared-channel policy, while personal messages stay in DMs. Removed private-trial prefixes from new subscription and DM-test messages. Preserved the historical sample deduplication ID to prevent reposts. The channel topic now describes event-only updates and personal DMs, without the old daily-report promise.

## 2026-11-17 — Monitoring and pool-condition alerts

Implemented and deployed as three separately reviewed changes:

- `a355cdc`: independent local monitoring-health watchdog. Warn once after five minutes of observed degradation; recover after at least one minute of healthy checks. Quiet startup/pauses and generic public diagnostics. Full host/network/Discord outage notification still requires an external watchdog.
- `4a224ff`: identity-verified pool-status transitions with explicit borrowing/supply restrictions. Silent initial baseline; seven status codes checked against the registry's exact contract revision. No additional RPC calls.
- `7cc850b`: reserve liquidity warnings at 90% utilization, critical escalation at 95%, recovery at 85% or below, with six-hour warning cooldowns. Reuses five-minute reserve reads, uses conservative integer accounting and labels remaining supply as an estimate rather than guaranteed withdrawable liquidity.
- `8991a78`: final live verification exposed a host/ledger clock offset. The watchdog now anchors freshness to the collector's ledger/capture-time pair, with regression coverage for host offsets and stopped-source updates.

The final isolated release passed 93 tests, executable import checks, website cross-check and access-isolation probes before activation. Each feature and the clock fix passed GitHub CI. Synthetic failure tests covered debounce, recovery, cancellation, uncertain delivery, schema/freshness failures, fixed-point boundaries and clock offsets; live protocol failures were not induced. Scheduled live collection verified liquidity calculations for all 13 reserves, both status baselines were verified and the independent watchdog reported zero issues. Deployment preserved subscriber settings. Shared daily reports remain disabled.

See [system requirements](SYSTEM_SPEC.md), [pool alert definitions](POOL_ALERTS.md) and [agent workflow](AGENTS.md). Always-on hosting, independent off-host outage monitoring and the previously documented operational exercises remain follow-ups.
