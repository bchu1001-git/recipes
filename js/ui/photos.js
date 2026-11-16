// Adding a recipe from photos or screenshots. The person gives the pictures by choosing them, by
// pasting them, or by dropping them onto the screen, sees them, and sends them. Each one is made
// smaller here first. They wait on this device until a sync has put them into the library, where the
// library's importer reads them. The recipe then shows up under To review.

import { h, icon, toast, go } from './dom.js';
import { library, queueJob, subscribe } from '../store.js';
import { syncNow } from '../sync/auto.js';
import { MAX_PICTURES, fitWithin, newJobId } from '../jobs.js';

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('not a picture'));
    img.src = url;
  });
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** One picture, as a file or a blob, as a smaller JPEG: { base64, url (for showing it), screenshot }. */
async function shrink(file) {
  const source = URL.createObjectURL(file);
  try {
    const img = await loadImage(source);
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';   // paper behind a see-through picture, since a JPEG cannot be see-through
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (!blob) throw new Error('could not be prepared');
    // A phone saves its screenshots as PNG and its camera pictures as something else.
    return { base64: await toBase64(blob), url: URL.createObjectURL(blob), screenshot: file.type === 'image/png' };
  } finally {
    URL.revokeObjectURL(source);
  }
}

const isPicture = (file) => !!file && typeof file.type === 'string' && file.type.startsWith('image/');

export function renderPhotos(root) {
  const picked = [];
  let busy = false;
  let live = true;

  const bar = (send) => h('header', { class: 'bar bar-detail' },
    h('a', { class: 'back', href: '#/' }, 'Cancel'),
    h('span', { class: 'bar-heading', text: 'From photos' }),
    send || h('span', { class: 'bar-spacer' }));

  const blocked = (text, label, href) => {
    root.replaceChildren(h('div', { class: 'pane-scroll' }, bar(),
      h('div', { class: 'settings' },
        h('p', { class: 'set-note', text }),
        h('a', { class: 'btn btn-main', href }, label))));
  };

  // Pictures of a recipe often leave its name out, so it can be typed here. It is optional.
  const title = h('input', { class: 'input', name: 'title', autocomplete: 'off', maxlength: '200', enterkeyhint: 'done' });
  const titleField = h('label', { class: 'field' },
    h('span', { class: 'field-label', text: 'Title' }), title,
    h('span', { class: 'field-hint', text: 'Leave empty if the pictures show it. You can also give it, or change it, when you review the recipe.' }));
  const grid = h('div', { class: 'pick-grid' });
  const problem = h('p', { class: 'field-error', role: 'alert' });
  const count = h('p', { class: 'set-note' });
  const input = h('input', { class: 'offscreen', type: 'file', accept: 'image/*', multiple: true, 'aria-label': 'Choose pictures' });
  const choose = h('label', { class: 'btn btn-quiet pick-choose' }, input, icon('plus'), h('span', { text: 'Choose pictures' }));
  const pasteButton = h('button', { class: 'btn btn-quiet', type: 'button' }, 'Paste');
  const buttons = h('div', { class: 'pick-buttons' }, choose, pasteButton);
  const sendTop = h('button', { class: 'bar-save', type: 'button' }, 'Send');
  const sendMain = h('button', { class: 'btn btn-main', type: 'button' }, 'Send to be read');

  const paint = () => {
    grid.replaceChildren(...picked.map((p, i) => h('div', { class: 'pick-item' },
      h('img', { src: p.url, alt: 'Picture ' + (i + 1) }),
      h('span', { class: 'pick-number', text: String(i + 1) }),
      h('button', { class: 'pick-remove', type: 'button', 'aria-label': 'Remove picture ' + (i + 1), onclick: () => {
        URL.revokeObjectURL(p.url);
        picked.splice(i, 1);
        problem.textContent = '';
        paint();
      } }, icon('close')))));
    const full = picked.length >= MAX_PICTURES;
    count.textContent = !picked.length ? 'Nothing added yet.'
      : picked.length + (picked.length === 1 ? ' picture' : ' pictures') + (full ? '. That is the most one recipe can have.' : picked.length > 1 ? ', read together as one recipe.' : '.');
    buttons.hidden = full;
    choose.lastChild.textContent = picked.length ? 'Choose more' : 'Choose pictures';
    sendTop.disabled = sendMain.disabled = busy || !picked.length;
    sendMain.textContent = busy ? 'Getting them ready...' : 'Send to be read';
  };

  /**
   * Takes in whatever was chosen, pasted or dropped: every picture among it, up to the most a recipe
   * can have. What is not a picture is passed over, and one line says so. `other` counts things that
   * were offered and were not files at all, such as a piece of text.
   */
  const add = async (offered, other = 0) => {
    const files = [...offered];
    const pictures = files.filter(isPicture);
    let left = other + files.length - pictures.length;   // offered, and not a picture
    let extra = 0;                                       // pictures beyond the most a recipe can have
    if (busy) return;
    busy = true;
    const before = picked.length;
    problem.textContent = '';
    paint();
    for (const file of pictures) {
      if (picked.length >= MAX_PICTURES) { extra++; continue; }
      try {
        const small = await shrink(file);
        if (!live) { URL.revokeObjectURL(small.url); return; }
        picked.push(small);
      } catch (err) {
        left++;   // called itself a picture, and could not be opened as one
      }
    }
    busy = false;
    const said = [];
    if (left && picked.length === before) said.push(left === 1 ? 'That was not a picture, so nothing was added.' : 'None of those were pictures, so nothing was added.');
    else if (left) said.push(left === 1 ? 'One of those was not a picture and was left out.' : left + ' of those were not pictures and were left out.');
    if (extra) said.push('A recipe can have ' + MAX_PICTURES + ' pictures at most, so ' + (extra === 1 ? 'one was' : extra + ' were') + ' left out. Send the rest as another recipe.');
    problem.textContent = said.join(' ');
    paint();
  };

  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';   // so that choosing the same picture again still counts as a change
    if (files.length) add(files);
  });

  // Paste, from the button: the browser asks before it hands the clipboard over.
  pasteButton.addEventListener('click', async () => {
    if (busy) return;
    if (!navigator.clipboard || !navigator.clipboard.read) {
      problem.textContent = 'This browser cannot paste from a button. Use its own Paste instead: press Command-V, or hold a finger on the Title box and choose Paste.';
      return;
    }
    let items = [];
    try {
      items = await navigator.clipboard.read();
    } catch (err) {
      problem.textContent = 'Nothing was pasted. If the browser asks whether to allow pasting, allow it. Otherwise copy the picture again and try once more.';
      return;
    }
    const blobs = [];
    let other = 0;
    for (const item of items) {
      const type = (item.types || []).find((t) => t.startsWith('image/'));
      if (!type) { other++; continue; }
      try { blobs.push(await item.getType(type)); } catch (err) { other++; }
    }
    if (!blobs.length && !other) problem.textContent = 'There is nothing on the clipboard. Copy a picture first, then paste.';
    else add(blobs, other);
  });

  // Paste, the ordinary way: Command-V, or Paste from the menu that a long press brings up.
  // Text pasted into the Title box is left to go there; only files are taken.
  const onPaste = (e) => {
    if (!root.contains(grid) || !e.clipboardData) return;
    const files = [...e.clipboardData.files];
    if (!files.length) return;
    e.preventDefault();
    add(files);
  };

  // Dropping pictures onto the screen.
  const hasFiles = (e) => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  const onDragOver = (e) => {
    if (!root.contains(grid)) return;
    e.preventDefault();   // without this the browser would open the file instead
    e.dataTransfer.dropEffect = hasFiles(e) ? 'copy' : 'none';
    root.classList.toggle('is-drop', hasFiles(e));
  };
  const onDragLeave = (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('is-drop'); };
  const onDrop = (e) => {
    if (!root.contains(grid)) return;
    e.preventDefault();
    root.classList.remove('is-drop');
    const files = [...e.dataTransfer.files];
    if (files.length) add(files);
    else problem.textContent = 'That was not a picture file, so nothing was added.';
  };

  const send = async () => {
    if (busy || !picked.length) return;
    busy = true;
    paint();
    await queueJob({
      id: newJobId(),
      at: new Date().toISOString(),
      by: library.config.device,
      kind: picked.every((p) => p.screenshot) ? 'screenshot' : 'photo',
      title: title.value.replace(/\s+/g, ' ').trim(),
      pictures: picked.map((p) => p.base64),
    });
    toast('Sent. The recipe will show up under To review, usually within a minute or two.');
    go('');
    syncNow();
  };
  sendTop.addEventListener('click', send);
  sendMain.addEventListener('click', send);

  const draw = () => {
    if (!library.config) {
      blocked('Pictures are read through your library: the app sends them there, and the library reads the recipe out of them. Connect a library in Settings first.', 'Open Settings', '#/settings');
    } else if (library.base.reader === false) {
      blocked('This library has not been set up to read pictures yet. It takes a few minutes, once.', 'Set up Read photos', '#/read');
    } else if (!root.contains(grid)) {
      root.replaceChildren(h('div', { class: 'pane-scroll' }, bar(sendTop),
        h('div', { class: 'settings' },
          h('p', { class: 'set-note', text: 'Add screenshots or photos of one recipe: choose them, paste them, or drop them here. If the recipe runs over several pictures, add them all, up to ' + MAX_PICTURES + '. They are read together as one recipe, whatever order they are in.' }),
          titleField, grid, count, problem, buttons, sendMain,
          h('p', { class: 'set-note', text: 'The pictures go into your library, and from there to Google’s Gemini to be read. The recipe comes back under To review, with the pictures kept beside it.' }))));
      paint();
    }
  };

  document.addEventListener('paste', onPaste);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('dragleave', onDragLeave);
  root.addEventListener('drop', onDrop);
  const stop = subscribe(draw);   // connecting, or a sync that finds the library set up, changes what is shown
  draw();
  return () => {
    live = false;
    stop();
    document.removeEventListener('paste', onPaste);
    root.removeEventListener('dragover', onDragOver);
    root.removeEventListener('dragleave', onDragLeave);
    root.removeEventListener('drop', onDrop);
    root.classList.remove('is-drop');
    for (const p of picked) URL.revokeObjectURL(p.url);
  };
}
