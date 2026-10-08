/* Parsers for FANUC variable/system ASCII files fetched from the controller
 * (MD: device over HTTP) or from a backup directory.
 */
(function (global) {
  'use strict';

  // NUMREG.VA lines look like:   [1] = 25  'part count'
  // (integer or real values; comment may be empty)
  function parseNumreg(text) {
    var out = [], m;
    var re = /\[(\d+)\]\s*=\s*(-?[0-9.eE+]+)\s*(?:'([^']*)')?/g;
    while ((m = re.exec(text)) !== null) {
      out.push({
        index: parseInt(m[1], 10),
        value: parseFloat(m[2]),
        comment: (m[3] || '').trim()
      });
    }
    return out;
  }

  // Generic line filter for raw diagnostic/IO files (DIOCFGSV.IO, *.DG):
  // returns trimmed, non-empty lines for display.
  function rawLines(text) {
    return text.split(/\r\n|\r|\n/)
      .map(function (l) { return l.replace(/\s+$/, ''); })
      .filter(function (l) { return l.trim().length > 0; });
  }

  // Pull I/O comments out of DIOCFGSV.IO / similar config dumps: any line that
  // mentions TYPE[ n ] and carries a 'quoted comment'.
  function parseIOComments(text) {
    var out = [], seen = {};
    text.split(/\r\n|\r|\n/).forEach(function (line) {
      var m = line.match(/\b(DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|AI|AO|F|M)\s*\[\s*(\d+)\s*\]/);
      if (!m) return;
      var c = line.match(/'([^']*)'/);
      if (!c || !c[1].trim()) return;
      var key = m[1] + '[' + m[2] + ']';
      if (seen[key]) return;
      seen[key] = true;
      out.push({ type: m[1], index: parseInt(m[2], 10), comment: c[1].trim() });
    });
    return out;
  }

  // IOSTATE.DG: live I/O dump with comments. Lines look like
  //   DIN[   1]  ON  Auto Mode
  //   FLG[   8] OFF  Task Rdy                  FLG[ 520] OFF
  // (flags print two columns per line, so parse by match position, not line).
  var IOSTATE_TYPES = {
    DIN: 'DI', DOUT: 'DO', RIN: 'RI', ROUT: 'RO', RI: 'RI', RO: 'RO',
    GIN: 'GI', GOUT: 'GO', UIN: 'UI', UOUT: 'UO', UI: 'UI', UO: 'UO',
    SIN: 'SI', SOUT: 'SO', SI: 'SI', SO: 'SO', AIN: 'AI', AOUT: 'AO',
    FLG: 'F', WI: 'WI', WO: 'WO'
  };

  function parseIOState(text) {
    var out = [];
    var headRe = /\b(DIN|DOUT|RIN|ROUT|GIN|GOUT|UIN|UOUT|SIN|SOUT|AIN|AOUT|FLG|RI|RO|UI|UO|SI|SO|WI|WO)\[\s*(\d+)\]\s+(ON|OFF|-?[\d.]+)/g;
    var colRe = /\s{2,}(?:DIN|DOUT|RIN|ROUT|GIN|GOUT|UIN|UOUT|SIN|SOUT|AIN|AOUT|FLG|RI|RO|UI|UO|SI|SO|WI|WO)\[/;
    var m;
    while ((m = headRe.exec(text)) !== null) {
      var end = m.index + m[0].length;
      var nl = text.indexOf('\n', end);
      if (nl === -1) nl = text.length;
      var seg = text.slice(end, nl);
      var cut = seg.search(colRe);   // flags print two columns per line
      if (cut !== -1) seg = seg.slice(0, cut);
      out.push({ type: IOSTATE_TYPES[m[1]], index: parseInt(m[2], 10), state: m[3], comment: seg.trim() });
    }
    return out;
  }

  /* STRREG.VA — string registers. Value first, comment last:
   *   [1] = Error setting SR Alarm text.  '*Active Alarm'
   *   [2] =   ''
   * Parsed a line at a time rather than with a global regex, because a stored
   * string can itself contain a bracketed reference — the [101] in
   * "Reset R[101] Sts ID to 0" would otherwise read as a register of its own.
   * The comment is the LAST quoted run on the line, so a value carrying an
   * apostrophe cannot swallow it either. */
  function parseStrreg(text) {
    var out = [];
    text.split(/\r\n|\r|\n/).forEach(function (line) {
      var m = line.match(/^\s*\[(\d+)\]\s*=\s*(.*)$/);
      if (!m) return;                    // the header line is [*STRREG*]$STRREG …
      var rest = m[2], comment = '';
      var q = rest.match(/^(.*)'([^']*)'\s*$/);
      if (q) { rest = q[1]; comment = q[2]; }
      out.push({ index: parseInt(m[1], 10), value: rest.trim(), comment: comment.trim() });
    });
    return out;
  }

  /* POSREG.VA — position registers with comments and values.
   *   [1,1] =   'Home'   Group: 1
   *   J1 = -.000 deg  J2 = -60.000 deg ...
   * or Cartesian:
   *   [1,20] =  '*Rack PKPL'
   *   Group: 1   Config: F U T, 0, 0, 0
   *   X: 17.764  Y: -30.473  Z: -784.647 ...
   * or:  [1,7] = '' Uninitialized
   * First bracket number is the motion group, second is the PR index. */
  function parsePosreg(text) {
    var out = [];
    var headRe = /^\s*\[(\d+)\s*,\s*(\d+)\]\s*=\s*'([^']*)'(\s*Uninitialized)?/gm;
    var heads = [];
    var m;
    while ((m = headRe.exec(text)) !== null) {
      heads.push({ group: parseInt(m[1], 10), index: parseInt(m[2], 10), comment: m[3].trim(), uninit: !!m[4], start: m.index, bodyStart: m.index + m[0].length });
    }
    heads.forEach(function (hd, i) {
      var body = text.slice(hd.bodyStart, i + 1 < heads.length ? heads[i + 1].start : text.length);
      var e = { group: hd.group, index: hd.index, comment: hd.comment, rep: 'uninitialized', config: null, coords: {} };
      if (!hd.uninit) {
        var c = body.match(/Config:\s*([^\n]*?)\s*$/m);
        if (c) e.config = c[1].trim();
        var jRe = /\bJ(\d)\s*=\s*(-?[.\d]+)/g, j, any = false;
        while ((j = jRe.exec(body)) !== null) { e.coords['J' + j[1]] = parseFloat(j[2]); any = true; }
        if (any) e.rep = 'joint';
        else {
          var cRe = /\b([XYZWPR]):\s*(-?[.\d]+)/g;
          while ((j = cRe.exec(body)) !== null) { e.coords[j[1]] = parseFloat(j[2]); any = true; }
          if (any) e.rep = 'cartesian';
        }
      }
      out.push(e);
    });
    return out;
  }

  // Compact one-line value for display: "J1 -95.0  J2 -60.0 …" / "X 17.8  Y -30.5 …"
  function posregValueStr(e) {
    if (e.rep === 'uninitialized') return 'uninitialized';
    var keys = e.rep === 'joint' ? ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] : ['X', 'Y', 'Z', 'W', 'P', 'R'];
    return keys.filter(function (k) { return e.coords[k] !== undefined; })
      .map(function (k) { return k + ' ' + e.coords[k].toFixed(1); }).join('  ');
  }

  /* ERRALL.LS / ERRACT.LS — controller error history, NEWEST FIRST:
   *   4695" 28-AUG-26 15:34:24 " ASBN-002 Error occurred during load  " " WARN   00000000" act"
   * "R E S E T" rows have no alarm code; a trailing "act" marks active alarms. */
  function parseErrall(text) {
    var out = [];
    text.split(/\r\n|\r|\n/).forEach(function (line) {
      var m = line.match(/^\s*(\d+)"\s*([^"]*?)\s*"\s*([^"]*?)\s*"(.*)$/);
      if (!m) return;
      var msg = m[3];
      var cm = msg.match(/^([A-Z]{2,5}-\d+)\s*(.*)$/);
      var rest = m[4];
      var sev = (rest.match(/([A-Z][A-Z.,G]*(?:\s[A-Z.,G]+)*)\s+[01]{8}"/) || [])[1] || '';
      out.push({
        seq: parseInt(m[1], 10),
        time: m[2],
        code: cm ? cm[1] : null,
        text: cm ? cm[2].trim() : msg.replace(/\s+/g, ' ').trim(),
        severity: sev.trim(),
        active: /"\s*act\s*"?\s*$/.test(line)
      });
    });
    return out;
  }


  /* PRGSTATE.DG — the controller's own program/task state dump. Two sections:
   *
   *   TASK STATES:
   *   1     ATCELLIO RUNNING @ 477 in MAIN of ATCELLIO
   *   2  ZDTMSGTYPES status = ABORTED
   *   ****** History Data ******            <- the routine stack for that task
   *   Routine depth: 1  Routine: MAIN
   *   Line:   477       Program: ATCELLIO   Type: PC
   *
   *   PROGRAM STATES:
   *   _PK_RACK      TP
   *   Task: no                              <- a task is attached to it
   *   Protection: OFF                       <- write protected
   *
   * This is what answers "why will the controller not let me overwrite this".
   * A controller refuses to overwrite a program that has a live task, and a
   * PAUSED task is still live — only ABORT releases it. Everything on the
   * routine stack is pinned too, not just the program the cursor sits in.
   */
  function parsePrgState(text) {
    var src = String(text || '').replace(/\r\n?|\r/g, '\n');
    var out = { header: {}, tasks: [], programs: [] };

    var hdr = {
      fNumber: /^F Number:\s*(\S+)/m,
      version: /^VERSION *:\s*(.+?)\s*$/m,
      sysVersion: /^\$VERSION:\s*(.+?)\s*$/m,
      date: /^DATE:\s*(.+?)\s*$/m
    };
    Object.keys(hdr).forEach(function (k) {
      var m = src.match(hdr[k]);
      if (m) out.header[k] = m[1].trim();
    });

    /* ---- TASK STATES ---- */
    var taskSec = src.split(/^TASK STATES:\s*$/m)[1];
    if (taskSec) taskSec = taskSec.split(/^PROGRAM STATES:\s*$/m)[0];
    if (taskSec) {
      /* Two header shapes, hence the alternation: a live task reports where it
       * is, a dead one only reports how it ended. */
      var running = /^\s*(\d+)\s+(\S+)\s+([A-Z]+)\D*(\d+)\s+in\s+(\S+)\s+of\s+(\S+)/;
      var stopped = /^\s*(\d+)\s+(\S+)\s+status\s*=\s*(\S+)/;
      var depth = /^Routine depth:\s*(\d+)\s+Routine:\s*(\S+)/;
      var lineOf = /^Line:\s*(\d+)\s+Program:\s*(\S+)(?:\s+Type:\s*(\S+))?/;
      var cur = null;
      taskSec.split('\n').forEach(function (raw) {
        var line = raw.replace(/\s+$/, '');
        var m = line.match(running);
        if (m) {
          cur = { n: +m[1], name: m[2], state: m[3].toUpperCase(), line: +m[4], routine: m[5], program: m[6], stack: [] };
          out.tasks.push(cur);
          return;
        }
        m = line.match(stopped);
        if (m) {
          cur = { n: +m[1], name: m[2], state: m[3].toUpperCase(), line: null, routine: null, program: null, stack: [] };
          out.tasks.push(cur);
          return;
        }
        if (!cur) return;
        m = line.match(depth);
        if (m) { cur.stack.push({ depth: +m[1], routine: m[2], line: null, program: null, type: null }); return; }
        m = line.match(lineOf);
        if (m && cur.stack.length) {
          var top = cur.stack[cur.stack.length - 1];
          top.line = +m[1]; top.program = m[2]; top.type = m[3] || null;
        }
      });
    }

    /* ---- PROGRAM STATES ---- */
    var progSec = src.split(/^PROGRAM STATES:\s*$/m)[1];
    if (progSec) {
      var head = /^(\S+)\s+(TP|PC|VR|MN|KL)\s*$/;
      var field = /^([A-Za-z][A-Za-z ]*?):\s+(.*?)\s*$/;
      var p = null;
      progSec.split('\n').forEach(function (raw) {
        var line = raw.replace(/\s+$/, '');
        var m = line.match(head);
        if (m) { p = { name: m[1], type: m[2] }; out.programs.push(p); return; }
        if (!p) return;
        m = line.match(field);
        if (!m) return;
        var key = m[1].trim().toLowerCase();
        var val = m[2].trim();
        if (key === 'task') p.task = val;
        else if (key === 'lines') p.lines = parseInt(val, 10);
        else if (key === 'comment') p.comment = val;
        else if (key === 'protection') p.protection = val;
        else if (key === 'last modified') p.modified = val;
        else if (key === 'program size') p.size = parseInt(val, 10);
        else if (key === 'ignore abort') p.ignoreAbort = val;
        else if (key === 'ignore pause') p.ignorePause = val;
      });
    }

    /* Which programs a controller will refuse to overwrite. A task only holds
     * its programs while it is alive, so ABORTED tasks are not counted — but
     * anything on a live task's routine stack is, not just its current
     * program. `Task:` is read as attached unless it explicitly says "no",
     * so an unfamiliar value errs toward warning rather than silence. */
    var LIVE = { RUNNING: 1, PAUSED: 1, HELD: 1 };
    var locked = {};
    out.tasks.forEach(function (t) {
      if (!LIVE[t.state]) return;
      if (t.program) locked[t.program.toUpperCase()] = t;
      t.stack.forEach(function (f) { if (f.program) locked[f.program.toUpperCase()] = t; });
    });
    out.programs.forEach(function (p) {
      if (p.task && p.task.toLowerCase() !== 'no') locked[p.name.toUpperCase()] = locked[p.name.toUpperCase()] || null;
    });
    out.locked = locked;
    return out;
  }

  var api = { parseNumreg: parseNumreg, parseStrreg: parseStrreg, rawLines: rawLines, parseIOComments: parseIOComments, parseIOState: parseIOState, parsePosreg: parsePosreg, posregValueStr: posregValueStr, parseErrall: parseErrall, parsePrgState: parsePrgState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucVA = api;
})(typeof window !== 'undefined' ? window : globalThis);
