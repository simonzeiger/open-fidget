'use strict';

/**
 * Canonical Open Fidget headless mode contract.
 * Pure CommonJS with zero React Native or Node-only dependencies so the same
 * engines run identically in Expo Go (Metro) and headless Node.js validation.
 */

const HAPTIC_TYPES = Object.freeze([
  'tick',
  'light',
  'medium',
  'heavy',
  'rigid',
  'soft',
  'success',
  'warning',
  'error',
]);

const HAPTIC_TYPE_SET = new Set(HAPTIC_TYPES);

const INPUT_TYPES = Object.freeze([
  'pointer_down',
  'pointer_move',
  'pointer_up',
  'pointer_cancel',
  'imu',
  'dial',
  'squeeze',
  'button_down',
  'button_up',
  'action',
  'resize',
]);

const MODE_KINDS = Object.freeze(['puzzle', 'fidget', 'pacer']);

/**
 * Creates a deterministic pattern player backed by an injected clock & haptics sink.
 * Each step is `{ type, delay, cue?, onStep? }` where `delay` is ms AFTER this step
 * before the next step (matching the original src/haptics.js semantics).
 */
function createPatternPlayer(clock, emitFn) {
  return function playPattern(steps, onComplete) {
    let cancelled = false;
    const timers = [];
    let elapsed = 0;

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const fireAt = elapsed;
      const t = clock.setTimeout(() => {
        if (cancelled) return;
        if (step.type) {
          emitFn(step.type, step.cue ? { cue: step.cue } : undefined);
        }
        if (typeof step.onStep === 'function') {
          step.onStep();
        }
      }, fireAt);
      timers.push(t);
      elapsed += step.delay ?? 0;
    }

    if (typeof onComplete === 'function') {
      const endTimer = clock.setTimeout(() => {
        if (!cancelled) onComplete();
      }, elapsed);
      timers.push(endTimer);
    }

    return function cancel() {
      cancelled = true;
      for (let i = 0; i < timers.length; i += 1) {
        clock.clearTimeout(timers[i]);
      }
      timers.length = 0;
    };
  };
}

/**
 * Wraps a raw `emit(type, meta)` callback and `clock` into the full `ctx.haptics`
 * object passed into every mode engine.
 */
function createHapticsContext(clock, rawEmit) {
  const emit = (type, meta) => {
    if (!HAPTIC_TYPE_SET.has(type)) {
      throw new Error(`Unknown haptic type "${type}". Allowed: ${HAPTIC_TYPES.join(', ')}`);
    }
    rawEmit(type, meta || null);
  };

  const api = {
    emit,
    playPattern: createPatternPlayer(clock, emit),
  };

  for (const type of HAPTIC_TYPES) {
    api[type] = (meta) => emit(type, meta);
  }

  return api;
}

/**
 * Validates that a mode module exports the required contract fields.
 * Throws a descriptive error if invalid.
 */
function validateModeDefinition(mode) {
  if (!mode || typeof mode !== 'object') {
    throw new Error('Mode definition must be an object');
  }
  if (typeof mode.id !== 'string' || !mode.id.trim()) {
    throw new Error('Mode definition requires a non-empty string "id"');
  }
  if (typeof mode.name !== 'string' || !mode.name.trim()) {
    throw new Error(`Mode "${mode.id}" requires a non-empty string "name"`);
  }
  if (!MODE_KINDS.includes(mode.kind)) {
    throw new Error(`Mode "${mode.id}" has invalid kind "${mode.kind}". Expected one of: ${MODE_KINDS.join(', ')}`);
  }
  if (!Array.isArray(mode.inputs) || mode.inputs.length === 0) {
    throw new Error(`Mode "${mode.id}" requires a non-empty "inputs" array`);
  }
  if (typeof mode.blindInstructions !== 'string' || !mode.blindInstructions.trim()) {
    throw new Error(`Mode "${mode.id}" requires a non-empty "blindInstructions" string`);
  }
  if (typeof mode.create !== 'function') {
    throw new Error(`Mode "${mode.id}" requires a "create(ctx, config)" function`);
  }
  if (mode.actions !== undefined) {
    if (!Array.isArray(mode.actions)) {
      throw new Error(`Mode "${mode.id}" optional "actions" must be an array`);
    }
    for (let i = 0; i < mode.actions.length; i += 1) {
      const action = mode.actions[i];
      if (!action || typeof action !== 'object' || Array.isArray(action)) {
        throw new Error(`Mode "${mode.id}" actions[${i}] must be an object { name, label }`);
      }
      if (typeof action.name !== 'string' || !action.name.trim()) {
        throw new Error(`Mode "${mode.id}" actions[${i}].name must be a non-empty string`);
      }
      if (typeof action.label !== 'string' || !action.label.trim()) {
        throw new Error(`Mode "${mode.id}" actions[${i}].label must be a non-empty string`);
      }
    }
  }
  return true;
}

/**
 * Validates an instantiated mode engine object.
 */
function validateModeInstance(instance, modeId) {
  const required = ['onInput', 'getVisualState', 'getEvalState', 'dispose'];
  for (const fn of required) {
    if (!instance || typeof instance[fn] !== 'function') {
      throw new Error(`Mode "${modeId}" instance is missing required method "${fn}()"`);
    }
  }
  return true;
}

module.exports = {
  HAPTIC_TYPES,
  HAPTIC_TYPE_SET,
  INPUT_TYPES,
  MODE_KINDS,
  createPatternPlayer,
  createHapticsContext,
  validateModeDefinition,
  validateModeInstance,
};
