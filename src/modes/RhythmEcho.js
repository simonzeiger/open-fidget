import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
} from 'react-native';
import { COLORS } from '../theme';
import { useModeEngine } from './useModeEngine';
import RhythmEchoMode from '../engine/rhythmEcho';

export default function RhythmEcho({ blindMode }) {
  const { state, sendInput } = useModeEngine(RhythmEchoMode);
  const {
    phase,
    sequence,
    inputIndex,
    activeBeat,
    streak,
    bestStreak,
    isHolding,
    holdCrossed,
  } = state;

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
              onPress={() => sendInput({ type: 'action', name: 'replay' })}
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
        onPressIn={() => sendInput({ type: 'pointer_down' })}
        onPressOut={() => sendInput({ type: 'pointer_up' })}
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
