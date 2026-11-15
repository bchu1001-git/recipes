// How two copies of a library become one. Pure rules: no network, no storage, no screen.
//
// A library is { recipes: Map<id, recipe>, folders, deleted: { id: time } }.
// Every recipe carries `updated`; every deletion leaves a time in `deleted`. The newer one wins.

/** A recipe as it is written to its file: known fields in a fixed order, anything else after them. */
const ORDER = ['id', 'v', 'title', 'source', 'minutes', 'serves', 'ingredients', 'steps', 'notes', 'folders',
  'goto', 'rating', 'photo', 'originals', 'review', 'created', 'updated', 'by'];

export function serializeRecipe(recipe) {
  const out = {};
  for (const key of ORDER) if (key in recipe) out[key] = recipe[key];
  for (const key of Object.keys(recipe).sort()) if (!(key in out) && key !== 'example') out[key] = recipe[key];
  return JSON.stringify(out, null, 2) + '\n';
}

export function serializeFolders(folders) {
  return JSON.stringify({ groups: folders.groups, updated: folders.updated || EPOCH, deleted: folders.deleted || {} }, null, 2) + '\n';
}

export function serializeDeleted(deleted) {
  const out = {};
  for (const id of Object.keys(deleted).sort()) out[id] = deleted[id];
  return JSON.stringify(out, null, 2) + '\n';
}

export const EPOCH = '2000-01-01T00:00:00.000Z';
export const recipePath = (id) => 'recipes/' + id + '.json';
export const recipeIdOf = (path) => {
  const m = /^recipes\/([^/]+)\.json$/.exec(path);
  return m ? m[1] : null;
};

function later(a, b) {
  if (!a) return b || '';
  if (!b) return a;
  return a >= b ? a : b;
}

/** Folders from both sides. Names and order come from the side changed more recently. */
export function mergeFolders(mine, theirs) {
  if (!theirs) return mine;
  if (!mine) return theirs;
  const mineAt = mine.updated || EPOCH;
  const theirsAt = theirs.updated || EPOCH;
  const [newer, older] = mineAt >= theirsAt ? [mine, theirs] : [theirs, mine];
  const [newerAt, olderAt] = mineAt >= theirsAt ? [mineAt, theirsAt] : [theirsAt, mineAt];

  const deleted = {};
  for (const src of [older.deleted || {}, newer.deleted || {}]) {
    for (const [id, at] of Object.entries(src)) deleted[id] = later(deleted[id], at);
  }
  // A folder stays deleted unless the side that still has it changed its folders after the deletion.
  const gone = (id, sideAt) => deleted[id] && deleted[id] >= sideAt;

  const groups = [];
  const olderGroups = new Map(older.groups.map((g) => [g.id, g]));
  for (const g of newer.groups) {
    const other = olderGroups.get(g.id);
    olderGroups.delete(g.id);
    const folders = g.folders.filter((f) => !gone(f.id, newerAt));
    const have = new Set(g.folders.map((f) => f.id));
    for (const f of other ? other.folders : []) if (!have.has(f.id) && !gone(f.id, olderAt)) folders.push(f);
    groups.push({ id: g.id, name: g.name, folders });
  }
  for (const g of olderGroups.values()) groups.push({ id: g.id, name: g.name, folders: g.folders.filter((f) => !gone(f.id, olderAt)) });

  const kept = new Set(groups.flatMap((g) => g.folders.map((f) => f.id)));
  for (const id of Object.keys(deleted)) if (kept.has(id)) delete deleted[id];
  return { groups, updated: later(mineAt, theirsAt), deleted };
}

/**
 * Merges this device's library with the one on GitHub.
 *
 * `base` is { path: hash } as of the last sync, and `hashes` gives the current hash of each file on each
 * side: { mine: Map<path, hash>, theirs: Map<path, hash> }. They are only used to tell a real clash
 * (both sides changed the same recipe since the last sync) from one side simply being behind.
 *
 * Returns the merged library plus `clashes`: this device's versions that lost a real clash, so the
 * caller can keep them in the repository instead of throwing them away.
 */
export function mergeLibraries(mine, theirs, base = {}, hashes = { mine: new Map(), theirs: new Map() }) {
  const recipes = new Map();
  const deleted = {};
  const clashes = [];

  for (const src of [mine.deleted || {}, theirs.deleted || {}]) {
    for (const [id, at] of Object.entries(src)) deleted[id] = later(deleted[id], at);
  }

  const ids = new Set([...mine.recipes.keys(), ...theirs.recipes.keys()]);
  for (const id of ids) {
    const m = mine.recipes.get(id);
    const t = theirs.recipes.get(id);
    const path = recipePath(id);
    const was = base[path];

    // A file that was synced before and is now missing on GitHub, with no deletion recorded,
    // was removed by hand there. Respect that unless this device changed the recipe since.
    if (m && !t && was && !deleted[id] && hashes.mine.get(path) === was) {
      deleted[id] = new Date().toISOString();
      continue;
    }

    const winner = m && t ? (m.updated >= t.updated ? m : t) : (m || t);
    if (deleted[id] && deleted[id] >= winner.updated) continue;
    delete deleted[id];
    recipes.set(id, winner);

    if (m && t && winner === t) {
      const mineHash = hashes.mine.get(path);
      const theirsHash = hashes.theirs.get(path);
      if (was && mineHash && theirsHash && mineHash !== was && theirsHash !== was && mineHash !== theirsHash) clashes.push(m);
    }
  }

  return { recipes, deleted, folders: mergeFolders(mine.folders, theirs.folders), clashes };
}
