/* Renaming an item on a FANUC controller.
 *
 * A register's name IS its comment: R[1:Task ID] is R[1] plus the comment held
 * in the controller's own table, and every listing the robot writes is
 * generated from that table. So renaming means writing that comment.
 *
 * The robot already has a page for it — its built-in comment tool at
 * /KAREL/COMMAIN — and that page writes with a plain GET:
 *
 *   /karel/ComSet?sComment=<text>&sIndx=<n>&sFc=<code>
 *
 * The codes in CODES were read off that page's own klserver.js handlers rather
 * than guessed, so they are the controller's numbers and not ours. `max` is
 * the maxlength the controller puts on its own input for that type, and `file`
 * is what to re-read afterwards to prove the rename landed.
 *
 * Types the comment tool does not offer (UI, UO, SI, SO, WI, WO, M) are
 * deliberately absent, so asking to rename one is refused rather than sent.
 *
 * Zero dependencies beyond the .VA/.DG parsers.
 */
'use strict';
const VA = require('../js/vaparse.js');

const CODES = {
  R:    { fc: 1,  max: 16, file: 'NUMREG.VA' },
  PR:   { fc: 3,  max: 16, file: 'POSREG.VA' },
  SR:   { fc: 14, max: 16, file: 'STRREG.VA' },
  UALM: { fc: 4,  max: 29, file: null },        // no ASCII file exports these
  RI:   { fc: 6,  max: 24, file: 'IOSTATE.DG' },
  RO:   { fc: 7,  max: 24, file: 'IOSTATE.DG' },
  DI:   { fc: 8,  max: 24, file: 'IOSTATE.DG' },
  DO:   { fc: 9,  max: 24, file: 'IOSTATE.DG' },
  GI:   { fc: 10, max: 24, file: 'IOSTATE.DG' },
  GO:   { fc: 11, max: 24, file: 'IOSTATE.DG' },
  AI:   { fc: 12, max: 24, file: 'IOSTATE.DG' },
  AO:   { fc: 13, max: 24, file: 'IOSTATE.DG' },
  F:    { fc: 19, max: 24, file: 'IOSTATE.DG' }
};

const MAX_INDEX = 9999;

/* Everything the request has to get right, in one place, so a bad rename is
 * refused by the bridge instead of sent to a controller.
 * Returns { url, spec, key } to send, or { error } to refuse. */
function plan(type, index, text) {
  const kind = String(type == null ? '' : type).toUpperCase();
  const spec = CODES[kind];
  if (!spec) return { error: 'the controller offers no comment write for ' + (kind || 'that type') };
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 1 || idx > MAX_INDEX) {
    return { error: 'index must be a whole number from 1 to ' + MAX_INDEX };
  }
  const comment = String(text == null ? '' : text);
  const bad = checkComment(comment, spec.max);
  if (bad) return { error: bad };
  return {
    spec,
    kind,
    index: idx,
    comment,
    key: kind + '[' + idx + ']',
    url: '/karel/ComSet?sComment=' + encodeURIComponent(comment) + '&sIndx=' + idx + '&sFc=' + spec.fc
  };
}

/* A comment written to the controller comes back out wrapped in quotes in
 * NUMREG.VA and in brackets in every listing — R[1:Task ID] — so a quote or a
 * bracket would corrupt the very files this app reads back. The controller is
 * an iso-8859-1 machine and its own pendant comments are ASCII, so anything
 * outside printable ASCII is refused here rather than encoded and hoped for. */
function checkComment(text, max) {
  if (text.length > max) return 'that comment is ' + text.length + ' characters — the controller allows ' + max;
  if (/[^\x20-\x7e]/.test(text)) return 'a comment can only hold plain printable ASCII';
  if (/['"[\]]/.test(text)) return 'a comment cannot contain quotes or square brackets — the controller writes it back inside both';
  return null;
}

/* What the controller ACTUALLY holds for one item, read out of the file it
 * lives in. null means the item is not in that file at all. */
function storedComment(file, content, type, index) {
  let rows;
  if (file === 'NUMREG.VA') rows = VA.parseNumreg(content);
  else if (file === 'STRREG.VA') rows = VA.parseStrreg(content);
  else if (file === 'POSREG.VA') rows = VA.parsePosreg(content).filter((r) => r.group === 1);
  else if (file === 'IOSTATE.DG') rows = VA.parseIOState(content).filter((r) => r.type === type);
  else return null;
  const hit = rows.find((r) => r.index === index);
  return hit ? hit.comment : null;
}

/* Setting a numeric register's VALUE. The same comment tool does it from its
 * Numeric Registers page (ComGet?sFc=28): each value box calls
 *
 *   sendRegValue(this.value, 'iValN', 2)
 *     -> /karel/ComSet?sValue=<v>&sIndx=<n>&sRealFlag=<v.indexOf('.')>&sFc=2
 *
 * with maxlength="16" on the box — read off a V9.x controller's klserver.js
 * and page markup, not guessed. sRealFlag is literally the position of the
 * decimal point (-1 = integer), so it is computed the same way here.
 *
 * Only R[n]. A value write changes what a running program reads, so the
 * format is strict: an optional minus, digits, an optional fraction. No
 * exponent, no leading '.', nothing the page itself would not have sent. */
const REG_VALUE_FC = 2;
const REG_VALUE_MAX = 16;
const INT_MIN = -2147483648, INT_MAX = 2147483647;

function planRegValue(index, value) {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 1 || idx > MAX_INDEX) {
    return { error: 'index must be a whole number from 1 to ' + MAX_INDEX };
  }
  const v = String(value == null ? '' : value).trim();
  if (!v) return { error: 'enter a value' };
  if (v.length > REG_VALUE_MAX) return { error: 'the controller takes at most ' + REG_VALUE_MAX + ' characters' };
  if (!/^-?\d+(\.\d+)?$/.test(v)) return { error: 'a register value is a number like 12, -3 or 1.5' };
  const real = v.indexOf('.') !== -1;
  const num = Number(v);
  if (!real && (num < INT_MIN || num > INT_MAX)) return { error: 'an integer register holds ' + INT_MIN + ' to ' + INT_MAX };
  if (real && !isFinite(Math.fround(num))) return { error: 'that is too large for a real register' };
  return {
    index: idx,
    value: v,
    num,
    real,
    key: 'R[' + idx + ']',
    url: '/karel/ComSet?sValue=' + encodeURIComponent(v) + '&sIndx=' + idx +
         '&sRealFlag=' + v.indexOf('.') + '&sFc=' + REG_VALUE_FC
  };
}

/* What NUMREG.VA says R[index] holds now (null = not in the file). */
function storedRegValue(content, index) {
  const hit = VA.parseNumreg(content).find((r) => r.index === index);
  return hit ? hit.value : null;
}

/* Does the stored value match what was sent? A real register is a 32-bit
 * float, so 0.1 comes back as 0.1000000015; compare at that precision. */
function regValueMatches(stored, num) {
  if (stored === null || stored === undefined || !isFinite(stored)) return false;
  return Math.fround(stored) === Math.fround(num) || Math.abs(stored - num) <= Math.abs(num) * 1e-6;
}

module.exports = {
  CODES, MAX_INDEX, plan, checkComment, storedComment,
  REG_VALUE_FC, planRegValue, storedRegValue, regValueMatches
};
