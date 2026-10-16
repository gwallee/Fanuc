@echo off
title FANUC TP Program Studio
cd /d "%~dp0"

rem Options:
rem   /nobrowser   start the bridge without opening a browser tab — for when
rem                the app is installed (Chrome/Edge "Install app") and you
rem                open it from its own icon
rem   /quiet       no "press any key" at the end (used when run hidden)
set "OPEN_BROWSER=1"
set "QUIET="
:args
if "%~1"=="" goto :argsdone
if /i "%~1"=="/nobrowser" set "OPEN_BROWSER="
if /i "%~1"=="/quiet" set "QUIET=1"
shift
goto :args
:argsdone

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
    if not defined QUIET pause
    exit /b 1
  )
)

rem Register the fanucstudio: link for this user (no admin needed), so the
rem installed app can start the bridge itself when it finds it down: its
rem "Start the bridge" button opens fanucstudio:start, and Windows runs the
rem hidden launcher beside this file. Re-run every time, so a moved folder
rem is picked up.
reg add "HKCU\Software\Classes\fanucstudio" /ve /d "URL:FANUC TP Program Studio bridge" /f >nul 2>nul
reg add "HKCU\Software\Classes\fanucstudio" /v "URL Protocol" /d "" /f >nul 2>nul
reg add "HKCU\Software\Classes\fanucstudio\DefaultIcon" /ve /d "\"%~dp0FANUC Studio.ico\"" /f >nul 2>nul
reg add "HKCU\Software\Classes\fanucstudio\shell\open\command" /ve /d "wscript.exe \"%~dp0Start FANUC Studio hidden.vbs\" \"%%1\"" /f >nul 2>nul

echo Starting the FANUC TP Program Studio bridge...
echo Keep this window open while you use the app. Close it to stop the bridge.
echo.
echo Using the installed app instead of a browser tab? Start this with /nobrowser,
echo or let the app start the bridge itself: it offers "Start the bridge" when it
echo finds the bridge down. "Start FANUC Studio hidden.vbs" runs it with no window.
echo.

rem open the browser once the server has had a moment to start
if defined OPEN_BROWSER start "" cmd /c "ping -n 2 127.0.0.1 >nul & start "" http://localhost:8642"

"%NODE%" server.js
if not defined QUIET pause
