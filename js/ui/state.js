// What the person is looking at right now: the search, the chosen folders, the open tab.
// None of this is saved; it resets when the app is reopened.

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

export function ticksFor(id) {
  if (!ui.ticks.has(id)) ui.ticks.set(id, new Set());
  return ui.ticks.get(id);
}
