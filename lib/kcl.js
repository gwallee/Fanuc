/* Minimal KCL-over-Telnet client for FANUC controllers.
 *
 *   const k = await Kcl.connect(host, 23, 'KCL', pass);
 *   const out = await k.cmd('SET PORT DOUT[1] = ON');   // returns KCL's reply
 *   await k.quit();
 *
 * KCL on these controllers decorates its prompt ("$.#5KCL>") and streams
 * asynchronous console lines, so a command's reply is captured by time: the
 * text that arrives after the command is sent, until the console goes quiet.
 * The caller decides success by looking for "ERROR" in that reply (cmdOk()).
 *
 * This client WRITES to the controller only what the caller tells it to. The
 * bridge uses it for SET PORT; the controller enforces that physical inputs
 * cannot be forced. Zero dependencies.
 */
'use strict';
const net = require('net');

const DEFAULT_TIMEOUT = 10000;

/* Strip IAC negotiation from the stream and answer it (accept server
 * ECHO/SGA, decline the rest), so what the caller reads is just KCL text. */
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

function clean(s) {
  return s.replace(/\r/g, '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/[^\x09\x0a\x20-\x7e]/g, '')
    .replace(/#\d/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

class KclError extends Error {
  constructor(message) { super(message); this.name = 'KclError'; }
}

class Kcl {
  constructor(sock, timeout) {
    this.sock = sock;
    this.timeout = timeout;
    this.acc = '';
    this.filter = telnetFilter(sock);
    this.dead = null;
    this.onIdle = null;
    sock.on('data', (c) => {
      this.acc += this.filter(c);
      if (this.onIdle) this.onIdle();
    });
    sock.on('error', (e) => { this.dead = this.dead || new KclError(e.message); });
    sock.on('close', () => { this.dead = this.dead || new KclError('connection closed'); });
  }

  static connect(host, port, user, pass, timeout) {
    timeout = timeout || DEFAULT_TIMEOUT;
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host, port: port || 23 });
      let settled = false;
      const fail = (e) => { if (!settled) { settled = true; try { sock.destroy(); } catch (x) {} reject(e instanceof Error ? e : new KclError(String(e))); } };
      sock.once('error', fail);
      sock.setTimeout(timeout, () => fail(new KclError('connect timed out')));
      sock.once('connect', () => {
        sock.setTimeout(0);
        const k = new Kcl(sock, timeout);
        k._login(user || '', pass || '').then(() => { if (!settled) { settled = true; resolve(k); } }, fail);
      });
    });
  }

  /* Wait until the controller stops sending for `quiet` ms, or `max` ms pass. */
  _settle(quiet, max) {
    return new Promise((resolve) => {
      let timer = null;
      const start = Date.now();
      const arm = () => {
        clearTimeout(timer);
        const left = max - (Date.now() - start);
        timer = setTimeout(done, Math.max(0, Math.min(quiet, left)));
      };
      const done = () => { this.onIdle = null; resolve(); };
      this.onIdle = arm;
      arm();
    });
  }

  async _login(user, pass) {
    // drive the login prompts; give up if no KCL prompt appears
    const deadline = Date.now() + this.timeout;
    let sentUser = false, sentPass = false;
    while (Date.now() < deadline) {
      if (this.dead) throw this.dead;
      const tail = this.acc.slice(-200);
      if (/login incorrect/i.test(this.acc) && sentPass) throw new KclError('KCL login refused (check the username and password on SETUP > Host Comm > TELNET)');
      if (/KCL>/.test(this.acc) || /logged in/i.test(this.acc)) { await this._settle(200, 1000); return; }
      if (!sentUser && /login\s*:/i.test(tail)) { sentUser = true; this.sock.write(user + '\r\n'); }
      else if (sentUser && !sentPass && /password\s*:/i.test(tail)) { sentPass = true; this.sock.write(pass + '\r\n'); }
      await this._settle(200, 400);
    }
    throw new KclError('no KCL prompt — the controller did not present a usable login');
  }

  /* Send one command; return the controller's reply text (cleaned). */
  async cmd(line) {
    if (this.dead) throw this.dead;
    const mark = this.acc.length;
    this.sock.write(line + '\r\n');
    await this._settle(250, 2000);
    return clean(this.acc.slice(mark));
  }

  async quit() {
    try { this.sock.write('\r\n'); } catch (e) { /* closing */ }
    try { this.sock.destroy(); } catch (e) { /* already gone */ }
  }
}

/* Did a reply report a KCL error? */
function cmdOk(reply) { return !/\^?\s*ERROR/i.test(reply); }

module.exports = { Kcl, KclError, cmdOk };
