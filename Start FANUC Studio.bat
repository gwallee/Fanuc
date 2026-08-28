@echo off
title FANUC TP Program Studio
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  echo.
  echo ^(For offline file viewing only, you can just double-click index.html instead.^)
  pause
  exit /b 1
)

echo Starting the FANUC TP Program Studio bridge...
echo Keep this window open while you use the app. Close it to stop the bridge.
echo.

rem open the browser once the server has had a moment to start
start "" cmd /c "ping -n 2 127.0.0.1 >nul & start "" http://localhost:8642"

node server.js
pause
