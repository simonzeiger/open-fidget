import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { haptics } from './src/haptics';
import { COLORS } from './src/theme';
import SafeCracker from './src/modes/SafeCracker';
import RhythmEcho from './src/modes/RhythmEcho';
import VirtualMarble from './src/modes/VirtualMarble';
import HotColdHunt from './src/modes/HotColdHunt';
import FidgetSandbox from './src/modes/FidgetSandbox';

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
    <SafeAreaProvider>
      <SafeAreaView style={[styles.root, blindMode && styles.rootBlind]}>
        <StatusBar barStyle="light-content" backgroundColor={blindMode ? '#000000' : COLORS.bg} />

      {blindMode ? (
        <View style={styles.blindTopBar}>
          <TouchableOpacity
            style={styles.blindExitBtn}
            onPress={() => {
              haptics.medium();
              setBlindMode(false);
            }}
          >
            <Text style={styles.blindExitText}>EXIT EYES-FREE ({activeMode.label.toUpperCase()})</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.header}>
            <View>
              <Text style={styles.brand}>OPEN FIDGET</Text>
              <Text style={styles.subtitle}>Haptic Validation Lab v0</Text>
            </View>
            <TouchableOpacity
              style={styles.blindBtn}
              onPress={() => {
                haptics.medium();
                setBlindMode(true);
              }}
            >
              <Text style={styles.blindBtnText}>◐ EYES-FREE</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.tabWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabRow}
            >
              {MODES.map((m) => {
                const active = m.id === activeId;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.tab, active && styles.tabActive]}
                    onPress={() => {
                      haptics.tick();
                      setActiveId(m.id);
                    }}
                  >
                    <Text style={[styles.tabIcon, active && styles.tabTextActive]}>
                      {m.icon}
                    </Text>
                    <Text style={[styles.tabLabel, active && styles.tabTextActive]}>
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </>
      )}

        <View style={styles.stage}>
          <ActiveComponent key={activeId} blindMode={blindMode} />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  rootBlind: {
    backgroundColor: COLORS.blackout,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 10,
  },
  brand: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 2,
  },
  subtitle: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  blindBtn: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  blindBtnText: {
    color: COLORS.text,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  blindTopBar: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: COLORS.blackout,
  },
  blindExitBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1E1E24',
  },
  blindExitText: {
    color: '#3F3F4A',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  tabWrap: {
    marginBottom: 12,
  },
  tabRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabActive: {
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.accent,
  },
  tabIcon: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  tabLabel: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  tabTextActive: {
    color: COLORS.accent,
  },
  stage: {
    flex: 1,
  },
});
