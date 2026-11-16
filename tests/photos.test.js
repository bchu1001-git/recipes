// Pictures on their way to becoming recipes, across everything involved: a device that sends them,
// the stand-in for GitHub, the real importer run over the stand-in's files, and the devices that
// then receive the recipe.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fakeGitHub } from './fake-github.js';
import { createClient, GitHubError } from '../js/sync/github.js';
import { syncLibrary } from '../js/sync/sync.js';
import { makeRecipe, starterFolders, reviewNotes } from '../js/model.js';
import { jobPath, picturePath, jobRecipeId, originalPath, makeJob, serializeJob, failedJob, WORKFLOW_PATH } from '../js/jobs.js';
import { processJobs, summary, JobError } from '../importer/jobs.mjs';

let clock = Date.parse('2026-03-01T00:00:00.000Z');
const tick = () => new Date((clock += 60000)).toISOString();

const JPEG = (n) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, n, n, n]);   // made-up pictures that differ
const READING = { title: 'Lemon rice', ingredients: ['For the rice:', '1 cup rice', '2 cups water'], steps: ['Rinse the rice.', 'Simmer for 15 minutes.'], notes: '', time: '25 minutes', serves: '4', source: '' };

/** A pretend device: its own copy of the library, its own queue of pictures and its own memory of the last sync. */
function device(name, hub, fetch = hub.fetch) {
  const d = {
    name, recipes: [], folders: starterFolders(), deleted: {}, base: {}, queue: [], actions: [],
    client: createClient({ owner: 'someone', repo: 'library', token: 'good-key', fetch }),
    /** Picks pictures and sends them, as the From photos screen does. */
    send(id, count, kind = 'photo') {
      d.queue.push({ id, at: tick(), by: name, kind, pictures: Array.from({ length: count }, (x, i) => JPEG(i + 1).toString('base64')) });
    },
    ask(id, action) { d.actions.push({ id, action }); },
    remove(id) { d.recipes = d.recipes.filter((r) => r.id !== id); d.deleted = { ...d.deleted, [id]: tick() }; },
    async sync() {
      const out = await syncLibrary({
        client: d.client, device: name, base: d.base, now: tick(),
        local: { recipes: d.recipes, folders: d.folders, deleted: d.deleted, queue: d.queue, actions: d.actions },
      });
      d.recipes = out.recipes; d.folders = out.folders; d.deleted = out.deleted; d.base = out.base;
      d.queue = d.queue.filter((j) => !out.sentJobs.includes(j.id));
      d.actions = d.actions.filter((a) => !out.doneActions.includes(a.id));
      return out;
    },
    jobs() { return d.base.jobs.map((j) => [j.id, j.state, j.pictures]); },
  };
  return d;
}

async function everyFile(dir, under = dir, out = new Map()) {
  for (const entry of await readdir(under, { withFileTypes: true })) {
    const full = join(under, entry.name);
    if (entry.isDirectory()) await everyFile(dir, full, out);
    else out.set(relative(dir, full).split(sep).join('/'), await readFile(full));
  }
  return out;
}

/** What a library's workflow does on GitHub: the real importer over the library's files, then one commit. */
async function importerRuns(hub, read = async () => READING) {
  const dir = await mkdtemp(join(tmpdir(), 'recipes-photos-test-'));
  try {
    for (const [path, bytes] of hub.snapshot()) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), bytes);
    }
    const out = await processJobs(dir, { read, now: tick });
    if (out.read.length || out.failed.length || out.cleared.length) hub.replaceAll(await everyFile(dir), summary(out));
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('photos: pictures sent from a device land in the library as a job', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.send('abc123def456', 2, 'screenshot');
  const out = await phone.sync();
  assert.equal('title' in JSON.parse(hub.files().get(jobPath('abc123def456'))), false, 'no title was typed, so the job has none');

  assert.deepEqual(out.sentJobs, ['abc123def456']);
  assert.deepEqual(phone.queue, []);
  const files = hub.snapshot();
  assert.deepEqual([...files.keys()].sort(), ['README.md', 'deleted.json', 'folders.json', 'inbox/job-abc123def456.json', 'inbox/job-abc123def456/1.jpg', 'inbox/job-abc123def456/2.jpg']);
  assert.deepEqual(files.get(picturePath('abc123def456', 1)), JPEG(1));
  assert.deepEqual(files.get(picturePath('abc123def456', 2)), JPEG(2));
  const job = JSON.parse(files.get(jobPath('abc123def456')).toString('utf8'));
  assert.equal(job.job, 'photos');
  assert.equal(job.kind, 'screenshot');
  assert.equal(job.by, 'Phone');
  assert.deepEqual(job.images, [picturePath('abc123def456', 1), picturePath('abc123def456', 2)]);
  assert.equal(hub.history()[0], 'Phone: 2 pictures sent to be read');
  assert.deepEqual(phone.jobs(), [['abc123def456', 'waiting', 2]]);
});

test('photos: the next sync sends nothing again and makes no commit', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.send('abc123def456', 1);
  await phone.sync();
  const commits = hub.history().length;
  hub.forgetCalls();
  await phone.sync();
  assert.equal(hub.history().length, commits);
  assert.deepEqual(hub.calls().filter((c) => c.startsWith('POST')), []);
  // The job file is not downloaded again either: nothing about it changed.
  assert.equal(hub.calls().filter((c) => c.includes('/git/blobs/')).length, 0);
  assert.deepEqual(phone.jobs(), [['abc123def456', 'waiting', 1]]);
});

test('photos: from the pictures to a recipe under review, with the importer in between', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const tablet = device('Tablet', hub);
  phone.send('abc123def456', 2);
  await phone.sync();
  await tablet.sync();
  assert.deepEqual(tablet.jobs(), [['abc123def456', 'waiting', 2]], 'another device sees the pictures being read');

  const ran = await importerRuns(hub);
  assert.equal(ran.read.length, 1);

  const out = await phone.sync();
  const id = jobRecipeId('abc123def456');
  const recipe = phone.recipes.find((r) => r.id === id);
  assert.equal(recipe.title, 'Lemon rice');
  assert.equal(recipe.review, true);
  assert.equal(recipe.source.kind, 'photo');
  assert.deepEqual(recipe.originals, [originalPath(id, 1), originalPath(id, 2)]);
  assert.equal(out.received, 1);
  assert.equal(out.sent, 0, 'the importer wrote it the way the app would, so nothing is sent back');
  assert.deepEqual(phone.jobs(), []);
  // Where the pictures can be fetched from, for the review screen.
  assert.deepEqual(Object.keys(phone.base.originals).sort(), [originalPath(id, 1), originalPath(id, 2)]);
  assert.deepEqual(hub.snapshot().get(originalPath(id, 2)), JPEG(2));
  assert.deepEqual(Buffer.from(await phone.client.blobBytes(phone.base.originals[originalPath(id, 1)])), JPEG(1));
  assert.equal(hub.history()[0], 'Importer: 1 recipe read from pictures', 'the device made no commit of its own');

  await tablet.sync();
  assert.equal(tablet.recipes.find((r) => r.id === id).title, 'Lemon rice');
  // The review screen reminds the person that an AI service read this.
  assert.match(reviewNotes(recipe)[0], /read from the pictures by an AI service/);
});

test('photos: the lines the reader was unsure of are pointed out on review, and gone once the recipe is kept', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.send('abc123def456', 1);
  await phone.sync();
  await importerRuns(hub, async () => ({ ...READING, unsure: ['1 cup rice', 'Simmer for 15 minutes.'] }));
  await phone.sync();
  const recipe = phone.recipes.find((r) => r.id === jobRecipeId('abc123def456'));
  assert.deepEqual(recipe.unsure, ['1 cup rice', 'Simmer for 15 minutes.']);
  assert.deepEqual(reviewNotes(recipe).slice(1, 4), ['The reader was not sure it read these lines right:', '• 1 cup rice', '• Simmer for 15 minutes.']);
  assert.deepEqual(reviewNotes({ ...recipe, unsure: ['1 cup rice'] }).slice(1, 3), ['The reader was not sure it read this line right:', '• 1 cup rice']);
  // A title the pictures did not show is pointed out too.
  assert.match(reviewNotes({ ...recipe, titleSuggested: true })[0], /The title is a suggestion/);
  assert.deepEqual(reviewNotes({ ...recipe, titleSuggested: true }).slice(2, 5), ['The reader was not sure it read these lines right:', '• 1 cup rice', '• Simmer for 15 minutes.']);
  // Keep, as the review screen does it: the field is dropped along with `review`.
  const { unsure, ...checked } = recipe;
  const kept = makeRecipe({ ...checked, review: false }, tick());
  assert.equal('unsure' in kept, false);
  assert.equal(reviewNotes(kept).some((note) => /not sure/.test(note)), false);
});

test('photos: a title typed when sending travels with the job and wins over what the reader makes of the pictures', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.queue.push({ id: 'abc123def456', at: tick(), by: 'Phone', kind: 'screenshot', title: '  Sunday   chicken dinner ', pictures: [JPEG(1).toString('base64')] });
  await phone.sync();
  assert.equal(JSON.parse(hub.files().get(jobPath('abc123def456'))).title, 'Sunday chicken dinner');
  assert.equal(phone.base.jobs[0].title, 'Sunday chicken dinner', 'the list can name the job while it is being read');

  // The reader sees a group name where a title would be, and offers a suggestion of its own.
  await importerRuns(hub, async () => ({ ...READING, title: 'For the rice', titleSuggested: true }));
  await phone.sync();
  const recipe = phone.recipes.find((r) => r.id === jobRecipeId('abc123def456'));
  assert.equal(recipe.title, 'Sunday chicken dinner');
  assert.equal('titleSuggested' in recipe, false, 'a typed title is not a suggestion');
  assert.equal(reviewNotes(recipe).some((note) => /title/i.test(note)), false);
});

test('photos: pictures that could not be read show the reason on every device', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const tablet = device('Tablet', hub);
  phone.send('abc123def456', 1);
  await phone.sync();
  await importerRuns(hub, async () => { throw new JobError('No recipe could be found in this picture.'); });
  await phone.sync();
  await tablet.sync();
  for (const d of [phone, tablet]) {
    assert.deepEqual(d.jobs(), [['abc123def456', 'failed', 1]]);
    assert.equal(d.base.jobs[0].error, 'No recipe could be found in this picture.');
  }
  assert.ok(hub.snapshot().has(picturePath('abc123def456', 1)), 'the picture is still there');
});

test('photos: Try again puts the job back to be read, and the importer then reads it', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.send('abc123def456', 1);
  await phone.sync();
  await importerRuns(hub, async () => { throw new JobError('The free AI service is at its limit for now. Try again in a while.'); });
  await phone.sync();

  phone.ask('abc123def456', 'retry');
  const out = await phone.sync();
  assert.deepEqual(out.doneActions, ['abc123def456']);
  assert.deepEqual(phone.actions, []);
  assert.deepEqual(phone.jobs(), [['abc123def456', 'waiting', 1]]);
  const job = JSON.parse(hub.files().get(jobPath('abc123def456')));
  assert.equal('error' in job, false);
  assert.equal(job.tries, 1);
  assert.ok(job.asked, 'the file changed, which is what starts the importer again');
  assert.equal(hub.history()[0], 'Phone: another try at reading pictures');

  await importerRuns(hub);
  await phone.sync();
  assert.equal(phone.recipes.find((r) => r.id === jobRecipeId('abc123def456')).title, 'Lemon rice');
  assert.deepEqual(phone.jobs(), []);
});

test('photos: Discard removes the job and its pictures from the library', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.send('abc123def456', 2);
  phone.send('zzz999zzz999', 1);
  await phone.sync();
  await importerRuns(hub, async () => { throw new JobError('No recipe could be found.'); });
  await phone.sync();

  phone.ask('abc123def456', 'discard');
  const out = await phone.sync();
  assert.deepEqual(out.doneActions, ['abc123def456']);
  assert.deepEqual(phone.jobs(), [['zzz999zzz999', 'failed', 1]]);
  assert.deepEqual([...hub.files().keys()].filter((p) => p.startsWith('inbox/')).sort(), ['inbox/job-zzz999zzz999.json', 'inbox/job-zzz999zzz999/1.jpg']);
  assert.equal(hub.history()[0], 'Phone: pictures discarded');
});

test('photos: asking something of a job that is no longer there does nothing and is forgotten', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  await phone.sync();
  const commits = hub.history().length;
  phone.ask('abc123def456', 'retry');
  phone.ask('zzz999zzz999', 'discard');
  const out = await phone.sync();
  assert.deepEqual(out.doneActions.sort(), ['abc123def456', 'zzz999zzz999']);
  assert.equal(hub.history().length, commits);
});

test('photos: deleting a recipe that was read from pictures removes the pictures too', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const tablet = device('Tablet', hub);
  phone.send('abc123def456', 2);
  phone.send('zzz999zzz999', 1);
  await phone.sync();
  await importerRuns(hub);
  await phone.sync();
  await tablet.sync();

  phone.remove(jobRecipeId('abc123def456'));   // Discard on the review screen
  await phone.sync();
  const left = [...hub.files().keys()].filter((p) => p.startsWith('originals/')).sort();
  assert.deepEqual(left, [originalPath(jobRecipeId('zzz999zzz999'), 1)]);
  assert.deepEqual(Object.keys(phone.base.originals), left);

  await tablet.sync();
  assert.deepEqual(tablet.recipes.map((r) => r.id), [jobRecipeId('zzz999zzz999')]);
  assert.deepEqual(Object.keys(tablet.base.originals), left);
});

test('photos: pictures of a recipe that still exists are never removed', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.send('abc123def456', 1);
  await phone.sync();
  await importerRuns(hub);
  await phone.sync();
  // Kept, edited, synced again and again: the pictures stay.
  const id = jobRecipeId('abc123def456');
  phone.recipes = phone.recipes.map((r) => (r.id === id ? makeRecipe({ ...r, review: false, title: 'Lemon rice, my way' }, tick()) : r));
  await phone.sync();
  await phone.sync();
  assert.ok(hub.files().has(originalPath(id, 1)));
  assert.equal(JSON.parse(hub.files().get('recipes/' + id + '.json')).title, 'Lemon rice, my way');
});

test('photos: a sync that is beaten to it does not send the pictures a second time', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const tablet = device('Tablet', hub);
  await phone.sync();
  await tablet.sync();
  phone.send('abc123def456', 3);
  // Another device gets its commit in just before the phone's lands, so the phone has to go round again.
  hub.onNextMove(() => { hub.onNextMove(null); hub.write('recipes/elsewhere.json', JSON.stringify(makeRecipe({ id: 'elsewhere', title: 'From elsewhere' }, tick())), 'Tablet: 1 recipe changed'); });
  hub.forgetCalls();
  await phone.sync();
  assert.equal(hub.calls().filter((c) => c === 'POST /git/blobs').length, 3, 'three pictures, each stored once');
  assert.ok(hub.files().has(jobPath('abc123def456')));
  assert.ok(hub.files().has('recipes/elsewhere.json'));
  assert.deepEqual(phone.queue, []);
});

test('photos: with no connection the pictures stay queued, and go with a later sync', async () => {
  const hub = fakeGitHub();
  let online = true;
  const phone = device('Phone', hub, (url, options) => (online ? hub.fetch(url, options) : Promise.reject(new Error('offline'))));
  await phone.sync();
  phone.send('abc123def456', 1);
  online = false;
  await assert.rejects(phone.sync(), (err) => err instanceof GitHubError && err.status === 0);
  assert.equal(phone.queue.length, 1, 'nothing was lost');
  online = true;
  await phone.sync();
  assert.deepEqual(phone.queue, []);
  assert.ok(hub.files().has(jobPath('abc123def456')));
});

test('photos: pictures whose job is already in the library, or already read, are not sent again', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.send('abc123def456', 1);
  await phone.sync();
  // The app was closed before it could forget the queue: the same job is still waiting to go.
  phone.send('abc123def456', 1);
  hub.forgetCalls();
  let out = await phone.sync();
  assert.deepEqual(out.sentJobs, ['abc123def456']);
  assert.equal(hub.calls().filter((c) => c === 'POST /git/blobs').length, 0);

  await importerRuns(hub);
  phone.send('abc123def456', 1);   // and again, after it has been read
  hub.forgetCalls();
  out = await phone.sync();
  assert.deepEqual(out.sentJobs, ['abc123def456']);
  assert.equal(hub.calls().filter((c) => c === 'POST /git/blobs').length, 0);
  assert.equal(hub.files().has(jobPath('abc123def456')), false);

  phone.remove(jobRecipeId('abc123def456'));
  await phone.sync();
  phone.send('abc123def456', 1);   // and once more, after the recipe was thrown away
  hub.forgetCalls();
  out = await phone.sync();
  assert.deepEqual(out.sentJobs, ['abc123def456']);
  assert.equal(hub.calls().filter((c) => c === 'POST /git/blobs').length, 0);
});

test('photos: job files are never mistaken for pages saved from Safari, and other jobs are left alone', async () => {
  const hub = fakeGitHub({ empty: false });
  const link = '{"v":1,"job":"link","id":"link00000001","url":"https://kitchen.example/soup"}\n';
  hub.write('inbox/job-link00000001.json', link, 'A newer app: a link to fetch');
  hub.write(jobPath('abc123def456'), serializeJob(makeJob({ id: 'abc123def456', count: 1, at: tick(), by: 'Tablet' })), 'Tablet: pictures');
  hub.write(picturePath('abc123def456', 1), JPEG(1), 'Tablet: pictures');
  hub.write('inbox/job-broken000001.json', 'not json', 'Something else');
  const phone = device('Phone', hub);
  const out = await phone.sync();
  assert.equal(out.added, 0);
  assert.deepEqual(phone.recipes, []);
  assert.deepEqual(phone.jobs(), [['abc123def456', 'waiting', 1]]);
  assert.equal(hub.files().get('inbox/job-link00000001.json'), link);
  assert.equal(hub.files().get('inbox/job-broken000001.json'), 'not json');
  assert.ok(hub.files().has(picturePath('abc123def456', 1)));
});

test('photos: a sync notices whether the library has the file that does the reading', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  await phone.sync();
  assert.equal(phone.base.reader, false);
  hub.write(WORKFLOW_PATH, 'name: Import\n', 'The owner: add the workflow');
  await phone.sync();
  assert.equal(phone.base.reader, true);
  assert.equal(hub.files().get(WORKFLOW_PATH), 'name: Import\n', 'and leaves it as it is');
});

test('photos: a job that failed on the importer’s side is shown without being downloaded twice', async () => {
  const hub = fakeGitHub({ empty: false });
  const data = failedJob(makeJob({ id: 'abc123def456', count: 2, at: tick(), by: 'Phone' }), 'The AI service did not accept the key.', tick());
  hub.write(jobPath('abc123def456'), serializeJob(data), 'Importer: 1 lot of pictures could not be read');
  const phone = device('Phone', hub);
  await phone.sync();
  assert.deepEqual(phone.jobs(), [['abc123def456', 'failed', 2]]);
  hub.forgetCalls();
  await phone.sync();
  assert.equal(hub.calls().filter((c) => c.includes('/git/blobs/')).length, 0);
  assert.equal(phone.base.jobs[0].error, 'The AI service did not accept the key.');
});
