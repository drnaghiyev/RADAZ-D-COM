param(
  [Parameter(Mandatory=$true)][string]$InstallRoot,
  [ValidateSet('Quiesce','StopRuntime','StopServices','Owner','RetireWatch','InUse')][string]$Action = 'Quiesce',
  [string]$Version,
  [int]$Port = 5173
)
$ErrorActionPreference = 'Stop'
$installation = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$versions = Join-Path $installation 'versions'
if ($Version -and $Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid runtime version' }
$scopedVersion = $Version -and $Action -ne 'RetireWatch'
$scope = if ($scopedVersion) { Join-Path $versions $Version } else { $versions }
$processes = @(Get-CimInstance Win32_Process)
if ($Action -eq 'InUse') {
  $pattern = [regex]::Escape($versions + '\') + '(\d+\.\d+\.\d+)\\'
  $used = @($processes | ForEach-Object {
    foreach ($text in @($_.ExecutablePath, $_.CommandLine)) {
      if ($text) { foreach ($match in [regex]::Matches($text, $pattern, 'IgnoreCase')) { $match.Groups[1].Value } }
    }
  } | Sort-Object -Unique)
  @{versions=$used} | ConvertTo-Json -Compress
  exit 0
}
# Never stop this controller, its invoking watcher, or any ancestor. In
# particular a gateway may have parented the detached update controller.
$ancestors = @{}
$next = $PID
while ($next -and -not $ancestors.ContainsKey([int]$next)) {
  $ancestors[[int]$next] = $true
  $parent = $processes | Where-Object ProcessId -eq $next | Select-Object -First 1
  $next = if ($parent) { $parent.ParentProcessId } else { 0 }
}
function Has-Script($process, [string]$relative) {
  if (-not $process.CommandLine) { return $false }
  $prefix = [regex]::Escape($scope + '\')
  $suffix = [regex]::Escape($relative)
  $middle = if ($scopedVersion) { '' } else { '\d+\.\d+\.\d+\\' }
  return $process.CommandLine -match ('(?:^|["\s])' + $prefix + $middle + $suffix + '(?:["\s]|$)')
}
function Stop-Snapshot($snapshot, [switch]$RetireAncestor) {
  if ($ancestors.ContainsKey([int]$snapshot.ProcessId) -and -not $RetireAncestor) { return }
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($snapshot.ProcessId)"
  if (-not $current) { return }
  # A parent shutdown can reap a child between enumeration and this lookup.
  # A recycled PID belongs to a replacement, so the original is already gone.
  if ($current.CreationDate -ne $snapshot.CreationDate) { return }
  if ($current.ExecutablePath -ne $snapshot.ExecutablePath -or $current.CommandLine -ne $snapshot.CommandLine) {
    $live = Get-Process -Id $snapshot.ProcessId -ErrorAction SilentlyContinue
    if (-not $live -or $live.HasExited) { return }
    throw 'Process identity changed; replacement process was not stopped.'
  }
  try { Stop-Process -Id $current.ProcessId -Force -ErrorAction Stop }
  catch {
    $remaining = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ProcessId)"
    if ($remaining -and $remaining.CreationDate -eq $snapshot.CreationDate) { throw }
  }
  Wait-Process -Id $current.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
  $remaining = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ProcessId)"
  if ($remaining -and $remaining.CreationDate -eq $snapshot.CreationDate) {
    $live = Get-Process -Id $current.ProcessId -ErrorAction SilentlyContinue
    if ($live -and -not $live.HasExited) { throw "Runtime process did not stop: $($current.Name) PID $($current.ProcessId)" }
  }
}
if ($Action -eq 'Owner') {
  $owners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
  if ($owners.Count -ne 1) { throw 'Expected exactly one runtime listener' }
  $owner = $processes | Where-Object ProcessId -eq $owners[0] | Select-Object -First 1
  if (-not $Version -or $owner.Name -ne 'node.exe' -or -not (Has-Script $owner 'scripts\start-release.mjs') -or $owner.ExecutablePath -ine (Join-Path $scope 'runtime\node\node.exe')) {
    throw 'Port is not owned by the requested installed runtime'
  }
  @{pid=$owner.ProcessId; version=$Version; created=$owner.CreationDate.ToString('o')} | ConvertTo-Json -Compress
  exit 0
}
# Stop startup producers before their children. Do not kill arbitrary process
# trees, Electron windows, archive receivers, or another installation's services.
foreach ($process in $processes) {
  $watch = $process.Name -eq 'python.exe' -and (Has-Script $process 'bridge\radaz_desktop.py') -and $process.CommandLine -match 'radaz_desktop\.py"?\s+watch(?:\s|$)'
  if ($Action -eq 'RetireWatch') {
    # The new Watch owns launch.lock at this point. An old Watch which was
    # itself the applying controller has now left the activation transaction;
    # it is safe to retire even if it parented us. Never kill its child tree.
    $keep = [regex]::Escape((Join-Path $versions "$Version\bridge\radaz_desktop.py"))
    if ($watch -and $Version -and $process.CommandLine -notmatch $keep) { Stop-Snapshot $process -RetireAncestor }
    continue
  }
  $starter = $process.Name -in @('powershell.exe','pwsh.exe') -and ((Has-Script $process 'scripts\start-radaz.ps1') -or (Has-Script $process 'scripts\start-archive.ps1') -or (Has-Script $process 'scripts\stop-web-server.ps1'))
  if ($starter -or ($Action -eq 'Quiesce' -and $watch)) { Stop-Snapshot $process }
}
if ($Action -eq 'StopRuntime') {
  foreach ($process in $processes) {
    $runtimeNode = $Version -and $process.ExecutablePath -ieq (Join-Path $scope 'runtime\node\node.exe')
    $worker = $runtimeNode -and $process.CommandLine -match '(?:["\s])dist[\\/]runtime[\\/]web-server\.mjs(?:["\s]|$)'
    if ($process.Name -eq 'node.exe' -and ((Has-Script $process 'scripts\start-release.mjs') -or (Has-Script $process 'dist\runtime\web-server.mjs') -or $worker)) { Stop-Snapshot $process }
  }
}
if ($Action -eq 'StopServices') {
  foreach ($process in $processes) {
    $archive = $process.Name -eq 'python.exe' -and ((Has-Script $process 'bridge\radaz_archive.py') -or (Has-Script $process 'bridge\radaz_pacs_bridge.py'))
    $shellPath = [regex]::Escape($versions + '\') + '\d+\.\d+\.\d+\\runtime\\electron\\RADAZ\.exe$'
    $shell = $process.Name -eq 'RADAZ.exe' -and $process.ExecutablePath -match ('^' + $shellPath)
    if ($archive -or $shell) { Stop-Snapshot $process }
  }
}
