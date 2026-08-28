/* Minimal FTP client for FANUC controllers (and anything RFC-959-ish).
 * Zero dependencies — plain net sockets, passive mode only.
 *
 * const ftp = await Ftp.connect(host, port, user, pass);
 * await ftp.nlst();               -> ['MAIN.LS', 'NUMREG.VA', ...]
 * await ftp.retr('MAIN.LS');      -> Buffer
 * await ftp.stor('MAIN.LS', buf); -> resolves on 226, rejects on any error
 * await ftp.quit();
 */
'use strict';
const net = require('net');

const DEFAULT_TIMEOUT = 10000;

class FtpError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'FtpError';
    this.code = code;
  }
}

class Ftp {
  constructor(socket, timeout) {
    this.socket = socket;
    this.timeout = timeout;
    this.buffer = '';
    this.waiters = [];
    socket.setTimeout(timeout);
    socket.on('timeout', () => this._fail(new FtpError('control connection timed out')));
    socket.on('error', (e) => this._fail(new FtpError(e.message)));
    socket.on('close', () => this._fail(new FtpError('control connection closed')));
    socket.on('data', (chunk) => {
      this.buffer += chunk.toString('latin1');
      this._drain();
    });
  }

  static async connect(host, port, user, pass, timeout) {
    timeout = timeout || DEFAULT_TIMEOUT;
    const socket = await new Promise((resolve, reject) => {
      const s = net.createConnection({ host, port: port || 21 });
      s.once('connect', () => resolve(s));
      s.once('error', reject);
      s.setTimeout(timeout, () => { s.destroy(); reject(new FtpError('connect timed out')); });
    });
    const ftp = new Ftp(socket, timeout);
    await ftp._expect([220]);                          // greeting
    await ftp.cmd('USER ' + (user || 'anonymous'), [230, 331]);
    const last = ftp.lastCode;
    if (last === 331) await ftp.cmd('PASS ' + (pass === undefined ? 'guest' : pass), [230, 202]);
    return ftp;
  }

  _fail(err) {
    const ws = this.waiters;
    this.waiters = [];
    ws.forEach((w) => w.reject(err));
  }

  /* Responses end with a line "NNN text". Multi-line starts "NNN-". */
  _drain() {
    for (;;) {
      const m = this.buffer.match(/^([\s\S]*?)^(\d{3}) ([^\r\n]*)\r?\n/m);
      if (!m) return;
      this.buffer = this.buffer.slice(m[0].length);
      const code = parseInt(m[2], 10);
      const text = (m[1] + m[2] + ' ' + m[3]).trim();
      const w = this.waiters.shift();
      if (w) w.settle(code, text);
    }
  }

  _expect(okCodes) {
    return new Promise((resolve, reject) => {
      this.waiters.push({
        reject,
        settle: (code, text) => {
          this.lastCode = code;
          if (okCodes.indexOf(code) !== -1) resolve({ code, text });
          else reject(new FtpError('FTP: ' + text, code));
        }
      });
    });
  }

  cmd(line, okCodes) {
    this.socket.write(line + '\r\n');
    return this._expect(okCodes);
  }

  async pasv() {
    const r = await this.cmd('PASV', [227]);
    const m = r.text.match(/(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/);
    if (!m) throw new FtpError('cannot parse PASV reply: ' + r.text);
    // Trust the control connection's address over the advertised one (NAT-safe).
    const host = this.socket.remoteAddress || (m[1] + '.' + m[2] + '.' + m[3] + '.' + m[4]);
    return { host, port: (+m[5]) * 256 + (+m[6]) };
  }

  /* Run one data-connection command. sendBuf: Buffer to upload, or null to download. */
  async _dataCmd(command, sendBuf) {
    const { host, port } = await this.pasv();
    const chunks = [];
    const data = net.createConnection({ host, port });
    data.setTimeout(this.timeout, () => data.destroy(new Error('data connection timed out')));
    const dataDone = new Promise((resolve, reject) => {
      data.on('error', reject);
      data.on('close', (hadErr) => (hadErr ? reject(new FtpError('data connection failed')) : resolve()));
      if (sendBuf === null) data.on('data', (c) => chunks.push(c));
    });
    // The data socket can reject before anyone awaits dataDone (e.g. the
    // command itself is refused and the socket later times out). Without this
    // no-op handler that becomes an unhandled rejection and kills the process.
    dataDone.catch(() => {});
    try {
      await this.cmd(command, [125, 150]);
    } catch (e) {
      data.destroy();
      throw e;
    }
    if (sendBuf !== null) data.end(sendBuf);
    await dataDone;
    await this._expect([226, 250]);                    // transfer complete — FANUC reports translation errors here
    return sendBuf === null ? Buffer.concat(chunks) : null;
  }

  async type(t) { await this.cmd('TYPE ' + t, [200]); }

  /* Change directory — FANUC controllers root the FTP server at the device
   * list (fr:, mc:, md:, ...); program files live under md:. */
  async cwd(dir) { await this.cmd('CWD ' + dir, [200, 250]); }

  async retr(name) {
    await this.type('I');
    return this._dataCmd('RETR ' + name, null);
  }

  async stor(name, buf) {
    await this.type('I');
    return this._dataCmd('STOR ' + name, Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  }

  async nlst() {
    await this.type('A');
    try {
      const out = await this._dataCmd('NLST', null);
      return out.toString('latin1').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch (e) {
      // some servers refuse NLST — fall back to LIST and take the last token
      const out = await this._dataCmd('LIST', null);
      return out.toString('latin1').split(/\r?\n/)
        .map((l) => l.trim().split(/\s+/).pop())
        .filter((n) => n && n !== '.' && n !== '..');
    }
  }

  async quit() {
    try { await this.cmd('QUIT', [221]); } catch (e) { /* closing anyway */ }
    this.socket.destroy();
  }
}

module.exports = { Ftp, FtpError };
