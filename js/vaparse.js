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

  var api = { parseNumreg: parseNumreg, rawLines: rawLines, parseIOComments: parseIOComments, parseIOState: parseIOState, parsePosreg: parsePosreg, posregValueStr: posregValueStr };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucVA = api;
})(typeof window !== 'undefined' ? window : globalThis);
