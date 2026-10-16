/* FANUC .LS (ASCII teach pendant listing) parser.
 * Produces: { name, attrs, appl, lines[], positions[], errors[], source }
 *   lines[]: { num, motion, text, raw, comment }
 *   positions[]: { id, name, groups: [{ group, rep, uf, ut, config, coords }] }
 */
(function (global) {
  'use strict';

  /* Controllers with the web server enabled serve MD: files wrapped in an
   * HTML page (the iPendant homepage) with the real listing inside <XMP>.
   * Unwrap that so the stored source is the clean .LS. */
  function unwrapMd(source) {
    if (!/^\s*</.test(source)) return source;
    var m = source.match(/<XMP>\r?\n?([\s\S]*?)<\/XMP>/i);
    if (m) return m[1];
    // no closing tag (truncated page) — take /PROG through /END
    var start = source.search(/^\/PROG\b/m);
    if (start === -1) return source;
    var endM = /^\/END\b.*$/m.exec(source.slice(start));
    return endM ? source.slice(start, start + endM.index + endM[0].length) + '\n' : source.slice(start);
  }

  function parseLS(rawSource, filename) {
    var source = unwrapMd(rawSource);
    var result = {
      name: null,
      filename: filename || '',
      attrs: {},
      appl: [],
      lines: [],
      positions: [],
      errors: [],
      source: source
    };

    var rawLines = source.split(/\r\n|\r|\n/);
    var section = null; // 'attr' | 'appl' | 'mn' | 'pos' | 'end'
    var posBuffer = [];

    for (var i = 0; i < rawLines.length; i++) {
      var raw = rawLines[i];
      var trimmed = raw.trim();

      if (/^\/PROG\b/i.test(trimmed)) {
        var m = trimmed.match(/^\/PROG\s+([^\s]+)/i);
        if (m) result.name = m[1];
        section = 'prog';
        continue;
      }
      if (/^\/ATTR\b/i.test(trimmed)) { section = 'attr'; continue; }
      if (/^\/APPL\b/i.test(trimmed)) { section = 'appl'; continue; }
      if (/^\/MN\b/i.test(trimmed))   { section = 'mn'; continue; }
      if (/^\/POS\b/i.test(trimmed)) {
        section = 'pos';
        posBuffer = [];
        continue;
      }
      if (/^\/END\b/i.test(trimmed)) {
        if (section === 'pos' && posBuffer.length) flushPositions(posBuffer, result);
        section = 'end';
        continue;
      }

      switch (section) {
        case 'attr': parseAttrLine(trimmed, result); break;
        case 'appl': if (trimmed) result.appl.push(trimmed); break;
        case 'mn':   parseBodyLine(raw, result, i + 1); break;
        case 'pos':  posBuffer.push(raw); break;
      }
    }

    if (section === 'pos' && posBuffer.length) flushPositions(posBuffer, result);

    if (!result.name) {
      // fall back to filename without extension
      result.name = (filename || 'UNTITLED').replace(/\.[^.]*$/, '').toUpperCase();
      result.errors.push('No /PROG header found; using filename as program name.');
    }
    return result;
  }

  function parseAttrLine(line, result) {
    if (!line) return;
    // TCD: and DEFAULT_GROUP style lines can span; keep it simple: KEY = VALUE;
    var m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*?);?\s*$/i);
    if (m) {
      var key = m[1].toUpperCase();
      var val = m[2].replace(/^"|"$/g, '').trim();
      result.attrs[key] = val;
      return;
    }
    // continuation lines of TCD block: "TASK_PRIORITY = 50," etc.
    var c = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*?),?\s*;?\s*$/i);
    if (c) result.attrs[c[1].toUpperCase()] = c[2].trim();
  }

  /* fileLine is the 1-based line of `raw` in the cleaned source, so an edit
   * made to a parsed line can be written back to the right place. A wrapped
   * instruction keeps the fileLine of its first row; its raw spans the rest. */
  function parseBodyLine(raw, result, fileLine) {
    // "   5:J P[1:home] 100% FINE ;"  |  "  12:  IF R[1]<3,JMP LBL[1] ;"
    var m = raw.match(/^\s*(\d+)\s*:(.*)$/);
    if (!m) {
      if (raw.trim()) {
        // continuation of the previous logical line — long lines wrap as
        // "    :  rest of the instruction"
        var prev = result.lines[result.lines.length - 1];
        if (prev) {
          var cont = raw.replace(/^\s*:\s?/, '').replace(/\s*;\s*$/, '').trim();
          prev.text = (prev.text.replace(/\s*;\s*$/, '') + ' ' + cont).trim();
          prev.raw += '\n' + raw;
        }
      }
      return;
    }
    var num = parseInt(m[1], 10);
    var rest = m[2];
    var motion = null;

    // Motion lines put J/L/C/A/S immediately after the colon (no leading spaces).
    var mm = rest.match(/^([JLCAS])\s+(?=P\[|PR\[)/);
    if (mm) {
      motion = mm[1];
      rest = rest.slice(mm[0].length);
    }

    var text = rest.replace(/\s*;\s*$/, '').trim();
    var comment = null;
    if (/^!/.test(text)) comment = text.replace(/^!\s*/, '');
    if (/^\/\//.test(text)) comment = text.replace(/^\/\/\s*/, '');

    result.lines.push({ num: num, motion: motion, text: text, raw: raw, comment: comment, fileLine: fileLine || null });
  }

  /* Write edited body lines back into a source listing. Each edit names the
   * fileLine a parsed line started on, how many file rows its raw spanned
   * (1 unless the instruction wrapped) and the new raw text, which may itself
   * hold newlines. Rows are replaced from the bottom up so earlier fileLines
   * stay valid, and the listing keeps whichever line ending it arrived with. */
  function applyLineEdits(source, edits) {
    var eol = /\r\n/.test(source) ? '\r\n' : '\n';
    var rows = source.split(/\r\n|\r|\n/);
    edits.slice().sort(function (a, b) { return b.fileLine - a.fileLine; }).forEach(function (e) {
      var args = [e.fileLine - 1, e.count || 1].concat(String(e.text).split('\n'));
      rows.splice.apply(rows, args);
    });
    return rows.join(eol);
  }

  function flushPositions(bufferLines, result) {
    var text = bufferLines.join('\n');
    // Split into P[...] { ... }; blocks
    var blockRe = /P\[(\d+)(?:\s*:\s*"([^"]*)")?\]\s*\{([\s\S]*?)\}\s*;/g;
    var m;
    while ((m = blockRe.exec(text)) !== null) {
      var pos = { id: parseInt(m[1], 10), name: m[2] || '', groups: [] };
      parsePositionBody(m[3], pos, result);
      result.positions.push(pos);
    }
  }

  function parsePositionBody(body, pos, result) {
    // Split by GPn: markers (multi-group). If none, treat whole body as GP1.
    var parts = body.split(/\bGP(\d+)\s*:/);
    if (parts.length === 1) {
      pos.groups.push(parseGroup(1, body));
      return;
    }
    // parts: ["", "1", body1, "2", body2, ...]
    for (var i = 1; i < parts.length; i += 2) {
      pos.groups.push(parseGroup(parseInt(parts[i], 10), parts[i + 1] || ''));
    }
  }

  function parseGroup(groupNum, body) {
    var g = { group: groupNum, rep: 'cartesian', uf: null, ut: null, config: null, coords: {} };
    var m;
    if ((m = body.match(/\bUF\s*:\s*(\d+)/)))  g.uf = parseInt(m[1], 10);
    if ((m = body.match(/\bUT\s*:\s*(\d+)/)))  g.ut = parseInt(m[1], 10);
    if ((m = body.match(/\bCONFIG\s*:\s*'([^']*)'/))) g.config = m[1];

    // Cartesian: X = 1.0 mm, ... W/P/R deg; extended axes E1..E3
    var cartRe = /\b([XYZWPR]|E\d)\s*=\s*(-?[\d.]+)\s*(mm|deg)/g;
    var found = false;
    while ((m = cartRe.exec(body)) !== null) {
      g.coords[m[1]] = { value: parseFloat(m[2]), unit: m[3] };
      found = true;
    }
    // Joint: J1 = 12.345 deg, ...
    var jointRe = /\bJ(\d+)\s*=\s*(-?[\d.]+)\s*(deg|mm)/g;
    var joint = false;
    while ((m = jointRe.exec(body)) !== null) {
      g.coords['J' + m[1]] = { value: parseFloat(m[2]), unit: m[3] };
      joint = true;
    }
    if (joint && !found) g.rep = 'joint';
    return g;
  }

  /* A position value the way the controller prints one: three decimals, no
   * leading zero on a fraction (.083, -.007). */
  function fmtPosValue(v) {
    var s = (Math.round(v * 1000) / 1000).toFixed(3);
    if (s === '-0.000') s = '0.000';
    return s.replace(/^(-?)0\./, '$1.');
  }

  /* Write one field of a taught position back into the listing text:
   * field is a coordinate (X Y Z W P R, J1…J9, E1…E3), 'UF', 'UT' or
   * 'CONFIG'; group is the GPn the value belongs to (1 for a single-group
   * position). Only the value's own characters change — the controller's
   * tabs, padding and line endings stay, and a shorter number is padded to
   * the width the old one had so the columns keep lining up. Returns the new
   * source, or null when there is no such position, group or field. */
  function setPositionField(source, id, group, field, value) {
    var posAt = source.search(/^\/POS\b/m);
    if (posAt === -1) return null;
    var tail = source.slice(posAt);
    var blockRe = new RegExp('P\\[' + id + '(?:\\s*:\\s*"[^"]*")?\\]\\s*\\{([\\s\\S]*?)\\}\\s*;');
    var bm = blockRe.exec(tail);
    if (!bm) return null;
    var body = bm[1];
    var bodyAt = posAt + bm.index + bm[0].indexOf('{') + 1;
    var gStart = 0, gEnd = body.length;
    var markers = [], gm, gre = /\bGP(\d+)\s*:/g;
    while ((gm = gre.exec(body)) !== null) markers.push({ n: parseInt(gm[1], 10), start: gm.index, end: gm.index + gm[0].length });
    if (markers.length) {
      var k = -1;
      for (var i = 0; i < markers.length; i++) if (markers[i].n === group) { k = i; break; }
      if (k === -1) return null;
      gStart = markers[k].end;
      gEnd = k + 1 < markers.length ? markers[k + 1].start : body.length;
    } else if (group !== 1) return null;
    var seg = body.slice(gStart, gEnd), re, out;
    if (field === 'UF' || field === 'UT') {
      re = new RegExp('(\\b' + field + '\\s*:\\s*)(\\d+)');
      if (!re.test(seg)) return null;
      out = seg.replace(re, function (_, head) { return head + String(Math.max(0, Math.floor(Number(value)))); });
    } else if (field === 'CONFIG') {
      re = /(\bCONFIG\s*:\s*')([^']*)(')/;
      if (!re.test(seg)) return null;
      out = seg.replace(re, function (_, head, _old, q) { return head + String(value).replace(/'/g, '') + q; });
    } else {
      re = new RegExp('(\\b' + field + '\\s*=\\s*)(-?[\\d.]+)');
      if (!re.test(seg)) return null;
      out = seg.replace(re, function (_, head, old) {
        var s = fmtPosValue(Number(value));
        while (s.length < old.length) s = ' ' + s;
        return head + s;
      });
    }
    var newBody = body.slice(0, gStart) + out + body.slice(gEnd);
    return source.slice(0, bodyAt) + newBody + source.slice(bodyAt + body.length);
  }

  /* FANUC load errors (ASBN-009 "on line 76") count PHYSICAL file lines —
   * header included — not teach-pendant line numbers. Map one to the other
   * using the exact source that was uploaded. */
  function mapFileLine(source, fileLine) {
    var lines = source.split(/\r\n|\r|\n/);
    var t = lines[fileLine - 1];
    if (t === undefined) return null;
    var m = t.match(/^\s*(\d+)\s*:/);
    return { raw: t.trim(), progLine: m ? parseInt(m[1], 10) : null };
  }

  var api = { parseLS: parseLS, unwrapMd: unwrapMd, mapFileLine: mapFileLine, applyLineEdits: applyLineEdits, setPositionField: setPositionField, fmtPosValue: fmtPosValue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
