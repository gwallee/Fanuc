#!/usr/bin/env node
/* Integration tests for forcing I/O over KCL (/api/robot/setport), against a
 * mock KCL telnet service and a mock web server whose IOSTATE.DG reflects the
 * KCL writes — so the verify-by-read-back path runs end to end. Two bridges
 * run at once (one normal controller, one that only accepts TRUE/FALSE) so no
 * process is restarted mid-run.  Run: node test/io-tests.js
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { startMockKcl } = require('./mock-kcl.js');
const RESLOG = process.env.IO_TEST_LOG;
const fsx = require('fs');
function out(m) { if (RESLOG) { try { fsx.appendFileSync(RESLOG, m + '\n'); } catch (e) {} } console.log(m); }

let failures = 0;
function check(cond, msg) {
  if (cond) out('  ok  ' + msg);
  else { failures++; out('FAIL  ' + msg); }
}
async function post(appPort, body) {
  const r = await fetch('http://127.0.0.1:' + appPort + '/api/robot/setport', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return r.json();
}

const IOSTATE_NAME = { DOUT: 'DOUT', RDO: 'ROUT', GOUT: 'GOUT', AOUT: 'AOUT', FLAG: 'FLG', DIN: 'DIN', RDI: 'RIN' };
function iostate(ports) {
  const base = { 'DOUT[1]': 'OFF', 'DOUT[2]': 'OFF', 'RDO[1]': 'OFF', 'GOUT[1]': '0', 'AOUT[1]': '0', 'FLAG[1]': 'OFF', 'DIN[1]': 'OFF' };
  const all = Object.assign({}, base, ports);
  let body = 'F Number: F000001\n$VERSION: V9.40\nIO STATUS::\n\n';
  Object.keys(all).forEach((k) => {
    const m = k.match(/^([A-Z]+)\[(\d+)\]$/);
    const nm = IOSTATE_NAME[m[1]] || m[1];
    const v = all[k];
    body += nm + '[' + String(m[2]).padStart(4) + '] ' + (/^(ON|OFF)$/.test(v) ? v.padEnd(3) : v) + ' pt' + m[2] + '\n';
  });
  return body;
}
function webServer(port, ports) {
  const srv = http.createServer((req, res) => {
    if (/\/MD\/IOSTATE\.DG$/i.test(new URL(req.url, 'http://m').pathname)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<XMP>\n' + iostate(ports) + '</XMP>');
    }
    res.writeHead(404); res.end('no');
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}
function bridge(appPort, httpPort, kclPort) {
  return spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), String(appPort)], {
    stdio: 'ignore',
    env: Object.assign({}, process.env, {
      FANUC_STUDIO_ROBOT_HTTP_PORT: String(httpPort),
      FANUC_STUDIO_ROBOT_KCL_PORT: String(kclPort)
    })
  });
}

(async () => {
  const A = { app: 8659, http: 8659 + 100, kcl: 8659 + 200, ports: {} };   // normal controller
  const B = { app: 8660, http: 8660 + 100, kcl: 8660 + 200, ports: {} };   // TRUE/FALSE only
  const servers = [];
  servers.push(await startMockKcl(A.kcl, A.ports, { user: 'KCL', pass: '1234' }));
  servers.push(await startMockKcl(B.kcl, B.ports, { user: 'KCL', pass: '1234', onlyTrueFalse: true }));
  servers.push(await webServer(A.http, A.ports));
  servers.push(await webServer(B.http, B.ports));
  const procs = [bridge(A.app, A.http, A.kcl), bridge(B.app, B.http, B.kcl)];
  await new Promise((r) => setTimeout(r, 700));

  try {
    out('\n-- force a digital output, verified against IOSTATE.DG --');
    let r = await post(A.app, { ip: '127.0.0.1', pass: '1234', writes: [{ type: 'DO', index: 1, value: 'ON' }] });
    check(r.ok === true && r.writes[0].sent === 'ON' && r.writes[0].verified === true && r.writes[0].stored === 'ON', 'DO[1] forced ON and read back ON');
    check(A.ports['DOUT[1]'] === 'ON', 'the mock controller holds DOUT[1]=ON');

    out('\n-- several at once: output off, flag on, group value --');
    r = await post(A.app, { ip: '127.0.0.1', pass: '1234', writes: [
      { type: 'DO', index: 1, value: 'OFF' }, { type: 'F', index: 1, value: 'ON' }, { type: 'GO', index: 1, value: 42 }
    ] });
    check(r.ok === true && r.writes.length === 3, 'three writes reported ok');
    check(r.writes[0].stored === 'OFF' && r.writes[1].stored === 'ON' && r.writes[2].stored === '42', 'DO[1]=OFF, F[1]=ON, GO[1]=42 all verified');

    out('\n-- a controller that only accepts TRUE/FALSE --');
    r = await post(B.app, { ip: '127.0.0.1', pass: '1234', writes: [{ type: 'DO', index: 2, value: 'ON' }] });
    check(r.ok === true && r.writes[0].sent === 'TRUE' && r.writes[0].verified === true, 'fell back to TRUE and verified');

    out('\n-- a wrong KCL password is refused, nothing written --');
    r = await post(A.app, { ip: '127.0.0.1', pass: 'nope', writes: [{ type: 'DO', index: 2, value: 'ON' }] });
    check(r.ok === false && /login/i.test(r.error || ''), 'bad login reported: ' + r.error);
    check(A.ports['DOUT[2]'] === undefined, 'nothing was written on the bad-login attempt');

    out('\n-- bad requests refused before any session --');
    r = await post(A.app, { ip: '127.0.0.1', pass: '1234', writes: [{ type: 'UO', index: 1, value: 'ON' }] });
    check(r.error && /writable types/.test(r.error), 'a non-writable type is refused');
    r = await post(A.app, { ip: '127.0.0.1', pass: '1234', writes: [{ type: 'DO', index: 1, value: 'MAYBE' }] });
    check(r.error && /ON or OFF/.test(r.error), 'a non-ON/OFF digital value is refused');
  } catch (e) {
    failures++; console.error('FAIL  unexpected: ' + (e && e.stack || e));
  } finally {
    procs.forEach((p) => { try { p.kill(); } catch (e) {} });
    servers.forEach((s) => { try { s.closeAll ? s.closeAll() : s.close(); } catch (e) {} });
  }

  out('');
  if (failures) { out(failures + ' test(s) failed'); process.exit(1); }
  out('All I/O tests passed.');
  process.exit(0);
})();
