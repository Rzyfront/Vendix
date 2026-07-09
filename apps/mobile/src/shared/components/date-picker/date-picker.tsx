import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { colors, spacing, typography, colorScales } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

/**
 * DatePicker — wrapper de `@react-native-community/datetimepicker` que
 * alinea visualmente con el `Input` shared (label UPPERCASE + asterisco
 * rojo si `required`, error inline, helper text). En iOS renderiza el
 * picker inline (spinner compacto); en Android abre el modal nativo.
 *
 * El `value` es string ISO `YYYY-MM-DD` (alineado con el formato
 * backend de `promotions.start_date`/`end_date`). `null` = sin fecha.
 *
 * Usos esperados (módulos admin):
 * - Promociones: `start_date`, `end_date`
 * - Impuestos: vigencia
 * - Cupones: vigencia, redemption window
 *
 * ⚠️ Replica 1:1 del Web Visual Pattern: label UPPERCASE + asterisco
 *    rojo en `required`, mensaje de error inline (NO toast).
 */

export interface DatePickerProps {
  label?: string;
  /** ISO `YYYY-MM-DD` o `null` (sin fecha). */
  value: string | null;
  /** Callback al cambiar. `null` cuando el usuario limpia. */
  onChange: (next: string | null) => void;
  required?: boolean;
  error?: string;
  helperText?: string;
  placeholder?: string;
  disabled?: boolean;
  minDate?: Date;
  maxDate?: Date;
  /** Si true, muestra también selector de hora. Default false (solo fecha). */
  showTime?: boolean;
  style?: ViewStyle;
}

function toIsoDate(d: Date | undefined | null): string | null {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? undefined : d;
}

function formatDisplay(value: string | null): string {
  if (!value) return '';
  const d = parseIsoDate(value);
  if (!d) return value;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

const styles = StyleSheet.create({
  container: { width: '100%' },
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
  requiredMark: {
    color: colors.error,
    fontSize: 10,
    fontWeight: '700' as any,
  },
  triggerWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    minHeight: 40,
    gap: spacing[2],
  },
  triggerWrapperError: {
    borderColor: colors.error,
    borderWidth: 1.5,
  },
  triggerWrapperDisabled: {
    opacity: 0.5,
  },
  triggerText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  triggerPlaceholder: {
    color: colorScales.gray[500],
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

export function DatePicker({
  label,
  value,
  onChange,
  required = false,
  error,
  helperText,
  placeholder = 'Seleccionar fecha',
  disabled = false,
  minDate,
  maxDate,
  showTime = false,
  style,
}: DatePickerProps) {
  const [showPicker, setShowPicker] = useState(false);

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    // Android: el picker se cierra solo. iOS: permanece abierto
    // hasta que el usuario hace tap fuera (manejado por `showPicker`).
    if (Platform.OS !== 'ios') {
      setShowPicker(false);
    }
    if (event.type === 'dismissed' || !selected) return;
    onChange(toIsoDate(selected));
  };

  const triggerStyle = [
    styles.triggerWrapper,
    error ? styles.triggerWrapperError : null,
    disabled ? styles.triggerWrapperDisabled : null,
  ];

  const dateValue = parseIsoDate(value) ?? new Date();

  return (
    <View style={[styles.container, style]}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {required ? <Text style={styles.requiredMark}> *</Text> : null}
        </View>
      ) : null}

      <Pressable
        onPress={() => !disabled && setShowPicker(true)}
        disabled={disabled}
        style={triggerStyle}
      >
        <Icon name="calendar" size={16} color={colorScales.gray[500]} />
        <Text
          style={[
            styles.triggerText,
            !value ? styles.triggerPlaceholder : null,
          ]}
        >
          {value ? formatDisplay(value) : placeholder}
        </Text>
      </Pressable>

      {showPicker ? (
        <DateTimePicker
          value={dateValue}
          mode={showTime ? 'datetime' : 'date'}
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={handleChange}
          minimumDate={minDate}
          maximumDate={maxDate}
          {...(Platform.OS === 'ios' && showPicker
            ? { onTouchOutside: () => setShowPicker(false) }
            : {})}
        />
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!error && helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
    </View>
  );
}
