/* FANUC TP Program Studio — UI layer. */
(function () {
  'use strict';

  var P = window.FanucParser, A = window.FanucAnalyzer, X = window.FanucExplain;
  var L = window.FanucLinter, FL = window.FanucFlow, VA = window.FanucVA, D = window.FanucDiff;
  var STORE_KEY_V1 = 'fanuc-tp-studio.programs.v1';
  var STORE_KEY = 'fanuc-tp-studio.programs.v2';

  var state = {
    programs: {},          // NAME -> { parsed, analysis, source, origin }
    selected: null,
    tab: 'code',
    explain: false,
    editing: false,
    graph: null,
    xref: null,
    findings: [],
    server: false,         // bridge server reachable?
    robot: { ip: '', ftpUser: '', ftpPass: '', files: [], registers: null, rawIO: null, ioComments: null, error: null, loadedAt: null, backup: null },
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
    xrefFilter: ''
  };

  var PREFS_KEY = 'fanuc-tp-studio.prefs.v1';

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      state.flowIgnore = p.flowIgnore || {};
      state.hiddenRules = p.hiddenRules || {};
    } catch (e) { /* defaults */ }
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ flowIgnore: state.flowIgnore, hiddenRules: state.hiddenRules }));
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
    var regs = null, io = null, source = null;
    if (state.robot.registers && !state.robot.registers.error) {
      regs = state.robot.registers;
      source = 'robot ' + state.robot.ip;
    }
    if (state.robot.ioComments) { io = state.robot.ioComments; source = 'robot ' + state.robot.ip; }
    if (!regs && state.dirExtern && state.dirExtern.registers) { regs = state.dirExtern.registers; source = state.dirExtern.source; }
    if (!io && state.dirExtern && state.dirExtern.io) { io = state.dirExtern.io; source = source || state.dirExtern.source; }
    if (!regs && !io) return null;
    return { registers: regs || [], io: io || [], source: source };
  }

  function rebuildDerived() {
    state.graph = A.buildCallGraph(state.programs);
    state.xref = A.buildGlobalXref(state.programs);
    state.extern = buildExtern();
    state.findings = L.lint(state.programs, state.graph, state.xref, state.extern, { passThroughCalls: state.flowIgnore });
  }

  // Controllers export logs (ERRALL.LS, HIST.LS, LOGBOOK.LS…) with a .ls
  // extension too — only files with a /PROG header are actual programs.
  function isProgramSource(src) { return /^\/PROG\b/m.test(src); }

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

  function loadSamples() {
    if (!window.FANUC_SAMPLES) return;
    var last = null;
    Object.keys(window.FANUC_SAMPLES).forEach(function (n) {
      last = addProgram(window.FANUC_SAMPLES[n], n + '.LS', { type: 'sample' });
    });
    state.selected = state.programs.MAIN ? 'MAIN' : last;
    rebuildDerived();
    persist();
    render();
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

  function detectServer() {
    if (location.protocol === 'file:') { state.server = false; renderConnect(); return; }
    fetch('/api/ping').then(function (r) { return r.json(); })
      .then(function (b) { state.server = !!(b && b.ok); renderConnect(); })
      .catch(function () { state.server = false; renderConnect(); });
  }

  function ftpQS() {
    var s = '';
    if (state.robot.ftpUser) s += '&user=' + encodeURIComponent(state.robot.ftpUser);
    if (state.robot.ftpPass) s += '&pass=' + encodeURIComponent(state.robot.ftpPass);
    return s;
  }

  function connectRobot(ip) {
    state.robot = { ip: ip, ftpUser: state.robot.ftpUser, ftpPass: state.robot.ftpPass, files: [], registers: null, rawIO: null, ioState: null, ioComments: null, error: null, loadedAt: null, backup: null };
    state.tab = 'robot';
    render();
    api('/api/robot/list?ip=' + encodeURIComponent(ip) + ftpQS()).then(function (b) {
      state.robot.files = b.files;
      state.robot.loadedAt = new Date();
      render();
      loadRobotRegisters();
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
    state.robot.backup = { running: true };
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

  function importFromRobot(name) {
    var ip = state.robot.ip;
    return api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=' + encodeURIComponent(name) + ftpQS())
      .then(function (b) {
        var prog = addProgram(b.content, b.name, { type: 'robot', ip: ip, name: b.name });
        rebuildDerived();
        persist();
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
      var extern = { source: 'backup ' + b.path, registers: null, io: null };
      var externLoads = [];
      if (numreg) externLoads.push(api('/api/dir/file?path=' + encodeURIComponent(numreg.path)).then(function (f) {
        extern.registers = VA.parseNumreg(f.content);
      }).catch(function () {}));
      if (iostate) externLoads.push(api('/api/dir/file?path=' + encodeURIComponent(iostate.path)).then(function (f) {
        extern.io = VA.parseIOState(f.content).filter(function (p) { return p.comment; });
      }).catch(function () {}));
      else if (iocfg) externLoads.push(api('/api/dir/file?path=' + encodeURIComponent(iocfg.path)).then(function (f) {
        extern.io = VA.parseIOComments(f.content);
      }).catch(function () {}));
      Promise.all(externLoads).then(function () {
        if (extern.registers || extern.io) { state.dirExtern = extern; rebuildDerived(); render(); }
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
    var s = esc(line.text);
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
      if (tokEl) {
        var m = tokEl.textContent.match(/^(R|PR|AR|SR|DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|AI|AO|F|M|TIMER|LBL)\[(\d+)/);
        // component references (PR[20,1]) count as uses of the same item
        if (m) itemRe = new RegExp('\\b' + m[1] + '\\[' + m[2] + '(?:\\s*,\\s*\\d+)?(?::[^\\]]*)?\\]', 'g');
      }
    } else {
      text = '';
    }
    var key = itemRe ? 'item:' + itemRe.source : (text ? 'text:' + text : null);
    if (key === occLast) return;
    occLast = key;
    CSS.highlights.delete('tp-occ');
    if (!key) return;

    var ranges = [];
    document.querySelectorAll('#pane .codebox .src').forEach(function (srcEl) {
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

  function renderSidebar() {
    var list = document.getElementById('prog-list');
    list.innerHTML = '';
    var all = Object.keys(state.programs).sort();
    var q = (document.getElementById('lib-filter').value || '').trim().toLowerCase();
    var names = !q ? all : all.filter(function (n) {
      var p = state.programs[n];
      return n.toLowerCase().indexOf(q) !== -1 ||
        (p.parsed.attrs.COMMENT || '').toLowerCase().indexOf(q) !== -1;
    });
    document.getElementById('lib-count').textContent =
      !all.length ? '' :
      q ? names.length + ' of ' + all.length :
      all.length + ' program' + (all.length > 1 ? 's' : '');
    if (!all.length) {
      list.appendChild(h('div', { class: 'empty', text: 'No programs yet. Import .LS files or load the sample cell.' }));
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
        onclick: function () { state.selected = n; state.editing = false; render(); }
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

  function renderConnect() {
    var hint = document.getElementById('server-hint');
    var robotRow = document.getElementById('robot-row');
    var dirRow = document.getElementById('dir-row');
    if (!hint) return;
    if (state.server) {
      robotRow.style.display = '';
      dirRow.style.display = '';
      hint.innerHTML = '<span class="badge ok">bridge on</span> ' + (state.dirStatus ? esc(state.dirStatus) : 'Robot + folder access ready.');
    } else {
      robotRow.style.display = 'none';
      dirRow.style.display = 'none';
      hint.innerHTML = 'Robot &amp; folder-path access need the bridge:<br><code>node server.js</code> then open <code>http://localhost:8642</code>. The Robot tab has details.';
    }
  }

  var TABS = [
    ['code', 'Code'],
    ['summary', 'Summary'],
    ['flow', 'Flow'],
    ['checks', 'Checks'],
    ['compare', 'Compare'],
    ['positions', 'Positions'],
    ['xref', 'Cross-reference'],
    ['search', 'Search'],
    ['robot', 'Robot']
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
    pane.innerHTML = '';
    var needsProgram = ['code', 'summary', 'flow', 'positions'].indexOf(state.tab) !== -1;
    if (!Object.keys(state.programs).length && needsProgram) {
      pane.appendChild(h('div', { class: 'placeholder' }, [
        h('h2', { text: 'FANUC TP Program Studio' }),
        h('p', { text: 'View, edit, check, and understand FANUC teach pendant programs. Import ASCII listing files (.LS), open a backup folder, or connect to a robot by IP (Robot tab).' }),
        h('div', { class: 'drop-hint' }, [
          h('p', { text: 'Drag .LS files anywhere in this window,' }),
          h('p', { text: 'or use Import / Open folder / Load sample cell above.' })
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
      if (state.explain) {
        box.appendChild(h('div', { class: 'explain-row' }, [
          h('span', { class: 'ln' }),
          h('span', { class: 'note', text: '↳ ' + X.explainLine(line) })
        ]));
      }
    });
    box.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.classList.contains('tok-call')) {
        var name = t.getAttribute('data-call').toUpperCase();
        if (state.programs[name]) { state.selected = name; render(); }
        return;
      }
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
    var explain = (function () {
      var cb = h('input', { type: 'checkbox' });
      cb.checked = state.explain;
      cb.addEventListener('change', function () { state.explain = cb.checked; render(); });
      var lab = h('label', {}, [cb]);
      lab.appendChild(document.createTextNode(' Explain every line'));
      return lab;
    })();
    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Side by side' }),
      h('span', { class: 'muted', text: 'drag a program from the library onto either half to view it there' }),
      h('span', { style: 'flex:1' }),
      explain,
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
      (function () {
        var cb = h('input', { type: 'checkbox' });
        cb.checked = state.explain;
        cb.addEventListener('change', function () { state.explain = cb.checked; render(); });
        var lab = h('label', {}, [cb]);
        lab.appendChild(document.createTextNode(' Explain every line'));
        return lab;
      })(),
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

    var ta = h('textarea', { class: 'editor', spellcheck: 'false' });
    ta.value = p.source;

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
      status,
      h('span', { style: 'flex:1' }),
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
    pane.appendChild(ta);
    pane.appendChild(h('p', { class: 'muted', text: 'Saving re-parses the program, refreshes every view, and re-runs the checks. If you change the /PROG name the program is renamed in the library.' }));
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
    var g = state.graph;

    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Program flow' })
    ]));

    // -- call order --
    var rootNames = A.roots(g);
    if (!rootNames.length) rootNames = Object.keys(state.programs);
    var flowWrap = h('div', { class: 'graph' });
    var secCall = secHead('Call order — the sequence programs run in', 'flow-callorder');
    flowWrap.appendChild(secCall.el);
    if (!secCall.open) {
      pane.appendChild(flowWrap);
      var secCfg0 = secHead('Control flow inside ' + p.parsed.name, 'flow-cfg');
      pane.appendChild(secCfg0.el);
      if (secCfg0.open) renderCfg(pane, p);
      return;
    }
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
        var el = h('div', { class: 'seq-row', style: 'padding-left:' + (row.depth * 26) + 'px' });
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

    // -- control-flow graph of the selected program --
    var secCfg = secHead('Control flow inside ' + p.parsed.name, 'flow-cfg');
    pane.appendChild(secCfg.el);
    if (secCfg.open) renderCfg(pane, p);
  }

  function renderCfg(pane, p) {
    pane.appendChild(h('p', { class: 'muted', text: 'Blocks run top to bottom. Curved arrows are jumps: amber going up = loop, blue going down = skip ahead; dashed = conditional (IF / timeout / skip).' }));

    var flow = FL.buildFlow(p.parsed);
    var wrap = h('div', { class: 'flow-wrap' });
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'flow-svg');
    wrap.appendChild(svg);
    var col = h('div', { class: 'flow-col' });

    flow.blocks.forEach(function (b) {
      var card = h('div', { class: 'flow-card ' + b.kind.replace(' ', '-'), 'data-block': b.idx });
      card.appendChild(h('div', { class: 'fc-head' }, [
        h('span', { class: 'fc-title', text: b.title }),
        h('span', { class: 'fc-range', text: b.kind === 'normal' ? '' : 'lines ' + b.startNum + '–' + b.endNum })
      ]));
      var body = h('div', { class: 'fc-body' });
      b.preview.forEach(function (t) {
        body.appendChild(h('div', { class: 'fc-line', text: t.length > 64 ? t.slice(0, 62) + '…' : t }));
      });
      var extra = b.lines.filter(function (l) { return l.comment === null; }).length - b.preview.length;
      if (extra > 0) body.appendChild(h('div', { class: 'fc-line muted', text: '… ' + extra + ' more line' + (extra > 1 ? 's' : '') }));
      card.appendChild(body);
      var visCalls = b.calls.filter(function (n) { return !state.flowIgnore[n]; });
      if (visCalls.length) {
        var cc = h('div', { class: 'fc-calls' });
        visCalls.forEach(function (name) {
          cc.appendChild(h('span', {
            class: 'chip read', text: '→ ' + name,
            onclick: state.programs[name] ? function () { state.selected = name; render(); } : null
          }));
        });
        card.appendChild(cc);
      }
      var missing = flow.edges.filter(function (e) { return e.from === b.idx && e.missing; });
      missing.forEach(function (e) {
        card.appendChild(h('div', { class: 'fc-missing', text: '⚠ jumps to ' + e.label + ' — label not defined' }));
      });
      card.addEventListener('click', function () { gotoLine(p.parsed.name, b.startNum); });
      col.appendChild(card);
    });
    wrap.appendChild(col);
    pane.appendChild(wrap);

    requestAnimationFrame(function () { drawFlowEdges(wrap, svg, flow); });
  }

  function drawFlowEdges(wrap, svg, flow) {
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

    // lane assignment for jump edges: longer spans further left
    var jumps = flow.edges.filter(function (e) { return e.kind !== 'fall' && e.to !== null; });
    jumps.sort(function (a, b) { return Math.abs(b.to - b.from) - Math.abs(a.to - a.from); });
    jumps.forEach(function (e, i) { e.lane = i % 6; });

    flow.edges.forEach(function (e) {
      if (e.to === null) return;
      var from = cardBox(e.from), to = cardBox(e.to);
      var path = document.createElementNS(ns, 'path');
      if (e.kind === 'fall') {
        var x = GUTTER + 30;
        path.setAttribute('d', 'M ' + x + ' ' + (from.bottom + 1) + ' L ' + x + ' ' + (to.top - 1));
        path.setAttribute('stroke', 'var(--gutter)');
        path.setAttribute('marker-end', 'url(#arr-fall)');
      } else {
        var back = to.top < from.top;
        var y1 = from.bottom - 14;
        var y2 = back ? to.top + 8 : to.top + 8;
        var xr = GUTTER - 18 - e.lane * 20;
        path.setAttribute('d',
          'M ' + GUTTER + ' ' + y1 +
          ' C ' + xr + ' ' + y1 + ', ' + xr + ' ' + y2 + ', ' + GUTTER + ' ' + y2);
        path.setAttribute('stroke', back ? 'var(--accent)' : 'var(--motion)');
        path.setAttribute('marker-end', back ? 'url(#arr-back)' : 'url(#arr-fwd)');
        if (e.kind === 'cond') path.setAttribute('stroke-dasharray', '5 4');
      }
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '1.6');
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

    function draw() {
      state.xrefFilter = fIn.value;
      var q = fIn.value.trim().toLowerCase();
      wrap.innerHTML = '';
      var haveValues = !!(state.extern && state.extern.registers && state.extern.registers.length);
      var sections = [
        ['Registers R[n]' + (haveValues ? ' — all controller registers, with values' : ''), registerEntries()],
        ['Position registers PR[n]', entriesOf(x.posRegs, function (n) { return 'PR[' + n + ']'; })],
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
   * A bare item like "R[10]" or "DO[104]" also matches its labeled form
   * ("R[10:pallet slot]"), which is how the code actually reads. */
  function buildMatcher(q) {
    var flags = searchOpts.caseSensitive ? 'g' : 'gi';
    var re = null;
    var item = q.match(/^(R|PR|DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|AI|AO|F|M|TIMER|LBL|AR)\[(\d+)\]$/i);
    if (item && !searchOpts.regex) {
      var type = item[1].toUpperCase();
      var guard = type === 'R' ? '(?:^|[^A-Z])' : '\\b';
      re = new RegExp(guard + '(' + type + '\\[' + item[2] + '(?::[^\\]]*)?\\])', 'g');
      return function (text) {
        re.lastIndex = 0;
        var m = re.exec(text);
        return m ? { index: m.index + m[0].indexOf(m[1]), length: m[1].length } : null;
      };
    }
    if (searchOpts.regex) {
      try { re = new RegExp(q, flags); } catch (e) { return { error: 'Invalid regex: ' + e.message }; }
    } else {
      var escd = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  function setBaseline(label, programs) {
    state.compare = {
      label: label,
      programs: programs,
      results: D.comparePrograms(programs, librarySources()),
      open: null
    };
    render();
  }

  function renderCompare(pane) {
    // -- two-program compare (Notepad++ Compare-plugin style) --
    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Compare two programs' })
    ]));
    var names = Object.keys(state.programs).sort();
    if (names.length >= 1) {
      if (!state.pair) state.pair = { a: state.selected || names[0], b: state.split || state.selected || names[0] };
      var row = h('div', { class: 'search-bar' });
      row.appendChild(progSelect(state.pair.a, function (v) { state.pair.a = v; render(); }));
      row.appendChild(h('span', { class: 'muted', text: 'vs' }));
      row.appendChild(progSelect(state.pair.b, function (v) { state.pair.b = v; render(); }));
      row.appendChild(h('button', { class: 'btn subtle', text: '⇄ swap', onclick: function () { state.pair = { a: state.pair.b, b: state.pair.a }; render(); } }));
      pane.appendChild(row);
      var pa = state.programs[state.pair.a], pb = state.programs[state.pair.b];
      if (pa && pb) {
        if (state.pair.a === state.pair.b) {
          pane.appendChild(h('p', { class: 'muted', text: 'Same program on both sides — pick two different programs (or two revisions imported under different names).' }));
        } else {
          pane.appendChild(renderDiffBody(pa.source, pb.source, true, state.pair.a, state.pair.b));
        }
      }
    } else {
      pane.appendChild(h('p', { class: 'muted', text: 'Import programs first.' }));
    }

    pane.appendChild(h('div', { class: 'code-toolbar', style: 'margin-top:18px' }, [
      h('span', { class: 'title', text: 'Compare against a backup' }),
      h('span', { class: 'muted', text: 'see everything that changed on the robot since a backup was taken' })
    ]));

    var src = h('div', { class: 'search-bar', style: 'flex-wrap:wrap' });
    src.appendChild(h('button', {
      class: 'btn', text: 'Pick backup .LS files…',
      onclick: function () { document.getElementById('compare-input').click(); }
    }));
    if (state.server) {
      var dirIn = h('input', { type: 'text', placeholder: 'or backup folder path on this PC' });
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
      pane.appendChild(h('p', { class: 'muted', text: 'Load a baseline — the .LS files from an old backup — and it is compared program-by-program against your current library' + (state.server ? ' (import the robot’s current programs from the Robot tab first to diff robot vs backup)' : '') + '. Header-only differences (dates, sizes) are separated from real code changes.' }));
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
      pane.appendChild(h('h3', { text: 'Changed programs — click to see the diff' }));
      r.changed.forEach(function (ch) {
        var isOpen = c.open === ch.name;
        pane.appendChild(h('div', { class: 'diff-head' + (isOpen ? ' open' : ''), onclick: function () { c.open = isOpen ? null : ch.name; render(); } }, [
          h('span', { class: 'mono', text: (isOpen ? '▾ ' : '▸ ') + ch.name }),
          h('span', { class: 'diff-adds', text: '+' + ch.adds }),
          h('span', { class: 'diff-dels', text: '−' + ch.dels })
        ]));
        if (isOpen) pane.appendChild(renderDiffBody(c.programs[ch.name], state.programs[ch.name].source, false, ch.name + ' — backup', ch.name + ' — current'));
      });
    }
    progList('New since the baseline', r.added, 'added');
    progList('In the baseline but missing now', r.removed, 'removed');
    progList('Header-only changes (dates / sizes — code identical)', r.headerOnly, 'header');
  }

  /* Side-by-side diff: baseline/A on the left, current/B on the right. */
  function renderDiffBody(baselineSrc, currentSrc, fullSource, aLabel, bLabel) {
    var ops = fullSource
      ? D.diffLines(baselineSrc, currentSrc)
      : D.diffLines(D.bodyOf(baselineSrc), D.bodyOf(currentSrc));
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

    // program files
    var lsFiles = state.robot.files.filter(function (f) { return /\.LS$/i.test(f); });
    var secProgs = secHead('Programs on ' + state.robot.ip + ' (' + lsFiles.length + ')', 'robot-programs');
    pane.appendChild(secProgs.el);
    if (!secProgs.open) { /* collapsed */ } else if (lsFiles.length) {
      var actions = h('p', {}, [
        h('button', {
          class: 'btn', text: 'Import all ' + lsFiles.length + ' programs',
          onclick: function () {
            if (!confirmCrossSource(lsFiles)) return;
            var pending = lsFiles.length;
            lsFiles.forEach(function (f) {
              importFromRobot(f).catch(function () {}).then(function () { if (--pending === 0) render(); });
            });
          }
        })
      ]);
      pane.appendChild(actions);
      var fl = h('div', { class: 'robot-files' });
      lsFiles.forEach(function (f) {
        var name = f.replace(/\.LS$/i, '');
        fl.appendChild(h('span', {
          class: 'chip ' + (state.programs[name] ? 'read' : 'write'),
          text: f + (state.programs[name] ? ' ✓' : ''),
          title: state.programs[name] ? 'in library — click to re-import' : 'click to import',
          onclick: function () {
            if (!confirmCrossSource([f])) return;
            importFromRobot(f).then(function (n) { state.selected = n; render(); });
          }
        }));
      });
      pane.appendChild(fl);
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
    pane.appendChild(h('p', {}, [
      h('button', {
        class: 'btn primary', text: (bk && bk.running) ? 'Backing up…' : 'Full backup',
        title: 'Every file on MD:',
        onclick: (bk && bk.running) ? null : function () { takeBackup('full'); }
      }),
      document.createTextNode(' '),
      h('button', {
        class: 'btn', text: (bk && bk.running) ? '…' : 'Quick backup (.LS + .VA)',
        title: 'Just programs and variable files — fast, ideal right before making changes',
        onclick: (bk && bk.running) ? null : function () { takeBackup('quick'); }
      })
    ]));
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
    document.getElementById('compare-input').addEventListener('change', function (ev) {
      var files = Array.prototype.slice.call(ev.target.files).filter(function (f) { return /\.ls$/i.test(f.name); });
      ev.target.value = '';
      if (!files.length) return;
      var set = {}, pending = files.length;
      files.forEach(function (f) {
        var reader = new FileReader();
        reader.onload = function () {
          var src = String(reader.result);
          set[P.parseLS(src, f.name).name] = src;
          if (--pending === 0) setBaseline('backup files (' + files.length + ')', set);
        };
        reader.readAsText(f);
      });
    });

    window.addEventListener('popstate', onPopState);

    // Ctrl+E: cross-reference the selection (Studio 5000 habit)
    window.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        crossRefToken(selectedText());
      }
    });
    document.getElementById('btn-import').addEventListener('click', function () {
      document.getElementById('file-input').click();
    });
    document.getElementById('btn-folder').addEventListener('click', function () {
      document.getElementById('folder-input').click();
    });
    document.getElementById('btn-samples').addEventListener('click', loadSamples);
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
    document.getElementById('btn-robot').addEventListener('click', function () {
      var ip = document.getElementById('robot-ip').value.trim();
      if (ip) connectRobot(ip);
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
    restore();
    rebuildDerived();
    render();
    detectServer();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
