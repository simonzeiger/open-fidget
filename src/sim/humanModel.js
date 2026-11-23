'use strict';

/**
 * Virtual human thumb, motor timing jitter, IMU hand noise, and perceptual haptic
 * confusion model. Includes strict anti-leak stripping so blind playtesters never
 * observe internal `cue` tags or ground-truth game metadata.
 */

const { PERCEPTUAL_LABEL } = require('./actuator');
const { createRng } = require('./rng');

const HUMAN_PROFILES = Object.freeze({
  ideal: Object.freeze({
    name: 'ideal',
    timingJitterMs: 0,
    spatialDrift: 0,
    tiltNoise: 0,
    confusionRate: 0,
  }),
  typical: Object.freeze({
    name: 'typical',
    timingJitterMs: 25,
    spatialDrift: 0.025,
    tiltNoise: 0.03,
    confusionRate: 0.10,
  }),
  pocket: Object.freeze({
    name: 'pocket',
    timingJitterMs: 45,
    spatialDrift: 0.045,
    tiltNoise: 0.06,
    confusionRate: 0.20,
  }),
});

/**
 * Adjacent perceptual confusion clusters:
 * - Light/crisp single impulses confuse among themselves
 * - Stronger single impulses confuse among themselves
 * - Multi-pulse notification signatures rarely confuse (only with other multi-pulse signatures)
 */
const CONFUSION_NEIGHBORS = Object.freeze({
  tick: Object.freeze(['light', 'soft']),
  soft: Object.freeze(['light', 'tick']),
  light: Object.freeze(['tick', 'soft']),
  medium: Object.freeze(['rigid', 'heavy']),
  rigid: Object.freeze(['medium', 'heavy']),
  heavy: Object.freeze(['medium', 'rigid']),
  success: Object.freeze(['warning']),
  warning: Object.freeze(['success', 'error']),
  error: Object.freeze(['warning']),
});

const NOTIFICATION_TYPES = new Set(['success', 'warning', 'error']);

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function resolveProfile(profileOrName) {
  if (profileOrName == null) {
    return HUMAN_PROFILES.ideal;
  }
  if (typeof profileOrName === 'string') {
    const preset = HUMAN_PROFILES[profileOrName];
    if (!preset) {
      throw new Error(
        `Unknown human profile "${profileOrName}". Expected one of: ${Object.keys(HUMAN_PROFILES).join(', ')}`
      );
    }
    return preset;
  }
  if (typeof profileOrName === 'object') {
    const base =
      typeof profileOrName.name === 'string' && HUMAN_PROFILES[profileOrName.name]
        ? HUMAN_PROFILES[profileOrName.name]
        : HUMAN_PROFILES.ideal;
    return Object.freeze({
      name:
        typeof profileOrName.name === 'string' && profileOrName.name.trim()
          ? profileOrName.name
          : 'custom',
      timingJitterMs: Number.isFinite(profileOrName.timingJitterMs)
        ? Math.max(0, profileOrName.timingJitterMs)
        : base.timingJitterMs,
      spatialDrift: Number.isFinite(profileOrName.spatialDrift)
        ? Math.max(0, profileOrName.spatialDrift)
        : base.spatialDrift,
      tiltNoise: Number.isFinite(profileOrName.tiltNoise)
        ? Math.max(0, profileOrName.tiltNoise)
        : base.tiltNoise,
      confusionRate: Number.isFinite(profileOrName.confusionRate)
        ? clamp01(profileOrName.confusionRate)
        : base.confusionRate,
    });
  }
  throw new TypeError('profileOrName must be a profile name string or profile object');
}

/**
 * Creates a stateful human motor + perceptual noise model driven by a dedicated RNG.
 *
 * @param {string|object} [profileOrName='ideal']
 * @param {() => number} [rng]
 */
function createHumanModel(profileOrName = 'ideal', rng) {
  const profile = resolveProfile(profileOrName);
  const rand = typeof rng === 'function' ? rng : createRng(1);

  let gestureActive = false;
  let gestureDriftX = 0;
  let gestureDriftY = 0;

  /**
   * Bounded Irwin-Hall (n=3) bell-shaped noise centered at 0 in [-1, 1).
   */
  function signedBell() {
    return ((rand() + rand() + rand()) / 3) * 2 - 1;
  }

  function reset() {
    gestureActive = false;
    gestureDriftX = 0;
    gestureDriftY = 0;
  }

  function perturbInput(event) {
    if (!event || typeof event !== 'object') {
      return event;
    }

    const out = { ...event };
    const { type } = out;

    if (type === 'pointer_down' || type === 'pointer_move' || type === 'pointer_up') {
      const drift = profile.spatialDrift;
      if (drift > 0) {
        const persistentCap = drift * 0.7;
        const jitterScale = drift * 0.3;

        if (type === 'pointer_down' || !gestureActive) {
          gestureActive = true;
          gestureDriftX = signedBell() * persistentCap;
          gestureDriftY = signedBell() * persistentCap;
        } else if (type === 'pointer_move') {
          gestureDriftX = clamp(
            gestureDriftX + signedBell() * (drift * 0.15),
            -persistentCap,
            persistentCap
          );
          gestureDriftY = clamp(
            gestureDriftY + signedBell() * (drift * 0.15),
            -persistentCap,
            persistentCap
          );
        }

        if (typeof out.x === 'number' && Number.isFinite(out.x)) {
          out.x = clamp01(out.x + gestureDriftX + signedBell() * jitterScale);
        }
        if (typeof out.y === 'number' && Number.isFinite(out.y)) {
          out.y = clamp01(out.y + gestureDriftY + signedBell() * jitterScale);
        }
      }

      if (type === 'pointer_up') {
        gestureActive = false;
        gestureDriftX = 0;
        gestureDriftY = 0;
      }
      return out;
    }

    if (type === 'pointer_cancel') {
      reset();
      return out;
    }

    if (type === 'imu') {
      const tiltNoise = profile.tiltNoise;
      if (tiltNoise > 0) {
        if (typeof out.ax === 'number' && Number.isFinite(out.ax)) {
          out.ax = out.ax + signedBell() * tiltNoise;
        }
        if (typeof out.ay === 'number' && Number.isFinite(out.ay)) {
          out.ay = out.ay + signedBell() * tiltNoise;
        }
      }
      return out;
    }

    return out;
  }

  function jitterDelay(ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
      return 0;
    }
    if (profile.timingJitterMs <= 0) {
      return ms;
    }
    return Math.max(0, Math.round(ms + signedBell() * profile.timingJitterMs));
  }

  function perceiveHaptic(rawEvent) {
    const rawType = rawEvent && typeof rawEvent.type === 'string' ? rawEvent.type : 'tick';
    const smeared = Boolean(rawEvent && rawEvent.smeared);
    let perceivedType = rawType;

    const baseRate = profile.confusionRate;
    if (baseRate > 0 && CONFUSION_NEIGHBORS[rawType]) {
      let effectiveRate = NOTIFICATION_TYPES.has(rawType) ? baseRate * 0.15 : baseRate;
      if (smeared) {
        effectiveRate = Math.min(0.75, effectiveRate * 1.5);
      }
      if (rand() < effectiveRate) {
        const neighbors = CONFUSION_NEIGHBORS[rawType];
        const idx = Math.min(neighbors.length - 1, Math.floor(rand() * neighbors.length));
        perceivedType = neighbors[idx];
      }
    }

    return {
      t: rawEvent ? rawEvent.t : 0,
      type: perceivedType,
      felt: PERCEPTUAL_LABEL[perceivedType] || perceivedType,
      smeared,
    };
  }

  return {
    profile,
    perturbInput,
    jitterDelay,
    perceiveHaptic,
    reset,
  };
}

module.exports = {
  HUMAN_PROFILES,
  CONFUSION_NEIGHBORS,
  createHumanModel,
};
