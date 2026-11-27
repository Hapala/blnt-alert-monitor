param(
    [ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$Distribution = 'Ubuntu',
    [ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$LinuxUser = 'blnt-alerts'
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $admin.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run as administrator using the Windows account that owns this WSL distribution.'
}
$name = 'BLNT Alerts WSL Boot'
$description = 'Launch the existing BLNT Alerts Ubuntu services before Windows sign-in; no stored password.'
$wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType S4U -RunLevel Limited
$existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne $description) { throw 'Refusing to replace an unrelated task' }
$previous = if ($existing) { Export-ScheduledTask -TaskName $name } else { $null }
$wasRunning = $existing -and $existing.State -eq 'Running'

# Test the exact noninteractive principal first, without credentials or posting.
# S4U cannot use Windows network credentials/EFS. Linux HTTPS must be tested,
# rather than assuming an interactive WSL check proves this account can run it.
$probe = @'
import subprocess
units=['blnt-alert-monitor.service','blnt-dm-alerts.service','blnt-health-watchdog.timer','blnt-alert-retention.timer']
for unit in units:
 subprocess.run(['systemctl','is-enabled','--quiet',unit],check=True)
 subprocess.run(['systemctl','is-active','--quiet',unit],check=True)
code="""
import assert from 'node:assert/strict';
import {PublicRpc,PUBLIC_PROVIDERS} from '/opt/blnt-alert-monitor/current/public-rpc.mjs';
const results=await Promise.allSettled(PUBLIC_PROVIDERS.map(url=>new PublicRpc(url).health()));
assert(results.some(result=>result.status==='fulfilled'));
const response=await fetch('https://discord.com/api/v10/gateway',{signal:AbortSignal.timeout(20000)});
assert(response.ok);assert((await response.json()).url.startsWith('wss://'));
"""
subprocess.run(['/usr/local/bin/node','--input-type=module','--eval',code],check=True,timeout=65)
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($probe))
# PowerShell supplies native standard handles in a noninteractive session.
# The task holds the fixed command itself; it never reads a checkout script.
function New-WslAction([string]$LinuxCommand) {
    $program = '& ''{0}'' --distribution ''{1}'' --user ''{2}'' --exec {3} 2>&1 | Out-Null' -f $wsl,$Distribution,$LinuxUser,$LinuxCommand
    $program += "`nexit `$LASTEXITCODE"
    $command64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($program))
    New-ScheduledTaskAction -Execute $powershell -Argument ('-NoProfile -NonInteractive -EncodedCommand {0}' -f $command64) -WorkingDirectory $env:SystemRoot
}
$probeAction = New-WslAction ('/usr/bin/python3 -c "import base64;exec(base64.b64decode(''{0}''))"' -f $encoded)
$probeName = 'BLNT Alerts Boot Probe ' + [Guid]::NewGuid().ToString('N')
try {
    $probeSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
    Register-ScheduledTask -TaskName $probeName -Action $probeAction -Principal $principal -Settings $probeSettings -Description 'Temporary BLNT Alerts noninteractive readiness check.' | Out-Null
    Start-ScheduledTask -TaskName $probeName
    $deadline = (Get-Date).AddSeconds(100)
    do {
        Start-Sleep -Seconds 2
        $info = Get-ScheduledTaskInfo -TaskName $probeName
        $state = (Get-ScheduledTask -TaskName $probeName).State
        $ran = $info.LastRunTime.Year -gt 2000
    } until (($ran -and $state -ne 'Running' -and $state -ne 'Queued') -or (Get-Date) -gt $deadline)
    if (-not $ran -or $state -eq 'Running' -or $state -eq 'Queued' -or $info.LastTaskResult -ne 0) {
        throw ('Noninteractive WSL/network probe failed (task result {0}). Boot task not changed.' -f $info.LastTaskResult)
    }
} finally {
    $temporary = Get-ScheduledTask -TaskName $probeName -ErrorAction SilentlyContinue
    if ($temporary) {
        if ($temporary.State -eq 'Running' -or $temporary.State -eq 'Queued') { Stop-ScheduledTask -TaskName $probeName }
        Unregister-ScheduledTask -TaskName $probeName -Confirm:$false
    }
}

# Enabled Linux units start on distro boot; this is only a foreground keepalive.
# The action uses only protected OS executables, not a mutable checkout script.
$action = New-WslAction '/usr/bin/sleep infinity'
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$registered = $false
try {
    Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $description -Force | Out-Null
    $registered = $true
    Start-ScheduledTask -TaskName $name
    Start-Sleep -Seconds 8
    $task = Get-ScheduledTask -TaskName $name
    if ($task.State -ne 'Running') { throw 'Boot keepalive did not remain running' }
    if ($task.Principal.LogonType -ne 'S4U' -or $task.Principal.RunLevel -ne 'Limited' -or $task.Triggers[0].CimClass.CimClassName -ne 'MSFT_TaskBootTrigger') { throw 'Registered task does not match boot policy' }
} catch {
    if ($registered) {
        Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($previous) {
            Register-ScheduledTask -TaskName $name -Xml $previous -Force | Out-Null
            if ($wasRunning) { Start-ScheduledTask -TaskName $name }
        }
        else { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
    }
    throw
}
Write-Output 'BLNT Alerts boot task installed and running; noninteractive Linux HTTPS and service checks passed. A full reboot test remains separate.'
