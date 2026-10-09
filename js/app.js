/* FANUC TP Program Studio — UI layer. */
(function () {
  'use strict';

  var P = window.FanucParser, A = window.FanucAnalyzer;
  var L = window.FanucLinter, FL = window.FanucFlow, VA = window.FanucVA, D = window.FanucDiff;
  // TP syntax: the grammar, and the shape dictionary mined from real listings
  // (absent only if js/tpshapes.js was never built — the grammar still runs)
  var TPS = window.FanucSyntax || null, TP_DICT = window.TP_SHAPES || null;
  var STORE_KEY_V1 = 'fanuc-tp-studio.programs.v1';
  var STORE_KEY_V2 = 'fanuc-tp-studio.programs.v2';
  /* v3: one library per robot. Each robot's programs live under their own
   * key (suffix = the robot's IP; 'local' holds uploads and folder loads made
   * with no robot connected), so switching robots swaps libraries instead of
   * forcing a clear + re-import. The active library id is remembered too. */
  var STORE_PREFIX = 'fanuc-tp-studio.programs.v3.';
  var ACTIVE_LIB_KEY = 'fanuc-tp-studio.library.v1';
  var LOCAL_LIB = 'local';

  var state = {
    programs: {},          // NAME -> { parsed, analysis, source, origin }
    library: LOCAL_LIB,    // whose library is loaded: a robot IP, or 'local'
    selected: null,
    tab: 'code',
    editing: false,
    graph: null,
    xref: null,
    findings: [],
    server: false,         // bridge server reachable?
    robotImport: null,     // {total, done, added, skipped, failed, inFlight, cancel} while a bulk import runs
    robot: { ip: '', ftpUser: '', ftpPass: '', files: [], registers: null, strregs: null, rawIO: null, ioComments: null, error: null, loadedAt: null, backup: null, notPrograms: {}, prgState: undefined },
    knownRobots: [],       // saved robots, served by the bridge (never a password)
    robotProbe: {},        // ip -> 'checking' | 'up' | 'down'
    scan: null,            // subnet sweep in progress / its last result
    backupHome: null,      // {backupRoot, isDefault, error} — the bridge's saved home folder
    backupPick: {},        // ip -> bool, which saved robots the next sweep covers
    backupAll: null,       // multi-robot backup in progress / its last result
    subnets: null,         // the bridge PC's own networks, for the default CIDR
    dirExtern: null,       // register/IO label data found in an opened folder
    dirStatus: null,
    compare: null,         // { label, programs: {NAME: source}, results, open: name|null }
    pair: null,            // { a, b } two-program comparison
    split: null,           // program name shown in the right half of the Code view
    syncSplit: false,      // side-by-side: scroll both halves together (persisted)
    upload: null,          // last robot-upload result banner
    flowIgnore: {},        // {NAME: true} utility programs hidden from Flow (persisted)
    hiddenRules: {},       // {rule: true} check rules the user muted (persisted)
    checksOpen: {},        // {rule: bool} transient expand state in the Checks tab
    xrefOpen: {},          // {itemKey: true} expanded items in Cross-reference
    xrefFolded: {},        // {sectionId: true} sections collapsed in Cross-reference (saved)
    xrefHideUnused: false, // Cross-reference: leave out items no program touches (saved)
    xrefFilter: '',
    checksProg: null,      // Checks tab: show only findings touching this program
    noteOpen: {},          // {NAME:line -> bool} gutter notes the reader has toggled
    flowFocus: null,       // block idx isolated in the control-flow graph
    flowLayout: 'chart',   // control-flow canvas: 'column' | 'chart' (persisted)
    flowGaps: 'normal',    // 'tight' | 'normal' | 'wide' (persisted)
    flowDetail: 'auto',    // 'auto' | 'full' | 'compact' | 'map' (persisted)
    flowMini: true,        // show the overview strip (persisted)
    flowHideNav: false,    // hide the library while the Flow tab is open (persisted)
    hideNav: false,        // hide the library on every tab — the ☰ button in the header (persisted)
    codeSize: 13,          // code font size in px (persisted)
    ignoreIoState: true,   // Compare: skip the controller's inline I/O state (persisted)
    ignoreLineNums: true,  // Compare: skip the leading /MN line number (persisted)
    robotCheck: null,      // last "check robot for changes" run — manual, never polled
    /* Studio-5000-style document tabs in the Code view. A doc is a program
     * ('P:NAME') or a data view ('D:regs' | 'D:prs' | 'D:io'), so live
     * registers can sit in a tab — or docked beside the code — instead of
     * needing a second browser window. */
    openDocs: [],          // ordered open-doc ids (the tab strip)
    activeDoc: null,       // doc in the left (or only) half of the Code view
    splitDoc: null,        // doc docked on the right, or null
    editSide: null,        // 'left' | 'right' — which split half is an editor
    editDraft: null,       // {name, text} — unsaved editor text, survives tab switches
    splitPct: 50,          // side-by-side: left half's share of the width (persisted)
    showAllProgs: false,   // sidebar: also list programs not prefixed A_/_ (persisted)
    dataFilter: {},        // data-view filter text, per doc id — survives re-renders
    theme: 'auto'          // 'auto' (follow the system) | 'light' | 'dark' (persisted)
  };

  var PREFS_KEY = 'fanuc-tp-studio.prefs.v1';

  /* ---- code text size ----
   * Only the code surfaces scale: the viewer, the side-by-side/unified diffs
   * and the editor all take their font-size from --code-size. This replaced
   * an interface zoom that scaled the whole shell, which was never the point
   * — the thing worth enlarging on a phone, or across a shop-floor desk, is
   * the program text, not the chrome around it. The gutters are sized in em
   * so they stay proportional as the text grows. */
  var CODE_SIZES = [11, 12, 13, 14, 16, 18, 21];
  var CODE_SIZE_DEFAULT = 13;

  /* ---- theme ----
   * 'auto' leaves the choice to prefers-color-scheme; forcing it just sets
   * data-theme on <html>, which the stylesheet already honors. */
  var THEME_ORDER = ['auto', 'dark', 'light'];
  var THEME_FACE = { auto: '◐ Auto', dark: '🌙 Dark', light: '☀ Light' };

  function paintTheme() {
    var root = document.documentElement;
    if (state.theme === 'light' || state.theme === 'dark') root.setAttribute('data-theme', state.theme);
    else root.removeAttribute('data-theme');
    var btn = document.getElementById('btn-theme');
    if (btn) {
      btn.textContent = THEME_FACE[state.theme] || THEME_FACE.auto;
      btn.title = state.theme === 'auto'
        ? 'Theme follows Windows/browser dark mode — click for always dark'
        : 'Theme: always ' + state.theme + ' — click to switch';
    }
  }

  function paintCodeSize() {
    var app = document.querySelector('.app');
    if (app) app.style.setProperty('--code-size', state.codeSize + 'px');
  }

  /* The − / size / + group for the Code tab's toolbar. It repaints its own
   * label and sets the CSS variable directly rather than calling render(),
   * because the editor shares this toolbar and a re-render would rebuild the
   * textarea and drop unsaved text. */
  function codeSizeControl() {
    var minus = h('button', { class: 'btn subtle', text: '−', 'aria-label': 'Smaller code text', title: 'Smaller code text' });
    var plus = h('button', { class: 'btn subtle', text: '+', 'aria-label': 'Larger code text', title: 'Larger code text' });
    var level = h('button', {
      class: 'btn subtle code-size-level',
      title: 'Code text size — click to reset to ' + CODE_SIZE_DEFAULT + 'px'
    });

    function paint() {
      level.textContent = state.codeSize + 'px';
      minus.disabled = state.codeSize === CODE_SIZES[0];
      plus.disabled = state.codeSize === CODE_SIZES[CODE_SIZES.length - 1];
    }

    function step(d) {
      var i = CODE_SIZES.indexOf(state.codeSize);
      if (i === -1) i = CODE_SIZES.indexOf(CODE_SIZE_DEFAULT);
      state.codeSize = d === 0
        ? CODE_SIZE_DEFAULT
        : CODE_SIZES[Math.max(0, Math.min(CODE_SIZES.length - 1, i + d))];
      paintCodeSize();
      paint();
      savePrefs();
    }

    minus.addEventListener('click', function () { step(-1); });
    plus.addEventListener('click', function () { step(1); });
    level.addEventListener('click', function () { step(0); });
    paint();
    return h('div', { class: 'code-size', role: 'group', 'aria-label': 'Code text size' }, [minus, level, plus]);
  }

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      state.flowIgnore = p.flowIgnore || {};
      state.hiddenRules = p.hiddenRules || {};
      if (CODE_SIZES.indexOf(p.codeSize) !== -1) state.codeSize = p.codeSize;
      if (typeof p.ignoreIoState === 'boolean') state.ignoreIoState = p.ignoreIoState;
      if (p.lastRobot && p.lastRobot.ip) state.lastRobot = p.lastRobot; // {ip, ftpUser}
      if (p.theme === 'light' || p.theme === 'dark' || p.theme === 'auto') state.theme = p.theme;
      if (typeof p.splitPct === 'number' && p.splitPct >= 20 && p.splitPct <= 80) state.splitPct = p.splitPct;
      if (typeof p.showAllProgs === 'boolean') state.showAllProgs = p.showAllProgs;
      if (typeof p.ignoreLineNums === 'boolean') state.ignoreLineNums = p.ignoreLineNums;
      if (typeof p.syncSplit === 'boolean') state.syncSplit = p.syncSplit;
      if (p.flowLayout === 'column' || p.flowLayout === 'chart') state.flowLayout = p.flowLayout;
      if (CFG_GAPS[p.flowGaps]) state.flowGaps = p.flowGaps;
      if (p.flowDetail === 'auto' || CFG_TIER_MAX[p.flowDetail]) state.flowDetail = p.flowDetail;
      if (typeof p.flowMini === 'boolean') state.flowMini = p.flowMini;
      if (typeof p.flowHideNav === 'boolean') state.flowHideNav = p.flowHideNav;
      if (typeof p.hideNav === 'boolean') state.hideNav = p.hideNav;
      if (p.xrefFolded && typeof p.xrefFolded === 'object') state.xrefFolded = p.xrefFolded;
      if (typeof p.xrefHideUnused === 'boolean') state.xrefHideUnused = p.xrefHideUnused;
    } catch (e) { /* defaults */ }
    try {
      // the password never touches disk — it lives for this tab only
      state.sessionFtpPass = sessionStorage.getItem('fanuc-tp-studio.ftpPass') || '';
    } catch (e) { /* no session storage — re-enter it after a refresh */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        flowIgnore: state.flowIgnore, hiddenRules: state.hiddenRules, codeSize: state.codeSize,
        ignoreIoState: state.ignoreIoState, ignoreLineNums: state.ignoreLineNums,
        syncSplit: state.syncSplit,
        flowLayout: state.flowLayout, flowGaps: state.flowGaps, flowDetail: state.flowDetail,
        flowMini: state.flowMini, flowHideNav: state.flowHideNav, hideNav: state.hideNav,
        xrefFolded: state.xrefFolded, xrefHideUnused: state.xrefHideUnused,
        lastRobot: state.lastRobot || null, theme: state.theme, splitPct: state.splitPct,
        showAllProgs: state.showAllProgs
      }));
    } catch (e) { /* session-only */ }
  }

  function toast(msg, ms) {
    var t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.classList.remove('show'); }, ms || 4000);
  }

  /* ================= library ================= */

  function buildExtern() {
    var regs = null, io = null, posregs = null, source = null;
    if (state.robot.registers && !state.robot.registers.error) {
      regs = state.robot.registers;
      source = 'robot ' + state.robot.ip;
    }
    if (state.robot.ioComments) { io = state.robot.ioComments; source = 'robot ' + state.robot.ip; }
    if (state.robot.posregs && !state.robot.posregs.error) { posregs = state.robot.posregs; source = 'robot ' + state.robot.ip; }
    if (!regs && state.dirExtern && state.dirExtern.registers) { regs = state.dirExtern.registers; source = state.dirExtern.source; }
    if (!io && state.dirExtern && state.dirExtern.io) { io = state.dirExtern.io; source = source || state.dirExtern.source; }
    if (!posregs && state.dirExtern && state.dirExtern.posregs) { posregs = state.dirExtern.posregs; source = source || state.dirExtern.source; }
    if (!regs && !io && !posregs) return null;
    return { registers: regs || [], io: io || [], posregs: posregs || [], source: source };
  }

  function rebuildDerived() {
    state.graph = A.buildCallGraph(state.programs);
    state.xref = A.buildGlobalXref(state.programs);
    state.extern = buildExtern();
    state.findings = L.lint(state.programs, state.graph, state.xref, state.extern, { passThroughCalls: state.flowIgnore });
    // lines the controller's translator will refuse — the same grammar the
    // editor underlines, so Save + send can warn before the upload
    if (TPS) Object.keys(state.programs).forEach(function (name) {
      TPS.checkProgram(state.programs[name].parsed, TP_DICT).forEach(function (e) {
        state.findings.push({
          severity: 'error', rule: 'syntax-error',
          message: name + ' line ' + e.line + ': ' + e.message,
          refs: [{ prog: name, line: e.line }]
        });
      });
    });
    // live names: the controller's CURRENT register/PR/IO comments, shown in
    // place of whatever stale comment the program text was exported with
    state.liveNames = null;
    if (state.extern) {
      var ln = { r: {}, pr: {}, io: {} };
      var any = false;
      (state.extern.registers || []).forEach(function (r2) { if (r2.comment) { ln.r[r2.index] = r2.comment; any = true; } });
      (state.extern.posregs || []).forEach(function (r2) { if (r2.group === 1 && r2.comment) { ln.pr[r2.index] = r2.comment; any = true; } });
      (state.extern.io || []).forEach(function (p2) { if (p2.comment) { ln.io[p2.type + '[' + p2.index + ']'] = p2.comment; any = true; } });
      if (any) state.liveNames = ln;
    }
    state.namesRev = (state.namesRev || 0) + 1; // invalidates highlight caches
    refreshCompare();
  }

  /* A loaded baseline is compared against the library as it stood at that
   * moment. Every later import, edit or removal changes the library, so the
   * stored verdicts have to be recomputed alongside it. Otherwise the changed
   * list could name a program the library no longer holds, and opening that
   * row threw on a missing .source — which aborted the rest of the render
   * and looked like a row that simply would not open. */
  function refreshCompare() {
    var c = state.compare;
    if (!c) return;
    c.results = D.comparePrograms(c.programs, librarySources(), diffOpts());
    if (c.open && !state.programs[c.open]) c.open = null;
  }

  // Controllers export logs and diagnostics (ERRALL.LS, HIST.LS, LOGBOOK.LS,
  // UPDTLOG.LS, VTRNDIAG.LS…) with a .ls extension too — only files with a
  // /PROG header are actual programs.
  function isProgramSource(src) { return /^\/PROG\b/m.test(src); }

  /* A controller's file list gives names only, so the /PROG test above needs
   * the file fetched first. These are the log and diagnostic exports by name,
   * which lets the Robot tab keep them out of the program list before anything
   * is read. Any other file that turns out to have no /PROG header is
   * remembered in state.robot.notPrograms once a fetch has proved it.
   *
   * Matched as whole names, not a suffix pattern: a real program can easily be
   * called something like _BGL_TASKLOG.LS, so /LOG\.LS$/ would hide code. */
  var LOG_EXPORT_RE = /^(ERR[A-Z]*|HIST|LOGBOOK|UPDTLOG|VTRNDIAG)\.LS$/i;

  function isKnownNonProgram(filename) {
    return LOG_EXPORT_RE.test(filename) || !!state.robot.notPrograms[filename.toUpperCase()];
  }

  function addProgram(source, filename, origin) {
    var parsed = P.parseLS(source, filename);
    state.programs[parsed.name] = {
      parsed: parsed,
      analysis: A.analyzeProgram(parsed),
      // parsed.source is the cleaned listing — HTTP fetches from a controller
      // arrive wrapped in the iPendant HTML page, which parseLS strips
      source: parsed.source,
      origin: origin || { type: 'upload' }
    };
    return parsed.name;
  }

  function removeProgram(name) {
    delete state.programs[name];
    closeDoc('P:' + name);
    if (state.selected === name) state.selected = Object.keys(state.programs)[0] || null;
    rebuildDerived();
    persist();
    render();
  }

  function libStoreKey(id) { return STORE_PREFIX + id; }

  function libLabel(id) {
    if (id === LOCAL_LIB) return 'Local files';
    var r = state.knownRobots.filter(function (x) { return x.ip === id; })[0];
    return r && r.name ? r.name + ' — ' + id : id;
  }

  /* Every library that has ever been stored, plus the active one (which may
   * not have been written yet) and 'local' (always offered). */
  function listLibraries() {
    var ids = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(STORE_PREFIX) === 0) ids.push(k.slice(STORE_PREFIX.length));
      }
    } catch (e) { /* storage unavailable */ }
    if (ids.indexOf(state.library) === -1) ids.push(state.library);
    if (ids.indexOf(LOCAL_LIB) === -1) ids.push(LOCAL_LIB);
    ids.sort(function (a, b) {
      if (a === LOCAL_LIB) return -1;
      if (b === LOCAL_LIB) return 1;
      return libLabel(a).localeCompare(libLabel(b));
    });
    return ids;
  }

  function persist() {
    try {
      var out = {};
      Object.keys(state.programs).forEach(function (n) {
        out[n] = { source: state.programs[n].source, origin: state.programs[n].origin };
      });
      localStorage.setItem(libStoreKey(state.library), JSON.stringify(out));
      localStorage.setItem(ACTIVE_LIB_KEY, state.library);
    } catch (e) { /* storage unavailable — session-only mode */ }
  }

  function loadLibraryStore(id) {
    try {
      var raw = localStorage.getItem(libStoreKey(id));
      if (!raw) return;
      var data = JSON.parse(raw);
      Object.keys(data).forEach(function (n) { addProgram(data[n].source, n + '.LS', data[n].origin); });
    } catch (e) { /* ignore corrupt store */ }
  }

  /* Bumped whenever the loaded library is swapped out. Slow importers (robot
   * pulls, folder reads, FileReader) capture it when they start and drop any
   * file that lands after a switch, so one robot's programs can never bleed
   * into another robot's library. */
  var libGen = 0;

  /* Swap the loaded library. Everything derived from the program set —
   * selection, split view, pair diff, per-program filters — goes with it;
   * a loaded Compare baseline keeps its own sources and is simply re-run
   * against the new set by rebuildDerived(). Returns false if the user
   * chose to stay (unsaved editor text). */
  function setLibrary(id) {
    if (id === state.library) return true;
    if ((state.editing || state.editSide) && editorDirty() && !confirm('Switch libraries? Unsaved editor changes will be lost.')) return false;
    if (state.robotImport) state.robotImport.cancel = true;
    persist();                      // save the outgoing library
    libGen++;
    state.library = id;
    state.programs = {};
    state.selected = null;
    state.editing = false;
    state.editSide = null;
    state.editDraft = null;
    state.openDocs = [];
    state.activeDoc = null;
    state.splitDoc = null;
    state.pair = null;
    state.checksProg = null;
    loadLibraryStore(id);
    state.selected = Object.keys(state.programs)[0] || null;
    loadViewState();                // each library remembers its own tabs
    rebuildDerived();
    persist();                      // records the new active library
    return true;
  }

  function restore() {
    try {
      /* One-time migration of the single shared library: each program goes
       * to the library of the robot it came from, everything else to Local
       * files. The app then opens on whichever split got the most programs,
       * so the upgrade does not greet anyone with an empty sidebar. */
      var v2 = localStorage.getItem(STORE_KEY_V2);
      var v1 = localStorage.getItem(STORE_KEY_V1);
      if (v2 || v1) {
        var old = {};
        if (v2) old = JSON.parse(v2);
        else {
          var o1 = JSON.parse(v1);   // v1 held plain name -> source strings
          Object.keys(o1).forEach(function (n) { old[n] = { source: o1[n], origin: { type: 'upload' } }; });
        }
        var byLib = {}, biggest = LOCAL_LIB, max = -1;
        Object.keys(old).forEach(function (n) {
          var o = old[n].origin || {};
          var id = (o.type === 'robot' && o.ip) ? o.ip : LOCAL_LIB;
          (byLib[id] = byLib[id] || {})[n] = old[n];
        });
        Object.keys(byLib).forEach(function (id) {
          localStorage.setItem(libStoreKey(id), JSON.stringify(byLib[id]));
          var count = Object.keys(byLib[id]).length;
          if (count > max) { max = count; biggest = id; }
        });
        localStorage.setItem(ACTIVE_LIB_KEY, biggest);
        localStorage.removeItem(STORE_KEY_V2);
        localStorage.removeItem(STORE_KEY_V1);
        if (Object.keys(byLib).length > 1) {
          toast('Your library was split per robot — pick a library above the program list, or connect to a robot to open its own.');
        }
      }
      state.library = localStorage.getItem(ACTIVE_LIB_KEY) || LOCAL_LIB;
      loadLibraryStore(state.library);
      state.selected = Object.keys(state.programs)[0] || null;
      loadViewState();   // reopen the tabs and program from before the refresh
    } catch (e) { /* ignore corrupt store */ }
  }

  /* ---- per-library view memory ----
   * Which program was open, which doc tabs, what was docked: without this a
   * refresh landed on whatever program happened to be first in the store. */
  function viewKey(id) { return 'fanuc-tp-studio.view.v1.' + id; }

  function saveViewState() {
    try {
      localStorage.setItem(viewKey(state.library), JSON.stringify({
        selected: state.selected, openDocs: state.openDocs,
        activeDoc: state.activeDoc, splitDoc: state.splitDoc
      }));
    } catch (e) { /* storage unavailable — session-only */ }
  }

  function loadViewState() {
    try {
      var v = JSON.parse(localStorage.getItem(viewKey(state.library)) || 'null');
      if (!v) return;
      if (v.selected && state.programs[v.selected]) { state.selected = v.selected; docSelSync = v.selected; }
      state.openDocs = (v.openDocs || []).filter(docValid);
      state.activeDoc = docValid(v.activeDoc) ? v.activeDoc : null;
      state.splitDoc = docValid(v.splitDoc) ? v.splitDoc : null;
    } catch (e) { /* corrupt — fall back to defaults */ }
  }

  /* Controller device directories. A robot backup keeps its programs under
   * one of these, so "MD" as a label would name every backup alike. */
  var DEVICE_DIR_RE = /^(MD|MC|MF|FR|RD|UD1|UT1|TEMP)$/i;

  /* A folder pick (webkitdirectory) tags every file with its path relative to
   * the folder that was chosen, e.g. "R2000_BACKUP/MD/PICK1.LS". The label is
   * the deepest folder that actually names something — device directories are
   * skipped, so the file reads "from R2000_BACKUP" and not "from MD" — and the
   * whole relative path goes on the hover title. A plain multi-file pick has
   * no relative path at all, and then there is no folder to name. */
  function folderOf(file) {
    var parts = String(file.webkitRelativePath || '').split('/');
    parts.pop();                                  // the file itself
    if (!parts.length) return null;
    var i = parts.length - 1;
    while (i > 0 && DEVICE_DIR_RE.test(parts[i])) i--;
    return { folder: parts[i], dir: parts.join('/') };
  }

  function importFiles(fileList) {
    var all = Array.prototype.slice.call(fileList);
    var files = all.filter(function (f) {
      return /\.(ls|txt)$/i.test(f.name) || all.length === 1;
    });
    var pending = files.length;
    if (!pending) {
      toast(all.length
        ? 'No .LS files in that selection (' + all.length + ' file' + (all.length > 1 ? 's' : '') + ' skipped — names must end in .LS).'
        : 'Nothing was selected.');
      return;
    }
    var lastName = null;
    var imported = 0, skipped = 0;
    var gen = libGen;
    files.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        var src = String(reader.result);
        if (gen !== libGen) skipped++;   // library switched mid-read
        else if (isProgramSource(src)) {
          var origin = { type: 'upload' };
          var fo = folderOf(f);
          if (fo) { origin.folder = fo.folder; origin.dir = fo.dir; }
          lastName = addProgram(src, f.name, origin);
          imported++;
        } else skipped++;
        if (--pending === 0) {
          if (lastName) state.selected = lastName;
          rebuildDerived();
          persist();
          render();
          toast(imported
            ? 'Imported ' + imported + ' program' + (imported > 1 ? 's' : '') + (skipped ? ' (skipped ' + skipped + ' log file' + (skipped > 1 ? 's' : '') + ' — no /PROG header)' : '') + '.'
            : 'No programs found — ' + skipped + ' file' + (skipped > 1 ? 's are' : ' is') + ' a controller log export, not a TP program.');
        }
      };
      reader.readAsText(f);
    });
  }

  /* ================= bridge (server) API ================= */

  function api(pathname) {
    return fetch(pathname).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
        return body;
      });
    }, function () {
      throw new Error('The bridge did not answer — check that the "Start FANUC Studio" window is still open, then try again.');
    });
  }

  function postJSON(pathname, body) {
    return fetch(pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status));
        return b;
      });
    }, function () {
      throw new Error('The bridge did not answer.');
    });
  }

  function detectServer() {
    if (location.protocol === 'file:') { state.server = false; renderConnect(); return; }
    fetch('/api/ping').then(function (r) { return r.json(); })
      .then(function (b) {
        state.server = !!(b && b.ok);
        renderConnect();
        if (state.server) {
          loadKnownRobots();
          loadSubnets();
          loadBackupHome();
          // pick up where the last page load left off: silently reconnect to
          // the robot that was selected before the refresh
          if (state.lastRobot && state.lastRobot.ip && !state.robot.ip) {
            state.robot.ftpUser = state.lastRobot.ftpUser || '';
            state.robot.ftpPass = state.sessionFtpPass || '';
            var keepTab = state.tab;
            connectRobot(state.lastRobot.ip);
            state.tab = keepTab; // reconnecting is background work, not navigation
            render();
          }
        }
      })
      .catch(function () { state.server = false; renderConnect(); });
  }

  function ftpQS() {
    var s = '';
    if (state.robot.ftpUser) s += '&user=' + encodeURIComponent(state.robot.ftpUser);
    if (state.robot.ftpPass) s += '&pass=' + encodeURIComponent(state.robot.ftpPass);
    return s;
  }

  /* ---- subnet scan ----
   * The bridge streams NDJSON so progress shows while the sweep runs and
   * aborting the request really does stop it. Events are written straight
   * into the panel's own elements — a full re-render mid-scan would take the
   * CIDR box's focus away and throw the caret out. */
  var scanAbort = null;
  var scanUI = null;

  function readNdjson(r, onLine) {
    var feed = function (text) {
      text.split('\n').forEach(function (l) {
        if (!l.trim()) return;
        try { onLine(JSON.parse(l)); } catch (e) { /* a torn line — the next read completes it */ }
      });
    };
    if (!(r.body && r.body.getReader && window.TextDecoder)) {
      return r.text().then(feed);   // older browser: take it all at the end
    }
    var reader = r.body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    function pump() {
      return reader.read().then(function (res) {
        if (res.done) { feed(buf); return; }
        buf += dec.decode(res.value, { stream: true });
        var parts = buf.split('\n');
        buf = parts.pop();
        feed(parts.join('\n'));
        return pump();
      });
    }
    return pump();
  }

  function loadSubnets() {
    return api('/api/net').then(function (b) {
      state.subnets = b.subnets || [];
      if (state.tab === 'robot' && !(state.scan && state.scan.running)) render();
    }).catch(function () { state.subnets = []; });
  }

  function startScan(cidr) {
    cancelScan();
    scanAbort = new AbortController();
    state.scan = { running: true, cidr: cidr, total: 0, done: 0, found: [], others: [], error: null, ms: 0 };
    render();
    fetch('/api/robots/scan?cidr=' + encodeURIComponent(cidr), { signal: scanAbort.signal })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || ('HTTP ' + r.status)); });
        return readNdjson(r, onScanEvent);
      })
      .then(function () { endScan(); })
      .catch(function (e) {
        if (e.name === 'AbortError') return;   // cancelled on purpose
        if (state.scan) state.scan.error = e.message;
        endScan();
      });
  }

  function cancelScan() {
    if (scanAbort) { scanAbort.abort(); scanAbort = null; }
    if (state.scan) state.scan.running = false;
  }

  function endScan() {
    scanAbort = null;
    if (state.scan) state.scan.running = false;
    scanUI = null;
    loadKnownRobots();   // the bridge already saved whatever it confirmed
    render();
  }

  function onScanEvent(ev) {
    var sc = state.scan;
    if (!sc) return;
    if (ev.type === 'start') { sc.total = ev.total; sc.cidr = ev.cidr; }
    else if (ev.type === 'progress') sc.done = ev.done;
    else if (ev.type === 'hit') sc.found.push({ ip: ev.ip, name: ev.name });
    else if (ev.type === 'other') sc.others.push(ev.ip);
    else if (ev.type === 'done') { sc.ms = ev.ms; sc.done = ev.scanned; }
    paintScan();
  }

  function paintScan() {
    var sc = state.scan;
    if (!sc || !scanUI || !scanUI.progress || !scanUI.progress.isConnected) return;
    scanUI.progress.textContent = scanProgressText(sc);
    if (scanUI.bar) scanUI.bar.style.width = (sc.total ? Math.round(100 * sc.done / sc.total) : 0) + '%';
  }

  function scanProgressText(sc) {
    if (sc.error) return sc.error;
    if (sc.running) {
      return 'Scanning ' + sc.cidr + ' — ' + sc.done + ' of ' + (sc.total || '?') + ' addresses' +
        (sc.found.length ? ', ' + sc.found.length + ' found' : '') + '…';
    }
    var bits = [sc.found.length + (sc.found.length === 1 ? ' controller' : ' controllers') + ' found'];
    if (sc.others.length) bits.push(sc.others.length + ' other device' + (sc.others.length === 1 ? '' : 's') + ' answered on port 80');
    if (sc.ms) bits.push('swept ' + sc.done + ' addresses in ' + (sc.ms / 1000).toFixed(1) + 's');
    return bits.join(' · ');
  }

  /* ---- saved robots (bridge-side, shared by every device) ---- */

  function loadKnownRobots(thenProbe) {
    if (!state.server) return;
    api('/api/robots').then(function (b) {
      state.knownRobots = b.robots || [];
      /* The saved list arrives after the first paint. The Robot tab shows it
       * in full, but the sidebar picker is built from it too, so it has to be
       * refreshed on every other tab as well — otherwise the dropdown sits
       * on "No saved robots yet" for the whole session. Repainting just the
       * picker keeps a burst of probe results from re-rendering everything. */
      if (state.tab === 'robot') render(); else paintRobotPicker();
      paintLibraryPicker();   // library labels use the saved robots' names too
      if (thenProbe !== false) probeKnownRobots();
    }).catch(function () { /* bridge without the endpoint — list just stays empty */ });
  }

  function rememberRobot(ip, name) {
    if (!state.server) return;
    postJSON('/api/robots/remember', { ip: ip, name: name || null, ftpUser: state.robot.ftpUser || null })
      .then(function (b) {
        state.knownRobots = b.robots || state.knownRobots;
        state.robotProbe[ip] = 'up';
        if (state.tab === 'robot') render();
      }).catch(function () { /* remembering is a convenience — never block on it */ });
  }

  function forgetRobot(ip) {
    postJSON('/api/robots/forget', { ip: ip }).then(function (b) {
      state.knownRobots = b.robots || [];
      delete state.robotProbe[ip];
      render();
    }).catch(function (e) { toast('Could not forget ' + ip + ': ' + e.message); });
  }

  /* One short TCP probe per saved robot, all in flight together — a handful
   * of connects, and the row says which are actually reachable right now. */
  function probeKnownRobots() {
    state.knownRobots.forEach(function (r) {
      state.robotProbe[r.ip] = 'checking';
      api('/api/robots/probe?ip=' + encodeURIComponent(r.ip)).then(function (b) {
        state.robotProbe[r.ip] = b.ok ? 'up' : 'down';
      }).catch(function () {
        state.robotProbe[r.ip] = 'down';
      }).then(function () {
        if (state.tab === 'robot') render(); else paintRobotPicker();
      });
    });
    if (!state.knownRobots.length) return;
    if (state.tab === 'robot') render(); else paintRobotPicker();
  }

  /* ---- backups to the server ----
   * The home folder lives on the bridge, not in this browser: it is a path
   * on the bridge PC, so it is the same folder no matter which device is
   * looking, and it survives a cleared browser. Set once, used by every
   * backup afterwards. */
  function loadBackupHome() {
    return api('/api/settings').then(function (b) {
      state.backupHome = b;
      if (state.tab === 'robot' && !backupAllRunning()) render();
    }).catch(function () { /* older bridge — the section just shows defaults */ });
  }

  function setRobotFolder(ip, folder) {
    postJSON('/api/robots/folder', { ip: ip, folder: folder || '' }).then(function (b) {
      state.knownRobots = b.robots || state.knownRobots;
      var hit = state.knownRobots.filter(function (r) { return r.ip === ip; })[0];
      toast(folder ? ((hit && hit.name || ip) + ' → ' + folder) : ((hit && hit.name || ip) + ' will use the bridge’s backups folder'));
      render();
    }).catch(function (e) { toast('Could not use that folder: ' + e.message); });
  }

  /* ---- folder picker ----
   * A browser cannot hand a server a filesystem path — a folder input gives
   * file names and nothing else — and the folders that matter here are the
   * bridge PC's mapped drives and shares. So the bridge lists its own
   * directories and this walks them. The path box stays typable on purpose:
   * a UNC path can be pasted, and a folder that does not exist yet can be
   * named outright, since the bridge creates it when it saves. */
  var fpDlg = null;
  var fpUI = null;
  var fpState = null;

  function openFolderPicker(opts) {
    fpState = {
      title: opts.title, hint: opts.hint || '', allowHome: !!opts.allowHome,
      onPick: opts.onPick, path: null, dirs: [], parent: null, places: null,
      error: null, warn: null, loading: true
    };
    if (!fpDlg) buildFolderPicker();
    fpUI.title.textContent = fpState.title;
    fpUI.hint.textContent = fpState.hint;
    fpUI.hint.hidden = !fpState.hint;
    fpUI.home.hidden = !fpState.allowHome;
    fpUI.path.value = opts.start || '';
    if (!fpDlg.open) fpDlg.showModal();
    fpBrowse(opts.start || null);
  }

  function closeFolderPicker() {
    fpState = null;
    if (fpDlg && fpDlg.open) fpDlg.close();
  }

  function buildFolderPicker() {
    fpDlg = h('dialog', { class: 'fp-dlg', 'aria-label': 'Choose a folder' });
    var title = h('h2', { text: 'Choose a folder' });
    var head = h('div', { class: 'fp-head' }, [
      title,
      h('button', { class: 'btn subtle', text: '✕', title: 'Cancel', onclick: closeFolderPicker })
    ]);
    var hint = h('p', { class: 'muted fp-hint' });
    var pathIn = h('input', {
      type: 'text', class: 'fp-path', placeholder: '\\\\server\\share\\folder',
      title: 'Type or paste a path on the bridge PC. It does not have to exist yet — the bridge creates it.'
    });
    pathIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); fpBrowse(pathIn.value.trim() || null); }
    });
    var go = h('button', { class: 'btn', text: 'Go', title: 'Open this path', onclick: function () { fpBrowse(pathIn.value.trim() || null); } });
    var msg = h('p', { class: 'fp-msg' });
    var list = h('div', { class: 'fp-list', tabindex: '-1' });
    var homeBtn = h('button', {
      class: 'btn subtle', text: 'Clear — use the default folder',
      title: 'Forget this robot’s own folder and file its backups in the bridge’s backups folder',
      onclick: function () { commitFolderPicker(null); }
    });
    var useBtn = h('button', { class: 'btn primary', text: 'Use this folder', onclick: function () { commitFolderPicker(pathIn.value.trim() || (fpState && fpState.path)); } });
    var foot = h('div', { class: 'fp-foot' }, [
      homeBtn,
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', text: 'Cancel', onclick: closeFolderPicker }),
      useBtn
    ]);
    fpDlg.appendChild(head);
    fpDlg.appendChild(hint);
    fpDlg.appendChild(h('div', { class: 'fp-bar' }, [pathIn, go]));
    fpDlg.appendChild(msg);
    fpDlg.appendChild(list);
    fpDlg.appendChild(foot);
    /* Clicking the backdrop lands on the dialog element itself. Escape
     * closes it natively, so fpState has to be dropped on close either way
     * or the next open would inherit the last one's callback. */
    fpDlg.addEventListener('click', function (e) { if (e.target === fpDlg) closeFolderPicker(); });
    fpDlg.addEventListener('close', function () { fpState = null; });
    document.body.appendChild(fpDlg);
    fpUI = { title: title, hint: hint, path: pathIn, msg: msg, list: list, home: homeBtn, use: useBtn };
  }

  function commitFolderPicker(dir) {
    var cb = fpState && fpState.onPick;
    closeFolderPicker();
    if (cb) cb(dir || null);
  }

  function fpBrowse(dir) {
    if (!fpState) return;
    fpState.loading = true;
    fpState.error = null;
    paintFolderPicker();
    api('/api/fs/dirs' + (dir ? '?path=' + encodeURIComponent(dir) : '')).then(function (b) {
      if (!fpState) return;
      fpState.loading = false;
      if (b.places) {
        fpState.places = b.places;
        fpState.path = null;
        fpState.dirs = [];
        fpState.parent = null;
        fpState.warn = null;
      } else {
        fpState.places = null;
        fpState.path = b.path;
        fpState.dirs = b.dirs || [];
        fpState.parent = b.parent;
        fpState.warn = b.error;                 // readable, but not writable
        fpUI.path.value = b.path;
      }
      paintFolderPicker();
    }).catch(function (e) {
      /* Stay where we were and say why: a folder that cannot be opened
       * (a share that is down, a permission) should not also lose the
       * place the user had already navigated to. */
      if (!fpState) return;
      fpState.loading = false;
      fpState.error = e.message;
      paintFolderPicker();
    });
  }

  function paintFolderPicker() {
    if (!fpState || !fpUI) return;
    fpUI.msg.textContent = fpState.error || fpState.warn || '';
    fpUI.msg.className = 'fp-msg' + (fpState.error ? ' bad' : fpState.warn ? ' warn' : '');
    fpUI.msg.hidden = !(fpState.error || fpState.warn);
    fpUI.use.disabled = fpState.loading;
    var list = fpUI.list;
    list.textContent = '';
    if (fpState.loading) {
      list.appendChild(h('div', { class: 'fp-item muted', text: 'Reading…' }));
      return;
    }
    if (fpState.places) {
      fpState.places.forEach(function (p) {
        list.appendChild(h('button', { class: 'fp-item', onclick: function () { fpBrowse(p.path); } }, [
          h('span', { class: 'fp-ic', text: '🖿' }),
          h('span', { class: 'fp-label', text: p.label }),
          h('span', { class: 'fp-sub mono', text: p.path })
        ]));
      });
      if (!fpState.places.length) list.appendChild(h('div', { class: 'fp-item muted', text: 'No drives found — type a path above.' }));
      return;
    }
    list.appendChild(h('button', {
      class: 'fp-item', onclick: function () { fpBrowse(fpState.parent); }
    }, [
      h('span', { class: 'fp-ic', text: '↑' }),
      h('span', { class: 'fp-label', text: fpState.parent ? '.. up to ' + fpState.parent : '.. drives and places' })
    ]));
    fpState.dirs.forEach(function (name) {
      list.appendChild(h('button', {
        class: 'fp-item', onclick: function () { fpBrowse(joinPath(fpState.path, name)); }
      }, [
        h('span', { class: 'fp-ic', text: '🖿' }),
        h('span', { class: 'fp-label', text: name })
      ]));
    });
    if (!fpState.dirs.length) {
      list.appendChild(h('div', { class: 'fp-item muted', text: 'No subfolders here — “Use this folder” files backups straight into it.' }));
    }
  }

  /* Joining is done on the client so a click can descend without waiting for
   * a round trip to tell it the separator. Which separator is the bridge's,
   * not this browser's — a phone pointed at a Windows bridge still has to
   * build Windows paths — so it is taken from the path we are standing in. */
  function joinPath(base, name) {
    var sep = base.indexOf('\\') !== -1 && base.indexOf('/') === -1 ? '\\' : '/';
    if (/^[A-Za-z]:$/.test(base)) return base + '\\' + name;   // "C:" alone is not a folder
    return base.replace(/[\\/]+$/, '') + sep + name;
  }

  var backupAllAbort = null;
  var backupAllUI = null;

  function backupAllRunning() { return !!(state.backupAll && state.backupAll.running); }

  /* Which robots the next sweep covers. Everything the bridge knows about is
   * in by default except what a probe has just told us is not answering —
   * a cell that is powered down is the normal reason a robot is missing, and
   * pre-ticking it would only mean waiting for it to be skipped. */
  function backupPicked() {
    return state.knownRobots.filter(function (r) {
      var st = state.robotProbe[r.ip];
      var def = st !== 'down';
      return (r.ip in state.backupPick) ? state.backupPick[r.ip] : def;
    });
  }

  /* No ips = the ticked robots (the full sweep). A list of one is how a
   * row's Quick backup runs: same machinery, same per-row progress. */
  function startBackupAll(mode, ips) {
    var picked = ips
      ? state.knownRobots.filter(function (r) { return ips.indexOf(r.ip) !== -1; })
      : backupPicked();
    if (!picked.length) return;
    cancelBackupAll();
    var rows = {};
    picked.forEach(function (r) { rows[r.ip] = { ip: r.ip, name: r.name, status: 'waiting' }; });
    state.backupAll = {
      running: true, mode: mode, total: picked.length, index: -1, current: null,
      order: picked.map(function (r) { return r.ip; }), rows: rows,
      file: null, dests: [], destCount: 0,
      ok: 0, failed: 0, skipped: 0, files: 0, bytes: 0, ms: 0, error: null
    };
    backupAllAbort = new AbortController();
    render();
    fetch('/api/robots/backup-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: backupAllAbort.signal,
      body: JSON.stringify({
        ips: picked.map(function (r) { return r.ip; }),
        mode: mode,
        user: state.robot.ftpUser || undefined,
        pass: state.robot.ftpPass || undefined
      })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (b) { throw new Error(b.error || ('HTTP ' + r.status)); });
      return readNdjson(r, onBackupAllEvent);
    }).then(function () { endBackupAll(); })
      .catch(function (e) {
        if (e.name === 'AbortError') return;
        if (state.backupAll) state.backupAll.error = e.message;
        endBackupAll();
      });
  }

  function cancelBackupAll() {
    if (backupAllAbort) { backupAllAbort.abort(); backupAllAbort = null; }
    if (state.backupAll) state.backupAll.running = false;
  }

  function endBackupAll() {
    backupAllAbort = null;
    if (state.backupAll) state.backupAll.running = false;
    backupAllUI = null;
    /* The sweep refreshes lastSeen on the bridge and can fill in a name a
     * scan never got, so the saved list is worth re-reading — without
     * re-probing every robot, which the backups just proved. */
    loadKnownRobots(false);
    if (state.tab === 'robot') render();
  }

  function onBackupAllEvent(ev) {
    var ba = state.backupAll;
    if (!ba) return;
    var row = ev.ip ? ba.rows[ev.ip] : null;
    if (ev.type === 'start') {
      ba.total = ev.total;
      ba.destCount = ev.dests;
    } else if (ev.type === 'robot') {
      ba.index = ev.index;
      ba.current = ev.ip;
      ba.file = null;
      if (row) { row.status = 'running'; row.dest = ev.dest; if (ev.name) row.name = ev.name; }
    } else if (ev.type === 'file') {
      ba.file = { saved: ev.saved, total: ev.total };
      if (row) { row.saved = ev.saved; row.fileTotal = ev.total; }
    } else if (ev.type === 'robotDone') {
      ba.current = null;
      ba.file = null;
      if (row) {
        row.status = ev.ok ? 'done' : ev.skipped ? 'skipped' : 'failed';
        row.folder = ev.folder;
        row.files = ev.files;
        row.bytes = ev.bytes;
        row.error = ev.error;
        row.failedFiles = ev.failed;
        if (ev.robotName) row.name = ev.robotName;
      }
    } else if (ev.type === 'done') {
      ba.ok = ev.ok; ba.failed = ev.failed; ba.skipped = ev.skipped;
      ba.files = ev.files; ba.bytes = ev.bytes; ba.ms = ev.ms; ba.dests = ev.dests || [];
    }
    paintBackupAll();
  }

  /* Painted straight into the panel's own elements rather than re-rendered:
   * a full render mid-sweep would take the caret out of the home-folder box
   * and drop every checkbox the user was still adjusting. */
  function paintBackupAll() {
    var ba = state.backupAll;
    if (!ba || !backupAllUI || !backupAllUI.status || !backupAllUI.status.isConnected) return;
    backupAllUI.status.textContent = backupAllText(ba);
    var pct = ba.total ? Math.round(100 * (Math.max(0, ba.index) + (ba.file && ba.file.total ? ba.file.saved / ba.file.total : 0)) / ba.total) : 0;
    if (backupAllUI.bar) backupAllUI.bar.style.width = Math.min(100, pct) + '%';
    if (backupAllUI.rows) {
      ba.order.forEach(function (ip) {
        var el = backupAllUI.rows[ip];
        if (el) paintBackupRow(el, ba.rows[ip]);
      });
    }
  }

  function backupAllText(ba) {
    if (ba.running) {
      var at = Math.max(0, ba.index) + 1;
      var who = ba.current ? ((ba.rows[ba.current] && ba.rows[ba.current].name) || ba.current) : '';
      return 'Robot ' + at + ' of ' + ba.total + (who ? ' — ' + who : '') +
        (ba.file ? ' — ' + ba.file.saved + ' of ' + ba.file.total + ' files' : ' — connecting…');
    }
    if (ba.error) return 'Backup sweep failed: ' + ba.error;
    var parts = [ba.ok + ' backed up'];
    if (ba.failed) parts.push(ba.failed + ' failed');
    if (ba.skipped) parts.push(ba.skipped + ' skipped');
    return parts.join(', ') + ' — ' + ba.files + ' files, ' + (ba.bytes / 1048576).toFixed(1) + ' MB' +
      (ba.ms ? ' in ' + Math.round(ba.ms / 1000) + 's' : '');
  }

  function connectRobot(ip, opts) {
    /* Accept a pasted browser URL — "http://10.5.6.143/" means the robot at
     * 10.5.6.143. The scheme, any path, and a trailing slash all go. A bare
     * ":port" suffix typed by hand survives (that is how a nonstandard FTP
     * port is given), but a URL's port goes with the rest of the URL: it is
     * an HTTP port, and handing it to FTP would only manufacture a failure. */
    ip = String(ip).trim();
    if (/^[a-z]+:\/\//i.test(ip)) {
      ip = ip.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
    }
    if (!ip) return;
    // each robot works against its own stored library
    if (!setLibrary(ip)) return;
    state.robot = { ip: ip, ftpUser: state.robot.ftpUser, ftpPass: state.robot.ftpPass, files: [], registers: null, posregs: null, strregs: null, rawIO: null, ioState: null, ioComments: null, errors: undefined, error: null, loadedAt: null, backup: null, notPrograms: {}, prgState: undefined };
    state.robotCheck = null;   // verdicts belong to the robot they were read from
    state.tab = 'robot';
    render();
    api('/api/robot/list?ip=' + encodeURIComponent(ip) + ftpQS()).then(function (b) {
      state.robot.files = b.files;
      state.robot.loadedAt = new Date();
      render();
      rememberRobot(ip);   // only ever remember one that actually answered
      // survive page refreshes: next load reconnects to this robot by itself
      state.lastRobot = { ip: ip, ftpUser: state.robot.ftpUser || '' };
      savePrefs();
      try { sessionStorage.setItem('fanuc-tp-studio.ftpPass', state.robot.ftpPass || ''); } catch (e) { /* optional */ }
      loadRobotRegisters();
      loadRobotPosregs();
      loadRobotStrregs();
      /* "Import programs" from a saved-robot row: connect (which switched
       * the library to this robot's) and pull everything in one gesture.
       * The Programs section is opened so the chips fill in visibly. */
      if (opts && opts.andImport) {
        var ls = b.files.filter(function (f) { return /\.LS$/i.test(f) && !isKnownNonProgram(f); });
        if (!ls.length) toast('No programs listed on ' + ip + '.');
        else if (confirmCrossSource(ls)) {
          if (!state.secOpen) state.secOpen = {};
          state.secOpen['robot-programs'] = true;
          importAllFromRobot(ls);
        }
      }
    }).catch(function (e) {
      state.robot.error = e.message;
      render();
    });
  }

  function loadRobotRegisters() {
    var ip = state.robot.ip;
    api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=NUMREG.VA' + ftpQS()).then(function (b) {
      state.robot.registers = VA.parseNumreg(b.content);
      state.robot.loadedAt = new Date();
      rebuildDerived();
      if (state.tab === 'robot') render();
    }).catch(function (e) {
      state.robot.registers = { error: e.message };
      if (state.tab === 'robot') render();
    });
  }

  function loadRobotPosregs() {
    var ip = state.robot.ip;
    api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=POSREG.VA' + ftpQS()).then(function (b) {
      state.robot.posregs = VA.parsePosreg(b.content);
      rebuildDerived();
      if (state.tab === 'robot') render();
    }).catch(function (e) {
      state.robot.posregs = { error: e.message };
      if (state.tab === 'robot') render();
    });
  }

  function loadRobotStrregs() {
    var ip = state.robot.ip;
    api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=STRREG.VA' + ftpQS()).then(function (b) {
      state.robot.strregs = VA.parseStrreg(b.content);
      if (state.tab === 'robot') render();
    }).catch(function (e) {
      state.robot.strregs = { error: e.message };
      if (state.tab === 'robot') render();
    });
  }

  /* ---- renaming things on the controller ----
   * A register's name IS its comment: R[1:Task ID] is R[1] plus the comment
   * held in the controller's own table, and every listing the robot writes is
   * generated from that table. So renaming is a comment write, which the
   * bridge makes through the controller's own comment tool.
   *
   * The robot's own page for this saves on blur, and so does this: `change`
   * fires when focus leaves a field whose value actually changed, which means
   * tabbing across a table sends nothing and an untouched field is never
   * rewritten. Enter commits, Escape puts the old name back.
   *
   * Only offered against a live robot through the bridge. A backup folder has
   * no controller to write to, so its tables stay plain text — as do the I/O
   * types the controller's comment tool does not cover (UI, UO, SI, SO, WI,
   * WO): the bridge would refuse them, so they are never offered. */
  var COMMENT_MAX = {
    R: 16, PR: 16, SR: 16,
    DI: 24, DO: 24, RI: 24, RO: 24, GI: 24, GO: 24, AI: 24, AO: 24, F: 24
  };

  function canRename(type) {
    return !!(state.server && state.robot.ip && COMMENT_MAX[type]);
  }

  /* A table cell holding a renameable comment. `apply` writes the new text
   * back into whichever loaded array the row came from, so the new name
   * survives the next render without re-reading the whole file. */
  function commentCell(type, index, current, apply) {
    var td = h('td', { class: 'cmt-cell' });
    var was = current || '';
    if (!canRename(type)) { td.textContent = was; return td; }
    var key = type + '[' + index + ']';
    var max = COMMENT_MAX[type];
    var inp = h('input', {
      type: 'text', class: 'cmt-edit', value: was, maxlength: String(max),
      placeholder: 'name…',
      title: 'Rename ' + key + ' on the controller — up to ' + max + ' characters'
    });
    var note = h('span', { class: 'cmt-note' });
    var busy = false;

    function settle(cls, msg) {
      inp.classList.remove('busy', 'ok', 'bad');
      if (cls) inp.classList.add(cls);
      note.textContent = msg || '';
      if (cls === 'ok') setTimeout(function () {
        inp.classList.remove('ok');
        note.textContent = '';
      }, 2500);
    }

    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      else if (e.key === 'Escape') { inp.value = was; inp.blur(); }
    });

    inp.addEventListener('change', function () {
      var text = inp.value.trim();
      if (busy || text === was) return;
      busy = true;
      inp.disabled = true;
      settle('busy', 'renaming…');
      postJSON('/api/robot/comment', {
        ip: state.robot.ip, type: type, index: index, text: text,
        user: state.robot.ftpUser || undefined, pass: state.robot.ftpPass || undefined
      }).then(function (b) {
        if (!b.ok) throw new Error(b.error || 'the controller did not take the rename');
        was = b.comment;
        inp.value = was;
        apply(was);
        rebuildDerived();          // labels feed the checks and the xref
        settle('ok', b.verified ? 'renamed' : 'sent');
        if (!b.verified && b.verifyError) {
          toast('Renamed ' + key + ' — but could not read it back to confirm: ' + b.verifyError);
        }
      }).catch(function (e) {
        inp.value = was;           // nothing changed on the robot, so show that
        settle('bad', 'failed');
        toast('Could not rename ' + key + ': ' + e.message);
      }).then(function () {
        busy = false;
        inp.disabled = false;
      });
    });

    td.appendChild(inp);
    td.appendChild(note);
    return td;
  }

  function loadRobotErrors() {
    var ip = state.robot.ip;
    state.robot.errors = null;
    render();
    api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=ERRALL.LS' + ftpQS()).then(function (b) {
      state.robot.errors = VA.parseErrall(b.content);
      if (state.tab === 'robot') render();
    }).catch(function (e) {
      state.robot.errors = { error: e.message };
      if (state.tab === 'robot') render();
    });
  }

  /* PRGSTATE.DG answers "why will the controller not let me overwrite this".
   * Read on demand rather than on connect: it is a large file, and it only
   * matters at the moment an edit is being refused. */
  function loadRobotPrgState() {
    var ip = state.robot.ip;
    state.robot.prgState = null;
    render();
    api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=PRGSTATE.DG' + ftpQS()).then(function (b) {
      state.robot.prgState = VA.parsePrgState(b.content);
      if (state.tab === 'robot') render();
    }).catch(function (e) {
      state.robot.prgState = { error: e.message };
      if (state.tab === 'robot') render();
    });
  }

  function loadRobotIO() {
    var ip = state.robot.ip;
    // IOSTATE.DG carries live state + comments in ASCII (DIOCFGSV.IO is binary
    // on many controllers)
    api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=IOSTATE.DG' + ftpQS()).then(function (b) {
      var points = VA.parseIOState(b.content);
      if (!points.length) throw new Error('IOSTATE.DG had no readable points');
      state.robot.ioState = points;
      state.robot.rawIO = null;
      state.robot.ioComments = points.filter(function (p) { return p.comment; });
      rebuildDerived();
      if (state.tab === 'robot') render();
    }).catch(function () {
      api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=DIOCFGSV.IO' + ftpQS()).then(function (b) {
        state.robot.ioState = null;
        state.robot.rawIO = VA.rawLines(b.content);
        state.robot.ioComments = VA.parseIOComments(b.content);
        rebuildDerived();
        if (state.tab === 'robot') render();
      }).catch(function (e) {
        state.robot.rawIO = { error: e.message };
        if (state.tab === 'robot') render();
      });
    });
  }
  function sendToRobot(name, content, onDone) {
    fetch('/api/robot/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ip: state.robot.ip,
        name: name + '.LS',
        content: content,
        user: state.robot.ftpUser || undefined,
        pass: state.robot.ftpPass || undefined
      })
    }).then(function (r) { return r.json(); }).then(function (b) {
      b.sentContent = content; // for mapping controller file-line errors back to program lines
      /* A good send is news for a moment, not a banner that outlives the next
       * edit: it goes out as a toast. A failure stays as the banner, because
       * its controller error log and "fix line" chips are what you work from. */
      if (b.ok) {
        state.upload = null;
        toast(name + '.LS sent to ' + state.robot.ip + ' and verified on the robot' +
          (b.snapshot ? ' — previous version saved in backups\\pre-upload' : '') + '.', 7000);
        // the controller regenerates register/IO comments during LS→TP→LS, so
        // pull its copy straight back — the old FileZilla re-open, automated
        importFromRobot(name + '.LS').then(function () {
          toast(name + '.LS sent and verified — library copy refreshed from the robot (comments regenerated).', 7000);
          render();
        }).catch(function () { /* library still holds what we sent */ });
      } else state.upload = b;
      onDone(b);
    }).catch(function (e) {
      state.upload = { ok: false, name: name + '.LS', error: e.message };
      onDone(state.upload);
    });
  }

  /* The result of the last send. The Robot tab shows it whatever is selected;
   * the Code and editor panes pass the program they are showing, so a note
   * about _PL_PAL_ZONE does not follow you to every other program. */
  function uploadBanner(forProg) {
    var u = state.upload;
    if (!u) return null;
    if (forProg && String(u.name).replace(/\.LS$/i, '').toUpperCase() !== String(forProg).toUpperCase()) return null;
    var el = h('div', { class: 'banner ' + (u.ok ? 'good' : 'bad') });
    if (u.ok) {
      el.appendChild(h('strong', { text: u.name + ' uploaded to ' + state.robot.ip + ' and verified on the robot. ' }));
      if (u.snapshot) el.appendChild(h('span', { text: 'The previous version was snapshotted to ' + u.snapshot + ' before the upload.' }));
    } else {
      el.appendChild(h('strong', { text: u.name + ' — upload failed. ' }));
      el.appendChild(h('span', { text: (u.error || 'unknown error') + ' ' }));
      if (u.restored) el.appendChild(h('span', { text: 'The previous version was automatically restored on the robot from the pre-upload snapshot — nothing was lost. Fix the program here and send again.' }));
      else if (u.snapshot) el.appendChild(h('span', { text: 'Auto-restore did not succeed' + (u.restoreError ? ' (' + u.restoreError + ')' : '') + ' — the previous version is saved at ' + u.snapshot + '.' }));
      else el.appendChild(h('span', { text: 'The program did not exist on the robot before this upload, so there is nothing to restore. Your source is safe in the library.' }));

      // pull the controller's load errors and translate file lines → program lines
      if (u.errlog) {
        var loadErrs = VA.parseErrall(u.errlog).filter(function (e2) { return e2.code && /^(ASBN|MEMO|INTP)/.test(e2.code); }).slice(0, 6);
        if (loadErrs.length) {
          var box = h('div', { class: 'banner-errs' });
          box.appendChild(h('div', {}, [h('strong', { text: 'Controller error log:' })]));
          loadErrs.forEach(function (e2) {
            var row = h('div', { class: 'mono' });
            row.appendChild(document.createTextNode('• ' + e2.code + ' ' + e2.text));
            var lm = e2.text.match(/\bline\s+(\d+)/i);
            if (lm && u.sentContent) {
              var mapped = P.mapFileLine(u.sentContent, parseInt(lm[1], 10));
              if (mapped && mapped.progLine !== null) {
                row.appendChild(document.createTextNode(' — that is program line ' + mapped.progLine + ': "' + mapped.raw.replace(/^\d+\s*:\s*/, '').replace(/\s*;\s*$/, '') + '" '));
                row.appendChild(h('span', {
                  class: 'chip write', text: 'fix line ' + mapped.progLine,
                  title: 'Open the editor with this line selected',
                  onclick: function () { gotoEditorLine(u.name.replace(/\.LS$/i, ''), mapped.progLine); }
                }));
              } else if (mapped) {
                row.appendChild(document.createTextNode(' — file line ' + lm[1] + ' is in the header/positions section: "' + mapped.raw + '"'));
              }
            }
            box.appendChild(row);
          });
          el.appendChild(box);
        }
      }
    }
    el.appendChild(h('button', { class: 'btn subtle', text: 'Dismiss', onclick: function () { state.upload = null; render(); } }));
    return el;
  }

  /* Programs already in the library that came from somewhere OTHER than the
   * currently connected robot and would be overwritten by importing `names`. */
  function crossSourceCollisions(names) {
    return names.map(function (f) { return f.replace(/\.LS$/i, '').toUpperCase(); })
      .filter(function (n) {
        var p = state.programs[n];
        if (!p) return false;
        return !(p.origin.type === 'robot' && p.origin.ip === state.robot.ip);
      });
  }

  function confirmCrossSource(names) {
    var hits = crossSourceCollisions(names);
    if (!hits.length) return true;
    return confirm('The library already has ' + hits.length + ' program' + (hits.length > 1 ? 's' : '') + ' with the same name' + (hits.length > 1 ? 's' : '') + ' from a different source (another robot, a folder, or an upload):\n\n' +
      hits.slice(0, 12).join(', ') + (hits.length > 12 ? ' +' + (hits.length - 12) + ' more' : '') +
      '\n\nImporting from ' + state.robot.ip + ' will REPLACE those library copies. If you want to keep both robots’ versions, take a backup of each robot instead and use the Compare tab.\n\nReplace them?');
  }

  /* A bulk import used to be a bare forEach over every file, which was wrong
   * in three ways: render() ran only once the last file landed, so nothing
   * moved for the whole import and every chip turned green at the same
   * moment; all N files were requested at once, which on a 57-program
   * controller means 57 simultaneous requests at a web server that is not
   * really one; and rebuildDerived() + persist() ran per program, so the
   * whole library was re-analysed and rewritten to localStorage N times.
   *
   * Now: a small pool, a render after every file so the chips fill in as they
   * arrive, and the expensive rebuild exactly once at the end. */
  var IMPORT_CONCURRENCY = 4;

  function importAllFromRobot(names) {
    var queue = names.slice();
    state.robotImport = {
      total: names.length, done: 0, added: 0, skipped: 0, failed: 0,
      inFlight: {}, cancel: false
    };
    render();

    function next() {
      var imp = state.robotImport;
      if (!imp || imp.cancel || !queue.length) return Promise.resolve();
      var name = queue.shift();
      imp.inFlight[name.toUpperCase()] = true;
      return importFromRobot(name, true)
        .then(function (prog) { if (prog) imp.added++; else imp.skipped++; })
        .catch(function () { imp.failed++; })
        .then(function () {
          delete imp.inFlight[name.toUpperCase()];
          imp.done++;
          if (state.tab === 'robot') render();
          return next();
        });
    }

    var runners = [];
    var n = Math.min(IMPORT_CONCURRENCY, queue.length);
    for (var i = 0; i < n; i++) runners.push(next());

    return Promise.all(runners).then(function () {
      var imp = state.robotImport;
      state.robotImport = null;
      // the costly part, once, rather than once per program
      rebuildDerived();
      persist();
      if (!state.selected) state.selected = Object.keys(state.programs).sort()[0] || null;
      if (imp) {
        toast(imp.cancel
          ? 'Import stopped — ' + imp.added + ' of ' + imp.total + ' imported.'
          : 'Imported ' + imp.added + ' program' + (imp.added === 1 ? '' : 's') +
            (imp.skipped ? ' (skipped ' + imp.skipped + ' non-program file' + (imp.skipped === 1 ? '' : 's') + ')' : '') +
            (imp.failed ? ' — ' + imp.failed + ' failed' : '') + '.');
      }
      render();
    });
  }

  function importFromRobot(name, deferRebuild) {
    var ip = state.robot.ip;
    var gen = libGen;
    return api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=' + encodeURIComponent(name) + ftpQS())
      .then(function (b) {
        if (gen !== libGen) return null;   // library switched while this was in flight
        if (!isProgramSource(b.content)) {
          // remember it so the program list stops offering this one
          state.robot.notPrograms[String(name).toUpperCase()] = true;
          // during a bulk import these are counted and summarised at the end
          if (!deferRebuild) toast(b.name + ' is a controller log export, not a TP program — skipped.');
          return null;
        }
        var prog = addProgram(b.content, b.name, { type: 'robot', ip: ip, name: b.name });
        // the library copy IS the robot copy now, so any earlier
        // "differs from robot" verdict for it is settled
        if (prog && state.robotCheck && state.robotCheck.ip === ip) {
          delete state.robotCheck.differs[prog];
          if (state.robotCheck.sources) state.robotCheck.sources[prog] = state.programs[prog].source;
        }
        /* A bulk import defers both: re-analysing the whole library and
         * rewriting localStorage per program is the bulk of the wall clock. */
        if (!deferRebuild) { rebuildDerived(); persist(); }
        return prog;
      });
  }

  /* ---- "did anything change on the robot?" ----
   * Strictly on demand — press the button, the bridge reads each program
   * that exists both in the library and on the controller, and the verdicts
   * land as ≠ badges in the sidebar and the Robot tab. No background
   * polling: a browser tab re-reading every program on a timer is noise on
   * the robot network, and a verdict is only trustworthy with a time on it
   * anyway. */
  function checkRobotChanges() {
    var ip = state.robot.ip;
    if (!ip || (state.robotCheck && state.robotCheck.running)) return;
    var gen = libGen;
    var onRobot = {};
    state.robot.files.forEach(function (f) {
      if (/\.LS$/i.test(f) && !isKnownNonProgram(f)) onRobot[f.replace(/\.LS$/i, '').toUpperCase()] = f;
    });
    var libNames = Object.keys(state.programs);
    var targets = libNames.filter(function (n) { return onRobot[n.toUpperCase()]; });
    var rc = state.robotCheck = {
      running: true, cancel: false, ip: ip, at: null,
      total: targets.length, done: 0, same: 0,
      differs: {},        // NAME -> {name, adds, dels} vs the robot copy
      headerOnly: [],     // only /ATTR noise (dates, sizes) moved
      notOnRobot: libNames.filter(function (n) { return !onRobot[n.toUpperCase()]; }),
      failed: [],
      sources: {}         // NAME -> robot copy, ready to open in Compare
    };
    render();
    var chain = Promise.resolve();
    targets.forEach(function (n) {
      chain = chain.then(function () {
        if (rc.cancel || state.robotCheck !== rc || gen !== libGen) return;
        return api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=' + encodeURIComponent(onRobot[n.toUpperCase()]) + ftpQS())
          .then(function (b) {
            if (gen !== libGen || !state.programs[n]) return;
            rc.sources[n] = b.content;
            var robotSide = {}; robotSide[n] = b.content;
            var librarySide = {}; librarySide[n] = state.programs[n].source;
            var res = D.comparePrograms(robotSide, librarySide, diffOpts());
            if (res.changed.length) rc.differs[n] = res.changed[0];
            else if (res.headerOnly.length) rc.headerOnly.push(n);
            else rc.same++;
          })
          .catch(function () { rc.failed.push(n); })
          .then(function () {
            rc.done++;
            if (state.tab === 'robot' || rc.done >= rc.total) render();
          });
      });
    });
    chain.then(function () {
      if (state.robotCheck !== rc) return;
      rc.running = false;
      rc.at = new Date();
      render();
    });
  }

  function openDirectory(dirPath) {
    state.dirStatus = 'Reading ' + dirPath + '…';
    renderConnect();
    api('/api/dir/list?path=' + encodeURIComponent(dirPath)).then(function (b) {
      // pick up controller label data if the folder is a backup
      var numreg = b.files.find(function (f) { return /^numreg\.va$/i.test(f.name); });
      var iocfg = b.files.find(function (f) { return /^diocfgsv\.io$/i.test(f.name); });
      var iostate = b.files.find(function (f) { return /^iostate\.dg$/i.test(f.name); });
      var posregVa = b.files.find(function (f) { return /^posreg\.va$/i.test(f.name); });
      var extern = { source: 'backup ' + b.path, registers: null, io: null, posregs: null };
      var externLoads = [];
      if (numreg) externLoads.push(api('/api/dir/file?path=' + encodeURIComponent(numreg.path)).then(function (f) {
        extern.registers = VA.parseNumreg(f.content);
      }).catch(function () {}));
      if (posregVa) externLoads.push(api('/api/dir/file?path=' + encodeURIComponent(posregVa.path)).then(function (f) {
        extern.posregs = VA.parsePosreg(f.content);
      }).catch(function () {}));
      if (iostate) externLoads.push(api('/api/dir/file?path=' + encodeURIComponent(iostate.path)).then(function (f) {
        extern.io = VA.parseIOState(f.content).filter(function (p) { return p.comment; });
      }).catch(function () {}));
      else if (iocfg) externLoads.push(api('/api/dir/file?path=' + encodeURIComponent(iocfg.path)).then(function (f) {
        extern.io = VA.parseIOComments(f.content);
      }).catch(function () {}));
      Promise.all(externLoads).then(function () {
        if (extern.registers || extern.io || extern.posregs) { state.dirExtern = extern; rebuildDerived(); render(); }
      });

      var lsFiles = b.files.filter(function (f) { return /\.ls$/i.test(f.name); });
      if (!lsFiles.length) {
        state.dirStatus = 'No .LS files found in ' + b.path;
        renderConnect();
        return;
      }
      var pending = lsFiles.length;
      var imported = 0, skipped = 0;
      var gen = libGen;
      lsFiles.forEach(function (f) {
        api('/api/dir/file?path=' + encodeURIComponent(f.path)).then(function (file) {
          if (gen !== libGen) { skipped++; return; }   // library switched mid-load
          if (isProgramSource(file.content)) {
            addProgram(file.content, file.name, { type: 'dir', path: file.path });
            imported++;
          } else skipped++;
        }).catch(function () { /* unreadable file — skip */ }).then(function () {
          if (--pending === 0) {
            state.dirStatus = 'Loaded ' + imported + ' program' + (imported === 1 ? '' : 's') + (skipped ? ' (+' + skipped + ' log files skipped)' : '') + ' from ' + b.path;
            state.selected = state.selected || Object.keys(state.programs)[0];
            rebuildDerived();
            persist();
            render();
          }
        });
      });
    }).catch(function (e) {
      state.dirStatus = e.message;
      renderConnect();
    });
  }

  /* ================= helpers ================= */

  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'text') el.textContent = attrs[k];
      else if (k === 'html') el.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function current() { return state.selected ? state.programs[state.selected] : null; }

  function gotoLine(prog, lineNum) {
    state.selected = prog;
    state.tab = 'code';
    state.editing = false;
    render();
    requestAnimationFrame(function () {
      var el = document.querySelector('[data-line="' + lineNum + '"]');
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('flash');
        setTimeout(function () { el.classList.remove('flash'); }, 1600);
      }
    });
  }

  /* Collapsible section header (h3). Collapse state is per-session. */
  function secHead(title, key, defaultOpen) {
    if (!state.secOpen) state.secOpen = {};
    var open = (key in state.secOpen) ? state.secOpen[key] : (defaultOpen !== false);
    var el = h('h3', { class: 'sec-toggle' }, [
      h('span', { class: 'xi-caret', text: open ? '▾' : '▸' }),
      document.createTextNode(' ' + title)
    ]);
    el.addEventListener('click', function () {
      state.secOpen[key] = !open;
      render();
    });
    return { el: el, open: open };
  }

  /* Open the EDITOR on a program with a specific TP line selected and
   * scrolled into view — used by the failed-upload banner, where the next
   * action is always "fix that line". Keeps an already-open editor (and any
   * unsaved changes) intact and just moves the selection. */
  function gotoEditorLine(progName, progLine) {
    state.selected = progName;
    state.tab = 'code';
    var needRender = !(state.editing && document.querySelector('textarea.editor'));
    if (needRender) {
      state.editing = true;
      render();
    }
    requestAnimationFrame(function () {
      var ta = document.querySelector('textarea.editor');
      if (!ta) return;
      var lines = ta.value.split('\n');
      var re = new RegExp('^\\s*' + progLine + '\\s*:');
      var offset = 0, target = -1;
      for (var i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) { target = i; break; }
        offset += lines[i].length + 1;
      }
      if (target === -1) return;
      ta.focus();
      ta.setSelectionRange(offset, offset + lines[target].length);
      var lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.scrollTop = Math.max(0, target * lh - ta.clientHeight / 3);
    });
  }

  function chip(ref, cls) {
    return h('span', {
      class: 'chip ' + cls,
      text: ref.prog + ':' + ref.line,
      title: (cls === 'write' ? 'written' : 'read') + ' at ' + ref.prog + ' line ' + ref.line,
      onclick: function () { gotoLine(ref.prog, ref.line); }
    });
  }

  /* ================= syntax highlighting ================= */

  /* A comment line is shown as the listing has it: "! remark" stays a remark
   * and "//PAUSE" stays a disabled instruction — on a FANUC those are two
   * different things, and the controller keeps the marker you wrote. */
  function highlight(line) {
    if (line.comment !== null) {
      return '<span class="tok-cmt">' + esc(line.text) + '</span>';
    }
    return tokenize(esc(line.text), true);
  }

  /* Colour the instruction text of one already-HTML-escaped TP line.
   * live=true additionally swaps register/PR/IO comments for the
   * controller's CURRENT names (from NUMREG.VA etc.) — display only, and
   * never for the editor overlay, which must align with the raw text. */
  function tokenize(s, live) {
    var ln = live ? state.liveNames : null;

    function liveSpan(cls, shown) {
      // title stays free of ON/OFF etc. — later keyword passes rescan the
      // whole string and would mangle spans inside an attribute
      return '<span class="' + cls + ' tok-livename" title="Name from controller data">' + shown + '</span>';
    }

    s = s.replace(/(MESSAGE\[)([^\]]*)(\])/g, '<span class="tok-kw">$1</span><span class="tok-str">$2</span><span class="tok-kw">$3</span>');
    s = s.replace(/\bLBL\[[^\]]*\]/g, function (m0) { return '<span class="tok-lbl">' + m0 + '</span>'; });
    s = s.replace(/\b(CALL|RUN)\s+([A-Z_][A-Z0-9_]*)/g, function (_, kw, name) {
      return '<span class="tok-kw">' + kw + '</span> <span class="tok-call" data-call="' + name + '">' + name + '</span>';
    });
    s = s.replace(/\b(PR|AR|SR|GP\d+)\[[^\]]*\]/g, function (m0, kind) {
      if (ln && kind === 'PR') {
        var pm = m0.match(/^PR\[\s*(\d+)((?:\s*,\s*\d+)?)\s*(?::([^\]]*))?\]$/);
        if (pm && ln.pr[pm[1]] !== undefined) {
          return liveSpan('tok-reg', 'PR[' + pm[1] + pm[2] + ':' + esc(ln.pr[pm[1]]) + ']', pm[3]);
        }
      }
      return '<span class="tok-reg">' + m0 + '</span>';
    });
    s = s.replace(/(^|[^A-Z>])(R\[[^\]]*\])/g, function (_, pre, r) {
      if (ln) {
        var rm = r.match(/^R\[\s*(\d+)\s*(?::([^\]]*))?\]$/);
        if (rm && ln.r[rm[1]] !== undefined) {
          return pre + liveSpan('tok-reg', 'R[' + rm[1] + ':' + esc(ln.r[rm[1]]) + ']', rm[2]);
        }
      }
      return pre + '<span class="tok-reg">' + r + '</span>';
    });
    s = s.replace(/\b(DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|AI|AO|WI|WO|F|M|TIMER)\[[^\]]*\]/g, function (m0, type) {
      if (ln && type !== 'TIMER') {
        var im = m0.match(/^[A-Z]+\[\s*(\d+)\s*(?::([^\]]*))?\]$/);
        if (im && ln.io[type + '[' + im[1] + ']'] !== undefined) {
          return liveSpan('tok-io', type + '[' + im[1] + ':' + esc(ln.io[type + '[' + im[1] + ']']) + ']', im[2]);
        }
      }
      return '<span class="tok-io">' + m0 + '</span>';
    });
    s = s.replace(/\bP\[[^\]]*\]/g, function (m0) { return '<span class="tok-num">' + m0 + '</span>'; });
    s = s.replace(/\bON\b/g, '<span class="tok-on">ON</span>');
    s = s.replace(/\bOFF\b/g, '<span class="tok-off">OFF</span>');
    s = s.replace(/\b(IF|THEN|ELSE|ENDIF|SELECT|FOR|ENDFOR|TO|JMP|WAIT|TIMEOUT|SKIP|CONDITION|PULSE|END|ABORT|PAUSE|UALM|OVERRIDE|PAYLOAD|UFRAME_NUM|UTOOL_NUM|MOD|DIV|AND|OR|NOT|START|STOP|RESET|Offset|Tool_Offset)\b/g,
      '<span class="tok-kw">$1</span>');
    s = s.replace(/\b(FINE|CNT\d+|ACC\d+|max_speed|BREAK|RTCP|Wjnt|PTH)\b/g, '<span class="tok-num">$1</span>');
    return s;
  }

  /* Highlight raw .LS text for the editor overlay. Unlike highlight(), which
   * works on parsed lines, this sees the file as typed — section markers,
   * TP line numbers, /ATTR entries and all — so the <pre> underneath the
   * textarea lines up character for character with what is being edited. */
  function highlightSource(src) {
    return String(src).split('\n').map(highlightSourceLine).join('\n');
  }

  function highlightSourceLine(raw) {
    if (!raw) return '';
    if (/^\s*\//.test(raw)) return '<span class="tok-kw">' + esc(raw) + '</span>'; // /PROG, /MN, /POS, /END
    var m = raw.match(/^(\s*\d+:)([\s\S]*)$/);
    if (!m) return tokenize(esc(raw));
    var num = '<span class="tok-ln">' + esc(m[1]) + '</span>';
    var cm = m[2].match(/^(\s*)((?:!|\/\/).*)$/);   // ! remark, or a //disabled instruction
    if (cm) return num + esc(cm[1]) + '<span class="tok-cmt">' + esc(cm[2]) + '</span>';
    return num + tokenize(esc(m[2]));
  }

  /* ================= occurrence highlighting =================
   * Notepad++-style: select text in the code view and every other instance
   * lights up. Selecting inside a register/PR/IO token highlights every
   * reference to that ITEM (labeled or not) — e.g. select PR[6] and
   * PR[6:pallet base] lights up too. */

  var occLast = null;

  function clearOccurrences() {
    occLast = null;
    if (window.CSS && CSS.highlights) CSS.highlights.delete('tp-occ');
  }

  function updateOccurrences() {
    if (!(window.Highlight && window.CSS && CSS.highlights)) return; // older browser — feature off
    var sel = window.getSelection();
    var text = sel ? String(sel).trim() : '';
    var itemRe = null;
    if (text && text.length >= 2 && text.length <= 60 && text.indexOf('\n') === -1) {
      var node = sel.anchorNode;
      var el = node && (node.nodeType === 3 ? node.parentElement : node);
      var tokEl = el && el.closest ? el.closest('.tok-reg, .tok-io, .tok-lbl') : null;
      /* Inside the editor the anchor is the <textarea>, never a token span,
       * so there is nothing to close() on. Read the item off the selected
       * text instead, which gives edit mode the same item-aware matching the
       * viewer has: select R[1] and R[1:part count] lights up too. */
      var ITEM_HEAD = /^(R|PR|AR|SR|DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|AI|AO|F|M|TIMER|LBL)\[\s*(\d+)/;
      var m = (tokEl ? tokEl.textContent : text).match(ITEM_HEAD);
      // component references (PR[20,1]) count as uses; indices may be padded (LBL[ 610])
      if (m) itemRe = new RegExp('\\b' + m[1] + '\\[\\s*' + m[2] + '(?:\\s*,\\s*\\d+)?\\s*(?::[^\\]]*)?\\]', 'g');
    } else {
      text = '';
    }
    var key = itemRe ? 'item:' + itemRe.source : (text ? 'text:' + text : null);
    // the editor's overlay is rebuilt as you type, so its ranges go stale
    if (key === occLast && !document.querySelector('.pane.editing')) return;
    occLast = key;
    CSS.highlights.delete('tp-occ');
    if (!key) return;

    var ranges = [];
    document.querySelectorAll('#pane .codebox .src, #pane .editor-hl').forEach(function (srcEl) {
      var walker = document.createTreeWalker(srcEl, NodeFilter.SHOW_TEXT);
      var tn;
      while ((tn = walker.nextNode()) && ranges.length < 2000) {
        var t = tn.nodeValue;
        if (itemRe) {
          itemRe.lastIndex = 0;
          var mm;
          while ((mm = itemRe.exec(t)) !== null) {
            var r = new Range();
            r.setStart(tn, mm.index);
            r.setEnd(tn, mm.index + mm[0].length);
            ranges.push(r);
          }
        } else {
          var from = 0, idx;
          while ((idx = t.indexOf(text, from)) !== -1) {
            var r2 = new Range();
            r2.setStart(tn, idx);
            r2.setEnd(tn, idx + text.length);
            ranges.push(r2);
            from = idx + text.length;
          }
        }
      }
    });
    if (ranges.length) {
      var hl = new Highlight();
      ranges.forEach(function (r) { hl.add(r); });
      CSS.highlights.set('tp-occ', hl);
    }
  }

  var occTimer = null;
  document.addEventListener('selectionchange', function () {
    clearTimeout(occTimer);
    occTimer = setTimeout(updateOccurrences, 120);
  });

  /* ================= browser-history navigation =================
   * Every view change (tab / program / split) becomes a history entry,
   * so the mouse back/forward buttons walk the view trail —
   * Flow → click a block → Code → back button → Flow again. */

  var nav = { restoring: false, last: null };

  function navSnapshot() {
    return { tab: state.tab, selected: state.selected, split: state.splitDoc, active: state.activeDoc };
  }

  function sameNav(a, b) {
    return a && b && a.tab === b.tab && a.selected === b.selected && a.split === b.split && a.active === b.active;
  }

  function recordNav() {
    var snap = navSnapshot();
    if (nav.restoring || sameNav(snap, nav.last)) { nav.last = snap; return; }
    try {
      if (nav.last === null) history.replaceState(snap, '');
      else history.pushState(snap, '');
    } catch (e) { /* history unavailable (some sandboxes) — nav buttons just won't work */ }
    nav.last = snap;
  }

  function onPopState(e) {
    var s = e.state;
    if (!s || !s.tab) return;
    if (state.editing || state.editSide) {
      if (editorDirty() && !confirm('Leave the editor? Unsaved changes will be lost.')) {
        try { history.pushState(navSnapshot(), ''); } catch (err) { /* ignore */ }
        return;
      }
      state.editing = false;
      state.editSide = null;
      state.editDraft = null;
    }
    state.tab = s.tab;
    if (s.selected && state.programs[s.selected]) state.selected = s.selected;
    state.splitDoc = docValid(s.split) ? s.split : null;
    if (docValid(s.active)) {
      state.activeDoc = s.active;
      if (docIsProg(s.active)) docSelSync = state.selected = docProg(s.active);
    }
    nav.restoring = true;
    render();
    nav.restoring = false;
  }

  /* ================= renderers ================= */

  function render() {
    recordNav();
    clearOccurrences(); // the DOM is rebuilt — stale highlight ranges go with it
    if (state.tab !== 'flow') { cfg = null; cfgHideTip(); }
    applyFlowNav();
    renderSidebar();
    renderConnect();
    renderTabs();
    renderPane();
    saveViewState();   // a refresh reopens exactly this view
  }

  /* Library filter: whitespace-separated words are ANDed, each matched as a
   * substring of "NAME comment", in any order — so "set task" finds both
   * _SET_TASK and _TASK_SETUP, and "pick pallet" finds PICK whether "pallet"
   * is in the name or only in its comment. */
  function libMatch(name, terms) {
    var p = state.programs[name];
    var hay = (name + ' ' + (p.parsed.attrs.COMMENT || '') + ' ' + (p.origin.dir || '')).toLowerCase();
    return terms.every(function (t) { return hay.indexOf(t) !== -1; });
  }

  /* Off-canvas program library (narrow screens only — the class is inert at
   * desktop widths, where the sidebar is always in the grid). */
  function setNav(open) {
    var app = document.querySelector('.app');
    if (!app) return;
    app.classList.toggle('nav-open', open);
    var btn = document.getElementById('btn-nav');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function navOpen() {
    var app = document.querySelector('.app');
    return !!app && app.classList.contains('nav-open');
  }

  /* Which robot's library is showing. Hidden until a second library exists,
   * so a single-robot (or robot-less) setup never sees it. Picking one only
   * swaps the program set — it does not connect to the robot, so a robot's
   * programs stay browsable from the couch. Connecting is what switches it
   * automatically. */
  function paintLibraryPicker() {
    var row = document.getElementById('lib-ws-row');
    var sel = document.getElementById('lib-ws');
    if (!row || !sel) return;
    var ids = listLibraries();
    row.hidden = ids.length < 2;
    if (row.hidden) return;
    var key = ids.map(libLabel).join(',') + '#' + state.library;
    if (sel.getAttribute('data-key') !== key) {
      sel.innerHTML = '';
      ids.forEach(function (id) {
        sel.appendChild(h('option', { value: id, text: libLabel(id) }));
      });
      sel.setAttribute('data-key', key);
    }
    sel.value = state.library;
  }

  /* The shop convention: own programs are prefixed A_ or _, everything else
   * is the controller's furniture (-BCKED*-, RSR0001, SV_ADJST…). */
  function isOwnProgram(n) { return /^(?:A_|_)/i.test(n); }

  function renderSidebar() {
    paintLibraryPicker();
    var list = document.getElementById('prog-list');
    list.innerHTML = '';
    var all = Object.keys(state.programs).sort();
    var shown = state.showAllProgs ? all : all.filter(isOwnProgram);
    var hidden = all.length - shown.length;
    var cb = document.getElementById('lib-showall');
    if (cb) cb.checked = !!state.showAllProgs;
    var hc = document.getElementById('lib-hidden-count');
    if (hc) hc.textContent = (!state.showAllProgs && hidden) ? '· ' + hidden + ' hidden' : '';
    var q = (document.getElementById('lib-filter').value || '').trim();
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    var names = !terms.length ? shown : shown.filter(function (n) { return libMatch(n, terms); });
    document.getElementById('lib-count').textContent =
      !all.length ? '' :
      terms.length ? names.length + ' of ' + shown.length :
      shown.length + ' program' + (shown.length === 1 ? '' : 's');
    if (!all.length) {
      list.appendChild(h('div', { class: 'empty', text: 'No programs yet. Import .LS files or open a backup folder.' }));
      return;
    }
    if (!shown.length) {
      list.appendChild(h('div', { class: 'empty', text: 'All ' + all.length + ' programs here are hidden by the A_/_ prefix filter — tick “Show all” above to list them.' }));
      return;
    }
    if (!names.length) {
      list.appendChild(h('div', { class: 'empty', text: 'No programs match “' + q + '”.' }));
      return;
    }
    names.forEach(function (n) {
      var p = state.programs[n];
      var meta = p.parsed.lines.length + ' lines';
      if (p.origin.type === 'robot') meta += ' · from ' + p.origin.ip;
      else if (p.origin.type === 'dir') meta += ' · on disk';
      else if (p.origin.folder) meta += ' · from ' + p.origin.folder;
      else if (p.parsed.attrs.COMMENT) meta += ' · ' + p.parsed.attrs.COMMENT;
      var dif = robotDiffers(n);
      var item = h('button', {
        class: 'prog-item' + (n === state.selected ? ' active' : ''),
        draggable: 'true',
        title: (p.origin.dir ? 'From ' + p.origin.dir + '/ · ' : '') + 'Click to open · drag onto the code view to open side-by-side',
        onclick: function () { setNav(false); activateDoc('P:' + n); }
      }, [
        h('div', { class: 'name' }, [
          document.createTextNode(n),
          dif ? h('span', {
            class: 'badge warn rc-badge', text: '≠ robot',
            title: 'The copy on ' + state.robot.ip + ' differs from this library copy (+' + dif.adds + '/−' + dif.dels + ' lines) — from the last “Check robot for changes”'
          }) : null
        ]),
        h('div', { class: 'meta', text: meta })
      ]);
      item.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/x-prog', n);
        e.dataTransfer.effectAllowed = 'link';
      });
      list.appendChild(item);
    });
  }

  /* Sidebar robot picker. It replaced a bare IP text box that could not
   * carry FTP credentials (so a controller needing FTP auth failed as though
   * it were unreachable), did not know the saved robot names, and duplicated
   * the Robot tab's own field. Its second job is to show which robot you are
   * on from any tab — without that, a Compare against the wrong controller
   * looks perfectly plausible. */
  var ROBOT_PICK_TAB = '__robot_tab__';

  function robotPickerKey() {
    return state.knownRobots.map(function (r) {
      return r.ip + '|' + (r.name || '') + '|' + (state.robotProbe[r.ip] || '');
    }).join(',') + '#' + (state.robot.ip || '');
  }

  function paintRobotPicker() {
    var sel = document.getElementById('robot-select');
    if (!sel) return;
    /* Only rebuild when the list or a status dot actually changed: probes
     * land asynchronously and re-render, and swapping the options out from
     * under an open menu would close it mid-choice. */
    var key = robotPickerKey();
    if (sel.getAttribute('data-key') !== key) {
      sel.innerHTML = '';
      if (!state.knownRobots.length) {
        sel.appendChild(h('option', { value: '', text: 'No saved robots yet' }));
      } else {
        sel.appendChild(h('option', { value: '', text: state.robot.ip ? 'Switch robot…' : 'Pick a robot…' }));
        state.knownRobots.forEach(function (r) {
          var st = state.robotProbe[r.ip];
          // ● answering · ○ not answering · · still checking
          var dot = st === 'up' ? '● ' : st === 'down' ? '○ ' : '· ';
          sel.appendChild(h('option', {
            value: r.ip,
            text: dot + (r.name ? r.name + '  —  ' + r.ip : r.ip)
          }));
        });
      }
      sel.appendChild(h('option', { value: ROBOT_PICK_TAB, text: '→ Robot tab (new IP, FTP, scan)' }));
      sel.setAttribute('data-key', key);
    }
    var known = state.knownRobots.some(function (r) { return r.ip === state.robot.ip; });
    sel.value = (state.robot.ip && known) ? state.robot.ip : '';
  }

  function renderConnect() {
    var hint = document.getElementById('server-hint');
    var dot = document.getElementById('bridge-dot');
    var robotRow = document.getElementById('robot-row');
    var dirRow = document.getElementById('dir-row');
    if (!hint) return;
    if (state.server) {
      robotRow.style.display = '';
      dirRow.style.display = '';
      /* The bridge being on is the normal case — it is how the app is
       * started — so it says so with a dot in the "Sources" heading, which
       * is on screen anyway, and costs no vertical space of its own. The
       * explanation is on hover; the off state is the one worth words. */
      if (dot) {
        dot.hidden = false;
        dot.setAttribute('aria-label', 'Bridge on');
        dot.title = 'Bridge on — robot by IP, folder by path, uploads, backups and scanning are available';
      }
      // a folder-load result is real news, so it still gets a line
      paintRobotPicker();
      hint.innerHTML = state.dirStatus ? esc(state.dirStatus) : '';
      hint.hidden = !state.dirStatus;
    } else {
      robotRow.style.display = 'none';
      dirRow.style.display = 'none';
      if (dot) dot.hidden = true;
      hint.hidden = false;
      hint.innerHTML = 'Robot &amp; folder-path access need the bridge:<br><code>node server.js</code> then open <code>http://localhost:8642</code>. The Robot tab has details.';
    }
    var phoneBtn = document.getElementById('btn-phone');
    // Only the bridge serves this app to other devices; a file:// page has
    // no address it could hand a phone.
    if (phoneBtn) phoneBtn.hidden = !state.server;
  }

  /* ================= open on a phone =================
   * The bridge already serves the whole app to anything on the network; the
   * only friction is typing http://<pc-ip>:8642 into a phone one-handed at a
   * machine. A QR code on the PC screen removes it — point the camera, tap
   * the notification, and the phone has the same app with live robot access.
   */
  var phoneDlg = null;
  var phoneHost = null;      // which address is showing, kept between opens

  function isLoopbackHost(host) {
    return !host || host === 'localhost' || host === '::1' || host === '[::1]' ||
           host === '0.0.0.0' || /^127\./.test(host);
  }

  /* The bridge ranks its interfaces for finding robots — wired first, because
   * that is where controllers live (see localSubnets()). A phone wants very
   * nearly the opposite: it joins the Wi-Fi, and a plant PC's wired entries
   * are often /30 point-to-point links with room for this PC and one
   * controller and nothing else. So the addresses get ranked again here:
   * wireless, then wired networks big enough to hold a phone, then those
   * tiny direct links, then the host-only and VPN adapters no phone is on. */
  var PHONE_RANK = { wireless: 0, wired: 1, virtual: 3, overlay: 3 };

  function phoneRank(s) {
    if (s.kind === 'wired' && s.hosts < 6) return 2;
    return PHONE_RANK[s.kind];
  }

  /* Every address a phone could reach this bridge on, best first. */
  function phoneTargets() {
    var proto = location.protocol === 'https:' ? 'https://' : 'http://';
    var port = location.port ? ':' + location.port : '';
    var out = [];
    var seen = {};
    function add(host, iface, note) {
      if (!host || seen[host]) return;
      seen[host] = true;
      out.push({ host: host, url: proto + host + port, iface: iface, note: note || '' });
    }
    /* An address this very page was served on is the one address already
     * proven to work from somewhere other than the bridge PC, so it leads.
     * localhost never qualifies — it means "me" on whatever device reads it. */
    if (!isLoopbackHost(location.hostname)) add(location.hostname, 'this page', '');
    var ranked = (state.subnets || []).slice().sort(function (a, b) { return phoneRank(a) - phoneRank(b); });
    ranked.forEach(function (s) {
      add(s.address, s.iface, s.kind === 'wired' && s.hosts < 6
        ? ' (a direct link with room for one other device — almost certainly a robot, not a phone)'
        : KIND_NOTE[s.kind]);
    });
    return out;
  }

  function copyToClipboard(text, btn) {
    function done(ok) {
      btn.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      setTimeout(function () { btn.textContent = 'Copy link'; }, 1600);
    }
    /* navigator.clipboard needs a secure context, and the whole point of this
     * dialog is a plain-http LAN address — so the textarea fallback is the
     * path that actually runs most of the time, not a legacy branch. */
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    /* Inside the dialog, not on <body>: everything outside an open modal
     * dialog is inert, and an inert textarea cannot take the selection the
     * copy command needs. */
    var ta = h('textarea', { style: 'position:fixed;top:-1000px;opacity:0' });
    ta.value = text;
    phoneDlg.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    phoneDlg.removeChild(ta);
    done(ok);
  }

  function paintPhoneDialog() {
    var targets = phoneTargets();
    phoneDlg.innerHTML = '';
    var head = h('div', { class: 'phone-head' }, [
      h('h2', { text: 'Open on your phone' }),
      h('button', { class: 'btn subtle', text: '✕', 'aria-label': 'Close',
                    onclick: function () { phoneDlg.close(); } })
    ]);
    phoneDlg.appendChild(head);

    if (!targets.length) {
      phoneDlg.appendChild(h('p', { class: 'muted', text: 'This PC reports no network address other than its own loopback, so there is nothing a phone could connect to. Check that it is on the plant network (wired or Wi‑Fi), then reopen this.' }));
      return;
    }

    var target = null;
    for (var i = 0; i < targets.length; i++) if (targets[i].host === phoneHost) target = targets[i];
    if (!target) { target = targets[0]; phoneHost = target.host; }

    var art = h('div', { class: 'phone-qr' });
    try {
      art.innerHTML = FanucQR.svg(target.url, { size: 232, label: target.url });
    } catch (e) {
      art.appendChild(h('p', { class: 'muted', text: 'Could not draw the code: ' + e.message }));
    }
    phoneDlg.appendChild(art);

    phoneDlg.appendChild(h('div', { class: 'phone-url' }, [
      h('code', { text: target.url }),
      h('button', { class: 'btn subtle', text: 'Copy link',
                    onclick: function () { copyToClipboard(target.url, this); } })
    ]));

    /* A plant PC usually has several networks and only the person standing
     * there knows which one the phone's Wi-Fi lands on, so every address is
     * offered rather than guessed at. */
    if (targets.length > 1) {
      var pick = h('div', { class: 'phone-pick' });
      pick.appendChild(h('span', { class: 'muted', text: 'Address:' }));
      targets.forEach(function (t) {
        pick.appendChild(h('button', {
          class: 'btn subtle opt' + (t.host === target.host ? ' active' : ''),
          text: t.host,
          title: t.iface + t.note,
          onclick: function () { phoneHost = t.host; paintPhoneDialog(); }
        }));
      });
      phoneDlg.appendChild(pick);
    }

    phoneDlg.appendChild(h('p', { class: 'muted phone-hint', text:
      'Point the phone’s camera at the code. The phone has to be on the same network as this PC, and the bridge has to stay running — the phone is talking to it, not to a copy of the app.' +
      (target.note ? ' This one is on ' + target.iface + target.note + '.' : '') }));
  }

  function openPhoneDialog() {
    if (!phoneDlg) {
      phoneDlg = h('dialog', { class: 'phone-dlg', 'aria-label': 'Open on your phone' });
      // clicking the backdrop lands on the dialog element itself
      phoneDlg.addEventListener('click', function (e) { if (e.target === phoneDlg) phoneDlg.close(); });
      document.body.appendChild(phoneDlg);
    }
    /* The address list arrives with /api/net; if the ping is still in flight
     * the dialog would open empty, so ask for it and repaint when it lands. */
    if (!state.subnets) loadSubnets().then(function () { if (phoneDlg.open) paintPhoneDialog(); });
    paintPhoneDialog();
    if (!phoneDlg.open) phoneDlg.showModal();
  }

  /* Robot leads: it is where a session starts (connect, then import), and it
   * is the one tab that works with an empty library. */
  var TABS = [
    ['robot', 'Robot'],
    ['code', 'Code'],
    ['summary', 'Summary'],
    ['flow', 'Flow'],
    ['checks', 'Checks'],
    ['compare', 'Compare'],
    ['positions', 'Positions'],
    ['xref', 'Cross-reference'],
    ['search', 'Search']
  ];

  /* Ctrl+E (Studio 5000 style): cross-reference the selected text.
   * Recognizes R[n], PR[n], I/O points, TIMER[n], and program names. */
  function crossRefToken(raw) {
    var t = (raw || '').trim();
    if (!t) { state.tab = 'search'; render(); return; }
    var m = t.match(/^(R|PR|DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|AI|AO|F|M|TIMER|LBL|AR)\s*\[\s*(\d+)/i);
    if (m) t = m[1].toUpperCase() + '[' + m[2] + ']';
    else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && state.programs[t.toUpperCase()]) t = t.toUpperCase();
    state.searchQuery = t;
    state.tab = 'search';
    render();
  }

  function selectedText() {
    var el = document.activeElement;
    if (el && el.tagName === 'TEXTAREA') {
      var sel = el.value.slice(el.selectionStart, el.selectionEnd);
      if (sel) return sel;
      // no selection: take the token around the cursor
      var pos = el.selectionStart;
      var left = el.value.slice(0, pos).match(/[A-Za-z0-9_$]*(\[\s*\d*)?$/);
      var right = el.value.slice(pos).match(/^[A-Za-z0-9_$]*(\[\s*\d+\s*\])?/);
      return ((left ? left[0] : '') + (right ? right[0] : '')).trim();
    }
    var s = window.getSelection && window.getSelection();
    return s ? String(s) : '';
  }

  function renderTabs() {
    var bar = document.getElementById('tabs');
    bar.innerHTML = '';
    var problemCount = visibleFindings().filter(function (f) { return f.severity !== 'info'; }).length;
    TABS.forEach(function (t) {
      var label = t[1];
      if (t[0] === 'checks' && problemCount) label += ' (' + problemCount + ')';
      bar.appendChild(h('button', {
        class: 'tab' + (state.tab === t[0] ? ' active' : ''),
        text: label,
        onclick: function () { state.tab = t[0]; render(); }
      }));
    });
  }

  function renderPane() {
    var pane = document.getElementById('pane');
    pane.className = 'pane';
    pane.innerHTML = '';
    var needsProgram = ['code', 'summary', 'flow', 'positions'].indexOf(state.tab) !== -1;
    if (!Object.keys(state.programs).length && needsProgram) {
      pane.appendChild(h('div', { class: 'placeholder' }, [
        h('h2', { text: 'FANUC TP Program Studio' }),
        h('p', { text: 'View, edit, check, and understand FANUC teach pendant programs. Import ASCII listing files (.LS), open a backup folder, or connect to a robot by IP (Robot tab).' }),
        h('div', { class: 'drop-hint' }, [
          h('p', { text: 'Drag .LS files anywhere in this window,' }),
          h('p', { text: 'or use Import .LS files / Import folder above.' })
        ])
      ]));
      return;
    }
    switch (state.tab) {
      case 'code': renderCode(pane); break;
      case 'summary': renderSummary(pane); break;
      case 'flow': renderFlow(pane); break;
      case 'checks': renderChecks(pane); break;
      case 'compare': renderCompare(pane); break;
      case 'positions': renderPositions(pane); break;
      case 'xref': renderXref(pane); break;
      case 'search': renderSearch(pane); break;
      case 'robot': renderRobot(pane); break;
    }
  }

  /* ---- code tab (view + edit + side-by-side) ---- */

  /* A finding's note. The message is a full sentence of prose, so it steps
   * out of the monospace grid into the interface font — and out of
   * --code-size, which exists to scale program text, not paragraphs. */
  function findingNote(progName, f) {
    var note = h('div', { class: 'cnote' }, [
      h('div', { class: 'cn-row' }, [
        h('div', { class: 'cn-head' }, [
          h('span', { class: 'badge ' + (f.severity === 'error' ? 'warn' : 'mid'), text: SEV_LABEL[f.severity] }),
          h('span', { class: 'cn-rule', text: RULE_NAMES[f.rule] || f.rule })
        ]),
        h('div', { class: 'cn-msg', text: f.message })
      ])
    ]);
    note.appendChild(h('button', {
      class: 'btn subtle cn-open', text: 'All checks for ' + progName + ' →',
      title: 'Open the Checks tab, filtered to this program',
      onclick: function () { state.checksProg = progName; state.tab = 'checks'; render(); }
    }));
    return note;
  }

  function buildCodeBox(p) {
    var box = h('div', { class: 'codebox' });
    // highlighting is pure per line, so cache the HTML per program object —
    // a re-parse makes a new object, and new controller name data bumps
    // namesRev, either way giving a fresh cache
    if (p.hlRev !== state.namesRev) { p.hlCache = []; p.hlRev = state.namesRev; }
    var cache = p.hlCache;
    var name = p.parsed.name;
    var byLine = findingsByLine(name);
    var all = findingsFor(name);

    /* One finding routinely points at several lines — the handshake check
     * names both the line that sets the output and the line that waits on the
     * input. Every one of those lines earns a marker, but the note belongs on
     * the first of them only; printing the same paragraph under each line read
     * as two separate problems. A marker further down toggles that one note. */
    var homeLine = all.map(function (f) {
      return f.refs.reduce(function (min, r) {
        return r.prog === name && (min === null || r.line < min) ? r.line : min;
      }, null);
    });
    var notes = all.map(function (f) { return findingNote(name, f); });

    /* Notes start folded. The marker and its tooltip are what the listing
     * owes you by default — the message is a paragraph of prose, and a program
     * reads as a program only while the lines stay next to each other. Click a
     * marker for the note; that choice is then remembered for the session. */
    notes.forEach(function (note, i) {
      var key = name + '#' + all[i].rule + '@' + homeLine[i];
      note.hidden = !state.noteOpen[key];
      note.dataset.noteKey = key;
    });

    p.parsed.lines.forEach(function (line, i) {
      var found = byLine[line.num];
      var worst = !found ? null
        : found.some(function (f) { return f.severity === 'error'; }) ? 'error' : 'warn';
      var mk = h('span', { class: 'mk' + (worst ? ' sev-' + worst : '') });

      var html = cache[i];
      if (html === undefined) {
        html = (line.motion ? '<span class="tok-motion">' + line.motion + '</span> ' : '') + highlight(line);
        cache[i] = html;
      }
      box.appendChild(h('div', { class: 'cline', 'data-line': line.num }, [
        mk,
        h('span', { class: 'ln', text: line.num }),
        h('span', { class: 'src', html: html })
      ]));

      notes.forEach(function (note, i) { if (homeLine[i] === line.num) box.appendChild(note); });

      if (!found) return;

      mk.textContent = worst === 'error' ? '●' : '▲';
      mk.setAttribute('role', 'button');
      mk.setAttribute('tabindex', '0');
      mk.setAttribute('aria-label', SEV_LABEL[worst] + ' on line ' + line.num + ', click for detail');
      mk.title = found.map(function (f) {
        return SEV_LABEL[f.severity] + ' — ' + (RULE_NAMES[f.rule] || f.rule) + '\n' + f.message;
      }).join('\n\n');

      var mine = found.map(function (f) { return all.indexOf(f); })
                      .filter(function (i) { return i !== -1; });
      function toggle() {
        // any one of them still folded means the gesture is "show me"
        var show = mine.some(function (i) { return notes[i].hidden; });
        mine.forEach(function (i) {
          notes[i].hidden = !show;
          /* Remembered against the finding rather than re-rendered: a render()
           * here would rebuild the listing and lose the place you were reading. */
          state.noteOpen[notes[i].dataset.noteKey] = show;
        });
        /* The note may be homed a line or two above the marker just clicked,
         * so bring it into view if it isn't already. */
        if (show && mine.length) notes[mine[0]].scrollIntoView({ block: 'nearest' });
      }
      mk.addEventListener('click', function (ev) { ev.stopPropagation(); toggle(); });
      mk.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); }
      });
    });
    box.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.classList.contains('tok-call')) {
        var name = t.getAttribute('data-call').toUpperCase();
        if (state.programs[name]) { state.selected = name; render(); }
      }
    });
    /* Cross-referencing a register or I/O point is a DOUBLE click. On a
     * single one it fired while you were only trying to place the caret or
     * start a selection, and every stray click on an R[] threw the whole tab
     * over to Search mid-read. Double-click is the ordinary "look this up"
     * gesture, and Ctrl+E on a selection still does the same thing. */
    box.addEventListener('dblclick', function (ev) {
      var t = ev.target;
      if (t.classList.contains('tok-reg') || t.classList.contains('tok-io')) crossRefToken(t.textContent);
    });
    return box;
  }

  /* ================= document tabs (Code view) =================
   * Studio-5000 habit: everything you have open — programs AND data views —
   * is a tab, and any tab drags onto the right half of the code to dock
   * side-by-side. Data views put live registers next to the program that
   * uses them, which used to take a second browser window. */

  var DATA_DOCS = {
    'D:regs': 'Registers',
    'D:prs': 'PRs',
    'D:io': 'I/O'
  };

  function docIsProg(id) { return !!id && id.slice(0, 2) === 'P:'; }
  function docProg(id) { return docIsProg(id) ? id.slice(2) : null; }
  function docLabel(id) { return DATA_DOCS[id] || String(id).slice(2); }
  function docValid(id) {
    if (!id) return false;
    return DATA_DOCS[id] ? true : !!state.programs[id.slice(2)];
  }

  function openDoc(id, activate) {
    if (state.openDocs.indexOf(id) === -1) state.openDocs.push(id);
    if (activate) state.activeDoc = id;
  }

  /* Close a tab from the UI: if that doc is the one being edited, unsaved
   * changes get a say first. closeDoc() stays the raw bookkeeping. */
  function safeCloseDoc(id) {
    var editingThis =
      (state.editing && id === state.activeDoc) ||
      (state.editSide === 'left' && id === state.activeDoc) ||
      (state.editSide === 'right' && id === state.splitDoc);
    if (editingThis) {
      if (editorDirty() && !confirm('Close ' + docLabel(id) + '? Unsaved changes will be lost.')) return;
      state.editing = false;
      state.editSide = null;
      state.editDraft = null;
    }
    closeDoc(id);
    render();
  }

  function closeDoc(id) {
    var i = state.openDocs.indexOf(id);
    if (i !== -1) state.openDocs.splice(i, 1);
    if (state.splitDoc === id) state.splitDoc = null;
    if (state.activeDoc === id) {
      var next = state.openDocs[Math.min(i, state.openDocs.length - 1)] || null;
      state.activeDoc = next;
      if (docIsProg(next)) { state.selected = docProg(next); docSelSync = state.selected; }
    }
    /* The selection may not keep pointing at a closed tab — syncDocs holds
     * "the selected program is always an open doc" and would reopen it on
     * the very next render. Hand the selection to the next open program. */
    if (docIsProg(id) && state.selected === docProg(id)) {
      var np = docIsProg(state.activeDoc) ? docProg(state.activeDoc) : null;
      if (!np) {
        for (var k = 0; k < state.openDocs.length; k++) {
          if (docIsProg(state.openDocs[k])) { np = docProg(state.openDocs[k]); break; }
        }
      }
      state.selected = np;
      docSelSync = np;
    }
  }

  function activateDoc(id) {
    if (!docValid(id)) return;
    if (state.editing || state.editSide) {
      if (editorDirty() && !confirm('Leave the editor? Unsaved changes will be lost.')) return;
      state.editing = false;
      state.editSide = null;
      state.editDraft = null;
    }
    openDoc(id);
    state.activeDoc = id;
    if (docIsProg(id)) { state.selected = docProg(id); docSelSync = state.selected; }
    render();
  }

  /* Dock a doc on the right, or activate it on the left — the one drop
   * gesture, shared by tab drags and library drags. */
  function dockDoc(id, rightHalf) {
    if (!docValid(id)) return;
    if ((state.editing || state.editSide) && editorDirty() &&
        !confirm('Leave the editor? Unsaved changes will be lost.')) return;
    state.tab = 'code';
    state.editing = false;
    state.editSide = null;
    state.editDraft = null;
    openDoc(id);
    if (rightHalf) {
      if (!state.activeDoc || !docValid(state.activeDoc)) state.activeDoc = id;
      else {
        /* Docking the data view you are already looking at: hand the left
         * half back to a program, or the "no doc twice" rule silently
         * swallows the whole gesture. */
        if (state.activeDoc === id && !docIsProg(id)) {
          var back = (state.selected && state.programs[state.selected]) ? 'P:' + state.selected : null;
          if (!back) {
            for (var k = 0; k < state.openDocs.length; k++) {
              if (docIsProg(state.openDocs[k])) { back = state.openDocs[k]; break; }
            }
          }
          if (back) { state.activeDoc = back; openDoc(back); }
        }
        state.splitDoc = id;
      }
    } else {
      state.activeDoc = id;
      if (docIsProg(id)) { state.selected = docProg(id); docSelSync = state.selected; }
    }
    render();
  }

  /* Everything else in the app navigates by setting state.selected (sidebar,
   * go-to-line, CALL clicks, search hits). The doc model follows along here
   * rather than patching two dozen call sites: a selection change opens that
   * program's tab and makes it active. */
  var docSelSync = null;

  function syncDocs() {
    state.openDocs = state.openDocs.filter(docValid);
    if (state.splitDoc && !docValid(state.splitDoc)) state.splitDoc = null;
    // split-editing only exists while that half holds a program
    if (state.editSide === 'right' && !docIsProg(state.splitDoc)) state.editSide = null;
    if (state.editSide === 'left' && !docIsProg(state.activeDoc)) state.editSide = null;
    if (!state.splitDoc) state.editSide = null;
    if (state.selected && state.selected !== docSelSync) {
      docSelSync = state.selected;
      openDoc('P:' + state.selected, true);
    }
    if (state.selected) openDoc('P:' + state.selected);
    if (!docValid(state.activeDoc)) {
      state.activeDoc = state.selected ? 'P:' + state.selected : (state.openDocs[0] || null);
    }
    if (state.splitDoc && state.splitDoc === state.activeDoc && docIsProg(state.splitDoc) === false) {
      state.splitDoc = null;   // the same data view twice says nothing
    }
  }

  function renderDocTabs() {
    var strip = h('div', { class: 'doc-tabs', title: 'Drag a tab onto the right half of the code to dock it side-by-side' });
    state.openDocs.forEach(function (id) {
      var tab = h('span', {
        class: 'doc-tab' + (id === state.activeDoc ? ' active' : '') +
               (id === state.splitDoc ? ' docked' : '') +
               (DATA_DOCS[id] ? ' data' : ''),
        draggable: 'true'
      }, [
        h('span', { class: 'doc-label', text: docLabel(id) }),
        h('span', {
          class: 'doc-x', text: '×', title: 'Close (or middle-click the tab)',
          onclick: function (ev) { ev.stopPropagation(); safeCloseDoc(id); }
        })
      ]);
      tab.addEventListener('click', function () { activateDoc(id); });
      /* Middle-click closes, Notepad++/browser style. The mousedown
       * preventDefault matters: without it Windows Chrome starts its
       * middle-button autoscroll on the way down and eats the click. */
      tab.addEventListener('mousedown', function (ev) { if (ev.button === 1) ev.preventDefault(); });
      tab.addEventListener('auxclick', function (ev) {
        if (ev.button !== 1) return;
        ev.preventDefault();
        safeCloseDoc(id);
      });
      tab.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/x-doc', id);
        e.dataTransfer.effectAllowed = 'link';
      });
      strip.appendChild(tab);
    });
    // data-view openers for whatever is not already open
    var haveData = !!(state.extern || (state.server && state.robot.ip));
    Object.keys(DATA_DOCS).forEach(function (id) {
      if (state.openDocs.indexOf(id) !== -1) return;
      var add = h('button', {
        class: 'doc-add', draggable: 'true', text: '+ ' + DATA_DOCS[id],
        title: haveData
          ? 'Open ' + DATA_DOCS[id] + ' as a tab — or drag it onto the right half of the code to dock it side-by-side'
          : 'Opens as a tab. No controller data yet — connect to a robot or open a backup folder to fill it.',
        onclick: function () { activateDoc(id); }
      });
      // draggable before it is even open: "+ I/O" dragged onto the right
      // half docks it in one gesture
      add.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/x-doc', id);
        e.dataTransfer.effectAllowed = 'link';
      });
      strip.appendChild(add);
    });
    return strip;
  }

  /* One data view: live registers / position registers / I/O as a document.
   * The filter works on the rows already rendered — no re-render, so the
   * input never loses its caret. */
  function buildDataView(id) {
    var box = h('div', { class: 'dataview' });
    var rows = [];
    var source = null;

    if (id === 'D:regs') {
      var regs = (state.robot.registers && !state.robot.registers.error && state.robot.registers) ||
                 (state.extern && state.extern.registers) || [];
      source = state.robot.registers && !state.robot.registers.error ? 'robot ' + state.robot.ip
             : (state.extern && state.extern.source);
      regs.forEach(function (r) {
        rows.push({
          text: 'R[' + r.index + (r.comment ? ':' + r.comment : '') + '] = ' + r.value,
          html: '<span class="tok-reg">R[' + esc(String(r.index)) + (r.comment ? ':' + esc(r.comment) : '') + ']</span> = <span class="tok-num">' + esc(String(r.value)) + '</span>'
        });
      });
    } else if (id === 'D:prs') {
      var prs = (state.robot.posregs && !state.robot.posregs.error && state.robot.posregs) ||
                (state.extern && state.extern.posregs) || [];
      source = state.robot.posregs && !state.robot.posregs.error ? 'robot ' + state.robot.ip
             : (state.extern && state.extern.source);
      prs.forEach(function (r) {
        var val = r.uninit ? 'Uninitialized' : (VA.posregValueStr ? VA.posregValueStr(r) : '');
        rows.push({
          text: 'PR[' + r.group + ',' + r.index + (r.comment ? ':' + r.comment : '') + '] ' + val,
          html: '<span class="tok-reg">PR[' + r.group + ',' + r.index + (r.comment ? ':' + esc(r.comment) : '') + ']</span> <span class="' + (r.uninit ? 'muted' : 'tok-num') + '">' + esc(val) + '</span>'
        });
      });
    } else if (id === 'D:io') {
      var pts = state.robot.ioState || (state.extern && state.extern.io) || [];
      source = state.robot.ioState ? 'robot ' + state.robot.ip : (state.extern && state.extern.source);
      pts.forEach(function (p2) {
        var st = p2.state ? (p2.state === 'ON' ? '<span class="tok-on">ON</span>' : '<span class="tok-off">OFF</span>') : '';
        rows.push({
          text: p2.type + '[' + p2.index + (p2.comment ? ':' + p2.comment : '') + '] ' + (p2.state || ''),
          html: '<span class="tok-io">' + esc(p2.type) + '[' + p2.index + (p2.comment ? ':' + esc(p2.comment) : '') + ']</span> ' + st
        });
      });
    }

    var head = h('div', { class: 'dataview-head' });
    var filter = h('input', { type: 'text', placeholder: 'Filter ' + DATA_DOCS[id].toLowerCase() + '…', class: 'dataview-filter' });
    // the view is rebuilt on every render (tab switches, robot refreshes…),
    // so the typed filter lives in state, not in the input
    filter.value = state.dataFilter[id] || '';
    head.appendChild(filter);
    if (source) head.appendChild(h('span', { class: 'muted', text: 'from ' + source }));
    if (state.server && state.robot.ip) {
      head.appendChild(h('button', {
        class: 'btn subtle', text: 'Refresh',
        title: 'Re-read from ' + state.robot.ip,
        onclick: function () {
          if (id === 'D:regs') loadRobotRegisters();
          else if (id === 'D:prs') loadRobotPosregs();
          else loadRobotIO();
          toast('Re-reading from ' + state.robot.ip + '…', 2500);
        }
      }));
    }
    box.appendChild(head);

    var listEl = h('div', { class: 'dataview-rows' });
    if (!rows.length) {
      listEl.appendChild(h('p', { class: 'muted', text: 'No data yet. Connect to a robot (Robot tab) or open a backup folder that holds NUMREG.VA / POSREG.VA / IOSTATE.DG.' }));
    }
    var els = rows.map(function (r) {
      var el = h('div', { class: 'dataview-row mono', html: r.html });
      el._filterText = r.text.toLowerCase();
      listEl.appendChild(el);
      return el;
    });
    function applyFilter() {
      var q = filter.value.trim().toLowerCase();
      els.forEach(function (el) { el.style.display = (!q || el._filterText.indexOf(q) !== -1) ? '' : 'none'; });
    }
    filter.addEventListener('input', function () {
      state.dataFilter[id] = filter.value;
      applyFilter();
    });
    applyFilter();
    box.appendChild(listEl);
    return box;
  }

  function progSelect(value, onchange) {
    var sel = h('select', { class: 'prog-select' });
    Object.keys(state.programs).sort().forEach(function (n) {
      var o = h('option', { value: n, text: n });
      if (n === value) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { onchange(sel.value); });
    return sel;
  }

  /* Side by side: two independent code panes.
   *
   * Each half is its own scroller. The pane itself stops scrolling and the
   * two code boxes scroll instead, so one program can sit on line 40 while
   * the other sits on line 400. Before this the pane was the only scroller,
   * which dragged both halves along together and meant scrolling well past
   * the end of the shorter program to reach the bottom of the longer one.
   *
   * Sync scroll puts that lockstep back deliberately, for the case where it
   * IS what you want: two versions of the same program. It mirrors pixels
   * rather than lines, which comes to the same thing — both halves take
   * their font-size from --code-size, so the line heights always match. */
  function renderSplit(pane) {
    pane.classList.add('splitting');

    var boxes = [];
    var echo = null;   // the half whose next scroll event we caused ourselves

    function mirror(src, dst) {
      var wasTop = dst.scrollTop, wasLeft = dst.scrollLeft;
      if (wasTop === src.scrollTop && wasLeft === src.scrollLeft) return;
      echo = dst;
      dst.scrollTop = src.scrollTop;
      dst.scrollLeft = src.scrollLeft;
      /* Writing scrollTop clamps immediately and reads back clamped, so this
       * tells us whether the write actually moved anything. One that didn't
       * — dst already sitting at the end of the shorter program — fires no
       * scroll event, so there is no echo waiting to be swallowed. */
      if (dst.scrollTop === wasTop && dst.scrollLeft === wasLeft) echo = null;
    }

    function onScroll(ev) {
      var src = ev.currentTarget;
      /* Mirroring dst makes dst fire a scroll event of its own. Swallow that
       * one echo rather than mirroring it back: the round trip would drag src
       * to wherever dst landed, and when dst holds the shorter program that
       * means the longer half can never scroll past the shorter one's last
       * line. This is also why the guard is one specific element and not a
       * timer or a rAF — nothing has to fire for it to be released. */
      if (src === echo) { echo = null; return; }
      echo = null;
      if (!state.syncSplit || boxes.length < 2) return;
      mirror(src, src === boxes[0] ? boxes[1] : boxes[0]);
    }

    var cb = h('input', { type: 'checkbox' });
    cb.checked = state.syncSplit;
    cb.addEventListener('change', function () {
      state.syncSplit = cb.checked;
      savePrefs();
      /* Snap into line the moment it is ticked, taking the left half as the
       * reference. No render() — that would rebuild both boxes and throw
       * away wherever you had scrolled to. */
      if (state.syncSplit && boxes.length === 2) mirror(boxes[0], boxes[1]);
    });
    var syncLabel = h('label', {
      class: 'sync-toggle',
      title: 'Scroll both halves together, line for line — for two versions of the same program. Off by default: two different programs read better when each half moves on its own.'
    }, [cb]);
    syncLabel.appendChild(document.createTextNode(' Sync scroll'));

    var bothProgs = docIsProg(state.activeDoc) && docIsProg(state.splitDoc);

    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Side by side' }),
      h('span', { class: 'muted', text: 'drag a tab or a library program onto either half to view it there' }),
      h('span', { style: 'flex:1' }),
      bothProgs && !state.editSide ? syncLabel : null,
      h('button', {
        class: 'btn subtle', text: 'Close split',
        onclick: function () {
          if (state.editSide && editorDirty() && !confirm('Discard your unsaved changes?')) return;
          state.splitDoc = null;
          state.editSide = null;
          state.editDraft = null;
          render();
        }
      })
    ]));

    /* A failed send renders its banner here too — without this, a rejected
     * translation after "Save + send" from a split half reported nothing. */
    var ub = uploadBanner(docProg(state.activeDoc)) || uploadBanner(docProg(state.splitDoc));
    if (ub) pane.appendChild(ub);

    var wrap = h('div', { class: 'split-wrap' });
    wrap.style.setProperty('--split-l', (state.splitPct || 50) + '%');
    [['left', state.activeDoc], ['right', state.splitDoc]].forEach(function (side) {
      var id = side[1];
      var col = h('div', { class: 'code-pane ' + side[0], 'data-side': side[0] });
      if (docIsProg(id)) {
        var name = docProg(id);
        var p = state.programs[name];

        // this half is being edited — the other half stays a live reference
        if (p && state.editSide === side[0]) {
          var ed = buildEditorCore(p, { side: side[0] });
          col.classList.add('editing');
          col.appendChild(h('div', { class: 'pane-head' }, [
            h('span', { class: 'title mono', text: 'Editing ' + name }),
            ed.status,
            h('span', { style: 'flex:1' }),
            TPS ? ed.snipWrap : null,
            TPS ? h('button', {
              class: 'btn', text: 'Renumber',
              title: 'Number the /MN rows 1, 2, 3… after inserting or deleting lines by hand',
              onclick: function () { ed.ta.value = TPS.renumber(ed.ta.value); ed.paint(); ed.ta.focus(); }
            }) : null,
            h('button', { class: 'btn primary', text: 'Save', title: 'Save to library — re-parses and re-runs every check', onclick: function () { ed.save(false); } }),
            (p.origin.type === 'dir' && state.server)
              ? h('button', { class: 'btn', text: 'Save + disk', title: 'Save to library and to ' + p.origin.path, onclick: function () { ed.save(true); } })
              : null,
            (state.server && state.robot.ip)
              ? h('button', { class: 'btn', text: 'Save & Upload', title: 'Save and FTP to ' + state.robot.ip + ' with snapshot + verify + auto-restore', onclick: ed.saveAndSend })
              : null,
            h('button', {
              class: 'btn subtle', text: 'Cancel',
              onclick: function () {
                if (editorDirty() && !confirm('Discard your changes to ' + name + '?')) return;
                state.editSide = null;
                state.editDraft = null;
                render();
              }
            })
          ]));
          col.appendChild(ed.el);
          col.appendChild(ed.statusBar);
          col.appendChild(ed.problems);
          wrap.appendChild(col);
          ed.ta.focus();
          ed.renderStatus();
          return;
        }

        col.appendChild(h('div', { class: 'pane-head' }, [
          progSelect(name, function (v) {
            if (side[0] === 'left') { state.selected = v; docSelSync = v; state.activeDoc = 'P:' + v; openDoc('P:' + v); }
            else { state.splitDoc = 'P:' + v; openDoc('P:' + v); }
            render();
          }),
          h('button', {
            class: 'btn subtle', text: 'Edit', title: 'Edit this half in place — the other half stays open beside it',
            onclick: function () {
              if (state.editSide && editorDirty() && !confirm('Discard your unsaved changes in the other half?')) return;
              state.editDraft = null;
              state.editSide = side[0];
              render();
            }
          }),
          bothProgs ? h('button', {
            class: 'btn subtle', text: 'Compare A↔B', title: 'Diff these two programs in the Compare tab',
            onclick: function () { state.pair = { a: docProg(state.activeDoc), b: docProg(state.splitDoc) }; state.tab = 'compare'; render(); }
          }) : null
        ]));
        if (p) {
          var box = buildCodeBox(p);
          box.addEventListener('scroll', onScroll);
          boxes.push(box);
          col.appendChild(box);
        } else {
          col.appendChild(h('p', { class: 'muted', text: 'no program' }));
        }
      } else {
        col.appendChild(h('div', { class: 'pane-head' }, [
          h('span', { class: 'title', text: docLabel(id) }),
          h('span', { style: 'flex:1' }),
          side[0] === 'right' ? h('button', {
            class: 'btn subtle', text: 'Close', onclick: function () { state.splitDoc = null; render(); }
          }) : null
        ]));
        col.appendChild(buildDataView(id));
      }
      wrap.appendChild(col);
    });

    /* The handle between the halves: drag to resize, double-click to reset.
     * The ratio lives in --split-l on the wrap and is saved with the prefs. */
    var divider = h('div', {
      class: 'split-divider', title: 'Drag to resize · double-click for 50/50',
      role: 'separator', 'aria-orientation': 'vertical'
    });
    divider.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      divider.setPointerCapture(e.pointerId);
      var r = wrap.getBoundingClientRect();
      function move(ev) {
        var pct = ((ev.clientX - r.left) / r.width) * 100;
        state.splitPct = Math.round(Math.max(20, Math.min(80, pct)) * 10) / 10;
        wrap.style.setProperty('--split-l', state.splitPct + '%');
      }
      function up() {
        divider.removeEventListener('pointermove', move);
        divider.removeEventListener('pointerup', up);
        savePrefs();
      }
      divider.addEventListener('pointermove', move);
      divider.addEventListener('pointerup', up);
    });
    divider.addEventListener('dblclick', function () {
      state.splitPct = 50;
      wrap.style.setProperty('--split-l', '50%');
      savePrefs();
    });
    wrap.insertBefore(divider, wrap.children[1]);
    pane.appendChild(wrap);
  }

  function renderCode(pane) {
    syncDocs();
    pane.appendChild(renderDocTabs());

    if (!docValid(state.activeDoc)) return;

    // a data view, full width
    if (!docIsProg(state.activeDoc)) {
      if (state.splitDoc && docValid(state.splitDoc)) return renderSplit(pane);
      pane.appendChild(buildDataView(state.activeDoc));
      return;
    }

    var p = state.programs[docProg(state.activeDoc)];
    if (!p) return;

    if (state.editing) return renderEditor(pane, p);
    if (state.splitDoc && docValid(state.splitDoc)) return renderSplit(pane);

    var progFindings = findingsFor(p.parsed.name);

    var bar = h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: p.parsed.name }),
      p.parsed.attrs.COMMENT ? h('span', { class: 'muted', text: p.parsed.attrs.COMMENT }) : null,
      progFindings.length ? h('span', {
        class: 'badge warn', text: progFindings.length + ' issue' + (progFindings.length > 1 ? 's' : ''),
        style: 'cursor:pointer',
        title: 'Marked in the gutter, line ' + flaggedLines(p.parsed.name).join(', ')
          + '. Click for the Checks tab, filtered to this program.',
        onclick: function () { state.checksProg = p.parsed.name; state.tab = 'checks'; render(); }
      }) : null,
      h('span', { style: 'flex:1' }),
      codeSizeControl(),
      h('button', { class: 'btn', text: 'Edit', onclick: function () { state.editing = true; render(); } }),
      h('button', {
        class: 'btn', text: 'Side-by-side', title: 'Open a second program next to this one (or drag one from the library onto the right half)',
        onclick: function () { state.splitDoc = 'P:' + p.parsed.name; render(); }
      }),
      (state.server && state.robot.ip) ? h('button', {
        class: 'btn', text: 'Send to robot',
        title: 'Upload ' + p.parsed.name + '.LS to ' + state.robot.ip + ' over FTP (snapshot + verify + auto-restore on failure)',
        onclick: function () {
          if (!confirm('Send ' + p.parsed.name + '.LS to robot ' + state.robot.ip + ' over FTP?\n\nThe current version on the robot is snapshotted first. If the controller rejects the translation, that snapshot is restored automatically.')) return;
          sendToRobot(p.parsed.name, p.source, function () { render(); });
        }
      }) : null,
      h('button', { class: 'btn subtle', text: 'Export .LS', onclick: function () { exportProgram(p); } }),
      h('button', {
        class: 'btn subtle', text: 'Remove',
        onclick: function () {
          if (confirm('Remove ' + p.parsed.name + ' from the library? (Your original file is untouched.)')) removeProgram(p.parsed.name);
        }
      })
    ]);
    pane.appendChild(bar);
    var banner = uploadBanner(p.parsed.name);
    if (banner) pane.appendChild(banner);
    pane.appendChild(buildCodeBox(p));
  }

  /* The one live editor (full-page or a split half). Dirty means the text no
   * longer matches what was loaded — the guards below only interrupt for
   * changes that would actually be lost. */
  var liveEditor = null;

  function editorDirty() {
    if (liveEditor && liveEditor.ta.isConnected) return liveEditor.ta.value !== liveEditor.source;
    // the editor may not be on screen (another tab is) — the draft still counts
    return !!(state.editDraft && state.programs[state.editDraft.name] &&
      state.editDraft.text !== state.programs[state.editDraft.name].source);
  }

  /* A program was renamed by editing its /PROG header — every open doc
   * reference follows it. */
  function renameDocRefs(oldId, newId) {
    state.openDocs = state.openDocs.map(function (d) { return d === oldId ? newId : d; })
      .filter(function (d, i, arr) { return arr.indexOf(d) === i; });
    if (state.activeDoc === oldId) state.activeDoc = newId;
    if (state.splitDoc === oldId) state.splitDoc = newId;
  }

  /* The editor itself — textarea, highlight overlay, save/send logic — shared
   * by the full-page editor and a split half. opts.side ('left'|'right') means
   * it lives in that half of a side-by-side view. */
  function buildEditorCore(p, opts) {
    opts = opts || {};
    var oldName = p.parsed.name;
    var status = h('span', { class: 'muted' });

    var ta = h('textarea', {
      class: 'editor', spellcheck: 'false', wrap: 'off',
      autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off'
    });
    /* Unsaved text survives leaving the Code tab: the draft lives in state
     * and the editor reopens with it. Saving or an explicit discard clears
     * it — switching tabs never does. */
    ta.value = (state.editDraft && state.editDraft.name === oldName) ? state.editDraft.text : p.source;

    /* Syntax highlighting in a plain textarea: a <pre> holding the coloured
     * copy sits directly behind transparent text, with identical metrics, and
     * follows the textarea's scroll. Editing stays completely native. */
    var hl = h('pre', { class: 'editor-hl', 'aria-hidden': 'true' });
    var editorWrap = h('div', { class: 'editor-wrap' }, [hl, ta]);
    var repaintQueued = false;

    /* ---- syntax check ----
     * Every repaint re-checks the whole listing (a few hundred lines is
     * nothing) and marks the rows in the overlay: a wavy underline for what
     * the controller will refuse, a dotted one for a form no robot in the
     * dictionary uses. The strip under the editor explains the row the caret
     * is on; the list jumps to any of them. */
    var issues = [], byRow = {};
    var statusBar = h('div', { class: 'editor-status' });
    var problems = h('div', { class: 'editor-problems' });
    problems.hidden = true;

    function paint() {
      var rows = ta.value.split('\n');
      issues = TPS ? TPS.checkSource(ta.value, TP_DICT) : [];
      byRow = {};
      issues.forEach(function (iss) {
        iss.rows.forEach(function (r) { if (!byRow[r] || iss.level === 'error') byRow[r] = iss; });
      });
      // the trailing newline keeps the last line scrollable in step with the textarea
      hl.innerHTML = rows.map(function (raw, i) {
        var html = highlightSourceLine(raw);
        var iss = byRow[i];
        return iss ? '<span class="' + (iss.level === 'error' ? 'ln-err' : 'ln-unk') + '">' + html + '</span>' : html;
      }).join('\n') + '\n';
      syncScroll();
      renderStatus();
    }
    function syncScroll() {
      hl.scrollTop = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
    }
    function caretRow() { return ta.value.slice(0, ta.selectionStart).split('\n').length - 1; }
    function rowStart(rows, row) {
      var pos = 0;
      for (var i = 0; i < row; i++) pos += rows[i].length + 1;
      return pos;
    }
    function gotoRow(row) {
      var rows = ta.value.split('\n');
      var pos = rowStart(rows, row);
      ta.focus();
      ta.setSelectionRange(pos, pos + (rows[row] || '').length);
      var lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.scrollTop = Math.max(0, row * lh - ta.clientHeight / 2);
      renderStatus();
    }
    function renderStatus() {
      statusBar.innerHTML = '';
      if (!TPS) return;
      var errs = issues.filter(function (i) { return i.level === 'error'; }).length;
      var unks = issues.length - errs;
      var text = errs ? errs + ' syntax error' + (errs === 1 ? '' : 's') : 'no syntax errors';
      if (unks) text += ' · ' + unks + ' unrecognised form' + (unks === 1 ? '' : 's');
      if (!TP_DICT) text += ' · grammar only (no shape dictionary built)';
      statusBar.appendChild(h('span', { class: 'msg' + (errs ? ' err' : ''), text: text }));
      if (issues.length) statusBar.appendChild(h('span', {
        class: 'toggle', text: problems.hidden ? 'list them' : 'hide the list',
        onclick: function () { problems.hidden = !problems.hidden; renderStatus(); }
      }));
      var iss = byRow[caretRow()];
      if (iss) {
        statusBar.appendChild(h('span', { class: 'msg ' + (iss.level === 'error' ? 'err' : 'unk'), text: (iss.num !== null ? 'line ' + iss.num + ': ' : '') + iss.message }));
        if (iss.nearest && iss.nearest.length) {
          statusBar.appendChild(h('span', { class: 'msg', text: 'closest forms your robots use:' }));
          iss.nearest.forEach(function (n) { statusBar.appendChild(h('span', { class: 'ex', text: n.example, title: 'used ' + n.count + ' time' + (n.count === 1 ? '' : 's') })); });
        }
      } else {
        var m = (ta.value.split('\n')[caretRow()] || '').match(/^\s*\d+\s*:(.*)$/);
        if (m) {
          var r = TPS.check(m[1], TP_DICT);
          if (r.level === 'ok' && r.count) {
            statusBar.appendChild(h('span', {
              class: 'msg',
              text: r.family
                ? 'your robots use this form (as ' + r.example + ')'
                : 'this form appears ' + r.count + ' time' + (r.count === 1 ? '' : 's') + ' on your robots'
            }));
          }
        }
      }
      problems.innerHTML = '';
      issues.forEach(function (i) {
        problems.appendChild(h('div', { onclick: function () { gotoRow(i.row); } }, [
          h('span', { class: 'n', text: i.num !== null ? String(i.num) : '?' }),
          h('span', { class: i.level === 'error' ? 'msg err' : 'msg unk', text: i.message })
        ]));
      });
    }

    /* ---- snippets ----
     * A form is dropped in as a new row (or rows) after the caret's, written
     * the way the controller writes it, and the whole /MN renumbered so the
     * file stays loadable. The inserted instruction is left selected. */
    function insertSnippet(text) {
      var rows = ta.value.split('\n');
      var mn = -1, end = rows.length, i;
      for (i = 0; i < rows.length; i++) {
        if (mn === -1 && /^\s*\/MN\b/i.test(rows[i])) mn = i;
        else if (mn !== -1 && /^\s*\/(?:POS|END)\b/i.test(rows[i])) { end = i; break; }
      }
      if (mn === -1) { toast('No /MN section to insert into.'); return; }
      var at = caretRow() + 1;
      if (at <= mn) at = mn + 1;
      if (at > end) at = end;
      if (at - 1 > mn && at - 1 < end && !rows[at - 1].trim()) { at = at - 1; rows.splice(at, 1); }   // use a blank row
      var lines = text.split('\n').map(function (t) { return TPS.formatRow(0, t); });
      rows.splice.apply(rows, [at, 0].concat(lines));
      ta.value = TPS.renumber(rows.join('\n'));
      var out = ta.value.split('\n');
      var first = out[at], pos = rowStart(out, at);
      var start = pos + first.indexOf(':') + 1 + (/^\s*\d+:  /.test(first) ? 2 : 0);
      ta.focus();
      ta.setSelectionRange(start, pos + first.length - 2);
      paint();
    }

    var snipWrap = h('span', { class: 'snip-wrap' });
    var menu = null;
    function closeMenu() {
      if (!menu) return;
      menu.remove();
      menu = null;
      document.removeEventListener('mousedown', outsideMenu);
    }
    function outsideMenu(e) { if (menu && !snipWrap.contains(e.target)) closeMenu(); }
    function openMenu() {
      if (menu) { closeMenu(); return; }
      var list = TPS.snippets(TP_DICT);
      menu = h('div', { class: 'snip-menu' });
      var filt = h('input', { type: 'search', placeholder: 'Filter… e.g. wait, offset, select, negative' });
      var body = h('div');
      function draw() {
        var q = filt.value.trim().toLowerCase(), lastGroup = null;
        body.innerHTML = '';
        list.forEach(function (s) {
          // names and notes still match the filter ("jump" finds JMP) —
          // they just don't take up a row each. The reader knows what a
          // jump instruction is; the detail waits on hover.
          if (q && (s.group + ' ' + s.name + ' ' + s.text + ' ' + s.note).toLowerCase().indexOf(q) === -1) return;
          if (s.group !== lastGroup) { body.appendChild(h('div', { class: 'snip-group', text: s.group })); lastGroup = s.group; }
          var tip = [s.name, s.note, s.count ? 'used ' + s.count + '× on your robots' : '']
            .filter(Boolean).join('\n');
          body.appendChild(h('div', {
            class: 'snip-item',
            title: tip,
            onmousedown: function (e) { e.preventDefault(); },   // keep the textarea's caret
            onclick: function () { insertSnippet(s.text); closeMenu(); }
          }, [
            h('div', { class: 'code', text: s.text })
          ]));
        });
        if (!body.children.length) body.appendChild(h('div', { class: 'snip-group', text: 'nothing matches' }));
      }
      filt.addEventListener('input', draw);
      filt.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeMenu(); ta.focus(); }
        if (e.key === 'Enter') { var first = body.querySelector('.snip-item'); if (first) first.click(); }
      });
      menu.appendChild(filt);
      menu.appendChild(body);
      draw();
      snipWrap.appendChild(menu);
      // place it under the button, clamped inside the viewport — never
      // under the sidebar, never clipped by the pane's scroll box
      var r = snipWrap.getBoundingClientRect();
      var w = Math.min(560, window.innerWidth - 16);
      menu.style.width = w + 'px';
      menu.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
      menu.style.top = (r.bottom + 4) + 'px';
      menu.style.maxHeight = Math.max(180, window.innerHeight - r.bottom - 16) + 'px';
      document.addEventListener('mousedown', outsideMenu);
      window.addEventListener('resize', closeMenu, { once: true });
      filt.focus();
    }
    if (TPS) snipWrap.appendChild(h('button', {
      class: 'btn', text: 'Insert ▾',
      title: 'Insert a correctly formatted instruction after the caret — each with a note on its form, and how often your robots use it',
      onclick: openMenu
    }));

    ta.addEventListener('input', function () {
      state.editDraft = { name: oldName, text: ta.value };
      if (repaintQueued) return;
      repaintQueued = true;
      requestAnimationFrame(function () { repaintQueued = false; paint(); });
    });
    ta.addEventListener('scroll', syncScroll);
    ta.addEventListener('keyup', renderStatus);
    ta.addEventListener('click', renderStatus);
    paint();
    liveEditor = { ta: ta, source: p.source };

    function stopEditing() { state.editing = false; state.editSide = null; state.editDraft = null; }

    /* Store the edited source and keep every view pointing at it, renamed or
     * not. Editing the RIGHT half must not yank the left half over to the
     * saved program, so only a left/full edit moves the selection. */
    function store(src) {
      var parsed = P.parseLS(src, oldName + '.LS');
      if (parsed.name !== oldName) {
        delete state.programs[oldName];
        renameDocRefs('P:' + oldName, 'P:' + parsed.name);
      }
      state.programs[parsed.name] = {
        parsed: parsed,
        analysis: A.analyzeProgram(parsed),
        source: src,
        origin: p.origin
      };
      if (opts.side === 'right') {
        state.splitDoc = 'P:' + parsed.name;
      } else {
        state.selected = parsed.name;
        docSelSync = parsed.name;
        state.activeDoc = 'P:' + parsed.name;
      }
      rebuildDerived();
      persist();
      return parsed;
    }

    function save(alsoDisk) {
      var src = ta.value;
      store(src);
      if (alsoDisk && p.origin.type === 'dir' && state.server) {
        fetch('/api/dir/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p.origin.path, content: src })
        }).then(function (r) { return r.json(); }).then(function (b) {
          if (b.error) throw new Error(b.error);
          stopEditing();
          render();
        }).catch(function (e) { status.textContent = 'Disk save failed: ' + e.message; });
        return;
      }
      stopEditing();
      render();
    }

    function saveAndSend() {
      // save to library first so nothing is ever lost, then upload with the
      // snapshot/verify/restore safety net
      var src = ta.value;
      var parsed = store(src);
      var blocking = state.findings.filter(function (f) {
        return f.severity === 'error' && f.refs.some(function (r) { return r.prog === parsed.name; });
      });
      if (blocking.length && !confirm('Checks found ' + blocking.length + ' error(s) in ' + parsed.name + ' that will likely fail translation on the robot:\n\n' +
        blocking.map(function (f) { return '• ' + f.message; }).join('\n') + '\n\nSend anyway? (The robot version is snapshotted and auto-restored if translation fails.)')) {
        status.textContent = 'Saved to library — not sent. Fix the errors in the Checks tab.';
        return;
      }
      status.textContent = 'Uploading to ' + state.robot.ip + '…';
      sendToRobot(parsed.name, src, function (result) {
        // on failure keep the editor open so the fix is one keystroke away
        if (result.ok) stopEditing();
        else if (opts.side) state.editSide = opts.side;
        else state.editing = true;
        render();
      });
    }

    return {
      el: editorWrap, ta: ta, status: status, save: save, saveAndSend: saveAndSend,
      // the syntax-check strip, its problem list, the snippet menu and the
      // repaint hook all live in here — hand them out so any editor surface
      // (full page or a split half) can mount them
      statusBar: statusBar, problems: problems, snipWrap: snipWrap,
      paint: paint, renderStatus: renderStatus
    };
  }

  function renderEditor(pane, p) {
    var oldName = p.parsed.name;
    var ed = buildEditorCore(p, {});
    var status = ed.status;
    var save = ed.save;
    var saveAndSend = ed.saveAndSend;
    var editorWrap = ed.el;
    var ta = ed.ta;

    var bar = h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Editing ' + oldName }),
      h('span', { class: 'muted', text: 'saving re-parses the program and re-runs every check — renaming /PROG renames it in the library' }),
      status,
      h('span', { style: 'flex:1' }),
      codeSizeControl(),
      TPS ? ed.snipWrap : null,
      TPS ? h('button', {
        class: 'btn', text: 'Renumber',
        title: 'Number the /MN rows 1, 2, 3… after inserting or deleting lines by hand',
        onclick: function () { ta.value = TPS.renumber(ta.value); ed.paint(); ta.focus(); }
      }) : null,
      h('button', { class: 'btn primary', text: 'Save to library', onclick: function () { save(false); } }),
      (p.origin.type === 'dir' && state.server)
        ? h('button', { class: 'btn', text: 'Save to library + disk', title: p.origin.path, onclick: function () { save(true); } })
        : null,
      (state.server && state.robot.ip)
        ? h('button', { class: 'btn', text: 'Save & Upload', title: 'FTP to ' + state.robot.ip + ' with snapshot + verify + auto-restore', onclick: saveAndSend })
        : null,
      h('button', { class: 'btn subtle', text: 'Cancel', onclick: function () { state.editing = false; state.editDraft = null; render(); } })
    ]);
    pane.appendChild(bar);
    var banner = uploadBanner(p.parsed.name);
    if (banner) pane.appendChild(banner);
    if (p.origin.type === 'robot' && !(state.server && state.robot.ip)) {
      pane.appendChild(h('p', { class: 'muted', text: 'This program was read from robot ' + p.origin.ip + '. Connect to the robot (Robot tab) to send edits back over FTP with the snapshot/auto-restore safety net.' }));
    }
    pane.appendChild(editorWrap);
    pane.appendChild(ed.statusBar);
    pane.appendChild(ed.problems);
    pane.classList.add('editing');
    ta.focus();
    ed.renderStatus();
  }

  function exportProgram(p) {
    // Hosted (claude.ai artifact) viewers save through the downloads capability;
    // the local app uses a plain blob link.
    if (window.claude && typeof window.claude.use === 'function') {
      window.claude.use('downloads').then(function (dl) {
        if (dl) return dl.save({ filename: p.parsed.name + '.LS.txt', data: p.source });
        blobDownload(p);
      }).catch(function () { /* viewer declined — nothing to do */ });
      return;
    }
    blobDownload(p);
  }

  function blobDownload(p) {
    var blob = new Blob([p.source], { type: 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = p.parsed.name + '.LS';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---- summary tab ---- */

  function renderSummary(pane) {
    var p = current();
    if (!p) return;
    var a = p.analysis, parsed = p.parsed;

    pane.appendChild(h('div', { class: 'code-toolbar' }, [h('span', { class: 'title', text: parsed.name })]));

    /* Two things change how you read everything below them: which frames the
     * program selects, and whether the parser understood every line. Both used
     * to sit under the narrative, so a wrong UFRAME or an unparsed line was
     * three scrolls down — behind the counts nobody checks twice. */
    var top = h('div', { class: 'sum-top' });

    if (parsed.errors.length) {
      var errRow = h('div', { class: 'row' }, [h('span', { class: 'badge warn', text: 'parser' })]);
      errRow.appendChild(h('div', { class: 'txt' }, [
        h('div', { text: parsed.errors.length + ' line' + (parsed.errors.length > 1 ? 's' : '') + ' could not be read — the counts below, Checks, and Cross-reference are all missing whatever is in them.' })
      ].concat(parsed.errors.map(function (e) { return h('div', { class: 'muted', text: e }); }))));
      top.appendChild(errRow);
    }

    var uf = uniq(a.uframes.map(function (u) { return u.num; }));
    var ut = uniq(a.utools.map(function (u) { return u.num; }));
    var frameTxt;
    if (uf.length || ut.length) {
      var parts = [];
      if (uf.length) parts.push('UFRAME ' + uf.join(', '));
      if (ut.length) parts.push('UTOOL ' + ut.join(', '));
      frameTxt = 'Selects ' + parts.join(' · ') + '.';
    } else {
      frameTxt = 'Sets no UFRAME or UTOOL — it runs against whatever frame the controller (or the calling program) left active.';
    }
    top.appendChild(h('div', { class: 'row' }, [
      h('span', { class: 'badge info', text: 'frames' }),
      h('div', { class: 'txt', text: frameTxt })
    ]));

    pane.appendChild(top);

    /* Line count is deliberately not a card: the library listing shows it, and
     * LINE_COUNT repeats it in the header table below. */
    var totalMoves = Object.keys(a.motions).reduce(function (s, k) { return s + a.motions[k]; }, 0);
    var cards = h('div', { class: 'cards' });
    [[totalMoves, 'motion instructions'],
     [a.calls.length, 'subprogram calls'],
     [Object.keys(a.io).length, 'I/O points touched'],
     [Object.keys(a.registers).length, 'registers used'],
     [parsed.positions.length, 'taught positions']].forEach(function (c) {
      cards.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'k', text: c[0] }),
        h('div', { class: 'l', text: c[1] })
      ]));
    });
    pane.appendChild(cards);

    var sum = h('div', { class: 'summary' });
    sum.appendChild(h('h3', { text: 'What this program does' }));
    narrative(p).forEach(function (s) { sum.appendChild(h('p', { text: s })); });

    var facts = h('ul');
    var mv = [];
    ['J', 'L', 'C'].forEach(function (k) { if (a.motions[k]) mv.push(a.motions[k] + ' ' + ({ J: 'joint', L: 'linear', C: 'circular' })[k]); });
    if (mv.length) facts.appendChild(h('li', { text: 'Motion: ' + mv.join(', ') + ' move' + (totalMoves > 1 ? 's' : '') + '.' }));
    if (a.loops.length) {
      a.loops.forEach(function (lp) {
        facts.appendChild(h('li', { text: 'Loop: line ' + lp.jumpLine + ' jumps back to LBL[' + lp.label + '] at line ' + lp.defLine + ' — this section repeats.' }));
      });
    }
    if (a.waits.length) facts.appendChild(h('li', { text: 'Waits on: ' + a.waits.map(function (w) { return w.cond; }).join(' · ') }));
    var writes = Object.keys(a.io).filter(function (k) { return a.io[k].writes.length; });
    if (writes.length) facts.appendChild(h('li', { text: 'Outputs written: ' + writes.map(function (k) { return k + (a.io[k].label ? ' (' + a.io[k].label + ')' : ''); }).join(', ') }));
    sum.appendChild(facts);

    sum.appendChild(h('h3', { text: 'Header attributes' }));
    var tw = h('div', { class: 'table-wrap' });
    var tbl = h('table', { class: 'attr-table' });
    ['COMMENT', 'OWNER', 'CREATE', 'MODIFIED', 'LINE_COUNT', 'PROG_SIZE', 'MEMORY_SIZE', 'PROTECT', 'DEFAULT_GROUP', 'TASK_PRIORITY'].forEach(function (k) {
      if (parsed.attrs[k] !== undefined) {
        tbl.appendChild(h('tr', {}, [h('td', { text: k }), h('td', { class: 'mono', text: parsed.attrs[k] })]));
      }
    });
    tw.appendChild(tbl);
    sum.appendChild(tw);
    pane.appendChild(sum);
  }

  function narrative(p) {
    var a = p.analysis, out = [];
    var graph = state.graph;
    var name = p.parsed.name;
    var callers = (graph.calledBy[name] || []);
    var callees = uniq(a.calls.map(function (c) { return c.target; }));

    var s1 = name;
    if (p.parsed.attrs.COMMENT) s1 += ' ("' + p.parsed.attrs.COMMENT + '")';
    s1 += callers.length
      ? ' is a subprogram called by ' + callers.join(', ') + '.'
      : ' is a top-level program — nothing in this library calls it.';
    out.push(s1);

    var actions = [];
    var totalMoves = Object.keys(a.motions).reduce(function (s, k) { return s + a.motions[k]; }, 0);
    if (totalMoves) actions.push('moves the robot through ' + totalMoves + ' motion instruction' + (totalMoves > 1 ? 's' : ''));
    if (callees.length) actions.push('delegates work to ' + callees.join(', '));
    var ioWrites = Object.keys(a.io).filter(function (k) { return a.io[k].writes.length; }).length;
    if (ioWrites) actions.push('drives ' + ioWrites + ' output' + (ioWrites > 1 ? 's' : ''));
    if (a.waits.length) actions.push('synchronizes with the cell via ' + a.waits.length + ' WAIT' + (a.waits.length > 1 ? 's' : ''));
    if (a.loops.length) actions.push('repeats a section ' + (a.loops.length > 1 ? a.loops.length + ' loops' : 'in a loop'));
    if (actions.length) out.push('It ' + actions.join(', ') + '.');
    return out;
  }

  function uniq(arr) {
    return arr.filter(function (v, i) { return arr.indexOf(v) === i; });
  }

  /* ---- flow tab: call order + control-flow graph ---- */

  function renderFlow(pane) {
    var p = current();
    if (!p) return;

    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Program flow' })
    ]));

    /* Control flow of the open program comes first: it is the part that gets
     * read line by line, and isolating a block should not mean scrolling
     * past the whole call tree to reach it. */
    var secCfg = secHead('Control flow inside ' + p.parsed.name, 'flow-cfg');
    pane.appendChild(secCfg.el);
    if (secCfg.open) renderCfg(pane, p);

    var secCall = secHead('Call order — the sequence programs run in', 'flow-callorder');
    pane.appendChild(secCall.el);
    if (secCall.open) renderCallOrder(pane);
  }

  function renderCallOrder(pane) {
    var g = state.graph;
    var rootNames = A.roots(g);
    if (!rootNames.length) rootNames = Object.keys(state.programs);
    var flowWrap = h('div', { class: 'graph' });
    flowWrap.appendChild(h('p', { class: 'muted', text: 'Read top to bottom: each row is a CALL in the order it appears. Indent = call depth. Sections inside loops repeat every cycle. Click a program to open it, ▸ to collapse a branch.' }));

    if (!state.flowCollapse) state.flowCollapse = {};
    var rowsByRoot = {};
    rootNames.sort().forEach(function (r) {
      rowsByRoot[r] = FL.callOrder(state.programs, g, r, state.flowIgnore);
    });

    // collapse controls
    var ctl = h('div', { class: 'search-bar', style: 'margin-bottom:6px' });
    ctl.appendChild(h('button', {
      class: 'btn subtle', text: 'Expand all',
      onclick: function () { state.flowCollapse = {}; render(); }
    }));
    ctl.appendChild(h('button', {
      class: 'btn subtle', text: 'Collapse all',
      onclick: function () {
        state.flowCollapse = {};
        Object.keys(rowsByRoot).forEach(function (r) {
          var m = FL.collapseToDepth(rowsByRoot[r], 1);
          Object.keys(m).forEach(function (s) { state.flowCollapse[r + '|' + s] = true; });
        });
        render();
      }
    }));
    [1, 2, 3].forEach(function (d) {
      ctl.appendChild(h('button', {
        class: 'btn subtle opt', text: String(d), title: 'Show ' + d + ' call level' + (d > 1 ? 's' : '') + ' deep',
        onclick: function () {
          state.flowCollapse = {};
          Object.keys(rowsByRoot).forEach(function (r) {
            var m = FL.collapseToDepth(rowsByRoot[r], d + 1);
            Object.keys(m).forEach(function (s) { state.flowCollapse[r + '|' + s] = true; });
          });
          render();
        }
      }));
    });
    flowWrap.appendChild(ctl);

    // restore row for programs hidden with ✕ — kept next to the controls so
    // it's easy to find
    var ignored = Object.keys(state.flowIgnore).filter(function (n) { return state.flowIgnore[n]; });
    if (ignored.length) {
      var ig = h('p', { class: 'muted' });
      ig.appendChild(document.createTextNode('Hidden programs (click to unhide): '));
      ignored.sort().forEach(function (n) {
        ig.appendChild(h('span', {
          class: 'chip write', text: n + ' ✕',
          title: 'Show ' + n + ' in the flow again',
          onclick: function () { delete state.flowIgnore[n]; savePrefs(); rebuildDerived(); render(); }
        }));
      });
      ig.appendChild(h('span', { class: 'muted', text: ' (hidden programs are also treated as non-motion by the handshake check)' }));
      flowWrap.appendChild(ig);
    }

    var seqBox = h('div', { class: 'callorder' });
    Object.keys(rowsByRoot).forEach(function (r) {
      var perRoot = {};
      Object.keys(state.flowCollapse).forEach(function (k) {
        if (k.indexOf(r + '|') === 0 && state.flowCollapse[k]) perRoot[k.slice(r.length + 1)] = true;
      });
      FL.visibleRows(rowsByRoot[r], perRoot).forEach(function (row) {
        var key = r + '|' + row.seq;
        var el = h('div', { class: 'seq-row', style: 'padding-left:' + (row.depth * 22) + 'px' });
        el.appendChild(row.hasChildren
          ? h('span', {
              class: 'seq-caret', text: state.flowCollapse[key] ? '▸' : '▾',
              title: state.flowCollapse[key] ? 'Expand this branch' : 'Collapse this branch',
              onclick: function () {
                if (state.flowCollapse[key]) delete state.flowCollapse[key];
                else state.flowCollapse[key] = true;
                render();
              }
            })
          : h('span', { class: 'seq-caret empty' }));
        el.appendChild(h('span', { class: 'seq-num', text: row.seq }));
        el.appendChild(h('span', {
          class: 'seq-name' + (row.note === 'missing' ? ' missing' : ''),
          text: row.name,
          onclick: row.note === 'missing' ? null : function () { state.selected = row.name; state.tab = 'code'; render(); }
        }));
        if (state.flowCollapse[key]) el.appendChild(h('span', { class: 'ref', text: '… ' + (rowsByRoot[r].filter(function (x) { return x.seq.indexOf(row.seq + '.') === 0; }).length) + ' hidden' }));
        if (row.line) el.appendChild(h('span', { class: 'ref', text: 'called at line ' + row.line }));
        if (row.note === 'missing') el.appendChild(h('span', { class: 'badge warn', text: 'not in library' }));
        if (row.note === 'recursion') el.appendChild(h('span', { class: 'ref', text: '↻ recursion — expanded above' }));
        if (row.depth > 0) el.appendChild(h('span', {
          class: 'seq-hide', text: '✕',
          title: 'Hide ' + row.name + ' from the flow view (utility programs like offset setters)',
          onclick: function () { state.flowIgnore[row.name] = true; savePrefs(); rebuildDerived(); render(); }
        }));
        seqBox.appendChild(el);
      });
    });
    flowWrap.appendChild(seqBox);

    var loopNotes = [];
    Object.keys(state.programs).forEach(function (n) {
      state.programs[n].analysis.loops.forEach(function (lp) {
        loopNotes.push(n + ': lines ' + lp.defLine + '–' + lp.jumpLine + ' repeat (JMP back to LBL[' + lp.label + ']) — calls inside run once per cycle.');
      });
    });
    if (loopNotes.length) {
      var ul = h('ul');
      loopNotes.forEach(function (t) { ul.appendChild(h('li', { text: t })); });
      flowWrap.appendChild(ul);
    }
    pane.appendChild(flowWrap);
  }

  /* ---- flow tab: the control-flow canvas -------------------------------
   *
   * A pan/zoom surface rather than a page-height column of cards: on a
   * jump-heavy program the arrows only make sense once you can pull back far
   * enough to see the shape, then go in close to read the lines.
   *
   *   layout   "column" keeps one stack with the jumps arcing through the
   *            gutter; "chart" spreads branches sideways and routes every jump
   *            at right angles down a lane of its own
   *   detail   "auto" swaps as you zoom: every line -> headings -> a bar per
   *            block whose height is its line count
   *   gaps     how much room the blocks and the arrow lanes get
   *
   * Zoom and pan survive a re-render of the same program, so isolating a block
   * does not lose your place.
   */

  var CFG_KMIN = 0.05, CFG_KMAX = 2.5;
  var CFG_FIT_FLOOR = 0.12;      // below this nothing is legible; pan instead
  var CFG_CARD_W = { chartFull: 470, chartMap: 330 };
  var CFG_TIERS = ['full', 'compact', 'map'];
  var CFG_TIER_MAX = { full: CFG_KMAX, compact: 0.62, map: 0.30 };
  var NS_SVG = 'http://www.w3.org/2000/svg';

  /* Room between blocks and between the lanes the arrows run down. None of it
   * scales the text — it only decides how much air the picture gets, so a knot
   * of overlapping jumps can be pulled apart without zooming. */
  var CFG_GAPS = {
    tight:  { y: { full: 5,  compact: 4,  map: 2 },  pitch: 12, colGap: 30 },
    normal: { y: { full: 16, compact: 12, map: 6 },  pitch: 24, colGap: 60 },
    wide:   { y: { full: 44, compact: 34, map: 16 }, pitch: 48, colGap: 120 }
  };

  var cfgView = { k: 1, x: 0, y: 0 };
  var cfgProg = null;      // program the view belongs to
  var cfgTier = 'full';    // resolved tier (state.flowDetail may be 'auto')
  var cfg = null;          // the mounted view; null when the tab is elsewhere
  var cfgTip = null;
  var cfgHooked = false;

  function cfgGaps() { return CFG_GAPS[state.flowGaps] || CFG_GAPS.normal; }
  function cfgPitch() { return cfgGaps().pitch; }
  function cfgChartMode() { return state.flowLayout === 'chart'; }

  function renderCfg(pane, p) {
    var flow = FL.buildFlow(p.parsed);
    var fresh = cfgProg !== p.parsed.name;
    if (fresh) { state.flowFocus = null; cfgProg = p.parsed.name; }
    if (state.flowFocus !== null && state.flowFocus >= flow.blocks.length) state.flowFocus = null;

    var bar = h('div', { class: 'flow-bar' });
    var vp = h('div', { class: 'flow-vp' });
    var canvas = h('div', { class: 'flow-canvas tier-' + cfgTier });
    var svg = document.createElementNS(NS_SVG, 'svg');
    svg.setAttribute('class', 'flow-svg');
    var col = h('div', { class: 'flow-col' });
    var mini = h('div', { class: 'flow-mini' + (state.flowMini ? '' : ' hidden') });
    var minisvg = document.createElementNS(NS_SVG, 'svg');
    mini.appendChild(h('span', { class: 'cap', text: 'Overview' }));
    mini.appendChild(minisvg);
    var hint = h('p', { class: 'flow-hint' });

    canvas.appendChild(svg);
    canvas.appendChild(col);
    vp.appendChild(canvas);

    cfg = {
      p: p, flow: flow, cards: [], geom: [], drawn: [], chart: null,
      lineBlock: {}, hoverEdge: null,
      vp: vp, canvas: canvas, svg: svg, col: col, mini: mini, minisvg: minisvg, hint: hint
    };

    cfgBuildBar(bar);
    pane.appendChild(bar);
    pane.appendChild(hint);
    pane.appendChild(h('div', { class: 'flow-stage' }, [vp, mini]));

    cfgBuildCards();
    cfgIndexLines();
    cfgWire();
    cfgPaintHint();

    /* Laid out now, not on a frame: the pane is live, so the cards can be
     * measured immediately — and a frame that never arrives (a hidden window,
     * a skipped paint) would otherwise leave the graph with no geometry at all
     * and nothing to re-trigger it. The frame afterwards is only a refinement,
     * for when a web font settles late and every card changes height. */
    cfgLayout(fresh);
    requestAnimationFrame(function () {
      if (!cfg || cfg.canvas !== canvas) return;   // re-rendered underneath us
      cfgLayout(fresh);
    });
  }

  function cfgLayout(fresh) {
    if (fresh) cfgFit();
    else { cfgApplyTier(cfgTier); cfgRelayout(); cfgApplyView(); cfgAfterLayout(); }
    cfgPaintFocus();
  }

  function cfgBuildBar(bar) {
    function grp() { var g = h('span', { class: 'grp' }); bar.appendChild(g); return g; }
    function sel(label, title, value, opts, onpick) {
      var s = h('select', { title: title });
      opts.forEach(function (o) {
        var op = h('option', { value: o[0], text: o[1] });
        if (o[0] === value) op.selected = true;
        s.appendChild(op);
      });
      s.addEventListener('change', function () { onpick(s.value); });
      return h('label', { text: label }, [s]);
    }

    var g1 = grp();
    g1.appendChild(h('button', { class: 'btn subtle', text: '−', title: 'Zoom out (−)',
      onclick: function () { cfgZoomTo(cfgView.k / 1.25); } }));
    cfg.zoomRead = h('span', { class: 'flow-zoom', text: '100%' });
    g1.appendChild(cfg.zoomRead);
    g1.appendChild(h('button', { class: 'btn subtle', text: '+', title: 'Zoom in (+)',
      onclick: function () { cfgZoomTo(cfgView.k * 1.25); } }));
    g1.appendChild(h('button', { class: 'btn subtle', text: 'Fit', title: 'Fit the whole program on screen (F)',
      onclick: cfgFit }));
    g1.appendChild(h('button', { class: 'btn subtle', text: '1:1', title: 'Back to 100% (0)',
      onclick: function () { cfgZoomTo(1); } }));

    var g2 = grp();
    g2.appendChild(sel('Layout',
      'Column keeps one stack with the jumps arcing through the gutter. Chart spreads branches sideways and routes every jump at right angles in its own lane. (C)',
      state.flowLayout, [['column', 'column'], ['chart', 'chart']],
      function (v) { state.flowLayout = v; savePrefs(); cfgFit(); }));
    g2.appendChild(sel('Gaps',
      'Room between blocks and between the lanes the arrows run down. Wider pulls a knot of overlapping jumps apart; it does not change the size of the text. (S)',
      state.flowGaps, [['tight', 'tight'], ['normal', 'normal'], ['wide', 'wide']],
      function (v) { state.flowGaps = v; savePrefs(); cfgRebuild(cfgAnchor()); }));

    var g3 = grp();
    g3.appendChild(sel('Detail',
      'How much of each block is drawn. Auto swaps as you zoom: every line, then the block’s own !*** banner comment *** with what it contains and calls, then a bar per block whose height is its line count.',
      state.flowDetail,
      [['auto', 'auto'], ['full', 'every line'], ['compact', 'headings'], ['map', 'bars']],
      function (v) {
        state.flowDetail = v;
        savePrefs();
        var a = cfgAnchor();
        cfgApplyTier(v === 'auto' ? cfgTierFor(cfgView.k, cfgTier) : v);
        cfgRebuild(a);
      }));
    var miniLbl = h('label', { title: 'Show the overview strip beside the graph' });
    var miniBox = h('input', { type: 'checkbox' });
    miniBox.checked = !!state.flowMini;
    miniBox.addEventListener('change', function () {
      state.flowMini = miniBox.checked;
      savePrefs();
      cfg.mini.classList.toggle('hidden', !state.flowMini);
      cfgDrawMini();
    });
    miniLbl.appendChild(miniBox);
    miniLbl.appendChild(document.createTextNode(' Overview'));
    g3.appendChild(miniLbl);

    var g4 = grp();
    g4.appendChild(h('button', {
      class: 'btn subtle' + (state.flowHideNav ? ' on' : ''),
      text: state.flowHideNav ? 'Show library' : 'Hide library',
      title: 'Hide the program library to give the graph the whole window. Only this tab — the library comes back on Code, Search and the rest. The ☰ in the header hides it everywhere.',
      onclick: function () {
        state.flowHideNav = !state.flowHideNav;
        savePrefs();
        applyFlowNav();
        render();
      }
    }));
  }

  /* ---- cards ---- */

  function cfgBuildCards() {
    var p = cfg.p, flow = cfg.flow;
    cfg.col.innerHTML = '';
    cfg.cards = [];
    if (!flow.blocks.length) {
      cfg.col.appendChild(h('p', { class: 'muted', text: 'No executable lines in ' + p.parsed.name + '.' }));
      return;
    }
    flow.blocks.forEach(function (b) {
      var card = h('div', { class: 'flow-card ' + b.kind.replace(' ', '-'), 'data-block': String(b.idx) });

      /* b.startNum can be a blank line: buildFlow buffers the blanks and
       * comments above a label and hands them to the block that follows. Aim
       * the ↗ at the first line that actually says something, which is also
       * the first row drawn in the card. */
      var firstShown = b.lines.filter(cfgSpeaks)[0];
      var gotoNum = firstShown ? firstShown.num : b.startNum;

      var head = h('div', { class: 'fc-head' }, [
        h('span', { class: 'fc-title' + (b.kind === 'normal' ? ' anon' : ''), text: b.title }),
        b.kind === 'normal' ? null : h('span', { class: 'fc-range', text: 'lines ' + b.startNum + '–' + b.endNum }),
        h('span', { class: 'fc-spacer' }),
        h('button', {
          class: 'fc-goto', text: '↗', 'data-ln': String(gotoNum), 'aria-label': 'Go to code',
          title: 'Go to code — opens ' + p.parsed.name + ' at line ' + gotoNum
        })
      ]);
      card.appendChild(head);

      /* Which blocks lead here. In a jump-heavy program "how does it even
       * reach this line" is the constant question, and at full detail the
       * arrows alone do not answer it once there are more than a handful. */
      if (b.inbound.length) {
        var inRow = h('div', { class: 'fc-in' }, [h('span', { class: 'fc-in-label', text: 'from' })]);
        b.inbound.forEach(function (e) {
          var src = flow.blocks[e.from];
          var atLine = e.kind === 'fall' ? (src ? src.endNum : b.startNum) : e.fromLine;
          inRow.appendChild(h('button', {
            class: 'fc-in-chip ' + e.kind, 'data-ln': String(atLine),
            text: (e.kind === 'fall' ? '↓ ' : '↷ ') + atLine,
            title: (e.kind === 'fall' ? 'falls through from line ' + atLine
              : (e.kind === 'cond' ? 'conditional jump from line ' : 'jump from line ') + atLine) +
              (src ? ' · ' + src.title : '') + ' — click to open it in the code'
          }));
        });
        card.appendChild(inRow);
      }

      var body = h('div', { class: 'fc-body' });
      b.lines.forEach(function (l) {
        if (!cfgSpeaks(l)) return;
        var row = h('div', {
          class: 'fc-line' + (l.comment !== null ? ' cmt' : ''),
          'data-ln': String(l.num),
          title: 'Line ' + l.num + ' — click to open it in the code'
        }, [
          h('span', { class: 'fc-ln', text: String(l.num) }),
          h('span', { class: 'fc-src', text: (l.motion ? l.motion + ' ' : '') + l.text })
        ]);
        body.appendChild(row);
      });
      card.appendChild(body);

      var cap = cfgCaption(b);
      if (cap) card.appendChild(h('div', { class: 'fc-cap', text: cap }));
      card.appendChild(h('div', { class: 'fc-sum', text: cfgSummary(b) }));

      var visCalls = b.calls.filter(function (n) { return !state.flowIgnore[n]; });
      if (visCalls.length) {
        var cc = h('div', { class: 'fc-calls' });
        cfgCounted(visCalls).forEach(function (c) {
          var known = !!state.programs[c.name];
          cc.appendChild(h('span', {
            class: 'chip read' + (known ? '' : ' absent'),
            text: '→ ' + c.name + (c.n > 1 ? ' ×' + c.n : ''),
            'data-prog': known ? c.name : null,
            title: known
              ? 'Open ' + c.name + (c.n > 1 ? ' — called ' + c.n + ' times in this block' : '')
              : c.name + ' is not in the library'
          }));
        });
        card.appendChild(cc);
      }

      flow.edges.filter(function (e) { return e.from === b.idx && e.missing; })
        .forEach(function (e) {
          card.appendChild(h('div', { class: 'fc-missing', text: '⚠ jumps to ' + e.label + ' — label not defined' }));
        });

      cfg.cards.push(card);
      cfg.col.appendChild(card);
    });
  }

  function cfgSpeaks(l) { return l.comment !== null || String(l.text).trim() !== ''; }

  /* A heading is something the programmer already wrote: TP code is full of
   * !***Appr Conveyor*** banner comments sitting above the label they
   * describe, and buildFlow keeps those with the block that follows them. */
  function cfgCaption(b) {
    // only "!" remarks make headings — a "//PAUSE" is a disabled instruction, not a title
    var isRemark = function (l) { return l.comment !== null && !/^\/\//.test(l.text); };
    var lead = (b.leadIn ? b.lines.slice(0, b.leadIn) : []).filter(isRemark);
    if (!lead.length) lead = b.lines.filter(isRemark);
    var txt = lead.slice(0, 2)
      .map(function (l) {
        return String(l.text).replace(/^\s*!/, '').replace(/^[\s*=_-]+/, '').replace(/[\s*=_-]+$/, '').trim();
      })
      .filter(function (t) { return t; });
    return txt.length ? txt.join(' · ') : null;
  }

  /* What is inside the block — the whole heading for a block with no caption
   * of its own, and a size cue for the ones that have one. */
  function cfgSummary(b) {
    var moves = 0, waits = 0, io = 0, regs = 0, jumps = 0;
    b.lines.forEach(function (l) {
      if (l.comment !== null || !String(l.text).trim()) return;
      var t = String(l.text);
      if (l.motion) moves++;
      if (/^WAIT\b/i.test(t)) waits++;
      if (/\bJMP\b/.test(t)) jumps++;
      if (/^(?:WAIT|IF)\b/i.test(t)) return;   // an = in a test is not a write
      if (/\b(?:DO|RO|GO|AO|SO|UO|F|M)\[[^\]]*\]\s*=/.test(t)) io++;
      if (/(?:^|[^A-Z])R\[[^\]]*\]\s*=/.test(t)) regs++;
    });
    var parts = [cfgPlural(b.activeCount, 'line')];
    if (moves) parts.push(cfgPlural(moves, 'move'));
    if (waits) parts.push(cfgPlural(waits, 'wait'));
    if (io) parts.push(io + ' I/O');
    if (regs) parts.push(cfgPlural(regs, 'register'));
    if (jumps) parts.push(cfgPlural(jumps, 'jump'));
    return parts.join(' · ');
  }

  function cfgPlural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  /* One chip per program called, not one per CALL line: a block that sets
   * three offsets in a row was showing → _SET_OFFS three times over. */
  function cfgCounted(names) {
    var out = [], seen = {};
    names.forEach(function (n) {
      if (seen[n] === undefined) { seen[n] = out.length; out.push({ name: n, n: 1 }); }
      else out[seen[n]].n++;
    });
    return out;
  }

  function cfgIndexLines() {
    cfg.lineBlock = {};
    cfg.flow.blocks.forEach(function (b) {
      b.lines.forEach(function (l) { cfg.lineBlock[l.num] = b.idx; });
    });
  }

  /* ---- tiers and layout ---- */

  function cfgTierFor(k, current) {
    // paired thresholds, so a tier does not flicker while you scrub the wheel
    if (k >= 0.62) return 'full';
    if (k >= 0.55 && current === 'full') return 'full';
    if (k >= 0.30) return 'compact';
    if (k >= 0.26 && current === 'compact') return 'compact';
    return 'map';
  }

  function cfgApplyTier(t) {
    cfgTier = t;
    cfg.canvas.className = 'flow-canvas tier-' + t + (state.flowFocus === null ? '' : ' isolated');
    cfg.cards.forEach(function (card, i) {
      var b = cfg.flow.blocks[i];
      // 3.2px of height per real line, so a long block still reads as long
      card.style.height = t === 'map'
        ? Math.max(13, Math.min(220, b.activeCount * 3.2)) + 'px'
        : '';
    });
  }

  /* Which column a block belongs in.
   *
   * A forward jump means "skip the next few blocks", so what it skips is a
   * branch body and belongs one column right; the jump itself becomes a short
   * hop down the spine instead of a long arc past everything.
   *
   * Depth is nesting, not overlap. A chain of IFs produces spans that cross
   * each other — block 7 skips to 9 while block 8 skips to 10 — and counting
   * every span over a block would march the whole middle of the program off to
   * the right one step at a time. Only a span that strictly contains another
   * pushes it further out, and only the longest jump out of any one block
   * counts, because a dispatcher with eight IF…JMPs is offering eight
   * alternatives, not eight nested branches. */
  var CFG_MAX_COL = 4;

  function cfgColumns() {
    var d = [], i;
    for (i = 0; i < cfg.flow.blocks.length; i++) d.push(0);
    var longest = {};
    cfg.flow.edges.forEach(function (e) {
      if (e.to === null || e.kind === 'fall' || e.to <= e.from + 1) return;
      if (longest[e.from] === undefined || e.to > longest[e.from]) longest[e.from] = e.to;
    });
    var spans = Object.keys(longest).map(function (from) {
      return { lo: +from + 1, hi: longest[from] - 1 };
    });
    spans.forEach(function (sp) {
      sp.depth = 0;
      spans.forEach(function (o) {
        if (o === sp) return;
        if (o.lo <= sp.lo && o.hi >= sp.hi && (o.lo < sp.lo || o.hi > sp.hi)) sp.depth++;
      });
    });
    spans.forEach(function (sp) {
      for (var k = sp.lo; k <= sp.hi; k++) if (sp.depth + 1 > d[k]) d[k] = sp.depth + 1;
    });
    return d.map(function (v) { return Math.min(v, CFG_MAX_COL); });
  }

  /* Place the blocks and record geom[] in canvas coordinates. The side gutters
   * are sized from the arrows that actually need them, so no arrow ever runs
   * off the canvas however wide the gaps are set. */
  function cfgRelayout() {
    if (!cfg.cards.length) { cfg.geom = []; return; }
    var gy = cfgGaps().y[cfgTier];
    var pitch = cfgPitch();
    var padL, padR;

    if (cfgChartMode()) {
      cfg.col.classList.add('chart');
      var cw = cfgTier === 'map' ? CFG_CARD_W.chartMap : CFG_CARD_W.chartFull;
      var cols = cfgColumns();
      var lanes = cfgAssignLanes(cols);
      var nCols = Math.max.apply(null, cols) + 1;

      /* Each gap carries two channels: the forward jumps leaving the column on
       * its left and the backward jumps arriving at the column on its right.
       * Size it for exactly those — sizing every gap for the worst channel in
       * the program is what pushes the canvas out to thousands of pixels on a
       * program with one dispatcher. */
      var colX = [0], c;
      for (c = 0; c + 1 < nCols; c++) {
        colX.push(colX[c] + cw + Math.max(cfgGaps().colGap,
          44 + ((lanes.fwd[c] || 0) + (lanes.back[c + 1] || 0)) * pitch));
      }
      cfg.chart = { cols: cols, colX: colX, cw: cw };
      padL = 44 + (lanes.back[0] || 0) * pitch;
      padR = 44 + (lanes.fwd[nCols - 1] || 0) * pitch;

      // width first, then heights — a card's height depends on its width
      cfg.cards.forEach(function (cd, i) {
        cd.style.width = cw + 'px';
        cd.style.left = colX[cols[i]] + 'px';
        cd.style.top = '0px';
      });
      var y = 0;
      cfg.geom = cfg.cards.map(function (cd, i) {
        var hh = cd.offsetHeight;
        cd.style.top = y + 'px';
        var g = { x: colX[cols[i]], y: y, w: cw, h: hh };
        y += hh + gy;
        return g;
      });
      cfg.col.style.height = Math.max(0, y - gy) + 'px';
      cfg.col.style.width = (colX[nCols - 1] + cw) + 'px';
    } else {
      cfg.chart = null;
      cfg.col.classList.remove('chart');
      cfg.cards.forEach(function (cd) { cd.style.width = ''; cd.style.left = ''; cd.style.top = ''; });
      cfg.col.style.height = '';
      cfg.col.style.width = '';
      cfg.col.style.gap = gy + 'px';
      cfg.geom = [];
      padL = 44 + (cfgAssignLanes(null).back[0] || 0) * pitch;
      padR = 24;
    }

    cfg.canvas.style.paddingLeft = padL + 'px';
    cfg.canvas.style.paddingRight = padR + 'px';

    if (cfgChartMode()) {
      // .flow-col is positioned in chart mode, so its own offset is the origin
      var bx = cfg.col.offsetLeft, by = cfg.col.offsetTop;
      cfg.geom.forEach(function (g) { g.x += bx; g.y += by; });
    } else {
      // in column mode a card's own offsets are already canvas-relative
      cfg.geom = cfg.cards.map(function (cd) {
        return { x: cd.offsetLeft, y: cd.offsetTop, w: cd.offsetWidth, h: cd.offsetHeight };
      });
    }
  }

  /* Every jump gets a vertical lane to run down. Lanes are handed out by
   * interval colouring, so two jumps share one only when their spans do not
   * overlap — an index-modulo-N lane drops unrelated arrows on top of each
   * other, which is most of what makes a gutter look like a knot. A forward
   * jump uses the channel right of the rightmost column it touches, a backward
   * jump the one left of the leftmost, so a loop and a skip can never be drawn
   * over each other. */
  function cfgAssignLanes(cols) {
    var jumps = cfg.flow.edges.filter(function (e) { return e.kind !== 'fall' && e.to !== null; });
    if (!cols) {                          // column layout: one shared gutter
      return { fwd: {}, back: { 0: cfgColourLanes(jumps.map(cfgSpan)) } };
    }
    var gf = {}, gb = {}, fwd = {}, back = {};
    jumps.forEach(function (e) {
      var a = cols[e.from], b = cols[e.to];
      if (e.to > e.from) (gf[Math.max(a, b)] = gf[Math.max(a, b)] || []).push(cfgSpan(e));
      else (gb[Math.min(a, b)] = gb[Math.min(a, b)] || []).push(cfgSpan(e));
    });
    Object.keys(gf).forEach(function (g) { fwd[g] = cfgColourLanes(gf[g]); });
    Object.keys(gb).forEach(function (g) { back[g] = cfgColourLanes(gb[g]); });
    return { fwd: fwd, back: back };
  }

  function cfgSpan(e) { return { e: e, t: Math.min(e.from, e.to), b: Math.max(e.from, e.to) }; }

  function cfgColourLanes(items) {
    items.sort(function (a, b) { return a.t - b.t || a.b - b.b; });
    var ends = [];
    items.forEach(function (it) {
      for (var i = 0; i < ends.length; i++) {
        if (ends[i] <= it.t) { ends[i] = it.b; it.e.lane = i; return; }
      }
      it.e.lane = ends.length;
      ends.push(it.b);
    });
    return ends.length;
  }

  /* Changing tier or layout changes every card's position, so the block you
   * were reading would jump away. Pin it: remember which block sits under the
   * viewport centre and where inside it, then put that spot back. */
  function cfgAnchor() {
    if (!cfg || !cfg.geom.length) return null;
    var cy = cfg.vp.clientHeight / 2;
    var worldY = (cy - cfgView.y) / cfgView.k;
    for (var i = 0; i < cfg.geom.length; i++) {
      if (worldY < cfg.geom[i].y + cfg.geom[i].h || i === cfg.geom.length - 1) {
        return {
          idx: i,
          frac: cfg.geom[i].h ? Math.max(0, Math.min(1, (worldY - cfg.geom[i].y) / cfg.geom[i].h)) : 0,
          cy: cy
        };
      }
    }
    return null;
  }

  function cfgRebuild(anchor) {
    cfgApplyTier(cfgTier);
    cfgRelayout();
    if (anchor && cfg.geom[anchor.idx]) {
      cfgView.y = anchor.cy - (cfg.geom[anchor.idx].y + anchor.frac * cfg.geom[anchor.idx].h) * cfgView.k;
    }
    cfgApplyView();
    cfgAfterLayout();
  }

  function cfgAfterLayout() {
    cfgHush();
    cfgDrawEdges();
    cfgDrawMini();
  }

  /* At the bars tier a 13px block is 2px of screen at 15% zoom, and the title
   * inside it is noise. Hide it when it cannot render at a readable size — the
   * overview strip and the hover read-out cover reading at that range. */
  function cfgHush() {
    if (cfgTier !== 'map') {
      cfg.cards.forEach(function (c) { c.classList.remove('hushed'); });
      return;
    }
    cfg.cards.forEach(function (c, i) {
      c.classList.toggle('hushed', (cfg.geom[i] ? cfg.geom[i].h : 0) * cfgView.k < 9);
    });
  }

  /* ---- arrows ---- */

  /* markerUnits defaults to strokeWidth, which multiplies the head by the
   * line — and the width already carries the zoom compensation, so a
   * highlighted arrow ended up wearing a head several times the size of a
   * plain one. Size it in user units and scale it by the zoom alone, so every
   * head is a constant 7px on screen whatever the arrow is doing. */
  function cfgMarker(id, color, inv) {
    var mk = document.createElementNS(NS_SVG, 'marker');
    mk.setAttribute('id', id);
    mk.setAttribute('viewBox', '0 0 10 10');
    mk.setAttribute('refX', '9'); mk.setAttribute('refY', '5');
    mk.setAttribute('markerUnits', 'userSpaceOnUse');
    mk.setAttribute('markerWidth', (7 * inv).toFixed(2));
    mk.setAttribute('markerHeight', (7 * inv).toFixed(2));
    mk.setAttribute('orient', 'auto-start-reverse');
    var p = document.createElementNS(NS_SVG, 'path');
    p.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    p.setAttribute('fill', color);
    mk.appendChild(p);
    return mk;
  }

  function cfgOnFocus(e) {
    return state.flowFocus !== null && (e.from === state.flowFocus || e.to === state.flowFocus);
  }

  /* Shape and colour only. Width, fade and arrowhead are decided in one pass
   * afterwards, because hovering an arrow changes them for every arrow at once
   * and redrawing the geometry on mousemove would be waste. */
  function cfgRegister(path, e, markerId) {
    var inv = 1 / Math.max(0.35, cfgView.k);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linejoin', 'round');
    if (e.kind === 'cond') {
      path.setAttribute('stroke-dasharray', (5 * inv).toFixed(1) + ' ' + (4 * inv).toFixed(1));
    }
    var idx = cfg.drawn.length;
    cfg.drawn.push({ e: e, path: path, marker: 'url(#' + markerId + ')' });
    cfg.gVis.appendChild(path);

    /* A hairline is not something you can reliably point at, so every arrow
     * gets an invisible fat twin to catch the cursor. They all live in a layer
     * above the visible ones, where hit-testing finds them first. */
    var hit = document.createElementNS(NS_SVG, 'path');
    hit.setAttribute('d', path.getAttribute('d'));
    hit.setAttribute('fill', 'none');
    hit.setAttribute('stroke', 'transparent');
    hit.setAttribute('stroke-width', (11 * inv).toFixed(2));
    hit.setAttribute('data-edge', String(idx));
    cfg.gHit.appendChild(hit);
  }

  /* Point at an arrow and it is the only one drawn solid, with the blocks at
   * both ends outlined — which is the whole question a jump-heavy program
   * raises: where does this one go? */
  function cfgEmphasise() {
    var inv = 1 / Math.max(0.35, cfgView.k);
    var hot = cfg.hoverEdge !== null && cfg.drawn[cfg.hoverEdge] ? cfg.drawn[cfg.hoverEdge].e : null;

    cfg.cards.forEach(function (c) { c.classList.remove('hot'); });

    cfg.drawn.forEach(function (d, i) {
      var lit = hot ? i === cfg.hoverEdge : (state.flowFocus === null || cfgOnFocus(d.e));
      var strong = hot ? lit : (lit && state.flowFocus !== null);
      // the fade on everything else carries the emphasis — the lit arrow only
      // needs a nudge, not to go fat
      d.path.setAttribute('stroke-width', ((strong ? 1.7 : 1.3) * inv).toFixed(2));
      d.path.setAttribute('opacity', lit ? '1' : '0.1');
      if (lit) d.path.setAttribute('marker-end', d.marker);
      else d.path.removeAttribute('marker-end');
    });

    if (hot) {
      if (cfg.cards[hot.from]) cfg.cards[hot.from].classList.add('hot');
      if (cfg.cards[hot.to]) cfg.cards[hot.to].classList.add('hot');
    }
  }

  function cfgSetHoverEdge(i) {
    if (!cfg || i === cfg.hoverEdge) return;
    cfg.hoverEdge = i;
    if (cfg.drawn.length) cfgEmphasise();
  }

  function cfgDrawEdges() {
    cfg.svg.innerHTML = '';
    cfg.drawn = [];
    if (!cfg.geom.length) return;
    var W = cfg.canvas.offsetWidth, H = cfg.canvas.offsetHeight;
    cfg.svg.setAttribute('width', W); cfg.svg.setAttribute('height', H);
    cfg.svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    var inv = 1 / Math.max(0.35, cfgView.k);
    var defs = document.createElementNS(NS_SVG, 'defs');
    defs.appendChild(cfgMarker('fc-arr-fall', 'var(--gutter)', inv));
    defs.appendChild(cfgMarker('fc-arr-fwd', 'var(--motion)', inv));
    defs.appendChild(cfgMarker('fc-arr-back', 'var(--accent)', inv));
    cfg.svg.appendChild(defs);

    cfg.gVis = document.createElementNS(NS_SVG, 'g');
    cfg.gHit = document.createElementNS(NS_SVG, 'g');
    cfg.gHit.setAttribute('class', 'hits');
    cfg.svg.appendChild(cfg.gVis);
    cfg.svg.appendChild(cfg.gHit);

    cfgAssignLanes(cfg.chart ? cfg.chart.cols : null);

    // dimmed arrows first, so the isolated ones draw over them
    cfg.flow.edges.slice()
      .sort(function (a, b) { return (cfgOnFocus(a) ? 1 : 0) - (cfgOnFocus(b) ? 1 : 0); })
      .forEach(function (e) {
        if (e.to === null || !cfg.geom[e.from] || !cfg.geom[e.to]) return;
        if (cfgChartMode()) cfgChartEdge(e);
        else cfgColumnEdge(e);
      });
    cfgEmphasise();
  }

  /* column layout: a spine in the gutter for fall-through, beziers for jumps */
  function cfgColumnEdge(e) {
    var a = cfg.geom[e.from], b = cfg.geom[e.to];
    var GUT = a.x;
    var path = document.createElementNS(NS_SVG, 'path');
    var mk;
    if (e.kind === 'fall') {
      var x = GUT - 8;
      path.setAttribute('d', 'M ' + x + ' ' + (a.y + a.h + 1) + ' L ' + x + ' ' + (b.y - 1));
      path.setAttribute('stroke', 'var(--gutter)');
      mk = 'fc-arr-fall';
    } else {
      var back = b.y < a.y;
      var y1 = Math.max(a.y + 2, a.y + a.h - 14);
      var y2 = b.y + Math.min(8, b.h / 2);
      var xr = GUT - 22 - (e.lane || 0) * cfgPitch();
      path.setAttribute('d', 'M ' + GUT + ' ' + y1 +
        ' C ' + xr + ' ' + y1 + ', ' + xr + ' ' + y2 + ', ' + GUT + ' ' + y2);
      path.setAttribute('stroke', back ? 'var(--accent)' : 'var(--motion)');
      mk = back ? 'fc-arr-back' : 'fc-arr-fwd';
    }
    cfgRegister(path, e, mk);
  }

  /* chart layout: right-angle routing. Fall-through drops out of the bottom
   * and into the top of the next block; a jump leaves the side of its block,
   * runs down a lane clear of every column it passes, and comes back in at the
   * side of its target. */
  function cfgChartEdge(e) {
    var a = cfg.geom[e.from], b = cfg.geom[e.to];
    var path = document.createElementNS(NS_SVG, 'path');

    if (e.kind === 'fall') {
      var ax = a.x + 30, bx = b.x + 30;
      var y1 = a.y + a.h + 1, y2 = b.y - 1;
      path.setAttribute('d', Math.abs(ax - bx) < 1
        ? 'M ' + ax + ' ' + y1 + ' L ' + ax + ' ' + y2
        : cfgElbow([[ax, y1], [ax, (y1 + y2) / 2], [bx, (y1 + y2) / 2], [bx, y2]], 8));
      path.setAttribute('stroke', 'var(--gutter)');
      cfgRegister(path, e, 'fc-arr-fall');
      return;
    }

    var back = e.to < e.from;
    var lane = e.lane || 0, pitch = cfgPitch();
    var x0, x1, xc;
    if (back) {
      x0 = a.x; x1 = b.x;
      xc = Math.min(a.x, b.x) - 22 - lane * pitch;
    } else {
      x0 = a.x + a.w; x1 = b.x + b.w;
      xc = Math.max(a.x + a.w, b.x + b.w) + 22 + lane * pitch;
    }
    var ya = a.y + Math.max(10, a.h - 14);      // leaves at the jump line
    var yb = b.y + Math.min(10, b.h / 2);       // arrives at the top of the target
    path.setAttribute('d', cfgElbow([[x0, ya], [xc, ya], [xc, yb], [x1, yb]], 8));
    path.setAttribute('stroke', back ? 'var(--accent)' : 'var(--motion)');
    cfgRegister(path, e, back ? 'fc-arr-back' : 'fc-arr-fwd');
  }

  /* Orthogonal polyline with rounded corners: right angles read as a wiring
   * diagram, and the rounding stops them looking like stair steps. */
  function cfgElbow(pts, r) {
    var d = 'M ' + pts[0][0] + ' ' + pts[0][1];
    for (var i = 1; i < pts.length - 1; i++) {
      var prev = pts[i - 1], p = pts[i], next = pts[i + 1];
      var rr = Math.min(r,
        (Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1])) / 2,
        (Math.abs(next[0] - p[0]) + Math.abs(next[1] - p[1])) / 2);
      var inDx = cfgSign(p[0] - prev[0]), inDy = cfgSign(p[1] - prev[1]);
      var outDx = cfgSign(next[0] - p[0]), outDy = cfgSign(next[1] - p[1]);
      d += ' L ' + (p[0] - inDx * rr) + ' ' + (p[1] - inDy * rr);
      d += ' Q ' + p[0] + ' ' + p[1] + ' ' + (p[0] + outDx * rr) + ' ' + (p[1] + outDy * rr);
    }
    var last = pts[pts.length - 1];
    return d + ' L ' + last[0] + ' ' + last[1];
  }

  function cfgSign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }

  /* ---- the view ---- */

  function cfgApplyView() {
    cfg.canvas.style.transform = 'translate(' + cfgView.x.toFixed(1) + 'px,' + cfgView.y.toFixed(1) +
      'px) scale(' + cfgView.k.toFixed(4) + ')';
    if (cfg.zoomRead) cfg.zoomRead.textContent = Math.round(cfgView.k * 100) + '%';
    cfgMiniViewport();
  }

  function cfgZoomTo(k, cx, cy) {
    if (!cfg) return;
    k = Math.max(CFG_KMIN, Math.min(CFG_KMAX, k));
    if (k === cfgView.k) return;
    if (cx === undefined) { cx = cfg.vp.clientWidth / 2; cy = cfg.vp.clientHeight / 2; }
    var wx = (cx - cfgView.x) / cfgView.k, wy = (cy - cfgView.y) / cfgView.k;
    cfgView.k = k;
    cfgView.x = cx - wx * k;
    cfgView.y = cy - wy * k;
    cfgApplyView();

    var want = state.flowDetail === 'auto' ? cfgTierFor(cfgView.k, cfgTier) : state.flowDetail;
    if (want !== cfgTier) { var a = cfgAnchor(); cfgApplyTier(want); cfgRebuild(a); }
    else { cfgHush(); cfgScheduleEdges(); }
  }

  /* Only the stroke width depends on zoom, so redrawing the arrows can wait
   * for the wheel to settle. */
  var cfgEdgeTimer = null;
  function cfgScheduleEdges() {
    clearTimeout(cfgEdgeTimer);
    cfgEdgeTimer = setTimeout(function () { if (cfg) cfgDrawEdges(); }, 90);
  }

  function cfgCentre(k) {
    var cw = cfg.canvas.offsetWidth, ch = cfg.canvas.offsetHeight;
    cfgView.k = k;
    cfgView.x = cw * k < cfg.vp.clientWidth ? (cfg.vp.clientWidth - cw * k) / 2 : 8;
    cfgView.y = ch * k < cfg.vp.clientHeight ? (cfg.vp.clientHeight - ch * k) / 2 : 8;
    cfgApplyView();
  }

  function cfgFitScale() {
    var cw = cfg.canvas.offsetWidth, ch = cfg.canvas.offsetHeight;
    if (!cw || !ch) return 1;
    return Math.max(CFG_FIT_FLOOR, Math.min(1,
      Math.min((cfg.vp.clientWidth - 16) / cw, (cfg.vp.clientHeight - 16) / ch)));
  }

  /* Fitting and auto-detail chase each other: a coarser tier makes the program
   * fit, which raises the zoom, which asks for a finer tier again. So solve it
   * as a fixed point — try a tier, measure, stop when the zoom that tier fits
   * at is the zoom that tier belongs to. If two tiers trade places, keep the
   * coarser one and hold the zoom at its ceiling, so "auto" never lands in a
   * state its own rule disagrees with. */
  function cfgFit() {
    if (!cfg || !cfg.cards.length) return;
    if (state.flowDetail !== 'auto') {
      cfgApplyTier(state.flowDetail);
      cfgRelayout();
      cfgCentre(cfgFitScale());
    } else {
      var t = cfgTier, k = 1, seen = [];
      for (var pass = 0; pass < 4; pass++) {
        cfgApplyTier(t);
        cfgRelayout();
        k = cfgFitScale();
        var want = cfgTierFor(k, t);
        if (want === t) break;
        if (seen.indexOf(want) !== -1) {          // oscillating — take the coarser
          t = CFG_TIERS[Math.max(CFG_TIERS.indexOf(want), CFG_TIERS.indexOf(t))];
          cfgApplyTier(t);
          cfgRelayout();
          k = Math.min(cfgFitScale(), CFG_TIER_MAX[t]);
          break;
        }
        seen.push(t);
        t = want;
      }
      cfgCentre(Math.min(k, CFG_TIER_MAX[t]));
    }
    cfgAfterLayout();
  }

  /* ---- pointer ---- */

  function cfgCapture(el, id, on) {
    try { if (on) el.setPointerCapture(id); else el.releasePointerCapture(id); }
    catch (e) { /* not capturable */ }
  }

  function cfgUpTo(target, cls, stop) {
    var t = target;
    while (t && t !== stop) {
      if (t.classList && t.classList.contains(cls)) return t;
      t = t.parentNode;
    }
    return null;
  }

  function cfgAttrAt(target, name, stop) {
    var t = target;
    while (t && t !== stop) {
      if (t.getAttribute) {
        var v = t.getAttribute(name);
        if (v !== null) return v;
      }
      t = t.parentNode;
    }
    return null;
  }

  function cfgWire() {
    var vp = cfg.vp, canvas = cfg.canvas;
    var drag = null, press = null;

    vp.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var dy = ev.deltaY * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? vp.clientHeight : 1);
      if (ev.shiftKey) {                        // shift+wheel scrolls, for reading
        cfgView.y -= dy;
        cfgApplyView();
        return;
      }
      // ctrlKey arrives from a trackpad pinch: same gesture, finer steps
      var rate = ev.ctrlKey ? 0.010 : 0.0022;
      var r = vp.getBoundingClientRect();
      cfgZoomTo(cfgView.k * Math.exp(-dy * rate), ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });

    /* A left drag pans only from the background: inside a block the browser is
     * left alone so the program text can be selected. The middle button pans
     * from anywhere, including across a block. */
    vp.addEventListener('pointerdown', function (ev) {
      var hit = cfgUpTo(ev.target, 'flow-card', canvas);
      if (ev.button === 1 || (ev.button === 0 && !hit)) {
        // no autoscroll cursor, and no selection started underneath — without
        // this a pan sweeps a selection across every block it passes over
        ev.preventDefault();
        drag = { x: ev.clientX, y: ev.clientY, ox: cfgView.x, oy: cfgView.y, moved: 0, hit: hit };
        cfgCapture(vp, ev.pointerId, true);
        vp.classList.add('panning');
        cfgHideTip();
        cfgSetHoverEdge(null);
        return;
      }
      if (ev.button === 0) {
        press = {
          card: hit,
          ln: cfgAttrAt(ev.target, 'data-ln', canvas),
          prog: cfgAttrAt(ev.target, 'data-prog', canvas),
          x: ev.clientX, y: ev.clientY
        };
      }
    });

    vp.addEventListener('pointermove', function (ev) {
      if (drag) {
        var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        drag.moved = Math.max(drag.moved, Math.abs(dx) + Math.abs(dy));
        cfgView.x = drag.ox + dx;
        cfgView.y = drag.oy + dy;
        cfgApplyView();
        return;
      }
      // a press that turns into a drag is the user selecting text, not a click
      if (press && Math.abs(ev.clientX - press.x) + Math.abs(ev.clientY - press.y) > 4) press = null;
      var onEdge = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-edge');
      cfgSetHoverEdge(onEdge === null || onEdge === undefined ? null : parseInt(onEdge, 10));
      cfgHoverTip(ev);
    });

    vp.addEventListener('pointerup', function (ev) {
      if (drag) {
        var wasClick = drag.moved < 4, hit = drag.hit;
        drag = null;
        vp.classList.remove('panning');
        cfgCapture(vp, ev.pointerId, false);
        /* Pointer capture retargets this event to the viewport, so the block
         * has to come from the press, not from ev.target. */
        if (wasClick) cfgSetFocus(hit);
        return;
      }
      if (!press) return;
      var pr = press;
      press = null;
      // most specific first: a → chip, then a line or the ↗, then the block
      if (pr.prog) { state.selected = pr.prog; render(); }
      else if (pr.ln !== null) gotoLine(cfg.p.parsed.name, parseInt(pr.ln, 10));
      else cfgSetFocus(pr.card);
    });

    vp.addEventListener('pointercancel', function () {
      drag = null; press = null; vp.classList.remove('panning');
    });
    vp.addEventListener('pointerleave', function () {
      cfgHideTip();
      cfgSetHoverEdge(null);
    });

    var miniDrag = false;
    cfg.mini.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();            // no text selection while scrubbing
      miniDrag = true;
      cfgCapture(cfg.mini, ev.pointerId, true);
      cfgMiniSeek(ev);
    });
    cfg.mini.addEventListener('pointermove', function (ev) { if (miniDrag) cfgMiniSeek(ev); });
    cfg.mini.addEventListener('pointerup', function (ev) {
      miniDrag = false;
      cfgCapture(cfg.mini, ev.pointerId, false);
    });

    // the viewport is user-resizable, and the overview is scaled to its height
    if (window.ResizeObserver) {
      new ResizeObserver(function () { if (cfg && cfg.vp === vp) cfgDrawMini(); }).observe(vp);
    }
  }

  /* Isolation: the clicked block plus every block an arrow runs to or from.
   * Everything else recedes, and so do the arrows that miss it. Handled in
   * place rather than through render(), so the zoom and pan stay put. */
  function cfgSetFocus(card) {
    if (!cfg) return;
    if (!card) state.flowFocus = null;
    else {
      var idx = parseInt(card.getAttribute('data-block'), 10);
      state.flowFocus = state.flowFocus === idx ? null : idx;
    }
    cfgPaintFocus();
    cfgDrawEdges();
    cfgPaintHint();
  }

  function cfgPaintFocus() {
    var focus = state.flowFocus;
    var related = {};
    if (focus !== null) {
      related[focus] = true;
      cfg.flow.edges.forEach(function (e) {
        if (e.from === focus && e.to !== null) related[e.to] = true;
        if (e.to === focus) related[e.from] = true;
      });
    }
    cfg.canvas.classList.toggle('isolated', focus !== null);
    cfg.cards.forEach(function (c, i) {
      c.classList.remove('focus', 'related', 'dimmed');
      if (focus === null) return;
      c.classList.add(i === focus ? 'focus' : (related[i] ? 'related' : 'dimmed'));
    });
  }

  function cfgPaintHint() {
    if (!cfg) return;
    cfg.hint.innerHTML = '';
    var focus = state.flowFocus;
    cfg.hint.appendChild(document.createTextNode(focus === null
      ? 'Wheel zooms, dragging the background pans (or middle-drag anywhere), shift+wheel scrolls. Amber arrows go up — a loop; blue go down — a skip; dashed is conditional. Hover an arrow to trace it, click a block to isolate its jumps, ↗ or a line to open the code.'
      : 'Isolated ' + cfg.flow.blocks[focus].title + ' — only the arrows into and out of it are drawn, and the blocks they connect stay lit. '));
    if (focus !== null) {
      cfg.hint.appendChild(h('button', {
        class: 'btn subtle', text: 'Show all',
        onclick: function () { cfgSetFocus(null); }
      }));
    }
  }

  /* The read-out answers "what am I looking at" when the blocks are 3px tall.
   * Screen-sized, so zoom never touches it. */
  function cfgHoverTip(ev) {
    var c = cfgUpTo(ev.target, 'flow-card', cfg.canvas);
    if (!c || cfgTier === 'full') { cfgHideTip(); return; }
    var b = cfg.flow.blocks[parseInt(c.getAttribute('data-block'), 10)];
    if (!cfgTip) { cfgTip = h('div', { class: 'flow-tip' }); document.body.appendChild(cfgTip); }
    cfgTip.innerHTML = '';
    var cap = cfgCaption(b);
    cfgTip.appendChild(h('div', { class: 't', text: b.title + (cap ? '  ' + cap : '') }));
    cfgTip.appendChild(h('div', { class: 'r', text: 'lines ' + b.startNum + '–' + b.endNum + ' · ' + cfgSummary(b) }));
    cfgTip.appendChild(h('pre', {
      text: b.lines.filter(cfgSpeaks).slice(0, 8).map(function (l) {
        return l.num + '  ' + (l.motion ? l.motion + ' ' : '') + l.text;
      }).join('\n')
    }));
    cfgTip.style.display = 'block';
    cfgTip.style.left = Math.max(4, Math.min(window.innerWidth - cfgTip.offsetWidth - 8, ev.clientX + 14)) + 'px';
    cfgTip.style.top = Math.max(4, Math.min(window.innerHeight - cfgTip.offsetHeight - 8, ev.clientY + 14)) + 'px';
  }

  function cfgHideTip() { if (cfgTip) cfgTip.style.display = 'none'; }

  /* ---- overview strip ---- */

  function cfgDrawMini() {
    if (!cfg) return;
    cfg.minisvg.innerHTML = '';
    cfg.miniGeom = null;
    if (!state.flowMini || !cfg.geom.length) return;
    var mw = cfg.mini.clientWidth, mh = cfg.mini.clientHeight;
    if (!mw || !mh) return;
    cfg.minisvg.setAttribute('viewBox', '0 0 ' + mw + ' ' + mh);

    var padT = 22, padL = 10;
    var contentW = cfg.canvas.offsetWidth, contentH = cfg.canvas.offsetHeight;
    /* Separate scales on the two axes: the strip is a schematic, not a scale
     * drawing, and these programs are far taller than they are wide. */
    var wide = cfgChartMode();
    var sy = (mh - padT - 10) / contentH;
    var sx = wide ? (mw - padL - 62) / contentW : 0;
    cfg.miniGeom = { sx: sx, sy: sy, padT: padT, padL: padL, wide: wide, contentW: contentW, contentH: contentH };

    var g = document.createElementNS(NS_SVG, 'g');
    var lastLabelY = -99;
    cfg.geom.forEach(function (gm, i) {
      var b = cfg.flow.blocks[i];
      var y = padT + gm.y * sy, hgt = Math.max(1.2, gm.h * sy);
      var r = document.createElementNS(NS_SVG, 'rect');
      r.setAttribute('x', (wide ? padL + gm.x * sx : padL + 2).toFixed(2));
      r.setAttribute('y', y.toFixed(2));
      r.setAttribute('width', (wide ? Math.max(3, gm.w * sx) : 34).toFixed(2));
      r.setAttribute('height', hgt.toFixed(2));
      r.setAttribute('rx', '1.5');
      r.setAttribute('fill', b.kind.indexOf('stop') !== -1 ? 'var(--write)'
        : b.kind === 'label' ? 'var(--accent)' : 'var(--gutter)');
      r.setAttribute('opacity', b.kind === 'normal' ? '0.45' : '0.85');
      g.appendChild(r);

      /* Landmarks get a name at true screen size — this is the part that stays
       * readable when the canvas itself is down at 12%. */
      if (b.kind.indexOf('label') === 0 && y - lastLabelY > 11) {
        var t = document.createElementNS(NS_SVG, 'text');
        t.setAttribute('x', (wide ? mw - 58 : padL + 41).toFixed(1));
        t.setAttribute('y', (y + Math.min(hgt, 8)).toFixed(2));
        t.setAttribute('font-size', '9.5');
        t.setAttribute('font-family', 'IBM Plex Mono, monospace');
        t.setAttribute('fill', 'var(--faint)');
        t.textContent = b.title.replace(/^LBL\[(\d+)\]\s*/, '$1 ').slice(0, wide ? 7 : 15);
        g.appendChild(t);
        lastLabelY = y;
      }
    });
    cfg.minisvg.appendChild(g);

    var vpr = document.createElementNS(NS_SVG, 'rect');
    vpr.setAttribute('class', 'vpr');
    vpr.setAttribute('fill', 'var(--accent)'); vpr.setAttribute('fill-opacity', '0.14');
    vpr.setAttribute('stroke', 'var(--accent)'); vpr.setAttribute('stroke-width', '1');
    vpr.setAttribute('rx', '2');
    cfg.minisvg.appendChild(vpr);
    cfgMiniViewport();
  }

  /* The box says which part of the program is on screen. Zoomed right out the
   * visible region is larger than the program, so clamp it to the strip —
   * otherwise it runs off both ends and reads as no box at all. */
  function cfgMiniViewport() {
    if (!cfg || !cfg.miniGeom) return;
    var mg = cfg.miniGeom;
    var vpr = cfg.minisvg.querySelector('.vpr');
    if (!vpr) return;
    var y0 = mg.padT + (-cfgView.y / cfgView.k) * mg.sy;
    var y1 = y0 + (cfg.vp.clientHeight / cfgView.k) * mg.sy;
    y0 = Math.max(mg.padT - 2, y0);
    y1 = Math.min(mg.padT + mg.contentH * mg.sy + 2, y1);
    vpr.setAttribute('y', y0.toFixed(2));
    vpr.setAttribute('height', Math.max(2, y1 - y0).toFixed(2));
    if (mg.wide) {
      var x0 = mg.padL + (-cfgView.x / cfgView.k) * mg.sx;
      var x1 = x0 + (cfg.vp.clientWidth / cfgView.k) * mg.sx;
      x0 = Math.max(mg.padL - 2, x0);
      x1 = Math.min(mg.padL + mg.contentW * mg.sx + 2, x1);
      vpr.setAttribute('x', x0.toFixed(2));
      vpr.setAttribute('width', Math.max(3, x1 - x0).toFixed(2));
    } else {
      vpr.setAttribute('x', (mg.padL - 2).toFixed(2));
      vpr.setAttribute('width', '42');
    }
  }

  function cfgMiniSeek(ev) {
    if (!cfg || !cfg.miniGeom) return;
    var mg = cfg.miniGeom;
    var r = cfg.mini.getBoundingClientRect();
    cfgView.y = cfg.vp.clientHeight / 2 - ((ev.clientY - r.top - mg.padT) / mg.sy) * cfgView.k;
    if (mg.wide && mg.sx > 0) {
      cfgView.x = cfg.vp.clientWidth / 2 - ((ev.clientX - r.left - mg.padL) / mg.sx) * cfgView.k;
    }
    cfgApplyView();
  }

  /* ---- keyboard, and the library-hiding class ---- */

  function cfgKey(ev) {
    if (state.tab !== 'flow' || !cfg) return false;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) return false;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return false;
    if (ev.key === '+' || ev.key === '=') { cfgZoomTo(cfgView.k * 1.25); return true; }
    if (ev.key === '-' || ev.key === '_') { cfgZoomTo(cfgView.k / 1.25); return true; }
    if (ev.key === '0') { cfgZoomTo(1); return true; }
    if (ev.key === 'f' || ev.key === 'F') { cfgFit(); return true; }
    if (ev.key === 'c' || ev.key === 'C') {
      state.flowLayout = cfgChartMode() ? 'column' : 'chart';
      savePrefs();
      render();
      return true;
    }
    if (ev.key === 's' || ev.key === 'S') {
      var opts = ['tight', 'normal', 'wide'];
      state.flowGaps = opts[(opts.indexOf(state.flowGaps) + 1) % opts.length];
      savePrefs();
      render();
      return true;
    }
    if (ev.key === 'Escape' && state.flowFocus !== null) { cfgSetFocus(null); return true; }
    return false;
  }

  /* Two ways to lose the 250px library. The header's ☰ hides it on every tab
   * (state.hideNav). The Flow tab has its own, because the graph is wide and
   * the library is the difference between reading it and panning constantly,
   * while on every other tab the library is how a program gets picked. */
  function applyFlowNav() {
    var app = document.querySelector('.app');
    if (!app) return;
    var hidden = !!state.hideNav || (state.tab === 'flow' && !!state.flowHideNav);
    app.classList.toggle('nav-hidden', hidden);
    var btn = document.getElementById('btn-nav');
    if (btn) {
      btn.classList.toggle('on', !!state.hideNav);
      btn.title = state.hideNav ? 'Show the program library (hidden on every tab)' : 'Hide the program library on every tab';
    }
  }

  /* Above the phone breakpoint the sidebar sits in the grid, so ☰ toggles the
   * saved hide; below it the sidebar is a drawer, and ☰ opens that instead. */
  function toggleNav() {
    if (window.matchMedia && window.matchMedia('(max-width: 760px)').matches) { setNav(!navOpen()); return; }
    state.hideNav = !state.hideNav;
    savePrefs();
    applyFlowNav();
  }

  /* ---- checks tab ---- */

  var SEV_LABEL = { error: 'Error', warn: 'Warning', info: 'Info' };
  var RULE_NAMES = {
    'syntax-error': 'Syntax the controller will refuse',
    'jump-to-missing-label': 'Jump to a missing label',
    'duplicate-label': 'Duplicate label definition',
    'unreachable-code': 'Unreachable code',
    'call-missing-program': 'Call to a program not in the library',
    'handshake-without-motion': 'Handshake without motion (DO=ON → WAIT, no move)',
    'unlabeled-register': 'Unlabeled register',
    'unlabeled-posreg': 'Unlabeled position register',
    'unlabeled-io': 'Unlabeled I/O point',
    'unused-label': 'Label nothing jumps to',
    'register-never-written': 'Register read but never written',
    'labeled-never-used-register': 'Labeled register never used',
    'labeled-never-used-io': 'Labeled I/O never used'
  };

  function visibleFindings() {
    return state.findings.filter(function (f) { return !state.hiddenRules[f.rule]; });
  }

  /* The problems one program is answerable for: what the "N issues" badge
   * counts, and what the Code view marks in the gutter. Info-level notes stay
   * out — they are observations, not things to go and fix — and a muted check
   * stays out too, so hiding a check in the Checks tab also stops it marking
   * up the listing. (The badge used to read state.findings directly and went
   * on counting checks you had hidden.) */
  function findingsFor(name) {
    return visibleFindings().filter(function (f) {
      return f.severity !== 'info' && f.refs.some(function (r) { return r.prog === name; });
    });
  }

  /* line number -> the findings pointing at it, within one program */
  function findingsByLine(name) {
    var byLine = {};
    findingsFor(name).forEach(function (f) {
      f.refs.forEach(function (r) {
        if (r.prog !== name) return;
        var list = byLine[r.line] || (byLine[r.line] = []);
        if (list.indexOf(f) === -1) list.push(f);
      });
    });
    return byLine;
  }

  function flaggedLines(name) {
    return Object.keys(findingsByLine(name))
      .map(Number)
      .sort(function (a, b) { return a - b; });
  }

  function renderChecks(pane) {
    /* A program the filter named can leave the library under it (removed, or
     * the library cleared), which would otherwise leave the tab stuck showing
     * nothing with no way to tell why. */
    if (state.checksProg && !state.programs[state.checksProg]) state.checksProg = null;
    var only = state.checksProg;

    var picker = h('select', { class: 'prog-select', title: 'Show only the findings that touch one program' });
    picker.appendChild(h('option', { value: '', text: 'All programs' }));
    Object.keys(state.programs).sort().forEach(function (n) {
      var o = h('option', { value: n, text: n });
      if (n === only) o.selected = true;
      picker.appendChild(o);
    });
    picker.addEventListener('change', function () {
      state.checksProg = picker.value || null;
      render();
    });

    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Program checks' }),
      picker,
      only ? h('span', {
        class: 'chip read', text: 'showing only ' + only + ' ' + '✕',
        title: 'Show every program again',
        onclick: function () { state.checksProg = null; render(); }
      }) : h('span', { class: 'muted', text: 'grouped by check — collapse a group, or Hide it to mute that check everywhere' })
    ]));

    if (!Object.keys(state.programs).length) {
      pane.appendChild(h('p', { class: 'muted', text: 'Import programs first — checks run across everything in the library.' }));
      return;
    }

    var visible = visibleFindings();
    if (only) {
      visible = visible.filter(function (f) {
        return f.refs.some(function (r) { return r.prog === only; });
      });
    }
    var counts = { error: 0, warn: 0, info: 0 };
    visible.forEach(function (f) { counts[f.severity]++; });
    var cards = h('div', { class: 'cards' });
    [['error', 'errors — will fault on the robot'], ['warn', 'warnings — review these'], ['info', 'notes']].forEach(function (c) {
      cards.appendChild(h('div', { class: 'card sev-' + c[0] }, [
        h('div', { class: 'k', text: counts[c[0]] }),
        h('div', { class: 'l', text: c[1] })
      ]));
    });
    pane.appendChild(cards);

    // hidden rules restore row
    var hidden = Object.keys(state.hiddenRules).filter(function (r) { return state.hiddenRules[r]; });
    if (hidden.length) {
      var hr = h('p', { class: 'muted' });
      hr.appendChild(document.createTextNode('Hidden checks: '));
      hidden.forEach(function (r) {
        hr.appendChild(h('span', {
          class: 'chip read', text: (RULE_NAMES[r] || r) + ' ✕',
          title: 'Show this check again',
          onclick: function () { delete state.hiddenRules[r]; savePrefs(); render(); }
        }));
      });
      pane.appendChild(hr);
    }

    if (!visible.length) {
      pane.appendChild(h('p', {
        text: only ? 'Nothing flagged in ' + only + '.'
          : hidden.length ? 'Nothing to show — every remaining check is clean.'
          : 'No issues found. Jumps all land on defined labels, every register and I/O point used has a label, and all called programs are present.'
      }));
      return;
    }

    // group by rule, ordered error → warn → info (findings are pre-sorted)
    var groups = [];
    var byRule = {};
    visible.forEach(function (f) {
      if (!byRule[f.rule]) {
        byRule[f.rule] = { rule: f.rule, severity: f.severity, items: [] };
        groups.push(byRule[f.rule]);
      }
      byRule[f.rule].items.push(f);
    });

    groups.forEach(function (g) {
      var open = state.checksOpen[g.rule] !== undefined ? state.checksOpen[g.rule] : (g.severity !== 'info');
      var box = h('div', { class: 'check-group' });
      var head = h('button', { class: 'cg-head' }, [
        h('span', { class: 'xi-caret', text: open ? '▾' : '▸' }),
        h('span', { class: 'badge ' + (g.severity === 'error' ? 'warn' : g.severity === 'warn' ? 'mid' : 'ok'), text: SEV_LABEL[g.severity] }),
        h('span', { class: 'cg-name', text: RULE_NAMES[g.rule] || g.rule }),
        h('span', { class: 'muted', text: g.items.length + ' finding' + (g.items.length > 1 ? 's' : '') }),
        h('span', { style: 'flex:1' }),
        h('span', {
          class: 'cg-hide', text: 'Hide',
          title: 'Mute this check everywhere (restore from the “Hidden checks” row)',
          onclick: function (ev) {
            ev.stopPropagation();
            state.hiddenRules[g.rule] = true;
            savePrefs();
            render();
          }
        })
      ]);
      head.addEventListener('click', function () {
        state.checksOpen[g.rule] = !open;
        render();
      });
      box.appendChild(head);
      if (open) {
        var body = h('div', { class: 'cg-body' });
        g.items.forEach(function (f) {
          var row = h('div', { class: 'cg-row' });
          row.appendChild(h('div', { class: 'cg-msg', text: f.message }));
          var refs = h('div', { class: 'cg-refs' });
          /* Filtered, a cross-program finding (a CALL to a missing program,
           * say) would otherwise spend its twelve chips on other programs and
           * never show the line you came here for. Lead with this program's
           * lines and account for the rest in words. */
          var shown = only ? f.refs.filter(function (r) { return r.prog === only; }) : f.refs;
          var elsewhere = f.refs.length - shown.length;
          shown.slice(0, 12).forEach(function (r) { refs.appendChild(chip(r, f.severity === 'error' ? 'write' : 'read')); });
          if (shown.length > 12) refs.appendChild(h('span', { class: 'muted', text: ' +' + (shown.length - 12) + ' more' }));
          if (elsewhere) refs.appendChild(h('span', { class: 'muted', text: ' \u00b7 ' + elsewhere + ' more in other programs' }));
          row.appendChild(refs);
          body.appendChild(row);
        });
        box.appendChild(body);
      }
      pane.appendChild(box);
    });
  }

  /* ---- positions tab ---- */

  function renderPositions(pane) {
    var p = current();
    if (!p) return;
    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: p.parsed.name }),
      h('span', { class: 'muted', text: p.parsed.positions.length + ' taught position' + (p.parsed.positions.length === 1 ? '' : 's') })
    ]));
    if (!p.parsed.positions.length) {
      pane.appendChild(h('p', { class: 'muted', text: 'This program has no /POS section (it may use only position registers).' }));
      return;
    }
    var wrap = h('div', { class: 'table-wrap' });
    var tbl = h('table', { class: 'pos-table' });
    var head = h('tr');
    ['P[n]', 'Name', 'Grp', 'UF', 'UT', 'Config', 'X / J1', 'Y / J2', 'Z / J3', 'W / J4', 'P / J5', 'R / J6'].forEach(function (t) {
      head.appendChild(h('th', { text: t }));
    });
    tbl.appendChild(head);
    p.parsed.positions.forEach(function (pos) {
      pos.groups.forEach(function (g, gi) {
        var tr = h('tr');
        tr.appendChild(h('td', { class: 'n', text: gi === 0 ? 'P[' + pos.id + ']' : '' }));
        tr.appendChild(h('td', { text: gi === 0 ? pos.name : '' }));
        tr.appendChild(h('td', { class: 'n', text: g.group }));
        tr.appendChild(h('td', { class: 'n', text: g.uf === null ? '—' : g.uf }));
        tr.appendChild(h('td', { class: 'n', text: g.ut === null ? '—' : g.ut }));
        tr.appendChild(h('td', { class: 'n', text: g.config || (g.rep === 'joint' ? 'joint' : '—') }));
        var keys = g.rep === 'joint' ? ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] : ['X', 'Y', 'Z', 'W', 'P', 'R'];
        keys.forEach(function (k) {
          var c = g.coords[k];
          tr.appendChild(h('td', { class: 'n', text: c ? c.value.toFixed(3) : '—' }));
        });
        tbl.appendChild(tr);
      });
    });
    wrap.appendChild(tbl);
    pane.appendChild(wrap);
    pane.appendChild(h('p', { class: 'muted', text: 'Cartesian values in mm / deg in the position’s user frame (UF). Joint-format rows show axis angles J1–J6.' }));
  }

  /* ---- cross-reference tab ---- */

  function renderXref(pane) {
    var x = state.xref;
    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Library cross-reference' }),
      h('span', { class: 'muted', text: 'across all ' + Object.keys(state.programs).length + ' programs — expand an item to see every read/write and click to jump' })
    ]));

    var bar = h('div', { class: 'search-bar' });
    var fIn = h('input', { type: 'search', placeholder: 'Filter… e.g. R[10], DO, pallet, gripper' });
    fIn.value = state.xrefFilter || '';
    bar.appendChild(fIn);
    bar.appendChild(h('button', {
      class: 'btn subtle', text: 'Collapse all',
      onclick: function () { state.xrefOpen = {}; render(); }
    }));
    // Unused items only exist when controller data is loaded — every register
    // the robot holds, not just the ones programs mention — and that is also
    // when they get in the way, so the toggle is saved with the preferences.
    var unusedCb = h('input', { type: 'checkbox' });
    unusedCb.checked = !state.xrefHideUnused;
    unusedCb.addEventListener('change', function () {
      state.xrefHideUnused = !unusedCb.checked;
      savePrefs();
      draw();
    });
    bar.appendChild(h('label', { title: 'Registers, PRs and I/O points that no program in the library reads or writes' }, [
      unusedCb, document.createTextNode(' Show unused')
    ]));
    pane.appendChild(bar);

    var wrap = h('div', { class: 'xref' });
    pane.appendChild(wrap);

    function entriesOf(map, fmt) {
      return Object.keys(map).map(Number).sort(function (a, b) { return a - b; }).map(function (n) {
        return { key: fmt(n), label: map[n].label, refs: map[n].refs };
      });
    }

    // Registers section: when controller data is loaded (robot or backup
    // folder), list EVERY register — value, comment, and usage — not just
    // the ones the programs touch.
    function registerEntries() {
      var byNum = {};
      Object.keys(x.registers).forEach(function (n) {
        byNum[n] = { key: 'R[' + n + ']', label: x.registers[n].label, refs: x.registers[n].refs, value: undefined };
      });
      if (state.extern && state.extern.registers) {
        state.extern.registers.forEach(function (r) {
          if (!byNum[r.index]) byNum[r.index] = { key: 'R[' + r.index + ']', label: null, refs: [], value: undefined };
          byNum[r.index].value = r.value;
          if (!byNum[r.index].label && r.comment) byNum[r.index].label = r.comment;
        });
      }
      return Object.keys(byNum).map(Number).sort(function (a, b) { return a - b; }).map(function (n) { return byNum[n]; });
    }

    // PR section: merge controller data (values + comments) when loaded
    function posregEntries() {
      var byNum = {};
      Object.keys(x.posRegs).forEach(function (n) {
        byNum[n] = { key: 'PR[' + n + ']', label: x.posRegs[n].label, refs: x.posRegs[n].refs, value: undefined };
      });
      if (state.extern && state.extern.posregs) {
        state.extern.posregs.forEach(function (r) {
          if (r.group !== 1) return;
          if (!byNum[r.index]) {
            if (r.rep === 'uninitialized' && !r.comment) return; // don't list hundreds of empty PRs
            byNum[r.index] = { key: 'PR[' + r.index + ']', label: null, refs: [], value: undefined };
          }
          byNum[r.index].value = VA.posregValueStr(r);
          if (!byNum[r.index].label && r.comment) byNum[r.index].label = r.comment;
        });
      }
      return Object.keys(byNum).map(Number).sort(function (a, b) { return a - b; }).map(function (n) { return byNum[n]; });
    }

    function draw() {
      state.xrefFilter = fIn.value;
      var q = fIn.value.trim().toLowerCase();
      wrap.innerHTML = '';
      var haveValues = !!(state.extern && state.extern.registers && state.extern.registers.length);
      var havePRValues = !!(state.extern && state.extern.posregs && state.extern.posregs.length);
      var sections = [
        ['Registers R[n]' + (haveValues ? ' — all controller registers, with values' : ''), registerEntries(), 'regs'],
        ['Position registers PR[n]' + (havePRValues ? ' — with controller values' : ''), posregEntries(), 'prs'],
        ['I/O points', Object.keys(x.io).sort(function (a, b) {
          var ta = x.io[a], tb = x.io[b];
          return ta.type === tb.type ? ta.index - tb.index : ta.type.localeCompare(tb.type);
        }).map(function (k) { return { key: k, label: x.io[k].label, refs: x.io[k].refs }; }), 'io'],
        ['Timers', entriesOf(x.timers, function (n) { return 'TIMER[' + n + ']'; }), 'timers']
      ];
      sections.forEach(function (sec) {
        var entries = sec[1].filter(function (e) {
          if (state.xrefHideUnused && !e.refs.length) return false;
          if (!q) return true;
          return e.key.toLowerCase().indexOf(q) !== -1 ||
            (e.label || '').toLowerCase().indexOf(q) !== -1 ||
            (e.value !== undefined && String(e.value).indexOf(q) !== -1);
        });
        if (!entries.length) return;
        // a filter is a request to see matches, so it looks past a fold
        var folded = !q && !!state.xrefFolded[sec[2]];
        var sh = h('button', { class: 'xs-head' + (folded ? ' folded' : ''), title: folded ? 'Expand this section' : 'Collapse this section' }, [
          h('span', { class: 'xi-caret', text: folded ? '▸' : '▾' }),
          h('span', { text: sec[0] + ' (' + entries.length + ')' })
        ]);
        sh.addEventListener('click', function () {
          if (state.xrefFolded[sec[2]]) delete state.xrefFolded[sec[2]]; else state.xrefFolded[sec[2]] = true;
          savePrefs();
          draw();
        });
        wrap.appendChild(sh);
        if (folded) return;
        entries.forEach(function (e) {
          var open = !!state.xrefOpen[e.key];
          var reads = 0, writes = 0;
          e.refs.forEach(function (r) { if (r.write) writes++; else reads++; });
          var item = h('div', { class: 'xref-item' + (open ? ' open' : '') });
          var head = h('button', { class: 'xi-head' }, [
            h('span', { class: 'xi-caret', text: open ? '▾' : '▸' }),
            h('span', { class: 'xi-key mono', text: e.key }),
            e.value !== undefined ? h('span', { class: 'xi-value mono', text: '= ' + e.value }) : null,
            h('span', { class: 'xi-label', text: e.label || '' }),
            h('span', { style: 'flex:1' }),
            (!e.refs.length) ? h('span', { class: 'muted', text: 'unused' }) : null,
            reads ? h('span', { class: 'chip read', text: reads + ' read' + (reads > 1 ? 's' : '') }) : null,
            writes ? h('span', { class: 'chip write', text: writes + ' write' + (writes > 1 ? 's' : '') }) : null
          ]);
          head.addEventListener('click', function () {
            if (state.xrefOpen[e.key]) delete state.xrefOpen[e.key];
            else state.xrefOpen[e.key] = true;
            render();
          });
          item.appendChild(head);
          if (open) {
            var body = h('div', { class: 'xi-body' });
            e.refs.forEach(function (r) { body.appendChild(chip(r, r.write ? 'write' : 'read')); });
            item.appendChild(body);
          }
          wrap.appendChild(item);
        });
      });
      if (!wrap.children.length) wrap.appendChild(h('p', { class: 'muted', text: 'Nothing matches the filter.' }));
    }
    fIn.addEventListener('input', draw);
    draw();
  }

  /* ---- search tab ---- */

  var searchOpts = { caseSensitive: false, wholeWord: false, regex: false, replace: false };

  /* Build a matcher(text) -> {index, length} | null for the query.
   *
   * An item query is recognised from the type and index alone, so it does not
   * have to be finished: "R[40", "R[40:", "R[40]" and "R[40:box count]" are
   * all item searches for R 40. That matters because the results update as
   * you type — the old form only recognised a closed "R[40]", so every
   * keystroke before the bracket ran as plain text and swept up PR[40],
   * AR[40], SR[40] and R[400]. A plain substring can never separate them:
   * "PR[40:box base]" literally contains "R[40:box base]".
   *
   * The type guard is what does the work. R, PR, AR and SR all end in R, so
   * matching R requires a non-letter in front of it; the same guard is now
   * applied to every type rather than just R.
   *
   * Anything typed after the colon narrows by label, matched anywhere inside
   * it, so "R[40:box" finds "R[40:box count]" while still excluding PR.
   */
  /* Escape a literal for use inside a RegExp. */
  function escapeRe(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  var ITEM_TYPES = 'R|PR|AR|SR|DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|AI|AO|F|M|TIMER|LBL';
  var ITEM_QUERY = new RegExp(
    '^\\s*(' + ITEM_TYPES + ')\\s*\\[\\s*(\\d+)\\s*' +   // type and index
    '(?:,\\s*(\\d+)\\s*)?' +                             // optional component, PR[20,1]
    '(?::\\s*([^\\]]*?)\\s*)?' +                         // optional label fragment
    '\\]?\\s*$', 'i');                                   // closing bracket optional

  function buildMatcher(q) {
    var flags = searchOpts.caseSensitive ? 'g' : 'gi';
    var re = null;
    var item = searchOpts.regex ? null : q.match(ITEM_QUERY);
    if (item) {
      var type = item[1].toUpperCase();
      var comp = item[3] ? ',\\s*' + item[3] + '\\s*' : '(?:\\s*,\\s*\\d+\\s*)?';
      var label = item[4]
        ? ':[^\\]]*' + escapeRe(item[4]) + '[^\\]]*'
        : '(?::[^\\]]*)?';
      re = new RegExp('(?:^|[^A-Za-z])((' + type + '\\[\\s*' + item[2] + ')\\s*' + comp + label + '\\])', flags);
      var itemMatch = function (text) {
        re.lastIndex = 0;
        var m = re.exec(text);
        return m ? { index: m.index + m[0].indexOf(m[1]), length: m[1].length } : null;
      };
      /* A partial query — "PR[26", no closing bracket and no label — names the
       * number alone, so only TYPE[index is swapped and the comment and the
       * closing bracket stay: PR[26 → PR[22 turns PR[26:Zone1 Appr] into
       * PR[22:Zone1 Appr]. A closed query, or one with a label, replaces the
       * whole item. The character before the item is context, never touched. */
      var partial = !/\]\s*$/.test(q) && !item[4];
      itemMatch.replaceAll = function (text, repl) {
        return text.replace(re, function (m0, m1, m2) {
          var pre = m0.slice(0, m0.indexOf(m1));
          return partial ? pre + repl + m1.slice(m2.length) : pre + repl;
        });
      };
      itemMatch.positions = function (text) {
        var out = [], m;
        re.lastIndex = 0;
        while ((m = re.exec(text)) !== null) out.push({ index: m.index + m[0].indexOf(m[1]), length: m[1].length });
        return out;
      };
      return itemMatch;
    }
    /* Space-separated terms: a line matches when it has them ALL, anywhere —
     * "DO EOAT" finds DO[30:EOAT Clamp]. A * inside a term stands for
     * anything. Plain searches only: regex mode owns its own spaces, and
     * replace mode needs one literal needle to swap out. */
    if (!searchOpts.regex && !searchOpts.replace && /\s/.test(q.trim())) {
      var terms = q.trim().split(/\s+/).map(function (t) {
        var e = escapeRe(t).replace(/\\\*/g, '.*');
        if (searchOpts.wholeWord) e = '\\b' + e + '\\b';
        return new RegExp(e, flags);
      });
      return function (text) {
        var ranges = [];
        for (var i = 0; i < terms.length; i++) {
          terms[i].lastIndex = 0;
          var m = terms[i].exec(text);
          if (!m) return null;
          ranges.push({ index: m.index, length: m[0].length || 1 });
        }
        ranges.sort(function (a, b) { return a.index - b.index; });
        return { index: ranges[0].index, length: ranges[0].length, ranges: ranges };
      };
    }
    if (searchOpts.regex) {
      try { re = new RegExp(q, flags); } catch (e) { return { error: 'Invalid regex: ' + e.message }; }
    } else {
      var escd = escapeRe(q).replace(/\\\*/g, '.*');   // * = wildcard here too
      if (searchOpts.wholeWord) escd = '\\b' + escd + '\\b';
      re = new RegExp(escd, flags);
    }
    var plainMatch = function (text) {
      re.lastIndex = 0;
      var m = re.exec(text);
      return m ? { index: m.index, length: m[0].length || 1 } : null;
    };
    // a function replacement, so "$1" or "$&" typed into the box stays literal
    plainMatch.replaceAll = function (text, repl) { return text.replace(re, function () { return repl; }); };
    plainMatch.positions = function (text) {
      var out = [], m;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        out.push({ index: m.index, length: m[0].length || 1 });
        if (!m[0].length) re.lastIndex++;
      }
      return out;
    };
    return plainMatch;
  }

  /* Library-wide find and replace. The hits come from the search matcher run
   * over each parsed line's raw row, so a replacement is written back exactly
   * where the listing had it. Two kinds of hit start unticked: a comment
   * (which the robot never executes) and a hit that is the target of an
   * assignment, since "R[30]=..." becoming "1500=..." will not translate.
   * The edit lands in the library only; sending to the robot or writing to
   * disk stays per program, the same as an editor save. */
  function replaceTargetsAssignment(raw, match) {
    // any match on the line, not just the first: IF (R[30]<10),R[30]=(10)
    return match.positions(raw).some(function (m) { return /^\s*=(?!=)/.test(raw.slice(m.index + m.length)); });
  }

  function applyReplacements(hits) {
    var byProg = {}, undo = {};
    hits.forEach(function (hh) {
      if (!byProg[hh.prog]) byProg[hh.prog] = [];
      byProg[hh.prog].push({ fileLine: hh.line.fileLine, count: hh.line.raw.split('\n').length, text: hh.after });
    });
    var progs = Object.keys(byProg).sort();
    progs.forEach(function (n) {
      var p = state.programs[n];
      undo[n] = p.source;
      var src = P.applyLineEdits(p.source, byProg[n]);
      var parsed = P.parseLS(src, n + '.LS');
      state.programs[n] = { parsed: parsed, analysis: A.analyzeProgram(parsed), source: src, origin: p.origin };
    });
    rebuildDerived();
    persist();
    state.replaced = { count: hits.length, progs: progs, undo: undo, sent: {}, busy: null };
  }

  /* Upload one changed program from the banner, behind the same "checks found
   * errors, send anyway?" gate as the editor's Save + send. The outcome is
   * kept on the banner row, so a run of sends reads as a checklist. */
  function sendReplaced(name, onDone) {
    var r = state.replaced, p = state.programs[name];
    if (!r || !p || r.busy || !(state.server && state.robot.ip)) { if (onDone) onDone(false); return; }
    var blocking = state.findings.filter(function (f) {
      return f.severity === 'error' && f.refs.some(function (x) { return x.prog === name; });
    });
    if (blocking.length && !confirm('Checks found ' + blocking.length + ' error(s) in ' + name + ' that will likely fail translation on the robot:\n\n' +
      blocking.map(function (f) { return '• ' + f.message; }).join('\n') + '\n\nSend anyway? (The robot version is snapshotted and auto-restored if translation fails.)')) {
      r.sent[name] = { skipped: true };
      render();
      if (onDone) onDone(false);
      return;
    }
    r.busy = name;
    r.sent[name] = { busy: true };
    render();
    sendToRobot(name, p.source, function (b) {
      if (state.replaced === r) { r.busy = null; r.sent[name] = b; }
      render();
      if (onDone) onDone(!!b.ok);
    });
  }

  /* One after another, never in parallel: the bridge holds one FTP session
   * per upload and the controller translates one file at a time. A failure
   * or a declined "send anyway" stops the run where it is. */
  function sendAllReplaced() {
    var r = state.replaced;
    if (!r || r.busy) return;
    var todo = r.progs.filter(function (n) { return !(r.sent[n] && r.sent[n].ok); });
    if (!todo.length) return;
    if (!confirm('Send ' + todo.length + ' program' + (todo.length === 1 ? '' : 's') + ' to robot ' + state.robot.ip + ' over FTP, one after another?\n\n' +
      todo.join(', ') + '\n\nEach is snapshotted on the controller first and auto-restored if the translation is rejected. A failure stops the run so you can look at it.')) return;
    (function next(i) {
      if (i >= todo.length || state.replaced !== r) return;
      sendReplaced(todo[i], function (ok) { if (ok) next(i + 1); });
    })(0);
  }

  function undoReplacements() {
    var r = state.replaced;
    if (!r) return;
    Object.keys(r.undo).forEach(function (n) {
      var p = state.programs[n];
      if (!p) return;
      var parsed = P.parseLS(r.undo[n], n + '.LS');
      state.programs[n] = { parsed: parsed, analysis: A.analyzeProgram(parsed), source: r.undo[n], origin: p.origin };
    });
    rebuildDerived();
    persist();
    state.replaced = null;
  }

  function replacedBanner() {
    var r = state.replaced;
    if (!r) return null;
    var el = h('div', { class: 'banner good' });
    el.appendChild(h('strong', { text: 'Replaced ' + r.count + ' occurrence' + (r.count === 1 ? '' : 's') + ' in ' + r.progs.length + ' program' + (r.progs.length === 1 ? '' : 's') + ' — in the library only. ' }));
    var canSend = !!(state.server && state.robot.ip);
    el.appendChild(h('span', { text: canSend
      ? 'Every check has been re-run on the new text. Send each program to ' + state.robot.ip + ' from here, or all of them in turn; each upload is snapshotted and verified, and auto-restored if the controller rejects it.'
      : 'Nothing has gone to the robot or to disk. Connect to a robot on the Robot tab to send these from here, or open each program and use Edit → Save to library + disk. Every check has been re-run on the new text.' }));
    var list = h('div', { class: 'banner-errs' });
    var unsent = 0, anySent = false;
    r.progs.forEach(function (n) {
      var s = r.sent[n];
      var row = h('div', { class: 'replaced-row' });
      row.appendChild(h('span', {
        class: 'chip read', text: n, title: 'Open ' + n + ' in the Code tab',
        onclick: function () { state.selected = n; state.tab = 'code'; state.editing = false; render(); }
      }));
      if (s && s.busy) row.appendChild(h('span', { class: 'muted', text: 'uploading to ' + state.robot.ip + '…' }));
      else if (s && s.ok) { anySent = true; row.appendChild(h('span', { class: 'badge ok', text: 'on robot' })); }
      else if (s && s.skipped) row.appendChild(h('span', { class: 'muted', text: 'not sent — checks found errors' }));
      else if (s) {
        row.appendChild(h('span', { class: 'badge warn', text: 'failed' }));
        row.appendChild(h('span', { class: 'muted', text: (s.error || 'unknown error') + (s.restored ? ' — previous version restored on the robot' : '') }));
      }
      if (!(s && s.ok)) unsent++;
      if (canSend && !(s && s.ok)) row.appendChild(btn({
        class: 'btn', text: s && !s.busy ? 'Retry' : 'Send',
        title: 'Upload ' + n + '.LS to ' + state.robot.ip + ' over FTP',
        onclick: function () { sendReplaced(n); }
      }));
      list.appendChild(row);
    });
    el.appendChild(list);
    if (canSend && unsent > 1) el.appendChild(btn({
      class: 'btn primary', text: 'Send all ' + unsent + ' to robot',
      title: 'Upload the changed programs one after another',
      onclick: sendAllReplaced
    }));
    el.appendChild(btn({
      class: 'btn', text: 'Undo',
      title: anySent ? 'Put the previous text back in the library — the robot keeps what was already sent' : 'Put the previous text of every changed program back',
      onclick: function () { undoReplacements(); render(); }
    }));
    el.appendChild(btn({ class: 'btn subtle', text: 'Dismiss', onclick: function () { state.replaced = null; render(); } }));
    return el;

    // every control in the banner waits while an upload is in flight
    function btn(attrs) { var b = h('button', attrs); b.disabled = !!r.busy; return b; }
  }

  function renderSearch(pane) {
    var bar = h('div', { class: 'search-bar' });
    var input = h('input', {
      type: 'search', placeholder: 'Find in all files… e.g. R[10], DO EOAT, CALL PICK',
      title: 'Space-separated terms must ALL appear on the line: DO EOAT finds DO[30:EOAT Clamp]. * stands for anything: R[2*] finds R[20]–R[29]. With Replace (⇄) on, spaces are literal.'
    });
    input.value = state.searchQuery || '';
    bar.appendChild(input);
    [['caseSensitive', 'Aa', 'Match case'], ['wholeWord', '|w|', 'Whole word'], ['regex', '.*', 'Regular expression'], ['replace', '⇄', 'Find and replace across the library']].forEach(function (o) {
      bar.appendChild(h('button', {
        class: 'btn opt' + (searchOpts[o[0]] ? ' active' : ''),
        text: o[1], title: o[2],
        onclick: function () { searchOpts[o[0]] = !searchOpts[o[0]]; render(); }
      }));
    });
    pane.appendChild(bar);

    var replIn = null, applyBtn = null;
    if (searchOpts.replace) {
      var rbar = h('div', { class: 'search-bar replace-bar' });
      replIn = h('input', { type: 'text', placeholder: 'Replace with… (leave empty to delete the matched text)' });
      replIn.value = state.replaceWith || '';
      applyBtn = h('button', { class: 'btn primary', text: 'Replace', disabled: 'disabled' });
      rbar.appendChild(replIn);
      rbar.appendChild(applyBtn);
      pane.appendChild(rbar);
      pane.appendChild(h('p', { class: 'muted', text: 'Each hit shows the line as it will read afterwards. Tick or untick lines before replacing — comments and assignment targets (R[30]=…) start unticked. Replacing edits the library and re-runs the checks; it never touches the robot or disk by itself.' }));
    } else {
      pane.appendChild(h('p', { class: 'muted', text: 'Tip: select any item in the code and press Ctrl+E to cross-reference it here. Clicking a register or I/O token in the Code view does the same.' }));
    }
    var done = replacedBanner();
    if (done) pane.appendChild(done);
    var results = h('div');
    pane.appendChild(results);

    function run() {
      state.searchQuery = input.value;
      if (replIn) state.replaceWith = replIn.value;
      results.innerHTML = '';
      var q = input.value.trim();
      var replacing = !!replIn;
      var repl = replacing ? replIn.value : null;
      var ticked = [];
      function refreshApply() {
        if (!applyBtn) return;
        var n = ticked.filter(function (t) { return t.cb.checked; }).length;
        applyBtn.disabled = !n;
        applyBtn.textContent = n ? 'Replace ' + n + ' selected' : 'Replace';
      }
      refreshApply();
      if (q.length < 2) {
        results.appendChild(h('p', { class: 'muted', text: 'Type at least two characters to search every line of every program in the library.' }));
        return;
      }
      var match = buildMatcher(q);
      if (match.error) {
        results.appendChild(h('p', { class: 'muted', text: match.error }));
        return;
      }
      var count = 0, shown = 0;
      Object.keys(state.programs).sort().forEach(function (n) {
        var hits = [];
        state.programs[n].parsed.lines.forEach(function (line) {
          var full = (line.motion ? line.motion + ' ' : '') + line.text;
          var m = match(full);
          if (!m) return;
          count++;
          if (shown < 400) { hits.push({ prog: n, line: line, full: full, m: m, commented: line.comment !== null }); shown++; }
        });
        if (!hits.length) return;
        results.appendChild(h('div', { class: 'hit-group' }, [
          h('span', { class: 'mono', text: n }),
          h('span', { class: 'muted', text: '  ' + hits.length + ' match' + (hits.length > 1 ? 'es' : '') })
        ]));
        hits.forEach(function (hh) {
          var hit = h('div', { class: 'hit' + (hh.commented ? ' commented' : '') });
          if (replacing) {
            // the replacement is made in the raw row, which is what gets written back
            var rm = match(hh.line.raw);
            hh.after = rm ? match.replaceAll(hh.line.raw, repl) : hh.line.raw;
            var why = null;
            if (!rm || hh.after === hh.line.raw || !hh.line.fileLine) why = 'no change';
            else if (hh.commented) why = 'comment';
            else if (repl.indexOf('[') === -1 && replaceTargetsAssignment(hh.line.raw, match)) why = 'assignment target';
            var cb = h('input', { type: 'checkbox', title: why ? 'Unticked: ' + why : 'Replace on this line' });
            cb.checked = !why;
            if (why === 'no change') cb.disabled = true;
            cb.addEventListener('change', refreshApply);
            ticked.push({ cb: cb, hit: hh });
            hit.appendChild(cb);
            if (why) hit.classList.add('skip');
          }
          hit.appendChild(h('span', {
            class: 'where', text: n + ':' + hh.line.num,
            onclick: function () { gotoLine(n, hh.line.num); }
          }));
          var txt = h('span', { class: 'text' });
          // a multi-term match marks every term, not just the first
          var ranges = hh.m.ranges || [{ index: hh.m.index, length: hh.m.length }];
          var parts = [], pos = 0;
          ranges.forEach(function (r2) {
            var s = Math.max(r2.index, pos), e2 = r2.index + r2.length;
            if (e2 <= pos) return;   // overlapping terms — already marked
            parts.push(esc(hh.full.slice(pos, s)), '<mark>', esc(hh.full.slice(s, e2)), '</mark>');
            pos = e2;
          });
          parts.push(esc(hh.full.slice(pos)));
          txt.innerHTML = parts.join('');
          if (replacing && hh.after !== hh.line.raw) {
            txt.appendChild(h('span', { class: 'after', text: '\n→ ' + hh.after.replace(/^\s*\d+\s*:\s?/, '').replace(/\s*;\s*$/, '') }));
          }
          hit.appendChild(txt);
          if (hh.commented) hit.appendChild(h('span', { class: 'muted', text: 'comment' }));
          else if (replacing && why) hit.appendChild(h('span', { class: 'muted', text: why }));
          results.appendChild(hit);
        });
      });
      refreshApply();
      results.insertBefore(h('p', { class: 'muted', text: count ? count + ' match' + (count > 1 ? 'es' : '') + ' across the library' + (count > 400 ? ' (showing first 400' + (replacing ? ' — narrow the search to replace the rest' : '') + ')' : '') : 'No matches.' }), results.firstChild);

      if (applyBtn) applyBtn.onclick = function () {
        var chosen = ticked.filter(function (t) { return t.cb.checked; }).map(function (t) { return t.hit; });
        if (!chosen.length) return;
        var progs = {};
        chosen.forEach(function (hh) { progs[hh.prog] = true; });
        var np = Object.keys(progs).length;
        if (!confirm('Replace ' + chosen.length + ' occurrence' + (chosen.length === 1 ? '' : 's') + ' of "' + q + '" with "' + repl + '" in ' + np + ' program' + (np === 1 ? '' : 's') + '?\n\nThis edits the library copy only. Undo is offered afterwards.')) return;
        applyReplacements(chosen);
        render();
      };
    }
    input.addEventListener('input', run);
    if (replIn) replIn.addEventListener('input', run);
    /* Tab hops straight between the find and replace boxes — the option
     * buttons sit between them in the DOM, and tabbing through four toggles
     * to get to "replace with" made the pair useless from the keyboard.
     * Shift+Tab comes straight back; the buttons stay mouse targets. */
    if (replIn) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); replIn.focus(); replIn.select(); }
      });
      replIn.addEventListener('keydown', function (e) {
        if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); input.focus(); input.select(); }
      });
    }
    run();
    if (replIn && input.value) replIn.focus(); else input.focus();
  }

  /* ---- compare tab ---- */

  function librarySources() {
    var out = {};
    Object.keys(state.programs).forEach(function (n) { out[n] = state.programs[n].source; });
    return out;
  }

  function diffOpts() {
    return { ignoreIoState: state.ignoreIoState, ignoreLineNums: state.ignoreLineNums };
  }

  function setBaseline(label, programs) {
    state.compare = {
      label: label,
      programs: programs,
      results: D.comparePrograms(programs, librarySources(), diffOpts()),
      open: null
    };
    render();
  }

  /* One "ignore this kind of noise" checkbox for the Compare toolbar. Both
   * settings feed diffOpts(), so flipping either has to recompute the stored
   * baseline verdicts, which were decided under the old setting. */
  function ignoreToggle(key, label, title) {
    var cb = h('input', { type: 'checkbox' });
    cb.checked = state[key];
    cb.addEventListener('change', function () {
      state[key] = cb.checked;
      savePrefs();
      refreshCompare();   // the stored verdicts were decided under the old setting
      render();
    });
    var lab = h('label', { title: title }, [cb]);
    lab.appendChild(document.createTextNode(' ' + label));
    return lab;
  }

  function renderCompare(pane) {
    /* Tab-level toolbar: these options govern both sections below, so they
     * live out here rather than inside one of them, where collapsing that
     * section would hide a control still affecting the other. */
    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Compare' }),
      h('span', { style: 'flex:1' }),
      ignoreToggle('ignoreLineNums', 'Ignore line numbers',
        'Every /MN line is written "12:  <instruction> ;", so inserting or deleting one line renumbers every line below it. Those lines are identical program content, so ignoring the number leaves just the real edit highlighted instead of the whole rest of the program.'),
      ignoreToggle('ignoreIoState', 'Ignore inline I/O state',
        'With the controller\u2019s I/O-state display on, a listing reads DO[65:OFF:Vac-1 ON] instead of DO[65:Vac-1 ON]. That state is live machine data, not program content, so ignoring it stops every such line showing as a change against a backup taken with the display off.')
    ]));

    // -- two-program compare (Notepad++ Compare-plugin style) --
    var pairLabel = 'Compare two programs';
    if (state.pair && state.pair.a && state.pair.b && state.pair.a !== state.pair.b) {
      pairLabel += ' — ' + state.pair.a + ' vs ' + state.pair.b;
    }
    var secPair = secHead(pairLabel, 'cmp-pair');
    pane.appendChild(secPair.el);
    if (secPair.open) renderComparePair(pane);

    // -- library vs a loaded baseline --
    var baseLabel = 'Compare against a backup';
    if (state.compare) {
      var ch = state.compare.results.changed.length;
      baseLabel += ' — ' + (ch ? ch + ' changed' : 'no code changes') + ' vs ' + state.compare.label;
    }
    var secBase = secHead(baseLabel, 'cmp-baseline');
    pane.appendChild(secBase.el);
    if (secBase.open) renderCompareBaseline(pane);
  }

  function renderComparePair(pane) {
    var names = Object.keys(state.programs).sort();
    if (!names.length) {
      pane.appendChild(h('p', { class: 'muted', text: 'Import programs first.' }));
      return;
    }
    if (!state.pair) state.pair = { a: state.selected || names[0], b: docProg(state.splitDoc) || state.selected || names[0] };
    var row = h('div', { class: 'search-bar' });
    row.appendChild(progSelect(state.pair.a, function (v) { state.pair.a = v; render(); }));
    row.appendChild(h('span', { class: 'muted', text: 'vs' }));
    row.appendChild(progSelect(state.pair.b, function (v) { state.pair.b = v; render(); }));
    row.appendChild(h('button', { class: 'btn subtle', text: '\u21c4 swap', onclick: function () { state.pair = { a: state.pair.b, b: state.pair.a }; render(); } }));
    pane.appendChild(row);
    var pa = state.programs[state.pair.a], pb = state.programs[state.pair.b];
    if (!pa || !pb) return;
    if (state.pair.a === state.pair.b) {
      pane.appendChild(h('p', { class: 'muted', text: 'Same program on both sides \u2014 pick two different programs (or two revisions imported under different names).' }));
      return;
    }
    pane.appendChild(renderDiffBody(pa.source, pb.source, true, state.pair.a, state.pair.b));
  }

  function renderCompareBaseline(pane) {
    pane.appendChild(h('p', { class: 'muted', text: 'see everything that changed on the robot since a backup was taken' }));

    var src = h('div', { class: 'search-bar', style: 'flex-wrap:wrap' });
    src.appendChild(h('button', {
      class: 'btn', text: 'Pick backup .LS files\u2026',
      onclick: function () { document.getElementById('compare-input').click(); }
    }));
    /* Native folder picker — reads the folder on whichever machine the browser
     * is running on, so it needs no bridge. The path box below is the other
     * case: browsing the *bridge PC's* disk from somewhere else. */
    src.appendChild(h('button', {
      class: 'btn', text: 'Browse for a backup folder\u2026',
      title: 'Opens your file manager\u2019s folder picker and loads every .LS inside',
      onclick: function () { document.getElementById('compare-dir-input').click(); }
    }));
    if (state.server) {
      var dirIn = h('input', { type: 'text', placeholder: 'or backup folder path on the bridge PC' });
      src.appendChild(dirIn);
      src.appendChild(h('button', {
        class: 'btn', text: 'Load folder',
        onclick: function () {
          var p = dirIn.value.trim();
          if (!p) return;
          api('/api/dir/list?path=' + encodeURIComponent(p)).then(function (b) {
            var ls = b.files.filter(function (f) { return /\.ls$/i.test(f.name); });
            var set = {}, pending = ls.length;
            if (!pending) { setBaseline(b.path + ' (empty)', {}); return; }
            ls.forEach(function (f) {
              api('/api/dir/file?path=' + encodeURIComponent(f.path)).then(function (file) {
                set[P.parseLS(file.content, file.name).name] = file.content;
              }).catch(function () {}).then(function () {
                if (--pending === 0) setBaseline('backup folder ' + b.path, set);
              });
            });
          }).catch(function (e) { alert(e.message); });
        }
      }));
    }
    pane.appendChild(src);

    if (!state.compare) {
      pane.appendChild(h('p', { class: 'muted', text: 'Load a baseline \u2014 the .LS files from an old backup \u2014 and it is compared program-by-program against your current library' + (state.server ? ' (import the robot\u2019s current programs from the Robot tab first to diff robot vs backup)' : '') + '. Header-only differences (dates, sizes) are separated from real code changes.' }));
      return;
    }

    var c = state.compare;
    var r = c.results;
    pane.appendChild(h('p', {}, [
      h('span', { class: 'muted', text: 'Baseline: ' }),
      h('span', { class: 'mono', text: c.label }),
      h('span', { class: 'muted', text: '  vs  current library (' + Object.keys(state.programs).length + ' programs)' })
    ]));

    var cards = h('div', { class: 'cards' });
    [[r.changed.length, 'changed'], [r.added.length, 'new (not in baseline)'], [r.removed.length, 'missing (only in baseline)'], [r.headerOnly.length, 'header-only changes'], [r.same.length, 'identical']].forEach(function (x) {
      cards.appendChild(h('div', { class: 'card' }, [h('div', { class: 'k', text: x[0] }), h('div', { class: 'l', text: x[1] })]));
    });
    pane.appendChild(cards);

    function progList(title, names, note) {
      if (!names.length) return;
      pane.appendChild(h('h3', { text: title }));
      var box = h('div', { class: 'robot-files' });
      names.forEach(function (n) {
        box.appendChild(h('span', {
          class: 'chip ' + (note === 'removed' ? 'write' : 'read'), text: n,
          onclick: state.programs[n] ? function () { state.selected = n; state.tab = 'code'; render(); } : null
        }));
      });
      pane.appendChild(box);
    }

    if (r.changed.length) {
      pane.appendChild(h('h3', { text: 'Changed programs \u2014 click to see the diff' }));
      r.changed.forEach(function (ch) {
        var isOpen = c.open === ch.name;
        pane.appendChild(h('div', { class: 'diff-head' + (isOpen ? ' open' : ''), onclick: function () { c.open = isOpen ? null : ch.name; render(); } }, [
          h('span', { class: 'mono', text: (isOpen ? '\u25be ' : '\u25b8 ') + ch.name }),
          h('span', { class: 'diff-adds', text: '+' + ch.adds }),
          h('span', { class: 'diff-dels', text: '\u2212' + ch.dels })
        ]));
        if (isOpen) {
          var cur = state.programs[ch.name];
          pane.appendChild(cur
            ? renderDiffBody(c.programs[ch.name], cur.source, false, ch.name + ' \u2014 backup', ch.name + ' \u2014 current')
            : h('p', { class: 'muted', text: ch.name + ' is in the baseline but no longer in the library \u2014 reload the baseline to refresh this list.' }));
        }
      });
    }
    progList('New since the baseline', r.added, 'added');
    progList('In the baseline but missing now', r.removed, 'removed');
    var ignored = [];
    if (state.ignoreLineNums) ignored.push('line numbers');
    if (state.ignoreIoState) ignored.push('inline I/O state');
    progList(ignored.length
      ? 'No code changes (header dates / sizes, or ' + ignored.join(' / ') + ' only)'
      : 'Header-only changes (dates / sizes \u2014 code identical)', r.headerOnly, 'header');
  }

  /* Side-by-side diff: baseline/A on the left, current/B on the right. */
  function renderDiffBody(baselineSrc, currentSrc, fullSource, aLabel, bLabel) {
    var ops = fullSource
      ? D.diffLines(baselineSrc, currentSrc, diffOpts())
      : D.diffLines(D.bodyOf(baselineSrc), D.bodyOf(currentSrc), diffOpts());
    var rows = D.sideBySide(ops);

    var box = h('div', { class: 'codebox sbs-box' });
    var grid = h('div', { class: 'sbs' });
    box.appendChild(grid);

    function cell(side, data, type) {
      var cls = 'sbs-cell ' + side;
      if (data === null) cls += ' empty';
      else if (type === 'del' || (type === 'change' && side === 'a')) cls += ' del';
      else if (type === 'add' || (type === 'change' && side === 'b')) cls += ' add';
      return h('div', { class: cls }, [
        h('span', { class: 'ln', text: data ? data.n : '' }),
        h('span', { class: 'src', text: data ? data.text : '' })
      ]);
    }

    grid.appendChild(h('div', { class: 'sbs-cell head a' }, [h('span', { class: 'src', text: aLabel || 'baseline (old)' })]));
    grid.appendChild(h('div', { class: 'sbs-cell head b' }, [h('span', { class: 'src', text: bLabel || 'current (new)' })]));

    var ctx = 2, shown = {};
    rows.forEach(function (r, i) {
      if (r.t === 'same') return;
      for (var k = Math.max(0, i - ctx); k <= Math.min(rows.length - 1, i + ctx); k++) shown[k] = true;
    });
    if (!Object.keys(shown).length) {
      grid.appendChild(h('div', { class: 'sbs-cell' }, [h('span', { class: 'src muted', text: 'identical' })]));
      grid.appendChild(h('div', { class: 'sbs-cell' }, [h('span', { class: 'src muted', text: 'identical' })]));
      return box;
    }
    var lastShown = -1;
    rows.forEach(function (r, i) {
      if (!shown[i]) return;
      if (i > lastShown + 1) {
        grid.appendChild(h('div', { class: 'sbs-cell skip' }, [h('span', { class: 'ln', text: '···' })]));
        grid.appendChild(h('div', { class: 'sbs-cell skip' }, [h('span', { class: 'ln', text: '···' })]));
      }
      lastShown = i;
      grid.appendChild(cell('a', r.a, r.t));
      grid.appendChild(cell('b', r.b, r.t));
    });
    return box;
  }

  /* ---- robot tab ---- */

  var KIND_NOTE = {
    wired: '',
    wireless: ' (wireless)',
    virtual: ' (a virtual adapter — only this PC and its VMs are on it)',
    overlay: ' (a VPN overlay — controllers will not be on it)'
  };

  /* Find controllers on the network. Deliberately a button and never
   * automatic: a subnet sweep looks like a port scan to an IDS, and that is
   * not something an app should start on a plant network by itself. */
  function scanPanel() {
    var wrap = h('div', { class: 'scan-panel' });
    var sc = state.scan;
    /* The bridge ranks its own interfaces, wired first — see localSubnets().
     * The best one prefills the box; the rest are one-click buttons beside
     * it, because only the person at the machine knows which network the
     * controllers are actually on. */
    var best = (state.subnets && state.subnets.length) ? state.subnets[0] : null;
    var suggested = best ? best.cidr : '';
    var cidrIn = h('input', {
      type: 'text', class: 'scan-cidr',
      placeholder: suggested || '192.168.0.0/24',
      title: 'Address range to sweep, up to 1024 addresses (a /22)' +
        (best ? '. Prefilled from this PC’s ' + best.iface + ' address, ' + best.address : '')
    });
    cidrIn.value = (sc && sc.cidr) || suggested;

    var row = h('div', { class: 'search-bar', style: 'margin-bottom:4px' });
    row.appendChild(cidrIn);
    if (sc && sc.running) {
      row.appendChild(h('button', { class: 'btn', text: 'Cancel', onclick: function () { cancelScan(); render(); } }));
    } else {
      row.appendChild(h('button', {
        class: 'btn', text: 'Scan',
        title: 'Try port 80 on every address in the range, then confirm which are FANUC controllers',
        onclick: function () {
          var c = cidrIn.value.trim();
          if (c) startScan(c);
        }
      }));
    }
    if (state.subnets && state.subnets.length > 1) {
      state.subnets.slice(0, 4).forEach(function (n) {
        row.appendChild(h('button', {
          class: 'btn subtle opt', text: n.cidr,
          title: n.iface + ' — this PC is ' + n.address + KIND_NOTE[n.kind] +
            (n.narrowed ? '. Its real mask is wider than a /22, so this is the /24 around this PC' : ''),
          onclick: function () { cidrIn.value = n.cidr; }
        }));
      });
    }
    wrap.appendChild(row);

    var bar = h('div', { class: 'scan-bar' }, [h('div', { class: 'scan-bar-fill' })]);
    var progress = h('span', { class: 'muted', text: sc ? scanProgressText(sc) : 'Sweeps the range for controllers and adds every one it finds to the list below. Only devices actually serving the robot MD: device are saved — a printer answering on port 80 is listed but never added.' });
    if (sc && sc.running) wrap.appendChild(bar);
    wrap.appendChild(h('div', {}, [progress]));
    scanUI = { progress: progress, bar: bar.firstChild };

    return wrap;
  }

  /* Saved robots and the multi-robot backup, one section. Each row IS the
   * robot: click the name to connect (the username comes back with the
   * entry; the password never does, so it is typed — or left blank — each
   * time), tick it to include it in the next backup sweep, and its folder
   * and live sweep result sit on the same line. This replaced two separate
   * sections that each listed every saved robot in its own way. */
  function savedRobotsPanel(ipIn, userIn) {
    var wrap = h('div', { class: 'backup-all' });
    var running = backupAllRunning();
    var home = state.backupHome;

    if (!state.knownRobots.length) {
      wrap.appendChild(h('p', { class: 'muted', text: 'Robots you connect to are saved here — this bridge remembers them for every device pointed at it (never the password). Scan the range above, and every controller it finds can be connected to or backed up from here.' }));
      return wrap;
    }

    wrap.appendChild(h('div', { class: 'sr-head' }, [
      h('span', { class: 'eyebrow', text: 'Saved robots' }),
      h('button', {
        class: 'btn subtle', text: '↻ re-check',
        title: 'Probe every saved robot again',
        onclick: function () { probeKnownRobots(); render(); }
      })
    ]));

    var picked = backupPicked();
    var pickedIps = {};
    picked.forEach(function (r) { pickedIps[r.ip] = true; });
    var homeDir = (home && home.backupRoot) || null;

    /* A real table: with a folder path, two buttons and a live result per
     * robot, aligned columns are what keeps six rows scannable. Narrow
     * screens scroll the table sideways inside its own wrapper rather than
     * the page. */
    var table = h('table', { class: 'sr-table' });
    table.appendChild(h('thead', {}, [h('tr', {}, [
      h('th', { text: '✓', title: 'Ticked robots are included in the full-backup sweep' }),
      h('th', {}),
      h('th', { text: 'Robot' }),
      h('th', { text: 'Address' }),
      h('th', { text: 'Backup folder' }),
      h('th', {}),
      h('th', {}),
      h('th', {})
    ])]));
    var tbody = h('tbody', {});
    var rowEls = {};
    state.knownRobots.forEach(function (r) {
      var st = state.robotProbe[r.ip] || 'checking';
      var label = r.name || r.ip;
      var cb = h('input', { type: 'checkbox', title: 'Include ' + label + ' in the next backup sweep' });
      cb.checked = !!pickedIps[r.ip];
      cb.disabled = running;
      cb.addEventListener('change', function () {
        state.backupPick[r.ip] = cb.checked;
        render();
      });
      function seedCreds() {
        ipIn.value = r.ip;
        if (r.ftpUser) { userIn.value = r.ftpUser; state.robot.ftpUser = r.ftpUser; }
      }
      /* The folder is one control, not a field plus a browse button: the
       * path itself is the button, and clicking it opens the bridge's
       * folder picker. Every robot files where its cell belongs on the
       * server; one that has not been given a folder yet falls back to the
       * bridge's own backups\ directory, and the button says so. */
      var folderBtn = h('button', {
        class: 'bp-folder' + (r.folder ? ' set' : ''),
        text: r.folder ? shortPath(r.folder) : 'set folder…',
        title: (r.folder
          ? label + '’s backups go in ' + r.folder
          : label + ' has no folder yet — backups go to the bridge’s own backups folder' + (homeDir ? ' (' + homeDir + ')' : '')) +
          '. Click to choose one.',
        onclick: function () {
          openFolderPicker({
            title: 'Backup folder for ' + label,
            hint: 'Where ' + label + '’s dated backup folders are created. Its own project folder on the server, if that is where this cell belongs.',
            start: r.folder || homeDir || '',
            allowHome: !!r.folder,
            onPick: function (p) { setRobotFolder(r.ip, p); }
          });
        }
      });
      folderBtn.disabled = running;
      /* Connect + pull every program, one gesture — the same import the
       * Programs section offers, reached without opening it. */
      var impBtn = h('button', {
        class: 'btn bp-quick', text: 'Import programs',
        title: st === 'down'
          ? label + ' is not answering'
          : 'Connect to ' + label + ' and read every program on it into its library',
        onclick: function () {
          seedCreds();
          connectRobot(r.ip, { andImport: true });
        }
      });
      impBtn.disabled = running || st === 'down' || !!state.robotImport;
      /* One robot, right now, no connecting: the same sweep machinery with
       * a list of one, so progress and the result land on this row the same
       * way they do during a full sweep. */
      var quickBtn = h('button', {
        class: 'btn bp-quick', text: 'Quick backup',
        title: st === 'down'
          ? label + ' is not answering — nothing to back up'
          : '.LS + .VA from ' + label + ' into a dated _quick folder — no need to connect first',
        onclick: function () { startBackupAll('quick', [r.ip]); }
      });
      quickBtn.disabled = running || st === 'down';
      var res = h('span', { class: 'bp-result' });
      if (state.backupAll && state.backupAll.rows[r.ip]) paintBackupRow(res, state.backupAll.rows[r.ip]);
      rowEls[r.ip] = res;
      /* The status dot carries the "last seen" reading as its tooltip — a
       * whole column for a timestamp nobody scans was width the folder
       * paths wanted. */
      var seen = lastSeenText(r.lastSeen);
      tbody.appendChild(h('tr', { class: r.ip === state.robot.ip ? 'current' : '' }, [
        h('td', {}, [cb]),
        h('td', {}, [h('span', {
          class: 'sr-dot ' + st,
          title: (st === 'up' ? 'Answering on port 80' : st === 'down' ? 'Not answering' : 'Checking…') +
            (seen ? ' · last seen ' + seen : '')
        })]),
        h('td', {}, [h('button', {
          class: 'sr-name', text: label,
          title: 'Connect to ' + r.ip,
          onclick: function () { seedCreds(); connectRobot(r.ip); }
        })]),
        h('td', {}, [h('span', { class: 'sr-ip mono', text: r.ip })]),
        h('td', {}, [folderBtn]),
        h('td', { class: 'sr-actions' }, [impBtn, quickBtn]),
        h('td', {}, [res]),
        h('td', {}, [h('span', {
          class: 'seq-hide', text: '✕',
          title: 'Forget ' + label,
          onclick: function () { forgetRobot(r.ip); }
        })])
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(h('div', { class: 'sr-scroll' }, [table]));

    /* ---- the full-backup sweep of the ticked robots ---- */
    var btnRow = h('p', {});
    if (running) {
      btnRow.appendChild(h('button', {
        class: 'btn', text: 'Stop',
        title: 'Finish nothing further — the robots already backed up keep their folders',
        onclick: function () { cancelBackupAll(); render(); }
      }));
    } else {
      var n = picked.length;
      var full = h('button', {
        class: 'btn primary',
        text: 'Backup ' + n + (n === 1 ? ' robot' : ' robots') + ' (full)',
        title: 'Every file on MD: from each ticked robot, one after another, each into its own folder',
        onclick: function () { startBackupAll('full'); }
      });
      full.disabled = !n;
      btnRow.appendChild(full);
    }
    wrap.appendChild(btnRow);

    var bar = h('div', { class: 'scan-bar' }, [h('div', { class: 'scan-bar-fill' })]);
    var status = h('span', {
      class: 'muted',
      text: state.backupAll ? backupAllText(state.backupAll)
        : 'One robot at a time, each into a dated folder in its own destination. A controller that is not answering is skipped after three seconds and named in the list, so a powered-down cell cannot stall the rest.'
    });
    if (running) wrap.appendChild(bar);
    wrap.appendChild(h('div', {}, [status]));
    backupAllUI = { status: status, bar: bar.firstChild, rows: rowEls };

    if (state.backupAll && !state.backupAll.running && !state.backupAll.error) {
      var dests = state.backupAll.dests || [];
      var p = h('p', { class: 'muted' }, [document.createTextNode(dests.length > 1 ? 'Filed into ' + dests.length + ' folders: ' : 'Filed into ')]);
      dests.forEach(function (d, i) {
        if (i) p.appendChild(document.createTextNode(', '));
        p.appendChild(h('span', { class: 'mono', text: d }));
      });
      p.appendChild(document.createTextNode('. Any of these dated folders loads as a baseline in the Compare tab.'));
      if (dests.length) wrap.appendChild(p);
    }
    return wrap;
  }

  function lastSeenText(iso) {
    var t = Date.parse(iso || '');
    if (isNaN(t)) return '';
    var mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hrs / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  /* Server paths run long — "S:\827-039 Wire Stripper Assembly\Robot" does
   * not belong on a row beside a robot name. The tail is what identifies the
   * folder to the person who chose it, so the middle is what goes. */
  function shortPath(p) {
    if (p.length <= 34) return p;
    var parts = p.split(/[\\/]/).filter(Boolean);
    var tail = parts.slice(-2).join(p.indexOf('\\') !== -1 ? '\\' : '/');
    return '…' + (p.indexOf('\\') !== -1 ? '\\' : '/') + (tail.length > 34 ? tail.slice(-33) : tail);
  }

  /* The per-robot result, written into the row's own span so a sweep can
   * report each controller as it finishes without a re-render. */
  function paintBackupRow(el, row) {
    if (!el || !row) return;
    el.className = 'bp-result ' + row.status;
    if (row.status === 'running') {
      el.textContent = row.fileTotal ? row.saved + ' / ' + row.fileTotal + ' files' : 'connecting…';
    } else if (row.status === 'done') {
      el.textContent = '✓ ' + row.files + ' files' +
        (row.failedFiles && row.failedFiles.length ? ' (' + row.failedFiles.length + ' unreadable)' : '');
      el.title = row.folder || '';
    } else if (row.status === 'skipped') {
      el.textContent = 'skipped';
      el.title = row.error || '';
    } else if (row.status === 'failed') {
      el.textContent = 'failed';
      el.title = row.error || '';
    } else {
      el.textContent = '';
      el.title = '';
    }
  }

  /* The latest check-for-changes verdict for one program, or null. Verdicts
   * stream in while the check runs, so badges appear as they are decided. */
  function robotDiffers(n) {
    var rc = state.robotCheck;
    return (rc && rc.ip === state.robot.ip && rc.differs[n]) || null;
  }

  function robotCheckControls() {
    var rc = state.robotCheck;
    if (rc && rc.running) {
      return h('button', {
        class: 'btn subtle', text: 'Checking ' + rc.done + ' of ' + rc.total + '… stop',
        title: 'Stop after the program currently being read',
        onclick: function () { rc.cancel = true; rc.running = false; rc.at = new Date(); render(); }
      });
    }
    if (!Object.keys(state.programs).length) return null;
    return h('button', {
      class: 'btn', text: 'Check robot for changes',
      title: 'Re-read every library program from ' + state.robot.ip + ' and flag the ones whose copy on the controller no longer matches the library. Read-only — nothing is sent to the robot.',
      onclick: checkRobotChanges
    });
  }

  function robotCheckPanel() {
    var rc = state.robotCheck;
    if (!rc || rc.ip !== state.robot.ip) return null;
    var box = h('div', { class: 'robot-check' });
    if (rc.running) {
      var pct = rc.total ? Math.round((rc.done / rc.total) * 100) : 0;
      box.appendChild(h('div', { class: 'import-bar' }, [h('span', { style: 'width:' + pct + '%' })]));
    }
    var difNames = Object.keys(rc.differs).sort();
    var parts = [];
    parts.push(difNames.length
      ? difNames.length + ' differ' + (difNames.length === 1 ? 's' : '') + ' from the robot'
      : (rc.running ? 'nothing differs so far' : 'library and robot match'));
    parts.push(rc.same + ' identical');
    if (rc.headerOnly.length) parts.push(rc.headerOnly.length + ' header-only (dates/sizes)');
    if (rc.failed.length) parts.push(rc.failed.length + ' unreadable');
    if (rc.notOnRobot.length) parts.push(rc.notOnRobot.length + ' only in the library');
    box.appendChild(h('div', {}, [
      h('strong', { text: (rc.running ? 'Checking against ' : 'Checked against ') + rc.ip + (rc.at ? ' at ' + rc.at.toLocaleTimeString() : '') + ' — ' }),
      h('span', { text: parts.join(', ') + '.' }),
      rc.at && !rc.running ? h('span', { class: 'muted', text: ' Verdicts age as you edit — run it again after changes.' }) : null
    ]));
    if (difNames.length) {
      var fl = h('div', { class: 'robot-files' });
      difNames.forEach(function (n) {
        var d = rc.differs[n];
        fl.appendChild(h('span', {
          class: 'chip write', text: n + ' ≠ (+' + d.adds + '/−' + d.dels + ')',
          title: 'The copy on ' + rc.ip + ' differs from the library (' + d.adds + ' added / ' + d.dels + ' removed lines). Click to see the diff.',
          onclick: function () { openRobotCheckCompare(n); }
        }));
      });
      box.appendChild(fl);
      box.appendChild(h('p', {}, [h('button', {
        class: 'btn subtle', text: 'Open all in Compare',
        title: 'Load the robot copies as the Compare baseline: robot on the left, library on the right',
        onclick: function () { openRobotCheckCompare(null); }
      })]));
    }
    return box;
  }

  function openRobotCheckCompare(name) {
    var rc = state.robotCheck;
    if (!rc) return;
    setBaseline('robot ' + rc.ip + (rc.at ? ' @ ' + rc.at.toLocaleTimeString() : ''), rc.sources);
    if (name) state.compare.open = name;
    state.tab = 'compare';
    setNav(false);
    render();
  }

  function renderRobot(pane) {
    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Robot connection' }),
      state.robot.loadedAt ? h('span', { class: 'muted', text: 'last read ' + state.robot.loadedAt.toLocaleTimeString() }) : null
    ]));

    if (!state.server) {
      var box = h('div', { class: 'summary' });
      box.appendChild(h('h3', { text: 'Live robot access needs the bridge server' }));
      box.appendChild(h('p', { text: 'Browsers cannot talk to a FANUC controller directly (the controller speaks plain HTTP/FTP with no browser-permitted cross-origin headers). The bridge is a small zero-dependency server included in this repo that proxies to the robot and serves this same app.' }));
      var ol = h('ol');
      [['On any PC on the robot network:  node server.js', 'then open http://localhost:8642 on that PC.'],
       ['From your phone or another PC on the same network:', 'open http://<that-pc-ip>:8642 — full app, live robot access.'],
       ['On the robot, enable the controller web server:', 'MENU → SETUP → Host Comm → HTTP (proxy/no-protection for the MD device). The bridge then reads programs and variables from http://<robot-ip>/MD/.']].forEach(function (s) {
        var li = h('li');
        li.appendChild(h('div', { class: 'mono', text: s[0] }));
        li.appendChild(h('div', { class: 'muted', text: s[1] }));
        ol.appendChild(li);
      });
      box.appendChild(ol);
      box.appendChild(h('p', { class: 'muted', text: 'The bridge mostly READS from robots — programs, register values, I/O. It writes only where you ask it to and it can check the result: sending a .LS back, and renaming a register or I/O point. Nothing it does can move a robot.' }));
      pane.appendChild(box);
      return;
    }

    // connection form
    var form = h('div', { class: 'search-bar' });
    var ipIn = h('input', { type: 'text', placeholder: 'Robot IP, e.g. 192.168.0.10' });
    ipIn.value = state.robot.ip || '';
    var userIn = h('input', { type: 'text', placeholder: 'FTP user (blank = anonymous)', style: 'max-width:200px' });
    userIn.value = state.robot.ftpUser || '';
    userIn.addEventListener('change', function () { state.robot.ftpUser = userIn.value.trim(); });
    var passIn = h('input', { type: 'password', placeholder: 'FTP password', style: 'max-width:160px' });
    passIn.value = state.robot.ftpPass || '';
    passIn.addEventListener('change', function () { state.robot.ftpPass = passIn.value; });
    form.appendChild(ipIn);
    form.appendChild(userIn);
    form.appendChild(passIn);
    form.appendChild(h('button', { class: 'btn primary', text: state.robot.ip ? 'Reconnect' : 'Connect', onclick: function () { state.robot.ftpUser = userIn.value.trim(); state.robot.ftpPass = passIn.value; if (ipIn.value.trim()) connectRobot(ipIn.value.trim()); } }));
    pane.appendChild(form);
    pane.appendChild(scanPanel());
    /* Above the connection-dependent sections on purpose: connecting and
     * backing up the robots a scan found are whole jobs on their own, and
     * neither must sit behind "connect to one of them first". */
    pane.appendChild(savedRobotsPanel(ipIn, userIn));

    var banner = uploadBanner();
    if (banner) pane.appendChild(banner);

    if (state.robot.error) {
      pane.appendChild(h('p', {}, [h('span', { class: 'badge warn', text: 'connection failed' })]));
      pane.appendChild(h('p', { class: 'muted', text: state.robot.error + ' — check the IP, that the PC running the bridge is on the robot network, and that HTTP is enabled on the controller (Host Comm).' }));
      return;
    }
    if (!state.robot.ip) {
      pane.appendChild(h('p', { class: 'muted', text: 'Enter the controller IP. The bridge reads the program list, register values (NUMREG.VA) and I/O configuration from the robot. Registers and I/O points can be renamed in place once connected.' }));
      return;
    }

    // program files — log exports carry a .LS extension too, and offering
    // them here only ever produced a chip that could not be imported
    var allLs = state.robot.files.filter(function (f) { return /\.LS$/i.test(f); });
    var lsFiles = allLs.filter(function (f) { return !isKnownNonProgram(f); });
    var logFiles = allLs.filter(isKnownNonProgram);
    var secProgs = secHead('Programs on ' + state.robot.ip + ' (' + lsFiles.length + ')', 'robot-programs', false);
    pane.appendChild(secProgs.el);
    if (!secProgs.open) { /* collapsed */ } else if (lsFiles.length) {
      var imp = state.robotImport;
      var actions = h('p', {});
      if (imp) {
        var pct = imp.total ? Math.round((imp.done / imp.total) * 100) : 0;
        var bar = h('div', { class: 'import-bar' }, [
          h('span', { style: 'width:' + pct + '%' })
        ]);
        actions.appendChild(bar);
        var line = h('div', { class: 'import-line' }, [
          h('span', { text: 'Importing ' + imp.done + ' of ' + imp.total + '… ' }),
          h('span', { class: 'muted', text: '(' + imp.added + ' in' +
            (imp.skipped ? ', ' + imp.skipped + ' skipped' : '') +
            (imp.failed ? ', ' + imp.failed + ' failed' : '') + ')' }),
          h('span', { text: ' ' }),
          h('button', {
            class: 'btn subtle', text: 'Stop',
            title: 'Stop after the files already in flight',
            onclick: function () { if (state.robotImport) state.robotImport.cancel = true; render(); }
          })
        ]);
        actions.appendChild(line);
      } else {
        actions.appendChild(h('button', {
          class: 'btn', text: 'Import all ' + lsFiles.length + ' programs',
          title: 'Read every listed program off the controller, ' + IMPORT_CONCURRENCY + ' at a time',
          onclick: function () {
            if (!confirmCrossSource(lsFiles)) return;
            importAllFromRobot(lsFiles);
          }
        }));
        var rcBtn = robotCheckControls();
        if (rcBtn) { actions.appendChild(document.createTextNode(' ')); actions.appendChild(rcBtn); }
      }
      pane.appendChild(actions);
      var rcPanel = robotCheckPanel();
      if (rcPanel) pane.appendChild(rcPanel);
      var fl = h('div', { class: 'robot-files' });
      lsFiles.forEach(function (f) {
        var name = f.replace(/\.LS$/i, '');
        var busy = imp && imp.inFlight[f.toUpperCase()];
        var here = !!state.programs[name];
        var dif = here && robotDiffers(name);
        /* Three states, so a bulk import reads as motion rather than a wall
         * of red that turns green all at once when it finishes. */
        fl.appendChild(h('span', {
          class: 'chip ' + (busy ? 'loading' : dif ? 'write' : here ? 'read' : 'write'),
          text: f + (busy ? ' …' : dif ? ' ≠' : here ? ' ✓' : ''),
          title: busy ? 'reading from the controller…'
            : dif ? 'the robot copy DIFFERS from the library (+' + dif.adds + '/−' + dif.dels + ' lines) — click to replace the library copy with the robot’s'
            : here ? 'in library — click to re-import' : 'click to import',
          onclick: function () {
            if (!confirmCrossSource([f])) return;
            importFromRobot(f).then(function (n) { if (n) { state.selected = n; render(); } });
          }
        }));
      });
      pane.appendChild(fl);
      if (logFiles.length) {
        pane.appendChild(h('p', {
          class: 'muted',
          text: 'Not listed (controller logs and diagnostics, not programs): ' + logFiles.join(', ') +
            '. The error history below reads ERRALL.LS directly.'
        }));
      }
    } else if (state.robot.loadedAt) {
      pane.appendChild(h('p', { class: 'muted', text: 'No .LS files listed. Some controllers need ASCII upload support for .LS on MD:. The file list found: ' + (state.robot.files.join(', ') || 'nothing') }));
    } else {
      pane.appendChild(h('p', { class: 'muted', text: 'Reading…' }));
    }

    /* The per-connection Backups section used to live here; backing up —
     * quick from the robot's row, full from the sweep button — is the saved
     * list's job now, connected or not. */

    /* ---- program / task state ----
     * Why an edit gets refused. Read on demand: PRGSTATE.DG is a big file and
     * it is only interesting when the controller is saying no. */
    var ps = state.robot.prgState;
    var psOk = ps && !ps.error ? ps : null;
    var lockedNames = psOk ? Object.keys(psOk.locked) : [];
    var secPs = secHead('Program state (PRGSTATE.DG)' +
      (psOk ? ' — ' + (lockedNames.length
        ? lockedNames.length + ' program' + (lockedNames.length > 1 ? 's' : '') + ' in use'
        : 'nothing in use') : ''),
      'robot-prgstate', false);
    pane.appendChild(secPs.el);
    if (secPs.open) {
      pane.appendChild(h('p', { class: 'muted', text: 'A controller refuses to overwrite a program that has a live task — and a PAUSED task is still live, only ABORT releases it. Every program on a live task’s routine stack is held, not just the one the cursor is in, which is why an edit can be refused for a program that looks idle.' }));
      pane.appendChild(h('p', {}, [
        h('button', {
          class: 'btn subtle',
          text: (ps !== undefined && ps !== null) ? 'Refresh from robot' : 'Read from robot',
          onclick: loadRobotPrgState
        })
      ]));
      if (ps === null) {
        pane.appendChild(h('p', { class: 'muted', text: 'Reading…' }));
      } else if (ps && ps.error) {
        pane.appendChild(h('p', { class: 'muted', text: 'Could not read PRGSTATE.DG: ' + ps.error }));
      } else if (psOk) {
        if (lockedNames.length) {
          pane.appendChild(h('h3', { text: 'Held by a live task — an edit will be refused' }));
          var lw = h('div', { class: 'robot-files' });
          lockedNames.sort().forEach(function (n) {
            var lt = psOk.locked[n];
            lw.appendChild(h('span', {
              class: 'chip write',
              text: n,
              title: lt
                ? 'task ' + lt.name + ' is ' + lt.state + (lt.line ? ' at line ' + lt.line + ' of ' + lt.routine : '')
                : 'a task is attached to this program'
            }));
          });
          pane.appendChild(lw);
        } else {
          pane.appendChild(h('p', { class: 'muted', text: 'No program is held by a live task right now — edits should be accepted.' }));
        }

        pane.appendChild(h('h3', { text: 'Tasks' }));
        var tskWrap = h('div', { class: 'table-wrap' });
        var tskTbl = h('table', { class: 'attr-table' });
        var tskHead = h('tr');
        ['#', 'Task', 'State', 'At', 'Routine stack'].forEach(function (c) {
          tskHead.appendChild(h('th', { text: c }));
        });
        tskTbl.appendChild(tskHead);
        psOk.tasks.forEach(function (t) {
          var live = t.state === 'RUNNING' || t.state === 'PAUSED' || t.state === 'HELD';
          var row = h('tr');
          row.appendChild(h('td', { text: String(t.n) }));
          row.appendChild(h('td', { class: 'mono', text: t.name }));
          row.appendChild(h('td', {}, [h('span', { class: 'badge ' + (live ? 'warn' : 'ok'), text: t.state })]));
          row.appendChild(h('td', { class: 'mono', text: t.program ? t.program + ':' + t.line : '' }));
          row.appendChild(h('td', {
            class: 'mono',
            text: t.stack.map(function (f) { return f.program + ':' + f.line; }).join('  <  ')
          }));
          tskTbl.appendChild(row);
        });
        tskWrap.appendChild(tskTbl);
        pane.appendChild(tskWrap);

        if (psOk.programs.length) {
          pane.appendChild(h('h3', { text: 'Programs on the controller (' + psOk.programs.length + ')' }));
          var pBar = h('div', { class: 'search-bar' });
          var pIn = h('input', { type: 'search', placeholder: 'Filter… e.g. _pk, protected, in use' });
          pBar.appendChild(pIn);
          pane.appendChild(pBar);
          var pWrap = h('div', { class: 'table-wrap' });
          pane.appendChild(pWrap);
          var drawPrgs = function () {
            var q = pIn.value.trim().toLowerCase();
            pWrap.innerHTML = '';
            var tbl = h('table', { class: 'attr-table' });
            var hr = h('tr');
            ['Program', 'Type', 'Task', 'Protection', 'Lines', 'Comment', 'Last modified'].forEach(function (c) {
              hr.appendChild(h('th', { text: c }));
            });
            tbl.appendChild(hr);
            var shown = 0;
            psOk.programs.forEach(function (pr) {
              var held = pr.task && pr.task.toLowerCase() !== 'no';
              var prot = /on/i.test(pr.protection || '');
              var hay = (pr.name + ' ' + (pr.comment || '') + ' ' + (pr.type || '') +
                (held ? ' in use' : ' free') + (prot ? ' protected' : '')).toLowerCase();
              if (q && hay.indexOf(q) === -1) return;
              if (++shown > 400) return;
              var r = h('tr');
              r.appendChild(h('td', { class: 'mono', text: pr.name }));
              r.appendChild(h('td', { text: pr.type || '' }));
              r.appendChild(h('td', {}, [held
                ? h('span', { class: 'badge warn', text: 'in use' })
                : h('span', { class: 'muted', text: 'free' })]));
              r.appendChild(h('td', { text: pr.protection || '' }));
              r.appendChild(h('td', { class: 'n', text: pr.lines === undefined ? '' : String(pr.lines) }));
              r.appendChild(h('td', { text: pr.comment || '' }));
              r.appendChild(h('td', { text: pr.modified || '' }));
              tbl.appendChild(r);
            });
            pWrap.appendChild(tbl);
            if (!shown) pWrap.appendChild(h('p', { class: 'muted', text: 'No programs match.' }));
          };
          pIn.addEventListener('input', drawPrgs);
          drawPrgs();
        }
      }
    }

    /* ---- live pendant (iPendant mirror) ----
     * The controller serves its own pendant UI, which is the only way to
     * reach the screens it never exports as a file. Execution History is the
     * one that matters: its trace buffer lives in controller memory and
     * appears in no backup, no MD: file and no system variable.
     *
     * These open a real window rather than an inline frame. Framing was tried
     * and does not work: the page loads but sticks on "Logging in to
     * controller" forever, because its login handshake needs a top-level
     * context. The controller's own home page opens them with window.open
     * too, at these same sizes.
     *
     * Opening one registers an interactive login on the controller (TPIF-137
     * names the PC that connected), so the window has a Logout button and it
     * is worth using. */
    var PENDANT_VIEWS = [
      ['/frh/jcgtp/cgtp.stm', 1024, 800, 'iPendant',
        'The full pendant UI — Execution History and every other menu. This drives the real controller.'],
      ['/frh/jcgtp/echo.stm', 692, 620, 'Display only',
        'Mirrors whatever the physical pendant is showing. You cannot navigate it from here.'],
      ['/frh/jcgtp/sop.stm', 1024, 800, 'Soft operator panel',
        'The operator panel: cycle start, hold, alarm reset.']
    ];
    var secPen = secHead('Live pendant (iPendant)', 'robot-pendant', false);
    pane.appendChild(secPen.el);
    if (secPen.open) {
      pane.appendChild(h('p', { class: 'muted', text: 'The controller serves its own pendant UI, so screens it never writes to a file are still reachable — Execution History among them. Each opens in its own window, because the pendant’s login does not complete inside an embedded frame.' }));
      var penRow = h('p', {});
      PENDANT_VIEWS.forEach(function (v) {
        var url = 'http://' + state.robot.ip.split(':')[0] + v[0];
        penRow.appendChild(h('button', {
          class: 'btn', text: v[3], title: v[4] + '  ·  ' + url,
          onclick: function () {
            window.open(url, 'fanuc-pendant-' + v[3].replace(/[^a-z]/gi, ''),
              'width=' + v[1] + ',height=' + v[2] + ',resizable=yes,scrollbars=yes');
          }
        }));
        penRow.appendChild(document.createTextNode(' '));
      });
      pane.appendChild(penRow);
      pane.appendChild(h('p', { class: 'muted', text: 'Two things worth knowing: the window talks straight to ' + state.robot.ip + ', so this device has to be able to reach the robot itself — fine on the plant network, but a phone reaching only the bridge from off-site will not load it. And opening one registers an interactive login on the controller, so use the pendant’s own Logout button when you are done rather than just closing the window.' }));
    }

    // error history
    var errs = state.robot.errors;
    var errsOk = errs && !errs.error ? errs : null;
    var actCount = errsOk ? errsOk.filter(function (e2) { return e2.active; }).length : 0;
    var secErr = secHead('Error history (ERRALL.LS)' + (errsOk ? ' — ' + errsOk.length + (actCount ? ' · ' + actCount + ' active' : '') : ''), 'robot-errors', false);
    pane.appendChild(secErr.el);
    if (secErr.open) {
      pane.appendChild(h('p', {}, [
        h('button', { class: 'btn subtle', text: errs !== undefined && errs !== null ? 'Refresh from robot' : 'Read from robot', onclick: loadRobotErrors })
      ]));
      if (errs === null) pane.appendChild(h('p', { class: 'muted', text: 'Reading…' }));
      else if (errs && errs.error) pane.appendChild(h('p', { class: 'muted', text: 'Could not read ERRALL.LS: ' + errs.error }));
      else if (errsOk) {
        var eBar = h('div', { class: 'search-bar' });
        var eIn = h('input', { type: 'search', placeholder: 'Filter errors… e.g. ASBN, SRVO-003, collision' });
        eBar.appendChild(eIn);
        pane.appendChild(eBar);
        var eWrap = h('div', { class: 'table-wrap' });
        pane.appendChild(eWrap);
        var drawErrs = function () {
          var q = eIn.value.trim().toLowerCase();
          eWrap.innerHTML = '';
          var tbl = h('table', { class: 'xref-table' });
          tbl.appendChild(h('tr', {}, [h('th', { text: 'Time' }), h('th', { text: 'Code' }), h('th', { text: 'Message' }), h('th', { text: 'Severity' })]));
          var shown = 0;
          errsOk.forEach(function (e2) {
            var hay = (e2.time + ' ' + (e2.code || '') + ' ' + e2.text + ' ' + e2.severity).toLowerCase();
            if (q && hay.indexOf(q) === -1) return;
            if (++shown > 300) return;
            tbl.appendChild(h('tr', {}, [
              h('td', { class: 'n', text: e2.time }),
              h('td', { class: 'n', text: e2.code || '—' }),
              h('td', { text: e2.text }),
              h('td', {}, [
                e2.severity ? h('span', { class: 'badge ' + (/SERVO|ABORT|STOP/.test(e2.severity) ? 'warn' : 'mid'), text: e2.severity }) : null,
                e2.active ? h('span', { class: 'badge warn', text: 'ACTIVE' }) : null
              ])
            ]));
          });
          eWrap.appendChild(tbl);
          if (!shown) eWrap.appendChild(h('p', { class: 'muted', text: 'No errors match.' }));
        };
        eIn.addEventListener('input', drawErrs);
        drawErrs();
        pane.appendChild(h('p', { class: 'muted', text: 'Newest first. Load errors (ASBN) reference physical FILE lines — failed uploads from this app translate those to program lines automatically in the red banner.' }));
      } else {
        pane.appendChild(h('p', { class: 'muted', text: 'Click “Read from robot” to pull the controller’s alarm history.' }));
      }
    }

    // registers
    var regs = state.robot.registers;
    var secRegs = secHead('Registers (NUMREG.VA)' + (regs && !regs.error ? ' — ' + regs.length : ''), 'robot-regs', false);
    pane.appendChild(secRegs.el);
    if (!secRegs.open) { /* collapsed */ } else {
    pane.appendChild(h('p', {}, [h('button', { class: 'btn subtle', text: 'Refresh from robot', onclick: loadRobotRegisters })]));
    if (!regs) {
      pane.appendChild(h('p', { class: 'muted', text: 'Reading…' }));
    } else if (regs.error) {
      pane.appendChild(h('p', { class: 'muted', text: 'Could not read NUMREG.VA: ' + regs.error }));
    } else {
      var filterBar = h('div', { class: 'search-bar' });
      var fIn = h('input', { type: 'search', placeholder: 'Filter registers by number, value, or comment…' });
      filterBar.appendChild(fIn);
      pane.appendChild(filterBar);
      var regWrap = h('div', { class: 'table-wrap' });
      pane.appendChild(regWrap);
      function drawRegs() {
        var q = fIn.value.trim().toLowerCase();
        regWrap.innerHTML = '';
        var tbl = h('table', { class: 'xref-table' });
        tbl.appendChild(h('tr', {}, [h('th', { text: 'Register' }), h('th', { text: 'Live value' }), h('th', { text: 'Comment' }), h('th', { text: 'Used at' })]));
        var shown = 0;
        regs.forEach(function (r) {
          var hay = ('r[' + r.index + '] ' + r.value + ' ' + r.comment).toLowerCase();
          if (q && hay.indexOf(q) === -1) return;
          if (++shown > 200) return;
          var used = h('td');
          var x = state.xref.registers[r.index];
          if (x) x.refs.slice(0, 6).forEach(function (ref) { used.appendChild(chip(ref, ref.write ? 'write' : 'read')); });
          tbl.appendChild(h('tr', {}, [
            h('td', { class: 'n', text: 'R[' + r.index + ']' }),
            h('td', { class: 'n', text: String(r.value) }),
            commentCell('R', r.index, r.comment, function (text) { r.comment = text; }),
            used
          ]));
        });
        regWrap.appendChild(tbl);
        if (!shown) regWrap.appendChild(h('p', { class: 'muted', text: 'No registers match.' }));
      }
      fIn.addEventListener('input', drawRegs);
      drawRegs();
    }
    } // end registers section

    // position registers
    var prs = state.robot.posregs;
    // Empty PRs (uninitialized, no comment) are hidden by default — a
    // controller has hundreds — but "show empty" lists them, because naming
    // one is the first step in putting it to use.
    var prsAll = prs && !prs.error ? prs : null;
    var prsOk = prsAll ? prsAll.filter(function (r) { return state.showEmptyPR || r.rep !== 'uninitialized' || r.comment; }) : null;
    var secPR = secHead('Position registers (POSREG.VA)' + (prsOk ? ' — ' + prsOk.length : ''), 'robot-posregs', false);
    pane.appendChild(secPR.el);
    if (secPR.open) {
      var emptyCount = prsAll ? prsAll.filter(function (r) { return r.group === 1 && r.rep === 'uninitialized' && !r.comment; }).length : 0;
      var emptyCb = h('input', { type: 'checkbox' });
      emptyCb.checked = !!state.showEmptyPR;
      emptyCb.addEventListener('change', function () { state.showEmptyPR = emptyCb.checked; render(); });
      pane.appendChild(h('p', { class: 'robot-tools' }, [
        h('button', { class: 'btn subtle', text: 'Refresh from robot', onclick: loadRobotPosregs }),
        prsAll ? h('label', { title: 'List uninitialized PRs that have no comment yet, so one can be named before it is taught' }, [
          emptyCb, document.createTextNode(' Show ' + emptyCount + ' empty PR' + (emptyCount === 1 ? '' : 's'))
        ]) : null
      ]));
      if (!prs) pane.appendChild(h('p', { class: 'muted', text: 'Reading…' }));
      else if (prs.error) pane.appendChild(h('p', { class: 'muted', text: 'Could not read POSREG.VA: ' + prs.error }));
      else {
        var prBar = h('div', { class: 'search-bar' });
        var prIn = h('input', { type: 'search', placeholder: 'Filter position registers…' });
        prBar.appendChild(prIn);
        pane.appendChild(prBar);
        var prWrap = h('div', { class: 'table-wrap' });
        pane.appendChild(prWrap);
        var drawPRs = function () {
          var q = prIn.value.trim().toLowerCase();
          prWrap.innerHTML = '';
          var tbl = h('table', { class: 'xref-table' });
          tbl.appendChild(h('tr', {}, [h('th', { text: 'PR' }), h('th', { text: 'Comment' }), h('th', { text: 'Type' }), h('th', { text: 'Values' }), h('th', { text: 'Used at' })]));
          var shown = 0;
          prsOk.forEach(function (r) {
            var key = 'PR[' + r.index + ']' + (r.group > 1 ? ' GP' + r.group : '');
            var vals = VA.posregValueStr(r);
            if (q && (key + ' ' + r.comment + ' ' + vals).toLowerCase().indexOf(q) === -1) return;
            if (++shown > 300) return;
            var used = h('td');
            var xr = r.group === 1 ? state.xref.posRegs[r.index] : null;
            if (xr) xr.refs.slice(0, 6).forEach(function (ref) { used.appendChild(chip(ref, ref.write ? 'write' : 'read')); });
            tbl.appendChild(h('tr', {}, [
              h('td', { class: 'n', text: key }),
              commentCell('PR', r.index, r.comment, function (text) {
                // one comment per PR index — the per-group rows all share it
                prs.forEach(function (pr) { if (pr.index === r.index) pr.comment = text; });
              }),
              h('td', { class: 'n', text: r.rep === 'joint' ? 'joint' : r.rep === 'cartesian' ? 'xyzwpr' + (r.config ? ' · ' + r.config : '') : '—' }),
              h('td', { class: 'n', text: vals }),
              used
            ]));
          });
          prWrap.appendChild(tbl);
          if (!shown) prWrap.appendChild(h('p', { class: 'muted', text: 'No position registers match.' }));
        };
        prIn.addEventListener('input', drawPRs);
        drawPRs();
        pane.appendChild(h('p', { class: 'muted', text: (state.showEmptyPR
          ? 'Empty PRs are listed — type a name in the Comment column to claim one; it is written to the controller when you leave the field. '
          : 'Uninitialized, uncommented PRs are hidden — tick "Show empty PRs" to name one. ')
          + 'Cartesian values are mm/deg; joint values are axis degrees.' }));
      }
    }

    // string registers — SR[n] carries the text an alarm or a message is built
    // from, and its comment is its name. Listed only when the controller
    // actually has them: without the string-register option there is no
    // STRREG.VA, and a missing option is not a fault worth a red section.
    var srs = state.robot.strregs;
    if (srs && !srs.error && srs.length) {
      var secSR = secHead('String registers (STRREG.VA) — ' + srs.length, 'robot-strregs', false);
      pane.appendChild(secSR.el);
      if (secSR.open) {
        pane.appendChild(h('p', {}, [h('button', { class: 'btn subtle', text: 'Refresh from robot', onclick: loadRobotStrregs })]));
        var srBar = h('div', { class: 'search-bar' });
        var srIn = h('input', { type: 'search', placeholder: 'Filter string registers by number, name, or text…' });
        srBar.appendChild(srIn);
        pane.appendChild(srBar);
        var srWrap = h('div', { class: 'table-wrap' });
        pane.appendChild(srWrap);
        var drawSRs = function () {
          var q = srIn.value.trim().toLowerCase();
          srWrap.innerHTML = '';
          var tbl = h('table', { class: 'xref-table' });
          tbl.appendChild(h('tr', {}, [h('th', { text: 'SR' }), h('th', { text: 'Comment' }), h('th', { text: 'Value' })]));
          var shown = 0;
          srs.forEach(function (r) {
            if (q && ('sr[' + r.index + '] ' + r.comment + ' ' + r.value).toLowerCase().indexOf(q) === -1) return;
            shown++;
            tbl.appendChild(h('tr', {}, [
              h('td', { class: 'n', text: 'SR[' + r.index + ']' }),
              commentCell('SR', r.index, r.comment, function (text) { r.comment = text; }),
              h('td', { text: r.value })
            ]));
          });
          srWrap.appendChild(tbl);
          if (!shown) srWrap.appendChild(h('p', { class: 'muted', text: 'No string registers match.' }));
        };
        srIn.addEventListener('input', drawSRs);
        drawSRs();
      }
    }

    // I/O — live state from IOSTATE.DG, grouped by type
    var secIO = secHead('Live I/O (IOSTATE.DG)' + (state.robot.ioState ? ' — ' + state.robot.ioState.length + ' points' : ''), 'robot-io', false);
    pane.appendChild(secIO.el);
    if (!secIO.open) return;
    pane.appendChild(h('p', {}, [
      h('button', { class: 'btn subtle', text: (state.robot.ioState || state.robot.rawIO) ? 'Refresh from robot' : 'Read from robot', onclick: loadRobotIO })
    ]));
    if (state.robot.ioState) {
      var ioBar2 = h('div', { class: 'search-bar' });
      var ioIn2 = h('input', { type: 'search', placeholder: 'Filter I/O… e.g. DI[1], DO, gripper, ON — or expand a type below' });
      ioBar2.appendChild(ioIn2);
      pane.appendChild(ioBar2);
      var ioWrap = h('div');
      pane.appendChild(ioWrap);

      function ioRow(tbl, p) {
        var key = p.type + '[' + p.index + ']';
        var used = h('td');
        var x = state.xref.io[key];
        if (x) x.refs.slice(0, 6).forEach(function (ref) { used.appendChild(chip(ref, ref.write ? 'write' : 'read')); });
        tbl.appendChild(h('tr', {}, [
          h('td', { class: 'n', text: key }),
          h('td', {}, [h('span', { class: p.state === 'ON' ? 'tok-on mono' : (p.state === 'OFF' ? 'tok-off mono' : 'mono'), text: p.state })]),
          commentCell(p.type, p.index, p.comment, function (text) {
            p.comment = text;
            // ioComments is the labeled-only view the checks read, so a point
            // that just gained or lost a name has to move in or out of it
            state.robot.ioComments = state.robot.ioState.filter(function (pt) { return pt.comment; });
          }),
          used
        ]));
      }

      function ioTable() {
        var tbl = h('table', { class: 'xref-table' });
        tbl.appendChild(h('tr', {}, [h('th', { text: 'Point' }), h('th', { text: 'Live state' }), h('th', { text: 'Comment' }), h('th', { text: 'Used at' })]));
        return tbl;
      }

      var drawIOTable = function () {
        var q = ioIn2.value.trim().toLowerCase();
        ioWrap.innerHTML = '';
        if (q) {
          // filtering: one flat table of matches across every type
          var tbl = ioTable();
          var shown = 0;
          state.robot.ioState.forEach(function (p) {
            var key = p.type + '[' + p.index + ']';
            if ((key + ' ' + p.state + ' ' + p.comment).toLowerCase().indexOf(q) === -1) return;
            if (++shown > 300) return;
            ioRow(tbl, p);
          });
          var tw = h('div', { class: 'table-wrap' });
          tw.appendChild(tbl);
          ioWrap.appendChild(tw);
          if (!shown) ioWrap.appendChild(h('p', { class: 'muted', text: 'No I/O points match.' }));
          return;
        }
        // no filter: collapsible group per I/O type
        var groups = {}, order = [];
        state.robot.ioState.forEach(function (p) {
          if (!groups[p.type]) { groups[p.type] = []; order.push(p.type); }
          groups[p.type].push(p);
        });
        order.forEach(function (type) {
          var pts = groups[type];
          var on = pts.filter(function (p) { return p.state === 'ON'; }).length;
          var labeled = pts.filter(function (p) { return p.comment; }).length;
          var open = !!(state.secOpen && state.secOpen['io-' + type]);
          var item = h('div', { class: 'xref-item' + (open ? ' open' : '') });
          var head = h('button', { class: 'xi-head' }, [
            h('span', { class: 'xi-caret', text: open ? '▾' : '▸' }),
            h('span', { class: 'xi-key mono', text: type }),
            h('span', { class: 'xi-label', text: pts.length + ' points · ' + on + ' ON · ' + labeled + ' labeled' })
          ]);
          head.addEventListener('click', function () {
            state.secOpen['io-' + type] = !open;
            drawIOTable();
          });
          item.appendChild(head);
          if (open) {
            var body = h('div', { class: 'xi-body table-wrap' });
            var tbl = ioTable();
            pts.slice(0, 600).forEach(function (p) { ioRow(tbl, p); });
            body.appendChild(tbl);
            if (pts.length > 600) body.appendChild(h('p', { class: 'muted', text: 'Showing first 600 — use the filter to narrow.' }));
            item.appendChild(body);
          }
          ioWrap.appendChild(item);
        });
      };
      ioIn2.addEventListener('input', drawIOTable);
      drawIOTable();
      return;
    }
    var io = state.robot.rawIO;
    if (io && io.error) {
      pane.appendChild(h('p', { class: 'muted', text: 'Could not read the I/O state: ' + io.error }));
    } else if (io) {
      var ioBar = h('div', { class: 'search-bar' });
      var ioIn = h('input', { type: 'search', placeholder: 'Filter I/O lines… e.g. DI[101], DO, RI' });
      ioBar.appendChild(ioIn);
      pane.appendChild(ioBar);
      var pre = h('div', { class: 'codebox io-raw' });
      pane.appendChild(pre);
      function drawIO() {
        var q = ioIn.value.trim().toLowerCase();
        pre.innerHTML = '';
        var shown = 0;
        io.forEach(function (l) {
          if (q && l.toLowerCase().indexOf(q) === -1) return;
          if (++shown > 400) return;
          pre.appendChild(h('div', { class: 'cline' }, [h('span', { class: 'src', text: l })]));
        });
        if (!shown) pre.appendChild(h('div', { class: 'cline' }, [h('span', { class: 'src muted', text: 'no matching lines' })]));
      }
      ioIn.addEventListener('input', drawIO);
      drawIO();
    }
  }

  /* ================= wiring ================= */

  function init() {
    document.getElementById('file-input').addEventListener('change', function (ev) {
      importFiles(ev.target.files);
      ev.target.value = '';
    });
    document.getElementById('folder-input').addEventListener('change', function (ev) {
      importFiles(ev.target.files);
      ev.target.value = '';
    });
    /* Both baseline pickers land here: a multi-file selection, and a folder
     * selection (which arrives as every file under it, hence the .LS filter
     * and the folder name taken off the first relative path). */
    function loadBaselineFiles(fileList, labelFor) {
      var files = Array.prototype.slice.call(fileList).filter(function (f) { return /\.ls$/i.test(f.name); });
      if (!files.length) {
        toast('No .LS files there.');
        return;
      }
      var set = {}, pending = files.length;
      files.forEach(function (f) {
        var reader = new FileReader();
        reader.onload = function () {
          var src = String(reader.result);
          set[P.parseLS(src, f.name).name] = src;
          if (--pending === 0) setBaseline(labelFor(files), set);
        };
        reader.readAsText(f);
      });
    }

    document.getElementById('compare-input').addEventListener('change', function (ev) {
      // snapshot before clearing: input.value = '' empties the live FileList
      var fl = Array.prototype.slice.call(ev.target.files);
      ev.target.value = '';
      loadBaselineFiles(fl, function (files) { return 'backup files (' + files.length + ')'; });
    });

    document.getElementById('compare-dir-input').addEventListener('change', function (ev) {
      var fl = Array.prototype.slice.call(ev.target.files);
      ev.target.value = '';
      loadBaselineFiles(fl, function (files) {
        var rel = files[0].webkitRelativePath || '';
        var folder = rel.split('/')[0] || 'selected folder';
        return 'backup folder ' + folder + ' (' + files.length + ' .LS)';
      });
    });

    window.addEventListener('popstate', onPopState);

    // Ctrl+E: cross-reference the selection (Studio 5000 habit)
    window.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        crossRefToken(selectedText());
      }
      if (cfgKey(e)) { e.preventDefault(); return; }
      if (e.key === 'Escape' && navOpen()) {
        setNav(false);
        var nb = document.getElementById('btn-nav');
        if (nb) nb.focus();
      }
    });


    document.getElementById('btn-nav').addEventListener('click', toggleNav);
    document.getElementById('nav-scrim').addEventListener('click', function () { setNav(false); });
    document.getElementById('btn-import').addEventListener('click', function () {
      document.getElementById('file-input').click();
    });
    document.getElementById('btn-folder').addEventListener('click', function () {
      document.getElementById('folder-input').click();
    });
    document.getElementById('btn-phone').addEventListener('click', openPhoneDialog);
    document.getElementById('lib-filter').addEventListener('input', renderSidebar);
    document.getElementById('lib-showall').addEventListener('change', function () {
      state.showAllProgs = this.checked;
      savePrefs();
      renderSidebar();
    });
    document.getElementById('btn-clear').addEventListener('click', function () {
      if (!Object.keys(state.programs).length) return;
      if (!confirm('Remove all programs from the ' + libLabel(state.library) + ' library? Other robots’ libraries and your original files are untouched.')) return;
      state.programs = {};
      state.selected = null;
      rebuildDerived();
      persist();
      render();
    });
    document.getElementById('lib-ws').addEventListener('change', function () {
      var v = this.value;
      if (!v || v === state.library) return;
      if (!setLibrary(v)) { this.value = state.library; return; }
      render();
    });
    document.getElementById('robot-select').addEventListener('change', function () {
      var v = this.value;
      if (v === ROBOT_PICK_TAB) { state.tab = 'robot'; render(); return; }
      if (!v) return;
      var saved = state.knownRobots.filter(function (r) { return r.ip === v; })[0];
      /* connectRobot() carries ftpUser/ftpPass over from the current
       * state.robot, so seed them first. The username comes back with the
       * saved entry; the password never does, by design — a robot that
       * needs one has to be connected from the Robot tab. */
      state.robot.ftpUser = (saved && saved.ftpUser) || '';
      state.robot.ftpPass = '';
      connectRobot(v);
    });
    document.getElementById('btn-dir').addEventListener('click', function () {
      var d = document.getElementById('dir-path').value.trim();
      if (d) openDirectory(d);
    });
    document.getElementById('btn-dir-browse').addEventListener('click', function () {
      var pathIn = document.getElementById('dir-path');
      openFolderPicker({
        title: 'Open a folder of programs',
        hint: 'Every .LS in the folder loads into the library — a robot backup folder, typically.',
        start: pathIn.value.trim() || '',
        onPick: function (p) {
          if (!p) return;
          pathIn.value = p;
          openDirectory(p);
        }
      });
    });

    ['dragover', 'dragenter'].forEach(function (t) {
      window.addEventListener(t, function (e) { e.preventDefault(); document.body.classList.add('dragging'); });
    });
    ['dragleave', 'dragend'].forEach(function (t) {
      window.addEventListener(t, function (e) { if (e.target === document.body || t === 'dragend') document.body.classList.remove('dragging'); });
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      document.body.classList.remove('dragging');
      if (!e.dataTransfer) return;
      var progName = e.dataTransfer.getData('text/x-prog');
      var docId = e.dataTransfer.getData('text/x-doc') ||
        (progName && state.programs[progName] ? 'P:' + progName : '');
      if (docId && docValid(docId)) {
        // Notepad++/Studio-5000-style: drop a tab or a library program onto
        // the code view — right half docks it side-by-side, left half
        // replaces the view
        var paneEl = document.getElementById('pane');
        var r = paneEl.getBoundingClientRect();
        dockDoc(docId, e.clientX > r.left + r.width / 2);
        return;
      }
      if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
    });

    var buildTag = document.getElementById('build-tag');
    if (buildTag && window.FANUC_STUDIO_BUILD) buildTag.textContent = window.FANUC_STUDIO_BUILD;

    document.getElementById('btn-theme').addEventListener('click', function () {
      state.theme = THEME_ORDER[(THEME_ORDER.indexOf(state.theme) + 1) % THEME_ORDER.length];
      paintTheme();
      savePrefs();
    });

    loadPrefs();
    paintTheme();
    paintCodeSize();
    restore();
    rebuildDerived();
    render();
    detectServer();

    // installable app: register the service worker when served by the bridge
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* optional */ });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
