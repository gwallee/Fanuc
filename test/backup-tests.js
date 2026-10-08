#!/usr/bin/env node
/* Integration tests for backups: the home folder setting, a single-robot
 * backup, and the back-up-every-robot sweep.
 *
 * These cannot be unit tests — the thing worth proving is that the bridge
 * really pulls files off a controller over FTP and files them under the
 * right name. So test/mock-ftp.js stands in for the robot, the real bridge
 * is started on a spare port, and the real HTTP endpoints are driven end to
 * end.
 *
 * The bridge under test is pointed at a scratch state directory with
 * FANUC_STUDIO_STATE, so the robot list and settings someone actually uses
 * are untouchable from here — not merely put back afterwards, which is no
 * protection at all if the run is interrupted.
 *
 * Run: node test/backup-tests.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { startMockFtp } = require('./mock-ftp.js');

const ROOT = path.join(__dirname, '..');
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'fanuc-state-'));
const SETTINGS = path.join(STATE, 'settings.json');
const ROBOTS = path.join(STATE, 'robots.json');
const PORT = 8791;
const FTP_PORT = 2141;          // clear of server-tests.js's 2131
const ROBOT = '127.0.0.1:' + FTP_PORT;
const DEAD = '127.0.0.1:9';     // nothing listens on discard

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.error('FAIL  ' + msg); }
}

/* ---- driving the bridge ---- */
function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length }
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: out }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, text: out }));
    }).on('error', reject);
  });
}

const ndjson = (text) => text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

function waitForBridge(tries) {
  return get('/api/ping').then((r) => {
    if (r.status !== 200) throw new Error('ping ' + r.status);
  }).catch((e) => {
    if (tries <= 0) throw e;
    return new Promise((r) => setTimeout(r, 150)).then(() => waitForBridge(tries - 1));
  });
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fanuc-backup-test-'));
  const robot = await startMockFtp(FTP_PORT, {
    'MAIN.LS': '/PROG MAIN\r\n/END\r\n',
    'PICK.LS': '/PROG PICK\r\n/END\r\n',
    'NUMREG.VA': "[1] = 5 'count'\r\n",
    'SUMMARY.DG': 'Robot Name: TESTBOT\r\n'
  }, { unreadable: ['SHREWD.DG'] });   // listed, then refused on RETR
  const bridge = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { FANUC_STUDIO_STATE: STATE }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  bridge.stderr.on('data', (d) => {
    const s = d.toString();
    if (!/\[api 4\d\d\]/.test(s)) process.stderr.write('  [bridge] ' + s);
  });

  try {
    /* The saved list is what a sweep works from, so it is seeded directly —
     * this test is about backups, not about scanning. */
    fs.writeFileSync(ROBOTS, JSON.stringify([
      { ip: ROBOT, name: null, ftpUser: null, lastSeen: null },
      { ip: DEAD, name: 'POWERED-OFF', ftpUser: null, lastSeen: null }
    ], null, 2));
    fs.writeFileSync(SETTINGS, '{}');
    await waitForBridge(40);

    console.log('\n-- home folder --');
    let r = JSON.parse((await get('/api/settings')).text);
    check(r.isDefault === true && /backups$/.test(r.backupRoot),
      'unset, backups go to the bridge’s own backups folder (' + r.backupRoot + ')');

    const bad = await post('/api/settings', { backupRoot: path.join(home, 'MAIN.LS-not-a-folder', 'x') });
    // a path under a FILE cannot be created, which is the realistic failure
    fs.writeFileSync(path.join(home, 'afile'), 'x');
    const bad2 = await post('/api/settings', { backupRoot: path.join(home, 'afile', 'under-a-file') });
    check(bad2.status === 400 && /cannot create/.test(JSON.parse(bad2.text).error),
      'a folder that cannot be created is refused, not saved and hoped for');
    check(bad.status === 400 || bad.status === 200,
      'a deep new path is either created or refused, never a crash');

    r = JSON.parse((await post('/api/settings', { backupRoot: home })).text);
    check(r.backupRoot === fs.realpathSync(home) || r.backupRoot === path.resolve(home),
      'a real folder is accepted and echoed back resolved');
    check(r.isDefault === false && r.error === null, 'and it reports itself writable');
    r = JSON.parse((await get('/api/settings')).text);
    check(r.backupRoot === path.resolve(home), 'the home folder survives a re-read — set once, remembered');

    console.log('\n-- one robot, no dest given --');
    r = JSON.parse((await post('/api/robot/backup', { ip: ROBOT })).text);
    check(r.ok === true, 'the backup ran');
    check(path.dirname(r.folder) === path.resolve(home),
      'and landed in the home folder without the caller naming it: ' + r.folder);
    const today = new Date().toISOString().slice(0, 10);
    check(new RegExp('_' + today + '_01$').test(r.folder),
      'folder is <name>_<date>_01 — the date and counter the old batch script wrote by hand');
    check(r.files === 4, 'all four readable files came across (got ' + r.files + ')');
    check(r.failed.length === 1 && r.failed[0] === 'SHREWD.DG',
      'the file the controller refused is reported, and did not abandon the rest');
    const got = fs.readdirSync(r.folder).sort();
    check(got.join(',') === 'MAIN.LS,NUMREG.VA,PICK.LS,SUMMARY.DG',
      'the files are really on disk, upper-cased: ' + got.join(', '));
    check(fs.readFileSync(path.join(r.folder, 'MAIN.LS'), 'utf8') === '/PROG MAIN\r\n/END\r\n',
      'MAIN.LS came across byte for byte, CRLF included');

    const r2 = JSON.parse((await post('/api/robot/backup', { ip: ROBOT })).text);
    check(new RegExp('_' + today + '_02$').test(r2.folder),
      'a second backup the same day increments to _02 rather than overwriting: ' + path.basename(r2.folder));

    const rq = JSON.parse((await post('/api/robot/backup', { ip: ROBOT, mode: 'quick' })).text);
    check(/_quick$/.test(rq.folder), 'a quick backup is suffixed _quick');
    check(fs.readdirSync(rq.folder).sort().join(',') === 'MAIN.LS,NUMREG.VA,PICK.LS',
      'and holds only .LS + .VA — SUMMARY.DG is left behind');

    console.log('\n-- a folder of this robot’s own --');
    const cell = path.join(home, '827-039 Wire Stripper', 'Robot');
    let fr = await post('/api/robots/folder', { ip: ROBOT, folder: cell });
    check(fr.status === 200, 'a per-robot folder is accepted');
    check(fs.existsSync(cell), 'and created — a project folder that is not there yet is not an error');
    check(JSON.parse(fr.text).robots.find((x) => x.ip === ROBOT).folder === cell,
      'the robot list comes back carrying it');

    const own = JSON.parse((await post('/api/robot/backup', { ip: ROBOT, mode: 'quick' })).text);
    check(path.dirname(own.folder) === cell,
      'its backup now goes to ITS folder, not the home folder: ' + own.folder);
    check(new RegExp('_' + today + '_01_quick$').test(own.folder),
      'and starts its own _01 there — the counter is per folder, not global: ' + path.basename(own.folder));

    /* Reconnecting is the moment a naive implementation would lose this:
     * /api/robots/remember rebuilds the entry from scratch. */
    await post('/api/robots/remember', { ip: ROBOT, name: 'DECANT' });
    check(JSON.parse(fs.readFileSync(ROBOTS, 'utf8')).find((x) => x.ip === ROBOT).folder === cell,
      'reconnecting to the robot does not clear the folder it was given');

    const badFolder = await post('/api/robots/folder', { ip: ROBOT, folder: path.join(home, 'afile', 'x') });
    check(badFolder.status === 400, 'a folder that cannot be created is refused for a robot too');
    check(JSON.parse(fs.readFileSync(ROBOTS, 'utf8')).find((x) => x.ip === ROBOT).folder === cell,
      'and the refusal left the working folder in place');

    console.log('\n-- every robot in one sweep, each to its own folder --');
    const bulk = await post('/api/robots/backup-all', { ips: [ROBOT, DEAD], mode: 'quick' });
    check(bulk.status === 200, 'the sweep streamed a 200');
    const evs = ndjson(bulk.text);
    const start = evs.find((e) => e.type === 'start');
    const doneEv = evs.find((e) => e.type === 'done');
    check(start && start.total === 2 && start.dests === 2,
      'it opens by naming the robot count and how many distinct folders they go to');
    const announce = evs.filter((e) => e.type === 'robot');
    check(announce.length === 2, 'both robots were announced, so the UI can say which one it is on');
    check(announce.find((e) => e.ip === ROBOT).dest === cell,
      'each announcement carries that robot’s own destination');
    check(announce.find((e) => e.ip === DEAD).dest === path.resolve(home),
      'and a robot with no folder of its own falls back to the home folder');
    check(evs.some((e) => e.type === 'file' && e.total === 3),
      'per-file progress carries a real denominator');
    const okDone = evs.find((e) => e.type === 'robotDone' && e.ip === ROBOT);
    const offDone = evs.find((e) => e.type === 'robotDone' && e.ip === DEAD);
    check(okDone && okDone.ok === true && okDone.files === 3, 'the live robot reports its own folder and count');
    check(offDone && offDone.skipped === true && /powered down/.test(offDone.error),
      'the dead one is skipped with a reason a person can act on: ' + (offDone && offDone.error));
    check(doneEv && doneEv.ok === 1 && doneEv.skipped === 1 && doneEv.failed === 0,
      'the tally adds up: 1 backed up, 1 skipped, 0 failed');
    check(doneEv && doneEv.dests.length === 2 && doneEv.dests.indexOf(cell) !== -1,
      'and it names every folder it wrote into, for the "filed into" line');
    check(fs.existsSync(okDone.folder) && path.dirname(okDone.folder) === cell,
      'the sweep really wrote into the robot’s own folder');

    const list = JSON.parse(fs.readFileSync(ROBOTS, 'utf8'));
    const entry = list.find((x) => x.ip === ROBOT);
    check(entry && entry.lastSeen, 'a completed backup refreshes lastSeen — it is the best proof of reach there is');
    check(!list.find((x) => x.ip === DEAD).lastSeen,
      'and the skipped robot is NOT marked as seen');

    console.log('\n-- clearing a robot’s folder --');
    await post('/api/robots/folder', { ip: ROBOT, folder: '' });
    check(JSON.parse(fs.readFileSync(ROBOTS, 'utf8')).find((x) => x.ip === ROBOT).folder === null,
      'a blank folder puts the robot back on the home folder');
    const backHome = JSON.parse((await post('/api/robot/backup', { ip: ROBOT, mode: 'quick' })).text);
    check(path.dirname(backHome.folder) === path.resolve(home), 'and its next backup goes there again');

    console.log('\n-- the sweep refuses what it cannot do --');
    check((await post('/api/robots/backup-all', { ips: [] })).status === 400, 'an empty list is refused');
    const badIp = await post('/api/robots/backup-all', { ips: ['not a host!'] });
    check(badIp.status === 400 && /invalid ip/.test(JSON.parse(badIp.text).error),
      'a bad address is refused before any robot is touched');
    const badDest = await post('/api/robots/backup-all', { ips: [ROBOT], dest: path.join(home, 'afile', 'nope') });
    check(badDest.status === 400, 'an unwritable dest fails up front, not eight transfers in');

    console.log('\n-- browsing the bridge’s folders --');
    const places = JSON.parse((await get('/api/fs/dirs')).text);
    check(Array.isArray(places.places) && places.places.length > 0,
      'with no path it offers somewhere to start (' + places.places.length + ' places)');
    check(places.places.some((p) => p.path === path.resolve(home)),
      'and the home folder is one of them, since that is where someone is heading');
    const walk = JSON.parse((await get('/api/fs/dirs?path=' + encodeURIComponent(home))).text);
    check(walk.path === path.resolve(home) && walk.dirs.indexOf('827-039 Wire Stripper') !== -1,
      'a folder lists its subfolders: ' + walk.dirs.join(', '));
    check(walk.dirs.indexOf('afile') === -1, 'files are not offered as folders');
    check(walk.parent && walk.parent !== walk.path, 'and there is a way back up');
    check((await get('/api/fs/dirs?path=' + encodeURIComponent(path.join(home, 'nope-not-here')))).status === 400,
      'a folder that is not there is a plain 400, not a crash');
  } finally {
    bridge.kill();
    robot.close();
    console.log('\n(scratch state in ' + STATE + '; test backups in ' + home + ')');
  }
}

main().then(() => {
  console.log('');
  if (failures) {
    console.error(failures + ' test(s) failed');
    process.exit(1);
  }
  console.log('All backup tests passed.');
}).catch((e) => {
  console.error('\nbackup tests could not run: ' + (e && e.stack || e));
  process.exit(1);
});
