$ErrorActionPreference = 'Stop'
$client = [Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(5)
$client.DefaultRequestHeaders.Add('X-Workspace-Id','tenant-a')
$samples = [Collections.Generic.List[object]]::new()
$etag = $null
try {
    foreach ($index in 0..15) {
        foreach ($kind in @('summary','conditional')) {
            $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get,'http://127.0.0.1:8010/api/v2/live/status?summary=true')
            if ($kind -eq 'conditional') { $null = $request.Headers.TryAddWithoutValidation('If-None-Match',$etag) }
            $timer = [Diagnostics.Stopwatch]::StartNew()
            $response = $client.SendAsync($request).GetAwaiter().GetResult()
            $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
            $timer.Stop()
            $status = [int]$response.StatusCode
            if ($kind -eq 'summary') {
                $response.EnsureSuccessStatusCode() | Out-Null
                $payload = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json
                if ($payload.status -ne 'ready' -or -not $response.Headers.ETag) { throw 'Expected ready account summary and ETag.' }
                $etag = $response.Headers.ETag.ToString()
            }
            $samples.Add([ordered]@{index=$index;kind=$kind;elapsed_ms=$timer.Elapsed.TotalMilliseconds;status=$status;bytes=$bytes.Length})
            $response.Dispose(); $request.Dispose()
        }
    }
} finally { $client.Dispose() }
$metrics = foreach ($kind in @('summary','conditional')) {
    $rows = @($samples | Where-Object { $_.kind -eq $kind -and $_.index -gt 0 })
    $times = @($rows.elapsed_ms | Sort-Object)
    [ordered]@{kind=$kind;samples=$rows.Count;p50_ms=$times[7];sample_p95_ms=$times[14];max_bytes=($rows.bytes | Measure-Object -Maximum).Maximum}
}
$receipt = [ordered]@{
    passed=@($samples | Where-Object { ($_.kind -eq 'summary' -and $_.status -ne 200) -or ($_.kind -eq 'conditional' -and $_.status -ne 304) }).Count -eq 0
    scope='Loopback native release API, one connected read-only account with no trade history. Sequential reused HTTP connection; one warmup pair plus 15 measured pairs. API timing excludes browser render. Not a load/capacity benchmark.'
    measured_at=[DateTime]::UtcNow.ToString('o');metrics=$metrics;samples=$samples
}
$receipt | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'summary-performance.json') -Encoding utf8
@{passed=$receipt.passed;metrics=$receipt.metrics} | ConvertTo-Json -Depth 5
if (-not $receipt.passed) { exit 1 }
