/* FANUC TP Program Studio — UI layer. */
(function () {
  'use strict';

  var P = window.FanucParser, A = window.FanucAnalyzer;
  var L = window.FanucLinter, FL = window.FanucFlow, VA = window.FanucVA, D = window.FanucDiff;
  var STORE_KEY_V1 = 'fanuc-tp-studio.programs.v1';
  var STORE_KEY = 'fanuc-tp-studio.programs.v2';

  var state = {
    programs: {},          // NAME -> { parsed, analysis, source, origin }
    selected: null,
    tab: 'code',
    editing: false,
    graph: null,
    xref: null,
    findings: [],
    server: false,         // bridge server reachable?
    robotImport: null,     // {total, done, added, skipped, failed, inFlight, cancel} while a bulk import runs
    robot: { ip: '', ftpUser: '', ftpPass: '', files: [], registers: null, rawIO: null, ioComments: null, error: null, loadedAt: null, backup: null, notPrograms: {}, prgState: undefined },
    knownRobots: [],       // saved robots, served by the bridge (never a password)
    robotProbe: {},        // ip -> 'checking' | 'up' | 'down'
    scan: null,            // subnet sweep in progress / its last result
    subnets: null,         // the bridge PC's own networks, for the default CIDR
    dirExtern: null,       // register/IO label data found in an opened folder
    dirStatus: null,
    compare: null,         // { label, programs: {NAME: source}, results, open: name|null }
    pair: null,            // { a, b } two-program comparison
    split: null,           // program name shown in the right half of the Code view
    upload: null,          // last robot-upload result banner
    flowIgnore: {},        // {NAME: true} utility programs hidden from Flow (persisted)
    hiddenRules: {},       // {rule: true} check rules the user muted (persisted)
    checksOpen: {},        // {rule: bool} transient expand state in the Checks tab
    xrefOpen: {},          // {itemKey: true} expanded items in Cross-reference
    xrefFilter: '',
    flowFocus: null,       // block idx isolated in the control-flow graph
    codeSize: 13,          // code font size in px (persisted)
    ignoreIoState: true,   // Compare: skip the controller's inline I/O state (persisted)
    ignoreLineNums: true   // Compare: skip the leading /MN line number (persisted)
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
      if (typeof p.ignoreLineNums === 'boolean') state.ignoreLineNums = p.ignoreLineNums;
    } catch (e) { /* defaults */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({
        flowIgnore: state.flowIgnore, hiddenRules: state.hiddenRules, codeSize: state.codeSize,
        ignoreIoState: state.ignoreIoState, ignoreLineNums: state.ignoreLineNums
      }));
    } catch (e) { /* session-only */ }
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.classList.remove('show'); }, 4000);
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

  // Controllers export logs (ERRALL.LS, HIST.LS, LOGBOOK.LS…) with a .ls
  // extension too — only files with a /PROG header are actual programs.
  function isProgramSource(src) { return /^\/PROG\b/m.test(src); }

  /* A controller's file list gives names only, so the /PROG test above needs
   * the file fetched first. These are the log exports by name, which lets the
   * Robot tab keep them out of the program list before anything is read. Any
   * other file that turns out to have no /PROG header is remembered in
   * state.robot.notPrograms once a fetch has proved it. */
  var LOG_EXPORT_RE = /^(ERR[A-Z]*|HIST|LOGBOOK)\.LS$/i;

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
    if (state.selected === name) state.selected = Object.keys(state.programs)[0] || null;
    rebuildDerived();
    persist();
    render();
  }

  function persist() {
    try {
      var out = {};
      Object.keys(state.programs).forEach(function (n) {
        out[n] = { source: state.programs[n].source, origin: state.programs[n].origin };
      });
      localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch (e) { /* storage unavailable — session-only mode */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) {
        // migrate v1 (plain name -> source strings)
        var v1 = localStorage.getItem(STORE_KEY_V1);
        if (v1) {
          var old = JSON.parse(v1);
          Object.keys(old).forEach(function (n) { addProgram(old[n], n + '.LS', { type: 'upload' }); });
          localStorage.removeItem(STORE_KEY_V1);
          persist();
        }
      } else {
        var data = JSON.parse(raw);
        Object.keys(data).forEach(function (n) { addProgram(data[n].source, n + '.LS', data[n].origin); });
      }
      state.selected = Object.keys(state.programs)[0] || null;
    } catch (e) { /* ignore corrupt store */ }
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
    files.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        var src = String(reader.result);
        if (isProgramSource(src)) {
          lastName = addProgram(src, f.name, { type: 'upload' });
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
        if (state.server) { loadKnownRobots(); loadSubnets(); }
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
    api('/api/net').then(function (b) {
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

  function connectRobot(ip) {
    state.robot = { ip: ip, ftpUser: state.robot.ftpUser, ftpPass: state.robot.ftpPass, files: [], registers: null, posregs: null, rawIO: null, ioState: null, ioComments: null, errors: undefined, error: null, loadedAt: null, backup: null, notPrograms: {}, prgState: undefined };
    state.tab = 'robot';
    render();
    api('/api/robot/list?ip=' + encodeURIComponent(ip) + ftpQS()).then(function (b) {
      state.robot.files = b.files;
      state.robot.loadedAt = new Date();
      render();
      rememberRobot(ip);   // only ever remember one that actually answered
      loadRobotRegisters();
      loadRobotPosregs();
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

  function takeBackup(mode) {
    state.robot.backup = { running: true, mode: mode };
    render();
    fetch('/api/robot/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: state.robot.ip, mode: mode, user: state.robot.ftpUser || undefined, pass: state.robot.ftpPass || undefined })
    }).then(function (r) { return r.json(); }).then(function (b) {
      if (b.error) throw new Error(b.error);
      state.robot.backup = b;
      render();
    }).catch(function (e) {
      state.robot.backup = { error: e.message };
      render();
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
      state.upload = b;
      onDone(b);
    }).catch(function (e) {
      state.upload = { ok: false, name: name + '.LS', error: e.message };
      onDone(state.upload);
    });
  }

  function uploadBanner() {
    var u = state.upload;
    if (!u) return null;
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
    return api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=' + encodeURIComponent(name) + ftpQS())
      .then(function (b) {
        if (!isProgramSource(b.content)) {
          // remember it so the program list stops offering this one
          state.robot.notPrograms[String(name).toUpperCase()] = true;
          // during a bulk import these are counted and summarised at the end
          if (!deferRebuild) toast(b.name + ' is a controller log export, not a TP program — skipped.');
          return null;
        }
        var prog = addProgram(b.content, b.name, { type: 'robot', ip: ip, name: b.name });
        /* A bulk import defers both: re-analysing the whole library and
         * rewriting localStorage per program is the bulk of the wall clock. */
        if (!deferRebuild) { rebuildDerived(); persist(); }
        return prog;
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
      lsFiles.forEach(function (f) {
        api('/api/dir/file?path=' + encodeURIComponent(f.path)).then(function (file) {
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

  function highlight(line) {
    if (line.comment !== null) {
      return '<span class="tok-cmt">! ' + esc(line.comment) + '</span>';
    }
    return tokenize(esc(line.text));
  }

  /* Colour the instruction text of one already-HTML-escaped TP line. */
  function tokenize(s) {
    s = s.replace(/(MESSAGE\[)([^\]]*)(\])/g, '<span class="tok-kw">$1</span><span class="tok-str">$2</span><span class="tok-kw">$3</span>');
    s = s.replace(/\bLBL\[[^\]]*\]/g, function (m0) { return '<span class="tok-lbl">' + m0 + '</span>'; });
    s = s.replace(/\b(CALL|RUN)\s+([A-Z_][A-Z0-9_]*)/g, function (_, kw, name) {
      return '<span class="tok-kw">' + kw + '</span> <span class="tok-call" data-call="' + name + '">' + name + '</span>';
    });
    s = s.replace(/\b(PR|AR|SR|GP\d+)\[[^\]]*\]/g, function (m0) { return '<span class="tok-reg">' + m0 + '</span>'; });
    s = s.replace(/(^|[^A-Z>])(R\[[^\]]*\])/g, function (_, pre, r) { return pre + '<span class="tok-reg">' + r + '</span>'; });
    s = s.replace(/\b(DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|AI|AO|WI|WO|F|M|TIMER)\[[^\]]*\]/g, function (m0) {
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
    var cm = m[2].match(/^(\s*)(!.*)$/);
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
    return { tab: state.tab, selected: state.selected, split: state.split };
  }

  function sameNav(a, b) {
    return a && b && a.tab === b.tab && a.selected === b.selected && a.split === b.split;
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
    if (state.editing) {
      if (!confirm('Leave the editor? Unsaved changes will be lost.')) {
        try { history.pushState(navSnapshot(), ''); } catch (err) { /* ignore */ }
        return;
      }
      state.editing = false;
    }
    state.tab = s.tab;
    if (s.selected && state.programs[s.selected]) state.selected = s.selected;
    state.split = (s.split && state.programs[s.split]) ? s.split : null;
    nav.restoring = true;
    render();
    nav.restoring = false;
  }

  /* ================= renderers ================= */

  function render() {
    recordNav();
    clearOccurrences(); // the DOM is rebuilt — stale highlight ranges go with it
    renderSidebar();
    renderConnect();
    renderTabs();
    renderPane();
  }

  /* Library filter: whitespace-separated words are ANDed, each matched as a
   * substring of "NAME comment", in any order — so "set task" finds both
   * _SET_TASK and _TASK_SETUP, and "pick pallet" finds PICK whether "pallet"
   * is in the name or only in its comment. */
  function libMatch(name, terms) {
    var hay = (name + ' ' + (state.programs[name].parsed.attrs.COMMENT || '')).toLowerCase();
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

  function renderSidebar() {
    var list = document.getElementById('prog-list');
    list.innerHTML = '';
    var all = Object.keys(state.programs).sort();
    var q = (document.getElementById('lib-filter').value || '').trim();
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    var names = !terms.length ? all : all.filter(function (n) { return libMatch(n, terms); });
    document.getElementById('lib-count').textContent =
      !all.length ? '' :
      terms.length ? names.length + ' of ' + all.length :
      all.length + ' program' + (all.length > 1 ? 's' : '');
    if (!all.length) {
      list.appendChild(h('div', { class: 'empty', text: 'No programs yet. Import .LS files or open a backup folder.' }));
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
      else if (p.parsed.attrs.COMMENT) meta += ' · ' + p.parsed.attrs.COMMENT;
      var item = h('button', {
        class: 'prog-item' + (n === state.selected ? ' active' : ''),
        draggable: 'true',
        title: 'Click to open · drag onto the code view to open side-by-side',
        onclick: function () { state.selected = n; state.editing = false; setNav(false); render(); }
      }, [
        h('div', { class: 'name', text: n }),
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
          h('p', { text: 'or use Import / Open folder above.' })
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

  function buildCodeBox(p) {
    var box = h('div', { class: 'codebox' });
    p.parsed.lines.forEach(function (line) {
      box.appendChild(h('div', { class: 'cline', 'data-line': line.num }, [
        h('span', { class: 'ln', text: line.num }),
        h('span', { class: 'src', html: (line.motion ? '<span class="tok-motion">' + line.motion + '</span> ' : '') + highlight(line) })
      ]));
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

  function renderSplit(pane) {
    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Side by side' }),
      h('span', { class: 'muted', text: 'drag a program from the library onto either half to view it there' }),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn subtle', text: 'Close split', onclick: function () { state.split = null; render(); } })
    ]));

    var wrap = h('div', { class: 'split-wrap' });
    [['left', state.selected], ['right', state.split]].forEach(function (side) {
      var name = side[1];
      var p = state.programs[name];
      var col = h('div', { class: 'code-pane ' + side[0], 'data-side': side[0] });
      col.appendChild(h('div', { class: 'pane-head' }, [
        progSelect(name, function (v) {
          if (side[0] === 'left') state.selected = v; else state.split = v;
          render();
        }),
        h('button', {
          class: 'btn subtle', text: 'Edit',
          onclick: function () { state.selected = name; state.split = null; state.editing = true; render(); }
        }),
        h('button', {
          class: 'btn subtle', text: 'Compare A↔B', title: 'Diff these two programs in the Compare tab',
          onclick: function () { state.pair = { a: state.selected, b: state.split }; state.tab = 'compare'; render(); }
        })
      ]));
      col.appendChild(p ? buildCodeBox(p) : h('p', { class: 'muted', text: 'no program' }));
      wrap.appendChild(col);
    });
    pane.appendChild(wrap);
  }

  function renderCode(pane) {
    var p = current();
    if (!p) return;

    if (state.editing) return renderEditor(pane, p);
    if (state.split && state.programs[state.split]) return renderSplit(pane);

    var progFindings = state.findings.filter(function (f) {
      return f.severity !== 'info' && f.refs.some(function (r) { return r.prog === p.parsed.name; });
    });

    var bar = h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: p.parsed.name }),
      p.parsed.attrs.COMMENT ? h('span', { class: 'muted', text: p.parsed.attrs.COMMENT }) : null,
      progFindings.length ? h('span', {
        class: 'badge warn', text: progFindings.length + ' issue' + (progFindings.length > 1 ? 's' : ''),
        style: 'cursor:pointer', title: 'Open the Checks tab',
        onclick: function () { state.tab = 'checks'; render(); }
      }) : null,
      h('span', { style: 'flex:1' }),
      codeSizeControl(),
      h('button', { class: 'btn', text: 'Edit', onclick: function () { state.editing = true; render(); } }),
      h('button', {
        class: 'btn', text: 'Side-by-side', title: 'Open a second program next to this one (or drag one from the library onto the right half)',
        onclick: function () { state.split = p.parsed.name; render(); }
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
    var banner = uploadBanner();
    if (banner) pane.appendChild(banner);
    pane.appendChild(buildCodeBox(p));
  }

  function renderEditor(pane, p) {
    var oldName = p.parsed.name;
    var status = h('span', { class: 'muted' });

    var ta = h('textarea', {
      class: 'editor', spellcheck: 'false', wrap: 'off',
      autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off'
    });
    ta.value = p.source;

    /* Syntax highlighting in a plain textarea: a <pre> holding the coloured
     * copy sits directly behind transparent text, with identical metrics, and
     * follows the textarea's scroll. Editing stays completely native. */
    var hl = h('pre', { class: 'editor-hl', 'aria-hidden': 'true' });
    var editorWrap = h('div', { class: 'editor-wrap' }, [hl, ta]);
    var repaintQueued = false;
    function paint() {
      // the trailing newline keeps the last line scrollable in step with the textarea
      hl.innerHTML = highlightSource(ta.value) + '\n';
      syncScroll();
    }
    function syncScroll() {
      hl.scrollTop = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
    }
    ta.addEventListener('input', function () {
      if (repaintQueued) return;
      repaintQueued = true;
      requestAnimationFrame(function () { repaintQueued = false; paint(); });
    });
    ta.addEventListener('scroll', syncScroll);
    paint();

    function save(alsoDisk) {
      var src = ta.value;
      var parsed = P.parseLS(src, oldName + '.LS');
      if (parsed.name !== oldName) delete state.programs[oldName];
      state.programs[parsed.name] = {
        parsed: parsed,
        analysis: A.analyzeProgram(parsed),
        source: src,
        origin: p.origin
      };
      state.selected = parsed.name;
      rebuildDerived();
      persist();
      if (alsoDisk && p.origin.type === 'dir' && state.server) {
        fetch('/api/dir/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p.origin.path, content: src })
        }).then(function (r) { return r.json(); }).then(function (b) {
          if (b.error) throw new Error(b.error);
          state.editing = false;
          render();
        }).catch(function (e) { status.textContent = 'Disk save failed: ' + e.message; });
        return;
      }
      state.editing = false;
      render();
    }

    function saveAndSend() {
      // save to library first so nothing is ever lost, then upload with the
      // snapshot/verify/restore safety net
      var src = ta.value;
      var parsed = P.parseLS(src, oldName + '.LS');
      if (parsed.name !== oldName) delete state.programs[oldName];
      state.programs[parsed.name] = { parsed: parsed, analysis: A.analyzeProgram(parsed), source: src, origin: p.origin };
      state.selected = parsed.name;
      rebuildDerived();
      persist();
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
        state.editing = !result.ok;
        render();
      });
    }

    var bar = h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Editing ' + oldName }),
      h('span', { class: 'muted', text: 'saving re-parses the program and re-runs every check — renaming /PROG renames it in the library' }),
      status,
      h('span', { style: 'flex:1' }),
      codeSizeControl(),
      h('button', { class: 'btn primary', text: 'Save to library', onclick: function () { save(false); } }),
      (p.origin.type === 'dir' && state.server)
        ? h('button', { class: 'btn', text: 'Save to library + disk', title: p.origin.path, onclick: function () { save(true); } })
        : null,
      (state.server && state.robot.ip)
        ? h('button', { class: 'btn', text: 'Save + send to robot', title: 'FTP to ' + state.robot.ip + ' with snapshot + verify + auto-restore', onclick: saveAndSend })
        : null,
      h('button', { class: 'btn subtle', text: 'Cancel', onclick: function () { state.editing = false; render(); } })
    ]);
    pane.appendChild(bar);
    var banner = uploadBanner();
    if (banner) pane.appendChild(banner);
    if (p.origin.type === 'robot' && !(state.server && state.robot.ip)) {
      pane.appendChild(h('p', { class: 'muted', text: 'This program was read from robot ' + p.origin.ip + '. Connect to the robot (Robot tab) to send edits back over FTP with the snapshot/auto-restore safety net.' }));
    }
    pane.appendChild(editorWrap);
    pane.classList.add('editing');
    ta.focus();
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

    var totalMoves = Object.keys(a.motions).reduce(function (s, k) { return s + a.motions[k]; }, 0);
    var cards = h('div', { class: 'cards' });
    [[parsed.lines.length, 'program lines'],
     [totalMoves, 'motion instructions'],
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
    if (a.uframes.length) facts.appendChild(h('li', { text: 'User frames selected: ' + uniq(a.uframes.map(function (u) { return u.num; })).join(', ') + '.' }));
    if (a.utools.length) facts.appendChild(h('li', { text: 'Tool frames selected: ' + uniq(a.utools.map(function (u) { return u.num; })).join(', ') + '.' }));
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

    if (parsed.errors.length) {
      sum.appendChild(h('h3', { text: 'Parser notes' }));
      parsed.errors.forEach(function (e) { sum.appendChild(h('p', { class: 'muted', text: e })); });
    }
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

    var comments = p.parsed.lines.filter(function (l) { return l.comment; }).slice(0, 3).map(function (l) { return l.comment; });
    if (comments.length) out.push('Programmer comments: ' + comments.join(' / '));
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

  /* Block to scroll back into view after the next render — isolating a block
   * rebuilds the pane, and losing your place in a long graph defeats the
   * point of isolating it. */
  var cfgScrollTo = null;
  var cfgFocusProg = null;

  function renderCfg(pane, p) {
    var flow = FL.buildFlow(p.parsed);
    // isolation belongs to one program's graph — switching or editing drops it
    if (cfgFocusProg !== p.parsed.name) { state.flowFocus = null; cfgFocusProg = p.parsed.name; }
    var focus = state.flowFocus;
    if (focus !== null && focus >= flow.blocks.length) focus = state.flowFocus = null;

    /* Isolation: the focused block plus every block an arrow runs to or from.
     * Everything else is dimmed, and so are the arrows that miss it. */
    var related = {};
    if (focus !== null) {
      related[focus] = true;
      flow.edges.forEach(function (e) {
        if (e.from === focus && e.to !== null) related[e.to] = true;
        if (e.to === focus) related[e.from] = true;
      });
    }

    var ctl = h('div', { class: 'flow-ctl' }, [
      h('p', {
        class: 'muted',
        text: focus === null
          ? 'Blocks run top to bottom. Curved arrows are jumps: amber going up = loop, blue going down = skip ahead; dashed = conditional (IF / timeout / skip). Click a block to isolate its jumps, ↗ to open it in the Code tab.'
          : 'Isolated ' + flow.blocks[focus].title + ' — only the arrows into and out of it are drawn, and the blocks they connect stay lit. Click the block again to bring the rest back.'
      }),
      focus === null ? null : h('button', {
        class: 'btn subtle', text: 'Show all',
        onclick: function () { cfgScrollTo = focus; state.flowFocus = null; render(); }
      })
    ]);
    pane.appendChild(ctl);

    var wrap = h('div', { class: 'flow-wrap' + (focus === null ? '' : ' isolated') });
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'flow-svg');
    wrap.appendChild(svg);
    var col = h('div', { class: 'flow-col' });

    flow.blocks.forEach(function (b) {
      var cls = 'flow-card ' + b.kind.replace(' ', '-');
      if (focus !== null) cls += b.idx === focus ? ' focus' : (related[b.idx] ? ' related' : ' dimmed');
      var card = h('div', {
        class: cls,
        'data-block': b.idx,
        title: b.idx === focus ? 'Click to show every block again' : 'Click to isolate this block’s jumps'
      });
      card.appendChild(h('div', { class: 'fc-head' }, [
        h('span', { class: 'fc-title', text: b.title }),
        h('span', { class: 'fc-range', text: 'lines ' + b.startNum + '–' + b.endNum }),
        h('span', { class: 'fc-spacer' }),
        h('button', {
          class: 'fc-goto', text: '↗',
          'aria-label': 'Go to code',
          title: 'Go to code — opens ' + p.parsed.name + ' at line ' + b.startNum,
          onclick: function (ev) { ev.stopPropagation(); gotoLine(p.parsed.name, b.startNum); }
        })
      ]));
      /* "How does it even reach this line" is the question a jump-heavy
       * program raises constantly, so every block says where control comes
       * from. Click a source to open that jump in the code. */
      if (b.inbound.length) {
        var inRow = h('div', { class: 'fc-in' });
        inRow.appendChild(h('span', { class: 'fc-in-label', text: 'from' }));
        b.inbound.forEach(function (e) {
          var src = flow.blocks[e.from];
          var atLine = e.kind === 'fall' ? (src ? src.endNum : b.startNum) : e.fromLine;
          inRow.appendChild(h('button', {
            class: 'fc-in-chip ' + e.kind,
            text: (e.kind === 'fall' ? '↓ ' : '↷ ') + atLine,
            title: (e.kind === 'fall' ? 'falls through from line ' + atLine
              : (e.kind === 'cond' ? 'conditional jump from line ' : 'jump from line ') + atLine) +
              (src ? ' · ' + src.title : '') + ' — click to open it in the code',
            onclick: function (ev) { ev.stopPropagation(); gotoLine(p.parsed.name, atLine); }
          }));
        });
        card.appendChild(inRow);
      }

      /* Every line, with its real number. This used to show three lines and
       * "… N more lines", which is no use when the point is to read the
       * program. Blank lines are dropped because they carry nothing, and the
       * numbers make the gap obvious anyway. */
      var body = h('div', { class: 'fc-body' });
      b.lines.forEach(function (l) {
        var cmt = l.comment !== null;
        if (!cmt && String(l.text).trim() === '') return;
        var row = h('div', { class: 'fc-line' + (cmt ? ' cmt' : ''), 'data-ln': String(l.num) });
        row.appendChild(h('span', { class: 'fc-ln', text: String(l.num) }));
        row.appendChild(h('span', { class: 'fc-src', text: (l.motion ? l.motion + ' ' : '') + l.text }));
        row.title = 'Line ' + l.num + ' — click to open it in the code';
        row.addEventListener('click', function (ev) {
          ev.stopPropagation();
          gotoLine(p.parsed.name, l.num);
        });
        body.appendChild(row);
      });
      card.appendChild(body);
      var visCalls = b.calls.filter(function (n) { return !state.flowIgnore[n]; });
      if (visCalls.length) {
        var cc = h('div', { class: 'fc-calls' });
        visCalls.forEach(function (name) {
          cc.appendChild(h('span', {
            class: 'chip read', text: '→ ' + name,
            title: state.programs[name] ? 'Open ' + name : name + ' is not in the library',
            onclick: state.programs[name]
              ? function (ev) { ev.stopPropagation(); state.selected = name; render(); }
              : null
          }));
        });
        card.appendChild(cc);
      }
      var missing = flow.edges.filter(function (e) { return e.from === b.idx && e.missing; });
      missing.forEach(function (e) {
        card.appendChild(h('div', { class: 'fc-missing', text: '⚠ jumps to ' + e.label + ' — label not defined' }));
      });
      card.addEventListener('click', function () {
        cfgScrollTo = b.idx;
        state.flowFocus = state.flowFocus === b.idx ? null : b.idx;
        render();
      });
      col.appendChild(card);
    });
    wrap.appendChild(col);
    pane.appendChild(wrap);

    requestAnimationFrame(function () {
      drawFlowEdges(wrap, svg, flow, focus);
      if (cfgScrollTo !== null) {
        var el = wrap.querySelector('.flow-card[data-block="' + cfgScrollTo + '"]');
        cfgScrollTo = null;
        if (el) el.scrollIntoView({ block: 'center' });
      }
    });
  }

  function drawFlowEdges(wrap, svg, flow, focus) {
    var cards = wrap.querySelectorAll('.flow-card');
    if (!cards.length) return;
    var W = wrap.clientWidth, Hh = wrap.scrollHeight;
    svg.setAttribute('width', W);
    svg.setAttribute('height', Hh);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
    var GUTTER = cards[0].offsetLeft;
    var ns = 'http://www.w3.org/2000/svg';

    var defs = document.createElementNS(ns, 'defs');
    [['arr-fall', 'var(--gutter)'], ['arr-fwd', 'var(--motion)'], ['arr-back', 'var(--accent)']].forEach(function (d) {
      var mk = document.createElementNS(ns, 'marker');
      mk.setAttribute('id', d[0]);
      mk.setAttribute('viewBox', '0 0 10 10');
      mk.setAttribute('refX', '9'); mk.setAttribute('refY', '5');
      mk.setAttribute('markerWidth', '7'); mk.setAttribute('markerHeight', '7');
      mk.setAttribute('orient', 'auto-start-reverse');
      var pth = document.createElementNS(ns, 'path');
      pth.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      pth.setAttribute('fill', d[1]);
      mk.appendChild(pth);
      defs.appendChild(mk);
    });
    svg.appendChild(defs);

    function cardBox(idx) {
      var c = cards[idx];
      return { top: c.offsetTop, bottom: c.offsetTop + c.offsetHeight };
    }
    function onFocus(e) {
      return focus !== null && (e.from === focus || e.to === focus);
    }

    // lane assignment for jump edges: longer spans further left. When a block
    // is isolated its own arrows take the innermost lanes, so the ones you
    // actually want to follow run closest to the blocks.
    var jumps = flow.edges.filter(function (e) { return e.kind !== 'fall' && e.to !== null; });
    jumps.sort(function (a, b) { return Math.abs(b.to - b.from) - Math.abs(a.to - a.from); });
    jumps.forEach(function (e, i) { e.lane = i % 6; });
    if (focus !== null) {
      var lit = jumps.filter(onFocus);
      lit.sort(function (a, b) { return Math.abs(a.to - a.from) - Math.abs(b.to - b.from); });
      lit.forEach(function (e, i) { e.lane = i % 6; });
    }

    // dimmed arrows first so the isolated ones are drawn over them
    var ordered = flow.edges.slice().sort(function (a, b) {
      return (onFocus(a) ? 1 : 0) - (onFocus(b) ? 1 : 0);
    });

    ordered.forEach(function (e) {
      if (e.to === null) return;
      var lit = focus === null || onFocus(e);
      var from = cardBox(e.from), to = cardBox(e.to);
      var path = document.createElementNS(ns, 'path');
      if (e.kind === 'fall') {
        var x = GUTTER + 30;
        path.setAttribute('d', 'M ' + x + ' ' + (from.bottom + 1) + ' L ' + x + ' ' + (to.top - 1));
        path.setAttribute('stroke', 'var(--gutter)');
        if (lit) path.setAttribute('marker-end', 'url(#arr-fall)');
      } else {
        var back = to.top < from.top;
        var y1 = from.bottom - 14;
        var y2 = back ? to.top + 8 : to.top + 8;
        var xr = GUTTER - 18 - e.lane * 20;
        path.setAttribute('d',
          'M ' + GUTTER + ' ' + y1 +
          ' C ' + xr + ' ' + y1 + ', ' + xr + ' ' + y2 + ', ' + GUTTER + ' ' + y2);
        path.setAttribute('stroke', back ? 'var(--accent)' : 'var(--motion)');
        if (lit) path.setAttribute('marker-end', back ? 'url(#arr-back)' : 'url(#arr-fwd)');
        if (e.kind === 'cond') path.setAttribute('stroke-dasharray', '5 4');
      }
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', lit && focus !== null ? '2.4' : '1.6');
      if (!lit) path.setAttribute('opacity', '0.12');
      svg.appendChild(path);
    });
  }

  /* ---- checks tab ---- */

  var SEV_LABEL = { error: 'Error', warn: 'Warning', info: 'Info' };
  var RULE_NAMES = {
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

  function renderChecks(pane) {
    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Program checks' }),
      h('span', { class: 'muted', text: 'grouped by check — collapse a group, or Hide it to mute that check everywhere' })
    ]));

    if (!Object.keys(state.programs).length) {
      pane.appendChild(h('p', { class: 'muted', text: 'Import programs first — checks run across everything in the library.' }));
      return;
    }

    var visible = visibleFindings();
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
      pane.appendChild(h('p', { text: hidden.length ? 'Nothing to show — every remaining check is clean.' : 'No issues found. Jumps all land on defined labels, every register and I/O point used has a label, and all called programs are present.' }));
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
          f.refs.slice(0, 12).forEach(function (r) { refs.appendChild(chip(r, f.severity === 'error' ? 'write' : 'read')); });
          if (f.refs.length > 12) refs.appendChild(h('span', { class: 'muted', text: ' +' + (f.refs.length - 12) + ' more' }));
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
        ['Registers R[n]' + (haveValues ? ' — all controller registers, with values' : ''), registerEntries()],
        ['Position registers PR[n]' + (havePRValues ? ' — with controller values' : ''), posregEntries()],
        ['I/O points', Object.keys(x.io).sort(function (a, b) {
          var ta = x.io[a], tb = x.io[b];
          return ta.type === tb.type ? ta.index - tb.index : ta.type.localeCompare(tb.type);
        }).map(function (k) { return { key: k, label: x.io[k].label, refs: x.io[k].refs }; })],
        ['Timers', entriesOf(x.timers, function (n) { return 'TIMER[' + n + ']'; })]
      ];
      sections.forEach(function (sec) {
        var entries = sec[1].filter(function (e) {
          if (!q) return true;
          return e.key.toLowerCase().indexOf(q) !== -1 ||
            (e.label || '').toLowerCase().indexOf(q) !== -1 ||
            (e.value !== undefined && String(e.value).indexOf(q) !== -1);
        });
        if (!entries.length) return;
        wrap.appendChild(h('h3', { text: sec[0] + ' (' + entries.length + ')' }));
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

  var searchOpts = { caseSensitive: false, wholeWord: false, regex: false };

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
      re = new RegExp('(?:^|[^A-Za-z])(' + type + '\\[\\s*' + item[2] + '\\s*' + comp + label + '\\])', flags);
      return function (text) {
        re.lastIndex = 0;
        var m = re.exec(text);
        return m ? { index: m.index + m[0].indexOf(m[1]), length: m[1].length } : null;
      };
    }
    if (searchOpts.regex) {
      try { re = new RegExp(q, flags); } catch (e) { return { error: 'Invalid regex: ' + e.message }; }
    } else {
      var escd = escapeRe(q);
      if (searchOpts.wholeWord) escd = '\\b' + escd + '\\b';
      re = new RegExp(escd, flags);
    }
    return function (text) {
      re.lastIndex = 0;
      var m = re.exec(text);
      return m ? { index: m.index, length: m[0].length || 1 } : null;
    };
  }

  function renderSearch(pane) {
    var bar = h('div', { class: 'search-bar' });
    var input = h('input', { type: 'search', placeholder: 'Find in all files… e.g. R[10], DO[104], CALL PICK, pallet' });
    input.value = state.searchQuery || '';
    bar.appendChild(input);
    [['caseSensitive', 'Aa', 'Match case'], ['wholeWord', '|w|', 'Whole word'], ['regex', '.*', 'Regular expression']].forEach(function (o) {
      bar.appendChild(h('button', {
        class: 'btn opt' + (searchOpts[o[0]] ? ' active' : ''),
        text: o[1], title: o[2],
        onclick: function () { searchOpts[o[0]] = !searchOpts[o[0]]; render(); }
      }));
    });
    pane.appendChild(bar);
    pane.appendChild(h('p', { class: 'muted', text: 'Tip: select any item in the code and press Ctrl+E to cross-reference it here. Clicking a register or I/O token in the Code view does the same.' }));
    var results = h('div');
    pane.appendChild(results);

    function run() {
      state.searchQuery = input.value;
      results.innerHTML = '';
      var q = input.value.trim();
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
          if (shown < 400) { hits.push({ line: line, full: full, m: m, commented: line.comment !== null }); shown++; }
        });
        if (!hits.length) return;
        results.appendChild(h('div', { class: 'hit-group' }, [
          h('span', { class: 'mono', text: n }),
          h('span', { class: 'muted', text: '  ' + hits.length + ' match' + (hits.length > 1 ? 'es' : '') })
        ]));
        hits.forEach(function (hh) {
          var hit = h('div', { class: 'hit' + (hh.commented ? ' commented' : '') });
          hit.appendChild(h('span', {
            class: 'where', text: n + ':' + hh.line.num,
            onclick: function () { gotoLine(n, hh.line.num); }
          }));
          var txt = h('span', { class: 'text' });
          txt.innerHTML = esc(hh.full.slice(0, hh.m.index)) + '<mark>' + esc(hh.full.substr(hh.m.index, hh.m.length)) + '</mark>' + esc(hh.full.slice(hh.m.index + hh.m.length));
          hit.appendChild(txt);
          if (hh.commented) hit.appendChild(h('span', { class: 'muted', text: 'comment' }));
          results.appendChild(hit);
        });
      });
      results.insertBefore(h('p', { class: 'muted', text: count ? count + ' match' + (count > 1 ? 'es' : '') + ' across the library' + (count > 400 ? ' (showing first 400)' : '') : 'No matches.' }), results.firstChild);
    }
    input.addEventListener('input', run);
    run();
    input.focus();
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
    if (!state.pair) state.pair = { a: state.selected || names[0], b: state.split || state.selected || names[0] };
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

  /* Robots this bridge has connected to before: click one to connect, with a
   * live dot from the short probe. The username comes back with the entry;
   * the password never does, so it is typed (or left blank) each time. */
  function savedRobots(ipIn, userIn) {
    var wrap = h('div', { class: 'saved-robots' });
    if (!state.knownRobots.length) {
      wrap.appendChild(h('p', { class: 'muted', text: 'Robots you connect to are saved here — this bridge remembers them for every device pointed at it (never the password).' }));
      return wrap;
    }
    var head = h('div', { class: 'sr-head' }, [
      h('span', { class: 'eyebrow', text: 'Saved robots' }),
      h('button', {
        class: 'btn subtle', text: '↻ re-check',
        title: 'Probe every saved robot again',
        onclick: function () { probeKnownRobots(); render(); }
      })
    ]);
    wrap.appendChild(head);
    state.knownRobots.forEach(function (r) {
      var st = state.robotProbe[r.ip] || 'checking';
      var row = h('div', { class: 'sr-row' + (r.ip === state.robot.ip ? ' current' : '') });
      row.appendChild(h('span', {
        class: 'sr-dot ' + st,
        title: st === 'up' ? 'answering on port 80' : st === 'down' ? 'not answering' : 'checking…'
      }));
      row.appendChild(h('button', {
        class: 'sr-name',
        text: r.name || r.ip,
        title: 'Connect to ' + r.ip,
        onclick: function () {
          ipIn.value = r.ip;
          if (r.ftpUser) { userIn.value = r.ftpUser; state.robot.ftpUser = r.ftpUser; }
          connectRobot(r.ip);
        }
      }));
      if (r.name) row.appendChild(h('span', { class: 'sr-ip mono', text: r.ip }));
      row.appendChild(h('span', { class: 'sr-seen', text: lastSeenText(r.lastSeen) }));
      row.appendChild(h('span', { style: 'flex:1' }));
      if (st === 'down') row.appendChild(h('span', { class: 'muted', text: 'not answering' }));
      row.appendChild(h('span', {
        class: 'seq-hide', text: '✕',
        title: 'Forget ' + (r.name || r.ip),
        onclick: function () { forgetRobot(r.ip); }
      }));
      wrap.appendChild(row);
    });
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
      box.appendChild(h('p', { class: 'muted', text: 'The bridge only ever READS from robots — programs, NUMREG.VA register values, I/O configuration. Writing to a controller is deliberately not supported.' }));
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
    pane.appendChild(savedRobots(ipIn, userIn));
    var banner = uploadBanner();
    if (banner) pane.appendChild(banner);

    if (state.robot.error) {
      pane.appendChild(h('p', {}, [h('span', { class: 'badge warn', text: 'connection failed' })]));
      pane.appendChild(h('p', { class: 'muted', text: state.robot.error + ' — check the IP, that the PC running the bridge is on the robot network, and that HTTP is enabled on the controller (Host Comm).' }));
      return;
    }
    if (!state.robot.ip) {
      pane.appendChild(h('p', { class: 'muted', text: 'Enter the controller IP. The bridge reads the program list, register values (NUMREG.VA) and I/O configuration from the robot — read-only.' }));
      return;
    }

    // program files — log exports carry a .LS extension too, and offering
    // them here only ever produced a chip that could not be imported
    var allLs = state.robot.files.filter(function (f) { return /\.LS$/i.test(f); });
    var lsFiles = allLs.filter(function (f) { return !isKnownNonProgram(f); });
    var logFiles = allLs.filter(isKnownNonProgram);
    var secProgs = secHead('Programs on ' + state.robot.ip + ' (' + lsFiles.length + ')', 'robot-programs');
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
      }
      pane.appendChild(actions);
      var fl = h('div', { class: 'robot-files' });
      lsFiles.forEach(function (f) {
        var name = f.replace(/\.LS$/i, '');
        var busy = imp && imp.inFlight[f.toUpperCase()];
        var here = !!state.programs[name];
        /* Three states, so a bulk import reads as motion rather than a wall
         * of red that turns green all at once when it finishes. */
        fl.appendChild(h('span', {
          class: 'chip ' + (busy ? 'loading' : here ? 'read' : 'write'),
          text: f + (busy ? ' …' : here ? ' ✓' : ''),
          title: busy ? 'reading from the controller…'
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
          text: 'Not listed (controller logs, not programs): ' + logFiles.join(', ') +
            '. The error history below reads ERRALL.LS directly.'
        }));
      }
    } else if (state.robot.loadedAt) {
      pane.appendChild(h('p', { class: 'muted', text: 'No .LS files listed. Some controllers need ASCII upload support for .LS on MD:. The file list found: ' + (state.robot.files.join(', ') || 'nothing') }));
    } else {
      pane.appendChild(h('p', { class: 'muted', text: 'Reading…' }));
    }

    // backup
    var secBk = secHead('Backups', 'robot-backups');
    pane.appendChild(secBk.el);
    var bk = state.robot.backup;
    var today = new Date().toISOString().slice(0, 10);
    if (secBk.open) {
    pane.appendChild(h('p', { class: 'muted', text: 'Saved to backups/<robot-name-or-ip>_' + today + '_NN on the bridge PC — NN increments automatically for multiple backups on the same day, and quick backups get a _quick suffix. The robot name is read from the controller when it answers over HTTP.' }));
    /* Both labels stay put while a backup runs and the buttons simply grey
     * out. Collapsing the quick-backup label to '…' left an unidentifiable
     * button on screen at exactly the moment someone would ask what it is,
     * and dropping the handler alone was not a disable — the button still
     * rendered enabled, took hover and focus, and swallowed the click. */
    var bkRunning = !!(bk && bk.running);
    var fullBtn = h('button', {
      class: 'btn primary', text: 'Full backup',
      title: 'Every file on MD:',
      onclick: function () { takeBackup('full'); }
    });
    var quickBtn = h('button', {
      class: 'btn', text: 'Quick backup (.LS + .VA)',
      title: 'Just programs and variable files — fast, ideal right before making changes',
      onclick: function () { takeBackup('quick'); }
    });
    fullBtn.disabled = bkRunning;
    quickBtn.disabled = bkRunning;
    var bkRow = h('p', {}, [fullBtn, document.createTextNode(' '), quickBtn]);
    if (bkRunning) {
      bkRow.appendChild(document.createTextNode(' '));
      bkRow.appendChild(h('span', {
        class: 'muted',
        text: (bk.mode === 'quick' ? 'Taking a quick backup…' : 'Taking a full backup… every file on MD: can take a minute.')
      }));
    }
    pane.appendChild(bkRow);
    if (bk && bk.error) pane.appendChild(h('p', {}, [h('span', { class: 'badge warn', text: 'backup failed' }), h('span', { class: 'muted', text: ' ' + bk.error })]));
    if (bk && bk.ok) {
      pane.appendChild(h('p', {}, [
        h('span', { class: 'badge ok', text: (bk.mode === 'quick' ? 'quick ' : '') + 'backup complete' }),
        h('span', { text: ' ' + bk.files + ' files (' + (bk.bytes / 1024).toFixed(0) + ' KB) → ' }),
        h('span', { class: 'mono', text: bk.folder })
      ]));
      if (bk.failed && bk.failed.length) pane.appendChild(h('p', { class: 'muted', text: 'Could not read: ' + bk.failed.join(', ') }));
      pane.appendChild(h('p', { class: 'muted', text: 'To diff a robot against this backup later: Compare tab → load this folder as the baseline.' }));
    }
    } // end backups section

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
      'robot-prgstate');
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
    var secPen = secHead('Live pendant (iPendant)', 'robot-pendant');
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
    var secErr = secHead('Error history (ERRALL.LS)' + (errsOk ? ' — ' + errsOk.length + (actCount ? ' · ' + actCount + ' active' : '') : ''), 'robot-errors');
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
    var secRegs = secHead('Registers (NUMREG.VA)' + (regs && !regs.error ? ' — ' + regs.length : ''), 'robot-regs');
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
            h('td', { text: r.comment }),
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
    var prsOk = prs && !prs.error ? prs.filter(function (r) { return r.rep !== 'uninitialized' || r.comment; }) : null;
    var secPR = secHead('Position registers (POSREG.VA)' + (prsOk ? ' — ' + prsOk.length : ''), 'robot-posregs');
    pane.appendChild(secPR.el);
    if (secPR.open) {
      pane.appendChild(h('p', {}, [h('button', { class: 'btn subtle', text: 'Refresh from robot', onclick: loadRobotPosregs })]));
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
              h('td', { text: r.comment }),
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
        pane.appendChild(h('p', { class: 'muted', text: 'Uninitialized, uncommented PRs are hidden. Cartesian values are mm/deg; joint values are axis degrees.' }));
      }
    }

    // I/O — live state from IOSTATE.DG, grouped by type
    var secIO = secHead('Live I/O (IOSTATE.DG)' + (state.robot.ioState ? ' — ' + state.robot.ioState.length + ' points' : ''), 'robot-io');
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
          h('td', { text: p.comment }),
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
      if (e.key === 'Escape' && navOpen()) {
        setNav(false);
        var nb = document.getElementById('btn-nav');
        if (nb) nb.focus();
      }
    });


    document.getElementById('btn-nav').addEventListener('click', function () { setNav(!navOpen()); });
    document.getElementById('nav-scrim').addEventListener('click', function () { setNav(false); });
    document.getElementById('btn-import').addEventListener('click', function () {
      document.getElementById('file-input').click();
    });
    document.getElementById('btn-folder').addEventListener('click', function () {
      document.getElementById('folder-input').click();
    });
    document.getElementById('lib-filter').addEventListener('input', renderSidebar);
    document.getElementById('btn-clear').addEventListener('click', function () {
      if (!Object.keys(state.programs).length) return;
      if (!confirm('Remove all programs from the library? Your original files are untouched.')) return;
      state.programs = {};
      state.selected = null;
      rebuildDerived();
      persist();
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
      if (progName && state.programs[progName]) {
        // Notepad++-style: drop a program onto the code view — right half opens
        // it side-by-side, left half (or no split yet, left third) replaces the view
        var paneEl = document.getElementById('pane');
        var r = paneEl.getBoundingClientRect();
        var rightHalf = e.clientX > r.left + r.width / 2;
        state.tab = 'code';
        state.editing = false;
        if (rightHalf) state.split = progName;
        else state.selected = progName;
        render();
        return;
      }
      if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
    });

    var buildTag = document.getElementById('build-tag');
    if (buildTag && window.FANUC_STUDIO_BUILD) buildTag.textContent = window.FANUC_STUDIO_BUILD;

    loadPrefs();
    paintCodeSize();
    restore();
    rebuildDerived();
    render();
    detectServer();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
