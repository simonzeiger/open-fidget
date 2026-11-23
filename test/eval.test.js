'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { getMode } = require('../src/engine/registry');
const { resolveMode } = require('../scripts/loadMode');
const { evaluateMode } = require('../src/eval/evaluate');
const { runRealisticProbes } = require('../src/eval/solvers');
const { createSession } = require('../src/sim/runner');
const { formatReport, formatAllReports } = require('../src/eval/reporter');

const ROOT_DIR = path.resolve(__dirname, '..');
const VALIDATE_SCRIPT = path.join(ROOT_DIR, 'scripts', 'validate.js');
const PLAYTEST_SCRIPT = path.join(ROOT_DIR, 'scripts', 'playtest.js');
const TEMPLATE_PATH = path.join(ROOT_DIR, 'src', 'engine', '_template.js');

const FORBIDDEN_BLIND_KEYS = new Set(['cue', 'target', 'beacon', 'finalEvalState']);

function assertReportSchema(report, expectedId) {
  assert.ok(report && typeof report === 'object');
  assert.ok(report.mode && typeof report.mode === 'object');
  assert.equal(report.mode.id, expectedId);
  assert.equal(typeof report.mode.name, 'string');
  assert.equal(typeof report.mode.kind, 'string');
  assert.ok(Array.isArray(report.mode.variants) && report.mode.variants.length > 0);

  assert.ok(Array.isArray(report.results));
  assert.equal(report.results.length, report.mode.variants.length);

  assert.ok(report.summary && typeof report.summary === 'object');
  assert.ok(['PASS', 'NEEDS_TUNING', 'FAIL'].includes(report.summary.verdict));
  assert.equal(typeof report.summary.overallScore, 'number');
  assert.ok(report.summary.overallScore >= 0 && report.summary.overallScore <= 100);
  assert.equal(typeof report.summary.errorCount, 'number');
  assert.equal(typeof report.summary.warnCount, 'number');
  assert.equal(typeof report.summary.infoCount, 'number');

  for (const r of report.results) {
    assert.equal(typeof r.variant, 'string');
    assert.equal(typeof r.variantKind, 'string');
    assert.ok(['PASS', 'NEEDS_TUNING', 'FAIL'].includes(r.verdict));
    assert.equal(typeof r.overallScore, 'number');
    assert.ok(r.profiles && typeof r.profiles === 'object');
    assert.ok(r.hygiene && typeof r.hygiene === 'object');
    assert.ok(r.fuzz && typeof r.fuzz === 'object');
    assert.ok(Array.isArray(r.findings));

    assert.equal(r.fuzz.crashes, 0, `${expectedId}:${r.variant} had fuzz crashes`);
    assert.equal(r.fuzz.runawayErrors, 0, `${expectedId}:${r.variant} had runaway errors`);
    assert.equal(r.fuzz.leakedTimers, 0, `${expectedId}:${r.variant} leaked timers`);
  }
}

function assertNoForbiddenKeys(value, contextLabel) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertNoForbiddenKeys(value[i], `${contextLabel}[${i}]`);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      assert.equal(
        FORBIDDEN_BLIND_KEYS.has(key),
        false,
        `Forbidden key "${key}" leaked in ${contextLabel}`
      );
      assertNoForbiddenKeys(value[key], `${contextLabel}.${key}`);
    }
  }
}

function runCli(scriptPath, args, stdinText) {
  const res = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    input: stdinText,
  });
  assert.equal(res.error, undefined, res.error ? res.error.message : undefined);
  return res;
}

test('evaluateMode validates all 5 v0 modes with zero crashes/leaks and detects known findings', () => {
  const reportsById = {};
  for (const modeId of ['safe', 'hunt', 'rhythm', 'marble', 'sandbox']) {
    const modeDef = getMode(modeId);
    assert.ok(modeDef, `Expected registered mode "${modeId}"`);

    const report = evaluateMode(modeDef, { seeds: 2 });
    assertReportSchema(report, modeId);
    reportsById[modeId] = report;
  }

  const safeStrictFindings = reportsById.safe.results
    .find((r) => r.variant === 'strict')
    .findings.map((f) => f.code);
  assert.ok(
    safeStrictFindings.includes('EDGE_REPOSITION_PUNISHES_USER'),
    `Expected safe:strict to report EDGE_REPOSITION_PUNISHES_USER, got ${safeStrictFindings.join(', ')}`
  );
  assert.ok(
    safeStrictFindings.includes('DOUBLE_THUNK_CANCELLED_ON_FAST_SWEEP'),
    `Expected safe:strict to report DOUBLE_THUNK_CANCELLED_ON_FAST_SWEEP, got ${safeStrictFindings.join(', ')}`
  );

  const huntFindings = reportsById.hunt.results[0].findings.map((f) => f.code);
  assert.ok(
    huntFindings.includes('COLD_TIMER_BLIND_SPOT'),
    `Expected hunt to report COLD_TIMER_BLIND_SPOT, got ${huntFindings.join(', ')}`
  );

  const rhythmFindings = reportsById.rhythm.results[0].findings.map((f) => f.code);
  assert.ok(
    rhythmFindings.includes('SILENT_TURN_HANDOFF'),
    `Expected rhythm to report SILENT_TURN_HANDOFF, got ${rhythmFindings.join(', ')}`
  );

  const marblePegs = reportsById.marble.results.find((r) => r.variant === 'pegs');
  assert.ok(marblePegs, 'Expected marble:pegs result');
  const pegFindings = marblePegs.findings.map((f) => f.code);
  assert.ok(
    pegFindings.includes('PEG_WALL_SAME_HAPTIC'),
    `Expected marble:pegs to report PEG_WALL_SAME_HAPTIC, got ${pegFindings.join(', ')}`
  );

  // Verify reporter formatting on single and multi-mode reports
  const huntText = formatReport(reportsById.hunt);
  assert.ok(huntText.includes('Hot-or-Cold Sonar'));
  assert.ok(huntText.includes('COLD_TIMER_BLIND_SPOT'));

  const allModes = Object.values(reportsById);
  const summary = {
    totalVariants: allModes.reduce((n, m) => n + m.results.length, 0),
    passCount: allModes.flatMap((m) => m.results).filter((r) => r.verdict === 'PASS').length,
    tuneCount: allModes.flatMap((m) => m.results).filter((r) => r.verdict === 'NEEDS_TUNING').length,
    failCount: allModes.flatMap((m) => m.results).filter((r) => r.verdict === 'FAIL').length,
  };
  const allText = formatAllReports({ modes: allModes, summary });
  assert.ok(allText.includes('EXECUTIVE REPORT'));
  assert.ok(allText.includes('marble:pegs'));
});

test('evaluateMode and runRealisticProbes run generic stress probes cleanly on custom mode ./src/engine/_template.js', () => {
  const templateMode = resolveMode('./src/engine/_template.js');
  const report = evaluateMode(templateMode, { seeds: 2 });

  assertReportSchema(report, 'pulse-catch');
  const result = report.results[0];
  const codes = result.findings.map((f) => f.code);

  assert.ok(
    codes.includes('GENERIC_PROBE_ONLY'),
    `Expected GENERIC_PROBE_ONLY finding, got ${codes.join(', ')}`
  );
  assert.equal(codes.includes('BLIND_UNSOLVABLE'), false);
  assert.equal(result.fuzz.crashes, 0);
  assert.equal(result.fuzz.leakedTimers, 0);

  // Verify runRealisticProbes generates input-driven probes on _template.js (pointer_down + pointer_cancel)
  const templateProbes = runRealisticProbes(
    () => createSession(templateMode, { variant: 'standard', seed: 3, humanProfile: 'typical' }),
    templateMode,
    'standard'
  );
  const templateProbeNames = templateProbes.map((p) => p.name);
  for (const p of templateProbes) {
    assert.equal(p.session.dispose().leakedTimers, 0);
  }
  assert.deepEqual(templateProbeNames, ['generic_rapid_tap_burst', 'generic_mid_gesture_cancel']);

  // Also verify all 3 generic probes trigger when pointer_move/dial + pointer_down + pointer_cancel are declared
  const customSweepMode = {
    id: 'custom-dial-pad',
    name: 'Custom Dial Pad',
    kind: 'fidget',
    inputs: ['pointer_down', 'pointer_move', 'pointer_up', 'pointer_cancel', 'dial'],
    blindInstructions: 'Slide or turn dial.',
    create(ctx) {
      let step = 0;
      return {
        onInput(ev) {
          if (ev.type === 'pointer_move') {
            const next = Math.round((ev.x || 0) * 10);
            if (next !== step) {
              step = next;
              ctx.haptics.tick({ cue: 'detent_tick' });
            }
          } else if (ev.type === 'pointer_down') {
            ctx.haptics.light({ cue: 'touch' });
          } else if (ev.type === 'dial') {
            ctx.haptics.tick({ cue: 'dial_tick' });
          }
        },
        getVisualState: () => ({ step }),
        getEvalState: () => ({ score: 0, progress: step }),
        dispose() {},
      };
    },
  };
  const customProbes = runRealisticProbes(
    () => createSession(customSweepMode, { variant: 'default', seed: 1, humanProfile: 'typical' }),
    customSweepMode,
    'default'
  );
  const customProbeNames = customProbes.map((p) => p.name);
  for (const p of customProbes) {
    assert.equal(p.session.dispose().leakedTimers, 0);
  }
  assert.deepEqual(customProbeNames, [
    'generic_fast_sweep',
    'generic_rapid_tap_burst',
    'generic_mid_gesture_cancel',
  ]);
});

test('two-track evaluation treats snappy fidget/pacer buzz as info while catching notification & same-ms overlaps', () => {
  // 1. Snappy tick fidget with high pulse density should PASS and downgrade ACOUSTIC_BUZZ_HIGH to info
  const snappyFidgetMode = {
    id: 'snappy-ratchet-fidget',
    name: 'Snappy Ratchet Fidget',
    kind: 'fidget',
    variants: ['standard'],
    inputs: ['pointer_down', 'pointer_move', 'pointer_up', 'pointer_cancel'],
    blindInstructions: 'Slide rapidly to feel crisp tick detents.',
    create(ctx) {
      let clicks = 0;
      let lastBucket = -1;
      return {
        onInput(ev) {
          if (ev.type === 'pointer_down') {
            clicks += 1;
            ctx.haptics.tick({ cue: 'press_tick' });
          } else if (ev.type === 'pointer_move') {
            const bucket = Math.floor((ev.x || 0) * 40);
            if (bucket !== lastBucket) {
              lastBucket = bucket;
              clicks += 1;
              ctx.haptics.tick({ cue: 'ratchet_tick' });
            }
          }
        },
        getVisualState: () => ({ clicks }),
        getEvalState: () => ({ score: clicks, progress: clicks }),
        dispose() {},
      };
    },
    blindSolver(blind) {
      // Rapid 20ms tick ratcheting over 2s (>10 pulses/sec, 0 hard collisions since tick settle=15ms)
      blind.step({ type: 'pointer_down', x: 0.02, y: 0.5 }, 20);
      for (let i = 1; i <= 38; i += 1) {
        blind.step({ type: 'pointer_move', x: 0.02 + (i / 38) * 0.96, y: 0.5 }, 20);
      }
      blind.step({ type: 'pointer_up', x: 0.98, y: 0.5 }, 120);
      return { ratcheted: true };
    },
  };

  const fidgetReport = evaluateMode(snappyFidgetMode, { seeds: 2 });
  const fidgetRes = fidgetReport.results[0];
  assert.equal(fidgetRes.variantKind, 'fidget');
  assert.equal(fidgetRes.hygiene.hardCollisions, 0);
  assert.equal(fidgetRes.verdict, 'PASS');
  const buzzFinding = fidgetRes.findings.find((f) => f.code === 'ACOUSTIC_BUZZ_HIGH');
  assert.ok(buzzFinding, 'Expected ACOUSTIC_BUZZ_HIGH diagnostic to be recorded on snappy fidget');
  assert.equal(buzzFinding.severity, 'info');

  // 2. Fidget that fires a notification overlap (`success` followed 40ms later by another pulse) or same-ms double-fire MUST be caught
  const overlappingFidgetMode = {
    id: 'overlapping-fidget',
    name: 'Overlapping Fidget',
    kind: 'fidget',
    variants: ['standard'],
    inputs: ['button_down', 'button_up'],
    blindInstructions: 'Tap the button.',
    create(ctx) {
      let timer = null;
      return {
        onInput(ev) {
          if (ev.type === 'button_down') {
            ctx.haptics.success({ cue: 'notify' });
            ctx.haptics.tick({ cue: 'same_ms_echo' });
            timer = ctx.clock.setTimeout(() => {
              timer = null;
              ctx.haptics.tick({ cue: 'late_echo' });
            }, 40);
          }
        },
        getVisualState: () => ({}),
        getEvalState: () => ({ score: 1, progress: 1 }),
        dispose() {
          if (timer !== null) {
            ctx.clock.clearTimeout(timer);
            timer = null;
          }
        },
      };
    },
  };

  const overlapReport = evaluateMode(overlappingFidgetMode, { seeds: 2 });
  const overlapCodes = overlapReport.results[0].findings.map((f) => f.code);
  assert.ok(
    overlapCodes.includes('LRA_NOTIFICATION_OVERLAP'),
    `Expected LRA_NOTIFICATION_OVERLAP, got ${overlapCodes.join(', ')}`
  );
  assert.ok(
    overlapCodes.includes('LRA_SAME_MS_COLLISION'),
    `Expected LRA_SAME_MS_COLLISION, got ${overlapCodes.join(', ')}`
  );
  assert.notEqual(overlapReport.results[0].verdict, 'PASS');

  // 3. Sandbox switch & marble ridges should pass under Track 2 (tick/light snappy fidgets)
  const sandboxReport = evaluateMode(getMode('sandbox'), { seeds: 2 });
  const switchRes = sandboxReport.results.find((r) => r.variant === 'switch');
  assert.equal(switchRes.verdict, 'PASS');
  const marbleReport = evaluateMode(getMode('marble'), { seeds: 2 });
  const ridgesRes = marbleReport.results.find((r) => r.variant === 'ridges');
  assert.equal(ridgesRes.verdict, 'PASS');
});

test('evaluateMode invokes custom blindSolver(blind) with strict blind facade', () => {
  let solverInvocations = 0;
  const observedFacadeChecks = [];

  const mockCustomMode = {
    id: 'mock-blind-check',
    name: 'Mock Blind Check',
    kind: 'puzzle',
    variants: ['standard'],
    inputs: ['button_down', 'button_up'],
    blindInstructions: 'Press the button once to score.',
    create(ctx) {
      let score = 0;
      let timer = null;
      return {
        onInput(event) {
          if (event && event.type === 'button_down') {
            score += 1;
            ctx.haptics.success({ cue: 'mock_score' });
            timer = ctx.clock.setTimeout(() => {
              timer = null;
            }, 50);
          }
        },
        getVisualState: () => ({ score }),
        getEvalState: () => ({ score, progress: score }),
        dispose() {
          if (timer !== null) {
            ctx.clock.clearTimeout(timer);
            timer = null;
          }
        },
      };
    },
    blindSolver(blind) {
      solverInvocations += 1;
      observedFacadeChecks.push({
        hasGetEvalState: blind.getEvalState !== undefined,
        hasGetVisualState: blind.getVisualState !== undefined,
        hasGetRawTrace: blind.getRawTrace !== undefined,
        hasGetBlindHeader: typeof blind.getBlindHeader === 'function',
        hasInput: typeof blind.input === 'function',
        hasAdvance: typeof blind.advance === 'function',
        hasStep: typeof blind.step === 'function',
        hasReadBlindHaptics: typeof blind.readBlindHaptics === 'function',
      });
      assert.equal(blind.getEvalState, undefined);
      assert.equal(blind.getVisualState, undefined);
      assert.equal(blind.getRawTrace, undefined);

      blind.step({ type: 'button_down' }, 80);
      blind.step({ type: 'button_up' }, 100);
      return { customRan: true };
    },
  };

  const report = evaluateMode(mockCustomMode, { seeds: 2 });
  assertReportSchema(report, 'mock-blind-check');

  // 3 profiles * 2 seeds = 6 solver runs
  assert.equal(solverInvocations, 6);
  for (const check of observedFacadeChecks) {
    assert.equal(check.hasGetEvalState, false);
    assert.equal(check.hasGetVisualState, false);
    assert.equal(check.hasGetRawTrace, false);
    assert.equal(check.hasGetBlindHeader, true);
    assert.equal(check.hasInput, true);
    assert.equal(check.hasAdvance, true);
    assert.equal(check.hasStep, true);
    assert.equal(check.hasReadBlindHaptics, true);
  }

  const codes = report.results[0].findings.map((f) => f.code);
  assert.equal(codes.includes('GENERIC_PROBE_ONLY'), false);
  assert.equal(report.results[0].profiles.ideal.avgScore, 1);
  assert.equal(report.results[0].fuzz.leakedTimers, 0);
});

test('scripts/validate.js CLI handles --json, --strict, and --all exit codes cleanly', () => {
  const jsonRun = runCli(VALIDATE_SCRIPT, ['marble', '--variant', 'hole', '--seeds', '2', '--json']);
  assert.equal(jsonRun.status, 0);
  assert.equal(jsonRun.stderr, '');
  const parsed = JSON.parse(jsonRun.stdout);
  assertReportSchema(parsed, 'marble');

  const strictRun = runCli(VALIDATE_SCRIPT, ['hunt', '--seeds', '2', '--strict']);
  assert.equal(strictRun.status, 1);
  assert.equal(strictRun.stderr, '');
  assert.ok(strictRun.stdout.includes('COLD_TIMER_BLIND_SPOT'));

  const allRun = runCli(VALIDATE_SCRIPT, ['--all', '--seeds', '2']);
  assert.equal(allRun.status, 1);
  assert.equal(allRun.stderr, '');
  assert.ok(allRun.stdout.includes('OPEN FIDGET HEADLESS VALIDATION LAB'));
});

test('scripts/playtest.js transcript-file workflow enforces anti-leak on safe and _template.js', () => {
  const targets = [
    {
      label: 'safe',
      modeRef: 'safe',
      stepInput: { type: 'pointer_down', x: 0.5, y: 0.5 },
      batchSteps: [
        { input: { type: 'pointer_move', x: 0.65, y: 0.5 }, advance: 60 },
        { input: { type: 'pointer_up' }, advance: 80 },
      ],
    },
    {
      label: 'template',
      modeRef: TEMPLATE_PATH,
      stepInput: { type: 'pointer_down', x: 0.5, y: 0.5 },
      batchSteps: [
        { input: { type: 'pointer_up' }, advance: 450 },
        { advance: 900 },
      ],
    },
  ];

  for (const target of targets) {
    const sessionPath = path.join(
      os.tmpdir(),
      `open-fidget-playtest-${process.pid}-${Date.now()}-${target.label}.json`
    );

    try {
      const startRes = runCli(PLAYTEST_SCRIPT, [
        'start',
        target.modeRef,
        '--seed',
        '1',
        '--session',
        sessionPath,
      ]);
      assert.equal(startRes.status, 0);
      assert.equal(startRes.stderr, '');
      const startJson = JSON.parse(startRes.stdout);
      assert.ok(startJson.header && typeof startJson.header.id === 'string');
      assert.ok(Array.isArray(startJson.initialHaptics));
      assertNoForbiddenKeys(startJson, `${target.label}:start`);

      const stepRes = runCli(PLAYTEST_SCRIPT, [
        'step',
        '--session',
        sessionPath,
        '--input',
        JSON.stringify(target.stepInput),
        '--advance',
        '60',
      ]);
      assert.equal(stepRes.status, 0);
      assert.equal(stepRes.stderr, '');
      const stepJson = JSON.parse(stepRes.stdout);
      assert.equal(stepJson.stepIndex, 0);
      assert.ok(Array.isArray(stepJson.haptics));
      assertNoForbiddenKeys(stepJson, `${target.label}:step`);

      const batchRes = runCli(PLAYTEST_SCRIPT, [
        'batch',
        '--session',
        sessionPath,
        JSON.stringify(target.batchSteps),
      ]);
      assert.equal(batchRes.status, 0);
      assert.equal(batchRes.stderr, '');
      const batchJson = JSON.parse(batchRes.stdout);
      assert.equal(batchJson.steps.length, target.batchSteps.length);
      assertNoForbiddenKeys(batchJson, `${target.label}:batch`);

      const finishRes = runCli(PLAYTEST_SCRIPT, ['finish', '--session', sessionPath]);
      assert.equal(finishRes.status, 0);
      assert.equal(finishRes.stderr, '');
      const finishJson = JSON.parse(finishRes.stdout);
      assert.ok(finishJson.finalEvalState && typeof finishJson.finalEvalState === 'object');
      assert.ok(finishJson.actuatorSummary && typeof finishJson.actuatorSummary === 'object');
      assert.equal(finishJson.leakedTimers, 0);
      assert.equal(finishJson.totalSteps, 1 + target.batchSteps.length);
    } finally {
      fs.rmSync(sessionPath, { force: true });
    }
  }
});

test('scripts/playtest.js pipe mode streams clean JSONL responses for 2 steps + finish', () => {
  const inputLines = [
    JSON.stringify({ input: { type: 'pointer_down', x: 0.5, y: 0.5 }, advance: 60 }),
    JSON.stringify({ input: { type: 'pointer_up' }, advance: 80 }),
    JSON.stringify({ cmd: 'finish' }),
  ].join('\n');

  const res = runCli(PLAYTEST_SCRIPT, ['pipe', 'safe', '--seed', '1'], `${inputLines}\n`);
  assert.equal(res.status, 0);
  assert.equal(res.stderr, '');

  const rawLines = res.stdout.trim().split('\n').filter(Boolean);
  const parsedLines = rawLines.map((line) => JSON.parse(line));

  assert.equal(parsedLines[0].event, 'ready');
  assertNoForbiddenKeys(parsedLines[0], 'pipe:ready');

  const commandResponses = parsedLines.slice(1);
  assert.equal(commandResponses.length, 3);
  assert.equal(commandResponses[0].stepIndex, 0);
  assert.equal(commandResponses[1].stepIndex, 1);
  assertNoForbiddenKeys(commandResponses[0], 'pipe:step0');
  assertNoForbiddenKeys(commandResponses[1], 'pipe:step1');

  const finishLine = commandResponses[2];
  assert.equal(finishLine.cmd, 'finish');
  assert.equal(finishLine.totalSteps, 2);
  assert.ok(finishLine.finalEvalState && typeof finishLine.finalEvalState === 'object');
  assert.ok(finishLine.actuatorSummary && typeof finishLine.actuatorSummary === 'object');
  assert.equal(finishLine.leakedTimers, 0);
});
