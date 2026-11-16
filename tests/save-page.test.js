import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { recipeFromCapture, SCRIPT_VERSION } from '../js/import/page.js';

// The script the Shortcut runs in Safari, tried here against a pretend page. Everything is made up.
const source = readFileSync(new URL('../shortcuts/save-page.js', import.meta.url), 'utf8');
const PAGE = 'https://www.maplestreetkitchen.example/recipes/lentil-soup';

/** A pretend element with just the parts the script uses. Its text is its own plus that of everything inside it. */
function el(tag, attrs = {}, kids = [], text = '') {
  const node = {
    tagName: tag.toUpperCase(), parentElement: null,
    get textContent() { return text + kids.map((k) => k.textContent).join(''); },
    get innerText() { return node.textContent; },
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
    children: kids,
    kids,
  };
  for (const k of kids) k.parentElement = node;
  return node;
}

/**
 * Runs the script on a pretend page and gives back the capture it hands to the Shortcut.
 * `body` is what is on the page, for the script to look through. `bold` says which elements the
 * page draws in bold, for a page that does it with styles instead of tags.
 */
function run({ ld = [], title = 'Lentil soup | Maple Street Kitchen', site = '', items = [], body = [], bold = null, url = PAGE, broken = false } = {}) {
  let handed;
  const scripts = [
    el('script', { type: 'text/javascript' }, [], 'var notData = "Recipe";'),
    ...ld.map((text) => el('script', { type: 'application/ld+json' }, [], text)),
  ];
  const page = el('html', {}, [el('body', {}, body)]);
  const byTag = (selector) => {
    const tags = selector.split(',').map((t) => t.trim().toUpperCase());
    const out = [];
    const walk = (n) => { for (const k of n.kids) { if (tags.includes(k.tagName)) out.push(k); walk(k); } };
    walk(page);
    return out;
  };
  const document = {
    title,
    querySelectorAll: (selector) => {
      if (broken) throw new Error('this page is odd');
      if (selector === 'script[type]') return scripts;
      if (selector === '[itemtype]') return items;
      assert.match(selector, /^[a-z0-9]+(, [a-z0-9]+)*$/, 'the script only ever asks for elements by their tags');
      return byTag(selector);
    },
    querySelector: () => (site ? el('meta', { property: 'og:site_name', content: site }) : null),
  };
  vm.runInNewContext(source, {
    document, location: { href: url },
    btoa: (text) => Buffer.from(text, 'latin1').toString('base64'),
    completion: (value) => { handed = value; },
    ...(bold ? { getComputedStyle: (e) => ({ fontWeight: bold(e) ? '700' : '400' }) } : {}),
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

test('page script: says which version of the script it is, and the app expects that version', () => {
  assert.equal(run({ ld: [soup()] }).capture.s, SCRIPT_VERSION);
  assert.equal(run({ broken: true }).capture.s, SCRIPT_VERSION);
});

// ---------- the groups a page's layout shows ----------

const li = (text) => el('li', {}, [], ' ' + text + ' ');
const h4 = (text, attrs = {}) => el('h4', attrs, [], text);
const BOWLS = ['2 chicken breasts', '1 tbsp soy sauce', 'Juice of ½ lemon', '2 cups cooked rice', '½ cucumber', '2 carrots', 'Juice of ½ lemon', 'Sesame seeds'];
// The page's data writes the halves as entities and pads its lines, as real pages do.
const bowlData = (lines = BOWLS) => JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Recipe', name: 'Chicken rice bowls',
  recipeIngredient: lines.map((l) => ' ' + l.replace(/½/g, '&frac12;')), recipeInstructions: ['Grill the chicken.', 'Fill the bowls.'],
});
const groupsOf = (capture) => (capture.groups || []).map((g) => [g.name, g.items.length]);
const linesOf = (capture) => recipeFromCapture(capture, '2026-03-01T12:00:00.000Z').recipe.ingredients.map((i) => i.text);
const GROUPED = [
  'For the chicken:', '2 chicken breasts', '1 tbsp soy sauce', 'Juice of ½ lemon',
  'For the bowls:', '2 cups cooked rice',
  'For the slaw:', '½ cucumber', '2 carrots', 'Juice of ½ lemon',
  'To finish:', 'Sesame seeds',
];

test('page script: headings that sit between the items of one list are the groups', () => {
  const body = [
    el('ul', { class: 'site-menu' }, [li('Recipes'), li('2 cups cooked rice')]),   // the same words, elsewhere on the page
    el('div', { class: 'recipe-ingredients' }, [
      el('h2', { class: 'column-heading' }, [], 'Ingredients'),
      el('ul', { id: 'ingredient-list' }, [
        h4('For the chicken', { class: 'group-heading' }), li(BOWLS[0]), li(BOWLS[1]), li(BOWLS[2]),
        h4('For the bowls'), li(BOWLS[3]),
        h4('For the slaw:'), li(BOWLS[4]), li(BOWLS[5]), li(BOWLS[6]),
        h4('To finish'), li(BOWLS[7]),
      ]),
      el('a', { href: '/cart' }, [], 'View cart (0)'),
    ]),
    el('ol', {}, [el('li', {}, [el('p', {}, [], 'Grill the chicken.')]), li('Fill the bowls.')]),
  ];
  const { capture } = run({ ld: [bowlData()], body });
  assert.deepEqual(groupsOf(capture), [['For the chicken', 3], ['For the bowls', 1], ['For the slaw', 3], ['To finish', 1]]);
  assert.deepEqual(capture.groups[2].items, ['&frac12; cucumber', '2 carrots', 'Juice of &frac12; lemon']);   // as the data wrote them
  assert.deepEqual(linesOf(capture), GROUPED);
});

test('page script: a heading before each separate list names that list, as the common recipe plug-ins do it', () => {
  // Each item is made of several pieces, and the page shows a note without the brackets the data has.
  const item = (...parts) => el('li', { class: 'recipe-ingredient' }, parts.map((part) => el('span', {}, [], part)));
  const data = JSON.stringify({ '@graph': [{ '@type': ['Recipe', 'NewsArticle'], name: 'Hand pies',
    recipeIngredient: ['2 cups flour (sifted)', '1 stick butter', '2 apples, diced', '1 tsp cinnamon', '1 egg'], recipeInstructions: ['Make the dough.', 'Fill and bake.'] }] });
  const body = [el('div', { class: 'recipe-ingredients-container' }, [
    el('h3', { class: 'recipe-header' }, [el('span', {}, [], 'Ingredients'), el('button', {}, [], '1x'), el('button', {}, [], '2x')]),
    el('div', { class: 'ingredient-group' }, [h4('Dough', { class: 'group-name' }), el('ul', {}, [item('2', ' cups', ' flour', ' sifted'), item('1', ' stick', ' butter')])]),
    el('div', { class: 'ingredient-group' }, [el('div', { class: 'name-row' }, [h4('Filling:')]), el('ul', {}, [item('2', ' apples,', ' diced'), item('1', ' tsp', ' cinnamon')])]),
    el('div', { class: 'ingredient-group' }, [el('p', { class: 'ingredient-group-title' }, [], 'To finish'), el('ul', {}, [item('1', ' egg')])]),
  ])];
  const { capture } = run({ ld: [data], body });
  assert.deepEqual(groupsOf(capture), [['Dough', 2], ['Filling', 2], ['To finish', 1]]);
  assert.deepEqual(linesOf(capture), ['Dough:', '2 cups flour (sifted)', '1 stick butter', 'Filling:', '2 apples, diced', '1 tsp cinnamon', 'To finish:', '1 egg']);
});

test('page script: a list item that is only a bold line is a heading, and lines above the first one have none', () => {
  const head = (tag, text) => el('li', {}, [el(tag, {}, [], text)]);
  const body = [el('ul', {}, [
    li(BOWLS[0]), li(BOWLS[1]),
    head('strong', 'For the bowls'), li(BOWLS[2]), li(BOWLS[3]),
    head('b', 'For the slaw:'), li(BOWLS[4]), li(BOWLS[5]), li(BOWLS[6]), li(BOWLS[7]),
  ])];
  const { capture } = run({ ld: [bowlData()], body });
  assert.deepEqual(groupsOf(capture), [['', 2], ['For the bowls', 2], ['For the slaw', 4]]);
  assert.deepEqual(linesOf(capture), [...BOWLS.slice(0, 2), 'For the bowls:', ...BOWLS.slice(2, 4), 'For the slaw:', ...BOWLS.slice(4)]);
});

test('page script: a page that draws its headings bold with styles, and has no lists, is read the same way', () => {
  const row = (text) => el('div', { class: 'row' }, [el('span', {}, [], text)]);
  const body = [el('section', {}, [
    el('p', { class: 'intro' }, [el('span', { id: 'bold-run' }, [], 'Tip'), el('span', {}, [], ' use ripe tomatoes for this one')]),
    el('p', { id: 'a' }, [], 'For the chicken'), row(BOWLS[0]), row(BOWLS[1]), row(BOWLS[2]), row(BOWLS[3]),
    el('p', { id: 'b' }, [], 'For the slaw'), row(BOWLS[4]), row(BOWLS[5]), row(BOWLS[6]), row(BOWLS[7]),
    el('p', { id: 'c' }, [], 'You might also like'),
  ])];
  const bold = (e) => ['a', 'b', 'c', 'bold-run'].includes(e.getAttribute('id'));
  const { capture } = run({ ld: [bowlData()], body, bold });
  assert.deepEqual(groupsOf(capture), [['For the chicken', 4], ['For the slaw', 4]]);
  // Without the styles nothing says those lines are headings, so there are no groups.
  assert.equal('groups' in run({ ld: [bowlData()], body }).capture, false);
});

test('page script: headings that say nothing about the ingredients are not groups', () => {
  const list = (...kids) => [el('div', { class: 'ingredients' }, kids)];
  const all = BOWLS.map(li);
  // Only "Ingredients", a serving size and a time above the list.
  const plain = list(el('h2', {}, [], 'Ingredients:'), el('p', {}, [el('strong', {}, [], 'Serves 4')]), el('p', {}, [el('b', {}, [], 'Total: 25 minutes')]), el('ul', {}, all));
  assert.equal('groups' in run({ ld: [bowlData()], body: plain }).capture, false);
  // One heading over everything says nothing about what belongs to what.
  const one = list(el('h3', {}, [], 'For the bowls'), el('ul', {}, BOWLS.map(li)));
  assert.equal('groups' in run({ ld: [bowlData()], body: one }).capture, false);
  // Bold words inside a longer line, a link, and a line too long to be a heading.
  const noise = list(el('ul', {}, [
    ...BOWLS.slice(0, 4).map(li),
    el('li', {}, [el('strong', {}, [], 'Note:'), el('span', {}, [], ' the slaw keeps for a week')]),
    el('li', {}, [el('a', { href: '/shop' }, [], 'Shop the slaw')]),
    el('li', {}, [el('strong', {}, [], 'This is a whole sentence about the slaw and how good it is, in bold')]),
    ...BOWLS.slice(4).map(li),
  ]));
  assert.equal('groups' in run({ ld: [bowlData()], body: noise }).capture, false);
});

test('page script: when too few of the ingredients can be found on the page, no groups are guessed', () => {
  const body = [el('ul', {}, [h4('For the chicken'), li(BOWLS[0]), li(BOWLS[1]), h4('For the slaw'), li(BOWLS[4]), li('something the data does not list')])];
  assert.equal('groups' in run({ ld: [bowlData()], body }).capture, false);
  // And a page with no recipe data has nothing to group.
  assert.equal('groups' in run({ body }).capture, false);
});

test('page script: an odd page cannot stop it while it looks for groups', () => {
  const trap = el('li', {}, [], BOWLS[0]);
  Object.defineProperty(trap, 'textContent', { get() { throw new Error('no text here'); } });
  const body = [el('ul', {}, [h4('For the chicken'), trap, ...BOWLS.slice(1).map(li)])];
  const { capture } = run({ ld: [bowlData()], body });
  assert.equal('groups' in capture, false);
  assert.equal(capture.ld.length, 1);
  assert.equal(recipeFromCapture(capture).recipe.ingredients.length, BOWLS.length);
});

test('page script: a recipe described only in the page\'s own markup gets its groups too', () => {
  const ing = (text) => el('li', { itemprop: 'recipeIngredient' }, [], text);
  const recipe = el('div', { itemscope: '', itemtype: 'https://schema.org/Recipe' }, [
    el('h2', { itemprop: 'name' }, [], 'Bean stew'),
    el('ul', {}, [h4('For the beans'), ing('1 can white beans'), ing('1 onion'), h4('To serve'), ing('Crusty bread'), ing('Olive oil')]),
    el('div', { itemprop: 'recipeInstructions' }, [], 'Simmer.\nServe.'),
  ]);
  const { capture } = run({ items: [recipe], body: [recipe], title: 'Bean stew' });
  assert.deepEqual(groupsOf(capture), [['For the beans', 2], ['To serve', 2]]);
  assert.deepEqual(linesOf(capture), ['For the beans:', '1 can white beans', '1 onion', 'To serve:', 'Crusty bread', 'Olive oil']);
});
