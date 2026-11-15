// Decides when to sync and tells the screens how it went.
// Rhythm: when the app opens, a few seconds after a change, when the app is left, when it comes back
// after an hour or after a failure, and whenever asked.

import { library, subscribe, snapshot, applySync, saveBase, saveLibrary, forgetLibrary } from '../store.js';
import { createClient, GitHubError } from './github.js';
import { syncLibrary } from './sync.js';

/** state: 'off' (no library), 'idle', 'syncing' or 'error'. `at` is the time of the last good sync. */
export const status = { state: 'off', at: null, message: '', sent: 0, received: 0 };

const listeners = new Set();
export function onStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function set(patch) {
  Object.assign(status, patch);
  for (const fn of [...listeners]) fn();
}

// For trying syncing on this computer without GitHub: scripts/dev-server.mjs serves a stand-in, and
// localStorage 'recipes.api' points the app at it. Ignored anywhere but localhost.
function apiBase() {
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return undefined;
  try { return localStorage.getItem('recipes.api') || undefined; } catch (err) { return undefined; }
}

function clientFor(config) {
  return createClient({ owner: config.owner, repo: config.repo, token: config.token, api: apiBase() });
}

/** Turns an error into a sentence someone can act on. */
export function explain(err) {
  if (err instanceof GitHubError) {
    if (err.status === 0) return 'No connection. It will try again when you are back online.';
    if (err.status === 401) return 'GitHub did not accept the key. It may have been cancelled or have expired.';
    if (err.status === 403 || err.status === 404) return 'This key can’t reach that library. Check the library’s name and that the key includes it.';
    return 'GitHub answered: ' + err.message;
  }
  return (err && err.message) || 'Something went wrong.';
}

let running = false;
let again = false;
let unsent = false;
let timer = null;

/** Syncs now. Resolves true when it worked. If a sync is already running, another follows it. */
export async function syncNow() {
  if (!library.config) return false;
  if (running) { again = true; return false; }
  running = true;
  clearTimeout(timer);
  unsent = false;
  set({ state: 'syncing', message: '' });
  let ok = false;
  try {
    const snap = snapshot();
    const out = await syncLibrary({
      client: clientFor(library.config), local: snap, base: library.base,
      device: library.config.device, branch: library.config.branch || 'main',
    });
    await applySync(out, snap);
    await saveBase(out.base);
    set({ state: 'idle', at: Date.now(), message: '', sent: out.sent, received: out.received });
    ok = true;
  } catch (err) {
    unsent = true;
    set({ state: 'error', message: explain(err) });
  }
  running = false;
  if (again) { again = false; return syncNow(); }
  return ok;
}

/** Checks the library and key, remembers them on this device, and does the first sync. */
export async function connect({ owner, repo, token, device }) {
  const config = { owner: owner.trim(), repo: repo.trim(), token: token.trim(), device: device.trim() || 'A device', branch: 'main' };
  const about = await clientFor(config).about();
  if (!about.isPrivate) throw new Error('That repository is public, so anyone could read your recipes. Make it private on GitHub, then connect.');
  if (!about.canWrite) throw new Error('This key can read that library but not change it. It needs Contents set to Read and write.');
  config.branch = about.branch;
  await saveLibrary(config);
  return syncNow();
}

/** Forgets the library and the key. The recipes stay on this device. */
export async function disconnect() {
  clearTimeout(timer);
  await forgetLibrary();
  set({ state: 'off', at: null, message: '', sent: 0, received: 0 });
}

export function startAutoSync() {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (!library.config) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      if (unsent) syncNow();
    } else if (status.state === 'error' || (hiddenAt && Date.now() - hiddenAt > 60 * 60 * 1000)) {
      syncNow();
    }
  });
  addEventListener('online', () => { if (library.config && status.state === 'error') syncNow(); });
  subscribe((why) => {
    if (why !== 'edit' || !library.config) return;
    unsent = true;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 8000);
  });
  if (library.config) {
    set({ state: 'idle' });
    syncNow();
  }
}

/** "just now", "5 min ago", "3 hr ago", then a date. */
export function ago(time) {
  if (!time) return '';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' hr ago';
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
