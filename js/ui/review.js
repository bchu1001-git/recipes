// Checking a recipe that arrived from outside before it joins the others. The original stays on top:
// where it came from and a way to open it, or the pictures it was read from, and what looks missing.
// Under it are the same fields as the editor, then Keep or Discard.

import { h, icon, confirmSheet, toast, go } from './dom.js';
import { state, subscribe, saveRecipe, deleteRecipe } from '../store.js';
import { setUi } from './state.js';
import { webLink, reviewNotes, waitingRecipes } from '../model.js';
import { recipeFields } from './editor.js';
import { pictureStrip, openPictures } from './pictures.js';

export function renderReview(root, id) {
  const recipe = state.recipes.get(id);
  const fields = recipeFields(recipe);
  const link = webLink(recipe.source.url);
  const notes = reviewNotes(recipe);
  const pictures = (Array.isArray(recipe.originals) ? recipe.originals : []).filter((path) => typeof path === 'string');
  const strip = pictures.length ? pictureStrip(pictures) : null;
  let busy = false;

  // After this one is kept or discarded: the next one waiting, or the list.
  const onward = () => {
    const rest = waitingRecipes(state.recipes.values()).filter((r) => r.id !== id);
    go(rest.length ? 'r/' + rest[0].id : '');
  };

  const discard = async () => {
    const yes = await confirmSheet('Discard this recipe?', (recipe.title ? '"' + recipe.title + '"' : 'It') + ' will be removed. This can’t be undone.', 'Discard');
    if (!yes || busy) return;
    busy = true;
    await deleteRecipe(id);
    toast('Discarded');
  };

  const form = h('form', { class: 'pane-scroll', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const input = fields.read(form);
    if (!input || busy) return;
    busy = true;
    const { unsure, titleSuggested, ...checked } = input;   // what the reader was unsure of has now been looked at
    await saveRecipe({ ...checked, review: false });
    toast('Kept');
  } },
    h('div', { class: 'review-top' },
      h('header', { class: 'bar' },
        h('a', { class: 'back back-list', href: '#/' }, icon('back'), 'To review'),
        h('span', { class: 'bar-heading', text: 'Review' }),
        h('button', { class: 'bar-save', type: 'submit' }, 'Keep')),
      h('div', { class: 'review-origin' },
        h('span', { class: 'label', text: 'Original' }),
        h('span', { class: 'review-origin-name', text: recipe.source.name
          || (!pictures.length ? 'A web page' : pictures.length === 1 ? 'One picture' : pictures.length + ' pictures, side by side') }),
        link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Open the page') : null,
        pictures.length ? h('button', { class: 'review-origin-more', type: 'button', onclick: () => openPictures(pictures) },
          pictures.length > 1 ? 'All ' + pictures.length + ', larger' : 'Larger') : null),
      strip ? strip.node : null),
    notes.length ? h('div', { class: 'review-notes', role: 'note' }, notes.map((text) => h('p', { text }))) : null,
    h('div', { class: 'editor' },
      fields.nodes,
      h('div', { class: 'review-buttons' },
        h('button', { class: 'btn btn-main', type: 'submit' }, 'Keep'),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: discard }, 'Discard'))));

  root.replaceChildren(form);
  setUi({ openId: id });

  // Kept or discarded, here or on another device: this screen has nothing left to do.
  const stop = subscribe(() => {
    const now = state.recipes.get(id);
    if (!now) onward();
    else if (!now.review) {
      // Kept: show it as an ordinary recipe. The address may already be the right one.
      if (location.hash === '#/r/' + id) dispatchEvent(new HashChangeEvent('hashchange'));
      else go('r/' + id);
    }
  });
  return () => { stop(); if (strip) strip.stop(); setUi({ openId: null }); };
}
