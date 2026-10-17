param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$radazPort = if ($env:RADAZ_PORT) { [int]$env:RADAZ_PORT } else { 5173 }
if ($radazPort -lt 1 -or $radazPort -gt 65535) { throw 'RADAZ portu duzgun deyil.' }
$url = "http://localhost:$radazPort/"
$probeUrl = "http://127.0.0.1:$radazPort/"
$hasSource = (Test-Path -LiteralPath (Join-Path $projectRoot 'app\page.tsx')) -and -not (Test-Path -LiteralPath (Join-Path $projectRoot 'SHA256SUMS.json'))
$expected = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'public\product.json') | ConvertFrom-Json
trap {
  if ($env:RADAZ_INSTALL_ROOT -and $expected.version) {
    $diagnostic = @{ phase = 'windows-launcher'; type = $_.Exception.GetType().Name; message = $_.Exception.Message; version = $expected.version; at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    $diagnostic | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $env:RADAZ_INSTALL_ROOT "startup-error-$($expected.version).json")
  }
  Write-Error $_ -ErrorAction Continue
  exit 1
}
$buildPath = Join-Path $projectRoot 'dist\server\radaz-build.json'
$expectedBuild = if (Test-Path -LiteralPath $buildPath) { Get-Content -Raw -LiteralPath $buildPath | ConvertFrom-Json } else { $null }
if ($env:RADAZ_INSTALL_ROOT) {
  $parentId = (Get-CimInstance Win32_Process -Filter "ProcessId = $PID").ParentProcessId
  if ($env:RADAZ_LAUNCH_ID -and $env:RADAZ_STARTUP_CONTROLLER -eq [string]$parentId) {
    $lease = Get-Content -Raw -LiteralPath (Join-Path $env:RADAZ_INSTALL_ROOT 'runtime-launch.json') | ConvertFrom-Json
    if ($lease.version -ne $expected.version -or $lease.launchId -ne $env:RADAZ_LAUNCH_ID -or -not (Get-Process -Id $lease.controllerPid -ErrorAction SilentlyContinue)) {
      throw 'Superseded RADAZ startup attempt'
    }
  } else {
    # Legacy controllers inherit the gateway environment. A previous launch's
    # nonce is not a new controller lease and must not be reused.
    Remove-Item Env:RADAZ_LAUNCH_ID -ErrorAction SilentlyContinue
    Remove-Item Env:RADAZ_STARTUP_CONTROLLER -ErrorAction SilentlyContinue
  }
  # Also protects upgrades initiated by the unmodified 0.2.37/0.2.39 controller.
  # Its launch.lock is held; exclude that controller's ancestor chain.
  & (Join-Path $PSScriptRoot 'desktop-processes.ps1') -InstallRoot $env:RADAZ_INSTALL_ROOT -Action Quiesce
}
Set-Location -LiteralPath $projectRoot
$privateNode = Join-Path $projectRoot 'runtime\node\node.exe'
if (Test-Path -LiteralPath $privateNode) {
  $env:PATH = "$(Split-Path $privateNode);$(Join-Path $projectRoot 'runtime\python');$(Join-Path $projectRoot 'runtime\ffmpeg');$env:PATH"
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Write-Host 'RADAZ-i acmaq ucun Node.js 22.13 ve ya daha yeni versiya lazimdir.' -ForegroundColor Red
  Write-Host 'Node.js: https://nodejs.org'
  exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\runtime\web-server.mjs')) -and -not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\vinext\dist\cli.js'))) {
  Write-Host 'Yeni RADAZ qovlugu ucun paketler qurasdirilir...'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'setup-release.ps1')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Test-RadazServer {
  try {
    if (-not $expectedBuild -or $needsBuild) { return $false }
    $served = Invoke-RestMethod -Uri "${probeUrl}radaz-runtime.json" -TimeoutSec 5
    $servedVersion = if ($served.candidateVersion) { $served.candidateVersion } else { $served.version }
    if ($served.name -ne 'RADAZ' -or $servedVersion -ne $expected.version -or $served.buildId -ne $expectedBuild.buildId) { return $false }
    if ($env:RADAZ_LAUNCH_ID -and $served.launchId -ne $env:RADAZ_LAUNCH_ID) { return $false }
    $response = Invoke-WebRequest -UseBasicParsing -Uri $probeUrl -TimeoutSec 5
    return $response.StatusCode -eq 200
  } catch { return $false }
}

$needsBuild = $false
if ($hasSource) {
  $sourceDigest = & node (Join-Path $PSScriptRoot 'build-identity.mjs')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $needsBuild = -not $expectedBuild -or $expectedBuild.product.version -ne $expected.version -or $expectedBuild.sourceHash -ne $sourceDigest
} elseif (-not $expectedBuild -or $expectedBuild.product.version -ne $expected.version) {
  throw 'RADAZ fayllari eyni versiyadan deyil. Release ZIP-ni ayrica yeni qovluga tam cixarin.'
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-archive.ps1')
if ($LASTEXITCODE -ne 0) {
  if ($LASTEXITCODE -eq 17) { exit 17 }
  if ($env:RADAZ_INSTALL_ROOT) { throw 'Arxiv xidmeti hazir deyil. Yenileme sonraki acilisa saxlanilir.' }
  Write-Warning 'Daimi arxiv xidmeti baslamadi; viewer brauzer arxivi ile davam edir.'
}

if (Test-RadazServer) {
  Write-Host 'RADAZ serveri artiq isleyir. Movcud sehife acilir.' -ForegroundColor Green
  if (-not $NoBrowser) { Start-Process "${url}?radaz-build=$($expectedBuild.buildId)" }
  exit 0
}
if (Get-NetTCPConnection -State Listen -LocalPort $radazPort -ErrorAction SilentlyContinue) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'stop-web-server.ps1') -Port $radazPort
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# Source checkouts build the current files; distributed ZIPs are already built.
# Normal workstation startup never enters Vite's development/optimizer loop.
if ($needsBuild) {
  Write-Host 'RADAZ-in cari fayllari hazirlanir...'
  & node (Join-Path $PSScriptRoot 'run-framework.mjs') build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\server\index.js'))) {
  Write-Error 'Hazir RADAZ fayllari tapilmadi. Release ZIP paketini yeniden acin.'
  exit 1
}

Write-Host "RADAZ $($expected.version) lokal serveri acilir..."
Write-Host "Brauzer unvani: $url"
$browserWaiter = $null
try {
  if (-not $NoBrowser) {
    $browserWaiter = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      "`"$(Join-Path $PSScriptRoot 'wait-release-browser.ps1')`"", '-Wait',
      '-OwnerProcessId', $PID, '-Url', $url
    )
  }
  & node (Join-Path $PSScriptRoot 'start-release.mjs')
  $radazExitCode = $LASTEXITCODE
} finally {
  if ($browserWaiter -and -not $browserWaiter.HasExited) { $browserWaiter.Kill() }
}
exit $radazExitCode
