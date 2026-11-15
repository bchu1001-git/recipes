// Reads the recipe a web page declares about itself (the schema.org Recipe data in its ld+json blocks)
// and turns it into this app's recipe shape. Pure string and data code: no screen, no storage and no
// network, so it runs the same in a browser, in the tests, and later in the importer on GitHub.
//
// A "capture" is the small file the Save to Recipes Shortcut writes into a library's inbox/:
//
//   {
//     v:     1
//     url:   the page's address
//     title: the page's title
//     site:  the site's name, when the page states one            (optional)
//     at:    when it was saved, as an ISO time                    (optional, not used here)
//     ld:    [the raw text of every <script type="application/ld+json"> on the page]
//     text:  the page's visible text, kept for the AI reader      (optional, not used here)
//   }
//
// The ld entries stay unparsed on purpose, so a page with broken JSON can never break the Shortcut.
//
// Everything in a capture was written by a web page, so all of it is treated as untrusted text. Tags
// are removed and entities decoded with string code only. Nothing here is ever parsed as HTML, and the
// only link kept is one that starts with http or https.

import { makeRecipe, parseDuration } from '../model.js';

// Limits, so that an odd or hostile page costs a moment at most.
const MAX_BLOCKS = 60;          // ld+json blocks read from one capture
const MAX_BLOCK = 2000000;      // characters in one block
const MAX_NODES = 20000;        // objects visited while looking for the recipe
const MAX_DEPTH = 24;           // how deep into nested data to look
const MAX_FIELD = 200000;       // characters read from one field
const MAX_LINES = 300;          // ingredients or steps kept
const MAX_LINE = 3000;          // characters kept from one ingredient or step
const MAX_TIPS = 40;            // tips kept for the notes
const MAX_TITLE = 200;
const MAX_SHORT = 80;           // site name, serves

// ---------- plain text out of page text ----------

// The names HTML gives to characters 160 to 255, in that order: &nbsp; is 160 and &yuml; is 255.
const LATIN = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute ' +
  'micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil ' +
  'Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute ' +
  'Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute ' +
  'icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml';
const NAMED = new Map(LATIN.split(' ').map((name, i) => [name, String.fromCharCode(160 + i)]));
// And the ones outside that range that turn up in recipes.
for (const [name, char] of Object.entries({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '', zwj: '', lrm: '', rlm: '',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', lsaquo: '‹', rsaquo: '›',
  hellip: '…', bull: '•', prime: '′', Prime: '″', frasl: '/', euro: '€', trade: '™', dagger: '†', permil: '‰',
  OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ',
  frac13: '⅓', frac23: '⅔', frac18: '⅛', frac38: '⅜', frac58: '⅝', frac78: '⅞',
})) NAMED.set(name, char);
// Numbers 128 to 159 are not characters, but old pages use them the way Windows did.
const WINDOWS = new Map([[128, '€'], [130, '‚'], [132, '„'], [133, '…'], [145, '‘'], [146, '’'], [147, '“'], [148, '”'], [149, '•'], [150, '–'], [151, '—'], [153, '™']]);

function fromCode(code) {
  if (WINDOWS.has(code)) return WINDOWS.get(code);
  if (code === 10 || code === 13) return '\n';
  if (code === 9) return ' ';
  if (!(code >= 32 && code <= 0x10ffff) || (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff)) return '';
  return String.fromCodePoint(code);
}

function decodeEntities(text) {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,9});/g, (whole, body) => {
    if (body[0] === '#') return fromCode(/^#[xX]/.test(body) ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10));
    const named = NAMED.get(body) ?? NAMED.get(body.toLowerCase());
    return named === undefined ? whole : named;
  });
}

/** Cuts out everything from each `open` to the next `close`. One pass, however the text is built. */
function dropBetween(text, open, close) {
  let out = '';
  let at = 0;
  for (;;) {
    open.lastIndex = at;
    const start = open.exec(text);
    if (!start) return out + text.slice(at);
    out += text.slice(at, start.index) + ' ';
    close.lastIndex = start.index + start[0].length;
    const end = close.exec(text);
    if (!end) return out;                 // never closed, so the rest is not text
    at = end.index + end[0].length;
  }
}

/** Removes tags. The ends of paragraphs, list items and line breaks become new lines. */
function stripTags(text) {
  let out = dropBetween(text, /<script\b/gi, /<\/script\s*>/gi);
  out = dropBetween(out, /<style\b/gi, /<\/style\s*>/gi);
  out = dropBetween(out, /<!--/g, /-->/g);
  return out
    .replace(/<\s*(?:br|hr)\b[^<>]*>|<\/?\s*(?:p|li|div|ol|ul|h[1-6]|tr|table|section|article|blockquote)\b[^<>]*>/gi, '\n')
    .replace(/<\/?[a-zA-Z][^<>]*>/g, '');
}

/** Whatever a field holds, as text. Lists become lines; an object gives its text or its name. */
function textOf(value, depth = 0) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (!value || typeof value !== 'object' || depth > 4) return '';
  if (Array.isArray(value)) return value.slice(0, MAX_LINES).map((v) => textOf(v, depth + 1)).filter(Boolean).join('\n');
  return textOf(value['@value'] ?? value.text ?? value.name ?? '', depth + 1);
}

/**
 * The plain lines of text in a field: tags gone, entities decoded, spaces tidied, empty lines dropped.
 * Entities are decoded before and after the tags go, because some pages send their markup encoded
 * ("&lt;p&gt;") and some encode twice ("&amp;#8217;").
 */
export function plainLines(value) {
  const raw = textOf(value).slice(0, MAX_FIELD);
  const text = decodeEntities(stripTags(decodeEntities(raw))).replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '');
  return text.split(/[\r\n\u2028\u2029]+/).map((l) => l.replace(/\s+/g, ' ').trim().slice(0, MAX_LINE)).filter(Boolean);
}

const lineOf = (value) => plainLines(value).join(' ');

// ---------- finding the recipe in the page's data ----------

/** One ld+json block as data, or a note that it could not be read. Never throws. */
function parseBlock(raw) {
  if (raw && typeof raw === 'object') return { value: raw };
  if (typeof raw !== 'string') return {};
  if (raw.length > MAX_BLOCK) return { failed: true };
  const text = raw.trim()
    .replace(/^<!--/, '').replace(/-->$/, '')
    .replace(/^(?:\/\/\s*)?<!\[CDATA\[/, '').replace(/(?:\/\/\s*)?\]\]>$/, '')
    .trim().replace(/;$/, '');
  if (!text) return {};
  // As written; then with line breaks inside strings turned into spaces; then without trailing commas.
  const spaced = text.replace(/[\u0000-\u001f]+/g, ' ');
  for (const attempt of [text, spaced, spaced.replace(/,\s*([\]}])/g, '$1')]) {
    try {
      return { value: JSON.parse(attempt) };
    } catch { /* try the next form */ }
  }
  return { failed: true };
}

/** Every object in the data, however it is nested: in a list, under @graph, under mainEntity. */
function everyNode(blocks) {
  const nodes = [];
  const walk = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > MAX_DEPTH || nodes.length >= MAX_NODES) return;
    if (Array.isArray(value)) {
      for (const v of value) {
        if (nodes.length >= MAX_NODES) break;
        walk(v, depth + 1);
      }
      return;
    }
    nodes.push(value);
    for (const key of Object.keys(value)) walk(value[key], depth + 1);
  };
  for (const block of blocks) walk(block, 0);
  return nodes;
}

/** A node's types in lower case, without "https://schema.org/" or "schema:" in front. */
function typesOf(node) {
  const type = node['@type'];
  return (Array.isArray(type) ? type : [type])
    .filter((t) => typeof t === 'string')
    .map((t) => t.slice(0, 200).replace(/^.*[/#:]/, '').trim().toLowerCase());
}

const isA = (node, type) => typesOf(node).includes(type);

// ---------- the parts of a recipe ----------

// The most widely used recipe plug-in wraps an ingredient's note in brackets even when the note has
// its own, and can leave a stray comma or an empty pair: "onions ((sliced))", "mince (, or turkey)".
const tidyBrackets = (line) => line
  .replace(/\(\s*\(([^()]*)\)\s*\)/g, '($1)')
  .replace(/\(\s*,\s*/g, '(')
  .replace(/\s*\(\s*\)/g, '')
  .trim();

function ingredientLines(node) {
  let lines = plainLines(node.recipeIngredient);
  if (!lines.length) lines = plainLines(node.ingredients);
  // Some pages write a half with the special fraction-slash character. A plain slash reads the same
  // and the amount can then be understood.
  return lines.slice(0, MAX_LINES).map((l) => tidyBrackets(l.replace(/[\u2044\u2215]/g, '/'))).filter(Boolean);
}

const ONLY_A_LABEL = /^(?:step\s*)?\d{1,2}\s*[.):]?$/i;
const LEADING_LABEL = /^(?:step\s*\d{1,2}\s*[.):–-]?|\d{1,2}\s*[.)]|[-*•–])\s+/i;
const PLAIN_SECTION = /^(?:instructions?|directions?|method|steps?|preparation|how to make(?: it)?)$/i;
const NOTE_LABEL = /^(?:do[- ]ahead|make[- ]ahead|(?:editor|cook|chef)[’']?s[’']? notes?|recipe notes?|notes?|tipp?s?|storage|variations?)\s*:/i;

/** "1. Mix. 2. Bake." written as one line becomes two steps. The numbers must start at 1 and count up. */
function splitNumbered(text) {
  const marks = [];
  const re = /(?:^|\s)(?:step\s*)?(\d{1,2})\s*[.):]\s+(?=\S)/gi;
  let m;
  while ((m = re.exec(text))) {
    if (Number(m[1]) === marks.length + 1 && (marks.length > 0 || m.index === 0)) {
      marks.push({ at: m.index, end: m.index + m[0].length });
    }
  }
  if (marks.length < 2) return [text];
  return marks.map((mark, i) => text.slice(mark.end, i + 1 < marks.length ? marks[i + 1].at : text.length).trim());
}

/** The steps in a piece of text, with "1.", "Step 1:" or a bullet taken off the front of each. */
function textSteps(value, tips) {
  let lines = plainLines(value);
  if (lines.length === 1) lines = splitNumbered(lines[0]);
  const steps = [];
  for (const raw of lines) {
    if (ONLY_A_LABEL.test(raw)) continue;
    const line = raw.replace(LEADING_LABEL, '');
    if (!line) continue;
    // Some sites end their last step with "Do ahead: ..." or "Editor's note: ..." on lines of their own.
    if (!NOTE_LABEL.test(line)) steps.push(line);
    else if (tips.length < MAX_TIPS) tips.push(line);
  }
  return steps;
}

const isTip = (value) => !!value && typeof value === 'object' && !Array.isArray(value) && isA(value, 'howtotip');

function addSteps(value, out, tips, depth, alone) {
  if (value == null || depth > 8 || out.length >= MAX_LINES) return;
  if (typeof value === 'string' || typeof value === 'number') {
    out.push(...textSteps(value, tips));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) addSteps(v, out, tips, depth + 1, false);
    return;
  }
  if (typeof value !== 'object') return;
  if (isTip(value)) {
    // Advice listed among the steps ("To make these ahead...") is not something to do in order.
    // It goes to the notes that came with the recipe.
    if (tips.length < MAX_TIPS) tips.push(...plainLines(value.text ?? value.name));
    return;
  }
  const inner = value.itemListElement ?? value.steps ?? value.step;
  if (inner != null) {
    // A section ("For the sauce") holding its own steps. Its name goes in front of its first step,
    // unless it is the only one or is just called "Instructions".
    const first = out.length;
    addSteps(inner, out, tips, depth + 1, false);
    const name = lineOf(value.name).replace(/[:.\s]+$/, '');
    if (name && out.length > first && !alone && !isA(value, 'howtostep') && !isA(value, 'itemlist') && !PLAIN_SECTION.test(name)) {
      out[first] = (name + ': ' + out[first]).slice(0, MAX_LINE);
    }
    return;
  }
  if (value.item && typeof value.item === 'object') {
    addSteps(value.item, out, tips, depth + 1, alone);
    return;
  }
  out.push(...textSteps(value.text ?? value.description ?? value.name ?? value['@value'], tips));
}

/** The steps to follow, and separately any tips that were listed among them. */
function stepsAndTips(node) {
  const value = node.recipeInstructions ?? node.instructions;
  const list = Array.isArray(value) ? value : [value];
  const alone = list.filter((v) => !isTip(v)).length === 1;
  const steps = [];
  const tips = [];
  for (const v of list) addSteps(v, steps, tips, 0, alone);
  return { steps: steps.slice(0, MAX_LINES), tips: tips.slice(0, MAX_TIPS) };
}

/** Minutes in an ISO 8601 duration such as "PT1H30M" or "P0DT45M". Null when it is not one, or is zero. */
export function isoMinutes(value) {
  const m = /^P(?:([\d.,]+)Y)?(?:([\d.,]+)M)?(?:([\d.,]+)W)?(?:([\d.,]+)D)?(?:T(?:([\d.,]+)H)?(?:([\d.,]+)M)?(?:([\d.,]+)S)?)?$/i
    .exec(String(value ?? '').trim());
  if (!m) return null;
  const n = (part) => (part ? parseFloat(part.replace(',', '.')) || 0 : 0);
  const minutes = n(m[3]) * 7 * 24 * 60 + n(m[4]) * 24 * 60 + n(m[5]) * 60 + n(m[6]) + n(m[7]) / 60;
  return minutes >= 0.5 && Number.isFinite(minutes) ? Math.round(minutes) : null;
}

function minutesOf(node) {
  // Most pages give "PT45M". A few write "45 minutes", which is what parseDuration is for.
  const read = (value) => {
    const text = lineOf(value);
    return (text && (isoMinutes(text) ?? parseDuration(text))) || 0;
  };
  return read(node.totalTime) || read(node.prepTime) + read(node.cookTime) || null;
}

/**
 * "4 servings", "Serves 4" and "4 serving(s)" all become "4", because the recipe page writes "Serves"
 * itself. Anything that says more than a count ("12 cookies", "1 loaf, 10 servings") is kept as written.
 */
function tidyYield(text) {
  const rest = text.replace(/^(?:serves|servings?|makes|yields?)\s*:?\s*/i, '').trim();
  const count = /^((?:about\s+|approx\.?\s+|approximately\s+)?\d+(?:\s*(?:-|–|to)\s*\d+)?)\s*(?:servings?|serving\(s\)|serves|portions?|portionen|people|persons?|personen|personnes)\.?$/i.exec(rest);
  return count ? count[1] : rest;
}

function servesOf(node) {
  const raw = node.recipeYield ?? node.yield;
  const list = (Array.isArray(raw) ? raw : [raw]).map((x) => tidyYield(lineOf(x))).filter(Boolean);
  // ["12", "12 cookies"]: the one that says what is being counted is the more useful.
  return (list.find((x) => /\p{L}/u.test(x)) || list[0] || '').slice(0, MAX_SHORT);
}

// ---------- where it came from ----------

function hostOf(url) {
  try {
    return new URL(String(url).trim()).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/** The address, only if it is an ordinary web address. Anything else is dropped. */
function webAddress(url) {
  if (typeof url !== 'string') return '';
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

function siteName(capture, node, nodes) {
  const stated = lineOf(capture.site);
  if (stated) return stated.slice(0, MAX_SHORT);
  // A publisher is often only a pointer ({ "@id": ... }) to another entry in the same data.
  const byId = new Map();
  for (const n of nodes) {
    const id = n['@id'];
    if (typeof id === 'string' && !byId.has(id) && Object.keys(n).length > 1) byId.set(id, n);
  }
  const nameOf = (ref, depth = 0) => {
    if (typeof ref === 'string') return byId.has(ref) ? lineOf(byId.get(ref).name) : (/^https?:/i.test(ref) ? '' : lineOf(ref));
    if (Array.isArray(ref)) {
      for (const r of ref.slice(0, 10)) {
        const name = depth < 2 ? nameOf(r, depth + 1) : '';
        if (name) return name;
      }
      return '';
    }
    if (!ref || typeof ref !== 'object') return '';
    return lineOf(ref.name) || (typeof ref['@id'] === 'string' && byId.has(ref['@id']) ? lineOf(byId.get(ref['@id']).name) : '');
  };
  const firstName = (names) => {
    for (const name of names) if (name) return name;
    return '';
  };
  const name = (node && nameOf(node.publisher))
    || firstName(nodes.filter((n) => isA(n, 'website')).map((n) => lineOf(n.name)))
    || firstName(nodes.filter((n) => n.publisher).map((n) => nameOf(n.publisher)))
    || hostOf(capture.url);
  return name.slice(0, MAX_SHORT);
}

/** The page's title without the site's name on the end of it or in front of it. */
function pageTitle(capture, site) {
  const title = lineOf(capture.title).slice(0, MAX_TITLE);
  const bare = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const host = hostOf(capture.url);
  const names = new Set([site, host, ...host.split('.').slice(0, -1)].map(bare).filter((s) => s.length > 1));
  const cut = /\s[|·•–—-]\s|\s*\|\s*|\s::\s/;
  const last = new RegExp('^(.*\\S)(?:' + cut.source + ')(\\S.*)$').exec(title);
  if (last && names.has(bare(last[2]))) return last[1].trim();
  const first = new RegExp('^(.*?\\S)(?:' + cut.source + ')(\\S.*)$').exec(title);
  if (first && names.has(bare(first[1]))) return first[2].trim();
  return title;
}

// ---------- the whole thing ----------

function read(capture, now) {
  const parsed = (Array.isArray(capture.ld) ? capture.ld : [capture.ld]).slice(0, MAX_BLOCKS).map(parseBlock);
  const nodes = everyNode(parsed.map((p) => p.value));

  // Several recipes can sit in one page (a recipe, plus a thin copy inside a review). Keep the fullest.
  let best = null;
  for (const node of nodes) {
    if (!isA(node, 'recipe')) continue;
    const found = { node, ingredients: ingredientLines(node), ...stepsAndTips(node) };
    found.score = found.ingredients.length + found.steps.length + (lineOf(node.name) ? 1 : 0);
    if (!best || found.score > best.score) best = found;
  }

  const site = siteName(capture, best && best.node, nodes);
  const fallbackUrl = best ? [best.node.url, best.node.mainEntityOfPage, best.node.mainEntityOfPage && best.node.mainEntityOfPage['@id'], best.node['@id']] : [];
  const url = [capture.url, ...fallbackUrl].map(webAddress).find(Boolean) || '';
  const source = { kind: 'web', name: site, url };
  const problems = [];

  if (!best) {
    const title = pageTitle(capture, site);
    problems.push(parsed.some((p) => p.failed) ? 'The recipe data on this page could not be read' : 'No recipe data was found on this page');
    return { recipe: makeRecipe({ title, source, review: true }, now), found: false, problems };
  }

  const title = (lineOf(best.node.name) || lineOf(best.node.headline) || pageTitle(capture, site)).slice(0, MAX_TITLE);
  if (!title) problems.push('No title was found');
  if (!best.ingredients.length) problems.push('No ingredients were found');
  if (!best.steps.length) problems.push('No steps were found');
  else if (best.steps.length === 1 && best.steps[0].length > 400) problems.push('The steps came as one block of text');

  const recipe = makeRecipe({
    title,
    source,
    minutes: minutesOf(best.node),
    serves: servesOf(best.node),
    ingredients: best.ingredients,
    steps: best.steps,
    notes: { source: best.tips.join('\n') },
    review: true,
  }, now);
  return { recipe, found: true, problems };
}

/**
 * Turns a capture into a recipe waiting for review.
 *
 * Returns { recipe, found, problems }. `found` is false when the page carried no recipe data; the
 * recipe is then only a title and a link, for the person to fill in. `problems` are short sentences
 * for the review screen. This never throws, whatever the capture holds.
 *
 * Kept: title, ingredients, steps, total time, servings, the site's name and the link. Tips that a
 * page lists among its steps go to notes.source. The page's story, pictures and ratings are left out.
 */
export function recipeFromCapture(capture, now) {
  const when = typeof now === 'string' && now ? now : new Date().toISOString();
  try {
    return read(capture && typeof capture === 'object' && !Array.isArray(capture) ? capture : {}, when);
  } catch {
    let url = '';
    try {
      url = webAddress(capture.url);
    } catch { /* no link, then */ }
    return {
      recipe: makeRecipe({ source: { kind: 'web', name: hostOf(url), url }, review: true }, when),
      found: false,
      problems: ['This page could not be read'],
    };
  }
}
