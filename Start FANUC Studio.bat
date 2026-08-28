@echo off
title FANUC TP Program Studio
cd /d "%~dp0"

rem Portable builds ship their own Node runtime in runtime\node.exe.
rem Otherwise fall back to a system-installed Node.
set "NODE=%~dp0runtime\node.exe"
if not exist "%NODE%" (
  set "NODE=node"
  where node >nul 2>nul
  if errorlevel 1 (
    echo Node.js was not found.
    echo.
    echo Either use the portable ZIP build ^(it includes Node^), or install the
    echo LTS version from https://nodejs.org and run this again.
    echo.
    echo ^(For offline file viewing only, you can just double-click index.html.^)
    pause
    exit /b 1
  )
)

echo Starting the FANUC TP Program Studio bridge...
echo Keep this window open while you use the app. Close it to stop the bridge.
echo.

rem open the browser once the server has had a moment to start
start "" cmd /c "ping -n 2 127.0.0.1 >nul & start "" http://localhost:8642"

"%NODE%" server.js
pause
