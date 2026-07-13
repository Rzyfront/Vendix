import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, type ViewStyle, type TextInputProps } from 'react-native';
import { colors, spacing, borderRadius, typography, colorScales } from '@/shared/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  helperText?: string;
  rightIcon?: React.ReactNode;
  helpIcon?: React.ReactNode;
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontSize: 12,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: '#374151',
    marginBottom: spacing[1.5],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  inputWrapperDefault: {
    borderColor: '#D1D5DB',
  },
  inputWrapperFocused: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  inputWrapperError: {
    borderColor: colors.error,
    borderWidth: 1.5,
  },
  textInput: {
    flex: 1,
    height: 44,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  iconWrapper: {
    marginLeft: spacing[2],
  },
  errorText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colors.error,
    marginTop: spacing[1],
  },
  helperText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colors.text.muted,
    marginTop: spacing[1],
  },
});

export function Input({
  label,
  error,
  helperText,
  rightIcon,
  helpIcon,
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
      {(label || helpIcon) && (
        <View style={styles.labelRow}>
          {label && <Text style={styles.label}>{label}</Text>}
          {helpIcon}
        </View>
      )}
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
