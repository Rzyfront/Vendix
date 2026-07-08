import { useState, useEffect } from 'react';
import { View, StyleSheet, Pressable, Text } from 'react-native';
import { Input, Selector, Button } from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { PROMOTION_LABELS, PROMOTION_TYPE_LABEL } from '@/features/store/constants/promotion-labels';
import type { PromotionType, QuantityTier } from '@/features/store/types/promotions.types';

const TIER_TYPE_OPTIONS: { label: string; value: PromotionType }[] = [
  { label: PROMOTION_TYPE_LABEL.percentage, value: 'percentage' },
  { label: PROMOTION_TYPE_LABEL.fixed_amount, value: 'fixed_amount' },
];

export interface PromotionTierRowProps {
  /** Índice de la fila (para mensajes de error cross-row como "Escala 3: ..."). */
  index: number;
  /** Total de filas en el FormArray (para detectar la "última"). */
  totalRows: number;
  value: QuantityTier;
  onChange: (next: QuantityTier) => void;
  onRemove: () => void;
  /** Errores cross-row calculados por el padre (e.g. "el rango debe ser continuo..."). */
  rowError?: string;
  disabled?: boolean;
}

/**
 * Fila del FormArray `quantity_tiers` con validación cross-row de
 * adyacencia y "última escala abierta" (mismas reglas que
 * `validateTiersOrder()` del web `promotion-form-modal.component.ts:677-734`).
 *
 * Validación local:
 * - `min_quantity` requerido, >= 1
 * - `value` requerido, > 0
 * - `value` <= 100 si type === 'percentage'
 *
 * Validación cross-row (en `index.tsx` padre):
 * - Sólo la última fila puede dejar `max_quantity` vacío
 * - `tier[i].max + 1 === tier[i+1].min` (adyacencia contigua)
 */
export function PromotionTierRow({
  index,
  totalRows,
  value,
  onChange,
  onRemove,
  rowError,
  disabled = false,
}: PromotionTierRowProps) {
  const [minError, setMinError] = useState<string | undefined>();
  const [maxError, setMaxError] = useState<string | undefined>();
  const [valueError, setValueError] = useState<string | undefined>();

  // Validador min: requerido, >= 1
  useEffect(() => {
    if (value.min_quantity == null || value.min_quantity === 0) {
      setMinError('Requerido');
    } else if (value.min_quantity < 1) {
      setMinError('Debe ser >= 1');
    } else {
      setMinError(undefined);
    }
  }, [value.min_quantity]);

  // Validador value: requerido, > 0
  useEffect(() => {
    if (value.value == null || value.value === 0) {
      setValueError('Requerido');
    } else if (value.value <= 0) {
      setValueError(PROMOTION_LABELS.errMinValue);
    } else if (value.type === 'percentage' && value.value > 100) {
      setValueError(PROMOTION_LABELS.errMaxPercent);
    } else {
      setValueError(undefined);
    }
  }, [value.value, value.type]);

  // max_quantity: optional, >= min_quantity
  useEffect(() => {
    if (value.max_quantity == null) {
      setMaxError(undefined);
    } else if (value.max_quantity < 1) {
      setMaxError('Debe ser >= 1');
    } else if (value.min_quantity && value.max_quantity < value.min_quantity) {
      setMaxError('Debe ser >= minimo');
    } else {
      setMaxError(undefined);
    }
  }, [value.max_quantity, value.min_quantity]);

  const isLast = index === totalRows - 1;

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>Escala {index + 1}</Text>
        <Pressable
          onPress={onRemove}
          disabled={disabled}
          hitSlop={8}
          style={({ pressed }) => [
            styles.removeButton,
            pressed && { backgroundColor: colorScales.red[50] },
          ]}
          accessibilityLabel={`Eliminar escala ${index + 1}`}
        >
          <Icon name="trash-2" size={14} color={colors.error} />
        </Pressable>
      </View>

      <View style={styles.fieldRow}>
        <View style={styles.flex1}>
          <Input
            label={PROMOTION_LABELS.fieldTierMin}
            value={value.min_quantity != null ? String(value.min_quantity) : ''}
            onChangeText={(t) =>
              onChange({ ...value, min_quantity: t ? Number(t) : 0 })
            }
            keyboardType="number-pad"
            error={minError}
            editable={!disabled}
            required
          />
        </View>
        <View style={styles.flex1}>
          <Input
            label={PROMOTION_LABELS.fieldTierMax}
            value={value.max_quantity != null ? String(value.max_quantity) : ''}
            onChangeText={(t) =>
              onChange({
                ...value,
                max_quantity: t ? Number(t) : null,
              })
            }
            keyboardType="number-pad"
            error={maxError}
            editable={!disabled}
            placeholder={isLast ? 'Sin maximo' : undefined}
          />
        </View>
      </View>

      <View style={styles.fieldRow}>
        <View style={styles.flex1}>
          <Selector
            label={PROMOTION_LABELS.fieldType}
            value={value.type}
            onChange={(v) => onChange({ ...value, type: v as PromotionType })}
            options={TIER_TYPE_OPTIONS}
            disabled={disabled}
            required
          />
        </View>
        <View style={styles.flex1}>
          <Input
            label={PROMOTION_LABELS.fieldValue}
            value={value.value != null ? String(value.value) : ''}
            onChangeText={(t) =>
              onChange({ ...value, value: t ? Number(t) : 0 })
            }
            keyboardType="decimal-pad"
            error={valueError}
            suffix={value.type === 'percentage' ? <Text style={styles.suffix}>%</Text> : undefined}
            editable={!disabled}
            required
          />
        </View>
      </View>

      {rowError ? <Text style={styles.rowError}>{`Escala ${index + 1}: ${rowError}`}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    gap: spacing[3],
    backgroundColor: colorScales.gray[50],
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    fontFamily: typography.fontFamily,
    color: colors.text.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.red[100],
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  flex1: { flex: 1 },
  suffix: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
  },
  rowError: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colors.error,
    fontStyle: 'italic',
  },
});
