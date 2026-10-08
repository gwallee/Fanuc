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
 * The bridge reads from robots, and writes to one only where it is asked to
 * and can prove the result: a .LS upload (snapshot / verify / auto-restore)
 * and a comment rename through the controller's own comment tool. Nothing
 * here can move a robot or change what a program does.
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
const CS = require('./lib/comset.js');

const ROOT = __dirname;
const SNAPSHOT_DIR = path.join(ROOT, 'backups', 'pre-upload');
const PORT = parseInt(process.argv[2], 10) || 8642;
const ROBOT_TIMEOUT_MS = 6000;
/* Liveness check for a saved robot: short, because the answer people want is
 * "is it there right now", and a dead address on the LAN fails far quicker
 * than this anyway. Only a silently-dropping firewall runs it to the end. */
const PROBE_TIMEOUT_MS = 1500;
const MAX_BODY = 5 * 1024 * 1024;
/* Where the bridge keeps what it remembers — the saved robots and the
 * settings. Beside the bridge by default, which is what a shop-floor PC
 * wants. Overridable so a test can point a bridge at a scratch directory
 * instead: the robot list someone actually uses is not a thing a test run
 * should ever be able to write over. */
const STATE_DIR = process.env.FANUC_STUDIO_STATE
  ? path.resolve(process.env.FANUC_STUDIO_STATE) : ROOT;
const ROBOTS_FILE = path.join(STATE_DIR, 'robots.json');
const SETTINGS_FILE = path.join(STATE_DIR, 'settings.json');
const MAX_ROBOTS = 64;
const DEFAULT_BACKUP_ROOT = path.join(STATE_DIR, 'backups');
if (STATE_DIR !== ROOT) fs.mkdirSync(STATE_DIR, { recursive: true });
/* Backing up several robots, a powered-down controller is the normal case,
 * not an error — and each one would otherwise hold the whole sweep for the
 * FTP connect timeout. A plain TCP probe of the control port turns twenty
 * seconds of dead air into three and a reason worth printing. */
const BATCH_PROBE_MS = 3000;
/* Subnet sweep. A connect attempt that finds nothing is one SYN and one RST,
 * so the whole cost of a /24 is well under 100 KB — the clock is set by how
 * many run at once, not by bandwidth. Capped at a /22 so a mistyped prefix
 * cannot turn into a 65k-address sweep of a plant network. */
const SCAN_TIMEOUT_MS = 500;
const SCAN_CONCURRENCY = 48;
const SCAN_MAX_HOSTS = 1024;
const SCAN_MIN_BITS = 22;      // SCAN_MAX_HOSTS expressed as a prefix length

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
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

/* Read one MD: file, controller web server first and FTP second — the same
 * either-protocol-is-enough fallback the rest of the bridge relies on. */
async function readRobotFile(t, user, pass, name) {
  const upper = name.toUpperCase();
  try {
    return { via: 'http', content: unwrapMd(await robotGet(t.host, '/MD/' + encodeURIComponent(upper))) };
  } catch (httpErr) {
    try {
      const buf = await pooledFtp(t, user, pass, (ftp) => ftp.retr(upper), undefined, true);
      return { via: 'ftp', content: buf.toString('utf8') };
    } catch (ftpErr) {
      throw new Error('HTTP: ' + httpErr.message + ' / FTP: ' + ftpErr.message);
    }
  }
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
    const all = readRobots();
    const prev = all.find((r) => r.ip === t.ip) || null;
    const list = all.filter((r) => r.ip !== t.ip);
    list.unshift({
      ip: t.ip,
      name: name,
      ftpUser: cleanLabel(payload.ftpUser, 32),   // never the password
      folder: prev ? (prev.folder || null) : null,  // set once; reconnecting must not clear it
      lastSeen: new Date().toISOString()
    });
    writeRobots(list);
    return json(res, 200, { robots: readRobots() });
  }

  /* The folder THIS robot's backups go in. Blank puts it back on the home
   * folder. Refused unless it can actually be written, for the same reason
   * the home folder is: a saved path that does not work is not a setting,
   * it is a backup that will not happen. */
  if (u.pathname === '/api/robots/folder' && req.method === 'POST') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (e) { return fail(res, 400, 'invalid JSON body'); }
    const ip = payload && payload.ip;
    if (!ip || !ROBOT_HOST.test(String(ip).split(':')[0])) return fail(res, 400, 'missing or invalid ip');
    const raw = payload.folder == null ? '' : String(payload.folder).trim();
    let folder = null;
    if (raw) {
      folder = path.resolve(raw);
      const bad = ensureDir(folder);
      if (bad) return fail(res, 400, bad);
    }
    const list = readRobots();
    const hit = list.find((r) => r.ip === String(ip));
    if (hit) hit.folder = folder;
    else list.unshift({ ip: String(ip), name: null, ftpUser: null, folder: folder, lastSeen: null });
    if (!writeRobots(list)) return fail(res, 500, 'could not save ' + ROBOTS_FILE);
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

  /* ---- folder picker ----
   * The folders that matter are on the BRIDGE PC — a mapped drive or a share
   * this machine can see. A browser cannot hand a server a real path (a
   * folder input gives file names, never a filesystem location), and typing
   * a UNC path by hand on a phone is nobody's idea of a good time, so the
   * bridge lists its own directories and the UI walks them. Names only:
   * strictly less than /api/dir/list already gives out, which reads files. */
  if (u.pathname === '/api/fs/dirs') {
    const raw = q.get('path');
    if (!raw) return json(res, 200, { places: startingPlaces() });
    const dir = path.resolve(raw);
    let dirs;
    try {
      dirs = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() || (e.isSymbolicLink() && isDirLink(path.join(dir, e.name))))
        .map((e) => e.name)
        /* $RECYCLE.BIN, System Volume Information and friends: never where a
         * backup goes, and they only ever error when opened. */
        .filter((n) => n[0] !== '$' && n !== 'System Volume Information')
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 1000);
    } catch (e) {
      return fail(res, 400, 'cannot read ' + dir + ': ' + e.message);
    }
    const parent = path.dirname(dir);
    return json(res, 200, {
      path: dir,
      parent: parent === dir ? null : parent,
      dirs: dirs,
      error: dirWritable(dir)
    });
  }

  /* The home folder, reported with whether it can actually be written to
   * right now — a mapped drive is only mapped inside a login session, so a
   * path that worked yesterday can be gone today and the UI should say so
   * before someone starts a sweep. */
  if (u.pathname === '/api/settings' && req.method === 'GET') {
    const dir = homeRoot();
    return json(res, 200, {
      backupRoot: dir,
      isDefault: dir === DEFAULT_BACKUP_ROOT,
      error: dirWritable(dir)
    });
  }

  if (u.pathname === '/api/settings' && req.method === 'POST') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (e) { return fail(res, 400, 'invalid JSON body'); }
    const s = readSettings();
    if ('backupRoot' in payload) {
      const raw = payload.backupRoot == null ? '' : String(payload.backupRoot).trim();
      if (!raw) {
        delete s.backupRoot;                  // back to backups/ beside the bridge
      } else {
        const dir = path.resolve(raw);
        /* Refused rather than saved-and-hoped-for: a home folder that cannot
         * be written is not a setting, it is a backup that will not happen. */
        const bad = ensureDir(dir);
        if (bad) return fail(res, 400, bad);
        s.backupRoot = dir;
      }
    }
    if (!writeSettings(s)) return fail(res, 500, 'could not save ' + SETTINGS_FILE);
    const dir = homeRoot();
    return json(res, 200, { backupRoot: dir, isDefault: dir === DEFAULT_BACKUP_ROOT, error: dirWritable(dir) });
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
          folder: prev ? (prev.folder || null) : null,   // a re-scan must not undo a filed folder
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
      const got = await readRobotFile(t, q.get('user') || undefined, q.get('pass') || undefined, name);
      return json(res, 200, { ip: t.ip, name: name.toUpperCase(), via: got.via, content: got.content });
    } catch (e) {
      return fail(res, 502, e.message);
    }
  }

  /* Rename one item on the controller: a register, a position or string
   * register, or an I/O point. This is the only write the bridge makes over
   * HTTP, so it is deliberately narrow — a comment and nothing else, only for
   * a type the controller's own comment tool offers, and the text is checked
   * before it goes anywhere. Nothing reachable here can move the robot or
   * change a program.
   *
   * Same shape as the .LS upload: write, then read the file back and report
   * what the controller actually stored, so the UI can prove the rename landed
   * instead of taking a 200 for an answer. */
  if (u.pathname === '/api/robot/comment' && req.method === 'POST') {
    const body = await readBody(req);
    let payload;
    try { payload = JSON.parse(body); } catch (e) { return fail(res, 400, 'invalid JSON body'); }
    const { ip, type, index, text, user, pass } = payload;
    if (!ip || !ROBOT_HOST.test(String(ip).split(':')[0])) return fail(res, 400, 'missing or invalid ip');
    const { error, spec, kind, index: idx, comment, key, url } = CS.plan(type, index, text);
    if (error) return fail(res, 400, error);

    const t = parseTarget(ip);
    const result = { ok: false, key, type: kind, index: idx, comment, verified: false };
    try {
      await robotGet(t.host, url);
    } catch (e) {
      return fail(res, 502, 'The controller would not rename ' + key + ': ' + e.message +
        ' — renaming needs the controller\'s comment tool (its own /KAREL/COMMAIN page) reachable over HTTP.');
    }
    result.ok = true;
    if (!spec.file) return json(res, 200, result);   // nothing to read back

    try {
      const got = await readRobotFile(t, user, pass, spec.file);
      const stored = CS.storedComment(spec.file, got.content, kind, idx);
      result.stored = stored;
      result.verified = stored === comment;
      if (!result.verified) {
        result.ok = false;
        result.error = 'The controller took the write but ' + key + ' still reads ' +
          (stored === null ? 'as absent from ' + spec.file : '"' + stored + '"') + '.';
      }
    } catch (e) {
      result.verifyError = e.message;   // the write went through; only the proof failed
    }
    return json(res, 200, result);
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
    try {
      // never retried: an upload must not be able to run twice
      await pooledFtp(t, user, pass, async (ftp) => {
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
        return;
      }
      result.ok = true;
      result.verified = true;
      }, undefined, false);
    } catch (e) {
      result.error = result.error || e.message;
    }
    return json(res, 200, result);
  }

  /* Full backup over FTP into <name-or-ip>_<YYYY-MM-DD>_<NN>/, under the
   * saved home folder unless this call names somewhere else. */
  if (u.pathname === '/api/robot/backup' && req.method === 'POST') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (e) { return fail(res, 400, 'invalid JSON body'); }
    const { ip, user, pass, dest } = payload;
    const mode = payload.mode === 'quick' ? 'quick' : 'full';
    if (!ip || !ROBOT_HOST.test(String(ip).split(':')[0])) return fail(res, 400, 'missing or invalid ip');
    const destRoot = destFor(ip, dest);
    const bad = ensureDir(destRoot);
    if (bad) return fail(res, 400, bad);
    try {
      return json(res, 200, await backupRobot(parseTarget(ip), user, pass, mode, destRoot));
    } catch (e) {
      return fail(res, 502, 'backup failed: ' + e.message);
    }
  }

  /* Back up several robots in one go into the same home folder — what a
   * per-robot batch script used to do, without a script per robot. Streams
   * NDJSON so the sweep says which controller it is on and aborting the
   * request really stops it. One robot at a time on purpose: it keeps the
   * progress honest, and on a plant network where each controller sits
   * behind its own point-to-point link there is nothing for parallel FTP
   * transfers to overlap with anyway. */
  if (u.pathname === '/api/robots/backup-all' && req.method === 'POST') {
    let payload;
    try { payload = JSON.parse(await readBody(req)); } catch (e) { return fail(res, 400, 'invalid JSON body'); }
    const mode = payload.mode === 'quick' ? 'quick' : 'full';
    const ips = [];
    const seen = new Set();
    for (const raw of (Array.isArray(payload.ips) ? payload.ips : [])) {
      const ip = String(raw == null ? '' : raw).trim();
      if (!ip || !ROBOT_HOST.test(ip.split(':')[0])) return fail(res, 400, 'invalid ip: ' + ip);
      if (!seen.has(ip)) { seen.add(ip); ips.push(ip); }
    }
    if (!ips.length) return fail(res, 400, 'no robots given');
    if (ips.length > MAX_ROBOTS) return fail(res, 400, 'too many robots at once (' + ips.length + ', max ' + MAX_ROBOTS + ')');

    const byIp = new Map(readRobots().map((r) => [r.ip, r]));
    /* Each robot has its own folder, so every distinct destination is checked
     * before the first controller is touched — a share that is down should
     * cost nothing, and it should be named along with the robot that was
     * going to use it rather than discovered eight transfers in. */
    const dests = new Map();
    for (const ip of ips) dests.set(ip, destFor(ip, payload.dest));
    const checked = new Set();
    for (const ip of ips) {
      const d = dests.get(ip);
      if (checked.has(d)) continue;
      checked.add(d);
      const bad = ensureDir(d);
      if (bad) return fail(res, 400, ((byIp.get(ip) || {}).name || ip) + ': ' + bad);
    }
    let aborted = false;
    req.on('close', () => { aborted = true; });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    const send = (o) => { if (!aborted) res.write(JSON.stringify(o) + '\n'); };
    const started = Date.now();
    send({ type: 'start', total: ips.length, dests: checked.size, mode: mode });

    const done = new Set();
    const names = new Map();
    let okCount = 0, failCount = 0, skipCount = 0, files = 0, bytes = 0;
    for (let i = 0; i < ips.length; i++) {
      if (aborted) break;
      const ip = ips[i];
      const entry = byIp.get(ip) || null;
      const t = parseTarget(ip);
      send({ type: 'robot', index: i, ip: ip, name: (entry && entry.name) || null, dest: dests.get(ip) });
      const up = await probePort(t.host, t.port, BATCH_PROBE_MS);
      if (!up.ok) {
        skipCount++;
        send({
          type: 'robotDone', ip: ip, skipped: true,
          error: 'no answer on FTP port ' + t.port + ' (' + up.error + ') — powered down, or not on this network'
        });
        continue;
      }
      try {
        /* A robot's own saved FTP user wins; the credentials sent with the
         * request cover the rest. The password is never stored, so it can
         * only ever come from this call. */
        const r = await backupRobot(
          t,
          (entry && entry.ftpUser) || payload.user || undefined,
          payload.pass || undefined,
          mode, dests.get(ip),
          (p) => send({ type: 'file', ip: ip, saved: p.saved, total: p.total, bytes: p.bytes })
        );
        okCount++;
        files += r.files;
        bytes += r.bytes;
        done.add(ip);
        if (r.robotName) names.set(ip, r.robotName);
        send({
          type: 'robotDone', ip: ip, ok: true, folder: r.folder,
          files: r.files, failed: r.failed, bytes: r.bytes, robotName: r.robotName
        });
      } catch (e) {
        failCount++;
        send({ type: 'robotDone', ip: ip, error: e.message });
      }
    }

    /* A completed backup is the strongest proof of reachability there is, so
     * it refreshes lastSeen — and fills in a name for a robot that was found
     * by a scan before it would tell anyone what it was called. */
    if (done.size) {
      const list = readRobots();
      let touched = false;
      for (const r of list) {
        if (!done.has(r.ip)) continue;
        r.lastSeen = new Date().toISOString();
        if (!r.name && names.get(r.ip)) r.name = names.get(r.ip);
        touched = true;
      }
      if (touched) writeRobots(list);
    }

    send({
      type: 'done', ok: okCount, failed: failCount, skipped: skipCount,
      files: files, bytes: bytes, dests: Array.from(checked), ms: Date.now() - started
    });
    return res.end();
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

/* ---- bridge settings ----
 * Kept on the bridge for the same reason the robot list is: the home folder
 * is a path on THIS PC — a mapped drive or a UNC share — so it means nothing
 * to a phone pointed at the bridge, and everyone filing backups off this
 * bridge should be filing them in the same place. Set it once, and every
 * backup after that lands there without anyone retyping a server path. */
function readSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
  } catch (e) {
    return {};   // missing or corrupt — the built-in defaults are the answer
  }
}

function writeSettings(s) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
    return true;
  } catch (e) {
    console.error('[bridge] could not save ' + SETTINGS_FILE + ': ' + e.message);
    return false;
  }
}

/* The home folder alone — where a robot with no folder of its own goes. */
function homeRoot() {
  const raw = readSettings().backupRoot;
  return raw ? path.resolve(String(raw)) : DEFAULT_BACKUP_ROOT;
}

/* Where one robot's backup goes: an explicit dest for this call wins, then
 * that robot's own folder, then the home folder. A robot gets its own folder
 * because a cell's backups belong with that cell's project on the server —
 * which is what a per-robot batch script was really encoding. */
function destFor(ip, dest) {
  if (dest && String(dest).trim()) return path.resolve(String(dest).trim());
  const own = robotFolder(ip);
  return own || homeRoot();
}

function robotFolder(ip) {
  const r = readRobots().find((x) => x.ip === String(ip));
  return (r && r.folder) ? path.resolve(r.folder) : null;
}

/* A mapped drive that isn't mapped in this login session, or a share that is
 * down, has to be said out loud BEFORE a sweep of eight robots starts —
 * never discovered halfway through on the first write. */
function dirWritable(dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return dir + ' is not a folder';
    fs.accessSync(dir, fs.constants.W_OK);
    return null;
  } catch (e) {
    return 'cannot write to ' + dir + ': ' + e.message;
  }
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (e) { return 'cannot create ' + dir + ': ' + e.message; }
  return dirWritable(dir);
}

function isDirLink(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

/* Where the folder picker opens: the drives this PC can see — the mapped
 * network drives are the whole point, since that is where plant backups
 * live — plus wherever backups already go. Drive letters are probed rather
 * than listed, because there is no dependency-free way to enumerate them and
 * 26 stat calls on a local machine cost nothing. */
function startingPlaces() {
  const places = [];
  const add = (label, dir) => {
    if (!dir) return;
    const p = path.resolve(dir);
    if (places.some((x) => x.path === p)) return;
    if (!isDirLink(p)) return;
    places.push({ label: label, path: p });
  };
  const home = homeRoot();
  add(home === DEFAULT_BACKUP_ROOT ? 'Bridge backups folder' : 'Current home folder', home);
  for (const r of readRobots()) if (r.folder) add((r.name || r.ip) + '’s folder', r.folder);
  if (process.platform === 'win32') {
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(67 + i);       // C: upward
      add(letter + ':', letter + ':\\');
    }
  } else {
    add('/', '/');
    for (const m of ['/Volumes', '/mnt', '/media', '/srv']) add(m, m);
  }
  add('Home directory', os.homedir());
  return places;
}

/* Pull the files off one robot's MD: into <name-or-ip>_<YYYY-MM-DD>_<NN>/.
 * Shared by the single-robot buttons and the back-up-every-robot sweep, so a
 * batch backup is indistinguishable from four taken by hand — same folder
 * names, same contents, and the Compare tab loads either as a baseline.
 * onFile is called after each file so a caller can stream progress. */
async function backupRobot(t, user, pass, mode, destRoot, onFile) {
  const name = await robotName(t.host);
  const base = (name || t.ip.replace(/[:.]/g, '-')) + '_' + new Date().toISOString().slice(0, 10);
  fs.mkdirSync(destRoot, { recursive: true });
  let nn = 1;
  for (const e of fs.readdirSync(destRoot)) {
    const m = e.match(new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_(\\d+)(?:_quick)?$'));
    if (m) nn = Math.max(nn, parseInt(m[1], 10) + 1);
  }
  const folder = path.join(destRoot, base + '_' + String(nn).padStart(2, '0') + (mode === 'quick' ? '_quick' : ''));
  /* Counters live inside the pooled call: a stale-connection retry restarts
   * the sweep from scratch into the same folder instead of double-counting. */
  const out = await pooledFtp(t, user, pass, async (ftp) => {
    let saved = 0, bytes = 0;
    const failed = [];
    /* The list is filtered before any transfer starts so progress has a real
     * denominator — "12 of 57" rather than a count that only makes sense
     * once it stops. */
    const want = (await ftp.nlst()).filter((f) => ROBOT_NAME.test(f) && (mode !== 'quick' || /\.(ls|va)$/i.test(f)));
    fs.mkdirSync(folder, { recursive: true });
    for (const f of want) {
      try {
        const buf = await ftp.retr(f);
        fs.writeFileSync(path.join(folder, f.toUpperCase()), buf);
        saved++;
        bytes += buf.length;
      } catch (e) { failed.push(f); }
      if (onFile) onFile({ name: f, saved: saved, total: want.length, bytes: bytes });
    }
    return { saved: saved, bytes: bytes, failed: failed };
  }, 20000, true);
  return { ok: true, folder: folder, robotName: name, mode: mode, files: out.saved, failed: out.failed, bytes: out.bytes };
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

/* A PC on a plant floor typically has several IPv4 interfaces, and only one
 * of them can reach a robot. os.networkInterfaces() hands them back in an
 * order that means nothing, so classify each and rank them: the wired network
 * is the overwhelmingly likely place to find controllers, wireless next, and
 * hypervisor host-only networks and VPN overlays last — nothing but this PC
 * and its VMs lives on those, so sweeping one is guaranteed to find nothing.
 * They stay in the list rather than being dropped, so an unusual setup can
 * still pick one; they just never win the default. */
const IFACE_VIRTUAL = /vmware|virtualbox|vbox|hyper-?v|vethernet|wsl|docker|loopback|bluetooth|npcap/i;
const IFACE_OVERLAY = /tailscale|zerotier|wireguard|openvpn|\bvpn\b|tap-|tun\d/i;

function ifaceKind(name, address) {
  if (IFACE_OVERLAY.test(name)) return 'overlay';
  // 100.64/10 is carrier-grade NAT, which is what Tailscale hands out
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address)) return 'overlay';
  if (IFACE_VIRTUAL.test(name)) return 'virtual';
  if (/wi-?fi|wireless|wlan|802\.11/i.test(name)) return 'wireless';
  return 'wired';
}

const KIND_RANK = { wired: 0, wireless: 1, virtual: 3, overlay: 4 };

/* Wired first as a rule — controllers live on wired networks — but a tiny
 * wired link is the exception: a /30 holds this PC and one device, so as a
 * SCAN target it can never find anything a probe of its one neighbor would
 * not. A plant PC with five point-to-point robot links and the shop Wi-Fi
 * used to bury the one network with every controller on it behind those
 * five, so real networks now outrank the direct links regardless of kind. */
function scanRank(s) {
  if (s.kind === 'wired' && s.hosts < 6) return 2;
  return KIND_RANK[s.kind];
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
      if (/^169\.254\./.test(a.address)) continue;   // link-local: no DHCP answered
      const mask = ipToInt(a.netmask);
      if (mask === null) continue;
      let bits = 0;
      for (let i = 31; i >= 0; i--) { if ((mask >>> i) & 1) bits++; else break; }
      /* A /16 corporate Ethernet is 65k addresses, which /api/robots/scan
       * refuses. Offer the /24 around this PC instead of a range that can
       * only ever come back as an error. */
      const narrowed = bits < SCAN_MIN_BITS;
      if (narrowed) bits = 24;
      const size = Math.pow(2, 32 - bits);
      const net = Math.floor(ipToInt(a.address) / size) * size;
      out.push({
        iface: name,
        address: a.address,
        cidr: intToIp(net) + '/' + bits,
        hosts: Math.max(0, size - 2),
        kind: ifaceKind(name, a.address),
        narrowed: narrowed
      });
    }
  }
  out.sort((x, y) => (scanRank(x) - scanRank(y)) || x.iface.localeCompare(y.iface));
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

/* ---- pooled FTP ----
 * One control connection per robot+user, reused across API calls — the UI
 * fires several calls per action, and a fresh login + CWD for each one is
 * the slowest part of talking to a controller. Calls are serialized per
 * connection, the connection closes after 25s idle, and a connection that
 * died while idle is replaced (with one retry for read-only calls; an
 * upload is never retried, so it can never run twice). Protocol errors
 * (550 file not found, …) keep the connection; anything that smells like a
 * broken socket drops it. */
const FTP_IDLE_MS = 25000;
const ftpPool = new Map(); // key -> { key, ftp, chain, idleTimer }

function connectionStillGood(e) {
  // a clean server rejection carries the reply code; transport trouble doesn't
  return e && typeof e.code === 'number' && e.code >= 400 && e.code < 600;
}

async function pooledFtp(t, user, pass, fn, connectTimeout, retryOnStale) {
  const key = t.host + ':' + t.port + '|' + (user || '');
  let entry = ftpPool.get(key);
  if (!entry) {
    entry = { key, ftp: null, chain: Promise.resolve(), idleTimer: null };
    ftpPool.set(key, entry);
  }
  const run = entry.chain.then(async () => {
    clearTimeout(entry.idleTimer);
    for (let attempt = 0; ; attempt++) {
      const reused = !!entry.ftp;
      if (!entry.ftp) {
        entry.ftp = await ftpConnect(t, user, pass, connectTimeout);
        const ftpRef = entry.ftp;
        ftpRef.socket.once('close', () => { if (entry.ftp === ftpRef) entry.ftp = null; });
      }
      try {
        return await fn(entry.ftp);
      } catch (e) {
        if (!connectionStillGood(e)) {
          const dead = entry.ftp;
          entry.ftp = null;
          if (dead) { try { dead.socket.destroy(); } catch (e2) { /* gone */ } }
          if (reused && retryOnStale && attempt === 0) continue; // idle-dropped by the robot — go again fresh
        }
        throw e;
      }
    }
  });
  entry.chain = run.catch(() => { /* keep the queue moving */ }).then(() => {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      const f = entry.ftp;
      entry.ftp = null;
      if (ftpPool.get(key) === entry) ftpPool.delete(key);
      if (f) f.quit().catch(() => { /* closing anyway */ });
    }, FTP_IDLE_MS);
    if (entry.idleTimer.unref) entry.idleTimer.unref();
  });
  return run;
}

async function withFtp(t, q, fn) {
  return pooledFtp(t, q.get('user') || undefined, q.get('pass') || undefined, fn, undefined, true);
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
    console.log('You can close this window; the other bridge window keeps serving.');
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
