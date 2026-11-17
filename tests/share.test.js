import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentRecipe, pack, unpack, shareLink, recipeData, LINK_LONG } from '../js/share.js';
import { recipeFromCapture } from '../js/import/page.js';
import { makeRecipe } from '../js/model.js';
import { returnAddress } from '../js/kitchen.js';

// Every recipe, site and address here is made up.
const NOW = '2026-03-01T12:00:00.000Z';

const bowl = () => makeRecipe({
  title: 'Smoky bean bowl “for two” 🌶️',
  source: { kind: 'web', name: 'Maple Street Kitchen', url: 'https://www.maplestreetkitchen.example/recipes/bean-bowl' },
  minutes: 45,
  serves: '2',
  ingredients: ['For the beans:', '1 can black beans', '½ tsp smoked paprika', 'For the rice:', '1 cup rice', 'Juice of 1 lime — plus zest'],
  steps: ['For the beans:', 'Fry the onion for 5 minutes.', 'Add the beans & simmer “gently” for 10 minutes.', 'For the rice:', 'Rinse, then cook for 15 minutes.'],
  notes: { mine: 'Double the paprika.\nGood cold the next day.', source: 'Keeps for 3 days.' },
  folders: ['dish:bowls'],
  goto: true,
  rating: 4,
  photo: 'photos/x.jpg',
}, NOW);

test('sending: what travels is the recipe and nothing about how it is filed', () => {
  const data = sentRecipe(bowl());
  assert.equal(data.t, 'Smoky bean bowl “for two” 🌶️');
  assert.deepEqual(data.i, ['For the beans:', '1 can black beans', '½ tsp smoked paprika', 'For the rice:', '1 cup rice', 'Juice of 1 lime — plus zest']);
  assert.equal(data.s.length, 5);
  assert.equal(data.m, 45);
  assert.equal(data.y, '2');
  assert.deepEqual(data.f, { n: 'Maple Street Kitchen', u: 'https://www.maplestreetkitchen.example/recipes/bean-bowl' });
  assert.equal(data.n, 'Keeps for 3 days.\n\nDouble the paprika.\nGood cold the next day.');
  const text = JSON.stringify(data);
  for (const left of ['dish:bowls', 'photos/x.jpg', 'rating', 'goto', 'folders']) assert.ok(!text.includes(left), left + ' should not travel');
});

test('sending: the person\'s own notes stay behind when asked', () => {
  assert.equal(sentRecipe(bowl(), { myNotes: false }).n, 'Keeps for 3 days.');
  const plain = makeRecipe({ title: 'Toast', steps: ['Toast the bread.'], notes: { mine: 'Mine only' } }, NOW);
  assert.equal(sentRecipe(plain, { myNotes: false }).n, '');
});

test('sending: a recipe with nothing in it gives nothing to send, and an unsafe link is dropped', () => {
  assert.equal(sentRecipe(makeRecipe({}, NOW)), null);
  assert.equal(sentRecipe(null), null);
  const odd = makeRecipe({ title: 'Soup', source: { name: 'A friend', url: 'javascript:alert(1)' } }, NOW);
  assert.deepEqual(sentRecipe(odd).f, { n: 'A friend', u: '' });
});

test('link: a recipe packed and unpacked comes back the same, headings, odd characters and emoji included', async () => {
  const data = sentRecipe(bowl());
  const packed = await pack(data);
  assert.match(packed, /^z\.[A-Za-z0-9_-]+$/);
  const out = await unpack(packed);
  assert.equal(out.ok, true);
  assert.deepEqual(out.data, data);
});

test('link: the plain form, for a browser that cannot squeeze, unpacks the same', async () => {
  const data = sentRecipe(bowl());
  const packed = await pack(data, { squeezed: false });
  assert.match(packed, /^j\.[A-Za-z0-9_-]+$/);
  assert.deepEqual((await unpack(packed)).data, data);
  // A tiny recipe is not made longer by squeezing it.
  const tiny = await pack(sentRecipe(makeRecipe({ title: 'Tea' }, NOW)));
  assert.deepEqual((await unpack(tiny)).data.t, 'Tea');
});

test('link: it is short enough to send, and is the app\'s address plus the packed recipe', async () => {
  const packed = await pack(sentRecipe(bowl()));
  const link = shareLink('https://someone.example/recipes/', packed);
  assert.equal(link, 'https://someone.example/recipes/#/s/' + packed);
  assert.ok(link.length < 1200, 'a usual recipe gives a link of about ' + link.length + ' characters');
  assert.ok(link.length < LINK_LONG);
  assert.equal(shareLink('https://someone.example/recipes/index.html?x=1#/r/abc', 'j.e30'), 'https://someone.example/recipes/#/s/j.e30');
});

test('link: one that was cut short or changed fails politely and never throws', async () => {
  const packed = await pack(sentRecipe(bowl()));
  const plain = await pack(sentRecipe(bowl()), { squeezed: false });
  const swapped = packed.slice(0, 40) + (packed[40] === 'A' ? 'B' : 'A') + packed.slice(41);
  const broken = [
    packed.slice(0, packed.length - 20), packed.slice(0, 12), swapped, plain.slice(0, plain.length - 9),
    '', 'z.', 'j.', 'x.abc', 'z.!!!!', 'not a link at all', null, undefined, 42, {}, 'z.' + 'A'.repeat(500000),
    'j.' + Buffer.from('not json').toString('base64url'),
    'j.' + Buffer.from('[1,2,3]').toString('base64url'),
    'j.' + Buffer.from('{"v":1}').toString('base64url'),
    'j.' + Buffer.from('{"t":"No version"}').toString('base64url'),
  ];
  for (const bad of broken) {
    const out = await unpack(bad);
    assert.equal(out.ok, false, 'should not open: ' + String(bad).slice(0, 30));
    assert.equal(typeof out.reason, 'string');
    assert.ok(out.reason.length > 10);
  }
  const newer = await unpack('j.' + Buffer.from('{"v":2,"t":"From the future"}').toString('base64url'));
  assert.equal(newer.ok, false);
  assert.match(newer.reason, /newer version/);
});

test('link: whatever is inside is only ever kept as text, in the right shape and within limits', async () => {
  const hostile = {
    v: 1,
    t: '<img src=x onerror=alert(1)>',
    i: ['<script>alert(1)</script>', 7, null, { text: 'x' }, 'x'.repeat(5000)],
    s: 'not a list',
    m: 'soon',
    y: ['4'],
    n: 12,
    f: { n: '<b>Site</b>', u: 'javascript:alert(1)' },
    extra: { anything: true },
  };
  const out = await unpack('j.' + Buffer.from(JSON.stringify(hostile)).toString('base64url'));
  assert.equal(out.ok, true);
  assert.deepEqual(Object.keys(out.data).sort(), ['f', 'i', 'm', 'n', 's', 't', 'v', 'y']);
  assert.equal(out.data.t, '<img src=x onerror=alert(1)>');           // kept as the text it is; the page shows it as text
  assert.equal(out.data.i.length, 2);
  assert.equal(out.data.i[1].length, 3000);
  assert.deepEqual(out.data.s, []);
  assert.equal(out.data.m, 0);
  assert.equal(out.data.y, '');
  assert.equal(out.data.n, '');
  assert.deepEqual(out.data.f, { n: '<b>Site</b>', u: '' });
  const many = await unpack('j.' + Buffer.from(JSON.stringify({ v: 1, t: 'Many', i: Array.from({ length: 900 }, (_, k) => 'line ' + k) })).toString('base64url'));
  assert.equal(many.data.i.length, 300);
});

test('keeping: the page\'s recipe data goes through the reader with headings, notes and the first source intact', async () => {
  const data = (await unpack(await pack(sentRecipe(bowl())))).data;
  const block = recipeData(data);
  assert.equal(block['@type'], 'Recipe');
  assert.equal(block.totalTime, 'PT45M');
  // As the Save to Recipes Shortcut saves it: the page's own address is the long link it was sent in.
  const capture = { v: 1, s: 2, url: 'https://someone.example/recipes/#/s/' + 'z.abc', title: data.t, ld: [JSON.stringify(block)] };
  const { recipe, found, problems } = recipeFromCapture(capture, NOW);
  assert.equal(found, true);
  assert.deepEqual(problems, []);
  assert.equal(recipe.title, 'Smoky bean bowl “for two” 🌶️');
  assert.equal(recipe.review, true);
  assert.deepEqual(recipe.source, { kind: 'shared', name: 'Maple Street Kitchen', url: 'https://www.maplestreetkitchen.example/recipes/bean-bowl' });
  assert.deepEqual(recipe.ingredients.map((x) => x.text), data.i);
  assert.deepEqual(recipe.ingredients.filter((x) => x.heading).map((x) => x.text), ['For the beans:', 'For the rice:']);
  assert.deepEqual(recipe.steps.map((x) => x.text), ['For the beans:', 'Fry the onion for 5 minutes.', 'Add the beans & simmer “gently” for 10 minutes.', 'For the rice:', 'Rinse, then cook for 15 minutes.']);
  assert.deepEqual(recipe.steps.filter((x) => x.heading).map((x) => x.text), ['For the beans:', 'For the rice:']);
  assert.equal(recipe.minutes, 45);
  assert.equal(recipe.serves, '2');
  assert.equal(recipe.notes.source, 'Keeps for 3 days.\nDouble the paprika.\nGood cold the next day.');
  assert.equal(recipe.notes.mine, '');
});

test('keeping: a sent recipe with no first source has no link, never the link it was sent in', async () => {
  const mine = makeRecipe({ title: 'Family stew', ingredients: ['2 carrots'], steps: ['Simmer for 1 hour.'] }, NOW);
  const data = sentRecipe(mine);
  const capture = { v: 1, s: 2, url: 'https://someone.example/recipes/#/s/z.abc', title: 'Family stew', ld: [JSON.stringify(recipeData(data))] };
  const { recipe } = recipeFromCapture(capture, NOW);
  assert.deepEqual(recipe.source, { kind: 'shared', name: '', url: '' });
  assert.equal(recipe.notes.source, '');
});

test('keeping: the page layout\'s groups are not added on top of headings the data already has', () => {
  const block = recipeData(sentRecipe(bowl()));
  const groups = [{ name: 'For the beans', items: ['1 can black beans', '½ tsp smoked paprika'] }, { name: 'For the rice', items: ['1 cup rice', 'Juice of 1 lime — plus zest'] }];
  const { recipe } = recipeFromCapture({ v: 1, s: 2, url: 'https://someone.example/recipes/#/s/z.abc', title: 'x', ld: [JSON.stringify(block)], groups }, NOW);
  assert.deepEqual(recipe.ingredients.map((x) => x.text), ['For the beans:', '1 can black beans', '½ tsp smoked paprika', 'For the rice:', '1 cup rice', 'Juice of 1 lime — plus zest']);
});

test('keeping: an ordinary recipe page is still credited to the page it was saved from', () => {
  const page = 'https://www.maplestreetkitchen.example/recipes/bean-bowl';
  const block = { '@context': 'https://schema.org', '@type': 'Recipe', name: 'Bean bowl', recipeIngredient: ['1 can beans'], recipeInstructions: ['Warm the beans.'], publisher: { name: 'Maple Street Kitchen' } };
  const { recipe } = recipeFromCapture({ v: 1, s: 2, url: page, title: 'Bean bowl', ld: [JSON.stringify(block)] }, NOW);
  assert.deepEqual(recipe.source, { kind: 'web', name: 'Maple Street Kitchen', url: page });
});

test('timers: the address that brings the Home Screen app back is webapp:// and where the app is served', () => {
  assert.equal(returnAddress('someone.example', '/recipes/'), 'webapp://someone.example/recipes/');
  assert.equal(returnAddress('someone.example', '/recipes/index.html'), 'webapp://someone.example/recipes/');
  assert.equal(returnAddress('someone.example', '/'), 'webapp://someone.example/');
  assert.equal(returnAddress('someone.example', ''), 'webapp://someone.example/');
  assert.equal(returnAddress('localhost:8788', '/index.html?sw#/timers'), 'webapp://localhost:8788/');
  assert.equal(returnAddress('', '/recipes/'), '');
});
