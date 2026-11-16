// One round of syncing: read what is on GitHub, merge it with this device, send up what GitHub lacks.
// It works on plain data and a client, so the tests can run it without a browser.

import { gitBlobSha } from './hash.js';
import { mergeLibraries, serializeRecipe, serializeFolders, serializeDeleted, recipePath, recipeIdOf } from './merge.js';
import { recipeFromCapture, SCRIPT_VERSION } from '../import/page.js';
import {
  JOB_FILE, ORIGINAL, WORKFLOW_PATH, MAX_PICTURES, jobPath, jobFolder, picturePath, jobRecipeId,
  makeJob, serializeJob, readJob, retriedJob,
} from '../jobs.js';

const FOLDERS = 'folders.json';
const DELETED = 'deleted.json';
const README = '# Recipes library\n\nThis repository holds a recipe collection for the Recipes app. The app reads and writes the files here;\nthere is no need to edit them by hand.\n';

// Pages saved from Safari arrive as small files in inbox/. Only the files this app understands are
// touched. Everything else in inbox/ belongs to something else and is left exactly as it is.
const INBOX = /^inbox\/[^/]+\.json$/;
const INBOX_MAX = 1500000;   // bytes. The Shortcut's script keeps a capture well under this
const INBOX_RULES = 1;       // raise this when a newer version understands more kinds of inbox file

function parse(text, path) {
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object') return data;
  } catch (err) { /* reported below */ }
  throw new Error('A file in the library could not be read: ' + path);
}

function describe(device, changed, removed, other, added, cleared, extra = []) {
  const parts = [];
  if (changed) parts.push(changed + (changed === 1 ? ' recipe changed' : ' recipes changed'));
  if (removed) parts.push(removed + (removed === 1 ? ' recipe removed' : ' recipes removed'));
  if (added) parts.push(added + ' new from the inbox');
  parts.push(...extra);
  if (!parts.length && other) parts.push('folders updated');
  if (!parts.length && cleared) parts.push('inbox cleared');
  return (device || 'A device') + ': ' + (parts.join(', ') || 'library updated');
}

/** A page capture: an object with an `ld` list or a `url`, and no `job` (those belong to the importer). */
export function isCapture(data) {
  return !!data && typeof data === 'object' && !Array.isArray(data) && !('job' in data)
    && (Array.isArray(data.ld) || typeof data.url === 'string');
}

/**
 * The id of the recipe made from an inbox file. It comes from the file's path and the hash of its
 * content, which are the same on every device, so two devices that read the same file at the same
 * moment make the same recipe rather than two.
 */
export async function captureId(path, sha) {
  return 'rs' + (await gitBlobSha(path + '\n' + sha)).slice(0, 14);
}

/** When the page was saved, unless that is missing, unreadable or later than now. */
function captureTime(at, now) {
  const time = typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isFinite(time) && time <= Date.parse(now) ? new Date(time).toISOString() : now;
}

/**
 * Looks through inbox/ for saved pages and turns each into a recipe waiting for review.
 *
 * Returns { recipes, done, left, outdated }: the new recipes, the inbox files that are finished with,
 * the files that were looked at and left alone (path -> hash), so they are not downloaded again next
 * time, and how many of the new recipes came from a Shortcut whose page script is an older version.
 * Nothing in the inbox can stop a sync, apart from losing the connection or the key.
 */
async function readInbox({ client, files, sizes, known, taken, now }) {
  const out = { recipes: [], done: [], left: {}, outdated: 0 };
  for (const [path, sha] of files) {
    if (!INBOX.test(path) || JOB_FILE.test(path)) continue;   // picture jobs are looked at by readJobs
    if (known[path] === sha || (sizes.get(path) || 0) > INBOX_MAX) { out.left[path] = sha; continue; }
    let text;
    try {
      text = await client.blob(sha);
    } catch (err) {
      if (err.status === 0 || err.status === 401) throw err;
      continue;   // look again at the next sync
    }
    let data = null;
    try { data = JSON.parse(text); } catch (err) { /* not one of ours */ }
    if (!isCapture(data)) { out.left[path] = sha; continue; }

    const id = await captureId(path, sha);
    if (!taken(id)) {
      let recipe;
      try {
        recipe = recipeFromCapture(data, captureTime(data.at, now)).recipe;
      } catch (err) {
        out.left[path] = sha;   // the reader never throws; if it ever does, the page is not lost
        continue;
      }
      out.recipes.push({ ...recipe, id });
      if (!(Number(data.s) >= SCRIPT_VERSION)) out.outdated++;
    }
    out.done.push(path);
  }
  return out;
}

/**
 * The picture jobs waiting in the library, as the app shows them: [{ id, path, sha, state, error, at,
 * by, kind, pictures, raw }]. A job file that has not changed since the last sync is not downloaded
 * again. One that cannot be fetched or read is passed over this time.
 */
async function readJobs({ client, files, known }) {
  const before = new Map((Array.isArray(known) ? known : []).map((j) => [j.path + '\n' + j.sha, j]));
  const jobs = [];
  for (const [path, sha] of files) {
    if (!JOB_FILE.test(path)) continue;
    const same = before.get(path + '\n' + sha);
    if (same) { jobs.push(same); continue; }
    let data = null;
    try {
      data = JSON.parse(await client.blob(sha));
    } catch (err) {
      if (err.status === 0 || err.status === 401) throw err;
      continue;
    }
    const job = readJob(data, path);
    if (job) jobs.push({ ...job, sha, raw: data });
  }
  return jobs;
}

/**
 * local:  { recipes: [recipe], folders, deleted, queue, actions }   as this device has them now
 * base:   { head, files: { path: hash }, inbox, jobs }              as of the last successful sync, or {}
 *
 * `queue` holds picture jobs this device has yet to send: [{ id, at, by, kind, title, pictures: [base64] }].
 * `actions` holds what the person asked to be done with a job in the library: [{ id, action }], where
 * action is 'retry' or 'discard'.
 *
 * Returns the merged library, the new base, how many recipes changed on each side, `added`: how many
 * recipes were made from pages waiting in the inbox, `outdated`: how many of those pages were saved
 * by a Shortcut whose page script is older than this app expects, `sentJobs`: the queued jobs that are
 * now in the library (or no longer needed), and `doneActions`: the actions that have been carried out.
 * The new base also holds `jobs` (the picture jobs in the library), `originals` (path -> hash of every
 * picture a recipe was read from) and `reader` (whether the library has the workflow that reads them).
 * Changes made on GitHub by someone else while this runs are picked up by trying again.
 */
export async function syncLibrary({ client, local, base = {}, device = '', branch = 'main', now = new Date().toISOString() }) {
  const known = base.inbox && base.inbox.rules === INBOX_RULES ? base.inbox.left || {} : {};
  const uploaded = new Map();   // pictures already stored by this sync, so that a second attempt does not send them again

  for (let attempt = 1; attempt <= 4; attempt++) {
    let head = await client.head(branch);
    if (!head) {
      await client.start('README.md', README, (device || 'A device') + ': start the library');
      head = await client.head(branch);
      if (!head) throw new Error('The library could not be started.');
    }
    const { files: theirFiles, sizes } = await client.tree(head.tree);

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

    // Pages waiting in the inbox become recipes to review. One that was already made into a recipe,
    // or whose recipe was deleted since, makes nothing; its file just leaves the inbox.
    const inbox = await readInbox({
      client, files: theirFiles, sizes, known, now,
      taken: (id) => merged.recipes.has(id) || id in merged.deleted,
    });
    for (const recipe of inbox.recipes) merged.recipes.set(recipe.id, recipe);
    const added = inbox.recipes.length;

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
    // The pages that were read leave the inbox in the same commit that adds their recipes.
    for (const path of inbox.done) entries.push({ path, mode: '100644', type: 'blob', sha: null });

    // Picture jobs. First the ones this device has yet to send: the pictures and the job file go up
    // together, which is what starts the library's importer.
    let jobs = await readJobs({ client, files: theirFiles, known: base.jobs });
    const sentJobs = [];
    const doneActions = [];
    const extra = [];
    let pictures = 0;
    for (const queued of local.queue || []) {
      const path = jobPath(queued.id);
      const recipeId = jobRecipeId(queued.id);
      const count = Math.min((queued.pictures || []).length, MAX_PICTURES);
      const data = makeJob({ id: queued.id, count, at: queued.at, by: queued.by || device, kind: queued.kind, title: queued.title });
      const job = count ? readJob(data, path) : null;
      // Already in the library, already read, read and deleted since, or not a job at all: nothing to send.
      if (!job || theirFiles.has(path) || merged.recipes.has(recipeId) || recipeId in merged.deleted) { sentJobs.push(queued.id); continue; }
      for (let n = 1; n <= count; n++) {
        const mark = queued.id + '/' + n;
        if (!uploaded.has(mark)) uploaded.set(mark, await client.createBlob(queued.pictures[n - 1]));
        entries.push({ path: picturePath(queued.id, n), mode: '100644', type: 'blob', sha: uploaded.get(mark) });
      }
      const text = serializeJob(data);
      entries.push({ path, mode: '100644', type: 'blob', content: text });
      jobs.push({ ...job, sha: await gitBlobSha(text), raw: data });
      sentJobs.push(queued.id);
      pictures += count;
    }
    if (pictures) extra.push(pictures + (pictures === 1 ? ' picture' : ' pictures') + ' sent to be read');

    // Then what the person asked for: another try at a job, or throwing one away with its pictures.
    for (const asked of local.actions || []) {
      const job = jobs.find((j) => j.id === asked.id);
      if (job && asked.action === 'retry' && !sentJobs.includes(job.id)) {
        const data = { ...retriedJob(job.raw), asked: now };   // the changed file is what starts the importer again
        const text = serializeJob(data);
        const again = readJob(data, job.path);
        if (again) {
          entries.push({ path: job.path, mode: '100644', type: 'blob', content: text });
          const sha = await gitBlobSha(text);
          jobs = jobs.map((j) => (j === job ? { ...again, sha, raw: data } : j));
          extra.push('another try at reading pictures');
        }
      } else if (job && asked.action === 'discard' && !sentJobs.includes(job.id)) {
        entries.push({ path: job.path, mode: '100644', type: 'blob', sha: null });
        for (const path of theirFiles.keys()) if (path.startsWith(jobFolder(job.id))) entries.push({ path, mode: '100644', type: 'blob', sha: null });
        jobs = jobs.filter((j) => j !== job);
        extra.push('pictures discarded');
      }
      doneActions.push(asked.id);
    }

    // The pictures a recipe was read from are kept beside it, and go when the recipe has been deleted.
    const originals = {};
    for (const [path, sha] of theirFiles) {
      const picture = ORIGINAL.exec(path);
      if (!picture) continue;
      if (!merged.recipes.has(picture[1]) && picture[1] in merged.deleted) entries.push({ path, mode: '100644', type: 'blob', sha: null });
      else originals[path] = sha;
    }

    let commit = head.commit;
    if (entries.length) {
      const message = describe(device, sentChanged - added, sentRemoved, other, added, inbox.done.length, extra);
      commit = await client.commit({ parent: head.commit, tree: head.tree, entries, message });
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
      base: {
        head: commit, files, inbox: { rules: INBOX_RULES, left: inbox.left },
        jobs, originals, reader: theirFiles.has(WORKFLOW_PATH),
      },
      sent: sentChanged + sentRemoved,
      received,
      added,
      outdated: inbox.outdated,
      sentJobs,
      doneActions,
    };
  }
  throw new Error('The library kept changing while syncing. Try again in a moment.');
}
