# BLNT Alerts cloud migration plan

**Proposed November 19, 2026. Planning only: no infrastructure purchased, credentials transferred or live services changed.** The owner/manager must select the provider, region, spending limit and operational contact before provisioning. Implementation remains one tested, reviewed changeset at a time under [AGENTS.md](AGENTS.md).

## Recommendation and cost

Use one Ubuntu 24.04 LTS x86-64 VM, initially **2 vCPUs / 4 GiB RAM / 80 GiB SSD**, running the current systemd workers and local SQLite database. Recommended starting provider/region: DigitalOcean Basic in Toronto (TOR1), subject to stock and final quote. This fits the existing long-lived Discord connection, browser cross-check and persistent database with fewer changes than a serverless deployment. It is a sizing recommendation, not a completed load benchmark or high-availability design.

The official Regular Basic price checked November 19 is **US$24/month** for that VM. Daily percentage-based VM backups add 30%, or **US$7.20/month**. Reserve a **US$35–50/month planning budget before tax/FX**, including an allowance for encrypted application-backup storage and external monitoring; those extras need quotes. Recheck plan/IPv4/region charges before purchase. Set billing alerts at the agreed limit; they are notifications, not a guaranteed spending cap. Sources: [Droplet pricing](https://www.digitalocean.com/pricing/droplets), [backup pricing](https://docs.digitalocean.com/products/backups/details/pricing/), [regional availability](https://docs.digitalocean.com/products/droplets/details/availability/).

Only BLNT Alerts moves: shared price/rate/status/liquidity updates, opt-in personal DMs, the local watchdog and retention jobs. Personal OpenClaw stays separate on the desktop. The private Stellar RPC/Core/PM2 projects are not dependencies. Keep approved hosted public RPCs and the website cross-check. Preserve all subscriptions, consent, mutes, thresholds, destinations, cooldowns, deduplication IDs and uncertain-delivery records.

## Target operation

- Immutable root-owned releases under `/opt/blnt-alert-monitor`, private runtime under `/var/lib/blnt-alert-monitor`, and local SQLite on persistent disk. No public dashboard or application port is required.
- Distinct non-login `blnt-alerts` and `blnt-alert-dm` UIDs; existing credential ownership, private group data access, filesystem restrictions and opposite-process access denial remain enforced. Install pinned Node 24 and a reviewed, compatible Chromium build with its Linux dependencies outside personal home directories.
- SSH keys for named administrators, restricted administration access, no password/root SSH login, provider-account MFA, time synchronization and scheduled security maintenance. Permit the required outbound HTTPS/WebSocket/DNS/time traffic; retain application endpoint/method allowlists. Workers cannot read administrator keys or backup/monitoring credentials.
- An independent external heartbeat service notifies the operational contact through email, with optional Discord as a second route. Send only generic health signals when worker/source freshness and rate coverage pass; an always-running cron alone is not proof of healthy alerts. Proposed cadence: one minute, notification after five minutes without a healthy signal. Do not put subscriber information in heartbeat payloads or logs.
- Hourly encrypted, consistent application backups in separately accessible object storage, with keys kept out of the VM's worker accounts and Git. Include both SQLite databases, runtime configuration, necessary credentials and release metadata. Use SQLite backup APIs or stopped writers; never copy an active database without handling its WAL. Keep at most 30 days, consistent with existing deletion disclosures. VM snapshots supplement application backups; they do not replace consistency and restore tests.
- Proposed recovery targets: at most one hour of data loss and service restoration within one hour, subject to a demonstrated restore. Price alerts can require another hour to rebuild continuous history after a long collection gap. Restore must reconcile later unsubscribe/forget changes before personal posting; if latest consent cannot be established, hold affected personal sends for review. These targets are not current guarantees.

Toronto places the primary VM in Canada; it does not establish Canadian residency for Discord, RPC, monitoring or backup providers. Decide backup location and operator access before transferring subscriber data. A single VM still has a host/provider failure risk.

## Ordered implementation

### 1. Inventory and make the installer portable

Record the source revision, current service state, resource/disk use and private configuration/preferences fingerprints without logging values. Inventory pending/sent/uncertain delivery state and confirm a recovery contact. Check provider reachability from the chosen region.

The current installer is WSL-oriented and **must not be run unchanged on a new VPS**. Refactor/test its `/mnt/wsl/resolv.conf` bind, Windows mount assumptions, `/home/hermes` browser/legacy paths, user-systemd migration assumptions and existing-managed-runtime activation requirement. Add a cloud bootstrap/import path that starts with all posting disabled and cannot silently enable workers. Preserve WSL compatibility and the distinct-UID model. Pin the deploy source; do not deploy an unreviewed moving branch.

**Gate:** unit/failure-injection tests, clean staged install on a disposable Ubuntu VM, executable imports, browser cross-check and both-direction direct/proc credential probes pass. Test initial setup, existing-runtime import, upgrade, rollback and preservation of intentionally stopped services. Verify both UIDs can safely use the shared SQLite WAL and status files.

### 2. Provision and rehearse without sending

After provider/budget selection, provision and harden the VM, install the tested immutable release and configure disabled services. Keep the current desktop host authoritative. Use synthetic fixtures first; any approved private data clone stays outside Git with production-equivalent access controls and is not promoted as final state.

Run a non-posting collector rehearsal for at least six hours, checking both pools, price agreement, rate coverage, browser stability, resource use and provider limits. **Do not log the shadow worker into the production Discord bot or run its command handlers.** Dry-run mode alone is not a complete shadow safety boundary: interactive commands can send messages. Keep production sending credentials unavailable to rehearsal processes and use fake Discord transports for personal-worker tests. Exercise a synthetic 20-subscriber workload with bounded/fake RPC first; any real provider-load test needs an agreed request budget.

**Gate:** regression suite passes; at least an hour of continuous price history is observed; no shadow Discord posts or command mutations occur; resource/provider headroom is acceptable. Create and restore an encrypted application backup into a separate non-posting environment and prove integrity, settings, queue and consent preservation. Simulate heartbeat loss and VM reboot without production credentials to prove the independent alert route and automatic startup.

### 3. Controlled cutover with one publishing host

1. Confirm the maintenance window, recovery contact and source/target checks. Pre-stage code, directories and backup tooling so the final pause is short.
2. Stop the desktop watchdog timer/service and both publishing workers, then **disable and mask those monitor units** before cloud posting. Prove they are stopped and cannot restart when Windows/WSL reboots. Leave personal OpenClaw and unrelated services alone. Temporarily quiesce any job that could modify the migration snapshot.
3. With all relevant writers stopped, take a final consistent snapshot of `monitor.sqlite`, `health.sqlite`, required runtime files and configuration. Transfer securely, verify integrity and fingerprints, and reconstruct ownership for the cloud UIDs. Keep an operator-only rollback copy. Do not use an older rehearsal database or reset modes/state in a way that expires the production outbox.
4. Preserve sent/uncertain/in-flight evidence and identifiers; recover an interrupted sending outcome as uncertain, never replay it automatically. Drop no eligible pending alert merely to make cutover easier. Normal stale-message expiry still applies.
5. Verify that only the target can publish. Start the cloud shared worker against the final state, verify fresh source data, then the DM worker, local watchdog and retention jobs, preserving any intentionally stopped state unless activation was explicitly approved. Initialize the external heartbeat from actual healthy checks. All existing settings and consent remain unchanged.
6. Compare fingerprints again; verify bot/application/command identity and channel routing through read-only requests. Check advancing release-specific heartbeats, both pools, all available reserves, website agreement, private discovery and configured personal checks. Confirm no second sender is running. Send clearly labelled end-to-end test messages only with explicit authorization; otherwise record that posting was not forced for the test.

**Gate:** cloud release is healthy, settings match, access probes pass, backups and independent monitoring work, and the old host is fenced. Record the maintenance gap; if it exceeds the continuity allowance, let price history rebuild rather than weakening freshness rules. Keep the subscriber pilot cap at 20 until the load exercise supports expansion.

### 4. Observe and close

Observe for at least 48 hours, including a cloud reboot in an agreed window. Check resource/disk growth, provider throttling, worker errors, backup age and heartbeat failures. Demonstrate a restore with production-equivalent synthetic settings/queues without starting a second sender. Publish a dated verification record and update the spec's hosting/restore gaps only after their checks pass.

Retain the desktop rollback archive within the existing 30-day limit, with workers still masked; then remove monitor credentials/private data under an explicit retirement step. Do not remove personal OpenClaw or unrelated projects. Name the owner for monthly updates, backup-restore checks, billing and incident response.

## Rollback

Stop and fence cloud publishers before unmasking anything on the desktop. Transfer the **latest authoritative cloud state**, including changes made after cutover, back to the desktop; preserve receipts, cooldowns, consent and uncertain outcomes. Do not restore a pre-cutover database after cloud posting and thereby replay alerts or undo user changes.

If cloud reachability or fencing cannot be proved, keep the desktop publishers stopped. Confirm cloud shutdown through the provider before restarting elsewhere. Recover with preserved uncertainty rather than starting two senders. Record any data loss and reconcile consent/deletion changes before resuming personal alerts.

## Decisions and acceptance still open

Owner/manager selection of provider/region, monthly limit, backup location and external incident recipient; approval of the proposed recovery targets and maintenance window. Then implement the portability/bootstrap fix first. This plan is not a completed cloud deployment or evidence that these operational gaps are already closed.

Related requirements: DATA-01–07, SEND-01–06, SEC-01–03, OPS-01–06 and KEEP-01–03 in [SYSTEM_SPEC.md](SYSTEM_SPEC.md). Existing operational evidence is summarized in [MANAGER_HANDOFF.md](MANAGER_HANDOFF.md).
