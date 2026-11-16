// Commits what the importer changed in a library's checkout and pushes it. If someone synced in the
// meantime, the commit is put on top of theirs and pushed again.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// The name GitHub shows for changes made by a workflow.
const WHO = ['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com'];

const git = (dir, args) => run('git', ['-C', dir, ...args], { maxBuffer: 32 * 1024 * 1024 });

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The branch the checkout is on. A workflow may leave it on a bare commit, and then says which branch it was. */
async function branchOf(dir) {
  const { stdout } = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const name = stdout.trim();
  return name && name !== 'HEAD' ? name : process.env.GITHUB_REF_NAME || 'main';
}

/**
 * Commits every change in `dir` with `message` and pushes it. Resolves false when there was nothing to
 * commit. Rejects when the push kept being refused or the library changed in a way that clashes.
 */
export async function commitAndPush(dir, message, { tries = 4, wait = 1500 } = {}) {
  await git(dir, ['add', '-A']);
  const { stdout } = await git(dir, ['status', '--porcelain']);
  if (!stdout.trim()) return false;
  await git(dir, [...WHO, 'commit', '-q', '-m', message]);
  const branch = await branchOf(dir);

  for (let attempt = 1; ; attempt++) {
    try {
      await git(dir, ['push', '-q', 'origin', 'HEAD:refs/heads/' + branch]);
      return true;
    } catch (err) {
      if (attempt >= tries) throw new Error('The library would not take the importer’s changes: ' + String(err.stderr || err.message).trim().slice(0, 300));
    }
    // Someone else's changes arrived first. Bring them in under this commit and try again.
    await pause(wait);
    try {
      await git(dir, [...WHO, 'pull', '-q', '--rebase', 'origin', branch]);
    } catch (err) {
      await git(dir, ['rebase', '--abort']).catch(() => {});
      throw new Error('The library changed in a way that clashes with what the importer wrote. It will be read again on the next run.');
    }
  }
}
