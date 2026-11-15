# Architecture

How the app is built today, and the plan for the parts that are not built yet. Sections marked
**Planned** describe intent; update them when the real thing is written.

## The pieces

| Piece | Where | State |
| --- | --- | --- |
| The app | This public repository, served by GitHub Pages | Built (core screens and To review) |
| A library | One private repository per library, holding recipes, photos and folders | Built (recipes, folders and the inbox) |
| The importer | Code in this repository, run by a GitHub Action inside each library | Planned; its web-page reader is built |
| The AI reader | A free tier outside GitHub, called only by the importer, only for photos | Planned |
| Shortcuts | "Save to Recipes" and "Recipe Timer", made on each iPhone | Save to Recipes: its page script and the steps for making it are built, and it is still to be tried on a phone. Recipe Timer: planned |

Nothing runs on a server owned by this project. A device talks to GitHub Pages for the app's files
and to `api.github.com` for its library. The page's Content Security Policy in
`index.html` allows exactly those two.

## The app today

- `js/main.js` starts everything and shows a screen for the address: `#/` the list, `#/r/<id>` a
  recipe, `#/new`, `#/edit/<id>`, `#/settings`, `#/save` (the steps for the Shortcut). A recipe that is
  still waiting for review opens on the review screen instead of its own page.
- Three panes exist at all times: sidebar, list, detail. A phone shows one at a time, chosen by
  `data-view` on `#app`. A window 900 pixels or wider shows all three. Inside the detail pane, a
  container query lays ingredients and steps side by side once that pane is 46rem wide.
- `js/store.js` holds the library in memory and saves it to IndexedDB (`recipes` and `meta` stores).
  Screens call `subscribe()` and redraw themselves after any change.
- `js/ui/state.js` holds what is on screen right now: search text, chosen folders, the open tab,
  ticked ingredients. None of it is saved.
- `js/model.js` has every rule that does not need a screen: building a recipe, splitting an ingredient
  line, finding times in a step, search, filtering, sorting.

### A recipe

```
id         "r" plus random letters; never changes
title
source     { kind: manual | web | screenshot | photo | shared, name, url }
minutes    total time, or null
serves     text, as written
ingredients  [{ text, qty, unit, item, note }]   text is the line as written
steps        [{ text, timers: [minutes] }]
notes      { mine, source }
folders    ["group:folder", ...]
goto       true for the version that gets cooked
rating     0 to 5
photo      path of its photo, or ""
originals  paths of the screenshots it was read from
review     true while it waits under To review
created, updated, by
```

Each ingredient is kept two ways on purpose. `text` is what was written and is what the editor shows.
`qty`, `unit` and `item` are for scaling, unit conversion, the pantry list and the shopping list
later.

### Folders

`{ groups: [{ id, name, folders: [{ id, name }] }] }`. A folder id is `group:slug` and does not change
when the folder is renamed, so recipes keep pointing at it.

### Offline

`sw.js` caches the app's files under a name that includes a build stamp. It is generated from
`sw.template.js` by `scripts/publish.sh`, which fills in a new stamp and the list of files on every
publish. That is what makes each device fetch the new version the next time it is online. The stamp
goes into a commit of its own, after your change, so two computers never clash over it. The worker is not registered on `localhost`, where a cached copy would hide changes.
To try it locally anyway, open `http://localhost:8787/?sw`, and unregister it afterwards in the
browser's developer tools.

## A library

One private repository per library:

```
recipes/       one JSON file per recipe
folders.json   groups and folders, with the time they last changed and the folders that were deleted
deleted.json   ids of deleted recipes with the time, so a later sync does not bring them back
clashes/       a device's version of a recipe that lost to a newer one from another device
README.md      written by the app when it starts an empty library
inbox/         pages saved from Safari, waiting to be read at the next sync. Anything else in it is left alone
photos/, originals/, .github/workflows/import.yml    planned, for photos and the importer
```

One file per recipe means two people changing different recipes never collide, and the repository's
history holds every earlier version of each one. The app starts an empty repository itself, so a
library needs no template.

## Syncing

Code: `js/sync/`. `sync.js` and `merge.js` work on plain data, so the tests run them without a browser.

- **When** (`auto.js`): when the app opens, eight seconds after the last change, when the app is left
  with changes not yet sent, when it comes back after an hour or after a failed sync, when the list is
  pulled down, and when the status next to the title is tapped.
- **Reading:** one call for the newest commit, one for its file tree. Each file's hash is compared with
  the hash the same content would have on this device; only files that differ are downloaded. A sync
  with nothing to do costs three small requests and makes no commit.
- **Merging** (`merge.js`): per recipe, the copy with the newer `updated` wins. A deletion and an edit
  compete the same way, using the time in `deleted.json`, so editing a recipe after another device
  deleted it brings it back. Folders are merged one by one; names and order come from the side that
  changed its folders more recently.
- **A real clash** is when both sides changed the same recipe since the last sync. The newer one wins
  and the other device's version is written to `clashes/` so it is not lost. The app does not show
  that folder yet.
- **Writing:** everything GitHub lacks goes up as one commit through the Git Data API, named for the
  device ("iPhone: 2 recipes changed"). If the branch moved in the meantime, the round starts over.
- **The inbox:** during a sync, every `inbox/*.json` file that holds a capture (an object with an `ld`
  list or a `url`, and no `job` field) is turned into a recipe by `recipeFromCapture`. The same commit
  adds `recipes/<id>.json` and removes the inbox file, so after one sync by any device the page is a
  recipe with `review: true`.
  - The id comes from the file's path and the hash of its content. Both are the same on every device,
    so two devices that read the same file at the same moment make the same recipe. The second one
    finds the branch has moved, starts over, and receives the first one's.
  - If a recipe with that id already exists, or was deleted, nothing is made or overwritten and the
    file is simply removed.
  - `created` and `updated` are the capture's `at`, unless that is missing, unreadable or in the future.
  - Everything else in `inbox/` is left exactly as it is: other kinds of file, anything with a `job`
    field, anything over 1.5 MB, anything that is not JSON. That room is kept for the importer's jobs.
    A file that was looked at and left is remembered by its hash and not downloaded again.
  - Nothing in the inbox can make a sync fail, apart from losing the connection or the key.
- **Changes made during a sync** are left alone by `applySync()` in `store.js` and go up next time.
- **The made-up example recipes are never synced.**
- **The key** is a fine-grained GitHub token limited to the one library repository with Contents read
  and write. It is stored in the browser's IndexedDB on that device only. Connecting refuses a
  repository that is public or that the key cannot write to.
- **Unknown fields** in a recipe file are kept, so an older version of the app does not strip what a
  newer one wrote.

`tests/fake-github.js` is a stand-in for the GitHub calls, kept in memory. The sync tests use it, and
`scripts/dev-server.mjs` serves it next to the app for trying syncing in a browser.

## Getting recipes in

- **From Safari (built, apart from proving the Shortcut on a phone):** the "Save to Recipes" Shortcut
  runs a short script on the open page, takes the schema.org Recipe data, and writes it into the
  library's `inbox/` as a capture (described below). The app turns that into a recipe itself at its
  next sync, so nothing waits for GitHub and no AI is involved.
- **Pasted links and photos (planned):** the app writes a small file into `inbox/`. That push starts the library's
  workflow, which runs the importer from this repository. For a link it fetches the page and reads the
  same recipe data; for photos it sends the images to the AI reader and gets back a recipe. The result
  is committed as a recipe with `review: true`.
- The AI key is a repository secret in each library, passed to the importer explicitly. Organization
  secrets do not reach private repositories on GitHub's free plan.
- The reader sits behind one small interface so a different service can replace it.

### The web-page reader

`js/import/page.js` turns a capture into a recipe waiting for review. Syncing calls it for every
capture it finds in the inbox. It has no screen, storage or network code in it, so the importer on
GitHub can use the same file for pasted links.

A capture is one small JSON file:

```
v       1
url     the page's address
title   the page's title
site    the site's name, when the page states one                 (optional)
at      when it was saved, as an ISO time                         (optional)
ld      the raw text of every <script type="application/ld+json"> block on the page
text    the page's visible text, for the AI reader later          (optional, not used yet)
```

The `ld` blocks are kept as the text they were written as, so a page with broken JSON cannot break
the Shortcut. The reader skips a block it cannot parse, after trying the usual repairs.

`recipeFromCapture(capture, now)` returns `{ recipe, found, problems }`:

- It looks through all of the data for schema.org Recipe entries, wherever they sit (at the top, in
  a list, under `@graph`, under `mainEntity`), and keeps the fullest one.
- `recipe` is built with `makeRecipe()`, with `source.kind` set to `web` and `review: true`. It keeps
  the title, ingredients, steps, total time, servings, the site's name and the link. The story,
  pictures, ratings and nutrition are left out.
- Steps may arrive as one block of text, numbered text, HTML, a list of strings, or step and section
  objects. A section's name goes in front of its first step. Tips listed among the steps, and lines
  such as "Do ahead:" or "Editor's note:", go to `notes.source` instead of the steps.
- `found` is false when the page carries no such data. The recipe is then only the page's title and
  link, for the person to fill in.
- `problems` holds short sentences for the review screen, such as "No steps were found".

Everything in a capture was written by a web page, so it is treated as untrusted text. Tags are
removed and entities decoded with string code, nothing is parsed as HTML, only a link that starts
with http or https is kept, sizes are capped, and the function never throws.

A page that describes its recipe only with the older in-page markup (microdata) has no `ld` blocks.
The page script below translates that markup into the same kind of data and adds it to `ld`, so the
reader did not need to change.

Two more things the check on real pages showed. `parseIngredient` in `js/model.js` reads "2 and 1/4
cups" as 2, and loses the unit in "150g/5oz", "2 c." and units written in other languages. The line
as written is always kept, so nothing is lost on screen; it matters once scaling and unit conversion
are built. And the importer on GitHub will need a small function that makes a capture from a page's
HTML, which is not written yet.

### The page script and the Shortcut

`shortcuts/save-page.js` is the script the Shortcut's "Run JavaScript on Webpage" action runs on the
page open in Safari. It builds a capture and hands it to the Shortcut as base64 of plain JSON, which
is exactly what GitHub's "create a file" call takes as `content`.

- Blocks that mention a recipe go first. The whole capture is kept under about 700 KB, so one call
  always fits; a block that would push it over is left out.
- If no block holds a Recipe, schema.org microdata in the page is translated into one. Where that
  markup leaves the steps out, the part of the recipe named for its directions is read as the steps.
- It reads the one page and nothing else, changes nothing, and cannot throw: on any error it still
  hands over the page's address and title.
- It is plain ASCII, so pasting it into Shortcuts cannot change it. `tests/save-page.test.js` runs it
  against a pretend page.

The Shortcut has four actions: Run JavaScript on Webpage (the script); Format Date (the file name,
`yyyyMMdd-HHmmss`); Get Contents of URL (a PUT to `.../contents/inbox/<name>.json` on `api.github.com`
with an `Authorization: Bearer` header and a JSON body of `message` and `content`); Show Result. It
holds a key of its own, limited to the library, so it can be cancelled without touching the app's key.

It is made by hand on each iPhone. The steps, with the library's own address filled in and a Copy
button for every piece of text, are in the app: Settings, Save from Safari (`js/ui/save.js`, the
address `#/save`). The app never shows or copies the key it stores.

### To review

A recipe with `review: true` stays out of the list, the search and the folder counts
(`keptRecipes` and `waitingRecipes` in `js/model.js`). An entry at the top of the list, and in the
sidebar on a wide window, shows how many are waiting and is hidden when there are none. A sync that
brings some says so wherever the person is.

The review screen (`js/ui/review.js`) keeps the original on top: the site's name, a link that opens the
page, and a plain sentence for anything that looks missing, worked out from the recipe itself by
`reviewNotes`. Under it are the editor's own fields (`recipeFields` in `js/ui/editor.js`), then
**Keep**, which saves it as an ordinary recipe, and **Discard**, which deletes it after asking. A
source address is only ever used as a link when `webLink` says it starts with http or https.

## Planned: sending a recipe

A link to the app with the recipe compressed into the part after `#`, which browsers never send to a
server. Opening it shows the recipe and includes the same recipe data a normal recipe page has, so the
recipient's "Save to Recipes" Shortcut can save it.

## Things proven or still to prove

| Question | State |
| --- | --- |
| Do popular recipe sites answer an automatic request? | Tested November 2026: 13 of 25 gave full recipe data, 11 refused, 1 used an older format |
| Can a Home Screen web app start a Clock timer through a Shortcut? | Proven November 2026 on an iPhone with `proofs/timer.html`: the timer starts and rings with the phone locked. The phone is left in Shortcuts afterwards. Asking Shortcuts to come back opens the page in Safari, not the Home Screen app, so the kitchen view should use the plain link and let the person return |
| Can a Shortcut read a recipe page and write into a library? | To test on a phone, with the steps in Settings, Save from Safari. The page script on its own was run on three live recipe pages in a desktop browser in November 2026, one of them with only the older in-page markup, and the reader made a full recipe from each |
| Does the web-page reader cope with real recipe pages? | Tested November 2026 on saved copies of one recipe page from each of 23 sites: 22 gave a full recipe; 1 had only the older in-page markup and gave a title and link |
| Does the free AI reader cope with the owner's own screenshots? | To test |
| Does syncing work against real GitHub? | Proven November 2026: an iPhone connected to an empty private library and synced |
