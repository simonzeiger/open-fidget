import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  TouchableOpacity,
} from 'react-native';
import { haptics } from '../haptics';
import { COLORS } from '../theme';
import { useModeEngine } from './useModeEngine';
import HotColdHuntMode from '../engine/hotColdHunt';

export default function HotColdHunt({ blindMode }) {
  const { state, sendInput } = useModeEngine(HotColdHuntMode);
  const { beacon, foundCount, finger, dist, tempLabel } = state;
  const [showTarget, setShowTarget] = useState(false);

  const padSizeRef = useRef({ width: 320, height: 420 });

  const getNormalizedPoint = (evt) => {
    const { width, height } = padSizeRef.current;
    if (!width || !height) return null;
    const x = Math.max(0, Math.min(1, evt.nativeEvent.locationX / width));
    const y = Math.max(0, Math.min(1, evt.nativeEvent.locationY / height));
    return { x, y };
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const pt = getNormalizedPoint(evt);
        if (pt) {
          sendInput({ type: 'pointer_down', x: pt.x, y: pt.y });
        }
      },
      onPanResponderMove: (evt) => {
        const pt = getNormalizedPoint(evt);
        if (pt) {
          sendInput({ type: 'pointer_move', x: pt.x, y: pt.y });
        }
      },
      onPanResponderRelease: () => {
        sendInput({ type: 'pointer_up' });
      },
      onPanResponderTerminate: () => {
        sendInput({ type: 'pointer_cancel' });
      },
    })
  ).current;

  const ringColor =
    dist <= 0.11
      ? COLORS.success
      : dist <= 0.24
      ? COLORS.accent
      : dist <= 0.42
      ? '#60A5FA'
      : COLORS.borderStrong;

  return (
    <View style={[styles.container, blindMode && styles.blackout]}>
      {!blindMode && (
        <View style={styles.hud}>
          <View>
            <Text style={styles.kicker}>BEACONS FOUND</Text>
            <Text style={styles.bigStat}>{foundCount}</Text>
          </View>
          <View style={styles.hudRight}>
            <TouchableOpacity
              style={[styles.pillBtn, showTarget && styles.pillBtnActive]}
              onPress={() => {
                haptics.tick();
                setShowTarget((v) => !v);
              }}
            >
              <Text style={[styles.pillText, showTarget && styles.pillTextActive]}>
                {showTarget ? 'PEEK: ON' : 'PEEK: OFF'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View
        style={[styles.pad, blindMode && styles.padBlind]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          padSizeRef.current = { width, height };
        }}
        {...panResponder.panHandlers}
      >
        {!blindMode ? (
          <View style={styles.padOverlay} pointerEvents="none">
            {showTarget && (
              <View
                style={[
                  styles.targetDot,
                  {
                    left: `${beacon.x * 100}%`,
                    top: `${beacon.y * 100}%`,
                  },
                ]}
              />
            )}

            {finger && (
              <View
                style={[
                  styles.fingerRing,
                  {
                    left: `${finger.x * 100}%`,
                    top: `${finger.y * 100}%`,
                    borderColor: ringColor,
                  },
                ]}
              />
            )}

            <View style={styles.statusChip}>
              <Text style={styles.statusText}>{tempLabel}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.padOverlay} pointerEvents="none">
            <Text style={styles.blindWhisper}>HOT OR COLD • SWEEP TO HUNT</Text>
          </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  kicker: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  bigStat: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: '800',
  },
  hudRight: {
    flexDirection: 'row',
    gap: 8,
  },
  pillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surfaceElevated,
  },
  pillBtnActive: {
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
  pad: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  padBlind: {
    backgroundColor: COLORS.blackout,
    borderWidth: 0,
    borderRadius: 0,
  },
  padOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetDot: {
    position: 'absolute',
    width: 26,
    height: 26,
    marginLeft: -13,
    marginTop: -13,
    borderRadius: 13,
    backgroundColor: COLORS.successSoft,
    borderWidth: 2,
    borderColor: COLORS.success,
  },
  fingerRing: {
    position: 'absolute',
    width: 68,
    height: 68,
    marginLeft: -34,
    marginTop: -34,
    borderRadius: 34,
    borderWidth: 2.5,
  },
  statusChip: {
    position: 'absolute',
    bottom: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(9, 9, 11, 0.85)',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  blindWhisper: {
    color: '#18181C',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
});
