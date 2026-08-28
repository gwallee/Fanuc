/* In-memory mock FTP server that imitates FANUC controller behavior:
 * - STOR of a .LS whose content contains "BADSYNTAX" reports success but
 *   DELETES the file — exactly what a failed LS→TP translation does.
 * - opts.deviceRoot: root the server at the device list (fr:, mc:, md:, ...)
 *   like a real controller — files are reachable only after CWD md:.
 */
'use strict';
const net = require('net');

const DEVICES = ['fr:', 'mc:', 'md:', 'mdb:', 'rd:', 'ud1:', 'ut1:'];

function startMockFtp(port, files, opts) {
  opts = opts || {};
  const server = net.createServer((sock) => {
    let buf = '';
    let pasvServer = null;
    let pasvConn = null; // promise of the data socket
    let cwd = opts.deviceRoot ? '/' : 'md:';

    const send = (s) => sock.write(s + '\r\n');
    send('220 MOCK-FANUC FTP');

    function openPasv() {
      if (pasvServer) pasvServer.close();
      pasvConn = new Promise((resolve) => {
        pasvServer = net.createServer((ds) => { pasvServer.close(); resolve(ds); });
        pasvServer.listen(0, '127.0.0.1', () => {
          const p = pasvServer.address().port;
          send(`227 Entering Passive Mode (127,0,0,1,${p >> 8},${p & 255}).`);
        });
      });
    }

    async function handle(line) {
      const sp = line.indexOf(' ');
      const cmd = (sp === -1 ? line : line.slice(0, sp)).toUpperCase();
      const arg = sp === -1 ? '' : line.slice(sp + 1).trim();
      switch (cmd) {
        case 'USER': send('331 password required'); break;
        case 'PASS': send('230 logged in'); break;
        case 'TYPE': send('200 type set'); break;
        case 'PASV': openPasv(); break;
        case 'CWD': {
          if (opts.deviceRoot && /^\/?md:?\/?$/i.test(arg)) { cwd = 'md:'; send('250 directory changed'); }
          else send('550 no such directory');
          break;
        }
        case 'NLST': {
          send('150 opening data connection');
          const ds = await pasvConn;
          const names = cwd === 'md:' ? Object.keys(files) : DEVICES;
          ds.end(names.join('\r\n') + '\r\n');
          send('226 transfer complete');
          break;
        }
        case 'RETR': {
          if (cwd !== 'md:' || !(arg in files)) { send('550 file not found'); break; }
          send('150 opening data connection');
          const ds = await pasvConn;
          ds.end(files[arg]);
          send('226 transfer complete');
          break;
        }
        case 'STOR': {
          if (cwd !== 'md:') { send('550 cannot write here'); break; }
          send('150 opening data connection');
          const ds = await pasvConn;
          const chunks = [];
          ds.on('data', (c) => chunks.push(c));
          ds.on('end', () => {
            const content = Buffer.concat(chunks).toString('utf8');
            if (/BADSYNTAX/.test(content)) {
              delete files[arg];           // FANUC-style: translation failed, program gone
              send('226 transfer complete'); // ...and it still says complete
            } else {
              files[arg] = content;
              send('226 transfer complete');
            }
          });
          break;
        }
        case 'QUIT': send('221 bye'); sock.end(); break;
        default: send('502 not implemented');
      }
    }

    sock.on('data', (d) => {
      buf += d.toString('latin1');
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        handle(line).catch(() => {});
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { startMockFtp };
