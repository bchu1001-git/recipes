// Sending a recipe to someone as a link. The whole recipe travels inside the link, in the part after
// "#", which a browser never sends to a server, so nothing is stored anywhere for it. This file holds
// the rules with no screen in them: what travels, how it is packed into a link and unpacked again,
// and the recipe data that the page showing a sent recipe carries, so that the Save to Recipes
// Shortcut can keep it like any other recipe page.
//
// A link is   <the app's address>#/s/<form>.<text>
//   form "z": the recipe as JSON, squeezed (deflate) and written in URL-safe base64
//   form "j": the same without the squeeze, for a browser that cannot squeeze
//
// The JSON uses short names to keep the link short. Anything empty is left out:
//   { v: 1, t: title, i: [ingredient lines], s: [step lines], m: minutes, y: serves, n: notes,
//     f: { n: where it came from, u: its link } }
// Headings travel as they are written: a line that ends with a colon. Folders, the heart, the rating
// and pictures do not travel.
//
// Whatever a link holds was written by someone else, so it is only ever treated as text.

import { webLink } from './model.js';

export const LINK_LONG = 6000;          // characters past which some apps cut a link short

const MAX_PAYLOAD = 400000;             // characters of a link's text that will be looked at
const MAX_JSON = 1000000;               // bytes a link may unpack to
const MAX_LINES = 300;
const MAX_LINE = 3000;
const MAX_TITLE = 200;
const MAX_SHORT = 80;
const MAX_NOTES = 20000;
const MAX_MINUTES = 100000;

const BROKEN = 'This link is not complete. It may have been cut short on the way. Ask for it to be sent again.';
const NEWER = 'This link was made by a newer version of Recipes. Update the app, then open the link again.';
const TOO_OLD = 'This browser cannot open the link. Open it in Safari or another up-to-date browser.';

// ---------- what travels ----------

const text = (value, most) => (typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, most)
  : '');

const oneLine = (value, most) => text(value, most).replace(/\s+/g, ' ');

/** The recipe in a link, checked and tidied: the right kinds of thing, within limits. Null when it holds no recipe. */
function tidy(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1) return null;
  const lines = (list) => (Array.isArray(list) ? list : []).slice(0, MAX_LINES).map((l) => oneLine(l, MAX_LINE)).filter(Boolean);
  const from = data.f && typeof data.f === 'object' && !Array.isArray(data.f) ? data.f : {};
  const out = {
    v: 1,
    t: oneLine(data.t, MAX_TITLE),
    i: lines(data.i),
    s: lines(data.s),
    m: typeof data.m === 'number' && data.m > 0 && data.m <= MAX_MINUTES ? Math.round(data.m) : 0,
    y: oneLine(data.y, MAX_SHORT),
    n: text(data.n, MAX_NOTES),
    f: { n: oneLine(from.n, MAX_SHORT), u: webLink(oneLine(from.u, 2000)) },
  };
  return out.t || out.i.length || out.s.length ? out : null;
}

/**
 * What is sent of a recipe: its title, ingredient and step lines as written (headings included), time,
 * servings, where it came from, and its notes. The person's own notes go along only when `myNotes` is
 * true. Null when the recipe has nothing in it to send.
 */
export function sentRecipe(recipe, { myNotes = true } = {}) {
  const r = recipe || {};
  const notes = r.notes || {};
  const source = r.source || {};
  return tidy({
    v: 1,
    t: r.title,
    i: (r.ingredients || []).map((x) => x && x.text),
    s: (r.steps || []).map((x) => x && x.text),
    m: r.minutes || 0,
    y: r.serves,
    n: [text(notes.source, MAX_NOTES), myNotes ? text(notes.mine, MAX_NOTES) : ''].filter(Boolean).join('\n\n'),
    f: { n: source.name, u: source.url },
  });
}

/** The same recipe with everything empty left out, so the link is no longer than it has to be. */
function lean(data) {
  const out = { v: 1 };
  if (data.t) out.t = data.t;
  if (data.i.length) out.i = data.i;
  if (data.s.length) out.s = data.s;
  if (data.m) out.m = data.m;
  if (data.y) out.y = data.y;
  if (data.n) out.n = data.n;
  if (data.f.n || data.f.u) {
    out.f = {};
    if (data.f.n) out.f.n = data.f.n;
    if (data.f.u) out.f.u = data.f.u;
  }
  return out;
}

// ---------- packing and unpacking ----------

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch (err) {
    return null;
  }
}

async function squeeze(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (err) {
    return null;
  }
}

/** The bytes unsqueezed, or null if they are not whole or would come out larger than `most`. */
async function unsqueeze(bytes, most) {
  try {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > most) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
    return out;
  } catch (err) {
    return null;
  }
}

/** Packs what `sentRecipe` gave into the text that goes after "#/s/". `squeezed: false` skips the squeeze. */
export async function pack(data, { squeezed = true } = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(lean(data)));
  const small = squeezed ? await squeeze(bytes) : null;
  return small && small.length < bytes.length ? 'z.' + toBase64Url(small) : 'j.' + toBase64Url(bytes);
}

/**
 * Unpacks the text after "#/s/". Resolves { ok: true, data } with the recipe in the shape described at
 * the top of this file, every field present, or { ok: false, reason } with a sentence for the person.
 * It never throws, whatever it is given.
 */
export async function unpack(payload) {
  const fail = (reason) => ({ ok: false, reason });
  try {
    const whole = typeof payload === 'string' ? payload.trim() : '';
    const parts = /^([zj])\.([A-Za-z0-9_-]+)$/.exec(whole);
    if (!parts || whole.length > MAX_PAYLOAD) return fail(BROKEN);
    let bytes = fromBase64Url(parts[2]);
    if (!bytes) return fail(BROKEN);
    if (parts[1] === 'z') {
      if (typeof DecompressionStream !== 'function') return fail(TOO_OLD);
      bytes = await unsqueeze(bytes, MAX_JSON);
      if (!bytes) return fail(BROKEN);
    }
    if (bytes.length > MAX_JSON) return fail(BROKEN);
    let data = null;
    try {
      data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (err) {
      return fail(BROKEN);
    }
    if (data && typeof data === 'object' && typeof data.v === 'number' && data.v > 1) return fail(NEWER);
    const recipe = tidy(data);
    return recipe ? { ok: true, data: recipe } : fail(BROKEN);
  } catch (err) {
    return fail(BROKEN);
  }
}

/** The whole link: where the app is served, then the packed recipe. A file name such as index.html is dropped. */
export function shareLink(appAddress, packed) {
  return String(appAddress || '').replace(/[?#].*$/, '').replace(/[^/]*$/, '') + '#/s/' + packed;
}

// ---------- the recipe data on the page that shows a sent recipe ----------

/**
 * schema.org Recipe data for a sent recipe, for the ld+json block on the page that shows it. The Save
 * to Recipes Shortcut reads it like any recipe page's. `sentFrom` is this app's own addition: where
 * the recipe first came from and the notes that travelled with it. The reader (js/import/page.js)
 * takes the source from there, because the address of the page itself is only the link it was sent in.
 */
export function recipeData(data) {
  const out = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: data.t,
    recipeIngredient: data.i,
    recipeInstructions: data.s,
  };
  if (data.m) out.totalTime = 'PT' + data.m + 'M';
  if (data.y) out.recipeYield = data.y;
  out.sentFrom = { name: data.f.n, url: data.f.u, notes: data.n };
  return out;
}
