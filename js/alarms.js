/* Offline FANUC alarm-code dictionary — index and lazy loader.
 *
 * This file is tiny and loaded eagerly; the alarm text itself lives in
 * js/alarms/<FCLT>.js (one file per facility, ~36 KB each) and is pulled in
 * only when a code is actually looked up. Open the app, work all day, never
 * expand an alarm: nothing here costs you anything.
 *
 * The text is fetched by tools/fetch-alarms.js from http://linuxsand.info/fanuc/
 * and reproduced for internal reference with the site owner's permission.
 *
 * Facility files are pulled in with a <script> tag rather than fetch() on
 * purpose: browser-only mode runs from file://, where fetch() is blocked by
 * CORS but script injection still works.
 *
 * If js/alarms/ is missing entirely (slim checkout), every lookup simply
 * calls back null and callers render plain text. That is not an error.
 */
(function (global) {
  'use strict';

  /* Every facility prefix the source site knows, newest list from
   * `node tools/fetch-alarms.js --list`. Kept here so a lookup for a
   * non-facility ("FOO-001") costs no request at all. */
  var FACILITIES = [
    'ACAL', 'APSH', 'ARC', 'ASBN', 'ATGP', 'ATZN', 'BBOX', 'CALM', 'CD', 'CMND',
    'CNTR', 'COND', 'COPT', 'CPMO', 'CUST', 'CVIS', 'DICT', 'DJOG', 'DMDR', 'DMER',
    'DNET', 'DX', 'ELOG', 'FILE', 'FLPY', 'FORC', 'FRSY', 'FXTL', 'HOST', 'HRTL',
    'IB-S', 'INTP', 'ISD', 'JOG', 'KALM', 'LANG', 'LECO', 'LNTK', 'LSTP', 'MACR',
    'MARL', 'MCTL', 'MEMO', 'MENT', 'MHND', 'MOTN', 'MUPS', 'NOM', 'OPTN', 'OS',
    'PALL', 'PALT', 'PICK', 'PMON', 'PNT1', 'PNT2', 'PRIO', 'PROF', 'PROG', 'PTPG',
    'PWD', 'QMGR', 'RIPE', 'ROUT', 'RPC', 'RPM', 'RTCP', 'SCIO', 'SDTL', 'SEAL',
    'SENS', 'SHAP', 'SPOT', 'SPRM', 'SRIO', 'SRVO', 'SSPC', 'SVGN', 'SYST', 'TAST',
    'TCPP', 'TG', 'THSR', 'TJOG', 'TMAT', 'TOOL', 'TPIF', 'TRAK', 'TRSV', 'VARS',
    'WEAV', 'WMAP', 'WNDW', 'XMLF'
  ];

  /* Longest first so "IB-S-001" matches IB-S, not some shorter prefix. */
  var BY_LEN = FACILITIES.slice().sort(function (a, b) { return b.length - a.length; });

  var cache = {};      // FCLT -> { "063": "detail…" }, or null when unavailable
  var waiting = {};    // FCLT -> [cb]  — dedupes concurrent loads of one facility

  /* Where js/alarms/ sits, relative to the page. Derived from our own <script>
   * so it survives being served from a subdirectory. */
  var base = 'js/alarms/';
  if (typeof document !== 'undefined') {
    var self = document.currentScript;
    if (self && self.src) base = self.src.replace(/alarms\.js(?:\?.*)?$/, 'alarms/');
  }

  /* "srvo 63", "SRVO-063", "srvo063" -> { fclt: "SRVO", num: "063" }.
   * Mirrors what the source site's own search box does, plus zero-padding. */
  function parse(code) {
    if (!code) return null;
    var s = String(code).toUpperCase().replace(/[\s_]+/g, '-').trim();
    for (var i = 0; i < BY_LEN.length; i++) {
      var f = BY_LEN[i];
      if (s.indexOf(f) !== 0) continue;
      var rest = s.slice(f.length).replace(/^-/, '');
      if (!/^\d{1,3}$/.test(rest)) continue;
      while (rest.length < 3) rest = '0' + rest;
      return { fclt: f, num: rest, code: f + '-' + rest };
    }
    return null;
  }

  /* The stored text is the site's raw detail: a title line, then "Cause:" and
   * "Remedy:" blocks, sometimes a trailing "Note:". Split for display only —
   * anything unrecognised comes back whole in .detail so no text is ever lost. */
  function split(detail) {
    var out = { title: '', cause: '', remedy: '', detail: detail || '' };
    if (!detail) return out;
    var ci = detail.search(/^Cause:/m);
    var ri = detail.search(/^Remedy:/m);
    out.title = (ci === -1 ? detail : detail.slice(0, ci)).split(/\r?\n/)[0].trim();
    if (ci !== -1) {
      out.cause = detail.slice(ci + 6, ri === -1 ? undefined : ri).trim();
    }
    if (ri !== -1) out.remedy = detail.slice(ri + 7).trim();
    return out;
  }

  function _put(fclt, data) {
    cache[fclt] = data || null;
    var q = waiting[fclt];
    delete waiting[fclt];
    if (q) q.forEach(function (cb) { cb(cache[fclt]); });
  }

  /* Pull in one facility's data file. Browser: inject a <script>. Node: plain
   * require, so test/run-tests.js can drive the same lookup path. */
  function load(fclt, cb) {
    if (Object.prototype.hasOwnProperty.call(cache, fclt)) { cb(cache[fclt]); return; }
    if (waiting[fclt]) { waiting[fclt].push(cb); return; }
    waiting[fclt] = [cb];

    if (typeof document === 'undefined') {
      var data = null;
      try { data = require('./alarms/' + fclt + '.js'); } catch (e) { data = null; }
      _put(fclt, data);
      return;
    }

    var el = document.createElement('script');
    el.src = base + fclt + '.js';
    el.async = true;
    // The file calls _put itself; these only cover it never arriving.
    el.onload = function () { if (!Object.prototype.hasOwnProperty.call(cache, fclt)) _put(fclt, null); };
    el.onerror = function () { _put(fclt, null); };
    document.head.appendChild(el);
  }

  /* lookup('SRVO-063', cb) -> cb(entry, status).
   *
   * status tells the two failures apart, which matters more than it looks:
   * "no-data" means the facility's file never arrived (not built yet, or the
   * PWA is offline and never cached it) and the answer is unknown, whereas
   * "no-code" means the dictionary has that facility and the code is simply
   * not a real alarm. Reporting the first as the second sends someone looking
   * for a fault that does not exist. */
  function lookup(code, cb) {
    var p = parse(code);
    if (!p) { cb(null, 'bad-code'); return; }
    load(p.fclt, function (data) {
      if (!data) { cb(null, 'no-data'); return; }
      var detail = data[p.num];
      if (!detail) { cb(null, 'no-code'); return; }
      var e = split(detail);
      e.code = p.code;
      cb(e, 'ok');
    });
  }

  /* True once a facility's file has been loaded (or failed) — lets the UI
   * render a known code synchronously on a re-render instead of flashing. */
  function ready(code) {
    var p = parse(code);
    return !!p && Object.prototype.hasOwnProperty.call(cache, p.fclt);
  }

  /* Only meaningful after ready(code). Returns { entry, status } so a
   * synchronous re-render can give the same answer lookup() would. */
  function peek(code) {
    var p = parse(code);
    if (!p) return { entry: null, status: 'bad-code' };
    var data = cache[p.fclt];
    if (!data) return { entry: null, status: 'no-data' };
    var detail = data[p.num];
    if (!detail) return { entry: null, status: 'no-code' };
    var e = split(detail);
    e.code = p.code;
    return { entry: e, status: 'ok' };
  }

  var api = {
    facilities: FACILITIES,
    parse: parse,
    split: split,
    lookup: lookup,
    ready: ready,
    peek: peek,
    _put: _put
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucAlarms = api;
})(typeof window !== 'undefined' ? window : globalThis);
