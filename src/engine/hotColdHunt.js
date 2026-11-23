'use strict';

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

const HotColdHuntMode = {
  id: 'hunt',
  name: 'Hot-or-Cold Sonar',
  kind: 'puzzle',
  variants: ['standard'],
  inputs: ['pointer_down', 'pointer_move', 'pointer_up', 'pointer_cancel'],
  blindInstructions:
    'Touch and sweep across the pad. Feel the haptic heartbeat speed up and sharpen from soft (cold) to light (warm) to medium (hot) to rapid rigid pulses (locked on). Hold for ~0.55s or lift your finger while locked on to capture the hidden beacon.',

  create(ctx, config = {}) {
    function randomBeacon(prev) {
      let x = 0.16 + ctx.rng() * 0.68;
      let y = 0.16 + ctx.rng() * 0.68;
      let guard = 0;
      while (prev && Math.hypot(x - prev.x, y - prev.y) < 0.35 && guard < 25) {
        x = 0.16 + ctx.rng() * 0.68;
        y = 0.16 + ctx.rng() * 0.68;
        guard += 1;
      }
      return { x, y };
    }

    let beacon = randomBeacon(null);
    let foundCount = 0;
    let finger = null;
    let tempLabel = 'TOUCH & SWEEP TO SENSE THE BEACON';
    let pulseTimer = null;
    let lockStart = null;
    let disposed = false;

    function getDistance(pt) {
      if (!pt) return 1;
      return Math.hypot(pt.x - beacon.x, pt.y - beacon.y);
    }

    function getVisualState() {
      return {
        beacon: { ...beacon },
        foundCount,
        finger: finger ? { ...finger } : null,
        dist: finger ? getDistance(finger) : 1,
        tempLabel,
      };
    }

    function getEvalState() {
      const dist = finger ? getDistance(finger) : 1;
      return {
        score: foundCount,
        progress: foundCount,
        foundCount,
        beacon: { ...beacon },
        finger: finger ? { ...finger } : null,
        dist,
        isTouching: Boolean(finger),
        activeExploration: Boolean(finger),
        phase: finger ? (dist <= 0.11 ? 'locked' : 'sweeping') : 'idle',
      };
    }

    function stopPulse() {
      if (pulseTimer !== null) {
        ctx.clock.clearTimeout(pulseTimer);
        pulseTimer = null;
      }
      lockStart = null;
    }

    function captureBeacon() {
      stopPulse();
      ctx.haptics.success({ cue: 'beacon_capture' });
      foundCount += 1;
      beacon = randomBeacon(beacon);
      tempLabel = 'BEACON CAPTURED! NEW SIGNAL HIDDEN';
    }

    function schedulePulse() {
      stopPulse();

      function runLoop(isAsyncTick) {
        if (disposed) return;
        const pt = finger;
        if (!pt) {
          pulseTimer = null;
          return;
        }

        const prevTempLabel = tempLabel;
        const prevFoundCount = foundCount;
        const prevBeacon = beacon;

        const d = getDistance(pt);
        let interval = 720;

        if (d <= 0.11) {
          ctx.haptics.rigid({ cue: 'sonar_locked' });
          interval = 100;
          tempLabel = 'LOCKED ON — HOLD OR LIFT TO CAPTURE!';
          if (lockStart === null) {
            lockStart = ctx.clock.now();
          } else if (ctx.clock.now() - lockStart >= 550) {
            captureBeacon();
            // Resume gentle sonar if finger stays down
            pulseTimer = ctx.clock.setTimeout(() => runLoop(true), 480);
            if (isAsyncTick && typeof ctx.onStateChange === 'function') {
              ctx.onStateChange(getVisualState());
            }
            return;
          }
        } else {
          lockStart = null;
          if (d <= 0.24) {
            ctx.haptics.medium({ cue: 'sonar_hot' });
            interval = 185;
            tempLabel = 'BURNING HOT';
          } else if (d <= 0.42) {
            ctx.haptics.light({ cue: 'sonar_warm' });
            interval = 340;
            tempLabel = 'WARM — GETTING CLOSER';
          } else {
            ctx.haptics.soft({ cue: 'sonar_cold' });
            interval = 680;
            tempLabel = 'COLD — KEEP SWEEPING';
          }
        }

        pulseTimer = ctx.clock.setTimeout(() => runLoop(true), interval);

        if (
          isAsyncTick &&
          typeof ctx.onStateChange === 'function' &&
          (tempLabel !== prevTempLabel || foundCount !== prevFoundCount || beacon !== prevBeacon)
        ) {
          ctx.onStateChange(getVisualState());
        }
      }

      runLoop(false);
    }

    function onInput(event) {
      if (disposed || !event || typeof event.type !== 'string') return;

      switch (event.type) {
        case 'pointer_down': {
          finger = { x: clamp01(event.x), y: clamp01(event.y) };
          schedulePulse();
          break;
        }
        case 'pointer_move': {
          finger = { x: clamp01(event.x), y: clamp01(event.y) };
          break;
        }
        case 'pointer_up': {
          const pt = finger;
          const onTarget = Boolean(pt && getDistance(pt) <= 0.12);
          finger = null;
          if (onTarget) {
            captureBeacon();
          } else {
            stopPulse();
            tempLabel = 'TOUCH & SWEEP TO SENSE THE BEACON';
          }
          break;
        }
        case 'pointer_cancel': {
          finger = null;
          stopPulse();
          break;
        }
        default:
          break;
      }
    }

    function dispose() {
      disposed = true;
      finger = null;
      stopPulse();
    }

    return {
      onInput,
      getVisualState,
      getEvalState,
      dispose,
    };
  },
};

module.exports = HotColdHuntMode;
