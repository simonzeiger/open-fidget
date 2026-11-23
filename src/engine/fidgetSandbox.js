'use strict';

const SWITCH_FEELS = [
  { id: 'clicky', label: 'CLICKY', down: 'rigid', up: 'light' },
  { id: 'thock', label: 'THOCK', down: 'heavy', up: 'soft' },
  { id: 'subtle', label: 'SUBTLE', down: 'tick', up: 'tick' },
];

const SWITCH_FEEL_MAP = Object.freeze({
  clicky: SWITCH_FEELS[0],
  thock: SWITCH_FEELS[1],
  subtle: SWITCH_FEELS[2],
});

const VALID_TOOLS = Object.freeze(['switch', 'slider', 'bubbles', 'breathing']);
const SLIDER_STOPS = 12;
const BUBBLE_COUNT = 12;
const BUBBLE_RESET_DELAY_MS = 260;
const BREATH_TICK_MS = 500;
const BREATH_CYCLE_HALF_SECS = 38; // 19s total at 500ms ticks

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function clamp01(val) {
  if (!Number.isFinite(val)) return 0;
  return clamp(val, 0, 1);
}

const FidgetSandboxMode = {
  id: 'sandbox',
  name: 'Fidget Sandbox',
  kind: 'fidget',
  variants: ['switch', 'slider', 'bubbles', 'breathing'],
  variantKinds: {
    switch: 'fidget',
    slider: 'fidget',
    bubbles: 'fidget',
    breathing: 'pacer',
  },
  inputs: [
    'pointer_down',
    'pointer_move',
    'pointer_up',
    'pointer_cancel',
    'button_down',
    'button_up',
    'dial',
    'action',
  ],
  blindInstructions:
    'Eyes-free fidget sandbox. Switch: press and release to click. Slider: drag horizontally or turn dial across 12 magnetic stops. Bubbles: tap across the 4x3 grid to pop all 12. Breathing: tap to toggle the 4-7-8 haptic pacer.',

  create(ctx, config = {}) {
    const requestedTool = config.variant || config.activeTool || 'switch';
    let activeTool = VALID_TOOLS.includes(requestedTool) ? requestedTool : 'switch';

    let switchFeel = SWITCH_FEEL_MAP[config.switchFeel] ? config.switchFeel : 'clicky';
    let clicks = 0;
    let switchDown = false;

    let sliderStep = 6;
    let sliderChanges = 0;

    let popped = Array(BUBBLE_COUNT).fill(false);
    let bubbleResets = 0;
    let bubbleResetTimer = null;

    let breathing = false;
    let breathPhase = 'IDLE';
    let breathHalfSec = 0;
    let breathTimer = null;

    let disposed = false;

    function getVisualState() {
      return {
        activeTool,
        switchFeel,
        clicks,
        switchDown,
        sliderStep,
        sliderStops: SLIDER_STOPS,
        popped: popped.slice(),
        breathing,
        breathPhase,
      };
    }

    function getEvalState() {
      let poppedCount = 0;
      for (let i = 0; i < popped.length; i += 1) {
        if (popped[i]) poppedCount += 1;
      }
      return {
        score: clicks + bubbleResets,
        progress: clicks + poppedCount + sliderChanges,
        activeTool,
        variantKind: activeTool === 'breathing' ? 'pacer' : 'fidget',
        clicks,
        sliderStep,
        sliderChanges,
        poppedCount,
        bubbleResets,
        breathing,
        breathPhase,
        activeExploration: switchDown || breathing,
        phase: activeTool,
      };
    }

    function notifyAsync() {
      if (!disposed && typeof ctx.onStateChange === 'function') {
        ctx.onStateChange(getVisualState());
      }
    }

    function pressSwitch() {
      if (switchDown) return;
      const feel = SWITCH_FEEL_MAP[switchFeel] || SWITCH_FEELS[0];
      switchDown = true;
      clicks += 1;
      ctx.haptics[feel.down]({ cue: 'switch_down' });
    }

    function releaseSwitch() {
      if (!switchDown) return;
      const feel = SWITCH_FEEL_MAP[switchFeel] || SWITCH_FEELS[0];
      switchDown = false;
      ctx.haptics[feel.up]({ cue: 'switch_up' });
    }

    function setSliderStep(nextStep) {
      const clamped = clamp(Math.round(nextStep), 0, SLIDER_STOPS - 1);
      if (clamped === sliderStep) return;
      sliderStep = clamped;
      sliderChanges += 1;
      if (sliderStep === 0 || sliderStep === SLIDER_STOPS - 1) {
        ctx.haptics.heavy({ cue: 'slider_end' });
      } else {
        ctx.haptics.medium({ cue: 'slider_detent' });
      }
    }

    function setSliderFromRatio(ratio) {
      const step = Math.round(clamp01(ratio) * (SLIDER_STOPS - 1));
      setSliderStep(step);
    }

    function popBubble(idx) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= BUBBLE_COUNT) return;
      if (popped[idx]) return;
      popped[idx] = true;
      ctx.haptics.rigid({ cue: 'bubble_pop' });

      if (popped.every(Boolean)) {
        if (bubbleResetTimer !== null) {
          ctx.clock.clearTimeout(bubbleResetTimer);
          bubbleResetTimer = null;
        }
        bubbleResetTimer = ctx.clock.setTimeout(() => {
          bubbleResetTimer = null;
          if (disposed) return;
          popped = Array(BUBBLE_COUNT).fill(false);
          bubbleResets += 1;
          ctx.haptics.success({ cue: 'bubble_reset' });
          notifyAsync();
        }, BUBBLE_RESET_DELAY_MS);
      }
    }

    function tickBreath() {
      const halfCycle = breathHalfSec % BREATH_CYCLE_HALF_SECS;
      const sec = halfCycle * 0.5;
      if (sec < 4) {
        breathPhase = `INHALE (${Math.ceil(4 - sec)}s)`;
        ctx.haptics.soft({ cue: 'breath_inhale' });
      } else if (sec < 11) {
        breathPhase = `HOLD (${Math.ceil(11 - sec)}s)`;
        if (sec === 4) {
          ctx.haptics.medium({ cue: 'breath_hold_start' });
        }
      } else {
        breathPhase = `EXHALE (${Math.ceil(19 - sec)}s)`;
        if (halfCycle % 2 === 0) {
          ctx.haptics.light({ cue: 'breath_exhale' });
        }
      }
      breathHalfSec += 1;
    }

    function startBreathing() {
      if (breathing) return;
      breathing = true;
      breathHalfSec = 0;
      tickBreath();
      breathTimer = ctx.clock.setInterval(() => {
        if (disposed || !breathing) return;
        tickBreath();
        notifyAsync();
      }, BREATH_TICK_MS);
    }

    function stopBreathing(emitCue) {
      if (breathTimer !== null) {
        ctx.clock.clearInterval(breathTimer);
        breathTimer = null;
      }
      const wasBreathing = breathing;
      breathing = false;
      breathPhase = 'IDLE';
      if (emitCue && wasBreathing) {
        ctx.haptics.medium({ cue: 'ui_tick' });
      }
    }

    function handleAction(event) {
      switch (event.name) {
        case 'set_tool': {
          if (VALID_TOOLS.includes(event.value) && event.value !== activeTool) {
            activeTool = event.value;
            ctx.haptics.tick({ cue: 'ui_tick' });
          }
          break;
        }
        case 'set_switch_feel': {
          if (SWITCH_FEEL_MAP[event.value]) {
            switchFeel = event.value;
            ctx.haptics.tick({ cue: 'ui_tick' });
          }
          break;
        }
        case 'switch_down': {
          pressSwitch();
          break;
        }
        case 'switch_up': {
          releaseSwitch();
          break;
        }
        case 'slider_ratio': {
          setSliderFromRatio(event.value);
          break;
        }
        case 'pop_bubble': {
          popBubble(event.value);
          break;
        }
        case 'toggle_breathing': {
          if (breathing) {
            stopBreathing(true);
          } else {
            startBreathing();
          }
          break;
        }
        case 'set_breathing': {
          if (event.value) {
            startBreathing();
          } else {
            stopBreathing(true);
          }
          break;
        }
        default:
          break;
      }
    }

    function onInput(event) {
      if (disposed || !event || typeof event !== 'object') return;

      if (event.type === 'action') {
        handleAction(event);
        return;
      }

      switch (event.type) {
        case 'pointer_down': {
          if (activeTool === 'switch') {
            pressSwitch();
          } else if (activeTool === 'slider') {
            setSliderFromRatio(event.x ?? 0);
          } else if (activeTool === 'bubbles') {
            const nx = clamp01(event.x ?? 0);
            const ny = clamp01(event.y ?? 0);
            const col = Math.min(3, Math.floor(nx * 4));
            const row = Math.min(2, Math.floor(ny * 3));
            popBubble(row * 4 + col);
          } else if (activeTool === 'breathing') {
            if (breathing) {
              stopBreathing(true);
            } else {
              startBreathing();
            }
          }
          break;
        }
        case 'pointer_move': {
          if (activeTool === 'slider') {
            setSliderFromRatio(event.x ?? 0);
          }
          break;
        }
        case 'pointer_up':
        case 'pointer_cancel': {
          if (activeTool === 'switch') {
            releaseSwitch();
          }
          break;
        }
        case 'button_down': {
          if (activeTool === 'switch') {
            pressSwitch();
          } else if (activeTool === 'breathing') {
            if (breathing) {
              stopBreathing(true);
            } else {
              startBreathing();
            }
          }
          break;
        }
        case 'button_up': {
          if (activeTool === 'switch') {
            releaseSwitch();
          }
          break;
        }
        case 'dial': {
          if (activeTool === 'slider') {
            const delta = Number.isFinite(event.deltaSteps)
              ? Math.round(event.deltaSteps)
              : 0;
            if (delta !== 0) {
              setSliderStep(sliderStep + delta);
            }
          }
          break;
        }
        default:
          break;
      }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (breathTimer !== null) {
        ctx.clock.clearInterval(breathTimer);
        breathTimer = null;
      }
      if (bubbleResetTimer !== null) {
        ctx.clock.clearTimeout(bubbleResetTimer);
        bubbleResetTimer = null;
      }
      breathing = false;
      breathPhase = 'IDLE';
    }

    return {
      onInput,
      getVisualState,
      getEvalState,
      dispose,
    };
  },
};

module.exports = FidgetSandboxMode;
