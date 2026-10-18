param([switch]$NoBrowser, [switch]$Uninstall)
$ErrorActionPreference = 'Stop'
try {
  $state = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'active.json') | ConvertFrom-Json
  if ($state.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid installed version' }
  $versionRoot = Join-Path $PSScriptRoot "versions\$($state.version)"
  $command = if ($Uninstall) { 'uninstall' } else { 'launch' }
  $arguments = @((Join-Path $versionRoot 'bridge\radaz_desktop.py'), $command, '--install-root', $PSScriptRoot)
  if ($NoBrowser) { $arguments += '--no-browser' }
  & (Join-Path $versionRoot 'runtime\python\python.exe') @arguments
  if ($LASTEXITCODE -ne 0) { throw "RADAZ acilmadi. Log: $PSScriptRoot\logs\desktop.log" }
} catch {
  if ($NoBrowser -or $Uninstall) { Write-Error $_.Exception.Message; exit 1 }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($_.Exception.Message, 'RADAZ') | Out-Null
  exit 1
}
