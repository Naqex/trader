param([int]$Seconds = 480)
$ErrorActionPreference = 'Stop'
$connectionId = 'f0e978a6-2f82-45ac-8dee-c5b36416057a'
$foundation = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$terminal = Join-Path $foundation ".runtime/mt5-broker/$connectionId/terminal64.exe"
$apiPid = (Get-Content (Join-Path $foundation '.runtime/api-platform/native-owner.json') -Raw | ConvertFrom-Json).processes.api.pid
$samples = [Collections.Generic.List[object]]::new()
$requests = [Collections.Generic.List[object]]::new()
$client = [Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(5)
$client.DefaultRequestHeaders.Add('X-Workspace-Id','tenant-a')
$started = [DateTime]::UtcNow
do {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $response = $client.GetAsync('http://127.0.0.1:8010/api/v2/live/connections').GetAwaiter().GetResult()
    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    $timer.Stop()
    $response.EnsureSuccessStatusCode() | Out-Null
    $requests.Add([ordered]@{elapsed_ms=$timer.Elapsed.TotalMilliseconds;bytes=$bytes.Length;status=[int]$response.StatusCode})
    $payload = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
    $response.Dispose()
    $account = @($payload.items | Where-Object id -eq $connectionId)[0]
    if (-not $account) { throw 'Expected authorized connection is missing.' }
    $terminals = @(Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" | Where-Object ExecutablePath -eq $terminal | Select-Object -ExpandProperty ProcessId)
    $workers = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.ParentProcessId -eq $apiPid -and $_.CommandLine.Contains('mt5_broker_worker.py') } | Select-Object -ExpandProperty ProcessId)
    $tree = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
    $ownedPids = [Collections.Generic.HashSet[int]]::new()
    $null = $ownedPids.Add([int]$apiPid)
    do {
        $count = $ownedPids.Count
        foreach ($item in $tree) {
            if ($ownedPids.Contains([int]$item.ParentProcessId)) { $null = $ownedPids.Add([int]$item.ProcessId) }
        }
    } while ($ownedPids.Count -ne $count)
    $resources = @(Get-Process -Id @($ownedPids) -ErrorAction SilentlyContinue | ForEach-Object {
        [ordered]@{pid=$_.Id;name=$_.ProcessName;cpu_seconds=$_.CPU;private_bytes=$_.PrivateMemorySize64;working_set_bytes=$_.WorkingSet64}
    })
    $sample = [ordered]@{
        at_utc=[DateTime]::UtcNow.ToString('o'); status=$account.status
        last_synced_at=$account.last_synced_at; error_code=$account.error_code
        requested_mode=$account.requested_mode; verified_permissions=$account.verified_permissions
        terminal_pids=$terminals; worker_pids=$workers
        resources=$resources
    }
    $samples.Add($sample)
    $samples | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'warm-samples.json') -Encoding utf8
    if ($samples.Count -eq 1 -or $sample.last_synced_at -ne $samples[$samples.Count-2].last_synced_at -or $sample.status -ne 'connected') { $sample | ConvertTo-Json -Compress -Depth 4 }
    Start-Sleep -Seconds 10
} while (([DateTime]::UtcNow - $started).TotalSeconds -lt $Seconds)
$passed = @($samples | Where-Object { $_.status -ne 'connected' -or $_.error_code -or $_.requested_mode -ne 'read_only' -or $_.verified_permissions.trade -ne $false -or $_.terminal_pids.Count -ne 1 -or $_.worker_pids.Count -ne 1 }).Count -eq 0
$terminalPids = @($samples | ForEach-Object { $_.terminal_pids } | Sort-Object -Unique)
$workerPids = @($samples | ForEach-Object { $_.worker_pids } | Sort-Object -Unique)
$refreshes = @($samples | ForEach-Object last_synced_at | Sort-Object -Unique)
$passed = $passed -and $terminalPids.Count -eq 1 -and $workerPids.Count -eq 1 -and $refreshes.Count -ge 3
$receipt = [ordered]@{ passed=$passed; duration_seconds=([DateTime]::UtcNow-$started).TotalSeconds; samples=$samples.Count; terminal_pids=$terminalPids; worker_pids=$workerPids; refreshes=$refreshes; broker_orders_sent=0; scope='Read-only existing authorized account; observation only; no credentials or broker commands' }
$latencies = @($requests | Select-Object -Skip 1 | ForEach-Object elapsed_ms | Sort-Object)
$cpuIntervals = @(for ($i=1; $i -lt $samples.Count; $i++) {
    $before = $samples[$i-1]; $after = $samples[$i]
    $cpuDelta = 0.0
    foreach ($process in $after.resources) {
        $previous = @($before.resources | Where-Object { $_.pid -eq $process.pid })
        if ($previous.Count -eq 1) { $cpuDelta += [Math]::Max(0.0, $process.cpu_seconds - $previous[0].cpu_seconds) }
    }
    100*$cpuDelta/(([DateTime]$after.at_utc)-([DateTime]$before.at_utc)).TotalSeconds
})
$receipt.performance = [ordered]@{
    scope='One connected account, no open positions/history; idle persistent connection plus summary GET every ~10s. No baseline speedup or trading-chart capacity claim.'
    first_request_ms=$requests[0].elapsed_ms
    warm_requests=$latencies.Count
    warm_p50_ms=$latencies[[Math]::Floor($latencies.Count*.5)]
    warm_sample_p95_ms=$latencies[[Math]::Max(0,[Math]::Ceiling($latencies.Count*.95)-1)]
    response_bytes_max=($requests.bytes | Measure-Object -Maximum).Maximum
    api_broker_tree_mean_cpu_one_core_pct=($cpuIntervals | Measure-Object -Average).Average
    api_broker_tree_mean_cpu_machine_pct=($cpuIntervals | Measure-Object -Average).Average / [Environment]::ProcessorCount
    api_broker_tree_peak_private_mib=(@($samples | ForEach-Object { ($_.resources.private_bytes | Measure-Object -Sum).Sum / 1MB }) | Measure-Object -Maximum).Maximum
    api_broker_tree_peak_working_set_mib=(@($samples | ForEach-Object { ($_.resources.working_set_bytes | Measure-Object -Sum).Sum / 1MB }) | Measure-Object -Maximum).Maximum
    logical_processors=[Environment]::ProcessorCount
}
$requests | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $PSScriptRoot 'warm-requests.json') -Encoding utf8
$client.Dispose()
$receipt | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'warm-receipt.json') -Encoding utf8
$receipt | ConvertTo-Json -Depth 8
if (-not $passed) { exit 1 }
