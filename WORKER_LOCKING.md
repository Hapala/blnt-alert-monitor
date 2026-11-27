# Worker locking and restart recovery

The shared and DM workers use separate **Linux kernel-held exclusive file locks** on `data/monitor.lock` and `data/dm-worker.lock`. Node keeps the locked file descriptor open for the worker's lifetime. The short `/usr/bin/flock` helper acquires ownership through an explicitly inherited descriptor; unrelated child processes do not inherit it. Preparation verifies that util-linux `flock` is installed before any activation.

Normal exit closes the descriptor. A process crash, SIGKILL or host reboot also releases kernel ownership automatically. Numeric PID text remains for operator inspection and stopped-writer compatibility with an older release, but does not establish ownership. A leftover marker pointing to a dead process, unrelated live process or partial write no longer prevents startup. A competing new worker fails immediately while the real owner holds the kernel lock, even if metadata is stale or incomplete.

For upgrade safety, a live same-UID Node worker using the legacy entry point still blocks acquisition when its numeric marker is found. Old workers must be stopped before activating or rolling back releases, as in the existing deployment workflow. Ambiguous inspection or unavailable locking fails closed; the worker does not run unlocked. Symlink/hardlink lock paths are rejected without modifying their targets.

**Lock files deliberately remain after release. Do not delete or replace them while any worker may be running.** Removing a locked inode could let another process lock a replacement path and create duplicate senders. To inspect contention, check the named service/process and kernel lock ownership; restarting a genuine competing worker or clearing a live lock is not a recovery procedure. Stopped-writer deployment preserves the lock files and all existing personal settings.

## Windows/WSL startup boundary

The systemd worker units are enabled to start when Ubuntu boots and use `Restart=on-failure`. Windows must first launch WSL. The optional [BLNT boot task](WINDOWS_BOOT.md) provides password-free startup before sign-in after its noninteractive readiness check passes. The existing current-user `OpenClaw WSL Gateway` task launches WSL after Windows sign-in; see [OPENCLAW_STARTUP.md](OPENCLAW_STARTUP.md). Kernel locking is independent of either launch mechanism and does not prevent host sleep.

Check Windows task state, WSL launch and enabled systemd services separately from lock correctness. A full Windows restart is distinct from automated crash/reused-PID tests and controlled worker restarts. Never restart the whole distribution just to test this fix when unrelated services are running.

## Acceptance checks

- Two descriptors/processes cannot own the same worker lock; simultaneous contenders produce exactly one owner.
- Graceful release preserves the inode, is idempotent, and permits the next worker.
- An abruptly killed synthetic owner releases ownership without cleanup; its unrelated child cannot keep the lock alive.
- Leftover unrelated live PIDs, nonexistent PIDs, empty/partial metadata and foreign-role markers cannot recreate the obsolete-PID failure.
- Genuine legacy workers block takeover for both roles until they exit. Shared and DM locks remain independent.
- Unsafe paths are rejected; missing `flock` stops preparation before account/service changes.
- After activation, check real-profile ownership/duplicate refusal, restart recovery, fresh release-specific heartbeats, SQLite integrity, Discord identity/command routing, credential isolation and unchanged private settings fingerprints. Do not replay uncertain sends or manufacture protocol events for a restart test.

Automated lock tests use temporary files and synthetic processes. Live recovery checks are recorded in the [deployment receipt](DEPLOYMENT_LOCKS_2026-11-27.md). No wallet/threshold changes or new Discord permissions are involved.
