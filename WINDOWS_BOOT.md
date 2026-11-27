# Start BLNT Alerts before Windows sign-in

This optional Windows boot task launches the existing Ubuntu distribution 30 seconds after Windows starts, under the Windows account that owns it. Enabled BLNT systemd services start with Ubuntu. A foreground `sleep` client keeps WSL available; systemd supervises the alert workers. No interactive sign-in or stored Windows password is used.

## Install

Open **Windows PowerShell as administrator using the same account that owns Ubuntu**, then run from this checkout:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\ops\install-alerts-boot.ps1 -Distribution Ubuntu -LinuxUser blnt-alerts
```

Administrator approval is required to register the boot trigger and noninteractive account. The command permits this reviewed installer for its own PowerShell process; it does not change the machine's execution policy. The installed task itself runs with **limited** Windows privileges and Linux user `blnt-alerts`. It uses only Windows-protected executables: a profile-free PowerShell process supplies native standard handles and launches `wsl.exe`. The task stores its fixed command as encoded text, with no credentials and no checkout-script dependency. Distribution/user names reject shell operators. It never runs the collector manually or creates another sender.

The installer first runs a temporary task under the same password-free **S4U** principal, checking Ubuntu access, the enabled/running worker and maintenance units, public RPC health through the deployed monitor's allowlisted providers and Discord HTTPS access. It uses the monitor's Node HTTP implementation; one provider must pass its existing mainnet/freshness health checks. This checks network access, not the collector's stricter provider-agreement gate, which remains unchanged. It removes the probe afterward and refuses installation if it fails. S4U cannot use Windows network credentials or encrypted files; the real noninteractive Linux HTTPS check is required. No fallback to stored credentials or SYSTEM is attempted. A readiness failure can also mean a provider is temporarily unavailable; inspect it before retrying.

The task is `BLNT Alerts WSL Boot`, with a boot trigger, 30-second delay, no runtime/battery limit, duplicate-start exclusion and one-minute failure retries (up to 999). It starts immediately after installation. The personal `OpenClaw WSL Gateway` sign-in task is left unchanged. Existing enabled services in the same Ubuntu distribution also start when Ubuntu boots; their configuration is not modified.

## Verify

```powershell
Get-ScheduledTask -TaskName 'BLNT Alerts WSL Boot' |
    Select-Object TaskName,State,Principal,Triggers
Get-ScheduledTaskInfo -TaskName 'BLNT Alerts WSL Boot'
wsl -d Ubuntu -u blnt-alerts -- systemctl is-active blnt-alert-monitor.service blnt-dm-alerts.service
```

`Running` is normal because the keepalive is intentional. Check release-specific advancing worker heartbeats, fresh data, watchdog health and unchanged subscriber settings separately. Manual startup with a noninteractive principal tests that principal; it does **not** prove a full boot with no signed-in session.

For installer syntax and argument-injection checks, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\test\windows-boot.ps1`. The actual scheduled preflight remains necessary; Linux CI cannot verify Windows Task Scheduler or pre-login WSL behavior.

To prove complete restart recovery, arrange a Windows reboot, leave the machine at the sign-in screen, and verify externally that the workers resumed before the first interactive login. After signing in, correlate boot time, task start time, worker startup and advancing data timestamps. Do not force a reboot or shut down WSL when unrelated services are running. No test Discord messages or threshold changes are required.

This does not bypass BitLocker/pre-boot authentication, prevent Windows sleep, provide off-host outage detection or guarantee provider/network availability. Host updates and power loss still interrupt monitoring. Worker [kernel locks](WORKER_LOCKING.md) prevent duplicate ownership and release automatically on reboot.

## Installation verified November 27, 2026

The actual S4U readiness task passed, including running/enabled units, the deployed monitor's public RPC health code and Discord HTTPS. The permanent task remained `Running` with a boot trigger, 30-second delay, S4U/limited privileges, unlimited runtime, one-minute retries, battery operation and `IgnoreNew`. Temporary readiness tasks were removed. The existing OpenClaw sign-in task remained running and unchanged.

Post-installation checks found both workers healthy on `release-1795791180-c5384b8b`, 13 fresh prices with a matching website cross-check, 13 reserve rates across two pools, fresh discovery, SQLite integrity and zero watchdog/personal-check failures. Configuration/subscriber-preference fingerprints were unchanged. Windows PowerShell syntax/injection checks and all 128 existing Node tests passed; the staged change was reviewed with no unresolved findings. No monitor redeployment, worker restart, real test message or threshold change was needed for this Windows-only installation.

The machine was not rebooted and the user was not signed out. A complete reboot with verification before interactive sign-in remains outstanding.

## Remove

In an administrator PowerShell under the owning account:

```powershell
Stop-ScheduledTask -TaskName 'BLNT Alerts WSL Boot'
Unregister-ScheduledTask -TaskName 'BLNT Alerts WSL Boot' -Confirm:$false
```

This removes the Windows keepalive only. It does not disable Linux units, change alert settings, stop unrelated services or remove the separate OpenClaw sign-in task. With no other WSL client, WSL may subsequently become idle and stop.

Microsoft references: [task logon types](https://learn.microsoft.com/en-us/windows/win32/taskschd/principal-logontype), [systemd in WSL](https://learn.microsoft.com/en-us/windows/wsl/systemd/).
