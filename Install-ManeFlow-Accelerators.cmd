@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows-accelerators.ps1" -Mode auto
if errorlevel 1 (
  echo.
  echo ManeFlow accelerator installation failed. The normal CPU beta remains usable.
  pause
)
