# Changes

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
