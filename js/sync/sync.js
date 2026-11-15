// One round of syncing: read what is on GitHub, merge it with this device, send up what GitHub lacks.
// It works on plain data and a client, so the tests can run it without a browser.

import { gitBlobSha } from './hash.js';
import { mergeLibraries, serializeRecipe, serializeFolders, serializeDeleted, recipePath, recipeIdOf } from './merge.js';

const FOLDERS = 'folders.json';
const DELETED = 'deleted.json';
const README = '# Recipes library\n\nThis repository holds a recipe collection for the Recipes app. The app reads and writes the files here;\nthere is no need to edit them by hand.\n';

function parse(text, path) {
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object') return data;
  } catch (err) { /* reported below */ }
  throw new Error('A file in the library could not be read: ' + path);
}

function describe(device, changed, removed, other) {
  const parts = [];
  if (changed) parts.push(changed + (changed === 1 ? ' recipe changed' : ' recipes changed'));
  if (removed) parts.push(removed + (removed === 1 ? ' recipe removed' : ' recipes removed'));
  if (!parts.length && other) parts.push('folders updated');
  return (device || 'A device') + ': ' + (parts.join(', ') || 'library updated');
}

/**
 * local:  { recipes: [recipe], folders, deleted }   as this device has them now
 * base:   { head, files: { path: hash } }           as of the last successful sync, or {}
 *
 * Returns the merged library, the new base, and how many recipes changed on each side.
 * Changes made on GitHub by someone else while this runs are picked up by trying again.
 */
export async function syncLibrary({ client, local, base = {}, device = '', branch = 'main' }) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    let head = await client.head(branch);
    if (!head) {
      await client.start('README.md', README, (device || 'A device') + ': start the library');
      head = await client.head(branch);
      if (!head) throw new Error('The library could not be started.');
    }
    const theirFiles = await client.tree(head.tree);

    // This device's library, with the hash each file would have.
    const mine = { recipes: new Map(), folders: local.folders, deleted: local.deleted || {} };
    const myFiles = new Map();
    for (const recipe of local.recipes) {
      if (recipe.example) continue;   // the made-up examples stay on the device
      mine.recipes.set(recipe.id, recipe);
      myFiles.set(recipePath(recipe.id), await gitBlobSha(serializeRecipe(recipe)));
    }
    myFiles.set(FOLDERS, await gitBlobSha(serializeFolders(local.folders)));
    myFiles.set(DELETED, await gitBlobSha(serializeDeleted(mine.deleted)));

    // GitHub's library. A file with the same hash as ours is not downloaded.
    const theirs = { recipes: new Map(), folders: null, deleted: {} };
    for (const [path, sha] of theirFiles) {
      const id = recipeIdOf(path);
      if (!id) continue;
      theirs.recipes.set(id, myFiles.get(path) === sha ? mine.recipes.get(id) : parse(await client.blob(sha), path));
    }
    if (theirFiles.has(FOLDERS)) {
      theirs.folders = theirFiles.get(FOLDERS) === myFiles.get(FOLDERS) ? local.folders : parse(await client.blob(theirFiles.get(FOLDERS)), FOLDERS);
    }
    if (theirFiles.has(DELETED)) {
      theirs.deleted = theirFiles.get(DELETED) === myFiles.get(DELETED) ? mine.deleted : parse(await client.blob(theirFiles.get(DELETED)), DELETED);
    }

    const merged = mergeLibraries(mine, theirs, base.files || {}, { mine: myFiles, theirs: theirFiles });

    // What GitHub lacks.
    const entries = [];
    const files = {};
    let sentChanged = 0;
    let sentRemoved = 0;
    let received = 0;
    for (const [id, recipe] of merged.recipes) {
      const path = recipePath(id);
      const text = serializeRecipe(recipe);
      const sha = await gitBlobSha(text);
      files[path] = sha;
      if (theirFiles.get(path) !== sha) { entries.push({ path, mode: '100644', type: 'blob', content: text }); sentChanged++; }
      if (myFiles.get(path) !== sha) received++;
    }
    for (const path of theirFiles.keys()) {
      const id = recipeIdOf(path);
      if (id && !merged.recipes.has(id)) { entries.push({ path, mode: '100644', type: 'blob', sha: null }); sentRemoved++; }
    }
    for (const id of mine.recipes.keys()) if (!merged.recipes.has(id)) received++;
    let other = 0;
    for (const [path, text] of [[FOLDERS, serializeFolders(merged.folders)], [DELETED, serializeDeleted(merged.deleted)]]) {
      const sha = await gitBlobSha(text);
      files[path] = sha;
      if (theirFiles.get(path) !== sha) { entries.push({ path, mode: '100644', type: 'blob', content: text }); other++; }
    }
    // A version of ours that lost to a newer one from another device is kept in the repository, out of the way.
    for (const lost of merged.clashes) {
      const stamp = String(lost.updated).replace(/[^0-9]/g, '').slice(0, 14);
      entries.push({ path: 'clashes/' + lost.id + '-' + stamp + '.json', mode: '100644', type: 'blob', content: serializeRecipe(lost) });
    }

    let commit = head.commit;
    if (entries.length) {
      commit = await client.commit({ parent: head.commit, tree: head.tree, entries, message: describe(device, sentChanged, sentRemoved, other) });
      try {
        await client.move(branch, commit);
      } catch (err) {
        if (err.status === 422 || err.status === 409) continue;   // someone else synced first: start over
        throw err;
      }
    }

    return {
      recipes: [...merged.recipes.values()],
      folders: merged.folders,
      deleted: merged.deleted,
      base: { head: commit, files },
      sent: sentChanged + sentRemoved,
      received,
    };
  }
  throw new Error('The library kept changing while syncing. Try again in a moment.');
}
