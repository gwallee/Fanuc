#!/usr/bin/env node
/* Creates the FanucStudio release signing key (Ed25519). Run once:
 *
 *   node tools/release-keygen.js [--key <file>] [--force]
 *
 * Private key: %USERPROFILE%\.fanucstudio\release-signing-key.pem (default),
 * protected with a passphrase you type (asked twice; blank = unprotected).
 * Keep it private and keep a backup off this PC (e.g. a USB stick in a
 * drawer): without it no update can be published, and every PC then needs a
 * newly installed launcher. Never put it on the S: share or in git.
 *
 * Public key: launcher/release-public-key.pem in this repo (commit it). It
 * ships inside every release, and installed launchers accept only builds
 * signed by the matching private key.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { askSecret } = require('./release-common.js');

const args = process.argv.slice(2);
const keyFile = args.includes('--key') ? path.resolve(args[args.indexOf('--key') + 1]) : path.join(os.homedir(), '.fanucstudio', 'release-signing-key.pem');
const pubFile = args.includes('--public-key') ? path.resolve(args[args.indexOf('--public-key') + 1]) : path.join(__dirname, '..', 'launcher', 'release-public-key.pem');
const force = args.includes('--force');

(async () => {
  if (fs.existsSync(keyFile) && !force) {
    console.error('A signing key already exists: ' + keyFile + '\nReplacing it means every installed launcher must be reinstalled. Use --force only if you mean that.');
    process.exit(1);
  }
  let pass = process.env.FANUCSTUDIO_KEY_PASSPHRASE;
  if (pass === undefined) {
    pass = await askSecret('Passphrase for the signing key (blank = none): ');
    const again = await askSecret('Repeat the passphrase: ');
    if (pass !== again) { console.error('The passphrases differ; nothing written.'); process.exit(1); }
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const priv = privateKey.export(pass ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: pass } : { type: 'pkcs8', format: 'pem' });
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, priv, { mode: 0o600 });
  fs.mkdirSync(path.dirname(pubFile), { recursive: true });
  fs.writeFileSync(pubFile, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('Private key: ' + keyFile + (pass ? ' (passphrase protected)' : ' (NOT passphrase protected)'));
  console.log('Public key:  ' + pubFile + ' (commit this file)');
  console.log('Back up the private key somewhere off this PC. Never copy it to the share.');
})();
