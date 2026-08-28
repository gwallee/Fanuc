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

  var api = { parseNumreg: parseNumreg, rawLines: rawLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucVA = api;
})(typeof window !== 'undefined' ? window : globalThis);
