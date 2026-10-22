$ErrorActionPreference = 'Stop'
$connectionId = 'f0e978a6-2f82-45ac-8dee-c5b36416057a'
$foundation = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$terminal = Join-Path $foundation ".runtime/mt5-broker/$connectionId/terminal64.exe"
function Read-Connection {
    $payload = Invoke-RestMethod 'http://127.0.0.1:8010/api/v2/live/connections' -Headers @{'X-Workspace-Id'='tenant-a'} -TimeoutSec 5
    @($payload.items | Where-Object id -eq $connectionId)[0]
}
$before = Read-Connection
if ($before.status -ne 'connected' -or $before.requested_mode -ne 'read_only' -or $before.verified_permissions.trade -ne $false) { throw 'Fault test requires the authorized, connected read-only account.' }
$owned = @(Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" | Where-Object ExecutablePath -eq $terminal)
if ($owned.Count -ne 1) { throw 'Expected exactly one isolated terminal.' }
$stoppedPid = $owned[0].ProcessId
$started = [DateTime]::UtcNow
# Only the isolated, verified read-only app terminal; never an installed/personal terminal.
Stop-Process -Id $stoppedPid -Force
$samples = [Collections.Generic.List[object]]::new()
$sawFailure = $false; $recovered = $false
do {
    $current = Read-Connection
    $pids = @(Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" | Where-Object ExecutablePath -eq $terminal | Select-Object -ExpandProperty ProcessId)
    $sample = [ordered]@{ at_utc=[DateTime]::UtcNow.ToString('o'); status=$current.status; error_code=$current.error_code; last_synced_at=$current.last_synced_at; requested_mode=$current.requested_mode; verified_permissions=$current.verified_permissions; terminal_pids=$pids }
    $samples.Add($sample)
    if ($current.status -eq 'error') { $sawFailure = $true }
    if ($samples.Count -eq 1 -or $sample.status -ne $samples[$samples.Count-2].status) { $sample | ConvertTo-Json -Compress -Depth 4 }
    $recovered = $sawFailure -and $current.status -eq 'connected' -and $pids.Count -eq 1 -and $pids[0] -ne $stoppedPid -and $current.last_synced_at -ne $before.last_synced_at
    if ($recovered) { break }
    Start-Sleep -Seconds 2
} while (([DateTime]::UtcNow-$started).TotalSeconds -lt 100)
$passed = $recovered -and @($samples | Where-Object { $_.requested_mode -ne 'read_only' -or $_.verified_permissions.trade -ne $false }).Count -eq 0
$receipt = [ordered]@{ passed=$passed; duration_seconds=([DateTime]::UtcNow-$started).TotalSeconds; stopped_pid=$stoppedPid; samples=$samples; broker_orders_sent=0 }
$receipt | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'terminal-recovery.json') -Encoding utf8
if (-not $passed) { throw 'Owned terminal recovery did not pass.' }
$receipt | Select-Object passed,duration_seconds,stopped_pid,broker_orders_sent | ConvertTo-Json
