/* Plain-English explanations for FANUC TP instructions. */
(function (global) {
  'use strict';

  function label(txt) { return txt ? ' ("' + txt.trim() + '")' : ''; }

  function describeTarget(text) {
    var m = text.match(/^P\[(\d+)(?::\s*"?([^\]"]*)"?)?\]/);
    if (m) return 'position P[' + m[1] + ']' + label(m[2]);
    m = text.match(/^PR\[(?:GP\d+\s*:\s*)?(\d+)(?::([^\]]*))?\]/);
    if (m) return 'position register PR[' + m[1] + ']' + label(m[2]);
    return 'a position';
  }

  function describeSpeed(text) {
    var m;
    if ((m = text.match(/(\d+(?:\.\d+)?)\s*%/)))        return m[1] + '% of max joint speed';
    if ((m = text.match(/(\d+(?:\.\d+)?)\s*mm\/sec/)))  return m[1] + ' mm/sec';
    if ((m = text.match(/(\d+(?:\.\d+)?)\s*cm\/min/)))  return m[1] + ' cm/min';
    if ((m = text.match(/(\d+(?:\.\d+)?)\s*(inch\/min|deg\/sec|sec|msec)/))) return m[1] + ' ' + m[2];
    if (/max_speed/i.test(text)) return 'maximum speed';
    if ((m = text.match(/R\[(\d+)[^\]]*\]\s*(%|mm\/sec)?/))) return 'speed from R[' + m[1] + ']';
    return 'programmed speed';
  }

  function describeTerm(text) {
    var m;
    if (/\bFINE\b/.test(text)) return 'stop exactly at the point (FINE)';
    if ((m = text.match(/\bCNT\s*(\d+)/))) return 'blend through the point (CNT' + m[1] + (m[1] === '100' ? ', maximum rounding' : '') + ')';
    if ((m = text.match(/\bCD\s*(\d+)/))) return 'corner distance CD' + m[1];
    return null;
  }

  function motionOptions(text) {
    var opts = [];
    var m;
    if ((m = text.match(/ACC\s*(\d+)/))) opts.push('acceleration override ' + m[1] + '%');
    if (/\bOffset,\s*PR\[(\d+)/.test(text)) {
      m = text.match(/Offset,\s*PR\[(\d+)(?::([^\]]*))?\]/);
      opts.push('offset by PR[' + m[1] + ']' + label(m[2]));
    } else if (/\bOffset\b/.test(text)) opts.push('apply the active OFFSET CONDITION');
    if (/\bTool_Offset/.test(text)) opts.push('tool offset applied');
    if ((m = text.match(/TIME BEFORE\s+([\d.]+)sec,?\s*(.*)$/i))) opts.push('start "' + m[2].replace(/\s*;?\s*$/, '') + '" ' + m[1] + 's before reaching the point');
    if ((m = text.match(/DB\s+([\d.]+)mm/i))) opts.push('distance-before trigger at ' + m[1] + ' mm');
    if (/\bRTCP\b/.test(text)) opts.push('remote TCP');
    if (/\bPTH\b/.test(text)) opts.push('path priority (PTH)');
    if ((m = text.match(/\bWjnt\b/))) opts.push('wrist joint motion (no wrist flip control)');
    if ((m = text.match(/Skip,\s*LBL\[(\d+)[^\]]*\]/))) opts.push('skip to LBL[' + m[1] + '] if the skip condition is met');
    if ((m = text.match(/\bAP_LD\s*(\d+)/))) opts.push('approach linear distance ' + m[1]);
    if ((m = text.match(/\bBREAK\b/))) opts.push('BREAK (stop lookahead)');
    return opts;
  }

  var IO_NAMES = {
    DI: 'digital input', DO: 'digital output', RI: 'robot input', RO: 'robot output',
    GI: 'group input', GO: 'group output', UI: 'UOP input', UO: 'UOP output',
    SI: 'operator-panel input', SO: 'operator-panel output', AI: 'analog input',
    AO: 'analog output', WI: 'weld input', WO: 'weld output', F: 'flag', M: 'marker'
  };

  function humanizeExpr(expr) {
    if (!expr) return expr;
    var s = ' ' + expr + ' ';
    s = s.replace(/\bR\[(\d+):([^\]]*)\]/g, 'R[$1] ("$2")');
    s = s.replace(/\bPR\[(\d+):([^\]]*)\]/g, 'PR[$1] ("$2")');
    s = s.replace(new RegExp('(^|[\\s(])(' + Object.keys(IO_NAMES).join('|') + ')\\[(\\d+)\\]', 'g'),
      function (_, pre, t, n) { return pre + IO_NAMES[t] + ' ' + t + '[' + n + ']'; });
    s = s.replace(new RegExp('\\b(' + Object.keys(IO_NAMES).join('|') + ')\\[(\\d+):([^\\]]*)\\]', 'g'),
      function (_, t, n, lbl) { return IO_NAMES[t] + ' ' + t + '[' + n + '] ("' + lbl.trim() + '")'; });
    s = s.replace(/<>/g, ' is not equal to ').replace(/>=/g, ' is at least ').replace(/<=/g, ' is at most ');
    s = s.replace(/([^<>=])=([^=])/g, '$1 equals $2');
    s = s.replace(/</g, ' is less than ').replace(/>/g, ' is greater than ');
    s = s.replace(/\bAND\b/g, 'and').replace(/\bOR\b/g, 'or');
    return s.replace(/\s+/g, ' ').trim();
  }

  var RULES = [
    { re: /^UFRAME_NUM\s*=\s*(\d+)/, fn: function (m) { return 'Select user frame ' + m[1] + ' as the active coordinate frame.'; } },
    { re: /^UTOOL_NUM\s*=\s*(\d+)/, fn: function (m) { return 'Select tool frame ' + m[1] + ' as the active TCP.'; } },
    { re: /^PAYLOAD\[(\d+)(?::([^\]]*))?\]/, fn: function (m) { return 'Switch to payload schedule ' + m[1] + label(m[2]) + '.'; } },
    { re: /^OVERRIDE\s*=\s*(\d+)\s*%/, fn: function (m) { return 'Set the general speed override to ' + m[1] + '%.'; } },
    { re: /^CALL\s+([A-Z0-9_]+)(\((.*)\))?/i, fn: function (m) { return 'Call subprogram ' + m[1] + (m[3] ? ' with arguments (' + m[3] + ')' : '') + ', then continue here when it finishes.'; } },
    { re: /^RUN\s+([A-Z0-9_]+)/i, fn: function (m) { return 'Start program ' + m[1] + ' as a parallel task (multitasking) and continue immediately.'; } },
    { re: /^LBL\[(\d+)(?::([^\]]*))?\]/, fn: function (m) { return 'Label ' + m[1] + label(m[2]) + ' — a jump target; does nothing by itself.'; } },
    { re: /^JMP\s+LBL\[(\d+)(?::([^\]]*))?\]/, fn: function (m) { return 'Jump unconditionally to label ' + m[1] + label(m[2]) + '.'; } },
    { re: /^IF\s+(.*?),\s*JMP\s+LBL\[(\d+)[^\]]*\]/, fn: function (m) { return 'If ' + humanizeExpr(m[1]) + ', jump to label ' + m[2] + '; otherwise continue to the next line.'; } },
    { re: /^IF\s+(.*?),\s*CALL\s+([A-Z0-9_]+)/i, fn: function (m) { return 'If ' + humanizeExpr(m[1]) + ', call subprogram ' + m[2] + '.'; } },
    { re: /^IF\s*\((.*)\)\s*THEN/, fn: function (m) { return 'If ' + humanizeExpr(m[1]) + ', run the block until ENDIF (mixed-logic IF/THEN).'; } },
    { re: /^ELSE\b/, fn: function () { return 'Otherwise — run this block when the IF condition was false.'; } },
    { re: /^ENDIF\b/, fn: function () { return 'End of the IF/THEN block.'; } },
    { re: /^SELECT\s+R\[(\d+)(?::([^\]]*))?\]\s*=\s*(\d+),\s*(JMP\s+LBL\[(\d+)[^\]]*\]|CALL\s+([A-Z0-9_]+))/, fn: function (m) {
        return 'Multi-way branch on R[' + m[1] + ']' + label(m[2]) + ': if it equals ' + m[3] + ', ' + (m[5] ? 'jump to label ' + m[5] : 'call ' + m[6]) + '. Following "= value" lines are the other cases.';
      } },
    { re: /^\s*=\s*(\d+),\s*(JMP\s+LBL\[(\d+)[^\]]*\]|CALL\s+([A-Z0-9_]+))/, fn: function (m) {
        return 'SELECT case: if the tested register equals ' + m[1] + ', ' + (m[3] ? 'jump to label ' + m[3] : 'call ' + m[4]) + '.';
      } },
    { re: /^ELSE,\s*(JMP\s+LBL\[(\d+)[^\]]*\]|CALL\s+([A-Z0-9_]+))/, fn: function (m) {
        return 'SELECT default case: ' + (m[2] ? 'jump to label ' + m[2] : 'call ' + m[3]) + ' when no case matched.';
      } },
    { re: /^FOR\s+R\[(\d+)[^\]]*\]\s*=\s*(.+?)\s+TO\s+(.+)/, fn: function (m) { return 'Loop: repeat the block until ENDFOR, counting R[' + m[1] + '] from ' + m[2] + ' to ' + m[3] + '.'; } },
    { re: /^ENDFOR\b/, fn: function () { return 'End of the FOR loop — jumps back to the FOR line while the counter is in range.'; } },
    { re: /^WAIT\s+([\d.]+)\s*\(?sec\)?/, fn: function (m) { return 'Pause the program for ' + m[1] + ' seconds.'; } },
    { re: /^WAIT\s+(.*?)(?:\s+TIMEOUT,?\s*LBL\[(\d+)[^\]]*\])?$/, fn: function (m) {
        var s = 'Wait here until ' + humanizeExpr(m[1]) + '.';
        if (m[2]) s += ' If the $WAITTMOUT timeout expires first, jump to label ' + m[2] + '.';
        return s;
      } },
    { re: /^TIMER\[(\d+)\]\s*=\s*(START|STOP|RESET)/, fn: function (m) {
        var act = { START: 'Start', STOP: 'Stop', RESET: 'Reset to zero' }[m[2]];
        return act + ' program timer ' + m[1] + '.';
      } },
    { re: /^(DO|RO|UO|SO|F|M)\[(\d+)(?::([^\]]*))?\]\s*=\s*(ON|OFF)/, fn: function (m) {
        return 'Turn ' + IO_NAMES[m[1]] + ' ' + m[1] + '[' + m[2] + ']' + label(m[3]) + ' ' + m[4] + '.';
      } },
    { re: /^(DO|RO|F|M)\[(\d+)(?::([^\]]*))?\]\s*=\s*PULSE(?:,\s*([\d.]+)\s*sec)?/, fn: function (m) {
        return 'Pulse ' + m[1] + '[' + m[2] + ']' + label(m[3]) + ' on' + (m[4] ? ' for ' + m[4] + ' s' : ' for the default pulse width') + ', then back off.';
      } },
    { re: /^(GO|AO)\[(\d+)(?::([^\]]*))?\]\s*=\s*(.+)/, fn: function (m) {
        return 'Write ' + humanizeExpr(m[4]) + ' to ' + IO_NAMES[m[1]] + ' ' + m[1] + '[' + m[2] + ']' + label(m[3]) + '.';
      } },
    { re: /^R\[(\d+)(?::([^\]]*))?\]\s*=\s*(.+)/, fn: function (m) {
        return 'Set register R[' + m[1] + ']' + label(m[2]) + ' to ' + humanizeExpr(m[3]) + '.';
      } },
    { re: /^PR\[(\d+)(?::([^\]]*))?\]\s*=\s*(.+)/, fn: function (m) {
        return 'Set position register PR[' + m[1] + ']' + label(m[2]) + ' to ' + humanizeExpr(m[3]) + '.';
      } },
    { re: /^PR\[(\d+)(?::[^\]]*)?\s*,\s*(\d+)\]\s*=\s*(.+)/, fn: function (m) {
        var comp = ['', 'X', 'Y', 'Z', 'W', 'P', 'R'][parseInt(m[2], 10)] || ('component ' + m[2]);
        return 'Set the ' + comp + ' component of PR[' + m[1] + '] to ' + humanizeExpr(m[3]) + '.';
      } },
    { re: /^MESSAGE\s*\[(.*)\]/, fn: function (m) { return 'Show the message "' + m[1] + '" on the teach pendant USER screen.'; } },
    { re: /^UALM\[(\d+)\]/, fn: function (m) { return 'Post user alarm ' + m[1] + ' — the robot faults with the configured alarm text.'; } },
    { re: /^ABORT\b/, fn: function () { return 'Abort this program (and its children) immediately.'; } },
    { re: /^PAUSE\b/, fn: function () { return 'Pause program execution until the operator resumes.'; } },
    { re: /^END\b/, fn: function () { return 'End of program — return to the caller (or stop, if this is the top level).'; } },
    { re: /^\$(.+?)\s*=\s*(.+)/, fn: function (m) { return 'Write ' + m[2] + ' to system variable $' + m[1] + '.'; } },
    { re: /^R\[(\d+)[^\]]*\]$/, fn: function (m) { return 'Reference register R[' + m[1] + '] (no-op line).'; } }
  ];

  function explainLine(line) {
    if (line.comment !== null && line.comment !== undefined) {
      return 'Comment: ' + line.comment;
    }
    var text = line.text;
    if (!text) return 'Blank line.';

    if (line.motion) {
      var kinds = {
        J: 'Joint move (fastest path in joint space, tool path not straight)',
        L: 'Linear move (tool travels in a straight line)',
        C: 'Circular move (arc through a via point)',
        A: 'Circle-arc move',
        S: 'Spline move'
      };
      var parts = [kinds[line.motion] + ' to ' + describeTarget(text) + ' at ' + describeSpeed(text)];
      var term = describeTerm(text);
      if (term) parts.push(term);
      var opts = motionOptions(text);
      return parts.concat(opts).join('; ') + '.';
    }

    for (var i = 0; i < RULES.length; i++) {
      var m = text.match(RULES[i].re);
      if (m) return RULES[i].fn(m);
    }
    return 'Instruction: ' + text;
  }

  var api = { explainLine: explainLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucExplain = api;
})(typeof window !== 'undefined' ? window : globalThis);
