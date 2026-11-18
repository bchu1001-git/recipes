import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeJob, serializeJob, failedJob, retriedJob, readJob, jobPath, picturePath, jobRecipeId } from '../js/jobs.js';
import { makeRecipe } from '../js/model.js';
import { serializeRecipe } from '../js/sync/merge.js';
import { processJobs, summary, JobError } from '../importer/jobs.mjs';
import { recipeFromReading } from '../importer/reading.mjs';
import { commitAndPush } from '../importer/git.mjs';
import * as gemini from '../importer/readers/gemini.mjs';
import { picturesIn, typeOf, dataIn } from '../importer/unpack.mjs';

// The git these tests run must not pick up this computer's own settings (signing, hooks, a default branch).
process.env.GIT_CONFIG_GLOBAL = devNull;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const NOW = '2026-03-01T10:05:00.000Z';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);   // the start of a JPEG; nobody looks further
const exists = (file) => stat(file).then(() => true, () => false);

// What a reader gives back for a made-up recipe.
const READING = {
  title: 'Weeknight lentil soup',
  ingredients: ['For the soup:', '1 cup red lentils', '1 onion, diced', 'To serve:', 'A squeeze of lemon'],
  steps: ['1. Soften the onion in oil.', 'Add the lentils and 4 cups water; simmer 20 minutes.', 'To serve:', 'Finish with lemon.'],
  notes: 'Thickens as it stands.',
  time: '35 minutes',
  serves: '4 servings',
  source: 'The Made-Up Kitchen',
};

/** A folder standing in for a checkout of a library, with the given picture jobs waiting in it. */
async function library(jobs = []) {
  const dir = await mkdtemp(join(tmpdir(), 'recipes-importer-test-'));
  await mkdir(join(dir, 'inbox'), { recursive: true });
  await writeFile(join(dir, 'deleted.json'), '{}\n');
  for (const job of jobs) await addJob(dir, job);
  return dir;
}

async function addJob(dir, { id, count = 1, kind = 'photo', by = 'Phone', data }) {
  const job = data || makeJob({ id, count, at: '2026-03-01T10:00:00.000Z', by, kind });
  await mkdir(join(dir, 'inbox', 'job-' + id), { recursive: true });
  for (let n = 1; n <= count; n++) await writeFile(join(dir, picturePath(id, n)), JPEG);
  await writeFile(join(dir, jobPath(id)), serializeJob(job));
  return job;
}

const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const options = (read) => ({ read, now: () => NOW });

// ---------- from what a reader says to a recipe ----------

test('reading: what the reader saw becomes a recipe waiting for review', () => {
  const { recipe, empty } = recipeFromReading(READING, { id: 'rpabc123def456', kind: 'screenshot', by: 'Phone', now: NOW, originals: ['originals/rpabc123def456/1.jpg'] });
  assert.equal(empty, false);
  assert.equal(recipe.id, 'rpabc123def456');
  assert.equal(recipe.title, 'Weeknight lentil soup');
  assert.equal(recipe.review, true);
  assert.deepEqual(recipe.source, { kind: 'screenshot', name: 'The Made-Up Kitchen', url: '' });
  assert.equal(recipe.minutes, 35);
  assert.equal(recipe.serves, '4');
  assert.equal(recipe.notes.source, 'Thickens as it stands.');
  assert.deepEqual(recipe.originals, ['originals/rpabc123def456/1.jpg']);
  assert.equal(recipe.by, 'Phone');
  assert.equal(recipe.created, NOW);
});

test('reading: group names become headings and step numbers are taken off', () => {
  const { recipe } = recipeFromReading(READING, { id: 'rp1', kind: 'photo', now: NOW });
  assert.deepEqual(recipe.ingredients.map((i) => [i.text, !!i.heading]), [
    ['For the soup:', true], ['1 cup red lentils', false], ['1 onion, diced', false], ['To serve:', true], ['A squeeze of lemon', false],
  ]);
  assert.deepEqual(recipe.steps.map((s) => s.text), ['Soften the onion in oil.', 'Add the lentils and 4 cups water; simmer 20 minutes.', 'To serve:', 'Finish with lemon.']);
  assert.equal(recipe.steps[2].heading, true);
  assert.deepEqual(recipe.steps[1].timers, [20]);
  assert.equal(recipe.ingredients[1].qty, '1');
});

test('reading: the lines the reader was unsure of stay with the recipe while it waits for review', () => {
  const { recipe } = recipeFromReading({ ...READING, unsure: ['1 cup red lentils', '1. Soften the onion in oil.', '1 cup red lentils', '', 7, null] }, { id: 'rp1', kind: 'photo', now: NOW });
  assert.deepEqual(recipe.unsure, ['1 cup red lentils', 'Soften the onion in oil.', '7']);
  // Nothing unsure, or no such list at all: the recipe has no such field.
  assert.equal('unsure' in recipeFromReading({ ...READING, unsure: [] }, { id: 'rp1', kind: 'photo', now: NOW }).recipe, false);
  assert.equal('unsure' in recipeFromReading(READING, { id: 'rp1', kind: 'photo', now: NOW }).recipe, false);
  assert.equal('unsure' in recipeFromReading({ ...READING, unsure: 'not a list' }, { id: 'rp1', kind: 'photo', now: NOW }).recipe, true);
});

test('reading: a suggested title is marked while the recipe waits for review', () => {
  const { recipe } = recipeFromReading({ ...READING, titleSuggested: true }, { id: 'rp1', kind: 'photo', now: NOW });
  assert.equal(recipe.titleSuggested, true);
  assert.equal('titleSuggested' in recipeFromReading(READING, { id: 'rp1', kind: 'photo', now: NOW }).recipe, false);
  assert.equal('titleSuggested' in recipeFromReading({ ...READING, title: '', titleSuggested: true }, { id: 'rp1', kind: 'photo', now: NOW }).recipe, false, 'no title, so nothing to mark');
  assert.equal(recipeFromReading({ ...READING, title: '', titleSuggested: true }, { id: 'rp1', kind: 'photo', now: NOW }).recipe.title, '');
});

test('reading: the name of one group is not the name of the dish', () => {
  const groups = {
    ingredients: ['Roast Squash:', '1 butternut squash', '2 tbsp oil', 'Herb Yoghurt:', '1 cup yoghurt', 'A handful of mint'],
    steps: ['Roast Squash:', 'Cut and oil the squash.', 'Roast for 40 minutes.', 'Herb Yoghurt:', 'Chop the mint.', 'Stir it into the yoghurt.'],
  };
  const read = (fields, job = {}) => recipeFromReading({ ...READING, ...groups, ...fields }, { id: 'rp1', kind: 'screenshot', now: NOW, ...job }).recipe;
  // The reader gave the first group's name as the title: the title is made from the group names and marked.
  const first = read({ title: 'Roast Squash' });
  assert.equal(first.title, 'Roast Squash with Herb Yoghurt');
  assert.equal(first.titleSuggested, true);
  // The groups themselves are untouched.
  assert.deepEqual(first.ingredients.filter((i) => i.heading).map((i) => i.text), ['Roast Squash:', 'Herb Yoghurt:']);
  // A name of its own is kept, and not marked.
  const named = read({ title: 'Sunday chicken dinner' });
  assert.equal(named.title, 'Sunday chicken dinner');
  assert.equal('titleSuggested' in named, false);
  // The reader's own suggestion, when it left the title empty, is used and marked.
  const offered = read({ title: 'Squash and yoghurt', titleSuggested: true });
  assert.equal(offered.title, 'Squash and yoghurt');
  assert.equal(offered.titleSuggested, true);
  // No title and no suggestion: it stays empty for the person to type. Nothing is made up from the groups.
  const none = read({ title: '' });
  assert.equal(none.title, '');
  assert.equal('titleSuggested' in none, false);
  // "For the ..." comes off the names, and names that only say what a part is for are passed over.
  const dough = read({ title: 'For the dough', ingredients: ['For the dough:', 'Flour', 'For the Filling:', 'Ricotta', 'To serve:', 'Sugar', 'TOPPING:', 'Nuts'], steps: ['Mix.', 'Bake.'] });
  assert.equal(dough.title, 'Dough with Filling');
  assert.equal(dough.titleSuggested, true);
  // One real group, whose name is also the title: that is the recipe's name.
  const one = read({ title: 'Lemon curd', ingredients: ['Lemon curd:', '3 lemons', '2 eggs', 'To serve:', 'Toast'], steps: ['Whisk.', 'Thicken.'] });
  assert.equal(one.title, 'Lemon curd');
  assert.equal('titleSuggested' in one, false);
});

test('reading: a title typed when the pictures were sent always wins', () => {
  const read = (fields, typed) => recipeFromReading({ ...READING, ...fields }, { id: 'rp1', kind: 'screenshot', now: NOW, title: typed }).recipe;
  for (const fields of [{}, { title: '' }, { title: 'For the soup' }, { title: 'Something else', titleSuggested: true }]) {
    const recipe = read(fields, '  Sunday   lentil soup ');
    assert.equal(recipe.title, 'Sunday lentil soup');
    assert.equal('titleSuggested' in recipe, false);
  }
  // Nothing typed: the reader's title stands.
  assert.equal(read({}, '').title, 'Weeknight lentil soup');
  assert.equal(read({}, undefined).title, 'Weeknight lentil soup');
  // A typed title does not make a recipe out of pictures that had none in them.
  assert.equal(recipeFromReading({ title: '', ingredients: [], steps: [] }, { id: 'rp1', kind: 'photo', now: NOW, title: 'Soup' }).empty, true);
  assert.equal(recipeFromReading({ title: 'Soup', ingredients: ['For the soup:'], steps: [] }, { id: 'rp1', kind: 'photo', now: NOW }).empty, true, 'a heading alone is not a recipe');
});

test('reading: bullets and tick boxes in front of ingredients, and little pictures in a name, are taken off', () => {
  const { recipe } = recipeFromReading({
    ...READING,
    title: 'Weeknight lentil soup \u{1f372}\u{1f525}',
    source: '\u{1f468}\u200d\u{1f373} soup.account',
    ingredients: ['- 1 cup red lentils', '\u2022 1 onion, diced', '\u2610 2 carrots', '* salt', '-1 is not a bullet', 'A squeeze of lemon'],
  }, { id: 'rp1', kind: 'photo', now: NOW });
  assert.equal(recipe.title, 'Weeknight lentil soup');
  assert.equal(recipe.source.name, 'soup.account');
  assert.deepEqual(recipe.ingredients.map((i) => i.text), ['1 cup red lentils', '1 onion, diced', '2 carrots', 'salt', '-1 is not a bullet', 'A squeeze of lemon']);
});

test('reading: what the picture did not show stays empty', () => {
  const { recipe, empty } = recipeFromReading({ title: 'Toast', ingredients: ['Bread'], steps: [], notes: '', time: '', serves: '', source: '' }, { id: 'rp1', kind: 'photo', now: NOW });
  assert.equal(empty, false);
  assert.equal(recipe.minutes, null);
  assert.equal(recipe.serves, '');
  assert.equal(recipe.source.name, '');
  assert.deepEqual(recipe.steps, []);
  assert.equal(recipe.notes.source, '');
});

test('reading: an answer with nothing in it is empty', () => {
  for (const nothing of [{ title: '', ingredients: [], steps: [], notes: '', time: '', serves: '', source: '' }, {}, null, 'text', [1, 2], 42]) {
    assert.equal(recipeFromReading(nothing, { id: 'rp1', kind: 'photo', now: NOW }).empty, true);
  }
});

test('reading: an odd answer never throws, and markup in it is only ever text', () => {
  const odd = {
    title: '<b>Soup</b> &amp; bread <script>alert(1)</script>',
    ingredients: ['1 cup <i>stock</i>', { not: 'text' }, null, 7, ['nested'], '&frac12; onion'],
    steps: 'Chop.\nSimmer for 10 minutes.',
    notes: ['Keeps well.', 'Freezes.'],
    time: { minutes: 30 },
    serves: 4,
    source: '<img src=x onerror=alert(1)>',
    extra: 'ignored',
  };
  const { recipe } = recipeFromReading(odd, { id: 'rp1', kind: 'photo', now: NOW });
  assert.equal(recipe.title, 'Soup & bread');
  assert.deepEqual(recipe.ingredients.map((i) => i.text), ['1 cup stock', '7', '½ onion']);
  assert.deepEqual(recipe.steps.map((s) => s.text), ['Chop.', 'Simmer for 10 minutes.']);
  assert.equal(recipe.notes.source, 'Keeps well.\nFreezes.');
  assert.equal(recipe.minutes, null);
  assert.equal(recipe.serves, '4');
  assert.equal(recipe.source.name, '');
  assert.equal('extra' in recipe, false);
});

test('reading: very long answers are cut to size', () => {
  const { recipe } = recipeFromReading({ title: 'x'.repeat(1000), ingredients: Array.from({ length: 900 }, (x, i) => 'item ' + i), steps: ['y'.repeat(9000)] }, { id: 'rp1', kind: 'photo', now: NOW });
  assert.equal(recipe.title.length, 200);
  assert.equal(recipe.ingredients.length, 300);
  assert.equal(recipe.steps[0].text.length, 3000);
});

// ---------- working through the jobs in a library ----------

test('importer: the title typed with a job becomes the recipe\u2019s title', async () => {
  const dir = await library();
  await addJob(dir, { id: 'abc123def456', data: { ...makeJob({ id: 'abc123def456', count: 1, at: '2026-03-01T10:00:00.000Z', by: 'Phone', kind: 'screenshot', title: 'Sunday lentil soup' }) } });
  const out = await processJobs(dir, options(async () => ({ ...READING, title: '' })));
  assert.deepEqual(out.read, [{ id: 'abc123def456', recipe: 'rpabc123def456', title: 'Sunday lentil soup' }]);
  assert.equal((await json(join(dir, 'recipes', 'rpabc123def456.json'))).title, 'Sunday lentil soup');
  await rm(dir, { recursive: true, force: true });
});

test('importer: a job becomes a recipe, its pictures move beside it, and the job is gone', async () => {
  const dir = await library([{ id: 'abc123def456', count: 2, kind: 'screenshot' }]);
  let seen = null;
  const out = await processJobs(dir, options(async (asked) => { seen = asked; return READING; }));

  assert.deepEqual(out.read, [{ id: 'abc123def456', recipe: 'rpabc123def456', title: 'Weeknight lentil soup' }]);
  assert.deepEqual(out.failed, []);
  assert.equal(seen.pictures.length, 2);
  assert.equal(seen.kind, 'screenshot');
  assert.deepEqual(seen.pictures[0], { data: JPEG, type: 'image/jpeg' });

  const recipe = await json(join(dir, 'recipes', 'rpabc123def456.json'));
  assert.equal(recipe.title, 'Weeknight lentil soup');
  assert.equal(recipe.review, true);
  assert.equal(recipe.source.kind, 'screenshot');
  assert.deepEqual(recipe.originals, ['originals/rpabc123def456/1.jpg', 'originals/rpabc123def456/2.jpg']);
  // Written exactly the way the app writes a recipe, so the app sees it as unchanged when it syncs.
  assert.equal(await readFile(join(dir, 'recipes', 'rpabc123def456.json'), 'utf8'), serializeRecipe(recipe));

  assert.deepEqual(await readFile(join(dir, 'originals', 'rpabc123def456', '2.jpg')), JPEG);
  assert.deepEqual(await readdir(join(dir, 'inbox')), []);
  assert.equal(summary(out), 'Importer: 1 recipe read from pictures');
  await rm(dir, { recursive: true, force: true });
});

test('importer: a job that cannot be read keeps its pictures and says why', async () => {
  const dir = await library([{ id: 'abc123def456', count: 1 }]);
  const out = await processJobs(dir, options(async () => { throw new JobError('The free AI service is at its limit for now. Try again in a while.'); }));

  assert.deepEqual(out.read, []);
  assert.deepEqual(out.failed, [{ id: 'abc123def456', reason: 'The free AI service is at its limit for now. Try again in a while.' }]);
  const job = await json(join(dir, jobPath('abc123def456')));
  assert.equal(job.error, 'The free AI service is at its limit for now. Try again in a while.');
  assert.equal(job.failed, NOW);
  assert.equal(job.tries, 1);
  assert.ok(await exists(join(dir, picturePath('abc123def456', 1))));
  assert.equal(await exists(join(dir, 'recipes')), false);
  assert.equal(summary(out), 'Importer: 1 lot of pictures could not be read');

  // It is not tried again by itself: the next run leaves it alone.
  let asked = 0;
  const next = await processJobs(dir, options(async () => { asked++; return READING; }));
  assert.equal(asked, 0);
  assert.deepEqual(next.left, [jobPath('abc123def456')]);
  assert.equal((await json(join(dir, jobPath('abc123def456')))).tries, 1);
  await rm(dir, { recursive: true, force: true });
});

test('importer: a fault in the reader is reported on the job without stopping the others', async () => {
  const dir = await library([{ id: 'aaa111aaa111' }, { id: 'bbb222bbb222' }, { id: 'ccc333ccc333' }]);
  let n = 0;
  const out = await processJobs(dir, options(async () => {
    n++;
    if (n === 2) throw new TypeError('reader is not feeling well');
    return { ...READING, title: 'Recipe ' + n };
  }));
  assert.deepEqual(out.read.map((r) => r.title), ['Recipe 1', 'Recipe 3']);
  assert.deepEqual(out.failed, [{ id: 'bbb222bbb222', reason: 'The reader stopped with a fault: reader is not feeling well' }]);
  assert.ok(await exists(join(dir, 'recipes', 'rpaaa111aaa111.json')));
  assert.ok(await exists(join(dir, 'recipes', 'rpccc333ccc333.json')));
  assert.equal(await exists(join(dir, 'recipes', 'rpbbb222bbb222.json')), false);
  assert.deepEqual(await readdir(join(dir, 'inbox')), ['job-bbb222bbb222', 'job-bbb222bbb222.json']);
  assert.equal(summary(out), 'Importer: 2 recipes read from pictures, 1 lot of pictures could not be read');
  await rm(dir, { recursive: true, force: true });
});

test('importer: pictures with no recipe in them make a failed job, not an empty recipe', async () => {
  const dir = await library([{ id: 'abc123def456', count: 2 }]);
  const out = await processJobs(dir, options(async () => ({ title: '', ingredients: [], steps: [], notes: '', time: '', serves: '', source: '' })));
  assert.deepEqual(out.failed, [{ id: 'abc123def456', reason: 'No recipe could be found in these pictures.' }]);
  assert.equal(await exists(join(dir, 'recipes')), false);
  await rm(dir, { recursive: true, force: true });
});

test('importer: a job whose recipe already exists is only tidied away', async () => {
  const dir = await library([{ id: 'abc123def456', count: 2 }]);
  // The recipe was written on an earlier run, and the person has since edited it.
  const edited = makeRecipe({ id: jobRecipeId('abc123def456'), title: 'My edited soup', ingredients: ['Stock'] }, NOW);
  await mkdir(join(dir, 'recipes'), { recursive: true });
  await writeFile(join(dir, 'recipes', edited.id + '.json'), serializeRecipe(edited));

  let asked = 0;
  const out = await processJobs(dir, options(async () => { asked++; return READING; }));
  assert.equal(asked, 0, 'it is not read a second time');
  assert.deepEqual(out.cleared, ['abc123def456']);
  assert.equal((await json(join(dir, 'recipes', edited.id + '.json'))).title, 'My edited soup');
  assert.deepEqual(await readdir(join(dir, 'inbox')), []);
  assert.ok(await exists(join(dir, 'originals', edited.id, '2.jpg')), 'its pictures are still kept beside it');
  assert.equal(summary(out), 'Importer: 1 finished job tidied away');
  await rm(dir, { recursive: true, force: true });
});

test('importer: a job whose recipe was deleted since is not made again', async () => {
  const dir = await library([{ id: 'abc123def456' }]);
  await writeFile(join(dir, 'deleted.json'), JSON.stringify({ [jobRecipeId('abc123def456')]: '2026-03-01T10:03:00.000Z' }));
  let asked = 0;
  const out = await processJobs(dir, options(async () => { asked++; return READING; }));
  assert.equal(asked, 0);
  assert.deepEqual(out.cleared, ['abc123def456']);
  assert.deepEqual(await readdir(join(dir, 'inbox')), []);
  assert.equal(await exists(join(dir, 'recipes')), false);
  assert.equal(await exists(join(dir, 'originals')), false);
  await rm(dir, { recursive: true, force: true });
});

test('importer: files that belong to something else are left exactly as they are', async () => {
  const dir = await library();
  const capture = '{"v":1,"url":"https://kitchen.example/soup","title":"Soup","ld":[]}';
  const link = '{"v":1,"job":"link","id":"link00000001","url":"https://kitchen.example/soup"}';
  const odd = JSON.stringify({ v: 1, job: 'photos', id: 'odd000000001', images: ['recipes/r1.json'] });
  await writeFile(join(dir, 'inbox', '482915.json'), capture);                    // a page saved from Safari: the app's business
  await writeFile(join(dir, 'inbox', 'job-link00000001.json'), link);             // a kind of job from the future
  await writeFile(join(dir, 'inbox', 'job-odd000000001.json'), odd);              // names files, but not as this version does
  await writeFile(join(dir, 'inbox', 'notes.txt'), 'hello');
  let asked = 0;
  const out = await processJobs(dir, options(async () => { asked++; return READING; }));
  assert.equal(asked, 0);
  assert.deepEqual(out.read, []);
  assert.deepEqual(out.failed, []);
  assert.deepEqual(out.left, ['inbox/job-link00000001.json', 'inbox/job-odd000000001.json']);
  assert.equal(await readFile(join(dir, 'inbox', '482915.json'), 'utf8'), capture);
  assert.equal(await readFile(join(dir, 'inbox', 'job-link00000001.json'), 'utf8'), link);
  assert.equal(await readFile(join(dir, 'inbox', 'job-odd000000001.json'), 'utf8'), odd);
  assert.equal(await readFile(join(dir, 'inbox', 'notes.txt'), 'utf8'), 'hello');
  assert.equal(summary(out), 'Importer: nothing to do');
  await rm(dir, { recursive: true, force: true });
});

test('importer: a missing picture, or a file that is not a picture, fails the job with a plain reason', async () => {
  const dir = await library([{ id: 'aaa111aaa111', count: 2 }, { id: 'bbb222bbb222', count: 1 }]);
  await rm(join(dir, picturePath('aaa111aaa111', 2)));
  await writeFile(join(dir, picturePath('bbb222bbb222', 1)), 'GIF89a not a jpeg');
  let asked = 0;
  const out = await processJobs(dir, options(async () => { asked++; return READING; }));
  assert.equal(asked, 0);
  assert.deepEqual(out.failed, [
    { id: 'aaa111aaa111', reason: 'A picture is missing from what was sent. Send the pictures again.' },
    { id: 'bbb222bbb222', reason: 'One of the files sent is not a picture.' },
  ]);
  await rm(dir, { recursive: true, force: true });
});

test('importer: a library with no inbox has nothing to do', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'recipes-importer-test-'));
  const out = await processJobs(dir, options(async () => READING));
  assert.deepEqual(out, { read: [], failed: [], cleared: [], left: [] });
  await rm(dir, { recursive: true, force: true });
});

// ---------- the Gemini reader, with a pretend service ----------

const picture = { data: JPEG, type: 'image/jpeg' };
// The service is asked for groups with headings. The reader hands them on as lines, a heading being a line that ends with a colon.
const SAID = {
  ...READING,
  ingredients: [{ heading: 'For the soup', lines: ['1 cup red lentils', '1 onion, diced'] }, { heading: 'TO SERVE:', lines: ['A squeeze of lemon'] }],
  steps: [{ heading: '', lines: ['1. Soften the onion in oil.', 'Add the lentils and 4 cups water; simmer 20 minutes.'] }, { heading: 'To serve', lines: ['Finish with lemon.'] }],
};
const READ = { ...READING, ingredients: ['For the soup:', '1 cup red lentils', '1 onion, diced', 'TO SERVE:', 'A squeeze of lemon'] };
const answer = (reading) => ({ status: 'completed', steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: JSON.stringify(reading) }] }] });
const reply = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('gemini: the request carries the instruction, the pictures in order and the shape of the answer', async () => {
  let sent = null;
  const out = await gemini.read({ pictures: [picture, { data: Buffer.from('second'), type: 'image/png' }], key: 'a-key', fetch: async (url, options) => { sent = { url, options }; return reply(200, answer(SAID)); } });
  assert.deepEqual(out, READ);
  assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.headers['x-goog-api-key'], 'a-key');
  const body = JSON.parse(sent.options.body);
  assert.equal(body.model, gemini.MODEL);
  assert.equal(body.store, false);
  assert.equal(body.system_instruction, gemini.INSTRUCTION);
  assert.deepEqual(body.input.map((part) => part.type), ['text', 'image', 'image']);
  assert.deepEqual(body.input[1], { type: 'image', data: JPEG.toString('base64'), mime_type: 'image/jpeg' });
  assert.equal(body.input[2].mime_type, 'image/png');
  assert.deepEqual(body.response_format, { type: 'text', mime_type: 'application/json', schema: gemini.SCHEMA });
  assert.deepEqual(gemini.SCHEMA.required, ['title', 'suggested_title', 'ingredients', 'steps', 'notes', 'time', 'serves', 'source', 'unsure']);
  // The key travels in its header and nowhere else.
  assert.equal(sent.options.body.includes('a-key'), false);
  assert.equal(sent.url.includes('a-key'), false);
});

test('gemini: the instruction asks for a copy and nothing invented', () => {
  for (const phrase of ['Copy what is written', 'Do not add, guess', 'a list of groups', 'only if', 'Keep the language of the original', 'ONE recipe', 'nothing is converted']) {
    assert.ok(gemini.INSTRUCTION.includes(phrase), 'missing: ' + phrase);
  }
});

test('gemini: the answer is found wherever the service puts it', () => {
  assert.deepEqual(gemini.answerOf(answer(SAID)), READ);
  assert.deepEqual(gemini.answerOf({ output_text: JSON.stringify(SAID) }), READ);
  assert.deepEqual(gemini.answerOf({ outputs: [{ type: 'text', text: '```json\n' + JSON.stringify(SAID) + '\n```' }] }), READ);
  assert.deepEqual(gemini.answerOf({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Here it is: ' + JSON.stringify(SAID) }] }] }), READ);
});

test('gemini: a title the pictures did not show is passed on as a suggestion', () => {
  const read = (fields) => gemini.answerOf({ output_text: JSON.stringify({ ...SAID, ...fields }) });
  const offered = read({ title: '', suggested_title: 'Lentil Soup with Lemon' });
  assert.equal(offered.title, 'Lentil Soup with Lemon');
  assert.equal(offered.titleSuggested, true);
  assert.equal('suggested_title' in offered, false);
  // A name that was written wins, and nothing is marked.
  const written = read({ title: 'Weeknight lentil soup', suggested_title: 'Something else' });
  assert.equal(written.title, 'Weeknight lentil soup');
  assert.equal('titleSuggested' in written, false);
  // Neither: no title, and nothing to mark.
  const neither = read({ title: ' ', suggested_title: '' });
  assert.equal(neither.title, '');
  assert.equal('titleSuggested' in neither, false);
});

test('gemini: groups become lines, with each heading a line of its own that ends in a colon', () => {
  const read = (ingredients) => gemini.answerOf({ output_text: JSON.stringify({ ...SAID, ingredients }) }).ingredients;
  // A heading as printed, with or without its colon, in capitals or not.
  assert.deepEqual(read([{ heading: 'FOR THE PASTRY', lines: ['250 g flour'] }, { heading: 'For the filling :', lines: ['2 eggs'] }]), ['FOR THE PASTRY:', '250 g flour', 'For the filling:', '2 eggs']);
  // No groups: one group with an empty heading.
  assert.deepEqual(read([{ heading: '', lines: ['250 g flour', '2 eggs'] }]), ['250 g flour', '2 eggs']);
  // Plain lines, should the model give them, pass through. Anything else is dropped.
  assert.deepEqual(read(['250 g flour', { heading: 'Topping', lines: ['Sugar', 7, null] }, 42, null, { lines: 'not a list' }]), ['250 g flour', 'Topping:', 'Sugar']);
  assert.deepEqual(read('not a list'), []);
});

test('gemini: an answer that cannot be used is a plain refusal, never a crash', () => {
  for (const bad of [null, {}, { steps: [] }, { output_text: 'sorry, no' }, { output_text: '[1,2]' }, { steps: [{ type: 'model_output', content: [{ type: 'text', text: '{"title": ' }] }] }]) {
    assert.throws(() => gemini.answerOf(bad), (err) => err instanceof JobError && /could not be understood/.test(err.message));
  }
  assert.throws(() => gemini.answerOf({ status: 'failed', errors: [{ message: 'blocked' }] }), (err) => err instanceof JobError && /did not finish reading: blocked/.test(err.message));
});

test('gemini: what the service refuses is said in words a person can act on', async () => {
  const ask = (status, data) => gemini.read({ pictures: [picture], key: 'a-key', wait: 0, fetch: async () => reply(status, data) });
  await assert.rejects(ask(403, { error: { message: 'API key not valid.' } }), (err) => err instanceof JobError && /did not accept the key.*It said: API key not valid\./.test(err.message));
  await assert.rejects(ask(404, { error: { message: 'model not found' } }), (err) => err instanceof JobError && /needs an update/.test(err.message));
  await assert.rejects(ask(400, { error: { message: 'bad\n  request' } }), (err) => err instanceof JobError && /did not accept the request\. It said: bad request/.test(err.message));
  await assert.rejects(ask(429, {}), (err) => err instanceof JobError && /at its limit/.test(err.message));
  await assert.rejects(ask(503, null), (err) => err instanceof JobError && /problem of its own/.test(err.message));
  await assert.rejects(gemini.read({ pictures: [picture], key: 'a-key', fetch: async () => { throw new Error('offline'); } }), (err) => err instanceof JobError && /could not be reached/.test(err.message));
  await assert.rejects(gemini.read({ pictures: [picture], key: '' }), (err) => err instanceof JobError && /no key/.test(err.message));
});

test('gemini: a busy service is asked once more, and only once', async () => {
  let calls = 0;
  const out = await gemini.read({ pictures: [picture], key: 'a-key', wait: 0, fetch: async () => (++calls === 1 ? reply(429, {}) : reply(200, answer(SAID))) });
  assert.deepEqual(out, READ);
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(gemini.read({ pictures: [picture], key: 'a-key', wait: 0, fetch: async () => { calls++; return reply(503, {}); } }), JobError);
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(gemini.read({ pictures: [picture], key: 'a-key', wait: 0, fetch: async () => { calls++; return reply(400, {}); } }), JobError);
  assert.equal(calls, 1, 'a request that was refused outright is not sent again');
});

// ---------- committing and pushing, against a repository on this computer ----------

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A pretend library on GitHub (a bare repository) with two checkouts of it: the importer's and a device's. */
async function remoteAndCheckouts() {
  const root = await mkdtemp(join(tmpdir(), 'recipes-importer-git-'));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(root, 'remote.git')]);
  execFileSync('git', ['clone', '-q', join(root, 'remote.git'), join(root, 'seed')], { stdio: 'ignore' });
  await writeFile(join(root, 'seed', 'README.md'), '# library\n');
  await writeFile(join(root, 'seed', 'deleted.json'), '{}\n');
  git(join(root, 'seed'), 'add', '-A');
  git(join(root, 'seed'), 'commit', '-q', '-m', 'Start');
  git(join(root, 'seed'), 'push', '-q', 'origin', 'HEAD:main');
  execFileSync('git', ['clone', '-q', '--depth', '1', 'file://' + join(root, 'remote.git'), join(root, 'importer')], { stdio: 'ignore' });   // shallow, as a workflow's checkout is
  execFileSync('git', ['clone', '-q', join(root, 'remote.git'), join(root, 'device')], { stdio: 'ignore' });
  return { root, importer: join(root, 'importer'), device: join(root, 'device'), remote: join(root, 'remote.git') };
}

test('git: nothing changed means nothing is committed', async () => {
  const { root, importer, remote } = await remoteAndCheckouts();
  assert.equal(await commitAndPush(importer, 'Importer: nothing to do'), false);
  assert.equal(git(remote, 'log', '--format=%s').trim(), 'Start');
  await rm(root, { recursive: true, force: true });
});

test('git: the importer’s changes reach the library as one commit', async () => {
  const { root, importer, remote } = await remoteAndCheckouts();
  await mkdir(join(importer, 'recipes'), { recursive: true });
  await writeFile(join(importer, 'recipes', 'rp1.json'), '{}\n');
  assert.equal(await commitAndPush(importer, 'Importer: 1 recipe read from pictures'), true);
  assert.deepEqual(git(remote, 'log', '--format=%s').trim().split('\n'), ['Importer: 1 recipe read from pictures', 'Start']);
  assert.match(git(remote, 'log', '-1', '--format=%an'), /github-actions\[bot\]/);
  await rm(root, { recursive: true, force: true });
});

test('git: when a device synced in the meantime, the importer’s commit goes on top of it', async () => {
  const { root, importer, device, remote } = await remoteAndCheckouts();
  // A device syncs a recipe while the importer is still reading.
  await mkdir(join(device, 'recipes'), { recursive: true });
  await writeFile(join(device, 'recipes', 'r-typed.json'), '{}\n');
  git(device, 'add', '-A');
  git(device, 'commit', '-q', '-m', 'Phone: 1 recipe changed');
  git(device, 'push', '-q', 'origin', 'HEAD:main');

  await mkdir(join(importer, 'recipes'), { recursive: true });
  await writeFile(join(importer, 'recipes', 'rp1.json'), '{}\n');
  assert.equal(await commitAndPush(importer, 'Importer: 1 recipe read from pictures', { wait: 0 }), true);
  assert.deepEqual(git(remote, 'log', '--format=%s').trim().split('\n'), ['Importer: 1 recipe read from pictures', 'Phone: 1 recipe changed', 'Start']);
  assert.deepEqual(git(remote, 'ls-tree', '-r', '--name-only', 'main').trim().split('\n').sort(), ['README.md', 'deleted.json', 'recipes/r-typed.json', 'recipes/rp1.json']);
  await rm(root, { recursive: true, force: true });
});

test('run: the whole importer, from a waiting job to the commit in the library', async () => {
  const { root, importer, device, remote } = await remoteAndCheckouts();
  // A device sends two pictures.
  await addJob(device, { id: 'abc123def456', count: 2, kind: 'photo' });
  git(device, 'add', '-A');
  git(device, 'commit', '-q', '-m', 'Phone: 2 pictures sent to be read');
  git(device, 'push', '-q', 'origin', 'HEAD:main');
  git(importer, 'pull', '-q');

  const run = fileURLToPath(new URL('../importer/run.mjs', import.meta.url));
  const said = execFileSync(process.execPath, [run, importer], { encoding: 'utf8', env: { ...process.env, RECIPES_READER: 'fake', GEMINI_API_KEY: '' } });
  assert.match(said, /Importer: 1 recipe read from pictures \(reader: Stand-in\)/);
  assert.match(said, /The changes are in the library\./);

  assert.deepEqual(git(remote, 'log', '--format=%s').trim().split('\n'), ['Importer: 1 recipe read from pictures', 'Phone: 2 pictures sent to be read', 'Start']);
  assert.deepEqual(git(remote, 'ls-tree', '-r', '--name-only', 'main').trim().split('\n').sort(), [
    'README.md', 'deleted.json', 'originals/rpabc123def456/1.jpg', 'originals/rpabc123def456/2.jpg', 'recipes/rpabc123def456.json',
  ]);
  const recipe = JSON.parse(git(remote, 'show', 'main:recipes/rpabc123def456.json'));
  assert.equal(recipe.title, 'Lemon rice');
  assert.equal(recipe.source.name, 'A made-up cookbook');
  assert.equal(recipe.review, true);
  await rm(root, { recursive: true, force: true });
});

test('run: with no key in the library, the job says so instead of being read', async () => {
  const { root, importer } = await remoteAndCheckouts();
  await addJob(importer, { id: 'abc123def456' });
  const run = fileURLToPath(new URL('../importer/run.mjs', import.meta.url));
  const said = execFileSync(process.execPath, [run, importer], { encoding: 'utf8', env: { ...process.env, RECIPES_READER: 'gemini', GEMINI_API_KEY: '', RECIPES_NO_PUSH: '1' } });
  assert.match(said, /1 lot of pictures could not be read/);
  const job = await json(join(importer, jobPath('abc123def456')));
  assert.match(job.error, /no key for the AI service.*GEMINI_API_KEY/);
  await rm(root, { recursive: true, force: true });
});

// ---------- a job file shared whole by a Shortcut, with its pictures inside it ----------

// Made-up pictures: the right first bytes, something in the middle, and the right last bytes.
const jpeg = (n, size = 200) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, n), Buffer.from([0xff, 0xd9])]);
const png = (n, size = 200) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size, n), Buffer.from('IEND'), Buffer.from([0xae, 0x42, 0x60, 0x82])]);
const wrapped = (bytes) => bytes.toString('base64').replace(/(.{76})/g, '$1\r\n');   // as Shortcuts writes base64 unless told not to
const shared = (pictures, more = {}) => JSON.stringify({ job: 'photos', pictures: pictures.map((p) => p.toString('base64')), ...more });
const same = (found, wanted) => assert.deepEqual(found.map((p) => p.data.toString('hex')), wanted.map((p) => p.toString('hex')));

test('unpack: a picture is told from its first bytes', () => {
  assert.equal(typeOf(jpeg(1)), 'image/jpeg');
  assert.equal(typeOf(png(1)), 'image/png');
  assert.equal(typeOf(Buffer.from('GIF89a and so on')), '');
  assert.equal(typeOf(Buffer.from('%PDF-1.7 and so on')), '');
  assert.equal(typeOf(Buffer.from([0xff, 0xd8])), '');
  assert.equal(typeOf(null), '');
});

test('unpack: the pictures in a shared file are found in order, whatever kind they are', () => {
  const sent = [jpeg(1), png(2), jpeg(3)];
  const { pictures, skipped } = picturesIn(shared(sent));
  same(pictures, sent);
  assert.deepEqual(pictures.map((p) => [p.type, p.ext]), [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/jpeg', 'jpg']]);
  assert.equal(skipped, 0);
});

test('unpack: base64 written with line breaks in it is read all the same', () => {
  const sent = [jpeg(1, 900), png(2, 700)];
  const text = '{"job":"photos","pictures":["' + wrapped(sent[0]) + '","' + wrapped(sent[1]) + '"]}';
  assert.throws(() => JSON.parse(text), 'line breaks inside a string are not JSON');
  assert.equal(dataIn(text).job, 'photos', 'but with them taken out it is');
  same(picturesIn(text).pictures, sent);
  // And when the line breaks were written as \r\n inside the JSON, as a program would write them.
  same(picturesIn(JSON.stringify({ job: 'photos', pictures: sent.map(wrapped) })).pictures, sent);
});

test('unpack: pictures joined by line breaks instead of the separator are still told apart', () => {
  const sent = [jpeg(1, 500), jpeg(2, 500), png(3, 500)];
  const oneLineEach = '{"job":"photos","pictures":["' + sent.map((p) => p.toString('base64')).join('\n') + '"]}';
  same(picturesIn(oneLineEach).pictures, sent);
  const wrappedToo = '{"job":"photos","pictures":["' + sent.map(wrapped).join('\r\n') + '"]}';
  same(picturesIn(wrappedToo).pictures, sent);
  const spaces = '{"job":"photos","pictures":["' + sent.map((p) => p.toString('base64')).join(' ') + '"]}';
  same(picturesIn(spaces).pictures, sent);
});

test('unpack: a line break that happens to fall before what looks like a picture does not cut one in two', () => {
  // Base64 lines are 76 characters, which is 57 bytes. A picture that has the bytes a JPEG starts
  // with at byte 57 has a second line that begins exactly as a new picture would.
  const tricky = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(53, 7), Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.alloc(300, 8), Buffer.from([0xff, 0xd9])]);
  const lines = wrapped(tricky).split('\r\n');
  assert.ok(lines[1].startsWith('/9j/'), 'the made-up picture is as tricky as intended');
  const next = jpeg(2, 300);
  const text = '{"job":"photos","pictures":["' + wrapped(tricky) + '","' + wrapped(next) + '"]}';
  same(picturesIn(text).pictures, [tricky, next]);
  const joined = '{"job":"photos","pictures":["' + wrapped(tricky) + '\r\n' + wrapped(next) + '"]}';
  same(picturesIn(joined).pictures, [tricky, next]);
});

test('unpack: a file that is not quite JSON still gives up its pictures', () => {
  const sent = [jpeg(1), png(2)];
  const b64 = sent.map((p) => p.toString('base64'));
  same(picturesIn('{"job":"photos","pictures":["' + b64[0] + '","' + b64[1]).pictures, sent);                 // the end was left off
  same(picturesIn(b64[0] + '","' + b64[1] + '"]}').pictures, sent);                                            // the beginning was
  same(picturesIn('{"job":"photos","pictures":"' + b64.join(',') + '"}').pictures, sent);                      // no list at all
  same(picturesIn(JSON.stringify({ job: 'photos', pictures: b64 }).replace(/\//g, '\\/')).pictures, sent);     // slashes written as \/
  same(picturesIn(JSON.stringify({ pictures: b64.map((b, i) => 'data:' + (i ? 'image/png' : 'image/jpeg') + ';base64,' + b) })).pictures, sent);
  assert.equal(dataIn('{"job":"photos","pictures":["' + b64[0]), null);
});

test('unpack: what is not a picture is left out, and no more than the most allowed are kept', () => {
  const sent = [jpeg(1), jpeg(2), jpeg(3)];
  const mixed = JSON.stringify({ job: 'photos', pictures: ['hello', Buffer.from('GIF89a not one of ours, however long it goes on').toString('base64'), sent[0].toString('base64'), '', Buffer.from('%PDF-1.7 a page, not a picture').toString('base64'), sent[1].toString('base64')] });
  const found = picturesIn(mixed);
  same(found.pictures, [sent[0], sent[1]]);
  assert.equal(found.skipped, 0);
  const capped = picturesIn(shared(sent), { most: 2 });
  same(capped.pictures, [sent[0], sent[1]]);
  assert.equal(capped.skipped, 1);
  assert.deepEqual(picturesIn(''), { pictures: [], skipped: 0 });
  assert.deepEqual(picturesIn(null), { pictures: [], skipped: 0 });
  assert.deepEqual(picturesIn('{"job":"photos","pictures":[]}'), { pictures: [], skipped: 0 });
});

test('importer: a job file shared whole is unpacked and then read like any other', async () => {
  const dir = await library();
  const sent = [png(1, 600), jpeg(2, 600), jpeg(3, 600)];
  await writeFile(join(dir, 'inbox', 'job-482915.json'), '{"job":"photos","pictures":["' + sent.map(wrapped).join('","') + '"]}');
  let given = null;
  const out = await processJobs(dir, options(async ({ pictures, kind, shared: flag }) => { given = { pictures, kind, shared: flag }; return READING; }));

  assert.deepEqual(out.read, [{ id: '482915', recipe: 'rp482915', title: 'Weeknight lentil soup' }]);
  assert.deepEqual(out.failed, []);
  same(given.pictures, sent);
  assert.equal(given.shared, true, 'the reader is told these were shared from another app');
  assert.deepEqual(given.pictures.map((p) => p.type), ['image/png', 'image/jpeg', 'image/jpeg']);
  assert.equal(given.kind, 'screenshot', 'a PNG among them says screenshots');

  const recipe = await json(join(dir, 'recipes', 'rp482915.json'));
  assert.equal(recipe.review, true);
  assert.equal(recipe.by, 'a Shortcut');
  assert.deepEqual(recipe.originals, ['originals/rp482915/1.png', 'originals/rp482915/2.jpg', 'originals/rp482915/3.jpg']);
  for (let i = 0; i < sent.length; i++) assert.equal((await readFile(join(dir, recipe.originals[i]))).toString('hex'), sent[i].toString('hex'));
  assert.deepEqual(await readdir(join(dir, 'inbox')), [], 'the file and its unpacked pictures are gone');
  assert.equal(summary(out), 'Importer: 1 recipe read from pictures');
  await rm(dir, { recursive: true, force: true });
});

test('importer: when a shared file cannot be read, what is left is an ordinary job the app can show', async () => {
  const dir = await library();
  const sent = [jpeg(1, 600), jpeg(2, 600)];
  const path = jobPath('482915');
  await writeFile(join(dir, path), shared(sent));
  const out = await processJobs(dir, options(async () => { throw new JobError('The free AI service is at its limit for now. Try again in a while.'); }));
  assert.deepEqual(out.failed, [{ id: '482915', reason: 'The free AI service is at its limit for now. Try again in a while.' }]);

  const left = await json(join(dir, path));
  assert.deepEqual(left.images, ['inbox/job-482915/1.jpg', 'inbox/job-482915/2.jpg']);
  assert.equal('pictures' in left, false, 'the pictures are files now, not text inside this one');
  assert.ok((await stat(join(dir, path))).size < 1000);
  const job = readJob(left, path);
  assert.equal(job.state, 'failed');
  assert.equal(job.pictures, 2);
  assert.equal(job.by, 'a Shortcut');
  assert.equal(job.shared, true, 'and it still says where it came from, for the next try');
  for (let i = 0; i < sent.length; i++) assert.equal((await readFile(join(dir, left.images[i]))).toString('hex'), sent[i].toString('hex'));

  // It is left alone until another try is asked for, exactly like a job the app sent.
  const idle = await processJobs(dir, options(async () => READING));
  assert.deepEqual(idle.left, [path]);
  await writeFile(join(dir, path), serializeJob(retriedJob(left)));
  const again = await processJobs(dir, options(async () => READING));
  assert.deepEqual(again.read.map((r) => r.recipe), ['rp482915']);
  assert.deepEqual(await readdir(join(dir, 'inbox')), []);
  await rm(dir, { recursive: true, force: true });
});

const NO_PICTURE = 'No picture was found in what was shared. In the Send Notes/Photos to Recipes Shortcut, check that Convert Image says JPEG.';

test('importer: a shared file with no picture in it becomes a failed job that says so, without asking the reader', async () => {
  const dir = await library();
  const sent = {
    111111: '{"job":"photos","pictures":[]}',
    222222: JSON.stringify({ job: 'photos', pictures: ['hello', Buffer.from('GIF89a not one of ours').toString('base64')] }),
    333333: '{"job":"photos","pictures":["',                                              // cut off before any picture
    444444: 'not json',                                                                    // not JSON, and no picture in it
    555555: '',                                                                            // nothing at all
    666666: Buffer.from('ftypheic, the kind a phone camera saves').toString('base64') + '\n',   // a picture of a kind not read here
    777777: '{"something":"else"}',                                                        // JSON, but not a job of any kind
    888888: '"just a piece of text"',
  };
  for (const [id, text] of Object.entries(sent)) await writeFile(join(dir, jobPath(id)), text);
  let asked = 0;
  const out = await processJobs(dir, options(async () => { asked++; return READING; }));
  assert.equal(asked, 0);
  assert.deepEqual(out.failed.map((f) => f.id), Object.keys(sent));
  assert.ok(out.failed.every((f) => f.reason === NO_PICTURE));
  assert.deepEqual(out.left, []);
  for (const id of Object.keys(sent)) {
    const job = readJob(await json(join(dir, jobPath(id))), jobPath(id));
    assert.equal(job.state, 'failed', id);
    assert.equal(job.pictures, 0);
    assert.equal(job.error, NO_PICTURE);
    assert.equal(job.by, 'a Shortcut');
  }
  assert.equal(summary(out), 'Importer: 8 lots of pictures could not be read');
  // A second run leaves them alone: there is nothing in them to try again.
  const idle = await processJobs(dir, options(async () => { asked++; return READING; }));
  assert.equal(asked, 0);
  assert.equal(idle.left.length, 8);
  await rm(dir, { recursive: true, force: true });
});

// ---------- exactly what the Send Notes/Photos to Recipes Shortcut sends: one picture's base64 to a line, and no JSON ----------

const oneToALine = (pictures, breaks = '') => pictures.map((p) => (breaks ? p.toString('base64').replace(/(.{76})/g, '$1' + breaks) : p.toString('base64'))).join('\n');

test('unpack: what the Shortcut sends, one picture to a line with no JSON around it, gives up its pictures', () => {
  const sent = [jpeg(1, 800), jpeg(2, 801), png(3, 802), jpeg(4, 803), jpeg(5, 804)];   // sizes that end the base64 with and without padding
  assert.equal(dataIn(oneToALine(sent)), null, 'it is not JSON');
  same(picturesIn(oneToALine(sent)).pictures, sent);
  same(picturesIn(oneToALine(sent) + '\n').pictures, sent);
  same(picturesIn('\n' + oneToALine(sent) + '\n\n').pictures, sent);
  // With the line breaks Base64 Encode adds unless it is told not to, whichever kind they are.
  same(picturesIn(oneToALine(sent, '\r\n')).pictures, sent);
  same(picturesIn(oneToALine(sent, '\n')).pictures, sent);
  same(picturesIn(oneToALine(sent, '\r\n') + '\r\n').pictures, sent);
  assert.equal(picturesIn(oneToALine(sent, '\r\n')).skipped, 0);
  // One picture alone, and ten of them.
  same(picturesIn(oneToALine([sent[0]])).pictures, [sent[0]]);
  const ten = Array.from({ length: 10 }, (x, i) => jpeg(i + 1, 500 + i));
  same(picturesIn(oneToALine(ten, '\r\n')).pictures, ten);
});

test('importer: what the Shortcut sends is unpacked and read, with or without line breaks inside each picture', async () => {
  for (const breaks of ['', '\r\n']) {
    const dir = await library();
    const sent = [jpeg(1, 600), jpeg(2, 601), png(3, 602)];
    await writeFile(join(dir, 'inbox', 'job-730144.json'), oneToALine(sent, breaks));
    let given = null;
    const out = await processJobs(dir, options(async ({ pictures, shared: flag }) => { given = { pictures, shared: flag }; return READING; }));
    assert.deepEqual(out.read, [{ id: '730144', recipe: 'rp730144', title: 'Weeknight lentil soup' }]);
    assert.deepEqual(out.failed, []);
    same(given.pictures, sent);
    assert.equal(given.shared, true);
    const recipe = await json(join(dir, 'recipes', 'rp730144.json'));
    assert.deepEqual(recipe.originals, ['originals/rp730144/1.jpg', 'originals/rp730144/2.jpg', 'originals/rp730144/3.png']);
    assert.equal(recipe.by, 'a Shortcut');
    for (let i = 0; i < sent.length; i++) assert.equal((await readFile(join(dir, recipe.originals[i]))).toString('hex'), sent[i].toString('hex'));
    assert.deepEqual(await readdir(join(dir, 'inbox')), []);
    await rm(dir, { recursive: true, force: true });
  }
});

test('importer: a title or a sender written into a shared file is used, and more than ten pictures are cut to ten', async () => {
  const dir = await library();
  const many = Array.from({ length: 12 }, (x, i) => jpeg(i + 1, 300));
  await writeFile(join(dir, jobPath('482915')), shared(many, { title: 'Sunday soup', by: 'Notes', kind: 'screenshot' }));
  let count = 0;
  const out = await processJobs(dir, options(async ({ pictures }) => { count = pictures.length; return READING; }));
  assert.equal(count, 10);
  assert.deepEqual(out.read, [{ id: '482915', recipe: 'rp482915', title: 'Sunday soup' }]);
  const recipe = await json(join(dir, 'recipes', 'rp482915.json'));
  assert.equal(recipe.by, 'Notes');
  assert.equal(recipe.source.kind, 'screenshot');
  assert.equal(recipe.originals.length, 10);
  await rm(dir, { recursive: true, force: true });
});

test('importer: an ordinary job may hold a PNG, and a file with the wrong ending is judged by what is in it', async () => {
  const dir = await library();
  const id = 'abc123def456';
  const job = makeJob({ id, count: 2, at: '2026-03-01T10:00:00.000Z', by: 'Phone', exts: ['png', 'jpg'] });
  await mkdir(join(dir, 'inbox', 'job-' + id), { recursive: true });
  await writeFile(join(dir, picturePath(id, 1, 'png')), jpeg(1));    // named .png, but a JPEG inside
  await writeFile(join(dir, picturePath(id, 2)), png(2));            // named .jpg, but a PNG inside
  await writeFile(join(dir, jobPath(id)), serializeJob(job));
  let types = null;
  let flag = null;
  const out = await processJobs(dir, options(async ({ pictures, shared: s }) => { types = pictures.map((p) => p.type); flag = s; return READING; }));
  assert.equal(out.read.length, 1);
  assert.deepEqual(types, ['image/jpeg', 'image/png']);
  assert.equal(flag, false, 'pictures sent from the app are not marked as shared');
  assert.deepEqual((await json(join(dir, 'recipes', jobRecipeId(id) + '.json'))).originals, ['originals/rp' + id + '/1.png', 'originals/rp' + id + '/2.jpg']);
  await rm(dir, { recursive: true, force: true });
});

test('gemini: pictures shared from another app get the instruction about a page that shows the whole note', () => {
  assert.match(gemini.NOTE_PAGE, /page from a notes app/);
  assert.match(gemini.NOTE_PAGE, /use it as the title/);
  assert.match(gemini.NOTE_PAGE, /do not take the copies as a second lot/);
  const pictures = [{ data: png(1), type: 'image/png' }, { data: jpeg(2), type: 'image/jpeg' }];
  const shared = gemini.request({ pictures, shared: true });
  assert.equal(shared.system_instruction, gemini.INSTRUCTION + '\n\n' + gemini.NOTE_PAGE);
  assert.deepEqual(shared.input.filter((p) => p.type === 'image').map((p) => p.mime_type), ['image/png', 'image/jpeg']);
  // Pictures sent from the app's own screen are read with the instruction exactly as it was.
  assert.equal(gemini.request({ pictures }).system_instruction, gemini.INSTRUCTION);
  assert.doesNotMatch(gemini.INSTRUCTION, /notes app/);
});

test('gemini: the reader passes on that pictures were shared', async () => {
  let sent = null;
  const send = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ status: 'completed', output_text: JSON.stringify({ title: 'Lemon rice', suggested_title: '', ingredients: [{ heading: '', lines: ['1 cup rice'] }], steps: [{ heading: '', lines: ['Cook it.'] }], notes: '', time: '', serves: '', source: '', unsure: [] }) }) }; };
  await gemini.read({ pictures: [{ data: jpeg(1), type: 'image/jpeg' }], key: 'a-key', shared: true, fetch: send });
  assert.match(sent.system_instruction, /page from a notes app/);
  await gemini.read({ pictures: [{ data: jpeg(1), type: 'image/jpeg' }], key: 'a-key', fetch: send });
  assert.doesNotMatch(sent.system_instruction, /page from a notes app/);
});
