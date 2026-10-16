#!/usr/bin/env node
/* Integration tests for the bridge's HTTP path to a controller, against the
 * mock web server in mock-http.js: listing and reading files, the comment
 * write with its read-back proof, the scanner's identity check, a
 * controller that drops a connection mid-file, the static app server, and
 * stopping the bridge from its own PC.   Run: node test/http-tests.js
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { startMockHttp } = require('./mock-http.js');

const APP_PORT = 8657;
const HTTP_PORT = 8080 + 57;
const BASE = 'http://127.0.0.1:' + APP_PORT;
const ROBOT = '127.0.0.1';

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.error('FAIL  ' + msg); }
}
async function get(route) { return fetch(BASE + route).then((r) => r.json()); }
async function post(route, body) {
  const r = await fetch(BASE + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}
function timed(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('still waiting after ' + ms + 'ms')), ms))]);
}

(async () => {
  const files = {
    'MAIN.LS': '/PROG MAIN\n/MN\n   1:  R[1:count]=1 ;\n/END\n',
    'PICK.LS': '/PROG PICK\n/MN\n   1:  R[2]=2 ;\n/END\n',
    'NUMREG.VA': "[1] = 0  'count'\n[2] = 5  'parts'\n",
    'SUMMARY.DG': 'Host name: MOCKBOT\nF-Number: F123456\nSoftware Version: V9.40P/01\n'
  };
  const mock = await startMockHttp(HTTP_PORT, files);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanuc-http-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), String(APP_PORT)], {
    stdio: 'ignore',
    env: Object.assign({}, process.env, { FANUC_STUDIO_ROBOT_HTTP_PORT: String(HTTP_PORT), FANUC_STUDIO_STATE: stateDir })
  });
  const exited = new Promise((r) => srv.on('exit', (code) => r(code)));
  await new Promise((r) => setTimeout(r, 600));

  try {
    console.log('\n-- static app server --');
    let r = await fetch(BASE + '/');
    check(r.status === 200 && /text\/html/.test(r.headers.get('content-type')) && /FANUC TP Program Studio/.test(await r.text()), 'GET / serves the app shell');
    r = await fetch(BASE + '/js/app.js');
    check(r.status === 200 && /javascript/.test(r.headers.get('content-type')), 'GET /js/app.js served as JavaScript');
    r = await fetch(BASE + '/nothing-here.html');
    check(r.status === 404, 'a missing file is a 404');
    const ping = await get('/api/ping');
    check(ping.ok === true && ping.local === true, '/api/ping answers and knows the caller is local');

    console.log('\n-- robot list and files over HTTP --');
    r = await get('/api/robot/list?ip=' + ROBOT);
    check(r.via === 'http', 'listing came over HTTP, not the FTP fallback');
    check(r.files.includes('MAIN.LS') && r.files.includes('NUMREG.VA') && r.files.includes('SUMMARY.DG'), 'hrefs scraped from the MD: page: ' + r.files.join(', '));
    r = await get('/api/robot/file?ip=' + ROBOT + '&name=MAIN.LS');
    check(r.via === 'http' && r.content.startsWith('/PROG MAIN'), 'file read over HTTP and unwrapped from the iPendant page');
    check(!/<XMP>/i.test(r.content), 'no page markup left in the stored source');
    r = await get('/api/robot/file?ip=' + ROBOT + '&name=NOPE.LS');
    check(r.error && /HTTP: .*404.*FTP:/.test(r.error), 'a missing file reports both the HTTP and the FTP failure: ' + r.error);

    console.log('\n-- a controller that drops the connection mid-file --');
    const t0 = Date.now();
    r = await timed(get('/api/robot/file?ip=' + ROBOT + '&name=HANG.LS'), 8000).catch((e) => ({ error: e.message }));
    check(r.error && !/still waiting/.test(r.error), 'the request settles with an error instead of hanging (' + (Date.now() - t0) + 'ms): ' + r.error);

    console.log('\n-- comment write through the controller\'s own ComSet, with read-back --');
    r = await post('/api/robot/comment', { ip: ROBOT, type: 'R', index: 1, text: 'cycle count' });
    check(r.ok === true && r.verified === true && r.stored === 'cycle count', 'rename landed and the read-back proves it');
    check(mock.hits.some((h) => /^\/karel\/ComSet\?sComment=cycle%20count&sIndx=1&sFc=1$/.test(h)), 'the write was the controller\'s own GET with its function code');
    r = await post('/api/robot/comment', { ip: ROBOT, type: 'UI', index: 1, text: 'x' });
    check(r.error && /no comment write/.test(r.error), 'a type the controller cannot rename is refused before anything is sent');
    r = await post('/api/robot/comment', { ip: ROBOT, type: 'R', index: 2, text: 'this name is far too long for a register' });
    check(r.error && /16/.test(r.error), 'an over-long comment is refused with the controller\'s limit');
    const sentBefore = mock.hits.length;
    r = await post('/api/robot/comment', { ip: ROBOT, type: 'R', index: 2, text: "it's" });
    check(r.error && mock.hits.length === sentBefore, 'a quote is refused and nothing reaches the robot');

    console.log('\n-- a controller that takes the write and stores nothing --');
    const lying = await startMockHttp(HTTP_PORT + 1, Object.assign({}, files), { comsetLies: true });
    // the bridge talks to one HTTP port, so swap the mock behind it
    await new Promise((res) => mock.close(res));
    const liar = await startMockHttp(HTTP_PORT, Object.assign({}, files), { comsetLies: true });
    await new Promise((res) => lying.close(res));
    r = await post('/api/robot/comment', { ip: ROBOT, type: 'R', index: 2, text: 'newname' });
    check(r.ok === false && r.verified === false && /still reads/.test(r.error), 'a 200 without the stored comment is reported as not done: ' + r.error);
    await new Promise((res) => liar.close(res));
    const mock2 = await startMockHttp(HTTP_PORT, files);

    console.log('\n-- probe and scan identify a controller by its SUMMARY.DG --');
    r = await get('/api/robots/probe?ip=' + ROBOT);
    check(r.ok === true, 'probe sees the web port open');
    const scanText = await fetch(BASE + '/api/robots/scan?cidr=127.0.0.1/32').then((x) => x.text());
    const events = scanText.trim().split('\n').map((l) => JSON.parse(l));
    const hit = events.find((e) => e.type === 'hit');
    check(hit && hit.ip === ROBOT && hit.name === 'MOCKBOT', 'scan reports a hit named from SUMMARY.DG: ' + JSON.stringify(hit));
    check(events[events.length - 1].type === 'done' && events[events.length - 1].found === 1, 'scan finishes with found=1');
    const robots = await get('/api/robots');
    check((robots.robots || robots).some((x) => x.ip === ROBOT && x.name === 'MOCKBOT'), 'the found robot was saved to robots.json in the test state dir');
    check(fs.existsSync(path.join(stateDir, 'robots.json')), 'robots.json lives in FANUC_STUDIO_STATE, not beside the bridge');
    await new Promise((res) => mock2.close(res));

    console.log('\n-- stopping the bridge from its own PC --');
    r = await post('/api/quit');
    check(r.ok === true, '/api/quit accepted from localhost');
    const code = await timed(exited, 3000).catch(() => 'still running');
    check(code === 0, 'the bridge process exited cleanly (code ' + code + ')');
  } catch (e) {
    failures++;
    console.error('FAIL  unexpected error: ' + (e && e.stack || e));
  } finally {
    try { srv.kill(); } catch (e) { /* already gone */ }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }

  console.log('');
  if (failures) { console.error(failures + ' test(s) failed'); process.exit(1); }
  console.log('All HTTP tests passed.');
})();
