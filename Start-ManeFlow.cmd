@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows-beta.ps1"
if errorlevel 1 (
  echo.
  echo ManeFlow could not start. Read the error above.
  echo Logs are stored under .runtime\windows-beta\logs.
  pause
)
