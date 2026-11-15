// The library as this device knows it: recipes and folders in memory, saved to IndexedDB.
// Syncing with GitHub will build on this file; nothing here talks to the network.

import { starterFolders, makeRecipe } from './model.js';

const DB_NAME = 'recipes-app';
const DB_VERSION = 1;

export const state = {
  recipes: new Map(),
  folders: starterFolders(),
  deleted: {},        // recipe id -> when it was deleted, so a later sync doesn't bring it back
  saved: true,        // false when this browser can't store data (for example a private window)
};

let db = null;
const listeners = new Set();

/** Calls `fn` after every change to recipes or folders. Returns a function that stops the calls. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  for (const fn of [...listeners]) fn();
}

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('recipes')) d.createObjectStore('recipes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

function run(storeName, mode, work) {
  if (!db) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const result = work(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Loads everything saved on this device. Safe to call once at start. */
export async function init() {
  try {
    db = await open();
    const all = await run('recipes', 'readonly', (s) => s.getAll());
    for (const r of all || []) state.recipes.set(r.id, r);
    const folders = await run('meta', 'readonly', (s) => s.get('folders'));
    if (folders && Array.isArray(folders.groups)) state.folders = folders;
    const deleted = await run('meta', 'readonly', (s) => s.get('deleted'));
    if (deleted) state.deleted = deleted;
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (err) {
    db = null;
    state.saved = false;
  }
}

/** Saves a new or changed recipe and stamps it with the current time. */
export async function saveRecipe(input) {
  const recipe = makeRecipe(input);
  state.recipes.set(recipe.id, recipe);
  delete state.deleted[recipe.id];
  changed();
  await run('recipes', 'readwrite', (s) => s.put(recipe));
  return recipe;
}

export async function deleteRecipe(id) {
  if (!state.recipes.has(id)) return;
  state.recipes.delete(id);
  state.deleted[id] = new Date().toISOString();
  changed();
  await run('recipes', 'readwrite', (s) => s.delete(id));
  await run('meta', 'readwrite', (s) => s.put(state.deleted, 'deleted'));
}

export async function saveFolders(folders) {
  state.folders = folders;
  changed();
  await run('meta', 'readwrite', (s) => s.put(folders, 'folders'));
}

/** Removes a folder everywhere: from its group and from every recipe filed in it. */
export async function removeFolder(folderId) {
  const folders = {
    groups: state.folders.groups.map((g) => ({ ...g, folders: g.folders.filter((f) => f.id !== folderId) })),
  };
  const touched = [...state.recipes.values()].filter((r) => r.folders.includes(folderId));
  for (const r of touched) {
    const next = makeRecipe({ ...r, folders: r.folders.filter((f) => f !== folderId) });
    state.recipes.set(next.id, next);
    await run('recipes', 'readwrite', (s) => s.put(next));
  }
  await saveFolders(folders);
}

/** Everything in one object, for a backup file. */
export function exportAll() {
  return {
    app: 'recipes',
    version: 1,
    exported: new Date().toISOString(),
    folders: state.folders,
    recipes: [...state.recipes.values()],
  };
}

/** Adds the recipes and folders from a backup. A recipe already here is replaced only by a newer copy. */
export async function importAll(data) {
  if (!data || data.app !== 'recipes' || !Array.isArray(data.recipes)) throw new Error('not a backup');
  let added = 0;
  for (const raw of data.recipes) {
    if (!raw || !raw.id || !raw.title) continue;
    const mine = state.recipes.get(raw.id);
    if (mine && mine.updated >= raw.updated) continue;
    const recipe = { ...makeRecipe(raw), updated: raw.updated || new Date().toISOString() };
    state.recipes.set(recipe.id, recipe);
    await run('recipes', 'readwrite', (s) => s.put(recipe));
    added++;
  }
  if (data.folders && Array.isArray(data.folders.groups)) {
    const folders = { groups: state.folders.groups.map((g) => ({ ...g, folders: [...g.folders] })) };
    for (const theirs of data.folders.groups) {
      let mine = folders.groups.find((g) => g.id === theirs.id);
      if (!mine) { mine = { id: theirs.id, name: theirs.name, folders: [] }; folders.groups.push(mine); }
      for (const f of theirs.folders || []) if (!mine.folders.some((x) => x.id === f.id)) mine.folders.push(f);
    }
    await saveFolders(folders);
  }
  changed();
  return added;
}
