// The kitchen view: every step in large type on a dark see-through grey, the current one lit, the
// screen kept awake, and a timer for each time a step mentions. It lies over the whole app and has
// an address of its own (#/cook/<id>), so a reload comes back to it.
//
// Nothing here changes a recipe. The step it was left at and the running timers are kept on the
// device (store.js). Folds and ticks are the very ones the recipe page uses.

import { h, icon } from './dom.js';
import { state, subscribe, foldsFor, setFold, kitchenStep, setKitchenStep } from '../store.js';
import { kitchenRows, stepOrder, currentStep, stepBeside, stepFoldKey, sectionOf, timeLeft, clockText, timerId, timerLink, resumeCooking } from '../kitchen.js';
import { formatMinutes, isHeading } from '../model.js';
import { ingredientList } from './recipe.js';
import { timers, onTimers, startTimer, clearTimer, timerMode, timerFace } from './timers.js';
import { applyAppearance, appearance } from './settings.js';

// While the view is open it leaves a mark on the device saying so. Leaving the view takes the mark
// away, so it is only still there when the app was closed, or reloaded by the phone, part way through.
const COOKING_KEY = 'recipes.cooking';

function markCooking(id) {
  try { localStorage.setItem(COOKING_KEY, JSON.stringify({ id, at: Date.now() })); } catch (err) { /* it just will not be reopened */ }
}

function unmarkCooking() {
  try { localStorage.removeItem(COOKING_KEY); } catch (err) { /* nothing to take away */ }
}

/** The recipe whose kitchen view to open again as the app starts, or '' when there is none. */
export function cookingToResume() {
  try {
    return resumeCooking(JSON.parse(localStorage.getItem(COOKING_KEY) || 'null'), Date.now());
  } catch (err) {
    return '';
  }
}

const NOTES = {
  noLock: 'This browser cannot keep the screen awake, so it may dim as usual.',
  lockFailed: 'The screen could not be kept awake this time.',
  here: 'Timers started here ring only while Recipes is open on screen.',
  clock: 'The timer started in the Clock app. To come back to Recipes, swipe along the bottom edge of the screen.',
};

/**
 * Opens the kitchen view for a recipe, over everything else. `wantStep` is a step to go to straight
 * away, as a place in the recipe's steps (a finished timer's alert asks for one). Returns the function
 * that closes it again.
 */
export function renderKitchen(id, wantStep) {
  let recipe = state.recipes.get(id);
  let rows = [];
  let order = [];
  let current = -1;
  let seen = '';
  let panelOpen = false;
  let lock = null;
  let open = true;
  let slots = [];                    // one for each time in each step that is showing
  let stripSign = '';
  const stepEls = new Map();         // a step's place in the recipe -> its row on screen
  const notes = new Set();

  const title = h('h1', { class: 'k-title', text: recipe.title });
  const ingButton = h('button', { class: 'k-bar-btn k-ing-btn', type: 'button', 'aria-expanded': 'false', onclick: () => setPanel(!panelOpen) },
    icon('list'), h('span', { text: 'Ingredients' }));
  const strip = h('div', { class: 'k-timers', 'aria-label': 'Timers' });
  const noteBox = h('div', { class: 'k-notes' });
  const stepList = h('ol', { class: 'k-steps' });
  const scroller = h('div', { class: 'k-scroll' }, stepList);
  const count = h('span', { class: 'k-count' });
  const back = h('button', { class: 'k-nav-btn', type: 'button', onclick: () => move(-1) }, icon('back'), h('span', { text: 'Back' }));
  const next = h('button', { class: 'k-nav-btn is-next', type: 'button', onclick: () => move(1) }, h('span', { text: 'Next' }), icon('chevron'));
  const panelBody = h('div', { class: 'k-ing-body' });
  const panel = h('aside', { class: 'k-ing', 'aria-label': 'Ingredients' },
    h('div', { class: 'k-ing-head' },
      h('h2', { class: 'k-ing-title', text: 'Ingredients' }),
      h('button', { class: 'k-bar-btn k-ing-done', type: 'button', onclick: () => setPanel(false) }, 'Done')),
    panelBody);

  const layer = h('div', { class: 'kitchen', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Kitchen view: ' + recipe.title },
    h('header', { class: 'k-bar' },
      h('button', { class: 'k-bar-btn k-close', type: 'button', 'aria-label': 'Leave the kitchen view', onclick: () => leaveView() },
        icon('close'), h('span', { text: 'Close' })),
      title,
      ingButton),
    strip,
    noteBox,
    h('div', { class: 'k-main' },
      panel,
      h('div', { class: 'k-panel-back', onclick: () => setPanel(false) }),
      scroller),
    h('footer', { class: 'k-nav' }, back, count, next));

  function leaveView() {
    location.hash = '#/r/' + id;
  }

  // ---------- quiet lines ----------

  function say(key) {
    if (notes.has(key)) return;
    notes.add(key);
    noteBox.replaceChildren(...[...notes].map((k) => h('p', { class: 'k-note', text: NOTES[k] })));
  }

  // ---------- keeping the screen awake ----------

  async function keepAwake() {
    if (!open || lock || document.hidden) return;
    if (!('wakeLock' in navigator)) { say('noLock'); return; }
    try {
      const got = await navigator.wakeLock.request('screen');
      if (!open) { got.release().catch(() => {}); return; }
      lock = got;
      lock.addEventListener('release', () => { lock = null; });
    } catch (err) {
      say('lockFailed');
    }
  }

  // The lock is given up by the browser whenever the app leaves the screen, so it is asked for again.
  const onVisible = () => { if (!document.hidden) keepAwake(); };

  // ---------- the ingredients ----------

  function setPanel(on) {
    panelOpen = on;
    layer.classList.toggle('has-panel', on);
    ingButton.setAttribute('aria-expanded', String(on));
  }

  // ---------- the steps ----------

  function total() {
    return recipe.steps.filter((s) => !isHeading(s.text)).length;
  }

  function drawNav() {
    const at = order.indexOf(current);
    const row = rows.find((r) => r.kind === 'step' && r.index === current);
    count.textContent = row ? 'Step ' + row.number + ' of ' + total() : 'No steps showing';
    back.disabled = at <= 0;
    next.disabled = at === -1 || at >= order.length - 1;
  }

  function light(index, scroll) {
    if (index === -1 || !stepEls.has(index)) return;
    current = index;
    for (const [at, li] of stepEls) {
      li.classList.toggle('is-lit', at === index);
      const main = li.querySelector('.k-step-main');
      if (at === index) main.setAttribute('aria-current', 'step'); else main.removeAttribute('aria-current');
    }
    setKitchenStep(id, index).catch(() => {});
    markCooking(id);
    drawNav();
    if (scroll) {
      const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
      stepEls.get(index).scrollIntoView({ block: 'center', behavior: scroll === 'jump' || calm ? 'auto' : 'smooth' });
    }
  }

  function move(dir) {
    light(stepBeside(order, current, dir), true);
  }

  /** Goes to a step wherever it is, opening the section it sits in if that was folded away. */
  async function reveal(index) {
    if (!order.includes(index)) {
      const key = sectionOf(recipe, index);
      if (key) {
        await setFold(id, stepFoldKey(key), false);
        refresh();
      }
    }
    if (order.includes(index)) light(index, true);
  }

  function begin(slot) {
    const out = startTimer({ recipe: id, step: slot.step, n: slot.n, number: slot.number, minutes: slot.minutes });
    markCooking(id);
    if (out.mode === 'here') say('here');
    else if (out.first) say('clock');
    paintTimers();
    paintStrip();
  }

  function drawSteps() {
    stepEls.clear();
    slots = [];
    stepList.replaceChildren(...rows.map((row) => {
      if (row.kind === 'heading') {
        if (!row.count) return h('li', { class: 'k-head' }, h('h3', { text: row.label }));
        const hidden = row.count === 1 ? ' · 1 step folded away' : ' · ' + row.count + ' steps folded away';
        return h('li', { class: 'k-head' + (row.folded ? ' is-folded' : '') },
          h('h3', null, h('button', { class: 'k-fold', type: 'button', 'aria-expanded': String(!row.folded), onclick: async () => {
            await setFold(id, stepFoldKey(row.key), !row.folded);
            refresh();
          } },
            h('span', { class: 'k-fold-label' }, row.label, row.folded ? h('span', { class: 'k-fold-count', text: hidden }) : null),
            icon('down', 'k-fold-arrow'))));
      }
      const times = row.times.map((minutes, n) => {
        const box = h('span', { class: 'k-time-slot' });
        slots.push({ id: timerId(id, row.index, n), step: row.index, n, number: row.number, minutes, box, sign: '', text: null });
        return box;
      });
      const li = h('li', { class: 'k-step' },
        h('button', { class: 'k-step-main', type: 'button', onclick: () => light(row.index, true) },
          h('span', { class: 'k-step-n', text: String(row.number) }),
          h('span', { class: 'k-step-text', text: row.text })),
        times.length ? h('div', { class: 'k-times' }, times) : null);
      stepEls.set(row.index, li);
      return li;
    }));
    if (!rows.length) stepList.replaceChildren(h('li', { class: 'k-empty', text: 'This recipe has no steps yet.' }));
  }

  // ---------- the timers ----------

  /** Shows each time in each step as a timer to start, a countdown, or done. Only what changed is redrawn. */
  function paintTimers() {
    const now = Date.now();
    const running = new Map(timers().map((t) => [t.id, t]));
    const mode = timerMode();
    for (const slot of slots) {
      const timer = running.get(slot.id);
      const left = timer ? timeLeft(timer, now) : null;
      const sign = !timer ? 'idle:' + mode : left.done ? 'done' : 'run';
      if (sign !== slot.sign) {
        slot.sign = sign;
        slot.text = null;
        const label = formatMinutes(slot.minutes);
        const clear = () => h('button', { class: 'k-time-clear', type: 'button', 'aria-label': 'Clear the ' + label + ' timer', onclick: () => clearTimer(slot.id) }, icon('close'));
        if (!timer && mode === 'clock') {
          // A real link, so the tap itself opens the Clock app's timer. The count is noted on the way.
          slot.box.replaceChildren(h('a', { class: 'k-time', href: timerLink(slot.minutes), 'aria-label': 'Start a ' + label + ' timer in the Clock app', onclick: () => begin(slot) }, timerFace(label)));
        } else if (!timer) {
          slot.box.replaceChildren(h('button', { class: 'k-time', type: 'button', 'aria-label': 'Start a ' + label + ' timer', onclick: () => begin(slot) }, timerFace(label)));
        } else if (left.done) {
          slot.box.replaceChildren(h('span', { class: 'k-time is-done' }, icon('check', 'timer-icon'), h('span', { class: 'timer-text', text: label + ' done' })), clear());
        } else {
          const face = h('span', { class: 'k-time is-running' }, timerFace(clockText(left.left)));
          slot.text = face.querySelector('.timer-text');
          slot.box.replaceChildren(face, clear());
        }
      }
      if (slot.text) slot.text.textContent = clockText(left.left);
    }
  }

  /** Every timer on the device in one row, whichever step is lit, each a way to its step. */
  function paintStrip() {
    const now = Date.now();
    const all = timers();
    const sign = all.map((t) => t.id + (timeLeft(t, now).done ? '!' : '')).join(' ');
    if (sign !== stripSign) {
      stripSign = sign;
      strip.replaceChildren(...all.map((t) => {
        const other = t.recipe !== id ? state.recipes.get(t.recipe) : null;
        const where = other ? other.title + ', step ' + t.number : 'Step ' + t.number;
        const done = timeLeft(t, now).done;
        return h('span', { class: 'k-chip' + (done ? ' is-done' : ''), 'data-timer': t.id },
          h('button', { class: 'k-chip-main', type: 'button', onclick: () => {
            if (t.recipe === id) reveal(t.step);
            else location.hash = '#/cook/' + t.recipe + '/' + t.step;
          } },
            h('span', { class: 'k-chip-where', text: where }),
            h('span', { class: 'k-chip-left', text: done ? 'done' : clockText(timeLeft(t, now).left) })),
          h('button', { class: 'k-chip-clear', type: 'button', 'aria-label': 'Clear the timer for ' + where.toLowerCase(), onclick: () => clearTimer(t.id) }, icon('close')));
      }));
      layer.classList.toggle('has-timers', all.length > 0);
    }
    for (const t of all) {
      const left = timeLeft(t, now);
      if (left.done) continue;
      const chip = [...strip.children].find((el) => el.dataset.timer === t.id);
      if (chip) chip.querySelector('.k-chip-left').textContent = clockText(left.left);
    }
  }

  // ---------- drawing it all from the recipe as it is now ----------

  function refresh() {
    recipe = state.recipes.get(id);
    if (!recipe) return;
    seen = recipe.updated;
    title.textContent = recipe.title;
    rows = kitchenRows(recipe, foldsFor(id));
    order = stepOrder(rows);
    const wanted = current === -1 ? kitchenStep(id) : current;
    drawSteps();
    panelBody.replaceChildren(ingredientList(recipe));
    current = -1;
    light(currentStep(order, wanted), false);
    drawNav();
    paintTimers();
    stripSign = '\n';
    paintStrip();
  }

  const onKey = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (document.querySelector('.layer')) return;   // a sheet is open on top and has the keyboard
    if (e.key === 'Escape') {
      e.preventDefault();
      if (panelOpen) setPanel(false); else leaveView();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      move(-1);
    }
  };

  const stopStore = subscribe(() => {
    const now = state.recipes.get(id);
    if (!now || now.review) { location.hash = now ? '#/r/' + id : '#/'; return; }
    if (now.updated !== seen) refresh();
  });
  const stopTimers = onTimers(() => { paintTimers(); paintStrip(); });

  document.getElementById('layers').append(layer);
  // The strip around the phone's clock and battery takes the view's own grey while it is open.
  const bar = document.getElementById('theme-color');
  const grey = getComputedStyle(layer).getPropertyValue('--k-solid').trim();
  if (bar && grey) bar.setAttribute('content', grey);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisible);
  refresh();
  markCooking(id);
  if (stepEls.has(current)) stepEls.get(current).scrollIntoView({ block: 'center', behavior: 'auto' });
  if (Number.isInteger(wantStep)) {
    // The step came in the address. It is taken out again so that a reload goes to the remembered step.
    history.replaceState(null, '', '#/cook/' + id);
    reveal(wantStep);
  }
  next.focus({ preventScroll: true });
  keepAwake();

  return () => {
    open = false;
    stopStore();
    stopTimers();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisible);
    applyAppearance(appearance());   // gives the strip around the phone's clock its usual color back
    if (lock) lock.release().catch(() => {});
    lock = null;
    layer.remove();
    unmarkCooking();
  };
}
