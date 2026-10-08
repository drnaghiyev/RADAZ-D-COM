$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$archivePort = if ($env:RADAZ_ARCHIVE_PORT) { [int]$env:RADAZ_ARCHIVE_PORT } else { 8766 }
$statusUrl = "http://127.0.0.1:$archivePort/status"
$expected = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'public\product.json') | ConvertFrom-Json).version
$status = $null
try { $status = Invoke-RestMethod -Uri $statusUrl -TimeoutSec 2 } catch {}
if ($status.version -eq 1) {
  if (-not $env:RADAZ_INSTALL_ROOT -or $status.appVersion -eq $expected) { exit 0 }
  if (-not $status.desktopManaged) {
    Write-Warning 'Kohne arxiv xidmeti isleyir. Windows yeniden acilanda yeni xidmet baslayacaq.'
    exit 0
  }
  try {
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$archivePort/_desktop/stop" -Headers @{'X-RADAZ-Desktop'=$env:RADAZ_DESKTOP_TOKEN} -TimeoutSec 20 | Out-Null
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 409) { exit 17 }
    throw
  }
  foreach ($attempt in 1..60) {
    if (-not (Get-NetTCPConnection -State Listen -LocalPort $archivePort -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 200
  }
}
$pythonPath = Join-Path $projectRoot 'runtime\python\python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
  $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $pythonCommand) { throw 'Python 3.10+ is required for the RADAZ permanent archive.' }
  $pythonPath = $pythonCommand.Source
}
$scriptPath = Join-Path $projectRoot 'bridge\radaz_archive.py'
$logDirectory = if ($env:RADAZ_INSTALL_ROOT) { Join-Path $env:RADAZ_INSTALL_ROOT 'logs' } else { Join-Path $env:LOCALAPPDATA 'RADAZ\Logs' }
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$archiveArguments = @("`"$scriptPath`"", '--http-port', $archivePort)
if ($env:RADAZ_ARCHIVE_DATA) { $archiveArguments += @('--data-dir', "`"$env:RADAZ_ARCHIVE_DATA`"") }
$logStamp = "$expected-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
$errorLog = Join-Path $logDirectory "archive-error-$logStamp.log"
$archiveProcess = Start-Process -FilePath $pythonPath -WindowStyle Hidden -PassThru -WorkingDirectory $projectRoot -ArgumentList $archiveArguments -RedirectStandardError $errorLog -RedirectStandardOutput (Join-Path $logDirectory "archive-$logStamp.log")
foreach ($attempt in 1..60) {
  Start-Sleep -Milliseconds 300
  if ($archiveProcess.HasExited) { throw "RADAZ archive exited ($($archiveProcess.ExitCode)): $(Get-Content -Raw -LiteralPath $errorLog)" }
  try { $status = Invoke-RestMethod -Uri $statusUrl -TimeoutSec 1; if ($status.version -eq 1 -and $status.appVersion -eq $expected) { exit 0 } } catch {}
}
throw "RADAZ archive did not start. Check $errorLog"
