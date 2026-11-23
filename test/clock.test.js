'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createVirtualClock } = require('../src/sim/clock');
const { createRng } = require('../src/sim/rng');

test('createVirtualClock orders setTimeout callbacks by fireAt and breaks ties FIFO', () => {
  const clock = createVirtualClock();
  const order = [];

  clock.setTimeout(() => order.push(['late', clock.now()]), 50);
  clock.setTimeout(() => order.push(['first-10', clock.now()]), 10);
  clock.setTimeout(() => order.push(['second-10', clock.now()]), 10);
  clock.setTimeout(() => order.push(['zero', clock.now()]), 0);
  clock.setTimeout(() => order.push(['third-10', clock.now()]), 10);

  assert.equal(clock.pendingCount(), 5);

  clock.advance(50);

  assert.deepEqual(order, [
    ['zero', 0],
    ['first-10', 10],
    ['second-10', 10],
    ['third-10', 10],
    ['late', 50],
  ]);
  assert.equal(clock.now(), 50);
  assert.equal(clock.pendingCount(), 0);
});

test('createVirtualClock clearTimeout cancels pending callback and updates pendingCount', () => {
  const clock = createVirtualClock();
  const fired = [];

  const t1 = clock.setTimeout(() => fired.push('t1'), 20);
  const t2 = clock.setTimeout(() => fired.push('t2'), 30);
  const t3 = clock.setTimeout(() => fired.push('t3'), 40);

  assert.equal(clock.pendingCount(), 3);
  clock.clearTimeout(t2);
  assert.equal(clock.pendingCount(), 2);

  clock.advance(25);
  assert.deepEqual(fired, ['t1']);
  assert.equal(clock.pendingCount(), 1);

  clock.clearTimeout(t3);
  clock.clearTimeout(t1); // clearing already-fired timer is a safe no-op
  assert.equal(clock.pendingCount(), 0);

  clock.advance(100);
  assert.deepEqual(fired, ['t1']);
  assert.equal(clock.now(), 125);
});

test('createVirtualClock supports nested and recursive timeouts within a single advance', () => {
  const clock = createVirtualClock();
  const timestamps = [];

  function scheduleStep(step) {
    if (step > 4) return;
    clock.setTimeout(() => {
      timestamps.push({ step, t: clock.now() });
      scheduleStep(step + 1);
    }, 15);
  }

  scheduleStep(1);
  assert.equal(clock.pendingCount(), 1);

  clock.advance(65);

  assert.deepEqual(timestamps, [
    { step: 1, t: 15 },
    { step: 2, t: 30 },
    { step: 3, t: 45 },
    { step: 4, t: 60 },
  ]);
  assert.equal(clock.pendingCount(), 0);
  assert.equal(clock.now(), 65);
});

test('createVirtualClock setInterval fires periodically until clearInterval', () => {
  const clock = createVirtualClock();
  const hits = [];

  const id = clock.setInterval(() => {
    hits.push(clock.now());
    if (hits.length === 3) {
      clock.clearInterval(id);
    }
  }, 25);

  assert.equal(clock.pendingCount(), 1);
  clock.advance(200);

  assert.deepEqual(hits, [25, 50, 75]);
  assert.equal(clock.pendingCount(), 0);
  assert.equal(clock.now(), 200);
});

test('createVirtualClock pendingCount reflects timeouts, intervals, and clearAll accurately', () => {
  const clock = createVirtualClock();

  const a = clock.setTimeout(() => {}, 10);
  const b = clock.setTimeout(() => {}, 50);
  const c = clock.setInterval(() => {}, 20);
  assert.equal(clock.pendingCount(), 3);

  clock.advance(15); // 'a' fires
  assert.equal(clock.pendingCount(), 2);

  clock.clearTimeout(b);
  assert.equal(clock.pendingCount(), 1);

  clock.clearAll();
  assert.equal(clock.pendingCount(), 0);

  clock.advance(100);
  assert.equal(clock.pendingCount(), 0);
  clock.clearInterval(c);
});

test('createVirtualClock runaway callback guard throws cleanly', () => {
  const clock = createVirtualClock({ maxCallbacksPerAdvance: 50 });

  function loop() {
    clock.setTimeout(loop, 0);
  }
  clock.setTimeout(loop, 0);

  assert.throws(
    () => clock.advance(10),
    /VirtualClock runaway guard tripped: exceeded 50 callbacks/
  );
});

test('createVirtualClock validates arguments cleanly', () => {
  const clock = createVirtualClock();
  assert.throws(() => clock.setTimeout('not-a-fn', 10), TypeError);
  assert.throws(() => clock.advance(-1), RangeError);
  assert.throws(() => clock.advance(Number.NaN), RangeError);
});

test('createRng(seed) is deterministic and bounded in [0, 1)', () => {
  const rngA1 = createRng(12345);
  const rngA2 = createRng(12345);
  const rngB = createRng(54321);

  const seqA1 = Array.from({ length: 20 }, () => rngA1());
  const seqA2 = Array.from({ length: 20 }, () => rngA2());
  const seqB = Array.from({ length: 20 }, () => rngB());

  assert.deepEqual(seqA1, seqA2);
  assert.notDeepEqual(seqA1, seqB);

  for (const v of seqA1) {
    assert.equal(typeof v, 'number');
    assert.ok(v >= 0 && v < 1);
  }

  // Seed 0 should still produce a valid non-degenerate stream
  const rngZero = createRng(0);
  const zeroSample = Array.from({ length: 5 }, () => rngZero());
  assert.equal(new Set(zeroSample).size, 5);
});
