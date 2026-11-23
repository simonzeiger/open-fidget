'use strict';

/**
 * Layer 3: Orchestrator running multi-seed, multi-profile blind evaluations,
 * random baselines, physical stress probes, and adversarial fuzzing.
 */

const registry = require('../engine/registry');
const { createSession } = require('../sim/runner');
const { createRng } = require('../sim/rng');
const {
  runRandomBaseline,
  runBlindSolver,
  runRealisticProbes,
} = require('./solvers');
const { analyzeVariantDiagnostics } = require('./metrics');

const DEFAULT_PROFILES = ['ideal', 'typical', 'pocket'];

function round2(n) {
  return Math.round(n * 100) / 100;
}

function resolveVariants(modeDef, requestedVariant) {
  if (requestedVariant !== undefined && requestedVariant !== null) {
    return [requestedVariant];
  }
  if (Array.isArray(modeDef.variants) && modeDef.variants.length > 0) {
    return modeDef.variants.map((v) =>
      typeof v === 'string' ? v : v && v.id ? v.id : 'default'
    );
  }
  return ['default'];
}

function resolveVariantKind(modeDef, variant) {
  if (modeDef.variantKinds && modeDef.variantKinds[variant]) {
    return modeDef.variantKinds[variant];
  }
  return modeDef.kind || 'puzzle';
}

function summarizeProfileRuns(runs, modeDef, variantKind) {
  if (runs.length === 0) {
    return {
      runs: 0,
      avgScore: 0,
      avgProgress: 0,
      successRate: 0,
      avgPulses: 0,
      avgDurationMs: 0,
      maxActiveDeadAirMs: 0,
    };
  }

  let sumScore = 0;
  let sumProgress = 0;
  let successes = 0;
  let sumPulses = 0;
  let sumDuration = 0;
  let maxDeadAir = 0;

  for (const r of runs) {
    const score = Number.isFinite(r.evalState.score) ? r.evalState.score : 0;
    const progress = Number.isFinite(r.evalState.progress) ? r.evalState.progress : score;
    sumScore += score;
    sumProgress += progress;

    if (variantKind === 'puzzle') {
      if (score > 0) successes += 1;
    } else if (progress > 0 || (r.trace.rawHaptics && r.trace.rawHaptics.length > 0)) {
      successes += 1;
    }

    sumPulses += (r.trace.rawHaptics || []).length;
    sumDuration += r.trace.durationMs || 0;
    if ((r.trace.maxSilentGapMs || 0) > maxDeadAir) {
      maxDeadAir = r.trace.maxSilentGapMs;
    }
  }

  return {
    runs: runs.length,
    avgScore: round2(sumScore / runs.length),
    avgProgress: round2(sumProgress / runs.length),
    successRate: round2(successes / runs.length),
    avgPulses: round2(sumPulses / runs.length),
    avgDurationMs: Math.round(sumDuration / runs.length),
    maxActiveDeadAirMs: maxDeadAir,
  };
}

/**
 * Fuzzes an engine instance with rapid, out-of-order, out-of-bounds, cancel,
 * resize, and clock-interleaved inputs, then verifies clean `dispose()` with zero leaked timers.
 */
function runFuzzTest(modeDef, variant, steps = 200, seed = 9001) {
  const rng = createRng(seed);
  const session = createSession(modeDef, {
    variant,
    seed,
    humanProfile: 'pocket',
  });
  const inputs = modeDef.inputs || ['pointer_down', 'pointer_move', 'pointer_up'];

  let crashes = 0;
  let runawayErrors = 0;
  const errors = [];

  for (let i = 0; i < steps; i += 1) {
    const typeChoice = rng();
    let event;

    if (typeChoice < 0.08) {
      // Malformed / unexpected / boundary values
      const badKind = Math.floor(rng() * 4);
      if (badKind === 0) event = { type: 'pointer_cancel' };
      else if (badKind === 1) event = { type: 'pointer_move', x: NaN, y: Infinity };
      else if (badKind === 2) event = { type: 'resize', widthPx: -10, heightPx: 0 };
      else event = { type: 'unknown_event', value: 42 };
    } else {
      const pick = inputs[Math.floor(rng() * inputs.length)];
      switch (pick) {
        case 'pointer_down':
        case 'pointer_move':
        case 'pointer_up':
          event = {
            type: pick,
            x: rng() * 1.4 - 0.2,
            y: rng() * 1.4 - 0.2,
          };
          break;
        case 'pointer_cancel':
          event = { type: 'pointer_cancel' };
          break;
        case 'button_down':
        case 'button_up':
          event = { type: pick };
          break;
        case 'dial':
          event = { type: 'dial', deltaSteps: Math.floor((rng() - 0.5) * 14) };
          break;
        case 'imu':
          event = { type: 'imu', ax: (rng() - 0.5) * 4, ay: (rng() - 0.5) * 4 };
          break;
        case 'squeeze':
          event = { type: 'squeeze', pressure: rng() * 1.5 - 0.25 };
          break;
        case 'resize':
          event = { type: 'resize', widthPx: 200 + rng() * 300, heightPx: 250 + rng() * 400 };
          break;
        case 'action':
          event = { type: 'action', name: 'fuzz_noop', value: rng() };
          break;
        default:
          event = { type: pick };
      }
    }

    try {
      session.input(event);
      if (rng() < 0.75) {
        const dt = Math.floor(rng() * 140);
        session.advance(dt);
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (msg.includes('runaway guard')) {
        runawayErrors += 1;
      } else {
        crashes += 1;
      }
      if (errors.length < 5) {
        errors.push(msg);
      }
    }
  }

  let leakedTimers = 0;
  try {
    const disposed = session.dispose();
    leakedTimers = disposed.leakedTimers || 0;
  } catch (err) {
    crashes += 1;
    errors.push(err && err.message ? err.message : String(err));
  }

  return {
    steps,
    crashes,
    leakedTimers,
    runawayErrors,
    errors,
  };
}

function evaluateVariant(modeDef, variant, options) {
  const seedsCount = Number.isInteger(options.seeds) && options.seeds > 0 ? options.seeds : 8;
  const profiles = Array.isArray(options.profiles) && options.profiles.length > 0
    ? options.profiles
    : DEFAULT_PROFILES;
  const fuzzSteps = Number.isInteger(options.fuzzSteps) && options.fuzzSteps >= 0 ? options.fuzzSteps : 200;

  const variantKind = resolveVariantKind(modeDef, variant);

  // 1. Run blind solver across all profiles and seeds
  const profileRuns = {};
  const profileSummaries = {};

  for (const profileName of profiles) {
    const runs = [];
    for (let s = 1; s <= seedsCount; s += 1) {
      const session = createSession(modeDef, {
        variant,
        seed: s,
        humanProfile: profileName,
      });
      let solverNotes = null;
      let evalState = {};
      let trace = {};
      try {
        solverNotes = runBlindSolver(session, modeDef, variant, profileName, s);
        evalState = session.getEvalState();
        trace = session.getRawTrace();
      } finally {
        const disp = session.dispose();
        if (disp.leakedTimers > 0) {
          trace._leakedTimers = disp.leakedTimers;
        }
      }
      runs.push({ seed: s, solverNotes, evalState, trace });
    }
    profileRuns[profileName] = runs;
    profileSummaries[profileName] = summarizeProfileRuns(runs, modeDef, variantKind);
  }

  // 2. Run random baseline across seeds (for puzzle lift calculation; also useful sanity check)
  let baselineStats = null;
  if (variantKind === 'puzzle') {
    const randomScores = [];
    for (let s = 1; s <= seedsCount; s += 1) {
      const session = createSession(modeDef, {
        variant,
        seed: s,
        humanProfile: 'typical',
      });
      try {
        runRandomBaseline(session, modeDef, variant, s);
        const st = session.getEvalState();
        randomScores.push(Number.isFinite(st.score) ? st.score : 0);
      } finally {
        session.dispose();
      }
    }
    const randomScore =
      randomScores.length > 0
        ? round2(randomScores.reduce((a, b) => a + b, 0) / randomScores.length)
        : 0;
    const idealAvg = profileSummaries.ideal ? profileSummaries.ideal.avgScore : 0;
    const typicalAvg = profileSummaries.typical ? profileSummaries.typical.avgScore : 0;
    const pocketAvg = profileSummaries.pocket ? profileSummaries.pocket.avgScore : 0;

    baselineStats = {
      randomScore,
      idealLift: round2(idealAvg - randomScore),
      typicalLift: round2(typicalAvg - randomScore),
      pocketLift: round2(pocketAvg - randomScore),
    };
  }

  // 3. Run realistic human edge-case / physical stress probes
  const rawProbes = runRealisticProbes(
    (probeName) =>
      createSession(modeDef, {
        variant,
        seed: probeName === 'early_turn_tap' ? 2 : 3,
        humanProfile: 'typical',
      }),
    modeDef,
    variant
  );

  const probeRuns = [];
  for (const probe of rawProbes) {
    try {
      const evalState = probe.session.getEvalState();
      const trace = probe.session.getRawTrace();
      probeRuns.push({
        name: probe.name,
        meta: probe.meta,
        evalState,
        trace,
      });
    } finally {
      probe.session.dispose();
    }
  }

  // 4. Fuzz & timer leak check
  const fuzz = runFuzzTest(modeDef, variant, fuzzSteps, 9001 + seedsCount);

  // 5. Aggregate metrics & diagnostics
  const diag = analyzeVariantDiagnostics({
    modeDef,
    variant,
    variantKind,
    profileRuns,
    baselineStats,
    probeRuns,
    fuzzResult: fuzz,
  });

  // Include leaked timers from solver sessions if any occurred
  for (const profileName of Object.keys(profileRuns)) {
    for (const r of profileRuns[profileName]) {
      if (r.trace && r.trace._leakedTimers) {
        fuzz.leakedTimers += r.trace._leakedTimers;
      }
    }
  }

  const result = {
    variant,
    variantKind,
    verdict: diag.verdict,
    overallScore: diag.overallScore,
    profiles: profileSummaries,
    baseline: baselineStats,
    hygiene: diag.hygiene,
    fuzz: {
      steps: fuzz.steps,
      crashes: fuzz.crashes,
      leakedTimers: fuzz.leakedTimers,
      runawayErrors: fuzz.runawayErrors,
    },
    findings: diag.findings,
  };

  return { result, counts: diag.counts };
}

function evaluateMode(modeDef, options = {}) {
  const opts = options || {};
  const variants = resolveVariants(modeDef, opts.variant);
  const results = [];

  let totalScore = 0;
  let errorCount = 0;
  let warnCount = 0;
  let infoCount = 0;
  let hasFail = false;
  let hasTune = false;

  for (const variant of variants) {
    const { result, counts } = evaluateVariant(modeDef, variant, opts);
    results.push(result);
    totalScore += result.overallScore;
    errorCount += counts.errorCount;
    warnCount += counts.warnCount;
    infoCount += counts.infoCount;
    if (result.verdict === 'FAIL') hasFail = true;
    else if (result.verdict === 'NEEDS_TUNING') hasTune = true;
  }

  const overallScore =
    results.length > 0 ? Math.round(totalScore / results.length) : 0;
  const verdict = hasFail ? 'FAIL' : hasTune ? 'NEEDS_TUNING' : 'PASS';

  return {
    mode: {
      id: modeDef.id,
      name: modeDef.name,
      kind: modeDef.kind,
      variants,
    },
    results,
    summary: {
      verdict,
      overallScore,
      errorCount,
      warnCount,
      infoCount,
    },
  };
}

function evaluateAll(options = {}) {
  const modes = [];
  let totalVariants = 0;
  let passCount = 0;
  let tuneCount = 0;
  let failCount = 0;

  for (const modeDef of registry.MODE_LIST) {
    const evalResult = evaluateMode(modeDef, options);
    modes.push(evalResult);
    for (const r of evalResult.results) {
      totalVariants += 1;
      if (r.verdict === 'PASS') passCount += 1;
      else if (r.verdict === 'NEEDS_TUNING') tuneCount += 1;
      else failCount += 1;
    }
  }

  return {
    modes,
    summary: {
      totalVariants,
      passCount,
      tuneCount,
      failCount,
    },
  };
}

module.exports = {
  evaluateMode,
  evaluateAll,
};
