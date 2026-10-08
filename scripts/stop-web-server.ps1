param([int]$Port = 5173)
$ErrorActionPreference = 'Stop'
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
if (-not $listeners.Count) { exit 0 }
$owners = @($listeners.OwningProcess | Sort-Object -Unique)
if ($owners.Count -ne 1) { throw "Port $Port has unexpected listeners. No process was stopped." }
$candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $($owners[0])"
# Only stop the RADAZ gateway process and its own child web workers, never the archive.
if (-not $candidate -or $candidate.Name -ne 'node.exe' -or $candidate.CommandLine -notmatch '(?:[\\/]|["\s])scripts[\\/]start-release\.mjs(?:["\s]|$)') {
  throw "Port $Port is not a recognized RADAZ web server. Close the old server window manually."
}
$identity = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/product.json" -TimeoutSec 5
if ($identity.name -ne 'RADAZ' -or $identity.version -notmatch '^\d+\.\d+\.\d+$') { throw 'The running application did not identify itself as RADAZ. No process was stopped.' }
Write-Host "Kohne RADAZ veb-serveri dayandirilir (PID $($candidate.ProcessId))..."
# The gateway can also parent the detached Python updater. Killing its whole
# process tree would kill the update controller and its replacement launcher.
# Snapshot only the known web renderers before stopping the gateway itself.
$renderers = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($candidate.ProcessId)" | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -match '(?:[\\/]|["\s])(?:dist[\\/]runtime[\\/]web-server\.mjs|node_modules[\\/]vinext[\\/]dist[\\/]cli\.js)(?:["\s]|$)'
})
function Stop-IdentifiedProcess($snapshot) {
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($snapshot.ProcessId)"
  if (-not $current) { return }
  if ($current.CreationDate -ne $snapshot.CreationDate -or $current.Name -ne $snapshot.Name -or $current.CommandLine -ne $snapshot.CommandLine) {
    throw 'Process identity changed during restart. No replacement process was stopped.'
  }
  Stop-Process -Id $snapshot.ProcessId -Force -ErrorAction Stop
}
Stop-IdentifiedProcess $candidate
foreach ($renderer in $renderers) { Stop-IdentifiedProcess $renderer }
foreach ($attempt in 1..30) {
  if (-not (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) { exit 0 }
  Start-Sleep -Milliseconds 200
}
throw "Port $Port was not released."
