'use strict';

const HOLD_THRESHOLD_MS = 250;
const INITIAL_LENGTH = 3;

const RhythmEchoMode = {
  id: 'rhythm',
  name: 'Rhythm Echo',
  kind: 'puzzle',
  variants: ['standard'],
  inputs: ['pointer_down', 'pointer_up', 'pointer_cancel', 'button_down', 'button_up', 'action'],
  blindInstructions:
    'Tap once anywhere to start. Feel the sequence of crisp single clicks (DOT) and double thumps (DASH), then echo it back with quick taps for DOT and 0.25s holds for DASH.',

  create(ctx, config = {}) {
    const holdThresholdMs = config.holdThresholdMs ?? HOLD_THRESHOLD_MS;
    const initialLength = config.initialLength ?? INITIAL_LENGTH;

    let phase = 'idle'; // idle | playing | listening | success | fail
    let sequence = [];
    let inputIndex = 0;
    let activeBeat = -1;
    let streak = 0;
    let bestStreak = 0;
    let isHolding = false;
    let holdCrossed = false;

    let pressStart = 0;
    let crossedDash = false;
    let cancelPlayback = null;
    let nextTimer = null;
    let holdTimer = null;
    let disposed = false;

    function makeRandomSymbol() {
      return ctx.rng() < 0.5 ? 'DOT' : 'DASH';
    }

    function makeSequence(len) {
      const seq = [];
      for (let i = 0; i < len; i += 1) {
        seq.push(makeRandomSymbol());
      }
      return seq;
    }

    function getVisualState() {
      return {
        phase,
        sequence: [...sequence],
        inputIndex,
        activeBeat,
        streak,
        bestStreak,
        isHolding,
        holdCrossed,
        holdThresholdMs,
      };
    }

    function getEvalState() {
      return {
        score: streak,
        bestStreak,
        progress: streak * 10 + inputIndex,
        phase,
        sequenceLength: sequence.length,
        inputIndex,
        expectedSymbol: phase === 'listening' ? (sequence[inputIndex] ?? null) : null,
        isHolding,
        holdCrossed,
        activeExploration: phase === 'playing' || isHolding,
      };
    }

    function notifyStateChange() {
      if (!disposed && typeof ctx.onStateChange === 'function') {
        ctx.onStateChange(getVisualState());
      }
    }

    function cleanupTimers() {
      if (cancelPlayback) {
        cancelPlayback();
        cancelPlayback = null;
      }
      if (nextTimer !== null) {
        ctx.clock.clearTimeout(nextTimer);
        nextTimer = null;
      }
      if (holdTimer !== null) {
        ctx.clock.clearTimeout(holdTimer);
        holdTimer = null;
      }
    }

    function playSequence(seq) {
      cleanupTimers();
      phase = 'playing';
      inputIndex = 0;
      activeBeat = -1;
      isHolding = false;
      holdCrossed = false;
      crossedDash = false;

      const steps = [];
      seq.forEach((sym, idx) => {
        if (sym === 'DOT') {
          steps.push({
            type: 'rigid',
            cue: 'play_dot',
            delay: 420,
            onStep: () => {
              activeBeat = idx;
              notifyStateChange();
            },
          });
        } else {
          // DASH: unmistakable double-thump
          steps.push({
            type: 'heavy',
            cue: 'play_dash_1',
            delay: 115,
            onStep: () => {
              activeBeat = idx;
              notifyStateChange();
            },
          });
          steps.push({
            type: 'medium',
            cue: 'play_dash_2',
            delay: 420,
          });
        }
      });

      // Tiny initial pause so user settles thumb
      nextTimer = ctx.clock.setTimeout(() => {
        nextTimer = null;
        if (disposed) return;
        cancelPlayback = ctx.haptics.playPattern(steps, () => {
          cancelPlayback = null;
          if (disposed) return;
          activeBeat = -1;
          phase = 'listening';
          notifyStateChange();
        });
      }, 320);
    }

    function startNewGame() {
      const seq = makeSequence(initialLength);
      sequence = seq;
      streak = 0;
      playSequence(seq);
    }

    function handlePressIn() {
      if (phase === 'idle') {
        startNewGame();
        return;
      }
      if (phase !== 'listening') return;

      if (holdTimer !== null) {
        ctx.clock.clearTimeout(holdTimer);
        holdTimer = null;
      }

      pressStart = ctx.clock.now();
      crossedDash = false;
      isHolding = true;
      holdCrossed = false;
      ctx.haptics.light({ cue: 'press_down' });

      holdTimer = ctx.clock.setTimeout(() => {
        holdTimer = null;
        if (disposed) return;
        crossedDash = true;
        holdCrossed = true;
        ctx.haptics.heavy({ cue: 'hold_crossed' });
        notifyStateChange();
      }, holdThresholdMs);
    }

    function handlePressOut() {
      if (holdTimer !== null) {
        ctx.clock.clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (!isHolding || phase !== 'listening') {
        isHolding = false;
        holdCrossed = false;
        crossedDash = false;
        return;
      }

      const elapsed = ctx.clock.now() - pressStart;
      const entered = crossedDash || elapsed >= holdThresholdMs ? 'DASH' : 'DOT';

      isHolding = false;
      holdCrossed = false;
      crossedDash = false;

      if (entered === 'DOT') {
        ctx.haptics.rigid({ cue: 'enter_dot' });
      }

      const expected = sequence[inputIndex];
      if (entered !== expected) {
        phase = 'fail';
        ctx.haptics.error({ cue: 'round_fail' });
        nextTimer = ctx.clock.setTimeout(() => {
          nextTimer = null;
          if (disposed) return;
          startNewGame();
          notifyStateChange();
        }, 1100);
        return;
      }

      const nextIdx = inputIndex + 1;
      inputIndex = nextIdx;

      if (nextIdx >= sequence.length) {
        const nextStreak = streak + 1;
        streak = nextStreak;
        bestStreak = Math.max(bestStreak, nextStreak);
        phase = 'success';
        ctx.haptics.success({ cue: 'round_success' });

        const nextSeq = [...sequence, makeRandomSymbol()];
        sequence = nextSeq;
        nextTimer = ctx.clock.setTimeout(() => {
          nextTimer = null;
          if (disposed) return;
          playSequence(nextSeq);
          notifyStateChange();
        }, 950);
      }
    }

    function handlePointerCancel() {
      if (holdTimer !== null) {
        ctx.clock.clearTimeout(holdTimer);
        holdTimer = null;
      }
      isHolding = false;
      holdCrossed = false;
      crossedDash = false;
    }

    function onInput(event) {
      if (disposed || !event || typeof event !== 'object') return;
      switch (event.type) {
        case 'pointer_down':
        case 'button_down':
          handlePressIn();
          break;
        case 'pointer_up':
        case 'button_up':
          handlePressOut();
          break;
        case 'pointer_cancel':
          handlePointerCancel();
          break;
        case 'action':
          if (event.name === 'replay') {
            if (sequence.length > 0 && phase === 'listening') {
              playSequence(sequence);
            } else {
              startNewGame();
            }
          } else if (event.name === 'start') {
            startNewGame();
          }
          break;
        default:
          break;
      }
    }

    function dispose() {
      disposed = true;
      cleanupTimers();
      isHolding = false;
      holdCrossed = false;
      crossedDash = false;
    }

    return {
      onInput,
      getVisualState,
      getEvalState,
      dispose,
    };
  },
};

module.exports = RhythmEchoMode;
