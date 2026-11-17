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
 *
 * expandCall(programs, name, opts) -> { prog, note, lines: [{ line, call }] }
 * The lines a CALL runs, for listing a called program inline under its CALL.
 */
(function (global) {
  'use strict';

  var JUMP_RE = /(?:JMP\s+|TIMEOUT\s*,\s*|Skip\s*,\s*)LBL\[\s*(\d+)\s*(?::[^\]]*)?\]/g;

  function isUncondJump(text) { return /^JMP\s+LBL\[/.test(text); }
  function isStop(text) { return /^(END\s*$|ABORT\s*$)/.test(text); }
  function isLabelDef(text) { return /^LBL\[/.test(text); }

  /* A blank line and a comment line are both inert, but they were treated
   * differently: comments were skipped, blanks counted as code. That is what
   * produced blocks holding nothing but blank lines. */
  function isActive(line) {
    return line.comment === null && String(line.text).trim() !== '';
  }

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

    /* Blanks and comments belong to whatever comes NEXT, not to what came
     * before. "!***Pick Up Box***" sitting on line 88 is the caption for
     * LBL[500] on 89, not a block of its own, and a run of blank lines is not
     * a block at all. So buffer them and let the next active line decide
     * where they land: a fresh block takes them as its lead-in, a block
     * already under way just keeps them inline. */
    var pending = [];

    parsed.lines.forEach(function (line) {
      if (!isActive(line)) { pending.push(line); return; }
      var label = isLabelDef(line.text);
      if (label) close();
      open();
      if (pending.length) {
        if (!cur.lines.length) cur.leadIn = pending.length;
        pending.forEach(function (pl) { cur.lines.push(pl); });
        pending = [];
      }
      if (label) {
        var m = line.text.match(/^LBL\[\s*(\d+)\s*(?::([^\]]*))?\]/);
        cur.labelNum = parseInt(m[1], 10);
        cur.labelName = (m[2] || '').trim();
        labelBlock[cur.labelNum] = blocks.length; // idx once pushed
      }
      cur.lines.push(line);
      if (jumpTargets(line.text).length || isStop(line.text) || isUncondJump(line.text)) close();
    });
    /* Trailing blanks and comments have no block left to caption. Keep them
     * with the last one so no line disappears from the view. */
    if (pending.length) {
      if (!cur && blocks.length) cur = blocks.pop();
      open();
      pending.forEach(function (pl) { cur.lines.push(pl); });
    }
    close();

    blocks.forEach(function (b, i) {
      b.idx = i;
      b.startNum = b.lines[0].num;
      b.endNum = b.lines[b.lines.length - 1].num;
      b.count = b.lines.length;
      var lastActive = null;
      b.calls = [];
      b.activeCount = 0;
      b.lines.forEach(function (l) {
        if (!isActive(l)) return;
        b.activeCount++;
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
        .filter(isActive)
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

    /* Which blocks lead here. In a jump-heavy program "how does it even
     * reach this line" is the constant question, and the arrows alone do not
     * answer it once there are more than a handful. */
    blocks.forEach(function (b) { b.inbound = []; });
    edges.forEach(function (e) {
      if (e.to !== null && blocks[e.to]) blocks[e.to].inbound.push(e);
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

  /* The program a line CALLs, or null. RUN is not a call: it starts a
   * separate task, so its lines do not run here. A name inside brackets
   * (DI[1:CALL HOME]) is not an instruction. */
  function callTarget(line) {
    if (!line || line.comment !== null) return null;
    var m = String(line.text).replace(/\[[^\]]*\]/g, '[]').match(/\bCALL\s+([A-Z_][A-Z0-9_]*)/i);
    return m ? m[1].toUpperCase() : null;
  }

  /* What a CALL runs, line by line, with the callee's own CALLs expanded in
   * turn. The tree stops — with a note saying why — at a program that is not
   * in the library ('missing'), at one already running further up the stack
   * ('recursion'), below opts.maxDepth levels ('depth'), and once
   * opts.budget.left lines have been listed across every expansion that
   * shares the budget ('truncated'). Programs in opts.ignore are not entered.
   * opts.stack names the programs already running, so a program that calls
   * itself through a helper is caught at the first repeat.
   *
   * Blank lines are dropped; comments are kept, as the graph keeps them. */
  function expandCall(programs, name, opts) {
    opts = opts || {};
    var ignore = opts.ignore || {};
    var maxDepth = opts.maxDepth || 6;
    var budget = opts.budget || { left: 5000 };

    function walk(prog, stack) {
      var p = programs[prog];
      if (!p) return { prog: prog, note: 'missing', lines: [] };
      if (stack.indexOf(prog) !== -1) return { prog: prog, note: 'recursion', lines: [] };
      if (stack.length - (opts.stack ? opts.stack.length : 0) >= maxDepth) {
        return { prog: prog, note: 'depth', lines: [] };
      }
      var out = { prog: prog, note: null, lines: [] };
      var lines = (p.parsed || p).lines || [];
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        if (l.comment === null && !String(l.text).trim()) continue;
        if (budget.left <= 0) { out.note = 'truncated'; break; }
        budget.left--;
        var node = { line: l, call: null };
        var c = callTarget(l);
        if (c && !ignore[c]) node.call = walk(c, stack.concat(prog));
        out.lines.push(node);
      }
      return out;
    }
    return walk(name, (opts.stack || []).slice());
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

  var api = {
    buildFlow: buildFlow, callOrder: callOrder, visibleRows: visibleRows, collapseToDepth: collapseToDepth,
    callTarget: callTarget, expandCall: expandCall
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FanucFlow = api;
})(typeof window !== 'undefined' ? window : globalThis);
