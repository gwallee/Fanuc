/* Static program checks over the parsed library.
 * lint(programs, graph, xref, extern?) -> findings:
 *   { severity: 'error'|'warn'|'info', rule, message, refs: [{prog, line}] }
 * Comment lines are never counted as uses — the analyzer skips them.
 * extern (optional): controller-side data for labeled-but-never-used checks —
 *   { source, registers: [{index, comment}], io: [{type, index, comment}] }
 */
(function (global) {
  'use strict';

  function lint(programs, graph, xref, extern) {
    var findings = [];
    var names = Object.keys(programs).sort();

    names.forEach(function (name) {
      var a = programs[name].analysis;
      var parsed = programs[name].parsed;

      // --- labels ---
      Object.keys(a.labels).forEach(function (n) {
        var lb = a.labels[n];
        if (lb.defLine === null && lb.jumps.length) {
          findings.push({
            severity: 'error',
            rule: 'jump-to-missing-label',
            message: name + ' jumps to LBL[' + n + '] but never defines it — the robot faults with INTP-267 at runtime.',
            refs: lb.jumps.map(function (l) { return { prog: name, line: l }; })
          });
        }
        if (lb.defLines && lb.defLines.length > 1) {
          findings.push({
            severity: 'error',
            rule: 'duplicate-label',
            message: name + ' defines LBL[' + n + '] ' + lb.defLines.length + ' times — jumps land on the first definition only.',
            refs: lb.defLines.map(function (l) { return { prog: name, line: l }; })
          });
        }
        if (lb.defLine !== null && lb.jumps.length === 0) {
          findings.push({
            severity: 'info',
            rule: 'unused-label',
            message: name + ': LBL[' + n + '] is defined but nothing jumps to it.',
            refs: [{ prog: name, line: lb.defLine }]
          });
        }
      });

      // --- handshake without motion: DO[n]=ON answered by WAIT DI/RI with no
      // move between them. The convention is: set the output, START THE MOVE,
      // then wait for the reply at the destination — otherwise the robot sits
      // idle for the whole communication round-trip.
      // Motion, CALL/RUN (may contain motion), and LBL (merge point) reset it.
      var pendingDO = null;
      parsed.lines.forEach(function (line) {
        if (line.comment !== null) return;
        var t = line.text;
        if (line.motion) { pendingDO = null; return; }
        if (/^(CALL|RUN)\b/.test(t) || /^LBL\[/.test(t)) pendingDO = null;
        var dm = t.match(/^DO\[(\d+)(?::([^\]]*))?\]\s*=\s*ON\b/);
        if (dm) { pendingDO = { key: 'DO[' + dm[1] + ']', line: line.num }; return; }
        if (pendingDO && /^WAIT\b/.test(t) && /\b(DI|RI)\[\d+/.test(t)) {
          findings.push({
            severity: 'warn',
            rule: 'handshake-without-motion',
            message: name + ': ' + pendingDO.key + '=ON (line ' + pendingDO.line + ') is answered by a WAIT on an input at line ' + line.num +
              ' with no motion between them — the robot sits idle for the whole handshake. Start the move after setting the output, then WAIT at the destination.',
            refs: [{ prog: name, line: pendingDO.line }, { prog: name, line: line.num }]
          });
          pendingDO = null;
        }
      });

      // --- unreachable code after an unconditional JMP / END / ABORT ---
      for (var i = 0; i < parsed.lines.length - 1; i++) {
        var line = parsed.lines[i];
        if (line.comment !== null) continue;
        if (!/^(JMP\s+LBL\[|END\s*$|ABORT\s*$)/.test(line.text)) continue;
        // find the next non-comment line; it's unreachable unless it's a label
        for (var k = i + 1; k < parsed.lines.length; k++) {
          var nx = parsed.lines[k];
          if (nx.comment !== null) continue;
          if (!/^LBL\[/.test(nx.text)) {
            findings.push({
              severity: 'warn',
              rule: 'unreachable-code',
              message: name + ' line ' + nx.num + ' can never run — line ' + line.num + ' (' + line.text.split(' ')[0] + ') always leaves before it.',
              refs: [{ prog: name, line: nx.num }]
            });
          }
          break;
        }
      }
    });

    // --- calls to programs missing from the library ---
    Object.keys(graph.unresolved).sort().forEach(function (target) {
      var refs = [];
      Object.keys(programs).forEach(function (name) {
        programs[name].analysis.calls.forEach(function (c) {
          if (c.target === target) refs.push({ prog: name, line: c.line });
        });
      });
      findings.push({
        severity: 'warn',
        rule: 'call-missing-program',
        message: 'CALL ' + target + ' — program is not in the library. Import its .LS, or the call faults (INTP-311) if it is missing on the robot too.',
        refs: refs
      });
    });

    // --- unlabeled registers / position registers / I/O in active lines ---
    unlabeled(findings, xref.registers, function (n) { return 'R[' + n + ']'; }, 'unlabeled-register',
      'has no comment/label anywhere in the library. Name it on the DATA screen so the code stays readable.');
    unlabeled(findings, xref.posRegs, function (n) { return 'PR[' + n + ']'; }, 'unlabeled-posreg',
      'has no comment/label anywhere in the library.');
    Object.keys(xref.io).sort().forEach(function (key) {
      var e = xref.io[key];
      if (e.label) return;
      findings.push({
        severity: 'warn',
        rule: 'unlabeled-io',
        message: key + ' is used without an I/O comment. Label it on the I/O screen so wiring intent is clear.',
        refs: e.refs.map(function (r) { return { prog: r.prog, line: r.line }; })
      });
    });

    // --- registers read but never written anywhere ---
    Object.keys(xref.registers).forEach(function (n) {
      var e = xref.registers[n];
      var hasWrite = e.refs.some(function (r) { return r.write; });
      if (!hasWrite) {
        findings.push({
          severity: 'info',
          rule: 'register-never-written',
          message: 'R[' + n + ']' + (e.label ? ' ("' + e.label + '")' : '') + ' is read but never written by any program here — its value must come from elsewhere (HMI, another task, or manual entry).',
          refs: e.refs.map(function (r) { return { prog: r.prog, line: r.line }; })
        });
      }
    });

    // --- labeled on the controller but never used in any program ---
    if (extern) {
      var src = extern.source ? ' (' + extern.source + ')' : '';
      (extern.registers || []).forEach(function (r) {
        if (!r.comment || xref.registers[r.index]) return;
        findings.push({
          severity: 'info',
          rule: 'labeled-never-used-register',
          message: 'R[' + r.index + '] ("' + r.comment + '") is labeled on the controller' + src + ' but no program in the library uses it.',
          refs: []
        });
      });
      (extern.io || []).forEach(function (p) {
        var key = p.type + '[' + p.index + ']';
        if (!p.comment || xref.io[key]) return;
        findings.push({
          severity: 'info',
          rule: 'labeled-never-used-io',
          message: key + ' ("' + p.comment + '") is labeled on the controller' + src + ' but no program in the library uses it.',
          refs: []
        });
      });
    }

    var order = { error: 0, warn: 1, info: 2 };
    findings.sort(function (x, y) {
      return order[x.severity] - order[y.severity] ||
        x.rule.localeCompare(y.rule) ||
        (x.refs[0] && y.refs[0] ? x.refs[0].prog.localeCompare(y.refs[0].prog) || x.refs[0].line - y.refs[0].line : 0);
    });
    return findings;
  }

  function unlabeled(findings, map, fmt, rule, tail) {
    Object.keys(map).map(Number).sort(function (a, b) { return a - b; }).forEach(function (n) {
      var e = map[n];
      if (e.label) return;
      findings.push({
        severity: 'warn',
        rule: rule,
        message: fmt(n) + ' ' + tail,
        refs: e.refs.map(function (r) { return { prog: r.prog, line: r.line }; })
      });
    });
  }

  var api = { lint: lint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucLinter = api;
})(typeof window !== 'undefined' ? window : globalThis);
