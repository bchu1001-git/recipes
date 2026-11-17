// Timers in the Clock app: how to make the "Recipe Timer" Shortcut that lets the kitchen view start a
// timer in the phone's own Clock, and a way to try it. Settings leads here when the Clock app is chosen.
//
// The Shortcut takes a number of minutes and starts a Clock timer for it. The kitchen view opens it
// with a plain link (timerLink in js/kitchen.js) and keeps its own count beside it.

import { h, icon } from './dom.js';
import { b, p, piece, step } from './save.js';
import { timerMode, setTimerMode, onTimers } from './timers.js';
import { timerLink, returnAddress } from '../kitchen.js';

export function renderClockSetup(root) {
  let shown = '';
  const draw = () => {
    const scroller = root.querySelector('.pane-scroll');
    const keep = scroller ? scroller.scrollTop : 0;
    shown = timerMode();
    const clock = shown === 'clock';
    const back = returnAddress(location.host, location.pathname);

    root.replaceChildren(h('div', { class: 'pane-scroll' },
      h('header', { class: 'bar bar-detail' },
        h('a', { class: 'back', href: '#/settings' }, icon('back'), 'Settings'),
        h('span', { class: 'bar-heading', text: 'Timers in the Clock app' }),
        h('span', { class: 'bar-spacer' })),
      h('div', { class: 'settings' },
        h('p', { class: 'set-note' },
          'In the kitchen view, each time a step mentions is a timer you can start with a tap. Handed to the iPhone’s ',
          b('Clock'), ' app, the timer rings even when the phone is locked or you are in another app. That needs a small Shortcut called ',
          b('Recipe Timer'), ', which you make once on this iPhone. It takes a few minutes.'),

        h('section', { class: 'set' },
          h('p', { class: 'set-status', role: 'status', text: clock
            ? 'On this device, timers go to the Clock app.'
            : 'On this device, timers run in this app. They ring only while Recipes is open on screen.' }),
          clock
            ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => setTimerMode('here') }, 'Use timers in this app instead')
            : h('button', { class: 'btn btn-main', type: 'button', onclick: () => setTimerMode('clock') }, 'Send timers to the Clock app')),

        h('p', { class: 'howto-note', text: 'These steps were run on an iPhone with iOS 27 in November 2026. Shortcuts names things a little differently from one iOS version to the next, so where a step does not match what you see, look for the nearest thing.' }),

        h('ol', { class: 'howto' },
          step('Start the Shortcut',
            p('Open the ', b('Shortcuts'), ' app and tap ', b('+'), '. Tap the name at the top, choose ', b('Rename'), ', and call it exactly this:'),
            piece('Recipe Timer', 'the name')),

          step('Add the timer',
            p('Search the actions for ', b('Start Timer'), ' and add it.')),

          step('Let Recipes say how long',
            p('In that action, tap the number. From the row just above the keyboard, choose ', b('Shortcut Input'), '. Leave the unit on ', b('minutes'), '. Then tap ', b('Done'), '.')),

          step('Come back to Recipes by itself',
            p('Without this, starting a timer leaves you in the Shortcuts app. Open the Shortcut again, search the actions for ', b('Open URLs'), ', and add it below Start Timer. Tap its ', b('URL'), ' and paste this, then tap ', b('Done'), ':'),
            back ? piece(back, 'the address that comes back to Recipes') : p('This copy of the app could not work out its own address. Open this screen in the app you added to the Home Screen.'),
            p('It is the address of this app with ', b('webapp://'), ' in front, which opens the app on the Home Screen itself, not a page in Safari.')),

          step('Try it',
            p('Tap the button below. The phone goes to the Shortcuts app, a 1 minute timer starts in Clock, and Recipes comes back to the front. The timer rings even if you lock the phone.'),
            h('a', { class: 'btn btn-main', href: timerLink(1) }, icon('timer'), 'Start a 1 minute timer'),
            p('If the phone says the address is not valid, delete the Open URLs action. The timer still starts; you then come back to Recipes yourself, with a swipe along the bottom edge of the screen.'))),

        h('section', { class: 'set' },
          h('h2', { class: 'label', text: 'Good to know' }),
          h('ul', { class: 'howto-ask' },
            h('li', { text: 'With the Open URLs action in place, Recipes comes back by itself at the step you were on. Without it, you are left in the Shortcuts app, and one swipe along the bottom edge brings Recipes back.' }),
            h('li', { text: 'Recipes keeps its own count of the time left, worked out from the moment you tapped. It cannot see the timer in Clock, so stopping or changing it there does not show here. Clear it here with the x beside it.' }),
            h('li', { text: 'A step that says “5 to 7 minutes” offers both, so you can look early and then go on.' }),
            h('li', { text: 'Each device chooses for itself. Another phone using the same library is not affected.' }))))));
    root.querySelector('.pane-scroll').scrollTop = keep;
  };

  // The choice above changes what this screen says. A running timer also calls in here twice a second,
  // and that is no reason to draw the screen again.
  const stop = onTimers(() => { if (timerMode() !== shown) draw(); });
  draw();
  return () => stop();
}
