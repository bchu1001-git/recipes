# Decisions

What the owner chose during the design phase in November 2026. These are settled. The options that
were turned down are listed where they explain a choice.

## What the app is for

- Save recipes from website links and from screenshots or photos, keeping only the title, ingredients,
  steps, notes, time, servings, one photo and a link back. The story, ads and comments are dropped.
- File them cleanly, with one recipe able to sit in several folders.
- Be sure which of several similar recipes is the one that gets cooked.
- Cost nothing to run.
- Used mostly on an iPhone at the counter, with Macs for tidying. Under 50 recipes expected.

## Where it lives

- A web app served by GitHub Pages and added to the Home Screen or Dock. Native apps were turned down
  because a free Apple developer account means re-signing the phone app every 7 days.
- The app's code is public. Recipes are stored in a separate private repository, one per library.
- The app is called **Recipes**. Its icon is a bowl seen from above on the green.

## How recipes get in

- **Links:** the main route is a "Save to Recipes" Shortcut in the Safari share sheet, which reads the
  recipe data from the page that is open. Pasting a link inside the app is a convenience: a test of 25
  popular sites found that 11 refuse automatic requests, so a server-side fetch works on about half.
- **Screenshots and photos:** read by a free AI tier (Gemini to start), called from a GitHub Action so
  the key never sits on a device. The reader must stay swappable. A paid reader was priced at about
  0.2 cents a recipe and turned down for now; no "retry with a stronger reader" button.
- Everything new lands under **To review** first, with the original pinned on top and any line the
  reader was unsure of marked.
- Version 1 also includes typing a recipe by hand and bulk import of a bookmarks file.

## Filing and finding

- **Grouped folders:** Main ingredient, Dish, Meal, Cuisine, My lists. Folders in the same group widen
  a filter; folders in different groups narrow it. Nested folders were turned down because a recipe
  could then live in only one place.
- Starter folders: Chicken, Beef, Pork, Seafood, Vegetarian; Soups & stews, Salads, Pasta & noodles,
  Rice & grains, Sides, Sauces & dressings, Baking & desserts; Breakfast, Lunch, Dinner, Snacks;
  Quick, Weeknight, Company's coming. Cuisine fills in as recipes are imported.
- On every card: a **heart** for the Go-to version, a **1 to 5 star rating**, and the source.
- Not wanted: "To try / Made it" tracking, cooked dates, or the owner's notes shown on cards. Notes
  live on the recipe page.
- Later: a warning when a new recipe looks like one already saved, with a side-by-side view.

## Screens

- **Home:** every recipe in one list, with search and the folders as filters. A folders-first home was
  turned down.
- **Recipe page:** an Ingredients / Steps / Notes switch, tick-off circles, amounts in a bold column.
  On a wide window the three parts sit side by side.
- **Kitchen view:** every step visible with the current one lit, on a dark see-through grey, with the
  screen kept awake. Black was turned down.
- **Timers:** handed to the iPhone's Clock app through a Shortcut, so they ring when the phone is
  locked. This has to be proven on a real phone; timers inside the app are the fallback.
- **Mac:** folders on the left, the list in the middle, the recipe on the right.

## Look

- White background with green highlights. The green is `#1f8f4e` in light and `#4fbf7f` in dark.
- Plain system lettering, no serif. Small thumbnails; a recipe with no photo shows a colored tile
  with its first two letters.
- Light or dark follows the device by default, and Settings can force either one.

## People

- Everyone has their own GitHub account. A single shared account handing out keys was turned down.
- Two people who share one library need a free GitHub organization that owns it, because a
  fine-grained key cannot reach a repository its owner was only invited to.
- A second, separate library lives in its own owner's account.
- A recipe is sent to someone else as a link that carries the recipe inside it. Whoever opens it can
  read it without the app, and saves it with the same Shortcut that saves any recipe page. The photo
  does not travel with the link.
- Keys in the organization never expire and need no approval step. A key can be cancelled at any time.

## Building and maintaining

- Build order: the core app, links, photos, kitchen view, people, finishing.
- Three things are proven on a real phone before the parts that depend on them: saving from Safari
  with the Shortcut, handing a timer to the Clock, and the AI reader on the owner's own screenshots.
- The owner publishes every change themselves with `scripts/publish.sh`. No GitHub key is stored on
  any computer by this project.
- The project must be fully maintainable from any Mac using only what is in this repository.

## Later, after version 1

Look-alike check, scaling servings, US and metric, a pantry list, a shopping list, a fridge photo
that proposes pantry changes, "what can I make", print and export.
