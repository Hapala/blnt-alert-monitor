# Changes

## 2026-11-17 — Monitoring and pool-condition alerts

Implemented and deployed as three separately reviewed changes:

- `a355cdc`: independent local monitoring-health watchdog. Warn once after five minutes of observed degradation; recover after at least one minute of healthy checks. Quiet startup/pauses and generic public diagnostics. Full host/network/Discord outage notification still requires an external watchdog.
- `4a224ff`: identity-verified pool-status transitions with explicit borrowing/supply restrictions. Silent initial baseline; seven status codes checked against the registry's exact contract revision. No additional RPC calls.
- `7cc850b`: reserve liquidity warnings at 90% utilization, critical escalation at 95%, recovery at 85% or below, with six-hour warning cooldowns. Reuses five-minute reserve reads, uses conservative integer accounting and labels remaining supply as an estimate rather than guaranteed withdrawable liquidity.
- `8991a78`: final live verification exposed a host/ledger clock offset. The watchdog now anchors freshness to the collector's ledger/capture-time pair, with regression coverage for host offsets and stopped-source updates.

The final isolated release passed 93 tests, executable import checks, website cross-check and access-isolation probes before activation. Each feature and the clock fix passed GitHub CI. Synthetic failure tests covered debounce, recovery, cancellation, uncertain delivery, schema/freshness failures, fixed-point boundaries and clock offsets; live protocol failures were not induced. Scheduled live collection verified liquidity calculations for all 13 reserves, both status baselines were verified and the independent watchdog reported zero issues. Deployment preserved subscriber settings. Shared daily reports remain disabled.

See [system requirements](SYSTEM_SPEC.md), [pool alert definitions](POOL_ALERTS.md) and [agent workflow](AGENTS.md). Always-on hosting, independent off-host outage monitoring and the previously documented operational exercises remain follow-ups.
