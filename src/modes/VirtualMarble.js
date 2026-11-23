import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Accelerometer } from 'expo-sensors';
import VirtualMarbleMode from '../engine/virtualMarble';
import { useModeEngine } from './useModeEngine';
import { COLORS } from '../theme';

const TRAYS = [
  { id: 'ridges', label: 'RIDGES' },
  { id: 'pegs', label: 'PEGS' },
  { id: 'hole', label: 'HOLE DROP' },
];

export default function VirtualMarble({ blindMode }) {
  const { state, sendInput } = useModeEngine(VirtualMarbleMode);
  const { tray, pos, hole, holesScored, pegs } = state;
  const [sensorReady, setSensorReady] = useState(true);
  const [boxSize, setBoxSize] = useState({ width: 300, height: 340 });

  useEffect(() => {
    let sub = null;
    let mounted = true;

    const start = async () => {
      try {
        const available = await Accelerometer.isAvailableAsync();
        if (!mounted) return;
        if (!available) {
          setSensorReady(false);
          return;
        }
        Accelerometer.setUpdateInterval(25);
        sub = Accelerometer.addListener(({ x, y }) => {
          sendInput({ type: 'imu', ax: x, ay: y });
        });
      } catch (_) {
        if (mounted) setSensorReady(false);
      }
    };

    start();

    return () => {
      mounted = false;
      if (sub) sub.remove();
    };
  }, [sendInput]);

  const calibrateFlat = () => {
    sendInput({ type: 'action', name: 'calibrate' });
    sendInput({ type: 'action', name: 'reset_marble' });
  };

  const toScreen = (nx, ny) => ({
    left: ((nx + 1) / 2) * (boxSize.width - 28),
    top: ((ny + 1) / 2) * (boxSize.height - 28),
  });

  const marbleStyle = toScreen(pos.x, pos.y);
  const holeStyle = toScreen(hole.x, hole.y);

  return (
    <View style={[styles.container, blindMode && styles.blackout]}>
      {!blindMode && (
        <View style={styles.topRow}>
          <View style={styles.trayTabs}>
            {TRAYS.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.trayPill, tray === t.id && styles.trayPillActive]}
                onPress={() => {
                  sendInput({ type: 'action', name: 'set_tray', value: t.id });
                }}
              >
                <Text style={[styles.trayText, tray === t.id && styles.trayTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.resetBtn} onPress={calibrateFlat}>
            <Text style={styles.resetText}>CENTER</Text>
          </TouchableOpacity>
        </View>
      )}

      <View
        style={[styles.trayBox, blindMode && styles.trayBoxBlind]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setBoxSize({ width, height });
        }}
      >
        {!sensorReady ? (
          <Text style={styles.sensorWarn}>
            Accelerometer unavailable on this preview — open in Expo Go on your iPhone to feel the marble roll!
          </Text>
        ) : !blindMode ? (
          <>
            {tray === 'ridges' && (
              <View style={styles.ridgeOverlay} pointerEvents="none">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <View key={`v${i}`} style={[styles.vLine, { left: `${(i / 7) * 100}%` }]} />
                ))}
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <View key={`h${i}`} style={[styles.hLine, { top: `${(i / 9) * 100}%` }]} />
                ))}
              </View>
            )}

            {tray === 'pegs' &&
              pegs.map((p, idx) => {
                const pt = toScreen(p.x, p.y);
                return <View key={idx} style={[styles.peg, pt]} />;
              })}

            {tray === 'hole' && (
              <View
                style={[
                  styles.hole,
                  {
                    left: holeStyle.left - 8,
                    top: holeStyle.top - 8,
                  },
                ]}
              />
            )}

            <View style={[styles.marble, marbleStyle]} />

            <View style={styles.footerBadge}>
              <Text style={styles.footerText}>
                {tray === 'hole'
                  ? `HOLES DROPPED: ${holesScored}  •  TILT TO GUIDE MARBLE`
                  : 'TILT PHONE LIKE A WOODEN BOX — FEEL WALLS & TEXTURE'}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.blindWhisper}>VIRTUAL MARBLE • TILT PHONE</Text>
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
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  trayTabs: {
    flexDirection: 'row',
    gap: 6,
    flex: 1,
  },
  trayPill: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  trayPillActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSoft,
  },
  trayText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  trayTextActive: {
    color: COLORS.accent,
  },
  resetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  resetText: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  trayBox: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: COLORS.borderStrong,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trayBoxBlind: {
    backgroundColor: COLORS.blackout,
    borderWidth: 0,
    borderRadius: 0,
  },
  ridgeOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: '#1E1E26',
  },
  hLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: '#1E1E26',
  },
  peg: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 2,
    borderColor: COLORS.borderStrong,
  },
  hole: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#050507',
    borderWidth: 2,
    borderColor: COLORS.success,
  },
  marble: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.accent,
    borderWidth: 2,
    borderColor: '#FDE68A',
  },
  footerBadge: {
    position: 'absolute',
    bottom: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(9, 9, 11, 0.82)',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  footerText: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  sensorWarn: {
    color: COLORS.textMuted,
    textAlign: 'center',
    padding: 24,
    lineHeight: 20,
  },
  blindWhisper: {
    color: '#18181C',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
});
