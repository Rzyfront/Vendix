import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, type ViewStyle, type TextInputProps } from 'react-native';
import { colors, spacing, borderRadius, typography, colorScales } from '@/shared/theme';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
  helperText?: string;
  rightIcon?: React.ReactNode;
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.secondary,
    marginBottom: spacing[1.5],
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[4],
    borderWidth: 1,
  },
  inputWrapperDefault: {
    borderColor: colors.inputBorder,
  },
  inputWrapperFocused: {
    borderColor: colors.primary,
  },
  inputWrapperError: {
    borderColor: colors.error,
  },
  textInput: {
    flex: 1,
    height: 48,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
  },
  iconWrapper: {
    marginLeft: spacing[2],
  },
  errorText: {
    fontSize: typography.fontSize.xs,
    color: colors.error,
    marginTop: spacing[1],
  },
  helperText: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing[1],
  },
});

export function Input({
  label,
  error,
  helperText,
  rightIcon,
  style,
  ...props
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const inputWrapperStyle = error
    ? styles.inputWrapperError
    : isFocused
      ? styles.inputWrapperFocused
      : styles.inputWrapperDefault;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrapper, inputWrapperStyle, style]}>
        <TextInput
          style={styles.textInput}
          placeholderTextColor={colors.text.muted}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...props}
        />
        {rightIcon && <View style={styles.iconWrapper}>{rightIcon}</View>}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
      {helperText && !error && <Text style={styles.helperText}>{helperText}</Text>}
    </View>
  );
}
