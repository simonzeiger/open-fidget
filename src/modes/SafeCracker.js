import React, { useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  TouchableOpacity,
} from 'react-native';
import { COLORS } from '../theme';
import SafeCrackerMode from '../engine/safeCracker';
import { useModeEngine } from './useModeEngine';

export default function SafeCracker({ blindMode }) {
  const { state, sendInput } = useModeEngine(SafeCrackerMode);
  const {
    detent,
    dist,
    onTarget,
    pinsLocked,
    pinsPerVault,
    dialSteps,
    vaultsCracked,
    strictMode,
    statusText,
    isTouching,
  } = state;

  const padSizeRef = useRef({ width: 360, height: 420 });
  const sendInputRef = useRef(sendInput);
  sendInputRef.current = sendInput;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX = 0, locationY = 0 } = evt?.nativeEvent || {};
          const { width, height } = padSizeRef.current;
          sendInputRef.current({
            type: 'pointer_down',
            x: width > 0 ? locationX / width : 0,
            y: height > 0 ? locationY / height : 0,
          });
        },
        onPanResponderMove: (evt) => {
          const { locationX = 0, locationY = 0 } = evt?.nativeEvent || {};
          const { width, height } = padSizeRef.current;
          sendInputRef.current({
            type: 'pointer_move',
            x: width > 0 ? locationX / width : 0,
            y: height > 0 ? locationY / height : 0,
          });
        },
        onPanResponderRelease: () => {
          sendInputRef.current({ type: 'pointer_up' });
        },
        onPanResponderTerminate: () => {
          sendInputRef.current({ type: 'pointer_cancel' });
        },
      }),
    []
  );

  const handlePadLayout = (evt) => {
    const { width, height } = evt?.nativeEvent?.layout || {};
    if (width > 0 && height > 0) {
      padSizeRef.current = { width, height };
      sendInput({ type: 'resize', widthPx: width, heightPx: height });
    }
  };

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
              {Array.from({ length: pinsPerVault }).map((_, i) => (
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
              onPress={() => sendInput({ type: 'action', name: 'toggle_strict' })}
            >
              <Text style={[styles.pillText, strictMode && styles.pillTextActive]}>
                {strictMode ? 'STRICT ON' : 'CHILL'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.status}>{statusText}</Text>

          <View style={styles.dialStrip}>
            {Array.from({ length: dialSteps }).map((_, i) => {
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
            NOTCH {String(detent).padStart(2, '0')} / {dialSteps - 1}
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
        onLayout={handlePadLayout}
        {...panResponder.panHandlers}
      >
        {!blindMode ? (
          <>
            <Text style={styles.padIcon} pointerEvents="none">◎</Text>
            <Text style={styles.padTitle} pointerEvents="none">
              {isTouching ? 'FEEL FOR THE DOUBLE-THUNK' : 'DRAG THUMB LEFT / RIGHT'}
            </Text>
            <Text style={styles.padHint} pointerEvents="none">
              Lift your thumb when you land on the heavy tumbler click
            </Text>
          </>
        ) : (
          <Text style={styles.blindWhisper} pointerEvents="none">SAFE CRACKER • DRAG & RELEASE</Text>
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
