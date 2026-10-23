[CmdletBinding()]
param(
    [ValidateSet('Init', 'Status', 'Serve')][string]$Action = 'Status',
    [string]$GatewayDirectory,
    [string]$RuntimeHome
)

$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
if (-not $GatewayDirectory) { $GatewayDirectory = Join-Path $taskProject '.runtime/ai-gateway-evaluation/cliproxyapi-v8.0.40' }
if (-not $RuntimeHome) { $RuntimeHome = Join-Path $taskProject '.runtime/mt5-ai-gateway' }
$taskGateway = [IO.Path]::GetFullPath($GatewayDirectory)
$taskHome = [IO.Path]::GetFullPath($RuntimeHome)
$taskBinary = Join-Path $taskGateway 'cli-proxy-api.exe'
$taskConfig = Join-Path $taskHome 'config.yaml'
$taskKey = Join-Path $taskHome 'inference.key'
$taskExpectedHash = '0fd1f03b80a4acac69515e3737fc9f4445de69221e4750e20a3c70038a3b8443'
if (-not (Test-Path -LiteralPath $taskBinary -PathType Leaf) -or
    (Get-FileHash -LiteralPath $taskBinary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpectedHash) {
    throw 'Expected the evaluated CLIProxyAPI v8.0.40 Windows AMD64 binary. Download and verify the pinned release first.'
}

if ($Action -eq 'Init') {
    if (Test-Path -LiteralPath $taskHome) { throw 'Runtime home already exists. Existing keys/accounts were not changed.' }
    New-Item -ItemType Directory -Path $taskHome | Out-Null
    # Protect the directory before creating either copy of the inference key.
    $taskSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $taskAcl = New-Object Security.AccessControl.DirectorySecurity
    $taskAcl.SetOwner($taskSid)
    $taskAcl.SetAccessRuleProtection($true, $false)
    $taskRule = New-Object Security.AccessControl.FileSystemAccessRule($taskSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $taskAcl.AddAccessRule($taskRule)
    Set-Acl -LiteralPath $taskHome -AclObject $taskAcl
    $taskActualAcl = Get-Acl -LiteralPath $taskHome
    if (-not $taskActualAcl.AreAccessRulesProtected -or @($taskActualAcl.Access).Count -ne 1 -or
        $taskActualAcl.Access[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $taskSid.Value) {
        throw 'Private runtime ACL verification failed. No key was generated.'
    }
    $taskBytes = New-Object byte[] 32
    $taskRng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $taskRng.GetBytes($taskBytes) } finally { $taskRng.Dispose() }
    $taskToken = [Convert]::ToBase64String($taskBytes)
    $taskUtf8 = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($taskKey, $taskToken, $taskUtf8)
    $taskAuth = Join-Path $taskHome 'auth'
    New-Item -ItemType Directory -Path $taskAuth | Out-Null
    $taskAuthYaml = ConvertTo-Json -InputObject $taskAuth -Compress
    $taskYaml = @"
config-version: 8
server:
  host: "127.0.0.1"
  port: 17852
  max-request-body-bytes: 65536
  commercial-mode: true
  discovery:
    enabled: false
management:
  allow-remote: false
  secret-key: ""
  disable-control-panel: true
  disable-auto-update-panel: true
access:
  api-keys: ["$taskToken"]
oauth:
  auth-dir: $taskAuthYaml
routing:
  strategy: "round-robin"
  session-affinity: true
  retry:
    request-retry: 0
    max-retry-credentials: 1
    max-retry-interval: 0
observability:
  logs:
    debug: false
    logging-to-file: false
    request-log: false
  usage:
    usage-statistics-enabled: false
"@
    [IO.File]::WriteAllText($taskConfig, $taskYaml, $taskUtf8)
    Write-Output 'Private gateway configuration created. No account login or service was started.'
}
if (-not (Test-Path -LiteralPath $taskConfig -PathType Leaf) -or -not (Test-Path -LiteralPath $taskKey -PathType Leaf)) {
    throw 'Gateway is not initialized. Run -Action Init first.'
}
if ($Action -eq 'Serve') {
    if (@(Get-NetTCPConnection -LocalPort 17852 -State Listen -ErrorAction SilentlyContinue).Count) {
        throw 'Port17852 is occupied. No existing process was adopted or stopped.'
    }
    Write-Output 'Starting the local gateway on127.0.0.1:17852. Ctrl+C stops this foreground process. No login is performed.'
    & $taskBinary --local-model --config $taskConfig
    if ($LASTEXITCODE -ne 0) { throw "Gateway exited with code $LASTEXITCODE" }
} else {
    [pscustomobject]@{
        Version = 'v8.0.40'; Endpoint = 'http://127.0.0.1:17852/v1'; RuntimeHome = $taskHome
        KeyFile = $taskKey; ConfigFile = $taskConfig
        ListenerPresent = (@(Get-NetTCPConnection -LocalPort 17852 -State Listen -ErrorAction SilentlyContinue).Count -gt 0)
        AccountFiles = @(Get-ChildItem -LiteralPath (Join-Path $taskHome 'auth') -Filter '*.json' -File).Count
    }
}
