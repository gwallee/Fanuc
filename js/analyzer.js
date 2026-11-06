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
      indirect: [],    // { type: 'F'|'DO'|'R'|..., reg, line, write } — F[R[n]], DO[R[n]], R[R[n]]
      forLoops: [],    // { reg, from, to, line } — FOR R[n]=a TO b (constants only)
      comments: 0
    };

    prog.lines.forEach(function (line) {
      var text = line.text;
      if (line.comment !== null) { a.comments++; return; }
      if (line.motion) a.motions[line.motion] = (a.motions[line.motion] || 0) + 1;

      // Label definitions: line begins with LBL[n]
      var m = text.match(/^LBL\[\s*(\d+)\s*(?::[^\]]*)?\]/);
      if (m) {
        var ln = parseInt(m[1], 10);
        a.labels[ln] = a.labels[ln] || { defLine: null, defLines: [], jumps: [] };
        if (a.labels[ln].defLine === null) a.labels[ln].defLine = line.num;
        a.labels[ln].defLines.push(line.num);
      }
      // Jump references: JMP LBL[n], WAIT ... TIMEOUT,LBL[n], Skip,LBL[n]
      var jmpRe = /(?:JMP\s+|TIMEOUT\s*,\s*|Skip\s*,\s*)LBL\[\s*(\d+)\s*(?::[^\]]*)?\]/g;
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
        a.calls.push({ target: j[2].toUpperCase(), line: line.num, kind: j[1], args: callArgs(text, j[2]) });
      }

      // Indirect references F[R[n]] / DO[R[n]] / R[R[n]]: the member written
      // is only known at runtime (A_ZONE_CHECK sets F[R[200]], _INIT wipes
      // DO[R[99]] in a FOR loop). Recorded apart so never-written rules can
      // credit them instead of flagging every flag such a loop sets.
      var indRe = /(^|[^A-Z])(DI|DO|RI|RO|GI|GO|UI|UO|F|M|R|PR)\[\s*R\[(\d+)(?::[^\]]*)?\]\s*\]/g;
      while ((j = indRe.exec(text)) !== null) {
        a.indirect.push({ type: j[2], reg: parseInt(j[3], 10), line: line.num, write: isWriteAt(text, j.index + j[0].length) });
      }
      var forM = text.match(/^FOR\s+R\[(\d+)(?::[^\]]*)?\]\s*=\s*(-?\d+)\s+(?:TO|DOWNTO)\s+(-?\d+)/i);
      if (forM) a.forLoops.push({ reg: parseInt(forM[1], 10), from: parseInt(forM[2], 10), to: parseInt(forM[3], 10), line: line.num });

      // Registers R[n]  (avoid PR[n] / SR[n] / AR[n] / GO[..] etc. via char class before R)
      var regRe = /(^|[^A-Z])R\[(\d+)(?::([^\]]*))?\]/g;
      while ((j = regRe.exec(text)) !== null) {
        recordRef(a.registers, parseInt(j[2], 10), j[3], line, isWriteAt(text, j.index + j[0].length));
      }
      // Position registers PR[n] and PR[i,j]
      var prRe = /\bPR\[(?:GP\d+\s*:\s*)?(\d+)(?:\s*,\s*\d+)?(?::([^\]]*))?\]/g;
      while ((j = prRe.exec(text)) !== null) {
        recordRef(a.posRegs, parseInt(j[1], 10), j[2], line, isWriteAt(text, j.index + j[0].length));
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
        if (isWriteAt(text, j.index + j[0].length)) a.io[key].writes.push(line.num);
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

  /* Arguments of CALL NAME(a,b,c) as trimmed strings (top-level commas only;
   * a mixed-logic IF (...),CALL X(1,2) still yields ['1','2']). */
  function callArgs(text, name) {
    var at = text.indexOf(name);
    if (at === -1) return [];
    var rest = text.slice(at + name.length);
    var open = rest.match(/^\s*\(/);
    if (!open) return [];
    var depth = 0, cur = '', out = [];
    for (var i = open[0].length - 1; i < rest.length; i++) {
      var ch = rest[i];
      if (ch === '(' || ch === '[') { depth++; if (depth === 1 && ch === '(') continue; }
      else if (ch === ')' || ch === ']') { depth--; if (depth === 0) { out.push(cur.trim()); return out; } }
      if (ch === ',' && depth === 1) { out.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  function recordRef(map, n, label, line, isWrite) {
    if (!map[n]) map[n] = { label: null, reads: [], writes: [] };
    if (label && !map[n].label) map[n].label = String(label).trim();
    (isWrite ? map[n].writes : map[n].reads).push(line.num);
  }

  // A reference is a "write" only when it is the thing being assigned: it ends
  // right before the line's assignment '=' (not ==, <=, >=, <>). Merely being
  // left of the '=' is not enough — a motion line's speed register sits left
  // of the '=' in a trailing TB 0.5sec,DO[1]=ON or Skip,LBL[1],PR[5]=LPOS,
  // and it is the DO or PR that is written there, not the speed.
  function isWriteAt(text, end) {
    var eq = findAssignEq(text);
    return eq !== -1 && end <= eq && /^\s*$/.test(text.slice(end, eq));
  }

  function findAssignEq(text) {
    var action = ifActionStart(text);
    for (var i = 0; i < text.length; i++) {
      if (text[i] === '=') {
        var prev = text[i - 1], next = text[i + 1];
        if (prev === '<' || prev === '>' || prev === '=' || next === '=') continue;
        // "IF (...)" conditions contain '=' comparisons; treat '=' after IF/WAIT/UNTIL/SELECT
        // as comparison — unless it is in the action a mixed-logic IF runs once its
        // condition closes: IF (R[1]<10),R[1]=(10) does write R[1].
        if (i < action && /\b(IF|WAIT|UNTIL|WHEN|SELECT)\b/i.test(text.slice(0, i))) continue;
        return i;
      }
    }
    return -1;
  }

  // Where the action of a mixed-logic "IF (cond),action" begins, or Infinity
  // when the line has no such action (plain IF R[1]=1,JMP, WAIT, SELECT...).
  function ifActionStart(text) {
    var m = /^\s*IF\s*\(/.exec(text);
    if (!m) return Infinity;
    var depth = 0;
    for (var i = m[0].length - 1; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth === 0) {
        return /^\s*,/.test(text.slice(i + 1)) ? i + 1 : Infinity;
      }
    }
    return Infinity;
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

  /* Which members an indirect write T[R[n]]= can reach, per type:
   *   { F: { all, indices: {k: true}, refs: [{prog, line}] }, DO: ..., R: ... }
   * The index register is resolved inside the writing program — a FOR loop
   * over it gives a range, R[n]=AR[k] gives the constants callers pass as
   * argument k, R[n]=<const> gives that constant. Anything else means the
   * write could hit any member (all = true). */
  function indirectWrites(programs, graph) {
    var out = {};
    Object.keys(programs).forEach(function (name) {
      var a = programs[name].analysis;
      a.indirect.forEach(function (ind) {
        if (!ind.write) return;
        var e = out[ind.type] || (out[ind.type] = { all: false, indices: {}, refs: [] });
        e.refs.push({ prog: name, line: ind.line, reg: ind.reg });
        var known = resolveRegister(programs, graph, name, ind.reg);
        if (known === null) e.all = true;
        else known.forEach(function (k) { e.indices[k] = true; });
      });
    });
    return out;
  }

  function resolveRegister(programs, graph, name, reg) {
    var a = programs[name].analysis;
    var values = [], resolved = false;
    a.forLoops.forEach(function (f) {
      if (f.reg !== reg) return;
      resolved = true;
      var lo = Math.min(f.from, f.to), hi = Math.max(f.from, f.to);
      if (hi - lo > 10000) return;
      for (var k = lo; k <= hi; k++) values.push(k);
    });
    programs[name].parsed.lines.forEach(function (line) {
      if (line.comment !== null) return;
      var m = line.text.match(new RegExp('^R\\[' + reg + '(?::[^\\]]*)?\\]\\s*=\\s*(.+)$'));
      if (!m) return;
      var rhs = m[1].trim();
      var c = rhs.match(/^\(?\s*(-?\d+)\s*\)?$/);
      if (c) { resolved = true; values.push(parseInt(c[1], 10)); return; }
      var ar = rhs.match(/^\(?\s*AR\[(\d+)\]\s*\)?$/);
      if (ar) {
        var k = parseInt(ar[1], 10) - 1;
        var callers = (graph && graph.calledBy && graph.calledBy[name]) || [];
        if (!callers.length) resolved = true;   // never called: the write never runs
        callers.forEach(function (from) {
          if (!programs[from]) return;
          programs[from].analysis.calls.forEach(function (call) {
            if (call.target !== name) return;
            var arg = (call.args || [])[k];
            var n = arg && arg.match(/^\(?\s*(-?\d+)\s*\)?$/);
            if (n) { resolved = true; values.push(parseInt(n[1], 10)); }
            else values.unknown = true;
          });
        });
        return;
      }
      values.unknown = true;
    });
    if (!resolved || values.unknown) return null;
    return values;
  }

  var api = {
    analyzeProgram: analyzeProgram,
    buildCallGraph: buildCallGraph,
    buildGlobalXref: buildGlobalXref,
    indirectWrites: indirectWrites,
    roots: roots
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucAnalyzer = api;
})(typeof window !== 'undefined' ? window : globalThis);
