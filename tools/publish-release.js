#!/usr/bin/env node
/* Publishes this working copy as a signed FanucStudio release.
 *
 *   node tools/publish-release.js [--dest S:\zz_Resources\FanucStudio] [--key <private key>]
 *
 * Writes into <dest>\releases:
 *   <build>\              the app files + _launcher\ (the installed launcher), and
 *                         release.sig.json (manifest of every file's SHA-256, signed)
 *   runtime\<ver>\node.exe  this PC's node.exe (copied once per Node version),
 *                         unless CellStudio's share already holds the identical
 *                         file (--shared-runtime, default
 *                         S:\zz_Resources\CellStudio\releases\runtime): then the
 *                         signed manifest names that copy (size + sha256) and
 *                         nothing is copied. --shared-runtime none turns it off.
 *   latest.json           the same signed manifest; written last, so a PC that
 *                         starts mid-publish sees the old release or the new one
 * and <dest>\Install FanucStudio.bat, the one-time installer for new users.
 *
 * The build number comes from js/version.js: bump it first. A published
 * build is never changed: publishing the same number with different files is
 * refused. Installed launchers never go back to an older build, so to pull a
 * bad release publish a newer build (e.g. revert the code and bump).
 *
 * Git: the app folder must be a Git working copy with nothing uncommitted and
 * its commit pushed to the upstream branch (GitHub), so every published build
 * exists on GitHub. The commit goes into the signed manifest, and the commit
 * is tagged build-<N> and the tag pushed. A build-<N> tag on another commit
 * is refused. --no-git skips all of this (tests, emergencies).
 *
 * Retire (remote removal):
 *   node tools/publish-release.js --retire [--message "text"] [--users name,name@PC]
 * writes <dest>\releases\retire.json, signed with the same key. Installed
 * copies then uninstall themselves (backups are never touched): on their next
 * start, or within about a minute while running (the page says why first).
 * --users limits it to those Windows users (user or user@host); without it,
 * every install is removed. New installs are refused while it exists.
 *   node tools/publish-release.js --unretire     removes retire.json again
 * Copies that were already removed must be installed again.
 *
 * Options: --root <app folder> (default this repo), --public-key <pem> (default
 * launcher/release-public-key.pem), --runtime <node.exe> (default the node
 * running this script). Passphrase: asked, or env FANUCSTUDIO_KEY_PASSPHRASE.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { askSecret } = require('./release-common.js');

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const ROOT = path.resolve(opt('root', path.join(__dirname, '..')));
const DEST = path.resolve(opt('dest', 'S:\\zz_Resources\\FanucStudio'));
const KEY_FILE = path.resolve(opt('key', path.join(os.homedir(), '.fanucstudio', 'release-signing-key.pem')));
const PUB_FILE = path.resolve(opt('public-key', path.join(__dirname, '..', 'launcher', 'release-public-key.pem')));
const RUNTIME = path.resolve(opt('runtime', process.execPath));
const SHARED_RUNTIME = opt('shared-runtime', 'S:\\zz_Resources\\CellStudio\\releases\\runtime');
const LAUNCHER_DIR = path.join(__dirname, '..', 'launcher');
const RELEASES = path.join(DEST, 'releases');
const NO_GIT = argv.includes('--no-git');
const RETIRE = argv.includes('--retire'), UNRETIRE = argv.includes('--unretire');

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
  if (r.error) throw new Error('git could not run: ' + r.error.message);
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
/* Every published build must exist on GitHub: clean tree, commit pushed. */
function gitState(build) {
  if (!git(['rev-parse', '--is-inside-work-tree']).ok) die(ROOT + ' is not a Git working copy (use --no-git to publish anyway)');
  const dirty = git(['status', '--porcelain']).out;
  if (dirty) die('uncommitted changes; commit and push them first:\n' + dirty.split('\n').slice(0, 15).join('\n'));
  const commit = git(['rev-parse', 'HEAD']).out;
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!upstream.ok) die('the current branch has no upstream on GitHub; push it first (git push -u origin <branch>)');
  const remote = upstream.out.split('/')[0];
  const f = git(['fetch', '-q', remote]);
  if (!f.ok) die('could not reach ' + remote + ' to check the commit is pushed: ' + f.err);
  if (!git(['merge-base', '--is-ancestor', 'HEAD', '@{u}']).ok) die('commit ' + commit.slice(0, 7) + ' is not pushed to ' + upstream.out + '; run git push first');
  const tag = 'build-' + build;
  const tagged = git(['rev-parse', '-q', '--verify', 'refs/tags/' + tag + '^{commit}']);
  if (tagged.ok && tagged.out !== commit) die('tag ' + tag + ' already marks commit ' + tagged.out.slice(0, 7) + ', not ' + commit.slice(0, 7) + '. Bump js/version.js for a new build.');
  return { commit, tag, tagExists: tagged.ok, remote, url: git(['remote', 'get-url', remote]).out };
}

/* What the bridge serves and runs; the same set tools/build-release.js ships,
 * minus the docs and the unmanaged-copy start scripts (the installed copy
 * starts through _launcher). */
const APP_FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'server.js', 'dac-standard.json', 'FANUC Studio.ico'];
const APP_FOLDERS = ['css', 'icons', 'js', 'lib'];
const LAUNCHER_FILES = ['launcher.js', 'Start FanucStudio.bat', 'Start FanucStudio hidden.vbs', 'Open FanucStudio.vbs'];
const SAFE_PATH = /^[A-Za-z0-9_][A-Za-z0-9._ ()-]*(\/[A-Za-z0-9_][A-Za-z0-9._ ()-]*)*$/;

const sha256 = (d) => crypto.createHash('sha256').update(d).digest('hex');
const die = (msg) => { console.error('Not published: ' + msg); process.exit(1); };

function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel + '/' + e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

async function loadKey() {
  if (!fs.existsSync(KEY_FILE)) die('no signing key at ' + KEY_FILE + '. Run: node tools/release-keygen.js');
  if (!fs.existsSync(PUB_FILE)) die('no public key at ' + PUB_FILE + '. Run: node tools/release-keygen.js');
  let privateKey;
  const pem = fs.readFileSync(KEY_FILE, 'utf8');
  try { privateKey = crypto.createPrivateKey(pem); }
  catch (e) {
    const passphrase = process.env.FANUCSTUDIO_KEY_PASSPHRASE !== undefined ? process.env.FANUCSTUDIO_KEY_PASSPHRASE : await askSecret('Signing key passphrase: ');
    try { privateKey = crypto.createPrivateKey({ key: pem, passphrase }); } catch (e2) { die('the passphrase is wrong or the key file is damaged'); }
  }
  const pubPem = fs.readFileSync(PUB_FILE, 'utf8');
  if (crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).trim() !== crypto.createPublicKey(pubPem).export({ type: 'spki', format: 'pem' }).trim()) {
    die(PUB_FILE + ' does not belong to this signing key; installed launchers would refuse the release');
  }
  return privateKey;
}

async function retire() {
  const file = path.join(RELEASES, 'retire.json');
  if (UNRETIRE) {
    if (!fs.existsSync(file)) { console.log('No retire.json in ' + RELEASES + '; nothing to undo.'); return; }
    fs.unlinkSync(file);
    console.log('Removed ' + file + '. Installs that still exist keep running; removed ones must run Install FanucStudio.bat again.');
    return;
  }
  if (!fs.existsSync(path.join(RELEASES, 'latest.json'))) die('no releases in ' + RELEASES);
  const privateKey = await loadKey();
  const users = (opt('users', '') || '').split(',').map((x) => x.trim()).filter(Boolean);
  const notice = { format: 1, app: 'FanucStudio', kind: 'retire', created: new Date().toISOString(), publishedBy: os.userInfo().username + '@' + os.hostname(),
    message: opt('message', '') || '', users: users.length ? users : null };
  const payload = JSON.stringify(notice, null, 1);
  const envelope = JSON.stringify({ payload, signature: crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64') }, null, 1);
  fs.writeFileSync(file + '.tmp', envelope);
  fs.renameSync(file + '.tmp', file);
  console.log('Wrote ' + file + ' (' + (users.length ? 'users: ' + users.join(', ') : 'every user') + ').');
  console.log('Installs remove themselves on their next start, or within about a minute while running.');
  console.log('Undo with: node tools/publish-release.js --unretire');
}

(async () => {
  if (RETIRE || UNRETIRE) return retire();
  const ver = /FANUC_STUDIO_BUILD\s*=\s*'build (\d+)'/.exec(fs.readFileSync(path.join(ROOT, 'js', 'version.js'), 'utf8'));
  if (!ver) die('no build number in js/version.js');
  const build = parseInt(ver[1], 10);
  const gitInfo = NO_GIT ? null : gitState(build);
  const privateKey = await loadKey();

  /* release path -> source file */
  const sources = {};
  for (const f of APP_FILES) sources[f] = path.join(ROOT, f);
  for (const d of APP_FOLDERS) for (const r of walk(path.join(ROOT, d), d, [])) sources[r] = path.join(ROOT, ...r.split('/'));
  for (const f of LAUNCHER_FILES) sources['_launcher/' + f] = path.join(LAUNCHER_DIR, f);
  sources['_launcher/release-public-key.pem'] = PUB_FILE;
  const files = {}, contents = {};
  for (const rel of Object.keys(sources).sort()) {
    if (!SAFE_PATH.test(rel)) die('file name the launcher would refuse: ' + rel);
    let data;
    try { data = fs.readFileSync(sources[rel]); } catch (e) { die('missing ' + sources[rel]); }
    contents[rel] = data;
    files[rel] = { sha256: sha256(data), size: data.length };
  }

  const nodeVer = spawnSync(RUNTIME, ['--version'], { encoding: 'utf8' }).stdout.trim();
  if (!/^v\d+\.\d+\.\d+$/.test(nodeVer)) die('could not run the runtime ' + RUNTIME);
  const nodeData = fs.readFileSync(RUNTIME);
  const runtime = { version: nodeVer, path: 'runtime/' + nodeVer + '/node.exe', sha256: sha256(nodeData), size: nodeData.length };
  /* One node.exe on the share for both apps: when CellStudio already
   * published this exact file, name its copy (relative to releases\, so the
   * installers keep working when S: is mapped elsewhere) instead of copying
   * another. The launcher checks size + sha256 before using it either way. */
  let sharedRuntime = false;
  if (SHARED_RUNTIME && SHARED_RUNTIME.toLowerCase() !== 'none') {
    const cand = path.join(path.resolve(SHARED_RUNTIME), nodeVer, 'node.exe');
    const rel = path.relative(RELEASES, cand).split(path.sep).join('/');
    let same = false;
    try { const d = fs.readFileSync(cand); same = d.length === runtime.size && sha256(d) === runtime.sha256; } catch (e) { /* not published there */ }
    if (same && !path.isAbsolute(rel) && /^(\.\.\/)*[A-Za-z0-9_][A-Za-z0-9._ ()-]*(\/[A-Za-z0-9_][A-Za-z0-9._ ()-]*)*$/.test(rel)) {
      runtime.path = rel;
      sharedRuntime = true;
    }
  }

  const manifest = {
    format: 1, app: 'FanucStudio', build, version: 'build ' + build,
    created: new Date().toISOString(), publishedBy: os.userInfo().username + '@' + os.hostname(),
    git: gitInfo ? { commit: gitInfo.commit, tag: gitInfo.tag, url: gitInfo.url } : null,
    runtime, files
  };
  const payload = JSON.stringify(manifest, null, 1);
  const envelope = JSON.stringify({ payload, signature: crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64') }, null, 1);

  fs.mkdirSync(RELEASES, { recursive: true });
  /* Refuse to republish a build number with other files. */
  const buildDir = path.join(RELEASES, String(build));
  if (fs.existsSync(buildDir)) {
    let same = false;
    try { const old = JSON.parse(JSON.parse(fs.readFileSync(path.join(buildDir, 'release.sig.json'), 'utf8')).payload); same = JSON.stringify(old.files) === JSON.stringify(files); } catch (e) { /* damaged */ }
    if (!same) die('build ' + build + ' is already published with different files. Bump js/version.js and publish again.');
    console.log('Build ' + build + ' is already published with these files.');
  } else {
    const tmp = buildDir + '.tmp-' + process.pid;
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const rel of Object.keys(contents)) {
      const t = path.join(tmp, ...rel.split('/'));
      fs.mkdirSync(path.dirname(t), { recursive: true });
      fs.writeFileSync(t, contents[rel]);
    }
    fs.writeFileSync(path.join(tmp, 'release.sig.json'), envelope);
    fs.renameSync(tmp, buildDir);
    console.log('Copied build ' + build + ' (' + Object.keys(files).length + ' files) to ' + buildDir);
  }

  /* The manifest that latest.json will carry: this one, or the identical
   * build published before (its runtime entry is the one installs use). */
  const used = JSON.parse(JSON.parse(fs.readFileSync(path.join(buildDir, 'release.sig.json'), 'utf8')).payload);
  const rtFile = path.join(RELEASES, ...used.runtime.path.split('/'));
  let rtOk = false;
  try { rtOk = sha256(fs.readFileSync(rtFile)) === used.runtime.sha256; } catch (e) { /* not there yet */ }
  if (rtOk && sharedRuntime && used.runtime.path === runtime.path) {
    console.log('Runtime ' + nodeVer + ': using CellStudio\'s copy (' + rtFile + ')');
  } else if (!rtOk && used.runtime.path.startsWith('../')) {
    die('build ' + build + ' names the runtime ' + rtFile + ', which is missing or changed');
  } else if (!rtOk) {
    if (used.runtime.sha256 !== runtime.sha256) die('build ' + build + ' was published with another node.exe (' + used.runtime.version + '); bump js/version.js');
    fs.mkdirSync(path.dirname(rtFile), { recursive: true });
    fs.writeFileSync(rtFile + '.tmp', nodeData);
    fs.renameSync(rtFile + '.tmp', rtFile);
    console.log('Copied runtime ' + nodeVer);
  }

  /* latest.json last; never moves to an older build. */
  const latest = path.join(RELEASES, 'latest.json');
  let current = 0;
  try { current = JSON.parse(JSON.parse(fs.readFileSync(latest, 'utf8')).payload).build; } catch (e) { /* first release */ }
  if (current > build) {
    console.log('latest.json stays at build ' + current + ' (newer than ' + build + ').');
  } else {
    const usedEnvelope = fs.readFileSync(path.join(buildDir, 'release.sig.json'), 'utf8');
    fs.writeFileSync(latest + '.tmp', usedEnvelope);
    fs.renameSync(latest + '.tmp', latest);
    const installer = path.join(DEST, 'Install FanucStudio.bat');
    const bat = [
      '@echo off',
      'rem One-time FanucStudio install for this Windows user (no admin). Written by',
      'rem tools/publish-release.js for build ' + build + '. After installing, FanucStudio',
      'rem updates itself from this folder each time it starts.',
      'title Install FanucStudio',
      '"%~dp0releases\\' + used.runtime.path.replace(/\//g, '\\') + '" "%~dp0releases\\' + build + '\\_launcher\\launcher.js" --install --source "%~dp0releases" & pause & exit /b',
      ''
    ].join('\r\n');
    fs.writeFileSync(installer + '.tmp', bat);
    fs.renameSync(installer + '.tmp', installer);
    const uninstaller = path.join(DEST, 'Uninstall FanucStudio.bat');
    const ubat = [
      '@echo off',
      'rem Removes FanucStudio from this Windows user: stops it, deletes the shortcuts,',
      'rem the fanucstudio:// link and %LOCALAPPDATA%\\FanucStudio. Robot backups are',
      'rem never touched. Written by tools/publish-release.js for build ' + build + '.',
      'title Uninstall FanucStudio',
      'choice /m "Remove FanucStudio from this PC"',
      'if errorlevel 2 exit /b',
      '"%~dp0releases\\' + used.runtime.path.replace(/\//g, '\\') + '" "%~dp0releases\\' + build + '\\_launcher\\launcher.js" --uninstall & pause & exit /b',
      ''
    ].join('\r\n');
    fs.writeFileSync(uninstaller + '.tmp', ubat);
    fs.renameSync(uninstaller + '.tmp', uninstaller);
    console.log('latest.json now offers build ' + build + '. Installed copies update on their next start.');
    console.log('New users: run ' + installer);
  }
  if (gitInfo) {
    if (!gitInfo.tagExists) {
      const t = git(['tag', '-a', gitInfo.tag, '-m', 'FanucStudio build ' + build + ' (published to ' + buildDir + ')']);
      if (!t.ok) { console.warn('Published, but tagging failed: ' + t.err); return; }
    }
    const p = git(['push', '-q', gitInfo.remote, 'refs/tags/' + gitInfo.tag]);
    console.log(p.ok ? 'Tagged ' + gitInfo.commit.slice(0, 7) + ' as ' + gitInfo.tag + ' on ' + gitInfo.remote + '.' : 'Published and tagged ' + gitInfo.tag + ', but pushing the tag failed: ' + p.err + ' (run git push ' + gitInfo.remote + ' ' + gitInfo.tag + ')');
  }
})().catch((e) => die(e.message));
