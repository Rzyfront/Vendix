import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';

interface ChipInputProps {
  /** Lista actual de valores (controlada). */
  values: string[];
  /** Se dispara al confirmar un nuevo valor (Enter, blur con texto, tap de un "+"). */
  onAdd: (value: string) => void;
  /** Se dispara al pulsar la × de un chip existente. */
  onRemove: (index: number) => void;
  /** Placeholder del TextInput. */
  placeholder?: string;
  /** Disabled state para todo el componente. */
  disabled?: boolean;
  /** Tooltip shown next to the field label. */
  tooltip?: string;
  /** Optional label rendered above the input row. */
  label?: string;
}

/**
 * ChipInput — input estilo "tags" usado en la sección Variantes.
 *
 * Espejo del patrón web `class="flex flex-wrap gap-2 px-3 py-1.5 bg-surface
 * rounded-sm border border-border min-h-[34px] focus-within:ring-2
 * focus-within:ring-primary/50 focus-within:border-primary transition-colors"`.
 *
 * UX:
 * - Cada valor se renderiza como un chip con × al lado.
 * - El TextInput al final acepta texto y al pulsar Enter llama `onAdd(value)`.
 * - Si el valor a agregar ya existe en la lista, `onAdd` no debería hacer nada
 *   (controlado por el padre).
 */
export function ChipInput({
  values,
  onAdd,
  onRemove,
  placeholder,
  disabled = false,
  tooltip,
  label,
}: ChipInputProps) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setDraft('');
  };

  return (
    <View>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {tooltip ? (
            <View style={styles.tooltipIcon}>
              <Icon name="help-circle" size={12} color={colorScales.gray[400]} />
            </View>
          ) : null}
        </View>
      ) : null}

      <View
        style={[
          styles.container,
          !disabled && styles.containerFocusable,
          disabled && styles.containerDisabled,
        ]}
      >
        {values.map((value, index) => (
          <View key={`${value}-${index}`} style={styles.chip}>
            <Text style={styles.chipText} numberOfLines={1}>
              {value}
            </Text>
            <Pressable
              onPress={() => onRemove(index)}
              hitSlop={6}
              style={styles.chipRemove}
              accessibilityLabel={`Eliminar ${value}`}
              disabled={disabled}
            >
              <Icon name="x" size={12} color={colorScales.gray[500]} />
            </Pressable>
          </View>
        ))}
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={commit}
          onBlur={commit}
          placeholder={placeholder}
          placeholderTextColor={colorScales.gray[400]}
          editable={!disabled}
          returnKeyType="done"
          blurOnSubmit={false}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginBottom: spacing[2],
  },
  label: {
    fontSize: 13,
    fontWeight: typography.fontWeight.semibold as any,
    color: colors.text.primary,
  },
  tooltipIcon: {
    marginLeft: 2,
  },
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colors.card,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    minHeight: 34,
  },
  containerFocusable: {},
  containerDisabled: {
    opacity: 0.6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: 9999,
    backgroundColor: colorScales.gray[100],
    maxWidth: '100%',
  },
  chipText: {
    fontSize: 13,
    color: colors.text.primary,
    fontWeight: typography.fontWeight.medium as any,
  },
  chipRemove: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  input: {
    flex: 1,
    minWidth: 100,
    fontSize: 13,
    color: colors.text.primary,
    padding: 0,
    margin: 0,
    backgroundColor: 'transparent',
  },
});
