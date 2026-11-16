// Reads a recipe out of pictures with Google's Gemini, on its free tier.
//
// A reader is a module with a `name` and one function:
//
//   read({ pictures: [{ data: Buffer, type: 'image/jpeg' or 'image/png' }], kind, key, shared })
//     -> { title, titleSuggested, ingredients: [line], steps: [line], notes, time, serves, source, unsure: [line] }
//
// `unsure` lists the ingredient lines and steps the reader was not sure it read right, for the review
// screen to point out. `titleSuggested` is true when the pictures showed no name for the recipe and
// the reader made the title from other words in them. Both may be left out.
//
// A group of ingredients, or a section of the method, is a line of its own that ends with a colon
// ("For the sauce:"), which is the app's rule for a heading. It rejects with a JobError, whose message
// is a sentence for the person, when the service refuses or its answer cannot be used. Another service can take this one's place by offering the same
// function; run.mjs picks the reader by name.
//
// The key goes to Google in a header and nowhere else. It is never logged or put into an error.

import { JobError } from '../jobs.mjs';

export const name = 'Gemini';

// The one place the model is named. It has to be one the free tier offers and one that takes pictures.
// This is Google's own name for "the newest small, fast model", so it goes on working when one model
// is retired and the next takes its place. The larger models were tried on the same pictures and took
// minutes where this one takes seconds, for the same answer.
export const MODEL = 'gemini-flash-lite-latest';
export const THINKING = '';   // how long the model may think before it answers: '' leaves that to the model
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const REVISION = '2026-05-20';   // the version of the request format below, as Google's examples send it

export const INSTRUCTION = [
  'You are copying a recipe out of pictures so that a person can cook from it. The pictures are screenshots of recipe websites or apps, captions of social media posts, or photographed pages of cookbooks and magazines. When there are several pictures they are parts of ONE recipe. They are usually in order but may not be, and they often overlap: use the step numbers, the headings and the overlap to put everything in the order of the recipe.',
  '',
  'Copy what is written. Do not add, guess, convert, translate, correct or improve anything.',
  '',
  '- title: the name of the recipe as it is written in the pictures. If the pictures do not show a name for the recipe as a whole, leave this empty.',
  '- suggested_title: only when title is empty: a short name for the dish made only from words that appear in the pictures, such as the names of its parts joined by "with" or "and". Otherwise empty.',
  '- ingredients: a list of groups, each with a heading and its lines. If the ingredients are not grouped, give one group with an empty heading. If they are grouped under headings such as "For the sauce" or "Topping", give one group for each heading, with the heading as written. The lines of a group are its ingredient lines, one entry each, exactly as written and in the same order: the amount, the unit, the ingredient, and any note such as "finely chopped". An ingredient that wraps onto a second line is one entry. Leave off the bullet, dash or tick box in front. Keep fractions and units as they are written: a fraction character such as ½ stays that character, and nothing is converted.',
  '- steps: a list of groups in the same way. If the method is not divided into sections, give one group with an empty heading. The lines of a group are its steps, one entry each, in order and in the original words, without the number or bullet in front. If the method is written as one paragraph, split it into steps where a new action begins, keeping the words. A paragraph of advice that sits among the steps, such as one that starts with "Note" or "Tip", is not a step: put it in notes.',
  '- Take in every ingredient line and every step that the pictures show. A picture may begin or end in the middle of a list, with the heading above it out of view. Those lines still belong to the recipe: put them in the group they continue, or in a group with an empty heading if that cannot be told. Never leave a visible line out because it seems to belong to another part of the dish.',
  '- Where two pictures overlap, the lines they both show are the same lines: take them once. A line cut in half at the edge of one picture is usually whole in the other. But a line that the recipe really has twice, such as the same seasoning in two groups, stays in both places.',
  '- notes: tips, storage advice, substitutions or variations that are written with the recipe, in the original words. Empty if there are none.',
  '- time: the total time as written, such as "45 minutes", and only if a time is stated. Do not work one out.',
  '- serves: the number of servings or the yield as written, and only if it is stated.',
  '- source: where the recipe is from, and only if that is visible: the title of a cookbook, the name of a website (a browser shows it in its address bar), or an account name. Otherwise empty.',
  '- unsure: the ingredient lines and steps, repeated exactly as you gave them above, in which a word, a number or an amount was blurred, cut off, covered, or could be read in two ways. Empty if everything was clear. Do not list a line only because it is unusual.',
  '',
  'Leave out everything that is not the recipe: the story around it, comments, likes, hashtags, emoji, advertisements, menus, buttons, switches between units, tick boxes and page numbers.',
  'Keep the language of the original. If a word is partly covered but there is no doubt what it is, write the word. If it cannot be told, copy what can be read and do not fill in the rest.',
  'If the pictures do not show a recipe, answer with empty text and empty lists.',
].join('\n');

// Added to the instruction only for pictures that were shared from another app (see unpack.mjs).
// A note shared from a notes app comes as its pictures plus one more: a picture of the note itself.
// Pictures sent from the app's own screen never have such a page, and their instruction stays as it is.
export const NOTE_PAGE = 'One of the pictures may be a page from a notes app that shows the whole note the other pictures were kept in: a line of text at the top, perhaps a few typed lines, and copies of the other pictures, which may be smaller or cut off at the edge of the page. The line at the top of that page is the name the person gave the recipe: use it as the title. Typed lines on that page that are not part of the ingredients or the method are the person\u2019s own notes: put them in notes. The copies on that page show the same recipe as the other pictures, so read the recipe from the other pictures and do not take the copies as a second lot of ingredients or steps.';

// The model is asked for groups with headings, so that a group never depends on how a heading was
// printed. read() then writes each heading as a line ending in a colon, which is what a reader returns.
const text = { type: 'string' };
const groups = {
  type: 'array',
  items: { type: 'object', properties: { heading: text, lines: { type: 'array', items: text } }, required: ['heading', 'lines'] },
};
export const SCHEMA = {
  type: 'object',
  properties: { title: text, suggested_title: text, ingredients: groups, steps: groups, notes: text, time: text, serves: text, source: text, unsure: { type: 'array', items: text } },
  required: ['title', 'suggested_title', 'ingredients', 'steps', 'notes', 'time', 'serves', 'source', 'unsure'],
};

/** Groups with headings as one list of lines, each heading a line of its own that ends with a colon. */
function flat(list) {
  const out = [];
  for (const entry of Array.isArray(list) ? list : []) {
    if (typeof entry === 'string') { out.push(entry); continue; }   // a plain line, should the model give one
    if (!entry || typeof entry !== 'object') continue;
    const heading = typeof entry.heading === 'string' ? entry.heading.replace(/[\s:]+$/, '').trim() : '';
    if (heading) out.push(heading + ':');
    for (const line of Array.isArray(entry.lines) ? entry.lines : []) if (typeof line === 'string') out.push(line);
  }
  return out;
}

/**
 * The body of the request for these pictures. `thinking` sets how long the model may think first, if
 * given. `shared` says the pictures were shared from another app, where one may be a page of a note.
 */
export function request({ pictures, model = MODEL, thinking = THINKING, shared = false }) {
  return {
    model,
    ...(thinking ? { generation_config: { thinking_level: thinking } } : {}),
    system_instruction: shared ? INSTRUCTION + '\n\n' + NOTE_PAGE : INSTRUCTION,
    input: [
      { type: 'text', text: pictures.length === 1 ? 'Here is the picture.' : 'Here are the ' + pictures.length + ' pictures of the one recipe.' },
      ...pictures.map((p) => ({ type: 'image', data: Buffer.from(p.data).toString('base64'), mime_type: p.type || 'image/jpeg' })),
    ],
    response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
    store: false,   // nothing is kept on Google's side for a later turn; there is no later turn
  };
}

/** The text the model wrote, wherever this version of the service puts it. */
function writtenIn(data) {
  if (typeof data.output_text === 'string' && data.output_text) return data.output_text;
  const parts = [];
  for (const step of Array.isArray(data.steps) ? data.steps : []) {
    if (!step || step.type !== 'model_output' || !Array.isArray(step.content)) continue;
    for (const piece of step.content) if (piece && piece.type === 'text' && typeof piece.text === 'string') parts.push(piece.text);
  }
  for (const piece of Array.isArray(data.outputs) ? data.outputs : []) {
    if (piece && piece.type === 'text' && typeof piece.text === 'string') parts.push(piece.text);
  }
  return parts.join('');
}

/** What the service's answer says, as the plain data a reader returns. Throws a JobError if it says nothing usable. */
export function answerOf(data) {
  if (!data || typeof data !== 'object') throw new JobError('The AI service gave an answer that could not be understood.');
  if (data.status && data.status !== 'completed') {
    const why = Array.isArray(data.errors) && data.errors[0] && data.errors[0].message;
    throw new JobError('The AI service did not finish reading' + (why ? ': ' + String(why).slice(0, 160) : '.'));
  }
  const written = writtenIn(data).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const from = written.indexOf('{');
  const to = written.lastIndexOf('}');
  let reading = null;
  try {
    reading = JSON.parse(from >= 0 && to > from ? written.slice(from, to + 1) : written);
  } catch (err) { /* reported below */ }
  if (!reading || typeof reading !== 'object' || Array.isArray(reading)) throw new JobError('The AI service gave an answer that could not be understood.');
  // A title the pictures did not show, made from other words in them, is passed on marked as a suggestion.
  const { suggested_title: offered, ...rest } = reading;
  const named = typeof reading.title === 'string' ? reading.title.trim() : '';
  const suggested = typeof offered === 'string' ? offered.trim() : '';
  return {
    ...rest,
    title: named || suggested,
    ...(!named && suggested ? { titleSuggested: true } : {}),
    ingredients: flat(reading.ingredients),
    steps: flat(reading.steps),
  };
}

function refusal(status, data) {
  const said = data && data.error && typeof data.error.message === 'string' ? data.error.message : data && typeof data.message === 'string' ? data.message : '';
  const tail = said ? ' It said: ' + said.replace(/\s+/g, ' ').slice(0, 160) : '';
  if (status === 401 || status === 403) return 'The AI service did not accept the key. Check the GEMINI_API_KEY secret in the library.' + tail;
  if (status === 404) return 'The AI service does not know the model this app asks for, so the app needs an update.' + tail;
  if (status === 429) return 'The free AI service is at its limit for now. Try again in a while.';
  if (status >= 500) return 'The AI service had a problem of its own. Try again in a while.';
  return 'The AI service did not accept the request.' + tail;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends the pictures and returns what was read. `fetch` and `wait` can be swapped for tests.
 * A busy service is asked once more after a pause, and no more than that.
 */
export async function read({ pictures, key, shared = false, fetch: send = fetch, model = MODEL, thinking = THINKING, wait = 15000 }) {
  if (!key) throw new JobError('There is no key for the AI service.');
  const body = JSON.stringify(request({ pictures, model, thinking, shared }));
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await send(ENDPOINT, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json', 'Api-Revision': REVISION },
        body,
        signal: AbortSignal.timeout(180000),
      });
    } catch (err) {
      throw new JobError('The AI service could not be reached, or took too long to answer.');
    }
    let data = null;
    try { data = await response.json(); } catch (err) { /* an answer with no body */ }
    if (response.ok) return answerOf(data);
    if (attempt === 1 && (response.status === 429 || response.status === 500 || response.status === 503)) { await pause(wait); continue; }
    throw new JobError(refusal(response.status, data));
  }
}
