#!/bin/bash
# Publishes the app to GitHub Pages: records your changes, brings in anything published from another
# computer, runs the tests, stamps a new version and sends it. It asks for your GitHub key every time
# and stores nothing on this computer.
#
#   scripts/publish.sh --setup YOUR-GITHUB-USERNAME     once per computer
#   scripts/publish.sh "What changed"                   every time after that
#   scripts/publish.sh --local                          rebuild sw.js for local testing, publish nothing
#
# On a computer that is already signed in to your own GitHub, skip the question with:
#   RECIPES_REMEMBER_LOGIN=1 scripts/publish.sh "What changed"

set -euo pipefail
cd "$(dirname "$0")/.."

# sw.js and js/version.js are written by this script and by nothing else.
GENERATED="sw.js js/version.js"

stamp() {
  local build="$1" list="'./'" f
  while IFS= read -r f; do list="$list, '$f'"; done < <(find index.html manifest.webmanifest css js icons proofs -type f ! -name '.DS_Store' | LC_ALL=C sort)
  {
    echo "// Generated from sw.template.js by scripts/publish.sh. Edit the template, not this file."
    awk -v build="$build" -v list="$list" '{ gsub(/__BUILD__/, build); gsub(/__FILES__/, list); print }' sw.template.js
  } > sw.js
  printf "// Written by scripts/publish.sh on every publish. Do not edit by hand.\nexport const BUILD = '%s';\n" "$build" > js/version.js
}

if [ "${1:-}" = "--local" ]; then
  stamp dev
  echo "sw.js rebuilt for local testing."
  exit 0
fi

if [ "${1:-}" = "--setup" ]; then
  user="${2:-}"
  if [ -z "$user" ]; then echo "Usage: scripts/publish.sh --setup YOUR-GITHUB-USERNAME"; exit 1; fi
  [ -d .git ] || git init -q -b main
  # A GitHub "noreply" address keeps real email addresses out of a public repository.
  git config user.name "$user"
  git config user.email "$user@users.noreply.github.com"
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "https://$user@github.com/$user/recipes.git"
  else
    git remote add origin "https://$user@github.com/$user/recipes.git"
  fi
  echo "Ready. This copy publishes to https://github.com/$user/recipes"
  echo "Changes are recorded as $user@users.noreply.github.com, so no real email address is published."
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1 || ! git remote get-url origin >/dev/null 2>&1 || ! git config --local --get user.email >/dev/null; then
  echo "Run this once first:  scripts/publish.sh --setup YOUR-GITHUB-USERNAME"
  exit 1
fi

# These hold a private key and personal screenshots. They must never reach a public repository.
for private in .env samples; do
  if [ -n "$(git ls-files -- "$private")" ]; then
    echo "STOP: $private is being tracked by git. Run:  git rm -r --cached $private   and publish again."
    exit 1
  fi
done

have_head() { git rev-parse --verify -q HEAD >/dev/null; }

# 1. See what is already on GitHub. The repository is public, so reading it needs no key.
anon=(-c credential.helper= -c "credential.https://github.com.helper=")
on_github=false
if GIT_TERMINAL_PROMPT=0 git "${anon[@]}" fetch -q origin main 2>/dev/null; then on_github=true; fi
if ! have_head && $on_github; then
  # First publish from this copy into a repository that already has something in it, such as a README.
  git update-ref "$(git symbolic-ref HEAD)" FETCH_HEAD
  git reset -q
fi

# 2. Record your changes. The generated files are left out; they get a commit of their own in step 5.
if have_head; then
  for g in $GENERATED; do git checkout -q HEAD -- "$g" 2>/dev/null || true; done
fi
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  git commit -q -m "${1:-Update}"
fi
if ! have_head; then echo "There is nothing here to publish yet."; exit 1; fi

# 3. Bring in anything that was published from another computer.
if $on_github && ! git merge-base --is-ancestor FETCH_HEAD HEAD; then
  echo "Bringing in changes that were published from another computer."
  if ! git rebase -q FETCH_HEAD >/dev/null 2>&1; then
    clash="$(git diff --name-only --diff-filter=U | tr '\n' ' ')"
    git rebase --abort
    echo "STOP: this computer and the other one changed the same lines in: $clash"
    echo "Nothing was published, and your work here is untouched."
    echo "To sort it out:  git pull --rebase origin main   then fix the marked lines in those files,"
    echo "                 git add -A && git rebase --continue   and publish again."
    exit 1
  fi
fi
if $on_github && [ "$(git rev-parse HEAD)" = "$(git rev-parse FETCH_HEAD)" ]; then
  echo "Nothing has changed since the last publish."
  exit 0
fi

# 4. Test what is about to go out.
if command -v node >/dev/null 2>&1; then
  if ! node --test tests/*.test.js >/tmp/recipes-tests.log 2>&1; then
    cat /tmp/recipes-tests.log
    echo "The tests failed, so nothing was published. Your changes are recorded on this computer only."
    exit 1
  fi
  echo "Tests passed."
else
  echo "node is not installed here, so the tests were skipped."
fi

# 5. Stamp a new version. Every device fetches the new files the next time it is online.
build="$(date -u +%Y%m%d-%H%M%S)"
stamp "$build"
git add -A
git commit -q -m "Version $build"

# 6. Send it. If that fails, take the version stamp back off so the next attempt starts clean.
if [ "${RECIPES_REMEMBER_LOGIN:-}" = "1" ]; then
  sent=true; git push -q -u origin HEAD:main || sent=false
else
  echo "Sending to GitHub. When it asks for a password, paste your GitHub key. It is not saved."
  sent=true; git "${anon[@]}" push -q -u origin HEAD:main || sent=false
fi
if ! $sent; then
  git reset -q --hard HEAD~1
  echo "GitHub did not accept it, so nothing was published. Your changes are still recorded here."
  echo "Check the key (it needs Contents: Read and write on the recipes repository) and try again."
  exit 1
fi
echo "Published version $build. GitHub Pages takes about a minute to show it."
