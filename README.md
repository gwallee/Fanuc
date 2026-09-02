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

- **Bulk import** — **Import all N programs** reads them four at a time rather than firing every request at once, renders after each one so the chips fill in green as they land (amber while in flight), and shows a progress bar with a **Stop**. The library re-analysis and the localStorage write happen once at the end instead of once per program, which is most of the wall clock on a 57-program controller
- **Robot by IP** — reads the program list, any `.LS`, live register values (`NUMREG.VA`), and I/O configuration (`DIOCFGSV.IO`). Tries the controller web server (`http://<robot-ip>/MD/`) first and falls back to FTP automatically, so either protocol being enabled is enough. Optional FTP credentials (default anonymous).
- **Safe upload over FTP** — sending a `.LS` to the controller triggers LS→TP translation, and a translation error makes the controller **delete the program**. The bridge makes that impossible to lose work to: it snapshots the robot's current version first, uploads, reads the file back to verify it survived, and if it's gone it **auto-restores the snapshot** — then the UI keeps your editor open so the fix is one keystroke away. Snapshots land in `backups/pre-upload/`.
- **Backups** — one click pulls every file off `MD:` into `backups/<robot-name-or-ip>_<YYYY-MM-DD>_<NN>/`; `NN` auto-increments for same-day backups, and the robot name is read from the controller when available. **Quick backup** grabs only `.LS` + `.VA` (folder suffixed `_quick`) — fast, ideal right before making changes.
- **Local directory by path** — point at a backup folder; every `.LS` loads into the library (plus `NUMREG.VA`/`DIOCFGSV.IO` label data if present), and edits can be saved back to disk.
- **Phone access** — run the bridge on a shop-floor PC and open `http://<that-pc-ip>:8642` from your phone on the same network: full app, live robot data.

Want a double-click desktop install later? Wrap this same code in Electron/Tauri — no rewrite needed.

## What it does

### View
- Multi-program library with syntax highlighting, header attributes, parsed `/POS` position tables (Cartesian + joint, multi-group), drag-and-drop import, localStorage persistence, `.LS` export
- **Code text size** (`−  13px  +` on the Code tab's toolbar, 11–21px) scales the program text only — the viewer, the editor, and both diff views — leaving the surrounding interface at a fixed size. Click the middle button to reset. Line-number gutters are sized in `em`, so they stay proportional as the text grows. Remembered between sessions
- **Phone / tablet**: below 760px the program library becomes an off-canvas drawer behind ☰ (tap a program, the backdrop, or Escape to close), and the header collapses to that toggle plus the build tag — the file pickers are desktop-only, since the drawer already has robot IP and bridge folder path. The code text size control stays on the Code tab, where a phone actually wants it. Open `http://<bridge-pc-ip>:8642` from any device on the same network

### Edit
- Full-source editor per program, syntax-highlighted and filling the tab: **Save to library** re-parses and refreshes every view and re-runs all checks; for programs opened from a directory via the bridge, **Save to library + disk** writes the file back
- **Save + send to robot** uploads over FTP with the snapshot/verify/auto-restore safety net; if the checks find errors that would fail translation, it warns before sending
- ON in green, OFF in red, comments recognized, full syntax highlighting in viewer and search results

### Find in files
- The Search tab greps every line of every program, grouped by program, with match-case / whole-word / regex options
- An item query is recognised from the type and index alone, so it works before you finish typing: `R[40`, `R[40:`, `R[40]` and `R[40:box count]` are all searches for register 40, and each excludes `PR[40]`, `AR[40]`, `SR[40]` and `R[400]`. The type guard is the point — R, PR, AR and SR all end in `R`, so a plain substring can never separate them (`PR[40:box base]` literally *contains* `R[40:box base]`). Anything after the colon narrows by label, matched anywhere inside it, so `R[40:box` finds `R[40:box count]`. Padding is tolerated: `R[ 40 ]` works, and `PR[20,1]` component references count as uses of `PR[20]`
- The library filter (sidebar) ANDs multiple words against the program name *and* its comment, in any order — `set task` finds both `_SET_TASK` and `_TASK_SETUP`
- **Occurrence highlighting** — select text and every other instance lights up, in the code viewer *and* in the editor. Selecting inside an item reference matches the item rather than the literal text, so selecting `R[1]` also lights up `R[1:part count]`, and `PR[6]` catches `PR[6,1]`. Needs the CSS Custom Highlight API; on a browser without it the feature is simply off
- **Ctrl+E** (Studio 5000 habit): select anything — in the viewer or the editor — and Ctrl+E cross-references it library-wide; **double-clicking** a register or I/O token in the Code view does the same. It is a double-click deliberately: on a single click it fired while you were only placing the caret. Single-clicking a `CALL`ed program name still opens that program

### Side-by-side
- **Side-by-side** button (or drag a program from the library onto the right half of the code view) opens two programs next to each other, each with its own program selector — Notepad++ split-view style
- **Compare A↔B** jumps straight from the split into a line diff of the two panes

### Compare (diff)
- **Two programs**: pick any two library programs and get a green/red unified diff (Notepad++ Compare-plugin style)
- **Against a backup**: load a baseline — **Browse for a backup folder…** (your file manager's folder picker, no bridge needed), pick individual `.LS` files, or type a folder path on the bridge PC — and see everything that changed: changed / new / missing / header-only / identical, with per-program line diffs
- Header-only differences (dates, sizes the controller rewrites on every touch) are classified separately so real code changes stand out
- **Ignore line numbers** (on by default): every `/MN` line is written `12:  <instruction> ;`, so inserting or deleting one line renumbers every line below it and a one-line edit otherwise reads as though the whole rest of the program changed. The leading number is skipped when comparing, leaving just the real edit highlighted; a pure renumber with no content change is classified as no code change at all. Both sides still *display* their own real line numbers
- **Ignore inline I/O state** (on by default): with the controller's I/O-status display enabled, a listing reads `DO[65:OFF:Vac-1 ON]` where the file itself says `DO[65:Vac-1 ON]`. That injected field is live machine state, not program content, so it is skipped when comparing — otherwise every such line reads as changed against a backup taken with the display off. Only the field immediately after the index is dropped, and only when a comment follows it, so a real comment (even one ending in `ON`) is never touched. Both sides still *display* exactly what they contain

### Check (Checks tab)
Static analysis across the whole library — comment lines (`!…`) never count as uses:
- **error** — `JMP`/`TIMEOUT`/`Skip` to a `LBL[n]` that is never defined (INTP-267 at runtime); duplicate label definitions
- **warn** — unlabeled registers, position registers, or I/O points used on active lines; `CALL` to a program not in the library; unreachable code after an unconditional `JMP`/`END`/`ABORT`; **handshake without motion** — `DO[n]=ON` answered by a `WAIT` on an input with no move between them (the robot sits idle for the whole round-trip; motion, `CALL`/`RUN`, or a label between them clears the check)
- **info** — labels nothing jumps to; registers read but never written; **registers/I-O labeled on the controller but never used in any program** (fed by `NUMREG.VA` / `DIOCFGSV.IO` from the connected robot or an opened backup folder)

The Checks tab count updates live as you edit.

### Understand
- **Summary** — per-program narrative, motion/I-O/register stats, loop detection
- **Flow tab** —
  - *Control flow graph* (first): the selected program split into blocks with drawn jump arrows — amber up = loop, blue down = skip ahead, dashed = conditional; jumps to missing labels flagged on the block. **Click a block to isolate it**: only the arrows into and out of it stay drawn, the blocks they connect stay lit, and everything else dims — the way to follow one jump through a program with a hundred of them. Click it again, or **Show all**, to bring the rest back; **Go to code** on each block opens that line in the Code tab.
  - *Call order*: the sequence programs actually run in (`1 → 1.1 → 1.2 → 1.2.1 …`), with call-site line numbers, loop annotations, recursion and missing-program flags
- **Cross-reference** — every `R[]`, `PR[]`, I/O point, and `TIMER[]` across the library with clickable read/write references
- **Robot tab** — the first tab, and the only one that works with an empty library. Controller log exports (`ERRALL.LS`, `HIST.LS`, `LOGBOOK.LS`…) carry a `.LS` extension but have no `/PROG` header, so they are kept out of the program list instead of sitting there as chips that cannot be imported — they are named underneath instead. Any other file that turns out to have no `/PROG` header is remembered for the rest of the connection and drops out of the list too. Live register values with search/filter (matched against where each register is used in code), filterable I/O configuration
- **Scan** — sweeps an address range (capped at a /22) for controllers and adds every one it finds to the saved list. A /24 takes about 4 seconds; the traffic is a TCP connect per address, well under 100 KB in total. An open port 80 is *not* enough to be saved — the device has to serve the robot's `MD:` device (`SUMMARY.DG` with FANUC identity fields, or a directory listing with real robot files), so a printer or a switch answering on 80 is only counted, never added. The range is prefilled from the bridge PC's own interfaces, ranked — wired first, then wireless, with hypervisor host-only adapters (VMware, Hyper-V) and VPN overlays (Tailscale, WireGuard) last, since nothing but that PC and its VMs lives on those. The other interfaces sit beside the box as one-click buttons, because only the person at the machine knows which network the controllers are actually on; an interface whose real mask is wider than a /22 offers the /24 around the PC instead of a range the scan would refuse. It is a button and never automatic: a subnet sweep looks like a port scan to an IDS, so run it knowing what network you are on
- **Robot picker (sidebar)** — the Sources block lists the bridge's saved robots by name with a live status dot (● answering, ○ not, · checking). Picking one connects and brings its saved FTP user with it; the currently connected robot stays selected, so every tab shows which controller you are looking at — which matters most in Compare, where a diff against the wrong robot looks perfectly plausible. A new IP, an FTP password, or a subnet scan live on the Robot tab, one entry down the list. This replaced a plain IP text box that could not carry FTP credentials at all
- **Live pendant (iPendant)** — buttons on the Robot tab that open the controller's own pendant UI: the full iPendant, a display-only mirror, or the soft operator panel. This is the only way to reach screens the controller never exports as a file — **Execution History** above all, whose trace buffer lives in controller memory and appears in no backup, no `MD:` file and no system variable (checked: 300 files in a full backup, no FlexUI page, and `$PGTRACE_UP` is display config only). Each opens in its own window rather than an inline frame: framing was tried and the pendant sticks on “Logging in to controller” forever, because its login needs a top-level context. Two caveats — the window talks straight to the robot, so the *browser's* device must be able to reach it (fine on the plant network, not over a VPN that only reaches the bridge); and opening one registers an interactive login on the controller (`TPIF-137`), so use the pendant's own Logout button when done
- **Program state (`PRGSTATE.DG`)** — read on demand from the Robot tab: which tasks exist, their state (RUNNING / PAUSED / ABORTED), where each one is, and its routine stack. A controller refuses to overwrite a program that has a live task, and **a PAUSED task is still live — only ABORT releases it**. Every program on a live task's stack is held, not just the one the cursor is in, so an edit can be refused for a program that looks idle: if `_PL_RACK` is paused and `__AUTO` called it, both are locked. The section lists exactly which programs are held and by which task, plus a per-program table with `Task:` and `Protection:` for all 85-odd programs on the controller. Read on demand rather than on connect, since the file is large and only matters when an edit is being refused
- **Saved robots** — every controller you connect to or find by scanning is remembered (name read from `SUMMARY.DG`, address, when it was last seen). Click one to reconnect; a short TCP probe of port 80 shows a live dot for which are answering right now, and ✕ forgets one. The list lives on the bridge in `robots.json`, so every device pointed at that bridge sees the same robots. **FTP passwords are never stored** — the username comes back with the entry, the password is typed each time

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
js/explain.js     instruction → plain-English rules (unit-tested; not wired
                  into the UI since the per-line Explain toggle was removed)
js/vaparse.js     NUMREG.VA / POSREG.VA / DIOCFGSV.IO / IOSTATE.DG /
                  ERRALL.LS / PRGSTATE.DG parsing
js/app.js         UI
robots.json       saved robots, written by the bridge (gitignored)
samples/          demo cell used as test fixtures: MAIN, PICK, PLACE,
                  GRIPPER, PALLET (not shipped in the release)
test/run-tests.js      unit tests:         node test/run-tests.js
test/server-tests.js   bridge integration: node test/server-tests.js
                       (runs against a mock FANUC FTP controller, including
                       the translation-failure → auto-restore path)
```

## File format notes

Targets the ASCII `.LS` listing format from controller ASCII backups and ROBOGUIDE. Binary `.TP` files are not parsed — export ASCII listings (or convert in ROBOGUIDE) first. Robot access uses the controller's built-in web server (MD: device over HTTP); FTP is not required.
