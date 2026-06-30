import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, type ViewStyle, type TextInputProps } from 'react-native';
import { colors, spacing, borderRadius, typography, colorScales } from '@/shared/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  helperText?: string;
  rightIcon?: React.ReactNode;
  helpIcon?: React.ReactNode;
  /**
   * Marca el campo como requerido. Muestra un asterisco rojo a la derecha
   * del label (mirror del `text-[var(--color-destructive)] ml-1` web).
   */
  required?: boolean;
  /**
   * Visual tone applied to the wrapper. The default keeps the soft gray look
   * used across the form. `rose` is used for the offer-price field in the
   * product pricing breakdown card (matches the web's rose-themed input).
   */
  tone?: 'default' | 'rose';
  style?: ViewStyle;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
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
    backgroundColor: colorScales.gray[50],
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    borderWidth: 0,
  },
  inputWrapperDefault: {
    borderColor: 'transparent',
  },
  inputWrapperFocused: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  inputWrapperError: {
    borderColor: colors.error,
    borderWidth: 1.5,
  },
  inputWrapperRose: {
    backgroundColor: '#FFFFFF',
    borderColor: colorScales.red[300],
    borderWidth: 1.5,
  },
  inputWrapperRoseFocused: {
    borderColor: colorScales.red[500],
  },
  inputWrapperRoseError: {
    borderColor: colors.error,
  },
  textInput: {
    flex: 1,
    height: 40,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  textInputRose: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.red[600],
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
  requiredMark: {
    color: colors.error,
    fontSize: 10,
    fontWeight: '700' as any,
  },
});

export function Input({
  label,
  error,
  helperText,
  rightIcon,
  helpIcon,
  required = false,
  tone = 'default',
  style,
  ...props
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);

  const inputWrapperStyle = (() => {
    if (tone === 'rose') {
      if (error) return styles.inputWrapperRoseError;
      return isFocused ? styles.inputWrapperRoseFocused : styles.inputWrapperRose;
    }
    if (error) return styles.inputWrapperError;
    return isFocused ? styles.inputWrapperFocused : styles.inputWrapperDefault;
  })();

  const textInputStyle = tone === 'rose' ? [styles.textInput, styles.textInputRose] : styles.textInput;

  return (
    <View style={styles.container}>
      {(label || helpIcon) && (
        <View style={styles.labelRow}>
          {label && (
            <Text style={styles.label}>
              {label}
              {required && <Text style={styles.requiredMark}> *</Text>}
            </Text>
          )}
          {helpIcon}
        </View>
      )}
      <View style={[styles.inputWrapper, inputWrapperStyle, style]}>
        <TextInput
          style={textInputStyle}
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
