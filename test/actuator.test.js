'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HARD_COLLISION_MS,
  TIGHT_GAP_MS,
  HAPTIC_SETTLE_MS,
  getSettleWindowMs,
  analyzeActuatorTrace,
  applyActuatorFilter,
} = require('../src/sim/actuator');
const { createSession } = require('../src/sim/runner');

test('actuator thresholds expose HAPTIC_SETTLE_MS, getSettleWindowMs(), HARD_COLLISION_MS, and TIGHT_GAP_MS', () => {
  assert.equal(HARD_COLLISION_MS, 35);
  assert.equal(TIGHT_GAP_MS, 55);
  assert.deepEqual(HAPTIC_SETTLE_MS, {
    tick: 15,
    light: 18,
    soft: 22,
    medium: 25,
    rigid: 25,
    heavy: 35,
    success: 180,
    warning: 200,
    error: 240,
  });

  assert.equal(getSettleWindowMs('tick'), 15);
  assert.equal(getSettleWindowMs('light'), 18);
  assert.equal(getSettleWindowMs('soft'), 22);
  assert.equal(getSettleWindowMs('medium'), 25);
  assert.equal(getSettleWindowMs('rigid'), 25);
  assert.equal(getSettleWindowMs('heavy'), 35);
  assert.equal(getSettleWindowMs('success'), 180);
  assert.equal(getSettleWindowMs('warning'), 200);
  assert.equal(getSettleWindowMs('error'), 240);
  assert.equal(getSettleWindowMs('unknown_type'), HARD_COLLISION_MS);

  // `light` has settleMs=18 and tightCeiling=max(55, 38)=55
  const events = [
    { t: 0, type: 'light', cue: 'a' },
    { t: 17, type: 'tick', cue: 'b' }, // gap 17 < 18 -> hard collision
    { t: 52, type: 'tick', cue: 'c' }, // gap 35 >= 15 and < 55 -> tight gap
    { t: 106, type: 'tick', cue: 'd' }, // gap 54 >= 15 and < 55 -> tight gap
    { t: 161, type: 'tick', cue: 'e' }, // gap 55 -> clean
  ];

  const report = analyzeActuatorTrace(events, 1000);
  assert.equal(report.totalPulses, 5);
  assert.equal(report.minGapMs, 17);
  assert.equal(report.hardCollisions.length, 1);
  assert.equal(report.hardCollisions[0].gapMs, 17);
  assert.equal(report.hardCollisions[0].settleMs, 18);
  assert.equal(report.hardCollisions[0].prevType, 'light');
  assert.equal(report.hardCollisions[0].type, 'tick');

  assert.equal(report.tightGaps.length, 2);
  assert.deepEqual(
    report.tightGaps.map((g) => g.gapMs),
    [35, 54]
  );
});

test('type-aware settling windows: tick @ 20ms does NOT collide, heavy @ 20ms DOES collide, success @ 100ms DOES collide', () => {
  // Snappy tick ratcheting at 20ms: tick settleMs = 15ms -> NOT colliding (goes to tightGaps)
  const tickRatchet = analyzeActuatorTrace(
    [
      { t: 0, type: 'tick', cue: 'detent' },
      { t: 20, type: 'tick', cue: 'detent' },
      { t: 40, type: 'tick', cue: 'detent' },
    ],
    500
  );
  assert.equal(tickRatchet.hardCollisions.length, 0);
  assert.equal(tickRatchet.tightGaps.length, 2);

  // Heavy @ 20ms: heavy settleMs = 35ms -> DOES collide
  const heavyCollision = analyzeActuatorTrace(
    [
      { t: 0, type: 'heavy', cue: 'thud' },
      { t: 20, type: 'tick', cue: 'follow' },
    ],
    500
  );
  assert.equal(heavyCollision.hardCollisions.length, 1);
  assert.equal(heavyCollision.hardCollisions[0].gapMs, 20);
  assert.equal(heavyCollision.hardCollisions[0].settleMs, 35);
  assert.equal(heavyCollision.hardCollisions[0].prevType, 'heavy');

  // Success @ 100ms: success settleMs = 180ms -> DOES collide
  const successCollision = analyzeActuatorTrace(
    [
      { t: 0, type: 'success', cue: 'beacon_capture' },
      { t: 100, type: 'soft', cue: 'sonar_cold' },
    ],
    500
  );
  assert.equal(successCollision.hardCollisions.length, 1);
  assert.equal(successCollision.hardCollisions[0].gapMs, 100);
  assert.equal(successCollision.hardCollisions[0].settleMs, 180);
  assert.equal(successCollision.hardCollisions[0].prevType, 'success');

  // Success tight gap window: 180 <= gap < max(55, 180 + 20) = 200
  const successTight = analyzeActuatorTrace(
    [
      { t: 0, type: 'success', cue: 'beacon_capture' },
      { t: 190, type: 'soft', cue: 'sonar_cold' },
      { t: 390, type: 'soft', cue: 'sonar_cold' },
    ],
    500
  );
  assert.equal(successTight.hardCollisions.length, 0);
  assert.equal(successTight.tightGaps.length, 1);
  assert.equal(successTight.tightGaps[0].gapMs, 190);
});

test('applyActuatorFilter and runner live smearing use type-aware settling windows without mutating input', () => {
  const ev1 = { t: 100, type: 'medium', cue: 'first' }; // settleMs=25
  const ev2 = { t: 120, type: 'tick', cue: 'second' }; // 20ms after medium (<25) -> smeared; settleMs=15
  const ev3 = { t: 140, type: 'rigid', cue: 'third' }; // 20ms after tick (>=15) -> NOT smeared; settleMs=25
  const ev4 = { t: 165, type: 'success', cue: 'fourth' }; // 25ms after rigid (>=25) -> NOT smeared; settleMs=180
  const ev5 = { t: 265, type: 'light', cue: 'fifth' }; // 100ms after success (<180) -> smeared
  const ev6 = { t: 600, type: 'soft', cue: 'sixth', smeared: true }; // pre-marked smeared preserved
  const input = [ev2, ev5, ev1, ev6, ev4, ev3];
  const inputSnapshot = JSON.parse(JSON.stringify(input));

  const filtered = applyActuatorFilter(input);

  // Inputs remain untouched in order and properties
  assert.deepEqual(input, inputSnapshot);
  assert.equal('smeared' in ev1, false);
  assert.equal('smeared' in ev2, false);
  assert.equal('smeared' in ev3, false);

  assert.equal(filtered.length, 6);
  assert.deepEqual(
    filtered.map((e) => ({ t: e.t, type: e.type, smeared: e.smeared })),
    [
      { t: 100, type: 'medium', smeared: false },
      { t: 120, type: 'tick', smeared: true },
      { t: 140, type: 'rigid', smeared: false },
      { t: 165, type: 'success', smeared: false },
      { t: 265, type: 'light', smeared: true },
      { t: 600, type: 'soft', smeared: true },
    ]
  );

  // Verify runner.js live smearing matches type-aware settling windows
  const mockMode = {
    id: 'type-aware-smear-test',
    name: 'Type Aware Smear Test',
    kind: 'fidget',
    inputs: ['action'],
    blindInstructions: 'Emit test sequence.',
    create(ctx) {
      return {
        onInput(ev) {
          if (ev.type === 'action' && ev.name === 'emit') {
            ctx.haptics[ev.haptic]({ cue: ev.name });
          }
        },
        getVisualState: () => ({}),
        getEvalState: () => ({ score: 0 }),
        dispose() {},
      };
    },
  };

  const session = createSession(mockMode, { seed: 1, humanProfile: 'ideal' });
  session.step({ type: 'action', name: 'emit', haptic: 'tick' }, 20);
  session.step({ type: 'action', name: 'emit', haptic: 'heavy' }, 20);
  session.step({ type: 'action', name: 'emit', haptic: 'success' }, 100);
  session.step({ type: 'action', name: 'emit', haptic: 'light' }, 10);
  const trace = session.getRawTrace();
  session.dispose();

  assert.deepEqual(
    trace.rawHaptics.map((h) => ({ type: h.type, smeared: h.smeared })),
    [
      { type: 'tick', smeared: false },
      { type: 'heavy', smeared: false }, // 20ms after tick (15ms settle) -> clean
      { type: 'success', smeared: true }, // 20ms after heavy (35ms settle) -> smeared
      { type: 'light', smeared: true }, // 100ms after success (180ms settle) -> smeared
    ]
  );
});

test('analyzeActuatorTrace computes pulsesPerSecond, energyPerSecond, minGapMs, and acousticRisk thresholds', () => {
  // Low risk: 2 light pulses over 1000ms -> 2 pps, 0.7 eps, no collisions/tight gaps
  const lowReport = analyzeActuatorTrace(
    [
      { t: 0, type: 'light', cue: 'p1' },
      { t: 500, type: 'light', cue: 'p2' },
    ],
    1000
  );
  assert.equal(lowReport.pulsesPerSecond, 2);
  assert.equal(lowReport.energyPerSecond, 0.7);
  assert.equal(lowReport.minGapMs, 500);
  assert.equal(lowReport.acousticRisk, 'low');

  // Moderate via energyPerSecond >= 2.2 (3 heavy pulses = 3.0 energy in 1000ms -> 3.0 eps)
  const modEnergy = analyzeActuatorTrace(
    [
      { t: 0, type: 'heavy', cue: 'h' },
      { t: 300, type: 'heavy', cue: 'h' },
      { t: 600, type: 'heavy', cue: 'h' },
    ],
    1000
  );
  assert.equal(modEnergy.energyPerSecond, 3);
  assert.equal(modEnergy.pulsesPerSecond, 3);
  assert.equal(modEnergy.acousticRisk, 'moderate');

  // Moderate via pulsesPerSecond >= 5.5 (6 tick pulses = 0.9 energy in 1000ms -> 6 pps)
  const modPps = analyzeActuatorTrace(
    [
      { t: 0, type: 'tick', cue: 't' },
      { t: 150, type: 'tick', cue: 't' },
      { t: 300, type: 'tick', cue: 't' },
      { t: 450, type: 'tick', cue: 't' },
      { t: 600, type: 'tick', cue: 't' },
      { t: 750, type: 'tick', cue: 't' },
    ],
    1000
  );
  assert.equal(modPps.pulsesPerSecond, 6);
  assert.equal(modPps.energyPerSecond, 0.9);
  assert.equal(modPps.acousticRisk, 'moderate');

  // Moderate via 1 hard collision or 3 tight gaps
  const modCollision = analyzeActuatorTrace(
    [
      { t: 0, type: 'tick', cue: 'c' },
      { t: 10, type: 'tick', cue: 'c' },
    ],
    2000
  );
  assert.equal(modCollision.hardCollisions.length, 1);
  assert.equal(modCollision.acousticRisk, 'moderate');

  const modTight = analyzeActuatorTrace(
    [
      { t: 0, type: 'tick', cue: 'g' },
      { t: 40, type: 'tick', cue: 'g' },
      { t: 80, type: 'tick', cue: 'g' },
      { t: 120, type: 'tick', cue: 'g' },
    ],
    2000
  );
  assert.equal(modTight.tightGaps.length, 3);
  assert.equal(modTight.acousticRisk, 'moderate');

  // High via energyPerSecond >= 4.5 (5 heavy pulses = 5.0 energy in 1000ms)
  const highEnergy = analyzeActuatorTrace(
    [
      { t: 0, type: 'heavy', cue: 'h' },
      { t: 200, type: 'heavy', cue: 'h' },
      { t: 400, type: 'heavy', cue: 'h' },
      { t: 600, type: 'heavy', cue: 'h' },
      { t: 800, type: 'heavy', cue: 'h' },
    ],
    1000
  );
  assert.equal(highEnergy.energyPerSecond, 5);
  assert.equal(highEnergy.acousticRisk, 'high');

  // High via pulsesPerSecond >= 10 (10 ticks in 1000ms)
  const highPps = analyzeActuatorTrace(
    Array.from({ length: 10 }, (_, idx) => ({ t: idx * 100, type: 'tick', cue: 't' })),
    1000
  );
  assert.equal(highPps.pulsesPerSecond, 10);
  assert.equal(highPps.acousticRisk, 'high');

  // High via >= 3 hard collisions
  const highCollisions = analyzeActuatorTrace(
    [
      { t: 0, type: 'tick', cue: 'c' },
      { t: 10, type: 'tick', cue: 'c' },
      { t: 20, type: 'tick', cue: 'c' },
      { t: 30, type: 'tick', cue: 'c' },
    ],
    5000
  );
  assert.equal(highCollisions.hardCollisions.length, 3);
  assert.equal(highCollisions.acousticRisk, 'high');
});

test('analyzeActuatorTrace aggregates cueToTypes and counts unlabeledPulses', () => {
  const report = analyzeActuatorTrace(
    [
      { t: 0, type: 'tick', cue: 'ridge_cross' },
      { t: 100, type: 'light', cue: 'ridge_cross' },
      { t: 200, type: 'tick', cue: 'ridge_cross' },
      { t: 300, type: 'heavy', cue: 'wall_hit' },
      { t: 400, type: 'soft', cue: null },
      { t: 500, type: 'medium' },
    ],
    600
  );

  assert.deepEqual(report.cueToTypes, {
    ridge_cross: ['tick', 'light'],
    wall_hit: ['heavy'],
  });
  assert.equal(report.unlabeledPulses, 2);
  assert.deepEqual(report.typeCounts, {
    tick: 2,
    light: 1,
    heavy: 1,
    soft: 1,
    medium: 1,
  });
});
