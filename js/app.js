/* FANUC TP Program Studio — UI layer. */
(function () {
  'use strict';

  var P = window.FanucParser, A = window.FanucAnalyzer, X = window.FanucExplain;
  var STORE_KEY = 'fanuc-tp-studio.programs.v1';

  var state = {
    programs: {},          // NAME -> { parsed, analysis, source }
    selected: null,
    tab: 'code',
    explain: false,
    graph: null,           // rebuilt on library change
    xref: null
  };

  /* ================= library ================= */

  function rebuildDerived() {
    state.graph = A.buildCallGraph(state.programs);
    state.xref = A.buildGlobalXref(state.programs);
  }

  function addProgram(source, filename) {
    var parsed = P.parseLS(source, filename);
    state.programs[parsed.name] = {
      parsed: parsed,
      analysis: A.analyzeProgram(parsed),
      source: source
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
      Object.keys(state.programs).forEach(function (n) { out[n] = state.programs[n].source; });
      localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch (e) { /* storage unavailable — session-only mode */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      Object.keys(data).forEach(function (n) { addProgram(data[n], n + '.LS'); });
      state.selected = Object.keys(state.programs)[0] || null;
      rebuildDerived();
    } catch (e) { /* ignore corrupt store */ }
  }

  function importFiles(fileList) {
    var files = Array.prototype.slice.call(fileList);
    var pending = files.length;
    if (!pending) return;
    var lastName = null;
    files.forEach(function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        lastName = addProgram(String(reader.result), f.name);
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
      last = addProgram(window.FANUC_SAMPLES[n], n + '.LS');
    });
    state.selected = state.programs.MAIN ? 'MAIN' : last;
    rebuildDerived();
    persist();
    render();
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
    // strings/messages first
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
      if (p.parsed.attrs.COMMENT) meta += ' · ' + p.parsed.attrs.COMMENT;
      list.appendChild(h('button', {
        class: 'prog-item' + (n === state.selected ? ' active' : ''),
        onclick: function () { state.selected = n; render(); }
      }, [
        h('div', { class: 'name', text: n }),
        h('div', { class: 'meta', text: meta })
      ]));
    });
  }

  var TABS = [
    ['code', 'Code'],
    ['summary', 'Summary'],
    ['positions', 'Positions'],
    ['xref', 'Cross-reference'],
    ['graph', 'Call graph'],
    ['search', 'Search']
  ];

  function renderTabs() {
    var bar = document.getElementById('tabs');
    bar.innerHTML = '';
    TABS.forEach(function (t) {
      bar.appendChild(h('button', {
        class: 'tab' + (state.tab === t[0] ? ' active' : ''),
        text: t[1],
        onclick: function () { state.tab = t[0]; render(); }
      }));
    });
  }

  function renderPane() {
    var pane = document.getElementById('pane');
    pane.innerHTML = '';
    if (!Object.keys(state.programs).length && state.tab !== 'search') {
      pane.appendChild(h('div', { class: 'placeholder' }, [
        h('h2', { text: 'FANUC TP Program Studio' }),
        h('p', { text: 'View, understand, and manage FANUC teach pendant programs. Import ASCII listing files (.LS) exported from your controller or ROBOGUIDE.' }),
        h('div', { class: 'drop-hint' }, [
          h('p', { text: 'Drag .LS files anywhere in this window,' }),
          h('p', { text: 'or use Import / Load sample cell above.' })
        ])
      ]));
      return;
    }
    switch (state.tab) {
      case 'code': renderCode(pane); break;
      case 'summary': renderSummary(pane); break;
      case 'positions': renderPositions(pane); break;
      case 'xref': renderXref(pane); break;
      case 'graph': renderGraph(pane); break;
      case 'search': renderSearch(pane); break;
    }
  }

  /* ---- code tab ---- */

  function renderCode(pane) {
    var p = current();
    if (!p) return;
    var bar = h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: p.parsed.name }),
      p.parsed.attrs.COMMENT ? h('span', { class: 'muted', text: p.parsed.attrs.COMMENT }) : null,
      h('span', { class: 'spacer', style: 'flex:1' }),
      (function () {
        var cb = h('input', { type: 'checkbox' });
        cb.checked = state.explain;
        cb.addEventListener('change', function () { state.explain = cb.checked; render(); });
        var lab = h('label', {}, [cb]);
        lab.appendChild(document.createTextNode(' Explain every line'));
        return lab;
      })(),
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

    // I/O grouped by type
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

  /* ---- call graph tab ---- */

  function renderGraph(pane) {
    var g = state.graph;
    pane.appendChild(h('div', { class: 'code-toolbar' }, [
      h('span', { class: 'title', text: 'Call graph' }),
      h('span', { class: 'muted', text: 'expand from each top-level program; amber items open the program' })
    ]));

    var wrap = h('div', { class: 'graph' });
    var rootNames = A.roots(g);
    if (!rootNames.length) rootNames = Object.keys(state.programs); // all called: cycles

    wrap.appendChild(h('h3', { text: 'Call trees' }));
    var tree = h('div', { class: 'tree' });
    var ul = h('ul');
    rootNames.sort().forEach(function (r) { ul.appendChild(treeNode(r, {}, null)); });
    tree.appendChild(ul);
    wrap.appendChild(tree);

    var missing = Object.keys(g.unresolved);
    if (missing.length) {
      wrap.appendChild(h('h3', { text: 'Called but not in library' }));
      var ml = h('ul');
      missing.sort().forEach(function (n) {
        var li = h('li', { class: 'mono' });
        li.appendChild(h('span', { class: 'badge warn', text: 'missing' }));
        li.appendChild(document.createTextNode(' ' + n + ' — called by ' + uniq(g.unresolved[n]).join(', ') + '. Import its .LS to complete the picture.'));
        ml.appendChild(li);
      });
      wrap.appendChild(ml);
    }
    pane.appendChild(wrap);
  }

  function treeNode(name, visited, viaLine) {
    var li = h('li');
    var exists = !!state.programs[name];
    var lbl = h('span', {
      class: 'node' + (exists ? '' : ' missing'),
      text: name
    });
    if (exists) lbl.addEventListener('click', function () { state.selected = name; state.tab = 'code'; render(); });
    li.appendChild(lbl);
    if (viaLine) li.appendChild(h('span', { class: 'ref', text: '  (line ' + viaLine + ')' }));
    if (!exists) {
      li.appendChild(h('span', { class: 'ref', text: '  — not in library' }));
      return li;
    }
    if (visited[name]) {
      li.appendChild(h('span', { class: 'cyc', text: '  ↻ recursion — already shown above' }));
      return li;
    }
    var v2 = Object.create(visited);
    v2[name] = true;
    var calls = state.graph.calls[name] || [];
    if (calls.length) {
      var ul = h('ul');
      calls.forEach(function (c) { ul.appendChild(treeNode(c.target, v2, c.line)); });
      li.appendChild(ul);
    }
    return li;
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

  /* ================= wiring ================= */

  function init() {
    document.getElementById('file-input').addEventListener('change', function (ev) {
      importFiles(ev.target.files);
      ev.target.value = '';
    });
    document.getElementById('btn-import').addEventListener('click', function () {
      document.getElementById('file-input').click();
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
  }

  document.addEventListener('DOMContentLoaded', init);
})();
