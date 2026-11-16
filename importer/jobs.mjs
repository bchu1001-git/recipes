// Works through the picture jobs waiting in a library: for each one, has the reader read the pictures,
// writes the recipe, moves the pictures beside it, and removes the job. It works on a folder that holds
// a checkout of the library and touches nothing else; committing is git.mjs's business.
//
// One job never gets in the way of another. A job that cannot be read keeps its pictures and has the
// reason written into its own file, where the app finds it. It is not tried again until the person
// asks for that in the app, which takes the reason back out.
//
// A job that a Shortcut shared whole, with its pictures inside the one file, is unpacked first into
// the ordinary layout (see unpack.mjs). From there on it is a job like any other, so the app can
// show it, try it again and discard it without knowing how it arrived.

import { readdir, readFile, writeFile, rename, rm, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  JOB_FILE, MAX_JOB_PICTURES, readJob, makeJob, failedJob, serializeJob, isShared, jobRecipeId, jobFolder, picturePath, pictureExt,
  originalsFolder, originalPath,
} from '../js/jobs.js';
import { serializeRecipe, recipePath } from '../js/sync/merge.js';
import { recipeFromReading } from './reading.mjs';
import { picturesIn, dataIn, typeOf, MAX_PICTURE } from './unpack.mjs';

const MAX_BYTES = MAX_PICTURE;              // one picture. The app sends a few hundred KB
// All of a job's pictures go to the reader in one request, which Google limits to 20 MB once the
// pictures are written as base64 (a third larger than the files) and the instruction is added.
const MAX_TOGETHER = 13 * 1024 * 1024;
const MAX_SHARED = 60 * 1024 * 1024;        // a job file with its pictures inside it

/** An error whose message is a sentence for the person, to be shown in the app as it is. */
export class JobError extends Error {}

const exists = (file) => stat(file).then(() => true, () => false);

async function readJson(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch (err) {
    return null;
  }
}

/** The job's pictures as [{ data, type }], or a JobError that says what is wrong with them. */
async function picturesOf(dir, job) {
  const pictures = [];
  let together = 0;
  for (const image of job.images) {
    const file = join(dir, image);
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) throw new JobError('A picture is missing from what was sent. Send the pictures again.');
    if (info.size > MAX_BYTES) throw new JobError('A picture is too large to be read.');
    together += info.size;
    if (together > MAX_TOGETHER) throw new JobError('These pictures are too large to be read in one go. Send fewer at a time, or send them as JPEG.');
    const data = await readFile(file);
    const type = typeOf(data);   // from what the file holds; its name is not trusted
    if (!type) throw new JobError('One of the files sent is not a picture.');
    pictures.push({ data, type });
  }
  return pictures;
}

/**
 * A job file that was shared whole, with its pictures inside it, made into an ordinary job: the
 * pictures are written out as files beside it and the file itself becomes the small job file that
 * names them. Returns the new job file's data. When no picture could be found in what was shared,
 * that is a job that failed, and says so, so that nothing a Shortcut sent ever sits there unexplained.
 * Returns null for a file that is not one of these (see isShared), which is left exactly as it is.
 */
async function unpack(dir, path, id, now) {
  const file = join(dir, path);
  const info = await stat(file).catch(() => null);
  if (!info || !info.isFile()) return null;
  const tooLarge = info.size > MAX_SHARED;
  const text = tooLarge ? '' : await readFile(file, 'utf8');
  const data = tooLarge ? null : dataIn(text);
  if (!tooLarge && !isShared(data)) return null;   // an ordinary job gone wrong, or a job of another kind: not ours
  const { pictures, skipped } = tooLarge ? { pictures: [], skipped: 0 } : picturesIn(text, { most: MAX_JOB_PICTURES });

  const said = data || {};
  const by = typeof said.by === 'string' && said.by.trim() ? said.by.trim().slice(0, 60) : 'a Shortcut';
  if (!pictures.length) {
    const reason = tooLarge ? 'What was shared is too large to be read. Share fewer pictures at a time.'
      : skipped ? 'The pictures that were shared could not be used. In the Send to Recipes Shortcut, check that Convert Image says JPEG.'
        : 'No picture was found in what was shared. In the Send to Recipes Shortcut, check that Convert Image says JPEG.';
    const failed = failedJob(makeJob({ id, count: 0, at: now, by, title: said.title, shared: true }), reason, now);
    await writeFile(file, serializeJob(failed));
    return failed;
  }
  await mkdir(join(dir, jobFolder(id)), { recursive: true });
  for (let i = 0; i < pictures.length; i++) await writeFile(join(dir, picturePath(id, i + 1, pictures[i].ext)), pictures[i].data);
  // A phone saves its screenshots as PNG. Once the Shortcut has made them JPEG that can no longer be told.
  const kind = said.kind === 'screenshot' || said.kind === 'photo' ? said.kind : pictures.some((p) => p.ext === 'png') ? 'screenshot' : 'photo';
  const job = makeJob({ id, count: pictures.length, at: now, by, kind, title: said.title, exts: pictures.map((p) => p.ext), shared: true });
  await writeFile(file, serializeJob(job));
  return job;
}

/** Puts a job's pictures where its recipe's originals are kept. A picture already moved is left alone. */
async function keepOriginals(dir, job, recipeId) {
  await mkdir(join(dir, originalsFolder(recipeId)), { recursive: true });
  for (let i = 0; i < job.images.length; i++) {
    const from = join(dir, job.images[i]);
    const to = join(dir, originalPath(recipeId, i + 1, pictureExt(job.images[i])));
    if (!(await exists(from))) continue;
    if (await exists(to)) await rm(from);
    else await rename(from, to);
  }
}

async function removeJob(dir, job) {
  await rm(join(dir, jobFolder(job.id)), { recursive: true, force: true });
  await rm(join(dir, job.path), { force: true });
}

/**
 * Handles every picture job in the library checked out at `dir`.
 *
 * `read({ pictures, kind, shared })` is the reader: it resolves with what it read, or rejects. `shared`
 * is true for pictures that came from another app through a Shortcut. A rejection
 * with a JobError carries a sentence for the person; anything else is reported as a fault.
 *
 * Returns { read, failed, cleared, left }:
 *   read     [{ id, recipe, title }]  jobs that became recipes
 *   failed   [{ id, reason }]         jobs that could not be read; the reason is now in the job file
 *   cleared  [id]                     jobs whose recipe already existed or had been deleted since
 *   left     [path]                   files that were not touched: already failed, or not a kind known here
 */
export async function processJobs(dir, { read, now = () => new Date().toISOString() }) {
  const out = { read: [], failed: [], cleared: [], left: [] };
  let names = [];
  try {
    names = await readdir(join(dir, 'inbox'));
  } catch (err) {
    return out;   // no inbox, so nothing is waiting
  }
  const deleted = (await readJson(join(dir, 'deleted.json'))) || {};

  for (const name of names.sort()) {
    const path = 'inbox/' + name;
    const named = JOB_FILE.exec(path);
    if (!named) continue;
    let data = await readJson(join(dir, path));
    let job = readJob(data, path);
    if (!job) {
      // Not an ordinary job. It may be one a Shortcut shared whole, with its pictures inside it.
      data = await unpack(dir, path, named[1], now()).catch(() => null);
      job = readJob(data, path);
      if (!job) { out.left.push(path); continue; }
      if (job.state === 'failed') { out.failed.push({ id: job.id, reason: job.error }); continue; }
    } else if (job.state === 'failed') {
      out.left.push(path);
      continue;
    }

    const recipeId = jobRecipeId(job.id);
    const recipeFile = join(dir, recipePath(recipeId));
    try {
      if (await exists(recipeFile)) {
        // Read on an earlier run that did not get to tidy up after itself.
        await keepOriginals(dir, job, recipeId);
        await removeJob(dir, job);
        out.cleared.push(job.id);
        continue;
      }
      if (recipeId in deleted) {
        // Read once already, and the recipe was thrown away since. It is not made again.
        await removeJob(dir, job);
        out.cleared.push(job.id);
        continue;
      }

      const pictures = await picturesOf(dir, job);
      const reading = await read({ pictures, kind: job.kind, shared: job.shared });
      const originals = job.images.map((image, i) => originalPath(recipeId, i + 1, pictureExt(image)));
      const { recipe, empty } = recipeFromReading(reading, { id: recipeId, kind: job.kind, by: job.by, now: now(), originals, title: job.title });
      if (empty) throw new JobError(job.pictures === 1 ? 'No recipe could be found in this picture.' : 'No recipe could be found in these pictures.');

      // The recipe first: once it exists, a later run knows this job was read and only tidies up.
      await mkdir(join(dir, 'recipes'), { recursive: true });
      await writeFile(recipeFile, serializeRecipe(recipe));
      await keepOriginals(dir, job, recipeId);
      await removeJob(dir, job);
      out.read.push({ id: job.id, recipe: recipeId, title: recipe.title });
    } catch (err) {
      const reason = err instanceof JobError ? err.message : 'The reader stopped with a fault: ' + String((err && err.message) || err).slice(0, 160);
      try {
        await writeFile(join(dir, path), serializeJob(failedJob(data, reason, now())));
      } catch (again) { /* the job stays as it was and is tried on the next run */ }
      out.failed.push({ id: job.id, reason });
    }
  }
  return out;
}

/** One line for the commit, such as "Importer: 1 recipe read from pictures". */
export function summary(out) {
  const parts = [];
  if (out.read.length) parts.push(out.read.length + (out.read.length === 1 ? ' recipe' : ' recipes') + ' read from pictures');
  if (out.failed.length) parts.push(out.failed.length + (out.failed.length === 1 ? ' lot of pictures' : ' lots of pictures') + ' could not be read');
  if (out.cleared.length) parts.push(out.cleared.length + (out.cleared.length === 1 ? ' finished job' : ' finished jobs') + ' tidied away');
  return 'Importer: ' + (parts.join(', ') || 'nothing to do');
}
