// Decides when to sync and tells the screens how it went.
// Rhythm: when the app opens, a few seconds after a change, when the app is left, when it comes back
// after an hour or after a failure, and whenever asked.

import { state, library, subscribe, snapshot, applySync, saveBase, saveLibrary, forgetLibrary, dropQueued, dropJobActions } from '../store.js';
import { createClient, GitHubError } from './github.js';
import { syncLibrary } from './sync.js';

/**
 * state: 'off' (no library), 'idle', 'syncing' or 'error'. `at` is the time of the last good sync.
 * `toReview` is how many recipes that sync brought to this device to be reviewed. `scriptNote` is
 * true on the one sync that first notices a Shortcut saving pages with an out-of-date script.
 */
export const status = { state: 'off', at: null, message: '', sent: 0, received: 0, toReview: 0, scriptNote: false };

// Whether the last page this device turned into a recipe was saved by an out-of-date Shortcut script.
// It is kept on the device so the person is told once, and so the setup screen can go on saying so
// until a page arrives from the current script.
const OLD_SCRIPT = 'recipes.oldScript';
export function scriptIsOld() {
  try { return localStorage.getItem(OLD_SCRIPT) === '1'; } catch (err) { return false; }
}
function rememberScript(old) {
  try {
    if (old) localStorage.setItem(OLD_SCRIPT, '1'); else localStorage.removeItem(OLD_SCRIPT);
  } catch (err) { /* nowhere to keep it: the note just shows again next time */ }
}

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

/** The client for the connected library, or null. For the few things outside a sync, such as fetching a picture. */
export function currentClient() {
  return library.config ? clientFor(library.config) : null;
}

/**
 * The picture jobs to show: the ones still waiting on this device to be sent ('queued'), then the ones
 * in the library that are being read ('waiting') or could not be read ('failed'). A job the person has
 * discarded is hidden straight away; one they asked to be tried again shows as waiting.
 */
export function jobsNow() {
  const asked = new Map(state.actions.map((a) => [a.id, a.action]));
  const queued = state.queue.map((j) => ({ id: j.id, state: 'queued', error: '', at: j.at, by: j.by, title: j.title || '', pictures: j.pictures.length }));
  const mine = new Set(queued.map((j) => j.id));
  const there = (library.config && Array.isArray(library.base.jobs) ? library.base.jobs : [])
    .filter((j) => !mine.has(j.id) && asked.get(j.id) !== 'discard')
    .map((j) => (asked.get(j.id) === 'retry' ? { ...j, state: 'waiting', error: '', pending: true } : j));
  return [...queued, ...there];
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

// While pictures this device sent are being read, the app looks again every little while, for a few
// minutes, so the recipe shows up without the person having to ask. The same goes for pictures shared
// from another app by a Shortcut, which is something the person holding this device has just done.
const POLL_EVERY = 20000;
const POLL_FOR = 5 * 60000;
let pollUntil = 0;
let pollTimer = null;

function ownWaiting() {
  const me = library.config && library.config.device;
  return (Array.isArray(library.base.jobs) ? library.base.jobs : []).filter((j) => j.state === 'waiting' && (j.by === me || j.packed));
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (!library.config || Date.now() > pollUntil || !ownWaiting().length) return;
  pollTimer = setTimeout(() => { if (document.visibilityState === 'visible') syncNow(); }, POLL_EVERY);
}

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
    const known = new Set((Array.isArray(library.base.jobs) ? library.base.jobs : []).map((j) => j.path + '\n' + j.sha));
    const out = await syncLibrary({
      client: clientFor(library.config), local: snap, base: library.base,
      device: library.config.device, branch: library.config.branch || 'main',
    });
    await applySync(out, snap);
    await saveBase(out.base);
    await dropQueued(out.sentJobs);
    await dropJobActions(out.doneActions);
    // Pictures just went up, or another try was asked for: keep looking for the answer for a while.
    if (snap.queue.some((j) => out.sentJobs.includes(j.id)) || snap.actions.some((a) => a.action === 'retry')) pollUntil = Date.now() + POLL_FOR;
    // Pictures shared from another app that this device has not seen before: keep looking for those too.
    if ((out.base.jobs || []).some((j) => j.packed && !known.has(j.path + '\n' + j.sha))) pollUntil = Date.now() + POLL_FOR;
    const toReview = out.recipes.filter((r) => r.review && !snap.seen.has(r.id)).length;
    // Pages from an older script: say so the first time. Pages from the current one: the note is over.
    const scriptNote = out.outdated > 0 && !scriptIsOld();
    if (out.outdated > 0) rememberScript(true);
    else if (out.added > 0) rememberScript(false);
    set({ state: 'idle', at: Date.now(), message: '', sent: out.sent, received: out.received, toReview, scriptNote });
    ok = true;
  } catch (err) {
    unsent = true;
    set({ state: 'error', message: explain(err) });
  }
  running = false;
  if (again) { again = false; return syncNow(); }
  if (ok) schedulePoll();
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
  clearTimeout(pollTimer);
  await forgetLibrary();
  set({ state: 'off', at: null, message: '', sent: 0, received: 0, toReview: 0, scriptNote: false });
}

export function startAutoSync() {
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (!library.config) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      if (unsent) syncNow();
    } else if (status.state === 'error' || (hiddenAt && Date.now() - hiddenAt > 60 * 60 * 1000) || ownWaiting().length) {
      syncNow();   // also when pictures are being read: the answer may have arrived meanwhile
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
    // Pictures sent a short while ago, before the app was closed, may still be on their way back.
    const recent = ownWaiting().map((j) => Date.parse(j.at)).filter((t) => Number.isFinite(t) && Date.now() - t < 2 * POLL_FOR);
    if (recent.length) pollUntil = Date.now() + POLL_FOR;
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
