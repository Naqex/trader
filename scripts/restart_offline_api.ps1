[CmdletBinding()]
param(
    [switch]$CheckOnly, [switch]$ApplyMigration, [switch]$BackupConfirmed, [switch]$Build, [switch]$AdoptLegacyDownloads,
    [ValidateSet('compatibility', 'native')][string]$RuntimeProfile = 'compatibility',
    [ValidateSet('full', 'compact')][string]$ReplayStorageProfile = 'full',
    [ValidateRange(1024, 65535)][int]$Port = 8010,
    [ValidatePattern('^[a-zA-Z0-9_]+$')][string]$DatabaseName = 'trading_workspace_v2_exness_history',
    [string]$ArtifactRoot, [string]$ManifestPath, [string]$BinaryDirectory,
    [ValidateSet('qdm', 'dukascopy', 'none')][string]$DownloadEngine = 'qdm',
    [string]$QdmHome, [string]$ScientificCapability, [string]$LegacyCodecCapability
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$foundationRoot = Join-Path $projectRoot 'foundation_v2'
$pythonPath = Join-Path $foundationRoot '.venv\Scripts\python.exe'
$launcherPath = Join-Path $foundationRoot 'scripts\run_api_platform.py'
$legacyPath = Join-Path $foundationRoot 'scripts\serve_exness_history.py'
if (-not $ManifestPath) {
    $ownerName = if ($RuntimeProfile -eq 'native') { 'native-owner.json' } else { 'owner.json' }
    $ManifestPath = Join-Path $foundationRoot ".runtime\api-platform\$ownerName"
}
$ManifestPath = [IO.Path]::GetFullPath($ManifestPath)
if (-not $BinaryDirectory) {
    $target = if ($RuntimeProfile -eq 'native') { 'api-rust\target\native-candidate\release' } else { 'api-rust\target\release' }
    $BinaryDirectory = Join-Path $foundationRoot $target
}
$BinaryDirectory = [IO.Path]::GetFullPath($BinaryDirectory)
$apiUrl = "http://127.0.0.1:$Port"
$headers = @{ 'X-Workspace-Id' = 'tenant-a' }
$profileArgs = @('--runtime-profile', $RuntimeProfile, '--replay-storage-profile', $ReplayStorageProfile,
    '--port', "$Port", '--database-name', $DatabaseName, '--manifest', $ManifestPath,
    '--download-engine', $DownloadEngine,
    '--rust-binary', (Join-Path $BinaryDirectory 'trading-workspace-api.exe'),
    '--rust-admin-binary', (Join-Path $BinaryDirectory 'rust_runtime_admin.exe'),
    '--rust-research-binary', (Join-Path $BinaryDirectory 'rust_research_worker.exe'))
foreach ($option in @(@('--artifact-root', $ArtifactRoot), @('--qdm-home', $QdmHome),
    @('--scientific-capability', $ScientificCapability), @('--legacy-codec-capability', $LegacyCodecCapability))) {
    if ($option[1]) { $profileArgs += $option }
}

function Invoke-Platform([string[]]$ActionArgs) {
    & $pythonPath -B $launcherPath @profileArgs @ActionArgs
    if ($LASTEXITCODE -ne 0) { throw 'Runtime action failed. Inspect the sanitized launcher error above.' }
}

function Get-OfflineListener {
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if (-not $listeners.Count) { return $null }
    $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -ne 1 -or @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count) {
        throw "Port $Port does not belong to one loopback API. Nothing was stopped."
    }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($owners[0])"
    if (-not $process) { throw 'API process could not be verified.' }
    if (Test-Path -LiteralPath $manifestPath) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $recordedProfile = if ($manifest.runtime_profile) { $manifest.runtime_profile } else { 'compatibility' }
        if ($recordedProfile -ne $RuntimeProfile) { throw 'Listener manifest belongs to another runtime profile. Nothing was stopped.' }
        if ($manifest.project -eq $projectRoot -and $manifest.port -eq $Port -and -not $manifest.stopped -and
            $manifest.processes.api.pid -eq $process.ProcessId -and
            $manifest.processes.api.executable -eq $process.ExecutablePath) {
            return @{ Kind = 'managed'; Process = $process }
        }
    }
    if ($RuntimeProfile -ne 'compatibility' -or $Port -ne 8010) {
        throw 'Listener is not owned by the selected runtime manifest. Nothing was stopped.'
    }
    $command = $process.CommandLine
    $relativeLauncher = $command -match '(?i)(?:^|\s|")scripts[\\/]serve_exness_history\.py(?:\s|")'
    $absoluteLauncher = $command -and $command.Contains($legacyPath)
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.ParentProcessId)" -ErrorAction SilentlyContinue
    $projectPython = $process.ExecutablePath -eq $pythonPath -or $parent.ExecutablePath -eq $pythonPath
    if ($process.Name -notmatch '^python(?:w)?\.exe$' -or -not $projectPython -or
        (-not $relativeLauncher -and -not $absoluteLauncher) -or
        $command -notmatch '--port\s+8010(?:\s|$)' -or $command -match '--mt5-python|--ticks') {
        throw "Port $Port is not an owned offline API. Nothing was stopped."
    }
    return @{ Kind = 'legacy'; Process = $process }
}

function Assert-NoActiveDownload {
    $response = Invoke-RestMethod -Uri "$apiUrl/api/v2/data/downloads" -Headers $headers -TimeoutSec 5
    if ($null -eq $response.items -or $null -eq $response.available) {
        throw 'Could not verify download state. Nothing was stopped.'
    }
    if (@($response.items | Where-Object { $_.status -in @('queued', 'running', 'pausing') }).Count) {
        throw 'A download is active. Pause it in the UI and wait until paused before restart.'
    }
}

try {
    if ($CheckOnly -and ($ApplyMigration -or $Build -or $AdoptLegacyDownloads)) { throw 'CheckOnly cannot be combined with actions.' }
    if ($RuntimeProfile -eq 'compatibility' -and $ReplayStorageProfile -ne 'full') { throw 'Compact replay storage requires the explicit native runtime profile.' }
    if ($RuntimeProfile -eq 'native' -and $AdoptLegacyDownloads) { throw 'Native profile requires explicit provider adoption before cutover.' }
    foreach ($path in @($pythonPath, $launcherPath)) {
        if (-not (Test-Path -LiteralPath $path)) { throw "Required local path is missing: $path" }
    }
    if (-not $env:TW_V2_DATABASE_URL) { $env:TW_V2_DATABASE_URL = [Environment]::GetEnvironmentVariable('TW_V2_DATABASE_URL', 'User') }
    if (-not $env:TW_V2_DATABASE_URL) { throw 'TW_V2_DATABASE_URL is missing; restore the existing local database configuration.' }
    # Establish listener ownership before a build could replace its executable.
    $listener = Get-OfflineListener
    if ($Build) {
        Invoke-Platform -ActionArgs @('--build-only')
    }
    $preflightArgs = @('--check-only', '--require-idle')
    if ($ApplyMigration) { $preflightArgs += '--allow-pending-migrations' }
    Invoke-Platform -ActionArgs $preflightArgs
    if ($ApplyMigration -and -not $BackupConfirmed) { throw 'Back up and verify BOTH PostgreSQL and artifact files, then pass -ApplyMigration -BackupConfirmed.' }
    if ($listener) { Assert-NoActiveDownload }
    if ($CheckOnly) { Write-Host 'Preflight passed. Check-only: no schema/process/provider changes.'; exit 0 }
    if ($listener) {
        $current = Get-OfflineListener
        if (-not $current -or $current.Process.ProcessId -ne $listener.Process.ProcessId -or
            $current.Process.CreationDate -ne $listener.Process.CreationDate) { throw 'API ownership changed. Nothing was stopped.' }
        Assert-NoActiveDownload
        if ($current.Kind -eq 'managed') {
            Invoke-Platform -ActionArgs @('--stop', '--allow-pending-migrations')
        } else {
            # Explicit legacy cutover only after PID/time/path and idle checks.
            Stop-Process -Id $current.Process.ProcessId
        }
        $deadline = (Get-Date).AddSeconds(10)
        while (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
            if ((Get-Date) -gt $deadline) { throw "Port $Port remains occupied; replacement was not started." }
            Start-Sleep -Milliseconds 250
        }
    }
    if ($ApplyMigration) {
        Invoke-Platform -ActionArgs @('--setup-only', '--migrate', '--backup-confirmed')
    }
    $logRoot = Split-Path -Parent $manifestPath
    $null = New-Item -ItemType Directory -Path $logRoot -Force
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdoutPath = Join-Path $logRoot "supervisor-$stamp.out.log"
    $stderrPath = Join-Path $logRoot "supervisor-$stamp.err.log"
    $startArgs = @('-B', ('"' + $launcherPath + '"'))
    # Start-Process joins arguments into one command line on Windows.
    $startArgs += @($profileArgs | ForEach-Object { '"' + $_ + '"' })
    if ($AdoptLegacyDownloads) { $startArgs += '--adopt-legacy-downloads' }
    $started = Start-Process -FilePath $pythonPath -ArgumentList $startArgs -WorkingDirectory $foundationRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    $deadline = (Get-Date).AddSeconds(70)
    do {
        Start-Sleep -Milliseconds 500
        $started.Refresh()
        if ($started.HasExited) { throw "Runtime supervisor exited. Inspect sanitized log: $stderrPath" }
        try {
            $newListener = Get-OfflineListener
            if ($newListener -and $newListener.Kind -eq 'managed') {
                $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
                $supervisor = Get-CimInstance Win32_Process -Filter "ProcessId=$($manifest.processes.supervisor.pid)"
                if ($manifest.ready -and ($supervisor.ProcessId -eq $started.Id -or $supervisor.ParentProcessId -eq $started.Id)) {
                    $health = Invoke-RestMethod -Uri "$apiUrl/health/ready" -TimeoutSec 2
                    if ($health.ok -eq $true) {
                        Write-Host "Rust offline API ready ($RuntimeProfile / $ReplayStorageProfile): $apiUrl"
                        Write-Host 'Reload the page. MT5/live execution and public services were not enabled.'
                        Write-Host "Runtime logs: $logRoot"
                        exit 0
                    }
                }
            }
        } catch { }
    } while ((Get-Date) -lt $deadline)
    if (Test-Path -LiteralPath $manifestPath) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        $supervisor = Get-CimInstance Win32_Process -Filter "ProcessId=$($manifest.processes.supervisor.pid)" -ErrorAction SilentlyContinue
        if ($supervisor -and ($supervisor.ProcessId -eq $started.Id -or $supervisor.ParentProcessId -eq $started.Id)) {
            Invoke-Platform -ActionArgs @('--stop')
        }
    }
    throw "Runtime readiness timed out; inspect sanitized log: $stderrPath"
} catch {
    Write-Host "Restart failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
