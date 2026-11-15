import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { recipeFromCapture } from '../js/import/page.js';

// The script the Shortcut runs in Safari, tried here against a pretend page. Everything is made up.
const source = readFileSync(new URL('../shortcuts/save-page.js', import.meta.url), 'utf8');
const PAGE = 'https://www.maplestreetkitchen.example/recipes/lentil-soup';

/** A pretend element with just the parts the script uses. */
function el(tag, attrs = {}, kids = [], text = '') {
  const node = {
    tagName: tag.toUpperCase(), parentElement: null, innerText: text, textContent: text,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    hasAttribute: (name) => name in attrs,
    querySelectorAll: (selector) => {
      assert.equal(selector, '[itemprop]');
      const out = [];
      const walk = (n) => { for (const k of n.kids) { if (k.hasAttribute('itemprop')) out.push(k); walk(k); } };
      walk(node);
      return out;
    },
    // Only the one lookup the script makes: the part of a recipe that holds its directions.
    querySelector: (selector) => {
      assert.match(selector, /directions/);
      let hit = null;
      const walk = (n) => { for (const k of n.kids) { if (!hit && /e-instructions|directions|instructions/.test(k.getAttribute('class') || '')) hit = k; walk(k); } };
      walk(node);
      return hit;
    },
    kids,
  };
  for (const k of kids) k.parentElement = node;
  return node;
}

/** Runs the script on a pretend page and gives back the capture it hands to the Shortcut. */
function run({ ld = [], title = 'Lentil soup | Maple Street Kitchen', site = '', items = [], url = PAGE, broken = false } = {}) {
  let handed;
  const scripts = [
    el('script', { type: 'text/javascript' }, [], 'var notData = "Recipe";'),
    ...ld.map((text) => el('script', { type: 'application/ld+json' }, [], text)),
  ];
  const document = {
    title,
    querySelectorAll: (selector) => {
      if (broken) throw new Error('this page is odd');
      return selector === 'script[type]' ? scripts : selector === '[itemtype]' ? items : [];
    },
    querySelector: () => (site ? el('meta', { property: 'og:site_name', content: site }) : null),
  };
  vm.runInNewContext(source, {
    document, location: { href: url },
    btoa: (text) => Buffer.from(text, 'latin1').toString('base64'),
    completion: (value) => { handed = value; },
  });
  assert.equal(typeof handed, 'string');
  assert.match(handed, /^[A-Za-z0-9+/]+=*$/);
  const json = Buffer.from(handed, 'base64').toString('latin1');
  for (const ch of json) assert.ok(ch >= ' ' && ch <= '~', 'the JSON is plain ASCII');
  return { capture: JSON.parse(json), size: handed.length };
}

const soup = (more = {}) => JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Recipe', name: 'Lentil soup',
  recipeIngredient: ['1 cup lentils', '1 onion, diced'], recipeInstructions: ['Simmer for 30 minutes.'], ...more,
});

test('page script: is plain ASCII, so pasting it into Shortcuts cannot change it', () => {
  for (const ch of source) assert.ok(ch === '\n' || (ch >= ' ' && ch <= '~'), 'unexpected character ' + ch.codePointAt(0));
});

test('page script: hands over the address, the title, the site and the recipe data', () => {
  const site = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Maple Street Kitchen' };
  const { capture } = run({ ld: [JSON.stringify(site), soup()], site: 'Maple Street Kitchen' });
  assert.equal(capture.v, 1);
  assert.equal(capture.url, PAGE);
  assert.equal(capture.title, 'Lentil soup | Maple Street Kitchen');
  assert.equal(capture.site, 'Maple Street Kitchen');
  assert.ok(!Number.isNaN(Date.parse(capture.at)));
  assert.deepEqual(capture.ld, [soup(), JSON.stringify(site)]);   // the recipe first
  const { recipe, found } = recipeFromCapture(capture, '2026-03-01T12:00:00.000Z');
  assert.equal(found, true);
  assert.equal(recipe.title, 'Lentil soup');
  assert.equal(recipe.source.name, 'Maple Street Kitchen');
  assert.equal(recipe.ingredients.length, 2);
});

test('page script: letters outside plain English survive the trip', () => {
  const name = 'Crème brûlée – ½ batch 🍮';
  const { capture } = run({ ld: [soup({ name })], title: name });
  assert.equal(capture.title, name);
  assert.equal(recipeFromCapture(capture).recipe.title, name);
});

test('page script: a page with nothing on it still gives its address and title', () => {
  const { capture } = run({ title: 'About us' });
  assert.deepEqual(capture.ld, []);
  assert.equal(capture.url, PAGE);
  assert.equal(capture.title, 'About us');
  assert.equal(recipeFromCapture(capture).found, false);
});

test('page script: an odd page cannot stop it; the address and title still get through', () => {
  const { capture } = run({ broken: true, title: 'Lentil soup' });
  assert.equal(capture.url, PAGE);
  assert.equal(capture.title, 'Lentil soup');
  assert.deepEqual(capture.ld, []);
});

test('page script: stays small enough to upload in one go, keeping the recipe before anything else', () => {
  const filler = (n) => JSON.stringify({ '@type': 'WebPage', text: 'x'.repeat(n) });
  const hugeRecipe = soup({ description: 'y'.repeat(800000) });
  const { capture, size } = run({ ld: [filler(60000), filler(60000), hugeRecipe, soup()] });
  assert.deepEqual(capture.ld, [soup(), filler(60000)]);   // the oversized block and the second filler are left out
  assert.ok(size < 1000000);
});

test('page script: a recipe described in the page\'s own markup is turned into the same kind of data', () => {
  const recipe = el('div', { itemscope: '', itemtype: 'https://schema.org/Recipe' }, [
    el('h2', { itemprop: 'name' }, [], 'Lentil soup'),
    el('span', { itemprop: 'author', itemscope: '', itemtype: 'https://schema.org/Person' }, [el('span', { itemprop: 'name' }, [], 'Somebody Else')]),
    el('meta', { itemprop: 'totalTime', content: 'PT45M' }),
    el('time', { itemprop: 'prepTime', datetime: 'PT10M' }, [], '10 minutes'),
    el('span', { itemprop: 'recipeYield' }, [], '4 servings'),
    el('ul', {}, [
      el('li', { itemprop: 'recipeIngredient' }, [], '1 cup lentils'),
      el('li', { itemprop: 'ingredients' }, [], '1 onion, diced'),
    ]),
    el('div', { itemprop: 'recipeInstructions' }, [], 'Cook the onion.\nAdd the lentils and simmer for 30 minutes.'),
    el('div', { itemprop: 'aggregateRating', itemscope: '' }, [el('span', { itemprop: 'ratingValue' }, [], '5')]),
  ]);
  const thin = el('div', { itemscope: '', itemtype: 'http://schema.org/Recipe' }, [el('a', { itemprop: 'name' }, [], 'Another recipe')]);
  const other = el('div', { itemscope: '', itemtype: 'https://schema.org/Person' }, [el('span', { itemprop: 'name' }, [], 'Not a recipe')]);
  // A block that only mentions the word, as a list of "Recipes" would, must not hide the markup.
  const crumbs = JSON.stringify({ '@type': 'BreadcrumbList', name: 'Recipes' });
  const { capture } = run({ ld: [crumbs], items: [other, thin, recipe] });
  assert.equal(capture.ld.length, 2);
  const { recipe: read, found } = recipeFromCapture(capture, '2026-03-01T12:00:00.000Z');
  assert.equal(found, true);
  assert.equal(read.title, 'Lentil soup');
  assert.deepEqual(read.ingredients.map((i) => i.text), ['1 cup lentils', '1 onion, diced']);
  assert.deepEqual(read.steps.map((s) => s.text), ['Cook the onion.', 'Add the lentils and simmer for 30 minutes.']);
  assert.equal(read.minutes, 45);
  assert.equal(read.serves, '4');
});

test('page script: markup is not read when the page already has real recipe data', () => {
  const recipe = el('div', { itemscope: '', itemtype: 'https://schema.org/Recipe' }, [el('h2', { itemprop: 'name' }, [], 'From the markup')]);
  const { capture } = run({ ld: [soup()], items: [recipe] });
  assert.deepEqual(capture.ld, [soup()]);
});

test('page script: when the markup leaves the steps out, the part named for the directions is read', () => {
  const recipe = el('div', { itemscope: '', itemtype: 'https://schema.org/Recipe', class: 'h-recipe' }, [
    el('h3', { itemprop: 'name' }, [], 'Skillet beans'),
    el('ul', {}, [el('li', { itemprop: 'recipeIngredient' }, [], '1 can white beans')]),
    el('div', { class: 'recipe-directions e-instructions' }, [], 'Directions\n\nWarm the beans in a skillet.\nSeason and serve.'),
  ]);
  const { capture } = run({ items: [recipe], title: 'Skillet beans' });
  const { recipe: read, found } = recipeFromCapture(capture);
  assert.equal(found, true);
  assert.deepEqual(read.steps.map((s) => s.text), ['Warm the beans in a skillet.', 'Season and serve.']);
});
