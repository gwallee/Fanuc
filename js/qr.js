/* QR Code encoder — byte mode, error-correction level M, versions 1-10.
 *
 * Hand-rolled because this app has no build step and no dependencies: the
 * only thing it has to encode is a short "http://<pc-ip>:8642" URL, and a
 * whole QR library (or a call out to some web service to draw one) would be
 * a far bigger commitment than the ~30 bytes of payload deserves. Level M
 * corrects ~15% of the symbol, which is what makes a code readable from a
 * phone held at arm's length in front of a slightly dirty monitor.
 *
 * Versions stop at 10 (213 bytes at level M) — many times what a LAN URL
 * needs, and past the point where the modules get too fine to scan off a
 * screen at a sensible size anyway.
 */
(function (global) {
  'use strict';

  /* ---------------- GF(256) ----------------
   * Reed-Solomon works over the field defined by x^8+x^4+x^3+x^2+1 (0x11D).
   * Log/antilog tables turn multiplication into an addition of exponents;
   * EXP runs to 512 so that sum never has to be reduced mod 255 by hand. */
  var EXP = new Array(512);
  var LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  /* Generator polynomial for n check symbols: (x - a^0)(x - a^1)...(x - a^n-1).
   * Coefficients are highest-power-first, so poly[0] is always 1. */
  function generatorPoly(n) {
    var poly = [1];
    for (var i = 0; i < n; i++) {
      var next = [];
      for (var k = 0; k <= poly.length; k++) next[k] = 0;
      for (var k = 0; k < poly.length; k++) {
        next[k] ^= poly[k];                       // multiply by x
        next[k + 1] ^= gfMul(poly[k], EXP[i]);    // ...and add a^i * poly
      }
      poly = next;
    }
    return poly;
  }

  /* The remainder of data * x^ecLen divided by the generator — i.e. the
   * error-correction codewords for one block. */
  function rsRemainder(data, ecLen) {
    var gen = generatorPoly(ecLen);
    var rem = [];
    for (var i = 0; i < ecLen; i++) rem[i] = 0;
    for (var d = 0; d < data.length; d++) {
      var factor = data[d] ^ rem[0];
      rem.shift();
      rem.push(0);
      if (factor !== 0) {
        for (var j = 0; j < ecLen; j++) rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
    return rem;
  }

  /* ---------------- version tables (level M only) ----------------
   * total: codewords in the whole symbol; ec: EC codewords per block;
   * blocks: how many blocks the data is split into. The split itself is
   * derivable — data codewords divide evenly across the blocks, and the
   * remainder goes to a second group whose blocks each hold one more. */
  var VERSIONS = [
    null,
    { total: 26,  ec: 10, blocks: 1 },
    { total: 44,  ec: 16, blocks: 1 },
    { total: 70,  ec: 26, blocks: 1 },
    { total: 100, ec: 18, blocks: 2 },
    { total: 134, ec: 24, blocks: 2 },
    { total: 172, ec: 16, blocks: 4 },
    { total: 196, ec: 18, blocks: 4 },
    { total: 242, ec: 22, blocks: 4 },
    { total: 292, ec: 22, blocks: 5 },
    { total: 346, ec: 26, blocks: 5 }
  ];
  var MAX_VERSION = 10;

  // Centres of the alignment patterns, per version.
  var ALIGN = [
    null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]
  ];

  function blockLayout(version) {
    var v = VERSIONS[version];
    var dataCw = v.total - v.ec * v.blocks;
    return {
      dataCw: dataCw,
      ecLen: v.ec,
      blocks: v.blocks,
      shortLen: Math.floor(dataCw / v.blocks),
      longCount: dataCw % v.blocks                  // blocks holding one extra
    };
  }

  /* Bytes of payload that fit, allowing for the 4-bit mode indicator and the
   * character count (8 bits up to version 9, 16 bits from version 10). */
  function capacity(version) {
    var headerBits = 4 + (version >= 10 ? 16 : 8);
    return Math.floor((blockLayout(version).dataCw * 8 - headerBits) / 8);
  }

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var lo = str.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00); i++; }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }

  /* Payload -> the symbol's data codewords: mode, length, the bytes, a
   * terminator, then the alternating 0xEC/0x11 pad the spec calls for. */
  function dataCodewords(bytes, version) {
    var bits = [];
    function push(value, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((value >> i) & 1);
    }
    var lay = blockLayout(version);
    var capacityBits = lay.dataCw * 8;
    push(4, 4);                                     // byte mode
    push(bytes.length, version >= 10 ? 16 : 8);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    push(0, Math.min(4, capacityBits - bits.length));
    while (bits.length % 8) bits.push(0);
    var cw = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      cw.push(byte);
    }
    var pad = [0xec, 0x11];
    for (var p = 0; cw.length < lay.dataCw; p++) cw.push(pad[p % 2]);
    return cw;
  }

  /* Split into blocks, compute each block's EC, then interleave: one codeword
   * from every block in turn, so a scratch across the symbol damages a little
   * of each block rather than destroying one outright. */
  function interleave(cw, version) {
    var lay = blockLayout(version);
    var dataBlocks = [];
    var ecBlocks = [];
    var at = 0;
    for (var b = 0; b < lay.blocks; b++) {
      var len = lay.shortLen + (b >= lay.blocks - lay.longCount ? 1 : 0);
      var block = cw.slice(at, at + len);
      at += len;
      dataBlocks.push(block);
      ecBlocks.push(rsRemainder(block, lay.ecLen));
    }
    var out = [];
    var maxData = lay.shortLen + (lay.longCount ? 1 : 0);
    for (var i = 0; i < maxData; i++) {
      for (var d = 0; d < dataBlocks.length; d++) {
        if (i < dataBlocks[d].length) out.push(dataBlocks[d][i]);
      }
    }
    for (var j = 0; j < lay.ecLen; j++) {
      for (var e = 0; e < ecBlocks.length; e++) out.push(ecBlocks[e][j]);
    }
    return out;
  }

  /* ---------------- the symbol ---------------- */

  function blank(size) {
    var m = [];
    for (var r = 0; r < size; r++) {
      var row = [];
      for (var c = 0; c < size; c++) row.push(0);
      m.push(row);
    }
    return m;
  }

  function drawFunctionPatterns(m, fn, version) {
    var size = m.length;
    function set(r, c, dark) {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      m[r][c] = dark ? 1 : 0;
      fn[r][c] = 1;
    }

    /* Finders and their separators in one go: the 9x9 neighbourhood of each
     * centre is dark wherever the Chebyshev distance from the centre is
     * neither 2 (the white ring) nor 4 (the separator). */
    var centres = [[3, 3], [3, size - 4], [size - 4, 3]];
    for (var f = 0; f < centres.length; f++) {
      for (var dr = -4; dr <= 4; dr++) {
        for (var dc = -4; dc <= 4; dc++) {
          var dist = Math.max(Math.abs(dr), Math.abs(dc));
          set(centres[f][0] + dr, centres[f][1] + dc, dist !== 2 && dist !== 4);
        }
      }
    }

    // Timing patterns: the alternating row and column at index 6.
    for (var i = 0; i < size; i++) {
      if (!fn[6][i]) set(6, i, i % 2 === 0);
      if (!fn[i][6]) set(i, 6, i % 2 === 0);
    }

    /* Alignment patterns at every pair of centres, minus the three that would
     * land on a finder. */
    var pos = ALIGN[version];
    for (var a = 0; a < pos.length; a++) {
      for (var b = 0; b < pos.length; b++) {
        var corner = (a === 0 && b === 0) ||
                     (a === 0 && b === pos.length - 1) ||
                     (a === pos.length - 1 && b === 0);
        if (corner) continue;
        for (var y = -2; y <= 2; y++) {
          for (var x = -2; x <= 2; x++) {
            set(pos[a] + y, pos[b] + x, Math.max(Math.abs(y), Math.abs(x)) !== 1);
          }
        }
      }
    }

    /* Reserve the format-information strips (written once the mask is known).
     * Index 6 is skipped in both: that is where the timing patterns cross the
     * strips, and those modules belong to the timing, not the format — the
     * format bits step around them. */
    for (var k = 0; k <= 8; k++) {
      if (k === 6) continue;
      set(8, k, 0);
      set(k, 8, 0);
    }
    for (var n = 0; n < 8; n++) { set(8, size - 1 - n, 0); set(size - 1 - n, 8, 0); }
    set(size - 8, 8, 1);                            // the always-dark module

    if (version >= 7) drawVersionInfo(m, version, set);
  }

  /* Version 7 and up carry the version number twice, BCH(18,6) coded. */
  function drawVersionInfo(m, version, set) {
    var size = m.length;
    var rem = version;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    var bits = (version << 12) | rem;
    for (var k = 0; k < 18; k++) {
      var bit = (bits >>> k) & 1;
      var a = size - 11 + (k % 3);
      var b = Math.floor(k / 3);
      set(b, a, bit);
      set(a, b, bit);
    }
  }

  /* Format info: EC level (M = 0b00) and mask, BCH(15,5) coded and XORed with
   * 0x5412 so an all-zero format never produces an all-light strip. */
  function drawFormatInfo(m, mask) {
    var size = m.length;
    var data = (0 << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    function bit(i) { return (bits >>> i) & 1; }

    for (var k = 0; k <= 5; k++) m[k][8] = bit(k);
    m[7][8] = bit(6);
    m[8][8] = bit(7);
    m[8][7] = bit(8);
    for (var j = 9; j < 15; j++) m[8][14 - j] = bit(j);

    for (var n = 0; n < 8; n++) m[8][size - 1 - n] = bit(n);
    for (var p = 8; p < 15; p++) m[size - 15 + p][8] = bit(p);
    m[size - 8][8] = 1;
  }

  /* Zigzag up and down two-module-wide columns from the bottom right,
   * skipping the vertical timing column. Modules past the end of the data are
   * the symbol's remainder bits and stay light. */
  function placeData(m, fn, bits) {
    var size = m.length;
    var i = 0;
    var dir = -1;
    var row = size - 1;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (!fn[row][cc]) {
            m[row][cc] = i < bits.length ? bits[i] : 0;
            i++;
          }
        }
        row += dir;
        if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
      }
    }
  }

  function maskBit(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0;
      default: return ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0;
    }
  }

  function applyMask(m, fn, mask) {
    for (var r = 0; r < m.length; r++) {
      for (var c = 0; c < m.length; c++) {
        if (!fn[r][c] && maskBit(mask, r, c)) m[r][c] ^= 1;
      }
    }
  }

  /* The four penalty rules from the spec. Lower is better; the mask that
   * scores lowest is the one leaving the fewest features a scanner could
   * mistake for a finder pattern or lose the edge of. */
  var FINDER_RUN = [1, 0, 1, 1, 1, 0, 1];

  function lineScore(get, size) {
    var run = 1;
    var s = 0;
    for (var i = 1; i < size; i++) {
      if (get(i) === get(i - 1)) {
        run++;
        if (run === 5) s += 3;
        else if (run > 5) s += 1;
      } else run = 1;
    }
    /* Rule 3: the 1:1:3:1:1 finder shape with four light modules on either
     * side of it — the sequence a scanner uses to locate the symbol, so it
     * must not turn up loose in the data. */
    for (var j = 0; j + 10 < size; j++) {
      var pre = true;
      var post = true;
      for (var k = 0; k < 7; k++) {
        if (get(j + k) !== FINDER_RUN[k]) pre = false;
        if (get(j + 4 + k) !== FINDER_RUN[k]) post = false;
      }
      for (var a = 7; pre && a < 11; a++) if (get(j + a) !== 0) pre = false;
      for (var b = 0; post && b < 4; b++) if (get(j + b) !== 0) post = false;
      if (pre) s += 40;
      if (post) s += 40;
    }
    return s;
  }

  function penalty(m) {
    var size = m.length;
    var score = 0;
    var dark = 0;

    for (var r = 0; r < size; r++) {
      score += lineScore(rowReader(m, r), size);
    }
    for (var c = 0; c < size; c++) {
      score += lineScore(colReader(m, c), size);
    }

    // Rule 2: any 2x2 block of one colour.
    for (var y = 0; y + 1 < size; y++) {
      for (var x = 0; x + 1 < size; x++) {
        var v = m[y][x];
        if (v === m[y][x + 1] && v === m[y + 1][x] && v === m[y + 1][x + 1]) score += 3;
      }
    }

    // Rule 4: how far the dark/light balance strays from 50%.
    for (var i = 0; i < size; i++) {
      for (var j = 0; j < size; j++) if (m[i][j]) dark++;
    }
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  }

  function rowReader(m, r) { return function (i) { return m[r][i]; }; }
  function colReader(m, c) { return function (i) { return m[i][c]; }; }

  function smallestVersion(byteLen) {
    for (var v = 1; v <= MAX_VERSION; v++) {
      if (byteLen <= capacity(v)) return v;
    }
    return 0;
  }

  /* Encode `text`, returning the finished module matrix. */
  function encode(text, opts) {
    opts = opts || {};
    var bytes = utf8Bytes(String(text));
    var version = opts.version || smallestVersion(bytes.length);
    if (!version) {
      throw new Error('QR: ' + bytes.length + ' bytes is more than the ' +
                      capacity(MAX_VERSION) + ' this encoder handles');
    }
    if (bytes.length > capacity(version)) {
      throw new Error('QR: text too long for version ' + version);
    }

    var codewords = interleave(dataCodewords(bytes, version), version);
    var bits = [];
    for (var i = 0; i < codewords.length; i++) {
      for (var b = 7; b >= 0; b--) bits.push((codewords[i] >> b) & 1);
    }

    var size = version * 4 + 17;
    var fn = blank(size);
    var base = blank(size);
    drawFunctionPatterns(base, fn, version);
    placeData(base, fn, bits);

    var best = null;
    var forced = (typeof opts.mask === 'number') ? opts.mask : -1;
    for (var mask = 0; mask < 8; mask++) {
      if (forced >= 0 && mask !== forced) continue;
      var m = base.map(function (row) { return row.slice(); });
      applyMask(m, fn, mask);
      drawFormatInfo(m, mask);
      var score = penalty(m);
      if (!best || score < best.score) best = { score: score, mask: mask, modules: m };
    }

    return { size: size, version: version, mask: best.mask, modules: best.modules };
  }

  /* Render as SVG. Deliberately black on white whatever the page theme is:
   * plenty of scanners refuse an inverted symbol, and a QR no phone will read
   * is worse than no QR at all. The quiet zone is part of the format — without
   * it the symbol runs into the page and stops scanning. */
  function svg(text, opts) {
    opts = opts || {};
    var sym = encode(text, opts);
    var margin = opts.margin === undefined ? 4 : opts.margin;
    var span = sym.size + margin * 2;
    var d = [];
    for (var r = 0; r < sym.size; r++) {
      for (var c = 0; c < sym.size; c++) {
        if (sym.modules[r][c]) d.push('M' + (c + margin) + ' ' + (r + margin) + 'h1v1h-1z');
      }
    }
    var px = opts.size || 232;
    var label = String(opts.label === undefined ? text : opts.label).replace(/[&<>"]/g, '');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '"' +
           ' viewBox="0 0 ' + span + ' ' + span + '" shape-rendering="crispEdges"' +
           ' role="img" aria-label="' + label + '">' +
           '<rect width="' + span + '" height="' + span + '" fill="#ffffff"/>' +
           '<path fill="#000000" d="' + d.join('') + '"/></svg>';
  }

  var api = {
    encode: encode,
    svg: svg,
    capacity: capacity,
    maxBytes: capacity(MAX_VERSION)
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucQR = api;
})(typeof window !== 'undefined' ? window : globalThis);
