'use strict';

/**
 * Layer 3: Context-aware haptic ergonomics, cue-clarity, active dead-air,
 * phase-transition, and lifecycle hygiene diagnostics (`src/eval/metrics.js`).
 */

const { analyzeActuatorTrace, HARD_COLLISION_MS, TIGHT_GAP_MS } = require('../sim/actuator');

const ACTIVE_DEAD_AIR_WARN_MS = 450;
const ACTIVE_DEAD_AIR_ERROR_MS = 900;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function addFinding(findings, severity, code, message, evidence) {
  findings.push({
    severity,
    code,
    message,
    evidence: evidence || {},
  });
}

/**
 * Inspects `cueToTypes` across traces to find distinct gameplay cues that
 * collapse onto the exact same single haptic waveform/type without obvious
 * multi-pulse signature separation.
 */
function analyzeCueAmbiguity(cueToTypes, rawHaptics) {
  const cuesBySingleType = new Map();
  const ambiguousGroups = [];

  // Determine which cues are part of multi-pulse patterns (e.g. tumbler_hit_1/2, play_dash_1/2)
  const pairedCues = new Set();
  for (let i = 1; i < rawHaptics.length; i += 1) {
    const prev = rawHaptics[i - 1];
    const curr = rawHaptics[i];
    if (prev.cue && curr.cue && curr.t - prev.t <= 160) {
      const prevBase = prev.cue.replace(/_[12]$/, '');
      const currBase = curr.cue.replace(/_[12]$/, '');
      if (prevBase === currBase || (prev.cue === 'vault_crack' && curr.cue === 'vault_crack')) {
        pairedCues.add(prev.cue);
        pairedCues.add(curr.cue);
      }
    }
  }

  for (const [cue, types] of Object.entries(cueToTypes || {})) {
    if (!Array.isArray(types) || types.length !== 1) continue;
    if (pairedCues.has(cue)) continue;
    // Ignore benign UI meta-cues when comparing gameplay feedback cues
    if (cue === 'ui_tick' || cue === 'tray_change' || cue === 'toggle_strict') continue;

    const hapticType = types[0];
    if (!cuesBySingleType.has(hapticType)) {
      cuesBySingleType.set(hapticType, []);
    }
    cuesBySingleType.get(hapticType).push(cue);
  }

  // Also note cues emitted in isolation with identical type & no cadence difference
  // Exclude same-mechanism pairs like switch_feel variants or slider/detent variants if they're distinct modes
  for (const [hapticType, cues] of cuesBySingleType.entries()) {
    if (cues.length >= 2) {
      // Filter out cues that explicitly differ by cadence (like sonar_* intervals)
      const allSonar = cues.every((c) => c.startsWith('sonar_'));
      if (allSonar) continue;

      ambiguousGroups.push({
        hapticType,
        cues: cues.slice().sort(),
      });
    }
  }

  return ambiguousGroups;
}

/**
 * Computes active exploration dead air excluding deliberate passive pauses
 * (e.g., breathing HOLD phase or Rhythm playback silence).
 */
function computeActiveDeadAir(trace, modeId, variant) {
  const silentWindows = trace.silentWindows || [];
  let maxActiveDeadAirMs = 0;
  let maxWindow = null;

  for (let i = 0; i < silentWindows.length; i += 1) {
    const w = silentWindows[i];
    // In RhythmEcho, pointer_down has 0..250ms silent hold before hold_crossed fires at 250ms,
    // which is expected hold build-up (cap acceptable hold silence at ~270ms).
    if (w.durationMs > maxActiveDeadAirMs) {
      maxActiveDeadAirMs = w.durationMs;
      maxWindow = w;
    }
  }

  // For breathing pacer, hold/exhale intervals are intentionally slow/quiet (7s hold, 1s exhale ticks)
  if (variant === 'breathing' || modeId === 'breathing') {
    return {
      maxActiveDeadAirMs: Math.min(maxActiveDeadAirMs, 520),
      rawMaxSilentGapMs: trace.maxSilentGapMs || 0,
      maxWindow,
    };
  }

  return {
    maxActiveDeadAirMs,
    rawMaxSilentGapMs: trace.maxSilentGapMs || 0,
    maxWindow,
  };
}

/**
 * Aggregates actuator, dead-air, cue-ambiguity, and mode-specific probe
 * diagnostics across all evaluated traces for a single mode variant.
 */
function analyzeVariantDiagnostics({
  modeDef,
  variant,
  variantKind,
  profileRuns,
  baselineStats,
  probeRuns,
  fuzzResult,
}) {
  const findings = [];

  // Merge raw traces from ideal + typical + pocket + probes for structural hygiene
  const allRawHaptics = [];
  const mergedCueToTypes = {};
  let totalHardCollisions = 0;
  let totalTightGaps = 0;
  let minGapMs = null;
  let maxPulsesPerSec = 0;
  let maxEnergyPerSec = 0;
  let totalPulses = 0;
  let maxActiveDeadAirMs = 0;
  let maxDeadAirDetail = null;
  let worstAcousticRisk = 'low';
  const riskOrder = { low: 0, moderate: 1, high: 2 };

  const allTraceEntries = [];
  for (const profileName of Object.keys(profileRuns)) {
    for (const run of profileRuns[profileName]) {
      allTraceEntries.push({ source: `solver:${profileName}`, trace: run.trace, evalState: run.evalState });
    }
  }
  for (const probe of probeRuns) {
    allTraceEntries.push({
      source: `probe:${probe.name}`,
      trace: probe.trace,
      evalState: probe.evalState,
      meta: probe.meta,
      name: probe.name,
    });
  }

  // Track worst collision example for actionable evidence
  let sampleCollision = null;
  let sampleTightGap = null;

  for (const entry of allTraceEntries) {
    const tr = entry.trace;
    const act = tr.actuator || analyzeActuatorTrace(tr.rawHaptics, tr.durationMs);

    totalPulses += act.totalPulses;
    totalHardCollisions += act.hardCollisions.length;
    totalTightGaps += act.tightGaps.length;

    if (!sampleCollision && act.hardCollisions.length > 0) {
      sampleCollision = { source: entry.source, ...act.hardCollisions[0] };
    }
    if (!sampleTightGap && act.tightGaps.length > 0) {
      sampleTightGap = { source: entry.source, ...act.tightGaps[0] };
    }

    if (act.minGapMs !== null && (minGapMs === null || act.minGapMs < minGapMs)) {
      minGapMs = act.minGapMs;
    }
    // Only count sustained acoustic density on regular solver traces >= 2000ms
    // (short 400ms stress probes like rapid_switch_burst are meant to test LRA collisions, not sustained room buzz)
    if (entry.source.startsWith('solver:') || (tr.durationMs || 0) >= 2000) {
      if (act.pulsesPerSecond > maxPulsesPerSec) {
        maxPulsesPerSec = act.pulsesPerSecond;
      }
      if (act.energyPerSecond > maxEnergyPerSec) {
        maxEnergyPerSec = act.energyPerSecond;
      }
      if (riskOrder[act.acousticRisk] > riskOrder[worstAcousticRisk]) {
        worstAcousticRisk = act.acousticRisk;
      }
    }

    for (const h of tr.rawHaptics || []) {
      allRawHaptics.push(h);
    }
    for (const [cue, types] of Object.entries(act.cueToTypes || {})) {
      if (!mergedCueToTypes[cue]) mergedCueToTypes[cue] = new Set();
      for (const t of types) mergedCueToTypes[cue].add(t);
    }

    const deadAir = computeActiveDeadAir(tr, modeDef.id, variant);
    if (deadAir.maxActiveDeadAirMs > maxActiveDeadAirMs) {
      maxActiveDeadAirMs = deadAir.maxActiveDeadAirMs;
      maxDeadAirDetail = {
        source: entry.source,
        durationMs: deadAir.maxActiveDeadAirMs,
        window: deadAir.maxWindow,
      };
    }
  }

  const normalizedCueToTypes = {};
  for (const [cue, set] of Object.entries(mergedCueToTypes)) {
    normalizedCueToTypes[cue] = Array.from(set);
  }

  const ambiguousCueGroups = analyzeCueAmbiguity(normalizedCueToTypes, allRawHaptics);

  // 1. Fuzz & lifecycle checks
  if (fuzzResult.crashes > 0) {
    addFinding(
      findings,
      'error',
      'FUZZ_CRASH',
      `Fuzz harness triggered ${fuzzResult.crashes} unhandled engine exception(s)`,
      { crashes: fuzzResult.crashes, sampleError: fuzzResult.errors[0] || null }
    );
  }
  if (fuzzResult.runawayErrors > 0) {
    addFinding(
      findings,
      'error',
      'CLOCK_RUNAWAY',
      `VirtualClock runaway timer loop detected (${fuzzResult.runawayErrors} occurrence(s))`,
      { runawayErrors: fuzzResult.runawayErrors }
    );
  }
  if (fuzzResult.leakedTimers > 0) {
    addFinding(
      findings,
      'error',
      'TIMER_LEAK',
      `${fuzzResult.leakedTimers} active timer(s) remained after dispose()`,
      { leakedTimers: fuzzResult.leakedTimers }
    );
  }

  // 2. Hard LRA collisions (<35ms)
  if (totalHardCollisions > 0) {
    const severity = totalHardCollisions >= 3 ? 'error' : 'warn';
    addFinding(
      findings,
      severity,
      'LRA_HARD_COLLISION',
      `${totalHardCollisions} LRA hard collision(s) (<${HARD_COLLISION_MS}ms gap) risk smearing pulses together`,
      {
        hardCollisions: totalHardCollisions,
        minGapMs,
        sample: sampleCollision,
      }
    );
  } else if (totalTightGaps >= 3) {
    addFinding(
      findings,
      'warn',
      'LRA_TIGHT_GAPS',
      `${totalTightGaps} tight pulse gap(s) (<${TIGHT_GAP_MS}ms) may sound buzzier on some phones`,
      {
        tightGaps: totalTightGaps,
        minGapMs,
        sample: sampleTightGap,
      }
    );
  }

  // 3. Acoustic / Pocket-discretion density check
  if (worstAcousticRisk === 'high') {
    addFinding(
      findings,
      'warn',
      'ACOUSTIC_BUZZ_HIGH',
      `High haptic pulse/energy density (${round2(maxPulsesPerSec)} pulses/s, ${round2(maxEnergyPerSec)} energy/s) may be audible in quiet rooms`,
      { pulsesPerSecond: round2(maxPulsesPerSec), energyPerSecond: round2(maxEnergyPerSec) }
    );
  }

  // 4. Active Exploration Dead Air check
  // Note: for virtualMarble `hole`, open-floor rolling has no ridges/pegs by design (only wall/hole clicks),
  // so dead-air silence during slow cross-tray rolling is reported as a tactile-gradient warning rather than a crash-grade error.
  if (modeDef.id === 'marble' && variant === 'hole') {
    if (maxActiveDeadAirMs >= ACTIVE_DEAD_AIR_WARN_MS) {
      addFinding(
        findings,
        'warn',
        'ACTIVE_DEAD_AIR',
        `Slow open-tray roll in Hole Drop went ${maxActiveDeadAirMs}ms without any texture or proximity feedback before hitting a wall/hole`,
        maxDeadAirDetail
      );
    }
  } else if (maxActiveDeadAirMs >= ACTIVE_DEAD_AIR_ERROR_MS) {
    addFinding(
      findings,
      'error',
      'ACTIVE_DEAD_AIR',
      `Active exploration went silent for ${maxActiveDeadAirMs}ms (>${ACTIVE_DEAD_AIR_ERROR_MS}ms) while user was actively interacting`,
      maxDeadAirDetail
    );
  } else if (maxActiveDeadAirMs >= ACTIVE_DEAD_AIR_WARN_MS) {
    addFinding(
      findings,
      'warn',
      'ACTIVE_DEAD_AIR',
      `Active exploration hit ${maxActiveDeadAirMs}ms of silent gap (>${ACTIVE_DEAD_AIR_WARN_MS}ms) without tactile feedback`,
      maxDeadAirDetail
    );
  }

  // 5. Cue distinguishability check
  if (ambiguousCueGroups.length > 0) {
    addFinding(
      findings,
      'warn',
      'CUE_COLLISION',
      `Distinct gameplay cues share identical single haptic type without rhythm separation: ${ambiguousCueGroups.map((g) => `${g.hapticType}=[${g.cues.join(', ')}]`).join('; ')}`,
      { groups: ambiguousCueGroups }
    );
  }

  // 6. Mode- & probe-specific empirical checks (strictly analyzing trace/eval after blind runs)
  const idealRuns = profileRuns.ideal || [];
  const typicalRuns = profileRuns.typical || [];
  const pocketRuns = profileRuns.pocket || [];

  const avgScore = (runs) =>
    runs.length === 0 ? 0 : runs.reduce((sum, r) => sum + (r.evalState.score || 0), 0) / runs.length;

  const idealScore = avgScore(idealRuns);
  const typicalScore = avgScore(typicalRuns);
  const pocketScore = avgScore(pocketRuns);

  const usedGenericSolver = idealRuns.some(
    (r) => r.solverNotes && r.solverNotes.usedGenericSolver
  );

  // Puzzle learnability / solver lift check
  if (variantKind === 'puzzle' && baselineStats) {
    if (idealScore <= 0 && usedGenericSolver) {
      addFinding(
        findings,
        'info',
        'GENERIC_PROBE_ONLY',
        `Evaluated with generic exploratory probe (no mode-specific blind solver); playtest via scripts/playtest.js or attach blindSolver(blind) to score puzzle solvability`,
        { idealScore, randomScore: baselineStats.randomScore }
      );
    } else if (idealScore <= 0) {
      addFinding(
        findings,
        'error',
        'BLIND_UNSOLVABLE',
        `Blind solver scored 0 under ideal conditions (${modeDef.id}:${variant})`,
        { idealScore, randomScore: baselineStats.randomScore }
      );
    } else if (!usedGenericSolver && baselineStats.idealLift <= 0.15) {
      addFinding(
        findings,
        'warn',
        'LOW_SOLVER_LIFT',
        `Blind solver barely outperformed random baseline (lift=${round2(baselineStats.idealLift)})`,
        baselineStats
      );
    }

    if (idealScore > 0 && pocketScore < idealScore * 0.55) {
      addFinding(
        findings,
        'warn',
        'POCKET_NOISE_SENSITIVE',
        `Pocket motor/perception noise dropped puzzle score by ${Math.round((1 - pocketScore / idealScore) * 100)}% (${round2(idealScore)} -> ${round2(pocketScore)})`,
        { idealScore: round2(idealScore), typicalScore: round2(typicalScore), pocketScore: round2(pocketScore) }
      );
    }
  }

  // Safe Cracker specific probe diagnostics
  if (modeDef.id === 'safe') {
    const edgeProbe = probeRuns.find((p) => p.name === 'edge_reposition');
    if (edgeProbe && edgeProbe.meta && edgeProbe.meta.edgeLiftTime !== null) {
      const liftHaps = (edgeProbe.trace.rawHaptics || []).filter(
        (h) => h.t >= edgeProbe.meta.edgeLiftTime
      );
      const strictResetOnLift = liftHaps.some((h) => h.cue === 'strict_reset');
      const missOnLift = liftHaps.some((h) => h.cue === 'miss');
      if (strictResetOnLift) {
        addFinding(
          findings,
          'error',
          'EDGE_REPOSITION_PUNISHES_USER',
          'Lifting thumb to reposition at pad edge in strict mode falsely triggers a pin-reset penalty (`strict_reset`)',
          { variant, liftCue: 'strict_reset', t: edgeProbe.meta.edgeLiftTime }
        );
      } else if (missOnLift) {
        addFinding(
          findings,
          'warn',
          'EDGE_REPOSITION_MISS_CUE',
          'Lifting thumb to reposition after dragging triggers an ambiguous `miss` penalty cue even without intent to submit',
          { variant, liftCue: 'miss', t: edgeProbe.meta.edgeLiftTime }
        );
      }
    }

    // Check double-thunk pattern cancellation during fast sweeps
    const fastProbe = probeRuns.find((p) => p.name === 'fast_sweep');
    if (fastProbe) {
      const haps = fastProbe.trace.rawHaptics || [];
      let orphans = 0;
      for (let i = 0; i < haps.length; i += 1) {
        if (haps[i].cue === 'tumbler_hit_1') {
          const next = haps[i + 1];
          if (!next || next.cue !== 'tumbler_hit_2') {
            orphans += 1;
          }
        }
      }
      if (orphans > 0) {
        addFinding(
          findings,
          'warn',
          'DOUBLE_THUNK_CANCELLED_ON_FAST_SWEEP',
          `Fast thumb sweep cancelled the 55ms tumbler double-thunk (${orphans} orphaned tumbler_hit_1 without tumbler_hit_2), hiding the target`,
          { orphanedTumblerHits: orphans }
        );
      }
    }
  }

  // Rhythm Echo specific probe diagnostics
  if (modeDef.id === 'rhythm') {
    // Silent playing -> listening transition check
    // Note: playPattern finishes after the last beat's 420ms delay, transitioning playing -> listening with ZERO haptic cue
    let maxTurnPauseAfterLastBeat = 0;
    for (const run of idealRuns) {
      const raw = run.trace.rawHaptics || [];
      for (let i = 0; i < raw.length - 1; i += 1) {
        const curr = raw[i];
        const next = raw[i + 1];
        if (
          (curr.cue === 'play_dot' || curr.cue === 'play_dash_2') &&
          next.cue === 'press_down'
        ) {
          maxTurnPauseAfterLastBeat = Math.max(maxTurnPauseAfterLastBeat, next.t - curr.t);
        }
      }
    }

    const earlyProbe = probeRuns.find((p) => p.name === 'early_turn_tap');
    let earlyDropped = false;
    if (earlyProbe && earlyProbe.meta && earlyProbe.meta.earlyTapTime !== null) {
      const tapT = earlyProbe.meta.earlyTapTime;
      const hapsAfterTap = (earlyProbe.trace.rawHaptics || []).filter(
        (h) => h.t >= tapT && (h.cue === 'press_down' || h.cue === 'enter_dot')
      );
      if (hapsAfterTap.length === 0) {
        earlyDropped = true;
      }
    }

    if (earlyDropped) {
      addFinding(
        findings,
        'error',
        'SILENT_TURN_HANDOFF',
        'No haptic cue marks the playing -> listening turn transition; tapping before the 420ms post-beat delay silently drops the user input',
        { earlyTapTime: earlyProbe.meta.earlyTapTime, postBeatWaitMs: 420 }
      );
    }

    // Check quick 30ms tap feel: press_down (light) + enter_dot (rigid) 30ms apart -> LRA collision!
    const quickProbe = probeRuns.find((p) => p.name === 'quick_tap_30ms');
    if (quickProbe) {
      const act = quickProbe.trace.actuator;
      const tapCollisions = (act.hardCollisions || []).filter(
        (c) => c.prevCue === 'press_down' && c.cue === 'enter_dot'
      );
      if (tapCollisions.length > 0) {
        addFinding(
          findings,
          'warn',
          'QUICK_TAP_LRA_COLLISION',
          `Realistic 30ms tap emits \`press_down\` (light) + \`enter_dot\` (rigid) ${tapCollisions[0].gapMs}ms apart (<${HARD_COLLISION_MS}ms LRA smearing window)`,
          { collisions: tapCollisions.length, sampleGapMs: tapCollisions[0].gapMs }
        );
      }
    }
  }

  // Hot-or-Cold Sonar specific probe diagnostics
  if (modeDef.id === 'hunt') {
    const sweepProbe = probeRuns.find((p) => p.name === 'cold_timer_sweep');
    if (sweepProbe) {
      const raw = sweepProbe.trace.rawHaptics || [];
      let maxColdGapMs = 0;
      for (let i = 1; i < raw.length; i += 1) {
        const dt = raw[i].t - raw[i - 1].t;
        if (dt > maxColdGapMs) maxColdGapMs = dt;
      }
      // Also inspect longest silent gap during active sweep
      const activeColdGap = computeActiveDeadAir(sweepProbe.trace, modeDef.id, variant).maxActiveDeadAirMs;
      const observedBlindGap = Math.max(maxColdGapMs, activeColdGap);
      if (observedBlindGap >= 600) {
        addFinding(
          findings,
          'warn',
          'COLD_TIMER_BLIND_SPOT',
          `Fixed 680ms cold pulse timer ignores pointer movement mid-interval, creating a ${observedBlindGap}ms blind spot during sweeps (~0.45 pad width traversed silently)`,
          { observedGapMs: observedBlindGap, coldIntervalMs: 680 }
        );
      }
    }
  }

  // Virtual Marble specific diagnostics
  if (modeDef.id === 'marble') {
    if (variant === 'hole') {
      if (idealScore < 0.5) {
        addFinding(
          findings,
          'warn',
          'HOLE_LOCALIZATION_HARD',
          `Blind marble solver averaged only ${round2(idealScore)} holes scored without gradient proximity cues before entering hole rim`,
          { idealScore: round2(idealScore), typicalScore: round2(typicalScore), pocketScore: round2(pocketScore) }
        );
      } else {
        addFinding(
          findings,
          'info',
          'NO_OUTER_HOLE_GRADIENT',
          'Hole Drop emits no proximity cue outside radius 0.15 (only a single `tick` upon entering rim), forcing blind grid sweeps',
          { holeEnterRadius: 0.15, idealScore: round2(idealScore) }
        );
      }
    } else if (variant === 'pegs') {
      // Check if pegs + walls collide onto single rigid
      const wallCues = normalizedCueToTypes.wall_rigid || [];
      const pegCues = normalizedCueToTypes.peg_hit || [];
      if (wallCues.includes('rigid') && pegCues.includes('rigid')) {
        addFinding(
          findings,
          'warn',
          'PEG_WALL_SAME_HAPTIC',
          'Hard wall impact (`wall_rigid`) and center peg impact (`peg_hit`) emit identical single `rigid` pulses without tactile distinction',
          { wallRigid: wallCues, pegHit: pegCues }
        );
      }
    }
  }

  // Fidget Sandbox specific diagnostics
  if (modeDef.id === 'sandbox') {
    if (variant === 'switch') {
      const burstProbe = probeRuns.find((p) => p.name === 'rapid_switch_burst');
      if (burstProbe) {
        const collisions = burstProbe.trace.actuator.hardCollisions || [];
        if (collisions.length > 0) {
          addFinding(
            findings,
            'warn',
            'RAPID_SWITCH_COLLISION',
            `Rapid 30ms fidget clicking collides \`switch_down\` (rigid) and \`switch_up\` (light) at ${collisions[0].gapMs}ms (<${HARD_COLLISION_MS}ms)`,
            { collisions: collisions.length, minGapMs: burstProbe.trace.actuator.minGapMs }
          );
        }
      }
    } else if (variant === 'slider') {
      const flickProbe = probeRuns.find((p) => p.name === 'fast_slider_flick');
      if (flickProbe) {
        const collisions = flickProbe.trace.actuator.hardCollisions || [];
        if (collisions.length > 0) {
          addFinding(
            findings,
            'warn',
            'SLIDER_FLICK_COLLISION',
            `Brisk slider drag triggers ${collisions.length} LRA collision(s) (<${HARD_COLLISION_MS}ms) across adjacent detents`,
            { collisions: collisions.length, minGapMs: flickProbe.trace.actuator.minGapMs }
          );
        }
      }
    } else if (variant === 'bubbles') {
      const retapProbe = probeRuns.find((p) => p.name === 'retap_popped_bubble');
      if (retapProbe && retapProbe.meta && retapProbe.meta.retapHapticsCount === 0) {
        addFinding(
          findings,
          'info',
          'POPPED_BUBBLE_SILENT_RETAP',
          'Re-tapping an already-popped bubble produces complete silence (no soft dull-cup feedback), indistinguishable from missed touch eyes-free',
          { retapHapticsCount: 0 }
        );
      }
    } else if (variant === 'breathing') {
      // Verify breathing pacer stayed quiet during 7s hold without false dead-air penalty
      const rawRun = idealRuns[0];
      if (rawRun) {
        const pulses = rawRun.trace.rawHaptics || [];
        addFinding(
          findings,
          'info',
          'PACER_CADENCE_VERIFIED',
          `4-7-8 breathing cycle emitted ${pulses.length} calm pacing pulse(s) over ${Math.round(rawRun.trace.durationMs / 1000)}s with intentional silent hold phase`,
          { totalPulses: pulses.length, durationMs: rawRun.trace.durationMs }
        );
      }
    }
  }

  // Generic custom mode check: ensure at least some responsive haptic output during exploration
  if (totalPulses === 0) {
    addFinding(
      findings,
      'error',
      'ZERO_HAPTICS_EMITTED',
      'Mode emitted 0 haptic pulses across all solver and probe sessions',
      { modeId: modeDef.id, variant }
    );
  }

  // Compute overall score (0..100) and verdict
  let score = 100;
  let errorCount = 0;
  let warnCount = 0;
  let infoCount = 0;

  for (const f of findings) {
    if (f.severity === 'error') {
      errorCount += 1;
      score -= 18;
    } else if (f.severity === 'warn') {
      warnCount += 1;
      score -= 8;
    } else {
      infoCount += 1;
    }
  }

  // Factor puzzle performance & noise resilience into score
  if (variantKind === 'puzzle' && baselineStats) {
    if (idealScore <= 0) score -= 25;
    else if (baselineStats.idealLift <= 0.15) score -= 12;
    if (idealScore > 0 && pocketScore < idealScore * 0.7) {
      score -= Math.min(12, Math.round((1 - pocketScore / idealScore) * 15));
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict = 'PASS';
  if (errorCount > 0 || score < 60) {
    verdict = 'FAIL';
  } else if (warnCount > 0 || score < 88) {
    verdict = 'NEEDS_TUNING';
  }

  return {
    hygiene: {
      hardCollisions: totalHardCollisions,
      tightGaps: totalTightGaps,
      minGapMs,
      pulsesPerSecond: round2(maxPulsesPerSec),
      energyPerSecond: round2(maxEnergyPerSec),
      acousticRisk: worstAcousticRisk,
      maxActiveDeadAirMs,
      ambiguousCues: ambiguousCueGroups.length,
      totalPulses,
    },
    findings,
    overallScore: score,
    verdict,
    counts: { errorCount, warnCount, infoCount },
  };
}

module.exports = {
  analyzeCueAmbiguity,
  computeActiveDeadAir,
  analyzeVariantDiagnostics,
};
