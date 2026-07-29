@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows-beta.ps1" -RepairVision
if errorlevel 1 pause
