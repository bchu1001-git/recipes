// Starts the app: loads the library saved on this device, draws the list, and shows
// whatever the address asks for (#/r/<id>, #/new, #/edit/<id>, #/settings).

import { init, state } from './store.js';
import { h, toast } from './ui/dom.js';
import { renderHome, renderSide } from './ui/home.js';
import { renderRecipe } from './ui/recipe.js';
import { renderEditor } from './ui/editor.js';
import { renderSettings, applyAppearance, appearance } from './ui/settings.js';
import { startAutoSync } from './sync/auto.js';

const app = document.getElementById('app');
const side = document.getElementById('side');
const list = document.getElementById('list');
const detail = document.getElementById('detail');
let leave = null;

function route() {
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (leave) { leave(); leave = null; }
  let view = 'detail';
  if (name === 'r' && state.recipes.has(id)) leave = renderRecipe(detail, id);
  else if (name === 'new') leave = renderEditor(detail, null);
  else if (name === 'edit' && state.recipes.has(id)) leave = renderEditor(detail, id);
  else if (name === 'settings') leave = renderSettings(detail);
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

async function start() {
  applyAppearance(appearance());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAppearance(appearance()));
  await init();
  renderSide(side);
  renderHome(list);
  route();
  addEventListener('hashchange', route);
  if (!state.saved) toast('This browser is not saving data. Recipes will be gone when the tab closes.');
  startAutoSync();
  registerWorker();
}

start();
