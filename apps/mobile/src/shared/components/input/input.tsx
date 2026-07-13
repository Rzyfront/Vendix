import React, { useState } from 'react';
import { Pressable, View, Text, TextInput, StyleSheet, Alert, type ViewStyle, type TextInputProps } from 'react-native';
import { colors, spacing, borderRadius, typography, colorScales } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  helperText?: string;
  rightIcon?: React.ReactNode;
  helpIcon?: React.ReactNode;
  /**
   * Texto del tooltip que se muestra al lado del label (mirror web).
   * Renderiza un ícono help-circle que al tap muestra el texto en un Alert.
   */
  tooltip?: string;
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
  /**
   * Prefijo visual dentro del input (a la izquierda). Mirror del
   * `prefix="$"` web para campos monetarios.
   */
  prefix?: React.ReactNode;
  /**
   * Sufijo visual dentro del input (a la derecha, antes del rightIcon).
   * Mirror del `suffix="%"` web para campos de porcentaje.
   */
  suffix?: React.ReactNode;
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
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    borderWidth: 1,
  },
  inputWrapperDefault: {
    borderColor: colorScales.gray[300],
  },
  inputWrapperFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.card,
    borderWidth: 1.5,
  },
  inputWrapperError: {
    borderColor: colors.error,
    borderWidth: 1.5,
    backgroundColor: colors.card,
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
  affix: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginHorizontal: spacing[1],
    fontWeight: '500' as any,
  },
  affixSuffix: {
    marginRight: spacing[2],
  },
  helpIconWrapper: {
    width: 16,
    height: 16,
    marginLeft: spacing[1],
    alignItems: 'center',
    justifyContent: 'center',
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
  tooltip,
  required = false,
  tone = 'default',
  prefix,
  suffix,
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

  /**
   * Renderiza el help-icon según prioridad:
   * 1. `helpIcon` prop (custom JSX) si fue pasado.
   * 2. Ícono help-circle automático si hay `tooltip` text.
   * 3. Nada.
   */
  const helpIconNode = helpIcon
    ?? (tooltip ? (
      <Pressable
        onPress={() => Alert.alert(label || 'Información', tooltip)}
        hitSlop={8}
        style={styles.helpIconWrapper}
      >
        <Icon name="help-circle" size={12} color={colors.text.muted} />
      </Pressable>
    ) : null);

  return (
    <View style={styles.container}>
      {(label || helpIconNode) && (
        <View style={styles.labelRow}>
          {label && (
            <Text style={styles.label}>
              {label}
              {required && <Text style={styles.requiredMark}> *</Text>}
            </Text>
          )}
          {helpIconNode}
        </View>
      )}
      <View style={[styles.inputWrapper, inputWrapperStyle, style]}>
        {prefix && <Text style={styles.affix}>{prefix}</Text>}
        <TextInput
          style={textInputStyle}
          placeholderTextColor={colors.text.muted}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...props}
        />
        {suffix && <Text style={[styles.affix, styles.affixSuffix]}>{suffix}</Text>}
        {rightIcon && <View style={styles.iconWrapper}>{rightIcon}</View>}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
      {helperText && !error && <Text style={styles.helperText}>{helperText}</Text>}
    </View>
  );
}
