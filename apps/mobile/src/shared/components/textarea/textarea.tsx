import { useState } from 'react';
import { TextInput, Text, View, StyleSheet, type ViewStyle, type TextInputProps } from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

interface TextareaProps extends Omit<TextInputProps, 'multiline' | 'style'> {
  label?: string;
  rows?: number;
  maxLength?: number;
  helperText?: string;
  error?: string;
  value: string;
  onChangeText: (value: string) => void;
  containerStyle?: ViewStyle;
}

export function Textarea({
  label,
  rows = 3,
  maxLength,
  helperText,
  error,
  value,
  onChangeText,
  containerStyle,
  ...rest
}: TextareaProps) {
  const [focused, setFocused] = useState(false);
  const minHeight = rows * 22 + spacing[3] * 2;

  return (
    <View style={containerStyle}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View
        style={[
          styles.wrapper,
          focused && styles.wrapperFocused,
          error && styles.wrapperError,
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          multiline
          maxLength={maxLength}
          placeholderTextColor={colors.text.muted}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[styles.input, { minHeight }]}
          {...rest}
        />
      </View>
      <View style={styles.footer}>
        {(helperText || error) && (
          <Text style={[styles.helperText, error && styles.errorText]} numberOfLines={1}>
            {error || helperText}
          </Text>
        )}
        {maxLength && (
          <Text style={styles.counter}>
            {value.length}/{maxLength}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: '500',
    color: colors.text.secondary,
    marginBottom: spacing[1],
  },
  wrapper: {
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.inputBg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  wrapperFocused: {
    borderColor: colors.primary,
  },
  wrapperError: {
    borderColor: colors.error,
  },
  input: {
    fontSize: typography.fontSize.base,
    color: colors.text.primary,
    textAlignVertical: 'top',
    padding: 0,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing[1],
  },
  helperText: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
  },
  errorText: {
    color: colors.error,
  },
  counter: {
    fontSize: typography.fontSize.xs,
    color: colors.text.muted,
  },
});

export type { TextareaProps };