'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  HARD_COLLISION_MS,
  TIGHT_GAP_MS,
  analyzeActuatorTrace,
  applyActuatorFilter,
} = require('../src/sim/actuator');

test('actuator thresholds classify HARD_COLLISION_MS (<35ms) and TIGHT_GAP_MS (35..54ms)', () => {
  assert.equal(HARD_COLLISION_MS, 35);
  assert.equal(TIGHT_GAP_MS, 55);

  const events = [
    { t: 0, type: 'light', cue: 'a' },
    { t: 34, type: 'tick', cue: 'b' }, // gap 34 -> hard collision
    { t: 69, type: 'tick', cue: 'c' }, // gap 35 -> tight gap
    { t: 123, type: 'tick', cue: 'd' }, // gap 54 -> tight gap
    { t: 178, type: 'tick', cue: 'e' }, // gap 55 -> clean
  ];

  const report = analyzeActuatorTrace(events, 1000);
  assert.equal(report.totalPulses, 5);
  assert.equal(report.minGapMs, 34);
  assert.equal(report.hardCollisions.length, 1);
  assert.equal(report.hardCollisions[0].gapMs, 34);
  assert.equal(report.hardCollisions[0].type, 'tick');

  assert.equal(report.tightGaps.length, 2);
  assert.deepEqual(
    report.tightGaps.map((g) => g.gapMs),
    [35, 54]
  );
});

test('applyActuatorFilter marks smeared pulses without mutating input array or events', () => {
  const ev1 = { t: 100, type: 'medium', cue: 'first' };
  const ev2 = { t: 120, type: 'tick', cue: 'second' }; // 20ms gap -> smeared
  const ev3 = { t: 155, type: 'rigid', cue: 'third' }; // 35ms gap -> not smeared
  const ev4 = { t: 500, type: 'soft', cue: 'fourth', smeared: true }; // pre-marked smeared preserved
  const input = [ev2, ev1, ev4, ev3];
  const inputSnapshot = JSON.parse(JSON.stringify(input));

  const filtered = applyActuatorFilter(input);

  // Inputs remain untouched in order and properties
  assert.deepEqual(input, inputSnapshot);
  assert.equal('smeared' in ev1, false);
  assert.equal('smeared' in ev2, false);
  assert.equal('smeared' in ev3, false);

  assert.equal(filtered.length, 4);
  assert.deepEqual(
    filtered.map((e) => ({ t: e.t, type: e.type, smeared: e.smeared })),
    [
      { t: 100, type: 'medium', smeared: false },
      { t: 120, type: 'tick', smeared: true },
      { t: 155, type: 'rigid', smeared: false },
      { t: 500, type: 'soft', smeared: true },
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
