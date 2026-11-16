#!/usr/bin/env node
// The importer: reads the pictures waiting in a library and turns them into recipes to review.
//
//   node importer/run.mjs <folder holding a checkout of the library>
//
// A library runs this from its workflow (.github/workflows/import.yml) whenever the app sends it
// pictures. It needs Node 20 or later and nothing else: no packages are installed.
//
//   GEMINI_API_KEY     the key for the AI reader, from the library's secret of that name
//   RECIPES_READER     which reader to use: "gemini" (the default) or "fake" (a stand-in, for tests)
//   RECIPES_NO_PUSH    set to leave the changes in the folder without committing them
//
// It ends with an error only when the library could not be written to. A job that could not be read
// is not an error here: the reason is written into the job, where the app shows it.

import { resolve } from 'node:path';
import { processJobs, summary, JobError } from './jobs.mjs';
import { commitAndPush } from './git.mjs';

const READERS = { gemini: './readers/gemini.mjs', fake: './readers/fake.mjs' };

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('The importer needs Node 20 or later. This is Node ' + process.versions.node + '.');
  const dir = resolve(process.argv[2] || '.');
  const which = process.env.RECIPES_READER || 'gemini';
  if (!READERS[which]) throw new Error('There is no reader called "' + which + '".');
  const reader = await import(READERS[which]);
  const key = process.env.GEMINI_API_KEY || '';

  const read = async ({ pictures, kind, shared }) => {
    if (which === 'gemini' && !key) {
      throw new JobError('The library has no key for the AI service. Add it as a secret named GEMINI_API_KEY: Settings, Read photos, in the app.');
    }
    return reader.read({ pictures, kind, key, shared });
  };

  const out = await processJobs(dir, { read });
  const line = summary(out);
  console.log(line + ' (reader: ' + reader.name + ')');
  for (const failed of out.failed) console.log('  not read: ' + failed.reason);

  if (process.env.RECIPES_NO_PUSH) return;
  const pushed = await commitAndPush(dir, line);
  console.log(pushed ? 'The changes are in the library.' : 'Nothing changed.');
}

main().catch((err) => {
  console.error(String((err && err.message) || err));
  process.exitCode = 1;
});
