// The pictures a recipe was read from. They live in the library under originals/<recipe id>/ and are
// fetched with this device's key when a screen wants to show one. A picture that has been fetched is
// kept on the device, so it also shows with no connection.

import { library } from '../store.js';
import { currentClient } from './auto.js';

// Not "recipes-...": the offline worker clears every cache with that prefix when a new version arrives.
const CACHE = 'originals-v1';
const address = (sha) => new URL('originals-kept/' + sha, location.href).href;

async function kept(sha) {
  try {
    const hit = await (await caches.open(CACHE)).match(address(sha));
    return hit ? await hit.blob() : null;
  } catch (err) {
    return null;   // no cache in this browser: fetch it each time
  }
}

async function keep(sha, blob) {
  try {
    await (await caches.open(CACHE)).put(address(sha), new Response(blob, { headers: { 'Content-Type': 'image/jpeg' } }));
  } catch (err) { /* nowhere to keep it */ }
}

/** The picture at `path` in the library, as a Blob. Rejects when it is not there or cannot be fetched. */
export async function loadOriginal(path) {
  const sha = library.base.originals && library.base.originals[path];
  if (!sha) throw new Error('That picture is not in the library.');
  const hit = await kept(sha);
  if (hit) return hit;
  const client = currentClient();
  if (!client) throw new Error('No library is connected.');
  const blob = new Blob([await client.blobBytes(sha)], { type: 'image/jpeg' });
  keep(sha, blob);
  return blob;
}
