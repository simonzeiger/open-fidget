#!/usr/bin/env node
'use strict';

const { listModeIds, resolveMode } = require('../src/engine/registry');
const { evaluateMode, evaluateAll } = require('../src/eval/evaluate');
const { formatReport, formatAllReports } = require('../src/eval/reporter');

function printHelp() {
  const registered = listModeIds().join(', ');
  console.log(`Usage:
  node scripts/validate.js <modeIdOrPath> [options]
  node scripts/validate.js --all [options]

Arguments:
  <modeIdOrPath>       Registered mode id (${registered}) or path to a mode module (e.g. ./src/engine/_template.js)

Options:
  --all                Validate all registered modes
  --variant <name>     Filter evaluation to a single mode variant
  --seeds <n>          Number of deterministic seeds to run per profile (default: 8)
  --profiles <csv>     Comma-separated human profiles (default: ideal,typical,pocket)
  --json               Output pure JSON to stdout with no extra logs
  --strict             Exit with code 1 if verdict is FAIL or NEEDS_TUNING
  -h, --help           Show this help message
`);
}

function parsePositiveInt(raw, flagName) {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} requires a positive integer, got "${raw}"`);
  }
  return parsed;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    modeRef: null,
    all: false,
    variant: undefined,
    seeds: 8,
    profiles: ['ideal', 'typical', 'pocket'],
    json: false,
    strict: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--strict') {
      options.strict = true;
    } else if (arg === '--variant') {
      if (i + 1 >= args.length) throw new Error('--variant requires a value');
      options.variant = args[++i];
    } else if (arg.startsWith('--variant=')) {
      options.variant = arg.slice('--variant='.length);
    } else if (arg === '--seeds') {
      if (i + 1 >= args.length) throw new Error('--seeds requires a value');
      options.seeds = parsePositiveInt(args[++i], '--seeds');
    } else if (arg.startsWith('--seeds=')) {
      options.seeds = parsePositiveInt(arg.slice('--seeds='.length), '--seeds');
    } else if (arg === '--profiles') {
      if (i + 1 >= args.length) throw new Error('--profiles requires a value');
      options.profiles = args[++i]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--profiles=')) {
      options.profiles = arg
        .slice('--profiles='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.modeRef) {
      options.modeRef = arg;
    } else {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
  }

  if (options.profiles.length === 0) {
    throw new Error('--profiles must include at least one profile');
  }

  return options;
}

function getVerdict(result) {
  return result && result.summary && result.summary.verdict ? result.summary.verdict : 'FAIL';
}

function isFailingVerdict(verdict, strict) {
  if (verdict === 'FAIL') return true;
  if (strict && verdict === 'NEEDS_TUNING') return true;
  return false;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (opts.help) {
    printHelp();
    return;
  }

  if (!opts.all && !opts.modeRef) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (opts.all && opts.modeRef) {
    console.error('Error: Specify either <modeIdOrPath> or --all, not both.');
    process.exitCode = 1;
    return;
  }

  const evalOptions = {
    variant: opts.variant,
    seeds: opts.seeds,
    profiles: opts.profiles,
  };

  try {
    if (opts.all) {
      const results = evaluateAll(evalOptions);
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatAllReports(results, opts)}\n`);
      }

      const list = Array.isArray(results && results.modes)
        ? results.modes
        : Array.isArray(results && results.results)
          ? results.results
          : Array.isArray(results)
            ? results
            : [];
      const summaryFail = Boolean(
        results &&
          results.summary &&
          (results.summary.failCount > 0 || (opts.strict && results.summary.tuneCount > 0))
      );
      const anyFail =
        summaryFail ||
        (results && results.summary && results.summary.verdict && isFailingVerdict(results.summary.verdict, opts.strict)) ||
        list.some((r) => isFailingVerdict(getVerdict(r), opts.strict));
      if (anyFail) {
        process.exitCode = 1;
      }
      return;
    }

    const modeDef = resolveMode(opts.modeRef);
    const result = evaluateMode(modeDef, evalOptions);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatReport(result, opts)}\n`);
    }

    if (isFailingVerdict(getVerdict(result), opts.strict)) {
      process.exitCode = 1;
    }
  } catch (err) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
    } else {
      console.error(`Validation error: ${err.message}`);
    }
    process.exitCode = 1;
  }
}

main();
