/* FANUC TP Program Studio — UI layer. */
(function () {
  'use strict';

  var P = window.FanucParser, A = window.FanucAnalyzer, X = window.FanucExplain;
  var L = window.FanucLinter, FL = window.FanucFlow, VA = window.FanucVA;
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
    robot: { ip: '', files: [], registers: null, rawIO: null, error: null, loadedAt: null },
    dirStatus: null
  };

  /* ================= library ================= */

  function rebuildDerived() {
    state.graph = A.buildCallGraph(state.programs);
    state.xref = A.buildGlobalXref(state.programs);
    state.findings = L.lint(state.programs, state.graph, state.xref);
  }

  function addProgram(source, filename, origin) {
    var parsed = P.parseLS(source, filename);
    state.programs[parsed.name] = {
      parsed: parsed,
      analysis: A.analyzeProgram(parsed),
      source: source,
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
    var files = Array.prototype.slice.call(fileList).filter(function (f) {
      return /\.(ls|txt)$/i.test(f.name) || fileList.length === 1;
    });
    var pending = files.length;
    if (!pending) return;
    var lastName = null;
    files.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        lastName = addProgram(String(reader.result), f.name, { type: 'upload' });
        if (--pending === 0) {
          state.selected = lastName;
          rebuildDerived();
          persist();
          render();
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
    });
  }

  function detectServer() {
    if (location.protocol === 'file:') { state.server = false; renderConnect(); return; }
    fetch('/api/ping').then(function (r) { return r.json(); })
      .then(function (b) { state.server = !!(b && b.ok); renderConnect(); })
      .catch(function () { state.server = false; renderConnect(); });
  }

  function connectRobot(ip) {
    state.robot = { ip: ip, files: [], registers: null, rawIO: null, error: null, loadedAt: null };
    state.tab = 'robot';
    render();
    api('/api/robot/list?ip=' + encodeURIComponent(ip)).then(function (b) {
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
    api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=NUMREG.VA').then(function (b) {
      state.robot.registers = VA.parseNumreg(b.content);
      state.robot.loadedAt = new Date();
      if (state.tab === 'robot') render();
    }).catch(function (e) {
      state.robot.registers = { error: e.message };
      if (state.tab === 'robot') render();
    });
  }

  function loadRobotIO() {
    var ip = state.robot.ip;
    api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=DIOCFGSV.IO').then(function (b) {
      state.robot.rawIO = VA.rawLines(b.content);
      if (state.tab === 'robot') render();
    }).catch(function (e) {
      state.robot.rawIO = { error: e.message };
      if (state.tab === 'robot') render();
    });
  }

  function importFromRobot(name) {
    var ip = state.robot.ip;
    return api('/api/robot/file?ip=' + encodeURIComponent(ip) + '&name=' + encodeURIComponent(name))
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
      var lsFiles = b.files.filter(function (f) { return /\.ls$/i.test(f.name); });
      if (!lsFiles.length) {
        state.dirStatus = 'No .LS files found in ' + b.path;
        renderConnect();
        return;
      }
      var pending = lsFiles.length;
      lsFiles.forEach(function (f) {
        api('/api/dir/file?path=' + encodeURIComponent(f.path)).then(function (file) {
          addProgram(file.content, file.name, { type: 'dir', path: file.path });
        }).catch(function () { /* unreadable file — skip */ }).then(function () {
          if (--pending === 0) {
            state.dirStatus = 'Loaded ' + lsFiles.length + ' program' + (lsFiles.length > 1 ? 's' : '') + ' from ' + b.path;
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
    s = s.replace(/\b(IF|THEN|ELSE|ENDIF|SELECT|FOR|ENDFOR|TO|JMP|WAIT|TIMEOUT|SKIP|CONDITION|PULSE|ON|OFF|END|ABORT|PAUSE|UALM|OVERRIDE|PAYLOAD|UFRAME_NUM|UTOOL_NUM|MOD|DIV|AND|OR|NOT|START|STOP|RESET|Offset|Tool_Offset)\b/g,
      '<span class="tok-kw">$1</span>');
    s = s.replace(/\b(FINE|CNT\d+|ACC\d+|max_speed|BREAK|RTCP|Wjnt|PTH)\b/g, '<span class="tok-num">$1</span>');
    return s;
  }

  /* ================= renderers ================= */

  function render() {
    renderSidebar();
    renderConnect();
    renderTabs();
    renderPane();
  }

  function renderSidebar() {
    var list = document.getElementById('prog-list');
    list.innerHTML = '';
    var names = Object.keys(state.programs).sort();
    document.getElementById('lib-count').textContent = names.length ? names.length + ' program' + (names.length > 1 ? 's' : '') : '';
    if (!names.length) {
      list.appendChild(h('div', { class: 'empty', text: 'No programs yet. Import .LS files or load the sample cell.' }));
      return;
    }
    names.forEach(function (n) {
      var p = state.programs[n];
      var meta = p.parsed.lines.length + ' lines';
      if (p.origin.type === 'robot') meta += ' · from ' + p.origin.ip;
      else if (p.origin.type === 'dir') meta += ' · on disk';
      else if (p.parsed.attrs.COMMENT) meta += ' · ' + p.parsed.attrs.COMMENT;
      list.appendChild(h('button', {
        class: 'prog-item' + (n === state.selected ? ' active' : ''),
        onclick: function () { state.selected = n; state.editing = false; render(); }
      }, [
        h('div', { class: 'name', text: n }),
        h('div', { class: 'meta', text: meta })
      ]));
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
    ['positions', 'Positions'],
    ['xref', 'Cross-reference'],
    ['search', 'Search'],
    ['robot', 'Robot']
  ];

  function renderTabs() {
    var bar = document.getElementById('tabs');
    bar.innerHTML = '';
    var problemCount = state.findings.filter(function (f) { return f.severity !== 'info'; }).length;
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
      case 'positions': renderPositions(pane); break;
      case 'xref': renderXref(pane); break;
      case 'search': renderSearch(pane); break;
      case 'robot': renderRobot(pane); break;
    }
  }

  /* ---- code tab (view + edit) ---- */

  function renderCode(pane) {
    var p = current();
    if (!p) return;

    if (state.editing) return renderEditor(pane, p);

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
      h('button', { class: 'btn subtle', text: 'Export .LS', onclick: function () { exportProgram(p); } }),
      h('button', {
        class: 'btn subtle', text: 'Remove',
        onclick: function () {
          if (confirm('Remove ' + p.parsed.name + ' from the library? (Your original file is untouched.)')) removeProgram(p.parsed.name);
        }
      })
    ]);
    pane.appendChild(bar);

    var box = h('div', { class: 'codebox' });
    p.parsed.lines.forEach(function (line) {
      var row = h('div', { class: 'cline', 'data-line': line.num }, [
        h('span', { class: 'ln', text: line.num }),
        h('span', { class: 'src', html: (line.motion ? '<span class="tok-motion">' + line.motion + '</span> ' : '') + highlight(line) })
      ]);
      box.appendChild(row);
      if (state.explain) {
        box.appendChild(h('div', { class: 'explain-row' }, [
          h('span', { class: 'ln' }),
          h('span', { class: 'note', text: '↳ ' + X.explainLine(line) })
        ]));
      }
    });
    pane.appendChild(box);

    box.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t.classList.contains('tok-call')) {
        var name = t.getAttribute('data-call').toUpperCase();
        if (state.programs[name]) { state.selected = name; render(); }
      }
    });
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

    var bar = h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Editing ' + oldName }),
      status,
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn primary', text: 'Save to library', onclick: function () { save(false); } }),
      (p.origin.type === 'dir' && state.server)
        ? h('button', { class: 'btn', text: 'Save to library + disk', title: p.origin.path, onclick: function () { save(true); } })
        : null,
      h('button', { class: 'btn subtle', text: 'Cancel', onclick: function () { state.editing = false; render(); } })
    ]);
    pane.appendChild(bar);
    if (p.origin.type === 'robot') {
      pane.appendChild(h('p', { class: 'muted', text: 'This program was read from robot ' + p.origin.ip + '. Edits stay in your library — writing back to a controller is deliberately not supported. Export the .LS and load it via the teach pendant / ASCII upload after review.' }));
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
    flowWrap.appendChild(h('h3', { text: 'Call order — the sequence programs run in' }));
    flowWrap.appendChild(h('p', { class: 'muted', text: 'Read top to bottom: each row is a CALL in the order it appears. Indent = call depth. Sections inside loops repeat every cycle. Click a program to open it.' }));

    var seqBox = h('div', { class: 'callorder' });
    rootNames.sort().forEach(function (r) {
      FL.callOrder(state.programs, g, r).forEach(function (row) {
        var el = h('div', { class: 'seq-row', style: 'padding-left:' + (row.depth * 26) + 'px' });
        el.appendChild(h('span', { class: 'seq-num', text: row.seq }));
        el.appendChild(h('span', {
          class: 'seq-name' + (row.note === 'missing' ? ' missing' : ''),
          text: row.name,
          onclick: row.note === 'missing' ? null : function () { state.selected = row.name; state.tab = 'code'; render(); }
        }));
        if (row.line) el.appendChild(h('span', { class: 'ref', text: 'called at line ' + row.line }));
        if (row.note === 'missing') el.appendChild(h('span', { class: 'badge warn', text: 'not in library' }));
        if (row.note === 'recursion') el.appendChild(h('span', { class: 'ref', text: '↻ recursion — expanded above' }));
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
    pane.appendChild(h('h3', { text: 'Control flow inside ' + p.parsed.name }));
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
      if (b.calls.length) {
        var cc = h('div', { class: 'fc-calls' });
        b.calls.forEach(function (name) {
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

  function renderChecks(pane) {
    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Program checks' }),
      h('span', { class: 'muted', text: 'static checks across the whole library — comment lines are never counted as uses' })
    ]));

    if (!Object.keys(state.programs).length) {
      pane.appendChild(h('p', { class: 'muted', text: 'Import programs first — checks run across everything in the library.' }));
      return;
    }

    var counts = { error: 0, warn: 0, info: 0 };
    state.findings.forEach(function (f) { counts[f.severity]++; });
    var cards = h('div', { class: 'cards' });
    [['error', 'errors — will fault on the robot'], ['warn', 'warnings — review these'], ['info', 'notes']].forEach(function (c) {
      cards.appendChild(h('div', { class: 'card sev-' + c[0] }, [
        h('div', { class: 'k', text: counts[c[0]] }),
        h('div', { class: 'l', text: c[1] })
      ]));
    });
    pane.appendChild(cards);

    if (!state.findings.length) {
      pane.appendChild(h('p', { text: 'No issues found. Jumps all land on defined labels, every register and I/O point used has a label, and all called programs are present.' }));
      return;
    }

    var tw = h('div', { class: 'table-wrap' });
    var tbl = h('table', { class: 'xref-table' });
    tbl.appendChild(h('tr', {}, [h('th', { text: 'Severity' }), h('th', { text: 'Finding' }), h('th', { text: 'Where' })]));
    state.findings.forEach(function (f) {
      var refs = h('td');
      f.refs.slice(0, 12).forEach(function (r) { refs.appendChild(chip(r, f.severity === 'error' ? 'write' : 'read')); });
      if (f.refs.length > 12) refs.appendChild(h('span', { class: 'muted', text: ' +' + (f.refs.length - 12) + ' more' }));
      tbl.appendChild(h('tr', {}, [
        h('td', {}, [h('span', { class: 'badge ' + (f.severity === 'error' ? 'warn' : f.severity === 'warn' ? 'mid' : 'ok'), text: SEV_LABEL[f.severity] })]),
        h('td', { text: f.message }),
        refs
      ]));
    });
    tw.appendChild(tbl);
    pane.appendChild(tw);
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
      h('span', { class: 'muted', text: 'every register, position register, I/O point, and timer across all ' + Object.keys(state.programs).length + ' programs — click a reference to jump to it' })
    ]));
    var wrap = h('div', { class: 'xref' });

    xrefSection(wrap, 'Registers R[n]', x.registers, function (n) { return 'R[' + n + ']'; });
    xrefSection(wrap, 'Position registers PR[n]', x.posRegs, function (n) { return 'PR[' + n + ']'; });

    var ioKeys = Object.keys(x.io).sort(function (a, b) {
      var ta = x.io[a], tb = x.io[b];
      return ta.type === tb.type ? ta.index - tb.index : ta.type.localeCompare(tb.type);
    });
    if (ioKeys.length) {
      wrap.appendChild(h('h3', { text: 'I/O points' }));
      var tw = h('div', { class: 'table-wrap' });
      var tbl = h('table', { class: 'xref-table' });
      tbl.appendChild(h('tr', {}, [h('th', { text: 'Point' }), h('th', { text: 'Label' }), h('th', { text: 'References (read / write)' })]));
      ioKeys.forEach(function (k) {
        var e = x.io[k];
        var refs = h('td');
        e.refs.forEach(function (r) { refs.appendChild(chip(r, r.write ? 'write' : 'read')); });
        tbl.appendChild(h('tr', {}, [
          h('td', { class: 'n', text: k }),
          h('td', { text: e.label || '' }),
          refs
        ]));
      });
      tw.appendChild(tbl);
      wrap.appendChild(tw);
    }

    xrefSection(wrap, 'Timers', x.timers, function (n) { return 'TIMER[' + n + ']'; });
    pane.appendChild(wrap);
  }

  function xrefSection(wrap, title, map, fmt) {
    var keys = Object.keys(map).map(Number).sort(function (a, b) { return a - b; });
    if (!keys.length) return;
    wrap.appendChild(h('h3', { text: title }));
    var tw = h('div', { class: 'table-wrap' });
    var tbl = h('table', { class: 'xref-table' });
    tbl.appendChild(h('tr', {}, [h('th', { text: 'Item' }), h('th', { text: 'Label' }), h('th', { text: 'References (read / write)' })]));
    keys.forEach(function (n) {
      var e = map[n];
      var refs = h('td');
      e.refs.forEach(function (r) { refs.appendChild(chip(r, r.write ? 'write' : 'read')); });
      tbl.appendChild(h('tr', {}, [
        h('td', { class: 'n', text: fmt(n) }),
        h('td', { text: e.label || '' }),
        refs
      ]));
    });
    tw.appendChild(tbl);
    wrap.appendChild(tw);
  }

  /* ---- search tab ---- */

  function renderSearch(pane) {
    var bar = h('div', { class: 'search-bar' });
    var input = h('input', { type: 'search', placeholder: 'Search all programs… e.g. R[10], DO[104], CALL PICK, pallet' });
    input.value = state.searchQuery || '';
    bar.appendChild(input);
    pane.appendChild(bar);
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
      var lower = q.toLowerCase();
      var count = 0;
      Object.keys(state.programs).sort().forEach(function (n) {
        state.programs[n].parsed.lines.forEach(function (line) {
          var full = (line.motion ? line.motion + ' ' : '') + line.text;
          var idx = full.toLowerCase().indexOf(lower);
          if (idx === -1) return;
          count++;
          if (count > 400) return;
          var hit = h('div', { class: 'hit' });
          hit.appendChild(h('span', {
            class: 'where', text: n + ':' + line.num,
            onclick: function () { gotoLine(n, line.num); }
          }));
          var txt = h('span', { class: 'text' });
          txt.innerHTML = esc(full.slice(0, idx)) + '<mark>' + esc(full.substr(idx, q.length)) + '</mark>' + esc(full.slice(idx + q.length));
          hit.appendChild(txt);
          results.appendChild(hit);
        });
      });
      results.insertBefore(h('p', { class: 'muted', text: count ? count + ' match' + (count > 1 ? 'es' : '') + (count > 400 ? ' (showing first 400)' : '') : 'No matches.' }), results.firstChild);
    }
    input.addEventListener('input', run);
    run();
    input.focus();
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
    form.appendChild(ipIn);
    form.appendChild(h('button', { class: 'btn primary', text: state.robot.ip ? 'Reconnect' : 'Connect', onclick: function () { if (ipIn.value.trim()) connectRobot(ipIn.value.trim()); } }));
    pane.appendChild(form);

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
    pane.appendChild(h('h3', { text: 'Programs on ' + state.robot.ip + ' (' + lsFiles.length + ')' }));
    if (lsFiles.length) {
      var actions = h('p', {}, [
        h('button', {
          class: 'btn', text: 'Import all ' + lsFiles.length + ' programs',
          onclick: function () {
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
          onclick: function () { importFromRobot(f).then(function (n) { state.selected = n; render(); }); }
        }));
      });
      pane.appendChild(fl);
    } else if (state.robot.loadedAt) {
      pane.appendChild(h('p', { class: 'muted', text: 'No .LS files listed. Some controllers need ASCII upload support for .LS on MD:. The file list found: ' + (state.robot.files.join(', ') || 'nothing') }));
    } else {
      pane.appendChild(h('p', { class: 'muted', text: 'Reading…' }));
    }

    // registers
    pane.appendChild(h('h3', {}, [
      document.createTextNode('Registers (NUMREG.VA) '),
      h('button', { class: 'btn subtle', text: 'Refresh', onclick: loadRobotRegisters })
    ]));
    var regs = state.robot.registers;
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

    // I/O
    pane.appendChild(h('h3', {}, [
      document.createTextNode('I/O configuration (DIOCFGSV.IO) '),
      h('button', { class: 'btn subtle', text: state.robot.rawIO ? 'Refresh' : 'Read from robot', onclick: loadRobotIO })
    ]));
    var io = state.robot.rawIO;
    if (io && io.error) {
      pane.appendChild(h('p', { class: 'muted', text: 'Could not read DIOCFGSV.IO: ' + io.error }));
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
    document.getElementById('btn-import').addEventListener('click', function () {
      document.getElementById('file-input').click();
    });
    document.getElementById('btn-folder').addEventListener('click', function () {
      document.getElementById('folder-input').click();
    });
    document.getElementById('btn-samples').addEventListener('click', loadSamples);
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
      if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
    });

    restore();
    rebuildDerived();
    render();
    detectServer();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
