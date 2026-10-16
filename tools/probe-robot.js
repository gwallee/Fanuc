#!/usr/bin/env node
/* Read-only survey of what a controller offers, for deciding how PR values
 * and I/O could be written. Run it on the bridge PC, which is on the robot's
 * network:
 *
 *   node tools/probe-robot.js 10.5.6.233 [--ftp user:pass]
 *
 * It WRITES NOTHING. Every step is a TCP connect, an HTTP GET of a page the
 * controller serves for reading, an FTP directory listing, or reading the
 * Telnet greeting. Nothing is sent to KCL beyond a bare Enter. Paste the
 * report back; the next step — a single, named write to test with — is
 * agreed before it is written.
 */
'use strict';
const net = require('net');
const http = require('http');
const path = require('path');
const { Ftp } = require(path.join(__dirname, '..', 'lib', 'ftp.js'));

const host = process.argv[2];
if (!host) { console.error('usage: node tools/probe-robot.js <robot-ip> [--ftp user:pass]'); process.exit(1); }
const ftpArg = process.argv.indexOf('--ftp');
const ftpCreds = ftpArg !== -1 ? String(process.argv[ftpArg + 1] || '').split(':') : null;

const out = [];
function say(s) { out.push(s); console.log(s); }
function head(s) { say('\n== ' + s + ' =='); }

function tcp(port, ms) {
  return new Promise((r) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); r('no answer'); }, ms || 2500);
    s.on('connect', () => { clearTimeout(t); s.destroy(); r('open'); });
    s.on('error', (e) => { clearTimeout(t); r(e.code || e.message); });
  });
}

function get(p, ms) {
  return new Promise((r) => {
    const req = http.request({ host, port: 80, path: p, method: 'GET', timeout: ms || 6000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => { if (chunks.reduce((n, b) => n + b.length, 0) < 400000) chunks.push(c); });
      res.on('end', () => r({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('latin1') }));
      res.on('error', (e) => r({ error: e.message }));
    });
    req.on('timeout', () => { req.destroy(); r({ error: 'timeout' }); });
    req.on('error', (e) => r({ error: e.message }));
    req.end();
  });
}

function hrefs(html) {
  const set = new Set();
  let m;
  const re = /href\s*=\s*["']?([^"'\s>]+)/gi;
  while ((m = re.exec(html)) !== null) set.add(m[1]);
  return [...set];
}

function printable(s) {
  return s.replace(/[^\x20-\x7e\r\n]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

(async () => {
  say('FANUC controller survey of ' + host + ' — ' + new Date().toISOString());
  say('(read-only: nothing on the controller is changed by this script)');

  head('ports (TCP connect only)');
  const ports = [[80, 'HTTP — web server / MD: device'], [21, 'FTP'], [23, 'Telnet — KCL'],
    [18245, 'SNPX (HMI Device option)'], [502, 'Modbus TCP'], [60008, 'PC Interface / Robot Interface'], [44818, 'EtherNet/IP']];
  for (const [p, what] of ports) say('  ' + String(p).padEnd(6) + what.padEnd(36) + await tcp(p));

  head('HTTP: identity and the pages the bridge already reads');
  let r = await get('/MD/SUMMARY.DG');
  if (r.error) say('  /MD/SUMMARY.DG: ' + r.error);
  else {
    say('  /MD/SUMMARY.DG: HTTP ' + r.status);
    r.body.split(/\r?\n/).filter((l) => /host\s*name|robot\s*name|f-?no|f-?number|software\s*version|controller|\$version|R-30i|R-50i/i.test(l)).slice(0, 8)
      .forEach((l) => say('    ' + l.trim()));
  }
  for (const p of ['/MD/POSREG.VA', '/MD/NUMREG.VA', '/MD/IOSTATE.DG', '/MD/DIOCFGSV.IO', '/MD/SYSVARS.VA']) {
    r = await get(p);
    const n = r.body ? r.body.split(/\r?\n/).length : 0;
    say('  ' + p.padEnd(18) + (r.error ? r.error : 'HTTP ' + r.status + (r.status === 200 ? ', ' + n + ' lines' : '')));
  }

  head('HTTP: the controller\'s own web pages (where a value-write tool would live)');
  for (const p of ['/', '/KAREL/COMMAIN', '/KAREL/', '/frh/', '/softpart/', '/MD/']) {
    r = await get(p);
    if (r.error) { say('  ' + p.padEnd(16) + r.error); continue; }
    const ct = (r.headers['content-type'] || '').split(';')[0];
    say('  ' + p.padEnd(16) + 'HTTP ' + r.status + (ct ? ' ' + ct : '') + (r.status === 200 ? ', ' + r.body.length + ' bytes' : ''));
    if (r.status === 200 && /html/i.test(ct)) {
      const links = hrefs(r.body).filter((h) => !/^(mailto|javascript):/i.test(h));
      const interesting = links.filter((h) => /karel|kcl|var|reg|io|port|edit|set|sop|frh|softpart|data/i.test(h) && !/\.(css|gif|png|jpg|ico)$/i.test(h));
      if (interesting.length) say('    links: ' + interesting.slice(0, 40).join('  '));
      const scripts = [...r.body.matchAll(/<script[^>]+src\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]);
      if (scripts.length) say('    scripts: ' + scripts.slice(0, 12).join('  '));
      if (p === '/KAREL/COMMAIN') {
        // the handlers the comment tool itself calls — this is how ComSet's codes were found
        const calls = [...r.body.matchAll(/\/karel\/[A-Za-z0-9_]+/gi)].map((m) => m[0]);
        if (calls.length) say('    karel calls on the page: ' + [...new Set(calls)].join('  '));
      }
    }
  }

  head('FTP: login and MD: listing');
  if (await tcp(21) !== 'open') say('  port 21 closed — FTP is off on this controller');
  else {
    try {
      const ftp = await Ftp.connect(host, 21, ftpCreds ? ftpCreds[0] : undefined, ftpCreds ? ftpCreds[1] : undefined, 8000);
      say('  login ok as ' + (ftpCreds ? ftpCreds[0] : 'anonymous'));
      try { await ftp.cwd('md:'); say('  CWD md: ok'); } catch (e) { say('  CWD md: refused (' + e.message + ') — rooted at md: already'); }
      const names = await ftp.nlst();
      say('  ' + names.length + ' entries; .TP ' + names.filter((n) => /\.tp$/i.test(n)).length + ', .LS ' + names.filter((n) => /\.ls$/i.test(n)).length +
        ', .VA ' + names.filter((n) => /\.va$/i.test(n)).length + (names.some((n) => /\.pc$/i.test(n)) ? ', KAREL .PC present: ' + names.filter((n) => /\.pc$/i.test(n)).slice(0, 8).join(' ') : ', no KAREL .PC files'));
      await ftp.quit();
    } catch (e) { say('  FTP: ' + e.message); }
  }

  head('Telnet (KCL): greeting only — nothing typed but Enter');
  if (await tcp(23) !== 'open') say('  port 23 closed — Telnet/KCL is off (SETUP > Host Comm > TELNET on the pendant turns it on)');
  else {
    await new Promise((resolve) => {
      const s = net.connect({ host, port: 23 });
      let got = '';
      const done = () => { s.destroy(); say('  banner/prompt: ' + (got ? JSON.stringify(printable(got).slice(0, 400)) : '(nothing received)')); resolve(); };
      s.on('data', (c) => { got += c.toString('latin1'); });
      s.on('error', (e) => { say('  telnet: ' + e.message); resolve(); });
      s.on('connect', () => { setTimeout(() => s.write('\r\n'), 1500); setTimeout(done, 3500); });
    });
  }

  head('end of survey');
  say('Paste everything above back. Nothing was written to the controller.');
})();
