import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

export function ActionButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.btn,
        disabled && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.txt, disabled && styles.txtDisabled]}>{label}</Text>
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
  btnDisabled: {
    backgroundColor: '#9EEBDD',
    borderColor: '#8EDACE',
    opacity: 0.7,
  },
  txt: {
    color: '#072225',
    fontWeight: '700',
  },
  txtDisabled: {
    color: '#3A5B56',
  },
});
