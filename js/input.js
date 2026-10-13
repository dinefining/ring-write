// Canvas pointer handling. It's always painting:
// press on an empty cell paints, press on a painted cell erases; drag to keep going.

export function initInput(app) {
  const cv = app.canvas;
  let op = null;

  const local = e => {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  cv.addEventListener('pointerdown', e => {
    app.hideHint();
    if (op) {
      // a second finger: abandon the stroke rather than guess
      if (op.type === 'paint') app.undoStroke();
      op = { type: 'none', id: op.id };
      return;
    }
    if (e.button !== 0) return;
    try { cv.setPointerCapture(e.pointerId); } catch {}
    const wp = app.toWorld(local(e));
    const c = app.cellAt(wp);
    op = { type: 'paint', id: e.pointerId, add: !app.isPainted(c), last: c };
    app.beginStroke();
    app.brush(c, op.add);
    app.setHover(c);
  });

  cv.addEventListener('pointermove', e => {
    if (!op) { hover(e); return; }
    if (op.type !== 'paint' || e.pointerId !== op.id) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const c = app.cellAt(app.toWorld(local(ev)));
      if (c[0] !== op.last[0] || c[1] !== op.last[1]) {
        app.brushLine(op.last, c, op.add);
        op.last = c;
      }
    }
    app.setHover(op.last);
  });

  const up = e => {
    if (!op || e.pointerId !== op.id) return;
    if (op.type === 'paint') app.commit();
    op = null;
    if (e.type !== 'pointercancel') hover(e);
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !op) app.setHover(null); });

  function hover(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    app.setHover(app.cellAt(app.toWorld(local(e))));
  }

  // no page zoom or scroll on the canvas
  cv.addEventListener('wheel', e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());
}
