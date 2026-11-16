// Settings: appearance, folders, the library, saving from Safari, backup, and the example recipes.

import { h, icon, sheet, confirmSheet, toast } from './dom.js';
import { state, library, subscribe, saveFolders, removeFolder, saveRecipe, deleteRecipe, exportAll, importAll } from '../store.js';
import { status, onStatus, syncNow, connect, disconnect, explain, ago, scriptIsOld } from '../sync/auto.js';
import { newFolderId } from '../model.js';
import { EXAMPLES } from '../sample.js';
import { BUILD } from '../version.js';

const APPEARANCE_KEY = 'recipes.appearance';
const MODES = [['system', 'Match the phone'], ['light', 'Light'], ['dark', 'Dark']];

export function appearance() {
  try { return localStorage.getItem(APPEARANCE_KEY) || 'system'; } catch (e) { return 'system'; }
}

/** Applies Match the phone, Light or Dark to the whole app, including the color of the phone's status bar. */
export function applyAppearance(mode) {
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
  else root.removeAttribute('data-theme');
  const dark = mode === 'dark' || (mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.getElementById('theme-color');
  if (meta) meta.setAttribute('content', dark ? '#121614' : '#ffffff');
}

function setAppearance(mode) {
  try { localStorage.setItem(APPEARANCE_KEY, mode); } catch (e) { /* still applies until the app is closed */ }
  applyAppearance(mode);
}

function nameSheet(title, start, saveLabel, onSave, onDelete) {
  sheet(title, (close) => {
    const input = h('input', { class: 'input', value: start, autocomplete: 'off', 'aria-label': 'Folder name', maxlength: '40' });
    const save = async () => {
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (!name) { input.focus(); return; }
      close();
      await onSave(name);
    };
    return [
      h('form', { onsubmit: (e) => { e.preventDefault(); save(); } }, input),
      h('div', { class: 'sheet-actions' },
        onDelete ? h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { close(); onDelete(); } }, 'Delete') : null,
        h('button', { class: 'btn btn-main', type: 'button', onclick: save }, saveLabel)),
    ];
  });
}

function addFolder(group) {
  nameSheet('New folder in ' + group.name, '', 'Add', async (name) => {
    const folders = { groups: state.folders.groups.map((g) => (g.id === group.id
      ? { ...g, folders: [...g.folders, { id: newFolderId(g, name), name }] } : g)) };
    await saveFolders(folders);
  });
}

function editFolder(group, folder) {
  nameSheet('Folder', folder.name, 'Save', async (name) => {
    const folders = { groups: state.folders.groups.map((g) => (g.id === group.id
      ? { ...g, folders: g.folders.map((f) => (f.id === folder.id ? { ...f, name } : f)) } : g)) };
    await saveFolders(folders);
  }, async () => {
    const used = [...state.recipes.values()].filter((r) => r.folders.includes(folder.id)).length;
    const yes = await confirmSheet('Delete this folder?',
      '"' + folder.name + '" will be removed' + (used ? ' from ' + used + (used === 1 ? ' recipe' : ' recipes') : '') + '. The recipes themselves stay.', 'Delete');
    if (yes) await removeFolder(folder.id);
  });
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function pickBackup() {
  const input = h('input', { type: 'file', accept: 'application/json,.json', onchange: async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const added = await importAll(JSON.parse(await file.text()));
      toast(added ? 'Added ' + added + (added === 1 ? ' recipe' : ' recipes') : 'Nothing new in that backup');
    } catch (err) {
      toast('That file is not a Recipes backup');
    }
  } });
  input.click();
}

function guessDevice() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Mac/.test(ua)) return 'Mac';
  return 'This device';
}

function openConnect() {
  sheet('Connect a library', (close) => {
    const field = (label, control, hint) => h('label', { class: 'field' },
      h('span', { class: 'field-label', text: label }), control, h('span', { class: 'field-hint', text: hint }));
    const repo = h('input', { class: 'input', placeholder: 'owner/library', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const key = h('input', { class: 'input', type: 'password', placeholder: 'github_pat_...', autocomplete: 'off' });
    const device = h('input', { class: 'input', value: guessDevice(), autocomplete: 'off', maxlength: '40' });
    const problem = h('p', { class: 'field-error', role: 'alert' });
    const button = h('button', { class: 'btn btn-main', type: 'submit' }, 'Connect');
    return h('form', { class: 'connect', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const name = repo.value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
      const parts = /^([\w.-]+)\/([\w.-]+)$/.exec(name);
      if (!parts) { problem.textContent = 'Write the library as owner/name, for example my-kitchen/library.'; repo.focus(); return; }
      if (!key.value.trim()) { problem.textContent = 'Paste the key for this library.'; key.focus(); return; }
      problem.textContent = '';
      button.disabled = true;
      button.textContent = 'Connecting...';
      try {
        const ok = await connect({ owner: parts[1], repo: parts[2], token: key.value, device: device.value });
        close();
        toast(ok ? 'Connected' : 'Connected, but the first sync did not finish');
      } catch (err) {
        problem.textContent = explain(err);
        button.disabled = false;
        button.textContent = 'Connect';
      }
    } },
      field('Library', repo, 'The owner and name of the private repository on GitHub'),
      field('Key', key, 'A fine-grained key for that repository, with Contents set to Read and write'),
      field('This device', device, 'Shows in the library\u2019s history next to each change'),
      problem, button);
  });
}

function librarySection(count) {
  if (!library.config) {
    return h('section', { class: 'set' },
      h('h2', { class: 'label', text: 'Library' }),
      h('p', { class: 'set-note', text: 'Connect this device to your library on GitHub and your recipes stay the same on every device. Until then, ' +
        (count === 0 ? 'anything you add lives' : count === 1 ? 'your recipe lives' : 'your ' + count + ' recipes live') + ' on this device only.' }),
      h('button', { class: 'btn btn-main', type: 'button', onclick: openConnect }, 'Connect a library'));
  }
  const line = status.state === 'syncing' ? 'Syncing...'
    : status.state === 'error' ? status.message
    : status.at ? 'Synced ' + ago(status.at) : 'Not synced yet';
  return h('section', { class: 'set' },
    h('h2', { class: 'label', text: 'Library' }),
    h('p', { class: 'set-library', text: library.config.owner + '/' + library.config.repo }),
    h('p', { class: 'set-note', text: 'This device is \u201c' + library.config.device + '\u201d. The example recipes are never synced.' }),
    h('p', { class: 'set-status' + (status.state === 'error' ? ' is-error' : ''), role: 'status', text: line }),
    h('div', { class: 'set-buttons' },
      h('button', { class: 'btn btn-quiet', type: 'button', disabled: status.state === 'syncing', onclick: () => syncNow() }, 'Sync now'),
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
        const yes = await confirmSheet('Disconnect this device?', 'Your recipes stay on this device and in the library. The key is forgotten here, so this device stops syncing.', 'Disconnect');
        if (yes) { await disconnect(); toast('Disconnected'); }
      } }, 'Disconnect')));
}

export function renderSettings(root) {
  const draw = () => {
    const scroller = root.querySelector('.pane-scroll');
    const keep = scroller ? scroller.scrollTop : 0;
    const mode = appearance();
    const examples = [...state.recipes.values()].filter((r) => r.example);
    const count = state.recipes.size;

    root.replaceChildren(h('div', { class: 'pane-scroll' },
      h('header', { class: 'bar bar-detail' },
        h('a', { class: 'back back-list', href: '#/' }, icon('back'), 'Recipes'),
        h('span', { class: 'bar-heading', text: 'Settings' }),
        h('span', { class: 'bar-spacer' })),
      h('div', { class: 'settings' },

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'Appearance' }),
          h('div', { class: 'seg', role: 'group', 'aria-label': 'Appearance' }, MODES.map(([key, label]) =>
            h('button', { class: 'seg-btn' + (mode === key ? ' is-on' : ''), type: 'button', 'aria-pressed': String(mode === key),
              onclick: () => { setAppearance(key); draw(); } }, label)))),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'Folders' }),
          h('p', { class: 'set-note', text: 'Tap a folder to rename or delete it.' }),
          state.folders.groups.map((g) => h('div', { class: 'set-group' },
            h('h3', { class: 'set-group-name', text: g.name }),
            h('div', { class: 'chips wrap' },
              g.folders.map((f) => h('button', { class: 'chip', type: 'button', onclick: () => editFolder(g, f) }, f.name)),
              h('button', { class: 'chip chip-add', type: 'button', onclick: () => addFolder(g) }, icon('plus'), 'Add'))))),

        librarySection(count),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'Save from Safari' }),
          h('p', { class: 'set-note', text: library.config
            ? 'Put Save to Recipes in Safari\u2019s share sheet. A recipe page you are reading then lands here, under To review.'
            : 'Saving a recipe page from Safari writes it into your library, so connect a library first.' }),
          library.config && scriptIsOld()
            ? h('p', { class: 'set-note', text: 'A page was saved by a Shortcut with an older script. The steps screen shows how to put the new one in.' })
            : null,
          library.config ? h('a', { class: 'btn btn-quiet', href: '#/save' }, 'Set up or update Save to Recipes') : null),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'Backup' }),
          h('p', { class: 'set-note', text: 'One file with every recipe and folder in it.' }),
          h('div', { class: 'set-buttons' },
            h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => {
              download('recipes-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(exportAll(), null, 2));
            } }, 'Save a backup'),
            h('button', { class: 'btn btn-quiet', type: 'button', onclick: pickBackup }, 'Open a backup'))),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'Examples' }),
          examples.length
            ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
              for (const r of examples) await deleteRecipe(r.id);
              toast('Examples removed');
            } }, 'Remove the ' + examples.length + (examples.length === 1 ? ' example' : ' examples'))
            : h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => {
              for (const ex of EXAMPLES) await saveRecipe(ex);
              toast('Three examples added');
            } }, 'Add three example recipes')),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'Tests' }),
          h('p', { class: 'set-note', text: 'A one-off check that this phone can hand a timer to the Clock app.' }),
          h('a', { class: 'btn btn-quiet', href: 'proofs/timer.html' }, 'Try the Clock timer')),

        h('p', { class: 'set-version', text: 'Recipes · version ' + BUILD + (state.saved ? '' : ' · this browser is not saving data') }))));
    root.querySelector('.pane-scroll').scrollTop = keep;
  };
  const stop = subscribe(draw);
  const stopStatus = onStatus(draw);
  draw();
  return () => { stop(); stopStatus(); };
}
