#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { getMode, listModeIds, resolveMode } = require('../src/engine/registry');
const { createSession } = require('../src/sim/runner');

const DEFAULT_SESSION_PATH = '/tmp/open-fidget-playtest.json';

function printHelp() {
  const registered = listModeIds().join(', ');
  console.log(`Usage:
  Transcript-File Mode (turn-by-turn stateless CLI):
    node scripts/playtest.js start <modeIdOrPath> [--variant V] [--profile ideal|typical|pocket] [--seed N] [--session path]
    node scripts/playtest.js step [--session path] [--input '<json>'] [--advance <ms>] [--jitter]
    node scripts/playtest.js batch [--session path] '<json array of {input?, advance?, jitter?}>'
    node scripts/playtest.js finish [--session path]

  JSONL Stdin Pipe Mode:
    node scripts/playtest.js pipe <modeIdOrPath> [--variant V] [--profile ideal|typical|pocket] [--seed N]

Registered modes: ${registered}
Default session file: ${DEFAULT_SESSION_PATH}
`);
}

function sanitizeBlindHaptic(ev) {
  return {
    t: ev && Number.isFinite(ev.t) ? ev.t : 0,
    type: ev && typeof ev.type === 'string' ? ev.type : 'tick',
    felt: ev && typeof ev.felt === 'string' ? ev.felt : ev && ev.type ? String(ev.type) : 'tick',
    smeared: Boolean(ev && ev.smeared),
  };
}

function normalizeModeRef(modeIdOrPath) {
  if (!modeIdOrPath || typeof modeIdOrPath !== 'string') {
    throw new Error('Mode id or file path is required');
  }
  if (getMode(modeIdOrPath)) {
    return modeIdOrPath;
  }
  return path.resolve(process.cwd(), modeIdOrPath);
}

function parseIntArg(raw, flagName) {
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(`${flagName} must be an integer, got "${raw}"`);
  }
  return n;
}

function parseNonNegNumber(raw, flagName) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${flagName} must be a non-negative number, got "${raw}"`);
  }
  return n;
}

function parseJsonArg(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON for ${label}: ${err.message}`);
  }
}

function parseCommonFlags(args) {
  const opts = {
    positionals: [],
    variant: undefined,
    profile: 'ideal',
    seed: 1,
    sessionPath: DEFAULT_SESSION_PATH,
    input: undefined,
    advance: 0,
    jitter: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--variant') {
      if (i + 1 >= args.length) throw new Error('--variant requires a value');
      opts.variant = args[++i];
    } else if (arg.startsWith('--variant=')) {
      opts.variant = arg.slice('--variant='.length);
    } else if (arg === '--profile') {
      if (i + 1 >= args.length) throw new Error('--profile requires a value');
      opts.profile = args[++i];
    } else if (arg.startsWith('--profile=')) {
      opts.profile = arg.slice('--profile='.length);
    } else if (arg === '--seed') {
      if (i + 1 >= args.length) throw new Error('--seed requires a value');
      opts.seed = parseIntArg(args[++i], '--seed');
    } else if (arg.startsWith('--seed=')) {
      opts.seed = parseIntArg(arg.slice('--seed='.length), '--seed');
    } else if (arg === '--session') {
      if (i + 1 >= args.length) throw new Error('--session requires a value');
      opts.sessionPath = args[++i];
    } else if (arg.startsWith('--session=')) {
      opts.sessionPath = arg.slice('--session='.length);
    } else if (arg === '--input') {
      if (i + 1 >= args.length) throw new Error('--input requires a value');
      opts.input = parseJsonArg(args[++i], '--input');
    } else if (arg.startsWith('--input=')) {
      opts.input = parseJsonArg(arg.slice('--input='.length), '--input');
    } else if (arg === '--advance') {
      if (i + 1 >= args.length) throw new Error('--advance requires a value');
      opts.advance = parseNonNegNumber(args[++i], '--advance');
    } else if (arg.startsWith('--advance=')) {
      opts.advance = parseNonNegNumber(arg.slice('--advance='.length), '--advance');
    } else if (arg === '--jitter') {
      opts.jitter = true;
    } else if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      opts.positionals.push(arg);
    }
  }

  return opts;
}

function normalizeStepSpec(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Each step must be a JSON object { input?, advance?, jitter? }');
  }
  const input = raw.input !== undefined && raw.input !== null ? raw.input : null;
  if (input !== null && (typeof input !== 'object' || Array.isArray(input) || typeof input.type !== 'string')) {
    throw new Error('step.input must be an object with a string "type" field');
  }
  const advance =
    raw.advance === undefined || raw.advance === null
      ? 0
      : parseNonNegNumber(raw.advance, 'step.advance');
  const jitter = Boolean(raw.jitter);
  return { input, advance, jitter };
}

function executeSessionStep(session, stepSpec) {
  const stepOpts = { jitter: stepSpec.jitter };
  if (stepSpec.input) {
    return session.step(stepSpec.input, stepSpec.advance, stepOpts);
  }
  const haptics = session.advance(stepSpec.advance, stepOpts);
  return {
    t: session.getBlindHeader().t,
    haptics,
  };
}

function createModeSession(modeRef, { variant, profile, seed }) {
  const modeDef = resolveMode(modeRef);
  const session = createSession(modeDef, {
    variant,
    humanProfile: profile,
    seed,
  });
  const initialHaptics = session.advance(0).map(sanitizeBlindHaptic);
  return { modeDef, session, initialHaptics };
}

function loadTranscript(sessionPath) {
  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Session transcript not found at "${sessionPath}". Run "start" first.`);
  }
  const raw = fs.readFileSync(sessionPath, 'utf8');
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !data.modeRef || !Array.isArray(data.steps)) {
    throw new Error(`Invalid session transcript format in "${sessionPath}"`);
  }
  return data;
}

function saveTranscript(sessionPath, transcript) {
  const dir = path.dirname(sessionPath);
  if (dir && dir !== '.') {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(sessionPath, `${JSON.stringify(transcript, null, 2)}\n`, 'utf8');
}

function replayTranscript(transcript) {
  const { session, initialHaptics } = createModeSession(transcript.modeRef, {
    variant: transcript.variant,
    profile: transcript.profile,
    seed: transcript.seed,
  });
  for (let i = 0; i < transcript.steps.length; i += 1) {
    executeSessionStep(session, transcript.steps[i]);
  }
  return { session, initialHaptics };
}

function buildDebrief(session, totalSteps) {
  const finalEvalState = session.getEvalState();
  const trace = session.getRawTrace();
  const { leakedTimers } = session.dispose();
  return {
    durationMs: trace.durationMs,
    totalSteps,
    finalEvalState,
    actuatorSummary: trace.actuator,
    leakedTimers,
    blindTimeline: trace.blindHaptics.map(sanitizeBlindHaptic),
  };
}

function handleStart(args) {
  const opts = parseCommonFlags(args);
  if (opts.help || opts.positionals.length === 0) {
    printHelp();
    if (!opts.help) process.exitCode = 1;
    return;
  }

  const modeRef = normalizeModeRef(opts.positionals[0]);
  const { session, initialHaptics } = createModeSession(modeRef, {
    variant: opts.variant,
    profile: opts.profile,
    seed: opts.seed,
  });
  const header = session.getBlindHeader();
  session.dispose();

  const transcript = {
    modeRef,
    variant: header.variant,
    profile: opts.profile,
    seed: opts.seed,
    steps: [],
  };
  saveTranscript(opts.sessionPath, transcript);

  process.stdout.write(
    `${JSON.stringify({ session: opts.sessionPath, header, initialHaptics }, null, 2)}\n`
  );
}

function handleStep(args) {
  const opts = parseCommonFlags(args);
  if (opts.help) {
    printHelp();
    return;
  }

  const transcript = loadTranscript(opts.sessionPath);
  const { session } = replayTranscript(transcript);

  const stepSpec = normalizeStepSpec({
    input: opts.input !== undefined ? opts.input : null,
    advance: opts.advance,
    jitter: opts.jitter,
  });

  const stepIndex = transcript.steps.length;
  const result = executeSessionStep(session, stepSpec);
  session.dispose();

  transcript.steps.push(stepSpec);
  saveTranscript(opts.sessionPath, transcript);

  process.stdout.write(
    `${JSON.stringify(
      {
        stepIndex,
        t: result.t,
        haptics: result.haptics.map(sanitizeBlindHaptic),
      },
      null,
      2
    )}\n`
  );
}

function handleBatch(args) {
  const opts = parseCommonFlags(args);
  if (opts.help || opts.positionals.length === 0) {
    printHelp();
    if (!opts.help) process.exitCode = 1;
    return;
  }

  const rawSteps = parseJsonArg(opts.positionals[0], 'batch steps');
  if (!Array.isArray(rawSteps)) {
    throw new Error('Batch argument must be a JSON array of { input?, advance?, jitter? }');
  }

  const transcript = loadTranscript(opts.sessionPath);
  const { session } = replayTranscript(transcript);

  const stepResults = [];
  let lastT = session.getBlindHeader().t;

  for (let i = 0; i < rawSteps.length; i += 1) {
    const stepSpec = normalizeStepSpec(rawSteps[i]);
    const stepIndex = transcript.steps.length;
    const result = executeSessionStep(session, stepSpec);
    lastT = result.t;
    transcript.steps.push(stepSpec);
    stepResults.push({
      stepIndex,
      t: result.t,
      haptics: result.haptics.map(sanitizeBlindHaptic),
    });
  }

  session.dispose();
  saveTranscript(opts.sessionPath, transcript);

  process.stdout.write(
    `${JSON.stringify(
      {
        session: opts.sessionPath,
        t: lastT,
        steps: stepResults,
      },
      null,
      2
    )}\n`
  );
}

function handleFinish(args) {
  const opts = parseCommonFlags(args);
  if (opts.help) {
    printHelp();
    return;
  }

  const transcript = loadTranscript(opts.sessionPath);
  const { session } = replayTranscript(transcript);
  const debrief = buildDebrief(session, transcript.steps.length);

  process.stdout.write(`${JSON.stringify(debrief, null, 2)}\n`);
}

function handlePipe(args) {
  const opts = parseCommonFlags(args);
  if (opts.help || opts.positionals.length === 0) {
    printHelp();
    if (!opts.help) process.exitCode = 1;
    return;
  }

  const modeRef = normalizeModeRef(opts.positionals[0]);
  const { session, initialHaptics } = createModeSession(modeRef, {
    variant: opts.variant,
    profile: opts.profile,
    seed: opts.seed,
  });

  let stepCount = 0;
  let finished = false;

  process.stdout.write(
    `${JSON.stringify({
      event: 'ready',
      header: session.getBlindHeader(),
      initialHaptics,
    })}\n`
  );

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed || finished) return;

    try {
      const msg = JSON.parse(trimmed);
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
        throw new Error('Command must be a JSON object');
      }

      if (msg.cmd === 'finish') {
        finished = true;
        const debrief = buildDebrief(session, stepCount);
        process.stdout.write(`${JSON.stringify({ cmd: 'finish', ...debrief })}\n`);
        rl.close();
        return;
      }

      const stepSpec = normalizeStepSpec(msg);
      const stepIndex = stepCount;
      stepCount += 1;
      const result = executeSessionStep(session, stepSpec);
      process.stdout.write(
        `${JSON.stringify({
          stepIndex,
          t: result.t,
          haptics: result.haptics.map(sanitizeBlindHaptic),
        })}\n`
      );
    } catch (err) {
      process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
    }
  });

  rl.on('close', () => {
    if (!finished) {
      finished = true;
      session.dispose();
    }
  });
}

function main() {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (!subcommand || subcommand === '-h' || subcommand === '--help') {
    printHelp();
    return;
  }

  const rest = args.slice(1);
  try {
    switch (subcommand) {
      case 'start':
        handleStart(rest);
        break;
      case 'step':
        handleStep(rest);
        break;
      case 'batch':
        handleBatch(rest);
        break;
      case 'finish':
        handleFinish(rest);
        break;
      case 'pipe':
        handlePipe(rest);
        break;
      default:
        throw new Error(`Unknown subcommand "${subcommand}"`);
    }
  } catch (err) {
    process.stderr.write(`Playtest error: ${err.message}\n`);
    process.exitCode = 1;
  }
}

main();
