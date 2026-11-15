// Adding a recipe by hand, and editing one. Ingredients and steps are typed one per line.

import { h, icon, go } from './dom.js';
import { state, saveRecipe } from '../store.js';
import { linesOf, splitLines, formatMinutes } from '../model.js';

export function renderEditor(root, id) {
  const existing = id ? state.recipes.get(id) : null;
  const picked = new Set(existing ? existing.folders : []);
  const backTo = existing ? '#/r/' + existing.id : '#/';

  const field = (label, control, hint) => h('label', { class: 'field' },
    h('span', { class: 'field-label', text: label }), control, hint ? h('span', { class: 'field-hint', text: hint }) : null);
  const input = (name, value, more) => h('input', { class: 'input', name, value: value || '', autocomplete: 'off', ...(more || {}) });
  const area = (name, value, rows) => h('textarea', { class: 'input', name, rows: String(rows), value: value || '' });

  const title = input('title', existing && existing.title, { required: true, enterkeyhint: 'next' });
  const problem = h('p', { class: 'field-error', role: 'alert' });
  const folders = h('div', { class: 'filter' });
  const drawFolders = () => {
    folders.replaceChildren(...state.folders.groups.filter((g) => g.folders.length).map((g) => h('div', { class: 'filter-group' },
      h('h3', { class: 'label', text: g.name }),
      h('div', { class: 'chips wrap' }, g.folders.map((f) => {
        const on = picked.has(f.id);
        return h('button', { class: 'chip' + (on ? ' is-on' : ''), type: 'button', 'aria-pressed': String(on), onclick: () => {
          if (on) picked.delete(f.id); else picked.add(f.id);
          drawFolders();
        } }, on ? icon('check') : null, f.name);
      })))));
  };
  drawFolders();

  const form = h('form', { class: 'pane-scroll', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    if (!String(data.get('title') || '').trim()) {
      problem.textContent = 'Give the recipe a title.';
      title.focus();
      return;
    }
    const recipe = await saveRecipe({
      ...(existing || {}),
      title: data.get('title'),
      source: { kind: existing ? existing.source.kind : 'manual', name: data.get('source'), url: data.get('url') },
      minutes: String(data.get('time') || ''),
      serves: data.get('serves'),
      ingredients: splitLines(data.get('ingredients')),
      steps: splitLines(data.get('steps')),
      notes: { mine: data.get('mine'), source: data.get('fromsource') },
      folders: [...picked],
    });
    go('r/' + recipe.id);
  } },
    h('header', { class: 'bar bar-detail' },
      h('a', { class: 'back', href: backTo }, 'Cancel'),
      h('span', { class: 'bar-heading', text: existing ? 'Edit recipe' : 'New recipe' }),
      h('button', { class: 'bar-save', type: 'submit' }, 'Save')),
    h('div', { class: 'editor' },
      field('Title', title), problem,
      h('div', { class: 'field-pair' },
        field('Time', input('time', existing ? formatMinutes(existing.minutes) : '', { placeholder: '45 min', inputmode: 'text' })),
        field('Serves', input('serves', existing && existing.serves, { placeholder: '4' }))),
      field('Ingredients', area('ingredients', existing ? linesOf(existing.ingredients) : '', 8), 'One per line, written the way you would say it: 2 carrots, sliced'),
      field('Steps', area('steps', existing ? linesOf(existing.steps) : '', 8), 'One per line'),
      field('My notes', area('mine', existing && existing.notes.mine, 3)),
      field('Where it came from', input('source', existing && existing.source.name, { placeholder: 'A cookbook, a person, a site' })),
      field('Link', input('url', existing && existing.source.url, { type: 'url', inputmode: 'url', placeholder: 'https://' })),
      field('Notes from the source', area('fromsource', existing && existing.notes.source, 3)),
      h('h2', { class: 'editor-heading', text: 'Folders' }),
      folders,
      h('button', { class: 'btn btn-main editor-save', type: 'submit' }, 'Save')));

  root.replaceChildren(form);
  if (!existing) title.focus({ preventScroll: true });
  return () => {};
}
