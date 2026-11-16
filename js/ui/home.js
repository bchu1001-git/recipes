// The list of recipes: search, the Go-to and folder filters, and the + button.
// On a wide window the same filters also appear as a sidebar.
// Recipes that arrived from outside wait under "To review" until they are kept or discarded.

import { h, icon, sheet, confirmSheet, go, paintChip } from './dom.js';
import { state, library, subscribe, saveRecipe, askOfJob, dropQueued } from '../store.js';
import { status, onStatus, syncNow, ago, jobsNow } from '../sync/auto.js';
import { ui, onUi, setUi, toggleFilter, clearFilters } from './state.js';
import { matchesQuery, matchesFilters, sortRecipes, initials, hueFor, formatMinutes, keptRecipes, waitingRecipes } from '../model.js';
import { EXAMPLES } from '../sample.js';

const kept = () => keptRecipes(state.recipes.values());
const waiting = () => waitingRecipes(state.recipes.values());

function visibleRecipes() {
  return sortRecipes(kept()).filter((r) => (!ui.gotoOnly || r.goto) && matchesFilters(r, ui.filters) && matchesQuery(r, ui.query));
}

function countIn(folderId) {
  let n = 0;
  for (const r of state.recipes.values()) if (!r.review && r.folders.includes(folderId)) n++;
  return n;
}

/** The + button: type a recipe in, or send pictures of one to be read. */
function openAdd() {
  sheet('Add a recipe', (close) => [
    h('div', { class: 'actions' },
      h('a', { class: 'action', href: '#/new', onclick: close }, 'Type it in'),
      h('a', { class: 'action', href: '#/photos', onclick: close }, 'From photos or screenshots')),
    h('p', { class: 'sheet-text', text: 'For a recipe on a web page, share the page from Safari with Save to Recipes instead.' }),
  ]);
}

const minutesSince = (at) => {
  const time = Date.parse(at);
  return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 60000)) : 0;
};
const pics = (n) => n + (n === 1 ? ' picture' : ' pictures');
// A job is named by the title typed when it was sent, if there was one, and otherwise by its pictures.
const named = (job) => (job.title ? '\u201c' + job.title + '\u201d, ' : '') + pics(job.pictures);

/** One lot of pictures on its way to becoming a recipe: waiting to go, being read, or not read. */
function jobRow(job) {
  const again = h('button', { class: 'job-btn', type: 'button', onclick: () => { askOfJob(job.id, 'retry'); syncNow(); } }, 'Try again');
  const discard = h('button', { class: 'job-btn is-danger', type: 'button', onclick: async () => {
    const yes = await confirmSheet('Discard these pictures?', 'They will be removed from the library without being read.', 'Discard');
    if (yes) { askOfJob(job.id, 'discard'); syncNow(); }
  } }, 'Discard');

  if (job.state === 'queued') {
    return h('div', { class: 'job' },
      h('p', { class: 'job-title', text: named(job) + ' waiting to be sent' }),
      h('p', { class: 'job-sub', text: library.config ? 'They go up with the next sync.' : 'Connect a library in Settings and they will be sent.' }),
      h('div', { class: 'job-buttons' }, h('button', { class: 'job-btn', type: 'button', onclick: () => dropQueued([job.id]) }, 'Cancel')));
  }
  if (job.state === 'failed') {
    // With no picture in it there is nothing to try again: what was shared held none that could be read.
    return h('div', { class: 'job is-failed' },
      h('p', { class: 'job-title', text: (job.pictures ? named(job) : 'What was shared') + ' could not be read' }),
      h('p', { class: 'job-sub', text: job.error }),
      h('div', { class: 'job-buttons' }, job.pictures ? again : null, discard));
  }
  if (job.packed) {
    // Shared from another app by a Shortcut. The file holds the pictures and is not fetched, so there
    // is no count, title or time to show until the library has unpacked it.
    return h('div', { class: 'job' },
      h('p', { class: 'job-title', text: 'Reading pictures sent from another app...' }),
      h('p', { class: 'job-sub', text: 'It usually takes a minute or two. If nothing comes of it, reading may not be set up in this library: see Settings, Read photos.' }),
      h('div', { class: 'job-buttons' }, discard));
  }
  const minutes = minutesSince(job.asked || job.at);
  const slow = minutes >= 10 && !job.pending;
  const when = minutes < 1 ? 'just now' : minutes + ' min ago';
  return h('div', { class: 'job' },
    h('p', { class: 'job-title', text: 'Reading ' + named(job) + '...' }),
    h('p', { class: 'job-sub', text: job.pending ? 'Another try has been asked for.'
      : slow ? 'Sent ' + when + ' and still not read. Reading may not be set up in this library: see Settings, Read photos.'
        : 'Sent ' + when + (job.by ? ' from ' + job.by : '') + '. It usually takes a minute or two.' }),
    slow ? h('div', { class: 'job-buttons' }, again, discard) : null);
}

/** Shows the recipes waiting for review. With only one waiting, it opens that one straight away. */
export function openReview() {
  const list = waiting();
  if (!list.length) return;
  setUi({ reviewing: true, filters: new Set(), gotoOnly: false });
  if (list.length === 1) go('r/' + list[0].id);
}

export function stars(rating, cls) {
  const wrap = h('span', { class: 'stars' + (cls ? ' ' + cls : ''), role: 'img', 'aria-label': rating + ' out of 5' });
  for (let i = 1; i <= 5; i++) wrap.append(icon('star', i <= rating ? 'on' : 'off'));
  return wrap;
}

export function tile(recipe, cls) {
  return h('span', { class: 'tile' + (cls ? ' ' + cls : ''), style: { '--h': String(hueFor(recipe)) }, 'aria-hidden': 'true' }, initials(recipe.title));
}

function row(recipe) {
  const sub = [recipe.source.name, formatMinutes(recipe.minutes)].filter(Boolean).join(' · ');
  return h('a', { class: 'row' + (ui.openId === recipe.id ? ' is-open' : ''), href: '#/r/' + recipe.id },
    tile(recipe),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title', text: recipe.title || 'Untitled' }),
      sub ? h('span', { class: 'row-sub', text: sub }) : null,
      recipe.rating ? stars(recipe.rating) : null),
    recipe.goto ? h('span', { class: 'row-heart', role: 'img', 'aria-label': 'Go-to' }, icon('heart')) : null);
}

/** The filter sheet: every group with its folders as chips. */
function openFilters() {
  let stop = () => {};
  sheet('Filter', (close) => {
    // The chips are made once and changed in place, so the sheet stays where it is when one is tapped.
    const chips = new Map();
    const body = h('div', { class: 'filter' }, state.folders.groups.filter((g) => g.folders.length).map((g) => h('div', { class: 'filter-group' },
      h('h3', { class: 'label', text: g.name }),
      h('div', { class: 'chips wrap' }, g.folders.map((f) => {
        const c = chip(f.name, ui.filters.has(f.id), () => toggleFilter(f.id));
        chips.set(f.id, c);
        return c;
      })))));
    const show = h('button', { class: 'btn btn-main', type: 'button', onclick: close });
    const draw = () => {
      for (const [id, c] of chips) paintChip(c, ui.filters.has(id), false);
      const n = visibleRecipes().length;
      show.textContent = 'Show ' + n + (n === 1 ? ' recipe' : ' recipes');
    };
    stop = onUi(draw);
    draw();
    return [
      body,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => setUi({ filters: new Set() }) }, 'Clear'),
        show),
    ];
  }, () => stop());
}

function chip(label, on, onclick, extra) {
  return h('button', { class: 'chip' + (on ? ' is-on' : ''), type: 'button', 'aria-pressed': String(on), onclick }, extra || null, label);
}

async function addExamples() {
  for (const ex of EXAMPLES) if (!state.recipes.has(ex.id)) await saveRecipe(ex);
}

/** Pulling the list down from its top syncs, when a library is connected. */
function pullToSync(scroller, hint) {
  let from = null;
  let pulled = 0;
  const rest = () => { hint.style.height = '0px'; from = null; pulled = 0; };
  scroller.addEventListener('touchstart', (e) => {
    from = library.config && scroller.scrollTop <= 0 ? e.touches[0].clientY : null;
    pulled = 0;
  }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (from === null) return;
    pulled = e.touches[0].clientY - from;
    if (pulled <= 0 || scroller.scrollTop > 0) { hint.style.height = '0px'; return; }
    hint.style.height = Math.min(pulled / 2, 52) + 'px';
    hint.textContent = pulled > 110 ? 'Let go to sync' : 'Pull to sync';
  }, { passive: true });
  scroller.addEventListener('touchend', () => { if (from !== null && pulled > 110) syncNow(); rest(); });
  scroller.addEventListener('touchcancel', rest);
}

export function renderHome(root) {
  const search = h('input', { class: 'search', type: 'search', 'aria-label': 'Search recipes', autocomplete: 'off',
    oninput: (e) => setUi({ query: e.target.value }) });
  const searchWrap = h('div', { class: 'search-wrap' }, icon('search'), search);
  const review = h('div', { class: 'review-slot' });
  const chips = h('div', { class: 'chips scroll-x' });
  const rows = h('div', { class: 'rows' });
  const sync = h('button', { class: 'sync-chip', type: 'button', onclick: () => {
    if (status.state === 'error') location.hash = '#/settings';
    else syncNow();
  } });
  const hint = h('div', { class: 'pull', 'aria-hidden': 'true' });
  const scroller = h('div', { class: 'pane-scroll' });
  const drawSync = () => {
    sync.hidden = status.state === 'off';
    sync.classList.toggle('is-error', status.state === 'error');
    sync.textContent = status.state === 'syncing' ? 'Syncing...'
      : status.state === 'error' ? 'Sync problem'
      : status.at ? 'Synced ' + ago(status.at) : 'Not synced yet';
  };

  scroller.append(
      hint,
      h('header', { class: 'bar' },
        h('h1', { class: 'bar-title', text: 'Recipes' }),
        sync,
        h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'Settings' }, icon('sliders'))),
      review,
      searchWrap,
      chips,
      rows);
  root.replaceChildren(scroller, h('button', { class: 'fab', type: 'button', 'aria-label': 'Add a recipe', onclick: openAdd }, icon('plus')));
  pullToSync(scroller, hint);

  let shown = '';   // which search and filters the list was last drawn for
  const draw = () => {
    const at = scroller.scrollTop;
    const total = kept().length;
    const toCheck = waiting();
    const reviewing = ui.reviewing && toCheck.length > 0;
    const list = visibleRecipes();
    const filtering = ui.filters.size > 0 || ui.gotoOnly || ui.query.trim() !== '';
    search.placeholder = total ? 'Search ' + total + (total === 1 ? ' recipe' : ' recipes') : 'Search';
    if (search.value !== ui.query) search.value = ui.query;

    // Something is waiting: one clear way in. While looking at them: one clear way back.
    // Under it, any pictures that are still on their way to becoming a recipe.
    review.replaceChildren(...(!toCheck.length ? [] : reviewing
      ? [h('div', { class: 'review-head' },
          h('button', { class: 'back', type: 'button', onclick: () => setUi({ reviewing: false }) }, icon('back'), 'All recipes'),
          h('span', { class: 'review-head-title', text: 'To review' }))]
      : [h('button', { class: 'review-entry', type: 'button', onclick: openReview },
          h('span', { class: 'review-entry-label', text: 'To review' }),
          h('span', { class: 'review-entry-count', text: String(toCheck.length) }),
          icon('chevron'))]),
      ...jobsNow().map(jobRow));
    searchWrap.hidden = reviewing;
    chips.hidden = reviewing;

    chips.replaceChildren(
      chip('Go-to', ui.gotoOnly, () => setUi({ gotoOnly: !ui.gotoOnly }), icon('heart')),
      ...state.folders.groups.filter((g) => g.folders.length).map((g) => {
        const picked = g.folders.filter((f) => ui.filters.has(f.id));
        const label = picked.length === 1 ? picked[0].name : picked.length ? g.name + ' · ' + picked.length : g.name;
        const c = chip(label, picked.length > 0, openFilters);
        c.append(icon('down'));
        return c;
      }));

    if (reviewing) {
      rows.replaceChildren(
        h('p', { class: 'rows-note', text: 'Check each one, then keep it or discard it.' }),
        ...toCheck.map(row));
    } else if (!total) {
      rows.replaceChildren(h('div', { class: 'empty' },
        h('h2', { text: 'No recipes yet' }),
        h('p', { text: 'Type in one you know by heart, or add three examples to look around.' }),
        h('button', { class: 'btn btn-main', type: 'button', onclick: openAdd }, 'Add a recipe'),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: addExamples }, 'Add three examples')));
    } else if (!list.length) {
      rows.replaceChildren(h('div', { class: 'empty' },
        h('h2', { text: 'Nothing matches' }),
        h('p', { text: 'No recipe fits this search and these folders together.' }),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: clearFilters }, 'Clear search and filters')));
    } else {
      const note = filtering ? [h('p', { class: 'rows-note', text: list.length + ' of ' + total })] : [];
      rows.replaceChildren(...note, ...list.map(row));
    }
    // The same list drawn again (after a sync, a heart, another recipe opened) stays where it was.
    // A different search or filter is a different list, and is left to start where the browser puts it.
    const now = JSON.stringify([ui.query, [...ui.filters].sort(), ui.gotoOnly, reviewing]);
    if (now === shown) scroller.scrollTop = at;
    shown = now;
  };

  subscribe(draw);
  onUi(draw);
  onStatus(drawSync);
  setInterval(() => { drawSync(); if (jobsNow().length) draw(); }, 60000);   // keeps "5 min ago" honest
  draw();
  drawSync();
}

/** The sidebar on a wide window: the same folders, always visible. */
export function renderSide(root) {
  const draw = () => {
    const item = (label, count, on, onclick, lead) => h('button', { class: 'side-item' + (on ? ' is-on' : ''), type: 'button', 'aria-pressed': String(on), onclick },
      lead || null, h('span', { class: 'side-label', text: label }), h('span', { class: 'side-count', text: String(count) }));
    const all = kept();
    const toCheck = waiting();
    const reviewing = ui.reviewing && toCheck.length > 0;
    const gotos = all.filter((r) => r.goto).length;
    const nothing = !reviewing && !ui.gotoOnly && ui.filters.size === 0;
    // The sidebar is drawn again after every change, so its place has to be put back by hand.
    const scrolled = root.querySelector('.side-scroll');
    const keep = scrolled ? scrolled.scrollTop : 0;
    root.replaceChildren(
      h('div', { class: 'side-scroll' },
        toCheck.length ? item('To review', toCheck.length, reviewing, () => (reviewing ? setUi({ reviewing: false }) : openReview())) : null,
        item('All recipes', all.length, nothing, () => setUi({ filters: new Set(), gotoOnly: false, reviewing: false })),
        item('Go-to', gotos, ui.gotoOnly && !reviewing, () => setUi({ gotoOnly: !ui.gotoOnly, reviewing: false }), icon('heart')),
        ...state.folders.groups.filter((g) => g.folders.length).map((g) => h('div', { class: 'side-group' },
          h('h2', { class: 'label', text: g.name }),
          g.folders.map((f) => item(f.name, countIn(f.id), ui.filters.has(f.id) && !reviewing, () => toggleFilter(f.id)))))),
      h('a', { class: 'side-item side-foot', href: '#/settings' }, icon('sliders'), h('span', { class: 'side-label', text: 'Settings' })));
    root.querySelector('.side-scroll').scrollTop = keep;
  };
  subscribe(draw);
  onUi(draw);
  draw();
}
