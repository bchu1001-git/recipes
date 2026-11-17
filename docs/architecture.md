# Architecture

How the app is built today, and the plan for the parts that are not built yet. Sections marked
**Planned** describe intent; update them when the real thing is written.

## The pieces

| Piece | Where | State |
| --- | --- | --- |
| The app | This public repository, served by GitHub Pages | Built (core screens and To review) |
| A library | One private repository per library, holding recipes, the pictures they were read from, and folders | Built (recipes, folders, the inbox and originals) |
| The importer | Code in this repository (`importer/`), run by a GitHub Action inside each library | Built for pictures, and proven inside a real library in November 2026. Pasted links are planned |
| The AI reader | A free tier outside GitHub, called only by the importer, only for pictures | Built: Google's Gemini. Tried with a real key on made-up pictures and on the owner's own screenshots, and run for real from the owner's phone in November 2026 |
| Shortcuts | "Save to Recipes", "Send to Recipes" and "Recipe Timer", made on each iPhone | Save to Recipes: built, and made and run on an iPhone. Send to Recipes: its steps and the library's side are built; nobody has made the Shortcut yet. Recipe Timer: planned |

Nothing runs on a server owned by this project. A device talks to GitHub Pages for the app's files
and to `api.github.com` for its library. The page's Content Security Policy in
`index.html` allows exactly those two. The AI service is called only by the importer, from inside a
library's workflow, and never by the app.

## The app today

- `js/main.js` starts everything and shows a screen for the address: `#/` the list, `#/r/<id>` a
  recipe, `#/cook/<id>` its kitchen view, `#/new`, `#/edit/<id>`, `#/settings`, `#/save` (the steps for
  the Shortcut), `#/timers` (the steps for the Recipe Timer Shortcut). A recipe that is still waiting
  for review opens on the review screen instead of its own page.
- Three panes exist at all times: sidebar, list, detail. A phone shows one at a time, chosen by
  `data-view` on `#app`. A window 900 pixels or wider shows all three. Inside the detail pane, a
  container query lays ingredients and steps side by side once that pane is 46rem wide.
- `js/store.js` holds the library in memory and saves it to IndexedDB (`recipes` and `meta` stores).
  Screens call `subscribe()` and redraw themselves after any change.
- `js/ui/state.js` holds what is on screen right now: search text, chosen folders, the open tab,
  ticked ingredients. None of it is saved, except the ticks, which are kept on the device for half a
  day (see the kitchen view below).
- `js/model.js` has every rule that does not need a screen: building a recipe, splitting an ingredient
  line, finding times in a step, search, filtering, sorting.

### A recipe

```
id         "r" plus random letters; never changes
title
source     { kind: manual | web | screenshot | photo | shared, name, url }
minutes    total time, or null
serves     text, as written
ingredients  [{ text, qty, unit, item, note, heading }]   text is the line as written
steps        [{ text, timers: [minutes], heading }]
notes      { mine, source }
folders    ["group:folder", ...]
goto       true for the version that gets cooked
rating     0 to 5
photo      path of its photo, or ""
originals  paths of the pictures it was read from, kept in the library
review     true while it waits under To review
unsure     lines the AI reader was not sure it read right; only while it waits under To review
titleSuggested   true when the pictures showed no name and the title was made from other words in
           them; only while it waits under To review
created, updated, by
```

Each ingredient is kept two ways on purpose. `text` is what was written and is what the editor shows.
`qty`, `unit` and `item` are for scaling, unit conversion, the pantry list and the shopping list
later.

### Headings and folding

A line that ends with a colon and is at most 60 characters long is a heading, such as "For the
salsa:". The rule is the same among the ingredients and among the steps (`isHeading` in
`js/model.js`), and the text is all that decides. `heading: true` is set from the text every time a
recipe is saved, so that scaling, the shopping list and timers can skip headings; a version of the
app that knows nothing of headings just shows the line. In the editor and on the review screen a
heading is that line and nothing more.

On the recipe page a heading is drawn without its colon, with no tick circle and no number, and it is
a button. A tap folds away the lines under it, up to the next heading, and the heading then says how
many lines it is hiding ("For the salsa · 9"); another tap brings them back. Lines above the first
heading belong to no group and never fold. Each step carries its own number, counted across the
whole list (`partsOf`), so the numbers never move when something is folded.

What is folded is a view choice for one device. It is kept in that device's `meta` store under
`folds`, by recipe and by heading (`foldsFor` and `setFold` in `js/store.js`). It is never written
into the recipe and never synced, it changes no `updated` time, and changing it does not count as a
change to the library, so folding the salsa on one phone hides nothing on another. A fold whose
heading has been renamed or removed simply stops applying. Deleting a recipe on a device drops its
record there; a recipe removed by a sync can leave one behind, which does no harm.

### The kitchen view and timers

Code: `js/ui/kitchen.js` (the view), `js/ui/timers.js` (the running timers), `js/ui/clock.js` (the
steps for the Shortcut), and `js/kitchen.js`, which holds every rule that needs no screen and is what
`tests/kitchen.test.js` runs.

The view is one layer over the whole app, at `#/cook/<id>`. The recipe's own page is drawn underneath
and shows faintly through it. It is dark in light and in dark appearance alike: the grey comes from
the `--k-` tokens at the top of `css/app.css`, and inside the layer the app's usual tokens are pointed
at them, so the ingredient list drawn for the recipe page (`ingredientList` in `js/ui/recipe.js`)
looks right there with no rules of its own. While the view is open the strip around the phone's clock
takes the same grey (`--k-solid`).

- **Steps.** `kitchenRows` turns the steps into rows: a heading, or a step with its number and the
  minutes of each time it mentions. A section folded on the recipe page is one folded row here, and
  folding or opening it here changes the same fold. `currentStep` picks the step to light when the
  rows change, and `stepBeside` is Next and Back. The lit step is scrolled to the middle.
- **Times.** `findTimers` in `js/model.js` reads the times out of a step's text every time the view is
  drawn, so the `timers` list stored with a step is not relied on. A range gives both ends ("5 to 7
  minutes" is 5 and 7). Hours and minutes written together are one time. Fractions, "half an hour"
  and "a 10-minute rest" are understood. Anything under a minute or over a day is not a timer.
- **Timers** belong to the device, not to a recipe: `{ id, recipe, step, n, number, minutes, started,
  mode, rang }`. Time left is always worked out from `started` and the clock (`timeLeft`), never
  counted down in memory, so a reload changes nothing. Every timer on the device shows in a row at the
  top of the view whichever recipe and step are open, and each leads to its step. A finished timer is
  dropped by itself half an hour later.
- **Two ways to run one**, chosen per device in Settings, Timers (`recipes.timers` in localStorage).
  *In this app* is the default: at zero `timers.js` shows an alert over whatever part of the app is
  open and plays a few tones made with the Web Audio API (there is no sound file, and the page's
  Content Security Policy would not allow one from a `data:` address). It can only do that while the
  app is open on screen. Three things in `timers.js` are there so that the tones are really heard:
  - *A tap starts the audio.* A browser lets a page begin making sound only from a tap, so the tap
    that starts a timer wakes it, and after a reload in the middle of a countdown the next tap
    anywhere does.
  - *It is kept going.* While a timer counts down in the app, a tone too low and too quiet to hear
    keeps the audio from being left idle, and the audio is asked to carry on again just before the
    tones. When no timer needs it any more it is let go.
  - *The silent switch.* On an iPhone, sound made with the Web Audio API counts as "ambient" by
    default and is muted when the phone is on silent; WebKit's engineers say so in bug 237322, and
    that since iOS 17 a page can set `navigator.audioSession.type = "playback"` to be heard anyway.
    That type is exclusive: it pauses whatever else the phone is playing. So the app sets it only
    while the tones sound, and for the button in Settings, Timers that plays the sound once, and sets
    it back to `"auto"` afterwards, so that starting a timer does not stop music for the whole
    countdown. Only Safari has this setting; elsewhere the code does nothing. *In the Clock app*: the button is a real link, `shortcuts://run-shortcut?
  name=Recipe%20Timer&input=text&text=<minutes>` (`timerLink`), so the tap itself opens the Shortcut
  that starts a Clock timer; the timer is noted on the device in the same tap, before the phone leaves
  the app. The app then only keeps count: it cannot see the Clock's timer, raises no alert of its own
  for it, and lets it be cleared. The link is the plain form on purpose, because asking Shortcuts to
  come back to an `https` address opens Safari instead of the Home Screen app. What does bring the app
  back is one more action at the end of the Shortcut: Open URLs with `webapp://` and then the app's
  address without `https://` (`returnAddress` in `js/kitchen.js`, shown with a Copy button on the
  Timers screen). On an iPhone with iOS 27 that opens the Home Screen app itself, on the step it was
  left at. It is not a documented address, so the screen also says what to do if a phone calls it
  invalid: delete the action and come back by hand.
- **The screen is kept awake** with the Screen Wake Lock API, asked for again each time the app comes
  back to the front, since the browser lets go of it whenever the app leaves the screen. Where it is
  missing or refused the view says so in one quiet line.

What the view remembers is kept on the device and never synced, like the folds:

| What | Where | For how long |
| --- | --- | --- |
| The step each recipe was left at, and the timers | `meta` store, under `kitchen` (`kitchenStep`, `saveTimers` in `js/store.js`) | Until the recipe is deleted; a finished timer for half an hour |
| Ticked ingredients | localStorage, `recipes.ticks` (`keepTicks` in `js/ui/state.js`) | Half a day after the last tick |
| That the view is open | localStorage, `recipes.cooking` | Until the view is left on purpose |
| Where timers run, and that coming back from Clock has been explained once | localStorage, `recipes.timers` and `recipes.clockTold` | Until changed |

A Home Screen web app that the phone has thrown out of memory starts again at its first address, not
where it was. So while the view is open it leaves a mark, and when the app starts with no address of
its own and a mark less than three hours old, it opens straight back into that recipe's kitchen view
(`resumeCooking`). Leaving the view with Close takes the mark away.

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
inbox/         pages saved from Safari and picture jobs, waiting to be read. Anything else in it is left alone
originals/     the pictures a recipe was read from, in a folder named for the recipe
.github/workflows/import.yml   runs the importer when pictures arrive. Added once by the owner (Settings, Read photos)
photos/        planned, for a recipe's own photo
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

- **From Safari (built, and run on an iPhone):** the "Save to Recipes" Shortcut
  runs a short script on the open page, takes the schema.org Recipe data, and writes it into the
  library's `inbox/` as a capture (described below). The app turns that into a recipe itself at its
  next sync, so nothing waits for GitHub and no AI is involved.
- **Photos and screenshots (built, and proven inside a real library in November 2026):** the app puts the
  pictures and a small job file into `inbox/`. That push starts the library's workflow, which runs
  the importer from this repository. The importer sends the pictures to the AI reader, gets back a
  recipe, and commits it with `review: true`. See "Reading pictures" below.
- **Pasted links (planned):** the same route with another kind of job: the importer fetches the page
  and reads its recipe data with the web-page reader.
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
groups  [{ name, items: [ingredient] }]: how the page's layout groups its ingredients   (optional)
s       which version of the page script made the capture         (optional; missing means the first)
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
  objects. A section's name becomes a heading line before its steps. Tips listed among the steps, and lines
  such as "Do ahead:" or "Editor's note:", go to `notes.source` instead of the steps.
- `groups` puts a heading line ("For the salsa:") in front of each group of ingredients. A page's
  data lists its ingredients in one flat run; only its layout shows what belongs to what, so the page
  script reads the groups there and the reader matches them to the data's ingredients by their
  letters and digits. The ingredients themselves stay exactly as the data gave them and in the same
  order: none is lost, repeated or moved, and the only change is the heading lines put between them.
  The groups are used only when at least four in five of the ingredients are found in them and the
  groups come in the same order as the ingredients. An ingredient found in no group stays where it
  is: ahead of the first heading, or under the heading before it.
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

`shortcuts/save-page.js` is the script the Shortcut's "Run JavaScript on Web Page" action runs on the
page open in Safari. It builds a capture and hands it to the Shortcut as base64 of plain JSON, which
is exactly what GitHub's "create a file" call takes as `content`.

- Blocks that mention a recipe go first. The whole capture is kept under about 700 KB, so one call
  always fits; a block that would push it over is left out.
- If no block holds a Recipe, schema.org microdata in the page is translated into one. Where that
  markup leaves the steps out, the part of the recipe named for its directions is read as the steps.
- It works out the groups the page shows its ingredients in, without knowing any one site. Each
  ingredient in the page's data is looked up on the page by its words; the part of the page that
  holds at least four in five of them is the ingredients area; and walking down that area, the
  heading before an ingredient names its group. A heading is an h1 to h6, or a short line of its own
  that is bold or is named as a heading or group; "Ingredients", a serving size and the like are
  not headings, and one heading over everything is not a group. This covers headings that sit
  between the items of one list, a heading before each separate list, and a list item that is only
  a bold line.
- It reads the one page and nothing else, changes nothing, and cannot throw: on any error it still
  hands over the page's address and title.
- It is plain ASCII, so pasting it into Shortcuts cannot change it. `tests/save-page.test.js` runs it
  against a pretend page.

The Shortcut has four actions: Run JavaScript on Web Page (the script); Random Number (the file
name, which only has to be one that is not in use); Get Contents of URL (a PUT to
`.../contents/inbox/<number>.json` on `api.github.com` with an `Authorization: Bearer` header and a
JSON body of `message` and `content`); Show Content, which older versions of iOS call Show Result. It
holds a key of its own, limited to the library, so it can be cancelled without touching the app's key.

The script inside a Shortcut does not change when the app does. The capture's `s` says which version
of the script made it, and `SCRIPT_VERSION` in `js/import/page.js` is the version the app goes with;
raise both together. When a sync turns a capture from an older script into a recipe, the app says so
once, and Settings and the steps screen keep a note until a capture from the current script arrives
(`scriptIsOld` in `js/sync/auto.js`, kept in the device's local storage). The steps screen has a
section on replacing the script.

It is made by hand on each iPhone. The steps, with the library's own address filled in and a Copy
button for every piece of text, are in the app: Settings, Save from Safari (`js/ui/save.js`, the
address `#/save`). The app never shows or copies the key it stores.

### Reading pictures

**The job** (`js/jobs.js`, shared by the app and the importer). One recipe's pictures travel as:

```
inbox/job-<id>.json     { v: 1, job: 'photos', id, images: [paths], at, by, kind, title }
inbox/job-<id>/1.jpg    the pictures of one recipe, six at most, in the order they were added
```

`title` is there only when the person typed one while sending. Pictures of a recipe often leave its
name out (a screenshot starts part way down the page), so the screen has a Title box, and what is
typed there always wins over whatever the reader makes of the pictures.

`kind` is `screenshot` or `photo`, guessed from the files chosen (a phone saves screenshots as PNG),
and becomes the recipe's `source.kind`. The id is twelve random letters and digits made on the device.
The recipe a job becomes is always `rp<id>`, so neither the app nor the importer can make it twice.

A picture file may end in `.png` as well as `.jpg`, and a job may name up to ten (`MAX_JOB_PICTURES`),
though the app's own screen sends six at most and always JPEG. What a picture file really holds is
told from its first bytes wherever that matters (the importer, and the app when it shows one), never
from its name.

**A job shared whole** (`importer/unpack.mjs`). A Shortcut cannot make several files in one go, so
the "Send to Recipes" Shortcut sends one, `inbox/job-<number>.json`, with the pictures inside it as
base64. It sends the plainest form there is, one picture to a line and no JSON around them, so that
nothing in the Shortcut has to be put together by hand:

```
<base64 of a picture>
<base64 of the next>
```

Anything else that wants to send pictures in one file should use the tidier form, which is read by
the same code:

```
{ "job": "photos", "pictures": ["<base64>", "<base64>"] }
```

Nothing else is needed in either: the id is the number in the file's name. The pictures are found by
what they are, not by where they sit: any run of base64 that begins the way a JPEG or a PNG begins.
So both forms work, and so does a file with line breaks inside the base64 (Shortcuts adds them
unless told not to), pictures joined by anything at all, JSON that is not quite right, and PNG in
place of JPEG. Whatever is not a picture is passed over, and no more than ten are kept.

The importer's first step with a job file that is not an ordinary job is to decide whose it is
(`isShared` in `js/jobs.js`). Two things are somebody else's and never touched: a job that names
picture files, and a job that says it is of another kind. Everything else under a job file's name
came from a Shortcut. If pictures are found in it, they are written out as `inbox/job-<id>/1.jpg`
and so on and the file becomes the small ordinary job file above. From there it is a job like any
other, so a reading that fails leaves something the app already knows how to show, try again and
discard. If no picture is found, the file becomes a failed job that says so (the only kind of job
with no pictures), so nothing a Shortcut sent ever sits in the library unexplained.

A note shared from the Notes app arrives as its pictures plus one more: a picture of the note as a
page, with the note's name at the top, anything typed in it, and copies of the pictures. A job that
was unpacked from a shared file is marked `shared: true`, and for those jobs only the reader's
instruction gains a paragraph about that page (`NOTE_PAGE` in `gemini.mjs`): its first line is the
recipe's title, typed lines go to the notes, and the copies are not a second recipe. Pictures sent
from the app's own screen are read with the instruction exactly as it was.

The app never downloads such a file when it is large, and one with pictures in it is several
megabytes. `sync.js` tells it by its size in the file tree (`LARGE_JOB_FILE`) and shows a plain
"Reading pictures sent from another app..." line with Discard, knowing nothing else about it. A small
one is fetched once to see what it is, and shown the same way if `isShared` says it is one of these. While one is waiting the app looks again every 20
seconds for five minutes, as it does for pictures it sent itself. The library's workflow needs no
change for any of this: it already starts on `inbox/job-*`.

Each shared note leaves its file in the library's history, about two megabytes, beside the pictures
kept in `originals/`. A recipe collection stays far below what a repository may hold, but it is the
heavier of the two ways of sending pictures.

**In the app.** The + button offers "From photos or screenshots" (`js/ui/photos.js`). Pictures come
in three ways: chosen with the browser's own picker (on an iPhone that offers the photo library, the
camera and the files), pasted (a Paste button that asks the browser for the clipboard, and the
ordinary paste as well, so Command-V works), or dropped onto the screen. Every picture offered is
taken, up to six; anything that is not a picture is passed over, and one line says so. They are shown
in the order added and each can be removed. There is no reordering: the reader is told the pictures
may be out of order and overlapping. Each picture is
drawn onto a canvas and saved as a JPEG with its long edge at 2000 pixels; a tall screenshot keeps
900 pixels of width instead, so it stays readable (`fitWithin`). The job waits in the device's storage
(`queue` in `js/store.js`) until a sync has sent it, so a dropped connection loses nothing. `sync.js`
stores each picture as a blob and adds the pictures and the job file in its usual single commit. A
second attempt in the same sync does not send a picture again, and a job that is already in the
library, already read, or read and deleted since, is not sent at all.

**In the library.** `.github/workflows/import.yml` starts on a push that touches `inbox/job-*`. Pages
saved from Safari have other names and do not start it. It checks out the library and this public
repository, and runs `node app/importer/run.mjs library` with the AI key from the library's secret
`GEMINI_API_KEY`. The importer needs Node 20 or later and installs nothing. `workflowText()` in
`js/jobs.js` writes the file, and the app works out this repository's name from the address it is
served from (`appRepository()`), so no name is written into this repository.

**The importer** (`importer/`). `jobs.mjs` goes through every waiting job: it checks the pictures,
hands them to the reader, turns the answer into a recipe with `makeRecipe()` (`reading.mjs`), writes
`recipes/rp<id>.json` exactly as the app would, moves the pictures to `originals/rp<id>/`, and removes
the job. `git.mjs` then makes one commit and pushes it; if a device synced in the meantime, the
commit is put on top of that and pushed again. The rules it keeps:

- One job never stops another. Whatever goes wrong with one is caught and written into that job.
- A job that could not be read keeps its pictures and gains `error` (a sentence for the person),
  `failed` (when) and `tries`. The importer then leaves it alone. It is read again only when the
  person taps Try again in the app, which takes the reason out and so changes the file, which starts
  the workflow.
- A job whose recipe already exists, or was deleted since, is only tidied away.
- A reading with no title, ingredient or step is a failed job ("No recipe could be found"), not an
  empty recipe.
- Nothing is invented. What the pictures did not show stays empty, and the answer is treated as
  untrusted text: it goes through the same cleaning as a saved web page and is capped in size.
- A file in `inbox/` that is not a picture job it understands is left exactly as it is.
- All of a job's pictures go to the reader in one request, which Google limits to 20 MB. Pictures
  that come to more than 13 MB together fail the job with a reason, before the reader is asked.

**The reader** (`importer/readers/`). A reader is a module with a `name` and one function:

```
read({ pictures: [{ data, type }], kind, key, shared })
  -> { title, ingredients: [line], steps: [line], notes, time, serves, source, unsure: [line] }
```

`unsure` names the ingredient lines and steps in which something was blurred, cut off, covered or
could be read two ways. They are kept on the recipe while it waits for review, listed on the review
screen under the original, and dropped when it is kept. A reader may also say `titleSuggested: true`
when the pictures showed no name and it made the title from other words in them.

**The title** (`titleOf` in `reading.mjs`). A typed title always wins. Otherwise the reader's title
is used, with one correction: when a recipe has several groups and the reader gave one group's name
as the title, which it tends to do when the dish's own name is out of view, the title is made from
the group names instead ("Roast Squash with Herb Yoghurt") and marked as a suggestion. Group names
that only say what a part is for ("To serve", "Topping") never make a title. With nothing to go on
the title stays empty. Either way only words from the pictures are used, and the review screen says
first of all when the title is missing or only suggested. No time, no servings and no source are
normal for a picture and are not remarked on.

A group of ingredients or a section of the method is a line of its own ending in a colon, the app's
rule for a heading. `gemini.mjs` asks Google's Gemini through its Interactions API, with the model
named in one place (`MODEL`: Google's own name for its newest small, fast model, so it goes on
working when one model is retired), an instruction to copy what is written and add nothing, and a
schema for the answer. The instruction covers pictures that overlap or are out of order, a line the
recipe really has twice, lines whose heading is out of view, a note that sits among the steps, and
a word that is partly covered. It asks the model for groups with headings and writes the heading lines itself, so a
group does not depend on how its heading was printed. Nothing is kept on Google's side for a later
turn (`store: false`). A busy service is asked once more after a pause, and no more. On the free tier
Google may use what it is sent to improve its products. `fake.mjs` is a stand-in that always "reads"
the same made-up recipe. `run.mjs` picks the reader by name, so another service can be added beside
these without touching the rest.

**Back in the app.** Every sync reads the job files in the library (a file that has not changed is
not downloaded again) and keeps them in `base.jobs`, with `base.originals` (where each kept picture
is) and `base.reader` (whether the library has the workflow file). The list shows each job: waiting
to be sent, being read, or not read, with the reason and Try again and Discard. Try again and Discard
are noted on the device (`actions` in `js/store.js`) and carried out by the next sync. While pictures
this device sent are being read and the app is open, it syncs every 20 seconds for five minutes
(`js/sync/auto.js`). When the recipe arrives it is under To review like any other.

**The originals.** The pictures a recipe was read from stay in `originals/<recipe id>/`.
`js/sync/originals.js` fetches one with the device's key when a screen wants it and keeps a copy on
the device (in a cache of its own, which the offline worker does not clear), so it also shows with no
connection. When a recipe is deleted, the sync that sends the deletion removes its pictures too.

**Trying it on a computer.** `node scripts/try-reader.mjs picture.jpg` sends pictures through the
real reader with the key in `.env`. `scripts/dev-server.mjs` can play the library's part:
`POST /fake-github/_import` runs the real importer over the stand-in's files with the made-up
reader, `?real=1` uses the real one, and `?fail=...` makes the reading fail with that reason.

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

A recipe read from pictures has them on top instead (`js/ui/pictures.js`): side by side to swipe
through, each scrolling inside its box, with a way to see them full size. They are drawn from
`blob:` addresses, which the page's Content Security Policy allows for images. `reviewNotes` adds a
reminder that an AI service read it and that amounts and times are worth checking, then the lines
the reader said it was unsure of. After Keep, the recipe page's menu offers the originals again.

## Sending a recipe

Built: `js/share.js` (the rules) and `js/ui/sent.js` (the sheet that makes the link, and the page
that shows a sent recipe).

- **The link** is the app's address, then `#/s/`, then the recipe. Everything after `#` stays in the
  browser and is never sent to a server, so nothing is stored anywhere for it. The recipe is JSON with
  short names (`t` title, `i` ingredient lines, `s` step lines, `m` minutes, `y` serves, `n` notes,
  `f` where it came from and its link), squeezed with the browser's own `CompressionStream` and
  written in URL-safe base64 after `z.`; a browser that cannot squeeze writes it plain after `j.`.
  A usual recipe makes a link of 400 to 1,200 characters. Past 6,000 the sheet warns that some apps
  cut long links short.
- **What travels:** the title, the ingredient and step lines as written (a heading is still just a
  line that ends with a colon), time, servings, where it came from, the notes from the source, and
  the sender's own notes unless that switch is turned off. Folders, the heart, the rating and
  pictures stay behind.
- **Opening it** (`#/s/...`) shows the recipe read-only, with no library and no sign-in needed. A
  link that was cut short or changed gives one plain sentence. Whatever a link holds is checked for
  shape and size and is only ever shown as text.
- **Keeping it.** On an iPhone a link opens in Safari, whose copy of the app has none of the person's
  recipes, so the way in is the Save to Recipes Shortcut: the page adds an ld+json block of
  schema.org Recipe data (`recipeData`), through the DOM as text, and the page script and the reader
  treat it like any recipe page. The block also carries `sentFrom`, this app's own addition: where
  the recipe first came from and the notes that travelled. The reader takes the source from there
  (`source.kind` is `shared`), because the page's own address is only the link it was sent in, and
  it leaves the page layout's groups alone when the data already has heading lines. A copy of the
  app with a library connected also shows "Keep in my library", which runs the same reader and puts
  the recipe under To review.

## Things proven or still to prove

| Question | State |
| --- | --- |
| Do popular recipe sites answer an automatic request? | Tested November 2026: 13 of 25 gave full recipe data, 11 refused, 1 used an older format |
| Can a Home Screen web app start a Clock timer through a Shortcut? | Proven November 2026 on an iPhone with `proofs/timer.html`: the timer starts and rings with the phone locked. The phone is left in Shortcuts afterwards. Asking Shortcuts to come back opens the page in Safari, not the Home Screen app, so the kitchen view uses the plain link. Later the same month an Open URLs action at the end of the Shortcut, with `webapp://` and the app's address without `https://`, brought the Home Screen app itself back to the front on the same phone |
| Can a Shortcut read a recipe page and write into a library? | Proven November 2026 on an iPhone with iOS 27: a page shared from Safari arrived under To review. Format Date could not be set up on that phone, so the file is named with a random number, and Show Result is called Show Content there. The page script was also run in a desktop browser on saved copies of ten live recipe pages, with their styles and without their own scripts: the three that group their ingredients gave the right groups, and the seven that do not gave none |
| Does the web-page reader cope with real recipe pages? | Tested November 2026 on saved copies of one recipe page from each of 23 sites: 22 gave a full recipe; 1 had only the older in-page markup and gave a title and link |
| Does the free AI reader cope with the owner's own screenshots? | Tried November 2026 on the owner's own samples, five screenshots of two recipes, on a computer: both came back with every ingredient, step, group and note in place, in two to five seconds, and the same whatever order the pictures were given in. One recipe's name was not in its pictures, and its title was suggested from the names of its two groups. Still to be tried from the owner's phone. The larger Gemini models took minutes on the same pictures, or timed out, so the small one is used. Also tried with a real key on six made-up pictures, sent through the app and the importer on a computer: a recipe-site screenshot, a social media caption, a photographed cookbook page with two groups of ingredients, a recipe over two overlapping screenshots, and a page with no recipe. Each recipe came back complete in two to three seconds, with nothing added, the groups as headings, and the overlap read once; the page with no recipe became a failed job. A half written as one character sometimes came back as 1/2. A seventh picture, a recipe card with a stain over one amount, two steps running off its edge and one blurred step, came back with the cut-off words left cut off and those four lines named as unsure |
| Can a Shortcut send a note's pictures to a library in one go? | Proven November 2026, on an iPhone with iOS 27: a share-sheet Shortcut given a note (Share, Send Copy) receives its pictures, and one more, Notes' own PDF copy of the note as a picture. The file such a Shortcut would send (one picture's base64 to a line, no JSON) was built on a computer from four of the owner's screenshots and a made-up note page, and went through the real importer and reader: the title came from the note page, with every ingredient, step and group and the typed line. The JSON form, with line breaks left in the base64 and the pictures as PNG, gave the same. Then the "Send to Recipes" Shortcut itself, made from the steps in Settings, Send from other apps, sent a note holding four screenshots: all five pictures arrived in one upload of a few megabytes, the recipe came back under To review with its groups and sections, and its title was read from the note page |
| Does the importer run inside a library on GitHub? | Proven November 2026: with the secret and the workflow file in place, a push of pictures started the run in a private library, and the recipe and its pictures were committed back. That first run came from a shared note; sending from the + button has not been tried on a phone |
| Does the kitchen view work on an iPhone? | Proven November 2026, iOS 27: the screen stays awake, a timer in the app counts down and shows its alert at zero, and a timer handed to the Clock app starts there with the view left on the same step. With the phone on silent the tones were not heard at first; once they were played as "playback" audio, with the audio kept going during the countdown, they were heard on the same phone |
| Does a recipe sent as a link arrive and get kept? | Half proven, November 2026, in a desktop browser: the link is made and opened, the real page script reads the opened page, and the reader keeps the recipe with its headings, notes, time, servings and first source; a cut or changed link fails with one sentence. To test between two phones: the link arriving whole through a messaging app, and Save to Recipes on the page it opens in Safari |
| Does syncing work against real GitHub? | Proven November 2026: an iPhone connected to an empty private library and synced |
