// Adding a recipe by hand, and editing one. Ingredients and steps are typed one per line.
// The review screen (review.js) shows the same fields for a recipe that arrived from outside.

import { h, go, paintChip } from './dom.js';
import { state, saveRecipe } from '../store.js';
import { linesOf, splitLines, formatMinutes } from '../model.js';

/**
 * The fields of a recipe as form controls, filled in from `existing` when there is one.
 *
 * Returns { nodes, read, title }. `nodes` go inside a form. `read(form)` gives what to hand to
 * saveRecipe, or shows what is missing and returns null. `title` is the title box, for focus.
 */
export function recipeFields(existing) {
  const picked = new Set(existing ? existing.folders : []);

  const field = (label, control, hint) => h('label', { class: 'field' },
    h('span', { class: 'field-label', text: label }), control, hint ? h('span', { class: 'field-hint', text: hint }) : null);
  const input = (name, value, more) => h('input', { class: 'input', name, value: value || '', autocomplete: 'off', ...(more || {}) });
  const area = (name, value, rows) => h('textarea', { class: 'input', name, rows: String(rows), value: value || '' });

  const title = input('title', existing && existing.title, { required: true, enterkeyhint: 'next' });
  const problem = h('p', { class: 'field-error', role: 'alert' });
  // Each chip is changed in place when tapped, so the screen stays where it is.
  const folders = h('div', { class: 'filter' }, state.folders.groups.filter((g) => g.folders.length).map((g) => h('div', { class: 'filter-group' },
    h('h3', { class: 'label', text: g.name }),
    h('div', { class: 'chips wrap' }, g.folders.map((f) => {
      const chip = h('button', { class: 'chip', type: 'button', onclick: () => {
        if (picked.has(f.id)) picked.delete(f.id); else picked.add(f.id);
        paintChip(chip, picked.has(f.id), true);
      } }, f.name);
      return paintChip(chip, picked.has(f.id), true);
    })))));

  const nodes = [
    field('Title', title), problem,
    // No example text inside these two boxes: "45 min" and "4" in an empty box were taken for values
    // that would be saved. The examples sit underneath, where a hint cannot be mistaken for an answer.
    h('div', { class: 'field-pair' },
      field('Time', input('time', existing ? formatMinutes(existing.minutes) : '', { inputmode: 'text' }), 'Such as 45 min. Leave empty if unknown.'),
      field('Serves', input('serves', existing && existing.serves), 'Such as 4. Leave empty if unknown.')),
    field('Ingredients', area('ingredients', existing ? linesOf(existing.ingredients) : '', 8),
      'One per line, written the way you would say it: 2 carrots, sliced. A line that ends with a colon becomes a heading: For the salsa:'),
    field('Steps', area('steps', existing ? linesOf(existing.steps) : '', 8),
      'One step per line. The recipe page numbers them. A line that ends with a colon becomes a heading.'),
    field('My notes', area('mine', existing && existing.notes.mine, 3)),
    field('Where it came from', input('source', existing && existing.source.name, { placeholder: 'A cookbook, a person, a site' })),
    field('Link', input('url', existing && existing.source.url, { type: 'url', inputmode: 'url', placeholder: 'https://' })),
    field('Notes from the source', area('fromsource', existing && existing.notes.source, 3)),
    h('h2', { class: 'editor-heading', text: 'Folders' }),
    folders,
  ];

  const read = (form) => {
    const data = new FormData(form);
    if (!String(data.get('title') || '').trim()) {
      problem.textContent = 'Give the recipe a title.';
      title.focus();
      return null;
    }
    problem.textContent = '';
    return {
      ...(existing || {}),
      title: data.get('title'),
      source: { kind: existing ? existing.source.kind : 'manual', name: data.get('source'), url: data.get('url') },
      minutes: String(data.get('time') || ''),
      serves: data.get('serves'),
      ingredients: splitLines(data.get('ingredients')),
      steps: splitLines(data.get('steps')),
      notes: { mine: data.get('mine'), source: data.get('fromsource') },
      folders: [...picked],
    };
  };

  return { nodes, read, title };
}

export function renderEditor(root, id) {
  const existing = id ? state.recipes.get(id) : null;
  const backTo = existing ? '#/r/' + existing.id : '#/';
  const fields = recipeFields(existing);

  const form = h('form', { class: 'pane-scroll', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const input = fields.read(form);
    if (!input) return;
    const recipe = await saveRecipe(input);
    go('r/' + recipe.id);
  } },
    h('header', { class: 'bar bar-detail' },
      h('a', { class: 'back', href: backTo }, 'Cancel'),
      h('span', { class: 'bar-heading', text: existing ? 'Edit recipe' : 'New recipe' }),
      h('button', { class: 'bar-save', type: 'submit' }, 'Save')),
    h('div', { class: 'editor' },
      fields.nodes,
      h('button', { class: 'btn btn-main editor-save', type: 'submit' }, 'Save')));

  root.replaceChildren(form);
  if (!existing) fields.title.focus({ preventScroll: true });
  return () => {};
}
