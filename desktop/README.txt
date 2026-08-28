What the Wether — Desktop Apps
==============================

The desktop app is the same web app in the repository root, wrapped in
Electron. No API keys, no separate codebase, no build step for the web
side.

GETTING A BUILD
---------------
You do not have to build anything yourself. Push a tag, or click
"Run workflow" on the "Build desktop apps" action, and GitHub builds
all three platforms and attaches them to a release:

    git tag v13.0.0 && git push origin v13.0.0

That produces:

  Windows   WhatTheWether-Setup-13.0.0.exe      installer, adds Start Menu
                                                and desktop shortcuts
            WhatTheWether-Portable-13.0.0.exe   single file, no install
  macOS     WhatTheWether-13.0.0-x64.dmg        Intel
            WhatTheWether-13.0.0-arm64.dmg      Apple Silicon
  Linux     WhatTheWether-13.0.0.AppImage       chmod +x and run
            what-the-wether_13.0.0_amd64.deb    sudo apt install ./file.deb
            what-the-wether-13.0.0.rpm          sudo rpm -i file.rpm
            what-the-wether-13.0.0.tar.gz       extract and run

BUILDING LOCALLY
----------------
Requires Node 18+.

    cd desktop
    npm install
    npm start          # run it without packaging
    npm run dist       # build for the platform you are on

Platform-specific:

    npm run dist:win     # Windows  (run on Windows)
    npm run dist:mac     # macOS    (must run on macOS)
    npm run dist:linux   # Linux    (run on Linux)

IMPORTANT: build each platform on that platform. Cross-building a
Windows .exe from Linux needs Wine (both 64- and 32-bit, because the
icon stamper is a 32-bit tool), and a macOS .dmg cannot be produced
off macOS at all. The GitHub workflow exists precisely so you never
have to deal with this.

UNSIGNED BUILDS
---------------
These are not code-signed — signing certificates cost money and none
are stored in this repository. On first launch:

  Windows   SmartScreen shows "Windows protected your PC".
            Click "More info" then "Run anyway".
  macOS     "cannot be opened because the developer cannot be verified".
            Right-click the app, choose Open, then Open again. Or:
            xattr -cr "/Applications/What the Wether.app"
  Linux     No warning. AppImage needs the executable bit:
            chmod +x WhatTheWether-*.AppImage

To sign properly, add your certificate to the workflow as encrypted
secrets and set CSC_LINK / CSC_KEY_PASSWORD (Windows and macOS).

FILES
-----
  package.json   Electron manifest and the full electron-builder config
                 (targets, icons, installer behaviour, package metadata)
  main.js        Main process: window, menu, single-instance lock,
                 external-link handling
  build/         Icons. icon.ico is a real multi-resolution Windows icon
                 (16-256px); icon.png is the master used for macOS and
                 Linux.

NOTES
-----
- No API keys are required for the desktop build.
- localStorage works the same in Electron, so settings, favorites,
  username, theme and roast history all persist.
- The service worker is a browser feature; the desktop build loads from
  disk and does not need it. Everything else, including the radar,
  charts and the local AI, works identically.
