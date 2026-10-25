// Draws one frame: artboard, grid, painted shape, letters, outline.
// The world origin is the centre of the artboard; cell (i, j) covers
// [i·g, (i+1)·g] × [j·g, (j+1)·g]. UI overlays come from a callback so exports skip them.

// perceived brightness of a #rrggbb colour, 0..1
function luma(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

function addPoly(path, pts) {
  if (!pts.length) return;
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
  path.closePath();
}

// o: { W, H, dpr, view, s (with colors), board, loops, glyphs, tint, fonts, grid, transparent, overlay }
// glyphs carry their cell size g; fonts maps cell size -> canvas font
// tint: [x, y, size, colour index] per cell, when the highlight is on
export function drawScene(ctx, o) {
  const { s, view, dpr, board: b } = o;
  const g = s.grid, col = s.colors;
  const k = dpr * view.scale, tx = view.x * dpr, ty = view.y * dpr;
  const world = () => ctx.setTransform(k, 0, 0, k, tx, ty);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (!o.transparent) {
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, o.W, o.H);
  }

  // grid lines, snapped to device pixels so they stay hairline-crisp
  if (o.grid && g * k >= 5) {
    const X0 = b.x * k + tx, Y0 = b.y * k + ty, X1 = X0 + b.w * k, Y1 = Y0 + b.h * k;
    ctx.beginPath();
    for (let i = Math.ceil(b.x / g); i * g <= b.x + b.w; i++) { const X = Math.round(i * g * k + tx) + 0.5; ctx.moveTo(X, Y0); ctx.lineTo(X, Y1); }
    for (let j = Math.ceil(b.y / g); j * g <= b.y + b.h; j++) { const Y = Math.round(j * g * k + ty) + 0.5; ctx.moveTo(X0, Y); ctx.lineTo(X1, Y); }
    ctx.strokeStyle = col.stroke;
    ctx.globalAlpha = 0.08;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  world();
  const shape = new Path2D();
  for (const l of o.loops) addPoly(shape, l);
  ctx.fillStyle = col.fill;
  ctx.fill(shape, 'evenodd');

  if (o.tint && col.tints) {
    for (const [x, y, z, c] of o.tint) {
      ctx.fillStyle = col.tints[c];
      ctx.fillRect(x, y, z, z);
    }
  }

  if (o.glyphs.length) {
    let font = null;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = col.text;
    // on highlighted cells the text takes whichever of ink or paper reads better on that colour
    const tintAt = o.tint && col.tints ? new Map(o.tint.map(([x, y, z, c]) => [x + ',' + y, c])) : null;
    const onTint = col.tints ? col.tints.map(c => (luma(c) > 0.55 ? '#111111' : '#ffffff')) : null;
    for (const gl of o.glyphs) {
      if (gl.ch === ' ') continue;
      if (o.fonts[gl.g] !== font) ctx.font = font = o.fonts[gl.g];
      if (tintAt) {
        const c = tintAt.get(Math.floor(gl.x / gl.g) * gl.g + ',' + Math.floor(gl.y / gl.g) * gl.g);
        ctx.fillStyle = c === undefined ? col.text : onTint[c];
      }
      const c = Math.round(Math.cos(gl.a)) * k, sn = Math.round(Math.sin(gl.a)) * k;
      ctx.setTransform(c, sn, -sn, c, Math.round(gl.x * k + tx), Math.round(gl.y * k + ty));
      ctx.fillText(gl.ch, 0, 0);
    }
    world();
  }

  // a fine outline: whole device pixels, nudged onto the pixel grid so it stays crisp
  if (col.line && o.loops.length) {
    // dark lines on white read thinner than light lines on black, so they get a touch more weight;
    // the weight follows the grid (tuned at 22, finer at 12, heavier at 34)
    const dark = col.stroke !== '#ffffff';
    const w = Math.max(1, Math.round(k * (dark ? 0.9 : 0.6) * (g / 22))), nudge = (w % 2) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    for (const l of o.loops) {
      l.forEach((p, i) => {
        const X = Math.round(p[0] * k + tx) + nudge, Y = Math.round(p[1] * k + ty) + nudge;
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      });
      ctx.closePath();
    }
    ctx.strokeStyle = col.stroke;
    ctx.lineWidth = w;
    ctx.lineJoin = 'miter';
    ctx.stroke();
    world();
  }

  if (o.overlay) o.overlay(ctx, { k, tx, ty, world });
}
