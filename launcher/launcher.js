#!/usr/bin/env node
/* FanucStudio launcher: installs, updates and starts signed FanucStudio builds.
 *
 * Installed per user in %LOCALAPPDATA%\FanucStudio (no admin):
 *   launcher.js, release-public-key.pem, Start/Open scripts   this launcher
 *   bin\node.exe                                             the runtime
 *   app\<build>\                                             verified builds (newest two kept)
 *   state\                                                   robots.json, settings.json, logs (FANUCSTUDIO_STATE)
 *   launcher.json                                            { source, highestBuild }
 * Robot backups and the pre-upload / pre-delete snapshots are NOT in here:
 * an installed bridge keeps them in Documents\FanucStudio (FANUCSTUDIO_DATA),
 * so uninstalling or retiring never deletes a backup.
 *
 * Published by tools/publish-release.js into <share>\releases:
 *   latest.json          signed envelope { payload, signature } of the newest build's manifest
 *   <build>\             that build's files, plus release.sig.json (its own signed manifest)
 *   runtime\<ver>\node.exe   or, when CellStudio already published the same
 *                        node.exe on the share, the manifest names that copy
 *                        (../../CellStudio/releases/runtime/...); either way it
 *                        is used only when its size and sha256 match the signature
 *
 * Every manifest is signed with Brian's private key (Ed25519); this launcher
 * holds only the public key (release-public-key.pem beside it). A build is
 * copied only when its signature and every file hash match, and the local
 * copy is checked again on every start, so an edited, replaced or extra file
 * makes that build unusable (it is repaired from the share when possible,
 * otherwise the previous verified build runs). An older build than one this
 * PC has already accepted is never installed (no rollback through the share).
 *
 * Modes:
 *   --console        check for an update, then run the bridge in this console
 *   --hidden         check, start the bridge hidden (logs in state\bridge.log), exit
 *   --restart        like --hidden; used by the bridge's Restart bridge button
 *   --open           with --console/--hidden: open the app in the browser once it answers
 *   --install        (run from the share) install into %LOCALAPPDATA%\FanucStudio, add shortcuts, start
 *   --check          check/update/verify only; prints a JSON status
 *   --uninstall      stop this PC's bridge, remove the shortcuts, the fanucstudio://
 *                    registration and %LOCALAPPDATA%\FanucStudio (robot list, settings
 *                    and logs; backups live outside it and are never touched)
 *   --uninstall --retired   the same, but only when the share holds a signed
 *                    retire.json that names this user (or everyone)
 *   --port N, --source DIR, --pid N (uninstall: the bridge to stop), --no-update,
 *   --no-start (install), --no-shortcuts (install)
 * Retire: tools/publish-release.js --retire writes <share>\releases\retire.json
 * (signed like a release). Every start then uninstalls instead of running, a
 * running bridge notices within a minute and uninstalls itself, and
 * --install refuses. --unretire removes the file.
 * Env: FANUCSTUDIO_HOME overrides the install folder, FANUCSTUDIO_NO_REGISTER=1 skips
 * the registry and shortcuts (tests), FANUCSTUDIO_DATA is passed to the bridge.
 * The bridge port defaults to 8642, as for an unmanaged copy.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const SELF_DIR = __dirname;
const HOME = process.env.FANUCSTUDIO_HOME ? path.resolve(process.env.FANUCSTUDIO_HOME)
  : path.join(process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'), 'FanucStudio');
const APP_DIR = path.join(HOME, 'app');
const BIN_DIR = path.join(HOME, 'bin');
const STATE_DIR = path.join(HOME, 'state');
const CONFIG_FILE = path.join(HOME, 'launcher.json');
const DEFAULT_SOURCE = 'S:\\zz_Resources\\FanucStudio\\releases';
const SIG_FILE = 'release.sig.json';
const KEEP_BUILDS = 2;
const SOURCE_TIMEOUT_MS = 8000;
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9._ ()-]*(\/[A-Za-z0-9_][A-Za-z0-9._ ()-]*)*$/;
/* The runtime may be CellStudio's copy on the same share, so leading ../
 * segments are allowed for it alone: it is only read, and only used when its
 * size and sha256 match the signed manifest. */
const RUNTIME_PATH = /^(\.\.\/)*[A-Za-z0-9_][A-Za-z0-9._ ()-]*(\/[A-Za-z0-9_][A-Za-z0-9._ ()-]*)*$/;

/* ---------- arguments ---------- */
function parseArgs(argv) {
  const o = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '--source' || a === '--pid') o[a.slice(2)] = argv[++i];
    else if (a.startsWith('--')) o.flags.add(a.slice(2));
  }
  return o;
}
const ARGS = parseArgs(process.argv.slice(2));
const has = (f) => ARGS.flags.has(f);
const PORT = /^\d+$/.test(ARGS.port || '') ? ARGS.port : null;

/* ---------- logging ---------- */
let logFd = null;
function openLog() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  for (let i = 0; i < 10; i++) {
    try { return fs.openSync(path.join(STATE_DIR, i ? 'bridge-' + i + '.log' : 'bridge.log'), 'a'); } catch (e) { /* held open: next */ }
  }
  return fs.openSync(path.join(STATE_DIR, 'bridge-' + Date.now() + '.log'), 'a');
}
function log(msg) {
  const line = '[launcher] ' + msg;
  if (logFd !== null) { try { fs.writeSync(logFd, new Date().toISOString() + ' ' + line + '\n'); } catch (e) { /* ignore */ } }
  else console.log(line);
}

/* ---------- signatures ---------- */
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
function publicKey(dir) {
  return crypto.createPublicKey(fs.readFileSync(path.join(dir || SELF_DIR, 'release-public-key.pem'), 'utf8'));
}
/* Parse a signed envelope and return its manifest, or throw. */
function openEnvelope(text, key) {
  let env;
  try { env = JSON.parse(text); } catch (e) { throw new Error('not a release file'); }
  if (!env || typeof env.payload !== 'string' || typeof env.signature !== 'string') throw new Error('not a signed release file');
  if (!crypto.verify(null, Buffer.from(env.payload, 'utf8'), key, Buffer.from(env.signature, 'base64'))) throw new Error('the signature does not match (not published with the FanucStudio release key, or edited)');
  const m = JSON.parse(env.payload);
  if (m.format !== 1 || m.app !== 'FanucStudio' || !Number.isInteger(m.build) || m.build <= 0 || !m.files || typeof m.files !== 'object') throw new Error('unknown release format');
  for (const [rel, f] of Object.entries(m.files)) {
    if (!SAFE_PATH.test(rel) || rel.split('/').some((s) => s === '.' || s === '..') || rel === SIG_FILE) throw new Error('unsafe file name in release: ' + rel);
    if (!f || !/^[0-9a-f]{64}$/.test(f.sha256) || !Number.isInteger(f.size)) throw new Error('bad file entry: ' + rel);
  }
  if (m.runtime && (!/^[0-9a-f]{64}$/.test(m.runtime.sha256) || !Number.isInteger(m.runtime.size) || !RUNTIME_PATH.test(m.runtime.path || ''))) throw new Error('bad runtime entry');
  return m;
}

/* A retire notice: { format: 1, app, kind: 'retire', created, message, users }
 * signed with the release key. users = null/[] means everyone, else user
 * names or user@host (case-insensitive). */
function openRetire(text, key) {
  let env;
  try { env = JSON.parse(text); } catch (e) { throw new Error('retire.json is not a signed file'); }
  if (!env || typeof env.payload !== 'string' || typeof env.signature !== 'string') throw new Error('retire.json is not a signed file');
  if (!crypto.verify(null, Buffer.from(env.payload, 'utf8'), key, Buffer.from(env.signature, 'base64'))) throw new Error('retire.json signature does not match');
  const r = JSON.parse(env.payload);
  if (r.format !== 1 || r.app !== 'FanucStudio' || r.kind !== 'retire') throw new Error('retire.json has an unknown format');
  return r;
}
function retireApplies(r) {
  if (!r || !Array.isArray(r.users) || !r.users.length) return !!r;
  const u = require('os').userInfo().username.toLowerCase(), h = require('os').hostname().toLowerCase();
  return r.users.some((x) => { x = String(x).toLowerCase(); return x === u || x === u + '@' + h; });
}
/* The retire notice on the share, or null (none, unreadable, or not signed: a warning). */
async function readRetire(source, key, warnings) {
  let text;
  try { text = await withTimeout(fs.promises.readFile(path.join(source, 'retire.json'), 'utf8'), SOURCE_TIMEOUT_MS, source); }
  catch (e) { if (e.code !== 'ENOENT' && warnings) warnings.push('Retire check: ' + e.message); return null; }
  try { return openRetire(text, key); } catch (e) { if (warnings) warnings.push(e.message + '; ignored'); return null; }
}

/* ---------- local builds ---------- */
function listFiles(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) listFiles(path.join(dir, e.name), rel, out);
    else out.push(rel);
  }
  return out;
}
/* Check a local build folder against its own signed manifest: every listed
 * file present with the right hash, nothing else. Returns the manifest. */
function verifyLocal(dir, key) {
  const m = openEnvelope(fs.readFileSync(path.join(dir, SIG_FILE), 'utf8'), key);
  if (String(m.build) !== path.basename(dir)) throw new Error('folder name does not match build ' + m.build);
  for (const [rel, f] of Object.entries(m.files)) {
    let data;
    try { data = fs.readFileSync(path.join(dir, ...rel.split('/'))); } catch (e) { throw new Error('missing ' + rel); }
    if (data.length !== f.size || sha256(data) !== f.sha256) throw new Error('modified ' + rel);
  }
  for (const rel of listFiles(dir, '', [])) {
    if (rel !== SIG_FILE && !m.files[rel]) throw new Error('unexpected file ' + rel);
  }
  return m;
}
function localBuilds() {
  let names = [];
  try { names = fs.readdirSync(APP_DIR); } catch (e) { return []; }
  return names.filter((n) => /^\d+$/.test(n)).map(Number).sort((a, b) => b - a);
}
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* in use: next start */ } }

/* ---------- the share ---------- */
function withTimeout(promise, ms, what) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + ' did not answer within ' + ms / 1000 + ' s')), ms); })])
    .finally(() => clearTimeout(t));
}
async function readRemote(source, key) {
  const text = await withTimeout(fs.promises.readFile(path.join(source, 'latest.json'), 'utf8'), SOURCE_TIMEOUT_MS, source);
  return { manifest: openEnvelope(text, key) };
}
/* Copy one build from the share, checking each file as it is written; the
 * folder only gets its real name once complete. */
async function installBuild(source, m, key) {
  const srcDir = path.join(source, String(m.build));
  const envText = await fs.promises.readFile(path.join(srcDir, SIG_FILE), 'utf8');
  const own = openEnvelope(envText, key);
  if (own.build !== m.build || JSON.stringify(own.files) !== JSON.stringify(m.files)) throw new Error('build ' + m.build + ' on the share does not match latest.json');
  fs.mkdirSync(APP_DIR, { recursive: true });
  const tmp = path.join(APP_DIR, m.build + '.tmp-' + process.pid);
  rmrf(tmp);
  for (const [rel, f] of Object.entries(m.files)) {
    const data = await fs.promises.readFile(path.join(srcDir, ...rel.split('/')));
    if (data.length !== f.size || sha256(data) !== f.sha256) throw new Error(rel + ' on the share does not match the signed release');
    const target = path.join(tmp, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  fs.writeFileSync(path.join(tmp, SIG_FILE), envText);
  const dest = path.join(APP_DIR, String(m.build));
  if (fs.existsSync(dest)) { const bad = dest + '.bad-' + Date.now(); fs.renameSync(dest, bad); rmrf(bad); }
  fs.renameSync(tmp, dest);
  try { verifyLocal(dest, key); }
  catch (e) { const bad = dest + '.bad-' + Date.now(); fs.renameSync(dest, bad); rmrf(bad); throw e; }
}
/* The runtime is shared by builds and replaced only when the release names
 * another one. A running node.exe cannot be overwritten or deleted but can
 * be renamed, so the old one is moved aside and removed on a later start. */
async function installRuntime(source, m) {
  if (!m.runtime) return;
  const node = path.join(BIN_DIR, 'node.exe'), stamp = path.join(BIN_DIR, 'node.sha256');
  try {
    const st = fs.statSync(node), s = JSON.parse(fs.readFileSync(stamp, 'utf8'));
    if (s.size === st.size && s.mtime === st.mtimeMs && s.sha256 === m.runtime.sha256) return;
  } catch (e) { /* no stamp yet */ }
  if (fs.existsSync(node) && sha256(fs.readFileSync(node)) === m.runtime.sha256) {
    const st = fs.statSync(node);
    fs.writeFileSync(stamp, JSON.stringify({ size: st.size, mtime: st.mtimeMs, sha256: m.runtime.sha256 }));
    return;
  }
  const data = await fs.promises.readFile(path.join(source, ...m.runtime.path.split('/')));
  if (data.length !== m.runtime.size || sha256(data) !== m.runtime.sha256) throw new Error('the runtime on the share does not match the signed release');
  fs.mkdirSync(BIN_DIR, { recursive: true });
  const fresh = path.join(BIN_DIR, 'node.new-' + process.pid + '.exe');
  fs.writeFileSync(fresh, data);
  if (fs.existsSync(node)) fs.renameSync(node, path.join(BIN_DIR, 'node-old-' + Date.now() + '.exe'));
  fs.renameSync(fresh, node);
  const st = fs.statSync(node);
  fs.writeFileSync(stamp, JSON.stringify({ size: st.size, mtime: st.mtimeMs, sha256: m.runtime.sha256 }));
  log('runtime ' + m.runtime.version + ' installed');
}
/* The launcher's own files travel inside each build as _launcher/*. They
 * are restored from the verified build, so an edited launcher is put back. */
function syncLauncher(buildDir, m) {
  for (const rel of Object.keys(m.files)) {
    if (!rel.startsWith('_launcher/')) continue;
    const target = path.join(HOME, ...rel.slice('_launcher/'.length).split('/'));
    const data = fs.readFileSync(path.join(buildDir, ...rel.split('/')));
    let cur = null;
    try { cur = fs.readFileSync(target); } catch (e) { /* missing */ }
    if (cur && cur.equals(data)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.new-' + process.pid;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
    log((cur ? 'updated ' : 'installed ') + rel.slice('_launcher/'.length));
  }
}

function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { return {}; } }
function writeConfig(cfg) {
  fs.mkdirSync(HOME, { recursive: true });
  const tmp = CONFIG_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_FILE);
}

/* Check the share, install a newer build, pick the newest local build that
 * verifies, tidy up. Never throws for a share problem: it is reported and
 * the local copy runs. */
async function prepare(key) {
  const cfg = readConfig();
  const source = ARGS.source || cfg.source || DEFAULT_SOURCE;
  const status = { home: HOME, source, remote: null, installed: null, warnings: [], build: null, dir: null };
  for (const f of (() => { try { return fs.readdirSync(BIN_DIR); } catch (e) { return []; } })()) {
    if (/^node-old-\d+\.exe$|^node\.new-\d+\.exe$/.test(f)) { try { fs.unlinkSync(path.join(BIN_DIR, f)); } catch (e) { /* still running */ } }
  }
  for (const f of (() => { try { return fs.readdirSync(APP_DIR); } catch (e) { return []; } })()) {
    if (/\.(tmp|bad)-\d+$/.test(f)) rmrf(path.join(APP_DIR, f));
  }
  if (!has('no-update')) {
    const r = await readRetire(source, key, status.warnings);
    if (r && retireApplies(r)) { status.retired = r; return status; }
  }
  const highest = Math.max(cfg.highestBuild || 0, ...localBuilds().map((b) => { try { verifyLocal(path.join(APP_DIR, String(b)), key); return b; } catch (e) { return 0; } }), 0);
  let remote = null;
  if (!has('no-update')) {
    try { remote = (await readRemote(source, key)).manifest; status.remote = remote.build; }
    catch (e) { status.warnings.push('No update check: ' + e.message); }
  }
  if (remote) {
    const dir = path.join(APP_DIR, String(remote.build));
    let ok = false;
    try { verifyLocal(dir, key); ok = true; } catch (e) { if (fs.existsSync(dir)) log('build ' + remote.build + ' here is not usable (' + e.message + '); copying it again'); }
    if (remote.build < highest && !ok) {
      status.warnings.push('The share offers build ' + remote.build + ', older than build ' + highest + ' already accepted on this PC; ignored.');
    } else {
      try {
        if (!ok) { log('installing build ' + remote.build + ' from ' + source); await installBuild(source, remote, key); status.installed = remote.build; }
        await installRuntime(source, remote);
      } catch (e) { status.warnings.push('Update to build ' + remote.build + ' failed: ' + e.message); }
    }
  }
  for (const b of localBuilds()) {
    const dir = path.join(APP_DIR, String(b));
    try { const m = verifyLocal(dir, key); status.build = b; status.dir = dir; status.manifest = m; break; }
    catch (e) { status.warnings.push('Build ' + b + ' on this PC is not used: ' + e.message); }
  }
  if (status.build) {
    writeConfig(Object.assign(cfg, { source, highestBuild: Math.max(highest, status.build) }));
    try { syncLauncher(status.dir, status.manifest); } catch (e) { status.warnings.push('Launcher files not refreshed: ' + e.message); }
    const keep = localBuilds().filter((b) => b <= status.build).slice(0, KEEP_BUILDS);
    for (const b of localBuilds()) if (!keep.includes(b) && b !== status.build) rmrf(path.join(APP_DIR, String(b)));
  }
  for (const w of status.warnings) log(w);
  return status;
}

/* ---------- Windows integration ---------- */
function register() {
  if (process.env.FANUCSTUDIO_NO_REGISTER === '1' || process.platform !== 'win32') return;
  const vbs = path.join(HOME, 'Start FanucStudio hidden.vbs');
  const k = 'HKCU\\Software\\Classes\\fanucstudio';
  const reg = (args) => spawnSync('reg', args, { windowsHide: true, stdio: 'ignore' });
  reg(['add', k, '/ve', '/d', 'URL:FanucStudio bridge', '/f']);
  reg(['add', k, '/v', 'URL Protocol', '/d', '', '/f']);
  reg(['add', k + '\\shell\\open\\command', '/ve', '/d', 'wscript.exe "' + vbs + '"', '/f']);
}
function shortcuts() {
  if (process.platform !== 'win32') return;
  const target = path.join(HOME, 'Open FanucStudio.vbs');
  const icon = path.join(APP_DIR, String(localBuilds()[0] || ''), 'FANUC Studio.ico');
  const ps = (lnk) => "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('" + lnk.replace(/'/g, "''") + "');" +
    "$s.TargetPath='wscript.exe';$s.Arguments='\"" + target.replace(/'/g, "''") + "\"';$s.WorkingDirectory='" + HOME.replace(/'/g, "''") + "';" +
    (fs.existsSync(icon) ? "$s.IconLocation='" + icon.replace(/'/g, "''") + "';" : '') + '$s.Description=\'FanucStudio\';$s.Save()';
  const desktop = path.join(require('os').homedir(), 'Desktop', 'FanucStudio.lnk');
  const menu = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'FanucStudio.lnk');
  for (const lnk of [desktop, menu]) spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps(lnk)], { windowsHide: true, stdio: 'ignore' });
}
/* Open the app once the bridge answers (up to 20 s); done() either way. */
function openBrowser(port, done) {
  const url = 'http://localhost:' + (port || 8642);
  let tries = 0;
  (function poll() {
    const req = http.get({ host: '127.0.0.1', port: port || 8642, path: '/api/ping', headers: { host: 'localhost' }, timeout: 1000 }, (res) => {
      res.resume();
      spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
      if (done) done();
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => { if (++tries < 40) setTimeout(poll, 500); else if (done) done(); });
  }());
}

/* ---------- start the bridge ---------- */
function bridgeEnv(status) {
  return Object.assign({}, process.env, {
    FANUCSTUDIO_STATE: STATE_DIR,
    FANUCSTUDIO_LAUNCHER: path.join(HOME, 'launcher.js'),
    FANUCSTUDIO_RELEASE: JSON.stringify({ build: status.build, source: status.source, verified: true, commit: (status.manifest && status.manifest.git && status.manifest.git.commit) || null }),
    FANUCSTUDIO_UPDATE_SOURCE: status.source
  }, has('restart') ? { FANUCSTUDIO_RESTART: '1' } : {});
}
function startHidden(status) {
  const fd = logFd !== null ? logFd : openLog();
  const child = spawn(process.execPath, [path.join(status.dir, 'server.js')].concat(PORT ? [PORT] : []), {
    cwd: status.dir, detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env: bridgeEnv(status)
  });
  child.unref();
  log('bridge build ' + status.build + ' started (pid ' + child.pid + ')');
}
function startInConsole(status) {
  Object.assign(process.env, bridgeEnv(status));
  process.chdir(status.dir);
  process.argv = [process.execPath, path.join(status.dir, 'server.js')].concat(PORT ? [PORT] : []);
  require(path.join(status.dir, 'server.js'));
}

/* ---------- uninstall ---------- */
const os = require('os');
const UNINSTALL_LOG = path.join(os.tmpdir(), 'FanucStudio-uninstall.log');
function note(msg) {
  console.log(msg);
  try { fs.appendFileSync(UNINSTALL_LOG, new Date().toISOString() + ' ' + msg + '\n'); } catch (e) { /* ignore */ }
}
function pingPort(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', headers: { host: 'localhost' }, timeout: 1500 }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(null));
  });
}
const inHome = (p) => { const a = path.resolve(String(p || '')).toLowerCase(), h = HOME.toLowerCase(); return a === h || a.startsWith(h + path.sep); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/* Bridges of this install: the --pid given by the bridge itself, plus any
 * FanucStudio bridge on the port whose state folder is inside HOME (so a dev
 * copy or another user's install is never stopped). */
async function stopBridges() {
  const pids = new Set();
  if (/^\d+$/.test(ARGS.pid || '')) pids.add(parseInt(ARGS.pid, 10));
  for (const p of new Set([PORT || '8642', '8642'])) {
    const b = await pingPort(p);
    if (b && b.app === 'fanuc-tp-studio-bridge' && b.me && b.me.user === os.userInfo().username && inHome(b.stateDir)) pids.add(b.me.pid);
  }
  for (const pid of pids) {
    if (pid === process.pid || !alive(pid)) continue;
    try { process.kill(pid); } catch (e) { note('Could not stop the bridge (pid ' + pid + '): ' + e.message); continue; }
    for (let i = 0; i < 50 && alive(pid); i++) await new Promise((r) => setTimeout(r, 100));
    note('Stopped the FanucStudio bridge (pid ' + pid + ').');
  }
}
function removeShortcuts() {
  if (process.env.FANUCSTUDIO_NO_REGISTER === '1' || process.platform !== 'win32') return;
  const desktop = path.join(os.homedir(), 'Desktop', 'FanucStudio.lnk');
  const menu = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'FanucStudio.lnk');
  const home = HOME.toLowerCase();
  for (const lnk of [desktop, menu]) {
    let data;
    try { data = fs.readFileSync(lnk); } catch (e) { continue; }
    /* only our own shortcut: its arguments / working folder name HOME (UTF-16 or ANSI) */
    const text = [data.toString('latin1'), data.toString('utf16le'), data.subarray(1).toString('utf16le')].join('\n').toLowerCase();
    if (!text.includes(home)) { note('Left ' + lnk + ' (it does not point to ' + HOME + ').'); continue; }
    try { fs.unlinkSync(lnk); note('Removed ' + lnk); } catch (e) { note('Could not remove ' + lnk + ': ' + e.message); }
  }
}
function unregister() {
  if (process.env.FANUCSTUDIO_NO_REGISTER === '1' || process.platform !== 'win32') return;
  const k = 'HKCU\\Software\\Classes\\fanucstudio';
  const q = spawnSync('reg', ['query', k + '\\shell\\open\\command', '/ve'], { windowsHide: true, encoding: 'utf8' });
  if (q.status !== 0) return;
  /* a developer copy's Start FanucStudio.bat registers its own folder: leave that */
  if (!q.stdout.toLowerCase().includes(HOME.toLowerCase())) { note('Left the fanucstudio:// link (it points to another FanucStudio copy).'); return; }
  spawnSync('reg', ['delete', k, '/f'], { windowsHide: true, stdio: 'ignore' });
  note('Removed the fanucstudio:// link.');
}
/* Delete HOME. A node.exe still running from HOME\bin (this process, when
 * the bridge started it) cannot be deleted, so a small script in %TEMP%
 * retries after this process has exited, then deletes itself. */
function removeHome() {
  for (const e of (() => { try { return fs.readdirSync(HOME); } catch (err) { return []; } })()) rmrf(path.join(HOME, e));
  rmrf(HOME);
  if (!fs.existsSync(HOME)) { note('Removed ' + HOME); return true; }
  if (process.platform !== 'win32') { note('Could not remove all of ' + HOME); return false; }
  const script = path.join(os.tmpdir(), 'FanucStudio-uninstall-' + process.pid + '.cmd');
  fs.writeFileSync(script, ['@echo off', 'for /l %%i in (1,1,30) do (', '  rmdir /s /q "' + HOME + '" 2>nul', '  if not exist "' + HOME + '\\" goto done', '  ping -n 2 127.0.0.1 >nul', ')',
    ':done', 'if exist "' + HOME + '\\" (echo %date% %time% Could not remove ' + HOME + ' >> "' + UNINSTALL_LOG + '") else (echo %date% %time% Removed ' + HOME + ' >> "' + UNINSTALL_LOG + '")',
    '(goto) 2>nul & del "%~f0"', ''].join('\r\n'));
  spawn('cmd.exe', ['/d', '/c', script], { cwd: os.tmpdir(), detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  note('The rest of ' + HOME + ' is removed once this window closes.');
  return true;
}
/* Backups are never deleted. The bridge refuses a backup folder inside HOME,
 * but settings.json / robots.json can be edited by hand: any configured
 * backup folder (home folder or a robot's own) inside HOME stops the
 * uninstall before anything is touched. */
function backupsInHome() {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(STATE_DIR, f), 'utf8')); } catch (e) { return null; } };
  const dirs = [];
  const s = read('settings.json');
  if (s && s.backupRoot) dirs.push(String(s.backupRoot));
  const robots = read('robots.json');
  if (Array.isArray(robots)) for (const r of robots) if (r && r.folder) dirs.push(String(r.folder));
  return dirs.filter((d) => inHome(d) && fs.existsSync(d));
}
async function uninstall(reason) {
  try { process.chdir(os.tmpdir()); } catch (e) { /* ignore */ }
  note('Uninstalling FanucStudio from ' + HOME + (reason ? ' (' + reason + ')' : '') + '.');
  if (!fs.existsSync(HOME)) { note('FanucStudio is not installed here.'); return 0; }
  const kept = backupsInHome();
  if (kept.length) {
    note('Not uninstalled: these backup folders are inside ' + HOME + ' and would be deleted with it: ' + kept.join(', ') + '. Move them elsewhere (and point FanucStudio at the new place), then uninstall again.');
    return 1;
  }
  await stopBridges();
  removeShortcuts();
  unregister();
  removeHome();
  note('FanucStudio is uninstalled. Robot backups were not touched. To install again, run Install FanucStudio.bat on the share.');
  return 0;
}
async function uninstallMode(key) {
  if (!has('retired')) return uninstall('requested');
  /* started by a bridge that saw retire.json: re-check the signature here */
  const source = ARGS.source || readConfig().source || DEFAULT_SOURCE;
  const r = await readRetire(source, key, []);
  if (!r || !retireApplies(r)) { note('No signed retire notice for this user on ' + source + '; nothing removed.'); return 1; }
  return uninstall('retired' + (r.message ? ': ' + r.message : ''));
}

/* ---------- install (run from the share) ---------- */
async function install(key) {
  const source = path.resolve(ARGS.source || path.join(SELF_DIR, '..', '..'));
  const r = await readRetire(source, key, []);
  if (r && retireApplies(r)) throw new Error('FanucStudio has been retired' + (r.message ? ': ' + r.message : '') + '. Nothing was installed.');
  fs.mkdirSync(HOME, { recursive: true });
  writeConfig(Object.assign(readConfig(), { source }));
  ARGS.source = source;
  const status = await prepare(key);
  if (!status.build) throw new Error('nothing could be installed. ' + status.warnings.join(' '));
  if (!fs.existsSync(path.join(BIN_DIR, 'node.exe'))) throw new Error('the runtime was not installed. ' + status.warnings.join(' '));
  register();
  if (!has('no-shortcuts')) shortcuts();
  console.log('FanucStudio build ' + status.build + ' is installed in ' + HOME);
  console.log('Updates come from ' + source + ' each time FanucStudio starts.');
  if (!has('no-shortcuts')) console.log('Start it from the FanucStudio shortcut on the desktop or in the Start menu.');
  if (!has('no-start')) {
    spawn(path.join(BIN_DIR, 'node.exe'), [path.join(HOME, 'launcher.js'), '--hidden', '--open'].concat(PORT ? ['--port', PORT] : []), { detached: true, windowsHide: true, stdio: 'ignore', env: process.env }).unref();
    console.log('Starting FanucStudio…');
  }
  return status;
}

async function main() {
  const hidden = has('hidden') || has('restart');
  if (hidden) logFd = openLog();
  const key = publicKey();
  if (has('uninstall')) return uninstallMode(key);
  if (has('install')) { await install(key); return 0; }
  const status = await prepare(key);
  if (has('check')) {
    console.log(JSON.stringify({ build: status.build, commit: (status.manifest && status.manifest.git && status.manifest.git.commit) || null, remote: status.remote, installed: status.installed, source: status.source, warnings: status.warnings, retired: status.retired ? (status.retired.message || true) : null }));
    return status.build ? 0 : 1;
  }
  if (status.retired) {
    log('retired by ' + status.source + '\\retire.json' + (status.retired.message ? ': ' + status.retired.message : '') + '; uninstalling');
    if (logFd !== null) { try { fs.closeSync(logFd); } catch (e) { /* ignore */ } logFd = null; }
    const code = await uninstall('retired' + (status.retired.message ? ': ' + status.retired.message : ''));
    if (!hidden) console.error('FanucStudio has been retired' + (status.retired.message ? ': ' + status.retired.message : '') + '. ' + (code ? 'It was not removed (see above) and does not start.' : 'It was removed from this PC.'));
    return code;
  }
  if (!status.build) {
    const msg = 'No verified FanucStudio build is available on this PC. ' + status.warnings.join(' ') +
      ' Connect to the company network (' + status.source + ') and start FanucStudio again.';
    log(msg);
    if (hidden) return 1;
    console.error(msg);
    return 1;
  }
  register();
  if (hidden) {
    startHidden(status);
    if (has('open')) { openBrowser(PORT, () => process.exit(0)); return null; }
    return 0;
  }
  if (has('open')) openBrowser(PORT);
  log('running build ' + status.build + (status.installed ? ' (just updated)' : ''));
  startInConsole(status);
  return null;
}

main().then((code) => {
  if (code !== null) process.exit(code);
}, (e) => {
  log('failed: ' + (e && e.message || e));
  if (!(has('hidden') || has('restart'))) console.error('FanucStudio launcher failed: ' + (e && e.message || e));
  process.exit(1);
});
