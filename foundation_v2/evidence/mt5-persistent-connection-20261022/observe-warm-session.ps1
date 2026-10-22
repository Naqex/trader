param([int]$Seconds = 140)
$ErrorActionPreference = 'Stop'
$connectionId = 'f0e978a6-2f82-45ac-8dee-c5b36416057a'
$foundation = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$terminal = Join-Path $foundation ".runtime/mt5-broker/$connectionId/terminal64.exe"
$apiPid = (Get-Content (Join-Path $foundation '.runtime/api-platform/native-owner.json') -Raw | ConvertFrom-Json).processes.api.pid
$samples = [Collections.Generic.List[object]]::new()
$started = [DateTime]::UtcNow
do {
    $payload = Invoke-RestMethod 'http://127.0.0.1:8010/api/v2/live/connections' -Headers @{'X-Workspace-Id'='tenant-a'} -TimeoutSec 5
    $account = @($payload.items | Where-Object id -eq $connectionId)[0]
    if (-not $account) { throw 'Expected authorized connection is missing.' }
    $terminals = @(Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" | Where-Object ExecutablePath -eq $terminal | Select-Object -ExpandProperty ProcessId)
    $workers = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.ParentProcessId -eq $apiPid -and $_.CommandLine.Contains('mt5_broker_worker.py') } | Select-Object -ExpandProperty ProcessId)
    $sample = [ordered]@{
        at_utc=[DateTime]::UtcNow.ToString('o'); status=$account.status
        last_synced_at=$account.last_synced_at; error_code=$account.error_code
        requested_mode=$account.requested_mode; verified_permissions=$account.verified_permissions
        terminal_pids=$terminals; worker_pids=$workers
    }
    $samples.Add($sample)
    $samples | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'warm-samples.json') -Encoding utf8
    $sample | ConvertTo-Json -Compress -Depth 4
    Start-Sleep -Seconds 5
} while (([DateTime]::UtcNow - $started).TotalSeconds -lt $Seconds)
$passed = @($samples | Where-Object { $_.status -ne 'connected' -or $_.error_code -or $_.requested_mode -ne 'read_only' -or $_.verified_permissions.trade -ne $false -or $_.terminal_pids.Count -ne 1 -or $_.worker_pids.Count -ne 1 }).Count -eq 0
$terminalPids = @($samples | ForEach-Object { $_.terminal_pids } | Sort-Object -Unique)
$workerPids = @($samples | ForEach-Object { $_.worker_pids } | Sort-Object -Unique)
$refreshes = @($samples | ForEach-Object last_synced_at | Sort-Object -Unique)
$passed = $passed -and $terminalPids.Count -eq 1 -and $workerPids.Count -eq 1 -and $refreshes.Count -ge 3
$receipt = [ordered]@{ passed=$passed; duration_seconds=([DateTime]::UtcNow-$started).TotalSeconds; samples=$samples.Count; terminal_pids=$terminalPids; worker_pids=$workerPids; refreshes=$refreshes; broker_orders_sent=0; scope='Read-only existing authorized account; observation only; no credentials or broker commands' }
$receipt | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'warm-receipt.json') -Encoding utf8
$receipt | ConvertTo-Json -Depth 8
if (-not $passed) { exit 1 }
