import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ScrollView,
  PanResponder,
  StatusBar,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Accelerometer } from 'expo-sensors';

// ─── Theme ───────────────────────────────────────────────────────────────────
const COLORS = {
  bg: '#09090B',
  surface: '#141418',
  surfaceElevated: '#1C1C22',
  border: '#27272F',
  borderStrong: '#3A3A46',
  text: '#F4F4F6',
  textMuted: '#8E8E9B',
  textDim: '#52525E',
  accent: '#F59E0B',
  accentSoft: 'rgba(245, 158, 11, 0.16)',
  success: '#10B981',
  successSoft: 'rgba(16, 185, 129, 0.16)',
  danger: '#EF4444',
  dangerSoft: 'rgba(239, 68, 68, 0.16)',
  blackout: '#000000',
};

// ─── Haptics Engine ──────────────────────────────────────────────────────────
const safeHaptic = (fn) => {
  try {
    const res = fn();
    if (res && typeof res.catch === 'function') {
      res.catch(() => {});
    }
  } catch (_) {}
};

const haptics = {
  tick: () => safeHaptic(() => Haptics.selectionAsync()),
  light: () => safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavy: () => safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  rigid: () => safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),
  soft: () => safeHaptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft)),
  success: () => safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safeHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};

function playPattern(steps, onComplete) {
  let cancelled = false;
  const timers = [];
  let elapsed = 0;

  steps.forEach((step) => {
    const t = setTimeout(() => {
      if (cancelled) return;
      if (step.type && haptics[step.type]) {
        haptics[step.type]();
      }
      if (step.onStep) step.onStep();
    }, elapsed);
    timers.push(t);
    elapsed += step.delay ?? 0;
  });

  if (onComplete) {
    const endTimer = setTimeout(() => {
      if (!cancelled) onComplete();
    }, elapsed);
    timers.push(endTimer);
  }

  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}

// ─── Mode 1: Safe Cracker ────────────────────────────────────────────────────
const DIAL_STEPS = 24;
const PIXELS_PER_TICK = 18;
const PINS_PER_VAULT = 3;

function circularDist(a, b) {
  const raw = Math.abs(a - b) % DIAL_STEPS;
  return Math.min(raw, DIAL_STEPS - raw);
}

function randomTarget(avoid) {
  let next = Math.floor(Math.random() * DIAL_STEPS);
  let guard = 0;
  while (circularDist(next, avoid) < 5 && guard < 30) {
    next = Math.floor(Math.random() * DIAL_STEPS);
    guard += 1;
  }
  return next;
}

function SafeCracker({ blindMode }) {
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

  useEffect(() => { targetRef.current = target; }, [target]);
  useEffect(() => { pinsRef.current = pinsLocked; }, [pinsLocked]);
  useEffect(() => { strictRef.current = strictMode; }, [strictMode]);
  useEffect(() => () => { if (cancelPatternRef.current) cancelPatternRef.current(); }, []);

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
      onPanResponderTerminate: () => setIsTouching(false),
    })
  ).current;

  const dist = circularDist(detent, target);
  const onTarget = dist === 0;

  return (
    <View style={[safeStyles.container, blindMode && safeStyles.blackout]}>
      {!blindMode && (
        <View style={safeStyles.hud}>
          <View style={safeStyles.hudRow}>
            <View>
              <Text style={safeStyles.kicker}>VAULTS CRACKED</Text>
              <Text style={safeStyles.bigStat}>{vaultsCracked}</Text>
            </View>
            <View style={safeStyles.pinRow}>
              {Array.from({ length: PINS_PER_VAULT }).map((_, i) => (
                <View key={i} style={[safeStyles.pinDot, i < pinsLocked && safeStyles.pinDotLocked]} />
              ))}
            </View>
            <TouchableOpacity
              style={[safeStyles.pillBtn, strictMode && safeStyles.pillBtnActive]}
              onPress={() => { haptics.tick(); setStrictMode((s) => !s); }}
            >
              <Text style={[safeStyles.pillText, strictMode && safeStyles.pillTextActive]}>
                {strictMode ? 'STRICT ON' : 'CHILL'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={safeStyles.status}>{statusText}</Text>
          <View style={safeStyles.dialStrip}>
            {Array.from({ length: DIAL_STEPS }).map((_, i) => {
              const isCurrent = i === detent;
              const isHint = onTarget && isCurrent;
              return (
                <View
                  key={i}
                  style={[
                    safeStyles.notch,
                    i % 6 === 0 && safeStyles.notchMajor,
                    isCurrent && safeStyles.notchActive,
                    isHint && safeStyles.notchTarget,
                  ]}
                />
              );
            })}
          </View>
          <Text style={safeStyles.dialReadout}>
            NOTCH {String(detent).padStart(2, '0')} / {DIAL_STEPS - 1}
            {dist === 1 ? '  •  TENSION' : onTarget ? '  •  TUMBLER!' : ''}
          </Text>
        </View>
      )}
      <View
        style={[
          safeStyles.touchPad,
          blindMode && safeStyles.touchPadBlind,
          !blindMode && isTouching && safeStyles.touchPadActive,
          !blindMode && onTarget && isTouching && safeStyles.touchPadHot,
        ]}
        {...panResponder.panHandlers}
      >
        {!blindMode ? (
          <>
            <Text style={safeStyles.padIcon}>◎</Text>
            <Text style={safeStyles.padTitle}>
              {isTouching ? 'FEEL FOR THE DOUBLE-THUNK' : 'DRAG THUMB LEFT / RIGHT'}
            </Text>
            <Text style={safeStyles.padHint}>
              Lift your thumb when you land on the heavy tumbler click
            </Text>
          </>
        ) : (
          <Text style={safeStyles.blindWhisper}>SAFE CRACKER • DRAG & RELEASE</Text>
        )}
      </View>
    </View>
  );
}

// ─── Mode 2: Rhythm Echo ─────────────────────────────────────────────────────
const HOLD_THRESHOLD_MS = 250;
const INITIAL_LENGTH = 3;

const makeRandomSymbol = () => (Math.random() < 0.5 ? 'DOT' : 'DASH');
const makeSequence = (len) => Array.from({ length: len }, makeRandomSymbol);

function RhythmEcho({ blindMode }) {
  const [phase, setPhase] = useState('idle');
  const [sequence, setSequence] = useState([]);
  const [inputIndex, setInputIndex] = useState(0);
  const [activeBeat, setActiveBeat] = useState(-1);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const [holdCrossed, setHoldCrossed] = useState(false);

  const cancelPlaybackRef = useRef(null);
  const nextTimerRef = useRef(null);
  const holdTimerRef = useRef(null);
  const pressStartRef = useRef(0);
  const crossedDashRef = useRef(false);

  const cleanupTimers = useCallback(() => {
    if (cancelPlaybackRef.current) { cancelPlaybackRef.current(); cancelPlaybackRef.current = null; }
    if (nextTimerRef.current) { clearTimeout(nextTimerRef.current); nextTimerRef.current = null; }
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
  }, []);

  useEffect(() => cleanupTimers, [cleanupTimers]);

  const playSequence = useCallback((seq) => {
    cleanupTimers();
    setPhase('playing');
    setInputIndex(0);
    setActiveBeat(-1);

    const steps = [];
    seq.forEach((sym, idx) => {
      if (sym === 'DOT') {
        steps.push({ type: 'rigid', delay: 420, onStep: () => setActiveBeat(idx) });
      } else {
        steps.push({ type: 'heavy', delay: 115, onStep: () => setActiveBeat(idx) });
        steps.push({ type: 'medium', delay: 420 });
      }
    });

    nextTimerRef.current = setTimeout(() => {
      cancelPlaybackRef.current = playPattern(steps, () => {
        setActiveBeat(-1);
        setPhase('listening');
      });
    }, 320);
  }, [cleanupTimers]);

  const startNewGame = useCallback(() => {
    const seq = makeSequence(INITIAL_LENGTH);
    setSequence(seq);
    setStreak(0);
    playSequence(seq);
  }, [playSequence]);

  const handlePressIn = () => {
    if (phase === 'idle') { startNewGame(); return; }
    if (phase !== 'listening') return;

    pressStartRef.current = Date.now();
    crossedDashRef.current = false;
    setIsHolding(true);
    setHoldCrossed(false);
    haptics.light();

    holdTimerRef.current = setTimeout(() => {
      crossedDashRef.current = true;
      setHoldCrossed(true);
      haptics.heavy();
    }, HOLD_THRESHOLD_MS);
  };

  const handlePressOut = () => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (!isHolding || phase !== 'listening') {
      setIsHolding(false);
      setHoldCrossed(false);
      return;
    }

    const elapsed = Date.now() - pressStartRef.current;
    const entered = crossedDashRef.current || elapsed >= HOLD_THRESHOLD_MS ? 'DASH' : 'DOT';
    setIsHolding(false);
    setHoldCrossed(false);

    if (entered === 'DOT') haptics.rigid();

    if (entered !== sequence[inputIndex]) {
      setPhase('fail');
      haptics.error();
      nextTimerRef.current = setTimeout(() => startNewGame(), 1100);
      return;
    }

    const nextIdx = inputIndex + 1;
    setInputIndex(nextIdx);
    if (nextIdx >= sequence.length) {
      const nextStreak = streak + 1;
      setStreak(nextStreak);
      setBestStreak((b) => Math.max(b, nextStreak));
      setPhase('success');
      haptics.success();
      const nextSeq = [...sequence, makeRandomSymbol()];
      setSequence(nextSeq);
      nextTimerRef.current = setTimeout(() => playSequence(nextSeq), 950);
    }
  };

  const phaseLabel = {
    idle: 'TAP PAD TO START',
    playing: 'FEEL THE PATTERN...',
    listening: 'ECHO IT BACK (TAP = DOT, HOLD = DASH)',
    success: 'NAILED IT! +1 BEAT...',
    fail: 'MISSED — RESTARTING...',
  }[phase];

  return (
    <View style={[rhythmStyles.container, blindMode && rhythmStyles.blackout]}>
      {!blindMode && (
        <View style={rhythmStyles.hud}>
          <View style={rhythmStyles.hudRow}>
            <View>
              <Text style={rhythmStyles.kicker}>STREAK</Text>
              <Text style={rhythmStyles.bigStat}>{streak}</Text>
            </View>
            <View>
              <Text style={rhythmStyles.kicker}>BEST</Text>
              <Text style={rhythmStyles.bigStat}>{bestStreak}</Text>
            </View>
            <TouchableOpacity
              style={rhythmStyles.pillBtn}
              onPress={() => {
                if (sequence.length > 0 && phase === 'listening') playSequence(sequence);
                else startNewGame();
              }}
            >
              <Text style={rhythmStyles.pillText}>{sequence.length > 0 ? 'REPLAY' : 'START'}</Text>
            </TouchableOpacity>
          </View>
          <View style={rhythmStyles.beatStrip}>
            {sequence.length === 0 ? (
              <Text style={rhythmStyles.legend}>• Quick Tap = Click    ▬ Hold (0.25s) = Double Thump</Text>
            ) : (
              sequence.map((sym, idx) => (
                <View
                  key={idx}
                  style={[
                    sym === 'DOT' ? rhythmStyles.dotPill : rhythmStyles.dashPill,
                    idx === activeBeat && phase === 'playing' && rhythmStyles.beatPlaying,
                    idx < inputIndex && phase === 'listening' && rhythmStyles.beatDone,
                  ]}
                />
              ))
            )}
          </View>
          <Text style={rhythmStyles.phaseText}>{phaseLabel}</Text>
        </View>
      )}
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          rhythmStyles.touchPad,
          blindMode && rhythmStyles.touchPadBlind,
          !blindMode && isHolding && rhythmStyles.padPressed,
          !blindMode && holdCrossed && rhythmStyles.padDash,
          !blindMode && phase === 'success' && rhythmStyles.padSuccess,
          !blindMode && phase === 'fail' && rhythmStyles.padFail,
        ]}
      >
        {!blindMode ? (
          <>
            <Text style={rhythmStyles.padSymbol}>
              {phase === 'idle' ? '◈' : holdCrossed ? '▬' : isHolding ? '•' : phase === 'playing' ? '≈' : '●'}
            </Text>
            <Text style={rhythmStyles.padTitle}>
              {phase === 'idle'
                ? 'TAP ANYWHERE TO BEGIN'
                : holdCrossed
                ? 'DASH LOCKED — RELEASE'
                : isHolding
                ? 'DOT — OR KEEP HOLDING...'
                : phase === 'listening'
                ? `BEAT ${inputIndex + 1} OF ${sequence.length}`
                : phaseLabel}
            </Text>
            <Text style={rhythmStyles.padHint}>Single thumb anywhere on the pad — zero aiming needed</Text>
          </>
        ) : (
          <Text style={rhythmStyles.blindWhisper}>
            {phase === 'idle' ? 'TAP TO START RHYTHM ECHO' : 'RHYTHM ECHO • TAP OR HOLD'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

// ─── Mode 3: Virtual Marble ──────────────────────────────────────────────────
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

const randomHole = () => ({
  x: (Math.random() - 0.5) * 1.35,
  y: (Math.random() - 0.5) * 1.35,
});

function VirtualMarble({ blindMode }) {
  const [tray, setTray] = useState('ridges');
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [hole, setHole] = useState(() => randomHole());
  const [holesScored, setHolesScored] = useState(0);
  const [sensorReady, setSensorReady] = useState(true);
  const [boxSize, setBoxSize] = useState({ width: 300, height: 340 });

  const trayRef = useRef(tray);
  const holeRef = useRef(hole);
  const stateRef = useRef({
    x: 0, y: 0, vx: 0, vy: 0,
    cellX: 0, cellY: 0, lastHitMs: 0, inHoleFrames: 0,
    zeroX: 0, zeroY: 0, rawX: 0, rawY: 0,
  });

  useEffect(() => { trayRef.current = tray; stateRef.current.inHoleFrames = 0; }, [tray]);
  useEffect(() => { holeRef.current = hole; }, [hole]);

  useEffect(() => {
    let sub = null;
    let mounted = true;
    const start = async () => {
      try {
        const available = await Accelerometer.isAvailableAsync();
        if (!mounted) return;
        if (!available) { setSensorReady(false); return; }
        Accelerometer.setUpdateInterval(25);
        sub = Accelerometer.addListener(({ x, y }) => {
          const s = stateRef.current;
          const now = Date.now();
          s.rawX = x;
          s.rawY = y;

          const ax = (x - s.zeroX) * 0.042;
          const ay = -(y - s.zeroY) * 0.042;
          s.vx = (s.vx + ax) * 0.935;
          s.vy = (s.vy + ay) * 0.935;

          const speed = Math.hypot(s.vx, s.vy);
          if (speed > 0.16) {
            s.vx = (s.vx / speed) * 0.16;
            s.vy = (s.vy / speed) * 0.16;
          }

          s.x += s.vx;
          s.y += s.vy;

          const limit = 0.92;
          let wallImpact = 0;
          if (s.x > limit) { s.x = limit; wallImpact = Math.max(wallImpact, Math.abs(s.vx)); s.vx = -s.vx * 0.52; }
          else if (s.x < -limit) { s.x = -limit; wallImpact = Math.max(wallImpact, Math.abs(s.vx)); s.vx = -s.vx * 0.52; }
          if (s.y > limit) { s.y = limit; wallImpact = Math.max(wallImpact, Math.abs(s.vy)); s.vy = -s.vy * 0.52; }
          else if (s.y < -limit) { s.y = -limit; wallImpact = Math.max(wallImpact, Math.abs(s.vy)); s.vy = -s.vy * 0.52; }

          if (wallImpact > 0.018 && now - s.lastHitMs > 75) {
            s.lastHitMs = now;
            if (wallImpact > 0.08) haptics.rigid();
            else if (wallImpact > 0.045) haptics.medium();
            else haptics.soft();
          }

          if (trayRef.current === 'ridges') {
            const cx = Math.floor((s.x + 1) * 3.5);
            const cy = Math.floor((s.y + 1) * 4.5);
            if ((cx !== s.cellX || cy !== s.cellY) && now - s.lastHitMs > 45) {
              s.cellX = cx; s.cellY = cy; s.lastHitMs = now;
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
                const nx = dx / d; const ny = dy / d;
                s.x = p.x + nx * pegRadius; s.y = p.y + ny * pegRadius;
                const dot = s.vx * nx + s.vy * ny;
                if (dot < 0) { s.vx -= 1.7 * dot * nx; s.vy -= 1.7 * dot * ny; }
                if (now - s.lastHitMs > 70) { s.lastHitMs = now; haptics.rigid(); }
              }
            }
          } else if (trayRef.current === 'hole') {
            const h = holeRef.current;
            const dx = h.x - s.x; const dy = h.y - s.y;
            const d = Math.hypot(dx, dy);
            if (d < 0.32 && d > 0.01) {
              s.vx += (dx / d) * 0.006;
              s.vy += (dy / d) * 0.006;
            }
            if (d < 0.15) {
              s.inHoleFrames += 1;
              if (s.inHoleFrames === 1 && now - s.lastHitMs > 80) { s.lastHitMs = now; haptics.tick(); }
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
    return () => { mounted = false; if (sub) sub.remove(); };
  }, []);

  const calibrateFlat = () => {
    haptics.medium();
    const s = stateRef.current;
    s.zeroX = s.rawX; s.zeroY = s.rawY;
    s.x = 0; s.y = 0; s.vx = 0; s.vy = 0;
    setPos({ x: 0, y: 0 });
  };

  const toScreen = (nx, ny) => ({
    left: ((nx + 1) / 2) * (boxSize.width - 28),
    top: ((ny + 1) / 2) * (boxSize.height - 28),
  });

  const marbleStyle = toScreen(pos.x, pos.y);
  const holeStyle = toScreen(hole.x, hole.y);

  return (
    <View style={[marbleStyles.container, blindMode && marbleStyles.blackout]}>
      {!blindMode && (
        <View style={marbleStyles.topRow}>
          <View style={marbleStyles.trayTabs}>
            {TRAYS.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[marbleStyles.trayPill, tray === t.id && marbleStyles.trayPillActive]}
                onPress={() => { haptics.tick(); setTray(t.id); }}
              >
                <Text style={[marbleStyles.trayText, tray === t.id && marbleStyles.trayTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={marbleStyles.resetBtn} onPress={calibrateFlat}>
            <Text style={marbleStyles.resetText}>CENTER</Text>
          </TouchableOpacity>
        </View>
      )}
      <View
        style={[marbleStyles.trayBox, blindMode && marbleStyles.trayBoxBlind]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setBoxSize({ width, height });
        }}
      >
        {!sensorReady ? (
          <Text style={marbleStyles.sensorWarn}>
            Accelerometer unavailable here — open in Expo Go on your iPhone to roll the marble!
          </Text>
        ) : !blindMode ? (
          <>
            {tray === 'ridges' && (
              <View style={marbleStyles.ridgeOverlay} pointerEvents="none">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <View key={`v${i}`} style={[marbleStyles.vLine, { left: `${(i / 7) * 100}%` }]} />
                ))}
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <View key={`h${i}`} style={[marbleStyles.hLine, { top: `${(i / 9) * 100}%` }]} />
                ))}
              </View>
            )}
            {tray === 'pegs' && PEGS.map((p, idx) => <View key={idx} style={[marbleStyles.peg, toScreen(p.x, p.y)]} />)}
            {tray === 'hole' && <View style={[marbleStyles.hole, { left: holeStyle.left - 8, top: holeStyle.top - 8 }]} />}
            <View style={[marbleStyles.marble, marbleStyle]} />
            <View style={marbleStyles.footerBadge}>
              <Text style={marbleStyles.footerText}>
                {tray === 'hole'
                  ? `HOLES DROPPED: ${holesScored}  •  TILT TO GUIDE MARBLE`
                  : 'TILT PHONE LIKE A WOODEN BOX — FEEL WALLS & TEXTURE'}
              </Text>
            </View>
          </>
        ) : (
          <Text style={marbleStyles.blindWhisper}>VIRTUAL MARBLE • TILT PHONE</Text>
        )}
      </View>
    </View>
  );
}

// ─── Mode 4: Hot-or-Cold Hunt ────────────────────────────────────────────────
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

function HotColdHunt({ blindMode }) {
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

  useEffect(() => { beaconRef.current = beacon; }, [beacon]);

  const stopPulse = () => {
    if (pulseTimerRef.current) { clearTimeout(pulseTimerRef.current); pulseTimerRef.current = null; }
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

  const getDistance = (pt) => (!pt ? 1 : Math.hypot(pt.x - beaconRef.current.x, pt.y - beaconRef.current.y));

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
        if (!lockStartRef.current) lockStartRef.current = Date.now();
        else if (Date.now() - lockStartRef.current >= 550) {
          captureBeacon();
          pulseTimerRef.current = setTimeout(loop, 480);
          return;
        }
      } else {
        lockStartRef.current = null;
        if (d <= 0.24) { haptics.medium(); interval = 185; setTempLabel('BURNING HOT'); }
        else if (d <= 0.42) { haptics.light(); interval = 340; setTempLabel('WARM — GETTING CLOSER'); }
        else { haptics.soft(); interval = 680; setTempLabel('COLD — KEEP SWEEPING'); }
      }
      pulseTimerRef.current = setTimeout(loop, interval);
    };
    loop();
  };

  const updateFinger = (evt) => {
    const { width, height } = padSizeRef.current;
    if (!width || !height) return;
    const pt = {
      x: Math.max(0, Math.min(1, evt.nativeEvent.locationX / width)),
      y: Math.max(0, Math.min(1, evt.nativeEvent.locationY / height)),
    };
    fingerRef.current = pt;
    setFinger(pt);
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => { updateFinger(evt); schedulePulse(); },
      onPanResponderMove: (evt) => updateFinger(evt),
      onPanResponderRelease: () => {
        const pt = fingerRef.current;
        const onTarget = pt && getDistance(pt) <= 0.12;
        fingerRef.current = null;
        setFinger(null);
        if (onTarget) captureBeacon();
        else { stopPulse(); setTempLabel('TOUCH & SWEEP TO SENSE THE BEACON'); }
      },
      onPanResponderTerminate: () => { fingerRef.current = null; setFinger(null); stopPulse(); },
    })
  ).current;

  const dist = finger ? getDistance(finger) : 1;
  const ringColor = dist <= 0.11 ? COLORS.success : dist <= 0.24 ? COLORS.accent : dist <= 0.42 ? '#60A5FA' : COLORS.borderStrong;

  return (
    <View style={[huntStyles.container, blindMode && huntStyles.blackout]}>
      {!blindMode && (
        <View style={huntStyles.hud}>
          <View>
            <Text style={huntStyles.kicker}>BEACONS FOUND</Text>
            <Text style={huntStyles.bigStat}>{foundCount}</Text>
          </View>
          <TouchableOpacity
            style={[huntStyles.pillBtn, showTarget && huntStyles.pillBtnActive]}
            onPress={() => { haptics.tick(); setShowTarget((v) => !v); }}
          >
            <Text style={[huntStyles.pillText, showTarget && huntStyles.pillTextActive]}>
              {showTarget ? 'PEEK: ON' : 'PEEK: OFF'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
      <View
        style={[huntStyles.pad, blindMode && huntStyles.padBlind]}
        onLayout={(e) => { padSizeRef.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }; }}
        {...panResponder.panHandlers}
      >
        {!blindMode ? (
          <View style={huntStyles.padOverlay} pointerEvents="none">
            {showTarget && <View style={[huntStyles.targetDot, { left: `${beacon.x * 100}%`, top: `${beacon.y * 100}%` }]} />}
            {finger && <View style={[huntStyles.fingerRing, { left: `${finger.x * 100}%`, top: `${finger.y * 100}%`, borderColor: ringColor }]} />}
            <View style={huntStyles.statusChip}>
              <Text style={huntStyles.statusText}>{tempLabel}</Text>
            </View>
          </View>
        ) : (
          <View style={huntStyles.padOverlay} pointerEvents="none">
            <Text style={huntStyles.blindWhisper}>HOT OR COLD • SWEEP TO HUNT</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Mode 5: Fidget Sandbox ──────────────────────────────────────────────────
const SWITCH_FEELS = [
  { id: 'clicky', label: 'CLICKY', down: 'rigid', up: 'light' },
  { id: 'thock', label: 'THOCK', down: 'heavy', up: 'soft' },
  { id: 'subtle', label: 'SUBTLE', down: 'tick', up: 'tick' },
];
const SLIDER_STOPS = 12;
const BUBBLE_COUNT = 12;

function FidgetSandbox({ blindMode }) {
  const [switchFeel, setSwitchFeel] = useState('clicky');
  const [clicks, setClicks] = useState(0);
  const [switchDown, setSwitchDown] = useState(false);

  const [sliderStep, setSliderStep] = useState(6);
  const sliderWidthRef = useRef(260);
  const sliderStepRef = useRef(6);

  const [popped, setPopped] = useState(() => Array(BUBBLE_COUNT).fill(false));
  const [breathing, setBreathing] = useState(false);
  const [breathPhase, setBreathPhase] = useState('IDLE');
  const breathTimerRef = useRef(null);

  useEffect(() => {
    if (!breathing) {
      if (breathTimerRef.current) clearInterval(breathTimerRef.current);
      setBreathPhase('IDLE');
      return;
    }
    let halfSec = 0;
    const tickBreath = () => {
      const sec = (halfSec * 0.5) % 19;
      if (sec < 4) { setBreathPhase(`INHALE (${Math.ceil(4 - sec)}s)`); haptics.soft(); }
      else if (sec < 11) { setBreathPhase(`HOLD (${Math.ceil(11 - sec)}s)`); if (sec === 4) haptics.medium(); }
      else { setBreathPhase(`EXHALE (${Math.ceil(19 - sec)}s)`); if (halfSec % 2 === 0) haptics.light(); }
      halfSec += 1;
    };
    tickBreath();
    breathTimerRef.current = setInterval(tickBreath, 500);
    return () => { if (breathTimerRef.current) clearInterval(breathTimerRef.current); };
  }, [breathing]);

  const updateSliderFromX = (x) => {
    const w = Math.max(1, sliderWidthRef.current);
    const ratio = Math.max(0, Math.min(1, x / w));
    const step = Math.round(ratio * (SLIDER_STOPS - 1));
    if (step !== sliderStepRef.current) {
      sliderStepRef.current = step;
      setSliderStep(step);
      if (step === 0 || step === SLIDER_STOPS - 1) haptics.heavy();
      else haptics.medium();
    }
  };

  const sliderResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => updateSliderFromX(evt.nativeEvent.locationX),
      onPanResponderMove: (evt) => updateSliderFromX(evt.nativeEvent.locationX),
    })
  ).current;

  const feelObj = SWITCH_FEELS.find((f) => f.id === switchFeel) || SWITCH_FEELS[0];

  const handlePop = (idx) => {
    if (popped[idx]) return;
    haptics.rigid();
    const next = [...popped];
    next[idx] = true;
    setPopped(next);
    if (next.every(Boolean)) {
      setTimeout(() => { haptics.success(); setPopped(Array(BUBBLE_COUNT).fill(false)); }, 260);
    }
  };

  if (blindMode) {
    return (
      <Pressable
        style={sandboxStyles.blindFull}
        onPressIn={() => { setSwitchDown(true); haptics[feelObj.down](); setClicks((c) => c + 1); }}
        onPressOut={() => { setSwitchDown(false); haptics[feelObj.up](); }}
      >
        <Text style={sandboxStyles.blindWhisper}>
          {breathing ? `BREATHING • ${breathPhase}` : `SWITCH SANDBOX • ${feelObj.label}`}
        </Text>
      </Pressable>
    );
  }

  return (
    <ScrollView style={sandboxStyles.scroll} contentContainerStyle={sandboxStyles.scrollContent} showsVerticalScrollIndicator={false}>
      <View style={sandboxStyles.card}>
        <View style={sandboxStyles.cardHeader}>
          <Text style={sandboxStyles.cardTitle}>1. VIRTUAL SWITCH</Text>
          <Text style={sandboxStyles.counter}>{clicks} CLICKS</Text>
        </View>
        <View style={sandboxStyles.feelRow}>
          {SWITCH_FEELS.map((f) => (
            <TouchableOpacity
              key={f.id}
              style={[sandboxStyles.miniPill, switchFeel === f.id && sandboxStyles.miniPillActive]}
              onPress={() => { haptics.tick(); setSwitchFeel(f.id); }}
            >
              <Text style={[sandboxStyles.miniPillText, switchFeel === f.id && sandboxStyles.miniPillTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Pressable
          onPressIn={() => { setSwitchDown(true); haptics[feelObj.down](); setClicks((c) => c + 1); }}
          onPressOut={() => { setSwitchDown(false); haptics[feelObj.up](); }}
          style={[sandboxStyles.keycap, switchDown && sandboxStyles.keycapPressed]}
        >
          <Text style={sandboxStyles.keycapText}>{switchDown ? 'PRESSED' : 'PRESS & RELEASE'}</Text>
        </Pressable>
      </View>

      <View style={sandboxStyles.card}>
        <View style={sandboxStyles.cardHeader}>
          <Text style={sandboxStyles.cardTitle}>2. MAGNETIC SLIDER</Text>
          <Text style={sandboxStyles.counter}>STOP {sliderStep + 1}/{SLIDER_STOPS}</Text>
        </View>
        <View style={sandboxStyles.sliderTrack}>
          <View
            style={sandboxStyles.sliderInner}
            onLayout={(e) => { sliderWidthRef.current = e.nativeEvent.layout.width; }}
            {...sliderResponder.panHandlers}
          >
            <View style={sandboxStyles.sliderDotsRow} pointerEvents="none">
              {Array.from({ length: SLIDER_STOPS }).map((_, i) => (
                <View key={i} style={[sandboxStyles.sliderTick, i === sliderStep && sandboxStyles.sliderTickActive]} />
              ))}
            </View>
            <View pointerEvents="none" style={[sandboxStyles.sliderThumb, { left: `${(sliderStep / (SLIDER_STOPS - 1)) * 100}%` }]} />
          </View>
        </View>
      </View>

      <View style={sandboxStyles.card}>
        <View style={sandboxStyles.cardHeader}>
          <Text style={sandboxStyles.cardTitle}>3. BUBBLE POP</Text>
          <Text style={sandboxStyles.counter}>{popped.filter(Boolean).length}/{BUBBLE_COUNT}</Text>
        </View>
        <View style={sandboxStyles.bubbleGrid}>
          {popped.map((isPopped, idx) => (
            <Pressable key={idx} onPressIn={() => handlePop(idx)} style={[sandboxStyles.bubble, isPopped && sandboxStyles.bubblePopped]}>
              <View style={[sandboxStyles.bubbleInner, isPopped && sandboxStyles.bubbleInnerPopped]} />
            </Pressable>
          ))}
        </View>
      </View>

      <View style={sandboxStyles.card}>
        <View style={sandboxStyles.cardHeader}>
          <Text style={sandboxStyles.cardTitle}>4. PALM BREATHING (4-7-8)</Text>
          <Text style={[sandboxStyles.counter, breathing && { color: COLORS.success }]}>{breathPhase}</Text>
        </View>
        <TouchableOpacity
          style={[sandboxStyles.breathBtn, breathing && sandboxStyles.breathBtnActive]}
          onPress={() => { haptics.medium(); setBreathing((b) => !b); }}
        >
          <Text style={[sandboxStyles.breathBtnText, breathing && { color: COLORS.success }]}>
            {breathing ? 'STOP SILENT PACER' : 'START SILENT PALM PACER'}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

// ─── Root App ────────────────────────────────────────────────────────────────
const MODES = [
  { id: 'safe', label: 'Safe', icon: '◎', component: SafeCracker },
  { id: 'rhythm', label: 'Echo', icon: '◈', component: RhythmEcho },
  { id: 'marble', label: 'Marble', icon: '●', component: VirtualMarble },
  { id: 'hunt', label: 'Sonar', icon: '◉', component: HotColdHunt },
  { id: 'sandbox', label: 'Fidget', icon: '⊞', component: FidgetSandbox },
];

export default function App() {
  const [activeId, setActiveId] = useState('safe');
  const [blindMode, setBlindMode] = useState(false);

  const activeMode = MODES.find((m) => m.id === activeId) || MODES[0];
  const ActiveComponent = activeMode.component;

  return (
    <SafeAreaView style={[appStyles.root, blindMode && appStyles.rootBlind]}>
      <StatusBar barStyle="light-content" backgroundColor={blindMode ? '#000000' : COLORS.bg} />

      {blindMode ? (
        <View style={appStyles.blindTopBar}>
          <TouchableOpacity
            style={appStyles.blindExitBtn}
            onPress={() => { haptics.medium(); setBlindMode(false); }}
          >
            <Text style={appStyles.blindExitText}>EXIT EYES-FREE ({activeMode.label.toUpperCase()})</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={appStyles.header}>
            <View>
              <Text style={appStyles.brand}>OPEN FIDGET</Text>
              <Text style={appStyles.subtitle}>Haptic Validation Lab v0</Text>
            </View>
            <TouchableOpacity
              style={appStyles.blindBtn}
              onPress={() => { haptics.medium(); setBlindMode(true); }}
            >
              <Text style={appStyles.blindBtnText}>◐ EYES-FREE</Text>
            </TouchableOpacity>
          </View>
          <View style={appStyles.tabWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={appStyles.tabRow}>
              {MODES.map((m) => {
                const active = m.id === activeId;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[appStyles.tab, active && appStyles.tabActive]}
                    onPress={() => { haptics.tick(); setActiveId(m.id); }}
                  >
                    <Text style={[appStyles.tabIcon, active && appStyles.tabTextActive]}>{m.icon}</Text>
                    <Text style={[appStyles.tabLabel, active && appStyles.tabTextActive]}>{m.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </>
      )}

      <View style={appStyles.stage}>
        <ActiveComponent key={activeId} blindMode={blindMode} />
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const appStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0 },
  rootBlind: { backgroundColor: COLORS.blackout },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10 },
  brand: { color: COLORS.text, fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  subtitle: { color: COLORS.textMuted, fontSize: 11, marginTop: 2 },
  blindBtn: { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.borderStrong },
  blindBtnText: { color: COLORS.text, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  blindTopBar: { alignItems: 'center', paddingTop: 10, paddingBottom: 6, backgroundColor: COLORS.blackout },
  blindExitBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: '#1E1E24' },
  blindExitText: { color: '#3F3F4A', fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  tabWrap: { marginBottom: 12 },
  tabRow: { paddingHorizontal: 16, gap: 8 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  tabActive: { backgroundColor: COLORS.accentSoft, borderColor: COLORS.accent },
  tabIcon: { color: COLORS.textMuted, fontSize: 14 },
  tabLabel: { color: COLORS.textMuted, fontSize: 13, fontWeight: '700' },
  tabTextActive: { color: COLORS.accent },
  stage: { flex: 1 },
});

const safeStyles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
  blackout: { backgroundColor: COLORS.blackout, paddingHorizontal: 0, paddingBottom: 0 },
  hud: { backgroundColor: COLORS.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  hudRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  bigStat: { color: COLORS.text, fontSize: 28, fontWeight: '800' },
  pinRow: { flexDirection: 'row', gap: 10 },
  pinDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: COLORS.surfaceElevated, borderWidth: 1.5, borderColor: COLORS.borderStrong },
  pinDotLocked: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  pillBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.borderStrong, backgroundColor: COLORS.surfaceElevated },
  pillBtnActive: { borderColor: COLORS.danger, backgroundColor: COLORS.dangerSoft },
  pillText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  pillTextActive: { color: COLORS.danger },
  status: { color: COLORS.textMuted, fontSize: 13, marginTop: 10, marginBottom: 12 },
  dialStrip: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 28, paddingHorizontal: 2 },
  notch: { width: 4, height: 10, borderRadius: 2, backgroundColor: COLORS.borderStrong },
  notchMajor: { height: 16, backgroundColor: COLORS.textDim },
  notchActive: { height: 26, width: 6, backgroundColor: COLORS.accent },
  notchTarget: { backgroundColor: COLORS.success },
  dialReadout: { color: COLORS.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginTop: 8, textAlign: 'center' },
  touchPad: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 24, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', padding: 24 },
  touchPadActive: { borderColor: COLORS.accent, backgroundColor: '#171512' },
  touchPadHot: { borderColor: COLORS.success, backgroundColor: '#0F1915' },
  touchPadBlind: { backgroundColor: COLORS.blackout, borderWidth: 0, borderRadius: 0 },
  padIcon: { fontSize: 42, color: COLORS.accent, marginBottom: 12 },
  padTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800', letterSpacing: 1.2, textAlign: 'center' },
  padHint: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 19 },
  blindWhisper: { color: '#18181C', fontSize: 11, letterSpacing: 2, fontWeight: '700' },
});

const rhythmStyles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
  blackout: { backgroundColor: COLORS.blackout, paddingHorizontal: 0, paddingBottom: 0 },
  hud: { backgroundColor: COLORS.surface, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  hudRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  bigStat: { color: COLORS.text, fontSize: 28, fontWeight: '800' },
  pillBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: COLORS.borderStrong, backgroundColor: COLORS.surfaceElevated },
  pillText: { color: COLORS.text, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  beatStrip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 28, marginTop: 14 },
  legend: { color: COLORS.textMuted, fontSize: 12 },
  dotPill: { width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.borderStrong },
  dashPill: { width: 28, height: 12, borderRadius: 6, backgroundColor: COLORS.borderStrong },
  beatPlaying: { backgroundColor: COLORS.accent },
  beatDone: { backgroundColor: COLORS.success },
  phaseText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textAlign: 'center', marginTop: 10 },
  touchPad: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 24, borderWidth: 1.5, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center', padding: 24 },
  padPressed: { borderColor: COLORS.accent, backgroundColor: '#191610' },
  padDash: { borderColor: COLORS.accent, backgroundColor: '#261D0D' },
  padSuccess: { borderColor: COLORS.success, backgroundColor: '#0F1C16' },
  padFail: { borderColor: COLORS.danger, backgroundColor: '#1F1012' },
  touchPadBlind: { backgroundColor: COLORS.blackout, borderWidth: 0, borderRadius: 0 },
  padSymbol: { fontSize: 48, color: COLORS.accent, marginBottom: 12 },
  padTitle: { color: COLORS.text, fontSize: 15, fontWeight: '800', letterSpacing: 1.2, textAlign: 'center' },
  padHint: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', marginTop: 8 },
  blindWhisper: { color: '#18181C', fontSize: 11, letterSpacing: 2, fontWeight: '700' },
});

const marbleStyles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
  blackout: { backgroundColor: COLORS.blackout, paddingHorizontal: 0, paddingBottom: 0 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 },
  trayTabs: { flexDirection: 'row', gap: 6, flex: 1 },
  trayPill: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  trayPillActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  trayText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  trayTextActive: { color: COLORS.accent },
  resetBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.surfaceElevated, borderWidth: 1, borderColor: COLORS.borderStrong },
  resetText: { color: COLORS.text, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  trayBox: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 24, borderWidth: 2, borderColor: COLORS.borderStrong, overflow: 'hidden', position: 'relative', alignItems: 'center', justifyContent: 'center' },
  trayBoxBlind: { backgroundColor: COLORS.blackout, borderWidth: 0, borderRadius: 0 },
  ridgeOverlay: { ...StyleSheet.absoluteFillObject },
  vLine: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#1E1E26' },
  hLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#1E1E26' },
  peg: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.surfaceElevated, borderWidth: 2, borderColor: COLORS.borderStrong },
  hole: { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: '#050507', borderWidth: 2, borderColor: COLORS.success },
  marble: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.accent, borderWidth: 2, borderColor: '#FDE68A' },
  footerBadge: { position: 'absolute', bottom: 14, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(9, 9, 11, 0.82)', borderWidth: 1, borderColor: COLORS.border },
  footerText: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.9 },
  sensorWarn: { color: COLORS.textMuted, textAlign: 'center', padding: 24, lineHeight: 20 },
  blindWhisper: { color: '#18181C', fontSize: 11, letterSpacing: 2, fontWeight: '700' },
});

const huntStyles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 16, paddingBottom: 16 },
  blackout: { backgroundColor: COLORS.blackout, paddingHorizontal: 0, paddingBottom: 0 },
  hud: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: COLORS.surface, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: 12 },
  kicker: { color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  bigStat: { color: COLORS.text, fontSize: 26, fontWeight: '800' },
  pillBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: COLORS.borderStrong, backgroundColor: COLORS.surfaceElevated },
  pillBtnActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  pillText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  pillTextActive: { color: COLORS.accent },
  pad: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 24, borderWidth: 1.5, borderColor: COLORS.border, overflow: 'hidden' },
  padBlind: { backgroundColor: COLORS.blackout, borderWidth: 0, borderRadius: 0 },
  padOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  targetDot: { position: 'absolute', width: 26, height: 26, marginLeft: -13, marginTop: -13, borderRadius: 13, backgroundColor: COLORS.successSoft, borderWidth: 2, borderColor: COLORS.success },
  fingerRing: { position: 'absolute', width: 68, height: 68, marginLeft: -34, marginTop: -34, borderRadius: 34, borderWidth: 2.5 },
  statusChip: { position: 'absolute', bottom: 18, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(9, 9, 11, 0.85)', borderWidth: 1, borderColor: COLORS.border },
  statusText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  blindWhisper: { color: '#18181C', fontSize: 11, letterSpacing: 2, fontWeight: '700' },
});

const sandboxStyles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 28, gap: 12 },
  blindFull: { flex: 1, backgroundColor: COLORS.blackout, alignItems: 'center', justifyContent: 'center' },
  blindWhisper: { color: '#18181C', fontSize: 11, letterSpacing: 2, fontWeight: '700' },
  card: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: COLORS.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTitle: { color: COLORS.text, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  counter: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  feelRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  miniPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.borderStrong, backgroundColor: COLORS.surfaceElevated },
  miniPillActive: { borderColor: COLORS.accent, backgroundColor: COLORS.accentSoft },
  miniPillText: { color: COLORS.textMuted, fontSize: 11, fontWeight: '700' },
  miniPillTextActive: { color: COLORS.accent },
  keycap: { height: 76, borderRadius: 16, backgroundColor: COLORS.surfaceElevated, borderWidth: 1.5, borderColor: COLORS.borderStrong, borderBottomWidth: 5, alignItems: 'center', justifyContent: 'center' },
  keycapPressed: { borderBottomWidth: 1.5, borderColor: COLORS.accent, backgroundColor: '#211B11', transform: [{ translateY: 2 }] },
  keycapText: { color: COLORS.text, fontSize: 13, fontWeight: '800', letterSpacing: 1.4 },
  sliderTrack: { height: 56, borderRadius: 16, backgroundColor: COLORS.surfaceElevated, borderWidth: 1, borderColor: COLORS.borderStrong, justifyContent: 'center', paddingHorizontal: 18 },
  sliderInner: { flex: 1, justifyContent: 'center', position: 'relative' },
  sliderDotsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderTick: { width: 4, height: 12, borderRadius: 2, backgroundColor: COLORS.borderStrong },
  sliderTickActive: { height: 22, backgroundColor: COLORS.accent },
  sliderThumb: { position: 'absolute', width: 24, height: 40, marginLeft: -12, borderRadius: 10, backgroundColor: COLORS.accentSoft, borderWidth: 2, borderColor: COLORS.accent },
  bubbleGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  bubble: { width: '22.5%', aspectRatio: 1, borderRadius: 999, backgroundColor: COLORS.surfaceElevated, borderWidth: 1.5, borderColor: COLORS.borderStrong, alignItems: 'center', justifyContent: 'center' },
  bubblePopped: { backgroundColor: '#0E0E12', borderColor: '#1E1E26' },
  bubbleInner: { width: '56%', height: '56%', borderRadius: 999, backgroundColor: COLORS.accentSoft, borderWidth: 1, borderColor: COLORS.accent },
  bubbleInnerPopped: { width: '28%', height: '28%', backgroundColor: 'transparent', borderColor: '#282832' },
  breathBtn: { height: 48, borderRadius: 14, backgroundColor: COLORS.surfaceElevated, borderWidth: 1, borderColor: COLORS.borderStrong, alignItems: 'center', justifyContent: 'center' },
  breathBtnActive: { borderColor: COLORS.success, backgroundColor: COLORS.successSoft },
  breathBtnText: { color: COLORS.text, fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
});
