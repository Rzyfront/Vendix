import { useState, useEffect } from 'react';
import { TextInput, View, Text, StyleSheet, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

export interface MoneyInputProps extends Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType'> {
  label?: string;
  value: string;
  /** Recibe el string crudo (sin separadores) cuando el usuario edita. */
  onChangeText: (rawValue: string) => void;
  /** Prefijo visual dentro del input (a la izquierda). */
  prefix?: string;
  required?: boolean;
  placeholder?: string;
  error?: string;
  helperText?: string;
  /**
   * Texto del tooltip mostrado al lado del label (mirror web).
   * Renderiza un ícono help-circle que al tap muestra el texto en un Alert.
   */
  tooltip?: string;
  style?: ViewStyle;
  /** Si true, muestra el separador de miles con punto (default true). */
  thousands?: boolean;
}

/**
 * Formatea un número con separador de miles con punto (formato español).
 * Ej: 10000 → "10.000", 1234567.89 → "1.234.567,89"
 */
export function formatThousands(value: string | number, withDecimals = true): string {
  const str = String(value);
  // Separar parte entera y decimal
  const [intPart, decPart] = str.split('.');
  // Formatear la parte entera con puntos
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return withDecimals && decPart ? `${formattedInt},${decPart}` : formattedInt;
}

/**
 * Quita los separadores de miles para obtener el string crudo.
 */
export function stripThousands(value: string): string {
  return value.replace(/\./g, '').replace(/,/g, '.');
}

/**
 * Input de dinero con separador de miles en formato español (10.000).
 * Mantiene el valor como string sin separadores para que el resto del form
 * (que usa `toNumber(string)`) siga funcionando sin cambios.
 */
export function MoneyInput({
  label,
  value,
  onChangeText,
  prefix = '$',
  required = false,
  placeholder = '0',
  error,
  helperText,
  tooltip,
  style,
  thousands = true,
  ...rest
}: MoneyInputProps) {
  const [isFocused, setIsFocused] = useState(false);

  // El valor formateado es lo que se muestra. Cuando NO está focused,
  // aplicamos los separadores; cuando está focused, mostramos el valor crudo
  // para que el usuario pueda editar más fácil (sin tener que borrar puntos).
  const displayValue = isFocused
    ? value
    : value
      ? formatThousands(value, value.includes('.'))
      : '';

  const inputWrapperStyle = (() => {
    if (error) return styles.inputWrapperError;
    return isFocused ? styles.inputWrapperFocused : styles.inputWrapperDefault;
  })();

  return (
    <View style={styles.container}>
      {(label || tooltip) && (
        <View style={styles.labelRow}>
          {label && (
            <Text style={styles.label}>
              {label}
              {required && <Text style={styles.requiredMark}> *</Text>}
              {tooltip && (
                <Text
                  onPress={() => alertWithTooltip(label, tooltip)}
                  style={styles.helpIconInline}
                >
                  {' '}ⓘ
                </Text>
              )}
            </Text>
          )}
        </View>
      )}
      <View style={[styles.inputWrapper, inputWrapperStyle, style]}>
        {prefix && <Text style={styles.affix}>{prefix}</Text>}
        <TextInput
          {...rest}
          style={styles.textInput}
          value={displayValue}
          onChangeText={(text) => {
            // Quitar separadores y validar que sólo tenga dígitos + punto/coma
            const cleaned = stripThousands(text).replace(/[^0-9.,]/g, '');
            // Reemplazar comas por puntos (decimal) y limitar a un decimal
            const normalized = cleaned.replace(/,/g, '.');
            onChangeText(normalized);
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.text.muted}
          keyboardType="decimal-pad"
        />
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
      {helperText && !error && <Text style={styles.helperText}>{helperText}</Text>}
    </View>
  );
}

// Helper para mostrar el tooltip (importamos Alert dinámicamente para evitar warnings).
function alertWithTooltip(label: string, tooltip: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Alert } = require('react-native');
    Alert.alert(label, tooltip);
  } catch {
    // noop
  }
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
  textInput: {
    flex: 1,
    height: 40,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  affix: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginHorizontal: spacing[1],
    fontWeight: '500' as any,
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
  helpIconInline: {
    color: colorScales.gray[400],
    fontSize: 12,
    fontWeight: typography.fontWeight.normal as any,
  },
});
