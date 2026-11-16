#!/usr/bin/env node
// Serves the app together with a stand-in for GitHub, for trying syncing on this computer.
// Nothing leaves the machine and the stand-in forgets everything when this stops.
//
//   node scripts/dev-server.mjs          then open http://localhost:8788
//
// In the browser's console, point the app at the stand-in once:
//   localStorage.setItem('recipes.api', '/fake-github')
// Then connect in Settings with any library name such as  test/library  and the key  test-key
//
// The stand-in can also play the part of a library's importer, which on GitHub runs by itself when
// pictures arrive. Here it is asked for: POST /fake-github/_import reads the waiting pictures with a
// made-up reader, POST /fake-github/_import?real=1 uses the real AI reader with the key in .env, and
// POST /fake-github/_import?fail=Some+reason makes the reading fail with that reason. Adding untitled=1
// makes the reader find no name for the recipe, as with a screenshot that starts part way down a page.

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeGitHub } from '../tests/fake-github.js';
import { processJobs, summary, JobError } from '../importer/jobs.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2]) || 8788;
const hub = fakeGitHub({ token: 'test-key' });
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8',
};

async function everyFile(dir, under = dir, out = new Map()) {
  for (const entry of await readdir(under, { withFileTypes: true })) {
    const full = join(under, entry.name);
    if (entry.isDirectory()) await everyFile(dir, full, out);
    else out.set(relative(dir, full).split(sep).join('/'), await readFile(full));
  }
  return out;
}

/** Does what a library's workflow does on GitHub: runs the importer over the library and commits the result. */
async function runImporter(real, fail, untitled) {
  const dir = await mkdtemp(join(tmpdir(), 'recipes-import-'));
  try {
    for (const [path, bytes] of hub.snapshot()) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), bytes);
    }
    // Loaded afresh each time, so a change to the reader is picked up without starting this again.
    const reader = await import((real ? '../importer/readers/gemini.mjs' : '../importer/readers/fake.mjs') + '?' + Date.now());
    let key = '';
    if (real) {
      const env = await readFile(join(root, '.env'), 'utf8').catch(() => '');
      key = (/^\s*GEMINI_API_KEY\s*=\s*(.*?)\s*$/m.exec(env) || [])[1] || '';
    }
    const out = await processJobs(dir, { read: async ({ pictures, kind }) => {
      if (fail) throw new JobError(fail);
      if (real && !key) throw new JobError('The library has no key for the AI service.');
      const reading = await reader.read({ pictures, kind, key });
      return untitled ? { ...reading, title: '', titleSuggested: false } : reading;
    } });
    if (out.read.length || out.failed.length || out.cleared.length) hub.replaceAll(await everyFile(dir), summary(out));
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

createServer(async (req, res) => {
  const send = (status, body, type) => {
    res.writeHead(status, { 'Content-Type': type || 'application/json', 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/fake-github/')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      const path = url.pathname.slice('/fake-github'.length) + url.search;
      // Three extras for looking inside the stand-in and for pretending to be another device.
      if (path === '/_files') {
        const files = {};
        for (const [name, bytes] of hub.snapshot()) files[name] = /\.(jpg|jpeg|png)$/i.test(name) ? '(a picture, ' + bytes.length + ' bytes)' : bytes.toString('utf8');
        return send(200, files);
      }
      if (path.startsWith('/_import') && req.method === 'POST') return send(200, await runImporter(url.searchParams.has('real'), url.searchParams.get('fail'), url.searchParams.has('untitled')));
      if (path === '/_history') return send(200, hub.history());
      if (path === '/_write' && req.method === 'POST') {
        const change = JSON.parse(body);
        hub.write(change.path, change.text, change.message || 'Another device');
        return send(200, { ok: true });
      }
      const call = /^\/repos\/[^/]+\/[^/?]+(.*)$/.exec(path);
      if (!call) return send(404, { message: 'Not Found' });
      const [status, data] = hub.handle(req.method, call[1], body ? JSON.parse(body) : null, req.headers.authorization);
      return send(status, data);
    }
    const file = resolve(join(root, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (file !== root && !file.startsWith(root + sep)) return send(403, 'Forbidden', 'text/plain');
    return send(200, await readFile(file), TYPES[extname(file)] || 'application/octet-stream');
  } catch (err) {
    return send(err.code === 'ENOENT' || err.code === 'EISDIR' ? 404 : 500, 'Not found', 'text/plain');
  }
}).listen(port, '127.0.0.1', () => {
  console.log('Recipes with a stand-in for GitHub: http://localhost:' + port);
});
