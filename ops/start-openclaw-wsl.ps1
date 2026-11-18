param(
    [ValidatePattern('^[A-Za-z0-9_.-]+$')][string]$Distribution = 'Ubuntu',
    [ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$LinuxUser = 'hermes'
)
$ErrorActionPreference = 'Stop'
$wsl = Join-Path $env:SystemRoot 'System32/wsl.exe'
# systemd starts enabled services, but WSL still needs a foreground client to
# remain available. No credentials or personal OpenClaw configuration are read.
$command = 'export XDG_RUNTIME_DIR=/run/user/$(id -u); /usr/bin/systemctl --user start openclaw-gateway.service && exec /usr/bin/sleep infinity'
& $wsl --distribution $Distribution --user $LinuxUser --exec /bin/sh -c $command
exit $LASTEXITCODE
