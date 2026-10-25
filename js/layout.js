// One letter per cell. Text walks each ring cell by cell, turning with it.
//   · every corner cell gets a letter, facing the way the text came in; the
//     next letter turns
//   · a cell is only ever used once, even where rings touch or double back
//   · whatever the rings leave over (thin strips, centre lines, odd bits) is
//     walked cell by cell as a path, starting where it was painted first
// Positions don't depend on the text, so the slots are worked out first and
// the text is poured into them afterwards.

export const SEP = [' '];

export function prepRing(r) {
  const p = r.pts, n = p.length;
  r.runs = [];
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const L = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (!L) continue;
    r.runs.push({ a, L, dx: (b[0] - a[0]) / L, dy: (b[1] - a[1]) / L, ang: Math.atan2(b[1] - a[1], b[0] - a[0]) });
  }
  return r;
}

export function applyCase(chars, mode) {
  if (mode === 'upper') return chars.map(c => { const u = c.toUpperCase(); return u.length === 1 ? u : c; });
  if (mode === 'lower') return chars.map(c => { const u = c.toLowerCase(); return u.length === 1 ? u : c; });
  return chars;
}

// rings: prepared rings · cells: Set of painted "i,j", in the order they were painted
// g: cell size
// → groups of slots; each group is one ring or one leftover path
export function slotGroups(rings, cells, g) {
  const used = new Set(), groups = [];
  const keyAt = (x, y) => Math.floor(x / g) + ',' + Math.floor(y / g);

  for (const r of rings) {
    const slots = [];
    for (const run of r.runs) {
      for (let s = g; s <= run.L + 0.01; s += g) {
        const x = run.a[0] + run.dx * s, y = run.a[1] + run.dy * s, key = keyAt(x, y);
        if (used.has(key) || !cells.has(key)) continue;
        used.add(key);
        slots.push({ x, y, a: run.ang });
      }
    }
    if (slots.length) groups.push(slots);
  }

  // Leftovers (strips too thin for a ring, centre lines, odd bits) are walked
  // cell by cell as paths: from the end painted first, straight on where
  // possible, otherwise the way the painting went. Each letter faces the way
  // the path came in, so it turns on the cell after a corner, like the rings.
  const order = new Map();
  let idx = 0;
  for (const k of cells) order.set(k, idx++);
  const left = new Set([...cells].filter(k => !used.has(k)));
  const queue = [...left]; // already in painting order
  let qi = 0;
  // neighbours along a path: edge neighbours, plus corner-only steps (a fast
  // drag paints diagonals) when no edge neighbour links the two already
  const orth = k => {
    const [i, j] = k.split(',').map(Number);
    return [[i + 1, j], [i, j + 1], [i - 1, j], [i, j - 1]].map(([a, b]) => a + ',' + b).filter(q => left.has(q));
  };
  const diag = k => {
    const [i, j] = k.split(',').map(Number);
    return [[1, 1], [1, -1], [-1, 1], [-1, -1]]
      .filter(([a, b]) => left.has((i + a) + ',' + (j + b)) && !left.has((i + a) + ',' + j) && !left.has(i + ',' + (j + b)))
      .map(([a, b]) => (i + a) + ',' + (j + b));
  };
  const nbrs = k => orth(k).concat(diag(k));
  const byOrder = (a, b) => order.get(a) - order.get(b);
  const paths = [];
  while (left.size) {
    // the earliest-painted cell picks the piece
    while (!left.has(queue[qi])) qi++;
    const first = queue[qi];
    // start from the end closest (along the path) to where painting began
    const hops = new Map([[first, 0]]), bfs = [first];
    for (let h = 0; h < bfs.length; h++) for (const q of nbrs(bfs[h])) if (!hops.has(q)) { hops.set(q, hops.get(bfs[h]) + 1); bfs.push(q); }
    const ends = bfs.filter(k => nbrs(k).length <= 1).sort((a, b) => hops.get(a) - hops.get(b) || byOrder(a, b));
    let cur = ends[0] || first, prev = null;
    const path = [];
    while (cur) {
      left.delete(cur);
      path.push(cur);
      const next = nbrs(cur);
      if (!next.length) break;
      let pick = null;
      if (prev) {
        const [pi, pj] = prev.split(',').map(Number), [ci, cj] = cur.split(',').map(Number);
        const straight = (2 * ci - pi) + ',' + (2 * cj - pj);
        if (next.includes(straight)) pick = straight;
      }
      const edge = next.filter(q => orth(cur).includes(q));
      prev = cur;
      cur = pick || (edge.length ? edge : next).sort(byOrder)[0];
    }
    if (path.length >= 2) paths.push(path);
  }
  for (const path of paths) {
    const pts = path.map(k => k.split(',').map(Number));
    let a = 0;
    groups.push(pts.map(([i, j], m) => {
      const [fi, fj] = m ? pts[m - 1] : [i, j], [ti, tj] = m ? [i, j] : pts[1];
      const dx = ti - fi, dy = tj - fj;
      // a diagonal step keeps the way the path was already going, so letters stay upright or on their side
      if (!dx || !dy) a = Math.atan2(dy, dx);
      else if (!m) a = Math.atan2(0, dx);
      return { x: (i + 0.5) * g, y: (j + 0.5) * g, a };
    }));
  }
  return groups;
}

// Pour the text into the slots. A new line jumps to the next group.
export function pour(groups, chars, s) {
  const disp = applyCase(chars, s.case);
  const N = disp.length;
  const out = { glyphs: [], overflow: false, capacity: groups.reduce((n, gr) => n + gr.length, 0), placed: 0 };
  if (!N) return out;
  const cyc = disp.concat(SEP), C = cyc.length;
  const repeat = s.fill === 'repeat';
  const limit = repeat ? Infinity : N;
  const get = i => {
    if (i >= limit) return null;
    const j = i % C;
    return { ch: cyc[j], src: j < N ? j : -1, copy: Math.floor(i / C) };
  };

  let i = 0;
  groups.forEach((slots, gi) => {
    let k = 0;
    while (k < slots.length) {
      const c = get(i);
      if (!c) return;
      i++;
      if (c.ch === '\n') { if (k) return; continue; }
      const sl = slots[k++];
      c.x = sl.x; c.y = sl.y; c.a = sl.a; c.g = sl.g; c.ring = gi;
      out.glyphs.push(c);
    }
  });
  out.overflow = !repeat && get(i) !== null;
  out.placed = out.glyphs.reduce((n, g) => n + (g.src >= 0 ? 1 : 0), 0);
  return out;
}
