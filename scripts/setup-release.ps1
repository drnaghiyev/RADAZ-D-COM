$ErrorActionPreference='Stop'
$radazRoot=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $radazRoot
if (Test-Path -LiteralPath (Join-Path $radazRoot 'runtime\python\python.exe')) {
  & (Join-Path $radazRoot 'runtime\python\python.exe') (Join-Path $radazRoot 'bridge\radaz_desktop.py') install
  if ($LASTEXITCODE -ne 0) { throw 'RADAZ installation failed.' }
  Write-Host 'RADAZ qurasdirildi. Is masasindaki RADAZ qisayolunu acin.'
  exit 0
}
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.13+ from nodejs.org first.' }
if (-not (Get-Command python.exe -ErrorAction SilentlyContinue)) { throw 'Install Python 3.10+ from python.org first.' }
$nodeVersion = & node -p 'process.versions.node'
if ([version]$nodeVersion -lt [version]'22.13.0') { throw 'Node.js 22.13+ is required.' }
if (-not (Test-Path -LiteralPath (Join-Path $radazRoot 'dist\runtime\web-server.mjs'))) {
  & corepack pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& python -c 'from PIL import Image'
if ($LASTEXITCODE -ne 0) { & python -m pip install 'Pillow>=10,<13'; if ($LASTEXITCODE -ne 0) { throw 'Pillow installation failed.' } }
Write-Host 'Setup complete. Run START-RADAZ.cmd.'
