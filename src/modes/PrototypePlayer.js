import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  TouchableOpacity,
} from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { COLORS } from '../theme';
import { useModeEngine } from './useModeEngine';

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function formatStateValue(val) {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') {
    return Number.isInteger(val) ? String(val) : val.toFixed(2);
  }
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    return val.length <= 4 ? val.join(', ') : `[${val.length}]`;
  }
  if (typeof val === 'object') {
    if (typeof val.x === 'number' && typeof val.y === 'number') {
      return `(${val.x.toFixed(2)}, ${val.y.toFixed(2)})`;
    }
    try {
      return JSON.stringify(val);
    } catch (_) {
      return '[obj]';
    }
  }
  return String(val);
}

function PrototypeStage({ modeDef, activeVariant, onSelectVariant, blindMode }) {
  const { state, sendInput } = useModeEngine(modeDef, { variant: activeVariant });

  const inputs = Array.isArray(modeDef.inputs) ? modeDef.inputs : [];
  const needsImu = inputs.includes('imu');
  const buttonOnly = inputs.includes('button_down') && !inputs.includes('pointer_down');

  const padSizeRef = useRef({ width: 320, height: 360 });
  const sendInputRef = useRef(sendInput);
  sendInputRef.current = sendInput;
  const buttonOnlyRef = useRef(buttonOnly);
  buttonOnlyRef.current = buttonOnly;

  useEffect(() => {
    if (!needsImu) return undefined;
    let sub = null;
    let mounted = true;

    const start = async () => {
      try {
        const available = await Accelerometer.isAvailableAsync();
        if (!mounted || !available) return;
        Accelerometer.setUpdateInterval(25);
        sub = Accelerometer.addListener(({ x, y, z }) => {
          sendInputRef.current({ type: 'imu', ax: x, ay: y, az: z });
        });
      } catch (_) {
        // Ignore unavailable accelerometer on simulator/web
      }
    };

    start();

    return () => {
      mounted = false;
      if (sub) sub.remove();
    };
  }, [needsImu]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          if (buttonOnlyRef.current) {
            sendInputRef.current({ type: 'button_down' });
            return;
          }
          const { locationX = 0, locationY = 0 } = evt?.nativeEvent || {};
          const { width, height } = padSizeRef.current;
          sendInputRef.current({
            type: 'pointer_down',
            x: width > 0 ? clamp01(locationX / width) : 0,
            y: height > 0 ? clamp01(locationY / height) : 0,
          });
        },
        onPanResponderMove: (evt) => {
          if (buttonOnlyRef.current) return;
          const { locationX = 0, locationY = 0 } = evt?.nativeEvent || {};
          const { width, height } = padSizeRef.current;
          sendInputRef.current({
            type: 'pointer_move',
            x: width > 0 ? clamp01(locationX / width) : 0,
            y: height > 0 ? clamp01(locationY / height) : 0,
          });
        },
        onPanResponderRelease: () => {
          if (buttonOnlyRef.current) {
            sendInputRef.current({ type: 'button_up' });
            return;
          }
          sendInputRef.current({ type: 'pointer_up' });
        },
        onPanResponderTerminate: () => {
          if (buttonOnlyRef.current) {
            sendInputRef.current({ type: 'button_up' });
            return;
          }
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

  const variants = Array.isArray(modeDef.variants) ? modeDef.variants : [];
  const actions = Array.isArray(modeDef.actions) ? modeDef.actions : [];
  const stateEntries = state && typeof state === 'object' ? Object.entries(state) : [];

  return (
    <View style={[styles.container, blindMode && styles.blackout]}>
      {!blindMode && (
        <View style={styles.hud}>
          <View style={styles.titleRow}>
            <Text style={styles.modeName}>{modeDef.name}</Text>
            {modeDef.kind ? (
              <View style={styles.kindBadge}>
                <Text style={styles.kindText}>{String(modeDef.kind).toUpperCase()}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.instructions}>{modeDef.blindInstructions}</Text>

          {variants.length > 1 && (
            <View style={styles.pillRow}>
              {variants.map((v) => {
                const active = v === activeVariant;
                return (
                  <TouchableOpacity
                    key={v}
                    style={[styles.pill, active && styles.pillActive]}
                    onPress={() => onSelectVariant(v)}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>
                      {String(v).toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {actions.length > 0 && (
            <View style={styles.pillRow}>
              {actions.map((act, idx) => {
                const actionName = typeof act === 'string' ? act : act?.name;
                const actionLabel =
                  typeof act === 'string'
                    ? act
                    : act?.label || act?.name || `action_${idx}`;
                const actionValue =
                  act && typeof act === 'object' ? act.value : undefined;
                if (!actionName) return null;
                return (
                  <TouchableOpacity
                    key={`${actionName}:${idx}`}
                    style={styles.actionBtn}
                    onPress={() =>
                      sendInput({
                        type: 'action',
                        name: actionName,
                        ...(actionValue !== undefined ? { value: actionValue } : {}),
                      })
                    }
                  >
                    <Text style={styles.actionBtnText}>
                      {String(actionLabel).toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {stateEntries.length > 0 && (
            <View style={styles.stateGrid}>
              {stateEntries.map(([k, v]) => (
                <View key={k} style={styles.stateChip}>
                  <Text style={styles.stateKey}>{k}</Text>
                  <Text style={styles.stateVal} numberOfLines={1}>
                    {formatStateValue(v)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      <View
        style={[styles.touchPad, blindMode && styles.touchPadBlind]}
        onLayout={handlePadLayout}
        {...panResponder.panHandlers}
      >
        {!blindMode ? (
          <View style={styles.padOverlay} pointerEvents="none">
            <Text style={styles.padTitle} pointerEvents="none">
              {buttonOnly ? 'PRESS & HOLD PAD' : 'TOUCH & DRAG PAD'}
            </Text>
            <Text style={styles.padHint} pointerEvents="none">
              {needsImu ? 'Touch + Accelerometer active' : 'Single-surface prototype stage'}
            </Text>
          </View>
        ) : (
          <View style={styles.padOverlay} pointerEvents="none">
            <Text style={styles.blindWhisper} pointerEvents="none">
              {`${modeDef.name.toUpperCase()} • EYES-FREE`}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function PrototypePlayer({ modeDef, blindMode }) {
  const defaultVariant =
    Array.isArray(modeDef?.variants) && modeDef.variants.length > 0
      ? modeDef.variants[0]
      : 'standard';

  const [activeVariant, setActiveVariant] = useState(defaultVariant);

  useEffect(() => {
    setActiveVariant(defaultVariant);
  }, [modeDef?.id, defaultVariant]);

  if (!modeDef) return null;

  return (
    <PrototypeStage
      key={`${modeDef.id}:${activeVariant}`}
      modeDef={modeDef}
      activeVariant={activeVariant}
      onSelectVariant={setActiveVariant}
      blindMode={blindMode}
    />
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
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  modeName: {
    color: COLORS.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
    flex: 1,
  },
  kindBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  kindText: {
    color: COLORS.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  instructions: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surfaceElevated,
  },
  pillActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSoft,
  },
  pillText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  pillTextActive: {
    color: COLORS.accent,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSoft,
  },
  actionBtnText: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  stateGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stateKey: {
    color: COLORS.textDim,
    fontSize: 10,
    fontWeight: '700',
  },
  stateVal: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '700',
    maxWidth: 120,
  },
  touchPad: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  touchPadBlind: {
    backgroundColor: COLORS.blackout,
    borderWidth: 0,
    borderRadius: 0,
  },
  padOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  padTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    textAlign: 'center',
  },
  padHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
  },
  blindWhisper: {
    color: '#18181C',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
    textAlign: 'center',
  },
});
