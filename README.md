# Recipes

A personal recipe app that runs from GitHub Pages. You open one web address on a phone or a Mac, add it
to the Home Screen or the Dock, and it behaves like an app: its own icon, full screen, works offline.

There is no server and no build step. The whole app is the plain HTML, CSS and JavaScript in this
repository, and your recipes live in your own storage, never in this repository.

## Where things stand

Built and working:

- Add a recipe by hand, edit it, delete it.
- Grouped folders (main ingredient, dish, meal, cuisine, your own lists). A recipe can sit in several.
  Folders in one group widen the list; folders in different groups narrow it.
- Search across titles, ingredients, steps and notes.
- A heart for the Go-to version of a dish, and a 1 to 5 rating.
- The recipe page with its Ingredients / Steps / Notes switch and tick-off circles. On a wide window
  the three parts sit side by side.
- Appearance: match the device, or force Light or Dark.
- A backup file you can save and open again.
- Syncing between devices through a private GitHub repository (a "library"): connect in Settings with
  the library's name and a key. It syncs when the app opens, a few seconds after a change, when you
  pull the list down, and when you tap the status next to the title.

Not built yet, in this order: saving links from Safari, reading screenshots and photos, the kitchen
view with timers, sharing with other people. See [docs/decisions.md](docs/decisions.md) for what was decided and
[docs/architecture.md](docs/architecture.md) for how the pieces will fit.

A device that is not connected to a library keeps its recipes only in its own browser. Use Settings,
Save a backup, or connect a library.

## Try it on your own computer

```bash
scripts/serve.sh
```

Then open http://localhost:8787. Make the window narrower than 900 pixels to see the phone layout.
Nothing needs installing: the script uses the `python3` that comes with macOS developer tools.

## Run the tests

```bash
node --test tests/*.test.js
```

The tests cover the data logic (reading an ingredient line into amount, unit and item, finding times in
a step, search and folder filtering), the rules for merging two copies of a library, and syncing
against a stand-in for GitHub kept in memory. They need Node.js 20 or later and nothing else. The app
itself does not need Node.

To try syncing in a browser without touching GitHub, run `node scripts/dev-server.mjs` and follow the
three lines at the top of that file.

## Publish a change

```bash
scripts/publish.sh "What changed"
```

That records your changes, brings in anything published from another computer, runs the tests, stamps
a new version and sends it to GitHub. GitHub Pages shows it about a minute later. Each publish leaves
two entries in the history: your change, then a `Version ...` stamp. The script asks for your GitHub
key each time and saves nothing. The one-time setup is in [docs/setup.md](docs/setup.md).

## Work on it from another Mac

Everything needed is in this repository, so any Mac with git can take over:

```bash
git clone https://github.com/YOUR-USERNAME/recipes.git ~/Documents/Recipes
```

```bash
cd ~/Documents/Recipes && scripts/publish.sh --setup YOUR-USERNAME
```

After that, `scripts/serve.sh`, the tests and `scripts/publish.sh` work the same way there. When you
switch computers, publish from the one you are leaving first; the script then brings those changes in
on the other. If both changed the same lines it stops and says which files, without publishing.

## What is where

| Path | What it holds |
| --- | --- |
| `index.html` | The page that loads everything |
| `css/app.css` | All styling. Light and dark differ only in the color tokens at the top |
| `js/model.js` | Data rules with no screen or storage in them: recipes, ingredient lines, timers, search, folders |
| `js/store.js` | The library on this device, kept in the browser's IndexedDB |
| `js/sync/` | Syncing: `github.js` (the few GitHub calls), `merge.js` (how two copies become one), `sync.js` (one round), `auto.js` (when to sync) |
| `js/ui/` | The screens: `home.js` (list, filters, sidebar), `recipe.js`, `editor.js`, `settings.js`, and helpers in `dom.js` |
| `js/sample.js` | Three made-up example recipes |
| `sw.template.js` | The worker that keeps a copy of the app for offline use. Edit this one |
| `sw.js`, `js/version.js` | Generated from the template by `scripts/publish.sh` on every publish. Never edit by hand |
| `manifest.webmanifest`, `icons/` | Name and icon for the Home Screen and Dock |
| `proofs/` | Small test pages for things that had to be tried on a real phone |
| `tests/` | Tests for the data rules, merging and syncing, plus `fake-github.js`, the stand-in they sync against |
| `scripts/` | `serve.sh` to run it locally, `publish.sh` to publish, `dev-server.mjs` to try syncing locally |
| `docs/` | Decisions, architecture, and the steps only the owner can take |

## Keeping private things private

This repository is public, so three things must never be committed: `.env` (the AI key),
`samples/` (personal screenshots used for testing), and any GitHub key. The first two are listed in
`.gitignore`, and `scripts/publish.sh` refuses to publish if either is tracked.
