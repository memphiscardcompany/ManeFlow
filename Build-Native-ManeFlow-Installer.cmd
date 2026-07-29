@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-native-installer-online.ps1"
if errorlevel 1 (echo. & echo Native installer build did not complete. & pause & exit /b 1)
pause
