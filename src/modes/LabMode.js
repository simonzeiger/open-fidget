import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { haptics } from '../haptics';
import { COLORS } from '../theme';
import prototypesExport from '../engine/prototypes';
import HapticBench from './HapticBench';
import PrototypePlayer from './PrototypePlayer';

const BENCH_ID = '__bench__';
const PROTOTYPES = Array.isArray(prototypesExport)
  ? prototypesExport
  : Array.isArray(prototypesExport?.PROTOTYPES)
  ? prototypesExport.PROTOTYPES
  : [];

export default function LabMode({ blindMode }) {
  const prototypes = PROTOTYPES;
  const [selectedId, setSelectedId] = useState(BENCH_ID);

  const activeProto = prototypes.find((p) => p.id === selectedId) || null;

  return (
    <View style={[styles.root, blindMode && styles.rootBlind]}>
      {!blindMode && (
        <View style={styles.switcherWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.switcherRow}
          >
            <TouchableOpacity
              style={[styles.pill, !activeProto && styles.pillActive]}
              onPress={() => {
                haptics.tick();
                setSelectedId(BENCH_ID);
              }}
            >
              <Text style={[styles.pillText, !activeProto && styles.pillTextActive]}>
                BENCH
              </Text>
            </TouchableOpacity>

            {prototypes.map((proto) => {
              const active = activeProto && activeProto.id === proto.id;
              return (
                <TouchableOpacity
                  key={proto.id}
                  style={[styles.pill, active && styles.pillActive]}
                  onPress={() => {
                    haptics.tick();
                    setSelectedId(proto.id);
                  }}
                >
                  <Text style={[styles.pillText, active && styles.pillTextActive]}>
                    {proto.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <View style={styles.body}>
        {activeProto ? (
          <PrototypePlayer
            key={activeProto.id}
            modeDef={activeProto}
            blindMode={blindMode}
          />
        ) : (
          <HapticBench blindMode={blindMode} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  rootBlind: {
    backgroundColor: COLORS.blackout,
  },
  switcherWrap: {
    marginBottom: 10,
  },
  switcherRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
  },
  pillActive: {
    backgroundColor: COLORS.accentSoft,
    borderColor: COLORS.accent,
  },
  pillText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  pillTextActive: {
    color: COLORS.accent,
  },
  body: {
    flex: 1,
  },
});
