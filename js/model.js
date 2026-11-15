// Pure data helpers: no DOM and no storage, so the tests can import this file in Node.

export function slug(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const STARTER = [
  ['ingredient', 'Main ingredient', ['Chicken', 'Beef', 'Pork', 'Seafood', 'Vegetarian']],
  ['dish', 'Dish', ['Soups & stews', 'Salads', 'Pasta & noodles', 'Rice & grains', 'Sides', 'Sauces & dressings', 'Baking & desserts']],
  ['meal', 'Meal', ['Breakfast', 'Lunch', 'Dinner', 'Snacks']],
  ['cuisine', 'Cuisine', []],
  ['lists', 'My lists', ['Quick', 'Weeknight', "Company's coming"]],
];

/** The folders a new library starts with. Folder ids are "group:slug" and never change on rename. */
export function starterFolders() {
  return {
    groups: STARTER.map(([id, name, folders]) => ({
      id,
      name,
      folders: folders.map((n) => ({ id: id + ':' + slug(n), name: n })),
    })),
  };
}

export function newId() {
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** A folder id for a new name in a group, with a number added if the plain one is taken. */
export function newFolderId(group, name) {
  const base = group.id + ':' + (slug(name) || 'folder');
  const taken = new Set(group.folders.map((f) => f.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = base + '-' + n;
  return id;
}

const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());
const cleanBlock = (s) => (s == null ? '' : String(s).replace(/[ \t]+\n/g, '\n').trim());

// ---------- ingredients ----------

const FRAC = '¼½¾⅓⅔⅛⅜⅝⅞';
const NUM = `(?:\\d+\\s*[${FRAC}]|[${FRAC}]|\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)`;
const QTY = new RegExp(`^(${NUM}(?:\\s*(?:-|–|to)\\s*${NUM})?)(?=\\s|[a-zA-Z(]|$)`);
const UNITS = new Set((
  'tsp tsps teaspoon teaspoons tbsp tbsps tbs tablespoon tablespoons cup cups oz ounce ounces lb lbs pound pounds ' +
  'g gram grams kg kilogram kilograms ml milliliter milliliters millilitre millilitres l liter liters litre litres ' +
  'quart quarts qt pint pints pt gallon gallons pinch pinches dash dashes clove cloves can cans stick sticks ' +
  'slice slices bunch bunches sprig sprigs package packages pkg piece pieces head heads handful handfuls drop drops inch inches'
).split(' '));
const LOOSE = /^(an?\s+)?(pinch|dash|handful|splash)\s+(?:of\s+)?/i;

/** Splits "1 1/2 cups chicken broth, warmed" into amount, unit, item and note. The line as written is kept in `text`. */
export function parseIngredient(line) {
  const text = clean(String(line).replace(/^\s*(?:[-*•–]|\d+[.)])\s+/, ''));
  const out = { text, qty: '', unit: '', item: text, note: '' };
  if (!text) return out;
  let rest = text;
  const q = rest.match(QTY);
  if (q) {
    out.qty = q[1].replace(/\s*(-|–)\s*/g, '-').replace(/\s+/g, ' ');
    rest = rest.slice(q[0].length).trim();
    const word = rest.match(/^([a-zA-Z]+)\.?(?=\s|$)/);
    if (word && UNITS.has(word[1].toLowerCase())) {
      out.unit = word[1];
      rest = rest.slice(word[0].length).trim().replace(/^of\s+/i, '');
    }
  } else {
    const loose = rest.match(LOOSE);
    if (loose) {
      out.qty = loose[1] ? clean(loose[1]) : '';
      out.unit = loose[2].toLowerCase();
      rest = rest.slice(loose[0].length).trim();
    }
  }
  const comma = splitAtComma(rest);
  out.item = comma.item || text;
  out.note = comma.note;
  return out;
}

function splitAtComma(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) return { item: s.slice(0, i).trim(), note: s.slice(i + 1).trim() };
  }
  return { item: s.trim(), note: '' };
}

/** "1 1/2 cups" for the bold amount column. */
export function amountLabel(ing) {
  return [ing.qty, ing.unit].filter(Boolean).join(' ');
}

/** What follows the amount: the item, then any note. */
export function itemLabel(ing) {
  return ing.note ? ing.item + ', ' + ing.note : ing.item;
}

// ---------- times ----------

/** Minutes for every time mentioned in a step, in order. A range such as "5 to 7 minutes" counts as its first number. */
export function findTimers(text) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?)\b/gi;
  let m;
  while ((m = re.exec(String(text)))) {
    const minutes = Math.round(parseFloat(m[1]) * (m[2][0].toLowerCase() === 'h' ? 60 : 1));
    if (minutes > 0 && minutes <= 24 * 60) out.push(minutes);
  }
  return out;
}

/** Turns "45", "45 min", "1 hr 15 min", "1.5 hours" or "1:30" into minutes. Returns null when there is no time in it. */
export function parseDuration(input) {
  const s = clean(input).toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s));
  const clock = s.match(/^(\d+):(\d{2})$/);
  if (clock) return parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10);
  let total = 0;
  let found = false;
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/g;
  let m;
  while ((m = re.exec(s))) {
    found = true;
    total += parseFloat(m[1]) * (m[2][0] === 'h' ? 60 : 1);
  }
  return found ? Math.round(total) : null;
}

export function formatMinutes(minutes) {
  if (!minutes || minutes < 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return m + ' min';
  return h + ' hr' + (m ? ' ' + m + ' min' : '');
}

// ---------- recipes ----------

function clampRating(n) {
  const v = Math.round(Number(n) || 0);
  return v < 0 ? 0 : v > 5 ? 5 : v;
}

/** Builds a complete recipe from loose input. Ingredients and steps may be plain lines of text. */
export function makeRecipe(input = {}, now = new Date().toISOString()) {
  const source = input.source || {};
  const notes = input.notes || {};
  const minutes = typeof input.minutes === 'number' ? input.minutes : parseDuration(input.minutes);
  const recipe = {
    id: input.id || newId(),
    v: 1,
    title: clean(input.title),
    source: { kind: source.kind || 'manual', name: clean(source.name), url: clean(source.url) },
    minutes: minutes && minutes > 0 ? minutes : null,
    serves: clean(input.serves),
    ingredients: (input.ingredients || [])
      .map((x) => (typeof x === 'string' ? parseIngredient(x) : x))
      .filter((x) => x && x.text),
    steps: (input.steps || [])
      .map((x) => (typeof x === 'string' ? { text: clean(x), timers: findTimers(x) } : x))
      .filter((x) => x && x.text),
    notes: { mine: cleanBlock(notes.mine), source: cleanBlock(notes.source) },
    folders: [...new Set(input.folders || [])],
    goto: !!input.goto,
    rating: clampRating(input.rating),
    photo: input.photo || '',
    originals: input.originals || [],
    review: !!input.review,
    created: input.created || now,
    updated: now,
    by: input.by || '',
  };
  if (input.example) recipe.example = true;
  // Fields written by a newer version of the app are carried along untouched.
  for (const key of Object.keys(input)) if (!(key in recipe) && key !== 'example') recipe[key] = input[key];
  return recipe;
}

/** Text lines for the editor: one ingredient or step per line. */
export function linesOf(list) {
  return (list || []).map((x) => x.text).join('\n');
}

export function splitLines(text) {
  return String(text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// ---------- finding ----------

/** Every word of the search must appear somewhere in the title, source, ingredients, steps or notes. */
export function matchesQuery(recipe, query) {
  const words = clean(query).toLowerCase().split(' ').filter(Boolean);
  if (!words.length) return true;
  const hay = [
    recipe.title, recipe.source.name,
    ...recipe.ingredients.map((i) => i.text),
    ...recipe.steps.map((s) => s.text),
    recipe.notes.mine, recipe.notes.source,
  ].join('\n').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Folders in one group widen the result (chicken OR beef); different groups narrow it (chicken AND soups). */
export function matchesFilters(recipe, selected) {
  const byGroup = new Map();
  for (const id of selected) {
    const group = id.split(':')[0];
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(id);
  }
  for (const ids of byGroup.values()) {
    if (!ids.some((id) => recipe.folders.includes(id))) return false;
  }
  return true;
}

export function sortRecipes(list) {
  return [...list].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.created.localeCompare(b.created));
}

/** Two letters for the tile shown when a recipe has no photo. */
export function initials(title) {
  const t = clean(title).replace(/[^\p{L}\p{N}]/gu, '');
  if (!t) return '?';
  return t[0].toUpperCase() + (t[1] ? t[1].toLowerCase() : '');
}

const INGREDIENT_HUES = { 'ingredient:chicken': 42, 'ingredient:beef': 12, 'ingredient:pork': 350, 'ingredient:seafood': 205, 'ingredient:vegetarian': 135 };

/** A steady color for the tile: by main ingredient when there is one, otherwise from the title. */
export function hueFor(recipe) {
  for (const id of recipe.folders) if (id in INGREDIENT_HUES) return INGREDIENT_HUES[id];
  let h = 0;
  for (const ch of recipe.title) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

export function folderIndex(folders) {
  const map = new Map();
  for (const g of folders.groups) for (const f of g.folders) map.set(f.id, { ...f, group: g.id, groupName: g.name });
  return map;
}
