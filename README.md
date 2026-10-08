# FANUC TP Program Studio

A web application for **viewing, editing, checking, and understanding FANUC robot teach pendant programs** (`.LS` ASCII listings) — offline from files, or live from a robot by IP.

## Two ways to run it — one codebase

**Browser-only (offline files, any device):**

```
open index.html          # no build, no dependencies
```

Import `.LS` files, drag-and-drop, or **Import folder** to pull in a whole backup directory. Works on a phone browser too.

**Bridge mode (live robot + local directories by path):**

Windows: double-click **`Start FANUC Studio.bat`** — it starts the bridge and opens the app (needs Node.js LTS from nodejs.org installed once). For a desktop shortcut, point it at the .bat and set its icon to **`FANUC Studio.ico`** (right-click the shortcut → Properties → Change Icon → Browse). macOS/Linux: `./start.sh`. Or by hand:

```
node server.js           # zero dependencies; then open http://localhost:8642
```

The bridge serves this same app and adds what a browser alone cannot do — browsers can't reach a FANUC controller directly (plain HTTP/FTP, no CORS), so the bridge proxies for them:

- **Bulk import** — **Import all N programs** reads them four at a time rather than firing every request at once, renders after each one so the chips fill in green as they land (amber while in flight), and shows a progress bar with a **Stop**. The library re-analysis and the localStorage write happen once at the end instead of once per program, which is most of the wall clock on a 57-program controller
- **Robot by IP** — reads the program list, any `.LS`, live register values (`NUMREG.VA`), string registers (`STRREG.VA`), and I/O configuration (`DIOCFGSV.IO`). Tries the controller web server (`http://<robot-ip>/MD/`) first and falls back to FTP automatically, so either protocol being enabled is enough. Optional FTP credentials (default anonymous).
- **Safe upload over FTP** — sending a `.LS` to the controller triggers LS→TP translation, and a translation error makes the controller **delete the program**. The bridge makes that impossible to lose work to: it snapshots the robot's current version first, uploads, reads the file back to verify it survived, and if it's gone it **auto-restores the snapshot** — then the UI keeps your editor open so the fix is one keystroke away. Snapshots land in `backups/pre-upload/`.
- **Rename registers and I/O in place** — the Robot tab's tables are editable: type over a name, leave the field, and the controller has it. A register's *name is its comment* (`R[1:Task ID]` is `R[1]` plus the comment held in the controller's own table, which every listing is generated from), so renaming means writing that comment. The bridge writes it the way the robot's own comment page does — a plain `GET /karel/ComSet?sComment=…&sIndx=…&sFc=…`, with the function codes read off that page's own script rather than guessed — then **re-reads the file and reports what the controller actually stored**, so a rename is proven rather than assumed. Saving on blur matches the pendant page's own behavior; Enter commits, Escape puts the old name back, and a field you only tab through sends nothing. Covers `R[]`, `PR[]`, `SR[]` and every I/O type the controller's comment tool offers (`DI`/`DO`, `RI`/`RO`, `GI`/`GO`, `AI`/`AO`, flags); `UI`, `UO`, `SI`, `SO` have no comment write on the controller at all and stay read-only, as does anything loaded from a backup folder — there is no controller there to write to. Names are checked before they go anywhere: the controller's own length cap (16 characters for registers, 24 for I/O), printable ASCII only, and no quotes or brackets, since the controller writes the comment back out inside both
- **Backups** — both kinds live on the saved-robots rows. **Quick backup** on a row grabs `.LS` + `.VA` from that robot right now (folder suffixed `_quick`) — fast, ideal right before making changes, no connecting needed. Full backups run as the sweep below. Every backup lands in a dated folder `<robot-name-or-ip>_<YYYY-MM-DD>_<NN>/`; `NN` auto-increments for same-day backups (per destination folder, so a robot's own folder keeps its own numbering), and the robot name is read from the controller when available.

- **Back up every robot to the server, in one sweep** — the replacement for a batch script per robot. Tick the robots in the saved list and **Backup N robots (full)** walks them one at a time, streaming progress: which controller it is on, how many of its files have landed, and a per-robot result on that robot's own row. A controller that is not answering is **skipped after three seconds** with the reason on its row, so a powered-down cell cannot stall the rest of the plant; everything that did answer still gets its backup. Every destination folder is checked for writability *before* the first controller is touched — a share that is down costs nothing instead of being discovered eight transfers in. A completed backup refreshes that robot's *last seen*, and fills in a name for a robot a scan found before it would say what it was called.

- **A folder per robot, set once** — each robot's backups go where that cell belongs on the server (`S:\827-039 Wire Stripper Assembly\Robot`): click the folder button on its row and the bridge remembers it. A robot without a folder yet files under the bridge's own `backups\` directory, and its button reads **set folder…** until it has one. Folders are stored on the bridge rather than in a browser, for the same reason the robot list is: the path means something on the bridge PC and nothing on a phone pointed at it, and everyone using that bridge should be filing backups in the same place. A path that cannot be written is **refused rather than saved** — a folder that does not work is not a setting, it is a backup that will not happen. A folder that does not exist yet is simply created.

- **Folder picker** — a browser cannot hand a server a filesystem path (a folder input gives file *names*, never a location), and the folders that matter here are the bridge PC's own drives and mapped shares. So the bridge lists its own directories and the picker walks them: drives and recent destinations to start from, click to descend, and a path box that stays typable for pasting a UNC path or naming a folder that isn't there yet. Works the same from a phone, since it is the bridge's filesystem either way.
- **Local directory by path** — point at a backup folder; every `.LS` loads into the library (plus `NUMREG.VA`/`DIOCFGSV.IO` label data if present), and edits can be saved back to disk.
- **Phone access** — run the bridge on a shop-floor PC and open `http://<that-pc-ip>:8642` from your phone on the same network: full app, live robot data. **Phone** in the header shows that address as a QR code — point the phone's camera at the PC screen instead of typing an IP. A plant PC usually has several addresses, so all of them are offered: the Wi-Fi one leads, since that is the network a phone actually joins, and the `/30` point-to-point links to individual controllers are ranked below it (they have room for the PC and one robot, and nothing else). The QR is drawn locally — nothing is sent anywhere to make it.

Want a double-click desktop install later? Wrap this same code in Electron/Tauri — no rewrite needed.

## What it does

### View
- Multi-program library with syntax highlighting, header attributes, parsed `/POS` position tables (Cartesian + joint, multi-group), drag-and-drop import, localStorage persistence, `.LS` export
- **One library per robot** — connecting to a robot switches to that robot's own stored library, so hopping between controllers never means clear + re-import. Uploads and folder loads made with no robot connected live in a **Local files** library. Once a second library exists, a picker above the program list swaps between them without connecting (a robot's programs stay browsable offline); **Clear library** empties only the one showing. An existing single library is migrated by splitting it per origin robot
- A **marker column** left of the line numbers flags lines the checks caught, with the finding printed under the line (see [Check](#check-checks-tab)). It is rendered on every line, empty ones included, so a listing never shifts sideways the moment a program picks up its first finding
- **Code text size** (`−  13px  +` on the Code tab's toolbar, 11–21px) scales the program text only — the viewer, the editor, and both diff views — leaving the surrounding interface at a fixed size. Click the middle button to reset. Line-number gutters are sized in `em`, so they stay proportional as the text grows. Remembered between sessions
- **Phone / tablet**: below 760px the program library becomes an off-canvas drawer behind ☰ (tap a program, the backdrop, or Escape to close), and the header collapses to that toggle plus the build tag — the file pickers are desktop-only, since the drawer already has robot IP and bridge folder path. The code text size control stays on the Code tab, where a phone actually wants it. Open `http://<bridge-pc-ip>:8642` from any device on the same network — or scan the QR behind **Phone** in the bridge PC's header

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
- Each half scrolls **on its own**, so one program can sit on line 40 while the other sits on line 400 — and the longer half still scrolls to its own last line when the other one has run out
- **Sync scroll** (checkbox, off by default) locks the two halves together line for line, for the case where that is the point: two versions of the same program. The setting is remembered
- **Compare A↔B** jumps straight from the split into a line diff of the two panes
- Under 1000px wide the halves stack into one column and the page scrolls as a whole; Sync scroll is hidden there, having nothing left to sync

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

**Seeing a finding where it happened.** The Code view marks every flagged line in the gutter — amber
`▲` for a warning, red `●` for an error, shape as well as colour — and prints the finding underneath the
line as a sentence you can read without leaving the program. Hover a marker for the same text as a
tooltip; click it (or Enter/Space) to fold that note away and back.

- Notes **start folded** — the marker and its tooltip are what the listing owes you by default, since a
  program reads as a program only while its lines stay next to each other. Click a marker for the
  note; that choice is remembered for the session
- One finding often points at **several lines** — the handshake check names both the line that sets the
  output and the line that waits on the input. Every such line gets a marker; the note itself is
  printed once, under the first of them, and any of those markers folds it
- The **`N issues` badge** beside the program name lists the flagged line numbers in its tooltip, and
  clicking it opens the Checks tab **filtered to that program**. So does **All checks for `NAME` →** at the
  foot of any note
- Markers, notes and the badge all respect **Hide**: mute a check in the Checks tab and it stops
  marking up listings too. (The badge used to keep counting checks you had hidden.) Info-level notes
  are never marked in the gutter — they are observations, not things to go and fix

**Filtering the Checks tab.** The **program picker** in the tab's toolbar narrows every group to the
findings that touch one program; `showing only NAME ✕` clears it. While filtered, a finding's line chips
are that program's lines, with anything elsewhere counted in words (`· 26 more in other programs`) —
otherwise a register read across the whole library spends all twelve chips on other programs and
never shows you the line you came for. The tab's own `Checks (N)` label stays library-wide.

The Checks tab count updates live as you edit.

### Understand
- **Summary** — per-program narrative, motion/I-O/register stats, loop detection
- **Flow tab** —
  - *Control flow graph* (first): a **pan and zoom canvas**, because on a jump-heavy program the arrows only make sense once you can pull back and see the whole shape, then go in close to read. The wheel zooms at the cursor, dragging the background pans (middle-drag works from anywhere, including across a block, so text inside a block stays selectable), shift+wheel scrolls, `Fit` frames the whole program and `1:1` returns to full size. An **overview strip** down the side maps the program with its `LBL` names at true size however far out the canvas is, and its box shows what is on screen — drag it to scrub. Keys: `+` `-` `0` `F`, `C` for layout, `S` for gaps, `Escape` to un-isolate.
    - **Layout** — *column* keeps one stack with the jumps arcing through the gutter; *chart* spreads branches sideways and routes every jump at right angles down a lane of its own. A forward jump means “skip the next few blocks”, so what it skips is a branch body and sits one column right — nested IFs nest further right. Depth counts nesting, not overlap: a chain of IFs produces spans that cross rather than contain each other, and counting every span over a block would march the middle of the program off to the right one step at a time. Only the longest jump out of any one block counts, since a dispatcher with eight `IF…JMP`s is offering eight alternatives, not eight nested branches
    - **Detail** — zooming alone turns the text to mush long before a whole program fits, so the blocks get simpler as you pull back: *every line* (with its real line number), then *headings* — the block's own `!***Appr Conveyor***` banner comment, what it contains (`6 lines · 2 moves · 1 jump`) and what it calls — then *bars*, no text at all, each block a bar whose height is its line count. `auto` swaps them as you zoom. Fitting and auto-detail chase each other (a coarser tier fits, which raises the zoom, which asks for finer detail again), so `Fit` solves it as a fixed point rather than oscillating
    - **Gaps** — room between the blocks and between the arrow lanes; wider pulls a knot of overlapping jumps apart without changing the size of the text. Lanes are handed out by interval colouring, so two jumps share one only when their spans do not overlap, and each gutter is sized to the deepest pile-up that has to fit in it
    - **Arrows** — amber up = loop, blue down = skip ahead, dashed = conditional; jumps to a missing label are flagged on the block. **Hover an arrow** and it is the only one drawn solid, with the blocks at both ends outlined — which is the whole question a loop arrow raises. Arrowheads are sized independently of the line, so a highlighted arrow does not wear a head several times the size of a plain one
    - **Click a block to isolate it**: only the arrows into and out of it stay drawn, the blocks they connect stay lit, everything else dims — the way to follow one jump through a program with a hundred of them. Click again, `Escape`, or **Show all** brings the rest back. Isolating happens in place, so the zoom and pan stay where you left them
    - At *every line* each block also lists **where control arrives from** (`from ↷ 80 ↷ 85`), the answer to “how does it even reach this line”; click a source to open that jump in the Code tab. **↗** on a block, or any line, opens the Code tab there — aimed at the first line that actually says something, since a block often starts on the blank line above its label. A **→ chip** opens the program it calls, one chip per program rather than one per `CALL`, counted (`→ _SET_OFFS ×2`)
    - Blank lines and comments form no blocks of their own: a blank run is dropped, and a header comment attaches to the block it captions, so `!***Pick Up Box***` on line 88 belongs to `LBL[500]` on 89 rather than to an empty box above it. A block with no label is titled by its line range in plain weight — bold means the section has a real name
    - **Hide library** gives the graph the whole window. It applies to this tab alone: the chart runs two to three thousand pixels wide, so the 250px library is the difference between reading the graph and panning constantly, but the library is how a program gets picked everywhere else, so Code, Search and the rest keep it. Layout, detail, gaps, the overview and this are all remembered between sessions. The viewport's bottom-right corner drags to make the graph taller; on a phone the overview strip drops so the canvas gets the width
  - *Call order*: the sequence programs actually run in (`1 → 1.1 → 1.2 → 1.2.1 …`), with call-site line numbers, loop annotations, recursion and missing-program flags
- **Cross-reference** — every `R[]`, `PR[]`, I/O point, and `TIMER[]` across the library with clickable read/write references
- **Robot tab** — the first tab, and the only one that works with an empty library. Controller log and diagnostic exports (`ERRALL.LS`, `HIST.LS`, `LOGBOOK.LS`, `UPDTLOG.LS`, `VTRNDIAG.LS`…) carry a `.LS` extension but have no `/PROG` header, so they are kept out of the program list instead of sitting there as chips that cannot be imported — they are named underneath instead. Any other file that turns out to have no `/PROG` header is remembered for the rest of the connection and drops out of the list too. Live register values with search/filter (matched against where each register is used in code), string registers, filterable I/O configuration — and every name in those tables can be typed over to rename it on the controller
- **Scan** — sweeps an address range (capped at a /22) for controllers and adds every one it finds to the saved list. A /24 takes about 4 seconds; the traffic is a TCP connect per address, well under 100 KB in total. An open port 80 is *not* enough to be saved — the device has to serve the robot's `MD:` device (`SUMMARY.DG` with FANUC identity fields, or a directory listing with real robot files), so a printer or a switch answering on 80 is only counted, never added. The range is prefilled from the bridge PC's own interfaces, ranked — wired first, then wireless, with hypervisor host-only adapters (VMware, Hyper-V) and VPN overlays (Tailscale, WireGuard) last, since nothing but that PC and its VMs lives on those. The other interfaces sit beside the box as one-click buttons, because only the person at the machine knows which network the controllers are actually on; an interface whose real mask is wider than a /22 offers the /24 around the PC instead of a range the scan would refuse. It is a button and never automatic: a subnet sweep looks like a port scan to an IDS, so run it knowing what network you are on
- **Robot picker (sidebar)** — the Sources block lists the bridge's saved robots by name with a live status dot (● answering, ○ not, · checking). Picking one connects and brings its saved FTP user with it; the currently connected robot stays selected, so every tab shows which controller you are looking at — which matters most in Compare, where a diff against the wrong robot looks perfectly plausible. A new IP, an FTP password, or a subnet scan live on the Robot tab, one entry down the list. This replaced a plain IP text box that could not carry FTP credentials at all
- **Live pendant (iPendant)** — buttons on the Robot tab that open the controller's own pendant UI: the full iPendant, a display-only mirror, or the soft operator panel. This is the only way to reach screens the controller never exports as a file — **Execution History** above all, whose trace buffer lives in controller memory and appears in no backup, no `MD:` file and no system variable (checked: 300 files in a full backup, no FlexUI page, and `$PGTRACE_UP` is display config only). Each opens in its own window rather than an inline frame: framing was tried and the pendant sticks on “Logging in to controller” forever, because its login needs a top-level context. Two caveats — the window talks straight to the robot, so the *browser's* device must be able to reach it (fine on the plant network, not over a VPN that only reaches the bridge); and opening one registers an interactive login on the controller (`TPIF-137`), so use the pendant's own Logout button when done
- **Program state (`PRGSTATE.DG`)** — read on demand from the Robot tab: which tasks exist, their state (RUNNING / PAUSED / ABORTED), where each one is, and its routine stack. A controller refuses to overwrite a program that has a live task, and **a PAUSED task is still live — only ABORT releases it**. Every program on a live task's stack is held, not just the one the cursor is in, so an edit can be refused for a program that looks idle: if `_PL_RACK` is paused and `__AUTO` called it, both are locked. The section lists exactly which programs are held and by which task, plus a per-program table with `Task:` and `Protection:` for all 85-odd programs on the controller. Read on demand rather than on connect, since the file is large and only matters when an edit is being refused
- **Saved robots** — every controller you connect to or find by scanning is remembered (name read from `SUMMARY.DG`, address, when it was last seen). Click a name to connect; a short TCP probe of port 80 shows a live dot for which are answering right now, and ✕ forgets one. The list lives on the bridge in `robots.json`, so every device pointed at that bridge sees the same robots. **FTP passwords are never stored** — the username comes back with the entry, the password is typed each time. The backups live on the same rows: **Quick backup** on a row pulls `.LS` + `.VA` from that one robot immediately, and for full backups tick the robots to include (everything answering is in by default) and **Backup N robots (full)** walks the list one controller at a time — each into its own folder (set from the row's folder button; unset robots file under the bridge's `backups\`), skipping anything powered down after three seconds

## Repository layout

```
index.html        app shell
server.js         bridge server (robot HTTP/FTP proxy, safe upload, backups,
                  directory access) — zero deps
lib/ftp.js        minimal FTP client (passive mode, zero deps)
lib/comset.js     renaming registers/I-O on the controller: the ComSet function
                  codes, the length/character rules, and the read-back check
css/app.css       styling (light/dark aware)
js/parser.js      .LS parser (header, /ATTR, /MN, /POS)
js/analyzer.js    per-program + library analysis (xref, call graph, labels)
js/linter.js      static checks
js/flow.js        control-flow blocks/edges + call-order computation
js/diff.js        line diff + program-set comparison
js/explain.js     instruction → plain-English rules (unit-tested; not wired
                  into the UI since the per-line Explain toggle was removed)
js/vaparse.js     NUMREG.VA / POSREG.VA / STRREG.VA / DIOCFGSV.IO / IOSTATE.DG /
                  ERRALL.LS / PRGSTATE.DG parsing
js/qr.js          QR encoder for the "open on your phone" code (byte mode,
                  level M, versions 1-10) — zero deps
js/app.js         UI
robots.json       saved robots — address, name, FTP user, and each robot's
                  own backup folder. Written by the bridge (gitignored)
settings.json     bridge settings: the default backup folder
                  (gitignored; absent until one is set)
samples/          demo cell used as test fixtures: MAIN, PICK, PLACE,
                  GRIPPER, PALLET (not shipped in the release)
test/run-tests.js      unit tests:         node test/run-tests.js
test/server-tests.js   bridge integration: node test/server-tests.js
                       (runs against a mock FANUC FTP controller, including
                       the translation-failure → auto-restore path)
test/backup-tests.js   backups:            node test/backup-tests.js
                       (default and per-robot folders, folder browsing,
                       and the multi-robot sweep, end to end over FTP)
test/mock-ftp.js       the mock controller both integration tests drive
```

`FANUC_STUDIO_STATE` moves `robots.json` / `settings.json` / the default
`backups/` somewhere other than beside the bridge. `test/backup-tests.js`
uses it so a test run cannot write over the robot list someone is using.

## File format notes

Targets the ASCII `.LS` listing format from controller ASCII backups and ROBOGUIDE. Binary `.TP` files are not parsed — export ASCII listings (or convert in ROBOGUIDE) first. Robot access uses the controller's built-in web server (MD: device over HTTP); FTP is not required.
