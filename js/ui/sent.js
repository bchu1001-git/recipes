// Sending a recipe as a link, and the page that shows a recipe someone sent (#/s/<packed recipe>).
//
// The link holds the recipe itself (see js/share.js), so the page needs no library and no sign-in:
// anyone who opens it can read the recipe. To keep it, the page carries the same kind of recipe data
// a recipe site's page has, which is what the Save to Recipes Shortcut reads. On an iPhone a link
// opens in Safari, not in the Home Screen app, so that Shortcut is the way into the person's library.
// A copy of the app that has a library connected (in a computer's browser, say) can keep it directly.
//
// Everything in a link was written by someone else. It is shown as text and nothing else.

import { h, icon, sheet, toast, go } from './dom.js';
import { copy } from './save.js';
import { library, subscribe, saveRecipe } from '../store.js';
import { sentRecipe, pack, unpack, shareLink, recipeData, LINK_LONG } from '../share.js';
import { recipeFromCapture, SCRIPT_VERSION } from '../import/page.js';
import { parseIngredient, amountLabel, itemLabel, isHeading, headingLabel, formatMinutes, webLink } from '../model.js';

/** The sheet that makes the link for one recipe and hands it to the share sheet or the clipboard. */
export function openSend(recipe) {
  sheet('Send this recipe', (close) => {
    const hasNotes = !!(recipe.notes && recipe.notes.mine);
    const include = h('input', { type: 'checkbox', checked: true });
    const status = h('p', { class: 'set-note', role: 'status', text: 'Making the link...' });
    const warning = h('p', { class: 'field-error', role: 'alert' });
    const share = h('button', { class: 'btn btn-main', type: 'button', disabled: true }, 'Share the link');
    const copyButton = h('button', { class: 'btn btn-quiet', type: 'button', disabled: true }, 'Copy the link');
    const canShare = typeof navigator.share === 'function';
    let link = '';
    let turn = 0;

    const make = async () => {
      const mine = ++turn;
      share.disabled = true;
      copyButton.disabled = true;
      const withNotes = hasNotes && include.checked;
      const data = sentRecipe(recipe, { myNotes: withNotes });
      const packed = data ? await pack(data) : '';
      if (mine !== turn) return;   // the switch was changed again meanwhile
      link = packed ? shareLink(location.origin + location.pathname, packed) : '';
      if (!link) {
        status.textContent = 'There is nothing in this recipe to send yet.';
        warning.textContent = '';
        return;
      }
      status.textContent = 'The link holds the whole recipe: ' + link.length.toLocaleString() + ' characters.';
      warning.textContent = link.length > LINK_LONG
        ? 'This is a long link, and some apps cut long links short.' + (withNotes ? ' Leaving out your notes makes it shorter.' : '')
        : '';
      share.disabled = false;
      copyButton.disabled = false;
    };

    include.addEventListener('change', make);
    share.addEventListener('click', async () => {
      if (!link) return;
      try {
        await navigator.share({ title: recipe.title, url: link });
        close();
      } catch (err) {
        // Closing the share sheet without choosing is not a problem. Anything else is said.
        if (!err || err.name !== 'AbortError') toast('Sharing did not work here. Copy the link instead.');
      }
    });
    copyButton.addEventListener('click', () => { if (link) copy(link); });
    make();

    return [
      h('div', { class: 'send' },
        h('p', { class: 'set-note', text: 'This makes a link with the recipe itself inside it. Whoever opens it can read the recipe, and keep it in their own Recipes. Pictures, folders and your rating are not sent.' }),
        hasNotes ? h('label', { class: 'send-check' }, include, h('span', { text: 'Include my notes' })) : null,
        status,
        warning),
      h('div', { class: 'sheet-actions' }, copyButton, canShare ? share : null),
    ];
  });
}

/** The lines of a sent recipe, read-only: headings as headings, and no ticks or folds. */
function ingredients(lines) {
  if (!lines.length) return h('p', { class: 'quiet', text: 'No ingredients came with it.' });
  return h('ul', { class: 'ing ing-plain' }, lines.map((line) => {
    if (isHeading(line)) return h('li', { class: 'part-head' }, h('h3', { text: headingLabel(line) }));
    const ing = parseIngredient(line);
    return h('li', null, h('div', { class: 'ing-row' },
      h('span', { class: 'ing-amount', text: amountLabel(ing) }),
      h('span', { class: 'ing-item', text: itemLabel(ing) })));
  }));
}

function steps(lines) {
  if (!lines.length) return h('p', { class: 'quiet', text: 'No steps came with it.' });
  let number = 0;
  return h('ol', { class: 'steps' }, lines.map((line) => (isHeading(line)
    ? h('li', { class: 'part-head' }, h('h3', { text: headingLabel(line) }))
    : h('li', { 'data-n': String(++number), text: line }))));
}

export function renderSent(root, packed) {
  const pageTitle = document.title;
  let live = true;
  let data = null;
  let block = null;   // the recipe data added to the page for the Save to Recipes Shortcut

  const frame = (...kids) => h('div', { class: 'pane-scroll' },
    h('header', { class: 'bar bar-detail' },
      h('a', { class: 'back', href: '#/' }, icon('back'), 'Recipes'),
      h('span', { class: 'bar-heading', text: 'Sent recipe' }),
      h('span', { class: 'bar-spacer' })),
    ...kids);

  const keepHere = async () => {
    // Read exactly as the Shortcut's capture would be, so both ways in give the same recipe.
    const { recipe } = recipeFromCapture({
      v: 1, s: SCRIPT_VERSION, url: location.href, title: data.t, at: new Date().toISOString(),
      ld: [JSON.stringify(recipeData(data))],
    });
    await saveRecipe(recipe);
    toast('Kept. It is waiting under To review.');
    go('r/' + recipe.id);
  };

  const draw = () => {
    if (!live || !data) return;
    const scroller = root.querySelector('.pane-scroll');
    const keep = scroller ? scroller.scrollTop : 0;
    const meta = [formatMinutes(data.m), data.y ? 'Serves ' + data.y : ''].filter(Boolean);
    const link = webLink(data.f.u);
    root.replaceChildren(frame(
      h('article', { class: 'recipe sent' },
        h('p', { class: 'kicker', text: 'Sent to you' }),
        h('h1', { class: 'recipe-title', text: data.t || 'A recipe' }),
        h('p', { class: 'meta' },
          meta.join(' · '),
          meta.length && (data.f.n || link) ? ' · ' : '',
          link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', text: data.f.n || 'Source' }) : data.f.n),
        h('div', { class: 'howto-note sent-keep' },
          h('p', { text: 'To keep this recipe on an iPhone, tap Share, then Save to Recipes. It arrives in your Recipes app under To review.' }),
          library.config
            ? h('button', { class: 'btn btn-main', type: 'button', onclick: keepHere }, 'Keep in my library')
            : null),
        h('h2', { class: 'label', text: 'Ingredients' }),
        ingredients(data.i),
        h('h2', { class: 'label', text: 'Steps' }),
        steps(data.s),
        data.n ? [h('h2', { class: 'label', text: 'Notes' }), h('p', { class: 'note', text: data.n })] : null)));
    root.querySelector('.pane-scroll').scrollTop = keep;
  };

  root.replaceChildren(frame(h('div', { class: 'settings' }, h('p', { class: 'set-note', text: 'Opening the recipe...' }))));

  unpack(packed).then((out) => {
    if (!live) return;
    if (!out.ok) {
      root.replaceChildren(frame(h('div', { class: 'settings' },
        h('p', { class: 'howto-note', text: out.reason }),
        h('a', { class: 'btn btn-quiet', href: '#/' }, 'Go to Recipes'))));
      return;
    }
    data = out.data;
    // The recipe data goes into the page as text inside a data block. It is never run.
    block = document.createElement('script');
    block.type = 'application/ld+json';
    block.textContent = JSON.stringify(recipeData(data));
    document.head.append(block);
    document.title = data.t || pageTitle;
    draw();
  });

  // Connecting or disconnecting a library changes whether it can be kept here.
  const stop = subscribe(draw);
  return () => {
    live = false;
    stop();
    if (block) block.remove();
    document.title = pageTitle;
  };
}
