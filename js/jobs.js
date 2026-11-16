// Picture jobs: what the app puts into a library's inbox/ so that the importer reads a recipe out of
// photos or screenshots. Pure rules with no screen, storage or network in them, shared by the app,
// the importer (importer/) and the tests.
//
// A job is one small file plus its pictures:
//
//   inbox/job-<id>.json     { v: 1, job: 'photos', id, images: [paths], at, by, kind, title, shared }
//   inbox/job-<id>/1.jpg    the pictures, in reading order: the pages of ONE recipe
//   inbox/job-<id>/2.jpg
//
// `title` is there only when the person typed one while sending. Pictures of a recipe often show no
// name for it, and a typed title always wins over whatever the reader makes of the pictures.
//
// The importer turns a job into recipes/rp<id>.json (waiting for review), moves the pictures to
// originals/rp<id>/ and removes the job. A job it could not read stays where it is with two fields
// added: `error` (a sentence for the person) and `failed` (when). It is then left alone until the
// person asks for another try, which takes those two fields out again, or discards it.
//
// A Shortcut that shares pictures from another app (a note, say) cannot make several files in one go,
// so it sends one file that carries its pictures inside it, as base64. The "Send to Recipes" Shortcut
// sends the plainest form there is, one picture to a line and nothing else:
//
//   inbox/job-<number>.json   <base64 of a picture>
//                             <base64 of the next>
//
// Anything else that wants to send pictures in one file can use the tidier form, which is read the
// same way:
//
//   inbox/job-<number>.json   { "job": "photos", "pictures": ["<base64>", "<base64>"] }
//
// The importer's first step is to unpack such a file into the layout above, marked `shared`. The app
// never downloads a large one: it tells them by their size and shows a plain "being read" line (see
// LARGE_JOB_FILE). See isShared() for which files count, and importer/unpack.mjs for how they are read.
//
// Other kinds of job (a pasted link, later) will use the same file name with another `job` value.
// Whatever this version does not understand is left exactly as it is.

export const MAX_PICTURES = 6;          // the most pictures the app's own From photos screen sends
export const MAX_JOB_PICTURES = 10;     // the most a job may hold: a shared note brings an extra page along
export const LARGE_JOB_FILE = 20000;    // bytes. A job file larger than this has its pictures inside it
export const PICTURE_EDGE = 2000;       // the long edge a picture is shrunk to before it is sent
const SHORT_EDGE = 900;                 // but a tall screenshot keeps at least this much width
const LONGEST = 8000;

const ID = '[a-z0-9]{6,24}';
export const JOB_FILE = new RegExp('^inbox/job-(' + ID + ')\\.json$');
const JOB_PICTURE = new RegExp('^inbox/job-(' + ID + ')/([1-9][0-9]?)\\.(jpg|png)$');
export const ORIGINAL = /^originals\/([A-Za-z0-9_-]+)\/[^/]+$/;
export const WORKFLOW_PATH = '.github/workflows/import.yml';

export function newJobId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export const jobPath = (id) => 'inbox/job-' + id + '.json';
export const jobFolder = (id) => 'inbox/job-' + id + '/';
const ending = (ext) => (ext === 'png' ? '.png' : '.jpg');
export const picturePath = (id, n, ext) => jobFolder(id) + n + ending(ext);
/** 'png' or 'jpg', from the end of a picture's path. What the file really holds is told from its first bytes. */
export const pictureExt = (path) => (/\.png$/i.test(String(path || '')) ? 'png' : 'jpg');

/** The recipe a job becomes. The same on every device and in the importer, so it is never made twice. */
export const jobRecipeId = (id) => 'rp' + id;
export const originalsFolder = (recipeId) => 'originals/' + recipeId + '/';
export const originalPath = (recipeId, n, ext) => originalsFolder(recipeId) + n + ending(ext);

const MAX_TITLE = 200;
const typedTitle = (title) => (typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : '');

/**
 * The job file for `count` pictures. `kind` says what the pictures are: 'screenshot' or 'photo'.
 * `title` is what the person typed as the recipe's name, if anything. `exts` may say, picture by
 * picture, which are 'png'; the rest are JPEG, as everything the app itself sends is.
 */
export function makeJob({ id, count, at, by, kind, title, exts, shared }) {
  const images = [];
  for (let n = 1; n <= count; n++) images.push(picturePath(id, n, Array.isArray(exts) ? exts[n - 1] : ''));
  const job = { v: 1, job: 'photos', id, images, at: at || new Date().toISOString(), by: by || '', kind: kind === 'screenshot' ? 'screenshot' : 'photo' };
  if (typedTitle(title)) job.title = typedTitle(title);
  if (shared === true) job.shared = true;   // it came whole from a Shortcut, and may hold a picture of a note
  return job;
}

export const serializeJob = (job) => JSON.stringify(job, null, 2) + '\n';

/**
 * What a job file says, or null when it is not a picture job this version understands.
 * `state` is 'waiting' (to be read) or 'failed' (read, and it did not work: `error` says why).
 */
export function readJob(data, path) {
  const named = JOB_FILE.exec(String(path || ''));
  if (!named || !data || typeof data !== 'object' || Array.isArray(data) || data.job !== 'photos') return null;
  const id = named[1];
  if (data.id !== id || !Array.isArray(data.images) || data.images.length > MAX_JOB_PICTURES) return null;
  for (let i = 0; i < data.images.length; i++) {
    const picture = JOB_PICTURE.exec(String(data.images[i]));
    if (!picture || picture[1] !== id) return null;       // a job may only name pictures in its own folder
  }
  const error = typeof data.error === 'string' ? data.error.trim().slice(0, 300) : '';
  // No pictures at all is only ever a job that failed for that very reason: what was shared held none.
  if (!data.images.length && !error) return null;
  return {
    id,
    path: jobPath(id),
    state: error ? 'failed' : 'waiting',
    error,
    at: typeof data.at === 'string' ? data.at : '',
    asked: typeof data.asked === 'string' ? data.asked : '',   // when another try was asked for, if one was
    by: typeof data.by === 'string' ? data.by.slice(0, 60) : '',
    kind: data.kind === 'screenshot' ? 'screenshot' : 'photo',
    title: typedTitle(data.title),   // typed by the person when sending, or empty
    shared: data.shared === true,    // shared from another app by a Shortcut, not sent from the app's own screen
    pictures: data.images.length,
    images: data.images.map(String),
    tries: Number.isInteger(data.tries) && data.tries > 0 ? data.tries : 0,
  };
}

/**
 * Whether a job file that is not an ordinary job is one that was shared whole, with its pictures
 * inside it. `data` is what the file holds as JSON, or null when it is not JSON at all, which is what
 * the Send to Recipes Shortcut sends. Only two things are somebody else's and never touched: a job
 * that names picture files (an ordinary job, or one from a newer version of the app), and a job that
 * says it is of another kind. Everything else under a job file's name came from a Shortcut, so the
 * importer unpacks it, or says plainly that it found no picture in it.
 */
export function isShared(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return true;
  if (Array.isArray(data.images)) return false;
  if (typeof data.job === 'string' && data.job !== 'photos') return false;
  return true;
}

/**
 * What the app shows for a job file that carries its pictures inside it and is waiting to be unpacked
 * and read. Nothing is known about it but its name, because the app does not download it.
 */
export function packedJob(path) {
  const named = JOB_FILE.exec(String(path || ''));
  if (!named) return null;
  return { id: named[1], path: jobPath(named[1]), state: 'waiting', error: '', at: '', asked: '', by: '', kind: 'photo', title: '', pictures: 0, images: [], tries: 0, packed: true };
}

/** The same job file, marked as not read, with the reason. */
export function failedJob(data, reason, now) {
  return { ...data, error: String(reason || 'It could not be read.').slice(0, 300), failed: now, tries: (Number.isInteger(data.tries) ? data.tries : 0) + 1 };
}

/** The same job file, ready for another try: the reason for the last failure is taken out. */
export function retriedJob(data) {
  const { error, failed, ...rest } = data;
  return rest;
}

/**
 * The size a picture is shrunk to before it is sent: the long edge comes down to PICTURE_EDGE, except
 * that a tall screenshot keeps enough width to stay readable. A picture is never made larger.
 */
export function fitWithin(width, height) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  let scale = Math.min(1, PICTURE_EDGE / long);
  if (short * scale < SHORT_EDGE) scale = Math.min(1, SHORT_EDGE / short);
  scale = Math.min(scale, LONGEST / long);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * The public repository this app is served from, as "owner/name", worked out from the page's address
 * on GitHub Pages: owner.github.io/name/. Empty when the app is served from anywhere else.
 */
export function appRepository(hostname, pathname) {
  const host = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.github\.io$/i.exec(String(hostname || ''));
  if (!host) return '';
  const parts = String(pathname || '/').replace(/^\//, '').split('/');
  // Served from the top of the site: no folder, or only a file such as index.html.
  if (!parts[0] || (parts.length === 1 && parts[0].includes('.'))) return host[1] + '/' + host[1] + '.github.io';
  return /^[\w.-]+$/.test(parts[0]) ? host[1] + '/' + parts[0] : '';
}

/**
 * The workflow file a library needs so that pictures sent to it get read: on a push that touches a
 * picture job, it fetches this app's importer and runs it. `app` is the app's public repository.
 * Pages saved from Safari land in inbox/ too, under other names, and do not start it.
 */
export function workflowText(app) {
  return [
    '# Reads recipes out of the pictures the Recipes app sends to this library.',
    '# It was added by following Settings, Read photos, in the app. Deleting this file is safe:',
    '# pictures then simply wait in inbox/ without being read.',
    'name: Import',
    '',
    'on:',
    '  push:',
    '    paths:',
    "      - 'inbox/job-*'",
    "      - 'inbox/job-*/**'",
    '  workflow_dispatch:',
    '',
    'permissions:',
    '  contents: write',
    '',
    'concurrency:',
    '  group: import',
    '  cancel-in-progress: false',
    '',
    'jobs:',
    '  import:',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 15',
    '    steps:',
    '      - name: Get this library',
    '        uses: actions/checkout@v7',
    '        with:',
    '          path: library',
    '      - name: Get the importer from the app',
    '        uses: actions/checkout@v7',
    '        with:',
    '          repository: ' + app,
    '          path: app',
    '      - name: Read the pictures',
    '        env:',
    '          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}',
    '        run: node app/importer/run.mjs library',
    '',
  ].join('\n');
}
