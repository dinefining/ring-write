// ring_write — paint a shape on the grid, and your text fills it in rings.
import { debounce, $ } from './util.js';
import { key, traceLoops, line, SIZES } from './grid.js';
import { insideRings, alignStarts } from './rings.js';
import { prepRing, slotGroups, pour } from './layout.js';
import { drawScene } from './render.js';
import { buildPanel } from './panel.js';
import { initInput } from './input.js';
import { decodeDoc, deliver, stamp, coarse } from './io.js';

const STORE = 'ring_write.cells.v5'; // bumped when the opening piece changes
const HINTED = 'ring_write.hinted';
const FONT = 'Press Start 2P';

const gridSize = () => app.doc.s.grid;
const letterSize = () => (SIZES.find(z => z[0] === gridSize()) || SIZES[0])[1];

const DEFAULTS = {
  grid: 12, brush: 3, fill: 'repeat', outline: false,
  bg: 'white', shape: 'white',
};

// Two choices make the palette: background and shape fill, each black or white.
// Text always contrasts with the shape; lines contrast with the background.
const INK = '#111111', PAPER = '#ffffff';
function colorsOf(s) {
  return {
    bg: s.bg === 'black' ? INK : PAPER,
    fill: s.shape === 'black' ? INK : PAPER,
    text: s.shape === 'black' ? PAPER : INK,
    stroke: s.bg === 'black' ? PAPER : INK,
    // the outline is only drawn where shape and background are the same colour
    line: s.outline && s.bg === s.shape,
  };
}

const SAMPLE =
  'You are rich. You own. We are poor. We lack. You have. We do not have. ' +
  'Everything is beautiful here, only not the faces. On Anarres nothing is beautiful, ' +
  'nothing but the faces... And you, the possessors are possessed. You are all in jail, ' +
  'each alone, solitary with a heap of what he owns. You live in prison, die in prison.';

const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
const stage = $('#stage');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const app = {
  canvas,
  doc: null,
  cells: new Set(),
  view: { x: 0, y: 0, scale: 1 },
  hover: null,
  loops: [], rings: [], groups: [], layout: null,
  dirtyGeom: true, dirtyLayout: true, needs: true,
  cw: 0, ch: 0, dpr: 1,
};

// ---------------------------------------------------------------- doc
// The artboard is the whole window. World origin is its centre, so a piece
// stays centred on any screen. No zoom, no pan.

const board = () => ({ x: -app.cw / 2, y: -app.ch / 2, w: app.cw, h: app.ch });

// The opening piece: a plain rectangle, sized to the screen.
function freshDoc() {
  const s = structuredClone(DEFAULTS);
  const b = board();
  const rw = Math.max(4, Math.floor((b.w * 0.3) / s.grid)), rh = Math.max(3, Math.floor((b.h * 0.3) / s.grid));
  const cells = [];
  for (let j = -rh; j < rh; j++) for (let i = -rw; i < rw; i++) cells.push(key(i, j));
  return { v: 6, cells, text: SAMPLE, s };
}

function normalize(d) {
  const s = { ...structuredClone(DEFAULTS), ...(d && d.s) };
  for (const k of Object.keys(s)) if (!(k in DEFAULTS)) delete s[k];
  if (!SIZES.some(z => z[0] === s.grid)) s.grid = DEFAULTS.grid;
  return {
    v: 5,
    cells: Array.isArray(d && d.cells) ? d.cells.filter(c => typeof c === 'string' && /^-?\d+,-?\d+$/.test(c)) : [],
    text: typeof (d && d.text) === 'string' ? d.text : SAMPLE,
    s,
  };
}

function setDoc(d) {
  app.doc = d;
  app.cells = new Set(d.cells);
  applyTheme();
  touchGeom();
}

// The panels invert with the background.
function applyTheme() {
  document.documentElement.dataset.theme = app.doc.s.bg === 'black' ? 'dark' : 'light';
}

// ---------------------------------------------------------------- history + autosave

const hist = { stack: [], i: -1 };
function snapshot() {
  app.doc.cells = [...app.cells];
  return JSON.stringify(app.doc);
}
function save(snap) {
  try { localStorage.setItem(STORE, snap); } catch { /* full or blocked */ }
}

app.commit = () => {
  app.commitSoon.cancel();
  const snap = snapshot();
  if (snap === hist.stack[hist.i]) return;
  hist.stack = hist.stack.slice(0, hist.i + 1);
  hist.stack.push(snap);
  if (hist.stack.length > 150) hist.stack.shift();
  hist.i = hist.stack.length - 1;
  save(snap);
  panel && panel.sync();
};
app.commitSoon = debounce(() => app.commit(), 500);
app.canUndo = () => hist.i > 0;
app.canRedo = () => hist.i < hist.stack.length - 1;

function restore(snap) {
  setDoc(normalize(JSON.parse(snap)));
  panel.sync();
  save(snap);
}
function undo() {
  app.commitSoon.flush();
  if (hist.i <= 0) return;
  hist.i--;
  restore(hist.stack[hist.i]);
}
function redo() {
  if (hist.i >= hist.stack.length - 1) return;
  hist.i++;
  restore(hist.stack[hist.i]);
}

// ---------------------------------------------------------------- settings from the panel

function touchGeom() { app.dirtyGeom = true; app.needs = true; }
function touchLayout() { app.dirtyLayout = true; app.needs = true; }

app.set = (k, val) => {
  app.doc.s[k] = val;
  if (k === 'bg') applyTheme();
  if (k === 'grid') touchGeom(); else touchLayout();
};

app.setText = str => {
  app.doc.text = str;
  touchLayout();
  app.commitSoon();
};

// ---------------------------------------------------------------- painting

// cells fully inside the artboard
function inBoard(i, j) {
  const b = board(), g = gridSize();
  return i * g >= b.x - 1e-6 && (i + 1) * g <= b.x + b.w + 1e-6 && j * g >= b.y - 1e-6 && (j + 1) * g <= b.y + b.h + 1e-6;
}

app.cellAt = wp => {
  const g = gridSize();
  return [Math.floor(wp[0] / g), Math.floor(wp[1] / g)];
};
app.isPainted = c => app.cells.has(key(c[0], c[1]));

function brushCells(c) {
  const b = app.doc.s.brush, o = Math.floor((b - 1) / 2), out = [];
  for (let j = 0; j < b; j++) for (let i = 0; i < b; i++) out.push([c[0] - o + i, c[1] - o + j]);
  return out;
}
function apply(c, add) {
  for (const [i, j] of brushCells(c)) {
    const k = key(i, j);
    if (add) { if (inBoard(i, j)) app.cells.add(k); } else app.cells.delete(k);
  }
}

let strokeChanged = false;
app.beginStroke = () => { strokeChanged = false; };
app.brush = (c, add) => { apply(c, add); strokeChanged = true; touchGeom(); };
app.brushLine = (a, b, add) => {
  line(a[0], a[1], b[0], b[1], (i, j) => apply([i, j], add));
  strokeChanged = true;
  touchGeom();
};
app.undoStroke = () => {
  if (strokeChanged && hist.stack[hist.i]) restore(hist.stack[hist.i]);
};
app.setHover = c => {
  if (c && !inBoard(c[0], c[1])) c = null;
  const same = (c && app.hover && c[0] === app.hover[0] && c[1] === app.hover[1]) || (!c && !app.hover);
  if (same) return;
  app.hover = c;
  app.needs = true;
};

// ---------------------------------------------------------------- actions

app.action = name => {
  switch (name) {
    case 'undo': return undo();
    case 'redo': return redo();
    case 'clear':
      if (!app.cells.size) return;
      app.cells.clear();
      touchGeom();
      app.commit();
      return toast('cleared · undo to bring it back');
    case 'reset':
      setDoc(freshDoc());
      panel.sync();
      app.commit();
      return toast('reset · undo to go back');
    case 'jpg': case 'png': return exportImage(name);
  }
};

// JPG: the whole board, background and all. PNG: only the shape (fill, letters,
// line) on transparency, cropped tight around it.
async function exportImage(kind) {
  app.commitSoon.flush();
  const s = { ...app.doc.s, grid: gridSize(), colors: colorsOf(app.doc.s) };
  let b = board();
  const png = kind === 'png';
  if (png) {
    const pts = app.loops.flat();
    if (!pts.length) return toast('nothing to export yet');
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), pad = 1;
    b = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  const scale = Math.max(1, Math.min(3, Math.floor(8000 / Math.max(b.w, b.h))));
  const W = Math.round(b.w * scale), H = Math.round(b.h * scale);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  drawScene(c.getContext('2d'), {
    W, H, dpr: 1, s, board: b,
    view: { x: -b.x * scale, y: -b.y * scale, scale },
    loops: app.loops, glyphs: app.layout ? app.layout.glyphs : [],
    font: fontStr(), grid: false, transparent: png,
  });
  const blob = await new Promise(res => c.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.92));
  if (!blob) return toast('export failed');
  const res = await deliver(blob, `ring_write-${stamp()}.${kind}`);
  if (res === 'downloaded') toast(`saved ${kind}`);
}

// ---------------------------------------------------------------- geometry + layout

function fontStr() {
  return `${letterSize()}px "${FONT}", monospace`;
}

function computeGeom() {
  const g = gridSize();
  // cells outside the board (after a resize or grid change) are kept but ignored
  const live = new Set();
  for (const k of app.cells) {
    const [i, j] = k.split(',').map(Number);
    if (inBoard(i, j)) live.add(k);
  }
  app.loops = traceLoops(live).map(l => l.map(p => [p[0] * g, p[1] * g]));
  let rings = [];
  try { rings = insideRings(app.loops, g, 1); } catch (e) { console.warn('ring generation failed', e); }
  alignStarts(rings);
  rings.forEach(prepRing);
  app.rings = rings;
  app.groups = slotGroups(rings, live, g);
  app.liveCount = live.size;
  app.dirtyLayout = true;
}

const updatePanelText = debounce(() => {
  const L = app.layout;
  if (!L) return;
  const s = app.doc.s;
  const chars = Array.from(app.doc.text), N = chars.length, placed = new Uint8Array(N);
  for (const g of L.glyphs) if (g.src >= 0) placed[g.src] = 1;
  const nf = n => n.toLocaleString('en-US');
  let status;
  if (!app.liveCount) status = 'paint a shape to start';
  else if (!N) status = `0 / ${nf(L.capacity)} · type something`;
  else if (s.fill === 'repeat') status = `${nf(N)} chars · repeating`;
  else if (L.overflow) status = `${nf(L.placed)} / ${nf(N)} · … full`;
  else status = `${nf(N)} / ${nf(L.capacity)} chars`;
  panel.updateText(chars, placed, status);
}, 80);

function computeLayout() {
  const L = pour(app.groups, Array.from(app.doc.text), app.doc.s);
  app.layout = L;
  updatePanelText();
}

// ---------------------------------------------------------------- view: centred, whole pixels, no zoom

function fitView() {
  if (!app.cw) return;
  app.view = { scale: 1, x: Math.round(app.cw / 2), y: Math.round(app.ch / 2) };
  app.needs = true;
  if (app.doc) touchGeom(); // the board changed size, so cells near the edge may come or go
}

app.toWorld = sp => [(sp[0] - app.view.x) / app.view.scale, (sp[1] - app.view.y) / app.view.scale];

// ---------------------------------------------------------------- drawing the frame

function overlay(ctx) {
  const s = app.doc.s, px = 1 / app.view.scale, g = gridSize(), col = colorsOf(s);

  // brush preview: solid to paint, dashed to erase
  if (app.hover) {
    const b = s.brush, o = Math.floor((b - 1) / 2);
    ctx.strokeStyle = col.stroke;
    ctx.lineWidth = 1.5 * px;
    ctx.globalAlpha = 0.6;
    if (app.isPainted(app.hover)) ctx.setLineDash([3 * px, 3 * px]);
    ctx.strokeRect((app.hover[0] - o) * g, (app.hover[1] - o) * g, b * g, b * g);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

function draw() {
  const s = app.doc.s;
  drawScene(ctx, {
    W: canvas.width, H: canvas.height, dpr: app.dpr, view: app.view, s: { ...s, grid: gridSize(), colors: colorsOf(s) }, board: board(),
    loops: app.loops, glyphs: app.layout ? app.layout.glyphs : [],
    font: fontStr(), grid: true, overlay,
  });
}

function loop() {
  requestAnimationFrame(loop);
  if (app.dirtyGeom) { app.dirtyGeom = false; computeGeom(); }
  if (app.dirtyLayout) { app.dirtyLayout = false; computeLayout(); app.needs = true; }
  if (!app.needs) return;
  app.needs = false;
  draw();
}

// ---------------------------------------------------------------- chrome: toast, hint, info

let toastTimer = 0;
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

app.hideHint = () => {
  const h = $('#hint');
  if (!h.classList.contains('show')) return;
  h.classList.remove('show');
  try { localStorage.setItem(HINTED, '1'); } catch {}
};

const info = $('#info'), infoBtn = $('#info-btn');
function openInfo(open) {
  info.hidden = !open;
  infoBtn.setAttribute('aria-expanded', String(open));
  infoBtn.classList.toggle('on', open);
}
infoBtn.addEventListener('click', () => openInfo(info.hidden));
document.addEventListener('pointerdown', e => {
  if (!info.hidden && !info.contains(e.target) && !infoBtn.contains(e.target)) openInfo(false);
}, true);

// ---------------------------------------------------------------- keyboard

addEventListener('keydown', e => {
  const t = e.target;
  const inField = t.tagName === 'TEXTAREA' || t.tagName === 'INPUT';
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && (k === 'z' || k === 'y')) {
    e.preventDefault();
    (k === 'y' || e.shiftKey) ? redo() : undo();
    return;
  }
  if (e.key === 'Escape') { if (!info.hidden) openInfo(false); return; }
  if (inField || mod || e.altKey) return;
  if (/^[1-5]$/.test(k)) { app.set('brush', +k); app.commit(); }
});

// ---------------------------------------------------------------- sizing

function resize() {
  const r = stage.getBoundingClientRect();
  app.cw = Math.round(r.width);
  app.ch = Math.round(r.height);
  app.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(app.cw * app.dpr);
  canvas.height = Math.round(app.ch * app.dpr);
  fitView();
}
new ResizeObserver(resize).observe(stage);

// ---------------------------------------------------------------- start

let panel;

async function start() {
  if (document.readyState !== 'complete') await new Promise(r => addEventListener('load', r, { once: true }));
  for (let i = 0; i < 40 && stage.getBoundingClientRect().width < 50; i++) await new Promise(r => setTimeout(r, 25));
  resize();

  let doc = null;
  const m = location.hash.match(/^#d=(.+)$/);
  if (m) {
    try { doc = await decodeDoc(m[1]); } catch { toast("that link didn't open"); }
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (!doc) {
    try { const saved = localStorage.getItem(STORE); if (saved) doc = JSON.parse(saved); } catch {}
  }
  setDoc(doc ? normalize(doc) : freshDoc());

  panel = buildPanel(app);
  initInput(app);
  computeGeom();
  panel.sync();
  app.commit();
  document.fonts.load(`16px "${FONT}"`, 'abc').then(() => { app.needs = true; }).catch(() => {});

  let hinted = false;
  try { hinted = localStorage.getItem(HINTED) === '1'; } catch {}
  if (!hinted) {
    const h = $('#hint');
    h.textContent = coarse() ? 'drag to paint · drag on painted cells to erase' : 'drag to paint cells · drag on painted cells to erase';
    setTimeout(() => h.classList.add('show'), 600);
  }

  requestAnimationFrame(loop);
}

if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__rw = app; // dev handle
start();
