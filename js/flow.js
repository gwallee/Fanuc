/* Control-flow and call-order computation for the Flow view.
 *
 * buildFlow(parsed) -> {
 *   blocks: [{ idx, startNum, endNum, kind, title, preview: [text], calls: [name], count }],
 *   edges:  [{ from, to, kind: 'fall'|'jump'|'cond', fromLine, label, missing }]
 * }
 * Blocks are straight-line runs; a block ends at any branching line
 * (JMP / IF…JMP / TIMEOUT,LBL / Skip,LBL / END / ABORT) or before a label.
 *
 * callOrder(programs, graph, root) -> [{ seq, depth, name, line, note }]
 * Static call sequence: programs listed in the order their CALLs appear.
 */
(function (global) {
  'use strict';

  var JUMP_RE = /(?:JMP\s+|TIMEOUT\s*,\s*|Skip\s*,\s*)LBL\[(\d+)(?::[^\]]*)?\]/g;

  function isUncondJump(text) { return /^JMP\s+LBL\[/.test(text); }
  function isStop(text) { return /^(END\s*$|ABORT\s*$)/.test(text); }
  function isLabelDef(text) { return /^LBL\[/.test(text); }

  function jumpTargets(text) {
    var out = [], m;
    JUMP_RE.lastIndex = 0;
    while ((m = JUMP_RE.exec(text)) !== null) out.push(parseInt(m[1], 10));
    return out;
  }

  function buildFlow(parsed) {
    var blocks = [];
    var labelBlock = {};   // label n -> block idx
    var cur = null;

    function close() { if (cur && cur.lines.length) blocks.push(cur); cur = null; }
    function open() { if (!cur) cur = { lines: [] }; }

    parsed.lines.forEach(function (line) {
      var active = line.comment === null;
      if (active && isLabelDef(line.text)) {
        close();
        open();
        var m = line.text.match(/^LBL\[(\d+)(?::([^\]]*))?\]/);
        cur.labelNum = parseInt(m[1], 10);
        cur.labelName = (m[2] || '').trim();
        labelBlock[cur.labelNum] = blocks.length; // idx once pushed
      } else {
        open();
      }
      cur.lines.push(line);
      if (active && (jumpTargets(line.text).length || isStop(line.text) || isUncondJump(line.text))) {
        close();
      }
    });
    close();

    blocks.forEach(function (b, i) {
      b.idx = i;
      b.startNum = b.lines[0].num;
      b.endNum = b.lines[b.lines.length - 1].num;
      b.count = b.lines.length;
      var lastActive = null;
      b.calls = [];
      b.lines.forEach(function (l) {
        if (l.comment !== null) return;
        lastActive = l;
        var cm = l.text.replace(/\[[^\]]*\]/g, '[]').match(/\b(?:CALL|RUN)\s+([A-Z_][A-Z0-9_]*)/);
        if (cm) b.calls.push(cm[1].toUpperCase());
      });
      b.lastActive = lastActive;
      if (b.labelNum !== undefined) {
        b.kind = 'label';
        b.title = 'LBL[' + b.labelNum + ']' + (b.labelName ? ' ' + b.labelName : '');
      } else if (lastActive && isStop(lastActive.text)) {
        b.kind = 'stop';
        b.title = lastActive.text.trim();
      } else {
        b.kind = 'normal';
        b.title = 'lines ' + b.startNum + '–' + b.endNum;
      }
      if (b.labelNum !== undefined && lastActive && isStop(lastActive.text)) b.kind = 'label stop';
      b.preview = b.lines
        .filter(function (l) { return l.comment === null; })
        .slice(0, 3)
        .map(function (l) { return (l.motion ? l.motion + ' ' : '') + l.text; });
    });

    var edges = [];
    blocks.forEach(function (b, i) {
      var la = b.lastActive;
      var fallsThrough = true;
      if (la) {
        var targets = jumpTargets(la.text);
        var uncond = isUncondJump(la.text);
        targets.forEach(function (n) {
          var to = labelBlock[n];
          edges.push({
            from: i,
            to: to === undefined ? null : to,
            kind: uncond ? 'jump' : 'cond',
            fromLine: la.num,
            label: 'LBL[' + n + ']',
            missing: to === undefined
          });
        });
        if (uncond || isStop(la.text)) fallsThrough = false;
      }
      if (fallsThrough && i + 1 < blocks.length) {
        edges.push({ from: i, to: i + 1, kind: 'fall' });
      }
    });

    return { blocks: blocks, edges: edges };
  }

  /* ignore: {NAME: true} — utility programs (offset setters, math helpers)
   * hidden from the tree entirely; their own calls are not walked either. */
  function callOrder(programs, graph, root, ignore) {
    var rows = [];
    function walk(name, seqPrefix, depth, viaLine, visited) {
      var missing = !programs[name];
      var recursive = visited.indexOf(name) !== -1;
      rows.push({
        seq: seqPrefix,
        depth: depth,
        name: name,
        line: viaLine,
        note: missing ? 'missing' : (recursive ? 'recursion' : null)
      });
      if (missing || recursive) return;
      var calls = (graph.calls[name] || []).filter(function (c) {
        return !(ignore && ignore[c.target]);
      });
      calls.forEach(function (c, i) {
        walk(c.target, seqPrefix + '.' + (i + 1), depth + 1, c.line, visited.concat(name));
      });
    }
    walk(root, '1', 0, null, []);
    return rows;
  }

  /* Collapse support for the call-order tree.
   * rows: output of callOrder. collapsed: {seq: true}.
   * Marks each row hasChildren and returns only visible rows. */
  function visibleRows(rows, collapsed) {
    var out = [];
    var hiddenUnder = null; // seq prefix currently collapsed
    rows.forEach(function (row, i) {
      row.hasChildren = i + 1 < rows.length && rows[i + 1].depth > row.depth;
      if (hiddenUnder !== null) {
        if (row.seq.indexOf(hiddenUnder + '.') === 0) return; // inside collapsed subtree
        hiddenUnder = null;
      }
      out.push(row);
      if (row.hasChildren && collapsed[row.seq]) hiddenUnder = row.seq;
    });
    return out;
  }

  /* Build a collapsed-map that shows only `depth` call levels (root = level 1). */
  function collapseToDepth(rows, depth) {
    var map = {};
    rows.forEach(function (row, i) {
      var hasChildren = i + 1 < rows.length && rows[i + 1].depth > row.depth;
      if (hasChildren && row.depth >= depth - 1) map[row.seq] = true;
    });
    return map;
  }

  var api = { buildFlow: buildFlow, callOrder: callOrder, visibleRows: visibleRows, collapseToDepth: collapseToDepth };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucFlow = api;
})(typeof window !== 'undefined' ? window : globalThis);
