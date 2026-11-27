# OpenClaw after a Windows restart

The personal OpenClaw gateway is a separate Ubuntu user service. Enabling it in Linux does not make Windows launch WSL after a reboot. The Windows `OpenClaw Node` task is a separate companion and does not start this gateway.

From a stable checkout of this repository, run in PowerShell as the Windows user who owns the Ubuntu distribution:

```powershell
.\ops\install-openclaw-startup.ps1 -Distribution Ubuntu -LinuxUser hermes
```

The installer creates `OpenClaw WSL Gateway` for that user, starts it immediately, and schedules it 20 seconds after subsequent Windows sign-ins. It opens no visible console. It starts the existing `openclaw-gateway.service` and keeps a WSL foreground client alive; Linux systemd continues to supervise gateway crashes. Windows retries startup failures every minute. Re-running the installer updates only its own named task. It does not read tokens, change OpenClaw access/model settings, enable a disabled Linux service, or change BLNT alert settings.

This starts after signing into Windows following a reboot, **not before login**. Windows remains free to sleep/shut down; this is not always-on hosting. The separate optional [BLNT Alerts boot task](WINDOWS_BOOT.md) can launch Ubuntu before login without changing this personal gateway task. Keep the checkout path available because the OpenClaw task references its script there.

Verify:

```powershell
Get-ScheduledTask -TaskName 'OpenClaw WSL Gateway' | Select-Object TaskName,State
wsl -d Ubuntu -u hermes -- systemctl --user is-active openclaw-gateway.service
```

The task normally stays `Running` because its foreground WSL client is intentional. A manual task start proves launch behavior, not a completed reboot test. An existing Windows node companion can start before the WSL gateway is ready; inspect its own result separately. This installer leaves other tasks untouched.

Enabled BLNT system services also start when this launches Ubuntu. Their independent [kernel-held worker locks](WORKER_LOCKING.md) release on crashes/reboot; PID marker files do not need manual deletion. The Windows task/WSL launch and Linux service/lock recovery remain separate checks.

To remove this startup behavior without changing Linux service settings:

```powershell
Stop-ScheduledTask -TaskName 'OpenClaw WSL Gateway'
Unregister-ScheduledTask -TaskName 'OpenClaw WSL Gateway' -Confirm:$false
```
