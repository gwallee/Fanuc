/* In-memory mock of a FANUC controller's KCL-over-Telnet service, for the
 * I/O-write tests. Imitates:
 *  - a login prompt (login: / password:) that accepts opts.user/opts.pass
 *    (default KCL / 1234), rejecting anything else with "Login incorrect"
 *  - a KCL> prompt decorated like the real one ("$.#5KCL>")
 *  - SET PORT name[idx] = value  → stores into the shared `ports` map and
 *    answers with a bare prompt; an unknown port or (for a DIN that is not
 *    simulated) answers "^ ERROR ...". Accepts ON/OFF and TRUE/FALSE.
 *
 * `ports` is shared with the mock web server so a SET PORT shows up when the
 * bridge re-reads IOSTATE.DG to verify — the same proof the real bridge uses.
 */
'use strict';
const net = require('net');

function startMockKcl(port, ports, opts) {
  opts = opts || {};
  const user = opts.user || 'KCL';
  const pass = opts.pass === undefined ? '1234' : opts.pass;
  const sockets = new Set();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {});
    let buf = '';
    let phase = 'login';   // login -> pass -> kcl
    const send = (s) => { try { sock.write(s); } catch (e) {} };
    send('\xff\xfb\x01\xff\xfb\x03R-J3 Telnet (Robot: MOCK)\r\n\r\nlogin: ');

    function handle(line) {
      if (phase === 'login') {
        this_user = line.trim();   // eslint-disable-line
        phase = 'pass';
        send('password: ');
        return;
      }
      if (phase === 'pass') {
        if (this_user === user && line.trim() === String(pass)) { phase = 'kcl'; send('User logged in\r\n$.#5KCL> '); }
        else { phase = 'login'; send('Login incorrect\r\nlogin: '); }
        return;
      }
      // KCL phase
      const m = line.match(/^\s*SET\s+PORT\s+([A-Z]+)\s*\[\s*(\d+)\s*\]\s*=\s*(\S+)/i);
      if (m) {
        const name = m[1].toUpperCase(), idx = parseInt(m[2], 10), val = m[3].toUpperCase().replace(/;$/, '');
        const key = name + '[' + idx + ']';
        if ((opts.unknown || []).indexOf(key) !== -1) { send('\r\n^ ERROR Port not found.\r\n$.#5KCL> '); return; }
        if (/^DIN/i.test(name) && (opts.simulated || []).indexOf(key) === -1) { send('\r\n^ ERROR Port is not simulated.\r\n$.#5KCL> '); return; }
        let stored;
        if (/^(ON|TRUE)$/.test(val)) stored = 'ON';
        else if (/^(OFF|FALSE)$/.test(val)) stored = 'OFF';
        else if (/^-?\d+(\.\d+)?$/.test(val)) stored = val;
        else { send('\r\n^ ERROR Illegal value.\r\n$.#5KCL> '); return; }
        if (opts.onlyTrueFalse && /^(ON|OFF)$/.test(val)) { send('\r\n^ ERROR Illegal value.\r\n$.#5KCL> '); return; }
        ports[key] = stored;
        send('\r\n$.#5KCL> ');
        return;
      }
      send('\r\n$.#5KCL> ');
    }

    let this_user = '';
    sock.on('data', (d) => {
      buf += d.toString('latin1').replace(/\xff[\xfb-\xfe]./g, '');   // drop client IAC
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        handle(line);
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    server.closeAll = () => { for (const s of sockets) s.destroy(); };
    resolve(server);
  }));
}

module.exports = { startMockKcl };
