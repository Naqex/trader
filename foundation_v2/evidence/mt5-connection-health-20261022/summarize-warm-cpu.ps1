# Recompute from recorded counters, without another broker connection or soak.
$ErrorActionPreference = 'Stop'
$samples = @(Get-Content (Join-Path $PSScriptRoot 'warm-samples.json') -Raw | ConvertFrom-Json)
$receipt = Get-Content (Join-Path $PSScriptRoot 'warm-receipt.json') -Raw | ConvertFrom-Json
$cpuSeconds = 0.0
for ($i=1; $i -lt $samples.Count; $i++) {
    foreach ($process in $samples[$i].resources) {
        $previous = @($samples[$i-1].resources | Where-Object { $_.pid -eq $process.pid })
        if ($previous.Count -ne 1) { throw 'PID changed; CPU comparison is not a stable-process measurement.' }
        # Double overload preserves fractional CPU seconds at each interval.
        $cpuSeconds += [Math]::Max(0.0, $process.cpu_seconds - $previous[0].cpu_seconds)
    }
}
$elapsed = ($samples[-1].at_utc - $samples[0].at_utc).TotalSeconds
$receipt.performance.api_broker_tree_mean_cpu_one_core_pct = 100 * $cpuSeconds / $elapsed
$receipt.performance.api_broker_tree_mean_cpu_machine_pct = 100 * $cpuSeconds / $elapsed / $receipt.performance.logical_processors
$receipt | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'warm-receipt.json') -Encoding utf8
@{cpu_seconds=$cpuSeconds;elapsed_seconds=$elapsed;one_core_pct=$receipt.performance.api_broker_tree_mean_cpu_one_core_pct;machine_pct=$receipt.performance.api_broker_tree_mean_cpu_machine_pct} | ConvertTo-Json
