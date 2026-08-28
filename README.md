# FANUC TP Program Studio

A zero-install web application for **viewing, understanding, and managing FANUC robot teach pendant programs** (`.LS` ASCII listing files).

## Quick start

No build step, no server, no dependencies. Just open the app:

```
open index.html        # macOS
start index.html       # Windows
xdg-open index.html    # Linux
```

or serve it if you prefer:

```
python3 -m http.server 8080
# then open http://localhost:8080
```

Click **Load sample cell** to explore with the bundled demo programs, or drag your own `.LS` files anywhere onto the window.

## What it does

### View
- Import one or many `.LS` files (drag & drop or file picker)
- Full syntax highlighting: motion instructions, registers, I/O, labels, comments, motion options
- Header/attribute display (owner, comment, create/modify dates, line count, group mask)
- Parsed position data (`/POS` section) shown as a readable table — Cartesian and joint representations, config strings, UF/UT

### Understand
- **Explain mode** — toggleable plain-English annotation under every program line ("Joint move to P[1] at 100% speed, stop exactly at the point", "If R[1] is less than R[2], jump to label 1", …)
- **Program summary** — automatic overview: what the program touches, motion breakdown, loops detected, outputs written, inputs waited on
- **Call graph** — who calls whom, rendered as an expandable tree per program plus callers ("called by") — unresolved calls (programs not in your library) are flagged
- **Cross-reference** — every `R[]`, `PR[]`, `DI/DO/RI/RO/GI/GO/UI/UO/F/M`, `TIMER[]`, and `LBL[]` with the exact lines that read/write it, across the whole library; click any reference to jump to that line

### Manage
- Program library persisted in your browser (localStorage) — survives reloads
- Global search across every line of every program
- Export any program back out as a `.LS` file
- Per-program delete, library-wide clear

## Repository layout

```
index.html        app shell
css/app.css       styling (light/dark aware)
js/parser.js      .LS format parser (header, /ATTR, /MN body, /POS positions)
js/analyzer.js    cross-reference + call graph + summary analysis
js/explain.js     instruction → plain-English rules
js/app.js         UI: library, tabs, rendering, search, import/export
samples/          demo cell: MAIN, PICK, PLACE, GRIPPER, PALLET
test/run-tests.js parser/analyzer sanity tests (run with `node test/run-tests.js`)
```

## File format notes

The parser targets the ASCII `.LS` listing format produced by FANUC controller backups ("ASCII upload") and ROBOGUIDE exports:

- `/PROG name`, `/ATTR key = value;`, `/MN` numbered body lines, `/POS` position blocks, `/END`
- Motion lines (`J`, `L`, `C`, `A`, `S` prefixes) with speed, termination (FINE/CNT), and trailing options
- Mixed-logic and classic register/I-O syntax
- Multi-group positions (`GP1:`, `GP2:`) and joint-format positions

Binary `.TP` files are not parsed — export ASCII listings from the controller (`ASCII PROG` / MD: device) or convert with ROBOGUIDE first.
