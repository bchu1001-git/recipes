// Starts the app: loads the library saved on this device, draws the list, and shows
// whatever the address asks for (#/r/<id>, #/new, #/edit/<id>, #/settings, #/save).
// A recipe that is still waiting for review opens on the review screen instead of its own page.

import { init, state } from './store.js';
import { h, toast } from './ui/dom.js';
import { renderHome, renderSide, openReview } from './ui/home.js';
import { renderRecipe } from './ui/recipe.js';
import { renderEditor } from './ui/editor.js';
import { renderReview } from './ui/review.js';
import { renderSaveSetup } from './ui/save.js';
import { renderSettings, applyAppearance, appearance } from './ui/settings.js';
import { startAutoSync, status, onStatus } from './sync/auto.js';

const app = document.getElementById('app');
const side = document.getElementById('side');
const list = document.getElementById('list');
const detail = document.getElementById('detail');
let leave = null;

function route() {
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (leave) { leave(); leave = null; }
  let view = 'detail';
  const recipe = state.recipes.get(id);
  if ((name === 'r' || name === 'edit') && recipe && recipe.review) leave = renderReview(detail, id);
  else if (name === 'r' && recipe) leave = renderRecipe(detail, id);
  else if (name === 'new') leave = renderEditor(detail, null);
  else if (name === 'edit' && recipe) leave = renderEditor(detail, id);
  else if (name === 'settings') leave = renderSettings(detail);
  else if (name === 'save') leave = renderSaveSetup(detail);
  else {
    view = 'list';
    detail.replaceChildren(h('div', { class: 'placeholder' },
      h('p', { text: state.recipes.size ? 'Pick a recipe from the list.' : 'Your recipes will show here.' })));
  }
  app.dataset.view = view;
}

function registerWorker() {
  // The offline copy is only for the published app; on a local test server it would serve stale files.
  // To try it locally anyway, open http://localhost:8787/?sw and unregister it afterwards.
  const testing = new URLSearchParams(location.search).has('sw');
  if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && !testing)) return;
  const hadOne = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadOne) toast('A new version is ready', { label: 'Reload', run: () => location.reload() });
  });
}

/** Says so when a sync brings recipes to review, wherever in the app the person happens to be. */
function announceArrivals() {
  let told = null;
  onStatus(() => {
    if (status.state !== 'idle' || !status.toReview || status.at === told) return;
    told = status.at;
    // Said once: the Shortcut that saved this has an older script, which misses what the new one reads.
    if (status.scriptNote) {
      toast('Saved, but your Save to Recipes Shortcut has an older script. Update it in Settings, Save from Safari.',
        { label: 'Show me', run: () => { location.hash = '#/save'; } });
      return;
    }
    toast(status.toReview === 1 ? 'A new recipe is waiting for review' : status.toReview + ' new recipes are waiting for review',
      { label: 'Review', run: openReview });
  });
}

async function start() {
  applyAppearance(appearance());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance(appearance()));
  await init();
  renderSide(side);
  renderHome(list);
  route();
  addEventListener('hashchange', route);
  if (!state.saved) toast('This browser is not saving data. Recipes will be gone when the tab closes.');
  announceArrivals();
  startAutoSync();
  registerWorker();
}

start();
