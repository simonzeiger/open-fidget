'use strict';

/**
 * LRA (Linear Resonant Actuator) physics, signal hygiene, and perceptual labeling model.
 * Models physical actuator collision/smearing limits (e.g. iPhone Taptic Engine / DRV2605L)
 * and estimates acoustic buzz density and cue-to-type distinguishability.
 */

const HARD_COLLISION_MS = 35;
const TIGHT_GAP_MS = 55;

const HAPTIC_ENERGY = Object.freeze({
  tick: 0.15,
  soft: 0.25,
  light: 0.35,
  medium: 0.6,
  rigid: 0.8,
  heavy: 1.0,
  warning: 0.85,
  success: 0.75,
  error: 0.95,
});

const PERCEPTUAL_LABEL = Object.freeze({
  tick: 'tiny crisp tick',
  soft: 'gentle soft bump',
  light: 'light tap',
  medium: 'firm bump',
  rigid: 'sharp metallic click',
  heavy: 'heavy deep thud',
  success: 'rising double-chime buzz',
  warning: 'double warning buzz',
  error: 'harsh triple buzz',
});

function roundMetric(value) {
  return Math.round(value * 1e6) / 1e6;
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) {
    throw new TypeError('events must be an array');
  }
  const indexed = events.map((ev, origIndex) => ({
    ev,
    origIndex,
    t: Number.isFinite(ev && ev.t) ? ev.t : 0,
  }));
  indexed.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.origIndex - b.origIndex));
  return indexed;
}

/**
 * Models physical LRA behavior on a sequence of raw haptic events.
 * Pulses arriving less than HARD_COLLISION_MS after the preceding pulse are
 * marked `smeared: true` without mutating the input array or objects.
 *
 * @param {Array<{t: number, type: string, cue?: string|null, smeared?: boolean}>} events
 * @returns {Array<{t: number, type: string, smeared: boolean}>}
 */
function applyActuatorFilter(events) {
  const ordered = normalizeEvents(events);
  const filtered = [];
  let prevT = null;

  for (let i = 0; i < ordered.length; i += 1) {
    const { ev, t } = ordered[i];
    const gapMs = prevT === null ? Infinity : t - prevT;
    const isCollision = prevT !== null && gapMs < HARD_COLLISION_MS;
    filtered.push({
      ...ev,
      t,
      smeared: Boolean((ev && ev.smeared) || isCollision),
    });
    prevT = t;
  }

  return filtered;
}

/**
 * Analyzes a raw haptic trace for LRA collisions, tight gaps, acoustic buzz density,
 * type distribution, and cue-to-type mapping.
 *
 * @param {Array<{t: number, type: string, cue?: string|null}>} events
 * @param {number} durationMs
 */
function analyzeActuatorTrace(events, durationMs) {
  const ordered = normalizeEvents(events);
  const totalPulses = ordered.length;
  const hardCollisions = [];
  const tightGaps = [];
  const typeCounts = {};
  const cueTypeSets = new Map();

  let minGapMs = null;
  let totalEnergy = 0;
  let unlabeledPulses = 0;

  for (let i = 0; i < ordered.length; i += 1) {
    const { ev, origIndex, t } = ordered[i];
    const type = ev && typeof ev.type === 'string' ? ev.type : 'unknown';
    const cue = ev && typeof ev.cue === 'string' && ev.cue.length > 0 ? ev.cue : null;

    typeCounts[type] = (typeCounts[type] || 0) + 1;
    totalEnergy += HAPTIC_ENERGY[type] ?? 0.5;

    if (cue !== null) {
      if (!cueTypeSets.has(cue)) {
        cueTypeSets.set(cue, new Set());
      }
      cueTypeSets.get(cue).add(type);
    } else {
      unlabeledPulses += 1;
    }

    if (i > 0) {
      const prev = ordered[i - 1];
      const prevType = prev.ev && typeof prev.ev.type === 'string' ? prev.ev.type : 'unknown';
      const prevCue =
        prev.ev && typeof prev.ev.cue === 'string' && prev.ev.cue.length > 0
          ? prev.ev.cue
          : null;
      const gapMs = roundMetric(Math.max(0, t - prev.t));

      if (minGapMs === null || gapMs < minGapMs) {
        minGapMs = gapMs;
      }

      if (gapMs < HARD_COLLISION_MS) {
        hardCollisions.push({
          index: origIndex,
          t,
          prevT: prev.t,
          gapMs,
          prevType,
          type,
          prevCue,
          cue,
        });
      } else if (gapMs < TIGHT_GAP_MS) {
        tightGaps.push({
          index: origIndex,
          t,
          prevT: prev.t,
          gapMs,
          prevType,
          type,
          prevCue,
          cue,
        });
      }
    }
  }

  let effectiveDurationMs = 0;
  if (Number.isFinite(durationMs) && durationMs > 0) {
    effectiveDurationMs = durationMs;
  } else if (durationMs === undefined || durationMs === null) {
    if (ordered.length >= 2) {
      effectiveDurationMs = Math.max(0, ordered[ordered.length - 1].t - ordered[0].t);
    }
  }

  const durationSec = effectiveDurationMs > 0 ? effectiveDurationMs / 1000 : 0;
  const pulsesPerSecond = durationSec > 0 ? roundMetric(totalPulses / durationSec) : 0;
  const cleanEnergy = roundMetric(totalEnergy);
  const energyPerSecond = durationSec > 0 ? roundMetric(cleanEnergy / durationSec) : 0;

  let acousticRisk = 'low';
  if (
    energyPerSecond >= 4.5 ||
    pulsesPerSecond >= 10 ||
    hardCollisions.length >= 3
  ) {
    acousticRisk = 'high';
  } else if (
    energyPerSecond >= 2.2 ||
    pulsesPerSecond >= 5.5 ||
    hardCollisions.length > 0 ||
    tightGaps.length >= 3
  ) {
    acousticRisk = 'moderate';
  }

  const cueToTypes = {};
  for (const [cue, set] of cueTypeSets.entries()) {
    cueToTypes[cue] = Array.from(set);
  }

  return {
    totalPulses,
    hardCollisions,
    tightGaps,
    pulsesPerSecond,
    energyPerSecond,
    totalEnergy: cleanEnergy,
    acousticRisk,
    minGapMs,
    typeCounts,
    cueToTypes,
    unlabeledPulses,
  };
}

module.exports = {
  HARD_COLLISION_MS,
  TIGHT_GAP_MS,
  HAPTIC_ENERGY,
  PERCEPTUAL_LABEL,
  analyzeActuatorTrace,
  applyActuatorFilter,
};
