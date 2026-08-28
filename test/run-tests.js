#!/usr/bin/env node
/* Sanity tests for the parser, analyzer, and explainer over the sample programs.
 * Run: node test/run-tests.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const P = require('../js/parser.js');
const A = require('../js/analyzer.js');
const X = require('../js/explain.js');
const L = require('../js/linter.js');
const FL = require('../js/flow.js');
const VA = require('../js/vaparse.js');

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failures++; console.error('FAIL  ' + msg); }
}

const samplesDir = path.join(__dirname, '..', 'samples');
const programs = {};
for (const f of fs.readdirSync(samplesDir).sort()) {
  if (!/\.ls$/i.test(f)) continue;
  const src = fs.readFileSync(path.join(samplesDir, f), 'utf8');
  const parsed = P.parseLS(src, f);
  programs[parsed.name] = { parsed, analysis: A.analyzeProgram(parsed), source: src };
}

console.log('\n-- parser --');
check(Object.keys(programs).length === 5, 'parsed 5 sample programs (' + Object.keys(programs).join(', ') + ')');
const main = programs.MAIN;
check(main && main.parsed.name === 'MAIN', 'MAIN /PROG header read');
check(main.parsed.attrs.COMMENT === 'Cell main - pick & place cycle', 'MAIN COMMENT attribute read');
check(main.parsed.lines.length === 34, 'MAIN has 34 body lines (got ' + main.parsed.lines.length + ')');
const l15 = main.parsed.lines.find(l => l.num === 15);
check(l15 && l15.motion === 'J' && /P\[1:home\]/.test(l15.text), 'line 15 recognized as J motion to P[1:home]');
check(main.parsed.positions.length === 1 && main.parsed.positions[0].name === 'home', 'MAIN /POS parsed: P[1:"home"]');
const homeG = main.parsed.positions[0].groups[0];
check(homeG.uf === 1 && homeG.ut === 1 && homeG.coords.X.value === 785.0, 'home position UF/UT/X parsed');
check(programs.PICK.parsed.positions.length === 2, 'PICK has 2 positions');
check(programs.GRIPPER.parsed.positions.length === 0, 'GRIPPER has no /POS section');

console.log('\n-- analyzer --');
const ma = main.analysis;
check(ma.calls.length === 4, 'MAIN makes 4 calls (GRIPPER, PICK, PLACE, PALLET) (got ' + ma.calls.length + ')');
check(ma.calls.filter(c => c.target === 'GRIPPER').length === 1, 'MAIN calls GRIPPER once');
check(ma.registers[1] && ma.registers[1].label === 'part count', 'R[1] label captured ("part count")');
check(ma.registers[1].writes.length >= 2 && ma.registers[1].reads.length >= 1, 'R[1] has both writes and reads');
check(ma.io['DO[104]'] && ma.io['DO[104]'].writes.length === 2, 'DO[104] written twice (ON/OFF)');
check(ma.io['DI[101]'] && ma.io['DI[101]'].reads.length === 1, 'DI[101] read once (WAIT)');
check(ma.io['GI[1]'] && ma.io['GI[1]'].reads.length === 1, 'GI[1] read (not counted as write)');
check(ma.labels[10] && ma.labels[10].defLine === 17 && ma.labels[10].jumps.includes(24), 'LBL[10] def line 17, jumped from 24');
check(ma.loops.length === 1 && ma.loops[0].label === 10, 'main cycle loop detected (JMP back to LBL[10])');
check(ma.motions.J === 2, 'MAIN has 2 joint moves');
check(ma.timers[1] && ma.timers[1].writes.length >= 2, 'TIMER[1] START/STOP/RESET counted as writes');

// write/read classification on PLACE line 8: PR[20,1]=R[11:col]*90
const pa = programs.PLACE.analysis;
check(pa.posRegs[20] && pa.posRegs[20].writes.length >= 3, 'PR[20] written (incl. component writes)');
check(pa.registers[11] && pa.registers[11].reads.length >= 1, 'R[11] read on right-hand side');

console.log('\n-- call graph --');
const graph = A.buildCallGraph(programs);
check(graph.calledBy.PICK.includes('MAIN'), 'PICK calledBy MAIN');
check(graph.calledBy.GRIPPER.sort().join(',') === 'MAIN,PICK,PLACE', 'GRIPPER called by MAIN, PICK, PLACE');
check(A.roots(graph).join(',') === 'MAIN', 'MAIN is the only root');
check(Object.keys(graph.unresolved).length === 0, 'no unresolved calls in sample cell');

console.log('\n-- global xref --');
const xref = A.buildGlobalXref(programs);
check(xref.registers[10] && xref.registers[10].refs.some(r => r.prog === 'MAIN') && xref.registers[10].refs.some(r => r.prog === 'PALLET'),
  'R[10] cross-referenced in MAIN and PALLET');
check(xref.io['RO[1]'] && xref.io['RO[1]'].label === 'gripper close', 'RO[1] label propagated to global xref');

console.log('\n-- explainer --');
const ex = n => X.explainLine(main.parsed.lines.find(l => l.num === n));
check(/Joint move .*P\[1\].*100% of max joint speed.*stop exactly/.test(ex(15)), 'motion line explained: ' + ex(15));
check(/Call subprogram PICK/.test(ex(19)), 'CALL explained: ' + ex(19));
check(/If R\[1\].*less than.*R\[2\].*jump to label 10/.test(ex(24)), 'IF/JMP explained: ' + ex(24));
check(/Turn digital output DO\[104\].*ON/.test(ex(16)), 'DO=ON explained: ' + ex(16));
check(/Pulse DO\[105\].*1\.0 s/.test(ex(29)), 'PULSE explained: ' + ex(29));
check(/Wait here until digital input DI\[101\].*timeout.*label 900/i.test(ex(18)), 'WAIT+TIMEOUT explained: ' + ex(18));
check(/Comment:/.test(ex(2)), 'comment line explained');
const offLine = programs.PLACE.parsed.lines.find(l => l.num === 11);
check(/Linear move .*300 mm\/sec.*offset by PR\[20\]/.test(X.explainLine(offLine)), 'Offset,PR explained: ' + X.explainLine(offLine));

console.log('\n-- jump reference forms --');
check(main.analysis.labels[900] && main.analysis.labels[900].jumps.includes(18),
  'TIMEOUT,LBL[900] counted as a jump reference to LBL[900]');

console.log('\n-- linter --');
// Broken fixture: jump to missing label, duplicate label, unlabeled R/DO on
// active lines, a commented-out use that must NOT count, unreachable code.
const badSrc = `/PROG BAD
/MN
   1:  R[50]=1 ;
   2:  !R[60]=1 ;
   3:  DO[999]=ON ;
   4:  JMP LBL[77] ;
   5:  R[50]=2 ;
   6:  LBL[5] ;
   7:  CALL NOWHERE ;
   8:  LBL[5] ;
   9:  END ;
/END
`;
const badParsed = P.parseLS(badSrc, 'BAD.LS');
const lib2 = Object.assign({}, programs, { BAD: { parsed: badParsed, analysis: A.analyzeProgram(badParsed), source: badSrc } });
const g2 = A.buildCallGraph(lib2);
const x2 = A.buildGlobalXref(lib2);
const findings = L.lint(lib2, g2, x2);
const byRule = r => findings.filter(f => f.rule === r);
check(byRule('jump-to-missing-label').some(f => f.refs.some(r => r.prog === 'BAD' && r.line === 4)),
  'error: JMP LBL[77] with no LBL[77] defined');
check(byRule('duplicate-label').some(f => f.message.includes('LBL[5]')), 'error: LBL[5] defined twice');
check(byRule('unlabeled-register').some(f => f.message.startsWith('R[50]')), 'warn: R[50] used without a label');
check(!byRule('unlabeled-register').some(f => f.message.startsWith('R[60]')),
  'commented-out !R[60] is NOT reported (comment lines ignored)');
check(byRule('unlabeled-io').some(f => f.message.startsWith('DO[999]')), 'warn: DO[999] used without an I/O comment');
check(byRule('call-missing-program').some(f => f.message.includes('NOWHERE')), 'warn: CALL NOWHERE not in library');
check(byRule('unreachable-code').some(f => f.refs.some(r => r.prog === 'BAD' && r.line === 5)),
  'warn: line 5 unreachable after unconditional JMP');
const cleanFindings = L.lint(programs, A.buildCallGraph(programs), A.buildGlobalXref(programs));
check(!cleanFindings.some(f => f.severity === 'error'), 'sample cell has no errors');

console.log('\n-- handshake without motion --');
const hsSrc = `/PROG HS
/MN
   1:  DO[20:station start]=ON ;
   2:  WAIT DI[21:station done]=ON ;
   3:  DO[20:station start]=ON ;
   4:J P[1:over there] 100% FINE ;
   5:  WAIT DI[21:station done]=ON ;
   6:  DO[22:next]=ON ;
   7:  CALL GRIPPER(1) ;
   8:  WAIT DI[23:ready]=ON ;
   9:  DO[24:sig]=ON ;
  10:  LBL[5] ;
  11:  WAIT DI[25:in]=ON ;
  12:  RO[1:clamp]=ON ;
  13:  WAIT RI[1:clamped]=ON ;
/END
`;
const hsParsed = P.parseLS(hsSrc, 'HS.LS');
const hsLib = Object.assign({}, programs, { HS: { parsed: hsParsed, analysis: A.analyzeProgram(hsParsed), source: hsSrc } });
const hsFindings = L.lint(hsLib, A.buildCallGraph(hsLib), A.buildGlobalXref(hsLib)).filter(f => f.rule === 'handshake-without-motion');
const hsAt = line => hsFindings.some(f => f.refs.some(r => r.prog === 'HS' && r.line === line));
check(hsAt(2), 'flagged: DO=ON at 1 → WAIT DI at 2 with nothing between');
check(!hsAt(5), 'NOT flagged: motion between DO=ON (3) and WAIT (5)');
check(!hsAt(8), 'NOT flagged: CALL between DO=ON (6) and WAIT (8) — the call may move');
check(!hsAt(11), 'NOT flagged: LBL between DO=ON (9) and WAIT (11) — merge point');
check(!hsAt(13), 'NOT flagged: RO (gripper valve) is exempt, only DO handshakes checked');
check(hsFindings.some(f => f.refs.some(r => r.prog === 'PALLET')),
  'sample PALLET flagged: DO[120]=ON → WAIT DI[121] with only a MESSAGE between');

console.log('\n-- flow --');
const flow = FL.buildFlow(main.parsed);
check(flow.blocks.length >= 5, 'MAIN splits into blocks (' + flow.blocks.length + ')');
const lbl10Block = flow.blocks.find(b => b.labelNum === 10);
check(!!lbl10Block, 'LBL[10] starts its own block');
const backEdge = flow.edges.find(e => e.kind === 'cond' && e.to === lbl10Block.idx && e.fromLine === 24);
check(!!backEdge, 'conditional back-edge from line 24 to the LBL[10] block (the cycle loop)');
const endBlock = flow.blocks.find(b => b.lastActive && /^END/.test(b.lastActive.text));
check(endBlock && !flow.edges.some(e => e.kind === 'fall' && e.from === endBlock.idx),
  'no fallthrough out of the END block');
const order = FL.callOrder(programs, A.buildCallGraph(programs), 'MAIN');
check(order[0].name === 'MAIN' && order[1].name === 'GRIPPER' && order[2].name === 'PICK',
  'call order: MAIN → GRIPPER → PICK … (' + order.slice(0, 4).map(r => r.name).join(' → ') + ')');
check(order.find(r => r.name === 'PICK').seq === '1.2', 'PICK is sequence 1.2');

console.log('\n-- real-backup constructs --');
const rbSrc = `/PROG RB
/MN
   1:  DO[60:OFF:Jogged]=($MOR_GRP[1].$JOGGED) ;
   2:  F[8:OFF:Task Rdy]=(OFF) ;
   3:  IF (F[8:OFF:Task Rdy]),JMP LBL[R[8]] ;
   4:  PR[6,1:*Transit]=(-93) ;
   5:  UFRAME_NUM=R[20:*RackNum] ;
   6:  R[R[199]]=0 ;
   7:  COL GUARD ADJUST 100 ;
   8:  OFFSET CONDITION PR[60:User Offset] ;
   9:  PAYLOAD[R[6]] ;
  10:  JMP LBL[100] ;
  11:   ;
  12:  LBL[100] ;
  13:  END ;
/END
`;
const rbParsed = P.parseLS(rbSrc, 'RB.LS');
const rbA = A.analyzeProgram(rbParsed);
check(rbA.io['DO[60]'].label === 'Jogged', 'IO label strips live-state prefix ("OFF:") → "' + rbA.io['DO[60]'].label + '"');
const rbEx = n => X.explainLine(rbParsed.lines.find(l => l.num === n));
const rbChecks = [
  [1, /Set digital output DO\[60\].*mixed logic/],
  [2, /Turn flag F\[8\] \("Task Rdy"\) OFF/],
  [3, /jump to the label whose number is in R\[8\]/],
  [4, /X component of PR\[6\] \("\*Transit"\)/],
  [5, /user frame whose number is R\[20\]/],
  [6, /register whose number is in R\[199\]/],
  [7, /collision-guard sensitivity to 100%/],
  [8, /offset condition.*PR\[60\]/],
  [9, /payload schedule whose number is in R\[6\]/]
];
rbChecks.forEach(([n, re]) => check(re.test(rbEx(n)), 'line ' + n + ' explained: ' + rbEx(n)));
const rbLib = { RB: { parsed: rbParsed, analysis: rbA, source: rbSrc } };
const rbFind = L.lint(rbLib, A.buildCallGraph(rbLib), A.buildGlobalXref(rbLib));
check(!rbFind.some(f => f.rule === 'unreachable-code'), 'blank line + LBL after JMP not flagged unreachable');

console.log('\n-- comments must never read as instructions --');
const cmSrc = `/PROG CM
/MN
   1:  WAIT DI[5:OFF:Run Task]=OFF ;
   2:  IF ((DI[5:OFF:Run Task] AND GI[1:0:Manual Task ID]>0) OR DI[4:OFF:Request to Enter]),JMP LBL[150] ;
   3:  DO[6:call the operator]=ON ;
   4:  LBL[150] ;
   5:  IF (R[2:Manual Task ID]=10),CALL _RECOVER ;
   6:  RUN _BGLOGIC ;
/END
`;
const cmParsed = P.parseLS(cmSrc, 'CM.LS');
const cmA = A.analyzeProgram(cmParsed);
check(cmA.calls.length === 2, 'only the real CALL and RUN found (got ' + cmA.calls.map(c => c.kind + ' ' + c.target).join(', ') + ')');
check(!cmA.calls.some(c => c.target === 'TASK'), '"Run Task" I/O comment not read as RUN TASK');
check(!cmA.calls.some(c => c.target === 'THE'), '"call the operator" comment not read as CALL');
check(cmA.calls.some(c => c.target === '_RECOVER') && cmA.calls.some(c => c.target === '_BGLOGIC'), 'real targets kept');
const cmFlow = FL.buildFlow(cmParsed);
check(!cmFlow.blocks.some(b => b.calls.includes('TASK')), 'flow blocks also ignore comment text');

console.log('\n-- IOSTATE.DG parser --');
const ios = VA.parseIOState('IO STATUS::\n\nDIN[   1]  ON  Auto Mode\nDIN[   2] OFF  Start\nDOUT[ 104] OFF  \nFLG[   8] OFF  Task Rdy                  FLG[ 520] OFF                          \nGIN[   1]  0  Task ID\n');
check(ios.length === 6, '6 points parsed (got ' + ios.length + ')');
check(ios[0].type === 'DI' && ios[0].index === 1 && ios[0].state === 'ON' && ios[0].comment === 'Auto Mode', 'DIN[1] → DI[1] ON "Auto Mode"');
check(ios[2].type === 'DO' && ios[2].comment === '', 'uncommented DOUT parsed with empty comment');
const flg = ios.filter(p => p.type === 'F');
check(flg.length === 2 && flg[0].comment === 'Task Rdy' && flg[1].comment === '', 'two-column FLG line split correctly');
check(ios[5].type === 'GI' && ios[5].state === '0' && ios[5].comment === 'Task ID', 'group input with numeric value parsed');

console.log('\n-- VA parser --');
const regs = VA.parseNumreg("  [1] = 25  'part count'\n  [2] = 1.5  ''\n  [3] = -4  'offset'\n");
check(regs.length === 3 && regs[0].value === 25 && regs[0].comment === 'part count', 'NUMREG.VA lines parsed');
check(regs[1].value === 1.5 && regs[1].comment === '', 'real value with empty comment parsed');
const ioc = VA.parseIOComments("DI[  1]  'door closed'\nDO[ 12]  ''\nRO[2] STATUS: ON 'gripper open'\njunk line\n");
check(ioc.length === 2 && ioc[0].type === 'DI' && ioc[0].comment === 'door closed', 'I/O comments parsed from config lines');
check(ioc[1].type === 'RO' && ioc[1].index === 2, 'unlabeled DO[12] skipped, RO[2] captured');

console.log('\n-- labeled but never used --');
const extern = {
  source: 'test',
  registers: [{ index: 1, comment: 'part count' }, { index: 77, comment: 'spare counter' }, { index: 78, comment: '' }],
  io: [{ type: 'DO', index: 104, comment: 'cell running' }, { type: 'DI', index: 555, comment: 'spare input' }]
};
const externFindings = L.lint(programs, A.buildCallGraph(programs), A.buildGlobalXref(programs), extern);
check(externFindings.some(f => f.rule === 'labeled-never-used-register' && f.message.includes('R[77]')),
  'R[77] "spare counter" flagged: labeled but never used');
check(!externFindings.some(f => f.rule === 'labeled-never-used-register' && f.message.includes('R[1]')),
  'R[1] not flagged (it is used)');
check(!externFindings.some(f => f.message.includes('R[78]')), 'unlabeled R[78] not flagged');
check(externFindings.some(f => f.rule === 'labeled-never-used-io' && f.message.includes('DI[555]')),
  'DI[555] "spare input" flagged: labeled but never used');

console.log('\n-- flow ignore + handshake pass-through --');
const ignored = { GRIPPER: true };
const orderIg = FL.callOrder(programs, A.buildCallGraph(programs), 'MAIN', ignored);
check(!orderIg.some(r => r.name === 'GRIPPER'), 'GRIPPER hidden from call order when ignored');
check(orderIg.some(r => r.name === 'PICK') && orderIg.some(r => r.name === 'PALLET'), 'other programs still shown');
const ptSrc = `/PROG PT
/MN
   1:  DO[30:go]=ON ;
   2:  CALL _SET_OFFS ;
   3:  WAIT DI[31:done]=ON ;
/END
`;
const ptParsed = P.parseLS(ptSrc, 'PT.LS');
const ptLib = { PT: { parsed: ptParsed, analysis: A.analyzeProgram(ptParsed), source: ptSrc } };
const without = L.lint(ptLib, A.buildCallGraph(ptLib), A.buildGlobalXref(ptLib)).filter(f => f.rule === 'handshake-without-motion');
const withPT = L.lint(ptLib, A.buildCallGraph(ptLib), A.buildGlobalXref(ptLib), null, { passThroughCalls: { _SET_OFFS: true } }).filter(f => f.rule === 'handshake-without-motion');
check(without.length === 0, 'normally: CALL clears the handshake window (call may move)');
check(withPT.length === 1, 'with _SET_OFFS marked utility: handshake still flagged through the call');

console.log('\n-- side-by-side pairing --');
const D0 = require('../js/diff.js');
const sbs = D0.sideBySide(D0.diffLines('a\nb\nc', 'a\nX\nc\nd'));
check(sbs.length === 4, '4 rows (got ' + sbs.length + ')');
check(sbs[1].t === 'change' && sbs[1].a.text === 'b' && sbs[1].b.text === 'X', 'changed line paired b|X');
check(sbs[3].t === 'add' && sbs[3].a === null && sbs[3].b.text === 'd', 'added line has empty left cell');

console.log('\n-- diff --');
const D = require('../js/diff.js');
const ops = D.diffLines('a\nb\nc\nd', 'a\nX\nc\nd\ne');
check(ops.filter(o => o.t === '-').map(o => o.text).join() === 'b', 'diff: "b" removed');
check(ops.filter(o => o.t === '+').map(o => o.text).join() === 'X,e', 'diff: "X" and "e" added');
check(ops.filter(o => o.t === '=').length === 3, 'diff: 3 unchanged lines');
const oldMain = main.parsed && programs.MAIN.source;
const headerTouched = oldMain.replace(/MODIFIED\t= DATE [^;]*/, 'MODIFIED\t= DATE 26-08-28  TIME 01:02:03');
const bodyTouched = oldMain.replace('R[1:part count]=0', 'R[1:part count]=5');
const cmp = D.comparePrograms(
  { MAIN: oldMain, GONE: '/PROG GONE\n/MN\n   1:  END ;\n/END\n' },
  { MAIN: headerTouched, EXTRA: '/PROG EXTRA\n/MN\n   1:  END ;\n/END\n' }
);
check(cmp.headerOnly.includes('MAIN'), 'header-only change classified separately');
check(cmp.added.includes('EXTRA') && cmp.removed.includes('GONE'), 'added/removed programs detected');
const cmp2 = D.comparePrograms({ MAIN: oldMain }, { MAIN: bodyTouched });
check(cmp2.changed.length === 1 && cmp2.changed[0].adds === 1 && cmp2.changed[0].dels === 1,
  'real body change: 1 added + 1 removed line');

console.log('');
if (failures) {
  console.error(failures + ' test(s) failed');
  process.exit(1);
}
console.log('All tests passed.');
