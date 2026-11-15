import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeGitHub } from './fake-github.js';
import { createClient, GitHubError } from '../js/sync/github.js';
import { syncLibrary } from '../js/sync/sync.js';
import { gitBlobSha } from '../js/sync/hash.js';
import { makeRecipe, starterFolders } from '../js/model.js';

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
      const out = await syncLibrary({ client: d.client, local: { recipes: d.recipes, folders: d.folders, deleted: d.deleted }, base: d.base, device: name });
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
