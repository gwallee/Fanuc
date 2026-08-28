#!/usr/bin/env node
/* Integration tests for the bridge server's FTP features against a mock
 * FANUC controller. Run: node test/server-tests.js
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { startMockFtp } = require('./mock-ftp.js');

const APP_PORT = 8653;
const FTP_PORT = 2131;
const BASE = 'http://127.0.0.1:' + APP_PORT;
const ROBOT = '127.0.0.1:' + FTP_PORT;

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.error('FAIL  ' + msg); }
}

async function post(route, body) {
  const r = await fetch(BASE + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.json();
}

(async () => {
  const files = {
    'MAIN.LS': '/PROG MAIN\n/MN\n   1:  R[1]=1 ;\n/END\n',
    'PICK.LS': '/PROG PICK\n/MN\n   1:  R[2]=2 ;\n/END\n',
    'NUMREG.VA': "[1] = 0  'count'\n"
  };
  const ftpServer = await startMockFtp(FTP_PORT, files);
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), String(APP_PORT)], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));

  try {
    console.log('\n-- robot list via FTP fallback --');
    let r = await fetch(BASE + '/api/robot/list?ip=' + ROBOT).then((x) => x.json());
    check(r.via === 'ftp', 'listing fell back to FTP (HTTP not available on mock)');
    check(r.files.includes('MAIN.LS') && r.files.includes('NUMREG.VA'), 'NLST names returned: ' + r.files.join(', '));

    console.log('\n-- robot file via FTP fallback --');
    r = await fetch(BASE + '/api/robot/file?ip=' + ROBOT + '&name=MAIN.LS').then((x) => x.json());
    check(r.via === 'ftp' && r.content.includes('R[1]=1'), 'RETR MAIN.LS content correct');

    console.log('\n-- safe upload: happy path --');
    const newSrc = '/PROG MAIN\n/MN\n   1:  R[1]=99 ;\n/END\n';
    r = await post('/api/robot/upload', { ip: ROBOT, name: 'MAIN.LS', content: newSrc });
    check(r.ok === true && r.verified === true, 'upload verified ok');
    check(files['MAIN.LS'] === newSrc, 'robot now has the new content');
    check(r.snapshot && fs.existsSync(r.snapshot), 'pre-upload snapshot saved: ' + r.snapshot);
    check(r.snapshot && fs.readFileSync(r.snapshot, 'utf8').includes('R[1]=1'), 'snapshot holds the PREVIOUS version');

    console.log('\n-- safe upload: translation failure deletes program, we auto-restore --');
    const before = files['PICK.LS'];
    r = await post('/api/robot/upload', { ip: ROBOT, name: 'PICK.LS', content: '/PROG PICK\n/MN\n   1:  BADSYNTAX ;\n/END\n' });
    check(r.ok === false, 'upload reported as failed');
    check(/GONE|deleted|rejected/i.test(r.error || ''), 'error explains the program vanished: ' + r.error);
    check(r.restored === true, 'previous version auto-restored on the robot');
    check(files['PICK.LS'] === before, 'robot content is byte-identical to before the failed upload');

    console.log('\n-- safe upload: new program that fails has nothing to restore --');
    r = await post('/api/robot/upload', { ip: ROBOT, name: 'NEWPROG.LS', content: '/PROG NEWPROG\n/MN\n   1:  BADSYNTAX ;\n/END\n' });
    check(r.ok === false && !r.restored && !r.snapshot, 'failure reported, no snapshot (program was new)');
    check(!('NEWPROG.LS' in files), 'nothing left behind on the robot');

    console.log('\n-- backup with date + incremental suffix --');
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'fanuc-bk-'));
    const b1 = await post('/api/robot/backup', { ip: ROBOT, dest });
    check(b1.ok && b1.files === Object.keys(files).length, 'backup pulled all ' + b1.files + ' files');
    const today = new Date().toISOString().slice(0, 10);
    check(path.basename(b1.folder) === ROBOT.replace(/[:.]/g, '-') + '_' + today + '_01', 'folder named <ip>_<date>_01: ' + path.basename(b1.folder));
    check(fs.readFileSync(path.join(b1.folder, 'MAIN.LS'), 'utf8') === files['MAIN.LS'], 'backup file content matches robot');
    const b2 = await post('/api/robot/backup', { ip: ROBOT, dest });
    check(path.basename(b2.folder).endsWith('_02'), 'second backup today increments to _02: ' + path.basename(b2.folder));

    console.log('\n-- device-root controller (real FANUC layout: fr:/mc:/md:...) --');
    const drFiles = { 'MAIN.LS': '/PROG MAIN\n/MN\n   1:  R[1]=7 ;\n/END\n', 'NUMREG.VA': "[1] = 7  'x'\n" };
    const drServer = await startMockFtp(FTP_PORT + 1, drFiles, { deviceRoot: true });
    const DR = '127.0.0.1:' + (FTP_PORT + 1);
    let dr = await fetch(BASE + '/api/robot/list?ip=' + DR).then((x) => x.json());
    check(dr.via === 'ftp' && dr.files.includes('MAIN.LS'), 'listing enters md: automatically: ' + dr.files.join(', '));
    check(!dr.files.some((f) => /^(FR|MC|RD|UD1|UT1):/.test(f)), 'device names not mistaken for files');
    dr = await fetch(BASE + '/api/robot/file?ip=' + DR + '&name=MAIN.LS').then((x) => x.json());
    check(dr.content && dr.content.includes('R[1]=7'), 'RETR works behind md:');
    dr = await post('/api/robot/upload', { ip: DR, name: 'MAIN.LS', content: '/PROG MAIN\n/MN\n   1:  R[1]=8 ;\n/END\n' });
    check(dr.ok === true && drFiles['MAIN.LS'].includes('R[1]=8'), 'safe upload works behind md:');
    drServer.close();

    console.log('\n-- quick backup (.LS + .VA only) --');
    files['SYSMAST.SV'] = 'binary-ish system file';
    files['MAIN.TP'] = 'binary tp';
    const b3 = await post('/api/robot/backup', { ip: ROBOT, dest, mode: 'quick' });
    check(b3.ok && b3.mode === 'quick', 'quick backup ran');
    check(path.basename(b3.folder).endsWith('_03_quick'), 'quick folder continues the counter with _quick suffix: ' + path.basename(b3.folder));
    const got = fs.readdirSync(b3.folder).sort();
    check(got.every((f) => /\.(LS|VA)$/i.test(f)) && got.includes('MAIN.LS') && got.includes('NUMREG.VA'),
      'quick backup contains only .LS/.VA: ' + got.join(', '));
    check(!got.includes('SYSMAST.SV') && !got.includes('MAIN.TP'), '.SV/.TP files skipped');
  } catch (e) {
    failures++;
    console.error('FAIL  unexpected error: ' + (e.stack || e.message));
  } finally {
    srv.kill();
    ftpServer.close();
  }

  console.log('');
  if (failures) { console.error(failures + ' server test(s) failed'); process.exit(1); }
  console.log('All server tests passed.');
  process.exit(0); // mock FTP data listeners would otherwise hold the loop open
})();
