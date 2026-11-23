'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { HUMAN_PROFILES, createHumanModel } = require('../src/sim/humanModel');
const { createRng } = require('../src/sim/rng');
const { createSession } = require('../src/sim/runner');
const SafeCrackerMode = require('../src/engine/safeCracker');
const HotColdHuntMode = require('../src/engine/hotColdHunt');

test('HUMAN_PROFILES exposes ideal, typical, and pocket profiles with expected noise ordering', () => {
  assert.deepEqual(Object.keys(HUMAN_PROFILES).sort(), ['ideal', 'pocket', 'typical']);

  assert.equal(HUMAN_PROFILES.ideal.timingJitterMs, 0);
  assert.equal(HUMAN_PROFILES.ideal.spatialDrift, 0);
  assert.equal(HUMAN_PROFILES.ideal.tiltNoise, 0);
  assert.equal(HUMAN_PROFILES.ideal.confusionRate, 0);

  assert.ok(HUMAN_PROFILES.typical.timingJitterMs > HUMAN_PROFILES.ideal.timingJitterMs);
  assert.ok(HUMAN_PROFILES.pocket.timingJitterMs > HUMAN_PROFILES.typical.timingJitterMs);

  assert.ok(HUMAN_PROFILES.typical.spatialDrift > HUMAN_PROFILES.ideal.spatialDrift);
  assert.ok(HUMAN_PROFILES.pocket.spatialDrift > HUMAN_PROFILES.typical.spatialDrift);

  assert.ok(HUMAN_PROFILES.typical.tiltNoise > HUMAN_PROFILES.ideal.tiltNoise);
  assert.ok(HUMAN_PROFILES.pocket.tiltNoise > HUMAN_PROFILES.typical.tiltNoise);

  assert.ok(HUMAN_PROFILES.typical.confusionRate > HUMAN_PROFILES.ideal.confusionRate);
  assert.ok(HUMAN_PROFILES.pocket.confusionRate > HUMAN_PROFILES.typical.confusionRate);
});

test('createHumanModel spatial drift clamps coordinates to [0, 1] without mutating input objects', () => {
  const model = createHumanModel('pocket', createRng(77));

  const edgeEvents = [
    { type: 'pointer_down', x: 0, y: 1 },
    { type: 'pointer_move', x: 0.005, y: 0.995 },
    { type: 'pointer_move', x: 0.5, y: 0.5 },
    { type: 'pointer_up', x: 1, y: 0 },
  ];
  const snapshots = edgeEvents.map((e) => ({ ...e }));

  for (let i = 0; i < edgeEvents.length; i += 1) {
    const ev = edgeEvents[i];
    const perturbed = model.perturbInput(ev);
    assert.deepEqual(ev, snapshots[i]);
    assert.notEqual(perturbed, ev);
    assert.ok(perturbed.x >= 0 && perturbed.x <= 1, `x out of bounds: ${perturbed.x}`);
    assert.ok(perturbed.y >= 0 && perturbed.y <= 1, `y out of bounds: ${perturbed.y}`);
  }
});

test('createHumanModel jitterDelay preserves ideal timing and bounds pocket jitter cleanly', () => {
  const ideal = createHumanModel('ideal', createRng(1));
  assert.equal(ideal.jitterDelay(120), 120);
  assert.equal(ideal.jitterDelay(0), 0);
  assert.equal(ideal.jitterDelay(-15), 0);

  const pocket = createHumanModel('pocket', createRng(42));
  let sawDelta = false;
  for (let i = 0; i < 40; i += 1) {
    const delayed = pocket.jitterDelay(100);
    assert.ok(Number.isInteger(delayed));
    assert.ok(delayed >= 100 - HUMAN_PROFILES.pocket.timingJitterMs);
    assert.ok(delayed <= 100 + HUMAN_PROFILES.pocket.timingJitterMs);
    if (delayed !== 100) sawDelta = true;
  }
  assert.equal(sawDelta, true);
});

test('perceiveHaptic enforces strict anti-leak: no cue or internal metadata appears in blind haptics', () => {
  const model = createHumanModel('typical', createRng(99));
  const raw = {
    t: 250,
    type: 'rigid',
    cue: 'secret_tumbler_hit',
    smeared: false,
    target: 14,
    beacon: { x: 0.5, y: 0.5 },
  };
  const perceived = model.perceiveHaptic(raw);

  assert.deepEqual(Object.keys(perceived).sort(), ['felt', 'smeared', 't', 'type']);
  assert.equal('cue' in perceived, false);
  assert.equal('target' in perceived, false);
  assert.equal('beacon' in perceived, false);
  assert.equal(perceived.t, 250);
  assert.equal(perceived.smeared, false);
  assert.equal(typeof perceived.felt, 'string');

  // Verify end-to-end through createSession as well
  const session = createSession(SafeCrackerMode, { seed: 7, humanProfile: 'pocket' });
  const h1 = session.input({ type: 'pointer_down', x: 0.5, y: 0.5 });
  const h2 = session.step({ type: 'pointer_move', x: 0.9, y: 0.5 }, 100).haptics;
  const allBlind = h1.concat(h2).concat(session.readBlindHaptics());
  assert.ok(allBlind.length > 0);
  for (const h of allBlind) {
    assert.deepEqual(Object.keys(h).sort(), ['felt', 'smeared', 't', 'type']);
    assert.equal('cue' in h, false);
  }
  session.dispose();
});

test('createSession isolates engine RNG from humanProfile RNG for identical seeds', () => {
  const safeIdeal = createSession(SafeCrackerMode, { seed: 2026, humanProfile: 'ideal' });
  const safePocket = createSession(SafeCrackerMode, { seed: 2026, humanProfile: 'pocket' });

  assert.equal(safeIdeal.getEvalState().target, safePocket.getEvalState().target);

  // Even after human noise perturbations in pocket mode, engine initial target / sequence matches
  const huntIdeal = createSession(HotColdHuntMode, { seed: 555, humanProfile: 'ideal' });
  const huntPocket = createSession(HotColdHuntMode, { seed: 555, humanProfile: 'pocket' });
  assert.deepEqual(huntIdeal.getEvalState().beacon, huntPocket.getEvalState().beacon);

  safeIdeal.dispose();
  safePocket.dispose();
  huntIdeal.dispose();
  huntPocket.dispose();
});

test('createSession input(), advance(), step(), and readBlindHaptics() follow cursor semantics', () => {
  const session = createSession(SafeCrackerMode, { seed: 11, humanProfile: 'ideal' });

  const fromInput = session.input({ type: 'pointer_down', x: 0.5, y: 0.5 });
  assert.equal(fromInput.length, 1);
  assert.equal(fromInput[0].type, 'light');

  // Cursor is drained after input(), so advance(0) returns empty
  assert.deepEqual(session.advance(0), []);

  // Move directly onto target via dial to trigger 2-step tumbler pattern (t=0 heavy, t=55 rigid)
  // Note: playPattern schedules step 0 via clock.setTimeout(..., 0), so it fires on advance(0)
  const target = session.getEvalState().target;
  assert.deepEqual(session.input({ type: 'dial', deltaSteps: target }), []);
  const firstPulse = session.advance(0);
  assert.equal(firstPulse.length, 1);
  assert.equal(firstPulse[0].type, 'heavy');

  // Advancing 54ms does not yet fire the 55ms rigid pulse
  assert.deepEqual(session.advance(54), []);
  // Advancing 1ms more fires the rigid pulse
  const delayed = session.advance(1);
  assert.equal(delayed.length, 1);
  assert.equal(delayed[0].type, 'rigid');
  assert.equal(delayed[0].t, 55);

  // step() combines input() + advance()
  const stepResult = session.step({ type: 'dial', deltaSteps: 1 }, 20);
  assert.equal(stepResult.t, 75);
  assert.equal(stepResult.haptics.length, 1);
  assert.equal(stepResult.haptics[0].type, 'medium');

  // readBlindHaptics(sinceIndex) does not advance or reset the drain cursor
  const all = session.readBlindHaptics(0);
  assert.equal(all.length, 4);
  assert.equal(session.readBlindHaptics(2).length, 2);
  assert.deepEqual(session.advance(10), []);

  // Blind haptics never expose cue even while raw trace retains it
  const trace = session.getRawTrace();
  assert.equal(trace.rawHaptics.length, 4);
  assert.equal(trace.rawHaptics[1].cue, 'tumbler_hit_1');
  assert.equal('cue' in trace.blindHaptics[1], false);

  session.dispose();
});

test('createSession dispose() detects zero leaked timers on clean modes and >0 on leaky mock mode', () => {
  const cleanSession = createSession(HotColdHuntMode, { seed: 3 });
  cleanSession.input({ type: 'pointer_down', x: 0.5, y: 0.5 });
  const cleanResult = cleanSession.dispose();
  assert.equal(cleanResult.leakedTimers, 0);

  const leakyMode = {
    id: 'leaky-mock',
    name: 'Leaky Mock',
    kind: 'fidget',
    inputs: ['action'],
    blindInstructions: 'Mock mode that forgets to clear an interval on dispose.',
    create(ctx) {
      ctx.clock.setInterval(() => {
        ctx.haptics.tick({ cue: 'leak' });
      }, 100);
      return {
        onInput() {},
        getVisualState: () => ({}),
        getEvalState: () => ({ score: 0 }),
        dispose() {
          // Intentionally omit clearInterval to verify harness leak detection
        },
      };
    },
  };

  const leakySession = createSession(leakyMode, { seed: 1 });
  const leakyResult = leakySession.dispose();
  assert.ok(leakyResult.leakedTimers > 0);

  // Subsequent disposal is idempotent and returns 0
  assert.deepEqual(leakySession.dispose(), { leakedTimers: 0 });
  assert.throws(() => leakySession.input({ type: 'action' }), /already been disposed/);
});
