// One recipe: title, source, heart and rating, then Ingredients / Steps / Notes.
// On a wide window the three parts sit side by side and the switch is hidden.

import { h, icon, sheet, confirmSheet, go, toast } from './dom.js';
import { state, subscribe, saveRecipe, deleteRecipe } from '../store.js';
import { ui, setUi, ticksFor } from './state.js';
import { amountLabel, itemLabel, formatMinutes, folderIndex, webLink } from '../model.js';

const TABS = [['ing', 'Ingredients'], ['steps', 'Steps'], ['notes', 'Notes']];

function menu(recipe) {
  sheet(recipe.title, (close) => [
    h('div', { class: 'actions' },
      h('a', { class: 'action', href: '#/edit/' + recipe.id, onclick: close }, 'Edit'),
      h('button', { class: 'action', type: 'button', onclick: () => { close(); folderPicker(recipe.id); } }, 'Folders'),
      h('button', { class: 'action is-danger', type: 'button', onclick: async () => {
        close();
        const yes = await confirmSheet('Delete this recipe?', '"' + recipe.title + '" will be removed from this device. This can’t be undone.', 'Delete');
        if (yes) { await deleteRecipe(recipe.id); go(''); toast('Deleted'); }
      } }, 'Delete')),
  ]);
}

/** Tick folders on and off for one recipe. Each tap is saved straight away. */
export function folderPicker(id) {
  sheet('Folders', (close) => {
    const body = h('div', { class: 'filter' });
    const draw = () => {
      const recipe = state.recipes.get(id);
      if (!recipe) return;
      body.replaceChildren(...state.folders.groups.filter((g) => g.folders.length).map((g) => h('div', { class: 'filter-group' },
        h('h3', { class: 'label', text: g.name }),
        h('div', { class: 'chips wrap' }, g.folders.map((f) => {
          const on = recipe.folders.includes(f.id);
          return h('button', { class: 'chip' + (on ? ' is-on' : ''), type: 'button', 'aria-pressed': String(on), onclick: async () => {
            const folders = on ? recipe.folders.filter((x) => x !== f.id) : [...recipe.folders, f.id];
            await saveRecipe({ ...recipe, folders });
            draw();
          } }, on ? icon('check') : null, f.name);
        })))));
    };
    draw();
    return [body, h('div', { class: 'sheet-actions' }, h('button', { class: 'btn btn-main', type: 'button', onclick: close }, 'Done'))];
  });
}

function rating(recipe) {
  const wrap = h('div', { class: 'rate', role: 'group', 'aria-label': 'Rating' });
  for (let n = 1; n <= 5; n++) {
    const on = n <= recipe.rating;
    wrap.append(h('button', { class: 'rate-star' + (on ? ' is-on' : ''), type: 'button',
      'aria-label': n + (n === 1 ? ' star' : ' stars'), 'aria-pressed': String(recipe.rating === n),
      onclick: () => saveRecipe({ ...recipe, rating: recipe.rating === n ? 0 : n }) }, icon('star')));
  }
  return wrap;
}

function ingredients(recipe) {
  if (!recipe.ingredients.length) return h('p', { class: 'quiet', text: 'No ingredients yet.' });
  const ticks = ticksFor(recipe.id);
  return h('ul', { class: 'ing' }, recipe.ingredients.map((ing, i) => {
    const li = h('li', { class: ticks.has(i) ? 'is-done' : '' },
      h('button', { class: 'ing-row', type: 'button', 'aria-pressed': String(ticks.has(i)), onclick: () => {
        if (ticks.has(i)) ticks.delete(i); else ticks.add(i);
        li.classList.toggle('is-done', ticks.has(i));
        li.firstChild.setAttribute('aria-pressed', String(ticks.has(i)));
      } },
        h('span', { class: 'ing-tick' }, icon('check')),
        h('span', { class: 'ing-amount', text: amountLabel(ing) }),
        h('span', { class: 'ing-item', text: itemLabel(ing) })));
    return li;
  }));
}

function steps(recipe) {
  if (!recipe.steps.length) return h('p', { class: 'quiet', text: 'No steps yet.' });
  return h('ol', { class: 'steps' }, recipe.steps.map((s) => h('li', { text: s.text })));
}

function notes(recipe) {
  const parts = [];
  if (recipe.notes.mine) parts.push(h('h3', { class: 'label', text: 'My notes' }), h('p', { class: 'note', text: recipe.notes.mine }));
  if (recipe.notes.source) parts.push(h('h3', { class: 'label', text: 'From the source' }), h('p', { class: 'note', text: recipe.notes.source }));
  if (!parts.length) parts.push(h('p', { class: 'quiet', text: 'No notes yet. Add your own with Edit.' }));
  return h('div', { class: 'notes' }, parts);
}

export function renderRecipe(root, id) {
  const draw = () => {
    const recipe = state.recipes.get(id);
    if (!recipe) return;
    const scroller = root.querySelector('.pane-scroll');
    const keep = scroller ? scroller.scrollTop : 0;
    const names = folderIndex(state.folders);
    const kicker = recipe.folders.map((f) => names.get(f)).filter(Boolean).map((f) => f.name).join(' · ');
    const meta = [formatMinutes(recipe.minutes), recipe.serves ? 'Serves ' + recipe.serves : ''].filter(Boolean);

    const panes = {
      ing: h('section', { class: 'part part-ing' + (ui.tab === 'ing' ? '' : ' is-off') }, h('h2', { class: 'label part-label', text: 'Ingredients' }), ingredients(recipe)),
      steps: h('section', { class: 'part part-steps' + (ui.tab === 'steps' ? '' : ' is-off') }, h('h2', { class: 'label part-label', text: 'Steps' }), steps(recipe)),
      notes: h('section', { class: 'part part-notes' + (ui.tab === 'notes' ? '' : ' is-off') }, h('h2', { class: 'label part-label', text: 'Notes' }), notes(recipe)),
    };

    const tabs = h('div', { class: 'seg', role: 'tablist' }, TABS.map(([key, label]) =>
      h('button', { class: 'seg-btn' + (ui.tab === key ? ' is-on' : ''), type: 'button', role: 'tab', 'aria-selected': String(ui.tab === key),
        onclick: () => { ui.tab = key; draw(); } }, label)));

    root.replaceChildren(
      h('div', { class: 'pane-scroll' },
        h('header', { class: 'bar bar-detail' },
          h('a', { class: 'back back-list', href: '#/' }, icon('back'), 'Recipes'),
          h('span', { class: 'bar-tools' },
            h('button', { class: 'icon-btn heart-btn' + (recipe.goto ? ' is-on' : ''), type: 'button', 'aria-pressed': String(recipe.goto),
              'aria-label': recipe.goto ? 'Go-to, tap to remove' : 'Mark as a Go-to',
              onclick: () => saveRecipe({ ...recipe, goto: !recipe.goto }) }, icon('heart')),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'More', onclick: () => menu(recipe) }, icon('more')))),
        h('article', { class: 'recipe' },
          kicker ? h('p', { class: 'kicker', text: kicker }) : null,
          h('h1', { class: 'recipe-title', text: recipe.title }),
          h('p', { class: 'meta' },
            meta.join(' · '),
            meta.length && recipe.source.name ? ' · ' : '',
            webLink(recipe.source.url)
              ? h('a', { href: webLink(recipe.source.url), target: '_blank', rel: 'noopener noreferrer', text: recipe.source.name || 'Source' })
              : recipe.source.name),
          rating(recipe),
          tabs,
          h('div', { class: 'parts' }, panes.ing, panes.steps, panes.notes))));
    root.querySelector('.pane-scroll').scrollTop = keep;
  };

  setUi({ openId: id });
  const stop = subscribe(draw);
  draw();
  return () => { stop(); setUi({ openId: null }); };
}
