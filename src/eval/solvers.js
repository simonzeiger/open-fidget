'use strict';

/**
 * Layer 3: Blind Heuristic Solvers, Random Baselines, and Realistic Interaction Probes.
 *
 * STRICT ANTI-LEAK GUARANTEE:
 * Every baseline, blind solver, and behavioral probe receives ONLY a `blindSession`
 * facade exposing:
 *   - getBlindHeader()
 *   - input(event, opts)
 *   - advance(ms, opts)
 *   - step(event, advanceMs, opts)
 *   - readBlindHaptics(sinceIndex)
 *
 * Solvers NEVER access `getEvalState()`, `getVisualState()`, or `getRawTrace()`.
 */

const { createRng } = require('../sim/rng');

function createBlindFacade(session) {
  return Object.freeze({
    getBlindHeader: () => session.getBlindHeader(),
    input: (event, opts) => session.input(event, opts),
    advance: (ms, opts) => session.advance(ms, opts),
    step: (event, advanceMs, opts) => session.step(event, advanceMs, opts),
    readBlindHaptics: (sinceIndex) => session.readBlindHaptics(sinceIndex),
  });
}

function isStrongCluster(type) {
  return type === 'medium' || type === 'rigid' || type === 'heavy';
}

function isNotificationSuccess(type) {
  return type === 'success' || type === 'warning';
}

function isNotificationError(type) {
  return type === 'error' || type === 'warning';
}

function isLightCluster(type) {
  return type === 'tick' || type === 'light' || type === 'soft';
}

// ---------------------------------------------------------------------------
// Random Baselines
// ---------------------------------------------------------------------------

function runRandomSafe(blind, rng) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    let x = 0.1 + rng() * 0.8;
    const y = 0.25 + rng() * 0.5;
    blind.step({ type: 'pointer_down', x, y }, 60);
    const moves = 3 + Math.floor(rng() * 6);
    for (let m = 0; m < moves; m += 1) {
      x = Math.max(0.03, Math.min(0.97, x + (rng() - 0.5) * 0.45));
      blind.step({ type: 'pointer_move', x, y }, 70);
    }
    blind.step({ type: 'pointer_up' }, 120);
  }
}

function runRandomRhythm(blind, rng) {
  // Tap to start
  blind.step({ type: 'pointer_down' }, 45);
  blind.step({ type: 'pointer_up' }, 600 + Math.floor(rng() * 1400));

  for (let i = 0; i < 18; i += 1) {
    const holdMs = rng() < 0.5 ? 40 + Math.floor(rng() * 60) : 220 + Math.floor(rng() * 110);
    blind.step({ type: 'pointer_down' }, holdMs);
    blind.step({ type: 'pointer_up' }, 180 + Math.floor(rng() * 320));
  }
  blind.advance(1200);
}

function runRandomHunt(blind, rng) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let x = 0.1 + rng() * 0.8;
    let y = 0.1 + rng() * 0.8;
    blind.step({ type: 'pointer_down', x, y }, 140);
    const hops = 5 + Math.floor(rng() * 4);
    for (let h = 0; h < hops; h += 1) {
      x = Math.max(0.04, Math.min(0.96, x + (rng() - 0.5) * 0.7));
      y = Math.max(0.04, Math.min(0.96, y + (rng() - 0.5) * 0.7));
      blind.step({ type: 'pointer_move', x, y }, 200 + Math.floor(rng() * 150));
    }
    blind.step({ type: 'pointer_up' }, 150);
  }
}

function runRandomMarble(blind, rng) {
  for (let i = 0; i < 24; i += 1) {
    const ax = (rng() - 0.5) * 1.4;
    const ay = (rng() - 0.5) * 1.4;
    blind.step({ type: 'imu', ax, ay }, 300 + Math.floor(rng() * 250));
  }
  blind.step({ type: 'imu', ax: 0, ay: 0 }, 300);
}

function runRandomGeneric(blind, header, rng, steps = 28) {
  const inputs = header.inputs || [];
  let pointerDown = false;
  let buttonDown = false;
  let px = 0.5;
  let py = 0.5;

  for (let i = 0; i < steps; i += 1) {
    const pick = inputs[Math.floor(rng() * inputs.length)];
    if (pick === 'pointer_down' || pick === 'pointer_move' || pick === 'pointer_up') {
      if (!pointerDown && (pick === 'pointer_down' || rng() < 0.5)) {
        px = 0.1 + rng() * 0.8;
        py = 0.1 + rng() * 0.8;
        pointerDown = true;
        blind.step({ type: 'pointer_down', x: px, y: py }, 80);
      } else if (pointerDown && pick === 'pointer_up') {
        pointerDown = false;
        blind.step({ type: 'pointer_up', x: px, y: py }, 100);
      } else if (pointerDown) {
        px = Math.max(0.05, Math.min(0.95, px + (rng() - 0.5) * 0.4));
        py = Math.max(0.05, Math.min(0.95, py + (rng() - 0.5) * 0.4));
        blind.step({ type: 'pointer_move', x: px, y: py }, 90);
      } else {
        blind.advance(100);
      }
    } else if (pick === 'button_down' || pick === 'button_up') {
      if (!buttonDown) {
        buttonDown = true;
        blind.step({ type: 'button_down' }, 80);
      } else {
        buttonDown = false;
        blind.step({ type: 'button_up' }, 120);
      }
    } else if (pick === 'dial') {
      const deltaSteps = rng() < 0.5 ? 1 : -1;
      blind.step({ type: 'dial', deltaSteps }, 100);
    } else if (pick === 'imu') {
      blind.step({ type: 'imu', ax: (rng() - 0.5) * 1.2, ay: (rng() - 0.5) * 1.2 }, 180);
    } else if (pick === 'squeeze') {
      blind.step({ type: 'squeeze', pressure: rng() }, 120);
    } else {
      blind.advance(100);
    }
  }
  if (pointerDown) blind.step({ type: 'pointer_up', x: px, y: py }, 80);
  if (buttonDown) blind.step({ type: 'button_up' }, 80);
}

function runRandomBaseline(session, modeDef, variant, seed) {
  const blind = createBlindFacade(session);
  const header = blind.getBlindHeader();
  const rng = createRng(seed * 31337 + 11);

  switch (modeDef.id) {
    case 'safe':
      runRandomSafe(blind, rng);
      break;
    case 'rhythm':
      runRandomRhythm(blind, rng);
      break;
    case 'hunt':
      runRandomHunt(blind, rng);
      break;
    case 'marble':
      runRandomMarble(blind, rng);
      break;
    default:
      runRandomGeneric(blind, header, rng, 28);
      break;
  }

  return { kind: 'random_baseline', modeId: modeDef.id, variant };
}

// ---------------------------------------------------------------------------
// Blind Heuristic Solvers (Zero Eval-State / Zero Visual-State Access)
// ---------------------------------------------------------------------------

/**
 * Blind Safe Cracker solver:
 * Slides horizontally across the touch pad in ~1-tick increments, listens for
 * tension (single strong pulse) vs tumbler double-thunk (2 strong pulses from
 * one tick transition), reverses if overshot, and lifts thumb to lock pins.
 */
function solveSafeBlind(blind) {
  const notes = {
    pinsFoundAttempted: 0,
    edgeRepositions: 0,
    doubleThunksHeard: 0,
    lockSuccessesHeard: 0,
    strictResetsHeard: 0,
  };

  let totalTime = 0;
  const maxTimeMs = 24000;

  for (let pinAttempt = 0; pinAttempt < 10 && totalTime < maxTimeMs; pinAttempt += 1) {
    let x = 0.04;
    let dir = 1;
    let found = false;
    let sweeps = 0;

    blind.step({ type: 'pointer_down', x, y: 0.5 }, 70);
    totalTime += 70;

    let stepCount = 0;
    let consecutiveTension = 0;

    while (stepCount < 42 && totalTime < maxTimeMs) {
      stepCount += 1;
      let nextX = x + dir * 0.042;
      if (nextX > 0.96 || nextX < 0.04) {
        // Hit pad edge while dragging: lift to reposition and try remaining notches
        const upRes = blind.step({ type: 'pointer_up' }, 100);
        totalTime += 100;
        notes.edgeRepositions += 1;
        for (const h of upRes.haptics) {
          if (h.type === 'error') notes.strictResetsHeard += 1;
        }
        sweeps += 1;
        if (sweeps >= 2) break;
        x = dir > 0 ? 0.04 : 0.96;
        blind.step({ type: 'pointer_down', x, y: 0.5 }, 70);
        totalTime += 70;
        consecutiveTension = 0;
        continue;
      }

      x = nextX;
      // 85ms gives the 55ms double-thunk pattern plenty of time to emit both pulses
      const res = blind.step({ type: 'pointer_move', x, y: 0.5 }, 85, { jitter: true });
      totalTime += 85;

      const strong = res.haptics.filter((h) => isStrongCluster(h.type));
      const light = res.haptics.filter((h) => isLightCluster(h.type));

      if (strong.length >= 2) {
        // Unmistakable double-thunk (heavy + rigid)
        notes.doubleThunksHeard += 1;
        notes.pinsFoundAttempted += 1;
        // Realistic human lift reaction (~65ms after feeling second thunk)
        blind.advance(65, { jitter: true });
        totalTime += 65;
        const upRes = blind.step({ type: 'pointer_up' }, 420);
        totalTime += 420;
        for (const h of upRes.haptics) {
          if (isNotificationSuccess(h.type)) notes.lockSuccessesHeard += 1;
          if (h.type === 'error') notes.strictResetsHeard += 1;
        }
        found = true;
        break;
      }

      if (strong.length === 1) {
        consecutiveTension += 1;
        // Wait an extra 55ms to let any 55ms double-thunk complete before deciding
        const extra = blind.advance(55);
        totalTime += 55;
        if (extra.some((h) => isStrongCluster(h.type))) {
          notes.doubleThunksHeard += 1;
          notes.pinsFoundAttempted += 1;
          blind.advance(65, { jitter: true });
          totalTime += 65;
          const upRes = blind.step({ type: 'pointer_up' }, 420);
          totalTime += 420;
          for (const h of upRes.haptics) {
            if (isNotificationSuccess(h.type)) notes.lockSuccessesHeard += 1;
            if (h.type === 'error') notes.strictResetsHeard += 1;
          }
          found = true;
          break;
        }
        // If we got 2 consecutive single strong pulses without a double-thunk, reverse 1 step
        if (consecutiveTension >= 2) {
          dir = -dir;
          consecutiveTension = 0;
        }
      } else if (light.length > 0) {
        if (consecutiveTension > 0) {
          // Passed tension back into ticks -> reverse to catch tumbler
          dir = -dir;
        }
        consecutiveTension = 0;
      }
    }

    if (!found && sweeps < 2) {
      blind.step({ type: 'pointer_up' }, 100);
      totalTime += 100;
    }
    if (notes.lockSuccessesHeard >= 6) break;
  }

  return notes;
}

/**
 * Blind Rhythm Echo solver:
 * Taps once to begin, listens purely to the blind haptic stream, groups pulses
 * by temporal clustering (<= 210ms pair = DASH, isolated = DOT), detects turn
 * handoff by silence timeout (>760ms after last pulse), and echoes back.
 */
function solveRhythmBlind(blind) {
  const notes = {
    roundsAttempted: 0,
    roundsSucceeded: 0,
    roundsFailed: 0,
    decodedBeatsTotal: 0,
  };

  // Tap to start first sequence
  blind.step({ type: 'pointer_down' }, 45);
  blind.step({ type: 'pointer_up' }, 0);

  let now = 45;
  const maxTimeMs = 26000;

  for (let round = 0; round < 5 && now < maxTimeMs; round += 1) {
    // Wait and collect playback pulses until >760ms silence after at least 1 pulse
    const pulses = [];
    let silenceMs = 0;
    let maxWait = 0;

    while (maxWait < 9000) {
      const haptics = blind.advance(40);
      now += 40;
      maxWait += 40;

      if (haptics.length > 0) {
        for (const h of haptics) {
          pulses.push(h);
        }
        silenceMs = 0;
      } else if (pulses.length > 0) {
        silenceMs += 40;
        if (silenceMs >= 760) {
          break;
        }
      }
    }

    if (pulses.length === 0) break;

    // Decode pulses by inter-pulse gap (DASH = 2 pulses ~115ms apart; DOT = isolated)
    const decoded = [];
    let i = 0;
    while (i < pulses.length) {
      if (i + 1 < pulses.length && pulses[i + 1].t - pulses[i].t <= 210) {
        decoded.push('DASH');
        i += 2;
      } else {
        decoded.push('DOT');
        i += 1;
      }
    }

    notes.roundsAttempted += 1;
    notes.decodedBeatsTotal += decoded.length;

    let roundOutcome = null;
    for (let b = 0; b < decoded.length; b += 1) {
      const sym = decoded[b];
      if (sym === 'DOT') {
        const downRes = blind.step({ type: 'pointer_down' }, 75, { jitter: true });
        now += 75;
        const upRes = blind.step({ type: 'pointer_up' }, 140, { jitter: true });
        now += 140;
        const all = downRes.haptics.concat(upRes.haptics);
        if (all.some((h) => isNotificationSuccess(h.type))) roundOutcome = 'success';
        if (all.some((h) => h.type === 'error')) roundOutcome = 'fail';
      } else {
        // Hold until hold_crossed cue or ~310ms max (safe against 45ms pocket jitter)
        blind.input({ type: 'pointer_down' });
        let held = 0;
        let sawCross = false;
        while (held < 320) {
          const stepMs = 45;
          const haps = blind.advance(stepMs);
          now += stepMs;
          held += stepMs;
          if (haps.some((h) => isStrongCluster(h.type))) {
            sawCross = true;
            break;
          }
        }
        if (!sawCross && held < 310) {
          blind.advance(310 - held);
          now += 310 - held;
        } else {
          // Small realistic human reaction buffer after feeling hold tick
          blind.advance(40, { jitter: true });
          now += 40;
        }
        const upRes = blind.step({ type: 'pointer_up' }, 150, { jitter: true });
        now += 150;
        if (upRes.haptics.some((h) => isNotificationSuccess(h.type))) roundOutcome = 'success';
        if (upRes.haptics.some((h) => h.type === 'error')) roundOutcome = 'fail';
      }

      if (roundOutcome) break;
    }

    if (roundOutcome === 'success') {
      notes.roundsSucceeded += 1;
      // Wait for round_success pause (~950ms) before next playback starts
      blind.advance(980);
      now += 980;
    } else {
      notes.roundsFailed += 1;
      // Wait for round_fail pause (~1100ms) before new game playback starts
      blind.advance(1150);
      now += 1150;
    }
  }

  return notes;
}

/**
 * Blind Hot-or-Cold Sonar solver:
 * Samples a 3x3 coarse grid waiting for the first sonar pulse + interval cadence
 * to classify cold/warm/hot/locked without cue leaks, then hill-climbs with
 * shrinking cross steps until locked and lifts to capture.
 */
function solveHuntBlind(blind) {
  const notes = {
    capturesHeard: 0,
    coarseScans: 0,
    refinementSteps: 0,
  };

  const clampPos = (v) => Math.max(0.06, Math.min(0.94, v));

  function classifyType(type) {
    if (type === 'rigid') return 3;
    if (type === 'medium') return 2;
    if (type === 'light') return 1;
    return 0;
  }

  // Wait for up to two pulses to measure actual cadence AND protect against perception confusion
  function measurePoint(x, y) {
    blind.input({ type: 'pointer_move', x: clampPos(x), y: clampPos(y) });
    // Flush the previous scheduled pulse (could be stale at old position) and wait for a fresh cycle
    let p0 = null;
    let waited = 0;
    while (waited < 720) {
      const haps = blind.advance(40);
      waited += 40;
      if (haps.length > 0) {
        p0 = haps[haps.length - 1];
        break;
      }
    }
    if (!p0) return { level: 0, intervalMs: 720, type: 'soft' };

    // Wait for next pulse — interval (p1.t - p0.t) gives ground-truth distance band unaffected by confusion!
    let p1 = null;
    let wait1 = 0;
    while (wait1 < 720) {
      const haps = blind.advance(35);
      wait1 += 35;
      if (haps.length > 0) {
        p1 = haps[haps.length - 1];
        break;
      }
    }
    if (!p1) return { level: classifyType(p0.type), intervalMs: 680, type: p0.type };

    // Sample one more if first interval looks fast, to be certain of current-position band
    let p2 = null;
    const dt1 = p1.t - p0.t;
    if (dt1 <= 400) {
      let wait2 = 0;
      while (wait2 < 420) {
        const haps = blind.advance(30);
        wait2 += 30;
        if (haps.length > 0) {
          p2 = haps[haps.length - 1];
          break;
        }
      }
    }

    const dt = p2 ? p2.t - p1.t : dt1;
    const refType = p2 ? p2.type : p1.type;

    if (dt <= 130) return { level: 3, intervalMs: dt, type: refType };
    if (dt <= 240) return { level: 2, intervalMs: dt, type: refType };
    if (dt <= 410) return { level: 1, intervalMs: dt, type: refType };
    return { level: 0, intervalMs: dt, type: refType };
  }

  const gridCoords = [0.28, 0.5, 0.72];
  let totalTime = 0;

  for (let huntRound = 0; huntRound < 4 && totalTime < 28000; huntRound += 1) {
    let best = { x: 0.28, y: 0.28, level: -1, intervalMs: 999 };
    blind.step({ type: 'pointer_down', x: 0.28, y: 0.28 }, 40);
    totalTime += 40;

    // 1. Coarse 3x3 scan
    let hitHotOrLocked = false;
    for (let yi = 0; yi < gridCoords.length && !hitHotOrLocked; yi += 1) {
      const rowXs = yi % 2 === 0 ? gridCoords : [...gridCoords].reverse();
      for (let xi = 0; xi < rowXs.length; xi += 1) {
        const gx = rowXs[xi];
        const gy = gridCoords[yi];
        notes.coarseScans += 1;
        const tBefore = blind.getBlindHeader().t;
        const m = measurePoint(gx, gy);
        totalTime += blind.getBlindHeader().t - tBefore;

        if (m.level > best.level || (m.level === best.level && m.intervalMs < best.intervalMs)) {
          best = { x: gx, y: gy, level: m.level, intervalMs: m.intervalMs };
        }
        if (m.level >= 2) {
          hitHotOrLocked = true;
          break;
        }
      }
    }

    // 2. Coordinate-wise binary/axis search from best point (resolves X then Y cleanly)
    let locked = best.level === 3;
    let stepSize = best.level >= 2 ? 0.09 : best.level === 1 ? 0.14 : 0.18;
    for (let iter = 0; iter < 5 && !locked && totalTime < 28000; iter += 1) {
      let anyImproved = false;
      for (const axis of ['x', 'y']) {
        if (locked) break;
        for (const dir of [-1, 1]) {
          const cx = axis === 'x' ? clampPos(best.x + dir * stepSize) : best.x;
          const cy = axis === 'y' ? clampPos(best.y + dir * stepSize) : best.y;
          notes.refinementSteps += 1;
          const tBefore = blind.getBlindHeader().t;
          const m = measurePoint(cx, cy);
          totalTime += blind.getBlindHeader().t - tBefore;

          if (m.level === 3) {
            best = { x: cx, y: cy, level: 3, intervalMs: m.intervalMs };
            locked = true;
            anyImproved = true;
            break;
          }
          if (m.level > best.level) {
            best = { x: cx, y: cy, level: m.level, intervalMs: m.intervalMs };
            anyImproved = true;
            break; // greedily follow improved direction along this axis
          }
        }
      }
      if (!anyImproved) {
        stepSize = Math.max(0.05, stepSize * 0.58);
      } else {
        stepSize = Math.max(0.05, stepSize * 0.65);
      }
    }

    // Move to best coordinate and lift to capture
    blind.step({ type: 'pointer_move', x: best.x, y: best.y }, 140);
    totalTime += 140;
    const upRes = blind.step({ type: 'pointer_up' }, 100);
    totalTime += 100;
    if (upRes.haptics.some((h) => isNotificationSuccess(h.type))) {
      notes.capturesHeard += 1;
    }
  }

  return notes;
}

/**
 * Blind Virtual Marble solver:
 * - For `hole`: localizes via corner wall bounces, then performs gentle
 *   serpentine sweeps (`speed < 0.045`) across ~7 rows spaced by 0.22 units,
 *   braking/leveling immediately on `tick`/`light` hole-enter cues to settle for >450ms.
 * - For `ridges` / `pegs`: exercises systematic multi-quadrant tilt explorations.
 */
function solveMarbleBlind(blind, variant) {
  if (variant !== 'hole') {
    const notes = { quadrantsVisited: 4, wallHitsHeard: 0, pulsesFelt: 0 };
    const tilts = [
      [0.65, 0.25],
      [-0.65, 0.4],
      [-0.55, -0.6],
      [0.6, -0.55],
      [0.85, 0.0],
      [-0.85, 0.0],
      [0.0, 0.85],
      [0.0, -0.85],
    ];
    for (const [ax, ay] of tilts) {
      const res = blind.step({ type: 'imu', ax, ay }, 1050, { jitter: true });
      notes.pulsesFelt += res.haptics.length;
      for (const h of res.haptics) {
        if (h.type === 'rigid' || h.type === 'medium') notes.wallHitsHeard += 1;
      }
    }
    blind.step({ type: 'imu', ax: 0, ay: 0 }, 300);
    return notes;
  }

  const notes = {
    scoresHeard: 0,
    pauseChecks: 0,
    wallTurns: 0,
    sweepsCompleted: 0,
  };

  let totalTime = 0;
  const maxTimeMs = 26000;

  // Steady-state speed = ~0.60 * tilt per 25ms frame.
  // So tilt=0.055 -> speed ~0.033 (<0.045 capture threshold!), ~1.32 tray-units/sec (~1.4s per row).
  // 1. Gently settle into top-left corner (-0.92, -0.92) without big bounce
  blind.step({ type: 'imu', ax: -0.25, ay: 0.25 }, 1000);
  blind.step({ type: 'imu', ax: -0.08, ay: 0.08 }, 350);
  blind.step({ type: 'imu', ax: 0, ay: 0 }, 250);
  // Step down slightly into row 0 (y ≈ -0.68)
  blind.step({ type: 'imu', ax: 0, ay: -0.06 }, 250);
  blind.step({ type: 'imu', ax: 0, ay: 0 }, 250);
  totalTime += 2100;

  let dir = 1;
  for (let row = 0; row < 9 && totalTime < maxTimeMs; row += 1) {
    let rowTime = 0;
    const maxRowTime = 1650;
    blind.input({ type: 'imu', ax: dir * 0.055, ay: 0 });

    while (rowTime < maxRowTime && totalTime < maxTimeMs) {
      const haps = blind.advance(75);
      rowTime += 75;
      totalTime += 75;

      const sawHoleClick = haps.some((h) => h.type === 'tick' || h.type === 'light');
      const sawWall = haps.some((h) => h.type === 'soft' || h.type === 'medium' || h.type === 'rigid');

      if (sawHoleClick) {
        // Level out immediately and let gravity well pull marble to center for 550ms
        notes.pauseChecks += 1;
        const settle = blind.step({ type: 'imu', ax: 0, ay: 0 }, 550);
        totalTime += 550;
        if (settle.haptics.some((h) => isNotificationSuccess(h.type))) {
          notes.scoresHeard += 1;
          break;
        }
        blind.input({ type: 'imu', ax: dir * 0.055, ay: 0 });
      } else if (sawWall && rowTime >= 500) {
        notes.wallTurns += 1;
        break;
      }

      if (rowTime % 225 === 0) {
        blind.input({ type: 'imu', ax: dir * 0.055, ay: 0 });
      }
    }

    // Step down ~0.20 units along +Y (negative ay accelerates +Y)
    blind.step({ type: 'imu', ax: 0, ay: -0.055 }, 225);
    blind.step({ type: 'imu', ax: 0, ay: 0 }, 225);
    totalTime += 450;
    dir = -dir;
  }

  notes.sweepsCompleted = 1;
  blind.step({ type: 'imu', ax: 0, ay: 0 }, 200);
  return notes;
}

/**
 * Blind Fidget Sandbox exercise across all 4 variants:
 * - switch: comfortable rhythm clicks + brief fast fidget burst
 * - slider: slow deliberate 12-stop sweep + brisk human flick
 * - bubbles: systematically pops all 12 cells + waits for 260ms reset
 * - breathing: runs full 19.5s 4-7-8 pacer cycle and toggles off cleanly
 */
function solveSandboxBlind(blind, variant) {
  const notes = { variant, actionsPerformed: 0, resetsOrCyclesHeard: 0 };

  if (variant === 'switch') {
    for (let i = 0; i < 10; i += 1) {
      blind.step({ type: 'pointer_down' }, 85, { jitter: true });
      blind.step({ type: 'pointer_up' }, 140, { jitter: true });
      notes.actionsPerformed += 1;
    }
    return notes;
  }

  if (variant === 'slider') {
    // Slow deliberate scrub across 12 stops
    blind.step({ type: 'pointer_down', x: 0.0, y: 0.5 }, 90);
    for (let s = 1; s <= 11; s += 1) {
      blind.step({ type: 'pointer_move', x: s / 11, y: 0.5 }, 90, { jitter: true });
      notes.actionsPerformed += 1;
    }
    blind.step({ type: 'pointer_up' }, 150);

    // Return via dial or deliberate drag back
    blind.step({ type: 'pointer_down', x: 1.0, y: 0.5 }, 90);
    for (let s = 10; s >= 0; s -= 1) {
      blind.step({ type: 'pointer_move', x: s / 11, y: 0.5 }, 85, { jitter: true });
      notes.actionsPerformed += 1;
    }
    blind.step({ type: 'pointer_up' }, 120);
    return notes;
  }

  if (variant === 'bubbles') {
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const x = (col + 0.5) / 4;
        const y = (row + 0.5) / 3;
        blind.step({ type: 'pointer_down', x, y }, 40);
        blind.step({ type: 'pointer_up' }, 70);
        notes.actionsPerformed += 1;
      }
    }
    const waitReset = blind.advance(340);
    if (waitReset.some((h) => isNotificationSuccess(h.type))) {
      notes.resetsOrCyclesHeard += 1;
    }
    return notes;
  }

  if (variant === 'breathing') {
    // Tap to start 4-7-8 breathing cycle
    blind.step({ type: 'pointer_down' }, 45);
    blind.step({ type: 'pointer_up' }, 0);
    notes.actionsPerformed += 1;

    // Run full 19.5s cycle cleanly + settle 150ms before stopping
    blind.advance(19650);
    notes.resetsOrCyclesHeard += 1;

    // Tap to stop pacer cleanly
    blind.step({ type: 'pointer_down' }, 45);
    blind.step({ type: 'pointer_up' }, 120);
    return notes;
  }

  return notes;
}

/**
 * Generic Blind Explorer for any brand-new / custom mode module based solely
 * on its declared `modeDef.inputs` and `blindHeader`.
 */
function solveGenericModeBlind(blind) {
  const header = blind.getBlindHeader();
  const inputs = new Set(header.inputs || []);
  const notes = { modeId: header.id, probesRun: [] };

  if (inputs.has('pointer_down')) {
    notes.probesRun.push('pointer_grid_and_drags');
    // Tap grid points + hold
    for (const y of [0.25, 0.5, 0.75]) {
      for (const x of [0.25, 0.5, 0.75]) {
        blind.step({ type: 'pointer_down', x, y }, 60);
        if (inputs.has('pointer_up')) {
          blind.step({ type: 'pointer_up', x, y }, 120);
        }
      }
    }
    if (inputs.has('pointer_move')) {
      // Slow horizontal drag
      blind.step({ type: 'pointer_down', x: 0.08, y: 0.5 }, 80);
      for (let i = 1; i <= 14; i += 1) {
        blind.step({ type: 'pointer_move', x: 0.08 + (i / 14) * 0.84, y: 0.5 }, 75);
      }
      if (inputs.has('pointer_up')) blind.step({ type: 'pointer_up', x: 0.92, y: 0.5 }, 120);

      // Slow vertical drag
      blind.step({ type: 'pointer_down', x: 0.5, y: 0.08 }, 80);
      for (let i = 1; i <= 10; i += 1) {
        blind.step({ type: 'pointer_move', x: 0.5, y: 0.08 + (i / 10) * 0.84 }, 75);
      }
      if (inputs.has('pointer_up')) blind.step({ type: 'pointer_up', x: 0.5, y: 0.92 }, 120);
    }
  }

  if (inputs.has('dial')) {
    notes.probesRun.push('dial_sweep');
    for (let i = 0; i < 24; i += 1) {
      blind.step({ type: 'dial', deltaSteps: 1 }, 80);
    }
    for (let i = 0; i < 12; i += 1) {
      blind.step({ type: 'dial', deltaSteps: -1 }, 80);
    }
  }

  if (inputs.has('button_down')) {
    notes.probesRun.push('button_presses');
    for (let i = 0; i < 4; i += 1) {
      blind.step({ type: 'button_down' }, 65);
      if (inputs.has('button_up')) blind.step({ type: 'button_up' }, 140);
    }
    // Long press
    blind.step({ type: 'button_down' }, 320);
    if (inputs.has('button_up')) blind.step({ type: 'button_up' }, 140);
  }

  if (inputs.has('imu')) {
    notes.probesRun.push('imu_quadrants');
    const tilts = [
      [0.6, 0.0],
      [0.0, 0.6],
      [-0.6, 0.0],
      [0.0, -0.6],
      [0.0, 0.0],
    ];
    for (const [ax, ay] of tilts) {
      blind.step({ type: 'imu', ax, ay }, 800);
    }
  }

  if (inputs.has('squeeze')) {
    notes.probesRun.push('squeeze_ramp');
    for (const pressure of [0.25, 0.6, 0.95, 0.0]) {
      blind.step({ type: 'squeeze', pressure }, 150);
    }
  }

  blind.advance(400);
  return notes;
}

function runBlindSolver(session, modeDef, variant, profileName, seed) {
  const blind = createBlindFacade(session);

  if (typeof modeDef.blindSolver === 'function') {
    const customNotes = modeDef.blindSolver(blind, { variant, profileName, seed });
    return Object.assign({ usedCustomSolver: true }, customNotes || {});
  }

  switch (modeDef.id) {
    case 'safe':
      return solveSafeBlind(blind, variant, profileName, seed);
    case 'rhythm':
      return solveRhythmBlind(blind, variant, profileName, seed);
    case 'hunt':
      return solveHuntBlind(blind, variant, profileName, seed);
    case 'marble':
      return solveMarbleBlind(blind, variant, profileName, seed);
    case 'sandbox':
      return solveSandboxBlind(blind, variant, profileName, seed);
    default:
      return Object.assign(
        { usedGenericSolver: true },
        solveGenericModeBlind(blind, variant, profileName, seed)
      );
  }
}

// ---------------------------------------------------------------------------
// Realistic Physical Stress & Edge-Case Probes (Still Blind!)
// ---------------------------------------------------------------------------

/**
 * Runs mode-targeted (or generic) realistic human stress probes strictly via
 * the blind facade so the evaluator empirically catches realistic human flaws:
 * - Fast thumb sweep & screen-edge reposition (safe)
 * - Quick 30ms taps & early turn taps (rhythm)
 * - Medium/fast 0.65 pad/sec sweeps across sonar field (hunt)
 * - Fast multi-axis tilt (marble)
 * - Fast slider flicks, rapid switch bursts, and already-popped bubble re-taps (sandbox)
 */
function runRealisticProbes(createProbeSession, modeDef, variant) {
  const probes = [];

  if (modeDef.id === 'safe') {
    // Probe 1: Realistic brisk thumb sweep (22ms/notch)
    const fastSess = createProbeSession('fast_sweep');
    const blindFast = createBlindFacade(fastSess);
    blindFast.step({ type: 'pointer_down', x: 0.04, y: 0.5 }, 40);
    for (let i = 1; i <= 18; i += 1) {
      blindFast.step({ type: 'pointer_move', x: 0.04 + i * 0.05, y: 0.5 }, 22);
    }
    blindFast.step({ type: 'pointer_up' }, 120);
    probes.push({ name: 'fast_sweep', session: fastSess, meta: {} });

    // Probe 2: Lock 1 pin, then simulate hitting screen edge without double-thunk & lifting to reposition
    const edgeSess = createProbeSession('edge_reposition');
    const blindEdge = createBlindFacade(edgeSess);
    let pinLocked = false;
    // Slowly find first pin
    for (let attempt = 0; attempt < 2 && !pinLocked; attempt += 1) {
      blindEdge.step({ type: 'pointer_down', x: 0.04, y: 0.5 }, 60);
      for (let i = 1; i <= 18; i += 1) {
        const res = blindEdge.step({ type: 'pointer_move', x: 0.04 + i * 0.05, y: 0.5 }, 80);
        if (res.haptics.filter((h) => isStrongCluster(h.type)).length >= 2) {
          const up = blindEdge.step({ type: 'pointer_up' }, 200);
          if (up.haptics.some((h) => isNotificationSuccess(h.type))) {
            pinLocked = true;
          }
          break;
        }
      }
      if (!pinLocked) blindEdge.step({ type: 'pointer_up' }, 100);
    }
    // Now drag to the screen edge and intentionally lift away from target (to reposition thumb)
    let edgeLiftTime = null;
    blindEdge.step({ type: 'pointer_down', x: 0.1, y: 0.5 }, 60);
    let lastHadDoubleThunk = false;
    for (let i = 1; i <= 16; i += 1) {
      const res = blindEdge.step({ type: 'pointer_move', x: 0.1 + i * 0.052, y: 0.5 }, 75);
      lastHadDoubleThunk = res.haptics.filter((h) => isStrongCluster(h.type)).length >= 2;
    }
    // If the final edge notch happened to be the tumbler, move back 1 notch so we lift off-target
    if (lastHadDoubleThunk) {
      blindEdge.step({ type: 'pointer_move', x: 0.88, y: 0.5 }, 75);
    }
    edgeLiftTime = blindEdge.getBlindHeader().t;
    blindEdge.step({ type: 'pointer_up' }, 120);
    probes.push({
      name: 'edge_reposition',
      session: edgeSess,
      meta: { edgeLiftTime, hadPinBeforeLift: pinLocked },
    });
  } else if (modeDef.id === 'rhythm') {
    // Probe 1: Quick realistic 30ms taps
    const quickSess = createProbeSession('quick_tap_30ms');
    const blindQuick = createBlindFacade(quickSess);
    blindQuick.step({ type: 'pointer_down' }, 35);
    blindQuick.step({ type: 'pointer_up' }, 0);
    const pulses = [];
    let silence = 0;
    for (let t = 0; t < 6000; t += 40) {
      const haps = blindQuick.advance(40);
      if (haps.length > 0) {
        pulses.push(...haps);
        silence = 0;
      } else if (pulses.length > 0) {
        silence += 40;
        if (silence >= 760) break;
      }
    }
    const decoded = [];
    let i = 0;
    while (i < pulses.length) {
      if (i + 1 < pulses.length && pulses[i + 1].t - pulses[i].t <= 210) {
        decoded.push('DASH');
        i += 2;
      } else {
        decoded.push('DOT');
        i += 1;
      }
    }
    for (const sym of decoded) {
      if (sym === 'DOT') {
        blindQuick.step({ type: 'pointer_down' }, 30);
        blindQuick.step({ type: 'pointer_up' }, 160);
      } else {
        blindQuick.step({ type: 'pointer_down' }, 285);
        blindQuick.step({ type: 'pointer_up' }, 160);
      }
    }
    blindQuick.advance(300);
    probes.push({ name: 'quick_tap_30ms', session: quickSess, meta: {} });

    // Probe 2: Early tap 240ms after beat #3 (testing missing "your turn" cue)
    const earlySess = createProbeSession('early_turn_tap');
    const blindEarly = createBlindFacade(earlySess);
    blindEarly.step({ type: 'pointer_down' }, 35);
    blindEarly.step({ type: 'pointer_up' }, 0);
    let beatsSeen = 0;
    let lastPulseT = -999;
    let earlyTapTime = null;
    for (let t = 0; t < 5000; t += 20) {
      const haps = blindEarly.advance(20);
      for (const h of haps) {
        if (h.t - lastPulseT > 200) {
          beatsSeen += 1;
        }
        lastPulseT = h.t;
      }
      // Beat #3's tail delay is 420ms before playing -> listening; tapping at +240ms hits playing!
      if (beatsSeen >= 3 && blindEarly.getBlindHeader().t - lastPulseT >= 240) {
        earlyTapTime = blindEarly.getBlindHeader().t;
        blindEarly.step({ type: 'pointer_down' }, 45);
        blindEarly.step({ type: 'pointer_up' }, 400);
        break;
      }
    }
    probes.push({ name: 'early_turn_tap', session: earlySess, meta: { earlyTapTime } });
  } else if (modeDef.id === 'hunt') {
    // Medium/fast sonar sweep (~0.65 pad/sec across 4 horizontal lanes)
    const sweepSess = createProbeSession('cold_timer_sweep');
    const blindSweep = createBlindFacade(sweepSess);
    const lanes = [0.22, 0.4, 0.58, 0.76];
    for (let li = 0; li < lanes.length; li += 1) {
      const y = lanes[li];
      const forward = li % 2 === 0;
      const startX = forward ? 0.05 : 0.95;
      blindSweep.step({ type: 'pointer_down', x: startX, y }, 50);
      for (let step = 1; step <= 27; step += 1) {
        const x = forward ? 0.05 + step * (0.9 / 27) : 0.95 - step * (0.9 / 27);
        blindSweep.step({ type: 'pointer_move', x, y }, 50); // 0.0333 / 0.05s = 0.67 pad/sec
      }
      blindSweep.step({ type: 'pointer_up' }, 80);
    }
    probes.push({ name: 'cold_timer_sweep', session: sweepSess, meta: {} });
  } else if (modeDef.id === 'marble') {
    // Brisk full-tilt circular exploration
    const fastTiltSess = createProbeSession('brisk_tilt');
    const blindTilt = createBlindFacade(fastTiltSess);
    for (let step = 0; step < 24; step += 1) {
      const angle = (step / 24) * Math.PI * 2;
      blindTilt.step({ type: 'imu', ax: Math.cos(angle) * 0.9, ay: Math.sin(angle) * 0.9 }, 200);
    }
    blindTilt.step({ type: 'imu', ax: 0, ay: 0 }, 300);
    probes.push({ name: 'brisk_tilt', session: fastTiltSess, meta: {} });
  } else if (modeDef.id === 'sandbox') {
    if (variant === 'switch') {
      const burstSess = createProbeSession('rapid_switch_burst');
      const blindBurst = createBlindFacade(burstSess);
      for (let i = 0; i < 6; i += 1) {
        blindBurst.step({ type: 'pointer_down' }, 30);
        blindBurst.step({ type: 'pointer_up' }, 50);
      }
      probes.push({ name: 'rapid_switch_burst', session: burstSess, meta: {} });
    } else if (variant === 'slider') {
      const flickSess = createProbeSession('fast_slider_flick');
      const blindFlick = createBlindFacade(flickSess);
      blindFlick.step({ type: 'pointer_down', x: 0.0, y: 0.5 }, 20);
      for (let i = 1; i <= 15; i += 1) {
        blindFlick.step({ type: 'pointer_move', x: i / 15, y: 0.5 }, 22);
      }
      blindFlick.step({ type: 'pointer_up' }, 100);
      probes.push({ name: 'fast_slider_flick', session: flickSess, meta: {} });
    } else if (variant === 'bubbles') {
      const retapSess = createProbeSession('retap_popped_bubble');
      const blindRetap = createBlindFacade(retapSess);
      blindRetap.step({ type: 'pointer_down', x: 0.125, y: 0.166 }, 40);
      blindRetap.step({ type: 'pointer_up' }, 80);
      const retapTime = blindRetap.getBlindHeader().t;
      const retapRes = blindRetap.step({ type: 'pointer_down', x: 0.125, y: 0.166 }, 40);
      blindRetap.step({ type: 'pointer_up' }, 80);
      probes.push({
        name: 'retap_popped_bubble',
        session: retapSess,
        meta: { retapTime, retapHapticsCount: retapRes.haptics.length },
      });
    }
  }

  return probes;
}

module.exports = {
  createBlindFacade,
  runRandomBaseline,
  runBlindSolver,
  runRealisticProbes,
};
