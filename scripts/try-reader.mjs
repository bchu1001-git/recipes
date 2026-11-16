#!/usr/bin/env node
// Tries the AI reader on pictures on this computer, the same way the importer uses it in a library.
//
//   node scripts/try-reader.mjs picture1.jpg [picture2.png ...]
//
// The pictures named are sent together, as the pages of one recipe, and what came back is printed:
// first as the reader gave it, then as the recipe the app would show under To review.
//
// The key is read from the file .env in the project folder, from a line that says GEMINI_API_KEY=...
// That file is never published and the key is never printed.

import { readFile } from 'node:fs/promises';
import { extname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as reader from '../importer/readers/gemini.mjs';
import { recipeFromReading } from '../importer/reading.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif' };

async function keyFromEnvFile() {
  let text = '';
  try {
    text = await readFile(join(root, '.env'), 'utf8');
  } catch (err) {
    return '';
  }
  for (const line of text.split(/\r?\n/)) {
    const found = /^\s*(?:export\s+)?GEMINI_API_KEY\s*=\s*(.*?)\s*$/.exec(line);
    if (found) return found[1].replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('Name one or more pictures: node scripts/try-reader.mjs picture1.jpg picture2.jpg');
  const key = (await keyFromEnvFile()) || process.env.GEMINI_API_KEY || '';
  if (!key) throw new Error('No key found. Put a line GEMINI_API_KEY=... into the file .env in the project folder.');

  const pictures = [];
  for (const file of files) {
    const type = TYPES[extname(file).toLowerCase()];
    if (!type) throw new Error('Not a kind of picture this can send: ' + file);
    pictures.push({ data: await readFile(file), type });
  }

  const started = Date.now();
  const reading = await reader.read({ pictures, key });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const { recipe, empty } = recipeFromReading(reading, { id: 'rptry', kind: 'photo', by: 'This computer', now: new Date().toISOString(), originals: [] });

  console.log(reader.name + ' (' + reader.MODEL + ') answered in ' + seconds + ' seconds for ' + pictures.length + (pictures.length === 1 ? ' picture.' : ' pictures.'));
  console.log('\n--- as the reader gave it ---');
  console.log(JSON.stringify(reading, null, 2));
  console.log('\n--- as the app would show it ---');
  if (empty) console.log('(no recipe was found in the pictures)');
  console.log('Title:   ' + (recipe.title || '(none)'));
  console.log('Source:  ' + (recipe.source.name || '(none)'));
  console.log('Time:    ' + (recipe.minutes ? recipe.minutes + ' min' : '(none)'));
  console.log('Serves:  ' + (recipe.serves || '(none)'));
  console.log('Ingredients (' + recipe.ingredients.filter((i) => !i.heading).length + '):');
  for (const ing of recipe.ingredients) console.log(ing.heading ? '  ' + ing.text : '    ' + ing.text);
  console.log('Steps (' + recipe.steps.filter((s) => !s.heading).length + '):');
  let n = 0;
  for (const step of recipe.steps) console.log(step.heading ? '  ' + step.text : '    ' + (++n) + '. ' + step.text);
  if (recipe.notes.source) console.log('Notes:\n    ' + recipe.notes.source.replace(/\n/g, '\n    '));
}

main().catch((err) => {
  console.error(String((err && err.message) || err));
  process.exitCode = 1;
});
