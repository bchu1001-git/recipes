// The timers the kitchen view starts. They belong to the device, not to a recipe: they are kept in
// the device's own storage (store.js), so that a reload, or coming back from the Clock app, finds
// them still counting. Time left is always worked out from the clock, never counted down in memory.
//
// A timer runs in one of two ways, chosen per device in Settings:
//   'here'   a countdown in this app. At zero it shows an alert wherever in the app the person is,
//            and makes a sound in code. It can only do that while the app is open on screen.
//   'clock'  handed to the phone's Clock app through the "Recipe Timer" Shortcut, which rings even
//            when the phone is locked. This app cannot see that timer; it only keeps its own count.

import { h, icon } from './dom.js';
import { state, savedTimers, saveTimers } from '../store.js';
import { makeTimer, timeLeft, tidyTimers } from '../kitchen.js';
import { formatMinutes } from '../model.js';

const MODE_KEY = 'recipes.timers';
const TOLD_KEY = 'recipes.clockTold';

/** How timers run on this device: 'here' unless the person chose the Clock app. */
export function timerMode() {
  try { return localStorage.getItem(MODE_KEY) === 'clock' ? 'clock' : 'here'; } catch (err) { return 'here'; }
}

export function setTimerMode(mode) {
  try {
    if (mode === 'clock') localStorage.setItem(MODE_KEY, 'clock'); else localStorage.removeItem(MODE_KEY);
  } catch (err) { /* nowhere to keep it: the choice lasts until the app is closed */ }
  tell();
}

/** Whether the person has already been told, once, how to come back from the Clock app. */
function clockTold() {
  try { return localStorage.getItem(TOLD_KEY) === '1'; } catch (err) { return true; }
}

let list = [];            // running and just-finished timers, soonest first
let ticker = null;
const listeners = new Set();

/** Calls `fn()` about twice a second while any timer is on show, and whenever one starts or goes. */
export function onTimers(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function tell() {
  for (const fn of [...listeners]) fn();
}

/** The timers on this device, soonest first: [{ id, recipe, step, n, number, minutes, started, mode, rang }]. */
export function timers() {
  return list;
}

// ---------- the sound, made in code ----------

let audio = null;
let beeps = null;
let beepsLeft = 0;

/** Gets the sound ready. A browser only allows this from a tap, so it is called when a timer is started. */
function primeSound() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    if (!audio) audio = new Context();
    if (audio.state !== 'running') audio.resume().catch(() => {});
  } catch (err) { /* no sound on this device: the alert on screen still shows */ }
}

function beep() {
  if (!audio || audio.state !== 'running') return;
  try {
    const at = audio.currentTime;
    for (let i = 0; i < 3; i++) {
      const start = at + i * 0.32;
      const tone = audio.createOscillator();
      const loud = audio.createGain();
      tone.type = 'sine';
      tone.frequency.value = i === 2 ? 1175 : 880;
      loud.gain.setValueAtTime(0.0001, start);
      loud.gain.exponentialRampToValueAtTime(0.5, start + 0.02);
      loud.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
      tone.connect(loud);
      loud.connect(audio.destination);
      tone.start(start);
      tone.stop(start + 0.28);
    }
  } catch (err) { /* the alert on screen is what counts */ }
}

const ringing = () => list.filter((t) => t.mode === 'here' && t.rang);

function startSound() {
  if (beeps) return;
  beepsLeft = 30;   // about a minute, then it gives up; the alert stays
  beep();
  beeps = setInterval(() => {
    if (--beepsLeft <= 0 || !ringing().length) stopSound();
    else beep();
  }, 2000);
}

function stopSound() {
  clearInterval(beeps);
  beeps = null;
}

// ---------- the alert at zero ----------

let alertBox = null;

function drawAlert() {
  const done = ringing();
  if (!done.length) {
    if (alertBox) { alertBox.remove(); alertBox = null; }
    return;
  }
  const rows = done.map((t) => {
    const recipe = state.recipes.get(t.recipe);
    const where = 'Step ' + t.number + (recipe ? ' of ' + recipe.title : '');
    return h('div', { class: 'timer-alert-row' },
      h('div', { class: 'timer-alert-text' },
        h('strong', { text: 'Timer done' }),
        h('span', { text: formatMinutes(t.minutes) + ' · ' + where })),
      h('div', { class: 'timer-alert-buttons' },
        h('button', { class: 'timer-alert-btn', type: 'button', onclick: () => {
          clearTimer(t.id);
          location.hash = '#/cook/' + t.recipe + '/' + t.step;
        } }, 'Show'),
        h('button', { class: 'timer-alert-btn is-main', type: 'button', onclick: () => clearTimer(t.id) }, 'OK')));
  });
  if (!alertBox) {
    alertBox = h('div', { class: 'timer-alert', role: 'alert' });
    document.getElementById('layers').append(alertBox);
  }
  alertBox.replaceChildren(...rows);
}

// ---------- keeping count ----------

function save() {
  return saveTimers(list).catch(() => {});
}

/** Looks at every timer: drops the stale ones and raises the alert for one that has just run out. */
function check() {
  const now = Date.now();
  let changed = false;
  const kept = tidyTimers(list, now).filter((t) => state.recipes.has(t.recipe));
  if (kept.length !== list.length) changed = true;
  list = kept;
  let rings = false;
  for (const t of list) {
    if (t.mode === 'here' && !t.rang && timeLeft(t, now).done) {
      t.rang = true;
      rings = true;
      changed = true;
    }
  }
  if (changed) save();
  if (rings) startSound();
  if (rings || changed) drawAlert();
  tell();
  if (!list.length) stopWatching();
}

function watch() {
  if (!ticker && list.length) ticker = setInterval(check, 500);
}

function stopWatching() {
  clearInterval(ticker);
  ticker = null;
  if (!ringing().length) stopSound();
}

/** Picks up the timers left on this device. Called once, when the app opens. */
export function startTimers() {
  list = tidyTimers(savedTimers(), Date.now()).filter((t) => state.recipes.has(t.recipe));
  // One that was to ring here but ran out while the app was closed: it shows as done, quietly.
  drawAlert();
  if (list.length) { watch(); check(); }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (audio && audio.state !== 'running') audio.resume().catch(() => {});
    if (list.length) check();
  });
}

/**
 * Starts a timer for one of a step's times and keeps it on the device straight away. If the same one
 * is already running it starts again from now.
 *
 * In 'clock' mode this only keeps count: the tap itself is a link that opens the Clock app's timer
 * (see timerLink in kitchen.js), and the count is saved here before the phone leaves the app.
 * Returns { mode, first }: `first` is true the first time ever a timer goes to the Clock app, so the
 * view can say, once, how to come back.
 */
export function startTimer({ recipe, step, n, number, minutes }) {
  const mode = timerMode();
  const timer = makeTimer({ recipe, step, n, number, minutes, mode }, Date.now());
  list = tidyTimers([...list.filter((t) => t.id !== timer.id), timer], Date.now());
  save();
  let first = false;
  if (mode === 'clock') {
    first = !clockTold();
    try { localStorage.setItem(TOLD_KEY, '1'); } catch (err) { /* it will just be said again */ }
  } else {
    primeSound();
  }
  watch();
  drawAlert();
  tell();
  return { mode, first };
}

/** Takes a timer away: one that is running, one that has finished, or one the Clock app took care of. */
export function clearTimer(id) {
  if (!list.some((t) => t.id === id)) return;
  list = list.filter((t) => t.id !== id);
  save();
  if (!ringing().length) stopSound();
  drawAlert();
  tell();
  if (!list.length) stopWatching();
}

/** A small clock icon followed by text, for a timer's button or chip. */
export function timerFace(text) {
  return [icon('timer', 'timer-icon'), h('span', { class: 'timer-text', text })];
}
