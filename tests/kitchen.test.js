import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRecipe } from '../js/model.js';
import {
  kitchenRows, stepOrder, currentStep, stepBeside, stepFoldKey, sectionOf,
  timerId, makeTimer, timeLeft, clockText, tidyTimers, timerLink, resumeCooking, freshTicks, DONE_KEPT, RESUME_WITHIN, TICKS_KEPT,
} from '../js/kitchen.js';

// A made-up recipe with one step above any heading and two sections under headings.
const bowl = () => makeRecipe({
  title: 'Sesame rice bowl',
  steps: [
    'Rinse the rice.',                              // 0   step 1
    'For the rice:',                                // 1   heading
    'Simmer for 12 to 15 minutes.',                 // 2   step 2
    'Rest, covered, for 10 minutes.',               // 3   step 3
    'For the sauce:',                               // 4   heading
    'Whisk everything together.',                   // 5   step 4
    'Leave to stand 1 hour 30 minutes.',            // 6   step 5
    'To serve:',                                    // 7   heading with nothing under it
  ],
}, '2026-11-16T12:00:00.000Z');

// ---------- the steps ----------

test('kitchen: every step is a row, with its number and the times it mentions', () => {
  const rows = kitchenRows(bowl());
  assert.deepEqual(rows.map((r) => (r.kind === 'step' ? r.number + ':' + r.index : 'h:' + r.label)),
    ['1:0', 'h:For the rice', '2:2', '3:3', 'h:For the sauce', '4:5', '5:6', 'h:To serve']);
  assert.deepEqual(rows.filter((r) => r.kind === 'step').map((r) => r.times), [[], [12, 15], [10], [], [90]]);
  assert.equal(rows[2].text, 'Simmer for 12 to 15 minutes.');
  assert.deepEqual(rows[1], { kind: 'heading', label: 'For the rice', key: 'For the rice', count: 2, folded: false });
  assert.deepEqual(rows[7], { kind: 'heading', label: 'To serve', key: 'To serve', count: 0, folded: false });
});

test('kitchen: a section folded on the recipe page is one row here, and the numbers do not shift', () => {
  const folded = new Set([stepFoldKey('For the rice'), 'ing:For the rice']);
  const rows = kitchenRows(bowl(), folded);
  assert.deepEqual(rows.map((r) => (r.kind === 'step' ? r.number + ':' + r.index : 'h:' + r.label + (r.folded ? ' (folded ' + r.count + ')' : ''))),
    ['1:0', 'h:For the rice (folded 2)', 'h:For the sauce', '4:5', '5:6', 'h:To serve']);
  assert.deepEqual(stepOrder(rows), [0, 5, 6]);
});

test('kitchen: a fold of the ingredients, or of a heading with nothing under it, hides no step', () => {
  const rows = kitchenRows(bowl(), new Set(['ing:For the sauce', stepFoldKey('To serve')]));
  assert.deepEqual(stepOrder(rows), [0, 2, 3, 5, 6]);
  assert.equal(rows.find((r) => r.label === 'To serve').folded, false);
});

test('kitchen: a recipe with no steps, or none at all, gives no rows', () => {
  assert.deepEqual(kitchenRows(makeRecipe({ title: 'Empty' })), []);
  assert.deepEqual(kitchenRows(null), []);
  assert.deepEqual(stepOrder([]), []);
});

test('kitchen: the step to light is the remembered one, or the nearest that is still showing', () => {
  const all = [0, 2, 3, 5, 6];
  assert.equal(currentStep(all, null), 0);            // never opened before
  assert.equal(currentStep(all, 3), 3);               // left at step 3
  assert.equal(currentStep([0, 5, 6], 3), 5);         // its section was folded since: the next one showing
  assert.equal(currentStep([0, 2, 3], 6), 3);         // nothing after it: the last one showing
  assert.equal(currentStep(all, 40), 6);              // the recipe got shorter
  assert.equal(currentStep(all, 'x'), 0);
  assert.equal(currentStep([], 2), -1);
});

test('kitchen: Next and Back walk the showing steps and stop at either end', () => {
  const order = [0, 5, 6];
  assert.equal(stepBeside(order, 0, 1), 5);
  assert.equal(stepBeside(order, 5, 1), 6);
  assert.equal(stepBeside(order, 6, 1), 6);
  assert.equal(stepBeside(order, 5, -1), 0);
  assert.equal(stepBeside(order, 0, -1), 0);
  assert.equal(stepBeside(order, 3, 1), 0);           // the current one is not showing: start again
  assert.equal(stepBeside([], 0, 1), -1);
});

test('kitchen: which section a step sits in, for opening it when a timer points there', () => {
  const recipe = bowl();
  assert.equal(sectionOf(recipe, 0), '');
  assert.equal(sectionOf(recipe, 3), 'For the rice');
  assert.equal(sectionOf(recipe, 6), 'For the sauce');
  assert.equal(sectionOf(recipe, 4), '');             // a heading is not a step
  assert.equal(sectionOf(recipe, 99), '');
});

// ---------- timers ----------

const T0 = Date.parse('2026-11-16T18:00:00.000Z');
const minute = 60000;

test('timers: a new timer knows whose it is and how it runs', () => {
  const t = makeTimer({ recipe: 'r1', step: 2, n: 1, number: 2, minutes: 15, mode: 'clock' }, T0);
  assert.deepEqual(t, { id: 'r1/2/1', recipe: 'r1', step: 2, n: 1, number: 2, minutes: 15, started: T0, mode: 'clock', rang: false });
  assert.equal(timerId('r1', 2, 1), 'r1/2/1');
  assert.equal(makeTimer({ recipe: 'r1', step: 0, n: 0, number: 1, minutes: 5 }, T0).mode, 'here');
  assert.equal(makeTimer({ recipe: 'r1', step: 0, n: 0, number: 1, minutes: 0.2, mode: 'here' }, T0).minutes, 1);
});

test('timers: time left comes from the clock, so it is right after a reload', () => {
  const t = makeTimer({ recipe: 'r1', step: 2, n: 0, number: 2, minutes: 12, mode: 'here' }, T0);
  assert.deepEqual(timeLeft(t, T0), { left: 12 * minute, done: false, ends: T0 + 12 * minute });
  assert.equal(timeLeft(t, T0 + 5 * minute + 500).left, 7 * minute - 500);
  assert.deepEqual(timeLeft(t, T0 + 12 * minute), { left: 0, done: true, ends: T0 + 12 * minute });
  assert.equal(timeLeft(t, T0 + 40 * minute).done, true);
  // The device's clock was put back: the timer starts over rather than showing more than it was set for.
  assert.equal(timeLeft(t, T0 - 3 * minute).left, 12 * minute);
});

test('timers: how the time left is written', () => {
  assert.equal(clockText(12 * minute), '12:00');
  assert.equal(clockText(9 * minute + 5000), '9:05');
  assert.equal(clockText(59001), '1:00');             // rounded up to the second
  assert.equal(clockText(400), '0:01');
  assert.equal(clockText(0), '0:00');
  assert.equal(clockText(62 * minute + 5000), '1:02:05');
  assert.equal(clockText(-50), '0:00');
});

test('timers: what is kept of the timers read back from the device', () => {
  const now = T0 + 20 * minute;
  const running = makeTimer({ recipe: 'r1', step: 2, n: 0, number: 2, minutes: 30, mode: 'here' }, T0);
  const justDone = makeTimer({ recipe: 'r1', step: 3, n: 0, number: 3, minutes: 10, mode: 'clock' }, T0);
  const longDone = makeTimer({ recipe: 'r2', step: 0, n: 0, number: 1, minutes: 5, mode: 'here' }, now - 5 * minute - DONE_KEPT - 1000);
  const edge = makeTimer({ recipe: 'r2', step: 1, n: 0, number: 2, minutes: 5, mode: 'here' }, now - 5 * minute - DONE_KEPT);
  const kept = tidyTimers([running, justDone, longDone, edge, null, 'x', { recipe: 'r1' }, { ...running, minutes: 0 }, { ...running, step: -1 }, { ...running, started: 'soon' }], now);
  assert.deepEqual(kept.map((t) => t.id), ['r2/1/0', 'r1/3/0', 'r1/2/0']);   // soonest first
  assert.equal(kept.find((t) => t.id === 'r1/3/0').mode, 'clock');
  assert.deepEqual(tidyTimers(undefined, now), []);
  assert.deepEqual(tidyTimers({ a: 1 }, now), []);
});

test('timers: started twice, the later one counts; what was rung stays rung', () => {
  const first = makeTimer({ recipe: 'r1', step: 2, n: 0, number: 2, minutes: 10, mode: 'here' }, T0);
  const again = { ...makeTimer({ recipe: 'r1', step: 2, n: 0, number: 2, minutes: 10, mode: 'here' }, T0 + 4 * minute), rang: true };
  const kept = tidyTimers([again, first], T0 + 5 * minute);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].started, T0 + 4 * minute);
  assert.equal(kept[0].rang, true);
  // An odd id, mode or step number written by something else is put right.
  const odd = tidyTimers([{ id: 'whatever', recipe: 'r9', step: 4, n: 2, minutes: 3, started: T0, mode: 'elsewhere' }], T0);
  assert.deepEqual(odd, [{ id: 'r9/4/2', recipe: 'r9', step: 4, n: 2, number: 5, minutes: 3, started: T0, mode: 'here', rang: false }]);
});

test('timers: the link that starts one in the Clock app is the plain one', () => {
  assert.equal(timerLink(20), 'shortcuts://run-shortcut?name=Recipe%20Timer&input=text&text=20');
  assert.equal(timerLink(90), 'shortcuts://run-shortcut?name=Recipe%20Timer&input=text&text=90');
  assert.equal(timerLink(0), 'shortcuts://run-shortcut?name=Recipe%20Timer&input=text&text=1');
  assert.equal(timerLink('x'), 'shortcuts://run-shortcut?name=Recipe%20Timer&input=text&text=1');
  assert.ok(!/x-callback|x-success/.test(timerLink(5)));   // asking to come back opens Safari, not the app
});

// ---------- coming back ----------

test('kitchen: the app opens back into the kitchen view only if it was left open lately', () => {
  const now = T0;
  assert.equal(resumeCooking({ id: 'r1', at: now - 10 * minute }, now), 'r1');
  assert.equal(resumeCooking({ id: 'r1', at: now - RESUME_WITHIN }, now), 'r1');
  assert.equal(resumeCooking({ id: 'r1', at: now - RESUME_WITHIN - 1 }, now), '');
  assert.equal(resumeCooking({ id: 'r1', at: now + minute }, now), '');      // a mark from the future is not trusted
  assert.equal(resumeCooking(null, now), '');
  assert.equal(resumeCooking({ id: '', at: now }, now), '');
  assert.equal(resumeCooking({ id: 'r1' }, now), '');
  assert.equal(resumeCooking('r1', now), '');
});

// ---------- ticked ingredients ----------

test('ticks: kept for one cooking session, then the recipe starts clean again', () => {
  const now = T0;
  const saved = {
    r1: { at: now - 20 * minute, on: [3, 0, 3, 5] },          // ticked a little while ago
    r2: { at: now - TICKS_KEPT - 1, on: [1] },                 // last week's
    r3: { at: now - minute, on: [] },                          // everything unticked again
    r4: { at: now + minute, on: [2] },                         // a time from the future is not trusted
    r5: { at: now - minute, on: [-1, 1.5, 'x', 4] },           // only real places count
    r6: 'ticked',
    r7: { on: [1] },
  };
  assert.deepEqual(freshTicks(saved, now), { r1: { at: now - 20 * minute, on: [0, 3, 5] }, r5: { at: now - minute, on: [4] } });
  assert.deepEqual(freshTicks({ r1: { at: now - TICKS_KEPT, on: [2] } }, now), { r1: { at: now - TICKS_KEPT, on: [2] } });
  assert.deepEqual(freshTicks(null, now), {});
  assert.deepEqual(freshTicks([1, 2], now), {});
  assert.deepEqual(freshTicks('x', now), {});
});
