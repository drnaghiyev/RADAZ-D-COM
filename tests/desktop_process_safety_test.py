"""Exercise process exit/PID reuse without touching any actual process."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

@unittest.skipUnless(os.name == 'nt', 'Windows process ownership protocol')
class DesktopProcessSafety(unittest.TestCase):
    def test_exited_and_recycled_processes_are_not_killed_or_reported_as_live(self):
        harness = r'''
param($TargetScript, $Mode)
$ErrorActionPreference='Stop'
$global:radazTestStopped=$false
$snapshot=[pscustomobject]@{Name='python.exe';ProcessId=99999;ParentProcessId=0;CreationDate=[datetime]'2026-01-01';ExecutablePath='C:\RADAZ-test\versions\0.2.41\runtime\python\python.exe';CommandLine='python.exe C:\RADAZ-test\versions\0.2.41\bridge\radaz_archive.py'}
$current=$snapshot.PSObject.Copy()
if ($Mode -eq 'gone') {$current.ExecutablePath=$null;$current.CommandLine=$null}
if ($Mode -eq 'reused') {$current.CreationDate=$snapshot.CreationDate.AddSeconds(1);$current.CommandLine='foreign process'}
if ($Mode -eq 'changed-live') {$current.CommandLine='unexpected live command'}
function Get-CimInstance {param($ClassName,$Filter) if ($Filter) {return $current} else {return $snapshot}}
function Get-Process {param($Id,$ErrorAction) if ($Mode -eq 'changed-live') {return [pscustomobject]@{HasExited=$false}}}
function Stop-Process {param($Id,[switch]$Force,$ErrorAction) $global:radazTestStopped=$true}
function Wait-Process {param($Id,$Timeout,$ErrorAction)}
$failed=$false
try {& $TargetScript -InstallRoot 'C:\RADAZ-test' -Action StopServices} catch {$failed=$true}
@{stopped=$global:radazTestStopped;failed=$failed}|ConvertTo-Json -Compress
'''
        with tempfile.TemporaryDirectory(prefix='radaz-process-unit-') as folder:
            file = Path(folder) / 'ownership.ps1';file.write_text(harness)
            for mode in ('gone', 'reused', 'changed-live', 'normal'):
                with self.subTest(mode=mode):
                    result = subprocess.run([str(Path(os.environ['SystemRoot'])/'System32/WindowsPowerShell/v1.0/powershell.exe'), '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(file), str(ROOT/'scripts/desktop-processes.ps1'), mode],capture_output=True,text=True,timeout=20,creationflags=0x08000000)
                    self.assertEqual(result.returncode,0,result.stderr)
                    self.assertEqual(json.loads(result.stdout),{'stopped':mode=='normal','failed':mode=='changed-live'})

if __name__ == '__main__':unittest.main()
