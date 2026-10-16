#!/usr/bin/env node
/* READ-ONLY KCL probe over Telnet, to learn how this controller lets values
 * be written — before anything is written. Run on the bridge PC:
 *
 *   node tools/probe-kcl.js 10.5.6.233 --user KCL --pass 1234
 *
 * Once logged in it runs read-only HELP/SHOW commands (the defaults discover
 * how a position register is stored, since KCL has no SET POSREG and a PR can
 * only be written through SET VAR on $POSREG). Override with --run "<cmd>".
 * The tool REFUSES to send anything but HELP/SHOW/LIST/DIR, so it cannot
 * change the controller. Paste the whole transcript back.
 *
 * The prompt on this controller looks like "$.#5KCL>" and the console
 * streams async status lines, so the driver is time-based: it waits for the
 * login prompts, then for the first KCL> anywhere, then runs the commands on
 * a timer rather than trying to match a clean prompt.
 */
'use strict';
const net = require('net');

const host = process.argv[2];
if (!host) { console.error('usage: node tools/probe-kcl.js <robot-ip> [--user U] [--pass P]'); process.exit(1); }
function opt(name, def) { const i = process.argv.indexOf('--' + name); return i !== -1 ? String(process.argv[i + 1] || '') : def; }
const USER = opt('user', '');
const PASS = opt('pass', '');

/* The read-only commands to run, each with how long to let its output
 * stream. Override with one or more --run "<cmd>" (e.g. --run "SHOW VAR $FNO").
 * Only HELP / SHOW / LIST / DIR commands are ever allowed — see the guard
 * below — so this tool cannot be used to change anything on the controller. */
function collectRuns() {
  const out = [];
  for (let i = 3; i < process.argv.length; i++) {
    if (process.argv[i] === '--run' && process.argv[i + 1]) { out.push([process.argv[i + 1], 4000]); i++; }
  }
  return out;
}
const DEFAULT_COMMANDS = [
  ['HELP SET VAR', 4500],       // how SET VAR takes a value — the only KCL route to a PR
  ['SHOW VAR $POSREG[1,1]', 3500],  // how one position register is represented
  ['SHOW VAR $POSREG[1]', 3500]
];
const READONLY_FIRST = /^(HELP|SHOW|LIST|DIR|TYPE)\b/i;
const COMMANDS = (collectRuns().length ? collectRuns() : DEFAULT_COMMANDS)
  .filter(function (c) {
    if (READONLY_FIRST.test(c[0].trim())) return true;
    console.error('refusing non-read-only command: ' + JSON.stringify(c[0]) + ' (this probe only sends HELP/SHOW)');
    return false;
  });
if (!COMMANDS.length) { console.error('no read-only commands to run'); process.exit(1); }

/* Minimal, well-behaved telnet: strip IAC negotiation out of the data stream
 * and answer it (accept server ECHO/SGA, decline the rest). */
function telnetFilter(sock) {
  let carry = Buffer.alloc(0);
  return function (chunk) {
    const buf = Buffer.concat([carry, chunk]);
    carry = Buffer.alloc(0);
    const out = [];
    let i = 0;
    while (i < buf.length) {
      if (buf[i] === 255) {
        if (i + 1 >= buf.length) { carry = buf.slice(i); break; }
        const cmd = buf[i + 1];
        if (cmd === 255) { out.push(255); i += 2; continue; }
        if (cmd >= 251 && cmd <= 254) {
          if (i + 2 >= buf.length) { carry = buf.slice(i); break; }
          const o = buf[i + 2];
          let resp;
          if (cmd === 251) resp = (o === 1 || o === 3) ? 253 : 254;
          else if (cmd === 253) resp = 252;
          else resp = (cmd === 252) ? 254 : 252;
          try { sock.write(Buffer.from([255, resp, o])); } catch (e) { /* closing */ }
          i += 3; continue;
        }
        if (cmd === 250) {
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
let sentUser = false, sentPass = false, loggedIn = false, commandsStarted = false;

s.on('error', (e) => finish('socket error: ' + e.message));
s.on('data', (c) => { acc += filter(c); onData(); });
s.on('connect', () => transcript.push('(connected to ' + host + ':23)'));

function send(line) { transcript.push('>>> ' + JSON.stringify(line)); try { s.write(line + '\r\n'); } catch (e) { /* closing */ } }

function onData() {
  const tail = acc.slice(-160);
  // page past any "more" prompt, whatever phase we are in
  if (/--- more|--more--|\[more|press\s+(enter|return)/i.test(tail)) {
    try { s.write('\r\n'); } catch (e) { /* closing */ }
    acc = acc.replace(/(--- more[^\n]*|--more--|\[more[^\n]*|press\s+(enter|return)[^\n]*)/ig, '');
    return;
  }
  if (!loggedIn) {
    if (!sentUser && /login\s*:/i.test(tail)) { sentUser = true; send(USER); return; }
    if (sentUser && !sentPass && /password\s*:/i.test(tail)) { sentPass = true; send(PASS); return; }
    if (/KCL>/.test(acc) || /logged in/i.test(acc)) { loggedIn = true; setTimeout(runCommands, 1200); }
  }
}

function runCommands() {
  if (commandsStarted) return;
  commandsStarted = true;
  let delay = 0;
  COMMANDS.forEach(function (c) {
    setTimeout(function () { send(c[0]); }, delay);
    delay += c[1];
  });
  setTimeout(function () { finish('done'); }, delay + 800);
}

const hardStop = setTimeout(() => finish('timed out before a KCL> prompt — the login may still be wrong, or KCL is restricted'), 30000);

let finished = false;
function finish(why) {
  if (finished) return;
  finished = true;
  clearTimeout(hardStop);
  try { s.destroy(); } catch (e) { /* already gone */ }
  // clean the controller's status markers so the HELP text reads plainly
  const clean = acc
    .replace(/\r/g, '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[^\x09\x0a\x20-\x7e]/g, '')   // ESC and other control bytes
    .replace(/#\d/g, '')                      // the "#5" status markers the controller interleaves
    .replace(/[ \t]{2,}/g, ' ');
  console.log('KCL probe of ' + host + ' — ' + new Date().toISOString());
  console.log('(read-only: only HELP and SHOW were typed; nothing was changed)\n');
  console.log('result: ' + why + '\n');
  console.log('--- commands sent ---');
  transcript.forEach((l) => console.log(l));
  console.log('\n--- transcript from the controller (status markers stripped) ---');
  console.log(clean);
  console.log('\n--- end ---  Paste everything above back. Nothing was written.');
}
