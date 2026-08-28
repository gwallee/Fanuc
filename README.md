# FANUC TP Program Studio

A web application for **viewing, editing, checking, and understanding FANUC robot teach pendant programs** (`.LS` ASCII listings) — offline from files, or live from a robot by IP.

## Two ways to run it — one codebase

**Browser-only (offline files, any device):**

```
open index.html          # no build, no dependencies
```

Import `.LS` files, drag-and-drop, or **Open folder** to import a whole backup directory. Works on a phone browser too.

**Bridge mode (live robot + local directories by path):**

Windows: double-click **`Start FANUC Studio.bat`** — it starts the bridge and opens the app (needs Node.js LTS from nodejs.org installed once). macOS/Linux: `./start.sh`. Or by hand:

```
node server.js           # zero dependencies; then open http://localhost:8642
```

The bridge serves this same app and adds what a browser alone cannot do — browsers can't reach a FANUC controller directly (plain HTTP/FTP, no CORS), so the bridge proxies for them:

- **Robot by IP** — reads the program list, any `.LS`, live register values (`NUMREG.VA`), and I/O configuration (`DIOCFGSV.IO`). Tries the controller web server (`http://<robot-ip>/MD/`) first and falls back to FTP automatically, so either protocol being enabled is enough. Optional FTP credentials (default anonymous).
- **Safe upload over FTP** — sending a `.LS` to the controller triggers LS→TP translation, and a translation error makes the controller **delete the program**. The bridge makes that impossible to lose work to: it snapshots the robot's current version first, uploads, reads the file back to verify it survived, and if it's gone it **auto-restores the snapshot** — then the UI keeps your editor open so the fix is one keystroke away. Snapshots land in `backups/pre-upload/`.
- **Backups** — one click pulls every file off `MD:` into `backups/<robot-name-or-ip>_<YYYY-MM-DD>_<NN>/`; `NN` auto-increments for same-day backups, and the robot name is read from the controller when available. **Quick backup** grabs only `.LS` + `.VA` (folder suffixed `_quick`) — fast, ideal right before making changes.
- **Local directory by path** — point at a backup folder; every `.LS` loads into the library (plus `NUMREG.VA`/`DIOCFGSV.IO` label data if present), and edits can be saved back to disk.
- **Phone access** — run the bridge on a shop-floor PC and open `http://<that-pc-ip>:8642` from your phone on the same network: full app, live robot data.

Want a double-click desktop install later? Wrap this same code in Electron/Tauri — no rewrite needed.

## What it does

### View
- Multi-program library with syntax highlighting, header attributes, parsed `/POS` position tables (Cartesian + joint, multi-group), drag-and-drop import, localStorage persistence, `.LS` export

### Edit
- Full-source editor per program: **Save to library** re-parses and refreshes every view and re-runs all checks; for programs opened from a directory via the bridge, **Save to library + disk** writes the file back
- **Save + send to robot** uploads over FTP with the snapshot/verify/auto-restore safety net; if the checks find errors that would fail translation, it warns before sending
- ON in green, OFF in red, comments recognized, full syntax highlighting in viewer and search results

### Find in files
- The Search tab greps every line of every program, grouped by program, with match-case / whole-word / regex options
- An item query like `R[10]` or `DO[104]` also matches its labeled form (`R[10:pallet slot]`)
- **Ctrl+E** (Studio 5000 habit): select anything — in the viewer or the editor — and Ctrl+E cross-references it library-wide; clicking any register/I-O token in the Code view does the same
- Click a `CALL`ed program name to open it (open-selection)

### Side-by-side
- **Side-by-side** button (or drag a program from the library onto the right half of the code view) opens two programs next to each other, each with its own program selector — Notepad++ split-view style
- **Compare A↔B** jumps straight from the split into a line diff of the two panes

### Compare (diff)
- **Two programs**: pick any two library programs and get a green/red unified diff (Notepad++ Compare-plugin style)
- **Against a backup**: load a baseline (backup folder path via the bridge, or pick `.LS` files anywhere) and see everything that changed: changed / new / missing / header-only / identical, with per-program line diffs
- Header-only differences (dates, sizes the controller rewrites on every touch) are classified separately so real code changes stand out

### Check (Checks tab)
Static analysis across the whole library — comment lines (`!…`) never count as uses:
- **error** — `JMP`/`TIMEOUT`/`Skip` to a `LBL[n]` that is never defined (INTP-267 at runtime); duplicate label definitions
- **warn** — unlabeled registers, position registers, or I/O points used on active lines; `CALL` to a program not in the library; unreachable code after an unconditional `JMP`/`END`/`ABORT`; **handshake without motion** — `DO[n]=ON` answered by a `WAIT` on an input with no move between them (the robot sits idle for the whole round-trip; motion, `CALL`/`RUN`, or a label between them clears the check)
- **info** — labels nothing jumps to; registers read but never written; **registers/I-O labeled on the controller but never used in any program** (fed by `NUMREG.VA` / `DIOCFGSV.IO` from the connected robot or an opened backup folder)

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
server.js         bridge server (robot HTTP/FTP proxy, safe upload, backups,
                  directory access) — zero deps
lib/ftp.js        minimal FTP client (passive mode, zero deps)
css/app.css       styling (light/dark aware)
js/parser.js      .LS parser (header, /ATTR, /MN, /POS)
js/analyzer.js    per-program + library analysis (xref, call graph, labels)
js/linter.js      static checks
js/flow.js        control-flow blocks/edges + call-order computation
js/diff.js        line diff + program-set comparison
js/explain.js     instruction → plain-English rules
js/vaparse.js     NUMREG.VA / DIOCFGSV.IO parsing
js/app.js         UI
samples/          demo cell: MAIN, PICK, PLACE, GRIPPER, PALLET
test/run-tests.js      unit tests:         node test/run-tests.js
test/server-tests.js   bridge integration: node test/server-tests.js
                       (runs against a mock FANUC FTP controller, including
                       the translation-failure → auto-restore path)
tools/build-samples.js regenerates js/samples.js from samples/
```

## File format notes

Targets the ASCII `.LS` listing format from controller ASCII backups and ROBOGUIDE. Binary `.TP` files are not parsed — export ASCII listings (or convert in ROBOGUIDE) first. Robot access uses the controller's built-in web server (MD: device over HTTP); FTP is not required.
