param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\RADAZ'),
  [string]$TargetVersion = '0.2.39'
)
$ErrorActionPreference = 'Stop'
$repairRoot = Split-Path -Parent $PSScriptRoot
$active = Get-Content -Raw -LiteralPath (Join-Path $InstallRoot 'active.json') | ConvertFrom-Json
if ($active.version -notmatch '^\d+\.\d+\.\d+$' -or $TargetVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid version' }
$python = Join-Path $InstallRoot "versions\$($active.version)\runtime\python\python.exe"
& $python (Join-Path $repairRoot 'bridge\radaz_desktop.py') repair --install-root $InstallRoot --target-version $TargetVersion
if ($LASTEXITCODE -ne 0) { throw 'RADAZ update repair failed. See logs\update-errors.jsonl in the installation folder.' }
Write-Host "RADAZ $TargetVersion verified and active."
