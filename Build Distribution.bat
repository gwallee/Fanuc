@echo off
setlocal
title Build FANUC Studio Distribution
cd /d "%~dp0"

set "BUILD_NODE=%~dp0runtime\node.exe"
if exist "%BUILD_NODE%" goto build
set "BUILD_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js LTS from https://nodejs.org
  echo on this build PC, then run this tool again.
  echo The resulting distribution includes Node.js for its recipients.
  pause
  exit /b 1
)

:build
echo Building a portable Windows distribution of FANUC Studio...
echo The first build downloads its runtime. Later builds use the cached copy.
echo.
"%BUILD_NODE%" "%~dp0tools\build-release.js" %*
set "BUILD_RESULT=%ERRORLEVEL%"
echo.
if "%BUILD_RESULT%"=="0" (
  echo Distribution ready: dist\FanucStudio-portable-win-x64.zip
) else (
  echo The distribution could not be built. See the error above.
)
pause
exit /b %BUILD_RESULT%
