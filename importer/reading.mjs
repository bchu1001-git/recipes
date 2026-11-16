// Turns what a reader says it saw in the pictures into a recipe waiting for review.
//
// A reader (see readers/) answers with plain data:
//
//   { title, titleSuggested, ingredients: [line], steps: [line], notes, time, serves, source, unsure: [line] }
//
// A group of ingredients or a section of the method is a line of its own that ends with a colon
// ("For the salsa:"), which is the app's rule for a heading. Whatever the picture did not show is
// left empty: nothing is filled in here. `unsure` names the lines the reader was not sure it read
// right, and `titleSuggested` says the pictures showed no name and the reader made the title from other
// words in them. Both are kept on the recipe for as long as it waits for review, so the review screen
// can point them out, and are dropped when it is kept.
//
// The answer came out of an AI service looking at a picture, so every part of it is treated as
// untrusted text: tags and entities are taken out with the same code that cleans a saved web page,
// sizes are capped, and anything that is not text is dropped.

import { makeRecipe, isHeading, headingLabel } from '../js/model.js';
import { plainLines, tidyYield } from '../js/import/page.js';

const MAX_LINES = 300;      // ingredients or steps kept
const MAX_LINE = 3000;      // characters kept from one of them
const MAX_TITLE = 200;
const MAX_SHORT = 80;       // where it came from, how many it serves, how long it takes
const MAX_NOTES = 6000;
const MAX_UNSURE = 40;

const one = (value, max) => (typeof value === 'string' || typeof value === 'number' ? plainLines(String(value)).join(' ').slice(0, max) : '');

/** A list of lines out of a list, or out of one block of text with a line for each. */
function lines(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const out = [];
  for (const entry of list) {
    if (typeof entry !== 'string' && typeof entry !== 'number') continue;
    for (const line of plainLines(String(entry))) {
      if (out.length >= MAX_LINES) return out;
      out.push(line.slice(0, MAX_LINE));
    }
  }
  return out;
}

// A name or a source is words. Whatever little pictures were mixed in with them are taken out.
const wordsOnly = (text) => text.replace(/[\p{Extended_Pictographic}\u{fe0f}\u{200d}]/gu, '').replace(/\s+/g, ' ').trim();

// A bullet, a dash or a tick box copied from in front of an ingredient is taken off.
const unbulleted = (line) => line.replace(/^[-*\u2022\u2013\u2014\u00b7\u25a2\u2610\u25a1\u25cb\u25e6]\s+/, '').trim();

// The page numbers its own steps, so a number or a bullet copied from the picture is taken off.
const unnumbered = (line) => line.replace(/^(?:step\s*\d{1,2}\s*[.):-]?|\d{1,2}\s*[.)]|[-*•–])\s+/i, '').trim();

// Group names that say what a part is for, not what it is. They never make a title.
const NOT_A_NAME = /^(?:to\s|serving\b|garnish|toppings?\b|optional\b|notes?\b|assembly\b|extras?\b|other\b)/i;
const bare = (name) => name.replace(/^for\s+(?:the\s+)?/i, '').replace(/[\s:]+$/, '').trim();

/** The names of the groups of ingredients and the sections of the method that could name a dish, each once, in order. */
function groupNames(lists) {
  const names = [];
  for (const line of lists.flat()) {
    if (!isHeading(line)) continue;
    const name = bare(headingLabel(line));
    if (name && !NOT_A_NAME.test(name) && !names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names;
}

/**
 * A recipe's title, and whether it is only a suggestion.
 *
 * What the person typed when sending the pictures always wins. Pictures of a recipe often leave its
 * name out: a screenshot starts part way down a page. A reader then tends to give the first group's
 * name as the title, but the name of one part is not the name of the dish. When the title is just one
 * of several group names, it is made from those names instead ("Roast Squash with Herb Yoghurt") and marked as a
 * suggestion for the person to check. A reader may also offer a suggestion of its own. Either way only
 * words that were in the pictures are used, and with nothing to go on the title stays empty.
 */
function titleOf(said, typed, ingredients, steps) {
  const own = one(typed, MAX_TITLE);
  if (own) return { title: own, suggested: false };
  const given = wordsOnly(one(said.title, MAX_TITLE));
  const names = groupNames([ingredients, steps]);
  if (given && names.length > 1 && names.some((n) => n.toLowerCase() === bare(given).toLowerCase())) {
    const few = names.slice(0, 3);
    const joined = few.length <= 2 ? few.join(' with ') : few.slice(0, -1).join(', ') + ' and ' + few[few.length - 1];
    return { title: (joined[0].toUpperCase() + joined.slice(1)).slice(0, MAX_TITLE), suggested: true };
  }
  return { title: given, suggested: said.titleSuggested === true && !!given };
}

/**
 * Returns { recipe, empty }. `empty` is true when the reader found no ingredient and no step, which
 * means there was no recipe in the pictures to speak of.
 *
 * The job gives the recipe its id, the kind of picture ('photo' or 'screenshot'), who sent it, the
 * paths its pictures are kept under, and the title the person typed when sending, if any.
 */
export function recipeFromReading(reading, { id, kind, by, now, originals, title: typed }) {
  const said = reading && typeof reading === 'object' && !Array.isArray(reading) ? reading : {};
  const ingredients = lines(said.ingredients).map(unbulleted).filter(Boolean);
  const steps = lines(said.steps).map(unnumbered).filter(Boolean);
  const { title, suggested } = titleOf(said, typed, ingredients, steps);
  const unsure = [...new Set(lines(said.unsure).map(unnumbered).filter(Boolean))].slice(0, MAX_UNSURE);
  const recipe = makeRecipe({
    id,
    title,
    source: { kind: kind === 'screenshot' ? 'screenshot' : 'photo', name: wordsOnly(one(said.source, MAX_SHORT)), url: '' },
    minutes: one(said.time, MAX_SHORT),
    serves: tidyYield(one(said.serves, MAX_SHORT)).slice(0, MAX_SHORT),
    ingredients,
    steps,
    notes: { source: lines(said.notes).join('\n').slice(0, MAX_NOTES) },
    originals: Array.isArray(originals) ? originals : [],
    review: true,
    by: typeof by === 'string' ? by : '',
    ...(unsure.length ? { unsure } : {}),
    ...(suggested ? { titleSuggested: true } : {}),
  }, now);
  const read = [...recipe.ingredients, ...recipe.steps].filter((line) => !line.heading).length;
  return { recipe, empty: read === 0 };
}
