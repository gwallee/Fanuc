# FANUC TP Program Studio

A web application for **viewing, editing, checking, and understanding FANUC robot teach pendant programs** (`.LS` ASCII listings) — offline from files, or live from a robot by IP.

## Two ways to run it — one codebase

**Browser-only (offline files, any device):**

```
open index.html          # no build, no dependencies
```

Import `.LS` files, drag-and-drop, or **Open folder** to import a whole backup directory. Works on a phone browser too.

**Bridge mode (live robot + local directories by path):**

```
node server.js           # zero dependencies; then open http://localhost:8642
```

The bridge serves this same app and adds what a browser alone cannot do — browsers can't reach a FANUC controller directly (plain HTTP/FTP, no CORS), so the bridge proxies for them:

- **Robot by IP** — reads the program list, any `.LS`, live register values (`NUMREG.VA`), and I/O configuration (`DIOCFGSV.IO`) from the controller's web server (`http://<robot-ip>/MD/`). Enable HTTP on the controller under *MENU → SETUP → Host Comm*. The bridge **only ever reads** from robots — writing to a controller is deliberately not supported.
- **Local directory by path** — point at a backup folder; every `.LS` in it (3 levels deep) loads into the library, and edits can be saved back to disk.
- **Phone access** — run the bridge on a shop-floor PC and open `http://<that-pc-ip>:8642` from your phone on the same network: full app, live robot data.

Want a double-click desktop install later? Wrap this same code in Electron/Tauri — no rewrite needed.

## What it does

### View
- Multi-program library with syntax highlighting, header attributes, parsed `/POS` position tables (Cartesian + joint, multi-group), drag-and-drop import, localStorage persistence, `.LS` export

### Edit
- Full-source editor per program: **Save to library** re-parses and refreshes every view and re-runs all checks; for programs opened from a directory via the bridge, **Save to library + disk** writes the file back
- Robot-sourced programs stay read-only toward the controller: edit in the library, export, and load via the pendant after review

### Check (Checks tab)
Static analysis across the whole library — comment lines (`!…`) never count as uses:
- **error** — `JMP`/`TIMEOUT`/`Skip` to a `LBL[n]` that is never defined (INTP-267 at runtime); duplicate label definitions
- **warn** — unlabeled registers, position registers, or I/O points used on active lines; `CALL` to a program not in the library; unreachable code after an unconditional `JMP`/`END`/`ABORT`
- **info** — labels nothing jumps to; registers read but never written

The Checks tab count updates live as you edit.

### Understand
- **Explain mode** — plain-English annotation under every line
- **Summary** — per-program narrative, motion/I-O/register stats, loop detection
- **Flow tab** —
  - *Call order*: the sequence programs actually run in (`1 → 1.1 → 1.2 → 1.2.1 …`), with call-site line numbers, loop annotations, recursion and missing-program flags
  - *Control flow graph*: the selected program split into blocks with drawn jump arrows — amber up = loop, blue down = skip ahead, dashed = conditional; jumps to missing labels flagged on the block
- **Cross-reference** — every `R[]`, `PR[]`, I/O point, and `TIMER[]` across the library with clickable read/write references
- **Robot tab** — live register values with search/filter (matched against where each register is used in code), filterable I/O configuration

## Repository layout

```
index.html        app shell
server.js         bridge server (robot proxy + directory access), zero deps
css/app.css       styling (light/dark aware)
js/parser.js      .LS parser (header, /ATTR, /MN, /POS)
js/analyzer.js    per-program + library analysis (xref, call graph, labels)
js/linter.js      static checks
js/flow.js        control-flow blocks/edges + call-order computation
js/explain.js     instruction → plain-English rules
js/vaparse.js     NUMREG.VA / raw variable-file parsing
js/app.js         UI
samples/          demo cell: MAIN, PICK, PLACE, GRIPPER, PALLET
test/run-tests.js test suite — run with:  node test/run-tests.js
tools/build-samples.js  regenerates js/samples.js from samples/
```

## File format notes

Targets the ASCII `.LS` listing format from controller ASCII backups and ROBOGUIDE. Binary `.TP` files are not parsed — export ASCII listings (or convert in ROBOGUIDE) first. Robot access uses the controller's built-in web server (MD: device over HTTP); FTP is not required.
