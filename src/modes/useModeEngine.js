import { useEffect, useRef, useState, useCallback } from 'react';
import { haptics } from '../haptics';
import { createHapticsContext } from '../engine/contract';
import { createRealClock } from '../sim/clock';
import { createMathRng } from '../sim/rng';

function instantiateEngine(modeDef, config, onAsyncStateChange) {
  const clock = createRealClock();
  const hapticsCtx = createHapticsContext(clock, (type) => {
    if (haptics[type]) haptics[type]();
  });
  return modeDef.create(
    {
      clock,
      haptics: hapticsCtx,
      rng: createMathRng(),
      onStateChange: onAsyncStateChange,
    },
    config
  );
}

/**
 * React Native hook that mounts a headless Open Fidget mode engine,
 * wires it to real Expo haptics + wall-clock timers, syncs visual state,
 * and cleanly handles unmount (and React StrictMode re-mounts).
 */
export function useModeEngine(modeDef, config) {
  const mountedRef = useRef(false);
  const engineRef = useRef(null);
  const configRef = useRef(config);
  configRef.current = config;

  const notifyAsync = useCallback((next) => {
    if (mountedRef.current) {
      setVisualState(next);
    }
  }, []);

  if (!engineRef.current) {
    engineRef.current = instantiateEngine(modeDef, configRef.current, notifyAsync);
  }

  const [visualState, setVisualState] = useState(() => engineRef.current.getVisualState());

  useEffect(() => {
    mountedRef.current = true;
    if (!engineRef.current) {
      engineRef.current = instantiateEngine(modeDef, configRef.current, notifyAsync);
      setVisualState(engineRef.current.getVisualState());
    }
    return () => {
      mountedRef.current = false;
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, [modeDef, notifyAsync]);

  const sendInput = useCallback((event) => {
    if (!engineRef.current) return;
    engineRef.current.onInput(event);
    setVisualState(engineRef.current.getVisualState());
  }, []);

  return {
    state: visualState,
    sendInput,
    engineRef,
  };
}
