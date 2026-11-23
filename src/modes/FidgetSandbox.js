import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  PanResponder,
  TouchableOpacity,
} from 'react-native';
import { COLORS } from '../theme';
import { useModeEngine } from './useModeEngine';
import FidgetSandboxMode from '../engine/fidgetSandbox';

const SWITCH_FEELS = [
  { id: 'clicky', label: 'CLICKY' },
  { id: 'thock', label: 'THOCK' },
  { id: 'subtle', label: 'SUBTLE' },
];

export default function FidgetSandbox({ blindMode }) {
  const { state, sendInput } = useModeEngine(FidgetSandboxMode);
  const {
    switchFeel,
    clicks,
    switchDown,
    sliderStep,
    sliderStops,
    popped,
    breathing,
    breathPhase,
  } = state;

  const sliderWidthRef = useRef(260);

  const updateSliderFromX = (x) => {
    const w = Math.max(1, sliderWidthRef.current);
    const ratio = Math.max(0, Math.min(1, x / w));
    sendInput({ type: 'action', name: 'slider_ratio', value: ratio });
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

  if (blindMode) {
    // Full-screen eyes-free tactile clicker + optional breathing pulse
    return (
      <Pressable
        style={styles.blindFull}
        onPressIn={() => sendInput({ type: 'action', name: 'switch_down' })}
        onPressOut={() => sendInput({ type: 'action', name: 'switch_up' })}
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
              onPress={() =>
                sendInput({ type: 'action', name: 'set_switch_feel', value: f.id })
              }
            >
              <Text style={[styles.miniPillText, switchFeel === f.id && styles.miniPillTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Pressable
          onPressIn={() => sendInput({ type: 'action', name: 'switch_down' })}
          onPressOut={() => sendInput({ type: 'action', name: 'switch_up' })}
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
            STOP {sliderStep + 1}/{sliderStops}
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
              {Array.from({ length: sliderStops }).map((_, i) => (
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
                { left: `${(sliderStep / (sliderStops - 1)) * 100}%` },
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
            {popped.filter(Boolean).length}/{popped.length}
          </Text>
        </View>
        <View style={styles.bubbleGrid}>
          {popped.map((isPopped, idx) => (
            <Pressable
              key={idx}
              onPressIn={() =>
                sendInput({ type: 'action', name: 'pop_bubble', value: idx })
              }
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
          onPress={() => sendInput({ type: 'action', name: 'toggle_breathing' })}
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
