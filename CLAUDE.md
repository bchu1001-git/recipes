# Working on Recipes

A personal recipe app served from GitHub Pages. Read `README.md` first, then `docs/decisions.md`
(what the owner chose, and why) and `docs/architecture.md` (how it is built and what comes next).

## Rules that keep this project simple

- **No build step and no dependencies.** Plain HTML, CSS and ES modules that a browser loads directly.
  Do not add a bundler, a framework, a package from npm or a CDN script.
- **Recipe content is always added as text.** Build screens with `h()` from `js/ui/dom.js`. Never put
  text that came from a recipe, a web page or an AI reader into `innerHTML`.
- **Colors come from the tokens** at the top of `css/app.css`. Light and dark must both work; do not
  write a color into a rule.
- **Data rules live in `js/model.js`** with no DOM or storage in them, and each one has a test in
  `tests/`. Run `node --test tests/*.test.js` after changing them.
- **The decisions in `docs/decisions.md` are settled.** Build on them. If one has to change, ask the
  owner first and update that file.
- **Check a change in a browser before calling it done.** `scripts/serve.sh`, then try it at phone
  width and at a wide window, in light and dark.

## Publishing

The owner publishes with `scripts/publish.sh "What changed"`. Do not push for them and do not store
a GitHub key anywhere. The script generates `sw.js` and `js/version.js`: change the offline worker in
`sw.template.js`, never in `sw.js`. Run `scripts/publish.sh --local` to rebuild `sw.js` without publishing.

## This repository is public

Never commit `.env`, `samples/`, a GitHub key, or anything that identifies the owner or their family:
no names, email addresses or employer in code, docs, commit messages or test data. Write docs for
"the owner" and "a second library". Example recipes must be made up, not copied from a site or book.

## Keep the docs true

When a feature is finished, move it from "not built yet" to "built" in `README.md`, and update
`docs/architecture.md` if how it works differs from the plan there.
