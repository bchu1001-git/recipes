import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIngredient, amountLabel, itemLabel, findTimers, parseDuration, formatMinutes, makeRecipe,
  matchesQuery, matchesFilters, starterFolders, newFolderId, initials, sortRecipes, splitLines, slug,
  webLink, keptRecipes, waitingRecipes, reviewNotes,
} from '../js/model.js';

const ing = (line) => {
  const { qty, unit, item, note } = parseIngredient(line);
  return { qty, unit, item, note };
};

test('ingredient: mixed number, unit, item and note', () => {
  assert.deepEqual(ing('1 1/2 cups chicken broth, warmed'), { qty: '1 1/2', unit: 'cups', item: 'chicken broth', note: 'warmed' });
});

test('ingredient: unicode fraction', () => {
  assert.deepEqual(ing('½ tsp salt'), { qty: '½', unit: 'tsp', item: 'salt', note: '' });
  assert.deepEqual(ing('1½ cups flour'), { qty: '1½', unit: 'cups', item: 'flour', note: '' });
});

test('ingredient: count with no unit', () => {
  assert.deepEqual(ing('2 carrots, sliced'), { qty: '2', unit: '', item: 'carrots', note: 'sliced' });
});

test('ingredient: ranges', () => {
  assert.deepEqual(ing('2-3 tbsp olive oil'), { qty: '2-3', unit: 'tbsp', item: 'olive oil', note: '' });
  assert.deepEqual(ing('2 to 3 cloves garlic, minced'), { qty: '2 to 3', unit: 'cloves', item: 'garlic', note: 'minced' });
});

test('ingredient: a size in brackets is not mistaken for a unit, and its comma is left alone', () => {
  assert.deepEqual(ing('1 (15 oz) can black beans, drained'), { qty: '1', unit: '', item: '(15 oz) can black beans', note: 'drained' });
  assert.deepEqual(ing('1 onion (yellow, large), diced'), { qty: '1', unit: '', item: 'onion (yellow, large)', note: 'diced' });
});

test('ingredient: no amount at all', () => {
  assert.deepEqual(ing('Salt and pepper, to taste'), { qty: '', unit: '', item: 'Salt and pepper', note: 'to taste' });
});

test('ingredient: a pinch of', () => {
  assert.deepEqual(ing('a pinch of nutmeg'), { qty: 'a', unit: 'pinch', item: 'nutmeg', note: '' });
});

test('ingredient: bullets, "of" and trailing periods are dropped', () => {
  assert.deepEqual(ing('- 8 oz egg noodles'), { qty: '8', unit: 'oz', item: 'egg noodles', note: '' });
  assert.deepEqual(ing('1 cup of milk'), { qty: '1', unit: 'cup', item: 'milk', note: '' });
  assert.deepEqual(ing('2 tbsp. butter'), { qty: '2', unit: 'tbsp', item: 'butter', note: '' });
});

test('ingredient: a word that only starts like a unit stays in the item', () => {
  assert.deepEqual(ing('2 large eggs'), { qty: '2', unit: '', item: 'large eggs', note: '' });
  assert.deepEqual(ing('1 lemon, juiced'), { qty: '1', unit: '', item: 'lemon', note: 'juiced' });
});

test('ingredient: the line as written is kept', () => {
  assert.equal(parseIngredient('  1 1/2 cups   chicken broth ').text, '1 1/2 cups chicken broth');
});

test('ingredient: labels for the two columns', () => {
  const i = parseIngredient('1 1/2 cups chicken broth, warmed');
  assert.equal(amountLabel(i), '1 1/2 cups');
  assert.equal(itemLabel(i), 'chicken broth, warmed');
});

test('timers: minutes and hours found in a step', () => {
  assert.deepEqual(findTimers('Bring to a boil, then simmer for 20 minutes.'), [20]);
  assert.deepEqual(findTimers('Bake 1 hour, rest 10 min, then chill 1.5 hours'), [60, 10, 90]);
  assert.deepEqual(findTimers('Cook 5 to 7 minutes until soft'), [5]);
  assert.deepEqual(findTimers('Heat the oven to 350 degrees.'), []);
});

test('duration: the forms someone might type', () => {
  assert.equal(parseDuration('45'), 45);
  assert.equal(parseDuration('45 min'), 45);
  assert.equal(parseDuration('1 hr 15 min'), 75);
  assert.equal(parseDuration('1.5 hours'), 90);
  assert.equal(parseDuration('1:30'), 90);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('a while'), null);
});

test('duration: shown back in plain words', () => {
  assert.equal(formatMinutes(45), '45 min');
  assert.equal(formatMinutes(60), '1 hr');
  assert.equal(formatMinutes(75), '1 hr 15 min');
  assert.equal(formatMinutes(null), '');
});

test('makeRecipe: builds a full recipe from plain lines', () => {
  const r = makeRecipe({
    title: '  Chicken   noodle soup ',
    minutes: '45 min',
    ingredients: ['1 tbsp olive oil', '', '2 carrots, sliced'],
    steps: ['Simmer for 20 minutes.', '   '],
    folders: ['ingredient:chicken', 'ingredient:chicken', 'dish:soups-stews'],
    rating: 9,
  }, '2026-01-01T00:00:00.000Z');
  assert.equal(r.title, 'Chicken noodle soup');
  assert.equal(r.minutes, 45);
  assert.equal(r.ingredients.length, 2);
  assert.equal(r.ingredients[1].item, 'carrots');
  assert.deepEqual(r.steps, [{ text: 'Simmer for 20 minutes.', timers: [20] }]);
  assert.deepEqual(r.folders, ['ingredient:chicken', 'dish:soups-stews']);
  assert.equal(r.rating, 5);
  assert.equal(r.goto, false);
  assert.equal(r.created, '2026-01-01T00:00:00.000Z');
  assert.match(r.id, /^r[a-z0-9]+$/);
});

test('makeRecipe: editing keeps the id and the created date', () => {
  const first = makeRecipe({ title: 'Ranch' }, '2026-01-01T00:00:00.000Z');
  const second = makeRecipe({ ...first, title: 'Homemade ranch' }, '2026-02-01T00:00:00.000Z');
  assert.equal(second.id, first.id);
  assert.equal(second.created, '2026-01-01T00:00:00.000Z');
  assert.equal(second.updated, '2026-02-01T00:00:00.000Z');
});

const soup = makeRecipe({ title: 'Chicken noodle soup', source: { name: 'Sunday Suppers' }, ingredients: ['2 tbsp fresh dill'], folders: ['ingredient:chicken', 'dish:soups-stews', 'meal:dinner'] });
const tacos = makeRecipe({ title: 'Black bean tacos', folders: ['ingredient:vegetarian', 'meal:dinner'] });
const stew = makeRecipe({ title: 'Beef and barley stew', folders: ['ingredient:beef', 'dish:soups-stews'] });

test('search: every word must appear somewhere', () => {
  assert.equal(matchesQuery(soup, 'chicken dill'), true);
  assert.equal(matchesQuery(soup, 'sunday'), true);
  assert.equal(matchesQuery(soup, 'chicken beef'), false);
  assert.equal(matchesQuery(soup, '   '), true);
});

test('filters: folders in different groups narrow the list', () => {
  const sel = new Set(['ingredient:chicken', 'dish:soups-stews']);
  assert.equal(matchesFilters(soup, sel), true);
  assert.equal(matchesFilters(stew, sel), false);
  assert.equal(matchesFilters(tacos, sel), false);
});

test('filters: folders in the same group widen the list', () => {
  const sel = new Set(['ingredient:chicken', 'ingredient:beef']);
  assert.equal(matchesFilters(soup, sel), true);
  assert.equal(matchesFilters(stew, sel), true);
  assert.equal(matchesFilters(tacos, sel), false);
  assert.equal(matchesFilters(tacos, new Set()), true);
});

test('folders: the starter set has Sauces & dressings under Dish', () => {
  const dish = starterFolders().groups.find((g) => g.id === 'dish');
  assert.ok(dish.folders.some((f) => f.id === 'dish:sauces-dressings' && f.name === 'Sauces & dressings'));
});

test('folders: a new folder gets an id that is not taken', () => {
  const dish = starterFolders().groups.find((g) => g.id === 'dish');
  assert.equal(newFolderId(dish, 'Dips'), 'dish:dips');
  assert.equal(newFolderId(dish, 'Salads'), 'dish:salads-2');
});

test('small helpers', () => {
  assert.equal(slug("Company's coming"), 'company-s-coming');
  assert.equal(initials('chicken noodle soup'), 'Ch');
  assert.equal(initials(''), '?');
  assert.deepEqual(splitLines('a\n\n b \r\nc'), ['a', 'b', 'c']);
  assert.deepEqual(sortRecipes([tacos, soup, stew]).map((r) => r.title), ['Beef and barley stew', 'Black bean tacos', 'Chicken noodle soup']);
});

test('links: only an ordinary web address may be used as a link', () => {
  assert.equal(webLink('https://www.maplestreetkitchen.example/soup'), 'https://www.maplestreetkitchen.example/soup');
  assert.equal(webLink('  http://example.org/a?b=1  '), 'http://example.org/a?b=1');
  for (const no of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.org', 'example.org', 'https://exa mple.org', '', null, undefined, 7]) {
    assert.equal(webLink(no), '');
  }
});

test('review: waiting recipes are kept apart from the others, newest first', () => {
  const made = (title, created, review) => ({ ...makeRecipe({ title, review }, created) });
  const all = [made('Kept', '2026-01-01T00:00:00.000Z', false), made('Older', '2026-01-02T00:00:00.000Z', true), made('Newer', '2026-01-03T00:00:00.000Z', true)];
  assert.deepEqual(keptRecipes(all).map((r) => r.title), ['Kept']);
  assert.deepEqual(waitingRecipes(all).map((r) => r.title), ['Newer', 'Older']);
  assert.deepEqual(waitingRecipes(new Map(all.map((r) => [r.id, r])).values()).length, 2);
});

test('review: says in plain words what is missing from a recipe that was read from a page', () => {
  const full = makeRecipe({ title: 'Lentil soup', ingredients: ['1 cup lentils'], steps: ['Simmer.', 'Serve.'] });
  assert.deepEqual(reviewNotes(full), []);
  assert.deepEqual(reviewNotes(makeRecipe({ title: 'Lentil soup', steps: ['Simmer.'] })), ['No ingredients were found.']);
  assert.deepEqual(reviewNotes(makeRecipe({ title: 'Lentil soup', ingredients: ['1 cup lentils'] })), ['No steps were found.']);
  const block = makeRecipe({ title: 'Lentil soup', ingredients: ['1 cup lentils'], steps: ['Stir. '.repeat(90)] });
  assert.match(reviewNotes(block)[0], /one block of text/);
  const empty = reviewNotes(makeRecipe({ title: '' }));
  assert.equal(empty.length, 2);
  assert.match(empty[0], /No recipe was found on the page/);
  assert.equal(empty[1], 'No title was found.');
});
