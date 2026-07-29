@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-ready-windows.ps1"
if errorlevel 1 (echo. & echo ManeFlow installation did not complete. & pause & exit /b 1)
echo. & echo ManeFlow installation completed. & pause
