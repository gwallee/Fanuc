#!/usr/bin/env node
/* READ-ONLY KCL probe over Telnet, to learn how this controller lets values
 * be written — before anything is written. Run on the bridge PC:
 *
 *   node tools/probe-kcl.js 10.5.6.233
 *   node tools/probe-kcl.js 10.5.6.233 --user me --pass secret   (if asked)
 *
 * It logs in and types exactly two things, both read-only:
 *     HELP SET          — lists the SET sub-commands this KCL accepts
 *                         (i.e. what CAN be written: ports, registers, vars)
 *     SHOW VAR $VERSION — proves a read works and shows the version
 * plus a bare Enter to page past any "--- more ---" prompt. It sends NO SET
 * command and changes nothing. Paste the whole transcript back.
 */
'use strict';
const net = require('net');

const host = process.argv[2];
if (!host) { console.error('usage: node tools/probe-kcl.js <robot-ip> [--user U] [--pass P]'); process.exit(1); }
function opt(name, def) { const i = process.argv.indexOf('--' + name); return i !== -1 ? String(process.argv[i + 1] || '') : def; }
const USER = opt('user', '');
const PASS = opt('pass', '');

/* Minimal, well-behaved telnet: strip IAC negotiation out of the data stream
 * and answer it (accept server ECHO/SGA, decline everything else), so what we
 * read back is just the KCL text. */
function telnetFilter(sock) {
  let carry = Buffer.alloc(0);
  return function (chunk) {
    const buf = Buffer.concat([carry, chunk]);
    carry = Buffer.alloc(0);
    const out = [];
    let i = 0;
    while (i < buf.length) {
      if (buf[i] === 255) {                         // IAC
        if (i + 1 >= buf.length) { carry = buf.slice(i); break; }
        const cmd = buf[i + 1];
        if (cmd === 255) { out.push(255); i += 2; continue; }
        if (cmd >= 251 && cmd <= 254) {             // WILL/WONT/DO/DONT <opt>
          if (i + 2 >= buf.length) { carry = buf.slice(i); break; }
          const o = buf[i + 2];
          let resp;
          if (cmd === 251) resp = (o === 1 || o === 3) ? 253 : 254;   // WILL -> DO echo/sga else DONT
          else if (cmd === 253) resp = 252;         // DO   -> WONT
          else resp = (cmd === 252) ? 254 : 252;    // WONT->DONT, DONT->WONT
          try { sock.write(Buffer.from([255, resp, o])); } catch (e) { /* closing */ }
          i += 3; continue;
        }
        if (cmd === 250) {                           // SB ... IAC SE
          let j = i + 2;
          while (j + 1 < buf.length && !(buf[j] === 255 && buf[j + 1] === 240)) j++;
          if (j + 1 >= buf.length) { carry = buf.slice(i); break; }
          i = j + 2; continue;
        }
        i += 2; continue;
      }
      out.push(buf[i]); i++;
    }
    return Buffer.from(out).toString('latin1');
  };
}

const transcript = [];
const s = net.connect({ host, port: 23 });
let acc = '';
const filter = telnetFilter(s);
const sentLogin = { user: false, pass: false };

s.setTimeout(20000, () => { finish('timed out'); });
s.on('error', (e) => finish('socket error: ' + e.message));
s.on('data', (c) => { acc += filter(c); drive(); });
s.on('connect', () => transcript.push('(connected to ' + host + ':23)'));

let step = 0;
let stepStarted = Date.now();
function send(line) { transcript.push('>>> ' + JSON.stringify(line)); try { s.write(line + '\r\n'); } catch (e) { /* closing */ } }

/* A tiny state machine so we never block: answer login/password when seen,
 * then run the two read-only commands, paging past any "more" prompt. */
function drive() {
  const tail = acc.slice(-120);
  if (/--- more|--more--|\[more|press\s+enter|press\s+return/i.test(tail)) {
    try { s.write('\r\n'); } catch (e) { /* closing */ }
    acc = acc.replace(/(--- more[^\n]*|--more--|\[more[^\n]*|press\s+(enter|return)[^\n]*)/ig, '');
    return;
  }
  if (step === 0 && /login\s*:/i.test(tail) && !sentLogin.user) { sentLogin.user = true; send(USER); return; }
  if (step === 0 && /password\s*:/i.test(tail) && !sentLogin.pass) { sentLogin.pass = true; send(PASS); return; }
  if (step === 0 && /KCL>\s*$/i.test(tail)) { step = 1; stepStarted = Date.now(); send('HELP SET'); return; }
  // after a command, move on once the KCL> prompt comes back
  if (step === 1 && /KCL>\s*$/i.test(tail) && Date.now() - stepStarted > 400) { step = 2; stepStarted = Date.now(); send('SHOW VAR $VERSION'); return; }
  if (step === 2 && /KCL>\s*$/i.test(tail) && Date.now() - stepStarted > 400) { step = 3; finish('done'); return; }
}

/* If login never reaches a KCL> prompt (credentials needed, KCL locked),
 * still print what we saw so we can tell why. */
const hardStop = setTimeout(() => finish('no KCL> prompt within 15s — login may need credentials, or KCL/Telnet is restricted'), 15000);

let finished = false;
function finish(why) {
  if (finished) return;
  finished = true;
  clearTimeout(hardStop);
  try { s.destroy(); } catch (e) { /* already gone */ }
  console.log('KCL probe of ' + host + ' — ' + new Date().toISOString());
  console.log('(read-only: only HELP and SHOW were typed; nothing was changed)\n');
  console.log('result: ' + why + '\n');
  console.log('--- commands sent ---');
  transcript.forEach((l) => console.log(l));
  console.log('\n--- full transcript from the controller ---');
  console.log(acc.replace(/\r/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[^\x09\x0a\x20-\x7e]/g, '.'));
  console.log('\n--- end ---  Paste everything above back. Nothing was written.');
}
