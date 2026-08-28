#!/bin/sh
# FANUC TP Program Studio launcher (macOS / Linux). Windows: use "Start FANUC Studio.bat".
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js is required — https://nodejs.org"; exit 1; }
( sleep 1; command -v open >/dev/null 2>&1 && open http://localhost:8642 || xdg-open http://localhost:8642 ) &
exec node server.js
