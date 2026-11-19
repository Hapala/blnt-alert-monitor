# BLNT Alerts: manager review handoff

**Deployment snapshot: November 19, 2026.** Six fixes are live in release `release-1795095774-6da01a87`, built from `d1e8443`. Deployment verification is recorded in `50b014a`. These are dated observations, not a claim of continuous availability.

## What changed

- Separate Linux worker accounts block access to opposite Discord credentials, including through another process's filesystem namespace.
- Late discovery, borrowing and delivery results cannot recreate locally deleted subscriber data, including after same-wallet re-enrolment.
- Definitely unsent price alerts cancel when verified coverage is withdrawn.
- Monitoring health includes partial pool/check failures, not just exceptions.
- Unsent liquidity warnings downgrade when current verified severity falls.
- Long-running high-APR episodes retain delivery evidence needed for recovery notices beyond ordinary history retention.

Each fix was tested, reviewed and committed separately. Requirements and operating guides were updated. Existing thresholds, consent and destination configuration were preserved, verified by before/after fingerprints.

## What was tested

- **104/104 automated tests passed** in the prepared release, covering retries/cancellation, privacy races, partial failures, severity changes, retention and deployment/rollback. All six fix commits and the separate startup helper passed GitHub CI.
- Live checks verified advancing heartbeats, 13 prices and 13 reserve APRs across two pools, fresh discovery, database integrity and zero personal-check/watchdog issues.
- Both workers passed direct and peer-process credential checks. Read-only Discord checks verified the destination, dedicated bot identity and 16 subcommands.
- Activation used a stopped-writer backup and readiness/rollback gates. No forced Discord samples or real protocol fault injections were performed.

## Still outstanding

- Always-on hosting, independent off-host outage monitoring and backup storage. Windows/WSL must currently remain awake.
- Full 20-subscriber/provider-load testing and an end-to-end restore exercise. Automated rollback tests do not replace disaster-recovery testing.
- The separate personal OpenClaw helper starts after Windows sign-in. Manual launch passed; a real reboot test and before-login operation were not verified.
- Public RPC/Discord availability remains external. No independent audit of upstream contracts/native binaries was performed.

Review against [SYSTEM_SPEC.md](SYSTEM_SPEC.md), [CHANGELOG.md](CHANGELOG.md) and the [code comparison](https://github.com/Hapala/blnt-alert-monitor/compare/a7f675a...d1e8443). This is ready for manager review; manager approval has not been claimed. Cloud migration is separate from this deployment.
