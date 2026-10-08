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

// fileLine + applyLineEdits: the find/replace path writes edited rows back
// into the listing by the file line each parsed line started on.
const flSrc = '/PROG FL\r\n/MN\r\n   1:L P[1] R[30:Spd]mm/sec FINE ;\r\n   2:  R[30:Spd]=R[31] ;\r\n   3:  CALL VERY_LONG_PROGRAM_NAME(1,2,\r\n    :  3,4) ;\r\n   4:  !end ;\r\n/POS\r\n/END';
const fl = P.parseLS(flSrc, 'FL.LS');
check(fl.lines.map(l => l.fileLine).join(',') === '3,4,5,7', 'body lines record their file line (got ' + fl.lines.map(l => l.fileLine).join(',') + ')');
check(fl.lines[2].raw.split('\n').length === 2, 'a wrapped instruction keeps both raw rows');
const flOut = P.applyLineEdits(flSrc, [
  { fileLine: 3, count: 1, text: '   1:L P[1] 1500mm/sec FINE ;' },
  { fileLine: 5, count: 2, text: '   3:  CALL SHORT ;' }
]);
check(flOut.split('\r\n').length === 8 && /\r\n/.test(flOut), 'edits keep CRLF endings and shrink the wrapped row (got ' + flOut.split('\r\n').length + ' rows)');
const flP = P.parseLS(flOut, 'FL.LS');
check(flP.lines[0].text === 'P[1] 1500mm/sec FINE' && flP.lines[2].text === 'CALL SHORT' && flP.lines[3].fileLine === 6, 'edited listing re-parses with the rows below shifted up');
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

// A motion line's trailing TB/DB trigger or Skip,LBL,PR=LPOS has the only '='
// on the line; the speed register and the destination PR left of it are reads.
const wrSrc = [
  '/PROG WR', '/MN',
  '   1:L PR[55:Meas] R[207:ScanSpd]mm/sec FINE Tool_Offset Skip,LBL[217],PR[49:Edge]=LPOS ;',
  '   2:J P[1] R[31:Speed-J]% CNT50 TB 0.5sec,DO[101]=ON ;',
  '   3:  IF R[31:Speed-J]=75,JMP LBL[1] ;',
  '   4:  SELECT R[31]=1,CALL A ;',
  '   5:  R[31:Speed-J]=R[31:Speed-J]+1 ;',
  '   6:  GO[1]=R[31] ;',
  '   7:  IF (R[31:Speed-J]<10),R[31:Speed-J]=(10) ;',
  '   8:  IF ((R[31]=1) AND (DI[1]=ON)),DO[102]=(ON) ;',
  '   9:  IF (R[31]=1),JMP LBL[1] ;',
  '/POS', '/END'
].join('\n');
const wrA = A.analyzeProgram(P.parseLS(wrSrc, 'WR.LS'));
check(wrA.registers[207].writes.length === 0 && wrA.registers[207].reads.length === 1, 'speed register on a Skip,PR=LPOS line is a read');
check(wrA.posRegs[55].writes.length === 0 && wrA.posRegs[49].writes.length === 1, 'Skip line: destination PR read, PR=LPOS written');
check(wrA.registers[31].writes.join(',') === '5,7', 'R[31]: written by R[31]=... and by the IF (...),R[31]=(10) action (got ' + wrA.registers[31].writes.join(',') + ')');
check(wrA.registers[31].reads.length === 8, 'R[31]: TB, IF, SELECT, RHS, GO[1]= and IF-condition uses are reads (got ' + wrA.registers[31].reads.length + ')');
check(wrA.io['DO[101]'].writes.length === 1 && wrA.io['GO[1]'].writes.length === 1, 'DO[101] in TB trigger and GO[1] target are writes');
check(wrA.io['DO[102]'].writes.length === 1 && wrA.io['DI[1]'].reads.length === 1, 'IF (nested cond),DO[102]=(ON): DO written, DI read');

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

console.log('\n-- ERRALL.LS parser --');
const errText = fs.readFileSync(path.join(__dirname, '..', 'testdata', 'errall.ls'), 'latin1');
const errs = VA.parseErrall(errText);
check(errs.length === 100, '100 error entries parsed (got ' + errs.length + ')');
check(errs[0].seq === 4428 && errs[0].code === 'SRVO-003' && errs[0].severity === 'SERVO' && errs[0].active === true,
  'first (newest) entry: ' + errs[0].code + ' "' + errs[0].text + '" [' + errs[0].severity + '] active=' + errs[0].active);
const reset = errs.find(e => e.code === null);
check(reset && /R E S E T/.test(reset.text), 'RESET rows (no alarm code) parsed');
const lidpickStyle = VA.parseErrall('4697\" 28-AUG-26 15:34:24 \" ASBN-009 on line 76, column 12                    \" \" ASBN-092 Undefined instruction   \" WARN   00000000\"    \"');
check(lidpickStyle.length === 1 && lidpickStyle[0].code === 'ASBN-009' && /line 76/.test(lidpickStyle[0].text), 'ASBN load-error row parsed');

console.log('\n-- file line → program line mapping --');
const mapSrc = ['/PROG X', '/ATTR', 'COMMENT = "t";', '/MN', '   1:  LBL[1] ;', '   2:  J MP LBL[620] ;', '   3:  END ;', '/END', ''].join('\n');
check(P.mapFileLine(mapSrc, 6).progLine === 2 && /J MP/.test(P.mapFileLine(mapSrc, 6).raw), 'file line 6 → program line 2 (the broken JMP)');
check(P.mapFileLine(mapSrc, 3).progLine === null, 'file line 3 is header — no program line');
check(P.mapFileLine(mapSrc, 999) === null, 'out-of-range file line → null');

console.log('\n-- padded label indices: LBL[ 610 ] --');
const padSrc = `/PROG PAD
/MN
   1:  IF (GI[3:1030:Meas Dist]>(R[222:Lsr2BtmTL Offs]+25)),JMP LBL[610] ;
   2:  JMP LBL[620] ;
   3:  LBL[ 610] ;
   4:  JMP LBL[999] ;
   5:  LBL[620] ;
   6:  JMP LBL[  999 ] ;
   7:  LBL[999] ;
/END
`;
const padParsed = P.parseLS(padSrc, 'PAD.LS');
const padA = A.analyzeProgram(padParsed);
check(padA.labels[610] && padA.labels[610].defLine === 3, 'LBL[ 610] with padding recognized as a definition');
check(padA.labels[999] && padA.labels[999].jumps.length === 2, 'JMP LBL[  999 ] padded reference counted');
const padLib = { PAD: { parsed: padParsed, analysis: padA, source: padSrc } };
const padFindings = L.lint(padLib, A.buildCallGraph(padLib), A.buildGlobalXref(padLib));
check(!padFindings.some(f => f.rule === 'jump-to-missing-label'),
  'no false "jump to missing label" for padded definitions');
const padFlow = FL.buildFlow(padParsed);
check(padFlow.blocks.some(b => b.labelNum === 610), 'flow block created for the padded label');
check(!padFlow.edges.some(e => e.missing), 'no missing-label edges in flow');
check(/Label 610/.test(X.explainLine(padParsed.lines.find(l => l.num === 3))), 'padded label explained');

console.log('\n-- iPendant HTML-wrapped programs (HTTP fetch) --');
const wrapped = `<html>
<head>
<meta http-equiv="Cache-Control" content="no-cache">
<title> LIDPICK (robot) Homepage </title>
<script language=javascript>
var appConf = [{page: "vsfrmn.stm", width: 1070, height: 960}];
</script>
</head>
<BODY bgcolor= #FFF9e3>
<strong>Hostname: LIDPICK<br>File Name: /MD/_PL_TRASH.LS<br></strong>
<A HREF="../">Home Page</A>
<PRE>
<XMP>
/PROG  _PL_TRASH
/ATTR
COMMENT\t\t= "Place Box Lid";
/MN
   1:  !*******PLACE LID AT TRASH******* ;
   2:  LBL[100] ;
   3:  IF (F[101:OFF:Sys Checks]),CALL _SYS_CHECKS ;
   4:J PR[51:Trash Appr] R[204:LidSpd-J]% CNT100    ;
/POS
/END

</XMP></PRE>
</BODY>
</HTML>`;
const unwrapped = P.unwrapMd(wrapped);
check(unwrapped.trim().startsWith('/PROG') && unwrapped.includes('/END'), 'HTML wrapper stripped to the bare listing');
check(!/[<>]/.test(unwrapped.replace(/<>/g, '')), 'no HTML tags left in the source');
const wp = P.parseLS(wrapped, '_PL_TRASH.LS');
check(wp.name === '_PL_TRASH' && wp.lines.length === 4, 'wrapped program parses (' + wp.lines.length + ' lines)');
check(wp.source.trim().startsWith('/PROG'), 'parsed.source is the CLEAN listing — safe to edit and send back');
check(P.unwrapMd('/PROG X\n/MN\n   1:  END ;\n/END\n').startsWith('/PROG'), 'clean listings pass through untouched');
check(P.unwrapMd("[1] = 5  'x'\n") === "[1] = 5  'x'\n", 'non-program VA content passes through untouched');

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

console.log('\n-- POSREG.VA parser --');
const prText = fs.readFileSync(path.join(__dirname, '..', 'testdata', 'posreg.va'), 'latin1');
const prsAll = VA.parsePosreg(prText);
const prHome = prsAll.find(r => r.index === 1 && r.group === 1);
check(prHome && prHome.comment === 'Home' && prHome.rep === 'joint' && prHome.coords.J2 === -60, 'PR[1] "Home" joint form parsed (J2=' + (prHome && prHome.coords.J2) + ')');
const pr20 = prsAll.find(r => r.index === 20 && r.group === 1);
check(pr20 && pr20.rep === 'cartesian' && pr20.coords.X === 17.764 && pr20.config === 'F U T, 0, 0, 0', 'PR[20] cartesian form with Config on its own line parsed');
const pr7 = prsAll.find(r => r.index === 7 && r.group === 1);
check(pr7 && pr7.rep === 'uninitialized', 'uninitialized PR[7] recognized');
check(VA.posregValueStr(prHome).startsWith('J1 '), 'compact value string: ' + VA.posregValueStr(prHome));
console.log('  (' + prsAll.length + ' entries parsed from the real backup, ' + prsAll.filter(r => r.rep !== 'uninitialized').length + ' initialized)');

console.log('\n-- labeled but never used: posregs --');
const prExtern = { source: 'test', registers: [], io: [], posregs: [
  { group: 1, index: 199, comment: 'spare path', rep: 'joint', coords: {} },
  { group: 1, index: 20, comment: 'used one', rep: 'joint', coords: {} }
] };
// PR[20] is used by PLACE in the samples; PR[199] is not
const prFindings = L.lint(programs, A.buildCallGraph(programs), A.buildGlobalXref(programs), prExtern);
check(prFindings.some(f => f.rule === 'labeled-never-used-posreg' && f.message.includes('PR[199]')), 'PR[199] "spare path" flagged');
check(!prFindings.some(f => f.rule === 'labeled-never-used-posreg' && f.message.includes('PR[20]')), 'PR[20] not flagged (used in PLACE)');

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

console.log('\n-- call-order collapse --');
const allRows = FL.callOrder(programs, A.buildCallGraph(programs), 'MAIN');
const vis1 = FL.visibleRows(allRows, { '1.2': true });
check(vis1.some(r => r.seq === '1.2') && !vis1.some(r => r.seq === '1.2.1'),
  'collapsing 1.2 keeps the row but hides 1.2.x (' + allRows.length + ' → ' + vis1.length + ' rows)');
check(vis1.some(r => r.seq === '1.3'), 'sibling 1.3 stays visible');
check(vis1.find(r => r.seq === '1.2').hasChildren === true && vis1.find(r => r.seq === '1.1').hasChildren === false,
  'hasChildren computed (PICK yes, GRIPPER leaf no)');
const depth1 = FL.visibleRows(allRows, FL.collapseToDepth(allRows, 2));
check(depth1.every(r => r.depth <= 1), 'collapseToDepth(2) shows root + direct calls only');
check(FL.visibleRows(allRows, FL.collapseToDepth(allRows, 1)).length === 1, 'collapseToDepth(1) shows just the root');

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

console.log('\n-- diff: ignore line numbers --');
check(D.stripLineNums('   1:  UTOOL_NUM=1 ;') === '  UTOOL_NUM=1 ;', 'line number prefix stripped, indentation kept');
check(D.stripLineNums('  10:  UTOOL_NUM=1 ;') === D.stripLineNums('   9:  UTOOL_NUM=1 ;'),
  'padding shift from 9 -> 10 normalizes away');
check(D.stripLineNums('/MN') === '/MN' && D.stripLineNums('P[1]{') === 'P[1]{',
  'section markers and /POS payload untouched');
// One line inserted at the top renumbers everything below it.
const before = '/MN\n   1:  A ;\n   2:  B ;\n   3:  C ;\n/END\n';
const after  = '/MN\n   1:  NEW ;\n   2:  A ;\n   3:  B ;\n   4:  C ;\n/END\n';
const naive = D.diffLines(before, after);
check(naive.filter(o => o.t === '+').length === 4 && naive.filter(o => o.t === '-').length === 3,
  'without the option a 1-line insert reports the whole program changed');
const renum = D.diffLines(before, after, { ignoreLineNums: true });
check(renum.filter(o => o.t === '+').length === 1 && renum.filter(o => o.t === '-').length === 0,
  'with the option the same insert reports exactly 1 added line');
check(renum.filter(o => o.t === '+')[0].text === '   1:  NEW ;',
  'the added op still carries the line as actually written');
// A pure renumber (no content change) is not a change at all.
const pureRenum = D.comparePrograms(
  { P: '/PROG P\n/MN\n   1:  A ;\n   2:  B ;\n/END\n' },
  { P: '/PROG P\n/MN\n   9:  A ;\n  10:  B ;\n/END\n' },
  { ignoreLineNums: true }
);
check(pureRenum.headerOnly.includes('P') && !pureRenum.changed.length,
  'pure renumber classified as no code change');

console.log('\n-- PRGSTATE.DG (program / task state) --');
const psRaw = fs.readFileSync(path.join(__dirname, '..', 'testdata', 'prgstate.dg'), 'utf8');
const psr = VA.parsePrgState(psRaw);
check(psr.header.fNumber === 'F333543', 'header F number read (' + psr.header.fNumber + ')');
check(psr.tasks.length === 7, 'all 7 tasks parsed (got ' + psr.tasks.length + ')');
const runningTasks = psr.tasks.filter(t => t.state === 'RUNNING');
check(runningTasks.length === 2, '2 tasks RUNNING (got ' + runningTasks.length + ')');
const atcellio = psr.tasks.find(t => t.name === 'ATCELLIO');
check(atcellio && atcellio.line === 477 && atcellio.routine === 'MAIN' && atcellio.program === 'ATCELLIO',
  'RUNNING header parsed: line/routine/program');
check(atcellio && atcellio.stack.length === 2 &&
      atcellio.stack[0].program === 'ATCELLIO' && atcellio.stack[0].line === 477 &&
      atcellio.stack[1].line === 603,
  'routine stack parsed with a frame per depth');
check(psr.tasks.filter(t => t.state === 'ABORTED').length === 5, '5 tasks ABORTED');

// only live tasks pin their programs
check(Object.keys(psr.locked).sort().join(',') === 'ATCELLIO,ATSHELL',
  'locked = programs held by live tasks only (' + Object.keys(psr.locked).sort().join(',') + ')');

check(psr.programs.length === 85, '85 program blocks parsed (got ' + psr.programs.length + ')');
const gh = psr.programs.find(p => p.name === 'GET_HOME');
check(gh && gh.type === 'PC' && gh.task === 'no' && gh.comment === 'Get Home Pos' && gh.protection === 'OFF',
  'program block fields read (type/task/comment/protection)');
check(psr.programs.every(p => p.name && p.type), 'every program block has a name and type');

/* A PAUSED task still holds its programs — this is the case that actually
 * bites, and the sample backup has no paused task in it, so synthesise one. */
const pausedDump = [
  'F Number: F1',
  'DATE:     01-JAN-26 00:00',
  '',
  'TASK STATES:',
  '',
  '1     _PL_RACK PAUSED @ 42 in _PL_RACK of __AUTO',
  '',
  '******  History Data  ******',
  'Routine depth: 1  Routine: _PL_RACK',
  'Line:    42       Program: _PL_RACK      Type: TP',
  '',
  'Routine depth: 0  Routine: __AUTO',
  'Line:   118       Program: __AUTO        Type: TP',
  '',
  'PROGRAM STATES:',
  '_PL_RACK      TP',
  'Task: yes',
  'Lines:   90',
  'Protection:      OFF',
  '',
  '_IDLE_PROG      TP',
  'Task: no',
  'Lines:   10',
  'Protection:      ON',
  ''
].join('\n');
const pp = VA.parsePrgState(pausedDump);
check(pp.tasks.length === 1 && pp.tasks[0].state === 'PAUSED', 'PAUSED task recognised as a state');
check(pp.tasks[0].program === '__AUTO' && pp.tasks[0].line === 42, 'PAUSED header line/program read');
check(Object.keys(pp.locked).sort().join(',') === '_PL_RACK,__AUTO',
  'a PAUSED task holds every program on its stack, not just the current one (' +
  Object.keys(pp.locked).sort().join(',') + ')');
check(pp.programs.length === 2, 'both program blocks parsed');
check(pp.programs[0].task === 'yes' && pp.programs[1].protection === 'ON',
  'Task: yes and Protection: ON read');
check(!Object.prototype.hasOwnProperty.call(pp.locked, '_IDLE_PROG'),
  'an idle, write-protected program is not reported as held by a task');

console.log('\n-- flow blocks: blanks, captions, inbound --');
/* The shape that made the Flow view hard to read: a JMP, then a blank run,
 * then a header comment captioning the label that follows it. */
const fbSrc = `/PROG FB
/MN
   1:  LBL[400] ;
   2:  IF (DI[18:Reject]),JMP LBL[420] ;
   3:  JMP LBL[410] ;
   4:  !**Normal Box ;
   5:  LBL[410] ;
   6:  R[101]=10 ;
   7:  JMP LBL[500] ;
   8:  !**Reject Box ;
   9:  LBL[420] ;
  10:  R[101]=70 ;
  11:  JMP LBL[500] ;
  12:   ;
  13:   ;
  14:  !***Pick Up Box*** ;
  15:  LBL[500] ;
  16:  CALL _SET_OFFS(0,0,250,61) ;
  17:  END ;
/END
`;
const fbParsed = P.parseLS(fbSrc, 'FB.LS');
const fb = FL.buildFlow(fbParsed);

// no block may consist only of blanks and comments
const inert = fb.blocks.filter(b => b.activeCount === 0);
check(inert.length === 0, 'no block is made only of blank/comment lines (got ' + inert.length + ')');

const b500 = fb.blocks.find(b => b.labelNum === 500);
check(!!b500, 'LBL[500] block exists');
check(b500.startNum === 12 && b500.endNum === 17,
  'the blank run and its header comment attach to the block below (lines ' + b500.startNum + '-' + b500.endNum + ')');
check(b500.leadIn === 3, '3 lead-in lines recorded (blank, blank, comment) — got ' + b500.leadIn);
check(b500.lines.some(l => l.num === 14 && l.comment !== null),
  'line 14 "!***Pick Up Box***" belongs to LBL[500], not to the run above it');

const b410 = fb.blocks.find(b => b.labelNum === 410);
check(b410.startNum === 4 && b410.leadIn === 1, 'LBL[410] takes its own one-line caption');

// how control reaches LBL[500]: the two JMPs, and nothing else
const into500 = b500.inbound.map(e => e.kind + '@' + (e.fromLine || '')).sort();
check(into500.join(',') === 'jump@11,jump@7',
  'inbound edges are exactly the two jumps (' + into500.join(',') + ')');
check(!b500.inbound.some(e => e.kind === 'fall'),
  'no phantom fall-through from a comment-only block');

// a comment in the middle of a block stays put rather than being hoisted
const midSrc = `/PROG MID
/MN
   1:  LBL[10] ;
   2:  R[1]=1 ;
   3:  !mid comment ;
   4:  R[2]=2 ;
   5:  END ;
/END
`;
const mid = FL.buildFlow(P.parseLS(midSrc, 'MID.LS'));
check(mid.blocks.length === 1, 'straight-line block stays one block');
check(mid.blocks[0].leadIn === undefined, 'an interior comment is not treated as a lead-in caption');
check(mid.blocks[0].lines.length === 5, 'all 5 lines kept in order');

// trailing blanks/comments must not vanish
const tailSrc = `/PROG TAIL
/MN
   1:  LBL[10] ;
   2:  R[1]=1 ;
   3:   ;
   4:  !trailing note ;
/END
`;
const tail = FL.buildFlow(P.parseLS(tailSrc, 'TAIL.LS'));
check(tail.blocks.length === 1, 'trailing inert lines do not create a block');
check(tail.blocks[tail.blocks.length - 1].endNum === 4,
  'trailing blank/comment stay with the last block (endNum ' + tail.blocks[tail.blocks.length - 1].endNum + ')');

// preview no longer counts blank lines as content
const prevBlanks = fb.blocks.every(b => b.preview.every(t => t.trim() !== ''));
check(prevBlanks, 'no preview entry is an empty string');

/* -- QR encoder --
 * The symbols this produces were checked once against a real decoder (jsQR)
 * across every version 1-10, all 8 masks, and each version's exact byte
 * limit — that is what says the encoder is *correct*. These tests are the
 * regression net around it: the published capacity table, the structure any
 * scanner looks for first, and a fingerprint of one fixed symbol, so a change
 * to the Reed-Solomon or the placement cannot pass unnoticed. */
console.log('\n-- qr --');
const QR = require('../js/qr.js');

// The byte-mode capacities at level M, straight out of the standard's table.
const CAPACITIES = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
check(CAPACITIES.every((n, i) => QR.capacity(i + 1) === n),
  'byte-mode level-M capacities match the standard for versions 1-10');
check(QR.maxBytes === 213, 'the encoder tops out at 213 bytes');

const url = 'http://192.168.0.50:8642';
const sym = QR.encode(url);
check(sym.version === 2 && sym.size === 25, 'a LAN URL fits version 2 (25x25), got v' + sym.version);
check(QR.encode('a'.repeat(14)).version === 1 && QR.encode('a'.repeat(15)).version === 2,
  'version steps up exactly at the capacity boundary');

// Structure: three finders, their separators, the timing rows, the dark module.
const m = sym.modules;
const finderOK = [[0, 0], [0, sym.size - 7], [sym.size - 7, 0]].every(([r0, c0]) => {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const d = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      if (m[r0 + r][c0 + c] !== (d !== 2 ? 1 : 0)) return false;
    }
  }
  return true;
});
check(finderOK, 'all three finder patterns are drawn correctly');
let timingOK = true;
for (let i = 8; i < sym.size - 8; i++) {
  if (m[6][i] !== (i % 2 === 0 ? 1 : 0) || m[i][6] !== (i % 2 === 0 ? 1 : 0)) timingOK = false;
}
check(timingOK, 'both timing patterns alternate');
check(m[sym.size - 8][8] === 1, 'the always-dark module is dark');
let quietOK = true;
for (let i = 0; i < 8; i++) { if (m[7][i] || m[i][7]) quietOK = false; }
check(quietOK, 'the separator around the top-left finder is clear');

// A fingerprint of the whole symbol: any change to the encoder moves it.
const fingerprint = m.reduce((h, row) =>
  row.reduce((a, v) => (a * 31 + v) >>> 0, h), 7);
check(fingerprint === 2679924875,
  'the symbol for ' + url + ' is bit-for-bit unchanged (got ' + fingerprint + ')');

check(QR.svg(url).indexOf('viewBox="0 0 33 33"') > 0,
  'the SVG carries the 4-module quiet zone a scanner needs');
let tooLong = false;
try { QR.encode('x'.repeat(214)); } catch (e) { tooLong = true; }
check(tooLong, 'text past the last version is refused rather than truncated');


console.log('\n-- STRREG.VA parser --');
const srSample = [
  "[*STRREG*]$STRREG  Storage: SHADOW  Access: RW  : ARRAY[25] OF String Reg",
  "  [1] = Error setting SR Alarm text.  '*Active Alarm' ",
  "  [2] =   '' ",
  "  [6] = Status ID not 0 with no Box in Grip. Reset R[101] Sts ID to 0.  'PrevAlarm-2' ",
  "  [7] = value with no comment field at all"
].join('\n');
const srs = VA.parseStrreg(srSample);
check(srs.length === 4, 'the ARRAY[25] header line is not read as a register (got ' + srs.length + ')');
check(srs[0].index === 1 && srs[0].comment === '*Active Alarm' && srs[0].value === 'Error setting SR Alarm text.',
  'value and comment split on the LAST quoted run');
check(srs[1].value === '' && srs[1].comment === '', 'an empty string register parses as empty, not skipped');
check(srs[2].index === 6 && srs[2].comment === 'PrevAlarm-2',
  'a stored string containing R[101] does not read as a second register');
check(srs[3].index === 7 && srs[3].comment === '' && srs[3].value === 'value with no comment field at all',
  'a line with no quoted comment still yields its value');

console.log('\n-- renaming on the controller (ComSet) --');
const CS = require('../lib/comset.js');
// The codes are the controller's own, read off its /KAREL/COMMAIN page's
// klserver.js handlers. If one of these ever changes, a rename silently writes
// the wrong table on a live robot — so they are pinned here.
check(CS.CODES.R.fc === 1 && CS.CODES.PR.fc === 3 && CS.CODES.SR.fc === 14,
  'register comment codes pinned: R=1, PR=3, SR=14');
check(CS.CODES.DI.fc === 8 && CS.CODES.DO.fc === 9 && CS.CODES.F.fc === 19,
  'I/O comment codes pinned: DI=8, DO=9, F=19');
check(CS.CODES.R.max === 16 && CS.CODES.DO.max === 24,
  "length caps match the controller's own maxlength: 16 for registers, 24 for I/O");
['UI', 'UO', 'SI', 'SO', 'WI', 'WO', 'M'].forEach((t) => {
  check(!!CS.plan(t, 1, 'x').error, t + ' has no comment write on the controller, so a rename is refused');
});

const good = CS.plan('r', 1, 'Task ID');
check(good.url === '/karel/ComSet?sComment=Task%20ID&sIndx=1&sFc=1',
  'the ComSet URL matches what the robot page sends: ' + good.url);
check(good.key === 'R[1]' && good.kind === 'R', 'a lowercase type still resolves to R[1]');
check(CS.plan('R', 1, '').error === undefined && CS.plan('R', 1, '').comment === '',
  'clearing a name is allowed — that is how a register goes back to unnamed');
check(!!CS.plan('R', 1, 'x'.repeat(17)).error, '17 characters is refused for a 16-character register comment');
check(!CS.plan('DO', 1, 'x'.repeat(24)).error, '24 characters is accepted for an I/O point');
check(!!CS.plan('R', 1, "it's").error, "an apostrophe is refused — NUMREG.VA quotes the comment");
check(!!CS.plan('R', 1, 'a[1]').error, 'a square bracket is refused — listings bracket the comment');
check(!!CS.plan('R', 1, 'café').error, 'non-ASCII is refused rather than encoded and hoped for');
check(!!CS.plan('R', 0, 'x').error && !!CS.plan('R', 1.5, 'x').error && !!CS.plan('R', 10000, 'x').error,
  'index 0, a fraction, and past the cap are all refused');

// Verification reads the item back out of the file it lives in.
check(CS.storedComment('NUMREG.VA', "  [1] = 92  'Task ID'\n", 'R', 1) === 'Task ID',
  'a register rename is verified against NUMREG.VA');
check(CS.storedComment('NUMREG.VA', "  [1] = 92  'Task ID'\n", 'R', 2) === null,
  'an index missing from the file reads as null, not as an empty name');
check(CS.storedComment('IOSTATE.DG', 'DOUT[  65] OFF  Vac-1 ON\n', 'DO', 65) === 'Vac-1 ON',
  'an I/O rename is verified against IOSTATE.DG');
check(CS.storedComment('IOSTATE.DG', 'DIN[   1]  ON  Auto Mode\n', 'DO', 1) === null,
  'DI[1] and DO[1] are not confused when verifying');
console.log('');
if (failures) {
  console.error(failures + ' test(s) failed');
  process.exit(1);
}
console.log('All tests passed.');
