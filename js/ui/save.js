// How to make the "Save Webpage to Recipes" Shortcut, step by step, with every piece of text ready to copy,
// and how to put a newer script into it later. The Shortcut runs shortcuts/save-page.js on the page
// open in Safari and writes the result into the connected library's inbox/. The next sync turns it
// into a recipe under To review. The steps were corrected against a run on an iPhone with iOS 27.
//
// The key this device uses is never shown or copied here. The Shortcut gets a key of its own.

import { h, icon, toast } from './dom.js';
import { library, subscribe } from '../store.js';
import { scriptIsOld } from '../sync/auto.js';

const SCRIPT = 'shortcuts/save-page.js';

export async function copy(text) {
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
export function piece(text, label) {
  return h('span', { class: 'copy' },
    h('span', { class: 'copy-text', text }),
    h('button', { class: 'copy-btn', type: 'button', 'aria-label': 'Copy ' + (label || text), onclick: () => copy(text) }, 'Copy'));
}

export const b = (text) => h('b', { text });
export const p = (...kids) => h('p', null, ...kids);
export const note = (...kids) => h('p', { class: 'set-note' }, ...kids);
export const step = (title, ...kids) => h('li', { class: 'howto-step' }, h('h3', { text: title }), ...kids);

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
      + '&description=' + encodeURIComponent('Lets the Save Webpage to Recipes Shortcut add pages to the library')
      + '&target_name=' + encodeURIComponent(config.owner) + '&expires_in=none&contents=write';

    const copyScript = () => (script
      ? h('button', { class: 'btn btn-main', type: 'button', onclick: () => copy(script) }, 'Copy the script')
      : p(failed ? 'The script could not be loaded. Check the connection, then open this screen again.' : 'Loading the script...'));

    root.replaceChildren(h('div', { class: 'pane-scroll' }, bar,
      h('div', { class: 'settings' },
        h('p', { class: 'set-note' },
          'This puts ', b('Save Webpage to Recipes'), ' in Safari\'s share sheet. Tap it on a recipe page and the recipe is written into your library, then shows up here under To review. You make the Shortcut once, by hand, on this iPhone. It takes about ten minutes.'),
        scriptIsOld()
          ? h('p', { class: 'howto-note', role: 'note', text: 'A page was saved by a Shortcut with an older script. It still works, but it misses what the new script reads, such as the groups a page puts its ingredients in. Update the script, further down, takes a minute.' })
          : null,
        h('p', { class: 'howto-note', text: 'These steps were run on an iPhone with iOS 27 in November 2026. Shortcuts names things a little differently from one iOS version to the next, so where a step does not match what you see, look for the closest name.' }),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'Putting a variable in a field' }),
          note('Two fields below need a variable: a blue bubble that stands for the result of an earlier action. Tap the field, then look at the row just above the keyboard and tap the variable that is named. If it is not in that row, tap ', b('Select Variable'), ' and then tap the result shown under the action it comes from.')),

        h('ol', { class: 'howto' },
          step('Let Shortcuts run scripts',
            p('Open the ', b('Settings'), ' app, then ', b('Apps'), ', then ', b('Shortcuts'), ', then ', b('Advanced'), ', and turn on ', b('Allow Running Scripts'), '. On some versions Shortcuts is in the main Settings list instead of under Apps.')),

          step('Start the Shortcut',
            p('Open the ', b('Shortcuts'), ' app and tap ', b('+'), '. Tap the name at the top, choose ', b('Rename'), ', and call it ', b('Save Webpage to Recipes'), '.')),

          step('Put it in Safari\'s share sheet',
            p('This is a setting of the Shortcut, not an action, so it is not in the action search. Close the search if it is open. At the bottom of the Shortcut\'s screen there is a small ', b('i'), ' in a circle. Tap it to open ', b('Details'), ', turn on ', b('Show in Share Sheet'), ', then tap ', b('Done'), ' or the tick.'),
            p('A row that begins with ', b('Receive'), ' appears at the top of the Shortcut. Tap the list of kinds in that row and switch off every kind except ', b('Safari web pages'), '.')),

          step('Read the page',
            p('Search the actions for ', b('Run JavaScript on Web Page'), ' and add it. It should say it runs on ', b('Shortcut Input'), '.'),
            p('Delete the sample script inside it and paste this one in its place:'),
            copyScript(),
            script ? h('details', { class: 'howto-code' }, h('summary', { text: 'Read the script' }), h('pre', { text: script })) : null,
            p('The script only reads the page you share. It collects the recipe data that the page carries about itself, and the groups the page puts its ingredients in, and hands them to the Shortcut.')),

          step('Give the file a name',
            p('Each saved page needs a file name that has not been used before, and a random number does that. Search the actions for ', b('Random Number'), ' and add it. It reads "Random number between ... and ...". Tap the first value and type the first number below, then tap the second and type the other.'),
            piece('100000', 'the smallest number'),
            piece('999999999', 'the largest number')),

          step('Send it to your library',
            p('Add the action ', b('Get Contents of URL'), '.'),
            h('ul', { class: 'howto-list' },
              h('li', null, p(b('URL:'), ' paste this. With the cursor at its end, put in the variable ', b('Random Number'), ', then type ', b('.json'), '. It ends up as the address, a blue Random Number bubble, then .json'), piece(address, 'the address')),
              h('li', null, p('Tap ', b('Show More'), ' and set ', b('Method'), ' to ', b('PUT'), '.')),
              h('li', null, p(b('Headers:'), ' add one. Its key is:'), piece('Authorization'),
                p('Its text is the word below, then a space. A key goes after that space, and it is a new one that you make in the next step: not the key this app uses, and not the key you publish with.'), piece('Bearer')),
              h('li', null, p(b('Request Body:'), ' choose ', b('JSON'), '. Add a ', b('Text'), ' field with this key:'), piece('message'),
                p('and this text:'), piece('Saved from Safari')),
              h('li', null, p('Add a second ', b('Text'), ' field with this key:'), piece('content'),
                p('For its text, put in the variable that holds the result of ', b('Run JavaScript on Web Page'), ' from step 4.')))),

          // The key comes last on purpose: GitHub shows it once, and copying anything else afterwards
          // would push it off the clipboard before it is pasted.
          step('Make the key and paste it in',
            p('The Shortcut writes into ', b(config.owner + '/' + config.repo), ', so it needs a key. Give it one of its own, so you can cancel it without touching the key this app uses.'),
            h('a', { class: 'btn btn-quiet', href: keyForm, target: '_blank', rel: 'noopener noreferrer' }, 'Open GitHub\'s new key form'),
            p('On that form: ', b('Resource owner'), ' should say ', b(config.owner), '. Under ', b('Repository access'), ' choose ', b('Only select repositories'), ', then ', b(config.repo), '. ', b('Contents'), ' should say ', b('Read and write'), '. Generate the token and copy it.'),
            p('GitHub shows the key only once, so copy nothing else now. Go straight back to Shortcuts, tap the text of the ', b('Authorization'), ' header after ', b('Bearer'), ' and its space, and paste. It ends up looking like Bearer github_pat_...'),
            p('The key is now inside the Shortcut, so do not share the Shortcut with anyone. Someone else who wants it makes their own, with their own key.')),

          step('Show what GitHub answered',
            p('Add the action ', b('Show Content'), ', which older versions call ', b('Show Result'), ', and make sure it shows ', b('Contents of URL'), '. Then tap ', b('Done'), '.')),

          step('Try it',
            p('Open a recipe in Safari, tap ', b('Share'), ', and choose ', b('Save Webpage to Recipes'), '. It may be far down the list.'),
            p('The first time, the phone asks whether the Shortcut may read the page and whether it may connect to api.github.com. Allow both.'),
            p('A result then appears. If it mentions content and commit, the page was saved. Come back to Recipes, pull the list down to sync, and look for ', b('To review'), ' at the top.'))),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'If the result shows a message instead' }),
          note('GitHub refused the page, and the message says why.'),
          h('ul', { class: 'howto-ask' },
            h('li', { text: 'Bad credentials: the key was not pasted whole, has no space before it, or has been cancelled.' }),
            h('li', { text: 'Not Found: the key cannot reach this library. Check its Resource owner and its repository, and the address in the URL.' }),
            h('li', { text: 'Resource not accessible: the key can read but not write. Contents must say Read and write.' }),
            h('li', { text: 'A message about "sha": a file with that number is already there, which is rare. Save the page again.' }))),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'Update the script' }),
          note('When the app learns to read more from a page, the script changes, and the Shortcut keeps the old one until you replace it. The app says so after a sync that brings in a page saved by an older script.'),
          h('ol', { class: 'howto-ask howto-count' },
            h('li', { text: 'Copy the new script with the button below.' }),
            h('li', { text: 'Open the Shortcuts app and open Save Webpage to Recipes for editing: the three dots on it.' }),
            h('li', { text: 'In Run JavaScript on Web Page, tap inside the script, choose Select All, and delete it.' }),
            h('li', { text: 'Paste, then tap Done. Nothing else in the Shortcut changes.' })),
          copyScript()))));
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
