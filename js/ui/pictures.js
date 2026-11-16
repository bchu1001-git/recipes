// Showing the pictures a recipe was read from: in a strip to swipe through on the review screen, and
// full size in a sheet. A picture is drawn from a blob: address, never from text a page supplied.

import { h, sheet } from './dom.js';
import { loadOriginal } from '../sync/originals.js';

/** One picture from the library in a box. While it loads, and if it cannot be had, the box says so. */
function picture(path, urls, label) {
  const box = h('div', { class: 'picture' }, h('span', { class: 'picture-note', text: 'Loading the picture...' }));
  loadOriginal(path).then((blob) => {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    box.replaceChildren(h('img', { src: url, alt: label, decoding: 'async' }));
  }, () => {
    box.replaceChildren(h('span', { class: 'picture-note', text: 'This picture could not be loaded. It needs a connection the first time.' }));
  });
  return box;
}

const labelFor = (i, count) => (count > 1 ? 'Original picture ' + (i + 1) + ' of ' + count : 'The original picture');

/**
 * The pictures side by side, one at a time, to swipe through. Each can be scrolled inside its box,
 * which is how a tall screenshot is read. Returns { node, stop }; call stop() when the screen goes.
 */
export function pictureStrip(paths) {
  const urls = [];
  const node = h('div', { class: 'pictures', tabindex: '0', role: 'group', 'aria-label': paths.length > 1 ? paths.length + ' original pictures' : 'The original picture' },
    paths.map((path, i) => picture(path, urls, labelFor(i, paths.length))));
  return { node, stop: () => { for (const url of urls) URL.revokeObjectURL(url); } };
}

/** The pictures at full width in a sheet, one under the other. */
export function openPictures(paths) {
  const urls = [];
  sheet(paths.length > 1 ? 'The original pictures' : 'The original picture',
    () => h('div', { class: 'pictures-full' }, paths.map((path, i) => picture(path, urls, labelFor(i, paths.length)))),
    () => { for (const url of urls) URL.revokeObjectURL(url); });
}
