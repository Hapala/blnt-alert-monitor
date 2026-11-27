# Run with Windows PowerShell 5.1; the Linux CI suite cannot test Task Scheduler.
$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '..\ops\install-alerts-boot.ps1'
$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($script,[ref]$tokens,[ref]$parseErrors) | Out-Null
if ($parseErrors.Count) { throw 'Windows PowerShell parsing failed' }
foreach ($case in @(@{Distribution='Ubuntu;bad'},@{Distribution='Ubuntu" & whoami'},@{LinuxUser='root;bad'},@{LinuxUser='blnt-alerts & whoami'})) {
    try { & $script @case; throw 'Invalid argument was accepted' }
    catch { if ($_.FullyQualifiedErrorId -notlike 'ParameterArgumentValidationError*') { throw } }
}
Write-Output 'Windows PowerShell parsing and shell-operator argument rejection passed.'
