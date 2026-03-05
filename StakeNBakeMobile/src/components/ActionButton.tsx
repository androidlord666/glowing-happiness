import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/colors';

export function ActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.btn,
        pressed && styles.btnPressed,
      ]}
      onPress={onPress}
    >
      <Text style={styles.txt}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginRight: 8,
  },
  btnPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.86,
    borderColor: colors.primary,
    backgroundColor: '#0E2628',
  },
  txt: {
    color: colors.text,
    fontWeight: '600',
  }
});
