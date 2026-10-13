// One letter per cell. Text walks each ring cell by cell, turning with it.
//   · a corner cell stays empty only at a real corner (both sides 3+ cells), so
//     corners read as a clean frame, while stair-steps still carry letters
//   · a cell is only ever used once, even where rings touch or double back
//   · whatever the rings leave over (centre lines, odd bits) is filled with
//     plain horizontal lines, then vertical ones
// Positions don't depend on the text, so the slots are worked out first and
// the text is poured into them afterwards.

export const SEP = Array.from(' · ');

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

// rings: prepared rings · cells: Set of painted "i,j" · g: cell size
// → groups of slots; each group is one ring or one leftover line
export function slotGroups(rings, cells, g) {
  const used = new Set(), groups = [];
  const keyAt = (x, y) => Math.floor(x / g) + ',' + Math.floor(y / g);

  for (const r of rings) {
    const n = r.runs.length, long = r.runs.map(run => run.L >= 3 * g - 0.01);
    const slots = [];
    r.runs.forEach((run, k) => {
      const last = long[k] && long[(k + 1) % n] ? run.L - g : run.L;
      for (let s = g; s <= last + 0.01; s += g) {
        const x = run.a[0] + run.dx * s, y = run.a[1] + run.dy * s, key = keyAt(x, y);
        if (used.has(key) || !cells.has(key)) continue;
        used.add(key);
        slots.push({ x, y, a: run.ang });
      }
    });
    if (slots.length) groups.push(slots);
  }

  // leftovers: horizontal stretches of 2+ cells, then vertical ones
  const left = [...cells].filter(k => !used.has(k)).map(k => k.split(',').map(Number));
  const stretches = (byLine, along, horizontal) => {
    for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
      const xs = byLine.get(line).filter(v => !used.has(horizontal ? v + ',' + line : line + ',' + v)).sort((a, b) => a - b);
      let run = [];
      const flush = () => {
        if (run.length >= 2) {
          groups.push(run.map(v => {
            used.add(horizontal ? v + ',' + line : line + ',' + v);
            return horizontal ? { x: (v + 0.5) * g, y: (line + 0.5) * g, a: 0 } : { x: (line + 0.5) * g, y: (v + 0.5) * g, a: Math.PI / 2 };
          }));
        }
        run = [];
      };
      for (const v of xs) { if (run.length && v !== run[run.length - 1] + 1) flush(); run.push(v); }
      flush();
    }
  };
  const rows = new Map(), cols = new Map();
  for (const [i, j] of left) {
    if (!rows.has(j)) rows.set(j, []);
    rows.get(j).push(i);
    if (!cols.has(i)) cols.set(i, []);
    cols.get(i).push(j);
  }
  stretches(rows, 0, true);
  stretches(cols, 1, false);
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
      c.x = sl.x; c.y = sl.y; c.a = sl.a; c.ring = gi;
      out.glyphs.push(c);
    }
  });
  out.overflow = !repeat && get(i) !== null;
  out.placed = out.glyphs.reduce((n, g) => n + (g.src >= 0 ? 1 : 0), 0);
  return out;
}
