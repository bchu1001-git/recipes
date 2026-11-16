// Small DOM helpers. Everything a recipe contains is added as text, never as HTML,
// so nothing imported from a web page or read from a photo can run as code.

/** Creates an element. `props` takes class, text, style (an object), data (an object), on<event> handlers and plain attributes. */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'style') for (const [p, v] of Object.entries(value)) el.style.setProperty(p, v);
      else if (key === 'data') for (const [d, v] of Object.entries(value)) el.dataset[d] = v;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected') el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) append(el, kid);
    else el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  back: { d: 'M15 5l-7 7 7 7' },
  plus: { d: 'M12 5v14M5 12h14' },
  check: { d: 'M5 12.5l4.5 4.5L19 7.5' },
  close: { d: 'M6 6l12 12M18 6L6 18' },
  chevron: { d: 'M9 6l6 6-6 6' },
  down: { d: 'M6 9l6 6 6-6' },
  search: { d: 'M10.5 16.5a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM15 15l5 5' },
  sliders: { d: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4' },
  more: { d: 'M5 12h.01M12 12h.01M19 12h.01', width: 3.2 },
  heart: { d: 'M12 20.5C6.2 16.6 3.5 13.4 3.5 9.9A4.4 4.4 0 0 1 12 8.3a4.4 4.4 0 0 1 8.5 1.6c0 3.5-2.7 6.7-8.5 10.6z', fill: true },
  star: { d: 'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z', fill: true },
};

/** An inline SVG icon. Filled icons take their color from `color`; line icons from `stroke`. */
export function icon(name, cls) {
  const def = ICONS[name];
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon' + (def.fill ? ' icon-fill' : '') + (cls ? ' ' + cls : ''));
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', def.d);
  if (def.width) path.setAttribute('stroke-width', def.width);
  svg.append(path);
  return svg;
}

/**
 * Shows a chip as picked or not, by changing the chip that is already on the screen. Drawing the whole
 * row of chips again instead throws away the scroll position on an iPhone. `tick` adds a check mark.
 */
export function paintChip(chip, on, tick) {
  chip.classList.toggle('is-on', on);
  chip.setAttribute('aria-pressed', String(on));
  const mark = chip.querySelector('.chip-tick');
  if (tick && on && !mark) chip.prepend(icon('check', 'chip-tick'));
  if (mark && !on) mark.remove();
  return chip;
}

const layers = () => document.getElementById('layers');

/**
 * Opens a sheet: from the bottom on a phone, centered on a wide screen.
 * `build(close)` returns the sheet's content. Returns the close function.
 */
export function sheet(title, build, onClose) {
  const previous = document.activeElement;
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    if (previous && previous.focus) previous.focus();
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const body = h('div', { class: 'sheet-body' });
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title', text: title }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
    body);
  const wrap = h('div', { class: 'layer' }, h('div', { class: 'backdrop', onclick: close }), panel);
  append(body, [build(close)]);
  layers().append(wrap);
  document.addEventListener('keydown', onKey);
  const first = panel.querySelector('input, textarea, button:not(.icon-btn)');
  if (first) first.focus({ preventScroll: true });
  return close;
}

/** Asks before something that can't be undone. Resolves true when confirmed. */
export function confirmSheet(title, message, confirmLabel) {
  return new Promise((resolve) => {
    let answer = false;
    // Closing with the backdrop, the X or Escape counts as Cancel.
    sheet(title, (close) => [
      h('p', { class: 'sheet-text', text: message }),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: close }, 'Cancel'),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { answer = true; close(); } }, confirmLabel)),
    ], () => resolve(answer));
  });
}

let toastTimer = null;

/** A short message at the bottom of the screen. An optional action shows as a button. */
export function toast(message, action) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: 'toast', role: 'status' }, h('span', { text: message }),
    action ? h('button', { class: 'toast-btn', type: 'button', onclick: () => { el.remove(); action.run(); } }, action.label) : null);
  layers().append(el);
  toastTimer = setTimeout(() => el.remove(), action ? 9000 : 3200);
}

export function go(path) {
  location.hash = '#/' + path;
}
