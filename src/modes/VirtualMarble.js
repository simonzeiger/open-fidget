import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { haptics } from '../haptics';
import { COLORS } from '../theme';

const TRAYS = [
  { id: 'ridges', label: 'RIDGES' },
  { id: 'pegs', label: 'PEGS' },
  { id: 'hole', label: 'HOLE DROP' },
];

const PEGS = [
  { x: -0.45, y: -0.42 },
  { x: 0.45, y: -0.42 },
  { x: 0, y: 0 },
  { x: -0.45, y: 0.42 },
  { x: 0.45, y: 0.42 },
];

function randomHole() {
  return {
    x: (Math.random() - 0.5) * 1.35,
    y: (Math.random() - 0.5) * 1.35,
  };
}

export default function VirtualMarble({ blindMode }) {
  const [tray, setTray] = useState('ridges');
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [hole, setHole] = useState(() => randomHole());
  const [holesScored, setHolesScored] = useState(0);
  const [sensorReady, setSensorReady] = useState(true);
  const [boxSize, setBoxSize] = useState({ width: 300, height: 340 });

  const trayRef = useRef(tray);
  const holeRef = useRef(hole);
  const stateRef = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    cellX: 0,
    cellY: 0,
    lastHitMs: 0,
    inHoleFrames: 0,
    zeroX: 0,
    zeroY: 0,
    rawX: 0,
    rawY: 0,
  });

  useEffect(() => {
    trayRef.current = tray;
    stateRef.current.inHoleFrames = 0;
  }, [tray]);

  useEffect(() => {
    holeRef.current = hole;
  }, [hole]);

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
          const s = stateRef.current;
          const now = Date.now();
          s.rawX = x;
          s.rawY = y;

          // Convert phone tilt into tray acceleration
          const ax = (x - s.zeroX) * 0.042;
          const ay = -(y - s.zeroY) * 0.042;

          s.vx = (s.vx + ax) * 0.935;
          s.vy = (s.vy + ay) * 0.935;

          // Clamp max velocity
          const speed = Math.hypot(s.vx, s.vy);
          if (speed > 0.16) {
            s.vx = (s.vx / speed) * 0.16;
            s.vy = (s.vy / speed) * 0.16;
          }

          s.x += s.vx;
          s.y += s.vy;

          // Wall collisions
          const limit = 0.92;
          let wallImpact = 0;
          if (s.x > limit) {
            s.x = limit;
            wallImpact = Math.max(wallImpact, Math.abs(s.vx));
            s.vx = -s.vx * 0.52;
          } else if (s.x < -limit) {
            s.x = -limit;
            wallImpact = Math.max(wallImpact, Math.abs(s.vx));
            s.vx = -s.vx * 0.52;
          }
          if (s.y > limit) {
            s.y = limit;
            wallImpact = Math.max(wallImpact, Math.abs(s.vy));
            s.vy = -s.vy * 0.52;
          } else if (s.y < -limit) {
            s.y = -limit;
            wallImpact = Math.max(wallImpact, Math.abs(s.vy));
            s.vy = -s.vy * 0.52;
          }

          if (wallImpact > 0.018 && now - s.lastHitMs > 75) {
            s.lastHitMs = now;
            if (wallImpact > 0.08) haptics.rigid();
            else if (wallImpact > 0.045) haptics.medium();
            else haptics.soft();
          }

          // Tray-specific tactile mechanics
          if (trayRef.current === 'ridges') {
            const cx = Math.floor((s.x + 1) * 3.5);
            const cy = Math.floor((s.y + 1) * 4.5);
            if ((cx !== s.cellX || cy !== s.cellY) && now - s.lastHitMs > 45) {
              s.cellX = cx;
              s.cellY = cy;
              s.lastHitMs = now;
              if (speed > 0.06) haptics.light();
              else haptics.tick();
            }
          } else if (trayRef.current === 'pegs') {
            const pegRadius = 0.17;
            for (let i = 0; i < PEGS.length; i += 1) {
              const p = PEGS[i];
              const dx = s.x - p.x;
              const dy = s.y - p.y;
              const d = Math.hypot(dx, dy);
              if (d > 0.001 && d < pegRadius) {
                const nx = dx / d;
                const ny = dy / d;
                s.x = p.x + nx * pegRadius;
                s.y = p.y + ny * pegRadius;
                const dot = s.vx * nx + s.vy * ny;
                if (dot < 0) {
                  s.vx -= 1.7 * dot * nx;
                  s.vy -= 1.7 * dot * ny;
                }
                if (now - s.lastHitMs > 70) {
                  s.lastHitMs = now;
                  haptics.rigid();
                }
              }
            }
          } else if (trayRef.current === 'hole') {
            const h = holeRef.current;
            const dx = h.x - s.x;
            const dy = h.y - s.y;
            const d = Math.hypot(dx, dy);

            if (d < 0.32 && d > 0.01) {
              // Subtle gravity well near the dimple rim
              s.vx += (dx / d) * 0.006;
              s.vy += (dy / d) * 0.006;
            }

            if (d < 0.15) {
              s.inHoleFrames += 1;
              if (s.inHoleFrames === 1 && now - s.lastHitMs > 80) {
                s.lastHitMs = now;
                haptics.tick();
              }
              if (s.inHoleFrames > 14 && speed < 0.045) {
                s.inHoleFrames = 0;
                haptics.success();
                setHolesScored((n) => n + 1);
                const nextH = randomHole();
                holeRef.current = nextH;
                setHole(nextH);
              }
            } else {
              s.inHoleFrames = 0;
            }
          }

          setPos({ x: s.x, y: s.y });
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
  }, []);

  const calibrateFlat = () => {
    haptics.medium();
    const s = stateRef.current;
    s.zeroX = s.rawX;
    s.zeroY = s.rawY;
    s.x = 0;
    s.y = 0;
    s.vx = 0;
    s.vy = 0;
    setPos({ x: 0, y: 0 });
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
                  haptics.tick();
                  setTray(t.id);
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
              PEGS.map((p, idx) => {
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
