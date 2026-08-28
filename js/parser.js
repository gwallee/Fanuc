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
        case 'mn':   parseBodyLine(raw, result); break;
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

  function parseBodyLine(raw, result) {
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

    result.lines.push({ num: num, motion: motion, text: text, raw: raw, comment: comment });
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

  var api = { parseLS: parseLS, unwrapMd: unwrapMd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
