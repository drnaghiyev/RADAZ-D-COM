@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\repair-desktop-update.ps1"
if errorlevel 1 pause
