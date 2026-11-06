#!/usr/bin/env node
/* Build a portable Windows x64 distribution, with no npm dependencies.
 * Windows: double-click "Build Distribution.bat".
 * Any platform: node tools/build-release.js [--offline]
 * Windows uses built-in PowerShell; Linux/macOS use curl, unzip and zip.
 */
'use strict';
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Update the version AND checksum together, from the official release:
// https://nodejs.org/en/blog/release/v24.22.1
const NODE_VERSION = 'v24.22.1';
const NODE_SHA256 = 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5';
const NODE_FOLDER = `node-${NODE_VERSION}-win-x64`;
const NODE_ZIP = `${NODE_FOLDER}.zip`;
const NODE_URL = `https://nodejs.org/dist/${NODE_VERSION}/${NODE_ZIP}`;
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'FanucStudio-portable-win-x64.zip');
const ZIP_HELPER = path.join(__dirname, 'release-zip.ps1');
const APP_FILES = [
  'index.html', 'server.js', 'README.md', 'WISHLIST.md', 'Start FANUC Studio.bat',
  'Start FANUC Studio hidden.vbs', 'start.sh', 'manifest.webmanifest',
  'sw.js', 'FANUC Studio.ico', 'dac-standard.json', 'css', 'js', 'lib', 'icons'
];

function run(file, args, options) {
  return execFileSync(file, args, Object.assign({ stdio: 'inherit', windowsHide: true }, options));
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function powershell(action, source, destination) {
  run('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', ZIP_HELPER, '-Action', action, '-Source', source,
    '-Destination', destination, '-RuntimeFolder', NODE_FOLDER
  ]);
}

async function runtimeArchive(offline, scratch) {
  const cached = path.join(DIST, NODE_ZIP);
  if (fs.existsSync(cached)) {
    if (await sha256(cached) !== NODE_SHA256) {
      throw new Error(`Runtime checksum mismatch: ${cached}\nRemove that cached file and build again with internet access.`);
    }
    console.log('Using verified cached runtime: ' + NODE_ZIP);
    return cached;
  }
  if (offline) {
    throw new Error(`Offline build needs ${cached}\nRun once with internet access, or copy the official runtime ZIP there.`);
  }
  console.log('Downloading ' + NODE_URL);
  const partial = path.join(scratch, NODE_ZIP);
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  run(curl, [
    '--fail', '--location', '--retry', '2', '--connect-timeout', '20',
    '--max-time', '300', '--proto', '=https', '--proto-redir', '=https',
    '--output', partial, NODE_URL
  ]);
  if (await sha256(partial) !== NODE_SHA256) {
    throw new Error('Downloaded runtime failed its SHA-256 check; it will not be packaged.');
  }
  fs.renameSync(partial, cached);
  return cached;
}

function addRuntime(archive, stage) {
  const runtime = path.join(stage, 'runtime');
  fs.mkdirSync(runtime);
  if (process.platform === 'win32') {
    powershell('ExtractRuntime', archive, runtime);
    const actual = run(path.join(runtime, 'node.exe'), ['-p', 'process.version + " " + process.arch'], { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (actual !== NODE_VERSION + ' x64') throw new Error('Unexpected bundled runtime: ' + actual);
  } else {
    for (const [entry, name] of [['node.exe', 'node.exe'], ['LICENSE', 'NODE-LICENSE.txt']]) {
      const fd = fs.openSync(path.join(runtime, name), 'w');
      try {
        run('unzip', ['-p', archive, NODE_FOLDER + '/' + entry], { stdio: ['ignore', fd, 'inherit'] });
      } finally {
        fs.closeSync(fd);
      }
    }
  }
  for (const name of ['node.exe', 'NODE-LICENSE.txt']) {
    if (!fs.statSync(path.join(runtime, name)).size) throw new Error('Missing runtime file: ' + name);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node tools/build-release.js [--offline]');
    console.log('Builds dist/FanucStudio-portable-win-x64.zip with a bundled Node runtime.');
    console.log('--offline requires the verified runtime ZIP already cached in dist/.');
    return;
  }
  for (const arg of args) {
    if (arg !== '--offline') throw new Error('Unknown option: ' + arg + ' (use --help)');
  }
  // Check inputs before downloading or changing any output.
  for (const name of APP_FILES) {
    if (!fs.existsSync(path.join(ROOT, name))) throw new Error('Missing app file: ' + name);
  }
  const versionSource = fs.readFileSync(path.join(ROOT, 'js', 'version.js'), 'utf8');
  const match = versionSource.match(/FANUC_STUDIO_BUILD\s*=\s*['"]([^'"]+)['"]/);
  if (!match) throw new Error('Cannot read the app build from js/version.js');
  const build = match[1];
  fs.mkdirSync(DIST, { recursive: true });
  // Work only in a unique disposable folder. A failed build keeps the last ZIP,
  // and never deletes an extracted app that someone may have started using.
  const scratch = fs.mkdtempSync(path.join(DIST, '.release-'));
  if (path.dirname(scratch) !== DIST) throw new Error('Staging folder must be inside dist/.');
  try {
    const archive = await runtimeArchive(args.includes('--offline'), scratch);
    const stage = path.join(scratch, 'FanucStudio');
    fs.mkdirSync(stage);
    console.log('Packaging FANUC Studio ' + build + '...');
    for (const name of APP_FILES) {
      fs.cpSync(path.join(ROOT, name), path.join(stage, name), {
        recursive: true,
        filter(source) {
          if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Distribution files must not be links: ' + source);
          return true;
        }
      });
    }
    addRuntime(archive, stage);
    fs.writeFileSync(path.join(stage, 'build-info.json'), JSON.stringify({
      app: 'FANUC TP Program Studio', build, platform: 'win-x64',
      node: NODE_VERSION, builtAt: new Date().toISOString()
    }, null, 2) + '\n');
    fs.writeFileSync(path.join(stage, 'READ ME FIRST.txt'), [
      'FANUC TP Program Studio - portable Windows x64 distribution',
      build + ' / Node.js ' + NODE_VERSION,
      '',
      'Everything is included. No Node.js installation or internet required to run.',
      '',
      '1. Extract the entire FanucStudio folder to a writable location,',
      '   for example C:\\Tools\\FanucStudio. Do not run inside the ZIP.',
      '2. Double-click "Start FANUC Studio.bat".',
      '   Keep its console window open while using the app.',
      '   Your browser opens http://localhost:8642.',
      '3. Close the console window to stop the bridge.',
      '',
      'For phone access, allow the bridge on the appropriate Windows Firewall',
      'network and open http://<this-pc-ip>:8642 on the same network.',
      'Robot access requires a network connection to the controller.',
      '',
      'For an app window and taskbar icon, open the running app in Chrome or',
      'Edge and use its install option. Running the launcher also registers',
      'the fanucstudio:// link used by the app\'s Start bridge button.',
      '',
      'For offline files only, double-click index.html.',
      '',
      'Saved robots, settings and backups are created in this extracted folder.',
      'To update, stop the bridge and replace the app files here, keeping',
      'robots.json, settings.json and backups/. Back up this folder first.',
      'See README.md for more features and instructions.',
      ''
    ].join('\r\n'));
    const zip = path.join(scratch, path.basename(OUT));
    if (process.platform === 'win32') {
      powershell('CreateDistribution', stage, zip);
    } else {
      run('zip', ['-r', '-q', zip, 'FanucStudio'], { cwd: scratch });
    }
    const digest = await sha256(zip);
    const checksum = path.join(scratch, path.basename(OUT) + '.sha256');
    fs.writeFileSync(checksum, digest + '  ' + path.basename(OUT) + '\n');
    fs.renameSync(zip, OUT);
    fs.renameSync(checksum, OUT + '.sha256');
    const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
    console.log('\nBuilt ' + OUT + ' (' + mb + ' MB)');
    console.log('Share this ZIP. Extract it, then double-click "Start FANUC Studio.bat".');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('\nBuild failed: ' + error.message);
  process.exitCode = 1;
});
