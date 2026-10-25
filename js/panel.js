// Floating controls: two buttons (text, controls), each opening a panel of tiles.
// Panels stack when both are open. Tiles follow one rule set: grey tile,
// darker fill for slider values, solid ink for whatever is on.
import { clamp, el, $ } from './util.js';
import { SIZES } from './grid.js';

const PREFS = 'ring_write.ui.v2';

export function buildPanel(app) {
  const syncs = [];
  const S = () => app.doc.s;
  const syncAll = () => { for (const f of syncs) f(); };

  // keep mouse clicks from parking focus on buttons
  $('#ui').addEventListener('mousedown', e => {
    if (!e.target.closest('textarea, input')) e.preventDefault();
  });

  const row = (parent, cls = '') => { const r = el('div', 'row ' + cls); parent.appendChild(r); return r; };

  // the whole tile is the slider; the darker fill shows the value
  // o.values: discrete values the slider snaps to (stored value is the value, not the index)
  function slider(parent, o) {
    const t = el('div', 'tile slider');
    t.tabIndex = 0;
    t.setAttribute('role', 'slider');
    t.setAttribute('aria-label', o.label);
    const fill = el('div', 'fill'), lab = el('span', 'label', o.label);
    t.append(fill, lab);
    parent.appendChild(t);
    const n = o.values.length;
    const idx = () => Math.max(0, o.values.indexOf(S()[o.key]));
    let dragging = false, touch = false, moved = false, x0 = 0, pid = null;
    const sync = () => {
      const i = idx();
      fill.style.width = ((i + 1) / n) * 100 + '%';
      t.setAttribute('aria-valuenow', S()[o.key]);
      t.setAttribute('aria-valuetext', o.fmt(S()[o.key]));
      lab.textContent = dragging ? o.fmt(S()[o.key]) : o.label;
    };
    const setX = x => {
      const r = t.getBoundingClientRect();
      const i = clamp(Math.floor(((x - r.left) / r.width) * n), 0, n - 1);
      if (o.values[i] !== S()[o.key]) app.set(o.key, o.values[i]);
      sync();
    };
    t.addEventListener('pointerdown', e => {
      if (e.button) return;
      touch = e.pointerType !== 'mouse';
      pid = e.pointerId; x0 = e.clientX; moved = false; dragging = true;
      t.setPointerCapture(pid);
      t.classList.add('drag');
      if (!touch) setX(e.clientX);
      sync();
    });
    t.addEventListener('pointermove', e => {
      if (!dragging || e.pointerId !== pid) return;
      if (touch && !moved) { if (Math.abs(e.clientX - x0) < 6) return; moved = true; }
      setX(e.clientX);
    });
    const end = (e, cancel) => {
      if (!dragging) return;
      dragging = false;
      t.classList.remove('drag');
      if (touch && !moved && !cancel) setX(e.clientX);
      sync();
      app.commit();
    };
    t.addEventListener('pointerup', e => end(e));
    t.addEventListener('pointercancel', e => end(e, true));
    t.addEventListener('keydown', e => {
      let i = idx();
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i++;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i--;
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = n - 1;
      else return;
      e.preventDefault();
      app.set(o.key, o.values[clamp(i, 0, n - 1)]);
      sync();
      app.commitSoon();
    });
    syncs.push(sync);
  }

  // a tile button; o.pressed() decides whether it shows as on
  function button(parent, label, o = {}) {
    const b = el('button', 'tile' + (o.cls ? ' ' + o.cls : ''), label);
    b.type = 'button';
    if (o.aria) b.setAttribute('aria-label', o.aria);
    if (o.chip) b.prepend(el('i', 'chip ' + o.chip));
    b.addEventListener('click', () => { o.onClick(); syncAll(); });
    parent.appendChild(b);
    if (o.pressed) syncs.push(() => b.setAttribute('aria-pressed', o.pressed()));
    if (o.disabled) syncs.push(() => { b.disabled = o.disabled(); });
    return b;
  }
  const choose = (k, v) => () => { app.set(k, v); app.commit(); };

  // ---------- the two buttons
  const bar = $('#bar');
  const textP = $('#p-text'), ctrlP = $('#p-ctrl');
  // text opens by default, except on phones where it would cover the drawing
  // one panel at a time; clicking the open one closes it
  let open = null; // both panels start closed
  try { const saved = JSON.parse(localStorage.getItem(PREFS) || 'null'); if (saved && 'open' in saved) open = saved.open; } catch {}
  const show = () => {
    textP.hidden = open !== 'text';
    ctrlP.hidden = open !== 'ctrl';
    try { localStorage.setItem(PREFS, JSON.stringify({ open })); } catch {}
    if (open === 'text') { grow(); syncThumb(); }
  };
  for (const [name, label] of [['text', 'text'], ['ctrl', 'controls']]) {
    const b = button(bar, label, { onClick: () => { open = open === name ? null : name; show(); }, pressed: () => open === name });
    b.setAttribute('aria-controls', 'p-' + name);
  }

  // ---------- text panel
  // the text grows inside a scroll area (mirror and textarea scroll together),
  // with the character count pinned to the bottom of the box
  const box = el('div', 'tile textbox');
  const scroll = el('div', 'scroll');
  const wrap = el('div', 'textwrap');
  const mirror = el('div', 'mirror');
  mirror.setAttribute('aria-hidden', 'true');
  const ta = el('textarea', 'text');
  ta.spellcheck = false;
  ta.setAttribute('aria-label', 'Text');
  ta.rows = 6;
  wrap.append(mirror, ta);
  scroll.appendChild(wrap);
  const status = el('div', 'status');
  status.setAttribute('role', 'status');
  // our own square scrollbar (browsers won't let us square off theirs)
  const track = el('div', 'track'), thumb = el('div', 'thumb');
  track.setAttribute('aria-hidden', 'true');
  track.appendChild(thumb);
  box.append(scroll, track, status);
  textP.appendChild(box);
  const syncThumb = () => {
    const { scrollTop: t, scrollHeight: h, clientHeight: c } = scroll;
    track.hidden = h <= c + 1;
    if (track.hidden) return;
    track.style.top = scroll.offsetTop + 'px';
    track.style.height = c + 'px';
    const th = Math.max(16, (c / h) * c);
    thumb.style.height = th + 'px';
    thumb.style.transform = `translateY(${(t / (h - c)) * (c - th)}px)`;
  };
  scroll.addEventListener('scroll', syncThumb);
  new ResizeObserver(syncThumb).observe(scroll);
  let drag = null;
  thumb.addEventListener('pointerdown', e => {
    drag = { y: e.clientY, top: scroll.scrollTop };
    thumb.setPointerCapture(e.pointerId);
    thumb.classList.add('drag');
  });
  thumb.addEventListener('pointermove', e => {
    if (!drag) return;
    const { scrollHeight: h, clientHeight: c } = scroll;
    const th = thumb.offsetHeight;
    scroll.scrollTop = drag.top + ((e.clientY - drag.y) * (h - c)) / Math.max(1, c - th);
  });
  const endDrag = () => { drag = null; thumb.classList.remove('drag'); };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
  function grow() { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  ta.addEventListener('input', () => { app.setText(ta.value); grow(); syncThumb(); });
  syncs.push(() => { if (ta.value !== app.doc.text) { ta.value = app.doc.text; grow(); syncThumb(); } });

  // ---------- controls panel
  let r = row(ctrlP);
  slider(r, { key: 'grid', label: 'grid', values: SIZES.map(z => z[0]), fmt: v => `grid ${v}` });
  slider(r, { key: 'brush', label: 'brush', values: [1, 2, 3, 4, 5], fmt: v => `brush ${v}` });

  // on = black. The border only matters when shape and background match.
  r = row(ctrlP);
  const flip = k => () => { app.set(k, S()[k] === 'black' ? 'white' : 'black'); app.commit(); };
  button(r, 'bg', { aria: 'Black background', onClick: flip('bg'), pressed: () => S().bg === 'black' });
  button(r, 'shape', { aria: 'Black shape', onClick: flip('shape'), pressed: () => S().shape === 'black' });
  button(r, 'border', {
    aria: 'Border', onClick: () => { app.set('outline', !S().outline); app.commit(); },
    pressed: () => !!S().outline && S().bg === S().shape && !S().color, disabled: () => S().bg !== S().shape || !!S().color,
  });

  // highlight each repeat of the text. Each swatch opens our own picker under
  // the row (the system one can't be closed from the page); the same swatch closes it.
  // Swatches are greyed out while the highlight is off.
  r = row(ctrlP);
  button(r, 'colour', {
    aria: 'Highlight each repeat',
    onClick: () => { app.set('color', !S().color); if (!S().color) editing = -1; app.commit(); },
    pressed: () => !!S().color,
  });
  const sw = el('div', 'swatches');
  const swatches = [];
  let editing = -1;
  for (let n = 0; n < 4; n++) {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.setAttribute('aria-label', `Highlight colour ${n + 1}`);
    b.addEventListener('click', () => { editing = editing === n ? -1 : n; syncAll(); });
    sw.appendChild(b);
    swatches.push(b);
  }
  r.appendChild(sw);
  const pick = buildPicker(ctrlP, hex => {
    if (editing < 0) return;
    const t = S().tints.slice();
    t[editing] = hex;
    app.set('tints', t);
    swatches[editing].style.setProperty('--c', hex);
  }, () => app.commit());
  syncs.push(() => {
    if (!S().color) editing = -1;
    swatches.forEach((b, n) => {
      b.style.setProperty('--c', S().tints[n]);
      b.disabled = !S().color;
      b.setAttribute('aria-pressed', editing === n);
    });
    pick.show(editing >= 0 ? S().tints[editing] : null);
  });

  r = row(ctrlP);
  button(r, 'repeat', { onClick: choose('fill', 'repeat'), pressed: () => S().fill === 'repeat' });
  button(r, 'once', { aria: 'Write the text once', onClick: choose('fill', 'empty'), pressed: () => S().fill === 'empty' });

  r = row(ctrlP);
  button(r, 'undo', { onClick: () => app.action('undo'), disabled: () => !app.canUndo() });
  button(r, 'redo', { onClick: () => app.action('redo'), disabled: () => !app.canRedo() });
  button(r, 'clear', { onClick: () => app.action('clear') });
  button(r, 'reset', { onClick: () => app.action('reset') });

  r = row(ctrlP);
  button(r, 'jpg', { onClick: () => app.action('jpg') });
  button(r, 'png', { onClick: () => app.action('png') });

  show();

  // Grey out the part of the text that didn't fit.
  let lastMirror = '';
  function updateText(chars, placed, info) {
    let html = '', run = '', runOff = null;
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    for (let i = 0; i < chars.length; i++) {
      const off = !placed[i];
      if (off !== runOff && run) { html += runOff ? `<span class="off">${esc(run)}</span>` : esc(run); run = ''; }
      runOff = off;
      run += chars[i];
    }
    if (run) html += runOff ? `<span class="off">${esc(run)}</span>` : esc(run);
    html += '\n ';
    if (html !== lastMirror) { mirror.innerHTML = html; lastMirror = html; }
    status.textContent = info;
  }

  return { sync: syncAll, updateText };
}

// A small colour picker: saturation/brightness square, hue strip, hex field.
// onInput(hex) while dragging or typing, onDone() when a change is finished.
function buildPicker(parent, onInput, onDone) {
  const box = el('div', 'tile picker');
  box.hidden = true;
  const sv = el('div', 'sv'), svDot = el('i', 'dot');
  const hue = el('div', 'hue'), hueDot = el('i', 'dot');
  const hex = el('input', 'hex');
  hex.spellcheck = false;
  hex.maxLength = 7;
  hex.setAttribute('aria-label', 'Hex colour');
  sv.appendChild(svDot);
  hue.appendChild(hueDot);
  box.append(sv, hue, hex);
  parent.appendChild(box);
  let h = 0, sat = 0, val = 0, current = null;

  const paint = () => {
    sv.style.background = `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h}, 100%, 50%))`;
    svDot.style.left = sat * 100 + '%';
    svDot.style.top = (1 - val) * 100 + '%';
    hueDot.style.left = (h / 360) * 100 + '%';
  };
  const emit = () => {
    current = hsvToHex(h, sat, val);
    if (document.activeElement !== hex) hex.value = current;
    paint();
    onInput(current);
  };
  const drag = (elm, fn) => {
    elm.addEventListener('pointerdown', e => {
      elm.setPointerCapture(e.pointerId);
      fn(e);
      const move = ev => fn(ev);
      const up = () => { elm.removeEventListener('pointermove', move); elm.removeEventListener('pointerup', up); elm.removeEventListener('pointercancel', up); onDone(); };
      elm.addEventListener('pointermove', move);
      elm.addEventListener('pointerup', up);
      elm.addEventListener('pointercancel', up);
    });
  };
  const frac = (e, elm, axis) => {
    const r = elm.getBoundingClientRect();
    return axis === 'x' ? clamp((e.clientX - r.left) / r.width, 0, 1) : clamp((e.clientY - r.top) / r.height, 0, 1);
  };
  drag(sv, e => { sat = frac(e, sv, 'x'); val = 1 - frac(e, sv, 'y'); emit(); });
  drag(hue, e => { h = frac(e, hue, 'x') * 360; emit(); });
  hex.addEventListener('input', () => {
    let v = hex.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (!/^#[0-9a-f]{6}$/i.test(v)) return;
    [h, sat, val] = hexToHsv(v.toLowerCase());
    emit();
  });
  hex.addEventListener('change', () => { hex.value = current; onDone(); });

  return {
    // show(hex) opens it on that colour; show(null) closes it
    show(c) {
      box.hidden = !c;
      if (!c || c === current) return;
      current = c;
      [h, sat, val] = hexToHsv(c);
      hex.value = c;
      paint();
    },
  };
}

function hexToHsv(c) {
  const n = parseInt(c.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}

function hsvToHex(h, s, v) {
  const f = k => { const x = (k + h / 60) % 6; return v - v * s * Math.max(0, Math.min(x, 4 - x, 1)); };
  return '#' + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
