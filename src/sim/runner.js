'use strict';

/**
 * Headless blind session harness for Open Fidget modes.
 * Drives a mode engine over a deterministic virtual clock and separate RNG streams
 * for engine randomness vs. human motor/perceptual noise, while enforcing strict
 * blind isolation (no cue or hidden eval-state leaks to the playtester API).
 */

const {
  createHapticsContext,
  validateModeDefinition,
  validateModeInstance,
} = require('../engine/contract');
const { createVirtualClock } = require('./clock');
const { createRng } = require('./rng');
const { HARD_COLLISION_MS, analyzeActuatorTrace } = require('./actuator');
const { createHumanModel } = require('./humanModel');

const PULSE_WINDOW_MS = 250;

function cloneShallow(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  return { ...obj };
}

function resolveDefaultVariant(modeDef, options) {
  if (options.variant !== undefined) {
    return options.variant;
  }
  if (options.config && options.config.variant !== undefined) {
    return options.config.variant;
  }
  if (modeDef.defaultVariant !== undefined) {
    return modeDef.defaultVariant;
  }
  if (Array.isArray(modeDef.variants) && modeDef.variants.length > 0) {
    const first = modeDef.variants[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object' && first.id !== undefined) return first.id;
  }
  return null;
}

/**
 * Creates an isolated headless validation session for a mode definition.
 *
 * @param {object} modeDef
 * @param {object} [options]
 */
function createSession(modeDef, options = {}) {
  validateModeDefinition(modeDef);

  const seed = options.seed !== undefined ? options.seed : 1;
  const actuatorFilter = options.actuatorFilter !== undefined ? Boolean(options.actuatorFilter) : true;
  const humanProfile = options.humanProfile !== undefined ? options.humanProfile : 'ideal';
  const variant = resolveDefaultVariant(modeDef, options);

  const clock = createVirtualClock();
  const engineRng = createRng(seed);
  const humanRng = createRng(seed * 7919 + 17);
  const human = createHumanModel(humanProfile, humanRng);

  const rawHaptics = [];
  const blindHaptics = [];
  const inputLog = [];

  let blindCursor = 0;
  let disposed = false;

  // Context-aware active exploration window tracking
  const activeWindows = [];
  let pointerHeld = false;
  let buttonHeld = false;
  let holdStartT = null;
  let pulseWindowStartT = null;
  let pulseWindowEndT = null;

  function appendMergedWindow(startT, endT) {
    if (!(endT > startT)) return;
    const prev = activeWindows[activeWindows.length - 1];
    if (prev && startT <= prev.endT) {
      prev.endT = Math.max(prev.endT, endT);
    } else {
      activeWindows.push({ startT, endT });
    }
  }

  function inferActiveExploration(event, opts) {
    if (opts && typeof opts.activeExploration === 'boolean') {
      return opts.activeExploration;
    }
    if (event && typeof event.activeExploration === 'boolean') {
      return event.activeExploration;
    }
    const type = event && event.type;
    if (
      type === 'pointer_down' ||
      type === 'pointer_move' ||
      type === 'dial' ||
      type === 'squeeze' ||
      type === 'button_down' ||
      type === 'action'
    ) {
      return true;
    }
    if (type === 'imu') {
      const ax = Number.isFinite(event.ax) ? event.ax : 0;
      const ay = Number.isFinite(event.ay) ? event.ay : 0;
      return Math.hypot(ax, ay) > 0.02 || pointerHeld || buttonHeld;
    }
    return false;
  }

  function updateExplorationWindows(t, event, activeExploration) {
    const type = event && event.type;

    if (type === 'pointer_down') {
      pointerHeld = activeExploration;
    } else if (type === 'pointer_up' || type === 'pointer_cancel') {
      pointerHeld = false;
    } else if (type === 'button_down') {
      buttonHeld = activeExploration;
    } else if (type === 'button_up') {
      buttonHeld = false;
    } else if (activeExploration === false) {
      // Explicit inactive marker closes pulse span cleanly
      if (pulseWindowStartT !== null) {
        appendMergedWindow(pulseWindowStartT, Math.min(t, pulseWindowEndT));
        pulseWindowStartT = null;
        pulseWindowEndT = null;
      }
    }

    const currentlyHeld = pointerHeld || buttonHeld;
    if (currentlyHeld) {
      if (holdStartT === null) {
        holdStartT = t;
      }
    } else if (holdStartT !== null) {
      appendMergedWindow(holdStartT, t);
      holdStartT = null;
    }

    if (activeExploration && !currentlyHeld) {
      if (pulseWindowStartT === null) {
        pulseWindowStartT = t;
        pulseWindowEndT = t + PULSE_WINDOW_MS;
      } else if (t <= pulseWindowEndT) {
        pulseWindowEndT = Math.max(pulseWindowEndT, t + PULSE_WINDOW_MS);
      } else {
        appendMergedWindow(pulseWindowStartT, pulseWindowEndT);
        pulseWindowStartT = t;
        pulseWindowEndT = t + PULSE_WINDOW_MS;
      }
    }
  }

  function computeSnapshotWindows(now) {
    const merged = activeWindows.map((w) => ({ startT: w.startT, endT: w.endT }));

    const mergeInto = (list, startT, endT) => {
      if (!(endT > startT)) return;
      const last = list[list.length - 1];
      if (last && startT <= last.endT) {
        last.endT = Math.max(last.endT, endT);
      } else {
        list.push({ startT, endT });
      }
    };

    const extra = [];
    if (holdStartT !== null && now > holdStartT) {
      extra.push({ startT: holdStartT, endT: now });
    }
    if (pulseWindowStartT !== null && pulseWindowEndT !== null) {
      const clampedEnd = Math.min(now, pulseWindowEndT);
      if (clampedEnd > pulseWindowStartT) {
        extra.push({ startT: pulseWindowStartT, endT: clampedEnd });
      }
    }
    extra.sort((a, b) => a.startT - b.startT);

    const combined = [];
    let i = 0;
    let j = 0;
    while (i < merged.length || j < extra.length) {
      const pickMerged =
        j >= extra.length || (i < merged.length && merged[i].startT <= extra[j].startT);
      const next = pickMerged ? merged[i++] : extra[j++];
      mergeInto(combined, next.startT, next.endT);
    }

    const formattedWindows = combined.map((w) => ({
      startT: w.startT,
      endT: w.endT,
      durationMs: w.endT - w.startT,
    }));

    const silentWindows = [];
    let hIdx = 0;
    for (let wIdx = 0; wIdx < formattedWindows.length; wIdx += 1) {
      const win = formattedWindows[wIdx];
      while (hIdx < rawHaptics.length && rawHaptics[hIdx].t < win.startT) {
        hIdx += 1;
      }
      let cursor = win.startT;
      let k = hIdx;
      while (k < rawHaptics.length && rawHaptics[k].t <= win.endT) {
        const ht = rawHaptics[k].t;
        if (ht > cursor) {
          silentWindows.push({
            startT: cursor,
            endT: ht,
            durationMs: ht - cursor,
          });
        }
        if (ht > cursor) {
          cursor = ht;
        }
        k += 1;
      }
      if (win.endT > cursor) {
        silentWindows.push({
          startT: cursor,
          endT: win.endT,
          durationMs: win.endT - cursor,
        });
      }
    }

    let activeExplorationMs = 0;
    for (let wIdx = 0; wIdx < formattedWindows.length; wIdx += 1) {
      activeExplorationMs += formattedWindows[wIdx].durationMs;
    }

    let maxSilentGapMs = 0;
    for (let sIdx = 0; sIdx < silentWindows.length; sIdx += 1) {
      if (silentWindows[sIdx].durationMs > maxSilentGapMs) {
        maxSilentGapMs = silentWindows[sIdx].durationMs;
      }
    }

    return {
      activeWindows: formattedWindows,
      silentWindows,
      activeExplorationMs,
      maxSilentGapMs,
    };
  }

  function rawEmit(type, meta) {
    if (disposed) return;
    const t = clock.now();
    const cue =
      meta && typeof meta.cue === 'string' && meta.cue.length > 0
        ? meta.cue
        : meta && meta.cue != null
          ? String(meta.cue)
          : null;

    const prevRaw = rawHaptics.length > 0 ? rawHaptics[rawHaptics.length - 1] : null;
    const smeared = Boolean(
      actuatorFilter && prevRaw !== null && t - prevRaw.t < HARD_COLLISION_MS
    );

    const rawEvent = { t, type, cue, smeared };
    rawHaptics.push(rawEvent);

    const blindEvent = human.perceiveHaptic(rawEvent);
    blindHaptics.push(blindEvent);
  }

  const hapticsCtx = createHapticsContext(clock, rawEmit);

  const engineConfig = { ...(options.config || {}) };
  if (variant !== null && variant !== undefined && engineConfig.variant === undefined) {
    engineConfig.variant = variant;
  }

  const engine = modeDef.create(
    {
      clock,
      haptics: hapticsCtx,
      rng: engineRng,
      onStateChange: typeof options.onStateChange === 'function' ? options.onStateChange : () => {},
    },
    engineConfig
  );
  validateModeInstance(engine, modeDef.id);

  function drainBlindHaptics() {
    const slice = blindHaptics.slice(blindCursor).map(cloneShallow);
    blindCursor = blindHaptics.length;
    return slice;
  }

  function assertAlive() {
    if (disposed) {
      throw new Error(`Session for mode "${modeDef.id}" has already been disposed`);
    }
  }

  function getBlindHeader() {
    return {
      id: modeDef.id,
      name: modeDef.name,
      kind: modeDef.kind,
      variant,
      inputs: [...modeDef.inputs],
      blindInstructions: modeDef.blindInstructions,
      t: clock.now(),
    };
  }

  function input(event, opts = {}) {
    assertAlive();
    const t = clock.now();
    const activeExploration = inferActiveExploration(event, opts);
    const perturbed = human.perturbInput(event);

    inputLog.push({
      t,
      event: cloneShallow(event),
      perturbedEvent: cloneShallow(perturbed),
      activeExploration,
    });
    updateExplorationWindows(t, perturbed, activeExploration);

    engine.onInput(perturbed);
    return drainBlindHaptics();
  }

  function advance(ms, opts = {}) {
    assertAlive();
    const actualMs =
      opts && opts.jitter && human.profile.timingJitterMs > 0 ? human.jitterDelay(ms) : ms;
    clock.advance(actualMs);
    return drainBlindHaptics();
  }

  function step(event, advanceMs = 0, opts = {}) {
    assertAlive();
    const fromInput = input(event, opts);
    const fromAdvance = advance(advanceMs, opts);
    return {
      t: clock.now(),
      haptics: fromInput.concat(fromAdvance),
    };
  }

  function readBlindHaptics(sinceIndex = 0) {
    const start = Number.isFinite(sinceIndex) && sinceIndex > 0 ? Math.floor(sinceIndex) : 0;
    return blindHaptics.slice(start).map(cloneShallow);
  }

  function getRawTrace() {
    const durationMs = clock.now();
    const windows = computeSnapshotWindows(durationMs);
    return {
      durationMs,
      rawHaptics: rawHaptics.map(cloneShallow),
      blindHaptics: blindHaptics.map(cloneShallow),
      inputLog: inputLog.map((entry) => ({
        t: entry.t,
        event: cloneShallow(entry.event),
        perturbedEvent: cloneShallow(entry.perturbedEvent),
        activeExploration: entry.activeExploration,
      })),
      actuator: analyzeActuatorTrace(rawHaptics, durationMs),
      activeWindows: windows.activeWindows,
      silentWindows: windows.silentWindows,
      activeExplorationMs: windows.activeExplorationMs,
      maxSilentGapMs: windows.maxSilentGapMs,
    };
  }

  function getEvalState() {
    return engine.getEvalState();
  }

  function getVisualState() {
    return engine.getVisualState();
  }

  function dispose() {
    if (disposed) {
      return { leakedTimers: 0 };
    }
    engine.dispose();
    const leakedTimers = clock.pendingCount();
    clock.clearAll();
    disposed = true;
    return { leakedTimers };
  }

  return {
    getBlindHeader,
    input,
    advance,
    step,
    readBlindHaptics,
    getRawTrace,
    getEvalState,
    getVisualState,
    dispose,
  };
}

module.exports = {
  createSession,
};
