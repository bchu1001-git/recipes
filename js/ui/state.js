// What the person is looking at right now: the search, the chosen folders, the open tab.
// None of this is saved; it resets when the app is reopened. The one exception is the ticked
// ingredients, which are kept on the device for half a day, so that the phone reloading the app in
// the middle of cooking does not untick them.

import { freshTicks } from '../kitchen.js';

export const ui = {
  query: '',
  filters: new Set(),   // folder ids
  gotoOnly: false,
  reviewing: false,     // the list shows the recipes waiting under To review
  tab: 'ing',           // 'ing' | 'steps' | 'notes' on the recipe page
  ticks: new Map(),     // recipe id -> Set of ticked ingredient indexes
  openId: null,         // the recipe shown in the detail pane, for highlighting its row
};

const listeners = new Set();

export function onUi(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setUi(patch) {
  Object.assign(ui, patch);
  for (const fn of [...listeners]) fn();
}

export function toggleFilter(id) {
  const next = new Set(ui.filters);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setUi({ filters: next, reviewing: false });
}

export function clearFilters() {
  setUi({ filters: new Set(), gotoOnly: false, query: '', reviewing: false });
}

const TICKS_KEY = 'recipes.ticks';
const tickedAt = new Map();   // recipe id -> when one of its ingredients was last ticked or unticked
let ticksRead = false;

function readTicks() {
  if (ticksRead) return;
  ticksRead = true;
  try {
    const saved = freshTicks(JSON.parse(localStorage.getItem(TICKS_KEY) || 'null'), Date.now());
    for (const [id, ticks] of Object.entries(saved)) {
      ui.ticks.set(id, new Set(ticks.on));
      tickedAt.set(id, ticks.at);
    }
  } catch (err) { /* nothing was kept, or it cannot be read: start clean */ }
}

/** The ticked ingredients of a recipe, as a set of places in its ingredient list. The recipe page and the kitchen view share it. */
export function ticksFor(id) {
  readTicks();
  if (!ui.ticks.has(id)) ui.ticks.set(id, new Set());
  return ui.ticks.get(id);
}

/** Keeps a recipe's ticks on the device after one of them changed. They are dropped half a day after the last change. */
export function keepTicks(id) {
  readTicks();
  tickedAt.set(id, Date.now());
  const all = {};
  for (const [recipe, at] of tickedAt) all[recipe] = { at, on: [...(ui.ticks.get(recipe) || [])] };
  try { localStorage.setItem(TICKS_KEY, JSON.stringify(freshTicks(all, Date.now()))); } catch (err) { /* they last until the app is closed */ }
}
