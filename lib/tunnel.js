/* Optional tunnel for robot connections: a SOCKS5 proxy on this PC (an SSH
 * "-D" tunnel through a machine that can reach the robots) used in place of
 * a route of this PC's own. Zero dependencies.
 *
 *   tunnel.configure('127.0.0.1:1080');      // or '' for none
 *   const sock = tunnel.connect(host, port); // a net.Socket either way
 *
 * A robot is reached through the proxy only when all of these hold:
 *   - a proxy is configured,
 *   - it is listening right now (checked every few seconds, so closing the
 *     tunnel puts everything back on the direct path by itself),
 *   - the robot is not on one of this PC's own subnets (shop-floor robots
 *     on the LAN are never sent the long way round).
 * Otherwise connect() is exactly net.createConnection().
 *
 * The proxied socket behaves like a direct one: 'connect' fires once the
 * proxy has reached the robot, anything written before that is held, and a
 * refusal by the proxy arrives as an ordinary 'error'. Nothing is retried.
 * socket.tunnelTarget holds the robot's address, because remoteAddress on a
 * proxied socket is the proxy's.
 */
'use strict';
const net = require('net');
const os = require('os');

const CHECK_MS = 4000;
/* How long the proxy gets to reach the robot. A direct connect is bounded by
 * the operating system; through the proxy nothing else bounds this step. */
const REACH_MS = 15000;
const SOCKS_ERRORS = {
  1: 'general failure', 2: 'not allowed', 3: 'network unreachable', 4: 'host unreachable',
  5: 'connection refused', 6: 'timed out', 7: 'command not supported', 8: 'address type not supported'
};

let proxy = null;     // { host, port } or null
let up = false;       // is the proxy listening
let timer = null;

function parse(text) {
  const m = /^\s*(?:socks5?:\/\/)?([A-Za-z0-9.-]+):(\d{1,5})\s*$/.exec(String(text || ''));
  if (!m || +m[2] < 1 || +m[2] > 65535) return null;
  return { host: m[1], port: +m[2] };
}

function check() {
  if (!proxy) { up = false; return Promise.resolve(false); }
  return new Promise((resolve) => {
    const target = proxy;
    const s = net.createConnection({ host: target.host, port: target.port });
    const done = (ok) => {
      s.destroy();
      if (proxy === target) {
        if (ok !== up) console.log('[bridge] tunnel ' + target.host + ':' + target.port + (ok ? ' is open: robots on no subnet of this PC go through it' : ' is closed: robots are reached directly'));
        up = ok;
      }
      resolve(ok);
    };
    s.setTimeout(1500, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/* Set (or clear) the proxy. Resolves once its state is known. */
function configure(text) {
  proxy = parse(text);
  up = false;
  if (timer) { clearInterval(timer); timer = null; }
  if (!proxy) return Promise.resolve(false);
  timer = setInterval(check, CHECK_MS);
  timer.unref();
  return check();
}

function ipv4ToInt(ip) {
  const p = String(ip).split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    if (!/^\d{1,3}$/.test(part) || +part > 255) return null;
    n = n * 256 + (+part);
  }
  return n;
}

/* Loopback, or an address on a subnet one of this PC's adapters is on. */
function isLocal(host) {
  if (host === 'localhost') return true;
  const addr = ipv4ToInt(host);
  if (addr === null) return false;
  if (Math.floor(addr / 16777216) === 127) return true;
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const a of ifaces[name] || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const own = ipv4ToInt(a.address);
      const mask = ipv4ToInt(a.netmask);
      if (own === null || mask === null || mask === 4294967295) continue;   // a /32 is a point-to-point VPN end, not a subnet
      const size = 4294967296 - mask;
      if (Math.floor(addr / size) === Math.floor(own / size)) return true;
    }
  }
  return false;
}

function via(host) {
  return !!(proxy && up && !isLocal(host));
}

function status() {
  return { proxy: proxy ? proxy.host + ':' + proxy.port : null, up: !!(proxy && up) };
}

function connect(host, port) {
  if (!via(host)) return net.createConnection({ host: host, port: port });

  const sock = net.createConnection({ host: proxy.host, port: proxy.port });
  sock.tunnelTarget = host;
  const emit = sock.emit;
  const write = sock.write;
  const end = sock.end;
  const held = [];          // what the caller wrote or ended before the robot was reached
  let stage = 'greeting';
  let buf = Buffer.alloc(0);

  /* The proxy's replies are read in paused mode: a socket nobody has put a
   * 'data' listener on yet does not flow, and one that somebody has must not
   * be handed the handshake. While this listener is on, no 'data' fires. */
  const onReadable = () => {
    let chunk;
    while ((stage === 'greeting' || stage === 'reply') && (chunk = sock.read()) !== null) {
      buf = Buffer.concat([buf, chunk]);
      feed();
    }
  };
  const restore = () => { clearTimeout(deadline); sock.emit = emit; sock.write = write; sock.end = end; sock.removeListener('readable', onReadable); };
  const fail = (message) => {
    restore();
    stage = 'failed';
    sock.destroy(new Error('tunnel: ' + message));
  };

  sock.write = function (chunk, encoding, cb) {
    held.push(['write', chunk, typeof encoding === 'string' ? encoding : undefined, typeof encoding === 'function' ? encoding : cb]);
    return true;
  };
  sock.end = function (chunk, encoding, cb) {
    held.push(['end', chunk, typeof encoding === 'string' ? encoding : undefined, typeof encoding === 'function' ? encoding : cb]);
    return sock;
  };

  const request = () => {
    const ip = ipv4ToInt(host);
    const portBytes = Buffer.from([(port >> 8) & 255, port & 255]);
    const addr = ip !== null
      ? Buffer.concat([Buffer.from([1]), Buffer.from(host.split('.').map(Number))])
      : Buffer.concat([Buffer.from([3, Buffer.byteLength(host)]), Buffer.from(host)]);
    write.call(sock, Buffer.concat([Buffer.from([5, 1, 0]), addr, portBytes]));
  };

  const feed = () => {
    if (stage === 'greeting') {
      if (buf.length < 2) return;
      if (buf[0] !== 5 || buf[1] !== 0) return fail('the proxy at ' + proxy.host + ':' + proxy.port + ' is not an open SOCKS5 proxy');
      buf = buf.subarray(2);
      stage = 'reply';
      request();
    }
    if (stage === 'reply') {
      if (buf.length < 5) return;
      if (buf[0] !== 5) return fail('unexpected reply from the proxy');
      if (buf[1] !== 0) return fail('could not reach ' + host + ':' + port + ' (' + (SOCKS_ERRORS[buf[1]] || 'error ' + buf[1]) + ')');
      const need = 4 + (buf[3] === 1 ? 4 : buf[3] === 4 ? 16 : buf[3] === 3 ? 1 + buf[4] : 0) + 2;
      if (buf[3] !== 1 && buf[3] !== 3 && buf[3] !== 4) return fail('unexpected reply from the proxy');
      if (buf.length < need) return;
      const rest = buf.subarray(need);
      stage = 'open';
      if (rest.length) sock.unshift(rest);   // the robot's first bytes, back in line for the caller
      restore();
      emit.call(sock, 'connect');
      emit.call(sock, 'ready');
      for (const h of held) {
        if (h[0] === 'write') write.call(sock, h[1], h[2], h[3]);
        else end.call(sock, h[1], h[2], h[3]);
      }
    }
  };

  /* Until the robot is reached, the caller must not see the proxy's own
   * connect. Everything else (error, timeout, close) passes straight through. */
  sock.emit = function (event) {
    if (stage === 'open' || stage === 'failed') return emit.apply(sock, arguments);
    if (event === 'connect') {
      write.call(sock, Buffer.from([5, 1, 0]));   // SOCKS5, one method: no authentication
      // net.Socket starts reading from a 'connect' listener of its own, which
      // has just been kept from firing; start it the way that listener would.
      sock._read(sock.readableHighWaterMark);
      return true;
    }
    if (event === 'ready') return true;
    // read() in onReadable announces each chunk it returns to any 'data'
    // listener the caller already has; those chunks are the proxy's.
    if (event === 'data') return true;
    if (event === 'end') {
      fail('the proxy closed the connection before ' + host + ':' + port + ' was reached');
      return true;
    }
    return emit.apply(sock, arguments);
  };
  sock.on('readable', onReadable);
  const deadline = setTimeout(() => {
    if (stage === 'greeting' || stage === 'reply') fail('no answer reaching ' + host + ':' + port + ' within ' + REACH_MS / 1000 + 's');
  }, REACH_MS);
  sock.once('close', () => clearTimeout(deadline));
  return sock;
}

module.exports = { configure, connect, status, via, isLocal, parse, check };
