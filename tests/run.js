#!/usr/bin/env node
/* ============================================================
   Aither Weather — test runner

   Serves the app on a free port, runs every suite against it in a
   real browser, and reports a single summary.

     node tests/run.js              # everything
     node tests/run.js v12 smoke    # only suites matching these names

   Requires Playwright's chromium:  npm install && npx playwright install chromium
   ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TESTS = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const rel = urlPath === '/' ? '/index.html' : urlPath;
      // Keep requests inside the project directory.
      const filePath = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream',
          // The service worker must be allowed to control the whole scope.
          'Service-Worker-Allowed': '/',
          'Cache-Control': 'no-store',
        });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function runSuite(file, baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(TESTS, file)], {
      env: Object.assign({}, process.env, { WTW_BASE_URL: baseUrl, WTW_APP_DIR: ROOT }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      const pass = (out.match(/^PASS/gm) || []).length;
      const fail = (out.match(/^FAIL/gm) || []).length;
      resolve({ file, code, pass, fail, out });
    });
  });
}

(async () => {
  const filters = process.argv.slice(2);
  const suites = fs.readdirSync(TESTS)
    .filter((f) => f.endsWith('.js') && f !== 'run.js')
    .filter((f) => !filters.length || filters.some((needle) => f.includes(needle)))
    .sort();

  if (!suites.length) {
    console.error('No suites matched.');
    process.exit(1);
  }

  const { server, port } = await serve();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Serving ${ROOT} at ${baseUrl}\nRunning ${suites.length} suite(s)\n`);

  const results = [];
  for (const suite of suites) {
    console.log(`\n──────── ${suite} ────────`);
    results.push(await runSuite(suite, baseUrl));
  }
  server.close();

  const totalPass = results.reduce((n, r) => n + r.pass, 0);
  const totalFail = results.reduce((n, r) => n + r.fail, 0);
  const broken = results.filter((r) => r.code !== 0);

  console.log('\n════════ Summary ════════');
  results.forEach((r) => {
    const status = r.code === 0 ? 'ok  ' : 'FAIL';
    console.log(`  ${status}  ${r.file.padEnd(22)} ${r.pass} passed${r.fail ? `, ${r.fail} failed` : ''}`);
  });
  console.log(`\n  ${totalPass} checks passed, ${totalFail} failed, ${broken.length} suite(s) not clean`);

  process.exit(broken.length ? 1 : 0);
})();
