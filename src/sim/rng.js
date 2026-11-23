'use strict';

/**
 * Deterministic seeded PRNG (mulberry32) for reproducible playtest simulations,
 * plus a Math.random wrapper for real-device usage.
 */

function createRng(seed = 1) {
  let state = (seed >>> 0) || 1;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createMathRng() {
  return () => Math.random();
}

module.exports = {
  createRng,
  createMathRng,
};
