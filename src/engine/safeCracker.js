'use strict';

const DIAL_STEPS = 24;
const PIXELS_PER_TICK = 18;
const PINS_PER_VAULT = 3;

function circularDist(a, b) {
  const raw = Math.abs(a - b) % DIAL_STEPS;
  return Math.min(raw, DIAL_STEPS - raw);
}

function randomTarget(avoid, rng) {
  let next = Math.floor(rng() * DIAL_STEPS);
  let guard = 0;
  while (circularDist(next, avoid) < 5 && guard < 30) {
    next = Math.floor(rng() * DIAL_STEPS);
    guard += 1;
  }
  return next;
}

const SafeCrackerMode = {
  id: 'safe',
  name: 'Safe Cracker',
  kind: 'puzzle',
  variants: ['chill', 'strict'],
  inputs: [
    'pointer_down',
    'pointer_move',
    'pointer_up',
    'pointer_cancel',
    'dial',
    'action',
    'resize',
  ],
  blindInstructions:
    'Slide your thumb slowly left and right across the 24-notch dial. Normal notches give light ticks, one notch away from the secret tumbler feels like stronger tension, and landing directly on the tumbler gives a heavy double-thunk. Lift your thumb on the double-thunk to lock a pin; lock 3 pins to crack the vault.',

  create(ctx, config = {}) {
    const cfg = config || {};
    const rng = ctx.rng;
    const haptics = ctx.haptics;

    let widthPx =
      Number.isFinite(cfg.widthPx) && cfg.widthPx > 0 ? cfg.widthPx : 360;
    let heightPx =
      Number.isFinite(cfg.heightPx) && cfg.heightPx > 0 ? cfg.heightPx : 420;

    let strictMode =
      cfg.variant === 'strict' ? true : Boolean(cfg.strictMode);
    let detent = 0;
    let target = randomTarget(0, rng);
    let pinsLocked = 0;
    let vaultsCracked = 0;
    let statusText = 'Slide thumb slowly to feel the heavy tumbler click';
    let isTouching = false;

    let startDetent = 0;
    let downX = 0;
    let downY = 0;
    let moved = false;
    let cancelPattern = null;

    function cancelActivePattern() {
      if (cancelPattern) {
        cancelPattern();
        cancelPattern = null;
      }
    }

    function triggerDetentHaptic(newDetent) {
      const dist = circularDist(newDetent, target);
      if (dist === 0) {
        cancelActivePattern();
        cancelPattern = haptics.playPattern([
          { type: 'heavy', delay: 55, cue: 'tumbler_hit_1' },
          { type: 'rigid', delay: 0, cue: 'tumbler_hit_2' },
        ]);
      } else if (dist === 1) {
        haptics.medium({ cue: 'detent_near' });
      } else {
        haptics.tick({ cue: 'detent_tick' });
      }
    }

    function onInput(event) {
      if (!event || typeof event.type !== 'string') return;

      switch (event.type) {
        case 'resize': {
          if (Number.isFinite(event.widthPx) && event.widthPx > 0) {
            widthPx = event.widthPx;
          }
          if (Number.isFinite(event.heightPx) && event.heightPx > 0) {
            heightPx = event.heightPx;
          }
          break;
        }

        case 'pointer_down': {
          startDetent = detent;
          downX = Number.isFinite(event.x) ? event.x : 0;
          downY = Number.isFinite(event.y) ? event.y : 0;
          moved = false;
          isTouching = true;
          haptics.light({ cue: 'touch_start' });
          break;
        }

        case 'pointer_move': {
          if (!isTouching) return;
          const x = Number.isFinite(event.x) ? event.x : downX;
          const y = Number.isFinite(event.y) ? event.y : downY;
          const dx = (x - downX) * widthPx;
          const dy = (y - downY) * heightPx;
          // Combine horizontal drag with minor vertical contribution for natural thumb arcs
          const deltaTicks = Math.round((dx - dy * 0.25) / PIXELS_PER_TICK);
          const rawNext =
            ((startDetent + deltaTicks) % DIAL_STEPS + DIAL_STEPS) % DIAL_STEPS;
          const next = rawNext === 0 ? 0 : rawNext;
          if (next !== detent) {
            detent = next;
            moved = true;
            triggerDetentHaptic(next);
          }
          break;
        }

        case 'pointer_up': {
          if (!isTouching) return;
          isTouching = false;
          if (!moved) return;

          const dist = circularDist(detent, target);
          if (dist === 0) {
            const nextPins = pinsLocked + 1;
            if (nextPins >= PINS_PER_VAULT) {
              vaultsCracked += 1;
              pinsLocked = 0;
              target = randomTarget(detent, rng);
              statusText = 'Vault cracked! New combination set';
              cancelActivePattern();
              cancelPattern = haptics.playPattern([
                { type: 'success', delay: 140, cue: 'vault_crack' },
                { type: 'heavy', delay: 110, cue: 'vault_crack' },
                { type: 'success', delay: 0, cue: 'vault_crack' },
              ]);
            } else {
              pinsLocked = nextPins;
              target = randomTarget(detent, rng);
              statusText = `Pin ${nextPins}/${PINS_PER_VAULT} locked! Find the next tumbler`;
              haptics.success({ cue: 'pin_lock' });
            }
          } else if (strictMode && pinsLocked > 0) {
            pinsLocked = 0;
            statusText = 'Slipped! Strict mode reset all pins';
            haptics.error({ cue: 'strict_reset' });
          } else {
            statusText = 'Missed tumbler — keep sweeping slowly';
            haptics.soft({ cue: 'miss' });
          }
          break;
        }

        case 'pointer_cancel': {
          isTouching = false;
          break;
        }

        case 'dial': {
          const deltaSteps = Number.isFinite(event.deltaSteps)
            ? Math.round(event.deltaSteps)
            : 0;
          const rawNext =
            ((detent + deltaSteps) % DIAL_STEPS + DIAL_STEPS) % DIAL_STEPS;
          const next = rawNext === 0 ? 0 : rawNext;
          if (next !== detent) {
            detent = next;
            moved = true;
            triggerDetentHaptic(next);
          }
          break;
        }

        case 'action': {
          if (event.name === 'toggle_strict') {
            strictMode = !strictMode;
            haptics.tick({ cue: 'toggle_strict' });
          } else if (event.name === 'set_strict') {
            strictMode = Boolean(event.value);
            haptics.tick({ cue: 'toggle_strict' });
          }
          break;
        }

        default:
          break;
      }
    }

    function getVisualState() {
      const dist = circularDist(detent, target);
      return {
        detent,
        target,
        dist,
        onTarget: dist === 0,
        pinsLocked,
        pinsPerVault: PINS_PER_VAULT,
        dialSteps: DIAL_STEPS,
        vaultsCracked,
        strictMode,
        statusText,
        isTouching,
      };
    }

    function getEvalState() {
      const dist = circularDist(detent, target);
      return {
        score: vaultsCracked,
        progress: vaultsCracked * PINS_PER_VAULT + pinsLocked,
        pinsLocked,
        vaultsCracked,
        strictMode,
        detent,
        target,
        dist,
        isTouching,
        activeExploration: isTouching,
        phase: isTouching ? 'dragging' : 'idle',
      };
    }

    function dispose() {
      cancelActivePattern();
    }

    return {
      onInput,
      getVisualState,
      getEvalState,
      dispose,
    };
  },
};

module.exports = SafeCrackerMode;
