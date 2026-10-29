[CmdletBinding()]
param(
    [ValidateSet('Init', 'Status', 'Login', 'Serve')]
    [string]$Action = 'Status',
    [string]$CoreDirectory,
    [string]$RuntimeHome,
    [ValidateRange(1024, 65535)]
    [int]$Port = 17851
)

$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
$taskWorkspace = Split-Path -Parent (Split-Path -Parent $taskProject)
if (-not $CoreDirectory) {
    $CoreDirectory = Join-Path $taskWorkspace 'tooling/chatgpt-web-core'
}
if (-not $RuntimeHome) {
    $RuntimeHome = Join-Path $taskWorkspace '.runtime/mt5-chatgpt-web'
}
$taskCore = (Resolve-Path -LiteralPath $CoreDirectory).Path
$taskPrivateHome = [System.IO.Path]::GetFullPath($RuntimeHome)
$taskCli = Join-Path $taskCore 'src/core-cli.ts'
if (-not (Test-Path -LiteralPath $taskCli -PathType Leaf)) {
    throw "chatgpt-web-core entrypoint not found: $taskCli"
}
$taskBun = Get-Command bun -ErrorAction Stop
$taskArguments = @('run', $taskCli, $Action.ToLowerInvariant(), '--home', $taskPrivateHome)
if ($Action -eq 'Init') { $taskArguments += @('--port', "$Port") }
# The child CLI binds all compatibility namespaces to this private home.
# Serve stays in this terminal; Ctrl+C stops only this provider process.
& $taskBun.Source @taskArguments
if ($LASTEXITCODE -ne 0) { throw "chatgpt-web-core $Action failed (exit $LASTEXITCODE)" }
