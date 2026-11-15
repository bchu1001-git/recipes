// The list of recipes: search, the Go-to and folder filters, and the + button.
// On a wide window the same filters also appear as a sidebar.

import { h, icon, sheet } from './dom.js';
import { state, subscribe, saveRecipe } from '../store.js';
import { ui, onUi, setUi, toggleFilter, clearFilters } from './state.js';
import { matchesQuery, matchesFilters, sortRecipes, initials, hueFor, formatMinutes } from '../model.js';
import { EXAMPLES } from '../sample.js';

function visibleRecipes() {
  const all = sortRecipes(state.recipes.values());
  return all.filter((r) => (!ui.gotoOnly || r.goto) && matchesFilters(r, ui.filters) && matchesQuery(r, ui.query));
}

function countIn(folderId) {
  let n = 0;
  for (const r of state.recipes.values()) if (r.folders.includes(folderId)) n++;
  return n;
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
      h('span', { class: 'row-title', text: recipe.title }),
      sub ? h('span', { class: 'row-sub', text: sub }) : null,
      recipe.rating ? stars(recipe.rating) : null),
    recipe.goto ? h('span', { class: 'row-heart', role: 'img', 'aria-label': 'Go-to' }, icon('heart')) : null);
}

/** The filter sheet: every group with its folders as chips. */
function openFilters() {
  let stop = () => {};
  sheet('Filter', (close) => {
    const body = h('div', { class: 'filter' });
    const show = h('button', { class: 'btn btn-main', type: 'button', onclick: close });
    const draw = () => {
      body.replaceChildren(
        ...state.folders.groups.filter((g) => g.folders.length).map((g) => h('div', { class: 'filter-group' },
          h('h3', { class: 'label', text: g.name }),
          h('div', { class: 'chips wrap' }, g.folders.map((f) => chip(f.name, ui.filters.has(f.id), () => toggleFilter(f.id)))))));
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

export function renderHome(root) {
  const search = h('input', { class: 'search', type: 'search', 'aria-label': 'Search recipes', autocomplete: 'off',
    oninput: (e) => setUi({ query: e.target.value }) });
  const chips = h('div', { class: 'chips scroll-x' });
  const rows = h('div', { class: 'rows' });

  root.replaceChildren(
    h('div', { class: 'pane-scroll' },
      h('header', { class: 'bar' },
        h('h1', { class: 'bar-title', text: 'Recipes' }),
        h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'Settings' }, icon('sliders'))),
      h('div', { class: 'search-wrap' }, icon('search'), search),
      chips,
      rows),
    h('a', { class: 'fab', href: '#/new', 'aria-label': 'Add a recipe' }, icon('plus')));

  const draw = () => {
    const total = state.recipes.size;
    const list = visibleRecipes();
    const filtering = ui.filters.size > 0 || ui.gotoOnly || ui.query.trim() !== '';
    search.placeholder = total ? 'Search ' + total + (total === 1 ? ' recipe' : ' recipes') : 'Search';
    if (search.value !== ui.query) search.value = ui.query;

    chips.replaceChildren(
      chip('Go-to', ui.gotoOnly, () => setUi({ gotoOnly: !ui.gotoOnly }), icon('heart')),
      ...state.folders.groups.filter((g) => g.folders.length).map((g) => {
        const picked = g.folders.filter((f) => ui.filters.has(f.id));
        const label = picked.length === 1 ? picked[0].name : picked.length ? g.name + ' · ' + picked.length : g.name;
        const c = chip(label, picked.length > 0, openFilters);
        c.append(icon('down'));
        return c;
      }));

    if (!total) {
      rows.replaceChildren(h('div', { class: 'empty' },
        h('h2', { text: 'No recipes yet' }),
        h('p', { text: 'Type in one you know by heart, or add three examples to look around.' }),
        h('a', { class: 'btn btn-main', href: '#/new' }, 'Add a recipe'),
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
  };

  subscribe(draw);
  onUi(draw);
  draw();
}

/** The sidebar on a wide window: the same folders, always visible. */
export function renderSide(root) {
  const draw = () => {
    const item = (label, count, on, onclick, lead) => h('button', { class: 'side-item' + (on ? ' is-on' : ''), type: 'button', 'aria-pressed': String(on), onclick },
      lead || null, h('span', { class: 'side-label', text: label }), h('span', { class: 'side-count', text: String(count) }));
    const all = state.recipes.size;
    const gotos = [...state.recipes.values()].filter((r) => r.goto).length;
    const nothing = !ui.gotoOnly && ui.filters.size === 0;
    root.replaceChildren(
      h('div', { class: 'side-scroll' },
        item('All recipes', all, nothing, () => setUi({ filters: new Set(), gotoOnly: false })),
        item('Go-to', gotos, ui.gotoOnly, () => setUi({ gotoOnly: !ui.gotoOnly }), icon('heart')),
        ...state.folders.groups.filter((g) => g.folders.length).map((g) => h('div', { class: 'side-group' },
          h('h2', { class: 'label', text: g.name }),
          g.folders.map((f) => item(f.name, countIn(f.id), ui.filters.has(f.id), () => toggleFilter(f.id)))))),
      h('a', { class: 'side-item side-foot', href: '#/settings' }, icon('sliders'), h('span', { class: 'side-label', text: 'Settings' })));
  };
  subscribe(draw);
  onUi(draw);
  draw();
}
