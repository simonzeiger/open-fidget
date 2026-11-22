import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  PanResponder,
  TouchableOpacity,
} from 'react-native';
import { haptics } from '../haptics';
import { COLORS } from '../theme';

const SWITCH_FEELS = [
  { id: 'clicky', label: 'CLICKY', down: 'rigid', up: 'light' },
  { id: 'thock', label: 'THOCK', down: 'heavy', up: 'soft' },
  { id: 'subtle', label: 'SUBTLE', down: 'tick', up: 'tick' },
];

const SLIDER_STOPS = 12;
const BUBBLE_COUNT = 12;

export default function FidgetSandbox({ blindMode }) {
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

    // 4-7-8 breathing cycle (19s total), tick every 500ms
    let halfSec = 0;
    const tickBreath = () => {
      const sec = (halfSec * 0.5) % 19;
      if (sec < 4) {
        setBreathPhase(`INHALE (${Math.ceil(4 - sec)}s)`);
        haptics.soft();
      } else if (sec < 11) {
        setBreathPhase(`HOLD (${Math.ceil(11 - sec)}s)`);
        if (sec === 4) haptics.medium();
      } else {
        setBreathPhase(`EXHALE (${Math.ceil(19 - sec)}s)`);
        if (halfSec % 2 === 0) haptics.light();
      }
      halfSec += 1;
    };

    tickBreath();
    breathTimerRef.current = setInterval(tickBreath, 500);
    return () => {
      if (breathTimerRef.current) clearInterval(breathTimerRef.current);
    };
  }, [breathing]);

  const updateSliderFromX = (x) => {
    const w = Math.max(1, sliderWidthRef.current);
    const ratio = Math.max(0, Math.min(1, x / w));
    const step = Math.round(ratio * (SLIDER_STOPS - 1));
    if (step !== sliderStepRef.current) {
      sliderStepRef.current = step;
      setSliderStep(step);
      if (step === 0 || step === SLIDER_STOPS - 1) {
        haptics.heavy();
      } else {
        haptics.medium();
      }
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
      setTimeout(() => {
        haptics.success();
        setPopped(Array(BUBBLE_COUNT).fill(false));
      }, 260);
    }
  };

  if (blindMode) {
    // Full-screen eyes-free tactile clicker + optional breathing pulse
    return (
      <Pressable
        style={styles.blindFull}
        onPressIn={() => {
          setSwitchDown(true);
          haptics[feelObj.down]();
          setClicks((c) => c + 1);
        }}
        onPressOut={() => {
          setSwitchDown(false);
          haptics[feelObj.up]();
        }}
      >
        <Text style={styles.blindWhisper}>
          {breathing ? `BREATHING • ${breathPhase}` : `SWITCH SANDBOX • ${feelObj.label}`}
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
      {/* 1. Mechanical Key Switch */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>1. VIRTUAL SWITCH</Text>
          <Text style={styles.counter}>{clicks} CLICKS</Text>
        </View>
        <View style={styles.feelRow}>
          {SWITCH_FEELS.map((f) => (
            <TouchableOpacity
              key={f.id}
              style={[styles.miniPill, switchFeel === f.id && styles.miniPillActive]}
              onPress={() => {
                haptics.tick();
                setSwitchFeel(f.id);
              }}
            >
              <Text style={[styles.miniPillText, switchFeel === f.id && styles.miniPillTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Pressable
          onPressIn={() => {
            setSwitchDown(true);
            haptics[feelObj.down]();
            setClicks((c) => c + 1);
          }}
          onPressOut={() => {
            setSwitchDown(false);
            haptics[feelObj.up]();
          }}
          style={[styles.keycap, switchDown && styles.keycapPressed]}
        >
          <Text style={styles.keycapText}>
            {switchDown ? 'PRESSED' : 'PRESS & RELEASE'}
          </Text>
        </Pressable>
      </View>

      {/* 2. Magnetic Detent Slider */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>2. MAGNETIC SLIDER</Text>
          <Text style={styles.counter}>
            STOP {sliderStep + 1}/{SLIDER_STOPS}
          </Text>
        </View>
        <View style={styles.sliderTrack}>
          <View
            style={styles.sliderInner}
            onLayout={(e) => {
              sliderWidthRef.current = e.nativeEvent.layout.width;
            }}
            {...sliderResponder.panHandlers}
          >
            <View style={styles.sliderDotsRow} pointerEvents="none">
              {Array.from({ length: SLIDER_STOPS }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.sliderTick,
                    i === sliderStep && styles.sliderTickActive,
                  ]}
                />
              ))}
            </View>
            <View
              pointerEvents="none"
              style={[
                styles.sliderThumb,
                { left: `${(sliderStep / (SLIDER_STOPS - 1)) * 100}%` },
              ]}
            />
          </View>
        </View>
      </View>

      {/* 3. Tactile Bubble Wrap */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>3. BUBBLE POP</Text>
          <Text style={styles.counter}>
            {popped.filter(Boolean).length}/{BUBBLE_COUNT}
          </Text>
        </View>
        <View style={styles.bubbleGrid}>
          {popped.map((isPopped, idx) => (
            <Pressable
              key={idx}
              onPressIn={() => handlePop(idx)}
              style={[styles.bubble, isPopped && styles.bubblePopped]}
            >
              <View style={[styles.bubbleInner, isPopped && styles.bubbleInnerPopped]} />
            </Pressable>
          ))}
        </View>
      </View>

      {/* 4. 4-7-8 Breathing Pacer */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>4. PALM BREATHING (4-7-8)</Text>
          <Text style={[styles.counter, breathing && { color: COLORS.success }]}>
            {breathPhase}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.breathBtn, breathing && styles.breathBtnActive]}
          onPress={() => {
            haptics.medium();
            setBreathing((b) => !b);
          }}
        >
          <Text style={[styles.breathBtnText, breathing && { color: COLORS.success }]}>
            {breathing ? 'STOP SILENT PACER' : 'START SILENT PALM PACER'}
          </Text>
        </TouchableOpacity>
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
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  feelRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  miniPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    backgroundColor: COLORS.surfaceElevated,
  },
  miniPillActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSoft,
  },
  miniPillText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  miniPillTextActive: {
    color: COLORS.accent,
  },
  keycap: {
    height: 76,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
    borderBottomWidth: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keycapPressed: {
    borderBottomWidth: 1.5,
    borderColor: COLORS.accent,
    backgroundColor: '#211B11',
    transform: [{ translateY: 2 }],
  },
  keycapText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  sliderTrack: {
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  sliderInner: {
    flex: 1,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderDotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderTick: {
    width: 4,
    height: 12,
    borderRadius: 2,
    backgroundColor: COLORS.borderStrong,
  },
  sliderTickActive: {
    height: 22,
    backgroundColor: COLORS.accent,
  },
  sliderThumb: {
    position: 'absolute',
    width: 24,
    height: 40,
    marginLeft: -12,
    borderRadius: 10,
    backgroundColor: COLORS.accentSoft,
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  bubbleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  bubble: {
    width: '22.5%',
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1.5,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubblePopped: {
    backgroundColor: '#0E0E12',
    borderColor: '#1E1E26',
  },
  bubbleInner: {
    width: '56%',
    height: '56%',
    borderRadius: 999,
    backgroundColor: COLORS.accentSoft,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  bubbleInnerPopped: {
    width: '28%',
    height: '28%',
    backgroundColor: 'transparent',
    borderColor: '#282832',
  },
  breathBtn: {
    height: 48,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breathBtnActive: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.successSoft,
  },
  breathBtnText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
});
