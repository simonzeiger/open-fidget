import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { haptics, playPattern } from '../haptics';
import { COLORS } from '../theme';

const HOLD_THRESHOLD_MS = 250;
const INITIAL_LENGTH = 3;

function makeRandomSymbol() {
  return Math.random() < 0.5 ? 'DOT' : 'DASH';
}

function makeSequence(len) {
  return Array.from({ length: len }, makeRandomSymbol);
}

export default function RhythmEcho({ blindMode }) {
  const [phase, setPhase] = useState('idle'); // idle | playing | listening | success | fail
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
    if (cancelPlaybackRef.current) {
      cancelPlaybackRef.current();
      cancelPlaybackRef.current = null;
    }
    if (nextTimerRef.current) {
      clearTimeout(nextTimerRef.current);
      nextTimerRef.current = null;
    }
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  useEffect(() => cleanupTimers, [cleanupTimers]);

  const playSequence = useCallback(
    (seq) => {
      cleanupTimers();
      setPhase('playing');
      setInputIndex(0);
      setActiveBeat(-1);

      const steps = [];
      seq.forEach((sym, idx) => {
        if (sym === 'DOT') {
          steps.push({
            type: 'rigid',
            delay: 420,
            onStep: () => setActiveBeat(idx),
          });
        } else {
          // DASH: unmistakable double-thump
          steps.push({
            type: 'heavy',
            delay: 115,
            onStep: () => setActiveBeat(idx),
          });
          steps.push({
            type: 'medium',
            delay: 420,
          });
        }
      });

      // Tiny initial pause so user settles thumb
      nextTimerRef.current = setTimeout(() => {
        cancelPlaybackRef.current = playPattern(steps, () => {
          setActiveBeat(-1);
          setPhase('listening');
        });
      }, 320);
    },
    [cleanupTimers]
  );

  const startNewGame = useCallback(() => {
    const seq = makeSequence(INITIAL_LENGTH);
    setSequence(seq);
    setStreak(0);
    playSequence(seq);
  }, [playSequence]);

  const handlePressIn = () => {
    if (phase === 'idle') {
      startNewGame();
      return;
    }
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
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (!isHolding || phase !== 'listening') {
      setIsHolding(false);
      setHoldCrossed(false);
      return;
    }

    const elapsed = Date.now() - pressStartRef.current;
    const entered = crossedDashRef.current || elapsed >= HOLD_THRESHOLD_MS ? 'DASH' : 'DOT';

    setIsHolding(false);
    setHoldCrossed(false);

    if (entered === 'DOT') {
      haptics.rigid();
    }

    const expected = sequence[inputIndex];
    if (entered !== expected) {
      setPhase('fail');
      haptics.error();
      nextTimerRef.current = setTimeout(() => {
        startNewGame();
      }, 1100);
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
      nextTimerRef.current = setTimeout(() => {
        playSequence(nextSeq);
      }, 950);
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
    <View style={[styles.container, blindMode && styles.blackout]}>
      {!blindMode && (
        <View style={styles.hud}>
          <View style={styles.hudRow}>
            <View>
              <Text style={styles.kicker}>STREAK</Text>
              <Text style={styles.bigStat}>{streak}</Text>
            </View>
            <View>
              <Text style={styles.kicker}>BEST</Text>
              <Text style={styles.bigStat}>{bestStreak}</Text>
            </View>
            <TouchableOpacity
              style={styles.pillBtn}
              onPress={() => {
                if (sequence.length > 0 && phase === 'listening') {
                  playSequence(sequence);
                } else {
                  startNewGame();
                }
              }}
            >
              <Text style={styles.pillText}>
                {sequence.length > 0 ? 'REPLAY' : 'START'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.beatStrip}>
            {sequence.length === 0 ? (
              <Text style={styles.legend}>
                • Quick Tap = Crisp Click    ▬ Hold (0.25s) = Double Thump
              </Text>
            ) : (
              sequence.map((sym, idx) => {
                const done = idx < inputIndex && phase === 'listening';
                const currentPlay = idx === activeBeat && phase === 'playing';
                return (
                  <View
                    key={idx}
                    style={[
                      sym === 'DOT' ? styles.dotPill : styles.dashPill,
                      currentPlay && styles.beatPlaying,
                      done && styles.beatDone,
                    ]}
                  />
                );
              })
            )}
          </View>
          <Text style={styles.phaseText}>{phaseLabel}</Text>
        </View>
      )}

      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.touchPad,
          blindMode && styles.touchPadBlind,
          !blindMode && phase === 'playing' && styles.padPlaying,
          !blindMode && isHolding && styles.padPressed,
          !blindMode && holdCrossed && styles.padDash,
          !blindMode && phase === 'success' && styles.padSuccess,
          !blindMode && phase === 'fail' && styles.padFail,
        ]}
      >
        {!blindMode ? (
          <>
            <Text style={styles.padSymbol}>
              {phase === 'idle'
                ? '◈'
                : holdCrossed
                ? '▬'
                : isHolding
                ? '•'
                : phase === 'playing'
                ? '≈'
                : '●'}
            </Text>
            <Text style={styles.padTitle}>
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
            <Text style={styles.padHint}>
              No buttons to aim at — single thumb anywhere on the pad
            </Text>
          </>
        ) : (
          <Text style={styles.blindWhisper}>
            {phase === 'idle' ? 'TAP TO START RHYTHM ECHO' : 'RHYTHM ECHO • TAP OR HOLD'}
          </Text>
        )}
      </Pressable>
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
  pillBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surfaceElevated,
  },
  pillText: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  beatStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 28,
    marginTop: 14,
  },
  legend: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  dotPill: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.borderStrong,
  },
  dashPill: {
    width: 28,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.borderStrong,
  },
  beatPlaying: {
    backgroundColor: COLORS.accent,
  },
  beatDone: {
    backgroundColor: COLORS.success,
  },
  phaseText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 10,
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
  padPlaying: {
    borderColor: COLORS.accentSoft,
  },
  padPressed: {
    borderColor: COLORS.accent,
    backgroundColor: '#191610',
  },
  padDash: {
    borderColor: COLORS.accent,
    backgroundColor: '#261D0D',
  },
  padSuccess: {
    borderColor: COLORS.success,
    backgroundColor: '#0F1C16',
  },
  padFail: {
    borderColor: COLORS.danger,
    backgroundColor: '#1F1012',
  },
  touchPadBlind: {
    backgroundColor: COLORS.blackout,
    borderWidth: 0,
    borderRadius: 0,
  },
  padSymbol: {
    fontSize: 48,
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
  },
  blindWhisper: {
    color: '#18181C',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
});
