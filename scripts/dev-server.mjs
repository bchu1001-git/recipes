#!/usr/bin/env node
// Serves the app together with a stand-in for GitHub, for trying syncing on this computer.
// Nothing leaves the machine and the stand-in forgets everything when this stops.
//
//   node scripts/dev-server.mjs          then open http://localhost:8788
//
// In the browser's console, point the app at the stand-in once:
//   localStorage.setItem('recipes.api', '/fake-github')
// Then connect in Settings with any library name such as  test/library  and the key  test-key

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeGitHub } from '../tests/fake-github.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2]) || 8788;
const hub = fakeGitHub({ token: 'test-key' });
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8',
};

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
      if (path === '/_files') return send(200, Object.fromEntries(hub.files()));
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
