param(
    [ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$Distribution = 'Ubuntu',
    [ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$LinuxUser = 'hermes'
)
$ErrorActionPreference = 'Stop'
$name = 'OpenClaw WSL Gateway'
$script = Join-Path $PSScriptRoot 'start-openclaw-wsl.ps1'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'Startup script missing' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Distribution "{1}" -LinuxUser "{2}"' -f $script,$Distribution,$LinuxUser)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$trigger.Delay = 'PT20S'
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($existing -and ($existing.Description -ne 'Keep Ubuntu OpenClaw gateway available after Windows sign-in.')) { throw 'Refusing to replace an unrelated existing task' }
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Keep Ubuntu OpenClaw gateway available after Windows sign-in.' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Output 'OpenClaw WSL startup task installed and started for the current Windows user.'
