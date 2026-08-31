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
  var IO_STATE_RE = /(\[\s*\d+\s*):(?:ON|OFF)\s*:/g;

  function stripIoState(text) {
    IO_STATE_RE.lastIndex = 0;
    return text.replace(IO_STATE_RE, '$1:');
  }

  function keyer(opts) { return (opts && opts.ignoreIoState) ? stripIoState : null; }

  /* Classic LCS line diff. Returns ops: {t: '='|'-'|'+', text, textB, an, bn}
   * (an/bn are 1-based line numbers in a/b where applicable).
   * opts.ignoreIoState compares lines with the inline I/O state removed while
   * every op still carries the text as it was actually written — textB is the
   * b-side original of an '=' op, which can differ from text by exactly the
   * state that was ignored. */
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
    sideBySide: sideBySide, stripIoState: stripIoState
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucDiff = api;
})(typeof window !== 'undefined' ? window : globalThis);
