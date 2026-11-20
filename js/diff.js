/* Line diff + program-set comparison for the Compare view. */
(function (global) {
  'use strict';

  /* The controller can list I/O state inline: with that display option on,
   *   DO[65:Vac-1 ON]        is written   DO[65:OFF:Vac-1 ON]
   *   F[20:Box Pk Rdy]                    F[20:ON :Box Pk Rdy]
   * The injected field is live machine state, not program content, so a robot
   * listing taken with the option on reports every such line as changed
   * against a backup taken with it off. This strips just that field: the one
   * immediately after the index, and only when a comment follows it, so a
   * real comment — including one that happens to end in "ON" — is untouched. */
  var IO_STATE_RE = /(\[\s*\d+\s*):\s*(?:ON|OFF)\s*(:|\])/g;
  var EMPTY_CMT_RE = /(\[\s*\d+\s*):\]/g;

  function stripIoState(text) {
    IO_STATE_RE.lastIndex = 0;
    var out = text.replace(IO_STATE_RE, function (_, head, tail) {
      // "DO[65:OFF:Vac-1 ON]" -> "DO[65:Vac-1 ON]"   (state, then a comment)
      // "DO[65:OFF]"          -> "DO[65]"            (state, no comment)
      return tail === ']' ? head + ']' : head + ':';
    });
    EMPTY_CMT_RE.lastIndex = 0;
    return out.replace(EMPTY_CMT_RE, '$1]');   // "DO[65:OFF:]" -> "DO[65]"
  }

  /* A register's or I/O point's NAME is not program content. It lives in the
   * controller's own comment table, and every listing the robot writes is
   * generated from that table — so renaming R[1] rewrites that line in all 77
   * programs, and the controller regenerates the names again on the next
   * LS->TP load (which is why a send re-imports the robot's copy). Compared
   * verbatim, one rename reads as a change in every program that touches the
   * register, and the upload's baseline check reads it as "someone edited this
   * on the robot".
   *
   *   R[1:part count]=0      vs   R[1:Part Count]=0      same instruction
   *   DI[3:ON :Run Task]     vs   DI[3:OFF:Start Cyc]    same instruction
   *
   * This drops the whole text after the index for exactly the types whose
   * comment is controller furniture. LBL[] and P[] are deliberately absent:
   * their comments are stored IN the program, so editing one is a real edit.
   * Indirect forms (R[R[1]]) never match — the index must be plain digits.
   * Covers the inline I/O state and GI/GO value injection too, since those sit
   * in the same field: GI[2:65456:Name] -> GI[2]. */
  var NAMED_RE = /\b(R|PR|SR|DI|DO|GI|GO|AI|AO|RI|RO|UI|UO|SI|SO|WI|WO|F|TIMER|PAYLOAD)(\[\s*\d+(?:\s*,\s*\d+)?\s*):[^[\]]*\]/g;

  function stripNames(text) {
    NAMED_RE.lastIndex = 0;
    return text.replace(NAMED_RE, function (_, type, head) { return type + head + ']'; });
  }

  /* /ATTR's CREATE and MODIFIED stamps are the CONTROLLER's, not the
   * programmer's: it re-stamps a program every time one is loaded into it,
   * whatever the bytes say. That includes this app's own auto-restore, which
   * puts the byte-identical snapshot back after a failed upload — so the
   * restore from a failed send made the NEXT send read as "changed on the
   * robot", over a diff showing nothing but two clocks, at exactly the moment
   * someone needs the retry to work. A plain reload of the same program from
   * a USB stick does it too.
   *
   *   CREATE   = DATE 26-11-20  TIME 01:13:10;   the send that failed
   *   CREATE   = DATE 26-11-20  TIME 01:13:42;   the restore, same bytes
   *
   * Only the two stamp VALUES go. Everything else in the header stays, so a
   * COMMENT, PROTECT or OWNER changed on the pendant is still a change, and
   * so are PROG_SIZE and MEMORY_SIZE — which is what catches a real edit that
   * happens to leave the line count alone. */
  var STAMP_RE = /^([ \t]*(?:CREATE|MODIFIED)[ \t]*=[ \t]*)DATE[ \t]+[-\d]+[ \t]+TIME[ \t]+[\d:]+[ \t]*;/gm;

  function stripStamps(text) {
    STAMP_RE.lastIndex = 0;
    return String(text).replace(STAMP_RE, '$1DATE * TIME *;');
  }

  /* Every /MN line is written "<pad><n>:  <instruction> ;", so inserting or
   * deleting one line renumbers every line after it. Those renumbered lines
   * are identical program content, but compared verbatim they all read as
   * changes and bury the one real edit. This drops the whole prefix — the pad
   * too, since 9 -> 10 also shifts the padding — leaving the two spaces that
   * separate it from the instruction, so indentation still counts. Anchored
   * and bounded so it can only match that prefix and never /POS payload.
   * Multiline + global because comparePrograms hands the normalizer a whole
   * body at once while diffLines hands it one line at a time. */
  var LINE_NUM_RE = /^[ \t]{0,6}\d{1,5}:/gm;

  function stripLineNums(text) {
    LINE_NUM_RE.lastIndex = 0;
    return text.replace(LINE_NUM_RE, '');
  }

  function keyer(opts) {
    if (!opts) return null;
    var fns = [];
    // stripNames subsumes stripIoState for the types it covers; both are kept
    // because the two options are independent and either can be on alone.
    if (opts.ignoreNames) fns.push(stripNames);
    if (opts.ignoreIoState) fns.push(stripIoState);
    if (opts.ignoreLineNums) fns.push(stripLineNums);
    if (!fns.length) return null;
    if (fns.length === 1) return fns[0];
    return function (text) {
      for (var i = 0; i < fns.length; i++) text = fns[i](text);
      return text;
    };
  }

  /* Classic LCS line diff. Returns ops: {t: '='|'-'|'+', text, textB, an, bn}
   * (an/bn are 1-based line numbers in a/b where applicable).
   * opts.ignoreIoState / opts.ignoreLineNums compare lines with the inline
   * I/O state and/or the leading line number removed while every op still
   * carries the text as it was actually written — textB is the b-side
   * original of an '=' op, which can differ from text by exactly what was
   * ignored. */
  function diffLines(aText, bText, opts) {
    var a = aText.split(/\r\n|\r|\n/);
    var b = bText.split(/\r\n|\r|\n/);
    var norm = keyer(opts);
    var ak = norm ? a.map(norm) : a;
    var bk = norm ? b.map(norm) : b;
    // trim common prefix/suffix to keep the DP small
    var pre = 0;
    while (pre < a.length && pre < b.length && ak[pre] === bk[pre]) pre++;
    var suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && ak[a.length - 1 - suf] === bk[b.length - 1 - suf]) suf++;
    var am = a.slice(pre, a.length - suf), amk = ak.slice(pre, ak.length - suf);
    var bm = b.slice(pre, b.length - suf), bmk = bk.slice(pre, bk.length - suf);

    var ops = [];
    for (var i = 0; i < pre; i++) ops.push({ t: '=', text: a[i], textB: b[i], an: i + 1, bn: i + 1 });
    ops = ops.concat(diffCore(am, bm, amk, bmk, pre));
    for (var k = 0; k < suf; k++) {
      ops.push({
        t: '=',
        text: a[a.length - suf + k], textB: b[b.length - suf + k],
        an: a.length - suf + k + 1, bn: b.length - suf + k + 1
      });
    }
    return ops;
  }

  function diffCore(a, b, ak, bk, preOffset) {
    var n = a.length, m = b.length;
    if (!n && !m) return [];
    if (n * m > 4000000) {
      // too big for DP — report as full replace
      var out = [];
      a.forEach(function (t, i) { out.push({ t: '-', text: t, an: preOffset + i + 1 }); });
      b.forEach(function (t, i) { out.push({ t: '+', text: t, bn: preOffset + i + 1 }); });
      return out;
    }
    // LCS length table
    var W = m + 1;
    var dp = new Uint32Array((n + 1) * (m + 1));
    for (var i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i * W + j] = ak[i] === bk[j]
          ? dp[(i + 1) * W + j + 1] + 1
          : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
      }
    }
    var ops = [];
    var x = 0, y = 0;
    while (x < n && y < m) {
      if (ak[x] === bk[y]) {
        ops.push({ t: '=', text: a[x], textB: b[y], an: preOffset + x + 1, bn: preOffset + y + 1 });
        x++; y++;
      } else if (dp[(x + 1) * W + y] >= dp[x * W + y + 1]) {
        ops.push({ t: '-', text: a[x], an: preOffset + x + 1 });
        x++;
      } else {
        ops.push({ t: '+', text: b[y], bn: preOffset + y + 1 });
        y++;
      }
    }
    while (x < n) { ops.push({ t: '-', text: a[x], an: preOffset + x + 1 }); x++; }
    while (y < m) { ops.push({ t: '+', text: b[y], bn: preOffset + y + 1 }); y++; }
    return ops;
  }

  /* The /ATTR header carries noise that changes on every touch (dates, sizes).
   * bodyOf() extracts /MN..end so we can tell real changes from header-only. */
  function bodyOf(source) {
    var m = source.match(/^\/MN\b[\s\S]*$/m);
    return m ? m[0] : source;
  }

  /* Compare two program sets {NAME: source}.
   * baseline = the old state (backup), current = the new state (library/robot). */
  function comparePrograms(baseline, current, opts) {
    var names = {};
    var norm = keyer(opts);
    Object.keys(baseline).forEach(function (n) { names[n] = true; });
    Object.keys(current).forEach(function (n) { names[n] = true; });
    var res = { added: [], removed: [], changed: [], headerOnly: [], same: [] };
    Object.keys(names).sort().forEach(function (n) {
      var a = baseline[n], b = current[n];
      if (a === undefined) { res.added.push(n); return; }
      if (b === undefined) { res.removed.push(n); return; }
      if (a === b) { res.same.push(n); return; }
      var ba = bodyOf(a), bb = bodyOf(b);
      if ((norm ? norm(ba) : ba) === (norm ? norm(bb) : bb)) { res.headerOnly.push(n); return; }
      var ops = diffLines(ba, bb, opts);
      var adds = 0, dels = 0;
      ops.forEach(function (o) { if (o.t === '+') adds++; else if (o.t === '-') dels++; });
      res.changed.push({ name: n, adds: adds, dels: dels });
    });
    return res;
  }

  /* Pair ops into side-by-side rows:
   * { a: {n, text}|null, b: {n, text}|null, t: 'same'|'change'|'del'|'add' } */
  function sideBySide(ops) {
    var rows = [];
    var i = 0;
    while (i < ops.length) {
      if (ops[i].t === '=') {
        rows.push({
          a: { n: ops[i].an, text: ops[i].text },
          b: { n: ops[i].bn, text: ops[i].textB !== undefined ? ops[i].textB : ops[i].text },
          t: 'same'
        });
        i++;
        continue;
      }
      var dels = [], adds = [];
      while (i < ops.length && ops[i].t !== '=') {
        (ops[i].t === '-' ? dels : adds).push(ops[i]);
        i++;
      }
      var n = Math.max(dels.length, adds.length);
      for (var k = 0; k < n; k++) {
        rows.push({
          a: dels[k] ? { n: dels[k].an, text: dels[k].text } : null,
          b: adds[k] ? { n: adds[k].bn, text: adds[k].text } : null,
          t: dels[k] && adds[k] ? 'change' : (dels[k] ? 'del' : 'add')
        });
      }
    }
    return rows;
  }

  var api = {
    diffLines: diffLines, comparePrograms: comparePrograms, bodyOf: bodyOf,
    sideBySide: sideBySide, stripIoState: stripIoState,
    stripLineNums: stripLineNums, stripNames: stripNames, stripStamps: stripStamps
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucDiff = api;
})(typeof window !== 'undefined' ? window : globalThis);
