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
    backgroundColor: '#14F195',
    borderColor: '#00D7C8',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginRight: 8,
  },
  btnPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
    borderColor: '#00B8AB',
    backgroundColor: '#0AD7B8',
  },
  txt: {
    color: '#072225',
    fontWeight: '700',
  }
});
