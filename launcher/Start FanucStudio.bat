@echo off
rem FanucStudio (installed copy): checks the share for a signed update, then
rem runs the bridge in this window. Keep it open while you use the app.
rem Everything after the node line is on that same line on purpose: an update
rem may rewrite this file while it runs, and cmd reads a .bat line by line.
title FanucStudio
cd /d "%~dp0"
"%~dp0bin\node.exe" "%~dp0launcher.js" --console --open & pause & exit /b
