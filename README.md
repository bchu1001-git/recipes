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
- Headings inside a recipe. A line that ends with a colon, such as `For the salsa:`, is a heading,
  among the ingredients and among the steps. On the recipe page a tap on a heading folds away the
  lines under it and another tap brings them back; the steps keep their numbers either way. What is
  folded is remembered on that device only and is never synced.
- Appearance: match the device, or force Light or Dark.
- A backup file you can save and open again.
- Syncing between devices through a private GitHub repository (a "library"): connect in Settings with
  the library's name and a key. It syncs when the app opens, a few seconds after a change, when you
  pull the list down, and when you tap the status next to the title.
- **To review:** a recipe that arrives from outside waits apart from the others until you keep it or
  discard it. Its screen shows where it came from, a link to the original, what looks missing, and
  the same fields as the editor.
- Saving a recipe page from Safari. The "Save to Recipes" Shortcut puts the page in the library's
  `inbox/`, and the next sync turns it into a recipe to review, read from the recipe data the page
  carries. The groups a page shows its ingredients in ("For the chicken", "For the salsa") arrive
  as headings. The Shortcut is made by hand from the steps in Settings, Save from Safari; they were
  run on an iPhone with iOS 27 in November 2026. The same screen shows how to put a newer script
  into the Shortcut when the app says the one it has is out of date.
- Reading a recipe out of screenshots and photos. The + button takes up to six pictures as the pages
  of one recipe, in any order: chosen from the photo library, the files or the camera, pasted, or
  dropped onto the screen. A title can be typed with them, since pictures of a recipe often leave
  its name out; without one, a title is suggested from words in the pictures where that can be done,
  and marked as a suggestion. The pictures are made smaller and sent to the library. There the importer has an AI
  service (Google's Gemini, on its free tier) read them, and the recipe comes back under To review
  with the pictures on top to check it against, and with any line the reader was not sure of
  pointed out. The pictures stay with the recipe afterwards. While
  they are being read the list says so, and if they cannot be read it gives the reason, with Try
  again and Discard. A library is set up for this once, from the steps in Settings, Read photos.
- Sending pictures from another app. The "Send to Recipes" Shortcut sits in the share sheet. A note
  that holds pictures of a recipe, or pictures in the photo library, go to the library as one file
  with the pictures inside it, without a trip through the photo library. The Shortcut has eight
  actions and nothing in it is put together by hand. The importer unpacks that
  file and reads it like any other pictures, up to ten at a time. A shared note also brings a picture
  of the whole note along, which the reader looks at for the recipe's title and for anything typed in
  the note. The list shows such pictures as being read without downloading them. The Shortcut is made
  by hand from the steps in Settings, Send from other apps.

Built but not proven: the part of reading pictures that runs inside a library on GitHub. The app, the
importer and the AI reader have each been run on a computer, the reader on made-up pictures with a
real key. The workflow that joins them up in a library, and the setup steps for it, are a first try
that nobody has run yet. The same goes for the Send to Recipes Shortcut: the file it sends was built
on a computer the way the Shortcut would build it and went through the real importer and reader, but
the Shortcut itself has not run on a phone.

Not built yet, in this order: pasting a link inside the app and importing a bookmarks file, the
kitchen view with timers, sharing with other people. See [docs/decisions.md](docs/decisions.md) for what was decided and
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
a step, search and folder filtering), the rules for merging two copies of a library, syncing against
a stand-in for GitHub kept in memory (including pages waiting in a library's inbox), reading the recipe
data in a web page, the script the Shortcut runs on a page, and pictures on their way to becoming
recipes: the job a device sends, the importer run over a library in a temporary folder, and its
commit pushed to a repository on this computer. They need Node.js 20 or later and git, and nothing
else. The app itself does not need Node.

To try syncing in a browser without touching GitHub, run `node scripts/dev-server.mjs` and follow the
lines at the top of that file. The stand-in can also play the importer's part, with a made-up reader
or the real one.

To try the AI reader on pictures of your own, put its key in a file called `.env` in this folder, as
one line `GEMINI_API_KEY=...`, and run:

```bash
node scripts/try-reader.mjs picture1.jpg picture2.jpg
```

The pictures named are read together as the pages of one recipe, and what came back is printed.

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
| `js/model.js` | Data rules with no screen or storage in them: recipes, ingredient lines, headings, timers, search, folders |
| `js/store.js` | The library on this device, kept in the browser's IndexedDB, with the pictures still waiting to be sent, and which groups are folded away on each recipe's page here |
| `js/jobs.js` | The rules for a picture job, shared by the app and the importer: its file and folder names, what its file holds, how small a picture is made, the file a Shortcut shares whole with its pictures inside it, and the workflow file a library needs |
| `js/sync/` | Syncing: `github.js` (the few GitHub calls), `merge.js` (how two copies become one), `sync.js` (one round, including pages waiting in the inbox and pictures on their way to being read), `auto.js` (when to sync), `originals.js` (fetching the pictures a recipe was read from, and keeping them on the device) |
| `js/import/` | Reading recipes that come from outside. `page.js` turns the recipe data a web page carries into a recipe waiting for review; syncing uses it for pages in the inbox |
| `shortcuts/` | `save-page.js`, the script the "Save to Recipes" Shortcut runs on the page open in Safari |
| `importer/` | What a library runs when pictures arrive, in Node with no packages: `run.mjs` (the command), `jobs.mjs` (works through the waiting jobs), `unpack.mjs` (finds the pictures in a file that was shared whole), `reading.mjs` (from what was read to a recipe), `git.mjs` (the commit), and `readers/` (the AI reader, `gemini.mjs`, and a stand-in). It uses `js/model.js`, `js/jobs.js`, `js/import/page.js` and `js/sync/merge.js`, so those must stay free of anything only a browser has. The app never loads it |
| `js/ui/` | The screens: `home.js` (list, filters, sidebar, To review), `recipe.js`, `editor.js`, `review.js` (keep or discard a recipe that arrived), `photos.js` (choosing pictures to send), `send.js` (the steps for the Send to Recipes Shortcut), `pictures.js` (showing the pictures a recipe was read from), `save.js` (the steps for making the Shortcut and for updating its script), `read.js` (the steps for setting a library up to read pictures), `settings.js`, and helpers in `dom.js` |
| `js/sample.js` | Three made-up example recipes |
| `sw.template.js` | The worker that keeps a copy of the app for offline use. Edit this one |
| `sw.js`, `js/version.js` | Generated from the template by `scripts/publish.sh` on every publish. Never edit by hand |
| `manifest.webmanifest`, `icons/` | Name and icon for the Home Screen and Dock |
| `proofs/` | Small test pages for things that had to be tried on a real phone |
| `tests/` | Tests for the data rules, merging, syncing, the inbox, the web-page reader, the page script, picture jobs and the importer, plus `fake-github.js`, the stand-in they sync against |
| `scripts/` | `serve.sh` to run it locally, `publish.sh` to publish, `dev-server.mjs` to try syncing and the importer locally, `try-reader.mjs` to try the AI reader on pictures |
| `docs/` | Decisions, architecture, and the steps only the owner can take |

## Keeping private things private

This repository is public, so three things must never be committed: `.env` (the AI key),
`samples/` (personal screenshots used for testing), and any GitHub key. The first two are listed in
`.gitignore`, and `scripts/publish.sh` refuses to publish if either is tracked.
