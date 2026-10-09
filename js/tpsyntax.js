/* TP instruction syntax — "does this line look like something a controller
 * will load?"
 *
 * Two layers, deliberately separate:
 *
 * 1. A SHAPE DICTIONARY mined from real controller listings (js/tpshapes.js,
 *    built by tools/build-shapes.js from backup folders). Every .LS line was
 *    written by a controller, so its spacing, parentheses and option order
 *    are exactly what the translator accepts. normalize() blanks the variable
 *    parts — numbers, comments, program names — so IF (R[93]<225),R[93]=(225)
 *    and IF (R[31]>2000),R[31]=(500) are one shape. A line whose shape is in
 *    the dictionary is KNOWN: it is a form the robots already run.
 *
 * 2. A small HAND GRAMMAR for the forms with structure the dictionary cannot
 *    express: balanced brackets and quotes, the motion line's fixed slots,
 *    mixed-logic parentheses, assignment targets, SELECT rows. It only
 *    reports what is certainly broken. Anything else it has no opinion on.
 *
 * check() answers with a level:
 *   'error'   — the grammar is sure the controller will refuse it
 *   'unknown' — nothing is provably wrong, but no robot in the dictionary
 *               uses this form (a new option, a typo in a keyword, or just a
 *               form these cells never needed)
 *   'ok'      — a known shape (with how often it appears, and an example)
 * The controller's own translator remains the final authority; the upload
 * path's snapshot-and-restore is the backstop for what this cannot see.
 *
 * Zero dependencies. Runs in the browser and under node (for the builder and
 * the tests).
 */
(function (global) {
  'use strict';

  /* ---------- normalisation ---------- */

  function normalize(text) {
    var t = String(text == null ? '' : text).replace(/\s*;\s*$/, '').trim();
    t = t.replace(/'[^']*'/g, "'s'");                                     // string literals
    t = t.replace(/\$[A-Za-z0-9_.\[\]]+/g, '$sysvar');                     // $MCR.$GENOVERRIDE
    t = t.replace(/\b(CALL|RUN)\s+[A-Za-z_][A-Za-z0-9_]*/g, '$1 PROG');    // program names
    t = t.replace(/\[\s*GP\d+\s*:\s*\d+(?:\s*,\s*\d+)?\s*(?::[^\]]*)?\]/g, '[GPn:n]');
    t = t.replace(/\[\s*\d+\s*,\s*\d+\s*(?::[^\]]*)?\]/g, '[n,n]');         // PR[6,1:*Transit]
    t = t.replace(/\[\s*\d+\s*(?::[^\]]*)?\]/g, '[n]');                     // R[30:Speed-J], P[1:"home"]
    t = t.replace(/(?:\d+\.\d+|\.\d+|\d+)/g, 'N');                          // 500, 0.5, .10
    t = t.replace(/\s+/g, ' ');
    t = t.replace(/,\s+/g, ',');   // a wrapped argument list rejoins as "1, 2" — same shape as "1,2"
    return t;
  }

  /* ---------- structural checks (certain errors) ---------- */

  function unbalanced(t) {
    var quotes = (t.match(/'/g) || []).length;
    if (quotes % 2) return 'a string is missing its closing quote';
    var s = t.replace(/'[^']*'/g, "''");
    var paren = 0, brack = 0, i, c;
    for (i = 0; i < s.length; i++) {
      c = s[i];
      if (c === '(') paren++;
      else if (c === ')') { if (--paren < 0) return 'a ")" with no "(" before it'; }
      else if (c === '[') brack++;
      else if (c === ']') { if (--brack < 0) return 'a "]" with no "[" before it'; }
    }
    if (paren) return paren === 1 ? 'a "(" is never closed' : paren + ' "(" are never closed';
    if (brack) return brack === 1 ? 'a "[" is never closed' : brack + ' "[" are never closed';
    return null;
  }

  // index of the ')' that closes the '(' at `open`, or -1
  function closeOf(t, open) {
    var depth = 0, i;
    for (i = open; i < t.length; i++) {
      if (t[i] === '(') depth++;
      else if (t[i] === ')' && --depth === 0) return i;
    }
    return -1;
  }

  // first '=' that is outside every ( ) and [ ], not part of <= >= <> ==
  function topLevelEq(t) {
    var depth = 0, i, c;
    for (i = 0; i < t.length; i++) {
      c = t[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === '=' && depth === 0) {
        var p = t[i - 1], n = t[i + 1];
        if (p === '<' || p === '>' || p === '=' || n === '=') continue;
        return i;
      }
    }
    return -1;
  }

  /* A bracketed item, one level of nesting allowed: R[1], R[30:Speed-J],
   * PR[R[20]], DO[49:SR[1] Alarm] — comments on a real controller can hold
   * brackets and spaces, so "[^]]*" is not enough. */
  var BR = '\\[(?:[^\\[\\]]|\\[[^\\[\\]]*\\])*\\]';
  var REG = 'R' + BR;
  var ITEM = '(?:R|PR|SR|AR|DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|AI|AO|WI|WO|F|M|TIMER|UALM|UFRAME|UTOOL|GP\\d+)' + BR;
  var TARGET = new RegExp('^(?:' + ITEM + '|\\$[A-Za-z0-9_.$\\[\\]]+|UFRAME_NUM|UTOOL_NUM|OVERRIDE|PAYLOAD|TIMER_OVERLAP\\[\\d+\\])\\s*$');
  var POS = '(?:P|PR)' + BR;

  var MOTION_SPEED = {
    J: new RegExp('^(?:\\d+|' + REG + ')%$'),
    L: new RegExp('^(?:(?:\\d+(?:\\.\\d+)?|' + REG + ')(?:mm\\/sec|cm\\/min|inch\\/min|deg\\/sec|sec|msec)|max_speed|WELD_SPEED)$'),
    C: null, A: null, S: null
  };
  MOTION_SPEED.C = MOTION_SPEED.A = MOTION_SPEED.S = MOTION_SPEED.L;
  var MOTION_TERM = new RegExp('^(?:FINE|CNT\\s*(?:\\d+|' + REG + ')|CR\\s*\\d+)$');
  var MOTION_OPTION = [
    new RegExp('^ACC\\s*(?:\\d+|' + REG + ')$'), /^Offset$/, new RegExp('^Offset,PR' + BR + '$'), /^Tool_Offset$/, new RegExp('^Tool_Offset,PR' + BR + '$'),
    /^Wjnt$/, /^RTCP$/, /^BREAK$/, /^PTH$/, /^INC$/, /^COORD$/, /^MROT$/, /^CTV\s*-?\d+$/, /^PSPD\s*\d+$/,
    new RegExp('^VOFFSET,VR' + BR + '$'), /^AP_LD\s*\d+$/, /^RT_LD\s*\d+$/, /^EV\s*\d+%$/, /^Ind\.EV\s*\d+%$/,
    /^T[BA]\s+[^,]+,.+$/,                       // TB 0.5sec,DO[1]=ON · TA 0.2sec,CALL PROG
    /^DB\s+[^,]+,.+$/,                          // DB 100mm,DO[1]=ON
    new RegExp('^Skip,LBL' + BR + '(?:,PR' + BR + '=[LJ]POS)?$'),
    /^TIME BEFORE .+$/, /^TIME AFTER .+$/, /^DISTANCE BEFORE .+$/, /^Track .+$/
  ];
  var MOTION_HEAD = new RegExp('^([JLCAS])\\s+(' + POS + ')(\\s*)(.*)$');
  var SECOND_POS = new RegExp('^' + POS + '\\s+');
  var OPTION_START = /\s+(?=(?:ACC|Offset|Tool_Offset|Wjnt|RTCP|BREAK|PTH|INC|COORD|MROT|CTV|PSPD|VOFFSET|AP_LD|RT_LD|EV|Ind\.EV|T[BA]\s|DB\s|Skip,|TIME\s|DISTANCE\s|Track\s))/;

  // split on blanks that are outside every [ ] and ( ), so a comment with a
  // space in it — R[215:Transit Spd]% — stays one token
  function splitTop(s) {
    var out = [], cur = '', depth = 0, i, c;
    for (i = 0; i < s.length; i++) {
      c = s[i];
      if (c === '[' || c === '(') depth++;
      else if (c === ']' || c === ')') depth--;
      if (/\s/.test(c) && depth === 0) { if (cur) out.push(cur); cur = ''; }
      else cur += c;
    }
    if (cur) out.push(cur);
    return out;
  }

  /* Split a motion line's tail into speed, termination and options. Options
   * can hold commas and spaces (TB 0.5sec,DO[1]=ON), so after the speed and
   * termination the split is on the known option starts, not on blanks. */
  function motion(t) {
    var m = t.match(MOTION_HEAD);
    if (!m) return null;
    var kind = m[1], rest = m[4];
    if (!m[3] && rest) return { error: 'a space is needed between the position and the speed: ' + kind + ' ' + m[2] + ' ' + rest };
    // C and A motions name a second point before the speed
    if ((kind === 'C' || kind === 'A') && SECOND_POS.test(rest)) rest = rest.replace(SECOND_POS, '');
    var toks = splitTop(rest);
    var speed = toks.shift() || '', term = toks.shift() || '';
    if (/^CNT$/.test(term) && toks.length && /^R\[/.test(toks[0])) term += ' ' + toks.shift();
    var parts = toks.length ? toks.join(' ').split(OPTION_START) : [];
    if (!speed) return { error: kind + ' motion needs a speed after the position — e.g. ' + kind + ' ' + m[2] + (kind === 'J' ? ' 100% FINE' : ' 500mm/sec FINE') };
    if (!MOTION_SPEED[kind].test(speed)) {
      if (/^(?:FINE|CNT)/.test(speed)) return { error: 'the speed comes before the termination: ' + kind + ' ' + m[2] + (kind === 'J' ? ' 100% ' : ' 500mm/sec ') + speed };
      if (kind === 'J' && /mm\/sec|cm\/min/.test(speed)) return { error: 'a J (joint) move takes a percentage speed, e.g. 100% or R[1]% — mm/sec is for L moves' };
      if (kind !== 'J' && /%$/.test(speed)) return { error: 'an ' + kind + ' move takes mm/sec, cm/min, deg/sec or sec — a % speed is for J moves' };
      if (/\s/.test(speed) || /^\d+(?:\.\d+)?\s*$/.test(speed)) return { error: 'the speed needs its unit attached: 500mm/sec, not 500 mm/sec' };
      return { error: '"' + speed + '" is not a speed the controller understands (100%, R[1]%, 500mm/sec, 20cm/min, max_speed)' };
    }
    if (!term) return { error: 'a motion line ends its speed with a termination: FINE or CNTn' };
    if (!MOTION_TERM.test(term)) {
      if (/^CNT$/i.test(term)) return { error: 'CNT takes a value with no space: CNT50 or CNT R[1]' };
      return { error: '"' + term + '" is not a termination — FINE, CNT0…CNT100 or CR' };
    }
    var unknown = parts.map(function (s) { return s.trim(); }).filter(function (o) {
      return o && !MOTION_OPTION.some(function (re) { return re.test(o); });
    });
    if (unknown.length) return { unknown: 'motion option "' + unknown[0] + '" is not one the dictionary or the grammar knows' };
    return { ok: true };
  }

  function ifLine(t) {
    if (/^IF\s*\(/.test(t)) {
      var open = t.indexOf('('), close = closeOf(t, open);
      if (close === -1) return { error: 'the IF condition is never closed with ")"' };
      var after = t.slice(close + 1).trim();
      if (after === 'THEN') return { ok: true };
      if (/^,\s*\S/.test(after)) return action(after.replace(/^,\s*/, ''), 'IF');
      if (!after) return { error: 'IF (condition) needs THEN, or ,action — e.g. IF (DI[1]),JMP LBL[1]' };
      if (/^THEN/.test(after)) return { error: 'nothing can follow THEN on the same line' };
      return { error: 'after the closing ")" the controller expects THEN or ,action — not "' + after.slice(0, 20) + '"' };
    }
    var m = t.match(/^IF\s+(.+)$/);
    if (!m) return { error: 'IF needs a condition' };
    var body = m[1];
    if (/!/.test(body.replace(/'[^']*'/g, ''))) return { error: '"!" (NOT) only works in mixed logic — wrap the condition in parentheses: IF (!DI[1]),…' };
    var comma = -1, depth = 0, i;
    for (i = 0; i < body.length; i++) {
      if (body[i] === '(' || body[i] === '[') depth++;
      else if (body[i] === ')' || body[i] === ']') depth--;
      else if (body[i] === ',' && depth === 0) { comma = i; break; }
    }
    if (comma === -1) return { error: 'a plain IF is IF condition,action — the comma and action are missing (use IF (condition) THEN for a block)' };
    if (/\bTHEN\b/.test(body)) return { error: 'THEN belongs to the mixed-logic form: IF (condition) THEN' };
    var cond = body.slice(0, comma).trim();
    if (!/(?:=|<>|<=|>=|<|>)/.test(cond.replace(/\[[^\]]*\]/g, '[]'))) return { error: 'a plain IF compares with = <> < > <= >= — a bare item needs mixed logic: IF (DI[1]),…' };
    return action(body.slice(comma + 1).trim(), 'IF');
  }

  var JMP_LBL = new RegExp('^JMP\\s+LBL' + BR + '$');

  function action(a, ctx) {
    if (JMP_LBL.test(a)) return { ok: true };
    if (/^CALL\s+[A-Za-z_][A-Za-z0-9_]*(?:\(.*\))?$/.test(a)) return { ok: true };
    if (/^JMP\s*$/.test(a) || /^JMP\s+[^L]/.test(a)) return { error: 'JMP goes to a label: JMP LBL[n]' };
    if (ctx === 'SELECT') return { error: 'a SELECT row does JMP LBL[n] or CALL PROG, nothing else' };
    var eq = topLevelEq(a);
    if (eq !== -1) return assignment(a, eq);
    if (/^(?:PAUSE|ABORT|END|PULSE|WAIT|RUN)\b/.test(a)) return { ok: true };
    return { unknown: 'IF action "' + a.slice(0, 24) + '" is not a form the grammar knows (JMP LBL, CALL, or an assignment)' };
  }

  function assignment(t, eq) {
    var lhs = t.slice(0, eq).trim(), rhs = t.slice(eq + 1).trim();
    if (!TARGET.test(lhs)) {
      if (/^\d/.test(lhs)) return { error: 'the left of "=" must be something that can hold a value — "' + lhs + '" is a number' };
      if (/^(?:P|LBL)\[/.test(lhs)) return { error: lhs.slice(0, lhs.indexOf('[')) + '[…] cannot be assigned to' };
      return { error: 'the left of "=" must be a register, PR, I/O point, flag, timer or $variable — not "' + lhs.slice(0, 24) + '"' };
    }
    if (rhs === '') return { error: 'nothing follows the "="' };
    if (/^-\s*\d/.test(rhs)) return { error: 'a negative value goes in parentheses: ' + lhs + '=(' + rhs + ')' };
    if (/^TIMER\[/.test(lhs) && !/^(?:START|STOP|RESET)$/.test(rhs)) return { error: 'a timer is set to START, STOP or RESET' };
    if (/^F\[/.test(lhs) && /^(?:ON|OFF)$/.test(rhs)) return { error: 'a flag is written in parentheses: ' + lhs + '=(' + rhs + ')' };
    if (/^PR\[\s*\d+\s*(?::[^\]]*)?\]$/.test(lhs) && /^-?\d+(?:\.\d+)?$/.test(rhs)) return { error: 'a whole PR takes a position (PR[n], LPOS, JPOS, P[n]) — a number goes to one component: PR[n,1]=' + rhs };
    return { ok: true };
  }

  function waitLine(t) {
    if (/^WAIT\s*\(/.test(t)) {
      var open = t.indexOf('('), close = closeOf(t, open);
      if (close === -1) return { error: 'the WAIT condition is never closed with ")"' };
      var after = t.slice(close + 1).trim();
      if (!after || /^TIMEOUT\s*,\s*LBL\[[^\]]*\]$/.test(after)) return { ok: true };
      return { error: 'after WAIT (condition) only TIMEOUT,LBL[n] may follow' };
    }
    if (/^WAIT\s+(?:\d+(?:\.\d+)?|\.\d+)\s*\(sec\)$/.test(t) || /^WAIT\s+(?:\d+(?:\.\d+)?|\.\d+)\(sec\)$/.test(t) || /^WAIT\s+R\[[^\]]*\]$/.test(t)) return { ok: true };
    if (/^WAIT\s+(?:\d+(?:\.\d+)?|\.\d+)\s*(?:sec|$)/.test(t)) return { error: 'a timed wait is WAIT 0.50(sec) — the unit goes in parentheses' };
    if (/!/.test(t)) return { error: '"!" (NOT) only works in mixed logic — WAIT (!DI[1])' };
    if (!/\bTIMEOUT\b/.test(t) && /,/.test(t.replace(/\[[^\]]*\]/g, '[]'))) return { error: 'a WAIT with a label is WAIT cond TIMEOUT,LBL[n]' };
    return { ok: true };
  }

  function selectLine(t) {
    var m = t.match(/^SELECT\s+(.+)$/);
    if (!m) return { error: 'SELECT needs a register: SELECT R[n]=1,JMP LBL[1]' };
    var b = m[1];
    if (!/^R\[[^\]]*\]\s*=/.test(b)) return { error: 'SELECT compares a register: SELECT R[n]=value,action' };
    return selectRow(b.replace(/^R\[[^\]]*\]\s*/, ''));
  }

  // "=20,JMP LBL[921]" and "ELSE,CALL PROG" continuation rows
  function selectRow(t) {
    var m = t.match(/^(?:=\s*(?:-?\d+(?:\.\d+)?|R\[[^\]]*\])|ELSE)\s*,\s*(.+)$/);
    if (!m) return { error: 'a SELECT row is =value,action or ELSE,action' };
    return action(m[1].trim(), 'SELECT');
  }

  function callLine(t) {
    var m = t.match(/^(CALL|RUN)\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/);
    if (!m) return { error: 'CALL needs a program name' };
    var args = m[3];
    if (!args) return { ok: true };
    if (!/^\(.*\)$/.test(args)) return { error: 'arguments go in parentheses right after the name: CALL ' + m[2] + '(1,R[2])' };
    if (/(?:^|,)\s*-\d/.test(args.slice(1, -1))) return { error: 'a negative argument is written in its own parentheses: CALL ' + m[2] + '((-90))' };
    return { ok: true };
  }

  /* ---------- the verdict for one instruction ---------- */

  function grammar(t) {
    var e = unbalanced(t);
    if (e) return { error: e };
    if (/^[JLCAS]\s+P/.test(t)) return motion(t) || { ok: true };
    if (/^IF\b/.test(t)) return ifLine(t);
    if (/^WAIT\b/.test(t)) return waitLine(t);
    if (/^SELECT\b/.test(t)) return selectLine(t);
    if (/^(?:=|ELSE\s*,)/.test(t)) return selectRow(t);
    if (/^(?:CALL|RUN)\b/.test(t)) return callLine(t);
    if (/^(?:LBL\[|END$|PAUSE$|ABORT$|ELSE$|ENDIF$|ENDFOR$)/.test(t)) return { ok: true };
    if (/^JMP\b/.test(t)) return JMP_LBL.test(t) ? { ok: true } : { error: 'JMP goes to a label: JMP LBL[n]' };
    var eq = topLevelEq(t);
    // instructions that carry an "=" of their own: conditions, monitors, loops
    if (eq !== -1 && !/^(?:FOR|SKIP|OFFSET|MESSAGE|UALM|TIMER_OVERLAP|RUN|WHEN|MONITOR|CONDITION|PAYLOAD|MOTION|Track|Vision|VR)\b/i.test(t)) return assignment(t, eq);
    return { ok: true, silent: true };   // nothing to say — the dictionary decides
  }

  /* dict: { shapes: { shape: [count, example] } } — the mined dictionary, or
   * null to run the grammar alone. */
  function check(text, dict) {
    var t = String(text == null ? '' : text).replace(/\s*;\s*$/, '').trim();
    if (!t || /^(?:!|\/\/)/.test(t)) return { level: 'ok', comment: true };
    var g = grammar(t);
    if (g.error) return { level: 'error', message: g.error };
    var shape = normalize(t);
    var hit = dict && dict.shapes && dict.shapes[shape];
    if (hit) return { level: 'ok', shape: shape, count: hit[0], example: hit[1] };
    var rep = familyHit(shape, dict);
    if (rep) return { level: 'ok', shape: shape, family: true, count: dict.shapes[rep][0], example: dict.shapes[rep][1] };
    if (g.unknown) return { level: 'unknown', message: g.unknown, shape: shape, nearest: nearest(shape, dict) };
    if (!dict || !dict.shapes) return { level: 'ok' };
    return {
      level: 'unknown', shape: shape, nearest: nearest(shape, dict),
      message: 'no program on your robots uses this form' + (g.silent ? '' : ' (the grammar sees nothing wrong with it)')
    };
  }

  /* ---------- family matching (fuzzier than exact shapes) ----------
   * Two collapses on top of normalize(), used only for the "have my robots
   * seen this form" question — never for grammar errors:
   *   1. Scalar variables are interchangeable: reading DI[3] is the same
   *      gesture as reading GI[7] or R[12], so they all become V[n].
   *   2. Repetition is not novelty: a chain of six identical OR/AND terms
   *      is the same form as a chain of two, so runs collapse to two.
   * PR, SR, P and TIMER stay distinct — positions, strings and timers have
   * genuinely different legal forms. */
  var SCALAR_RE = /\b(?:DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|WI|WO|AI|AO|F|M|R)\[n\]/g;

  // "A OR A OR A" -> "A OR A"; mixed operators or units break the run
  function collapseChain(s) {
    var parts = s.split(/ (AND|OR) /);
    if (parts.length < 5) return s;
    var out = [parts[0]];
    for (var i = 1; i + 1 <= parts.length - 1; i += 2) {
      var op = parts[i], unit = parts[i + 1];
      if (out.length >= 3 && out[out.length - 2] === op && out[out.length - 1] === unit) continue;
      out.push(op, unit);
    }
    return out.join(' ');
  }

  /* A parenthesized boolean expression — anything with logic operators,
   * comparisons or a NOT in it — is the GRAMMAR's business, not the
   * dictionary's: the grammar already proves it well-formed, and which
   * registers it combines is not what makes a form novel. It collapses to
   * the one token (C), so IF (!DI[n]),… and IF (GI[n]>N AND DI[n]),… are
   * the same family. A plain value group like =(N) or an argument list
   * stays itself. */
  function isCondition(inner) {
    return /(^|\s)(AND|OR)(\s|$)|[<>]|<=|>=|<>|(^|\s)!|=/.test(inner);
  }

  function family(shape) {
    var s = String(shape).replace(SCALAR_RE, 'V[n]');
    var groups = [];
    var prev = null;
    while (prev !== s) {           // innermost parens become opaque tokens,
      prev = s;                    // identical groups share one token so the
      s = s.replace(/\(([^()]*)\)/g, function (_, inner) {   // outer chain
        var c = collapseChain(inner);                        // can collapse
        if (isCondition(c)) c = 'C';
        var k = groups.indexOf(c);
        if (k === -1) { k = groups.length; groups.push(c); }
        return '§' + k + '§';
      });
    }
    s = collapseChain(s);
    prev = null;
    while (prev !== s && s.indexOf('§') !== -1) {
      prev = s;
      s = s.replace(/§(\d+)§/g, function (_, k) { return '(' + groups[+k] + ')'; });
    }
    // plain-form IF conditions (no parentheses) are conditions all the same
    s = s.replace(/^IF [^,()]+,/, 'IF (C),');
    return s;
  }

  // family -> one representative exact shape, built once per dictionary
  function familyHit(shape, dict) {
    if (!dict || !dict.shapes) return null;
    if (!dict.families) {
      dict.families = {};
      Object.keys(dict.shapes).forEach(function (k) {
        var f = family(k);
        if (!(f in dict.families) || dict.shapes[k][0] > dict.shapes[dict.families[f]][0]) {
          dict.families[f] = k;
        }
      });
    }
    var f = family(shape);
    var rep = dict.families[f];
    if (rep === undefined && f.indexOf('IF (C),') === 0) {
      // an IF is as familiar as its action: the grammar vouches for the
      // condition, so "IF (anything),R[n]=N" is known wherever R[n]=N is
      rep = dict.families[f.slice('IF (C),'.length)];
    }
    return rep === undefined ? null : rep;
  }

  // the most-used known shapes that start the same way, as examples to copy
  function nearest(shape, dict) {
    if (!dict || !dict.shapes) return [];
    var head = shape.split(/[\s(=]/)[0];
    return Object.keys(dict.shapes)
      .filter(function (s) { return s !== shape && s.split(/[\s(=]/)[0] === head; })
      .sort(function (a, b) { return dict.shapes[b][0] - dict.shapes[a][0]; })
      .slice(0, 3)
      .map(function (s) { return { shape: s, count: dict.shapes[s][0], example: dict.shapes[s][1] }; });
  }

  /* ---------- whole listings ---------- */

  /* The /MN rows of a source, grouped into logical instructions the way the
   * controller wraps them: a row starting with ":" continues the previous. */
  function instructions(src) {
    var rows = String(src).split(/\r\n|\r|\n/);
    var out = [], inMn = false, i, raw, m, cur = null;
    for (i = 0; i < rows.length; i++) {
      raw = rows[i];
      if (/^\s*\/MN\b/i.test(raw)) { inMn = true; continue; }
      if (/^\s*\/(?:POS|END)\b/i.test(raw)) { inMn = false; cur = null; continue; }
      if (!inMn) continue;
      if (!raw.trim()) { cur = null; continue; }
      m = raw.match(/^\s*(\d+)\s*:(.*)$/);
      if (m) {
        cur = { row: i, rows: [i], num: parseInt(m[1], 10), text: m[2].trim(), raw: raw };
        out.push(cur);
      } else if (/^\s*:/.test(raw) && cur) {
        cur.rows.push(i);
        cur.text = (cur.text.replace(/\s*;\s*$/, '') + ' ' + raw.replace(/^\s*:\s?/, '').trim()).trim();
        cur.raw += '\n' + raw;
      } else {
        out.push({ row: i, rows: [i], num: null, text: raw.trim(), raw: raw, badRow: true });
        cur = null;
      }
    }
    return out;
  }

  /* Every issue in a listing: [{ row, rows, num, level, message, ... }].
   * Row-level format problems (no line number, no ";") come first, because
   * the controller refuses a file over those before it reads a single
   * instruction. */
  function checkSource(src, dict) {
    var issues = [];
    instructions(src).forEach(function (ins) {
      if (ins.badRow) {
        issues.push({ row: ins.row, rows: ins.rows, num: null, level: 'error', message: 'every instruction row starts with its line number and a colon — "  12:  R[1]=0 ;" — or ":" to continue the row above' });
        return;
      }
      var body = ins.text;
      if (!/;\s*$/.test(body)) {
        if (body.trim()) issues.push({ row: ins.row, rows: ins.rows, num: ins.num, level: 'error', message: 'the instruction has to end with " ;"' });
        return;
      }
      var r = check(body, dict);
      if (r.level === 'ok') return;
      issues.push({ row: ins.row, rows: ins.rows, num: ins.num, level: r.level, message: r.message, shape: r.shape, nearest: r.nearest || [] });
    });
    return issues;
  }

  /* For the Checks tab: only what is certainly wrong, by program line. */
  function checkProgram(parsed, dict) {
    var out = [];
    parsed.lines.forEach(function (line) {
      if (line.comment !== null) return;
      var t = (line.motion ? line.motion + ' ' : '') + line.text;
      var r = check(t, dict);
      if (r.level === 'error') out.push({ line: line.num, message: r.message });
    });
    return out;
  }

  /* ---------- writing lines the way the controller does ---------- */

  // "  12:  R[1]=0 ;" — motion letters sit right after the colon, everything
  // else is indented two spaces, and the row ends in " ;"
  function formatRow(num, text) {
    var t = String(text).replace(/\s*;\s*$/, '').trim();
    var motionLike = /^[JLCAS]\s+P/.test(t);
    var n = String(num);
    while (n.length < 4) n = ' ' + n;
    return n + ':' + (motionLike ? '' : '  ') + t + ' ;';
  }

  // Renumber the /MN rows 1, 2, 3… leaving continuation rows and everything
  // outside /MN alone. Keeps the file's line endings.
  function renumber(src) {
    var eol = /\r\n/.test(src) ? '\r\n' : '\n';
    var rows = String(src).split(/\r\n|\r|\n/);
    var inMn = false, n = 0;
    var out = rows.map(function (raw) {
      if (/^\s*\/MN\b/i.test(raw)) { inMn = true; return raw; }
      if (/^\s*\/(?:POS|END)\b/i.test(raw)) { inMn = false; return raw; }
      if (!inMn) return raw;
      var m = raw.match(/^\s*\d+\s*:(.*)$/);
      if (!m) return raw;
      n++;
      var num = String(n);
      while (num.length < 4) num = ' ' + num;
      return num + ':' + m[1];
    });
    return out.join(eol);
  }

  /* ---------- snippets ---------- */

  /* Hand-picked forms with the note that answers the question people ask
   * about them. `text` may hold several lines. Where the dictionary knows
   * the form, the UI adds how often the robots use it. */
  var SNIPPETS = [
    { group: 'Registers', name: 'Set a register', text: 'R[1:name]=0', note: 'A value or another register — no parentheses needed in the plain form.' },
    { group: 'Registers', name: 'Arithmetic', text: 'R[1]=R[2]+R[3]', note: '+ - * / MOD DIV. Only mixed logic needs parentheses: R[1]=(R[2]*2+1).' },
    { group: 'Registers', name: 'Negative value', text: 'R[1]=(-1)', note: 'The controller always writes a negative literal in parentheses.' },
    { group: 'Registers', name: 'Register from an input', text: 'R[1]=GI[1]', note: 'GI, AI, DI all read straight into a register.' },
    { group: 'Registers', name: 'String register', text: "SR[1]='text'", note: 'Single quotes.' },
    { group: 'Position registers', name: 'Copy a PR', text: 'PR[10]=PR[11]' },
    { group: 'Position registers', name: 'Record the current position', text: 'PR[99]=LPOS', note: 'LPOS is Cartesian, JPOS is joint.' },
    { group: 'Position registers', name: 'Set one component', text: 'PR[10,3]=0', note: 'Components 1–6 are X Y Z W P R, or J1–J6 for a joint PR. A whole PR cannot take a number.' },
    { group: 'Position registers', name: 'Clear a PR', text: 'PR[10]=PR[10]-PR[10]' },
    { group: 'Motion', name: 'Joint move', text: 'J P[1] 100% FINE', note: 'J takes a % speed. The speed sits between the position and the termination.' },
    { group: 'Motion', name: 'Joint move, speed from a register', text: 'J PR[1] R[202:Speed-J]% CNT50' },
    { group: 'Motion', name: 'Linear move', text: 'L PR[20] 500mm/sec FINE', note: 'L takes mm/sec, cm/min, deg/sec or sec. No space before the unit.' },
    { group: 'Motion', name: 'Linear with offset', text: 'L PR[20] 500mm/sec CNT50 Offset', note: 'Offset uses the PR set by OFFSET CONDITION; Offset,PR[n] names one directly.' },
    { group: 'Motion', name: 'Linear with tool offset', text: 'L PR[20] 300mm/sec FINE Tool_Offset' },
    { group: 'Motion', name: 'Output on the way (time before)', text: 'L P[1] 200mm/sec CNT100 TB 0.5sec,DO[1]=ON', note: 'TB = time before reaching the point, TA = after, DB = distance before.' },
    { group: 'Motion', name: 'Skip to a label with position capture', text: 'L PR[1] R[207]mm/sec FINE Skip,LBL[1],PR[49]=LPOS', note: 'Needs a SKIP CONDITION set earlier.' },
    { group: 'Motion', name: 'Skip condition', text: 'SKIP CONDITION DI[1]=ON' },
    { group: 'Motion', name: 'Offset condition', text: 'OFFSET CONDITION PR[60]' },
    { group: 'Logic', name: 'IF, mixed logic', text: 'IF (DI[1]),JMP LBL[1]', note: 'Mixed logic: the whole condition in one pair of parentheses. ! for NOT, AND / OR to combine.' },
    { group: 'Logic', name: 'IF with AND / NOT', text: 'IF (R[1]=1 AND !DI[2]),CALL PROG' },
    { group: 'Logic', name: 'IF, plain', text: 'IF R[1]>5,JMP LBL[1]', note: 'Plain form: no parentheses, compare with = <> < > <= >=, no "!".' },
    { group: 'Logic', name: 'IF … THEN block', text: 'IF (R[1]=0) THEN\nR[1]=1\nELSE\nR[1]=0\nENDIF', note: 'THEN needs the parenthesised form. ELSE is optional, ENDIF is not.' },
    { group: 'Logic', name: 'Clamp a value', text: 'IF (R[1]<10),R[1]=(10)', note: 'An assignment as the IF action takes its value in parentheses.' },
    { group: 'Logic', name: 'SELECT', text: 'SELECT R[1]=1,JMP LBL[1]\n=2,JMP LBL[2]\nELSE,JMP LBL[9]', note: 'Each row is =value,action or ELSE,action. Actions are JMP LBL or CALL only.' },
    { group: 'Wait', name: 'Wait for an input', text: 'WAIT (DI[1])', note: 'Mixed logic — WAIT (!DI[1]) waits for it to go off.' },
    { group: 'Wait', name: 'Wait with timeout', text: 'WAIT DI[1]=ON TIMEOUT,LBL[1]', note: 'Jumps to the label when $WAITTMOUT expires.' },
    { group: 'Wait', name: 'Timed wait', text: 'WAIT .50(sec)', note: 'The unit goes in parentheses.' },
    { group: 'Wait', name: 'Wait a register', text: 'WAIT R[1]' },
    { group: 'I/O', name: 'Output on / off', text: 'DO[1]=ON' },
    { group: 'I/O', name: 'Pulse an output', text: 'DO[1]=PULSE,0.5sec' },
    { group: 'I/O', name: 'Flag', text: 'F[1]=(ON)', note: 'Flags are written in parentheses.' },
    { group: 'I/O', name: 'Group output from a register', text: 'GO[1]=R[1]' },
    { group: 'Flow', name: 'Label', text: 'LBL[1]' },
    { group: 'Flow', name: 'Jump', text: 'JMP LBL[1]' },
    { group: 'Flow', name: 'Call a program', text: 'CALL PROG' },
    { group: 'Flow', name: 'Call with arguments', text: 'CALL PROG(1,R[2])', note: 'A negative argument is wrapped twice: CALL PROG((-90)).' },
    { group: 'Flow', name: 'Run in parallel', text: 'RUN PROG', note: 'Starts the program as its own task.' },
    { group: 'Flow', name: 'Pause / Abort / End', text: 'PAUSE' },
    { group: 'Frames and timers', name: 'User frame', text: 'UFRAME_NUM=1' },
    { group: 'Frames and timers', name: 'Tool frame', text: 'UTOOL_NUM=1' },
    { group: 'Frames and timers', name: 'Speed override', text: 'OVERRIDE=50%' },
    { group: 'Frames and timers', name: 'Timer', text: 'TIMER[1]=START', note: 'START, STOP or RESET.' },
    { group: 'Messages', name: 'User alarm', text: 'UALM[1]' },
    { group: 'Messages', name: 'Pendant message', text: 'MESSAGE[text]' },
    { group: 'Comments', name: 'Remark', text: '! remark', note: 'Never executed.' },
    { group: 'Comments', name: 'Disabled instruction', text: '//PAUSE', note: 'An instruction switched off in place — different from a remark.' }
  ];

  /* The most-used shapes from the dictionary, as a group of their own, with
   * the robots' own line as the example. */
  function topShapes(dict, n) {
    if (!dict || !dict.shapes) return [];
    return Object.keys(dict.shapes)
      .filter(function (s) { return !/^LBL\[n\]$/.test(s); })
      .sort(function (a, b) { return dict.shapes[b][0] - dict.shapes[a][0]; })
      .slice(0, n || 24)
      .map(function (s) { return { group: 'Most used on your robots', name: dict.shapes[s][1], text: dict.shapes[s][1], count: dict.shapes[s][0] }; });
  }

  function snippets(dict) {
    var list = SNIPPETS.map(function (s) {
      var first = s.text.split('\n')[0];
      var hit = dict && dict.shapes && dict.shapes[normalize(first)];
      return { group: s.group, name: s.name, text: s.text, note: s.note || '', count: hit ? hit[0] : 0 };
    });
    return list.concat(topShapes(dict));
  }

  var api = {
    normalize: normalize, check: check, checkSource: checkSource, checkProgram: checkProgram,
    instructions: instructions, formatRow: formatRow, renumber: renumber, snippets: snippets,
    family: family
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucSyntax = api;
})(typeof window !== 'undefined' ? window : globalThis);
