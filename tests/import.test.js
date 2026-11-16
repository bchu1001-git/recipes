import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recipeFromCapture, isoMinutes, plainLines } from '../js/import/page.js';
import { makeRecipe } from '../js/model.js';

// Every page, site and recipe here is made up.
const NOW = '2026-03-01T12:00:00.000Z';
const PAGE = 'https://www.maplestreetkitchen.example/recipes/lemon-herb-chicken';

// A page as the Shortcut would save it: each ld+json block is kept as the text it was written as.
const capture = (blocks, extra = {}) => ({
  v: 1,
  url: PAGE,
  title: 'Lemon herb chicken | Maple Street Kitchen',
  ld: blocks.map((b) => (typeof b === 'string' ? b : JSON.stringify(b))),
  ...extra,
});
const read = (blocks, extra) => recipeFromCapture(capture(blocks, extra), NOW);

const chicken = (more = {}) => ({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Lemon herb chicken',
  recipeIngredient: ['4 chicken thighs', '1 lemon, juiced', '1 tbsp soy sauce'],
  recipeInstructions: ['Heat the oven to 425 degrees.', 'Roast for 35 minutes.'],
  ...more,
});
const stepsOf = (recipeInstructions) => read([chicken({ recipeInstructions })]).recipe.steps.map((s) => s.text);
const linesOf = (recipeIngredient) => read([chicken({ recipeIngredient })]).recipe.ingredients.map((i) => i.text);

test('page: a recipe at the top of the data becomes a recipe waiting for review', () => {
  const { recipe, found, problems } = read([chicken()]);
  assert.equal(found, true);
  assert.deepEqual(problems, []);
  assert.equal(recipe.title, 'Lemon herb chicken');
  assert.deepEqual(recipe.source, { kind: 'web', name: 'maplestreetkitchen.example', url: PAGE });
  assert.equal(recipe.review, true);
  assert.equal(recipe.created, NOW);
  assert.equal(recipe.updated, NOW);
  assert.match(recipe.id, /^r[a-z0-9]+$/);
  assert.equal(recipe.ingredients.length, 3);
  const { qty, unit, item, note } = recipe.ingredients[1];
  assert.deepEqual({ qty, unit, item, note }, { qty: '1', unit: '', item: 'lemon', note: 'juiced' });
  assert.deepEqual(recipe.steps, [
    { text: 'Heat the oven to 425 degrees.', timers: [] },
    { text: 'Roast for 35 minutes.', timers: [35] },
  ]);
});

test('page: the recipe is found in a list, under @graph, under mainEntity and in a later block', () => {
  const places = {
    list: [[{ '@type': 'BreadcrumbList', itemListElement: [] }, chicken()]],
    graph: [{ '@context': 'https://schema.org', '@graph': [{ '@type': 'Article', headline: 'Sunday roast' }, chicken()] }],
    mainEntity: [{ '@type': 'WebPage', name: 'A page', mainEntity: chicken() }],
    'a later block': [{ '@type': 'Organization', name: 'Maple Street Media' }, chicken()],
  };
  for (const [place, blocks] of Object.entries(places)) {
    const { recipe, found } = read(blocks);
    assert.equal(found, true, place);
    assert.equal(recipe.title, 'Lemon herb chicken', place);
    assert.equal(recipe.ingredients.length, 3, place);
  }
});

test('page: @type may be a list, or carry a schema.org address in front', () => {
  for (const type of [['NewsArticle', 'Recipe'], 'http://schema.org/Recipe', 'https://schema.org/Recipe', 'schema:Recipe', 'recipe']) {
    assert.equal(read([chicken({ '@type': type })]).found, true, JSON.stringify(type));
  }
  for (const type of ['Article', ['WebPage', 'ItemPage'], 'RecipeCollection', undefined]) {
    assert.equal(read([chicken({ '@type': type })]).found, false, JSON.stringify(type));
  }
});

test('page: with several recipes in one page, the fullest is kept', () => {
  const thin = { '@type': 'Recipe', name: 'Lemon herb chicken (short)' };
  const review = { '@type': 'Review', reviewBody: 'Lovely.', itemReviewed: thin };
  assert.equal(read([[review, chicken()]]).recipe.title, 'Lemon herb chicken');
  assert.equal(read([[chicken(), review]]).recipe.title, 'Lemon herb chicken');
  assert.equal(read([thin, chicken()]).recipe.title, 'Lemon herb chicken');
});

test('page: the older "ingredients" field is read when recipeIngredient is missing or empty', () => {
  const old = { '@type': 'Recipe', name: 'Skillet cornbread', ingredients: ['1 cup cornmeal', '1 cup buttermilk'], recipeInstructions: 'Bake.' };
  assert.deepEqual(read([old]).recipe.ingredients.map((i) => i.text), ['1 cup cornmeal', '1 cup buttermilk']);
  assert.equal(read([{ ...old, recipeIngredient: [] }]).recipe.ingredients.length, 2);
  assert.deepEqual(read([{ ...old, recipeIngredient: ['2 eggs'] }]).recipe.ingredients.map((i) => i.text), ['2 eggs']);
});

test('page: ingredients written as one block of text become lines', () => {
  assert.deepEqual(linesOf('2 eggs\n1 cup milk\n\n  a pinch of salt '), ['2 eggs', '1 cup milk', 'a pinch of salt']);
  assert.deepEqual(linesOf('<ul><li>2 eggs</li><li>1 cup milk</li></ul>'), ['2 eggs', '1 cup milk']);
});

test('page: doubled brackets and stray commas left by recipe plug-ins are tidied', () => {
  assert.deepEqual(linesOf([
    '1 cup onions ((sliced or diced))',
    '2 green cardamoms ( (or a pinch of ground cardamom))',
    '500 g chicken mince (, or turkey)',
    '1 cup flour ()',
    '1 can (14 oz (400 g)) chopped tomatoes',
  ]), [
    '1 cup onions (sliced or diced)',
    '2 green cardamoms (or a pinch of ground cardamom)',
    '500 g chicken mince (or turkey)',
    '1 cup flour',
    '1 can (14 oz (400 g)) chopped tomatoes',
  ]);
});

test('page steps: one string with a line for each step', () => {
  assert.deepEqual(stepsOf('Mix the batter.\nPour it into the pan.\r\n\r\nBake for 20 minutes.'),
    ['Mix the batter.', 'Pour it into the pan.', 'Bake for 20 minutes.']);
});

test('page steps: one string of numbered text', () => {
  assert.deepEqual(stepsOf('1. Mix the flour and salt. 2. Add the water. 3. Knead for 10 minutes.'),
    ['Mix the flour and salt.', 'Add the water.', 'Knead for 10 minutes.']);
  assert.deepEqual(stepsOf('Step 1: Whisk the eggs. Step 2: Cook for 3 minutes.'), ['Whisk the eggs.', 'Cook for 3 minutes.']);
  assert.deepEqual(stepsOf('1) Chop.\n2) Fry.'), ['Chop.', 'Fry.']);
  assert.deepEqual(stepsOf('- Chop.\n• Fry.\n* Serve.'), ['Chop.', 'Fry.', 'Serve.']);
  // Numbers in the middle of a sentence are not step numbers.
  assert.deepEqual(stepsOf('Bake for 25 minutes. Cool for 10 more, then cut into 12 squares.'),
    ['Bake for 25 minutes. Cool for 10 more, then cut into 12 squares.']);
  const read3 = read([chicken({ recipeInstructions: '1. Mix. 2. Rest for 30 minutes. 3. Bake.' })]).recipe.steps;
  assert.deepEqual(read3[1], { text: 'Rest for 30 minutes.', timers: [30] });
});

test('page steps: HTML lists, paragraphs and line breaks', () => {
  const want = ['Mix the batter.', 'Bake for 20 minutes.'];
  assert.deepEqual(stepsOf('<ol><li>Mix the batter.</li><li>Bake for 20 minutes.</li></ol>'), want);
  assert.deepEqual(stepsOf('<p>Mix the <strong>batter</strong>.</p>\n<p>Bake for 20 minutes.</p>'), want);
  assert.deepEqual(stepsOf('Mix the batter.<br>Bake for 20 minutes.<br />'), want);
  assert.deepEqual(stepsOf('<h3>Step 1</h3><p>Mix the batter.</p><h3>Step 2</h3><p>Bake for 20 minutes.</p>'), want);
});

test('page steps: a list of strings', () => {
  assert.deepEqual(stepsOf(['Mix the batter.', '  ', 'Bake for 20 minutes.']), ['Mix the batter.', 'Bake for 20 minutes.']);
  assert.deepEqual(stepsOf(['1. Mix the batter.', '2. Bake for 20 minutes.']), ['Mix the batter.', 'Bake for 20 minutes.']);
});

test('page steps: HowToStep objects', () => {
  assert.deepEqual(stepsOf([
    { '@type': 'HowToStep', name: 'Mix', text: 'Mix the batter.', url: PAGE + '#step-1', image: 'https://img.example/1.jpg' },
    { '@type': 'HowToStep', name: 'Bake for 20 minutes.' },
    { '@type': 'HowToStep', description: 'Cool on a rack.' },
  ]), ['Mix the batter.', 'Bake for 20 minutes.', 'Cool on a rack.']);
  // Some pages wrap each step in a ListItem, or the whole list in an ItemList.
  assert.deepEqual(stepsOf({ '@type': 'ItemList', name: 'Steps for this one', itemListElement: [
    { '@type': 'ListItem', position: 1, item: { '@type': 'HowToStep', text: 'Mix the batter.' } },
    { '@type': 'ListItem', position: 2, item: { '@type': 'HowToStep', text: 'Bake for 20 minutes.' } },
  ] }), ['Mix the batter.', 'Bake for 20 minutes.']);
});

test('page steps: a section\'s name becomes a heading line before its steps', () => {
  const section = (name, ...texts) => ({ '@type': 'HowToSection', name, itemListElement: texts.map((text) => ({ '@type': 'HowToStep', text })) });
  assert.deepEqual(stepsOf([
    section('For the chicken', 'Season the thighs.', 'Roast for 35 minutes.'),
    section('For the sauce:', 'Whisk the lemon juice with the oil.'),
  ]), ['For the chicken:', 'Season the thighs.', 'Roast for 35 minutes.', 'For the sauce:', 'Whisk the lemon juice with the oil.']);
  // The app reads those lines as headings, and a heading has no timer in it.
  const { recipe } = read([chicken({ recipeInstructions: [section('After 10 minutes', 'Roast for 35 minutes.'), section('To serve', 'Slice.')] })]);
  assert.deepEqual(recipe.steps.map((s) => !!s.heading), [true, false, true, false]);
  assert.deepEqual(recipe.steps.map((s) => s.timers), [[], [35], [], []]);
  // A lone section, or one only called Instructions, adds nothing worth reading.
  assert.deepEqual(stepsOf([section('Lemon herb chicken', 'Season the thighs.', 'Roast.')]), ['Season the thighs.', 'Roast.']);
  assert.deepEqual(stepsOf([section('Instructions', 'Season the thighs.'), section('To serve', 'Slice.')]), ['Season the thighs.', 'To serve:', 'Slice.']);
  // A name too long to be a heading goes in front of the first step, as a sentence would.
  const long = 'For the slow roasted chicken thighs with lemon, garlic and all of the herbs';
  assert.deepEqual(stepsOf([section(long, 'Season.'), section('To serve', 'Slice.')]), [long + ': Season.', 'To serve:', 'Slice.']);
});

// ---------- the groups the page's layout shows ----------

const BOWLS = ['2 chicken breasts', '1 tbsp soy sauce', 'Juice of ½ lemon', '2 cups cooked rice', '½ cucumber', '2 carrots', 'Juice of ½ lemon', 'Sesame seeds'];
const grouped = (groups, recipeIngredient = BOWLS) => read([chicken({ recipeIngredient })], { groups }).recipe.ingredients;
const textsOf = (ingredients) => ingredients.map((i) => i.text);
const withoutHeadings = (ingredients) => ingredients.filter((i) => !i.heading).map((i) => i.text);
const BOWL_GROUPS = [
  { name: 'For the chicken', items: ['2 chicken breasts', '1 tbsp soy sauce', 'Juice of ½ lemon'] },
  { name: 'For the bowls', items: ['2 cups cooked rice'] },
  { name: 'For the slaw:', items: ['½ cucumber', '2 carrots', 'Juice of ½ lemon'] },
  { name: 'To finish', items: ['Sesame seeds'] },
];

test('page groups: the groups a page shows become heading lines among the ingredients', () => {
  const out = grouped(BOWL_GROUPS);
  assert.deepEqual(textsOf(out), [
    'For the chicken:', '2 chicken breasts', '1 tbsp soy sauce', 'Juice of ½ lemon',
    'For the bowls:', '2 cups cooked rice',
    'For the slaw:', '½ cucumber', '2 carrots', 'Juice of ½ lemon',
    'To finish:', 'Sesame seeds',
  ]);
  assert.deepEqual(out.filter((i) => i.heading).map((i) => i.text), ['For the chicken:', 'For the bowls:', 'For the slaw:', 'To finish:']);
  // The same line in two groups (the lemon juice) lands once in each, and nothing else changes.
  assert.deepEqual(withoutHeadings(out), BOWLS);
  assert.equal(out[1].qty, '2');
});

test('page groups: a line is recognised whatever its spacing, capitals, punctuation or entities', () => {
  const out = grouped([
    { name: ' For the chicken : ', items: ['  2 Chicken Breasts ', '1 tbsp. soy sauce', '<b>Juice</b> of &frac12; lemon'] },
    { name: 'The rest', items: ['2 cups cooked  rice', '&#189; cucumber', '2 Carrots', 'juice of ½ lemon', 'Sesame  seeds'] },
  ]);
  assert.deepEqual(textsOf(out), ['For the chicken:', ...BOWLS.slice(0, 3), 'The rest:', ...BOWLS.slice(3)]);
});

test('page groups: ingredients before the first group come first, and one found in no group stays where it is', () => {
  const lines = ['1 tbsp soy sauce', '2 chicken breasts', '2 cups cooked rice', '½ cucumber', '2 carrots', '1 jalapeño', 'Sesame seeds', 'Lime wedges',
    'Salt', 'Pepper', 'Cumin', 'Garlic', 'Oregano', 'Paprika', 'Stock'];
  const out = grouped([
    { name: 'For the chicken', items: ['2 chicken breasts', 'Salt', 'Pepper'] },
    { name: 'For the slaw', items: ['½ cucumber', '1 jalapeño', 'Sesame seeds', 'Lime wedges'] },
    { name: 'Spices', items: ['Cumin', 'Garlic', 'Oregano', 'Paprika', 'Stock'] },
  ], lines);
  // Salt and pepper sit after the slaw in the data, so the groups would have to go backwards: left alone.
  assert.deepEqual(textsOf(out), lines);

  // Nothing claims the oil, which is ahead of the first group, or the tomatoes, in the middle of the slaw.

  const tidy = ['1 tbsp soy sauce', '2 chicken breasts', 'Salt', '2 cups cooked rice', '½ cucumber', '1 jalapeño', '2 carrots', 'Sesame seeds', 'Lime wedges', 'Cumin'];
  const again = grouped([
    { name: 'For the chicken', items: ['2 chicken breasts', 'Salt', '2 cups cooked rice'] },
    { name: 'For the slaw', items: ['½ cucumber', '1 jalapeño', 'Sesame seeds', 'Lime wedges'] },
    { name: 'Spices', items: ['Cumin', 'Something that is not in the data'] },
  ], tidy);
  assert.deepEqual(textsOf(again), [
    '1 tbsp soy sauce',
    'For the chicken:', '2 chicken breasts', 'Salt', '2 cups cooked rice',
    'For the slaw:', '½ cucumber', '1 jalapeño', '2 carrots', 'Sesame seeds', 'Lime wedges',
    'Spices:', 'Cumin',
  ]);
  assert.deepEqual(withoutHeadings(again), tidy);
});

test('page groups: they are used only when they account for at least four in five of the ingredients', () => {
  const some = [{ name: 'For the chicken', items: BOWLS.slice(0, 3) }, { name: 'For the slaw', items: BOWLS.slice(4, 7) }];   // 6 of 8
  assert.deepEqual(textsOf(grouped(some)), BOWLS);
  const most = [{ name: 'For the chicken', items: BOWLS.slice(0, 4) }, { name: 'For the slaw', items: BOWLS.slice(4, 7) }];   // 7 of 8
  assert.deepEqual(textsOf(grouped(most)), ['For the chicken:', ...BOWLS.slice(0, 4), 'For the slaw:', ...BOWLS.slice(4)]);
});

test('page groups: no ingredient is ever lost, repeated or moved because of them', () => {
  const odd = [
    [{ name: 'To finish', items: ['Sesame seeds'] }, ...BOWL_GROUPS.slice(0, 3)],                      // the page's order differs from the data's
    [{ name: 'Everything', items: [...BOWLS, ...BOWLS, '2 cups cooked rice'] }],                             // lines listed more often than they exist
    [{ name: 'x'.repeat(80), items: BOWLS.slice(0, 4) }, { name: 'For the slaw', items: BOWLS.slice(4) }],   // a name too long to be a heading
    [{ name: '', items: BOWLS }],
    [{ name: 'Only a name' }, { items: 'not a list' }, null, 7, 'text', [], { name: {}, items: [null, 3, {}, []] }],
    'not a list', 7, null, {}, [[]],
  ];
  for (const groups of odd) {
    const out = grouped(groups);
    assert.deepEqual(withoutHeadings(out), BOWLS, JSON.stringify(groups).slice(0, 60));
  }
  assert.deepEqual(textsOf(grouped(odd[0])), BOWLS);                                                    // out of order: left alone
  assert.deepEqual(textsOf(grouped(odd[1])), ['Everything:', ...BOWLS]);
  assert.deepEqual(textsOf(grouped(odd[2])), [...BOWLS.slice(0, 4), 'For the slaw:', ...BOWLS.slice(4)]);
  assert.deepEqual(textsOf(grouped(odd[3])), BOWLS);
  // A page with no recipe data ignores them too.
  assert.equal(recipeFromCapture({ v: 1, url: PAGE, title: 'About us', ld: [], groups: BOWL_GROUPS }, NOW).found, false);
});

test('page: tags and entities are taken out of every text field', () => {
  const { recipe } = read([chicken({
    name: 'Mac &amp; cheese <em>deluxe</em>',
    recipeIngredient: [
      '<a href="https://shop.example/butter">2 tbsp butter</a>',
      '&frac12; cup milk',
      '1&nbsp;cup cr&egrave;me fra&icirc;che',
      '2 jalape&#241;os, sliced',
      'baker&amp;#8217;s yeast',
      '&#x31; egg',
      '1\u20442 cup sugar',
      'the cook&#146;s choice of herbs &notathing;',
    ],
    recipeInstructions: [
      'Simmer &lt;b&gt;gently&lt;/b&gt; for 5 minutes.',
      'Stir.<script>alert(1)</script> Serve warm.<!-- a note for editors -->',
      'Cook until the middle is < 60 degrees & firm.',
    ],
    recipeYield: '<span>4</span> servings',
    publisher: { '@type': 'Organization', name: 'Maple &amp; Main <b>Kitchen</b>' },
  })]);
  assert.equal(recipe.title, 'Mac & cheese deluxe');
  assert.deepEqual(recipe.ingredients.map((i) => i.text), [
    '2 tbsp butter', '½ cup milk', '1 cup crème fraîche', '2 jalapeños, sliced', 'baker’s yeast', '1 egg', '1/2 cup sugar',
    'the cook’s choice of herbs &notathing;',
  ]);
  assert.equal(recipe.ingredients[1].qty, '½');
  assert.equal(recipe.ingredients[2].unit, 'cup');
  assert.equal(recipe.ingredients[6].qty, '1/2');
  assert.deepEqual(recipe.steps.map((s) => s.text), [
    'Simmer gently for 5 minutes.', 'Stir. Serve warm.', 'Cook until the middle is < 60 degrees & firm.',
  ]);
  assert.deepEqual(recipe.steps[0].timers, [5]);
  assert.equal(recipe.serves, '4');
  assert.equal(recipe.source.name, 'Maple & Main Kitchen');
});

test('page steps: tips listed among the steps go to the notes instead', () => {
  const { recipe, problems } = read([chicken({ recipeInstructions: [
    { '@type': 'HowToStep', text: 'Season the thighs.' },
    { '@type': 'HowToTip', text: 'The thighs can be seasoned <em>a day ahead</em>.' },
    { '@type': 'HowToStep', text: 'Roast for 35 minutes.' },
    { '@type': 'HowToTip', text: 'Leftovers keep for three days.' },
  ] })]);
  assert.deepEqual(recipe.steps.map((s) => s.text), ['Season the thighs.', 'Roast for 35 minutes.']);
  assert.deepEqual(recipe.notes, { mine: '', source: 'The thighs can be seasoned a day ahead.\nLeftovers keep for three days.' });
  assert.deepEqual(problems, []);
  // Some sites put their notes on lines of their own at the end of the last step.
  const last = read([chicken({ recipeInstructions: [
    { '@type': 'HowToStep', text: 'Season the thighs. Note: use plenty of salt.' },
    { '@type': 'HowToStep', text: 'Roast for 35 minutes.\nDo Ahead: The thighs can be seasoned a day ahead.\nEditor’s note: First printed long ago.' },
  ] })]).recipe;
  assert.deepEqual(last.steps.map((s) => s.text), ['Season the thighs. Note: use plenty of salt.', 'Roast for 35 minutes.']);
  assert.equal(last.notes.source, 'Do Ahead: The thighs can be seasoned a day ahead.\nEditor’s note: First printed long ago.');
  assert.equal(read([chicken({ recipeInstructions: 'Roast.\nTip: rest it before carving.\nNotes of lemon should come through.' })]).recipe.notes.source, 'Tip: rest it before carving.');
  // A tip next to a lone section does not make that section's name appear.
  assert.deepEqual(stepsOf([
    { '@type': 'HowToSection', name: 'Lemon herb chicken', itemListElement: [{ '@type': 'HowToStep', text: 'Roast.' }] },
    { '@type': 'HowToTip', text: 'Rest before carving.' },
  ]), ['Roast.']);
});

test('page: named entities for accents, fractions and signs', () => {
  assert.deepEqual(plainLines('350&deg; &frac14; &frac34; &Eacute;clair cr&egrave;me br&ucirc;l&eacute;e jalape&ntilde;o &times; 180&ordm; &NBSP;end'),
    ['350° ¼ ¾ Éclair crème brûlée jalapeño × 180º end']);
  assert.deepEqual(plainLines('soft&shy;hyphens, a &bogus; one, and &amp;amp; twice'), ['softhyphens, a &bogus; one, and & twice']);
});

test('page: plain lines out of whatever a field holds', () => {
  assert.deepEqual(plainLines('one<br>two'), ['one', 'two']);
  assert.deepEqual(plainLines(['a', ['b', { text: 'c' }], { '@value': 'd' }, { name: 'e' }, 7, null, true]), ['a', 'b', 'c', 'd', 'e', '7']);
  assert.deepEqual(plainLines('  spaced \u00a0 out\u200b  '), ['spaced out']);
  assert.deepEqual(plainLines(undefined), []);
});

test('page time: totalTime, else prep plus cook', () => {
  const minutes = (times) => read([chicken(times)]).recipe.minutes;
  assert.equal(minutes({ totalTime: 'PT45M' }), 45);
  assert.equal(minutes({ totalTime: 'PT1H30M', prepTime: 'PT5M', cookTime: 'PT5M' }), 90);
  assert.equal(minutes({ totalTime: 'P0DT1H0M0S' }), 60);
  assert.equal(minutes({ prepTime: 'PT15M', cookTime: 'PT1H' }), 75);
  assert.equal(minutes({ totalTime: 'PT0M', prepTime: 'PT10M', cookTime: 'PT20M' }), 30);
  assert.equal(minutes({ cookTime: 'PT25M' }), 25);
  assert.equal(minutes({ totalTime: '50 minutes' }), 50);
  assert.equal(minutes({ totalTime: 'a while' }), null);
  assert.equal(minutes({}), null);
});

test('page time: ISO 8601 durations', () => {
  assert.equal(isoMinutes('PT20M'), 20);
  assert.equal(isoMinutes('pt2h'), 120);
  assert.equal(isoMinutes('P1DT2H'), 26 * 60);
  assert.equal(isoMinutes('PT1.5H'), 90);
  assert.equal(isoMinutes('PT1H30M15S'), 90);
  assert.equal(isoMinutes('P0Y0M0DT0H35M0.000S'), 35);
  for (const not of ['PT', 'P', '', '45', 'PT1H30', '1 hour', '-PT30M', null, undefined]) assert.equal(isoMinutes(not), null, String(not));
});

test('page: recipeYield as a string, a number or a list', () => {
  const serves = (recipeYield) => read([chicken({ recipeYield })]).recipe.serves;
  assert.equal(serves('4 servings'), '4');
  assert.equal(serves('Serves 4 to 6'), '4 to 6');
  assert.equal(serves(6), '6');
  assert.equal(serves(['8', '8 servings']), '8');
  assert.equal(serves(['24', '24 cookies']), '24 cookies');
  assert.equal(serves('1 loaf'), '1 loaf');
  assert.equal(serves('6 - 8 serving(s)'), '6 - 8');
  assert.equal(serves('about 6 servings'), 'about 6');
  assert.equal(serves('Makes 12 muffins'), '12 muffins');
  assert.equal(serves('1 loaf, 10 serving(s)'), '1 loaf, 10 serving(s)');
  assert.equal(serves(['4', '4 Portionen']), '4');
  assert.equal(serves('4 personnes'), '4');
  assert.equal(serves(undefined), '');
});

test('page: the source is the name the capture gives, else the publisher, else the site, else the address', () => {
  const name = (blocks, extra) => read(blocks, extra).recipe.source.name;
  const publisher = { '@type': 'Organization', name: 'Maple Street Media' };
  const site = { '@type': 'WebSite', '@id': 'https://www.maplestreetkitchen.example/#website', name: 'Maple Street Kitchen' };
  assert.equal(name([chicken({ publisher })], { site: 'The Kitchen on Maple Street' }), 'The Kitchen on Maple Street');
  assert.equal(name([chicken({ publisher })]), 'Maple Street Media');
  assert.equal(name([chicken({ publisher: 'Maple Street Media' })]), 'Maple Street Media');
  // The publisher is often only a pointer to another entry in the same data.
  const org = { '@type': 'Organization', '@id': 'https://www.maplestreetkitchen.example/#org', name: 'Maple Street Media' };
  assert.equal(name([{ '@graph': [site, org, chicken({ publisher: { '@id': org['@id'] } })] }]), 'Maple Street Media');
  assert.equal(name([{ '@graph': [site, chicken()] }]), 'Maple Street Kitchen');
  assert.equal(name([{ '@graph': [{ '@type': 'Article', publisher }, chicken()] }]), 'Maple Street Media');
  assert.equal(name([chicken()]), 'maplestreetkitchen.example');
  assert.equal(name([chicken()], { url: 'not an address' }), '');
});

test('page: the story and the pictures are left out, and the recipe has no new fields', () => {
  const { recipe } = read([chicken({
    description: 'My grandmother made this every Sunday of my childhood.',
    image: ['https://img.example/photo.jpg'],
    author: { '@type': 'Person', name: 'Someone Madeup' },
    video: { '@type': 'VideoObject', name: 'Watch', contentUrl: 'https://img.example/clip.mp4' },
    nutrition: { '@type': 'NutritionInformation', calories: '300 calories' },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.8', ratingCount: '12' },
    keywords: 'chicken, lemon',
    recipeCategory: 'Dinner',
  })]);
  const saved = JSON.stringify(recipe);
  for (const left of ['grandmother', 'photo.jpg', 'clip.mp4', 'Someone', 'calories', '4.8', 'Dinner']) assert.equal(saved.includes(left), false, left);
  assert.equal(recipe.photo, '');
  assert.deepEqual(recipe.notes, { mine: '', source: '' });
  assert.deepEqual(recipe.folders, []);
  assert.equal(recipe.rating, 0);
  assert.equal(recipe.goto, false);
  assert.deepEqual(Object.keys(recipe).sort(), Object.keys(makeRecipe({})).sort());
});

test('page: JSON that does not parse is skipped, and the next block is still read', () => {
  const broken = '{"@type": "Recipe", "name": ';
  assert.equal(read([broken, chicken()]).found, true);
  const none = read([broken]);
  assert.equal(none.found, false);
  assert.deepEqual(none.problems, ['The recipe data on this page could not be read']);
});

test('page: common slips in a page\'s JSON are read anyway', () => {
  const text = JSON.stringify(chicken());
  const slips = {
    'a line break inside a string': text.replace('Lemon herb chicken', 'Lemon herb\nchicken'),
    'a trailing comma': text.replace('"1 tbsp soy sauce"]', '"1 tbsp soy sauce",]'),
    'an HTML comment around it': '<!--\n' + text + '\n-->',
    'a CDATA wrapper': '//<![CDATA[\n' + text + '\n//]]>',
    'a semicolon after it': text + ';',
  };
  for (const [slip, block] of Object.entries(slips)) {
    const { recipe, found } = read([block]);
    assert.equal(found, true, slip);
    assert.equal(recipe.title, 'Lemon herb chicken', slip);
    assert.equal(recipe.ingredients.length, 3, slip);
  }
});

test('page: a page with no recipe data gives a draft with its title and its link', () => {
  const { recipe, found, problems } = read([{ '@type': 'WebSite', name: 'Maple Street Kitchen' }]);
  assert.equal(found, false);
  assert.deepEqual(problems, ['No recipe data was found on this page']);
  assert.equal(recipe.title, 'Lemon herb chicken');
  assert.deepEqual(recipe.source, { kind: 'web', name: 'Maple Street Kitchen', url: PAGE });
  assert.equal(recipe.review, true);
  assert.deepEqual(recipe.ingredients, []);
  assert.deepEqual(recipe.steps, []);

  const title = (t, extra) => read([], { title: t, ...extra }).recipe.title;
  assert.equal(title('Lemon herb chicken - maplestreetkitchen.example'), 'Lemon herb chicken');
  assert.equal(title('Maple Street Kitchen · Lemon herb chicken', { site: 'Maple Street Kitchen' }), 'Lemon herb chicken');
  assert.equal(title('Lemon herb chicken - the easy way'), 'Lemon herb chicken - the easy way');
  assert.equal(title('Lemon &amp; herb chicken'), 'Lemon & herb chicken');
  assert.equal(recipeFromCapture({ url: PAGE }, NOW).recipe.title, '');
});

test('page: the page title stands in when the recipe data has no name', () => {
  const { recipe, problems } = read([chicken({ name: undefined })]);
  assert.equal(recipe.title, 'Lemon herb chicken');
  assert.deepEqual(problems, []);
  assert.equal(read([chicken({ name: '', headline: 'Chicken with lemon' })]).recipe.title, 'Chicken with lemon');
});

test('page: problems say what is missing', () => {
  const problems = (more, extra) => read([chicken(more)], extra).problems;
  assert.deepEqual(problems({ recipeInstructions: [] }), ['No steps were found']);
  assert.deepEqual(problems({ recipeIngredient: undefined }), ['No ingredients were found']);
  assert.deepEqual(problems({ name: '', recipeIngredient: [], recipeInstructions: '' }, { title: '' }),
    ['No title was found', 'No ingredients were found', 'No steps were found']);
  assert.deepEqual(problems({ recipeInstructions: 'Stir the pot and keep stirring. '.repeat(20) }), ['The steps came as one block of text']);
});

test('page: only an ordinary web address is kept as the link', () => {
  const url = (address, more) => read([chicken(more)], { url: address }).recipe.source.url;
  assert.equal(url('https://kitchen.example/soup?serves=4#method'), 'https://kitchen.example/soup?serves=4#method');
  assert.equal(url('http://kitchen.example/soup'), 'http://kitchen.example/soup');
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<p>hi</p>', 'ftp://kitchen.example/soup', 'file:///etc/hosts', 'soup', '', null, 7, {}]) {
    assert.equal(url(bad), '', String(bad));
  }
  // With no usable address in the capture, the one the recipe data gives is used, by the same rule.
  assert.equal(url('', { url: 'https://kitchen.example/soup' }), 'https://kitchen.example/soup');
  assert.equal(url('', { mainEntityOfPage: { '@id': 'https://kitchen.example/soup' } }), 'https://kitchen.example/soup');
  assert.equal(url('', { url: 'javascript:alert(1)' }), '');
});

test('page: nothing in a capture can make it throw', () => {
  const deep = (open, close) => open.repeat(5000) + close.repeat(5000);
  const trap = { get '@graph'() { throw new Error('not today'); } };
  const captures = [
    undefined, null, 42, 'a string', [], {}, () => {},
    { ld: 'not json at all' },
    { ld: null, url: {}, title: [], site: 7 },
    { ld: [null, 5, true, {}, [], '', '   ', '[]', 'null', '"text"', '12'] },
    { ld: [deep('[', ']'), deep('{"a":', '}').replace('{"a":}', '{"a":1}')] },
    { ld: [trap] },
    { ld: [{ '@type': 'Recipe', name: 10n, recipeIngredient: Symbol('salt') }], title: Symbol('title') },
    { url: { toString() { throw new Error('no'); } }, ld: [] },
    capture([chicken({ name: { a: 1 }, recipeIngredient: 5, recipeInstructions: { itemListElement: { itemListElement: { itemListElement: 'Stir.' } } } })]),
    capture([chicken({ name: [[['Soup']]], recipeIngredient: { text: { text: { text: '1 egg' } } }, recipeInstructions: [[[[['Stir.']]]]] })]),
    capture([chicken({ '@type': [null, 3, {}, 'Recipe'], totalTime: [], prepTime: {}, cookTime: -5, recipeYield: {}, publisher: [[[[]]]] })]),
    capture([chicken({ recipeInstructions: [{ '@type': 'HowToSection', name: {}, itemListElement: null }, { item: { item: { item: {} } } }] })]),
    capture([{ '@graph': { '@graph': { '@graph': chicken() } } }]),
    capture([chicken()], { url: 'https://[not-a-host', title: '\u0000\u0001', site: '<<<>>>' }),
  ];
  for (const [n, input] of captures.entries()) {
    let result;
    assert.doesNotThrow(() => { result = recipeFromCapture(input, NOW); }, 'capture ' + n);
    assert.equal(typeof result.found, 'boolean', 'capture ' + n);
    assert.ok(Array.isArray(result.problems), 'capture ' + n);
    assert.equal(result.recipe.review, true, 'capture ' + n);
    assert.equal(result.recipe.source.kind, 'web', 'capture ' + n);
    assert.equal(typeof result.recipe.title, 'string', 'capture ' + n);
    assert.doesNotThrow(() => JSON.stringify(result), 'capture ' + n);
  }
  assert.deepEqual(recipeFromCapture({ ld: [trap], url: PAGE }, NOW).problems, ['This page could not be read']);
  assert.equal(recipeFromCapture(capture([chicken()])).recipe.created.length, 24);   // no time given: it uses the present
});

test('page: a very long or very repetitive page is cut down, quickly', () => {
  const started = Date.now();
  const many = read([chicken({
    recipeIngredient: Array.from({ length: 5000 }, (_, i) => i + ' peppercorns'),
    recipeInstructions: Array.from({ length: 5000 }, (_, i) => 'Grind peppercorn ' + i + '.'),
  })]).recipe;
  assert.equal(many.ingredients.length, 300);
  assert.equal(many.steps.length, 300);
  for (const noise of ['<a', '<!--', '<script', '&#', '1. ', '<p', ', ']) {
    const { recipe } = read([chicken({ name: noise.repeat(60000), recipeInstructions: noise.repeat(60000) + 'Stir.' })]);
    assert.ok(recipe.title.length <= 200, noise);
    assert.ok(recipe.steps.every((s) => s.text.length <= 3000), noise);
  }
  assert.equal(read([' '.repeat(2000001)]).found, false);
  assert.ok(Date.now() - started < 5000, 'took ' + (Date.now() - started) + ' ms');
});

test('page: the reader has no screen, storage or network in it', () => {
  const source = readFileSync(new URL('../js/import/page.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(document|window|navigator|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|innerHTML|DOMParser|require|process|eval|Function)\b/);
  assert.deepEqual([...source.matchAll(/^import .* from '(.*)';$/gm)].map((m) => m[1]), ['../model.js']);
});
