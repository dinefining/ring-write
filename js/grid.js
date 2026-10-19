// Painted cells -> outline loops. Cells are keys "i,j"; cell (i, j) covers
// [i, i+1] × [j, j+1] in grid units.

export const key = (i, j) => i + ',' + j;

// Each grid size pairs a cell with a letter size (Monaspace Krypton) that fills it
// without touching its neighbours. [cell, letter]
export const SIZES = [[12, 10], [22, 18], [34, 28]];

export const unkey = k => k.split(',').map(Number);

// Trace the boundary of the painted cells into closed loops (in grid units).
// Every boundary edge keeps the painted side on its right, so outer loops run
// clockwise on screen and holes run the other way.
export function traceLoops(cells) {
  const out = new Map(); // "x,y" -> list of [x2, y2]
  const add = (x1, y1, x2, y2) => {
    const k = x1 + ',' + y1;
    let l = out.get(k);
    if (!l) out.set(k, (l = []));
    l.push([x2, y2, x1, y1]);
  };
  for (const k of cells) {
    const [i, j] = unkey(k);
    if (!cells.has(key(i, j - 1))) add(i, j, i + 1, j);
    if (!cells.has(key(i + 1, j))) add(i + 1, j, i + 1, j + 1);
    if (!cells.has(key(i, j + 1))) add(i + 1, j + 1, i, j + 1);
    if (!cells.has(key(i - 1, j))) add(i, j + 1, i, j);
  }
  const loops = [];
  for (const list of out.values()) {
    while (list.length) {
      let e = list.pop(); // [x2, y2, x1, y1]
      const sx = e[2], sy = e[3];
      const loop = [[sx, sy]];
      for (let guard = 0; guard < 1e7; guard++) {
        const ex = e[0], ey = e[1];
        if (ex === sx && ey === sy) break;
        loop.push([ex, ey]);
        const next = out.get(ex + ',' + ey);
        if (!next || !next.length) break;
        // at a corner shared by two diagonal cells, turn right to keep them apart
        let pick = 0;
        if (next.length > 1) {
          const dx = e[0] - e[2], dy = e[1] - e[3];
          let best = -Infinity;
          next.forEach((n, idx) => {
            const cross = dx * (n[1] - n[3]) - dy * (n[0] - n[2]); // > 0 = right turn on screen
            if (cross > best) { best = cross; pick = idx; }
          });
        }
        e = next.splice(pick, 1)[0];
      }
      const s = simplify(loop);
      if (s.length >= 4) loops.push(s);
    }
  }
  return loops;
}

// Drop points that sit in the middle of a straight run.
function simplify(p) {
  const n = p.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) continue;
    out.push(b);
  }
  return out;
}

// Cells along a line, so fast drags don't leave gaps.
export function line(i0, j0, i1, j1, fn) {
  const di = Math.abs(i1 - i0), dj = Math.abs(j1 - j0);
  const si = i0 < i1 ? 1 : -1, sj = j0 < j1 ? 1 : -1;
  let err = di - dj, i = i0, j = j0;
  for (;;) {
    fn(i, j);
    if (i === i1 && j === j1) break;
    const e2 = 2 * err;
    if (e2 > -dj) { err -= dj; i += si; }
    if (e2 < di) { err += di; j += sj; }
  }
}

export function stampCells(kind, ci, cj, r) {
  const cells = [];
  for (let j = -r; j < r; j++) {
    for (let i = -r; i < r; i++) {
      if (kind === 'circle') {
        const x = i + 0.5, y = j + 0.5;
        if (x * x + y * y > r * r) continue;
      }
      cells.push(key(ci + i, cj + j));
    }
  }
  return cells;
}

export function cellBounds(cells) {
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (const k of cells) {
    const [i, j] = unkey(k);
    if (i < i0) i0 = i;
    if (j < j0) j0 = j;
    if (i > i1) i1 = i;
    if (j > j1) j1 = j;
  }
  return { i0, j0, i1: i1 + 1, j1: j1 + 1 };
}
