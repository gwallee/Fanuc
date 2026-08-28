#!/usr/bin/env node
/* FANUC TP Program Studio — bridge server.
 *
 * Serves the app AND adds what a browser alone cannot do:
 *   - talk to a robot controller by IP over its HTTP interface (MD: device)
 *   - read/write .LS files in local directories by path
 *
 * Zero dependencies. Run:  node server.js  [port]
 * Then open http://localhost:8642 — or from your phone on the same
 * network, http://<this-pc-ip>:8642
 *
 * Robot-side requirement: the controller's built-in web server (HTTP)
 * must be enabled (Host Comm → HTTP). Files are read from http://<robot>/MD/.
 * This bridge only READS from robots — it never writes to a controller.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const PORT = parseInt(process.argv[2], 10) || 8642;
const ROBOT_TIMEOUT_MS = 6000;
const MAX_BODY = 5 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ls': 'text/plain; charset=utf-8'
};

const READ_EXTS = /\.(ls|va|io|dg|tp|txt|dt|sv|vr)$/i;
const WRITE_EXTS = /\.ls$/i;
const ROBOT_NAME = /^[A-Za-z0-9_.$-]+$/;      // filenames on MD:
const ROBOT_HOST = /^[A-Za-z0-9.-]+$/;        // IP or hostname

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function fail(res, code, message) { json(res, code, { error: message }); }

/* Fetch a file from the robot's MD: device over HTTP.
 * Deliberately plain http.request with no proxy: robots live on the LAN. */
function robotGet(host, filePath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port: 80, path: filePath, method: 'GET', timeout: ROBOT_TIMEOUT_MS },
      (r) => {
        if (r.statusCode !== 200) {
          r.resume();
          return reject(new Error('robot answered HTTP ' + r.statusCode + ' for ' + filePath));
        }
        const chunks = [];
        let size = 0;
        r.on('data', (c) => {
          size += c.length;
          if (size > MAX_BODY) { req.destroy(); return reject(new Error('response too large')); }
          chunks.push(c);
        });
        r.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      }
    );
    req.on('timeout', () => { req.destroy(new Error('robot did not answer within ' + ROBOT_TIMEOUT_MS / 1000 + 's — check the IP and that HTTP is enabled on the controller')); });
    req.on('error', reject);
    req.end();
  });
}

/* Extract program/variable filenames from an MD: directory listing page.
 * Listing HTML varies by controller version, so scrape both hrefs and
 * bare NAME.EXT tokens. */
function scrapeFileNames(html) {
  const names = new Set();
  let m;
  const hrefRe = /href="?\/?(?:MD\/)?([A-Za-z0-9_$.-]+\.(?:LS|VA|IO|DG|TP|DT|SV|VR))"?/gi;
  while ((m = hrefRe.exec(html)) !== null) names.add(m[1].toUpperCase());
  const bareRe = /\b([A-Z0-9_$-]{1,36}\.(?:LS|VA|IO|DG))\b/g;
  while ((m = bareRe.exec(html)) !== null) names.add(m[1].toUpperCase());
  return [...names].sort();
}

async function handleApi(req, res, u) {
  const q = u.searchParams;

  if (u.pathname === '/api/ping') {
    return json(res, 200, { ok: true, app: 'fanuc-tp-studio-bridge', version: 2 });
  }

  if (u.pathname === '/api/dir/list') {
    const dir = q.get('path');
    if (!dir) return fail(res, 400, 'missing ?path=');
    let entries;
    try { entries = walk(path.resolve(dir), 3); }
    catch (e) { return fail(res, 400, 'cannot read directory: ' + e.message); }
    return json(res, 200, { path: path.resolve(dir), files: entries });
  }

  if (u.pathname === '/api/dir/file' && req.method === 'GET') {
    const p = q.get('path');
    if (!p) return fail(res, 400, 'missing ?path=');
    if (!READ_EXTS.test(p)) return fail(res, 400, 'only robot file types can be read (.ls .va .io .dg .tp .txt .dt .sv .vr)');
    try {
      const content = fs.readFileSync(path.resolve(p), 'utf8');
      return json(res, 200, { path: path.resolve(p), name: path.basename(p), content });
    } catch (e) { return fail(res, 404, e.message); }
  }

  if (u.pathname === '/api/dir/file' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      try {
        const { path: p, content } = JSON.parse(body);
        if (!p || typeof content !== 'string') return fail(res, 400, 'need {path, content}');
        if (!WRITE_EXTS.test(p)) return fail(res, 400, 'only .LS files can be written');
        if (!fs.existsSync(path.resolve(p))) return fail(res, 400, 'refusing to create new files — the target must already exist');
        fs.writeFileSync(path.resolve(p), content, 'utf8');
        return json(res, 200, { ok: true, path: path.resolve(p) });
      } catch (e) { return fail(res, 400, e.message); }
    });
    return;
  }

  if (u.pathname === '/api/robot/list') {
    const ip = q.get('ip');
    if (!ip || !ROBOT_HOST.test(ip)) return fail(res, 400, 'missing or invalid ?ip=');
    try {
      const html = await robotGet(ip, '/MD/');
      return json(res, 200, { ip, files: scrapeFileNames(html) });
    } catch (e) { return fail(res, 502, e.message); }
  }

  if (u.pathname === '/api/robot/file') {
    const ip = q.get('ip');
    const name = q.get('name');
    if (!ip || !ROBOT_HOST.test(ip)) return fail(res, 400, 'missing or invalid ?ip=');
    if (!name || !ROBOT_NAME.test(name)) return fail(res, 400, 'missing or invalid ?name=');
    try {
      const content = await robotGet(ip, '/MD/' + encodeURIComponent(name.toUpperCase()));
      return json(res, 200, { ip, name: name.toUpperCase(), content });
    } catch (e) { return fail(res, 502, e.message); }
  }

  return fail(res, 404, 'unknown API route');
}

function walk(dir, depth) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (depth > 0 && !ent.name.startsWith('.')) out.push(...walk(full, depth - 1));
    } else if (READ_EXTS.test(ent.name)) {
      const st = fs.statSync(full);
      out.push({ name: ent.name, path: full, size: st.size, mtime: st.mtime.toISOString() });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = path.join(ROOT, path.normalize(rel));
  if (!full.startsWith(ROOT)) return fail(res, 403, 'forbidden');
  fs.readFile(full, (err, data) => {
    if (err) return fail(res, 404, 'not found: ' + pathname);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) {
    handleApi(req, res, u).catch((e) => fail(res, 500, e.message));
  } else {
    serveStatic(res, u.pathname);
  }
}).listen(PORT, () => {
  console.log('FANUC TP Program Studio bridge running:');
  console.log('  this PC:    http://localhost:' + PORT);
  console.log('  your phone: http://<this-pc-ip>:' + PORT + '  (same network)');
  console.log('Robot access reads http://<robot-ip>/MD/ — enable HTTP on the controller (Host Comm).');
});
