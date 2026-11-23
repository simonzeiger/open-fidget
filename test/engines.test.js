'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateModeDefinition, validateModeInstance } = require('../src/engine/contract');
const { MODE_LIST, MODES, listModeIds } = require('../src/engine/registry');
const { createVirtualClock } = require('../src/sim/clock');
const { createRng } = require('../src/sim/rng');
const { createHapticsContext } = require('../src/engine/contract');
const { createSession } = require('../src/sim/runner');

test('registry exposes all 5 modes and passes contract definition and instance validation', () => {
  assert.deepEqual(listModeIds().sort(), ['hunt', 'marble', 'rhythm', 'safe', 'sandbox']);
  assert.equal(MODE_LIST.length, 5);

  for (const mode of MODE_LIST) {
    assert.equal(validateModeDefinition(mode), true);
    assert.equal(MODES[mode.id], mode);

    const clock = createVirtualClock();
    const haptics = createHapticsContext(clock, () => {});
    const instance = mode.create({
      clock,
      haptics,
      rng: createRng(42),
      onStateChange: () => {},
    });
    assert.equal(validateModeInstance(instance, mode.id), true);
    instance.dispose();
    assert.equal(clock.pendingCount(), 0, `${mode.id} leaked timers on fresh dispose`);
  }
});

test('safe mode: drag onto target emits heavy+rigid, unlocks 3-pin vault, strict resets on slip, dial works, 0 leaks', () => {
  const session = createSession(MODES.safe, { seed: 10, humanProfile: 'ideal' });

  // Helper to move from current detent to target using normalized pointer drag in [0, 1]
  function dragToTarget() {
    const state = session.getEvalState();
    const cwSteps = (state.target - state.detent + 24) % 24;
    const ccwSteps = cwSteps - 24; // negative
    const steps = Math.abs(cwSteps) <= 12 ? cwSteps : ccwSteps;
    const startX = steps >= 0 ? 0.1 : 0.9;
    const endX = startX + steps * 0.05;

    const downH = session.input({ type: 'pointer_down', x: startX, y: 0.5 });
    assert.equal(downH[0].type, 'light');

    // Step across intermediate detents one tick at a time so we observe heavy + rigid on landing
    const dir = steps >= 0 ? 1 : -1;
    let landingHaptics = [];
    for (let s = 1; s <= Math.abs(steps); s += 1) {
      const x = startX + dir * s * 0.05;
      const res = session.step({ type: 'pointer_move', x, y: 0.5 }, 60);
      if (s === Math.abs(steps)) {
        landingHaptics = res.haptics;
      }
    }
    assert.equal(Math.abs(endX - (startX + steps * 0.05)) < 1e-9, true);
    return landingHaptics;
  }

  // Crack 3 pins in chill mode
  for (let pin = 1; pin <= 3; pin += 1) {
    const landing = dragToTarget();
    assert.deepEqual(
      landing.map((h) => h.type),
      ['heavy', 'rigid']
    );
    assert.equal(session.getVisualState().onTarget, true);

    const release = session.step({ type: 'pointer_up', x: 0.5, y: 0.5 }, 300);
    if (pin < 3) {
      assert.equal(session.getEvalState().pinsLocked, pin);
      assert.equal(session.getEvalState().vaultsCracked, 0);
      assert.equal(release.haptics[0].type, 'success');
    } else {
      assert.equal(session.getEvalState().pinsLocked, 0);
      assert.equal(session.getEvalState().vaultsCracked, 1);
      assert.deepEqual(
        release.haptics.map((h) => h.type),
        ['success', 'heavy', 'success']
      );
    }
  }

  // Test dial input directly
  const beforeDial = session.getEvalState();
  const deltaToTarget = (beforeDial.target - beforeDial.detent + 24) % 24;
  const dialRes = session.step({ type: 'dial', deltaSteps: deltaToTarget }, 60);
  assert.equal(session.getEvalState().detent, beforeDial.target);
  assert.deepEqual(
    dialRes.haptics.map((h) => h.type),
    ['heavy', 'rigid']
  );

  // Strict mode resets locked pins on off-target lift
  const strictSession = createSession(MODES.safe, {
    seed: 10,
    variant: 'strict',
    humanProfile: 'ideal',
  });
  assert.equal(strictSession.getEvalState().strictMode, true);

  // Lock pin 1 cleanly
  strictSession.input({ type: 'pointer_down', x: 0.1, y: 0.5 });
  const t1 = strictSession.getEvalState().target;
  const cw = (t1 - strictSession.getEvalState().detent + 24) % 24;
  const s1 = cw <= 12 ? cw : cw - 24;
  strictSession.step({ type: 'pointer_move', x: 0.1 + s1 * 0.05, y: 0.5 }, 60);
  strictSession.input({ type: 'pointer_up', x: 0.1 + s1 * 0.05, y: 0.5 });
  assert.equal(strictSession.getEvalState().pinsLocked, 1);

  // Now drag off-target and release -> strict mode resets pinsLocked to 0 with error haptic
  strictSession.input({ type: 'pointer_down', x: 0.5, y: 0.5 });
  strictSession.input({ type: 'pointer_move', x: 0.6, y: 0.5 }); // +2 detents, away from target (>=5 away)
  const slipH = strictSession.input({ type: 'pointer_up', x: 0.6, y: 0.5 });
  assert.equal(slipH[0].type, 'error');
  assert.equal(strictSession.getEvalState().pinsLocked, 0);

  assert.equal(session.dispose().leakedTimers, 0);
  assert.equal(strictSession.dispose().leakedTimers, 0);
});

test('rhythm mode: tap starts playback, echoes DOT & DASH to increment streak, wrong input emits error and restarts, pointer_cancel clears hold timer', () => {
  // Find a deterministic seed whose initial 3-step sequence contains both DOT and DASH
  let chosenSeed = 1;
  for (let s = 1; s <= 50; s += 1) {
    const probe = createSession(MODES.rhythm, { seed: s, humanProfile: 'ideal' });
    probe.input({ type: 'pointer_down', x: 0.5, y: 0.5 });
    probe.input({ type: 'pointer_up', x: 0.5, y: 0.5 });
    probe.advance(3000);
    const seq = probe.getVisualState().sequence;
    probe.dispose();
    if (seq.includes('DOT') && seq.includes('DASH')) {
      chosenSeed = s;
      break;
    }
  }

  const session = createSession(MODES.rhythm, { seed: chosenSeed, humanProfile: 'ideal' });
  assert.equal(session.getEvalState().phase, 'idle');

  // Tap starts playback
  session.input({ type: 'pointer_down', x: 0.5, y: 0.5 });
  session.input({ type: 'pointer_up', x: 0.5, y: 0.5 });
  assert.equal(session.getEvalState().phase, 'playing');

  // Advance until playback finishes and listening starts
  const playbackHaptics = session.advance(3000);
  assert.equal(session.getEvalState().phase, 'listening');
  const seq = session.getVisualState().sequence;
  assert.ok(seq.includes('DOT') && seq.includes('DASH'));

  // Verify playback emitted rigid for DOT and heavy+medium for DASH
  const playbackTypes = playbackHaptics.map((h) => h.type);
  assert.ok(playbackTypes.includes('rigid'));
  assert.ok(playbackTypes.includes('heavy'));
  assert.ok(playbackTypes.includes('medium'));

  // Echo full sequence accurately
  for (let i = 0; i < seq.length; i += 1) {
    const sym = seq[i];
    const downH = session.input({ type: 'pointer_down', x: 0.5, y: 0.5 });
    assert.equal(downH[0].type, 'light');
    if (sym === 'DOT') {
      const holdH = session.advance(60);
      assert.equal(holdH.length, 0);
      const upH = session.input({ type: 'pointer_up', x: 0.5, y: 0.5 });
      assert.ok(upH.some((h) => h.type === 'rigid'));
    } else {
      const crossH = session.advance(250);
      assert.deepEqual(
        crossH.map((h) => h.type),
        ['heavy']
      );
      session.input({ type: 'pointer_up', x: 0.5, y: 0.5 });
    }
  }

  assert.equal(session.getEvalState().score, 1);
  assert.equal(session.getEvalState().phase, 'success');

  // Advance through 950ms celebration + next round playback (length 4)
  session.advance(5000);
  assert.equal(session.getEvalState().phase, 'listening');
  assert.equal(session.getEvalState().sequenceLength, 4);

  // Test pointer_cancel clears hold timer (no hold_crossed heavy after 300ms)
  session.input({ type: 'pointer_down', x: 0.5, y: 0.5 });
  assert.equal(session.getEvalState().isHolding, true);
  session.input({ type: 'pointer_cancel', x: 0.5, y: 0.5 });
  assert.equal(session.getEvalState().isHolding, false);
  const afterCancel = session.advance(300);
  assert.deepEqual(afterCancel, []);
  assert.equal(session.getEvalState().inputIndex, 0);

  // Wrong input triggers error and restarts game after 1100ms
  const expected = session.getEvalState().expectedSymbol;
  session.input({ type: 'pointer_down', x: 0.5, y: 0.5 });
  let failHaptics;
  if (expected === 'DOT') {
    // Enter DASH instead
    session.advance(260);
    failHaptics = session.input({ type: 'pointer_up', x: 0.5, y: 0.5 });
  } else {
    // Enter DOT instead
    session.advance(40);
    failHaptics = session.input({ type: 'pointer_up', x: 0.5, y: 0.5 });
  }
  assert.equal(session.getEvalState().phase, 'fail');
  assert.ok(failHaptics.some((h) => h.type === 'error'));

  // Advance 1100ms -> restarts with streak = 0 and initial length 3
  session.advance(1100);
  assert.equal(session.getEvalState().score, 0);
  assert.equal(session.getEvalState().sequenceLength, 3);

  assert.equal(session.dispose().leakedTimers, 0);
});

test('hunt mode: zones emit soft/light/medium/rigid, 550ms lock & <=0.12 lift capture, and 680ms cold-timer sweep blind spot verified', () => {
  const session = createSession(MODES.hunt, { seed: 12, humanProfile: 'ideal' });
  const b1 = session.getEvalState().beacon;

  // Helper to pick a point at desired distance from beacon clamped inside [0, 1]
  function pointAtDist(beacon, d) {
    const dirX = beacon.x + d <= 0.98 ? 1 : -1;
    return { x: beacon.x + dirX * d, y: beacon.y };
  }

  // 1. Verify zone haptics via fresh pointer_down in each zone:
  // Cold (> 0.42) -> soft
  const coldPt = pointAtDist(b1, 0.48);
  assert.equal(session.input({ type: 'pointer_down', ...coldPt })[0].type, 'soft');
  session.input({ type: 'pointer_up', ...coldPt });

  // Warm (0.24 < d <= 0.42) -> light
  const warmPt = pointAtDist(b1, 0.30);
  assert.equal(session.input({ type: 'pointer_down', ...warmPt })[0].type, 'light');
  session.input({ type: 'pointer_up', ...warmPt });

  // Hot (0.11 < d <= 0.24) -> medium
  const hotPt = pointAtDist(b1, 0.16);
  assert.equal(session.input({ type: 'pointer_down', ...hotPt })[0].type, 'medium');
  session.input({ type: 'pointer_up', ...hotPt });

  // Locked (<= 0.11) -> rigid, and holding 550ms captures beacon
  const lockPt = pointAtDist(b1, 0.05);
  assert.equal(session.input({ type: 'pointer_down', ...lockPt })[0].type, 'rigid');
  const holdAdvance = session.advance(600);
  assert.ok(holdAdvance.some((h) => h.type === 'success'));
  assert.equal(session.getEvalState().foundCount, 1);
  session.input({ type: 'pointer_up', x: 0.02, y: 0.02 }); // lift off-target after capture

  // 2. Lift within 0.12 (0.115 > 0.11 lock threshold, <= 0.12 capture threshold) captures beacon
  const b2 = session.getEvalState().beacon;
  const edgePt = pointAtDist(b2, 0.115);
  session.input({ type: 'pointer_down', ...edgePt });
  const liftCapture = session.input({ type: 'pointer_up', ...edgePt });
  assert.equal(liftCapture[0].type, 'success');
  assert.equal(session.getEvalState().foundCount, 2);

  // 3. Empirically verify v0 680ms cold-timer sweep blind spot:
  // Touching down in the cold zone schedules the next pulse 680ms later.
  // Sweeping straight onto the beacon at t+50ms and away at t+500ms receives ZERO haptics during the 680ms window.
  const b3 = session.getEvalState().beacon;
  const startCold = pointAtDist(b3, 0.48);
  const initialCold = session.input({ type: 'pointer_down', ...startCold });
  assert.equal(initialCold[0].type, 'soft');

  const sweepOnTarget = session.step({ type: 'pointer_move', x: b3.x, y: b3.y }, 400);
  assert.deepEqual(sweepOnTarget.haptics, []);

  // Even sweeping back off before 680ms elapses yields zero haptics while crossing target
  const sweepOffTarget = session.step({ type: 'pointer_move', ...startCold }, 250);
  assert.deepEqual(sweepOffTarget.haptics, []);
  assert.equal(session.getEvalState().foundCount, 2);

  // Only at 680ms total elapsed does the timer fire again (emitting cold 'soft' because finger moved back)
  const at680 = session.advance(30);
  assert.equal(at680.length, 1);
  assert.equal(at680[0].type, 'soft');

  assert.equal(session.dispose().leakedTimers, 0);
});

test('marble mode: zero tilt stays stationary, imu+advance hits walls/ridges/pegs, hole tray scores, calibrate zeroes tilt, 0 leaks', () => {
  // 1. Zero tilt stays stationary (after initial cellX/cellY sync tick at t=25)
  const ridgesSession = createSession(MODES.marble, {
    seed: 5,
    variant: 'ridges',
    humanProfile: 'ideal',
  });
  ridgesSession.advance(25);
  assert.deepEqual(ridgesSession.getEvalState().pos, { x: 0, y: 0 });
  const hZero = ridgesSession.advance(500);
  assert.deepEqual(hZero, []);
  assert.deepEqual(ridgesSession.getEvalState().pos, { x: 0, y: 0 });

  // 2. Ridges tray: tilt right and advance -> moves marble, crosses grid ridges, and bounces off wall
  ridgesSession.input({ type: 'imu', ax: 1.0, ay: 0 });
  const ridgeHaptics = ridgesSession.advance(1000);
  assert.ok(ridgesSession.getEvalState().pos.x > 0);
  const ridgeRawCues = ridgesSession
    .getRawTrace()
    .rawHaptics.map((e) => e.cue);
  assert.ok(ridgeRawCues.includes('ridge_cross'));
  assert.ok(
    ridgeRawCues.some((c) => c === 'wall_rigid' || c === 'wall_medium' || c === 'wall_soft')
  );
  assert.ok(ridgeHaptics.length > 0);

  // Calibrate zeroes tilt at current raw IMU reading
  const calH = ridgesSession.input({ type: 'action', name: 'calibrate' });
  assert.equal(calH[0].type, 'medium');
  ridgesSession.advance(3000); // velocity decays to ~0 with zero relative tilt
  const posAfterDecay = { ...ridgesSession.getEvalState().pos };
  ridgesSession.advance(500);
  assert.ok(Math.abs(ridgesSession.getEvalState().pos.x - posAfterDecay.x) < 1e-4);

  // 3. Pegs tray: steer directly into center peg at (0, 0) from (-0.5, 0) or bounce off (-0.45, -0.42)
  const pegsSession = createSession(MODES.marble, {
    seed: 5,
    variant: 'pegs',
    humanProfile: 'ideal',
  });
  // Aim toward peg (-0.45, -0.42): note ay < 0 accelerates +y, so ay > 0 accelerates -y
  pegsSession.input({ type: 'imu', ax: -0.9, ay: 0.84 });
  pegsSession.advance(1200);
  const pegCues = pegsSession.getRawTrace().rawHaptics.map((e) => e.cue);
  assert.ok(pegCues.includes('peg_hit'));

  // 4. Hole tray: steer into hidden hole and hold steady for > 14 frames at speed < 0.045
  const holeSession = createSession(MODES.marble, {
    seed: 9,
    variant: 'hole',
    humanProfile: 'ideal',
  });
  for (let step = 0; step < 120; step += 1) {
    const ev = holeSession.getEvalState();
    if (ev.score >= 1) break;
    const dx = ev.hole.x - ev.pos.x;
    const dy = ev.hole.y - ev.pos.y;
    const dist = Math.hypot(dx, dy);
    // Proportional damping controller to settle cleanly inside the hole
    const targetVx = Math.max(-0.08, Math.min(0.08, dx * 0.25));
    const targetVy = Math.max(-0.08, Math.min(0.08, dy * 0.25));
    const axCmd = dist < 0.06 ? -ev.vel.vx * 8 : (targetVx - ev.vel.vx) * 12;
    const ayCmd = dist < 0.06 ? ev.vel.vy * 8 : -(targetVy - ev.vel.vy) * 12;
    holeSession.step({ type: 'imu', ax: axCmd, ay: ayCmd }, 25);
  }
  assert.ok(holeSession.getEvalState().score >= 1);
  const holeCues = holeSession.getRawTrace().rawHaptics.map((e) => e.cue);
  assert.ok(holeCues.includes('hole_enter'));
  assert.ok(holeCues.includes('hole_score'));

  assert.equal(ridgesSession.dispose().leakedTimers, 0);
  assert.equal(pegsSession.dispose().leakedTimers, 0);
  assert.equal(holeSession.dispose().leakedTimers, 0);
});

test('sandbox mode: switch, slider, bubbles (+260ms auto-reset), and breathing (4-7-8 cadence) emit expected cues with 0 leaks', () => {
  // 1. Switch
  const switchSession = createSession(MODES.sandbox, {
    variant: 'switch',
    humanProfile: 'ideal',
  });
  assert.equal(switchSession.input({ type: 'pointer_down', x: 0.5, y: 0.5 })[0].type, 'rigid');
  assert.equal(switchSession.input({ type: 'pointer_up', x: 0.5, y: 0.5 })[0].type, 'light');
  assert.equal(switchSession.getEvalState().clicks, 1);

  // Switch feel thock
  switchSession.input({ type: 'action', name: 'set_switch_feel', value: 'thock' });
  assert.equal(switchSession.input({ type: 'button_down' })[0].type, 'heavy');
  assert.equal(switchSession.input({ type: 'button_up' })[0].type, 'soft');
  assert.equal(switchSession.dispose().leakedTimers, 0);

  // 2. Slider
  const sliderSession = createSession(MODES.sandbox, {
    variant: 'slider',
    humanProfile: 'ideal',
  });
  const midH = sliderSession.input({ type: 'dial', deltaSteps: 1 });
  assert.equal(midH[0].type, 'medium'); // detent
  const endH = sliderSession.input({ type: 'pointer_down', x: 1, y: 0.5 });
  assert.equal(endH[0].type, 'heavy'); // slider_end at max stop
  const minH = sliderSession.input({ type: 'pointer_move', x: 0, y: 0.5 });
  assert.equal(minH[0].type, 'heavy'); // slider_end at min stop
  const sliderCues = sliderSession.getRawTrace().rawHaptics.map((e) => e.cue);
  assert.deepEqual(sliderCues, ['slider_detent', 'slider_end', 'slider_end']);
  assert.equal(sliderSession.dispose().leakedTimers, 0);

  // 3. Bubbles + 260ms auto-reset
  const bubblesSession = createSession(MODES.sandbox, {
    variant: 'bubbles',
    humanProfile: 'ideal',
  });
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const h = bubblesSession.input({
        type: 'pointer_down',
        x: (col + 0.5) / 4,
        y: (row + 0.5) / 3,
      });
      assert.equal(h[0].type, 'rigid');
    }
  }
  assert.equal(bubblesSession.getEvalState().poppedCount, 12);
  assert.deepEqual(bubblesSession.advance(259), []);
  const resetH = bubblesSession.advance(1);
  assert.equal(resetH.length, 1);
  assert.equal(resetH[0].type, 'success');
  assert.equal(bubblesSession.getEvalState().poppedCount, 0);
  assert.equal(bubblesSession.getEvalState().bubbleResets, 1);
  assert.equal(bubblesSession.dispose().leakedTimers, 0);

  // 4. Breathing 4-7-8 cadence (19s cycle at 500ms ticks)
  const breathSession = createSession(MODES.sandbox, {
    variant: 'breathing',
    humanProfile: 'ideal',
  });
  const startH = breathSession.input({ type: 'pointer_down', x: 0.5, y: 0.5 });
  assert.equal(startH[0].type, 'soft'); // sec 0: inhale
  assert.match(breathSession.getEvalState().breathPhase, /^INHALE/);

  // Advance remaining 3.5s of inhale (7 ticks * 500ms)
  const inhaleRest = breathSession.advance(3500);
  assert.equal(inhaleRest.length, 7);
  assert.ok(inhaleRest.every((h) => h.type === 'soft'));

  // At 4000ms -> HOLD phase starts with medium cue
  const holdStart = breathSession.advance(500);
  assert.equal(holdStart.length, 1);
  assert.equal(holdStart[0].type, 'medium');
  assert.match(breathSession.getEvalState().breathPhase, /^HOLD/);

  // Remaining 6.5s of hold (sec 4.5 .. 10.5) are silent
  assert.deepEqual(breathSession.advance(6500), []);

  // At 11000ms -> EXHALE phase starts with light cue on whole seconds (1Hz)
  const exhaleStart = breathSession.advance(500);
  assert.equal(exhaleStart.length, 1);
  assert.equal(exhaleStart[0].type, 'light');
  assert.match(breathSession.getEvalState().breathPhase, /^EXHALE/);

  const exhaleRest = breathSession.advance(7500); // sec 11.5 .. 18.5 -> 7 more whole-second ticks (12..18)
  assert.equal(exhaleRest.length, 7);
  assert.ok(exhaleRest.every((h) => h.type === 'light'));

  const breathCues = breathSession.getRawTrace().rawHaptics.map((e) => e.cue);
  assert.equal(breathCues.filter((c) => c === 'breath_inhale').length, 8);
  assert.equal(breathCues.filter((c) => c === 'breath_hold_start').length, 1);
  assert.equal(breathCues.filter((c) => c === 'breath_exhale').length, 8);

  assert.equal(breathSession.dispose().leakedTimers, 0);
});
