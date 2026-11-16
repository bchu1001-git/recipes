// The one-time setup that lets a library read recipes out of pictures: a key for the AI reader, kept
// in the library as a secret, and a small workflow file that runs this app's importer there whenever
// pictures arrive. Done once per library, not once per device.
//
// Nothing here knows this app's own repository by name: it is worked out from the address the app is
// served from, and the library's name comes from the connected library.

import { h, icon } from './dom.js';
import { library, subscribe } from '../store.js';
import { copy, piece, b, p, note, step } from './save.js';
import { appRepository, workflowText, WORKFLOW_PATH, MAX_PICTURES } from '../jobs.js';

const KEY_PAGE = 'https://aistudio.google.com/apikey';
const SECRET_NAME = 'GEMINI_API_KEY';

export function renderReadSetup(root) {
  const draw = () => {
    const scroller = root.querySelector('.pane-scroll');
    const keep = scroller ? scroller.scrollTop : 0;
    const config = library.config;

    const bar = h('header', { class: 'bar bar-detail' },
      h('a', { class: 'back', href: '#/settings' }, icon('back'), 'Settings'),
      h('span', { class: 'bar-heading', text: 'Read photos' }),
      h('span', { class: 'bar-spacer' }));

    if (!config) {
      root.replaceChildren(h('div', { class: 'pane-scroll' }, bar,
        h('div', { class: 'settings' },
          h('p', { class: 'set-note', text: 'Pictures are read inside your library, so connect a library in Settings first, then come back here.' }),
          h('a', { class: 'btn btn-main', href: '#/settings' }, 'Open Settings'))));
      return;
    }

    const name = config.owner + '/' + config.repo;
    const onGitHub = 'https://github.com/' + encodeURIComponent(config.owner) + '/' + encodeURIComponent(config.repo);
    const app = appRepository(location.hostname, location.pathname);
    const file = workflowText(app || 'OWNER/NAME');
    const secretPage = onGitHub + '/settings/secrets/actions/new';
    const filePage = onGitHub + '/new/' + encodeURIComponent(config.branch || 'main')
      + '?filename=' + encodeURIComponent(WORKFLOW_PATH) + '&value=' + encodeURIComponent(file);
    const outside = { target: '_blank', rel: 'noopener noreferrer' };

    root.replaceChildren(h('div', { class: 'pane-scroll' }, bar,
      h('div', { class: 'settings' },
        note('This lets ', b(name), ' read a recipe out of a screenshot or a photo. You send the pictures from the + button; the library reads them and the recipe comes back under To review. You set it up once for the library, and every device that uses the library can then send pictures.'),
        h('p', { class: 'howto-note', text: library.base.reader === true
          ? 'As of the last sync, this library has the file that does the reading (step 3). If pictures still come back unread, check the key in step 2.'
          : 'As of the last sync, this library does not have the file that does the reading yet.' }),
        h('p', { class: 'howto-note', text: 'These steps were run against a real library in November 2026. GitHub and Google rename their buttons now and then, so where a step does not match what you see, look for the closest one.' }),

        h('ol', { class: 'howto' },
          step('Get a key from Google',
            p('The reading is done by Google’s Gemini, on its free tier. Open Google AI Studio and sign in with a Google account. The first time, it asks you to accept its terms and then makes a key for you. Otherwise tap ', b('Create API key'), '. Copy the key.'),
            h('a', { class: 'btn btn-quiet', href: KEY_PAGE, ...outside }, 'Open Google AI Studio'),
            p('It costs nothing and needs no card. On the free tier Google may use what it is sent to improve its products, so send recipes and nothing private.')),

          step('Put the key in your library',
            p('The library keeps the key as a secret: once saved, nobody can read it back, not even you. Open the page below and sign in to GitHub if it asks.'),
            h('a', { class: 'btn btn-quiet', href: secretPage, ...outside }, 'Open the library’s new secret page'),
            h('ul', { class: 'howto-list' },
              h('li', null, p(b('Name:'), ' exactly this.'), piece(SECRET_NAME, 'the secret’s name')),
              h('li', null, p(b('Secret:'), ' paste the key from step 1.')),
              h('li', null, p('Tap ', b('Add secret'), '.')))),

          step('Add the file that does the reading',
            p('This small file tells GitHub to run the reader whenever pictures arrive in the library. Open the page below. The file’s name and its text should already be filled in.'),
            h('a', { class: 'btn btn-quiet', href: filePage, ...outside }, 'Open the library’s new file page'),
            h('ul', { class: 'howto-list' },
              h('li', null, p('If the name is empty, type or paste this as the name:'), piece(WORKFLOW_PATH, 'the file’s name')),
              h('li', null, p('If the large box is empty, copy the text and paste it in:'),
                h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => copy(file) }, 'Copy the file’s text')),
              h('li', null, p('Tap ', b('Commit changes'), ', then ', b('Commit changes'), ' again in the box that appears.'))),
            app ? null : p('This copy of the app is not served from GitHub Pages, so it could not work out its own repository. In the text, replace ', b('OWNER/NAME'), ' with the public repository the app is published from.'),
            h('details', { class: 'howto-code' }, h('summary', { text: 'Read the file' }), h('pre', { text: file }))),

          step('Try it',
            p('Back in Recipes, pull the list down to sync. This screen then says the library has the file.'),
            p('Tap ', b('+'), ' on the list, then ', b('From photos or screenshots'), '. Choose a picture of a recipe and send it. If the recipe runs over several pictures, choose them all, up to ' + MAX_PICTURES + '.'),
            p('The list shows the pictures being read. Within a minute or two the recipe appears under ', b('To review'), ', with the picture on top to check it against.'))),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'What to tell me' }),
          h('ul', { class: 'howto-ask' },
            h('li', { text: 'Which steps did not match what you saw, and what you saw instead.' }),
            h('li', { text: 'Whether the new file page in step 3 came with its name and text filled in.' }),
            h('li', { text: 'Whether the recipe came back under To review, and about how long it took.' }),
            h('li', { text: 'If the list says the pictures could not be read: the reason it gives.' }),
            h('li', { text: 'If nothing has happened after ten minutes: open the library on GitHub, tap Actions, and say whether there is a run called Import and whether it is green or red.' }))),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'What it costs' }),
          note('Nothing. Google’s free tier does the reading, and GitHub gives every private library a monthly allowance of running time that a recipe collection does not come near: each reading takes about a minute.')))));
    root.querySelector('.pane-scroll').scrollTop = keep;
  };

  const stop = subscribe(draw);   // connecting, or a sync that finds the file, changes what is shown
  draw();
  return stop;
}
