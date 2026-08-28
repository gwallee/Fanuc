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

  var api = { parseNumreg: parseNumreg, rawLines: rawLines, parseIOComments: parseIOComments };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucVA = api;
})(typeof window !== 'undefined' ? window : globalThis);
