# Architecture

How the app is built today, and the plan for the parts that are not built yet. Sections marked
**Planned** describe intent; update them when the real thing is written.

## The pieces

| Piece | Where | State |
| --- | --- | --- |
| The app | This public repository, served by GitHub Pages | Built (core screens) |
| A library | One private repository per library, holding recipes, photos and folders | Built (recipes and folders) |
| The importer | Code in this repository, run by a GitHub Action inside each library | Planned |
| The AI reader | A free tier outside GitHub, called only by the importer, only for photos | Planned |
| Shortcuts | "Save to Recipes" and "Recipe Timer", installed on each iPhone | Planned |

Nothing runs on a server owned by this project. A device talks to GitHub Pages for the app's files
and, once syncing exists, to `api.github.com` for its library. The page's Content Security Policy in
`index.html` allows exactly those two.

## The app today

- `js/main.js` starts everything and shows a screen for the address: `#/` the list, `#/r/<id>` a
  recipe, `#/new`, `#/edit/<id>`, `#/settings`.
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
photos/, originals/, inbox/, .github/workflows/import.yml    planned, for photos and the importer
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
- **Changes made during a sync** are left alone by `applySync()` in `store.js` and go up next time.
- **The made-up example recipes are never synced.**
- **The key** is a fine-grained GitHub token limited to the one library repository with Contents read
  and write. It is stored in the browser's IndexedDB on that device only. Connecting refuses a
  repository that is public or that the key cannot write to.
- **Unknown fields** in a recipe file are kept, so an older version of the app does not strip what a
  newer one wrote.

`tests/fake-github.js` is a stand-in for the GitHub calls, kept in memory. The sync tests use it, and
`scripts/dev-server.mjs` serves it next to the app for trying syncing in a browser.

## Planned: getting recipes in

- **From Safari:** the "Save to Recipes" Shortcut runs a short script on the open page, takes the
  schema.org Recipe data, and writes it into the library. The app turns that into a recipe itself, so
  nothing waits for GitHub and no AI is involved.
- **Pasted links and photos:** the app writes a small file into `inbox/`. That push starts the library's
  workflow, which runs the importer from this repository. For a link it fetches the page and reads the
  same recipe data; for photos it sends the images to the AI reader and gets back a recipe. The result
  is committed as a recipe with `review: true`.
- The AI key is a repository secret in each library, passed to the importer explicitly. Organization
  secrets do not reach private repositories on GitHub's free plan.
- The reader sits behind one small interface so a different service can replace it.

## Planned: sending a recipe

A link to the app with the recipe compressed into the part after `#`, which browsers never send to a
server. Opening it shows the recipe and includes the same recipe data a normal recipe page has, so the
recipient's "Save to Recipes" Shortcut can save it.

## Things proven or still to prove

| Question | State |
| --- | --- |
| Do popular recipe sites answer an automatic request? | Tested November 2026: 13 of 25 gave full recipe data, 11 refused, 1 used an older format |
| Can a Home Screen web app start a Clock timer through a Shortcut? | To test with `proofs/timer.html` |
| Can a Shortcut read a recipe page and write into a library? | To test |
| Does the free AI reader cope with the owner's own screenshots? | To test |
| Does syncing work against real GitHub? | To test: so far it has only run against the stand-in |
