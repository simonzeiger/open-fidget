import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  TouchableOpacity,
} from 'react-native';
import { haptics } from '../haptics';
import { COLORS } from '../theme';

function randomBeacon(prev) {
  let x = 0.16 + Math.random() * 0.68;
  let y = 0.16 + Math.random() * 0.68;
  let guard = 0;
  while (prev && Math.hypot(x - prev.x, y - prev.y) < 0.35 && guard < 25) {
    x = 0.16 + Math.random() * 0.68;
    y = 0.16 + Math.random() * 0.68;
    guard += 1;
  }
  return { x, y };
}

export default function HotColdHunt({ blindMode }) {
  const [beacon, setBeacon] = useState(() => randomBeacon(null));
  const [foundCount, setFoundCount] = useState(0);
  const [showTarget, setShowTarget] = useState(false);
  const [finger, setFinger] = useState(null);
  const [tempLabel, setTempLabel] = useState('TOUCH & SWEEP TO SENSE THE BEACON');

  const padSizeRef = useRef({ width: 320, height: 420 });
  const beaconRef = useRef(beacon);
  const fingerRef = useRef(null);
  const pulseTimerRef = useRef(null);
  const lockStartRef = useRef(null);

  useEffect(() => {
    beaconRef.current = beacon;
  }, [beacon]);

  const stopPulse = () => {
    if (pulseTimerRef.current) {
      clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = null;
    }
    lockStartRef.current = null;
  };

  useEffect(() => stopPulse, []);

  const captureBeacon = () => {
    stopPulse();
    haptics.success();
    setFoundCount((c) => c + 1);
    const next = randomBeacon(beaconRef.current);
    beaconRef.current = next;
    setBeacon(next);
    setTempLabel('BEACON CAPTURED! NEW SIGNAL HIDDEN');
  };

  const getDistance = (pt) => {
    if (!pt) return 1;
    const b = beaconRef.current;
    return Math.hypot(pt.x - b.x, pt.y - b.y);
  };

  const schedulePulse = () => {
    stopPulse();

    const loop = () => {
      const pt = fingerRef.current;
      if (!pt) return;

      const d = getDistance(pt);
      let interval = 720;

      if (d <= 0.11) {
        haptics.rigid();
        interval = 100;
        setTempLabel('LOCKED ON — HOLD OR LIFT TO CAPTURE!');
        if (!lockStartRef.current) {
          lockStartRef.current = Date.now();
        } else if (Date.now() - lockStartRef.current >= 550) {
          captureBeacon();
          // Resume gentle sonar if finger stays down
          pulseTimerRef.current = setTimeout(loop, 480);
          return;
        }
      } else {
        lockStartRef.current = null;
        if (d <= 0.24) {
          haptics.medium();
          interval = 185;
          setTempLabel('BURNING HOT');
        } else if (d <= 0.42) {
          haptics.light();
          interval = 340;
          setTempLabel('WARM — GETTING CLOSER');
        } else {
          haptics.soft();
          interval = 680;
          setTempLabel('COLD — KEEP SWEEPING');
        }
      }

      pulseTimerRef.current = setTimeout(loop, interval);
    };

    loop();
  };

  const updateFinger = (evt) => {
    const { width, height } = padSizeRef.current;
    if (!width || !height) return;
    const nx = Math.max(0, Math.min(1, evt.nativeEvent.locationX / width));
    const ny = Math.max(0, Math.min(1, evt.nativeEvent.locationY / height));
    const pt = { x: nx, y: ny };
    fingerRef.current = pt;
    setFinger(pt);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        updateFinger(evt);
        schedulePulse();
      },
      onPanResponderMove: (evt) => {
        updateFinger(evt);
      },
      onPanResponderRelease: () => {
        const pt = fingerRef.current;
        const onTarget = pt && getDistance(pt) <= 0.12;
        fingerRef.current = null;
        setFinger(null);
        if (onTarget) {
          captureBeacon();
        } else {
          stopPulse();
          setTempLabel('TOUCH & SWEEP TO SENSE THE BEACON');
        }
      },
      onPanResponderTerminate: () => {
        fingerRef.current = null;
        setFinger(null);
        stopPulse();
      },
    })
  ).current;

  const dist = finger ? getDistance(finger) : 1;
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
