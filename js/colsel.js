/* Column (rectangular) selection for the editor — the text side only.
 *
 * A rect is { r0, c0, r1, c1 } in rows and character columns of the editor
 * text, r0 <= r1 and c0 <= c1 (normalise() orders them). Columns may run past
 * the end of a short row: that is virtual space, and typing into it pads the
 * row with spaces first, the way Notepad++ does. Every function returns a new
 * text; nothing here touches the DOM. */
(function (global) {
  'use strict';

  function normalise(r) {
    return {
      r0: Math.min(r.r0, r.r1), r1: Math.max(r.r0, r.r1),
      c0: Math.min(r.c0, r.c1), c1: Math.max(r.c0, r.c1)
    };
  }

  function pad(s, n) {
    while (s.length < n) s += ' ';
    return s;
  }

  /* The block's text, one row per line — short rows contribute what they
   * have (nothing, past their end). */
  function extract(text, rect) {
    var r = normalise(rect), rows = text.split('\n'), out = [];
    for (var i = r.r0; i <= r.r1; i++) out.push((rows[i] || '').slice(r.c0, r.c1));
    return out.join('\n');
  }

  /* Replace the block in every row with str (the empty string deletes it).
   * Rows shorter than c0 are padded out so the typed text lands in the same
   * column everywhere. Returns { text, rect } with the rect collapsed to the
   * column after the insertion — the next keystroke goes there. */
  function replace(text, rect, str) {
    var r = normalise(rect), rows = text.split('\n');
    for (var i = r.r0; i <= r.r1 && i < rows.length; i++) {
      var row = rows[i];
      if (str === '' && row.length <= r.c0) continue;     // nothing to delete, don't pad
      row = pad(row, r.c0);
      rows[i] = row.slice(0, r.c0) + str + row.slice(r.c1);
    }
    var c = r.c0 + str.length;
    return { text: rows.join('\n'), rect: { r0: r.r0, c0: c, r1: r.r1, c1: c } };
  }

  /* Backspace / Delete on a collapsed (zero-width) rect: remove the character
   * before (dir = -1) or at (dir = +1) the column in every row. A rect with
   * width just deletes its contents. */
  function erase(text, rect, dir) {
    var r = normalise(rect);
    if (r.c1 > r.c0) return replace(text, r, '');
    if (dir < 0) {
      if (r.c0 === 0) return { text: text, rect: r };
      return replace(text, { r0: r.r0, c0: r.c0 - 1, r1: r.r1, c1: r.c0 }, '');
    }
    return replace(text, { r0: r.r0, c0: r.c0, r1: r.r1, c1: r.c0 + 1 }, '');
  }

  /* Paste a block: clip is the text of an earlier column copy (one line per
   * row). One clip line goes into every row of the rect; several go one per
   * row from r0 down, past the rect's bottom if there are more — the document
   * grows if they run off its end. The block replaces whatever the rect
   * covered. The returned rect spans the pasted rows, collapsed after the
   * longest line so a second paste lands beside the first. */
  function paste(text, rect, clip) {
    var r = normalise(rect), rows = text.split('\n');
    var lines = clip.replace(/\r\n?/g, '\n').split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();   // trailing newline from a line copy
    var n = lines.length === 1 ? (r.r1 - r.r0 + 1) : lines.length;
    var widest = 0;
    for (var k = 0; k < n; k++) {
      var i = r.r0 + k, s = lines.length === 1 ? lines[0] : lines[k];
      while (rows.length <= i) rows.push('');
      var row = pad(rows[i], r.c0);
      rows[i] = row.slice(0, r.c0) + s + row.slice(r.c1);
      if (s.length > widest) widest = s.length;
    }
    var c = r.c0 + widest;
    return { text: rows.join('\n'), rect: { r0: r.r0, c0: c, r1: r.r0 + n - 1, c1: c } };
  }

  /* Row/column of a character offset, and back. Past-the-end columns clamp
   * to the row's length — the textarea caret cannot sit in virtual space. */
  function toRowCol(text, pos) {
    var before = text.slice(0, pos), row = 0, nl = -1, i;
    for (i = 0; i < before.length; i++) if (before.charCodeAt(i) === 10) { row++; nl = i; }
    return { row: row, col: pos - nl - 1 };
  }
  function toPos(text, row, col) {
    var rows = text.split('\n'), pos = 0;
    if (row >= rows.length) return text.length;
    for (var i = 0; i < row; i++) pos += rows[i].length + 1;
    return pos + Math.min(col, rows[row].length);
  }

  var api = { normalise: normalise, extract: extract, replace: replace, erase: erase, paste: paste, toRowCol: toRowCol, toPos: toPos };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ColSel = api;
})(typeof window !== 'undefined' ? window : globalThis);
