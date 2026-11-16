// How to make the "Send to Recipes" Shortcut, step by step, with every piece of text ready to copy.
// It sits in the share sheet of other apps. Given a note that holds pictures of a recipe, or pictures
// from the photo library, it writes them into the connected library as one file, inbox/job-<number>.json,
// holding the base64 of each picture on a line of its own. The library's importer unpacks that file
// and reads the recipe, which then turns up under To review. See js/jobs.js for the file and
// importer/unpack.mjs for how it is read.
//
// The Shortcut has eight actions in a straight line, and nothing in it is typed out by hand except a
// file ending: the importer finds the pictures in whatever arrives, so no JSON has to be put together.
//
// The key this device uses is never shown or copied here.

import { h, icon } from './dom.js';
import { library, subscribe } from '../store.js';
import { piece, b, p, note, step } from './save.js';
import { MAX_JOB_PICTURES } from '../jobs.js';

export function renderSendSetup(root) {
  const draw = () => {
    const scroller = root.querySelector('.pane-scroll');
    const keep = scroller ? scroller.scrollTop : 0;
    const config = library.config;

    const bar = h('header', { class: 'bar bar-detail' },
      h('a', { class: 'back', href: '#/settings' }, icon('back'), 'Settings'),
      h('span', { class: 'bar-heading', text: 'Send to Recipes' }),
      h('span', { class: 'bar-spacer' }));

    if (!config) {
      root.replaceChildren(h('div', { class: 'pane-scroll' }, bar,
        h('div', { class: 'settings' },
          h('p', { class: 'set-note', text: 'Pictures shared from another app are written into your library and read there. Connect a library in Settings first, then come back here.' }),
          h('a', { class: 'btn btn-main', href: '#/settings' }, 'Open Settings'))));
      return;
    }

    const address = 'https://api.github.com/repos/' + config.owner + '/' + config.repo + '/contents/inbox/job-';
    const keyForm = 'https://github.com/settings/personal-access-tokens/new?name=Recipes+Send+Shortcut'
      + '&description=' + encodeURIComponent('Lets the Send to Recipes Shortcut add pictures to the library')
      + '&target_name=' + encodeURIComponent(config.owner) + '&expires_in=none&contents=write';

    root.replaceChildren(h('div', { class: 'pane-scroll' }, bar,
      h('div', { class: 'settings' },
        h('p', { class: 'set-note' },
          'This puts ', b('Send to Recipes'), ' in the share sheet of other apps. Share a note that holds pictures of a recipe, or pictures from Photos, and they go to your library to be read. The recipe then shows up here under To review, with no trip through the photo library. You make the Shortcut once, by hand, on this iPhone. It has eight actions and takes about ten minutes.'),
        h('p', { class: 'howto-note', text: library.base.reader === true
          ? 'As of the last sync, this library is set up to read pictures, which this Shortcut relies on.'
          : 'This library is not set up to read pictures yet, and this Shortcut relies on that. Do Settings, Read photos first.' }),
        library.base.reader === true ? null : h('a', { class: 'btn btn-quiet', href: '#/read' }, 'Set up Read photos'),
        h('p', { class: 'howto-note', text: 'This is a first try. It has not been run on a phone yet, and Shortcuts names things a little differently from one iOS version to the next. Where a step does not match what you see, note what you see instead.' }),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'Putting a variable in a field' }),
          note('Two fields in step 9 need a variable: a blue bubble that stands for the result of an earlier action. Tap the field, then look at the row just above the keyboard and tap the variable that is named. If it is not in that row, tap ', b('Select Variable'), ' and then tap the result shown under the action it comes from. Every other action picks up the result of the action above it by itself.')),

        h('ol', { class: 'howto' },
          step('Start the Shortcut',
            p('Open the ', b('Shortcuts'), ' app and tap ', b('+'), '. Tap the name at the top, choose ', b('Rename'), ', and call it ', b('Send to Recipes'), '.')),

          step('Put it in the share sheet',
            p('This is a setting of the Shortcut, not an action, so it is not in the action search. At the bottom of the Shortcut\'s screen there is a small ', b('i'), ' in a circle. Tap it to open ', b('Details'), ', turn on ', b('Show in Share Sheet'), ', then tap ', b('Done'), ' or the tick.'),
            p('A row that begins with ', b('Receive'), ' appears at the top of the Shortcut. Leave the kinds in it as they are.')),

          step('Take the pictures',
            p('Search the actions for ', b('Get Images from Input'), ' and add it. It should read "Get images from Shortcut Input". If its box is empty, tap it and choose ', b('Shortcut Input'), '.')),

          step('Make them JPEG',
            p('Add the action ', b('Convert Image'), '. It should read "Convert Images to JPEG". If it names another format, tap the format and choose ', b('JPEG'), '. This makes screenshots a good deal smaller.')),

          step('Turn them into text',
            p('Add the action ', b('Base64 Encode'), '. It should read "Encode Converted Image with base64". Tap its arrow, or ', b('Show More'), ', and set ', b('Line Breaks'), ' to ', b('None'), '.')),

          step('Join them',
            p('Add the action ', b('Combine Text'), '. It should read "Combine Base64 Encoded with New Lines". Leave it exactly like that: there is nothing to change.')),

          step('Turn that into text too',
            p('Add ', b('Base64 Encode'), ' a second time. It should read "Encode Combined Text with base64". Set its ', b('Line Breaks'), ' to ', b('None'), ' as well.')),

          step('Give the file a name',
            p('Each lot of pictures needs a file name that has not been used before, and a random number does that. Add the action ', b('Random Number'), '. It reads "Random number between ... and ...". Tap the first value and type the first number below, then tap the second and type the other.'),
            piece('100000', 'the smallest number'),
            piece('999999999', 'the largest number')),

          step('Send it to your library',
            p('Add the action ', b('Get Contents of URL'), '.'),
            h('ul', { class: 'howto-list' },
              h('li', null, p(b('URL:'), ' paste this. With the cursor at its end, put in the variable ', b('Random Number'), ', then type ', b('.json'), '. It ends up as the address, a blue Random Number bubble, then .json'), piece(address, 'the address')),
              h('li', null, p('Tap ', b('Show More'), ' and set ', b('Method'), ' to ', b('PUT'), '.')),
              h('li', null, p(b('Headers:'), ' add one. Its key is:'), piece('Authorization'),
                p('Its text is filled in by the next step.')),
              h('li', null, p(b('Request Body:'), ' choose ', b('JSON'), '. Add a ', b('Text'), ' field with this key:'), piece('message'),
                p('and this text:'), piece('Pictures to read')),
              h('li', null, p('Add a second ', b('Text'), ' field with this key:'), piece('content'),
                p('For its text, put in the variable ', b('Base64 Encoded'), ' from step 7: the second of the two, not the first. If the row shows two with that name, use ', b('Select Variable'), ' and tap the result under step 7.')))),

          // The key comes last on purpose: once copied, nothing else should be copied before it is pasted.
          step('Put the key in',
            p('The Shortcut writes into ', b(config.owner + '/' + config.repo), ', so it needs a key in the ', b('Authorization'), ' header. It is not the key this app uses. There are two ways to get one.'),
            p(b('If you have made Save to Recipes:'), ' it can share that Shortcut\'s key. Open Save to Recipes for editing, tap the text of its Authorization header, choose ', b('Select All'), ' and ', b('Copy'), '. Come back to this Shortcut and paste it as the text of the Authorization header here. It starts with the word Bearer.'),
            p(b('Otherwise, make a new key:'), ' open the form below. ', b('Resource owner'), ' should say ', b(config.owner), '. Under ', b('Repository access'), ' choose ', b('Only select repositories'), ', then ', b(config.repo), '. ', b('Contents'), ' should say ', b('Read and write'), '. Generate the token and copy it. GitHub shows it only once, so copy nothing else: go straight back to Shortcuts and, as the text of the Authorization header, type the word below, a space, and then paste. It ends up looking like Bearer github_pat_...'),
            h('a', { class: 'btn btn-quiet', href: keyForm, target: '_blank', rel: 'noopener noreferrer' }, 'Open GitHub\'s new key form'),
            piece('Bearer'),
            p('The key is now inside the Shortcut, so do not share the Shortcut with anyone.')),

          step('Show what GitHub answered',
            p('Add the action ', b('Show Content'), ', which older versions call ', b('Show Result'), ', and make sure it shows ', b('Contents of URL'), '. Then tap ', b('Done'), '.')),

          step('Try it',
            p('In Notes, open a note that holds pictures of a recipe. Tap ', b('Share'), ' and, if it offers a choice, ', b('Send Copy'), '. Choose ', b('Send to Recipes'), '. It may be far down the list.'),
            p('The first time, the phone asks whether the Shortcut may connect to api.github.com. Allow it.'),
            p('A result then appears. If it mentions content and commit, the pictures are in your library. Come back to Recipes and pull the list down to sync: it shows pictures from another app being read, and within a minute or two the recipe appears under ', b('To review'), '.'),
            p('Give the recipe its title while you review it. A note is shared as its pictures plus one picture of the whole note, and the reader looks at that one for the title, but it may not find it.'))),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'Good to know' }),
          h('ul', { class: 'howto-ask' },
            h('li', { text: 'It works from Photos and from any other app that shares pictures, as well as from Notes.' }),
            h('li', { text: 'Everything shared in one go is read as one recipe, up to ' + MAX_JOB_PICTURES + ' pictures. Share two recipes one after the other.' }),
            h('li', { text: 'Only pictures are taken. Text typed into a note comes along only inside the picture of the whole note.' }),
            h('li', { text: 'The list here shows no count or title while such pictures are being read, because the app does not download them.' }))),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'If the result shows a message instead' }),
          note('GitHub refused what was sent, and the message says why.'),
          h('ul', { class: 'howto-ask' },
            h('li', { text: 'Bad credentials: the key was not pasted whole, has no space before it, or has been cancelled.' }),
            h('li', { text: 'Not Found: the key cannot reach this library. Check its Resource owner and its repository, and the address in the URL.' }),
            h('li', { text: 'Resource not accessible: the key can read but not write. Contents must say Read and write.' }),
            h('li', { text: 'A message about "sha": a file with that number is already there, which is rare. Share the pictures again.' }),
            h('li', { text: 'A message about "content": what reached GitHub was not the text from step 7. Check which variable the content field holds.' }))),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'What to tell me' }),
          h('ul', { class: 'howto-ask' },
            h('li', { text: 'Which steps did not match what you saw, and what you saw instead.' }),
            h('li', { text: 'What the result in the last step said: the first line or two is enough.' }),
            h('li', { text: 'Whether Recipes showed pictures from another app being read after a sync.' }),
            h('li', { text: 'How many pictures the recipe says it was read from, against how many the note holds.' }),
            h('li', { text: 'Whether the title was picked up from the note, and whether any typed text reached the notes.' }),
            h('li', { text: 'If the list says what was shared could not be read: the reason it gives.' }))))));
    root.querySelector('.pane-scroll').scrollTop = keep;
  };

  const stop = subscribe(draw);   // connecting, or a sync that finds the reader, changes what is shown
  draw();
  return stop;
}
