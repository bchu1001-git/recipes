// A small stand-in for the part of GitHub that syncing uses, kept in memory. The tests give its
// `fetch` to the sync code; scripts/dev-server.mjs serves it over HTTP for trying things in a browser.

import { createHash } from 'node:crypto';

const sha1 = (bytes) => createHash('sha1').update(bytes).digest('hex');
const bytesOf = (content) => (Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8'));
const blobSha = (content) => {
  const body = bytesOf(content);
  return sha1(Buffer.concat([Buffer.from('blob ' + body.length + '\0'), body]));
};

export function fakeGitHub({ token = 'good-key', empty = true, canWrite = true } = {}) {
  const blobs = new Map();    // hash -> the file's bytes (text and pictures alike)
  const trees = new Map();    // hash -> Map<path, blob hash>
  const commits = new Map();  // hash -> { tree, parents, message }
  let head = null;
  let calls = [];
  let beforeMove = null;      // a hook the tests use to slip in another device's commit

  function saveTree(files) {
    const sha = sha1(JSON.stringify([...files].sort()));
    trees.set(sha, new Map(files));
    return sha;
  }
  function saveCommit(tree, parents, message) {
    const sha = sha1(JSON.stringify({ tree, parents, message, n: commits.size }));
    commits.set(sha, { tree, parents, message });
    return sha;
  }
  function keep(content) {
    const body = bytesOf(content);
    const sha = blobSha(body);
    blobs.set(sha, body);
    return sha;
  }
  /** Writes one file (text or a Buffer), or removes it when `content` is null, as a commit of its own. */
  function write(path, content, message) {
    const files = new Map(head ? trees.get(commits.get(head).tree) : []);
    if (content === null) files.delete(path);
    else files.set(path, keep(content));
    head = saveCommit(saveTree(files), head ? [head] : [], message);
    return head;
  }
  /** Replaces everything on the main branch with `files` (path -> text or Buffer), as one commit. */
  function replaceAll(files, message) {
    const next = new Map();
    for (const [path, content] of files) next.set(path, keep(content));
    head = saveCommit(saveTree(next), head ? [head] : [], message);
    return head;
  }
  if (!empty) write('README.md', '# library\n', 'Initial commit');

  function handle(method, path, body, auth) {
    calls.push(method + ' ' + path);
    if (auth !== 'Bearer ' + token) return [401, { message: 'Bad credentials' }];
    let m;
    if (method === 'GET' && path === '') return [200, { default_branch: 'main', private: true, permissions: { push: canWrite } }];
    if (method === 'GET' && path === '/git/ref/heads/main') {
      return head ? [200, { object: { sha: head } }] : [409, { message: 'Git Repository is empty.' }];
    }
    if (method === 'GET' && (m = /^\/git\/commits\/(\w+)$/.exec(path))) {
      const c = commits.get(m[1]);
      return c ? [200, { sha: m[1], tree: { sha: c.tree } }] : [404, { message: 'Not Found' }];
    }
    if (method === 'GET' && (m = /^\/git\/trees\/(\w+)\?recursive=1$/.exec(path))) {
      const t = trees.get(m[1]);
      return t ? [200, { tree: [...t].map(([p, sha]) => ({ path: p, type: 'blob', sha, size: blobs.get(sha).length })) }] : [404, { message: 'Not Found' }];
    }
    if (method === 'GET' && (m = /^\/git\/blobs\/(\w+)$/.exec(path))) {
      const body = blobs.get(m[1]);
      return body === undefined ? [404, { message: 'Not Found' }] : [200, { encoding: 'base64', content: body.toString('base64') }];
    }
    // "Create a blob": how a picture gets in, ahead of the commit that names it.
    if (method === 'POST' && path === '/git/blobs') {
      if (!canWrite) return [403, { message: 'Resource not accessible by personal access token' }];
      if (!body || typeof body.content !== 'string') return [422, { message: 'Invalid request.' }];
      return [201, { sha: keep(body.encoding === 'base64' ? Buffer.from(body.content, 'base64') : body.content) }];
    }
    if (method === 'POST' && path === '/git/trees') {
      if (!head) return [409, { message: 'Git Repository is empty.' }];
      const files = new Map(trees.get(body.base_tree));
      for (const e of body.tree) {
        if (e.sha === null) files.delete(e.path);
        else if (typeof e.content === 'string') files.set(e.path, keep(e.content));
        else if (blobs.has(e.sha)) files.set(e.path, e.sha);
        else return [422, { message: 'tree.sha ' + e.sha + ' is not a valid blob' }];
      }
      return [201, { sha: saveTree(files) }];
    }
    if (method === 'POST' && path === '/git/commits') return [201, { sha: saveCommit(body.tree, body.parents, body.message) }];
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      if (beforeMove) { const hook = beforeMove; beforeMove = null; hook(); }
      if (!canWrite) return [403, { message: 'Resource not accessible by personal access token' }];
      if (commits.get(body.sha).parents[0] !== head) return [422, { message: 'Update is not a fast forward' }];
      head = body.sha;
      return [200, { object: { sha: head } }];
    }
    // "Create a file": what starts an empty library, and what the Save Webpage to Recipes Shortcut calls.
    if (method === 'PUT' && (m = /^\/contents\/(.+)$/.exec(path))) {
      if (!canWrite) return [403, { message: 'Resource not accessible by personal access token' }];
      if (!body || typeof body.content !== 'string' || !body.message) return [422, { message: 'Invalid request.' }];
      // Like GitHub, it refuses to replace a file unless the call names the version being replaced.
      if (head && trees.get(commits.get(head).tree).has(m[1]) && !body.sha) return [422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }];
      write(m[1], Buffer.from(body.content, 'base64'), body.message);
      return [201, { content: { name: m[1].split('/').pop(), path: m[1] }, commit: { sha: head } }];
    }
    return [404, { message: 'Not Found' }];
  }

  return {
    /** Shaped like the browser's fetch, for the sync client. */
    async fetch(url, options = {}) {
      const path = String(url).replace(/^.*\/repos\/[^/]+\/[^/?]+/, '');
      const [status, data] = handle(options.method || 'GET', path, options.body ? JSON.parse(options.body) : null, options.headers && options.headers.Authorization);
      return { ok: status >= 200 && status < 300, status, json: async () => data };
    },
    handle,
    /** The files on the main branch as Map<path, text>. */
    files() {
      const out = new Map();
      if (head) for (const [p, sha] of trees.get(commits.get(head).tree)) out.set(p, blobs.get(sha).toString('utf8'));
      return out;
    },
    /** The files on the main branch as Map<path, Buffer>, for the ones that are not text. */
    snapshot() {
      const out = new Map();
      if (head) for (const [p, sha] of trees.get(commits.get(head).tree)) out.set(p, blobs.get(sha));
      return out;
    },
    replaceAll,
    history() {
      const out = [];
      for (let c = head; c; c = commits.get(c).parents[0]) out.push(commits.get(c).message);
      return out;
    },
    write,
    onNextMove(fn) { beforeMove = fn; },
    calls: () => calls,
    forgetCalls() { calls = []; },
  };
}
