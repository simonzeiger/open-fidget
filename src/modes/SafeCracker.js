import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  TouchableOpacity,
} from 'react-native';
import { haptics, playPattern } from '../haptics';
import { COLORS } from '../theme';

const DIAL_STEPS = 24;
const PIXELS_PER_TICK = 18;
const PINS_PER_VAULT = 3;

function randomTarget(avoid) {
  let next = Math.floor(Math.random() * DIAL_STEPS);
  let guard = 0;
  while (circularDist(next, avoid) < 5 && guard < 30) {
    next = Math.floor(Math.random() * DIAL_STEPS);
    guard += 1;
  }
  return next;
}

function circularDist(a, b) {
  const raw = Math.abs(a - b) % DIAL_STEPS;
  return Math.min(raw, DIAL_STEPS - raw);
}

export default function SafeCracker({ blindMode }) {
  const [detent, setDetent] = useState(0);
  const [target, setTarget] = useState(() => randomTarget(0));
  const [pinsLocked, setPinsLocked] = useState(0);
  const [vaultsCracked, setVaultsCracked] = useState(0);
  const [strictMode, setStrictMode] = useState(false);
  const [statusText, setStatusText] = useState('Slide thumb slowly to feel the heavy tumbler click');
  const [isTouching, setIsTouching] = useState(false);

  const detentRef = useRef(0);
  const startDetentRef = useRef(0);
  const targetRef = useRef(target);
  const pinsRef = useRef(0);
  const strictRef = useRef(false);
  const movedRef = useRef(false);
  const cancelPatternRef = useRef(null);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    pinsRef.current = pinsLocked;
  }, [pinsLocked]);

  useEffect(() => {
    strictRef.current = strictMode;
  }, [strictMode]);

  useEffect(() => {
    return () => {
      if (cancelPatternRef.current) cancelPatternRef.current();
    };
  }, []);

  const triggerDetentHaptic = (newDetent) => {
    const dist = circularDist(newDetent, targetRef.current);
    if (dist === 0) {
      if (cancelPatternRef.current) cancelPatternRef.current();
      cancelPatternRef.current = playPattern([
        { type: 'heavy', delay: 55 },
        { type: 'rigid', delay: 0 },
      ]);
    } else if (dist === 1) {
      haptics.medium();
    } else {
      haptics.tick();
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startDetentRef.current = detentRef.current;
        movedRef.current = false;
        setIsTouching(true);
        haptics.light();
      },
      onPanResponderMove: (_, gesture) => {
        // Combine horizontal drag with minor vertical contribution for natural thumb arcs
        const deltaTicks = Math.round((gesture.dx - gesture.dy * 0.25) / PIXELS_PER_TICK);
        const next = ((startDetentRef.current + deltaTicks) % DIAL_STEPS + DIAL_STEPS) % DIAL_STEPS;
        if (next !== detentRef.current) {
          detentRef.current = next;
          movedRef.current = true;
          setDetent(next);
          triggerDetentHaptic(next);
        }
      },
      onPanResponderRelease: () => {
        setIsTouching(false);
        if (!movedRef.current) return;

        const dist = circularDist(detentRef.current, targetRef.current);
        if (dist === 0) {
          const nextPins = pinsRef.current + 1;
          if (nextPins >= PINS_PER_VAULT) {
            setVaultsCracked((v) => v + 1);
            setPinsLocked(0);
            pinsRef.current = 0;
            const freshTarget = randomTarget(detentRef.current);
            setTarget(freshTarget);
            targetRef.current = freshTarget;
            setStatusText('Vault cracked! New combination set');
            if (cancelPatternRef.current) cancelPatternRef.current();
            cancelPatternRef.current = playPattern([
              { type: 'success', delay: 140 },
              { type: 'heavy', delay: 110 },
              { type: 'success', delay: 0 },
            ]);
          } else {
            setPinsLocked(nextPins);
            pinsRef.current = nextPins;
            const freshTarget = randomTarget(detentRef.current);
            setTarget(freshTarget);
            targetRef.current = freshTarget;
            setStatusText(`Pin ${nextPins}/${PINS_PER_VAULT} locked! Find the next tumbler`);
            haptics.success();
          }
        } else if (strictRef.current && pinsRef.current > 0) {
          setPinsLocked(0);
          pinsRef.current = 0;
          setStatusText('Slipped! Strict mode reset all pins');
          haptics.error();
        } else {
          setStatusText('Missed tumbler — keep sweeping slowly');
          haptics.soft();
        }
      },
      onPanResponderTerminate: () => {
        setIsTouching(false);
      },
    })
  ).current;

  const dist = circularDist(detent, target);
  const onTarget = dist === 0;

  return (
    <View style={[styles.container, blindMode && styles.blackout]}>
      {!blindMode && (
        <View style={styles.hud}>
          <View style={styles.hudRow}>
            <View>
              <Text style={styles.kicker}>VAULTS CRACKED</Text>
              <Text style={styles.bigStat}>{vaultsCracked}</Text>
            </View>
            <View style={styles.pinRow}>
              {Array.from({ length: PINS_PER_VAULT }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.pinDot,
                    i < pinsLocked && styles.pinDotLocked,
                  ]}
                />
              ))}
            </View>
            <TouchableOpacity
              style={[styles.pillBtn, strictMode && styles.pillBtnActive]}
              onPress={() => {
                haptics.tick();
                setStrictMode((s) => !s);
              }}
            >
              <Text style={[styles.pillText, strictMode && styles.pillTextActive]}>
                {strictMode ? 'STRICT ON' : 'CHILL'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.status}>{statusText}</Text>

          <View style={styles.dialStrip}>
            {Array.from({ length: DIAL_STEPS }).map((_, i) => {
              const isCurrent = i === detent;
              const isHint = onTarget && isCurrent;
              return (
                <View
                  key={i}
                  style={[
                    styles.notch,
                    i % 6 === 0 && styles.notchMajor,
                    isCurrent && styles.notchActive,
                    isHint && styles.notchTarget,
                  ]}
                />
              );
            })}
          </View>
          <Text style={styles.dialReadout}>
            NOTCH {String(detent).padStart(2, '0')} / {DIAL_STEPS - 1}
            {dist === 1 ? '  •  TENSION' : onTarget ? '  •  TUMBLER!' : ''}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.touchPad,
          blindMode && styles.touchPadBlind,
          !blindMode && isTouching && styles.touchPadActive,
          !blindMode && onTarget && isTouching && styles.touchPadHot,
        ]}
        {...panResponder.panHandlers}
      >
        {!blindMode ? (
          <>
            <Text style={styles.padIcon}>◎</Text>
            <Text style={styles.padTitle}>
              {isTouching ? 'FEEL FOR THE DOUBLE-THUNK' : 'DRAG THUMB LEFT / RIGHT'}
            </Text>
            <Text style={styles.padHint}>
              Lift your thumb when you land on the heavy tumbler click
            </Text>
          </>
        ) : (
          <Text style={styles.blindWhisper}>SAFE CRACKER • DRAG & RELEASE</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  blackout: {
    backgroundColor: COLORS.blackout,
    paddingHorizontal: 0,
    paddingBottom: 0,
  },
  hud: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  hudRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kicker: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  bigStat: {
    color: COLORS.text,
    fontSize: 28,
    fontWeight: '800',
  },
  pinRow: {
    flexDirection: 'row',
    gap: 10,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
  },
  pinDotLocked: {
    backgroundColor: COLORS.success,
    borderColor: COLORS.success,
  },
  pillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surfaceElevated,
  },
  pillBtnActive: {
    borderColor: COLORS.danger,
    backgroundColor: COLORS.dangerSoft,
  },
  pillText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  pillTextActive: {
    color: COLORS.danger,
  },
  status: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginTop: 10,
    marginBottom: 12,
  },
  dialStrip: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 28,
    paddingHorizontal: 2,
  },
  notch: {
    width: 4,
    height: 10,
    borderRadius: 2,
    backgroundColor: COLORS.borderStrong,
  },
  notchMajor: {
    height: 16,
    backgroundColor: COLORS.textDim,
  },
  notchActive: {
    height: 26,
    width: 6,
    backgroundColor: COLORS.accent,
  },
  notchTarget: {
    backgroundColor: COLORS.success,
  },
  dialReadout: {
    color: COLORS.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 8,
    textAlign: 'center',
  },
  touchPad: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  touchPadActive: {
    borderColor: COLORS.accent,
    backgroundColor: '#171512',
  },
  touchPadHot: {
    borderColor: COLORS.success,
    backgroundColor: '#0F1915',
  },
  touchPadBlind: {
    backgroundColor: COLORS.blackout,
    borderWidth: 0,
    borderRadius: 0,
  },
  padIcon: {
    fontSize: 42,
    color: COLORS.accent,
    marginBottom: 12,
  },
  padTitle: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  padHint: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
  },
  blindWhisper: {
    color: '#18181C',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
});
