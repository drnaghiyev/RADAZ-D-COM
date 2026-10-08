param([Parameter(Mandatory=$true)][string]$InstallRoot, [string]$ShortcutDirectory)
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$folders = if ($ShortcutDirectory) { @($ShortcutDirectory) } else { @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Startup')) }
foreach ($folder in $folders) {
  $shortcut = $shell.CreateShortcut((Join-Path $folder 'RADAZ.lnk'))
  $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $InstallRoot 'launcher.ps1')`""
  $shortcut.WorkingDirectory = $InstallRoot
  $shortcut.WindowStyle = 7
  $shortcut.IconLocation = Join-Path $InstallRoot 'radaz.ico'
  $shortcut.Description = 'RADAZ - DICOM Viewer'
  $shortcut.Save()
}
