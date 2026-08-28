#!/usr/bin/env node
/* Builds the portable Windows release:
 *   dist/FanucStudio-portable-win-x64.zip
 * containing the whole app PLUS its only dependency — the Node.js runtime —
 * so it runs on any Windows PC by extracting and double-clicking
 * "Start FANUC Studio.bat". Nothing to install.
 *
 * Run on Linux/macOS (uses curl, unzip, zip):  node tools/build-release.js
 * The Node runtime download is pinned and cached under dist/.
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE_VERSION = 'v20.18.3';
const NODE_ZIP = `node-${NODE_VERSION}-win-x64.zip`;
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_ZIP}`;

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'FanucStudio');
const OUT = path.join(DIST, 'FanucStudio-portable-win-x64.zip');

const APP_FILES = [
  'index.html', 'server.js', 'README.md', 'Start FANUC Studio.bat', 'start.sh',
  'css', 'js', 'lib', 'samples'
];

function sh(cmd, opts) {
  execSync(cmd, Object.assign({ stdio: 'inherit' }, opts));
}

fs.mkdirSync(DIST, { recursive: true });

// 1. fetch the pinned Node runtime (cached)
const nodeZipPath = path.join(DIST, NODE_ZIP);
if (!fs.existsSync(nodeZipPath)) {
  console.log('Downloading ' + NODE_URL);
  sh(`curl -fSL -o "${nodeZipPath}" "${NODE_URL}"`);
} else {
  console.log('Using cached ' + NODE_ZIP);
}

// 2. stage the app
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const f of APP_FILES) {
  fs.cpSync(path.join(ROOT, f), path.join(STAGE, f), { recursive: true });
}

// 3. add the runtime (just node.exe — the rest of the dist is npm tooling)
fs.mkdirSync(path.join(STAGE, 'runtime'), { recursive: true });
sh(`unzip -o -q "${nodeZipPath}" "node-${NODE_VERSION}-win-x64/node.exe" "node-${NODE_VERSION}-win-x64/LICENSE" -d "${DIST}"`);
fs.copyFileSync(path.join(DIST, `node-${NODE_VERSION}-win-x64`, 'node.exe'), path.join(STAGE, 'runtime', 'node.exe'));
fs.copyFileSync(path.join(DIST, `node-${NODE_VERSION}-win-x64`, 'LICENSE'), path.join(STAGE, 'runtime', 'NODE-LICENSE.txt'));
fs.rmSync(path.join(DIST, `node-${NODE_VERSION}-win-x64`), { recursive: true, force: true });

// 4. a short read-me for whoever gets the zip
fs.writeFileSync(path.join(STAGE, 'READ ME FIRST.txt'), [
  'FANUC TP Program Studio - portable build',
  '',
  'Everything is in this folder, including the Node.js runtime.',
  'Nothing to install.',
  '',
  '1. Extract this whole folder somewhere (e.g. C:\\Tools\\FanucStudio).',
  '   Do not run it from inside the ZIP.',
  '2. Double-click "Start FANUC Studio.bat".',
  '   A console window opens (keep it open - closing it stops the bridge)',
  '   and your browser opens the app at http://localhost:8642.',
  '3. If Windows Firewall asks about Node, allow it on Private networks',
  '   (needed for robot access and for using the app from your phone at',
  '   http://<this-pc-ip>:8642).',
  '',
  'Offline file viewing only? Double-clicking index.html also works,',
  'without the bridge (no robot access that way).',
  '',
  'Robot access reads/writes over the controller network - the PC must be',
  'on the same network as the robot, like with FileZilla.',
  ''
].join('\r\n'));

// 5. zip it
fs.rmSync(OUT, { force: true });
sh(`cd "${DIST}" && zip -r -q "${OUT}" FanucStudio`);
const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
console.log('\nBuilt ' + OUT + ' (' + mb + ' MB)');
console.log('Contains app + Node ' + NODE_VERSION + ' runtime — extract and double-click the .bat.');
