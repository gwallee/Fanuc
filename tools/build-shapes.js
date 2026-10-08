#!/usr/bin/env node
/* Builds js/tpshapes.js — the dictionary of instruction shapes the editor's
 * syntax check and snippet list run on — from real controller listings.
 *
 *   node tools/build-shapes.js [folder ...]
 *
 * With no folders it reads backups/ and testdata/. Every .LS under each
 * folder that has a /PROG header is mined; log exports are skipped. Each
 * instruction is normalised with the SAME function the browser uses
 * (js/tpsyntax.js), so a line matches the dictionary exactly when the
 * normaliser says it does. For every shape the dictionary keeps a count and
 * the first line seen, which the UI shows as the example.
 *
 * Re-run it whenever a backup with new instructions lands; the output is
 * committed so the browser-only mode has it too.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const S = require('../js/tpsyntax.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'js', 'tpshapes.js');
const folders = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [path.join(ROOT, 'backups'), path.join(ROOT, 'testdata')].filter((d) => fs.existsSync(d));

const shapes = new Map();
let programs = 0, lines = 0;

function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.ls$/i.test(f.name)) mine(p);
  }
}

function mine(file) {
  const src = fs.readFileSync(file, 'latin1');
  if (!/^\/PROG\b/m.test(src)) return;
  programs++;
  for (const ins of S.instructions(src)) {
    if (ins.badRow) continue;
    const t = ins.text.replace(/\s*;\s*$/, '').trim();
    if (!t || /^(?:!|\/\/)/.test(t)) continue;
    lines++;
    const shape = S.normalize(t);
    const e = shapes.get(shape);
    if (e) e[0]++; else shapes.set(shape, [1, t]);
  }
}

folders.forEach(walk);

const sorted = [...shapes.entries()].sort((a, b) => b[1][0] - a[1][0] || a[0].localeCompare(b[0]));
const dict = {
  built: new Date().toISOString().slice(0, 10),
  programs, lines, shapes: Object.fromEntries(sorted)
};

const body = JSON.stringify(dict, null, 1).replace(/\n\s*(\d+),\n\s*("(?:[^"\\]|\\.)*")\n\s*\]/g, ' $1, $2]');
fs.writeFileSync(OUT,
  '/* Instruction shapes mined from real controller listings by\n' +
  ' * tools/build-shapes.js — DO NOT EDIT, re-run the tool instead.\n' +
  ' * ' + programs + ' programs, ' + lines + ' instructions, ' + sorted.length + ' shapes. */\n' +
  '(function (global) {\n  var dict = ' + body.replace(/\n/g, '\n  ') + ';\n' +
  '  if (typeof module !== \'undefined\' && module.exports) module.exports = dict;\n' +
  '  global.TP_SHAPES = dict;\n' +
  '})(typeof window !== \'undefined\' ? window : globalThis);\n');

console.log('js/tpshapes.js: ' + programs + ' programs, ' + lines + ' instructions, ' + sorted.length + ' shapes from ' + folders.join(', '));
