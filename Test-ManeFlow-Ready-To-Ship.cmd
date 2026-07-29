@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js 22 or newer is required.
  pause
  exit /b 1
)
where npm >nul 2>nul || (
  echo npm was not found.
  pause
  exit /b 1
)
call npm run verify:ship
set EXITCODE=%ERRORLEVEL%
echo.
if "%EXITCODE%"=="0" (
  echo ManeFlow ready-to-ship provider gate PASSED.
) else (
  echo ManeFlow ready-to-ship provider gate FAILED with code %EXITCODE%.
)
echo.
pause
exit /b %EXITCODE%
