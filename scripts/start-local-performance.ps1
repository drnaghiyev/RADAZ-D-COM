param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$port = 5334
$expected = Get-Content -Raw (Join-Path $root 'dist/server/radaz-build.json') | ConvertFrom-Json
$ready = $false
try {
  $health = Invoke-RestMethod "http://127.0.0.1:$port/radaz-health.json" -TimeoutSec 2
  if ($health.buildId -ne $expected.buildId) { throw 'Port belongs to a different preview. Close that preview before starting this one.' }
  $ready = $health.ready
} catch {
  if ($_.Exception.Message -like 'Port belongs*') { throw }
}
if (-not $ready) {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $env:RADAZ_PORT = "$port"
  $env:RADAZ_WORKER_PORT = '5335'
  $env:RADAZ_ARCHIVE_PORT = '8768'
  $env:RADAZ_LOCAL_PREVIEW = '1'
  # Do not attach a private preview to the installed updater or change active.json.
  Remove-Item Env:RADAZ_INSTALL_ROOT -ErrorAction SilentlyContinue
  $nativePython = Join-Path $env:LOCALAPPDATA 'Programs/Python/Python310/python.exe'
  if (Test-Path -LiteralPath $nativePython) { $env:RADAZ_NATIVE_PYTHON = $nativePython }
  $archive = Invoke-RestMethod 'http://127.0.0.1:8766/status' -TimeoutSec 5
  $env:RADAZ_NATIVE_ARCHIVE = Split-Path $archive.databasePath -Parent
  $env:RADAZ_SMART_VOLUME_ROOT = Join-Path $env:LOCALAPPDATA 'Programs/RADAZ/local-modules/smart-volume'
  $logs = Join-Path $root 'outputs/local-preview'
  New-Item -ItemType Directory -Force $logs | Out-Null
  $run = [guid]::NewGuid().ToString('N')
  $archiveReady = $false
  try {
    $previewArchive = Invoke-RestMethod 'http://127.0.0.1:8768/status' -TimeoutSec 2
    if ($previewArchive.databasePath -ne $archive.databasePath) { throw 'Archive preview port belongs to another archive.' }
    $archiveReady = $true
  } catch { if ($_.Exception.Message -like 'Archive preview port*') { throw } }
  if (-not $archiveReady) {
    $install = Join-Path $env:LOCALAPPDATA 'Programs/RADAZ'
    $active = Get-Content -Raw (Join-Path $install 'active.json') | ConvertFrom-Json
    if ($active.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid installed version' }
    $archivePython = Join-Path $install "versions/$($active.version)/runtime/python/python.exe"
    Start-Process -FilePath $archivePython -ArgumentList @('-B','bridge/radaz_archive.py','--http-only','--http-port','8768','--data-dir',('"' + $env:RADAZ_NATIVE_ARCHIVE + '"')) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs "$run-archive-out.log") -RedirectStandardError (Join-Path $logs "$run-archive-error.log") | Out-Null
    for ($n = 0; $n -lt 30; $n++) {
      try { $previewArchive = Invoke-RestMethod 'http://127.0.0.1:8768/status' -TimeoutSec 2; if ($previewArchive.databasePath -eq $archive.databasePath) { $archiveReady = $true; break } } catch {}
      Start-Sleep -Seconds 1
    }
    if (-not $archiveReady) { throw "Lokal arxiv sınağı açılmadı. Jurnal: $logs" }
  }
  Start-Process -FilePath $node -ArgumentList 'scripts/start-release.mjs' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs "$run-out.log") -RedirectStandardError (Join-Path $logs "$run-error.log") | Out-Null
  for ($n = 0; $n -lt 60; $n++) {
    try { $health = Invoke-RestMethod "http://127.0.0.1:$port/radaz-health.json" -TimeoutSec 2; if ($health.ready -and $health.buildId -eq $expected.buildId) { $ready = $true; break } } catch {}
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "Lokal sınaq açılmadı. Jurnal: $logs" }
}
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$port/" }
Write-Output "RADAZ lokal sinaq: http://127.0.0.1:$port/"
