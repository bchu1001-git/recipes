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
4. Click **Generate token** and copy it into your password manager. GitHub shows it only once.

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

- **iPhone:** open the address in Safari, tap Share, then **Add to Home Screen**.
- **Mac:** open the address in Safari, then File, **Add to Dock**.

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

1. On github.com, click your picture, then **Your organizations**, then **New organization**.
2. Choose the **Free** plan.
3. Give it a name nobody else has, enter a contact email, and say it belongs to your personal account.
4. Skip inviting people for now.

### 2. Let keys work without approval or an expiry date

1. Open the organization, then **Settings**.
2. In the left column, under **Personal access tokens**, open **Settings**.
3. Allow fine-grained tokens, and choose **Do not require administrator approval**.
4. If a maximum lifetime is set for fine-grained tokens, remove the limit, so that keys can be made
   with no expiration.

### 3. Create the library

1. In the organization, **New repository**.
2. Name: `library`. Visibility: **Private**. Everything else can stay as it is.
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

In Recipes: **Settings**, **Connect a library**. Enter `YOUR-ORGANIZATION/library`, paste the key, name
the device, and tap **Connect**. Do the same on each device. The first one to connect sends its recipes
up; the others receive them.

### 6. Add the second person

In the organization, **People**, then **Invite member**. Once they accept, they make their own key
with the link in step 4 and connect the app the same way.

## Part 4: later steps

These will be written out in full when the parts they belong to are built:

- Add the AI key to the library as a secret.
- Install the "Save to Recipes" and "Recipe Timer" Shortcuts.
- Set up a second, separate library for another household.
