// The rules of the kitchen view that need no screen: which steps it shows and in what order, what a
// timer has left, and what is worth keeping of what the device remembers. There is no DOM and no
// storage in this file, so tests/kitchen.test.js runs it in Node.

import { partsOf, findTimers } from './model.js';

// ---------- the steps ----------

/** The name a folded section of the steps is remembered under. The recipe page uses the same one. */
export const stepFoldKey = (key) => 'steps:' + key;

/**
 * The kitchen view's rows for a recipe's steps, top to bottom.
 *
 *   { kind: 'heading', label, key, count, folded }   a section's heading, with `count` steps under it
 *   { kind: 'step', index, number, text, times }     a step: its place in recipe.steps, the number the
 *                                                    recipe page gives it, and the minutes of each
 *                                                    time it mentions
 *
 * `folded` is the set of sections folded away on this device, as foldsFor() in store.js gives it.
 * The steps of a folded section are left out, so its heading is the one row that stands for them.
 * Numbers never shift: a step keeps the number it has on the recipe page whatever is folded.
 */
export function kitchenRows(recipe, folded = new Set()) {
  const steps = (recipe && Array.isArray(recipe.steps)) ? recipe.steps : [];
  const rows = [];
  for (const part of partsOf(steps)) {
    let hidden = false;
    if (part.heading !== -1) {
      hidden = part.lines.length > 0 && folded.has(stepFoldKey(part.key));
      rows.push({ kind: 'heading', label: part.label, key: part.key, count: part.lines.length, folded: hidden });
    }
    if (hidden) continue;
    for (const { index, number } of part.lines) {
      rows.push({ kind: 'step', index, number, text: steps[index].text, times: findTimers(steps[index].text) });
    }
  }
  return rows;
}

/** The steps that can be made the current one, in order, as places in recipe.steps. */
export function stepOrder(rows) {
  return rows.filter((row) => row.kind === 'step').map((row) => row.index);
}

/**
 * The step to light when the view opens or its rows change: the remembered one if it is still
 * showing, otherwise the first showing step after it, otherwise the last one showing. -1 if no step
 * is showing at all.
 */
export function currentStep(order, remembered) {
  if (!order.length) return -1;
  if (!Number.isInteger(remembered)) return order[0];
  if (order.includes(remembered)) return remembered;
  const next = order.find((index) => index > remembered);
  return next === undefined ? order[order.length - 1] : next;
}

/** The step after the current one (dir 1) or before it (dir -1). At either end it stays where it is. */
export function stepBeside(order, current, dir) {
  const at = order.indexOf(current);
  if (at === -1) return order.length ? order[0] : -1;
  const to = at + (dir < 0 ? -1 : 1);
  return to < 0 || to >= order.length ? current : order[to];
}

/** The key of the section a step sits in, or '' for a step above every heading or one that is not there. */
export function sectionOf(recipe, index) {
  const steps = (recipe && Array.isArray(recipe.steps)) ? recipe.steps : [];
  for (const part of partsOf(steps)) {
    if (part.lines.some((line) => line.index === index)) return part.heading === -1 ? '' : part.key;
  }
  return '';
}

// ---------- timers ----------

/** How long a finished timer stays on show before it is dropped by itself. */
export const DONE_KEPT = 30 * 60 * 1000;
const LONGEST = 24 * 60;   // minutes

/** A timer's name: the recipe, the step's place in it, and which of the step's times it is. */
export function timerId(recipe, step, n) {
  return recipe + '/' + step + '/' + n;
}

/**
 * A timer started now.
 *   recipe, step, n   whose it is: the recipe's id, the step's place in recipe.steps, and which of
 *                     the step's times (0 for the first)
 *   number            the step's number as the person sees it
 *   minutes           how long it runs
 *   mode              'here' for a countdown that rings in this app, 'clock' for one handed to the
 *                     phone's Clock app, which this app can only keep count of
 */
export function makeTimer({ recipe, step, n, number, minutes, mode }, now) {
  return {
    id: timerId(recipe, step, n), recipe, step, n, number,
    minutes: Math.max(1, Math.min(LONGEST, Math.round(minutes))),
    started: now, mode: mode === 'clock' ? 'clock' : 'here', rang: false,
  };
}

/**
 * What a timer has left at `now`, worked out from the clock so that it is right after a reload:
 * { left, done, ends } with `left` in milliseconds. A start time later than now (the device's clock
 * was changed) counts as now.
 */
export function timeLeft(timer, now) {
  const whole = timer.minutes * 60000;
  const ends = Math.min(timer.started, now) + whole;
  const left = Math.max(0, Math.min(whole, ends - now));
  return { left, done: left <= 0, ends };
}

/** "9:05", or "1:02:05" from an hour up. Rounded up to the second, so 0:00 only shows when it is over. */
export function clockText(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const two = (n) => String(n).padStart(2, '0');
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
}

/**
 * What is worth keeping of a list of timers read back from the device: the ones that make sense, less
 * those that finished more than DONE_KEPT ago. If two have the same name the later one is kept.
 */
export function tidyTimers(list, now) {
  const kept = new Map();
  for (const t of Array.isArray(list) ? list : []) {
    if (!t || typeof t !== 'object' || typeof t.recipe !== 'string' || !t.recipe) continue;
    if (!Number.isInteger(t.step) || t.step < 0 || !Number.isInteger(t.n) || t.n < 0) continue;
    if (!Number.isInteger(t.minutes) || t.minutes < 1 || t.minutes > LONGEST) continue;
    if (typeof t.started !== 'number' || !Number.isFinite(t.started)) continue;
    const timer = {
      id: timerId(t.recipe, t.step, t.n), recipe: t.recipe, step: t.step, n: t.n,
      number: Number.isInteger(t.number) && t.number > 0 ? t.number : t.step + 1,
      minutes: t.minutes, started: t.started, mode: t.mode === 'clock' ? 'clock' : 'here', rang: t.rang === true,
    };
    if (now - timeLeft(timer, now).ends > DONE_KEPT) continue;
    const other = kept.get(timer.id);
    if (!other || other.started <= timer.started) kept.set(timer.id, timer);
  }
  return [...kept.values()].sort((a, b) => timeLeft(a, now).ends - timeLeft(b, now).ends || a.id.localeCompare(b.id));
}

/**
 * The link that starts a timer in the phone's Clock app through the "Recipe Timer" Shortcut. It is the
 * plain form on purpose: asking Shortcuts to come back afterwards opens Safari, not the app.
 */
export function timerLink(minutes) {
  const whole = Math.max(1, Math.min(LONGEST, Math.round(Number(minutes) || 0)));
  return 'shortcuts://run-shortcut?name=Recipe%20Timer&input=text&text=' + whole;
}

/**
 * The address that brings the Home Screen app itself back to the front when a Shortcut opens it:
 * "webapp://" and then where the app is served, without "https://" and without any file name. Put in
 * an Open URLs action at the end of the Recipe Timer Shortcut, it returns the person to the kitchen
 * view once the timer has started. Proven on an iPhone with iOS 27 in November 2026; an ordinary
 * https address opens Safari instead. Empty when the host is not known.
 */
export function returnAddress(host, pathname) {
  const where = String(host || '').trim();
  if (!where) return '';
  const folder = String(pathname || '/').replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  return 'webapp://' + where + (folder.startsWith('/') ? folder : '/' + folder);
}

// ---------- ticked ingredients ----------

/** How long ticked ingredients are kept once the last one was ticked: one cooking session, not next week's. */
export const TICKS_KEPT = 12 * 60 * 60 * 1000;

/**
 * The ticks worth keeping of what the device saved, as { recipe id: { at, on: [place in the ingredients] } }.
 * A recipe whose ticks were last touched more than TICKS_KEPT ago starts clean again, and so does
 * anything that is not in that shape.
 */
export function freshTicks(saved, now) {
  const kept = {};
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return kept;
  for (const [id, ticks] of Object.entries(saved)) {
    if (!ticks || typeof ticks !== 'object' || typeof ticks.at !== 'number' || !Array.isArray(ticks.on)) continue;
    const age = now - ticks.at;
    if (!(age >= 0 && age <= TICKS_KEPT)) continue;
    const on = [...new Set(ticks.on.filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b);
    if (on.length) kept[id] = { at: ticks.at, on };
  }
  return kept;
}

// ---------- coming back ----------

/** How long after the kitchen view was last used the app still opens straight back into it. */
export const RESUME_WITHIN = 3 * 60 * 60 * 1000;

/**
 * The recipe whose kitchen view to go back to when the app starts afresh, or ''. `marker` is what the
 * view left behind while it was open, { id, at }; it is taken away when the view is left on purpose,
 * so it is only still there if the app was closed, or reloaded by the phone, in the middle of cooking.
 */
export function resumeCooking(marker, now) {
  if (!marker || typeof marker !== 'object' || typeof marker.id !== 'string' || !marker.id) return '';
  if (typeof marker.at !== 'number' || !Number.isFinite(marker.at)) return '';
  const age = now - marker.at;
  return age >= 0 && age <= RESUME_WITHIN ? marker.id : '';
}
