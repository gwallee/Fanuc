/* In-memory mock of a FANUC controller's web server — the HTTP side of what
 * the bridge talks to, the way mock-ftp.js is the FTP side:
 * - GET /MD/            a directory listing page with one href per file
 * - GET /MD/NAME        the file, wrapped in the iPendant page the real
 *                       controller serves (<XMP> … </XMP>), 404 when absent
 * - GET /MD/SUMMARY.DG  identity fields the scanner looks for
 * - GET /karel/ComSet?sComment=…&sIndx=…&sFc=…
 *                       the controller's own comment write: updates the
 *                       comment in NUMREG.VA (fc 1) so a read-back sees it,
 *                       or — with opts.comsetLies — answers 200 and stores
 *                       nothing, which is what the bridge's verify is for
 * - GET /MD/HANG.LS     sends the headers and half a body, then drops the
 *                       connection, like a controller resetting mid-file
 * Every request is logged in `hits` for the tests to inspect.
 */
'use strict';
const http = require('http');

function page(body) {
  return '<HTML><HEAD><TITLE>MOCK</TITLE></HEAD><BODY><XMP>\n' + body + '</XMP></BODY></HTML>';
}

function startMockHttp(port, files, opts) {
  opts = opts || {};
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://mock');
    hits.push(u.pathname + u.search);
    if (u.pathname === '/MD/' || u.pathname === '/MD') {
      const rows = Object.keys(files).map((n) => '<a href="/MD/' + n + '">' + n + '</a> 1234 28-AUG-26').join('<br>\n');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<HTML><BODY><H2>MD: directory</H2>\n' + rows + '\n</BODY></HTML>');
    }
    if (u.pathname === '/MD/HANG.LS') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': '5000' });
      res.write(page('/PROG HANG\n/MN\n   1:  R[1]=1 ;\n'));
      return setTimeout(() => req.socket.destroy(), 50);
    }
    if (u.pathname.startsWith('/MD/')) {
      const name = decodeURIComponent(u.pathname.slice(4)).toUpperCase();
      if (!(name in files)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page(files[name]));
    }
    if (/^\/karel\/comset$/i.test(u.pathname)) {
      const fc = u.searchParams.get('sFc'), idx = u.searchParams.get('sIndx'), text = u.searchParams.get('sComment');
      if (!opts.comsetLies && fc === '1' && 'NUMREG.VA' in files) {
        const re = new RegExp('^(\\[' + idx + '\\]\\s*=\\s*\\S+\\s*)\'[^\']*\'', 'm');
        files['NUMREG.VA'] = files['NUMREG.VA'].replace(re, '$1\'' + text + '\'');
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<HTML><BODY>OK</BODY></HTML>');
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    server.hits = hits;
    resolve(server);
  }));
}

module.exports = { startMockHttp };
