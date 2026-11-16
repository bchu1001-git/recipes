import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeGitHub } from './fake-github.js';
import { createClient, GitHubError } from '../js/sync/github.js';
import { syncLibrary, isCapture, captureId } from '../js/sync/sync.js';
import { gitBlobSha } from '../js/sync/hash.js';
import { makeRecipe, starterFolders } from '../js/model.js';
import { SCRIPT_VERSION } from '../js/import/page.js';

let clock = Date.parse('2026-01-01T00:00:00.000Z');
const tick = () => new Date((clock += 60000)).toISOString();

/** A pretend device: its own copy of the library and its own memory of the last sync. */
function device(name, hub, token = 'good-key') {
  const d = {
    name, recipes: [], folders: starterFolders(), deleted: {}, base: {},
    client: createClient({ owner: 'someone', repo: 'library', token, fetch: hub.fetch }),
    add(fields) { const r = { ...makeRecipe(fields, tick()) }; d.recipes.push(r); return r; },
    edit(id, fields) { const i = d.recipes.findIndex((r) => r.id === id); d.recipes[i] = makeRecipe({ ...d.recipes[i], ...fields }, tick()); return d.recipes[i]; },
    remove(id) { d.recipes = d.recipes.filter((r) => r.id !== id); d.deleted = { ...d.deleted, [id]: tick() }; },
    titles() { return d.recipes.filter((r) => !r.example).map((r) => r.title).sort(); },
    async sync() {
      const out = await syncLibrary({ client: d.client, local: { recipes: d.recipes, folders: d.folders, deleted: d.deleted }, base: d.base, device: name, ...(d.now ? { now: d.now } : {}) });
      d.recipes = [...out.recipes, ...d.recipes.filter((r) => r.example)];
      d.folders = out.folders; d.deleted = out.deleted; d.base = out.base;
      return out;
    },
  };
  return d;
}

test('hash: matches the hash git gives a file', async () => {
  // `printf 'hello\n' | git hash-object --stdin`
  assert.equal(await gitBlobSha('hello\n'), 'ce013625030ba8dba906f756967f9e9ca394464a');
  assert.equal(await gitBlobSha(''), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('sync: the first sync starts an empty repository and sends the recipes', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const soup = phone.add({ title: 'Chicken noodle soup', ingredients: ['2 carrots, sliced'] });
  const out = await phone.sync();
  assert.equal(out.sent, 1);
  const files = hub.files();
  assert.deepEqual([...files.keys()].sort(), ['README.md', 'deleted.json', 'folders.json', 'recipes/' + soup.id + '.json']);
  assert.equal(JSON.parse(files.get('recipes/' + soup.id + '.json')).title, 'Chicken noodle soup');
  assert.deepEqual(hub.history(), ['Phone: 1 recipe changed', 'Phone: start the library']);
});

test('sync: a second device receives what the first one sent', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const mac = device('Mac', hub);
  phone.add({ title: 'Soup' });
  phone.add({ title: 'Tacos' });
  await phone.sync();
  const out = await mac.sync();
  assert.equal(out.received, 2);
  assert.equal(out.sent, 0);
  assert.deepEqual(mac.titles(), ['Soup', 'Tacos']);
});

test('sync: with nothing changed there is no new commit and very little traffic', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.add({ title: 'Soup' });
  await phone.sync();
  const before = hub.history().length;
  hub.forgetCalls();
  const out = await phone.sync();
  assert.equal(out.sent + out.received, 0);
  assert.equal(hub.history().length, before);
  assert.deepEqual(hub.calls().map((c) => c.split(' ')[0]), ['GET', 'GET', 'GET']);
});

test('sync: changes to different recipes on two devices both survive', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const mac = device('Mac', hub);
  const soup = phone.add({ title: 'Soup' });
  const tacos = phone.add({ title: 'Tacos' });
  await phone.sync(); await mac.sync();
  phone.edit(soup.id, { title: 'Chicken soup' });
  mac.edit(tacos.id, { title: 'Fish tacos' });
  await phone.sync(); await mac.sync(); await phone.sync();
  assert.deepEqual(phone.titles(), ['Chicken soup', 'Fish tacos']);
  assert.deepEqual(mac.titles(), ['Chicken soup', 'Fish tacos']);
});

test('sync: when both change the same recipe the later change wins and the earlier one is kept aside', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const mac = device('Mac', hub);
  const soup = phone.add({ title: 'Soup' });
  await phone.sync(); await mac.sync();
  phone.edit(soup.id, { title: 'Soup with dill' });     // earlier
  mac.edit(soup.id, { title: 'Soup with thyme' });      // later
  await mac.sync();
  await phone.sync();
  assert.deepEqual(phone.titles(), ['Soup with thyme']);
  assert.deepEqual(mac.titles(), ['Soup with thyme']);
  const aside = [...hub.files().keys()].filter((p) => p.startsWith('clashes/'));
  assert.equal(aside.length, 1);
  assert.equal(JSON.parse(hub.files().get(aside[0])).title, 'Soup with dill');
});

test('sync: a deletion reaches the other device', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const mac = device('Mac', hub);
  const soup = phone.add({ title: 'Soup' });
  phone.add({ title: 'Tacos' });
  await phone.sync(); await mac.sync();
  phone.remove(soup.id);
  const out = await phone.sync();
  assert.equal(hub.history()[0], 'Phone: 1 recipe removed');
  assert.equal(out.sent, 1);
  await mac.sync();
  assert.deepEqual(mac.titles(), ['Tacos']);
  assert.equal(hub.files().has('recipes/' + soup.id + '.json'), false);
});

test('sync: an edit made after another device deleted the recipe brings it back', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const mac = device('Mac', hub);
  const soup = phone.add({ title: 'Soup' });
  await phone.sync(); await mac.sync();
  phone.remove(soup.id);
  await phone.sync();
  mac.edit(soup.id, { title: 'Soup, improved' });
  await mac.sync(); await phone.sync();
  assert.deepEqual(phone.titles(), ['Soup, improved']);
  assert.deepEqual(mac.titles(), ['Soup, improved']);
});

test('sync: if another device syncs in the middle, it starts over and nothing is lost', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const mac = device('Mac', hub);
  phone.add({ title: 'Soup' });
  await phone.sync(); await mac.sync();
  phone.add({ title: 'Tacos' });
  hub.onNextMove(() => hub.write('recipes/rother.json', JSON.stringify({ ...makeRecipe({ id: 'rother', title: 'Slipped in' }, tick()) }), 'Other: 1 recipe changed'));
  await phone.sync();
  await mac.sync();
  assert.deepEqual(phone.titles(), ['Slipped in', 'Soup', 'Tacos']);
  assert.deepEqual(mac.titles(), ['Slipped in', 'Soup', 'Tacos']);
});

test('sync: the made-up example recipes stay on the device', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.add({ title: 'Example soup', example: true });
  phone.add({ title: 'Real soup' });
  await phone.sync();
  assert.equal([...hub.files().keys()].filter((p) => p.startsWith('recipes/')).length, 1);
  assert.equal(phone.recipes.length, 2);
});

test('sync: a new folder reaches the other device, and its removal does too', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const mac = device('Mac', hub);
  await phone.sync(); await mac.sync();
  const dish = (d) => d.folders.groups.find((g) => g.id === 'dish').folders.map((f) => f.name);
  phone.folders = { ...phone.folders, updated: tick(), groups: phone.folders.groups.map((g) => (g.id === 'dish' ? { ...g, folders: [...g.folders, { id: 'dish:dips', name: 'Dips' }] } : g)) };
  await phone.sync(); await mac.sync();
  assert.equal(dish(mac).includes('Dips'), true);
  const at = tick();
  mac.folders = { ...mac.folders, updated: at, deleted: { ...mac.folders.deleted, 'dish:dips': at }, groups: mac.folders.groups.map((g) => ({ ...g, folders: g.folders.filter((f) => f.id !== 'dish:dips') })) };
  await mac.sync(); await phone.sync();
  assert.equal(dish(phone).includes('Dips'), false);
});

test('sync: a field this version does not know about survives a round trip and an edit', async () => {
  const hub = fakeGitHub({ empty: false });
  hub.write('recipes/rfuture.json', JSON.stringify({ ...makeRecipe({ id: 'rfuture', title: 'From a newer app' }, tick()), nutrition: { calories: 320 } }, null, 2) + '\n', 'Newer app');
  const phone = device('Phone', hub);
  await phone.sync();
  assert.deepEqual(phone.recipes[0].nutrition, { calories: 320 });
  phone.edit('rfuture', { rating: 4 });
  await phone.sync();
  const onHub = JSON.parse(hub.files().get('recipes/rfuture.json'));
  assert.equal(onHub.rating, 4);
  assert.deepEqual(onHub.nutrition, { calories: 320 });
});

test('sync: a file removed by hand on GitHub is removed on the device', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const soup = phone.add({ title: 'Soup' });
  await phone.sync();
  hub.write('recipes/' + soup.id + '.json', null, 'Removed by hand');
  await phone.sync();
  assert.deepEqual(phone.titles(), []);
});

test('sync: a wrong key is reported as such', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub, 'wrong-key');
  phone.add({ title: 'Soup' });
  await assert.rejects(phone.sync(), (err) => err instanceof GitHubError && err.status === 401);
});

test('sync: a damaged file stops the sync instead of deleting anything', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const soup = phone.add({ title: 'Soup' });
  await phone.sync();
  hub.write('recipes/' + soup.id + '.json', '{ not json', 'Damaged');
  await assert.rejects(phone.sync(), /could not be read/);
  assert.deepEqual(phone.titles(), ['Soup']);
});

test('client: reports whether the key may write', async () => {
  const yes = createClient({ owner: 'someone', repo: 'library', token: 'good-key', fetch: fakeGitHub().fetch });
  const no = createClient({ owner: 'someone', repo: 'library', token: 'good-key', fetch: fakeGitHub({ canWrite: false }).fetch });
  assert.deepEqual(await yes.about(), { branch: 'main', canWrite: true, isPrivate: true });
  assert.equal((await no.about()).canWrite, false);
});

// ---------- pages saved into the inbox ----------

const INBOX_FILE = 'inbox/20251231-230000.json';
const SAVED_AT = '2025-12-31T23:00:00.000Z';
// A page as the Save to Recipes Shortcut would save it. The site and the recipe are made up.
const page = (more = {}) => ({
  v: 1,
  url: 'https://www.maplestreetkitchen.example/recipes/lentil-soup',
  title: 'Lentil soup | Maple Street Kitchen',
  at: SAVED_AT,
  ld: [JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Recipe', name: 'Lentil soup',
    recipeIngredient: ['1 cup lentils', '1 onion, diced'], recipeInstructions: ['Simmer for 30 minutes.'],
  })],
  ...more,
});
const save = (hub, path = INBOX_FILE, capture = page()) => hub.write(path, JSON.stringify(capture), 'Saved from Safari');
const inboxOf = (hub) => [...hub.files().keys()].filter((p) => p.startsWith('inbox/'));
const recipeFiles = (hub) => [...hub.files().keys()].filter((p) => p.startsWith('recipes/'));

test('inbox: only a page capture counts as one', () => {
  assert.equal(isCapture({ ld: [] }), true);
  assert.equal(isCapture({ url: 'https://www.maplestreetkitchen.example/' }), true);
  assert.equal(isCapture({ job: 'link', url: 'https://www.maplestreetkitchen.example/' }), false);
  assert.equal(isCapture({ title: 'No list and no address' }), false);
  for (const no of [null, undefined, 3, 'text', [1], [{ ld: [] }]]) assert.equal(isCapture(no), false);
});

test('inbox: a saved page becomes a recipe to review and its file leaves the inbox, in one commit', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.add({ title: 'Tacos' });
  await phone.sync();
  save(hub);
  const before = hub.history().length;
  const out = await phone.sync();
  assert.equal(out.added, 1);
  assert.deepEqual(inboxOf(hub), []);
  assert.equal(hub.history().length, before + 1);
  assert.equal(hub.history()[0], 'Phone: 1 new from the inbox');
  const soup = phone.recipes.find((r) => r.title === 'Lentil soup');
  assert.equal(soup.review, true);
  assert.deepEqual(soup.source, { kind: 'web', name: 'maplestreetkitchen.example', url: 'https://www.maplestreetkitchen.example/recipes/lentil-soup' });
  assert.equal(soup.created, SAVED_AT);
  assert.equal(soup.updated, SAVED_AT);
  assert.deepEqual(soup.ingredients.map((i) => i.text), ['1 cup lentils', '1 onion, diced']);
  assert.equal(JSON.parse(hub.files().get('recipes/' + soup.id + '.json')).title, 'Lentil soup');
  assert.deepEqual(phone.titles(), ['Lentil soup', 'Tacos']);
});

test('inbox: the call the Shortcut makes puts a page in the inbox, and the same name is refused a second time', async () => {
  const hub = fakeGitHub({ empty: false });
  const body = { message: 'Saved from Safari', content: Buffer.from(JSON.stringify(page()), 'utf8').toString('base64') };
  assert.equal(hub.handle('PUT', '/contents/' + INBOX_FILE, body, 'Bearer wrong-key')[0], 401);
  assert.equal(hub.handle('PUT', '/contents/' + INBOX_FILE, body, 'Bearer good-key')[0], 201);
  assert.equal(hub.handle('PUT', '/contents/' + INBOX_FILE, body, 'Bearer good-key')[0], 422);
  const phone = device('Phone', hub);
  await phone.sync();
  assert.deepEqual(phone.titles(), ['Lentil soup']);
  assert.deepEqual(inboxOf(hub), []);
});

test('inbox: a second device receives the same recipe, not a second one', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const mac = device('Mac', hub);
  await phone.sync(); await mac.sync();
  save(hub);
  await phone.sync();
  const out = await mac.sync();
  assert.equal(out.added, 0);
  assert.equal(out.received, 1);
  assert.equal(recipeFiles(hub).length, 1);
  assert.deepEqual(mac.recipes, phone.recipes);
});

test('inbox: two devices reading the same page at the same moment end with one recipe', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  const mac = device('Mac', hub);
  await phone.sync(); await mac.sync();
  save(hub);
  // Both start before either has finished. Whichever is second finds the branch moved and starts over.
  const [first, second] = await Promise.all([phone.sync(), mac.sync()]);
  assert.equal(first.added + second.added, 1);
  await phone.sync(); await mac.sync();
  assert.equal(recipeFiles(hub).length, 1);
  assert.deepEqual(inboxOf(hub), []);
  assert.equal(phone.recipes.length, 1);
  assert.deepEqual(mac.recipes, phone.recipes);
});

test('inbox: a device that loses the race takes the other device\'s recipe and makes none of its own', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  await phone.sync();
  const text = JSON.stringify(page());
  hub.write(INBOX_FILE, text, 'Saved from Safari');
  const id = await captureId(INBOX_FILE, await gitBlobSha(text));
  // The Mac gets there first, just as the phone is about to move the branch.
  hub.onNextMove(() => {
    hub.write('recipes/' + id + '.json', JSON.stringify({ ...makeRecipe({ id, title: 'Lentil soup', review: true, by: 'Mac' }, SAVED_AT) }), 'Mac: 1 new from the inbox');
    hub.write(INBOX_FILE, null, 'Mac: inbox cleared');
  });
  const out = await phone.sync();
  assert.equal(out.added, 0);
  assert.equal(recipeFiles(hub).length, 1);
  assert.equal(phone.recipes.length, 1);
  assert.equal(phone.recipes[0].id, id);
  assert.equal(phone.recipes[0].by, 'Mac');
});

test('inbox: a page that was already made into a recipe, or discarded, is not brought back', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  await phone.sync();
  save(hub);
  await phone.sync();
  const soup = phone.recipes[0];
  phone.edit(soup.id, { title: 'Lentil soup, my way', review: false });
  await phone.sync();

  save(hub);   // the very same file turns up again
  const again = await phone.sync();
  assert.equal(again.added, 0);
  assert.deepEqual(inboxOf(hub), []);
  assert.deepEqual(phone.titles(), ['Lentil soup, my way']);
  assert.equal(hub.history()[0], 'Phone: inbox cleared');

  phone.remove(soup.id);
  await phone.sync();
  save(hub);
  const afterDiscard = await phone.sync();
  assert.equal(afterDiscard.added, 0);
  assert.deepEqual(inboxOf(hub), []);
  assert.deepEqual(phone.titles(), []);
  assert.deepEqual(recipeFiles(hub), []);
});

test('inbox: files that are not saved pages are left exactly as they are, and are not downloaded twice', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.add({ title: 'Tacos' });
  await phone.sync();
  const others = {
    'inbox/job-1.json': JSON.stringify({ job: 'link', url: 'https://www.maplestreetkitchen.example/recipes/lentil-soup' }),
    'inbox/broken.json': '{ not json',
    'inbox/list.json': '[1, 2, 3]',
    'inbox/number.json': '42',
    'inbox/note.txt': 'not a json file',
    'inbox/photo.jpg': 'pretend picture',
    'inbox/deeper/page.json': JSON.stringify(page()),
    'inbox/huge.json': JSON.stringify(page({ text: 'x'.repeat(1600000) })),
  };
  for (const [path, text] of Object.entries(others)) hub.write(path, text, 'Something else');
  const before = hub.history().length;
  hub.forgetCalls();
  const out = await phone.sync();
  assert.equal(out.added, 0);
  assert.equal(hub.history().length, before);   // no commit at all
  for (const [path, text] of Object.entries(others)) assert.equal(hub.files().get(path), text);
  assert.deepEqual(phone.titles(), ['Tacos']);
  // Only the four small .json files directly in inbox/ were looked at; the huge one was never fetched.
  assert.equal(hub.calls().filter((c) => c.startsWith('GET /git/blobs/')).length, 4);

  hub.forgetCalls();
  await phone.sync();
  assert.deepEqual(hub.calls().map((c) => c.split(' ')[0]), ['GET', 'GET', 'GET']);   // none looked at again

  hub.write('inbox/broken.json', JSON.stringify(page()), 'Mended');   // once it changes, it is looked at again
  await phone.sync();
  assert.deepEqual(phone.titles(), ['Lentil soup', 'Tacos']);
  assert.equal(hub.files().has('inbox/broken.json'), false);
  assert.equal(hub.files().get('inbox/job-1.json'), others['inbox/job-1.json']);
});

test('inbox: a page with no recipe data still arrives, as a title and a link to fill in', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  await phone.sync();
  save(hub, INBOX_FILE, { v: 1, url: 'https://www.maplestreetkitchen.example/about', title: 'About us | Maple Street Kitchen', ld: [] });
  const out = await phone.sync();
  assert.equal(out.added, 1);
  const draft = phone.recipes[0];
  assert.equal(draft.review, true);
  assert.equal(draft.title, 'About us');
  assert.equal(draft.source.url, 'https://www.maplestreetkitchen.example/about');
  assert.deepEqual(draft.ingredients, []);
});

test('inbox: a page with no time, or a time that has not happened yet, is stamped with now', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.now = '2026-02-01T10:00:00.000Z';
  await phone.sync();
  save(hub, 'inbox/a.json', page({ at: undefined }));
  save(hub, 'inbox/b.json', page({ at: '2031-05-05T00:00:00.000Z' }));
  save(hub, 'inbox/c.json', page({ at: 'yesterday afternoon' }));
  save(hub, 'inbox/d.json', page());
  await phone.sync();
  assert.equal(phone.recipes.length, 4);
  assert.deepEqual(phone.recipes.map((r) => r.updated).sort(), [SAVED_AT, phone.now, phone.now, phone.now]);
  assert.equal(new Set(phone.recipes.map((r) => r.id)).size, 4);
});

test('inbox: a page that cannot be fetched this time does not stop the sync, and is read the next time', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.add({ title: 'Tacos' });
  await phone.sync();
  save(hub);
  const blob = phone.client.blob;
  phone.client.blob = async () => { throw new GitHubError(502, 'Bad gateway'); };
  phone.add({ title: 'Salad' });
  const out = await phone.sync();
  assert.equal(out.added, 0);
  assert.equal(out.sent, 1);
  assert.deepEqual(inboxOf(hub), [INBOX_FILE]);
  phone.client.blob = blob;
  await phone.sync();
  assert.deepEqual(phone.titles(), ['Lentil soup', 'Salad', 'Tacos']);
  assert.deepEqual(inboxOf(hub), []);
});

test('inbox: losing the connection while reading a page stops the sync, so it is tried again', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  await phone.sync();
  save(hub);
  phone.client.blob = async () => { throw new GitHubError(0, 'No connection'); };
  await assert.rejects(phone.sync(), (err) => err instanceof GitHubError && err.status === 0);
  assert.deepEqual(inboxOf(hub), [INBOX_FILE]);
});

test('inbox: odd things inside a capture cannot stop a sync', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  phone.add({ title: 'Tacos' });
  await phone.sync();
  save(hub, 'inbox/odd.json', { ld: [12, null, { a: 1 }, '{ broken', '<b>not data</b>'], url: 7, title: { x: 1 }, at: 99 });
  const out = await phone.sync();
  assert.equal(out.added, 1);
  assert.deepEqual(inboxOf(hub), []);
  const draft = phone.recipes.find((r) => r.review);
  assert.equal(draft.title, '');
  assert.equal(draft.source.url, '');
  assert.deepEqual(phone.titles(), ['', 'Tacos']);
});

test('inbox: the made-up examples and unknown fields are still handled as before when a page arrives', async () => {
  const hub = fakeGitHub({ empty: false });
  hub.write('recipes/rfuture.json', JSON.stringify({ ...makeRecipe({ id: 'rfuture', title: 'From a newer app' }, tick()), nutrition: { calories: 320 } }, null, 2) + '\n', 'Newer app');
  const phone = device('Phone', hub);
  phone.add({ title: 'Example soup', example: true });
  save(hub);
  await phone.sync();
  assert.deepEqual(recipeFiles(hub).length, 2);
  assert.deepEqual(JSON.parse(hub.files().get('recipes/rfuture.json')).nutrition, { calories: 320 });
  assert.equal(phone.recipes.filter((r) => r.example).length, 1);
  assert.deepEqual(phone.titles(), ['From a newer app', 'Lentil soup']);
});

test('inbox: a page saved by an older Shortcut script is counted, so the person can be told', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  await phone.sync();
  save(hub, 'inbox/a.json', page());                                             // the first script wrote no version
  save(hub, 'inbox/b.json', page({ s: 1, title: 'Another | Maple Street Kitchen' }));
  save(hub, 'inbox/c.json', page({ s: SCRIPT_VERSION, title: 'Current | Maple Street Kitchen' }));
  save(hub, 'inbox/d.json', page({ s: 'nonsense', title: 'Odd | Maple Street Kitchen' }));
  const out = await phone.sync();
  assert.equal(out.added, 4);
  assert.equal(out.outdated, 3);
  // Nothing new in the inbox: nothing to say.
  const quiet = await phone.sync();
  assert.equal(quiet.added, 0);
  assert.equal(quiet.outdated, 0);
  // A page whose recipe already exists makes nothing, so it is not counted either.
  save(hub, 'inbox/a.json', page());
  const again = await phone.sync();
  assert.equal(again.added, 0);
  assert.equal(again.outdated, 0);
});

test('inbox: the groups a page showed arrive as heading lines in the recipe', async () => {
  const hub = fakeGitHub();
  const phone = device('Phone', hub);
  await phone.sync();
  save(hub, INBOX_FILE, page({ s: SCRIPT_VERSION, groups: [{ name: 'For the soup', items: ['1 cup lentils'] }, { name: 'To finish', items: ['1 onion, diced'] }] }));
  await phone.sync();
  const soup = phone.recipes.find((r) => r.title === 'Lentil soup');
  assert.deepEqual(soup.ingredients.map((i) => i.text), ['For the soup:', '1 cup lentils', 'To finish:', '1 onion, diced']);
  assert.deepEqual(JSON.parse(hub.files().get('recipes/' + soup.id + '.json')).ingredients.map((i) => !!i.heading), [true, false, true, false]);
});
