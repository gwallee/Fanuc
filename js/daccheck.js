/* DAC Robotics template checks ("DAC checks") over a parsed program library.
 *
 *   DacCheck.check(programs, graph, xref, extern, standard, opts) -> findings
 *     { severity: 'error'|'warn'|'info', level: 'Critical'|'Warning'|'Info',
 *       rule: 'O1'.., title, message, refs: [{prog, line}] }
 *   DacCheck.generation(programs, standard) -> 1 | 2 | 3
 *   DacCheck.isScratch(name, standard)      -> true for -BCKED / TEST / TST_ … programs
 *
 * programs: { NAME: { parsed, analysis } } as the app and robocheck build them.
 * extern (optional): { io: [{type, index, comment}], registers: [...] } — the
 * controller's own labels (IOSTATE.DG / NUMREG.VA). standard: the parsed
 * dac-standard.json; every rule reads its numbers, names and spellings from
 * there. Scratch programs (-BCKED*, TEST, TST_*…) are dropped from the view
 * before any rule runs and reported under H2.
 *
 * Node CLI: node js/daccheck.js <backup folder> [-v] [--json] [--table]
 * A folder holding several controllers (one SUMMARY.DG each) is run per
 * controller. Same idea as CellStudio's js/plcchecks.js.
 */
(function (global) {
  'use strict';

  var isNode = typeof module !== 'undefined' && module.exports;
  var A = isNode ? require('./analyzer.js') : global.FanucAnalyzer;

  var SEV = { Critical: 'error', Warning: 'warn', Info: 'info' };
  var TITLES = {
    O1: 'No speed override write', O2: 'Override program never called', O3: 'Override not set in both loops',
    O4: 'Override forced without restore on every exit', O5: 'Override zero-guard / register label',
    P1: '_INIT_POS missing or not called', P2: '_INIT_POS clears positions without a known-position gate',
    P3: '"At …" output neither BGLogic-owned nor cleared', P4: 'Undefined label in a standard program',
    P5: '_RECOVER tail shape',
    N1: 'Fixed flag label', N2: 'Flag used without a label', N3: 'Dead flag', N4: 'Stale flag label on the controller',
    N5: 'Task-flag suffix', N6: 'Zone-flag block',
    S1: 'Required program missing', S2: 'Standard program never called', S3: '__MANUAL dispatch',
    S4: '__AUTO start shape', S5: 'Standard program name variant',
    H1: 'Undefined error label', H2: 'Leftover test / backup-edit programs', H3: 'Version header',
    H4: 'Fixed I/O label'
  };

  /* ---------- helpers ---------- */

  function glob(pattern) {
    return new RegExp('^' + String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  }
  function matchesAny(name, patterns) {
    return (patterns || []).some(function (p) { return glob(p).test(name); });
  }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function labelOk(label, allowed) {
    var n = norm(label);
    return (allowed || []).some(function (a) { return norm(a) === n; });
  }
  function labelContains(label, allowed) {
    var n = norm(label);
    return (allowed || []).some(function (a) { return n.indexOf(norm(a)) !== -1; });
  }
  function fmtList(arr, max) {
    max = max || 12;
    return arr.length > max ? arr.slice(0, max).join(', ') + ' … +' + (arr.length - max) : arr.join(', ');
  }
  function uniq(arr) { return arr.filter(function (x, i) { return arr.indexOf(x) === i; }); }

  function isScratch(name, std) { return matchesAny(name, std && std.scratchPrograms); }
  function scratchPattern(std) {
    var pats = (std && std.scratchPrograms) || [];
    if (!pats.length) return null;
    return new RegExp(pats.map(function (p) { return glob(p).source; }).join('|'), 'i');
  }

  function generation(programs, std) {
    var g = (std && std.generations) || {};
    var rules = g.detect || [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      var any = (r.anyProgram || []).some(function (p) { return !!programs[p]; });
      var none = !(r.noProgram || []).some(function (p) { return !!programs[p]; });
      if (any && none) return r.gen;
    }
    return g.default || 2;
  }

  /* ---------- the check ---------- */

  function check(programsAll, graphIn, xrefIn, extern, std, opts) {
    opts = opts || {};
    if (!std) throw new Error('DacCheck.check needs the parsed dac-standard.json');
    var findings = [];
    var scratch = [];
    var programs = {};
    Object.keys(programsAll).forEach(function (n) {
      if (isScratch(n, std)) scratch.push(n); else programs[n] = programsAll[n];
    });
    var graph = (scratch.length || !graphIn) ? A.buildCallGraph(programs) : graphIn;
    var xref = (scratch.length || !xrefIn) ? A.buildGlobalXref(programs) : xrefIn;
    var ctrl = { F: {}, DI: {}, DO: {}, R: {} };
    ((extern && extern.io) || []).forEach(function (p) {
      if (ctrl[p.type] && p.comment) ctrl[p.type][p.index] = p.comment;
    });
    ((extern && extern.registers) || []).forEach(function (r) { if (r.comment) ctrl.R[r.index] = r.comment; });

    var ctx = {
      programs: programs, graph: graph, xref: xref, std: std, ctrl: ctrl, scratch: scratch,
      gen: generation(programs, std), findings: findings, hasExternFlags: !!(extern && extern.io && extern.io.some(function (p) { return p.type === 'F'; }))
    };
    ctx.add = function (level, rule, message, refs, extra) {
      var f = { severity: SEV[level], level: level, rule: rule, title: TITLES[rule] || rule, message: message, refs: refs || [] };
      if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
      findings.push(f);
      return f;
    };
    ctx.lines = function (name) { return programs[name] ? programs[name].parsed.lines.filter(function (l) { return l.comment === null; }) : []; };
    ctx.allLines = function (name) { return programs[name] ? programs[name].parsed.lines : []; };
    ctx.find = function (pattern) {   // first program whose name matches pattern (exact or glob)
      var names = Object.keys(programs);
      for (var i = 0; i < names.length; i++) if (glob(pattern).test(names[i])) return names[i];
      return null;
    };
    ctx.findStd = function (name, variants) {   // standard program by name, else by variant
      if (programs[name]) return { name: name, variant: false };
      var v = (variants || []).filter(function (x) { return !!programs[x]; });
      return v.length ? { name: v[0], variant: true } : null;
    };
    ctx.flagLabel = function (n) {
      var e = xref.io['F[' + n + ']'];
      return (e && e.label) || ctrl.F[n] || null;
    };
    ctx.flagLabels = function (n) {   // every distinct spelling: per program (code) and the controller
      var out = [];
      Object.keys(programs).forEach(function (p) {
        var e = programs[p].analysis.io['F[' + n + ']'];
        if (e && e.label) out.push({ label: e.label, prog: p, line: (e.writes[0] || e.reads[0]) });
      });
      if (ctrl.F[n]) out.push({ label: ctrl.F[n], prog: null });
      return out;
    };
    ctx.ioLabel = function (type, n) {
      var e = xref.io[type + '[' + n + ']'];
      return (e && e.label) || ctrl[type][n] || null;
    };
    ctx.isBg = function (name) { return matchesAny(name, std.bglogicPrograms); };
    ctx.indirect = A.indirectWrites(programs, graph);

    overrideRules(ctx);
    positionRules(ctx);
    namingRules(ctx);
    standardProgramRules(ctx);
    hygieneRules(ctx);

    var order = { error: 0, warn: 1, info: 2 };
    findings.sort(function (x, y) {
      return order[x.severity] - order[y.severity] || x.rule.localeCompare(y.rule) ||
        (x.refs[0] && y.refs[0] ? x.refs[0].prog.localeCompare(y.refs[0].prog) || x.refs[0].line - y.refs[0].line : 0);
    });
    findings.generation = ctx.gen;
    return findings;
  }

  /* ---------- O: speed override ---------- */

  function overrideWrites(ctx) {
    var writes = [];      // { prog, line, kind: 'set'|'force'|'restore', reg, value, text }
    var saves = {};       // prog -> { reg: true }
    Object.keys(ctx.programs).forEach(function (name) {
      ctx.lines(name).forEach(function (l) {
        var m = l.text.match(/^R\[(\d+)(?::[^\]]*)?\]\s*=\s*\(?\s*\$MCR\.\$GENOVERRIDE\s*\)?\s*$/i);
        if (m) (saves[name] = saves[name] || {})[m[1]] = true;
      });
    });
    Object.keys(ctx.programs).forEach(function (name) {
      ctx.lines(name).forEach(function (l) {
        var m = l.text.match(/(?:^|,)\s*(?:\$MCR\.\$GENOVERRIDE|OVERRIDE)\s*=\s*(.+)$/i);
        if (!m) return;
        var rhs = m[1].trim();
        var c = rhs.match(/^\(?\s*(\d+)\s*\)?\s*%?$/);
        var r = rhs.match(/R\[(\d+)(?::([^\]]*))?\]/);
        var w = { prog: name, line: l.num, text: l.text, reg: r ? parseInt(r[1], 10) : null, value: c ? parseInt(c[1], 10) : null };
        if (c) w.kind = 'force';
        else if (r && saves[name]) w.kind = saves[name][r[1]] ? 'restore' : 'force';
        else if (r) w.kind = 'set';
        else w.kind = 'force';
        writes.push(w);
      });
    });
    return { writes: writes, saves: saves };
  }

  function overrideRules(ctx) {
    var std = ctx.std, ov = std.override || {};
    var info = overrideWrites(ctx);
    var sets = info.writes.filter(function (w) { return w.kind === 'set'; });
    var setterProgs = uniq(sets.map(function (w) { return w.prog; }));
    var bgSetters = setterProgs.filter(ctx.isBg);
    var calledSetters = setterProgs.filter(function (p) { return !ctx.isBg(p); });
    ctx.overrideSetters = setterProgs;

    // O1 — nobody sets it from a register
    if (!sets.length) {
      var forces = info.writes.filter(function (w) { return w.kind !== 'restore'; });
      ctx.add('Critical', 'O1',
        'No program sets the speed override from a register ($MCR.$GENOVERRIDE= / OVERRIDE=R[n]): whatever the pendant or HMI last left is what runs in auto and manual.' +
        (forces.length ? ' Only save/force/restore pairs exist (' + fmtList(uniq(forces.map(function (w) { return w.prog; }))) + ').' : '') +
        ' Standard: ' + (ov.standard === 'bglogic' ? 'clamp it every scan in _BGLOGIC from the HMI register' : 'CALL ' + ov.programName + ' in the __AUTO main loop and in __MANUAL') + '.',
        forces.map(function (w) { return { prog: w.prog, line: w.line }; }));
    }

    // O2 — the override program exists but nobody calls it
    calledSetters.forEach(function (p) {
      var callers = ctx.graph.calledBy[p] || [];
      if (callers.length) return;
      ctx.add('Critical', 'O2', p + ' writes the speed override but no program calls it — it is dead code, so the override is never set.',
        sets.filter(function (w) { return w.prog === p; }).map(function (w) { return { prog: w.prog, line: w.line }; }));
    });

    // O3 — reached in the __AUTO main loop and in __MANUAL
    if (sets.length && !bgSetters.length) {
      var reach = {};
      var queue = calledSetters.slice();
      calledSetters.forEach(function (p) { reach[p] = true; });
      while (queue.length) {
        var cur = queue.shift();
        (ctx.graph.calledBy[cur] || []).forEach(function (c) { if (!reach[c]) { reach[c] = true; queue.push(c); } });
      }
      var autoName = ctx.findStd((std.auto || {}).program || '__AUTO') ? (std.auto || {}).program || '__AUTO' : null;
      var manual = ctx.findStd((std.manual || {}).program || '__MANUAL', ((std.requiredPrograms || []).filter(function (r) { return r.name === '__MANUAL'; })[0] || {}).variants);
      var autoOk = false, manOk = false, autoCalls = [];
      if (autoName) {
        var a = ctx.programs[autoName].analysis;
        var loop = a.labels[ov.autoMainLoopLabel || 150];
        var from = loop && loop.defLine !== null ? loop.defLine : null;
        var to = loop && loop.jumps.length ? Math.max.apply(null, loop.jumps) : Infinity;
        a.calls.forEach(function (c) {
          if (!reach[c.target] && !(ctx.programs[c.target] && reach[c.target])) return;
          autoCalls.push({ prog: autoName, line: c.line });
          if (from !== null && c.line > from && c.line <= to) autoOk = true;
        });
        if (!autoOk) ctx.add('Warning', 'O3', autoName + ': the override write is not reached inside the main loop (LBL[' + (ov.autoMainLoopLabel || 150) + '] … JMP LBL[' + (ov.autoMainLoopLabel || 150) + '])' +
          (autoCalls.length ? ' — it is called at ' + autoCalls.map(function (r) { return r.prog + ':' + r.line; }).join(', ') + ', which runs once per Start, not every cycle.' : ' — it is not called from ' + autoName + ' at all.'),
          autoCalls);
      }
      if (manual) {
        var mcalls = ctx.programs[manual.name].analysis.calls.filter(function (c) { return reach[c.target]; });
        manOk = mcalls.length > 0;
        if (!manOk) ctx.add('Warning', 'O3', manual.name + ' never sets the override: a manual task runs at whatever speed auto mode left.', []);
      }
      if (autoOk && manOk && ov.standard === 'bglogic') {
        ctx.add('Info', 'O3', 'The override is set by CALL in both loops (' + fmtList(calledSetters) + '). The standard is a BGLogic clamp every scan; the CALL form is ' + (ov.acceptCallInBothLoops ? 'accepted as an alternative.' : 'not the standard.'), autoCalls);
      }
    }

    // O4 — force without restore on every exit path
    Object.keys(ctx.programs).forEach(function (name) {
      var ws = info.writes.filter(function (w) { return w.prog === name; });
      var forces = ws.filter(function (w) { return w.kind === 'force'; });
      if (!forces.length) return;
      var restores = ws.filter(function (w) { return w.kind === 'restore'; });
      var firstForce = Math.min.apply(null, forces.map(function (w) { return w.line; }));
      if (!restores.length) {
        var fv = forces[0].value !== null ? forces[0].value + '%' : 'R[' + forces[0].reg + ']';
        ctx.add(bgSetters.length ? 'Info' : 'Warning', 'O4', name + ' forces the override to ' + fv + ' at line ' + forces[0].line + ' and never restores it' +
          (bgSetters.length ? ' (harmless here: ' + bgSetters[0] + ' rewrites it every scan).' : ' — every program after it runs at that speed.'),
          forces.map(function (w) { return { prog: name, line: w.line }; }));
        return;
      }
      var a = ctx.programs[name].analysis;
      var lines = ctx.lines(name);
      var lastInstr = 0;
      lines.forEach(function (l) { if (l.text && !/^LBL\[/.test(l.text) && !/^END\s*$/.test(l.text)) lastInstr = l.num; });
      var exitLabels = {};
      (ctx.std.exitLabels || []).forEach(function (n) { exitLabels[n] = true; });
      Object.keys(a.labels).forEach(function (n) { var lb = a.labels[n]; if (lb.defLine !== null && lb.defLine > lastInstr) exitLabels[n] = true; });
      var skipped = [];
      lines.forEach(function (l) {
        if (l.num <= firstForce) return;
        var isExit = /^(END|ABORT)\s*$/.test(l.text);
        var jm = l.text.match(/JMP\s+LBL\[\s*(\d+)/);
        if (jm) {
          var n = parseInt(jm[1], 10);
          if (exitLabels[n] || !a.labels[n] || a.labels[n].defLine === null) isExit = true;
        }
        if (!isExit) return;
        var lastF = Math.max.apply(null, forces.filter(function (w) { return w.line < l.num; }).map(function (w) { return w.line; }));
        if (lastF === -Infinity) return;
        var restored = restores.some(function (r) { return r.line > lastF && r.line < l.num; });
        if (!restored) skipped.push(l.num);
      });
      if (skipped.length) ctx.add(bgSetters.length ? 'Info' : 'Warning', 'O4', name + ' saves/forces the override (line ' + firstForce + ') but ' + skipped.length + ' exit path' + (skipped.length > 1 ? 's' : '') + ' (line ' + fmtList(skipped.map(String), 8) + ') leave' + (skipped.length > 1 ? '' : 's') + ' before the restore — an abort or error there leaves the forced speed in place.',
        skipped.map(function (n) { return { prog: name, line: n }; }));
      else if (!bgSetters.length) {
        var lastRestore = Math.max.apply(null, restores.map(function (w) { return w.line; }));
        var inside = lines.filter(function (l) { return l.num > firstForce && l.num < lastRestore && (l.motion || /^(IF\b.*)?\s*,?\s*CALL\s/.test(l.text) || /^CALL\s/.test(l.text)); });
        if (inside.length) ctx.add('Info', 'O4', name + ' forces the override at line ' + firstForce + ' and restores it at line ' + lastRestore + '; a fault or abort in between (' + inside.length + ' motion/CALL line' + (inside.length > 1 ? 's' : '') + ') leaves the forced speed in place because nothing rewrites it every scan.',
          [{ prog: name, line: firstForce }, { prog: name, line: lastRestore }]);
      }
    });

    // O5 — zero guard with no default, register label
    setterProgs.forEach(function (p) {
      var regs = uniq(sets.filter(function (w) { return w.prog === p && w.reg !== null; }).map(function (w) { return w.reg; }));
      regs.forEach(function (reg) {
        var lines = ctx.lines(p);
        var guard = null;
        lines.forEach(function (l) {
          if (guard) return;
          var re = new RegExp('^IF\\s*\\(?\\s*R\\[' + reg + '(?::[^\\]]*)?\\]\\s*(<=|<|=)\\s*\\(?\\s*(0|1)\\s*\\)?');
          var m = l.text.match(re);
          if (m && (m[1] !== '<' || m[2] === '1') && /JMP|END|ABORT/.test(l.text)) guard = l.num;
        });
        var hasDefault = false;
        Object.keys(ctx.programs).forEach(function (n) {
          ctx.lines(n).forEach(function (l) {
            if (new RegExp('^R\\[' + reg + '(?::[^\\]]*)?\\]\\s*=\\s*\\(?\\s*[1-9]\\d*\\s*\\)?\\s*$').test(l.text)) hasDefault = true;
          });
        });
        var hasClamp = lines.some(function (l) { return new RegExp('R\\[' + reg + '(?::[^\\]]*)?\\]\\s*>\\s*\\(?\\s*' + (ov.maxValue || 100)).test(l.text); });
        var xr = ctx.xref.registers[reg];
        var label = (xr && xr.label) || ctx.ctrl.R[reg] || '';
        var notes = [];
        if (guard && !hasDefault) notes.push('line ' + guard + ' skips the write when R[' + reg + '] is 0 and nothing writes a default — a cleared register silently leaves the last speed');
        if (!hasClamp) notes.push('no >' + (ov.maxValue || 100) + ' clamp');
        if (!label) notes.push('R[' + reg + '] has no label (expected "' + (ov.registerLabels || ['OVERRIDE'])[0] + '")');
        else if (!labelContains(label, ov.registerLabels)) notes.push('R[' + reg + '] is labeled "' + label + '" — label it "' + (ov.registerLabels || ['OVERRIDE'])[0] + '" so the HMI speed register can be found by name');
        if (notes.length) ctx.add('Info', 'O5', p + ' override register R[' + reg + ']: ' + notes.join('; ') + '.',
          [{ prog: p, line: guard || sets.filter(function (w) { return w.prog === p; })[0].line }]);
      });
    });
  }

  /* ---------- P: recovery and _INIT_POS ---------- */

  function positionRules(ctx) {
    var std = ctx.std, ip = std.initPos || {}, name = ip.program || '_INIT_POS';
    var rec = ip.recoverProgram || '_RECOVER';
    var initPos = ctx.programs[name];

    // P1
    if (!initPos) {
      ctx.add('Critical', 'P1', name + ' is missing: nothing clears the "At station" outputs after recovery, so the PLC can see the robot at a station it has left.', []);
    } else {
      var callers = ctx.graph.calledBy[name] || [];
      var callRefs = function (from) {
        return ctx.programs[from] ? ctx.programs[from].analysis.calls.filter(function (c) { return c.target === name; }).map(function (c) { return { prog: from, line: c.line }; }) : [];
      };
      var fromStd = (ip.callers || []).filter(function (c) { return callers.indexOf(c) !== -1; });
      var fromLegacy = (ip.legacyCallers || []).filter(function (c) { return callers.indexOf(c) !== -1; });
      if (!fromStd.length) {
        if (fromLegacy.length) ctx.add('Warning', 'P1', name + ' is called from ' + fmtList(fromLegacy) + ' (Gen 2 pattern) but not from ' + fmtList(ip.callers) + ' at the start of every auto Start.', fromLegacy.reduce(function (acc, c) { return acc.concat(callRefs(c)); }, []));
        else ctx.add('Critical', 'P1', name + ' is not called from ' + fmtList(ip.callers) + (callers.length ? ' (only from ' + fmtList(callers) + ')' : ' — nobody calls it') + '.', callers.reduce(function (acc, c) { return acc.concat(callRefs(c)); }, []));
      }
      if (ctx.programs[rec] && callers.indexOf(rec) === -1) {
        ctx.add('Critical', 'P1', rec + ' never calls ' + name + ' — position outputs stay set after a recovery.' + (ctx.lines(rec).some(function (l) { return /Init Pos/i.test(l.text); }) || ctx.allLines(rec).some(function (l) { return l.comment && /init pos/i.test(l.comment); }) ? ' (The "Init Pos" comment is still there; the CALL is gone.)' : ''), []);
      }
    }

    // P2 — known-position gate before the first clear
    if (initPos) {
      var lines = ctx.lines(name);
      var writes = lines.filter(function (l) { return /^DO\[(\d+|R\[\d+[^\]]*\])(?::[^\]]*)?\]\s*=/.test(l.text); });
      if (writes.length) {
        var first = writes[0].num;
        var gateRe = new RegExp(ip.gateLabelPattern || '^At\\b', 'i');
        var gated = lines.some(function (l) {
          if (l.num >= first || !/^IF\b/.test(l.text)) return false;
          if ((ip.gateFlags || []).some(function (f) { return new RegExp('F\\[' + f + '[:\\]]').test(l.text); })) return true;
          var m, re = /\b(DO|DI|F)\[(\d+)(?::([^\]]*))?\]/g;
          while ((m = re.exec(l.text)) !== null) {
            var lab = (m[3] || '').replace(/^(ON|OFF)\s*:\s*/i, '') || ctx.ioLabel(m[1], parseInt(m[2], 10)) || '';
            if (gateRe.test(lab)) return true;
          }
          return false;
        });
        if (!gated) ctx.add('Warning', 'P2', name + ' clears position outputs from line ' + first + ' without first confirming a known position (F[' + (ip.gateFlags || [5])[0] + '] At RefPos or an "At …" output).', [{ prog: name, line: first }]);
      }
    }

    // P3 — every "At …" DO is BGLogic-owned or cleared in _INIT_POS
    var atRe = new RegExp(std.atOutputPattern || '^At\\b', 'i');
    var ipInd = initPos ? A.indirectWrites((function () { var o = {}; o[name] = initPos; return o; })(), ctx.graph).DO : null;
    var clearProgs = ip.clearPrograms || [name];
    var orphans = [];
    Object.keys(ctx.xref.io).forEach(function (key) {
      var e = ctx.xref.io[key];
      if (e.type !== 'DO') return;
      var label = ctx.ioLabel('DO', e.index);
      if (!label || !atRe.test(label)) return;
      // Outputs no program writes are the controller's own (reference
      // positions set At Home / At Safe …); only program-set ones matter.
      var setBy = e.refs.filter(function (r) { return r.write && !ctx.isBg(r.prog) && !matchesAny(r.prog, clearProgs); });
      if (!setBy.length) return;
      var bgOwned = e.refs.some(function (r) { return r.write && ctx.isBg(r.prog); });
      var cleared = e.refs.some(function (r) { return r.write && matchesAny(r.prog, clearProgs); }) ||
        (ipInd && (ipInd.all || ipInd.indices[e.index]));
      if (!bgOwned && !cleared) orphans.push({ key: key, label: label, refs: setBy.map(function (r) { return { prog: r.prog, line: r.line }; }) });
    });
    orphans.forEach(function (o) {
      ctx.add('Warning', 'P3', o.key + ' "' + o.label + '" is set by ' + fmtList(uniq(o.refs.map(function (r) { return r.prog; })), 4) + ' but is neither computed in BGLogic nor cleared in ' + fmtList(clearProgs) + ' — after a recovery it can stay on.', o.refs);
    });

    // P4 / H1 — undefined labels
    var ul = std.undefinedLabels || {};
    Object.keys(ctx.programs).sort().forEach(function (p) {
      var a = ctx.programs[p].analysis;
      var critical = matchesAny(p, ul.critical);
      Object.keys(a.labels).forEach(function (n) {
        var lb = a.labels[n];
        if (lb.defLine !== null || !lb.jumps.length) return;
        var isErr = (ul.errorLabels || []).indexOf(parseInt(n, 10)) !== -1;
        var msg = p + ' jumps to LBL[' + n + '] which is never defined' + (isErr ? ' (the template\'s error label — the error path faults with INTP-267 the first time it is needed)' : ' — INTP-267 at runtime') + '.';
        if (critical) ctx.add('Critical', 'P4', msg, lb.jumps.map(function (l) { return { prog: p, line: l }; }));
        else ctx.add(ul.elsewhere === 'info' ? 'Info' : 'Warning', 'H1', msg, lb.jumps.map(function (l) { return { prog: p, line: l }; }));
      });
    });

    // P5 — _RECOVER tail shape
    var rt = std.recoverTail || {};
    if (ctx.programs[rec] && initPos) {
      var ra = ctx.programs[rec].analysis;
      var starts = (rt.startLabels || [990, 995]).map(function (n) { return ra.labels[n] && ra.labels[n].defLine; }).filter(function (x) { return x != null; });
      if (!starts.length) {
        ctx.add('Info', 'P5', rec + ' has no LBL[' + (rt.startLabels || [990]).join('] / LBL[') + '] tail — the standard ends with LBL[990] home move, LBL[995] CALL ' + name + '.', []);
      } else {
        var start = Math.min.apply(null, starts);
        var issues = [];
        var ipCall = ra.calls.filter(function (c) { return c.target === name && c.line > start; })[0];
        if (!ipCall) issues.push('CALL ' + name + ' is not after LBL[' + start + ']');
        var end = ipCall ? ipCall.line : Infinity;
        var homeRe = new RegExp(rt.homePosRegLabelPattern || 'trans|origin|home', 'i');
        var homeMove = ctx.allLines(rec).some(function (l) {
          if (l.num <= start || l.num >= end) return false;
          if (l.motion) { var m = l.text.match(/PR\[\d+(?::([^\]]*))?\]/); return !!(m && homeRe.test(m[1] || '')) || /PR\[\d+\]/.test(l.text); }
          return false;
        }) || ra.calls.some(function (c) { return c.line > start && c.line < end && (rt.homePrograms || []).indexOf(c.target) !== -1; });
        if (!homeMove) issues.push('no move to the transit/origin PR (or CALL _HOME) between LBL[' + start + '] and ' + name);
        if (rt.waitAtHome) {
          var waited = ctx.lines(rec).some(function (l) { return l.num > start && l.num < end && /^WAIT\b/.test(l.text) && /At Home/i.test(l.text); });
          if (!waited) issues.push('no WAIT DO[At Home] before ' + name);
        }
        if (issues.length) ctx.add('Info', 'P5', rec + ' tail differs from the standard: ' + issues.join('; ') + '.', [{ prog: rec, line: start }]);
      }
    }
  }

  /* ---------- N: flags ---------- */

  function namingRules(ctx) {
    var std = ctx.std, xref = ctx.xref;
    var flagsUsed = Object.keys(xref.io).filter(function (k) { return xref.io[k].type === 'F'; }).map(function (k) { return xref.io[k].index; }).sort(function (a, b) { return a - b; });

    // N1 — fixed table
    Object.keys(std.flags || {}).forEach(function (k) {
      var n = parseInt(k, 10), entry = std.flags[k];
      if (entry.generations && entry.generations.indexOf(ctx.gen) === -1) return;
      var used = xref.io['F[' + n + ']'];
      var bad = ctx.flagLabels(n).filter(function (l) { return !labelOk(l.label, entry.labels); });
      if (!bad.length) return;
      var spellings = uniq(bad.map(function (l) { return l.label; }));
      var where = uniq(bad.map(function (l) { return l.prog || 'the controller'; }));
      ctx.add('Warning', 'N1', 'F[' + n + '] is "' + spellings.join('" / "') + '" in ' + fmtList(where, 6) + '; the template reserves it for "' + entry.meaning + '" (accepted spellings: ' + entry.labels.join(' / ') + ').' + (used ? '' : ' (Label only — not used by any program.)'),
        bad.filter(function (l) { return l.prog; }).map(function (l) { return { prog: l.prog, line: l.line }; }).slice(0, 12));
    });

    // N2 — used without a label
    flagsUsed.forEach(function (n) {
      if (ctx.flagLabel(n)) return;
      var e = xref.io['F[' + n + ']'];
      ctx.add('Warning', 'N2', 'F[' + n + '] is used in logic but has no label in code' + (ctx.hasExternFlags ? ' or on the controller' : '') + '.', e.refs.map(function (r) { return { prog: r.prog, line: r.line }; }));
    });

    // N3 — dead flags after crediting indirect writes and the hand-set list
    var hs = std.handSet || {};
    var indF = ctx.indirect.F;
    var neverWritten = [], neverRead = [];
    flagsUsed.forEach(function (n) {
      var e = xref.io['F[' + n + ']'];
      var label = ctx.flagLabel(n) || '';
      var writes = e.refs.filter(function (r) { return r.write; }).length;
      var reads = e.refs.length - writes;
      var hand = (hs.flags || []).indexOf(n) !== -1 || labelOk(label, hs.flagLabels);
      var credited = indF && (indF.all || indF.indices[n]);
      if (!writes && !credited && !hand) neverWritten.push(n);
      if (writes && !reads) neverRead.push(n);
    });
    var fmtF = function (n) { var l = ctx.flagLabel(n); return 'F[' + n + (l ? ':' + l : '') + ']'; };
    neverWritten.forEach(function (n) {
      var e = xref.io['F[' + n + ']'];
      ctx.add('Info', 'N3', fmtF(n) + ' is read but never written (no direct, indirect F[R[n]] or hand-set source).', e.refs.map(function (r) { return { prog: r.prog, line: r.line }; }));
    });
    neverRead.forEach(function (n) {
      var e = xref.io['F[' + n + ']'];
      ctx.add('Info', 'N3', fmtF(n) + ' is written but never read.', e.refs.map(function (r) { return { prog: r.prog, line: r.line }; }));
    });
    if (indF && indF.all) ctx.add('Info', 'N3', 'An indirect flag write F[R[n]] could not be resolved (' + fmtList(uniq(indF.refs.map(function (r) { return r.prog + ':' + r.line; }))) + '), so every flag counts as possibly written.', indF.refs.map(function (r) { return { prog: r.prog, line: r.line }; }));

    // N4 — labeled on the controller, unused
    if (ctx.hasExternFlags) {
      var stale = Object.keys(ctx.ctrl.F).map(Number).filter(function (n) {
        var c = ctx.ctrl.F[n];
        return !xref.io['F[' + n + ']'] && !/^[\*\-=_]/.test(c.trim());
      }).sort(function (a, b) { return a - b; });
      if (stale.length) ctx.add('Info', 'N4', stale.length + ' flag label' + (stale.length > 1 ? 's' : '') + ' on the controller ' + (stale.length > 1 ? 'have' : 'has') + ' no program use: ' + fmtList(stale.map(function (n) { return 'F[' + n + ':' + ctx.ctrl.F[n] + ']'; }), 20) + '.', []);
    }

    // N5 — task-flag suffix vocabulary
    var tf = std.taskFlags || {};
    if (tf.range && (!tf.generations || tf.generations.indexOf(ctx.gen) !== -1)) {
      var odd = [];
      flagsUsed.forEach(function (n) {
        if (n < tf.range[0] || n > tf.range[1]) return;
        var label = ctx.flagLabel(n);
        if (!label) return;
        var nl = norm(label);
        if ((tf.suffixes || []).some(function (s) { var ns = norm(s); return nl.length > ns.length && nl.slice(-ns.length) === ns; })) return;
        odd.push({ n: n, label: label });
      });
      if (odd.length) ctx.add('Info', 'N5', 'Task flag' + (odd.length > 1 ? 's' : '') + ' in ' + tf.range[0] + '–' + tf.range[1] + ' outside the suffix vocabulary (' + (tf.suffixes || []).join(' / ') + '): ' + fmtList(odd.map(function (o) { return 'F[' + o.n + ':' + o.label + ']'; }), 20) + '.',
        odd.slice(0, 12).map(function (o) { var r = xref.io['F[' + o.n + ']'].refs[0]; return { prog: r.prog, line: r.line }; }));
    }

    // N6 — zone-flag blocks
    var zf = std.zoneFlags || {};
    var zoneRe = new RegExp(zf.labelPattern || 'zn|zone', 'i');
    var inBlock = function (n) { return (zf.blocks || []).some(function (b) { return n >= b.range[0] && n <= b.range[1]; }); };
    var usedInNew = flagsUsed.some(function (n) { return (zf.blocks || []).length && n >= zf.blocks[0].range[0] && n <= zf.blocks[0].range[1]; });
    flagsUsed.forEach(function (n) {
      if (!inBlock(n)) return;
      var label = ctx.flagLabel(n);
      if (!label || zoneRe.test(label)) return;
      var e = xref.io['F[' + n + ']'];
      ctx.add('Warning', 'N6', 'F[' + n + ':' + label + '] sits in the zone-flag block (' + (zf.blocks || []).map(function (b) { return b.range[0] + '–' + b.range[1] + ' ' + b.tool; }).join(', ') + ') but is not labeled as a zone.', e.refs.map(function (r) { return { prog: r.prog, line: r.line }; }));
    });
    if (zf.legacy && (zf.legacy.generations || []).indexOf(ctx.gen) !== -1 && !usedInNew) {
      var legacy = flagsUsed.filter(function (n) { return n >= zf.legacy.range[0] && n <= zf.legacy.range[1]; });
      if (legacy.length) ctx.add('Info', 'N6', 'Zone flags use the legacy block F[' + zf.legacy.range[0] + '–' + zf.legacy.range[1] + '] (Gen ' + ctx.gen + '); the current template puts UT1 zones at ' + zf.blocks[0].range[0] + '–' + zf.blocks[0].range[1] + ' and UT2 at ' + zf.blocks[1].range[0] + '–' + zf.blocks[1].range[1] + '. In use: ' + fmtList(legacy.map(fmtF)) + '.',
        legacy.map(function (n) { var r = xref.io['F[' + n + ']'].refs[0]; return { prog: r.prog, line: r.line }; }));
    }
  }

  /* ---------- S: standard programs ---------- */

  function standardProgramRules(ctx) {
    var std = ctx.std, programs = ctx.programs, graph = ctx.graph;
    var present = {};   // canonical name -> actual name

    // S1 / S5
    (std.requiredPrograms || []).forEach(function (r) {
      var hit = ctx.findStd(r.name, r.variants);
      if (!hit) { ctx.add('Critical', 'S1', r.name + ' is missing from the library' + (r.variants && r.variants.length ? ' (nor any of ' + r.variants.join(', ') + ')' : '') + '.', []); return; }
      present[r.name] = hit.name;
      if (hit.variant) ctx.add('Info', 'S5', hit.name + ' is a name variant of the standard ' + r.name + '.', [{ prog: hit.name, line: 1 }]);
    });
    var ov = std.override || {};
    (ov.programVariants || []).forEach(function (v) {
      if (programs[v]) ctx.add('Info', 'S5', v + ' is a name variant of the standard ' + ov.programName + '.', [{ prog: v, line: 1 }]);
    });

    // S2 — standard program present but never called
    var stdNames = (std.requiredPrograms || []).map(function (r) { return present[r.name]; }).filter(Boolean)
      .concat(std.optionalStandardPrograms || []).concat([ov.programName]).concat(ov.programVariants || []);
    uniq(stdNames).forEach(function (n) {
      if (!programs[n] || matchesAny(n, std.rootPrograms)) return;
      if ((ctx.overrideSetters || []).indexOf(n) !== -1) return;              // O2 owns it
      if (n === ((std.initPos || {}).program || '_INIT_POS')) return;        // P1 owns it
      if ((graph.calledBy[n] || []).length) return;
      ctx.add('Warning', 'S2', n + ' is in the library but no program calls it.', [{ prog: n, line: 1 }]);
    });

    // S3 — __MANUAL dispatch
    var man = std.manual || {};
    var manual = ctx.findStd(man.program || '__MANUAL', ((std.requiredPrograms || []).filter(function (r) { return r.name === (man.program || '__MANUAL'); })[0] || {}).variants);
    if (manual) {
      var mlines = ctx.lines(manual.name);
      var variantsOf = function (target) {
        var r = (std.requiredPrograms || []).filter(function (x) { return x.name === target; })[0];
        return [target].concat((r && r.variants) || []);
      };
      Object.keys(man.tasks || {}).forEach(function (id) {
        var targets = variantsOf(man.tasks[id]);
        var hit = mlines.some(function (l) {
          var cmp = new RegExp('R\\[\\d+(?::[^\\]]*)?\\]\\s*=\\s*\\(?\\s*' + id + '\\s*\\)?\\s*(,|\\)|\\s|$|OR|AND)');
          return cmp.test(l.text) && targets.some(function (t) { return new RegExp('\\bCALL\\s+' + t + '\\b').test(l.text); });
        });
        if (!hit) ctx.add('Warning', 'S3', manual.name + ' does not dispatch manual task ' + id + ' to ' + man.tasks[id] + '.', [{ prog: manual.name, line: 1 }]);
      });
      var exitCalls = mlines.filter(function (l) {
        var m = l.text.match(/\bCALL\s+([A-Z_][A-Z0-9_]*)/);
        if (!m) return false;
        if (/R\[\d+(?::[^\]]*)?\]\s*=\s*\(?\s*\d+/.test(l.text)) return false;   // task dispatch line
        return true;
      });
      var stdExit = exitCalls.filter(function (l) { return (man.autoModeExitCalls || []).some(function (t) { return new RegExp('\\bCALL\\s+' + t + '\\b').test(l.text); }); });
      var legacyExit = exitCalls.filter(function (l) { return (man.legacyAutoModeExitCalls || []).some(function (t) { return new RegExp('\\bCALL\\s+' + t + '\\b').test(l.text); }); });
      if (!stdExit.length) {
        if (legacyExit.length) ctx.add('Info', 'S3', manual.name + ': the auto-mode-detected exit calls ' + legacyExit[0].text.match(/CALL\s+(\S+)/)[1] + ' instead of ' + (man.autoModeExitCalls || [])[0] + ' (Gen 2 pattern).', [{ prog: manual.name, line: legacyExit[0].num }]);
        else ctx.add('Warning', 'S3', manual.name + ': when auto mode is detected the loop should leave through CALL ' + (man.autoModeExitCalls || ['_RECOVER'])[0] + '; no such call found outside the task dispatch.', [{ prog: manual.name, line: 1 }]);
      }
    }

    // S4 — __AUTO start block and main loop
    var au = std.auto || {};
    var autoName = au.program || '__AUTO';
    if (programs[autoName]) {
      var a = programs[autoName].analysis;
      var initCall = a.calls.filter(function (c) { return c.target === (au.initProgram || '_INIT'); })[0];
      var recCall = a.calls.filter(function (c) { return c.target === (au.recoverProgram || '_RECOVER'); })[0];
      if (!initCall) ctx.add('Warning', 'S4', autoName + ' never calls ' + (au.initProgram || '_INIT') + ' at Start.', []);
      if (!recCall) ctx.add('Warning', 'S4', autoName + ' never calls ' + (au.recoverProgram || '_RECOVER') + ' at Start.', []);
      if (initCall && recCall && initCall.line > recCall.line) ctx.add('Warning', 'S4', autoName + ' calls ' + recCall.target + ' (line ' + recCall.line + ') before ' + initCall.target + ' (line ' + initCall.line + ') — the standard initializes first.', [{ prog: autoName, line: recCall.line }, { prog: autoName, line: initCall.line }]);
      var loop = a.labels[au.mainLoopLabel || 150];
      if (!loop || loop.defLine === null) {
        ctx.add('Warning', 'S4', autoName + ' has no LBL[' + (au.mainLoopLabel || 150) + '] main loop.', []);
      } else {
        var to = loop.jumps.length ? Math.max.apply(null, loop.jumps) : Infinity;
        var guarded = ctx.lines(autoName).some(function (l) {
          return l.num > loop.defLine && l.num <= to && new RegExp('F\\[' + (au.sysChecksFlag || 101) + '[:\\]]').test(l.text) && new RegExp('CALL\\s+' + (au.sysChecksProgram || '_SYS_CHECKS') + '\\b').test(l.text);
        });
        if (!guarded) ctx.add('Warning', 'S4', autoName + ' main loop (LBL[' + (au.mainLoopLabel || 150) + ']) lacks the IF F[' + (au.sysChecksFlag || 101) + '], CALL ' + (au.sysChecksProgram || '_SYS_CHECKS') + ' guard.', [{ prog: autoName, line: loop.defLine }]);
      }
    }
  }

  /* ---------- H: hygiene ---------- */

  function hygieneRules(ctx) {
    var std = ctx.std;

    // H2 — leftover programs (already excluded from the view)
    if (ctx.scratch.length) {
      var list = ctx.scratch.slice().sort();
      ctx.add('Info', 'H2', list.length + ' leftover test / backup-edit program' + (list.length > 1 ? 's' : '') + ' on the controller (excluded from these checks and the cross-reference): ' + fmtList(list, 20) + '.',
        list.map(function (p) { return { prog: p, line: 1 }; }));
    }

    // H3 — version headers
    var vh = std.versionHeader || {};
    if (vh.pattern) {
      var re = new RegExp(vh.pattern, 'i');
      var hits = [];
      Object.keys(ctx.programs).sort().forEach(function (p) {
        ctx.allLines(p).forEach(function (l) {
          if (l.comment === null) return;
          var m = l.comment.match(re);
          if (m) hits.push({ prog: p, line: l.num, ver: m[1], date: m[2] });
        });
      });
      if (hits.length) {
        var versions = uniq(hits.map(function (h) { return h.ver + ' ' + h.date; }));
        var level = vh.severity === 'warn' ? 'Warning' : 'Info';
        var bad = vh.expected ? hits.filter(function (h) { return (h.ver + ' ' + h.date) !== vh.expected && h.ver !== vh.expected; }) : [];
        if (bad.length) ctx.add('Warning', 'H3', bad.length + ' program' + (bad.length > 1 ? 's carry' : ' carries') + ' a Ver: header other than ' + vh.expected + ': ' + fmtList(uniq(bad.map(function (h) { return h.prog + ' (' + h.ver + ' ' + h.date + ')'; }))) + '.', bad.map(function (h) { return { prog: h.prog, line: h.line }; }));
        else ctx.add(level, 'H3', hits.length + ' of ' + Object.keys(ctx.programs).length + ' programs carry a Ver: header (' + versions.join('; ') + '): ' + fmtList(hits.map(function (h) { return h.prog; })) + '. Nothing checks these against a library version yet.', hits.map(function (h) { return { prog: h.prog, line: h.line }; }));
      }
    }

    // H4 — fixed I/O table
    var fio = std.fixedIO || {};
    Object.keys(fio).forEach(function (type) {
      Object.keys(fio[type]).forEach(function (k) {
        var n = parseInt(k, 10), entry = fio[type][k];
        var key = type + '[' + n + ']';
        var used = ctx.xref.io[key];
        var label = ctx.ioLabel(type, n);
        if (label) {
          if (!labelOk(label, entry.labels)) ctx.add('Warning', 'H4', key + ' is "' + label + '" here; the DAC I/O standard has "' + entry.meaning + '" (accepted: ' + entry.labels.join(' / ') + ').' + (used ? '' : ' (Label only — not used by any program.)'),
            used ? used.refs.slice(0, 12).map(function (r) { return { prog: r.prog, line: r.line }; }) : []);
        } else if (!used && !entry.optional) {
          ctx.add('Info', 'H4', key + ' "' + entry.meaning + '" from the DAC I/O standard is neither labeled nor used here.', []);
        }
      });
    });
  }

  /* ---------- Node: backup loading and CLI ---------- */

  function loadBackup(dir) {
    var fs = require('fs'), path = require('path');
    var P = require('./parser.js'), VA = require('./vaparse.js');
    var files = [];
    (function walk(d) {
      fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
        var p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else files.push(p);
      });
    })(dir);
    var programs = {}, dupes = [];
    files.filter(function (f) { return /\.ls$/i.test(f); })
      .sort(function (a, b) { return a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b); })
      .forEach(function (f) {
        var src = fs.readFileSync(f, 'latin1');
        if (!/^\/PROG\b/m.test(src)) return;
        var parsed = P.parseLS(src, path.basename(f));
        var name = parsed.name.toUpperCase();
        if (programs[name]) { dupes.push(name); return; }
        programs[name] = { parsed: parsed, analysis: A.analyzeProgram(parsed), file: path.relative(dir, f) };
      });
    var extern = null;
    var ioFile = files.filter(function (f) { return /[\\/]iostate\.dg$/i.test(f) && path.dirname(f) === dir; })[0];
    var nrFile = files.filter(function (f) { return /[\\/]numreg\.va$/i.test(f) && path.dirname(f) === dir; })[0];
    if (ioFile || nrFile) {
      extern = { source: 'backup', io: [], registers: [] };
      if (ioFile) extern.io = VA.parseIOState(fs.readFileSync(ioFile, 'latin1'));
      if (nrFile) extern.registers = VA.parseNumreg(fs.readFileSync(nrFile, 'latin1'));
    }
    var info = {};
    var sumFile = files.filter(function (f) { return /[\\/]summary\.dg$/i.test(f) && path.dirname(f) === dir; })[0];
    if (sumFile) {
      var sum = fs.readFileSync(sumFile, 'latin1');
      info.date = (sum.match(/DATE:\s*([^\r\n]+)/) || [])[1];
      info.version = (sum.match(/\$VERSION:\s*(V[\d.]+)/) || [])[1];
    }
    var graph = A.buildCallGraph(programs), xref = A.buildGlobalXref(programs);
    return { programs: programs, graph: graph, xref: xref, extern: extern, info: info, dupes: dupes };
  }

  /* Controller folders under root: every folder with a SUMMARY.DG that is not
   * inside another such folder; root itself when it holds .LS files directly. */
  function controllerDirs(root) {
    var fs = require('fs'), path = require('path');
    var out = [];
    (function walk(d) {
      var names = fs.readdirSync(d, { withFileTypes: true });
      if (names.some(function (e) { return e.isFile() && /^summary\.dg$/i.test(e.name); })) { out.push(d); return; }
      names.forEach(function (e) { if (e.isDirectory() && e.name !== '.claude') walk(path.join(d, e.name)); });
    })(root);
    if (!out.length && fs.readdirSync(root).some(function (n) { return /\.ls$/i.test(n); })) out.push(root);
    return out;
  }

  function loadStandard(file) {
    var fs = require('fs'), path = require('path');
    return JSON.parse(fs.readFileSync(file || path.join(__dirname, '..', 'dac-standard.json'), 'utf8'));
  }

  function cli(argv) {
    var path = require('path');
    var args = argv.filter(function (a) { return a[0] !== '-'; });
    var verbose = argv.indexOf('-v') !== -1, json = argv.indexOf('--json') !== -1, table = argv.indexOf('--table') !== -1;
    if (!args[0]) {
      console.error('usage: node js/daccheck.js <backup folder> [-v] [--json] [--table]');
      process.exit(2);
    }
    var std = loadStandard();
    var root = path.resolve(args[0]);
    var dirs = controllerDirs(root);
    var results = [];
    dirs.forEach(function (dir) {
      var lib = loadBackup(dir);
      var findings = check(lib.programs, lib.graph, lib.xref, lib.extern, std);
      var counts = {};
      findings.forEach(function (f) { counts[f.rule] = (counts[f.rule] || 0) + 1; });
      results.push({ id: path.relative(root, dir).replace(/\\/g, '/') || path.basename(root), dir: dir, generation: findings.generation, info: lib.info, programs: Object.keys(lib.programs).length, counts: counts, findings: findings });
    });
    if (json) { console.log(JSON.stringify(results.map(function (r) { return { id: r.id, generation: r.generation, counts: r.counts, findings: r.findings }; }), null, 1)); return; }
    if (table) {
      var rules = Object.keys(TITLES);
      console.log('controller'.padEnd(36) + 'gen ' + rules.map(function (r) { return r.padEnd(4); }).join(''));
      results.forEach(function (r) { console.log(r.id.padEnd(36) + String(r.generation).padEnd(4) + rules.map(function (k) { return String(r.counts[k] || 0).padEnd(4); }).join('')); });
      return;
    }
    results.forEach(function (r) {
      var errs = r.findings.filter(function (f) { return f.severity === 'error'; }).length;
      var warns = r.findings.filter(function (f) { return f.severity === 'warn'; }).length;
      console.log('\n== ' + r.id + '  (Gen ' + r.generation + (r.info.version ? ', ' + r.info.version : '') + (r.info.date ? ', ' + r.info.date.trim() : '') + ', ' + r.programs + ' programs)  ' + errs + ' critical, ' + warns + ' warnings, ' + (r.findings.length - errs - warns) + ' info');
      var byRule = {};
      r.findings.forEach(function (f) { (byRule[f.rule] = byRule[f.rule] || []).push(f); });
      Object.keys(byRule).forEach(function (rule) {
        var g = byRule[rule];
        console.log('  ' + g[0].level.padEnd(8) + ' ' + rule + ' ' + (TITLES[rule] || '') + ' (' + g.length + ')');
        if (verbose) g.forEach(function (f) {
          console.log('      - ' + f.message + (f.refs.length ? '  [' + f.refs.slice(0, 6).map(function (x) { return x.prog + ':' + x.line; }).join(' ') + (f.refs.length > 6 ? ' …' : '') + ']' : ''));
        });
      });
    });
  }

  var api = { check: check, generation: generation, isScratch: isScratch, scratchPattern: scratchPattern, TITLES: TITLES, SEV: SEV };
  if (isNode) {
    api.loadBackup = loadBackup;
    api.controllerDirs = controllerDirs;
    api.loadStandard = loadStandard;
    module.exports = api;
    if (require.main === module) cli(process.argv.slice(2));
  }
  global.DacCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
