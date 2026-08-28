What the Wether V11 — Desktop Version
====================================

This folder prepares the project to be packaged as a desktop app with
Electron. The web app in the repository root IS the desktop app — no
separate codebase, no API keys, fully offline-capable UI (weather data
still needs an internet connection, the AI does not).

REQUIREMENTS
------------
- Node.js 18+ (only for building the desktop app; the website itself
  needs nothing)

QUICK START (development)
-------------------------
1. cd desktop
2. npm install
3. npm start

That launches Electron and loads ../index.html in a desktop window.

PACKAGING AN INSTALLER (later)
------------------------------
When you're ready to ship installers, add electron-builder:

  cd desktop
  npm install --save-dev electron-builder
  npx electron-builder --win     (or --mac / --linux)

FILES
-----
- package.json ... Electron app manifest (start script included)
- main.js ........ Electron main process: creates the window and
                   loads the web app from the parent folder

NOTES
-----
- No API keys are required for the desktop build either.
- localStorage works the same in Electron, so settings, favorites,
  username, theme and roast history all persist.
- The service worker is a browser feature; the desktop build loads
  from disk and does not need it. Everything else, including the
  radar, hourly chart and local AI, works identically.
