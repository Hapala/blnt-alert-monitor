# Worker-lock recovery deployment — 2026-11-27

Deployed source `a08144e2edd629d1ed61ca337815407c6d78e47e` as immutable release `release-1795791180-c5384b8b`. Rollback snapshot: `/var/backups/blnt-alert-monitor/before-1795791274-473320d1`. Activation used `--preserve-owner-rules`.

## Change and review

Shared and DM workers now hold exclusive kernel locks for their process lifetime. Crashes and reboots release ownership automatically; stale PID markers no longer prevent recovery. Lock files remain in place to avoid replacement-inode races. Unsafe paths and unavailable locking fail closed, and live legacy workers block takeover during upgrades. See [WORKER_LOCKING.md](WORKER_LOCKING.md).

The staged executable/spec/docs change was reviewed with no unresolved findings. Local and isolated prepared-release suites each passed **128 tests**, including real-process contention, abrupt termination, descriptor inheritance, reused PID, legacy-worker and unsafe-path cases. Credential scanning and dependency audit passed. [Source CI passed](https://github.com/Hapala/blnt-alert-monitor/actions/runs/46019819461).

## Live checks

- Both enabled worker services are running the new release. Each was deliberately terminated once with SIGKILL, only after confirming no outbox rows were sending. Systemd restarted each automatically; both subsequently produced fresh release-specific heartbeats, with zero personal-check failures. Each restart counter is one from this test. No manual lock deletion was needed. The shared-worker recovery also explicitly verified the same lock inode.
- After recovery, direct kernel-lock probes under each worker's restricted profile refused duplicate acquisition for both actual lock paths.
- Configuration and subscriber-preference fingerprints matched the pre-deployment baseline. Existing personal alert settings and consent were preserved.
- Latest health check found 13 fresh verified prices, a matching website cross-check, 13 reserve rates across two pools, fresh discovery, SQLite integrity and zero watchdog issues.
- Direct and peer-process access probes confirmed isolation of both posting credentials and denial of personal OpenClaw/Windows-home access.
- Read-only Discord checks confirmed the shared destination, dedicated bot identity and 17 subcommands. No sample messages, fabricated protocol events or replay of uncertain deliveries were used.
- Health and retention timers are enabled and active. The existing Windows `OpenClaw WSL Gateway` task was observed running; its configuration was unchanged.

## Remaining boundary

A full Windows reboot or WSL shutdown was **not** performed, to avoid disrupting unrelated services. Automated process tests and the controlled deployed-worker crash tests verify lock recovery; they do not substitute for a complete Windows reboot exercise. Existing automatic WSL startup occurs after Windows user sign-in. Host sleep, host/network outages and off-host monitoring remain separate availability concerns.

This receipt documents the deployed executable commit; later documentation-only commits do not require redeployment.
