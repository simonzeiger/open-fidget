import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
} from 'react-native';
import { haptics, playPattern } from '../haptics';
import { COLORS } from '../theme';

const HAPTIC_TYPES = ['tick', 'light', 'soft', 'medium', 'rigid', 'heavy'];
const GAP_OPTIONS_MS = [15, 25, 35, 50, 80];
const NOTIF_OVERLAP_MS = [50, 180, 250];
const QUIZ_LENGTH = 10;

function pickRandomCue() {
  return HAPTIC_TYPES[Math.floor(Math.random() * HAPTIC_TYPES.length)];
}

function formatConfusionSummary(trials) {
  const counts = {};
  for (let i = 0; i < trials.length; i += 1) {
    const { expected, felt } = trials[i];
    if (expected !== felt) {
      const key = `${expected}→${felt}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return 'No confusions (100% clean)';
  }
  return entries.map(([pair, n]) => `${pair} (${n})`).join(', ');
}

export default function HapticBench({ blindMode }) {
  const [selectedType, setSelectedType] = useState('tick');
  const [selectedGap, setSelectedGap] = useState(35);
  const [lastPatternLabel, setLastPatternLabel] = useState('Ready — pick type & gap');

  // 10-pulse blind cue quiz state
  const [quizPhase, setQuizPhase] = useState('idle'); // 'idle' | 'active' | 'done'
  const [quizTarget, setQuizTarget] = useState(null);
  const [quizTrials, setQuizTrials] = useState([]);

  const cancelPatternRef = useRef(null);

  const stopActivePattern = useCallback(() => {
    if (cancelPatternRef.current) {
      cancelPatternRef.current();
      cancelPatternRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopActivePattern();
    };
  }, [stopActivePattern]);

  const firePattern = useCallback(
    (steps, label) => {
      stopActivePattern();
      setLastPatternLabel(label);
      cancelPatternRef.current = playPattern(steps, () => {
        cancelPatternRef.current = null;
      });
    },
    [stopActivePattern]
  );

  const fireSingle = useCallback(
    (type) => {
      stopActivePattern();
      if (haptics[type]) {
        haptics[type]();
      }
    },
    [stopActivePattern]
  );

  const handleDoublePulse = () => {
    firePattern(
      [
        { type: selectedType, delay: selectedGap },
        { type: selectedType, delay: 0 },
      ],
      `Double ${selectedType} @ ${selectedGap}ms`
    );
  };

  const handleFiveRatchet = () => {
    const steps = Array.from({ length: 5 }, (_, i) => ({
      type: selectedType,
      delay: i < 4 ? selectedGap : 0,
    }));
    firePattern(steps, `5x ${selectedType} ratchet @ ${selectedGap}ms`);
  };

  const handleNotifOverlap = (gapMs) => {
    firePattern(
      [
        { type: 'success', delay: gapMs },
        { type: 'rigid', delay: 0 },
      ],
      `Notif overlap: success → rigid @ ${gapMs}ms`
    );
  };

  const startQuiz = useCallback(() => {
    const firstCue = pickRandomCue();
    setQuizTrials([]);
    setQuizTarget(firstCue);
    setQuizPhase('active');
    fireSingle(firstCue);
  }, [fireSingle]);

  const replayQuizCue = useCallback(() => {
    if (quizPhase === 'active' && quizTarget) {
      fireSingle(quizTarget);
    } else {
      startQuiz();
    }
  }, [quizPhase, quizTarget, fireSingle, startQuiz]);

  const handleGuess = (felt) => {
    if (quizPhase !== 'active' || !quizTarget) return;
    const nextTrials = [...quizTrials, { expected: quizTarget, felt }];
    setQuizTrials(nextTrials);

    if (nextTrials.length >= QUIZ_LENGTH) {
      setQuizPhase('done');
      setQuizTarget(null);
      return;
    }

    const nextCue = pickRandomCue();
    setQuizTarget(nextCue);
    fireSingle(nextCue);
  };

  const resetQuiz = () => {
    stopActivePattern();
    setQuizPhase('idle');
    setQuizTarget(null);
    setQuizTrials([]);
  };

  const score = quizTrials.reduce(
    (acc, t) => acc + (t.expected === t.felt ? 1 : 0),
    0
  );
  const confusionSummary = formatConfusionSummary(quizTrials);

  if (blindMode) {
    return (
      <Pressable
        style={styles.blindFull}
        onPress={replayQuizCue}
      >
        <Text style={styles.blindWhisper} pointerEvents="none">
          {quizPhase === 'active'
            ? `BLIND QUIZ ${quizTrials.length + 1}/${QUIZ_LENGTH} • TAP TO REPLAY`
            : 'HAPTIC BENCH • TAP TO FIRE CUE'}
        </Text>
      </Pressable>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Section A: Gap & Settling Tester */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>A. GAP & SETTLING TESTER</Text>
          <Text style={styles.counter}>{selectedType.toUpperCase()} • {selectedGap}ms</Text>
        </View>

        <Text style={styles.subLabel}>HAPTIC TYPE</Text>
        <View style={styles.pillWrap}>
          {HAPTIC_TYPES.map((t) => {
            const active = selectedType === t;
            return (
              <TouchableOpacity
                key={t}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => {
                  setSelectedType(t);
                  fireSingle(t);
                }}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {t}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.subLabel}>INTER-PULSE GAP</Text>
        <View style={styles.pillWrap}>
          {GAP_OPTIONS_MS.map((ms) => {
            const active = selectedGap === ms;
            return (
              <TouchableOpacity
                key={ms}
                style={[styles.pill, active && styles.pillActive]}
                onPress={() => setSelectedGap(ms)}
              >
                <Text style={[styles.pillText, active && styles.pillTextActive]}>
                  {ms}ms
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleDoublePulse}>
            <Text style={styles.primaryBtnText}>DOUBLE PULSE</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleFiveRatchet}>
            <Text style={styles.primaryBtnText}>5x RATCHET</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.subLabel}>NOTIF OVERLAP (success → rigid)</Text>
        <View style={styles.actionRow}>
          {NOTIF_OVERLAP_MS.map((ms) => (
            <TouchableOpacity
              key={ms}
              style={styles.secondaryBtn}
              onPress={() => handleNotifOverlap(ms)}
            >
              <Text style={styles.secondaryBtnText}>{ms}ms</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.statusNote}>{lastPatternLabel}</Text>
      </View>

      {/* Section B: 10-Pulse Blind Cue Quiz */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>B. 10-PULSE BLIND CUE QUIZ</Text>
          <Text style={styles.counter}>
            {quizPhase === 'idle'
              ? '0 / 10'
              : quizPhase === 'active'
              ? `${quizTrials.length + 1} / ${QUIZ_LENGTH}`
              : `${score} / ${QUIZ_LENGTH}`}
          </Text>
        </View>

        {quizPhase === 'idle' && (
          <>
            <Text style={styles.quizHint}>
              Plays 10 random pulses. Close your eyes or look away, feel each pulse, then tap what you felt to measure real thumb confusion.
            </Text>
            <TouchableOpacity style={styles.startQuizBtn} onPress={startQuiz}>
              <Text style={styles.startQuizText}>START 10-PULSE QUIZ</Text>
            </TouchableOpacity>
          </>
        )}

        {quizPhase === 'active' && (
          <>
            <View style={styles.quizTopRow}>
              <Text style={styles.quizStatus}>
                Pulse {quizTrials.length + 1} of {QUIZ_LENGTH} • Score {score}/{quizTrials.length}
              </Text>
              <View style={styles.quizMiniActions}>
                <TouchableOpacity style={styles.replayBtn} onPress={replayQuizCue}>
                  <Text style={styles.replayBtnText}>REPLAY</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.resetMiniBtn} onPress={resetQuiz}>
                  <Text style={styles.resetMiniText}>RESET</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.subLabel}>WHICH CUE DID YOU FEEL?</Text>
            <View style={styles.choiceGrid}>
              {HAPTIC_TYPES.map((choice) => (
                <TouchableOpacity
                  key={choice}
                  style={styles.choicePill}
                  onPress={() => handleGuess(choice)}
                >
                  <Text style={styles.choicePillText}>{choice}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {quizPhase === 'done' && (
          <>
            <View style={styles.resultBox}>
              <Text style={styles.resultScore}>
                SCORE: {score} / {QUIZ_LENGTH} ({Math.round((score / QUIZ_LENGTH) * 100)}%)
              </Text>
              <Text style={styles.resultLabel}>CONFUSION SUMMARY (COPY TO docs/game-log.md)</Text>
              <Text selectable style={styles.resultSummary}>
                {`Score: ${score}/${QUIZ_LENGTH} | Confusion: ${confusionSummary}`}
              </Text>
            </View>
            <TouchableOpacity style={styles.startQuizBtn} onPress={startQuiz}>
              <Text style={styles.startQuizText}>RUN ANOTHER 10-PULSE QUIZ</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 12,
  },
  blindFull: {
    flex: 1,
    backgroundColor: COLORS.blackout,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blindWhisper: {
    color: '#18181C',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  counter: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  subLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 6,
    marginBottom: 8,
  },
  pillWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
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
    fontSize: 12,
    fontWeight: '700',
  },
  pillTextActive: {
    color: COLORS.accent,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    marginBottom: 10,
  },
  primaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.accentSoft,
    borderWidth: 1,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  secondaryBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  statusNote: {
    color: COLORS.textDim,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  quizHint: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  startQuizBtn: {
    height: 46,
    borderRadius: 14,
    backgroundColor: COLORS.accentSoft,
    borderWidth: 1,
    borderColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startQuizText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  quizTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    gap: 8,
  },
  quizStatus: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '700',
  },
  quizMiniActions: {
    flexDirection: 'row',
    gap: 8,
  },
  replayBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSoft,
  },
  replayBtnText: {
    color: COLORS.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  resetMiniBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surfaceElevated,
  },
  resetMiniText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  choiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choicePill: {
    width: '31%',
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choicePillText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '700',
  },
  resultBox: {
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    marginBottom: 12,
  },
  resultScore: {
    color: COLORS.success,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  resultLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  resultSummary: {
    color: COLORS.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
});
