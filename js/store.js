// The library as this device knows it: recipes and folders in memory, saved to IndexedDB.
// Nothing here talks to the network; js/sync/ does that and hands its result to applySync().

import { starterFolders, makeRecipe } from './model.js';

const DB_NAME = 'recipes-app';
const DB_VERSION = 1;
const EPOCH = '2000-01-01T00:00:00.000Z';

export const state = {
  recipes: new Map(),
  folders: { ...starterFolders(), updated: EPOCH, deleted: {} },
  deleted: {},        // recipe id -> when it was deleted, so a later sync doesn't bring it back
  saved: true,        // false when this browser can't store data (for example a private window)
  queue: [],          // picture jobs waiting to be sent: [{ id, at, by, kind, title, pictures: [base64] }]
  actions: [],        // what was asked of a job already in the library: [{ id, action: 'retry' | 'discard' }]
};

/** Which library this device syncs with, and what it looked like at the last sync. */
export const library = {
  config: null,       // { owner, repo, token, device, branch } or null when not connected
  base: {},           // { head, files: { path: hash }, inbox, jobs, originals, reader }
};

// How the recipe page is folded on this device: recipe id -> the groups folded away on its page.
// This is a view choice, not part of any recipe. It is never synced, it changes no recipe's `updated`
// time, and changing it does not count as a change to the library, so nobody listening is told.
let folds = {};

let db = null;
const listeners = new Set();

/** Calls `fn(why)` after every change. `why` is 'edit' for something done here, 'sync' for something received. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(why = 'edit') {
  for (const fn of [...listeners]) fn(why);
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

const getMeta = (key) => run('meta', 'readonly', (s) => s.get(key));
const putMeta = (key, value) => run('meta', 'readwrite', (s) => s.put(value, key));

/** Loads everything saved on this device. Safe to call once at start. */
export async function init() {
  try {
    db = await open();
    const all = await run('recipes', 'readonly', (s) => s.getAll());
    for (const r of all || []) state.recipes.set(r.id, r);
    const folders = await getMeta('folders');
    if (folders && Array.isArray(folders.groups)) state.folders = { updated: EPOCH, deleted: {}, ...folders };
    const deleted = await getMeta('deleted');
    if (deleted) state.deleted = deleted;
    const config = await getMeta('library');
    if (config && config.owner && config.repo && config.token) library.config = config;
    library.base = (await getMeta('base')) || {};
    const folded = await getMeta('folds');
    if (folded && typeof folded === 'object' && !Array.isArray(folded)) folds = folded;
    const queue = await getMeta('queue');
    if (Array.isArray(queue)) state.queue = queue.filter((j) => j && j.id && Array.isArray(j.pictures));
    const actions = await getMeta('jobActions');
    if (Array.isArray(actions)) state.actions = actions.filter((a) => a && a.id && a.action);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (err) {
    db = null;
    state.saved = false;
  }
}

/** Saves a new or changed recipe and stamps it with the current time. */
export async function saveRecipe(input) {
  const recipe = makeRecipe({ ...input, by: (library.config && library.config.device) || input.by || '' });
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
  await putMeta('deleted', state.deleted);
  if (id in folds) {
    delete folds[id];
    await putMeta('folds', folds);
  }
}

/** The groups folded away on one recipe's page on this device, as a set of keys. */
export function foldsFor(id) {
  return new Set(Array.isArray(folds[id]) ? folds[id] : []);
}

/**
 * Remembers on this device that a group on a recipe's page is folded away, or no longer is.
 * The recipe is not touched and nothing is synced. A key whose heading has since been renamed or
 * removed just stops matching anything.
 */
export async function setFold(id, key, folded) {
  const keys = foldsFor(id);
  if (folded) keys.add(key);
  else keys.delete(key);
  if (keys.size) folds[id] = [...keys];
  else delete folds[id];
  await putMeta('folds', folds);
}

/** Saves the groups and folders. A folder that is present is no longer counted as deleted. */
export async function saveFolders(folders) {
  const present = new Set(folders.groups.flatMap((g) => g.folders.map((f) => f.id)));
  const deleted = {};
  for (const [id, at] of Object.entries(folders.deleted || state.folders.deleted || {})) if (!present.has(id)) deleted[id] = at;
  state.folders = { groups: folders.groups, updated: new Date().toISOString(), deleted };
  changed();
  await putMeta('folders', state.folders);
}

/** Removes a folder everywhere: from its group and from every recipe filed in it. */
export async function removeFolder(folderId) {
  const touched = [...state.recipes.values()].filter((r) => r.folders.includes(folderId));
  for (const r of touched) {
    const next = makeRecipe({ ...r, folders: r.folders.filter((f) => f !== folderId) });
    state.recipes.set(next.id, next);
    await run('recipes', 'readwrite', (s) => s.put(next));
  }
  await saveFolders({
    groups: state.folders.groups.map((g) => ({ ...g, folders: g.folders.filter((f) => f.id !== folderId) })),
    deleted: { ...state.folders.deleted, [folderId]: new Date().toISOString() },
  });
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
    const groups = state.folders.groups.map((g) => ({ ...g, folders: [...g.folders] }));
    for (const theirs of data.folders.groups) {
      let mine = groups.find((g) => g.id === theirs.id);
      if (!mine) { mine = { id: theirs.id, name: theirs.name, folders: [] }; groups.push(mine); }
      for (const f of theirs.folders || []) if (!mine.folders.some((x) => x.id === f.id)) mine.folders.push(f);
    }
    await saveFolders({ groups });
  }
  changed();
  return added;
}

// ---------- pictures waiting to be read ----------

/** Keeps a picture job on this device until a sync has sent it, so a dropped connection loses nothing. */
export async function queueJob(job) {
  state.queue = [...state.queue, job];
  changed();
  await putMeta('queue', state.queue);
}

/** Forgets queued jobs: the ones a sync has sent, or one the person changed their mind about. */
export async function dropQueued(ids) {
  const gone = new Set(ids);
  if (!state.queue.some((j) => gone.has(j.id))) return;
  state.queue = state.queue.filter((j) => !gone.has(j.id));
  changed('sync');
  await putMeta('queue', state.queue);
}

/** Notes what to do with a job that is already in the library. The next sync carries it out. */
export async function askOfJob(id, action) {
  state.actions = [...state.actions.filter((a) => a.id !== id), { id, action }];
  changed();
  await putMeta('jobActions', state.actions);
}

export async function dropJobActions(ids) {
  const done = new Set(ids);
  if (!state.actions.some((a) => done.has(a.id))) return;
  state.actions = state.actions.filter((a) => !done.has(a.id));
  changed('sync');
  await putMeta('jobActions', state.actions);
}

// ---------- syncing ----------

export async function saveLibrary(config) {
  library.config = config;
  library.base = {};
  await putMeta('library', config);
  await putMeta('base', {});
  changed('sync');
}

export async function forgetLibrary() {
  library.config = null;
  library.base = {};
  state.actions = [];   // they were about jobs in that library
  await run('meta', 'readwrite', (s) => { s.delete('library'); s.delete('base'); s.delete('jobActions'); });
  changed('sync');
}

export async function saveBase(base) {
  library.base = base;
  changed('sync');   // the picture jobs shown on the list come from here
  await putMeta('base', base);
}

/** What goes into a sync, plus enough to notice anything that changes here while the sync is running. */
export function snapshot() {
  const recipes = [...state.recipes.values()];
  return {
    recipes,
    folders: state.folders,
    deleted: { ...state.deleted },
    seen: new Map(recipes.map((r) => [r.id, r.updated])),
    foldersAt: state.folders.updated,
    queue: [...state.queue],
    actions: [...state.actions],
  };
}

/**
 * Takes the merged library from a sync. Anything that was changed on this device while the sync was
 * running is left alone; it goes up with the next sync.
 */
export async function applySync(result, snap) {
  const merged = new Map(result.recipes.map((r) => [r.id, r]));
  const puts = [];
  const drops = [];

  for (const [id, recipe] of merged) {
    const now = state.recipes.get(id);
    if (now ? now.updated !== snap.seen.get(id) : (id in state.deleted && !(id in snap.deleted))) continue;   // edited or deleted meanwhile
    if (now === recipe) continue;
    state.recipes.set(id, recipe);
    puts.push(recipe);
  }
  for (const [id, now] of state.recipes) {
    if (now.example || merged.has(id)) continue;
    if (!snap.seen.has(id) || now.updated !== snap.seen.get(id)) continue;   // added or edited meanwhile
    state.recipes.delete(id);
    drops.push(id);
  }

  const deleted = { ...result.deleted };
  for (const [id, at] of Object.entries(state.deleted)) if (!(id in snap.deleted)) deleted[id] = at;   // deleted meanwhile
  state.deleted = deleted;
  if (state.folders.updated === snap.foldersAt) state.folders = { updated: EPOCH, deleted: {}, ...result.folders };

  changed('sync');
  await run('recipes', 'readwrite', (s) => { for (const r of puts) s.put(r); for (const id of drops) s.delete(id); });
  await putMeta('deleted', state.deleted);
  await putMeta('folders', state.folders);
}
