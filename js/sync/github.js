// The few GitHub calls syncing needs, for one repository. Nothing here knows about recipes.

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;   // 0 means the request never reached GitHub
  }
}

function toBase64(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesFromBase64(content) {
  const binary = atob(String(content).replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const fromBase64 = (content) => new TextDecoder().decode(bytesFromBase64(content));

/**
 * `fetch` and `api` can be swapped for tests. `token` is a fine-grained key with Contents read and
 * write on this one repository.
 */
export function createClient({ owner, repo, token, fetch: doFetch, api = 'https://api.github.com' }) {
  const send = doFetch || ((url, options) => fetch(url, options));
  const base = api + '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);

  async function call(method, path, body) {
    let response;
    try {
      response = await send(base + path, {
        method,
        cache: 'no-store',
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new GitHubError(0, 'No connection');
    }
    let data = null;
    try { data = await response.json(); } catch (err) { /* some answers have no body */ }
    if (!response.ok) throw new GitHubError(response.status, (data && data.message) || 'GitHub said no');
    return data;
  }

  return {
    /** Basic facts about the repository: its main branch and whether this key may write to it. */
    async about() {
      const data = await call('GET', '');
      return { branch: data.default_branch || 'main', canWrite: !!(data.permissions && data.permissions.push), isPrivate: !!data.private };
    },

    /** The newest commit on the branch and its file tree, or null when the repository is still empty. */
    async head(branch) {
      try {
        const ref = await call('GET', '/git/ref/heads/' + branch);
        const commit = await call('GET', '/git/commits/' + ref.object.sha);
        return { commit: commit.sha, tree: commit.tree.sha };
      } catch (err) {
        if (err.status === 404 || err.status === 409) return null;
        throw err;
      }
    },

    /** Every file in a tree: `files` is Map<path, hash> and `sizes` is Map<path, size in bytes>. */
    async tree(sha) {
      const data = await call('GET', '/git/trees/' + sha + '?recursive=1');
      const files = new Map();
      const sizes = new Map();
      for (const entry of data.tree || []) {
        if (entry.type !== 'blob') continue;
        files.set(entry.path, entry.sha);
        sizes.set(entry.path, entry.size || 0);
      }
      return { files, sizes };
    },

    async blob(sha) {
      const data = await call('GET', '/git/blobs/' + sha);
      return fromBase64(data.content);
    },

    /** A file that is not text, such as a picture, as bytes. */
    async blobBytes(sha) {
      const data = await call('GET', '/git/blobs/' + sha);
      return bytesFromBase64(data.content);
    },

    /** Stores a file that is not text, given as base64, and returns its hash for use in a commit. */
    async createBlob(base64) {
      const data = await call('POST', '/git/blobs', { content: base64, encoding: 'base64' });
      return data.sha;
    },

    /** Writes `entries` on top of `tree` as one commit and returns its hash. The branch is not moved yet. */
    async commit({ parent, tree, entries, message }) {
      const made = await call('POST', '/git/trees', { base_tree: tree, tree: entries });
      const commit = await call('POST', '/git/commits', { message, tree: made.sha, parents: [parent] });
      return commit.sha;
    },

    /** Points the branch at a commit. Fails with status 422 when someone else got there first. */
    async move(branch, sha) {
      await call('PATCH', '/git/refs/heads/' + branch, { sha, force: false });
    },

    /** Puts a first file into an empty repository, which also creates its main branch. */
    async start(path, text, message) {
      await call('PUT', '/contents/' + path, { message, content: toBase64(text) });
    },
  };
}
