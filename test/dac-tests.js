/* DAC template checks (js/daccheck.js + dac-standard.json).
 * Called from run-tests.js: require('./dac-tests.js').run(check)
 *
 * Part 1 is self-contained (tiny synthetic libraries). Part 2 is the
 * regression table over the 23 controller backups in CellStudio's
 * "Project Files/Robot Backups" (the 2026-11-06 review set): expected
 * finding counts per rule per controller. It is skipped when that folder
 * is not on this machine. Regenerate the table after an intended rule
 * change with:  node js/daccheck.js "<Robot Backups>" --json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const P = require('../js/parser.js');
const A = require('../js/analyzer.js');
const L = require('../js/linter.js');
const DC = require('../js/daccheck.js');

const BACKUPS = 'C:\\Users\\bjalufka\\Desktop\\Apps\\CellStudio\\Project Files\\Robot Backups';

function lib(sources) {
  const programs = {};
  Object.keys(sources).forEach((name) => {
    // motion lines put J/L right after the colon, everything else is indented two spaces
    const body = sources[name].trim().split('\n').map((l, i) => '   ' + (i + 1) + ':' + (/^[JLCAS] /.test(l.trim()) ? '' : '  ') + l.trim() + ' ;').join('\n');
    const parsed = P.parseLS('/PROG ' + name + '\n/MN\n' + body + '\n/POS\n/END\n', name + '.LS');
    programs[parsed.name] = { parsed, analysis: A.analyzeProgram(parsed) };
  });
  return { programs, graph: A.buildCallGraph(programs), xref: A.buildGlobalXref(programs) };
}

function run(check) {
  const std = DC.loadStandard();
  const rules = (f, r) => f.filter((x) => x.rule === r);

  console.log('\n-- DAC checks: standard file --');
  check(std.requiredPrograms.length >= 12 && std.flags['101'] && std.fixedIO.DO['64'], 'dac-standard.json has required programs, the flag table and the I/O table');
  check(DC.isScratch('-BCKED8-', std) && DC.isScratch('TST_ORIGIN', std) && DC.isScratch('_TST_STUFF', std) && DC.isScratch('TEST', std) && !DC.isScratch('_TESTER_PK', std) && !DC.isScratch('_INIT', std),
    'scratch patterns match -BCKED*/TST_*/TEST and leave real programs alone');

  console.log('\n-- DAC checks: analyzer indirect writes --');
  const z = lib({
    A_ZONE_CHECK: 'R[200]=AR[3]\nF[190]=(ON)\nF[R[200]]=(F[190] AND F[191] AND F[192])',
    _BGLOGIC: 'CALL A_ZONE_CHECK(1,2,181)\nCALL A_ZONE_CHECK(3,4,182)',
    _INIT: 'FOR R[99]=17 TO 32\nDO[R[99]]=OFF\nENDFOR\nR[R[7]]=0',
    _PK: 'IF (F[181:Zone 1]),JMP LBL[999]\nIF (F[182:Zone 2]),JMP LBL[999]\nIF R[40]=1,JMP LBL[999]\nLBL[999]'
  });
  const ind = A.indirectWrites(z.programs, z.graph);
  check(ind.F && !ind.F.all && ind.F.indices[181] && ind.F.indices[182] && !ind.F.indices[183], 'F[R[200]] resolves to the constants callers pass as AR[3] (181, 182)');
  check(ind.DO && !ind.DO.all && ind.DO.indices[17] && ind.DO.indices[32] && !ind.DO.indices[33], 'DO[R[99]] inside FOR 17 TO 32 resolves to that range');
  check(ind.R && ind.R.all, 'R[R[7]] with an unknown index credits every register');
  check(z.programs._BGLOGIC.analysis.calls[0].args.join(',') === '1,2,181', 'CALL arguments are captured');
  const lintZ = L.lint(z.programs, z.graph, z.xref, null, { handSet: { registers: [], labelPatterns: [] } });
  check(!rules(lintZ, 'register-never-written').length, 'register-never-written is quiet when an unresolved R[R[n]] write exists');
  const hs = lib({ _SPD: 'IF R[4:Speed Ovr]<=0,JMP LBL[999]\n$MCR.$GENOVERRIDE=R[4:Speed Ovr]\nIF R[55:Recipe Sel]=2,JMP LBL[999]\nIF R[56:Other]=2,JMP LBL[999]\nLBL[999]' });
  const lintHs = L.lint(hs.programs, hs.graph, hs.xref, null, { handSet: { registers: [56], labelPatterns: ['Ovr', 'Recipe'] } });
  check(!rules(lintHs, 'register-never-written').length, 'hand-set registers (by label pattern and by number) are not reported as never written');
  const lintHs2 = L.lint(hs.programs, hs.graph, hs.xref, null, {});
  check(rules(lintHs2, 'register-never-written').length === 3, 'without the allowlist the same registers are reported (' + rules(lintHs2, 'register-never-written').length + ')');

  console.log('\n-- DAC checks: synthetic rules --');
  const base = {
    __MAIN: 'IF DI[1:Auto Mode]=ON,CALL __AUTO\nCALL __MANUAL',
    __AUTO: 'LBL[100]\nIF (DI[2:Start]),JMP LBL[101]\nJMP LBL[100]\nLBL[101]\nCALL _INIT\nIF (F[5:At RefPos]),JMP LBL[150]\nCALL _RECOVER\nJMP LBL[100]\nLBL[150]\nIF (F[101:Sys Chks]),CALL _SYS_CHECKS\nCALL _SPEED_OVR\nCALL _PK_PART\nJMP LBL[150]\nLBL[999]',
    __MANUAL: 'LBL[100]\nIF DI[1:Auto Mode]=ON,JMP LBL[998]\nCALL _SPEED_OVR\nR[2:Manual TaskID]=GI[1:Task ID]\nIF (R[2:Manual TaskID]=10),CALL _RECOVER\nIF (R[2:Manual TaskID]=20),CALL _TOOL_MAINT\nIF (R[2:Manual TaskID]=30),CALL _SAFE\nIF (R[2:Manual TaskID]=40),CALL _ZERO\nJMP LBL[100]\nLBL[998]\nCALL _RECOVER',
    _INIT: 'CALL _INIT_POS\nCALL _INIT_ALM',
    _INIT_ALM: 'DO[62:Recover Error]=OFF',
    _INIT_POS: 'IF (F[5:At RefPos]) THEN\nDO[38:At Lathe]=OFF\nENDIF',
    _RECOVER: 'LBL[100]\nIF (F[5:At RefPos]),JMP LBL[990]\nCALL _SAFE\nLBL[990]\nJ PR[5:Trans-Origin] 50% FINE\nLBL[995]\nCALL _INIT_POS\nLBL[999]',
    _SYS_CHECKS: 'F[104:SysChks Ran]=(ON)\nF[101:Sys Chks]=(OFF)',
    _SAFE: 'R[1:Task ID]=130', _ZERO: 'R[1:Task ID]=140', _TOOL_MAINT: 'R[1:Task ID]=120',
    _BGLOGIC: 'F[5:At RefPos]=(DO[33:At Home] OR DO[37:At Transit])\nDO[111:Robot Moving]=($MOR_GRP[1].$ROB_MOVE)',
    _SPEED_OVR: 'IF R[4:OVERRIDE]<=0,JMP LBL[999]\nIF R[4:OVERRIDE]>100,JMP LBL[999]\n$MCR.$GENOVERRIDE=R[4:OVERRIDE]\nLBL[999]',
    _PK_PART: 'DO[38:At Lathe]=ON\nIF (!F[1:Part on Gripper]),JMP LBL[404]\nF[1:Part on Gripper]=(ON)\nDO[38:At Lathe]=OFF\nLBL[404]',
    '-BCKED8-': 'CALL _OLD_THING\nF[77]=(ON)\nJMP LBL[700]'
  };
  const good = lib(base);
  const fg = DC.check(good.programs, good.graph, good.xref, null, std);
  const ids = (f) => f.map((x) => x.rule).sort().join(' ');
  check(fg.generation === 2 && !rules(fg, 'O1').length && !rules(fg, 'O2').length && !rules(fg, 'P1').length && !rules(fg, 'S1').length && !rules(fg, 'S3').length && !rules(fg, 'S4').length,
    'a template-shaped library passes O1/O2/P1/S1/S3/S4 (' + ids(fg) + ')');
  check(!fg.some((f) => ['P4', 'H1', 'N2', 'N4'].indexOf(f.rule) !== -1), 'undefined labels, unlabeled flags and stale labels are left to the Program checks (no P4/H1/N2/N4)');
  check(rules(fg, 'O3').length === 1 && rules(fg, 'O3')[0].severity === 'info', 'CALL in both loops is accepted with an Info under the BGLogic standard');
  check(rules(fg, 'H2').length === 1 && /-BCKED8-/.test(rules(fg, 'H2')[0].message) && !fg.some((f) => f.refs.some((r) => r.prog === '-BCKED8-' && f.rule !== 'H2')),
    'a -BCKED program is listed under H2 and excluded from every other rule');
  check(rules(fg, 'P5').length === 0, '_RECOVER tail with PR[Trans-Origin] move and _INIT_POS passes P5');

  const noOvr = Object.assign({}, base); delete noOvr._SPEED_OVR;
  noOvr.__AUTO = base.__AUTO.replace('CALL _SPEED_OVR\n', ''); noOvr.__MANUAL = base.__MANUAL.replace('CALL _SPEED_OVR\n', '');
  const f1 = DC.check(lib(noOvr).programs, null, null, null, std);
  check(rules(f1, 'O1').length === 1 && f1[0].severity === 'error', 'O1 Critical when nothing writes the override');
  check(!rules(f1, 'O3').length, 'O3 stays quiet when O1 already fires');

  const uncalled = Object.assign({}, base);
  uncalled.__AUTO = base.__AUTO.replace('CALL _SPEED_OVR\n', ''); uncalled.__MANUAL = base.__MANUAL.replace('CALL _SPEED_OVR\n', '');
  const f2 = DC.check(lib(uncalled).programs, null, null, null, std);
  check(rules(f2, 'O2').length === 1 && rules(f2, 'O2')[0].refs[0].prog === '_SPEED_OVR', 'O2 Critical when the override program is never called');
  check(rules(f2, 'O3').length === 2, 'O3 once for __AUTO and once for __MANUAL when neither reaches the override');

  const beforeLoop = Object.assign({}, base);
  beforeLoop.__AUTO = base.__AUTO.replace('CALL _SPEED_OVR\n', '').replace('CALL _INIT\n', 'CALL _INIT\nCALL _SPEED_OVR\n');
  const f3 = DC.check(lib(beforeLoop).programs, null, null, null, std);
  check(rules(f3, 'O3').length === 1 && /once per Start/.test(rules(f3, 'O3')[0].message), 'O3 Warning when the call sits before LBL[150] (637-520 Laser shape)');

  const bg = Object.assign({}, base); delete bg._SPEED_OVR;
  bg.__AUTO = base.__AUTO.replace('CALL _SPEED_OVR\n', ''); bg.__MANUAL = base.__MANUAL.replace('CALL _SPEED_OVR\n', '');
  bg._BGLOGIC = base._BGLOGIC + '\nIF (R[300:OVERRIDE]>100),$mcr.$genoverride=(100)\nIF (R[300:OVERRIDE]<=100 AND R[300:OVERRIDE]>0),$mcr.$genoverride=R[300:OVERRIDE]';
  const f4 = DC.check(lib(bg).programs, null, null, null, std);
  check(!rules(f4, 'O1').length && !rules(f4, 'O2').length && !rules(f4, 'O3').length && !rules(f4, 'O5').length, 'the Tending BGLogic clamp satisfies every O rule (' + ids(f4.filter((x) => x.rule[0] === 'O')) + ')');

  const force = Object.assign({}, base);
  force._GLUE = 'R[15:Temp Ovrd]=($MCR.$GENOVERRIDE)\nOVERRIDE=50%\nIF R[9]=1,JMP LBL[999]\nCALL _SAFE\n$mcr.$genoverride=R[15:Temp Ovrd]\nLBL[999]';
  force.__AUTO = base.__AUTO.replace('CALL _PK_PART', 'CALL _GLUE');
  const f5 = DC.check(lib(force).programs, null, null, null, std);
  check(rules(f5, 'O4').length === 1 && rules(f5, 'O4')[0].severity === 'warn' && rules(f5, 'O4')[0].refs[0].line === 3, 'O4 Warning for the JMP LBL[999] between the force and the restore');
  check(!rules(f5, 'O2').length && !rules(f5, 'O3').some((x) => x.severity !== 'info'), 'a save/force/restore pair is not mistaken for the override setter');

  const guard = Object.assign({}, base);
  guard._SPEED_OVR = 'IF R[4:Speed Ovr Value]<=0,JMP LBL[999]\n$mcr.$genoverride=R[4:Speed Ovr Value]\nLBL[999]';
  const f6 = DC.check(lib(guard).programs, null, null, null, std);
  check(rules(f6, 'O5').length === 1 && /skips the write/.test(rules(f6, 'O5')[0].message) && /clamp/.test(rules(f6, 'O5')[0].message), 'O5 Info: zero guard without a default and no >100 clamp');

  const noInitPos = Object.assign({}, base);
  noInitPos._INIT = 'CALL _INIT_ALM'; noInitPos._RECOVER = base._RECOVER.replace('CALL _INIT_POS\n', '');
  const f7 = DC.check(lib(noInitPos).programs, null, null, null, std);
  check(rules(f7, 'P1').length === 2 && rules(f7, 'P1').every((x) => x.severity === 'error'), 'P1 Critical twice: not from _INIT, not at the end of _RECOVER');
  check(rules(f7, 'P5').length === 1, 'P5 Info when _RECOVER has no _INIT_POS call after LBL[990]');
  const gone = Object.assign({}, noInitPos); delete gone._INIT_POS;
  const f7b = DC.check(lib(gone).programs, null, null, null, std);
  check(rules(f7b, 'P1').length === 1 && /missing/.test(rules(f7b, 'P1')[0].message) && rules(f7b, 'S1').length === 1, 'P1 + S1 when _INIT_POS is missing altogether');
  check(rules(f7b, 'P3').length === 1 && /DO\[38\]/.test(rules(f7b, 'P3')[0].message), 'P3: DO[38] "At Lathe" set by a task program with no owner');

  const noGate = Object.assign({}, base); noGate._INIT_POS = 'DO[38:At Lathe]=OFF';
  check(rules(DC.check(lib(noGate).programs, null, null, null, std), 'P2').length === 1, 'P2 Warning when _INIT_POS clears without a known-position gate');
  const forInit = Object.assign({}, base); forInit._INIT_POS = 'IF !DO[33:At Home],JMP LBL[999]\nFOR R[99:*temp]=33 TO 48\nDO[R[99]]=OFF\nENDFOR\nLBL[999]';
  check(!rules(DC.check(lib(forInit).programs, null, null, null, std), 'P3').length, 'P3 credits a FOR-loop wipe that covers the output');

  const flags = Object.assign({}, base);
  flags._FIND_TASK = 'F[8:Task Rdy]=(OFF)';   // marks the library as Gen 3, where F[5] must be At RefPos
  flags._PK_PART = base._PK_PART + '\nF[5:Recovering]=(ON)\nF[101:Sys Chks]=(ON)\nIF (F[66]),JMP LBL[404]\nIF (F[9:Sim]),JMP LBL[404]\nIF (F[171:Nest Full]),JMP LBL[404]\nF[172:Zn2-Lathe]=(ON)';
  const f9 = DC.check(lib(flags).programs, null, null, { io: [{ type: 'F', index: 66, comment: '' }, { type: 'F', index: 900, comment: 'DCS Zone 1' }] }, std);
  check(rules(f9, 'N1').length === 1 && /F\[5\]/.test(rules(f9, 'N1')[0].message), 'N1: F[5] relabeled "Recovering" (Gen 3 library)');
  check(!rules(f9, 'N3').some((x) => /F\[9/.test(x.message)) && rules(f9, 'N3').some((x) => /F\[66\]/.test(x.message)) && rules(f9, 'N3').some((x) => /F\[172/.test(x.message)),
    'N3: hand-set F[9] Sim skipped, F[66] never written and F[172] never read reported');
  check(rules(f9, 'N6').length === 1 && /F\[171:Nest Full\]/.test(rules(f9, 'N6')[0].message), 'N6: a non-zone label inside the zone block');

  const missing = Object.assign({}, base); delete missing._ZERO; missing._TL_MAINT = base._TOOL_MAINT; delete missing._TOOL_MAINT;
  missing.__MANUAL = base.__MANUAL.replace('CALL _TOOL_MAINT', 'CALL _TL_MAINT').replace('IF (R[2:Manual TaskID]=40),CALL _ZERO\n', '');
  const f10 = DC.check(lib(missing).programs, null, null, null, std);
  check(rules(f10, 'S1').length === 1 && /_ZERO/.test(rules(f10, 'S1')[0].message), 'S1 Critical: _ZERO missing');
  check(rules(f10, 'S5').length === 1 && /_TL_MAINT/.test(rules(f10, 'S5')[0].message) && !rules(f10, 'S1').some((x) => /_TOOL_MAINT/.test(x.message)), 'S5 Info: _TL_MAINT accepted as the _TOOL_MAINT variant');
  check(rules(f10, 'S3').length === 1 && /task 40/.test(rules(f10, 'S3')[0].message), 'S3: manual task 40 no longer dispatches to _ZERO');

  const io = Object.assign({}, base);
  io._PK_PART = base._PK_PART + '\nDO[64:Prompt Shown]=ON\n!***Ver:P-00, 2022-02-28, DG***';
  const f11 = DC.check(lib(io).programs, null, null, null, std);
  check(rules(f11, 'H4').some((x) => /DO\[64\]/.test(x.message) && x.severity === 'warn'), 'H4 Warning: DO[64] labeled outside the I/O standard');
  check(rules(f11, 'H3').length === 1 && rules(f11, 'H3')[0].severity === 'info' && /P-00 2022-02-28/.test(rules(f11, 'H3')[0].message), 'H3 Info: Ver:P-00 header reported');

  console.log('\n-- DAC checks: 23-controller regression table --');
  if (!fs.existsSync(BACKUPS)) {
    console.log('  --  ' + BACKUPS + ' not on this machine; table skipped');
    return;
  }
  const EXPECT = [
  ["637-520/Laser", 2, {"N6":2,"O3":2,"P1":1,"P2":1,"H2":1,"N3":2,"O5":1,"S3":1}],
  ["637-520/Picking", 2, {"O3":1,"P1":1,"P2":1,"H2":1,"N3":2,"N6":1,"O5":1,"S3":1}],
  ["827-008", 1, {"P1":1,"S1":4,"H4":17,"O3":1,"O4":3,"S3":3,"S4":1,"H2":1,"N3":2,"O5":1,"S5":1}],
  ["827-012/Robot-1", 2, {"O2":1,"H4":2,"O3":2,"P1":1,"P3":1,"S2":1,"H2":1,"N6":1,"O5":1}],
  ["827-012/Robot-2", 2, {"O2":1,"P1":2,"H4":1,"O3":2,"P2":1,"H2":1,"N6":1,"O5":1,"P5":1}],
  ["827-012/Robot-3", 2, {"O2":1,"P1":2,"N1":1,"O3":2,"P3":1,"H2":1,"H4":3,"N3":3,"N6":1,"O5":1,"P5":1}],
  ["827-039/bkup_rob1", 2, {"O2":1,"P1":1,"O3":2,"P2":1,"P3":1,"S2":1,"H2":1,"N3":10,"N6":1,"O5":1,"P5":1}],
  ["827-039/bkup_rob2", 2, {"O3":1,"P1":1,"P2":1,"P3":1,"S2":1,"H2":1,"N3":2,"N6":1,"O5":1,"P5":1}],
  ["827-039/bkup_rob3", 2, {"O2":1,"P1":2,"O3":2,"P2":1,"S2":1,"H2":1,"N6":1,"O5":1,"P5":1}],
  ["827-039/bkup_rob4", 2, {"P1":1,"O3":1,"P2":1,"H2":1,"N6":1,"O5":1,"P5":1}],
  ["934-103/Cleaning", 3, {"O2":1,"P1":1,"S1":1,"O3":2,"H2":1,"H3":1,"N3":8,"N5":1,"O5":1,"S5":1}],
  ["934-103/GlueRobs/Rob1", 2, {"N1":2,"O3":1,"P1":1,"P2":1,"H2":1,"N3":10,"N6":1,"O5":1,"S3":1}],
  ["934-103/GlueRobs/Rob2", 2, {"P1":1,"P2":1,"H2":1,"H3":1,"N3":6,"N6":1,"O3":1,"O4":1,"O5":1}],
  ["934-103/GlueRobs/Rob3", 2, {"N1":2,"O3":1,"P1":1,"P2":1,"H2":1,"N3":5,"N6":1,"O5":1,"S3":1}],
  ["934-103/GlueRobs/Rob4", 2, {"P1":1,"P2":1,"H2":1,"H3":1,"N3":6,"N6":1,"O3":1,"O4":1,"O5":1}],
  ["934-103/GlueSide", 3, {"O3":1,"H2":1,"H3":1,"H4":3,"N3":14,"N5":1,"O5":1,"S5":1}],
  ["934-103/MagnetizeSide", 3, {"O3":1,"P2":1,"S2":2,"H2":1,"H3":1,"H4":3,"N3":13,"N5":1,"O5":1,"S5":1}],
  ["A73-007/LeakTest", 2, {"P1":1,"O3":2,"P2":1,"H2":1,"H3":1,"N3":1,"O5":1,"S3":1}],
  ["A73-007/Tending", 3, {"N1":2,"H2":1,"H3":1,"N3":9,"N5":1,"O4":1}],
  ["B26-001 Funnel/2025-06-05_2-Leaving", 3, {"O1":1,"H2":1,"H3":1,"N3":12,"N5":1,"O4":1}],
  ["B26-001 Load", 3, {"O1":1,"P2":1,"S2":1,"H2":1,"H3":1,"N3":7,"N5":1}],
  ["B26-001 Unload", 2, {"O3":1,"H2":1,"H3":1,"N3":8,"P5":1}],
  ["B72-004 CDI", 3, {"O1":1,"H2":1,"H3":1,"N3":15,"N5":1}],
  ];
  const dirs = DC.controllerDirs(BACKUPS);
  check(dirs.length === EXPECT.length, EXPECT.length + ' controller folders found (' + dirs.length + ')');
  const findDir = (id) => dirs.find((d) => path.relative(BACKUPS, d).replace(/\\/g, '/') === id);
  const results = {};
  EXPECT.forEach(([id, gen, counts]) => {
    const dir = findDir(id);
    if (!dir) { check(false, id + ' folder present'); return; }
    const l = DC.loadBackup(dir);
    const f = DC.check(l.programs, l.graph, l.xref, l.extern, std);
    results[id] = f;
    const got = {};
    f.forEach((x) => { got[x.rule] = (got[x.rule] || 0) + 1; });
    const diff = [];
    Object.keys(Object.assign({}, counts, got)).sort().forEach((r) => { if ((counts[r] || 0) !== (got[r] || 0)) diff.push(r + ' ' + (counts[r] || 0) + '→' + (got[r] || 0)); });
    check(f.generation === gen && !diff.length, id + ': Gen ' + gen + ', ' + f.length + ' findings' + (diff.length ? ' — changed: ' + diff.join(', ') : '') + (f.generation !== gen ? ' — generation now ' + f.generation : ''));
  });
  // headline findings from the review
  const r = (id) => results[id] || [];
  check(rules(r('B72-004 CDI'), 'O1').length === 1 && rules(r('B26-001 Load'), 'O1').length === 1, 'Load and CDI → O1 (no override write)');
  check(['934-103/Cleaning', '827-012/Robot-1', '827-012/Robot-2', '827-012/Robot-3', '827-039/bkup_rob1', '827-039/bkup_rob3'].every((id) => rules(r(id), 'O2').length === 1),
    'Cleaning, 827-012 ×3, 827-039 rob1/rob3 → O2 (override program never called)');
  check(['827-008', '934-103/Cleaning'].every((id) => rules(r(id), 'P1').some((x) => /missing/.test(x.message))), '827-008 and Cleaning → P1 (_INIT_POS missing)');
  check(['827-012/Robot-2', '827-012/Robot-3', '827-039/bkup_rob3'].every((id) => rules(r(id), 'P1').some((x) => /_RECOVER never calls/.test(x.message))), '827-012 R2/R3 and 827-039 rob3 → P1 (not called from _RECOVER)');
  check(!rules(r('827-039/bkup_rob2'), 'N3').some((x) => /F\[18[1-5]/.test(x.message)), '827-039 rob2 zone flags 181–185 are no longer "never written" (A_ZONE_CHECK F[R[200]] credited)');
  check(!Object.keys(results).some((id) => results[id].some((f) => ['P4', 'H1', 'N2', 'N4'].indexOf(f.rule) !== -1)), 'no backup reports a dropped rule');
}

module.exports = { run };
