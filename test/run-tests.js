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

console.log('\n-- VA parser --');
const regs = VA.parseNumreg("  [1] = 25  'part count'\n  [2] = 1.5  ''\n  [3] = -4  'offset'\n");
check(regs.length === 3 && regs[0].value === 25 && regs[0].comment === 'part count', 'NUMREG.VA lines parsed');
check(regs[1].value === 1.5 && regs[1].comment === '', 'real value with empty comment parsed');

console.log('');
if (failures) {
  console.error(failures + ' test(s) failed');
  process.exit(1);
}
console.log('All tests passed.');
