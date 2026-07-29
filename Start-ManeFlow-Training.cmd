@echo off
setlocal
cd /d "%~dp0"
if exist "vision-worker\.venv-windows\Scripts\python.exe" (
  set "PYTHON=vision-worker\.venv-windows\Scripts\python.exe"
) else (
  set "PYTHON=python"
)
%PYTHON% scripts\adaptive_learning_daemon.py --once --force
if errorlevel 1 (
  echo.
  echo ManeFlow learning stopped safely. No model was promoted.
  pause
  exit /b %errorlevel%
)
echo.
echo ManeFlow processed all new owner-authorized images.
echo Learning status is under data\training or .runtime\windows-beta\data\training.
pause
