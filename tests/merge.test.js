import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeLibraries, mergeFolders, serializeRecipe, recipePath, recipeIdOf, EPOCH } from '../js/sync/merge.js';
import { makeRecipe, starterFolders } from '../js/model.js';

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-02-01T00:00:00.000Z';
const T3 = '2026-03-01T00:00:00.000Z';

const recipe = (id, title, updated) => ({ ...makeRecipe({ id, title }, updated), updated });
const lib = (recipes = [], deleted = {}, folders = null) => ({
  recipes: new Map(recipes.map((r) => [r.id, r])), deleted, folders: folders || { groups: [], updated: EPOCH, deleted: {} },
});
const titles = (merged) => [...merged.recipes.values()].map((r) => r.title).sort();

test('merge: recipes from both sides are kept', () => {
  const merged = mergeLibraries(lib([recipe('a', 'Soup', T1)]), lib([recipe('b', 'Tacos', T1)]));
  assert.deepEqual(titles(merged), ['Soup', 'Tacos']);
});

test('merge: the newer copy of the same recipe wins, whichever side it is on', () => {
  const older = recipe('a', 'Soup', T1);
  const newer = recipe('a', 'Chicken soup', T2);
  assert.deepEqual(titles(mergeLibraries(lib([older]), lib([newer]))), ['Chicken soup']);
  assert.deepEqual(titles(mergeLibraries(lib([newer]), lib([older]))), ['Chicken soup']);
});

test('merge: a deletion carries over to the other side', () => {
  const merged = mergeLibraries(lib([], { a: T2 }), lib([recipe('a', 'Soup', T1)]));
  assert.deepEqual(titles(merged), []);
  assert.equal(merged.deleted.a, T2);
});

test('merge: editing a recipe after it was deleted elsewhere brings it back', () => {
  const merged = mergeLibraries(lib([recipe('a', 'Soup, improved', T3)]), lib([], { a: T2 }));
  assert.deepEqual(titles(merged), ['Soup, improved']);
  assert.equal('a' in merged.deleted, false);
});

test('merge: deletions known to only one side are remembered', () => {
  const merged = mergeLibraries(lib([], { a: T1 }), lib([], { b: T2 }));
  assert.deepEqual(merged.deleted, { a: T1, b: T2 });
});

test('merge: a real clash is reported so the losing copy can be kept', () => {
  const mine = recipe('a', 'Soup with dill', T2);
  const theirs = recipe('a', 'Soup with thyme', T3);
  const path = recipePath('a');
  const merged = mergeLibraries(lib([mine]), lib([theirs]), { [path]: 'base' },
    { mine: new Map([[path, 'mine']]), theirs: new Map([[path, 'theirs']]) });
  assert.deepEqual(titles(merged), ['Soup with thyme']);
  assert.deepEqual(merged.clashes.map((r) => r.title), ['Soup with dill']);
});

test('merge: being behind is not a clash', () => {
  const mine = recipe('a', 'Soup', T1);
  const theirs = recipe('a', 'Soup with thyme', T3);
  const path = recipePath('a');
  const merged = mergeLibraries(lib([mine]), lib([theirs]), { [path]: 'base' },
    { mine: new Map([[path, 'base']]), theirs: new Map([[path, 'theirs']]) });
  assert.deepEqual(merged.clashes, []);
});

test('merge: a file removed by hand on GitHub is removed here too, unless it changed here since', () => {
  const path = recipePath('a');
  const untouched = mergeLibraries(lib([recipe('a', 'Soup', T1)]), lib([]), { [path]: 'h1' },
    { mine: new Map([[path, 'h1']]), theirs: new Map() });
  assert.deepEqual(titles(untouched), []);
  assert.ok(untouched.deleted.a);
  const edited = mergeLibraries(lib([recipe('a', 'Soup, edited', T2)]), lib([]), { [path]: 'h1' },
    { mine: new Map([[path, 'h2']]), theirs: new Map() });
  assert.deepEqual(titles(edited), ['Soup, edited']);
});

test('merge: a recipe never synced before is new, not deleted', () => {
  const merged = mergeLibraries(lib([recipe('a', 'Soup', T1)]), lib([]), {}, { mine: new Map(), theirs: new Map() });
  assert.deepEqual(titles(merged), ['Soup']);
});

const withFolders = (names, updated, deleted = {}) => ({
  groups: [{ id: 'dish', name: 'Dish', folders: names.map((n) => ({ id: 'dish:' + n.toLowerCase(), name: n })) }], updated, deleted,
});
const dishNames = (f) => f.groups.find((g) => g.id === 'dish').folders.map((x) => x.name);

test('folders: additions on both sides are kept', () => {
  const merged = mergeFolders(withFolders(['Soups', 'Dips'], T2), withFolders(['Soups', 'Salads'], T1));
  assert.deepEqual(dishNames(merged), ['Soups', 'Dips', 'Salads']);
  assert.equal(merged.updated, T2);
});

test('folders: a rename on the newer side wins', () => {
  const mine = { groups: [{ id: 'dish', name: 'Dish', folders: [{ id: 'dish:soups', name: 'Soups & stews' }] }], updated: T2, deleted: {} };
  const theirs = { groups: [{ id: 'dish', name: 'Dish', folders: [{ id: 'dish:soups', name: 'Soups' }] }], updated: T1, deleted: {} };
  assert.deepEqual(dishNames(mergeFolders(mine, theirs)), ['Soups & stews']);
  assert.deepEqual(dishNames(mergeFolders(theirs, mine)), ['Soups & stews']);
});

test('folders: a deletion carries over to a side that has not seen it', () => {
  const merged = mergeFolders(withFolders(['Soups'], T2, { 'dish:dips': T2 }), withFolders(['Soups', 'Dips'], T1));
  assert.deepEqual(dishNames(merged), ['Soups']);
  assert.equal(merged.deleted['dish:dips'], T2);
});

test('folders: a folder added again after being deleted comes back', () => {
  const merged = mergeFolders(withFolders(['Soups'], T2, { 'dish:dips': T2 }), withFolders(['Soups', 'Dips'], T3));
  assert.deepEqual(dishNames(merged), ['Soups', 'Dips']);
  assert.equal('dish:dips' in merged.deleted, false);
});

test('folders: a new device with untouched starter folders takes the library\'s folders', () => {
  const starter = starterFolders();
  const library = withFolders(['Soups'], T1);
  const merged = mergeFolders(starter, library);
  assert.equal(merged.groups[0].id, 'dish');
  assert.deepEqual(dishNames(merged).slice(0, 1), ['Soups']);
});

test('files: a recipe is written with its fields in a fixed order, and unknown fields survive', () => {
  const r = { ...recipe('a', 'Soup', T1), futureField: 'kept', example: true };
  const text = serializeRecipe(r);
  const keys = Object.keys(JSON.parse(text));
  assert.deepEqual(keys.slice(0, 3), ['id', 'v', 'title']);
  assert.equal(keys.at(-1), 'futureField');
  assert.equal(keys.includes('example'), false);
  assert.equal(text, serializeRecipe(JSON.parse(text)));
  assert.equal(text.endsWith('\n'), true);
});

test('files: paths and ids convert both ways', () => {
  assert.equal(recipePath('abc'), 'recipes/abc.json');
  assert.equal(recipeIdOf('recipes/abc.json'), 'abc');
  assert.equal(recipeIdOf('folders.json'), null);
  assert.equal(recipeIdOf('recipes/sub/abc.json'), null);
});
