// The timers the kitchen view starts. They belong to the device, not to a recipe: they are kept in
// the device's own storage (store.js), so that a reload, or coming back from the Clock app, finds
// them still counting. Time left is always worked out from the clock, never counted down in memory.
//
// A timer runs in one of two ways, chosen per device in Settings:
//   'here'   a countdown in this app. At zero it shows an alert wherever in the app the person is,
//            and makes a sound in code, with the phone on silent too. It can only do that while the
//            app is open on screen.
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
//
// The tones are made with the Web Audio API; there is no sound file. Three things have to be right
// for them to be heard at the end of a timer:
//
// 1. A browser lets a page start making sound only from a tap. So the audio is woken by the tap that
//    starts a timer, and by any later tap if the app was reloaded while a timer was counting.
// 2. It has to still be going minutes later. While a timer counts down in this app a tone far too
//    quiet and too low to hear is kept playing, so the audio is never left idle, and it is asked to
//    carry on again just before the tones.
// 3. On an iPhone, sound made this way counts as "ambient" and is muted by the silent switch. Safari
//    lets a page say what kind of sound it is making (navigator.audioSession): for the tones it is
//    set to "playback", which is not muted. That kind pauses whatever else the phone is playing, so
//    it is only asked for while the tones sound, not for the whole countdown, and given back after.
//    Other browsers have no such setting and no such switch.

let audio = null;
let hum = null;            // the inaudible tone that keeps the audio going while a timer counts down
let beeps = null;
let beepsLeft = 0;
let trying = false;        // the Settings button is playing the sound
let tryTimer = null;
let restTimer = null;

const counting = () => list.some((t) => t.mode === 'here' && !t.rang);
const ringing = () => list.filter((t) => t.mode === 'here' && t.rang);

/** Says what kind of sound the app is making: 'playback' is heard with the phone on silent, 'auto' is the usual. */
function setSession(type) {
  try {
    const session = 'audioSession' in navigator ? navigator.audioSession : null;
    if (session && session.type !== type) session.type = type;
  } catch (err) { /* not there, or not allowed: the sound then follows the phone's silent switch */ }
}

/** Makes the audio if there is none yet and asks it to run. Resolves true once it is running. */
function wakeSound() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return Promise.resolve(false);
    if (!audio) audio = new Context();
    if (audio.state === 'running') return Promise.resolve(true);
    return audio.resume().then(() => audio.state === 'running', () => false);
  } catch (err) {
    return Promise.resolve(false);   // no sound on this device: the alert on screen still shows
  }
}

function startHum() {
  if (hum || !audio) return;
  try {
    const tone = audio.createOscillator();
    const level = audio.createGain();
    tone.type = 'sine';
    tone.frequency.value = 40;     // lower than a phone's speaker can play
    level.gain.value = 0.0005;     // and far quieter than anyone can hear
    tone.connect(level);
    level.connect(audio.destination);
    tone.start();
    hum = { tone, level };
  } catch (err) { /* the tones are still tried when the time comes */ }
}

function stopHum() {
  if (!hum) return;
  try {
    hum.tone.stop();
    hum.tone.disconnect();
    hum.level.disconnect();
  } catch (err) { /* it is gone either way */ }
  hum = null;
}

/** Keeps the audio going for as long as a timer here may need it, and lets go of it when none does. */
function tendSound() {
  if (!audio) return;
  clearTimeout(restTimer);
  if (counting()) startHum(); else stopHum();
  if (counting() || ringing().length || trying) {
    if (audio.state !== 'running') audio.resume().catch(() => {});
    return;
  }
  // Nothing left to ring for. Letting go of the phone's audio lets whatever else was playing carry on.
  restTimer = setTimeout(() => {
    if (!audio || counting() || ringing().length || trying) return;
    setSession('auto');
    audio.suspend().catch(() => {});
  }, 1200);
}

/** Three short tones. They are only scheduled when the audio is running; otherwise it is asked to. */
function beep() {
  if (!audio) return false;
  if (audio.state !== 'running') {
    audio.resume().catch(() => {});
    return false;
  }
  try {
    const at = audio.currentTime + 0.08;
    for (let i = 0; i < 3; i++) {
      const start = at + i * 0.32;
      const tone = audio.createOscillator();
      const loud = audio.createGain();
      tone.type = 'sine';
      tone.frequency.value = i === 2 ? 1175 : 880;
      loud.gain.setValueAtTime(0.0001, start);
      loud.gain.exponentialRampToValueAtTime(0.6, start + 0.02);
      loud.gain.exponentialRampToValueAtTime(0.0001, start + 0.26);
      tone.connect(loud);
      loud.connect(audio.destination);
      tone.start(start);
      tone.stop(start + 0.28);
    }
    return true;
  } catch (err) {
    return false;   // the alert on screen is what counts
  }
}

function startSound() {
  beepsLeft = 30;   // about a minute from the latest timer to run out, then it gives up; the alert stays
  if (beeps) return;
  setSession('playback');
  wakeSound().then(() => { if (ringing().length) beep(); });
  beeps = setInterval(() => {
    if (--beepsLeft <= 0 || !ringing().length) stopSound();
    else beep();
  }, 2000);
}

function stopSound() {
  clearInterval(beeps);
  beeps = null;
  if (!trying) setSession('auto');
  tendSound();
}

/**
 * Plays the sound a finished timer makes, once: for checking from Settings that it can be heard, with
 * the phone on silent too. The tap that asks for it also wakes the audio. Resolves false where the
 * browser would not play it.
 */
export function playTimerSound() {
  trying = true;
  clearTimeout(tryTimer);
  setSession('playback');
  tryTimer = setTimeout(() => {
    trying = false;
    if (!ringing().length) setSession('auto');
    tendSound();
  }, 2500);
  // A browser that will not start the audio may never answer, so it is given two seconds.
  const gaveUp = new Promise((resolve) => setTimeout(() => resolve(false), 2000));
  return Promise.race([wakeSound(), gaveUp]).then((running) => running && beep());
}

/** A tap anywhere wakes the audio if a timer here is counting and it is not going, as after a reload. */
function wakeOnTap() {
  if (!counting() && !ringing().length) return;
  if (audio && audio.state === 'running') return;
  wakeSound().then(tendSound);
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
  if (rings || changed) { drawAlert(); tendSound(); }
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
    tendSound();   // the phone stops a page's audio while the app is off the screen
    if (list.length) check();
  });
  // 'click' and 'touchend' are the taps a browser accepts for starting sound.
  document.addEventListener('click', wakeOnTap, true);
  document.addEventListener('touchend', wakeOnTap, true);
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
    wakeSound().then(tendSound);   // this tap is what lets the app make sound at all
  }
  watch();
  drawAlert();
  tendSound();
  tell();
  return { mode, first };
}

/** Takes a timer away: one that is running, one that has finished, or one the Clock app took care of. */
export function clearTimer(id) {
  if (!list.some((t) => t.id === id)) return;
  list = list.filter((t) => t.id !== id);
  save();
  if (!ringing().length) stopSound(); else tendSound();
  drawAlert();
  tell();
  if (!list.length) stopWatching();
}

/** A small clock icon followed by text, for a timer's button or chip. */
export function timerFace(text) {
  return [icon('timer', 'timer-icon'), h('span', { class: 'timer-text', text })];
}
