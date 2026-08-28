/* Cross-reference and call-graph analysis over parsed FANUC programs. */
(function (global) {
  'use strict';

  var IO_TYPES = ['DI', 'DO', 'RI', 'RO', 'GI', 'GO', 'UI', 'UO', 'SI', 'SO', 'AI', 'AO', 'WI', 'WO', 'F', 'M'];

  function analyzeProgram(prog) {
    var a = {
      registers: {},   // n -> { label, reads: [line], writes: [line] }
      posRegs: {},
      io: {},          // "DO[101]" -> { type, index, label, reads, writes }
      timers: {},
      labels: {},      // n -> { defLine, jumps: [line] }
      calls: [],       // { target, line, kind: 'CALL'|'RUN' }
      motions: { J: 0, L: 0, C: 0, A: 0, S: 0 },
      uframes: [], utools: [],
      waits: [],       // { line, cond }
      loops: [],       // { label, jumpLine, defLine } backward jumps
      comments: 0
    };

    prog.lines.forEach(function (line) {
      var text = line.text;
      if (line.comment !== null) { a.comments++; return; }
      if (line.motion) a.motions[line.motion] = (a.motions[line.motion] || 0) + 1;

      // Label definitions: line begins with LBL[n]
      var m = text.match(/^LBL\[(\d+)(?::[^\]]*)?\]/);
      if (m) {
        var ln = parseInt(m[1], 10);
        a.labels[ln] = a.labels[ln] || { defLine: null, defLines: [], jumps: [] };
        if (a.labels[ln].defLine === null) a.labels[ln].defLine = line.num;
        a.labels[ln].defLines.push(line.num);
      }
      // Jump references: JMP LBL[n], WAIT ... TIMEOUT,LBL[n], Skip,LBL[n]
      var jmpRe = /(?:JMP\s+|TIMEOUT\s*,\s*|Skip\s*,\s*)LBL\[(\d+)(?::[^\]]*)?\]/g;
      var j;
      while ((j = jmpRe.exec(text)) !== null) {
        var tn = parseInt(j[1], 10);
        a.labels[tn] = a.labels[tn] || { defLine: null, defLines: [], jumps: [] };
        a.labels[tn].jumps.push(line.num);
      }

      // Calls — scan with bracket contents blanked so comments like
      // DI[5:Run Task] are never read as a RUN instruction; keywords are
      // uppercase in TP, so match case-sensitively.
      var noBrackets = text.replace(/\[[^\]]*\]/g, '[]');
      var callRe = /\b(CALL|RUN)\s+([A-Z_][A-Z0-9_]*)/g;
      while ((j = callRe.exec(noBrackets)) !== null) {
        a.calls.push({ target: j[2].toUpperCase(), line: line.num, kind: j[1] });
      }

      // Registers R[n]  (avoid PR[n] / SR[n] / AR[n] / GO[..] etc. via char class before R)
      var regRe = /(^|[^A-Z])R\[(\d+)(?::([^\]]*))?\]/g;
      while ((j = regRe.exec(text)) !== null) {
        recordRef(a.registers, parseInt(j[2], 10), j[3], line, isWriteAt(text, j.index + j[1].length));
      }
      // Position registers PR[n] and PR[i,j]
      var prRe = /\bPR\[(?:GP\d+\s*:\s*)?(\d+)(?:\s*,\s*\d+)?(?::([^\]]*))?\]/g;
      while ((j = prRe.exec(text)) !== null) {
        recordRef(a.posRegs, parseInt(j[1], 10), j[2], line, isWriteAt(text, j.index));
      }
      // Timers
      var tRe = /\bTIMER\[(\d+)\]/g;
      while ((j = tRe.exec(text)) !== null) {
        recordRef(a.timers, parseInt(j[1], 10), null, line, /TIMER\[\d+\]\s*=/.test(text));
      }
      // I/O
      var ioRe = new RegExp('\\b(' + IO_TYPES.join('|') + ')\\[(\\d+)(?::([^\\]]*))?\\]', 'g');
      while ((j = ioRe.exec(text)) !== null) {
        var key = j[1] + '[' + j[2] + ']';
        if (!a.io[key]) a.io[key] = { type: j[1], index: parseInt(j[2], 10), label: null, reads: [], writes: [] };
        // exports embed the live state before the comment: DI[1:ON :Auto Mode]
        if (j[3] && !a.io[key].label) a.io[key].label = j[3].replace(/^(ON|OFF)\s*:\s*/i, '').trim();
        if (isWriteAt(text, j.index)) a.io[key].writes.push(line.num);
        else a.io[key].reads.push(line.num);
      }

      // Frames / tools
      if ((m = text.match(/UFRAME_NUM\s*=\s*(\d+)/))) a.uframes.push({ num: parseInt(m[1], 10), line: line.num });
      if ((m = text.match(/UTOOL_NUM\s*=\s*(\d+)/)))  a.utools.push({ num: parseInt(m[1], 10), line: line.num });

      // Waits
      if (/^WAIT\b/.test(text)) a.waits.push({ line: line.num, cond: text.replace(/^WAIT\s*/, '') });
    });

    // Loop detection: backward jumps
    Object.keys(a.labels).forEach(function (n) {
      var lb = a.labels[n];
      if (lb.defLine === null) return;
      lb.jumps.forEach(function (jl) {
        if (jl > lb.defLine) a.loops.push({ label: parseInt(n, 10), jumpLine: jl, defLine: lb.defLine });
      });
    });

    return a;
  }

  function recordRef(map, n, label, line, isWrite) {
    if (!map[n]) map[n] = { label: null, reads: [], writes: [] };
    if (label && !map[n].label) map[n].label = String(label).trim();
    (isWrite ? map[n].writes : map[n].reads).push(line.num);
  }

  // A reference is a "write" if it appears on the left of the first top-level '='
  // that is an assignment (not ==, <=, >=, <>).
  function isWriteAt(text, idx) {
    var eq = findAssignEq(text);
    return eq !== -1 && idx < eq;
  }

  function findAssignEq(text) {
    for (var i = 0; i < text.length; i++) {
      if (text[i] === '=') {
        var prev = text[i - 1], next = text[i + 1];
        if (prev === '<' || prev === '>' || prev === '=' || next === '=') continue;
        // "IF (...)" conditions contain '=' comparisons; treat '=' after IF/WAIT/UNTIL as comparison
        var head = text.slice(0, i);
        if (/\b(IF|WAIT|UNTIL|WHEN)\b/i.test(head) && !/,\s*$/.test(head)) {
          // mixed logic IF (DO[1]=ON) — comparison, keep scanning
          continue;
        }
        return i;
      }
    }
    return -1;
  }

  /* ---- library-level analysis ---- */

  function buildCallGraph(programs) {
    // programs: { NAME: { parsed, analysis } }
    var graph = { calls: {}, calledBy: {}, unresolved: {} };
    Object.keys(programs).forEach(function (name) {
      graph.calls[name] = [];
      graph.calledBy[name] = graph.calledBy[name] || [];
    });
    Object.keys(programs).forEach(function (name) {
      programs[name].analysis.calls.forEach(function (c) {
        graph.calls[name].push(c);
        if (programs[c.target]) {
          graph.calledBy[c.target] = graph.calledBy[c.target] || [];
          if (graph.calledBy[c.target].indexOf(name) === -1) graph.calledBy[c.target].push(name);
        } else {
          graph.unresolved[c.target] = graph.unresolved[c.target] || [];
          graph.unresolved[c.target].push(name);
        }
      });
    });
    return graph;
  }

  function roots(graph) {
    return Object.keys(graph.calls).filter(function (n) {
      return !graph.calledBy[n] || graph.calledBy[n].length === 0;
    });
  }

  // Aggregate cross-reference across all programs:
  // { registers: { n: { label, refs: [{prog, line, write}] } }, io: {...}, posRegs: {...}, timers: {...} }
  function buildGlobalXref(programs) {
    var x = { registers: {}, posRegs: {}, io: {}, timers: {} };
    Object.keys(programs).forEach(function (name) {
      var a = programs[name].analysis;
      mergeNumMap(x.registers, a.registers, name);
      mergeNumMap(x.posRegs, a.posRegs, name);
      mergeNumMap(x.timers, a.timers, name);
      Object.keys(a.io).forEach(function (key) {
        var src = a.io[key];
        if (!x.io[key]) x.io[key] = { type: src.type, index: src.index, label: src.label, refs: [] };
        if (src.label && !x.io[key].label) x.io[key].label = src.label;
        src.reads.forEach(function (l) { x.io[key].refs.push({ prog: name, line: l, write: false }); });
        src.writes.forEach(function (l) { x.io[key].refs.push({ prog: name, line: l, write: true }); });
      });
    });
    return x;
  }

  function mergeNumMap(dst, src, progName) {
    Object.keys(src).forEach(function (n) {
      if (!dst[n]) dst[n] = { label: src[n].label, refs: [] };
      if (src[n].label && !dst[n].label) dst[n].label = src[n].label;
      src[n].reads.forEach(function (l) { dst[n].refs.push({ prog: progName, line: l, write: false }); });
      src[n].writes.forEach(function (l) { dst[n].refs.push({ prog: progName, line: l, write: true }); });
    });
  }

  var api = {
    analyzeProgram: analyzeProgram,
    buildCallGraph: buildCallGraph,
    buildGlobalXref: buildGlobalXref,
    roots: roots
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucAnalyzer = api;
})(typeof window !== 'undefined' ? window : globalThis);
