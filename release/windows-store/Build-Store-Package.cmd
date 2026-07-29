@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Build-Store-Package.ps1"
if errorlevel 1 (
  echo.
  echo ManeFlow Store packaging did not complete. Review the message above.
  pause
  exit /b 1
)
echo.
echo ManeFlow Store package generation completed.
pause
