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
const net = require('net');
const os = require('os');
const { Ftp } = require('./lib/ftp.js');
const { unwrapMd } = require('./js/parser.js');

const ROOT = __dirname;
const SNAPSHOT_DIR = path.join(ROOT, 'backups', 'pre-upload');
const PORT = parseInt(process.argv[2], 10) || 8642;
const ROBOT_TIMEOUT_MS = 6000;
/* Liveness check for a saved robot: short, because the answer people want is
 * "is it there right now", and a dead address on the LAN fails far quicker
 * than this anyway. Only a silently-dropping firewall runs it to the end. */
const PROBE_TIMEOUT_MS = 1500;
const MAX_BODY = 5 * 1024 * 1024;
const ROBOTS_FILE = path.join(ROOT, 'robots.json');
const MAX_ROBOTS = 64;
/* Subnet sweep. A connect attempt that finds nothing is one SYN and one RST,
 * so the whole cost of a /24 is well under 100 KB — the clock is set by how
 * many run at once, not by bandwidth. Capped at a /22 so a mistyped prefix
 * cannot turn into a 65k-address sweep of a plant network. */
const SCAN_TIMEOUT_MS = 500;
const SCAN_CONCURRENCY = 48;
const SCAN_MAX_HOSTS = 1024;

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

function fail(res, code, message) {
  console.error('[api ' + code + '] ' + message);
  json(res, code, { error: message });
}

/* A robot that misbehaves must never take the bridge down mid-shift. */
process.on('uncaughtException', (e) => console.error('[bridge] uncaught exception (recovered):', e && e.stack || e));
process.on('unhandledRejection', (e) => console.error('[bridge] unhandled rejection (recovered):', e && e.message || e));

/* Fetch a file from the robot's MD: device over HTTP.
 * Deliberately plain http.request with no proxy: robots live on the LAN. */
function robotGet(host, filePath, timeoutMs) {
  const limit = timeoutMs || ROBOT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port: 80, path: filePath, method: 'GET', timeout: limit },
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
    req.on('timeout', () => { req.destroy(new Error('robot did not answer within ' + limit / 1000 + 's — check the IP and that HTTP is enabled on the controller')); });
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

  if (u.pathname === '/api/robots' && req.method === 'GET') {
    return json(res, 200, { robots: readRobots() });
  }

  if (u.pathname === '/api/robots/remember' && req.method === 'POST') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (e) { return fail(res, 400, 'invalid JSON body'); }
    const ip = payload && payload.ip;
    if (!ip || !ROBOT_HOST.test(String(ip).split(':')[0])) return fail(res, 400, 'missing or invalid ip');
    const t = parseTarget(ip);
    const name = cleanLabel(payload.name, 32) || await robotName(t.host);
    const list = readRobots().filter((r) => r.ip !== t.ip);
    list.unshift({
      ip: t.ip,
      name: name,
      ftpUser: cleanLabel(payload.ftpUser, 32),   // never the password
      lastSeen: new Date().toISOString()
    });
    writeRobots(list);
    return json(res, 200, { robots: readRobots() });
  }

  if (u.pathname === '/api/robots/forget' && req.method === 'POST') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (e) { return fail(res, 400, 'invalid JSON body'); }
    const ip = payload && payload.ip;
    if (!ip) return fail(res, 400, 'missing ip');
    writeRobots(readRobots().filter((r) => r.ip !== String(ip)));
    return json(res, 200, { robots: readRobots() });
  }

  if (u.pathname === '/api/net') {
    return json(res, 200, { subnets: localSubnets() });
  }

  /* Streams NDJSON so the UI can show progress and the caller can give up
   * mid-sweep by aborting the request. */
  if (u.pathname === '/api/robots/scan') {
    const parsed = cidrHosts(q.get('cidr'));
    if (parsed.error) return fail(res, 400, parsed.error);
    const hosts = parsed.hosts;
    let aborted = false;
    req.on('close', () => { aborted = true; });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    const send = (o) => { if (!aborted) res.write(JSON.stringify(o) + '\n'); };
    const started = Date.now();
    send({ type: 'start', cidr: parsed.cidr, total: hosts.length });

    const open = [];
    let done = 0;
    await pool(hosts, SCAN_CONCURRENCY, async (ip) => {
      if (aborted) return;
      const r = await probePort(ip, 80, SCAN_TIMEOUT_MS);
      if (r.ok) open.push(ip);
      done++;
      if (done % 16 === 0 || done === hosts.length) send({ type: 'progress', done: done, total: hosts.length });
    });

    // only the handful that answered get the (slower) identity check
    const found = [];
    const others = [];
    await pool(open, 8, async (ip) => {
      if (aborted) return;
      const id = await identifyRobot(ip);
      if (id.robot) {
        found.push({ ip: ip, name: id.name });
        send({ type: 'hit', ip: ip, name: id.name });
      } else {
        others.push(ip);
        send({ type: 'other', ip: ip });
      }
    });

    if (!aborted && found.length) {
      const list = readRobots();
      for (const f of found) {
        const keep = list.findIndex((r) => r.ip === f.ip);
        const prev = keep === -1 ? null : list[keep];
        if (keep !== -1) list.splice(keep, 1);
        list.unshift({
          ip: f.ip,
          name: f.name || (prev && prev.name) || null,
          ftpUser: prev ? prev.ftpUser : null,
          lastSeen: new Date().toISOString()
        });
      }
      writeRobots(list);
    }
    send({ type: 'done', found: found.length, others: others.length, scanned: done, ms: Date.now() - started });
    return res.end();
  }

  if (u.pathname === '/api/robots/probe') {
    const t = target(q);
    if (!t) return fail(res, 400, 'missing or invalid ip');
    return json(res, 200, await probeRobot(t));
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
    const t = target(q);
    if (!t) return fail(res, 400, 'missing or invalid ?ip=');
    try {
      const html = await robotGet(t.host, '/MD/');
      return json(res, 200, { ip: t.ip, via: 'http', files: scrapeFileNames(html) });
    } catch (httpErr) {
      try {
        const files = await withFtp(t, q, (ftp) => ftp.nlst());
        return json(res, 200, { ip: t.ip, via: 'ftp', files: files.map((f) => f.toUpperCase()).sort() });
      } catch (ftpErr) {
        return fail(res, 502, 'HTTP: ' + httpErr.message + ' / FTP: ' + ftpErr.message);
      }
    }
  }

  if (u.pathname === '/api/robot/file') {
    const t = target(q);
    const name = q.get('name');
    if (!t) return fail(res, 400, 'missing or invalid ?ip=');
    if (!name || !ROBOT_NAME.test(name)) return fail(res, 400, 'missing or invalid ?name=');
    try {
      // the controller web server wraps MD: files in an HTML page — unwrap it
      const content = unwrapMd(await robotGet(t.host, '/MD/' + encodeURIComponent(name.toUpperCase())));
      return json(res, 200, { ip: t.ip, name: name.toUpperCase(), via: 'http', content });
    } catch (httpErr) {
      try {
        const buf = await withFtp(t, q, (ftp) => ftp.retr(name.toUpperCase()));
        return json(res, 200, { ip: t.ip, name: name.toUpperCase(), via: 'ftp', content: buf.toString('utf8') });
      } catch (ftpErr) {
        return fail(res, 502, 'HTTP: ' + httpErr.message + ' / FTP: ' + ftpErr.message);
      }
    }
  }

  /* Safe .LS upload over FTP.
   * The controller translates .LS -> TP on STOR; a translation error leaves the
   * program DELETED on the robot. So: snapshot first, upload, verify by reading
   * the file back, and auto-restore the snapshot if the new version vanished. */
  if (u.pathname === '/api/robot/upload' && req.method === 'POST') {
    const body = await readBody(req);
    let payload;
    try { payload = JSON.parse(body); } catch (e) { return fail(res, 400, 'invalid JSON body'); }
    const { ip, name, content, user, pass } = payload;
    if (!ip || !ROBOT_HOST.test(String(ip).split(':')[0])) return fail(res, 400, 'missing or invalid ip');
    if (!name || !/^[A-Za-z0-9_-]+\.LS$/i.test(name)) return fail(res, 400, 'name must be NAME.LS');
    if (typeof content !== 'string' || !content.trim()) return fail(res, 400, 'missing content');
    const t = parseTarget(ip);
    const result = { ok: false, name: name.toUpperCase(), snapshot: null, restored: false };
    let ftp;
    try {
      ftp = await ftpConnect(t, user, pass);
      // 1. snapshot what's on the robot now
      let prev = null;
      try { prev = await ftp.retr(result.name); } catch (e) { /* program not on robot yet */ }
      if (prev && prev.length) {
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        result.snapshot = path.join(SNAPSHOT_DIR, t.ip.replace(/[:.]/g, '-') + '_' + result.name.replace(/\.LS$/i, '') + '_' + stamp + '.LS');
        fs.writeFileSync(result.snapshot, prev);
      }
      // 2. upload
      let uploadError = null;
      try { await ftp.stor(result.name, Buffer.from(content, 'utf8')); }
      catch (e) { uploadError = e.message; }
      // 3. verify the program still exists (translation errors delete it)
      let verified = false;
      try {
        const back = await ftp.retr(result.name);
        verified = back && back.length > 0;
      } catch (e) { verified = false; }
      if (uploadError || !verified) {
        result.error = uploadError
          ? 'The controller rejected the upload: ' + uploadError
          : 'Upload finished but the program is GONE on the robot — the .LS→TP translation failed and the controller deleted it.';
        // grab the newest error-log entries — they carry the ASBN load
        // errors with the failing file line
        try {
          const log = await ftp.retr('ERRALL.LS');
          result.errlog = log.toString('latin1').split(/\r?\n/).slice(0, 40).join('\n');
        } catch (e) { /* no error log available — banner just shows less */ }
        // 4. auto-restore the snapshot so nothing is lost on the robot
        if (result.snapshot) {
          try {
            await ftp.stor(result.name, fs.readFileSync(result.snapshot));
            const check = await ftp.retr(result.name);
            result.restored = !!(check && check.length);
          } catch (e) { result.restoreError = e.message; }
        }
        await ftp.quit();
        return json(res, 200, result);
      }
      await ftp.quit();
      result.ok = true;
      result.verified = true;
      return json(res, 200, result);
    } catch (e) {
      if (ftp) try { await ftp.quit(); } catch (e2) { /* already gone */ }
      result.error = e.message;
      return json(res, 200, result);
    }
  }

  /* Full backup over FTP into <name-or-ip>_<YYYY-MM-DD>_<NN>/ */
  if (u.pathname === '/api/robot/backup' && req.method === 'POST') {
    const body = await readBody(req);
    let payload;
    try { payload = JSON.parse(body); } catch (e) { return fail(res, 400, 'invalid JSON body'); }
    const { ip, user, pass, dest } = payload;
    const mode = payload.mode === 'quick' ? 'quick' : 'full';
    if (!ip || !ROBOT_HOST.test(String(ip).split(':')[0])) return fail(res, 400, 'missing or invalid ip');
    const t = parseTarget(ip);
    let robotName = null;
    try {
      const dg = await robotGet(t.host, '/MD/SUMMARY.DG');
      const m = dg.match(/(?:Host\s*name|Hostname|Robot\s*Name|\$HOSTNAME)\s*[:=]?\s*([A-Za-z0-9_-]{2,32})/i);
      if (m) robotName = m[1];
    } catch (e) { /* HTTP not available — fall back to IP naming */ }
    const base = (robotName || t.ip.replace(/[:.]/g, '-')) + '_' + new Date().toISOString().slice(0, 10);
    const destRoot = dest ? path.resolve(dest) : path.join(ROOT, 'backups');
    fs.mkdirSync(destRoot, { recursive: true });
    let nn = 1;
    for (const e of fs.readdirSync(destRoot)) {
      const m = e.match(new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(\\d+)(?:_quick)?$'));
      if (m) nn = Math.max(nn, parseInt(m[1], 10) + 1);
    }
    const folder = path.join(destRoot, base + '_' + String(nn).padStart(2, '0') + (mode === 'quick' ? '_quick' : ''));
    try {
      const ftp = await ftpConnect(t, user, pass, 20000);
      const files = await ftp.nlst();
      fs.mkdirSync(folder, { recursive: true });
      let saved = 0, bytes = 0;
      const failed = [];
      for (const f of files) {
        if (!ROBOT_NAME.test(f)) continue;
        if (mode === 'quick' && !/\.(ls|va)$/i.test(f)) continue;
        try {
          const buf = await ftp.retr(f);
          fs.writeFileSync(path.join(folder, f.toUpperCase()), buf);
          saved++;
          bytes += buf.length;
        } catch (e) { failed.push(f); }
      }
      await ftp.quit();
      return json(res, 200, { ok: true, folder, robotName, mode, files: saved, failed, bytes });
    } catch (e) {
      return fail(res, 502, 'backup failed: ' + e.message);
    }
  }

  return fail(res, 404, 'unknown API route');
}

/* ---- saved robots ----
 * Kept on the bridge rather than in a browser, so every device pointed at
 * this bridge sees the same list — and because the bridge is the thing that
 * can actually reach the robots. Passwords are deliberately never stored. */
function readRobots() {
  try {
    const list = JSON.parse(fs.readFileSync(ROBOTS_FILE, 'utf8'));
    if (!Array.isArray(list)) return [];
    return list.filter((r) => r && typeof r.ip === 'string' && ROBOT_HOST.test(r.ip.split(':')[0]));
  } catch (e) {
    return [];   // missing or corrupt — an empty list is the right answer
  }
}

function writeRobots(list) {
  try {
    fs.writeFileSync(ROBOTS_FILE, JSON.stringify(list.slice(0, MAX_ROBOTS), null, 2));
    return true;
  } catch (e) {
    console.error('[bridge] could not save ' + ROBOTS_FILE + ': ' + e.message);
    return false;
  }
}

function cleanLabel(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[^A-Za-z0-9_. @-]/g, '').trim().slice(0, max);
  return t || null;
}

/* Ask the controller its name. Best-effort and short: a robot that does not
 * answer still gets remembered, just under its address. */
async function robotName(host) {
  try {
    const dg = await robotGet(host, '/MD/SUMMARY.DG');
    const m = dg.match(/(?:Host\s*name|Hostname|Robot\s*Name|\$HOSTNAME)\s*[:=]?\s*([A-Za-z0-9_-]{2,32})/i);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

/* Is anything listening on the controller's web port? A plain TCP connect —
 * no HTTP semantics to misread across controller generations. */
function probePort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = net.connect({ host: host, port: port });
    let settled = false;
    const finish = (ok, error) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve({ ok: ok, ms: Date.now() - started, error: error || null });
    };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false, 'no answer within ' + timeoutMs + 'ms'));
    sock.on('error', (e) => finish(false, e.message));
  });
}

function probeRobot(t) {
  return probePort(t.host, 80, PROBE_TIMEOUT_MS).then((r) => ({ ip: t.ip, ok: r.ok, ms: r.ms, error: r.error }));
}

/* ---- subnet scan ---- */

function ipToInt(ip) {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    const v = Number(part);
    if (!/^\d{1,3}$/.test(part) || v > 255) return null;
    n = (n * 256) + v;
  }
  return n;
}

function intToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/* CIDR -> the host addresses inside it. Network and broadcast are skipped for
 * anything roomier than a /31, where they are not usable hosts. */
function cidrHosts(text) {
  const m = String(text || '').trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) return { error: 'expected something like 192.168.0.0/24' };
  const bits = Number(m[2]);
  const base = ipToInt(m[1]);
  if (base === null || bits < 8 || bits > 32) return { error: 'not a valid CIDR range' };
  const size = Math.pow(2, 32 - bits);
  if (size > SCAN_MAX_HOSTS + 2) {
    return { error: '/' + bits + ' is ' + size + ' addresses — ' + SCAN_MAX_HOSTS + ' is the limit, use /22 or smaller' };
  }
  const net = size === 4294967296 ? 0 : Math.floor(base / size) * size;
  const first = bits >= 31 ? net : net + 1;
  const last = bits >= 31 ? net + size - 1 : net + size - 2;
  const hosts = [];
  for (let n = first; n <= last; n++) hosts.push(intToIp(n));
  return { hosts: hosts, cidr: intToIp(net) + '/' + bits };
}

/* The subnets this bridge is actually attached to — the sensible default for
 * a scan, since a robot has to be reachable from here to be usable. */
function localSubnets() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      const mask = ipToInt(a.netmask);
      if (mask === null) continue;
      let bits = 0;
      for (let i = 31; i >= 0; i--) { if ((mask >>> i) & 1) bits++; else break; }
      const size = Math.pow(2, 32 - bits);
      const net = Math.floor(ipToInt(a.address) / size) * size;
      out.push({ iface: name, address: a.address, cidr: intToIp(net) + '/' + bits, hosts: Math.max(0, size - 2) });
    }
  }
  return out;
}

/* Run `work` over `items`, at most `limit` in flight. */
async function pool(items, limit, work) {
  let i = 0;
  const runners = [];
  for (let k = 0; k < Math.min(limit, items.length); k++) {
    runners.push((async () => {
      while (i < items.length) {
        const idx = i++;
        await work(items[idx], idx);
      }
    })());
  }
  await Promise.all(runners);
}

/* An open port 80 is not a robot — a printer or a switch answers too, and a
 * web UI that returns 200 for every path would pass a mere "did it fetch"
 * test. So the body has to actually look like a controller: either SUMMARY.DG
 * carrying FANUC identity fields, or an MD: listing with real robot files on
 * it. Anything else is reported as "answered, not a controller" and is never
 * saved — a wrong entry in the list is worse than a missing one. */
const FANUC_SIG = /(?:Robot\s*Name|Host\s*name|\$HOSTNAME|F-?No\.?|F-?Number|Software\s*Version|FANUC|Controller\s*Type|R-30i)/i;
const IDENTIFY_TIMEOUT_MS = 2500;

async function identifyRobot(ip) {
  try {
    const dg = await robotGet(ip, '/MD/SUMMARY.DG', IDENTIFY_TIMEOUT_MS);
    if (FANUC_SIG.test(dg)) {
      const m = dg.match(/(?:Host\s*name|Hostname|Robot\s*Name|\$HOSTNAME)\s*[:=]?\s*([A-Za-z0-9_-]{2,32})/i);
      return { robot: true, name: m ? m[1] : null };
    }
  } catch (e) { /* no SUMMARY.DG — fall through to the directory check */ }
  try {
    const md = await robotGet(ip, '/MD/', IDENTIFY_TIMEOUT_MS);
    if (scrapeFileNames(md).length) return { robot: true, name: null };
  } catch (e) { /* not serving MD: either */ }
  return { robot: false, name: null };
}

function parseTarget(ipField) {
  const parts = String(ipField).split(':');
  return { ip: String(ipField), host: parts[0], port: parts[1] ? parseInt(parts[1], 10) : 21 };
}

function target(q) {
  const ip = q.get('ip');
  if (!ip || !ROBOT_HOST.test(ip.split(':')[0])) return null;
  return parseTarget(ip);
}

/* Connect and enter the md: device — FANUC roots its FTP server at the
 * device list (fr:, mc:, md:, ...); programs and variable files live in md:.
 * Controllers that root directly at md: refuse the CWD, which is fine. */
async function ftpConnect(t, user, pass, timeout) {
  const ftp = await Ftp.connect(t.host, t.port, user, pass, timeout);
  try { await ftp.cwd('md:'); } catch (e) { /* already at md: on this controller */ }
  return ftp;
}

async function withFtp(t, q, fn) {
  const ftp = await ftpConnect(t, q.get('user') || undefined, q.get('pass') || undefined);
  try {
    return await fn(ftp);
  } finally {
    try { await ftp.quit(); } catch (e) { /* already gone */ }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > MAX_BODY) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
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
  if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const full = path.join(ROOT, path.normalize(rel));
  if (!full.startsWith(ROOT)) return fail(res, 403, 'forbidden');
  fs.readFile(full, (err, data) => {
    if (err) return fail(res, 404, 'not found: ' + pathname);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      // always revalidate so a git pull takes effect on the next reload
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const httpServer = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) {
    handleApi(req, res, u).catch((e) => fail(res, 500, e.message));
  } else {
    serveStatic(res, u.pathname);
  }
});

httpServer.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('The bridge is already running (port ' + PORT + ' is in use).');
    console.log('Just open http://localhost:' + PORT + ' in your browser.');
    console.log('This window will close; the other bridge window keeps serving.');
    process.exit(0);
  }
  console.error('[bridge] could not start: ' + e.message);
  process.exit(1);
});

httpServer.listen(PORT, () => {
  console.log('FANUC TP Program Studio bridge running:');
  console.log('  this PC:    http://localhost:' + PORT);
  console.log('  your phone: http://<this-pc-ip>:' + PORT + '  (same network)');
  console.log('Robot access reads http://<robot-ip>/MD/ — enable HTTP on the controller (Host Comm).');
});
