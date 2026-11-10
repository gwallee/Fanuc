'use strict';
/* Signed release round trip: publish -> install -> verify/repair -> refuse
 * tampering and rollback -> run the bridge -> update through Restart bridge
 * -> retire / uninstall, backups kept. Uses a throwaway key and temp folders
 * (share, install home, backups); never touches the S: share, the registry,
 * Documents or the real %LOCALAPPDATA%\FanucStudio.
 *   node --test tools/test-release.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fanucstudio-release-'));
const KEY = path.join(TMP, 'key.pem'), PUB = path.join(TMP, 'pub.pem');
const DEST = path.join(TMP, 'share', 'FanucStudio'), RELEASES = path.join(DEST, 'releases');
/* CellStudio's runtime folder on the same share, holding this very node.exe */
const CS_RUNTIME = path.join(TMP, 'share', 'CellStudio', 'releases', 'runtime');
const HOME = path.join(TMP, 'home');
const DATA = path.join(TMP, 'documents', 'FanucStudio');
const PORT = String(18000 + Math.floor(Math.random() * 1000));
const ENV = Object.assign({}, process.env, { FANUCSTUDIO_HOME: HOME, FANUCSTUDIO_DATA: DATA, FANUCSTUDIO_NO_REGISTER: '1', FANUCSTUDIO_KEY_PASSPHRASE: '', FANUCSTUDIO_UPDATE_POLL_MS: '500', FANUCSTUDIO_RETIRE_DELAY_MS: '1000' });
delete ENV.FANUC_STUDIO_STATE; delete ENV.FANUCSTUDIO_STATE;
const BUILD = parseInt(/build (\d+)/.exec(fs.readFileSync(path.join(REPO, 'js', 'version.js'), 'utf8'))[1], 10);
const NODE_VER = process.version;

const run = (file, args) => spawnSync(process.execPath, [file].concat(args), { env: ENV, encoding: 'utf8', timeout: 120000 });
const publishTo = (root, dest, extra) => run(path.join(REPO, 'tools', 'publish-release.js'), ['--root', root, '--dest', dest, '--key', KEY, '--public-key', PUB].concat(extra || []));
const publish = (root, git) => publishTo(root, DEST, ['--shared-runtime', CS_RUNTIME].concat(git ? [] : ['--no-git']));
const gitIn = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const check = (extra) => {
  const r = run(path.join(HOME, 'launcher.js'), ['--check'].concat(extra || []));
  return Object.assign(JSON.parse(r.stdout.trim().split('\n').pop()), { code: r.status });
};
const manifestOf = (build) => JSON.parse(JSON.parse(fs.readFileSync(path.join(RELEASES, String(build), 'release.sig.json'), 'utf8')).payload);
function appCopy(build) {
  const root = path.join(TMP, 'root-' + build);
  fs.mkdirSync(root, { recursive: true });
  for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'server.js', 'dac-standard.json', 'FANUC Studio.ico']) fs.copyFileSync(path.join(REPO, f), path.join(root, f));
  for (const d of ['css', 'icons', 'js', 'lib']) fs.cpSync(path.join(REPO, d), path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, 'js', 'version.js'), "window.FANUC_STUDIO_BUILD = 'build " + build + "';\n");
  return root;
}
function request(method, p, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, timeout: 3000,
      headers: Object.assign({ host: 'localhost:' + PORT, 'content-type': 'application/json' }, headers || {}) }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(Object.assign(JSON.parse(b), { status: res.statusCode })); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(method === 'POST' ? '{}' : undefined);
  });
}
async function waitPing(pred, ms) {
  const end = Date.now() + (ms || 30000);
  for (;;) {
    try { const b = await request('GET', '/api/ping'); if (pred(b)) return b; } catch (e) { /* not up yet */ }
    if (Date.now() > end) throw new Error('bridge did not reach the expected state');
    await new Promise((r) => setTimeout(r, 300));
  }
}

let pid = null;
test.after(() => { if (pid) { try { process.kill(pid); } catch (e) { /* gone */ } } setTimeout(() => fs.rmSync(TMP, { recursive: true, force: true }), 500); });

test('publish and install a signed build, sharing CellStudio\'s node.exe', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(PUB, publicKey.export({ type: 'spki', format: 'pem' }));
  fs.mkdirSync(path.join(CS_RUNTIME, NODE_VER), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(CS_RUNTIME, NODE_VER, 'node.exe'));
  const p = publish(appCopy(BUILD));
  assert.strictEqual(p.status, 0, p.stderr);
  assert.match(p.stdout, /using CellStudio's copy/);
  assert.ok(fs.existsSync(path.join(RELEASES, 'latest.json')));
  assert.ok(!fs.existsSync(path.join(RELEASES, 'runtime')), 'no second node.exe on the share');
  assert.strictEqual(manifestOf(BUILD).runtime.path, '../../CellStudio/releases/runtime/' + NODE_VER + '/node.exe');
  for (const f of ['FANUC Studio.ico', 'dac-standard.json', '_launcher/Start FanucStudio.bat', '_launcher/release-public-key.pem']) assert.ok(manifestOf(BUILD).files[f], f);
  const bat = fs.readFileSync(path.join(DEST, 'Install FanucStudio.bat'), 'utf8');
  assert.ok(bat.includes('%~dp0releases\\..\\..\\CellStudio\\releases\\runtime\\' + NODE_VER + '\\node.exe'), bat);
  /* Same number, other files: refused. */
  const other = appCopy(BUILD);
  fs.appendFileSync(path.join(other, 'js', 'linter.js'), '\n// changed\n');
  assert.notStrictEqual(publish(other).status, 0);

  const i = run(path.join(RELEASES, String(BUILD), '_launcher', 'launcher.js'), ['--install', '--source', RELEASES, '--no-start', '--no-shortcuts']);
  assert.strictEqual(i.status, 0, i.stderr + i.stdout);
  for (const f of ['launcher.js', 'release-public-key.pem', 'Start FanucStudio.bat', 'Open FanucStudio.vbs', 'bin/node.exe', 'app/' + BUILD + '/server.js']) assert.ok(fs.existsSync(path.join(HOME, f)), f);
  const s = check();
  assert.strictEqual(s.build, BUILD);
  assert.deepStrictEqual(s.warnings, []);
});

test('without CellStudio\'s copy, publish ships its own node.exe', () => {
  const dest = path.join(TMP, 'share-own');
  const p = publishTo(appCopy(BUILD), dest, ['--no-git', '--shared-runtime', path.join(TMP, 'nowhere')]);
  assert.strictEqual(p.status, 0, p.stderr);
  assert.ok(fs.existsSync(path.join(dest, 'releases', 'runtime', NODE_VER, 'node.exe')));
  const m = JSON.parse(JSON.parse(fs.readFileSync(path.join(dest, 'releases', 'latest.json'), 'utf8')).payload);
  assert.strictEqual(m.runtime.path, 'runtime/' + NODE_VER + '/node.exe');
});

test('a changed shared node.exe is refused', () => {
  const shared = path.join(CS_RUNTIME, NODE_VER, 'node.exe'), good = fs.readFileSync(shared);
  fs.rmSync(path.join(HOME, 'bin'), { recursive: true, force: true });
  fs.writeFileSync(shared, Buffer.concat([good, Buffer.from('x')]));
  const s = check();
  assert.match(s.warnings.join(' '), /runtime on the share does not match/);
  assert.ok(!fs.existsSync(path.join(HOME, 'bin', 'node.exe')));
  fs.writeFileSync(shared, good);
  assert.deepStrictEqual(check().warnings, []);
  assert.ok(fs.existsSync(path.join(HOME, 'bin', 'node.exe')));
});

test('a modified or extra local file is repaired from the share, or refused offline', () => {
  const f = path.join(HOME, 'app', String(BUILD), 'js', 'parser.js');
  fs.appendFileSync(f, '\n// local edit\n');
  let s = check(['--no-update']);
  assert.strictEqual(s.build, null);
  assert.strictEqual(s.code, 1);
  assert.match(s.warnings.join(' '), /modified js\/parser\.js/);
  s = check();
  assert.strictEqual(s.build, BUILD);
  assert.strictEqual(s.installed, BUILD);
  /* what an old bridge would have done: a snapshot beside server.js */
  fs.mkdirSync(path.join(HOME, 'app', String(BUILD), 'backups', 'pre-upload'), { recursive: true });
  fs.writeFileSync(path.join(HOME, 'app', String(BUILD), 'backups', 'pre-upload', 'X.LS'), '/PROG X');
  assert.match(check(['--no-update']).warnings.join(' '), /unexpected file backups\/pre-upload\/X\.LS/);
  assert.strictEqual(check().build, BUILD);
  /* An edited launcher is put back from the verified build. */
  fs.appendFileSync(path.join(HOME, 'launcher.js'), '\n// edited\n');
  check();
  assert.ok(fs.readFileSync(path.join(HOME, 'launcher.js')).equals(fs.readFileSync(path.join(HOME, 'app', String(BUILD), '_launcher', 'launcher.js'))));
});

test('an edited share release or a foreign key is ignored', () => {
  const latest = path.join(RELEASES, 'latest.json'), good = fs.readFileSync(latest, 'utf8');
  const env = JSON.parse(good);
  env.payload = env.payload.replace('"build": ' + BUILD, '"build": ' + (BUILD + 50));
  fs.writeFileSync(latest, JSON.stringify(env));
  let s = check();
  assert.strictEqual(s.build, BUILD);
  assert.match(s.warnings.join(' '), /signature does not match/);
  /* Validly formed, but signed by another key. */
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const payload = JSON.parse(good).payload.replace('"build": ' + BUILD, '"build": ' + (BUILD + 50));
  fs.writeFileSync(latest, JSON.stringify({ payload, signature: crypto.sign(null, Buffer.from(payload), other).toString('base64') }));
  s = check();
  assert.strictEqual(s.build, BUILD);
  assert.match(s.warnings.join(' '), /signature does not match/);
  fs.writeFileSync(latest, good);
});

test('the bridge runs the verified build, keeps backups outside the install, and updates through Restart bridge', async () => {
  const r = run(path.join(HOME, 'launcher.js'), ['--hidden', '--port', PORT]);
  assert.strictEqual(r.status, 0, r.stderr);
  let b = await waitPing((x) => x.release && x.release.build === BUILD);
  pid = b.me.pid;
  assert.strictEqual(b.build, 'build ' + BUILD);
  assert.strictEqual(b.release.verified, true);
  assert.strictEqual(path.resolve(b.stateDir), path.join(HOME, 'state'));
  /* backups default outside HOME; a folder inside it is refused */
  const st = await request('GET', '/api/settings');
  assert.strictEqual(path.resolve(st.backupRoot), path.join(DATA, 'backups'));
  const bad = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ backupRoot: path.join(HOME, 'state', 'backups') });
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/settings', method: 'POST', headers: { host: 'localhost:' + PORT, 'content-type': 'application/json' } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(t) }));
    });
    req.on('error', reject); req.end(body);
  });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.body.error, /inside the FanucStudio install folder/);
  /* restart / uninstall only for a same-origin page on this PC */
  assert.strictEqual((await request('POST', '/api/bridge/restart', { origin: 'http://evil.example' })).status, 403);
  assert.strictEqual((await request('POST', '/api/bridge/uninstall', { 'sec-fetch-site': 'cross-site' })).status, 403);

  const p = publish(appCopy(BUILD + 1));
  assert.strictEqual(p.status, 0, p.stderr);
  await waitPing((x) => x.release && x.release.update === BUILD + 1, 15000);
  const old = pid;
  assert.strictEqual((await request('POST', '/api/bridge/restart')).ok, true);
  b = await waitPing((x) => x.me && x.me.pid !== old && x.release && x.release.build === BUILD + 1);
  pid = b.me.pid;
  assert.strictEqual(b.build, 'build ' + (BUILD + 1));
  assert.strictEqual(b.release.update, null);
});

test('rollback through the share is refused', () => {
  const latest = path.join(RELEASES, 'latest.json');
  fs.copyFileSync(path.join(RELEASES, String(BUILD), 'release.sig.json'), latest);
  fs.rmSync(path.join(HOME, 'app', String(BUILD)), { recursive: true, force: true });
  const s = check();
  assert.strictEqual(s.build, BUILD + 1);
  assert.match(s.warnings.join(' '), /older than build/);
  fs.copyFileSync(path.join(RELEASES, String(BUILD + 1), 'release.sig.json'), latest);
});

test('publishing requires a clean, pushed commit and tags it', () => {
  const b = BUILD + 10, root = appCopy(b), bare = path.join(TMP, 'origin.git');
  const g = (args) => { const r = gitIn(root, args); assert.strictEqual(r.status, 0, r.stderr); return r.stdout.trim(); };
  gitIn(TMP, ['init', '-q', '--bare', bare]);
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@example.com']); g(['config', 'user.name', 'Test']);
  g(['add', '-A']); g(['commit', '-q', '-m', 'app']);
  let p = publish(root, true);
  assert.notStrictEqual(p.status, 0); assert.match(p.stderr, /no upstream/);
  g(['remote', 'add', 'origin', bare]); g(['push', '-q', '-u', 'origin', 'main']);
  fs.appendFileSync(path.join(root, 'js', 'linter.js'), '\n// wip\n');
  p = publish(root, true);
  assert.notStrictEqual(p.status, 0); assert.match(p.stderr, /uncommitted changes/);
  g(['commit', '-q', '-am', 'wip']);
  p = publish(root, true);
  assert.notStrictEqual(p.status, 0); assert.match(p.stderr, /not pushed/);
  g(['push', '-q']);
  p = publish(root, true);
  assert.strictEqual(p.status, 0, p.stderr);
  const head = g(['rev-parse', 'HEAD']);
  assert.strictEqual(gitIn(bare, ['rev-parse', 'build-' + b + '^{commit}']).stdout.trim(), head);
  const m = manifestOf(b);
  assert.strictEqual(m.git.commit, head);
  assert.strictEqual(m.git.tag, 'build-' + b);
  assert.strictEqual(check().commit, head);
});

const retireTool = (args) => run(path.join(REPO, 'tools', 'publish-release.js'), ['--dest', DEST, '--key', KEY, '--public-key', PUB].concat(args));
function signedRetire(privateKey, notice) {
  const payload = JSON.stringify(Object.assign({ format: 1, app: 'FanucStudio', kind: 'retire', created: new Date().toISOString() }, notice));
  return JSON.stringify({ payload, signature: crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64') });
}
const gone = async (p, ms) => { const end = Date.now() + ms; while (fs.existsSync(p)) { if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 300)); } return true; };

test('a retire notice removes the install but not the backups; unsigned or other-user notices do not', async () => {
  const RETIRE = path.join(RELEASES, 'retire.json');
  const b = await waitPing((x) => x.release && x.release.build >= BUILD + 1);
  pid = b.me.pid;
  assert.strictEqual(b.release.retired, null);
  /* a backup and an upload snapshot where the installed bridge keeps them */
  fs.mkdirSync(path.join(DATA, 'backups', 'R1'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'backups', 'R1', 'MAIN.LS'), '/PROG MAIN');
  fs.mkdirSync(path.join(DATA, 'pre-upload'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'pre-upload', 'snap.LS'), '/PROG SNAP');
  /* signed with another key: ignored with a warning */
  fs.writeFileSync(RETIRE, signedRetire(crypto.generateKeyPairSync('ed25519').privateKey, { message: 'fake', users: null }));
  let s = check();
  assert.strictEqual(s.retired, null);
  assert.match(s.warnings.join(' '), /retire.json signature/);
  /* signed, but for another user: ignored silently */
  const own = crypto.createPrivateKey(fs.readFileSync(KEY, 'utf8'));
  fs.writeFileSync(RETIRE, signedRetire(own, { message: 'not you', users: ['nobody-else', 'x@' + os.hostname()] }));
  s = check();
  assert.strictEqual(s.retired, null);
  assert.ok(!/retire/i.test(s.warnings.join(' ')), s.warnings.join(' '));
  await new Promise((r) => setTimeout(r, 1500));
  assert.strictEqual((await request('GET', '/api/ping')).release.retired, null);
  assert.ok(fs.existsSync(path.join(HOME, 'launcher.js')));
  /* the real thing, through the publish tool, for this user by name */
  const t = retireTool(['--retire', '--message', 'Moving to the new tool', '--users', os.userInfo().username]);
  assert.strictEqual(t.status, 0, t.stderr);
  assert.strictEqual(check().retired, 'Moving to the new tool');
  const r = await waitPing((x) => x.release && x.release.retired, 15000);
  assert.strictEqual(r.release.retired.message, 'Moving to the new tool');
  assert.ok(await gone(HOME, 40000), 'install folder removed');
  await assert.rejects(request('GET', '/api/ping'));
  pid = null;
  assert.ok(fs.existsSync(path.join(DATA, 'backups', 'R1', 'MAIN.LS')), 'backup kept');
  assert.ok(fs.existsSync(path.join(DATA, 'pre-upload', 'snap.LS')), 'snapshot kept');
  /* no new installs while retired */
  const i = run(path.join(RELEASES, String(BUILD + 1), '_launcher', 'launcher.js'), ['--install', '--source', RELEASES, '--no-start', '--no-shortcuts']);
  assert.notStrictEqual(i.status, 0);
  assert.match(i.stderr, /retired: Moving to the new tool/);
  assert.ok(!fs.existsSync(HOME));
});

test('unretire, reinstall, refuse while a backup folder is inside the install, then uninstall', async () => {
  const u = retireTool(['--unretire']);
  assert.strictEqual(u.status, 0, u.stderr);
  assert.ok(!fs.existsSync(path.join(RELEASES, 'retire.json')));
  const i = run(path.join(RELEASES, String(BUILD + 1), '_launcher', 'launcher.js'), ['--install', '--source', RELEASES, '--no-start', '--no-shortcuts']);
  assert.strictEqual(i.status, 0, i.stderr + i.stdout);
  assert.ok(check().build >= BUILD + 1);
  /* --retired without a notice removes nothing */
  const n = run(path.join(HOME, 'launcher.js'), ['--uninstall', '--retired']);
  assert.notStrictEqual(n.status, 0);
  assert.ok(fs.existsSync(path.join(HOME, 'launcher.js')));
  /* a hand-edited robots.json pointing a robot's backups into HOME: refused */
  const inside = path.join(HOME, 'state', 'my-backups');
  fs.mkdirSync(inside, { recursive: true });
  fs.writeFileSync(path.join(inside, 'MAIN.LS'), '/PROG MAIN');
  fs.writeFileSync(path.join(HOME, 'state', 'robots.json'), JSON.stringify([{ ip: '10.0.0.1', folder: inside }]));
  let x = run(path.join(HOME, 'launcher.js'), ['--uninstall', '--port', PORT]);
  assert.notStrictEqual(x.status, 0);
  assert.match(x.stdout, /Not uninstalled/);
  assert.ok(fs.existsSync(path.join(inside, 'MAIN.LS')));
  fs.rmSync(path.join(HOME, 'state', 'robots.json'));
  fs.rmSync(inside, { recursive: true });
  x = run(path.join(HOME, 'launcher.js'), ['--uninstall', '--port', PORT]);
  assert.strictEqual(x.status, 0, x.stderr + x.stdout);
  assert.match(x.stdout, /uninstalled/);
  assert.ok(await gone(HOME, 20000), 'install folder removed');
  assert.ok(fs.existsSync(path.join(DATA, 'backups', 'R1', 'MAIN.LS')), 'backup kept');
  /* the share has an uninstaller beside the installer */
  assert.ok(fs.existsSync(path.join(DEST, 'Uninstall FanucStudio.bat')));
});
