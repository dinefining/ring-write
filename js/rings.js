// Rings for a painted grid shape. Each ring is the shape inset by another
// cell with square (mitred) corners, so rings run through the centres of the
// cell layers and only ever go horizontal or vertical. Every ring is offset
// straight from the base outline, so nothing compounds and it stays fast.
import '../vendor/clipper.js'; // sets globalThis.ClipperLib
import { area, inside, dist, perimeter } from './util.js';

const SC = 64; // Clipper works in integers
const L = () => globalThis.ClipperLib;
const toC = p => p.map(q => ({ X: Math.round(q[0] * SC), Y: Math.round(q[1] * SC) }));
const fromC = p => p.map(q => [q.X / SC, q.Y / SC]);

function union(paths) {
  const C = L(), c = new C.Clipper();
  c.AddPaths(paths.map(toC), C.PolyType.ptSubject, true);
  const t = new C.PolyTree();
  c.Execute(C.ClipType.ctUnion, t, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return t;
}

function offset(cpaths, delta) {
  const C = L(), o = new C.ClipperOffset(2, 0.25 * SC);
  o.AddPaths(cpaths, C.JoinType.jtMiter, C.EndType.etClosedPolygon);
  const t = new C.PolyTree();
  o.Execute(t, delta * SC);
  return t;
}

function regions(tree) {
  const out = [];
  const walk = node => {
    for (const o of node.Childs()) {
      const reg = { outer: fromC(o.Contour()), holes: [] };
      for (const h of o.Childs()) { reg.holes.push(fromC(h.Contour())); walk(h); }
      reg.area = Math.abs(area(reg.outer)) - reg.holes.reduce((s, h) => s + Math.abs(area(h)), 0);
      out.push(reg);
    }
  };
  walk(tree);
  return out;
}

function ccontours(tree) {
  const out = [];
  const walk = node => { for (const ch of node.Childs()) { out.push(ch.Contour()); walk(ch); } };
  walk(tree);
  return out;
}

const clockwise = p => (area(p) < 0 ? p.slice().reverse() : p);

function findParent(reg, nodes) {
  const pt = reg.outer[0];
  for (const nd of nodes) if (inside(pt, nd.reg.outer) && !nd.reg.holes.some(h => inside(pt, h))) return nd;
  for (const nd of nodes) if (inside(pt, nd.reg.outer)) return nd;
  return null;
}

// loops: outline loops in world units · g: cell size = ring spacing.
// Pockets are filled one at a time, largest first.
export function insideRings(loops, g, minLen) {
  if (!loops.length) return [];
  const base = ccontours(union(loops));
  const roots = [];
  let prev = null, maxLevel = 0;
  for (let level = 0; level < 600; level++) {
    const regs = regions(offset(base, -g * (level + 0.5)));
    if (!regs.length) break;
    const nodes = regs.map(reg => ({ reg, level, kids: [] }));
    for (const nd of nodes) {
      const par = prev && findParent(nd.reg, prev);
      (par ? par.kids : roots).push(nd);
    }
    prev = nodes;
    maxLevel = level;
  }
  const order = [];
  const stack = roots.sort((a, b) => a.reg.area - b.reg.area);
  while (stack.length) {
    const nd = stack.pop();
    order.push(nd);
    stack.push(...nd.kids.sort((a, b) => a.reg.area - b.reg.area));
  }
  const rings = [];
  for (const nd of order) {
    const t = maxLevel ? nd.level / maxLevel : 0;
    for (const c of [nd.reg.outer, ...nd.reg.holes]) {
      if (perimeter(c) >= minLen) rings.push({ pts: clockwise(c), closed: true, t });
    }
  }
  return rings;
}

// The first ring starts at the left end of its topmost edge, so the text opens
// on a readable line. Each later ring starts at the corner nearest where the
// previous one started, so the seam runs inward and the text reads as a spiral.
export function alignStarts(rings) {
  let prev = null;
  for (const r of rings) {
    let target = prev;
    if (!target) {
      const top = Math.min(...r.pts.map(p => p[1]));
      target = [Math.min(...r.pts.filter(p => p[1] === top).map(p => p[0])), top];
    }
    let bi = 0, bd = Infinity;
    for (let i = 0; i < r.pts.length; i++) {
      const d = dist(r.pts[i], target);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi) r.pts = r.pts.slice(bi).concat(r.pts.slice(0, bi));
    prev = r.pts[0];
  }
  return rings;
}
