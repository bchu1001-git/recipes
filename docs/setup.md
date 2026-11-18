# Setup: the steps only the owner can take

These need a sign-in on GitHub or the iPhone, so nobody else can do them. Replace `YOUR-USERNAME`
with the personal GitHub username. GitHub renames its buttons now and then; if a name here does not
match what is on screen, look for the closest one.

## Part 1: put the app online (about 20 minutes, once)

### 1. Create the repository

1. Sign in to github.com with the personal account.
2. Click **+** at the top right, then **New repository**.
3. Repository name: `recipes`. Visibility: **Public**.
4. "Add a README" can be on or off; the publish script copes with either. Leave ".gitignore" and
   "license" off.
5. Click **Create repository**.

### 2. Make a key for publishing

The quick way is a link that fills most of the form in. Open it while signed in to the personal
account:

`https://github.com/settings/personal-access-tokens/new?name=Recipes+publishing&description=Publishes+the+Recipes+app&target_name=YOUR-USERNAME&expires_in=none&contents=write&workflows=write`

Then, on that page:

1. Check **Resource owner** is your personal account and **Expiration** is what you want.
2. Under **Repository access**, choose **Only select repositories** and pick `recipes`. The link cannot
   fill this part in.
3. Under **Permissions**, check that **Contents** and **Workflows** both say **Read and write**.
   Contents is what publishing needs. Workflows is for the importer that comes later.
4. Click **Generate token** and copy it somewhere safe that is not in this folder (a password manager,
   if you use one). GitHub shows it only once.

The long way, if the link does not work: your picture at the top right, **Settings**, then
**Developer settings** at the bottom of the left column, **Personal access tokens**,
**Fine-grained tokens**, **Generate new token**, and fill in the same things by hand.

### 3. Publish for the first time

In Terminal, inside the Recipes folder:

```bash
scripts/publish.sh --setup YOUR-USERNAME
```

```bash
scripts/publish.sh "First version"
```

The second command asks for a password. Paste the key from step 2. It is used once and not saved.

### 4. Turn on Pages

1. On the repository's page, **Settings**, then **Pages** in the left column.
2. Under "Build and deployment", Source: **Deploy from a branch**.
3. Branch: **main**, folder **/ (root)**. Click **Save**.
4. Wait about a minute, then open `https://YOUR-USERNAME.github.io/recipes/`.

### 5. Add it to the iPhone and the Mac

**iPhone.** These are the steps on iOS 26 and iOS 27. Every phone that will use the app needs them once.

1. Open **Safari** itself (the compass icon) and go to `YOUR-USERNAME.github.io/recipes`. A link
   opened inside another app will not do. Wait until the page titled Recipes shows.
2. Tap the **three dots** beside the address bar, then **Share**. If the bar has a Share button of its
   own (a square with an arrow pointing up), tap that instead.
3. Scroll down the list that slides up and tap **Add to Home Screen**. If it is missing, scroll to the
   bottom, tap **Edit Actions**, and add it from there.
4. Leave **Open as Web App** switched on and the name as Recipes, then tap **Add**.
5. Open Recipes from its new icon. It fills the screen, with no address bar.

Worth knowing:

- **Open it from the icon every time.** On an iPhone the icon keeps its own recipes, apart from the
  same address opened in a Safari tab.
- **Until a library is connected (Part 3) the recipes are only on that phone**, and removing the icon
  removes them. Settings, **Save a backup** makes a copy to keep.
- **It works without a connection** once it has been opened with one.
- **New versions arrive on their own.** After a publish, open the app with a connection and tap
  **Reload** on the note "A new version is ready". If no note appears, close the app completely and
  open it again. The version is the last line of Settings.
- **If Safari's bars show around the app,** Open as Web App was off: remove the icon and add it again.

**Mac.** Open the address in Safari, then File, **Add to Dock**.

### 6. Try the Clock timer test

On the iPhone, open Recipes from its Home Screen icon, go to Settings, and tap **Try the Clock timer**.
The page explains the rest.

## Part 2: a second Mac

```bash
git clone https://github.com/YOUR-USERNAME/recipes.git ~/Documents/Recipes
```

```bash
cd ~/Documents/Recipes && scripts/publish.sh --setup YOUR-USERNAME
```

If that Mac is already signed in to the personal GitHub account, publish without the password question:

```bash
RECIPES_REMEMBER_LOGIN=1 scripts/publish.sh "What changed"
```

## Part 3: the library (about 20 minutes, once)

A library is a private repository that holds the recipes. Two people who share one need a free
organization that owns it, because a key cannot reach a repository its owner was only invited to.
Someone with a library of their own can skip step 1 and create the repository in their own account.

### 1. Create the organization

1. On github.com, click your picture, then **Organizations** (it is also under Settings), then
   **New organization**.
2. Choose the **Free** plan.
3. Give it a name nobody else has, enter a contact email, and say it belongs to your personal account.
   Anyone can look the name up, though not what is inside, so pick one you do not mind being seen.
4. Skip inviting people for now.

### 2. Let keys work without approval or an expiry date

Do this before making a key: the organization turns away a key that breaks these rules.

1. Open the organization, then **Settings**.
2. In the left column, under **Personal access tokens**, open **Settings**, then the
   **Fine-grained tokens** tab.
3. Three sections follow, each with its own **Save** button. Click the one under whatever you change.
   - **Fine-grained personal access tokens:** choose **Allow access via fine-grained personal access
     tokens**.
   - **Require approval of fine-grained personal access tokens:** choose **Do not require
     administrator approval**.
   - **Set maximum lifetimes for personal access tokens:** leave **Fine-grained personal access tokens
     must expire** unticked, so that keys can be made with no expiration.
4. Reload the page to see that the choices stayed.

### 3. Create the library

1. In the organization, **New repository**.
2. Name: `library`, or any name you like. The app uses whatever name you give it when you connect.
   Visibility: **Private**. Everything else can stay as it is.
3. Click **Create repository**. The app fills it in the first time a device connects.

### 4. Make a key for each device

Open this while signed in, with the organization's name in place of `YOUR-ORGANIZATION`:

`https://github.com/settings/personal-access-tokens/new?name=Recipes+library&target_name=YOUR-ORGANIZATION&expires_in=none&contents=write`

1. **Resource owner** must be the organization.
2. **Repository access:** **Only select repositories**, then pick `library`.
3. **Permissions:** **Contents** set to **Read and write**.
4. **Generate token** and copy it.

One key can serve all of one person's devices. A key per device lets you cancel a lost phone alone.

### 5. Connect the app

In Recipes: **Settings**, **Connect a library**. Enter `YOUR-ORGANIZATION/library` (with your own
repository name if you chose another), paste the key, name the device, and tap **Connect**. Do the same on each device. The first one to connect sends its recipes
up; the others receive them.

### 6. Add the second person

Only the people you invite can see the library. Nobody else can, and a second household's library is
a separate repository in their own account.

1. They need a GitHub account of their own. If they have none, they make one at github.com/signup
   and confirm their email first.
2. In the organization, **People**, then **Invite member**, and invite them by their username.
3. Let members change recipes: organization **Settings**, **Member privileges**, and under
   **Base permissions** choose **Write**, then confirm. Without this a member can read the library
   but the app cannot save their changes.
4. Once they accept, they make their own key with the link in step 4 and connect the app the same way.
5. They make their own Save Webpage to Recipes and Send Notes/Photos to Recipes Shortcuts on their own
   phone, from the steps in the app's Settings, with their own key. A Shortcut copied from another
   phone carries that person's key inside it. Recipe Timer holds no key, so it can be shared with
   AirDrop instead.

This was done for a second person in November 2026.

## Part 4: saving from Safari, reading photos, timers, and later steps

**The "Save Webpage to Recipes" Shortcut.** Its steps are inside the app, with your library's own address
filled in: open Recipes, then **Settings**, **Save from Safari**, **Set up or update Save Webpage to Recipes**. The Shortcut is made by hand on each iPhone and gets a key of its own. The steps were run
on an iPhone with iOS 27 in November 2026; names can differ a little on other versions.

When the app learns to read more from a page, the script inside the Shortcut has to be replaced. The
app says so after a sync, and the same screen has the four steps under **Update the script**.

**Reading photos and screenshots.** A library is set up for this once, and every device that uses
it can then send pictures. The steps are inside the app, with your library's own addresses filled
in: open Recipes, then **Settings**, **Read photos**. There are three things to do: get a free key
from Google AI Studio, save it in the library as a secret named `GEMINI_API_KEY`, and add one small
file to the library that runs the reader when pictures arrive. Nothing is installed anywhere. These
steps were run against a real library in November 2026.

A second library, such as another household's, repeats those three steps with a key of its own.

**The "Send Notes/Photos to Recipes" Shortcut.** For recipes kept as pictures in another app, such as screenshots
in a note: this Shortcut sits in the share sheet and sends a note's pictures straight to the library
to be read, with no trip through the photo library. It relies on reading photos being set up first.
Its steps are inside the app, with your library's own address filled in: open Recipes, then
**Settings**, **Send from other apps**, **Set up Send Notes/Photos to Recipes**. It is made by hand on each iPhone
and can share the key of the Save Webpage to Recipes Shortcut. The steps were run on an iPhone with iOS 27 in
November 2026.

Both Shortcuts appear in Safari's share sheet: Apple notes that a Shortcut that takes pictures is
offered for web pages too, since a page can contain pictures. Their names say which is which; for a
web page, use Save Webpage to Recipes.

To try the reader on a computer first, see "Run the tests" in the README.

**The "Recipe Timer" Shortcut.** Only needed if timers in the kitchen view should run in the
iPhone's Clock app, where they ring even with the phone locked. Without it, timers run inside Recipes
and ring only while the app is open on screen. Open Recipes, then **Settings**, **Timers**, and choose
**In the Clock app**: the screen that opens has the steps for making the Shortcut, one more step
that brings Recipes back to the front by itself once the timer has started, and a button to try it.
Each iPhone makes its own and chooses for itself. The steps were run on an iPhone with iOS 27 in
November 2026.

**Sending a recipe to someone.** Nothing to set up: open a recipe, tap the three dots, then **Send
this recipe**. The link holds the recipe itself. Whoever opens it can read it, and keeps it in their
own library with their Save Webpage to Recipes Shortcut.

This will be written out in full when the part it belongs to is built:

- Set up a second, separate library for another household.
