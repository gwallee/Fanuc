'use strict';
/* Shared helpers for release-keygen.js and publish-release.js. */

/* Read a line from the console without echoing it. */
function askSecret(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    if (!stdin.isTTY) {
      let buf = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => { buf += c; const i = buf.indexOf('\n'); if (i >= 0) { stdin.pause(); resolve(buf.slice(0, i).replace(/\r$/, '')); } });
      stdin.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
      return;
    }
    let s = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); resolve(s); return; }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (c === '\b' || c === '\u007f') s = s.slice(0, -1);
        else s += c;
      }
    };
    stdin.on('data', onData);
  });
}

module.exports = { askSecret };
