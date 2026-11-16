import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PICTURES, JOB_FILE, ORIGINAL, WORKFLOW_PATH, newJobId, jobPath, jobFolder, picturePath, jobRecipeId, originalPath,
  makeJob, serializeJob, readJob, failedJob, retriedJob, fitWithin, appRepository, workflowText,
} from '../js/jobs.js';

test('jobs: a job file names its pictures in its own folder, in order', () => {
  const job = makeJob({ id: 'abc123def456', count: 2, at: '2026-03-01T10:00:00.000Z', by: 'Phone', kind: 'screenshot' });
  assert.deepEqual(job, {
    v: 1, job: 'photos', id: 'abc123def456',
    images: ['inbox/job-abc123def456/1.jpg', 'inbox/job-abc123def456/2.jpg'],
    at: '2026-03-01T10:00:00.000Z', by: 'Phone', kind: 'screenshot',
  });
  assert.equal(jobPath('abc123def456'), 'inbox/job-abc123def456.json');
  assert.equal(jobFolder('abc123def456'), 'inbox/job-abc123def456/');
  assert.equal(picturePath('abc123def456', 2), 'inbox/job-abc123def456/2.jpg');
  assert.ok(JOB_FILE.test(jobPath('abc123def456')));
  assert.ok(serializeJob(job).endsWith('}\n'));
});

test('jobs: a title typed when sending is carried in the job, and left out when there is none', () => {
  const id = 'abc123def456';
  assert.equal(makeJob({ id, count: 1, title: '  Sunday   chicken dinner ' }).title, 'Sunday chicken dinner');
  for (const nothing of ['', '   ', undefined, null, 42]) assert.equal('title' in makeJob({ id, count: 1, title: nothing }), false);
  assert.equal(makeJob({ id, count: 1, title: 'x'.repeat(500) }).title.length, 200);
  assert.equal(readJob(makeJob({ id, count: 1, title: 'Sunday chicken dinner' }), jobPath(id)).title, 'Sunday chicken dinner');
  assert.equal(readJob(makeJob({ id, count: 1 }), jobPath(id)).title, '');
  assert.equal(readJob({ ...makeJob({ id, count: 1 }), title: ['not', 'text'] }, jobPath(id)).title, '');
});

test('jobs: a kind that is not "screenshot" counts as a photo', () => {
  assert.equal(makeJob({ id: 'abc123def456', count: 1 }).kind, 'photo');
  assert.equal(makeJob({ id: 'abc123def456', count: 1, kind: 'painting' }).kind, 'photo');
});

test('jobs: a new id is twelve small letters and digits, and fits a job file name', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i++) {
    const id = newJobId();
    assert.match(id, /^[a-z0-9]{12}$/);
    assert.ok(JOB_FILE.test(jobPath(id)));
    ids.add(id);
  }
  assert.equal(ids.size, 200);
});

test('jobs: the recipe a job becomes, and where its pictures are kept, follow from its id', () => {
  assert.equal(jobRecipeId('abc123def456'), 'rpabc123def456');
  assert.equal(originalPath('rpabc123def456', 1), 'originals/rpabc123def456/1.jpg');
  assert.equal(ORIGINAL.exec('originals/rpabc123def456/2.jpg')[1], 'rpabc123def456');
  assert.equal(ORIGINAL.exec('originals/rpabc123def456/deeper/2.jpg'), null);
  assert.equal(ORIGINAL.exec('recipes/rpabc123def456.json'), null);
});

test('jobs: reading a job file gives its state', () => {
  const data = makeJob({ id: 'abc123def456', count: 3, at: '2026-03-01T10:00:00.000Z', by: 'Phone', kind: 'photo' });
  const job = readJob(data, jobPath('abc123def456'));
  assert.equal(job.state, 'waiting');
  assert.equal(job.pictures, 3);
  assert.equal(job.by, 'Phone');
  assert.equal(job.kind, 'photo');
  assert.equal(job.error, '');

  const failed = readJob(failedJob(data, 'No recipe could be found in these pictures.', '2026-03-01T10:02:00.000Z'), jobPath('abc123def456'));
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error, 'No recipe could be found in these pictures.');
  assert.equal(failed.tries, 1);
});

test('jobs: asking for another try takes the reason out and keeps the rest', () => {
  const data = makeJob({ id: 'abc123def456', count: 1, at: '2026-03-01T10:00:00.000Z', by: 'Phone' });
  const failed = failedJob(failedJob(data, 'Busy.', '2026-03-01T10:02:00.000Z'), 'Busy again.', '2026-03-01T10:05:00.000Z');
  assert.equal(failed.tries, 2);
  const again = retriedJob(failed);
  assert.equal('error' in again, false);
  assert.equal('failed' in again, false);
  assert.equal(again.tries, 2);
  assert.deepEqual(again.images, data.images);
  assert.equal(readJob(again, jobPath('abc123def456')).state, 'waiting');
});

test('jobs: a file that is not a picture job this version understands is not one', () => {
  const id = 'abc123def456';
  const good = makeJob({ id, count: 1 });
  assert.equal(readJob(good, 'inbox/' + id + '.json'), null, 'not a job file name');
  assert.equal(readJob({ ...good, job: 'link' }, jobPath(id)), null, 'another kind of job');
  assert.equal(readJob({ ...good, id: 'zzz999zzz999' }, jobPath(id)), null, 'the id does not match the name');
  assert.equal(readJob({ ...good, images: [] }, jobPath(id)), null, 'no pictures');
  assert.equal(readJob({ ...good, images: ['inbox/job-zzz999zzz999/1.jpg'] }, jobPath(id)), null, 'a picture in another job');
  assert.equal(readJob({ ...good, images: ['../secrets.txt'] }, jobPath(id)), null, 'a path outside its folder');
  assert.equal(readJob({ ...good, images: ['recipes/r1.json'] }, jobPath(id)), null, 'not a picture');
  assert.equal(readJob({ ...good, images: Array.from({ length: MAX_PICTURES + 1 }, (x, i) => picturePath(id, i + 1)) }, jobPath(id)), null, 'too many pictures');
  assert.equal(readJob(null, jobPath(id)), null);
  assert.equal(readJob([good], jobPath(id)), null);
  assert.equal(readJob('text', jobPath(id)), null);
});

test('jobs: a picture is shrunk to a long edge of 2000, and never made larger', () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 2000, height: 1500 });
  assert.deepEqual(fitWithin(3024, 4032), { width: 1500, height: 2000 });
  assert.deepEqual(fitWithin(1170, 2532), { width: 924, height: 2000 });
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(0, 0), { width: 1, height: 1 });
});

test('jobs: a tall screenshot keeps enough width to be read', () => {
  // A full-page capture: shrinking its long edge to 2000 would leave it 293 wide.
  assert.deepEqual(fitWithin(1170, 8000), { width: 900, height: 6154 });
  // One already narrower than that is left as it is.
  assert.deepEqual(fitWithin(750, 9000), { width: 667, height: 8000 });
  // And the long edge never goes past 8000.
  assert.equal(fitWithin(1170, 20000).height, 8000);
});

test('jobs: the app works out its own repository from the address it is served from', () => {
  assert.equal(appRepository('someone.github.io', '/recipes/'), 'someone/recipes');
  assert.equal(appRepository('someone.github.io', '/recipes/index.html'), 'someone/recipes');
  assert.equal(appRepository('Some-One.github.io', '/my.recipes/'), 'Some-One/my.recipes');
  assert.equal(appRepository('someone.github.io', '/'), 'someone/someone.github.io');
  assert.equal(appRepository('someone.github.io', '/index.html'), 'someone/someone.github.io');
  assert.equal(appRepository('localhost', '/'), '');
  assert.equal(appRepository('recipes.example.com', '/recipes/'), '');
  assert.equal(appRepository('', ''), '');
});

test('jobs: the workflow file runs the importer from the app when a picture job arrives', () => {
  const text = workflowText('someone/recipes');
  assert.equal(WORKFLOW_PATH, '.github/workflows/import.yml');
  // Only picture jobs start it. A page saved from Safari is inbox/<number>.json and does not match.
  assert.match(text, /\n {2}push:\n {4}paths:\n {6}- 'inbox\/job-\*'\n {6}- 'inbox\/job-\*\/\*\*'\n/);
  assert.match(text, /\npermissions:\n {2}contents: write\n/);
  assert.match(text, /\nconcurrency:\n {2}group: import\n {2}cancel-in-progress: false\n/);
  assert.match(text, /repository: someone\/recipes\n {10}path: app\n/);
  assert.match(text, /GEMINI_API_KEY: \$\{\{ secrets\.GEMINI_API_KEY \}\}\n/);
  assert.match(text, /run: node app\/importer\/run\.mjs library\n/);
  // Plain text, spaces only, and nothing that names a person or a place.
  assert.equal(/\t/.test(text), false);
  assert.equal(/[^\x20-\x7e\n]/.test(text), false);
  assert.ok(text.endsWith('\n'));
  // Every line is a comment, blank, or a key at an even indent: enough to catch a slip in the layout.
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    assert.equal(/^( {2})*\S/.test(line), true, 'odd indent: ' + line);
  }
});
