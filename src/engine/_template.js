'use strict';

/**
 * Open Fidget — Reference Mode Template ("Pulse Catch")
 *
 * Copy this file (e.g. `cp src/engine/_template.js src/engine/myNewMode.js`) to
 * prototype a brand-new eyes-free haptic game or fidget in minutes.
 *
 * Mode Contract rules:
 * 1. Pure CommonJS with ZERO React Native or Node-only dependencies so the same
 *    module runs identically in Expo Go (Metro) and headless Node validation.
 * 2. Use ONLY `ctx.clock` for timers (`setTimeout`, `clearTimeout`, `now`) and
 *    `ctx.rng()` for randomness so simulations are 100% deterministic.
 * 3. Emit haptics ONLY through `ctx.haptics` (`tick`, `light`, `medium`, `heavy`,
 *    `rigid`, `soft`, `success`, `warning`, `error`, or `playPattern`) and tag
 *    every pulse with a descriptive `{ cue: '...' }` for actuator diagnostics.
 * 4. Keep `dispose()` spotless: cancel every pending timer/pattern so
 *    `leakedTimers === 0`.
 *
 * Validate and blind-playtest your prototype before registering it:
 *   node scripts/playtest.js start ./src/engine/_template.js
 *   node scripts/validate.js ./src/engine/_template.js
 */

const DEFAULT_BEAT_MS = 420;
const DEFAULT_WINDOW_MS = 500;
const COOLDOWN_MS = 450;

const PulseCatchMode = {
  // Unique short id used by registry, CLI (`validate.js`, `playtest.js`), and UI
  id: 'pulse-catch',
  name: 'Pulse Catch (Template)',
  // One of: 'puzzle' | 'fidget' | 'pacer'
  kind: 'puzzle',
  // Supported variants; passed to create(ctx, { variant })
  variants: ['standard'],
  // Normalized input types handled by onInput(event)
  inputs: ['pointer_down', 'pointer_up', 'pointer_cancel', 'button_down', 'button_up', 'action'],
  // Shown to blind playtesters BEFORE they play — must explain the entire game eyes-free
  blindInstructions:
    'Tap once anywhere to start a round. Feel the 3-beat countdown (tick, tick, firm bump), wait one beat for the heavy target thud, then tap within 0.5s to catch it and build a streak. Do not tap early during the countdown!',

  /**
   * Instantiates a fresh mode session.
   *
   * @param {object} ctx
   * @param {object} ctx.clock - Virtual or real clock (`now`, `setTimeout`, `clearTimeout`)
   * @param {object} ctx.haptics - Haptics emitter (`tick`, `light`, `medium`, `heavy`, `rigid`, `soft`, `success`, `warning`, `error`, `playPattern`)
   * @param {() => number} ctx.rng - Deterministic PRNG in [0, 1)
   * @param {(visualState: object) => void} [ctx.onStateChange] - Optional UI notification callback
   * @param {object} [config] - Optional config (`{ variant, beatMs, windowMs }`)
   */
  create(ctx, config = {}) {
    const cfg = config || {};
    const beatMs =
      Number.isFinite(cfg.beatMs) && cfg.beatMs >= 150 ? cfg.beatMs : DEFAULT_BEAT_MS;
    const windowMs =
      Number.isFinite(cfg.windowMs) && cfg.windowMs >= 150 ? cfg.windowMs : DEFAULT_WINDOW_MS;

    // Internal state
    let phase = 'idle'; // 'idle' | 'countdown' | 'window' | 'caught' | 'miss'
    let beatIndex = 0; // 0..3 during countdown, 4 on target beat
    let streak = 0;
    let bestStreak = 0;
    let catches = 0;
    let attempts = 0;
    let lastReactionMs = null;
    let targetAt = null;
    let isTouching = false;
    let disposed = false;

    // Timer handles (always cleared in cleanupTimers / dispose)
    let cancelCountdown = null;
    let windowTimer = null;
    let resetTimer = null;

    function notifyStateChange() {
      if (!disposed && typeof ctx.onStateChange === 'function') {
        ctx.onStateChange(getVisualState());
      }
    }

    function cleanupTimers() {
      if (cancelCountdown) {
        cancelCountdown();
        cancelCountdown = null;
      }
      if (windowTimer !== null) {
        ctx.clock.clearTimeout(windowTimer);
        windowTimer = null;
      }
      if (resetTimer !== null) {
        ctx.clock.clearTimeout(resetTimer);
        resetTimer = null;
      }
    }

    function scheduleResetToIdle() {
      if (resetTimer !== null) {
        ctx.clock.clearTimeout(resetTimer);
      }
      resetTimer = ctx.clock.setTimeout(() => {
        resetTimer = null;
        if (disposed) return;
        phase = 'idle';
        beatIndex = 0;
        targetAt = null;
        notifyStateChange();
      }, COOLDOWN_MS);
    }

    function startRound() {
      if (disposed) return;
      cleanupTimers();

      phase = 'countdown';
      beatIndex = 0;
      targetAt = null;

      // Immediate subtle tactile confirmation that the round began
      ctx.haptics.light({ cue: 'round_start' });
      notifyStateChange();

      // Rhythmic 3-beat countdown followed by the heavy target beat.
      // Notice every pulse gap >= 360ms (> 55ms LRA threshold) to avoid actuator smearing.
      const steps = [
        {
          // Leading pause so the start tap and beat 1 stay cleanly separated
          delay: beatMs,
        },
        {
          type: 'tick',
          cue: 'countdown_1',
          delay: beatMs,
          onStep: () => {
            beatIndex = 1;
            notifyStateChange();
          },
        },
        {
          type: 'tick',
          cue: 'countdown_2',
          delay: beatMs,
          onStep: () => {
            beatIndex = 2;
            notifyStateChange();
          },
        },
        {
          type: 'medium',
          cue: 'countdown_3',
          delay: beatMs,
          onStep: () => {
            beatIndex = 3;
            notifyStateChange();
          },
        },
        {
          type: 'heavy',
          cue: 'target_beat',
          delay: 0,
          onStep: () => {
            beatIndex = 4;
            phase = 'window';
            targetAt = ctx.clock.now();
            notifyStateChange();

            windowTimer = ctx.clock.setTimeout(() => {
              windowTimer = null;
              if (disposed || phase !== 'window') return;
              attempts += 1;
              streak = 0;
              phase = 'miss';
              lastReactionMs = null;
              ctx.haptics.error({ cue: 'window_missed' });
              scheduleResetToIdle();
              notifyStateChange();
            }, windowMs);
          },
        },
      ];

      cancelCountdown = ctx.haptics.playPattern(steps, () => {
        cancelCountdown = null;
      });
    }

    function handlePressDown() {
      isTouching = true;

      if (phase === 'idle' || phase === 'caught' || phase === 'miss') {
        startRound();
        return;
      }

      if (phase === 'countdown') {
        cleanupTimers();
        attempts += 1;
        streak = 0;
        phase = 'miss';
        lastReactionMs = null;
        ctx.haptics.warning({ cue: 'early_tap' });
        scheduleResetToIdle();
        notifyStateChange();
        return;
      }

      if (phase === 'window') {
        cleanupTimers();
        const now = ctx.clock.now();
        lastReactionMs = targetAt !== null ? Math.max(0, now - targetAt) : 0;
        attempts += 1;
        catches += 1;
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
        phase = 'caught';
        ctx.haptics.success({ cue: 'catch_success' });
        scheduleResetToIdle();
        notifyStateChange();
      }
    }

    function handlePressUp() {
      isTouching = false;
    }

    /**
     * Handles normalized input events from Expo UI or the headless simulator.
     */
    function onInput(event) {
      if (disposed || !event || typeof event !== 'object') return;

      switch (event.type) {
        case 'pointer_down':
        case 'button_down':
          handlePressDown();
          break;
        case 'pointer_up':
        case 'button_up':
        case 'pointer_cancel':
          handlePressUp();
          break;
        case 'action':
          if (event.name === 'start' || event.name === 'reset') {
            if (event.name === 'reset') {
              streak = 0;
              bestStreak = 0;
              catches = 0;
              attempts = 0;
              lastReactionMs = null;
            }
            startRound();
          }
          break;
        default:
          break;
      }
    }

    /**
     * UI-safe snapshot (never exposed to blind playtesters).
     */
    function getVisualState() {
      return {
        phase,
        beatIndex,
        maxBeats: 3,
        streak,
        bestStreak,
        catches,
        attempts,
        lastReactionMs,
        isTouching,
      };
    }

    /**
     * Ground-truth snapshot for automated validators and post-playtest debriefs.
     * Include `score`, `progress`, `phase`, and `activeExploration` for consistent scoring.
     */
    function getEvalState() {
      return {
        score: catches,
        progress: catches * 4 + beatIndex,
        streak,
        bestStreak,
        catches,
        attempts,
        lastReactionMs,
        phase,
        beatIndex,
        windowOpen: phase === 'window',
        isTouching,
        activeExploration: isTouching || phase === 'countdown' || phase === 'window',
      };
    }

    /**
     * Cleans up all active timers and patterns. Must leave 0 pending timers.
     */
    function dispose() {
      disposed = true;
      isTouching = false;
      cleanupTimers();
    }

    return {
      onInput,
      getVisualState,
      getEvalState,
      dispose,
    };
  },
};

module.exports = PulseCatchMode;
