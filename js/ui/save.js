// How to make the "Save to Recipes" Shortcut, step by step, with every piece of text ready to copy.
// The Shortcut runs shortcuts/save-page.js on the page open in Safari and writes the result into the
// connected library's inbox/. The next sync turns it into a recipe under To review.
//
// The key this device uses is never shown or copied here. The Shortcut gets a key of its own.

import { h, icon, toast } from './dom.js';
import { library, subscribe } from '../store.js';

const SCRIPT = 'shortcuts/save-page.js';
const FILE_NAME = 'yyyyMMdd-HHmmss';

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
    return;
  } catch (err) { /* older browsers: fall back to selecting it */ }
  const box = h('textarea', { class: 'offscreen', readonly: true, value: text });
  document.body.append(box);
  box.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (err) { /* reported below */ }
  box.remove();
  toast(ok ? 'Copied' : 'Copying did not work. Select the text and copy it by hand.');
}

/** A piece of text to paste into the Shortcut, with a button that copies it. */
function piece(text, label) {
  return h('span', { class: 'copy' },
    h('span', { class: 'copy-text', text }),
    h('button', { class: 'copy-btn', type: 'button', 'aria-label': 'Copy ' + (label || text), onclick: () => copy(text) }, 'Copy'));
}

const b = (text) => h('b', { text });
const p = (...kids) => h('p', null, ...kids);
const step = (title, ...kids) => h('li', { class: 'howto-step' }, h('h3', { text: title }), ...kids);

export function renderSaveSetup(root) {
  let script = null;      // the page script, once it has loaded
  let failed = false;

  const draw = () => {
    const scroller = root.querySelector('.pane-scroll');
    const keep = scroller ? scroller.scrollTop : 0;
    const config = library.config;

    const bar = h('header', { class: 'bar bar-detail' },
      h('a', { class: 'back', href: '#/settings' }, icon('back'), 'Settings'),
      h('span', { class: 'bar-heading', text: 'Save from Safari' }),
      h('span', { class: 'bar-spacer' }));

    if (!config) {
      root.replaceChildren(h('div', { class: 'pane-scroll' }, bar,
        h('div', { class: 'settings' },
          h('p', { class: 'set-note', text: 'Saving a recipe page from Safari writes it into your library. Connect a library in Settings first, then come back here.' }),
          h('a', { class: 'btn btn-main', href: '#/settings' }, 'Open Settings'))));
      return;
    }

    const address = 'https://api.github.com/repos/' + config.owner + '/' + config.repo + '/contents/inbox/';
    const keyForm = 'https://github.com/settings/personal-access-tokens/new?name=Recipes+Save+Shortcut'
      + '&description=' + encodeURIComponent('Lets the Save to Recipes Shortcut add pages to the library')
      + '&target_name=' + encodeURIComponent(config.owner) + '&expires_in=none&contents=write';

    root.replaceChildren(h('div', { class: 'pane-scroll' }, bar,
      h('div', { class: 'settings' },
        h('p', { class: 'set-note' },
          'This puts ', b('Save to Recipes'), ' in Safari\'s share sheet. Tap it on a recipe page and the recipe is written into your library, then shows up here under To review. You make the Shortcut once, by hand, on this iPhone. It takes about ten minutes.'),
        h('p', { class: 'howto-note', text: 'This is a first try. It has not been run on a real phone yet, and Shortcuts names things a little differently from one iOS version to the next. Where a step does not match what you see, note what you see instead.' }),

        h('ol', { class: 'howto' },
          step('Let Shortcuts run scripts',
            p('Open the ', b('Settings'), ' app, then ', b('Apps'), ', then ', b('Shortcuts'), ', then ', b('Advanced'), ', and turn on ', b('Allow Running Scripts'), '. On some versions Shortcuts is in the main Settings list instead of under Apps.')),

          step('Start the Shortcut',
            p('Open the ', b('Shortcuts'), ' app and tap ', b('+'), '. Tap the name at the top, choose ', b('Rename'), ', and call it ', b('Save to Recipes'), '.')),

          step('Put it in Safari\'s share sheet',
            p('Tap the ', b('i'), ' button to open the details and turn on ', b('Show in Share Sheet'), '. A row that begins with ', b('Receive'), ' appears at the top of the Shortcut.'),
            p('Tap the list of kinds in that row and switch off every kind except ', b('Safari webpages'), '.')),

          step('Read the page',
            p('Search the actions for ', b('Run JavaScript on Webpage'), ' and add it. It should say it runs on ', b('Shortcut Input'), '.'),
            p('Delete the sample script inside it and paste this one in its place:'),
            script
              ? h('button', { class: 'btn btn-main', type: 'button', onclick: () => copy(script) }, 'Copy the script')
              : p(failed ? 'The script could not be loaded. Check the connection, then open this screen again.' : 'Loading the script...'),
            script ? h('details', { class: 'howto-code' }, h('summary', { text: 'Read the script' }), h('pre', { text: script })) : null,
            p('The script only reads the page you share. It collects the recipe data that the page carries about itself and hands it to the Shortcut.')),

          step('Name the file',
            p('Add the action ', b('Format Date'), '. Its date should be ', b('Current Date'), '. Set ', b('Date Format'), ' to ', b('Custom'), ' and paste this as the ', b('Format String'), ':'),
            piece(FILE_NAME, 'the file name pattern')),

          step('Send it to your library',
            p('Add the action ', b('Get Contents of URL'), '.'),
            h('ul', { class: 'howto-list' },
              h('li', null, p(b('URL:'), ' paste this, then right after it insert the variable ', b('Formatted Date'), ', then type ', b('.json')), piece(address, 'the address')),
              h('li', null, p('Tap ', b('Show More'), ' and set ', b('Method'), ' to ', b('PUT'), '.')),
              h('li', null, p(b('Headers:'), ' add one. Its key is:'), piece('Authorization'),
                p('Its text is the word below, then a space. The key goes after that space, in the next step.'), piece('Bearer')),
              h('li', null, p(b('Request Body:'), ' choose ', b('JSON'), '. Add a ', b('Text'), ' field with this key:'), piece('message'),
                p('and this text:'), piece('Saved from Safari')),
              h('li', null, p('Add a second ', b('Text'), ' field with this key:'), piece('content'),
                p('For its text, insert the variable that holds the result of ', b('Run JavaScript on Webpage'), ' from step 4.')))),

          // The key comes last on purpose: GitHub shows it once, and copying anything else afterwards
          // would push it off the clipboard before it is pasted.
          step('Make the key and paste it in',
            p('The Shortcut writes into ', b(config.owner + '/' + config.repo), ', so it needs a key. Give it one of its own, so you can cancel it without touching the key this app uses.'),
            h('a', { class: 'btn btn-quiet', href: keyForm, target: '_blank', rel: 'noopener noreferrer' }, 'Open GitHub\'s new key form'),
            p('On that form: ', b('Resource owner'), ' should say ', b(config.owner), '. Under ', b('Repository access'), ' choose ', b('Only select repositories'), ', then ', b(config.repo), '. ', b('Contents'), ' should say ', b('Read and write'), '. Generate the token and copy it.'),
            p('GitHub shows the key only once, so copy nothing else now. Go straight back to Shortcuts, tap the text of the ', b('Authorization'), ' header after ', b('Bearer'), ' and its space, and paste. It ends up looking like Bearer github_pat_...'),
            p('The key is now inside the Shortcut, so do not share the Shortcut with anyone. Someone else who wants it makes their own, with their own key.')),

          step('Show what GitHub answered',
            p('Add the action ', b('Show Result'), ' and make sure it shows ', b('Contents of URL'), '. Then tap ', b('Done'), '.')),

          step('Try it',
            p('Open a recipe in Safari, tap ', b('Share'), ', and choose ', b('Save to Recipes'), '. It may be far down the list.'),
            p('The first time, the phone asks whether the Shortcut may read the page and whether it may connect to api.github.com. Allow both.'),
            p('A result then appears. If it mentions content and commit, the page was saved. If it shows a message instead, GitHub refused it, and the message says why. Come back to Recipes, pull the list down to sync, and look for ', b('To review'), ' at the top.'))),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'What to tell me' }),
          h('ul', { class: 'howto-ask' },
            h('li', { text: 'Which steps did not match what you saw, and what you saw instead.' }),
            h('li', { text: 'What the result in step 9 said: the first line or two is enough.' }),
            h('li', { text: 'Whether the recipe showed up under To review after a sync.' }),
            h('li', { text: 'Whether it also worked on a second recipe site.' }))))));
    root.querySelector('.pane-scroll').scrollTop = keep;
  };

  let live = true;
  fetch(SCRIPT, { cache: 'no-cache' })
    .then((res) => (res.ok ? res.text() : Promise.reject(new Error('missing'))))
    .then((text) => { script = text; }, () => { failed = true; })
    .then(() => { if (live) draw(); });

  const stop = subscribe(draw);   // connecting or disconnecting the library changes what is shown
  draw();
  return () => { live = false; stop(); };
}
