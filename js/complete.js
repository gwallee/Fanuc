/* Register, I/O and program name completion — the text side only.
 *
 * Typing DI[ (or R[, PR[, GI[ …) opens a list of the NAMED points of that
 * type; what follows the bracket narrows it: digits by index, letters by
 * name. Nothing here touches the DOM, and nothing runs unless the caret sits
 * right after such an opener — a plain keystroke anywhere else checks only
 * the current row. Names come from the live library
 * (state.liveNames: { r: {idx: name}, pr: {…}, io: {'DI[1]': name} }), the
 * same source the overlay and the caret strip read, so the list is exactly
 * what the controller calls things today. CALL / RUN targets come from the
 * active program library and also work without live controller name data. */
(function (global) {
  'use strict';

  var OPENER = /\b(DI|DO|RI|RO|GI|GO|UI|UO|SI|SO|WI|WO|AI|AO|F|PR|R)\[\s*([^\]\s,:]*)$/;
  var PROGRAM = /\b(CALL|RUN)[ \t]+([A-Za-z_][A-Za-z0-9_]*)?$/i;
  var LIMIT = 12;

  // A CALL/RUN inside a string, MESSAGE or an I/O label is just text.
  function inLiteral(text) {
    var brackets = 0, quote = '';
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (quote) { if (c === quote) quote = ''; }
      else if (c === '[') brackets++;
      else if (c === ']') brackets = Math.max(0, brackets - 1);
      else if (!brackets && (c === '"' || c === "'")) quote = c;
    }
    return brackets > 0 || !!quote;
  }

  /* Where the caret is, if it is inside an opener. text is the whole
   * editor, caret an offset into it. Returns null, or
   *   { type, prefix, start, end }
   * start..end is the span the chosen item replaces: everything between the
   * [ and the row's first ] inclusive, or just the prefix if there is no ]
   * yet — insertion() always writes the closing bracket. Program contexts
   * have kind:'program'; their span covers only the target name, leaving
   * arguments and the instruction terminator intact. */
  function context(text, caret) {
    var rs = text.lastIndexOf('\n', caret - 1) + 1;
    var reEnd = text.indexOf('\n', caret);
    if (reEnd === -1) reEnd = text.length;
    var before = text.slice(rs, caret);
    if (/^\s*(?:\d+:\s*)?(?:!|\/\/)/.test(before)) return null;
    var after = text.slice(caret, reEnd);
    var pm = PROGRAM.exec(before);
    if (pm && !inLiteral(before.slice(0, pm.index))) {
      var prefix = pm[2] || '';
      return {
        kind: 'program', type: pm[1].toUpperCase(), prefix: prefix,
        start: caret - prefix.length,
        end: caret + /^[A-Za-z0-9_]*/.exec(after)[0].length
      };
    }
    var m = OPENER.exec(before);
    if (!m) return null;
    if (/^[0-9A-Za-z]/.test(after)) return null;           // the caret is inside a token, not at its end
    var cm = /^[^\];]*\]/.exec(after);
    return {
      type: m[1], prefix: m[2],
      start: caret - m[2].length,
      end: cm ? caret + cm[0].length : caret
    };
  }

  /* Per-type lists, cached by the caller until state.namesRev changes.
   * Points have { index, name }; program entries have { kind, name, comment }. */
  function index(liveNames, programs) {
    var by = {};
    if (programs) {
      var seen = Object.create(null);
      by.PROGRAM = [];
      Object.keys(programs).sort().forEach(function (key) {
        var name = key.toUpperCase();
        if (!/^[A-Z_][A-Z0-9_]*$/.test(name) || seen[name]) return;
        seen[name] = true;
        var p = programs[key], attrs = p && p.parsed && p.parsed.attrs;
        by.PROGRAM.push({ kind: 'program', name: name, comment: attrs && attrs.COMMENT || '' });
      });
    }
    function add(type, idx, name) {
      if (!name) return;
      (by[type] = by[type] || []).push({ index: +idx, name: String(name) });
    }
    if (!liveNames) return by;
    Object.keys(liveNames.r || {}).forEach(function (k) { add('R', k, liveNames.r[k]); });
    Object.keys(liveNames.pr || {}).forEach(function (k) { add('PR', k, liveNames.pr[k]); });
    Object.keys(liveNames.io || {}).forEach(function (k) {
      var m = /^([A-Z]+)\[(\d+)\]$/.exec(k);
      if (m) add(m[1], m[2], liveNames.io[k]);
    });
    Object.keys(by).forEach(function (t) {
      if (t !== 'PROGRAM') by[t].sort(function (a, b) { return a.index - b.index; });
    });
    return by;
  }

  /* Digits narrow by index ("2" → 2, 20…29, 200…); anything else by name,
   * case-insensitively. At most LIMIT rows — a 512-point rack is not a list
   * anyone scrolls, they type another digit instead. */
  function matches(by, ctx, limit) {
    var list = by[ctx.kind === 'program' ? 'PROGRAM' : ctx.type] || [];
    var q = ctx.prefix;
    var out = [];
    limit = limit || LIMIT;
    if (!q) return list.slice(0, limit);
    var ql = q.toLowerCase();
    if (ctx.kind === 'program') {
      // Prefer a name that starts with the typed text, then allow fragments
      // so "pick" also finds the shop's underscore-prefixed programs.
      return list.filter(function (it) { return it.name.toLowerCase().indexOf(ql) !== -1; })
        .sort(function (a, b) {
          return (b.name.toLowerCase().indexOf(ql) === 0 ? 1 : 0) -
            (a.name.toLowerCase().indexOf(ql) === 0 ? 1 : 0);
        }).slice(0, limit);
    }
    var byIndex = /^\d+$/.test(q);
    for (var i = 0; i < list.length && out.length < limit; i++) {
      var it = list[i];
      if (byIndex ? String(it.index).indexOf(q) === 0 : it.name.toLowerCase().indexOf(ql) !== -1) out.push(it);
    }
    return out;
  }

  /* What goes between the brackets: the index and the controller's own
   * name, the way the pendant writes it — DI[1:Auto Mode]. */
  function insertion(item) {
    if (item.kind === 'program') return item.name;
    return item.index + ':' + item.name + ']';
  }

  var api = { context: context, index: index, matches: matches, insertion: insertion, LIMIT: LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Complete = api;
})(typeof window !== 'undefined' ? window : globalThis);
