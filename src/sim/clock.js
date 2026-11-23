'use strict';

/**
 * Deterministic event-driven virtual clock for headless simulation,
 * plus a real-time clock wrapper for React Native / Expo Go.
 */

const DEFAULT_MAX_CALLBACKS_PER_ADVANCE = 10000;

function createVirtualClock(options = {}) {
  const maxCallbacks = options.maxCallbacksPerAdvance ?? DEFAULT_MAX_CALLBACKS_PER_ADVANCE;
  let currentTime = options.startTime ?? 0;
  let nextId = 1;
  let nextSeq = 1;
  const timers = new Map();

  function schedule(fn, delayMs, isInterval) {
    if (typeof fn !== 'function') {
      throw new TypeError('Clock callback must be a function');
    }
    const rawDelay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
    const intervalMs = isInterval ? Math.max(1, rawDelay) : 0;
    const id = nextId++;
    timers.set(id, {
      id,
      seq: nextSeq++,
      fn,
      fireAt: currentTime + (isInterval ? intervalMs : rawDelay),
      intervalMs,
      isInterval,
      active: true,
    });
    return id;
  }

  function clear(id) {
    const entry = timers.get(id);
    if (entry) {
      entry.active = false;
      timers.delete(id);
    }
  }

  function findNextDue(targetEnd) {
    let best = null;
    for (const entry of timers.values()) {
      if (!entry.active) continue;
      if (entry.fireAt > targetEnd) continue;
      if (
        !best ||
        entry.fireAt < best.fireAt ||
        (entry.fireAt === best.fireAt && entry.seq < best.seq)
      ) {
        best = entry;
      }
    }
    return best;
  }

  function advance(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`advance(ms) requires a finite non-negative number, got ${ms}`);
    }
    const targetEnd = currentTime + ms;
    let executed = 0;

    while (true) {
      const next = findNextDue(targetEnd);
      if (!next) break;

      executed += 1;
      if (executed > maxCallbacks) {
        throw new Error(
          `VirtualClock runaway guard tripped: exceeded ${maxCallbacks} callbacks in a single advance(${ms}ms)`
        );
      }

      currentTime = next.fireAt;
      if (next.isInterval) {
        next.fireAt = currentTime + next.intervalMs;
        next.seq = nextSeq++;
      } else {
        next.active = false;
        timers.delete(next.id);
      }

      next.fn();
    }

    currentTime = targetEnd;
    return currentTime;
  }

  return {
    now() {
      return currentTime;
    },
    setTimeout(fn, ms = 0) {
      return schedule(fn, ms, false);
    },
    clearTimeout(id) {
      clear(id);
    },
    setInterval(fn, ms = 1) {
      return schedule(fn, ms, true);
    },
    clearInterval(id) {
      clear(id);
    },
    advance,
    pendingCount() {
      return timers.size;
    },
    clearAll() {
      for (const entry of timers.values()) {
        entry.active = false;
      }
      timers.clear();
    },
  };
}

function createRealClock() {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
  };
}

module.exports = {
  createVirtualClock,
  createRealClock,
};
