param([switch]$NoBrowser, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
try {
  $state = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'active.json') | ConvertFrom-Json
  if ($state.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid installed version' }
  $versionRoot = Join-Path $PSScriptRoot "versions\$($state.version)"
  $command = if ($Uninstall) { 'uninstall' } else { 'launch' }
  $arguments = @((Join-Path $versionRoot 'bridge\radaz_desktop.py'), $command, '--install-root', $PSScriptRoot)
  if ($NoBrowser) { $arguments += '--no-browser' }
  $logRoot = Join-Path $PSScriptRoot 'logs'
  New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
  $launchLog = Join-Path $logRoot 'launcher.log'
  # Let a verified pending controller perform the transaction. Older releases
  # can misidentify the Windows listener even when the new runtime is healthy.
  $pendingPath = Join-Path $PSScriptRoot 'pending.json'
  if (-not $Uninstall -and (Test-Path -LiteralPath $pendingPath)) {
    $pending = Get-Content -Raw -LiteralPath $pendingPath | ConvertFrom-Json
    if ($pending.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid pending version' }
    if ([version]$pending.version -gt [version]$state.version) {
      $candidate = Join-Path $PSScriptRoot "versions\$($pending.version)"
      # Validate with the currently installed interpreter before executing any
      # pending code. A bad candidate never bypasses the complete file manifest.
      & (Join-Path $versionRoot 'runtime\python\python.exe') -c 'import sys; from pathlib import Path; import radaz_desktop; radaz_desktop.validate_directory(Path(sys.argv[1]), sys.argv[2])' $candidate $pending.version >> $launchLog 2>&1
      if ($LASTEXITCODE -ne 0) { throw "Pending RADAZ integrity check failed. Log: $launchLog" }
      $versionRoot = $candidate
      $arguments[0] = Join-Path $versionRoot 'bridge\radaz_desktop.py'
    }
  }
  & (Join-Path $versionRoot 'runtime\python\python.exe') @arguments >> $launchLog 2>&1
  if ($LASTEXITCODE -ne 0) { throw "RADAZ acilmadi. Log: $launchLog" }
} catch {
  if ($NoBrowser -or $Uninstall) { Write-Error $_.Exception.Message; exit 1 }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($_.Exception.Message, 'RADAZ') | Out-Null
  exit 1
}
