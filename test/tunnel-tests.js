#!/usr/bin/env node
/* Tests for lib/tunnel.js: robot connections through a SOCKS5 proxy.
 * Run: node test/tunnel-tests.js
 *
 * The "robot" is the mock FTP controller on loopback. A small SOCKS5 server
 * stands in for the tunnel and maps 192.0.2.10 (TEST-NET-1, never a real
 * address) onto it, so the client believes it is talking to a robot it has
 * no route to.
 */
'use strict';
const net = require('net');
const http = require('http');
const { startMockFtp } = require('./mock-ftp.js');
const { Ftp } = require('../lib/ftp.js');
const tunnel = require('../lib/tunnel.js');

const FTP_PORT = 2471;
const SOCKS_PORT = 2472;
const HTTP_PORT = 2473;
const FAR = '192.0.2.10';

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.error('FAIL  ' + msg); }
}

/* Minimal SOCKS5: no authentication, CONNECT, IPv4. Requests for FAR go to
 * loopback; anything else is refused the way a real proxy refuses. */
function startSocks(port, seen) {
  const server = net.createServer((client) => {
    let buf = Buffer.alloc(0);
    let stage = 0;
    client.on('error', () => {});
    client.on('data', function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 0 && buf.length >= 3) {
        buf = buf.subarray(2 + buf[1]);
        stage = 1;
        client.write(Buffer.from([5, 0]));
      }
      if (stage === 1 && buf.length >= 10) {
        const host = buf.subarray(4, 8).join('.');
        const dport = buf.readUInt16BE(8);
        const rest = buf.subarray(10);
        stage = 2;
        client.removeListener('data', onData);
        seen.push(host + ':' + dport);
        if (host !== FAR) { client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
        const up = net.createConnection({ host: '127.0.0.1', port: dport });
        up.on('error', () => client.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
        up.on('connect', () => {
          client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          if (rest.length) up.write(rest);
          client.pipe(up);
          up.pipe(client);
        });
        client.on('close', () => up.destroy());
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function httpGet(host, port, path) {
  return new Promise((resolve, reject) => {
    const options = { host, port, path, method: 'GET', timeout: 3000 };
    if (tunnel.via(host)) { options.createConnection = () => tunnel.connect(host, port); }
    const req = http.request(options, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const files = { 'MAIN.LS': '/PROG MAIN\n/MN\n   1:  R[1]=1 ;\n/END\n' };
  const ftpServer = await startMockFtp(FTP_PORT, files, {});
  const seen = [];
  const socks = await startSocks(SOCKS_PORT, seen);
  const web = http.createServer((req, res) => res.end('robot says ' + req.url));
  await new Promise((r) => web.listen(HTTP_PORT, '127.0.0.1', r));

  console.log('settings');
  check(tunnel.parse('127.0.0.1:1080').port === 1080 && tunnel.parse('socks5://localhost:9') .host === 'localhost', 'host:port and socks5://host:port are accepted');
  check(tunnel.parse('') === null && tunnel.parse('1080') === null && tunnel.parse('a:99999') === null, 'anything else means no tunnel');

  console.log('no tunnel configured');
  await tunnel.configure('');
  check(!tunnel.via(FAR) && tunnel.status().proxy === null, 'every robot is reached directly');

  console.log('tunnel open');
  check(await tunnel.configure('127.0.0.1:' + SOCKS_PORT), 'a listening proxy is seen as up');
  check(tunnel.via(FAR), 'a robot on no local subnet goes through it');
  check(!tunnel.via('127.0.0.1') && !tunnel.via('localhost'), 'loopback never does');

  const ftp = await Ftp.connect(FAR, FTP_PORT, undefined, undefined, 3000);
  check(ftp.socket.tunnelTarget === FAR, 'the control connection remembers the robot address');
  const names = await ftp.nlst();
  check(names.some((n) => /MAIN\.LS/i.test(n)), 'directory listing arrives through the tunnel');
  const got = await ftp.retr('MAIN.LS');
  check(got.toString('latin1') === files['MAIN.LS'], 'a program downloads intact');
  const sent = '/PROG NEW\n/MN\n   1:  R[5]=5 ;\n/END\n';
  await ftp.stor('NEW.LS', Buffer.from(sent, 'latin1'));
  const back = await ftp.retr('NEW.LS');
  check(back.toString('latin1') === sent, 'an upload arrives intact and reads back');
  await ftp.quit();
  check(seen.length >= 5 && seen.every((s) => s.indexOf(FAR + ':') === 0),
    'control and every data connection went through the proxy to the robot address (' + seen.length + ' connections)');

  const page = await httpGet(FAR, HTTP_PORT, '/MD/PRGSTATE.DG');
  check(page === 'robot says /MD/PRGSTATE.DG', 'an HTTP read arrives through the tunnel');

  console.log('refusals');
  const before = seen.length;
  const refused = await new Promise((resolve) => {
    const s = tunnel.connect('192.0.2.99', 80);
    let connected = false;
    s.on('connect', () => { connected = true; });
    s.on('error', (e) => resolve({ connected, message: e.message }));
    s.setTimeout(3000, () => resolve({ connected, message: 'timeout' }));
  });
  check(!refused.connected && /^tunnel: could not reach 192\.0\.2\.99:80/.test(refused.message),
    'a robot the proxy cannot reach is an ordinary error, never a connect (' + refused.message + ')');
  check(seen.length === before + 1, 'and it is tried once, not retried');

  console.log('tunnel closed');
  await new Promise((r) => socks.close(r));
  check(!(await tunnel.check()) && !tunnel.via(FAR), 'when the proxy stops listening, robots are reached directly again');
  const direct = await Ftp.connect('127.0.0.1', FTP_PORT, undefined, undefined, 3000);
  check(direct.socket.tunnelTarget === undefined && (await direct.retr('MAIN.LS')).toString('latin1') === files['MAIN.LS'],
    'a direct connection is untouched');
  await direct.quit();

  await tunnel.configure('');
  web.close();
  ftpServer.close && ftpServer.close();
  if (failures) { console.error(failures + ' tunnel test(s) failed'); process.exit(1); }
  console.log('all tunnel tests passed');
  process.exit(0);
})().catch((e) => { console.error('FAIL  ' + (e && e.stack || e)); process.exit(1); });
