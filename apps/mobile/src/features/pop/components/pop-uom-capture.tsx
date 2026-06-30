import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Spinner } from '@/shared/components/spinner/spinner';

export interface PopUomOption {
  id: number;
  code: string;
  name: string;
  factor_to_base: number;
}

export interface PopUomCaptureResult {
  purchase_uom_id: number | null;
  stock_uom_id: number | null;
  unit_cost: number;
  quantity: number;
}

interface PopUomCaptureProps {
  /** Lista de unidades de medida disponibles (purchasable). */
  purchaseUoms: PopUomOption[];
  /** Lista de unidades de medida de stock. */
  stockUoms: PopUomOption[];
  /** Costo unitario inicial. */
  initialUnitCost?: number;
  /** Cantidad inicial. */
  initialQuantity?: number;
  /** Loading state. */
  loading?: boolean;
  /** Mostrar preview de conversión (factor × cantidad). */
  showPreview?: boolean;
  onChange?: (result: PopUomCaptureResult) => void;
}

/**
 * pop-uom-capture — selector de unidad de medida para ingredientes.
 * Permite elegir la unidad de compra y de stock, con un preview del
 * factor de conversión (ej. "1 pack = 6 unidades"). Replica el patrón
 * visual de la versión web.
 */
export default function PopUomCapture({
  purchaseUoms = [],
  stockUoms = [],
  initialUnitCost = 0,
  initialQuantity = 1,
  loading = false,
  showPreview = true,
  onChange,
}: PopUomCaptureProps) {
  const [purchaseUomId, setPurchaseUomId] = useState<number | null>(
    purchaseUoms[0]?.id ?? null,
  );
  const [stockUomId, setStockUomId] = useState<number | null>(
    stockUoms[0]?.id ?? null,
  );
  const [unitCost, setUnitCost] = useState<string>(String(initialUnitCost || ''));
  const [quantity, setQuantity] = useState<string>(String(initialQuantity || 1));

  const purchaseUom = useMemo(
    () => purchaseUoms.find((u) => u.id === purchaseUomId) ?? null,
    [purchaseUoms, purchaseUomId],
  );
  const stockUom = useMemo(
    () => stockUoms.find((u) => u.id === stockUomId) ?? null,
    [stockUoms, stockUomId],
  );

  const factor = purchaseUom?.factor_to_base ?? 1;
  const parsedCost = Number(unitCost) || 0;
  const parsedQty = Number(quantity) || 1;
  const stockQty = parsedQty * factor;

  // Emite el cambio al padre
  useEffect(() => {
    if (onChange) {
      onChange({
        purchase_uom_id: purchaseUomId,
        stock_uom_id: stockUomId,
        unit_cost: parsedCost,
        quantity: parsedQty,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseUomId, stockUomId, unitCost, quantity]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner size="md" />
        <Text style={styles.loadingText}>Cargando unidades...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Selector unidad de compra */}
      <View style={styles.section}>
        <Text style={styles.label}>Unidad de compra</Text>
        <View style={styles.optionsRow}>
          {purchaseUoms.map((uom) => {
            const isActive = uom.id === purchaseUomId;
            return (
              <View
                key={uom.id}
                style={[styles.optionChip, isActive && styles.optionChipActive]}
              >
                <Text
                  style={[styles.optionChipText, isActive && styles.optionChipTextActive]}
                >
                  {uom.code}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Selector unidad de stock */}
      <View style={styles.section}>
        <Text style={styles.label}>Unidad de stock</Text>
        <View style={styles.optionsRow}>
          {stockUoms.map((uom) => {
            const isActive = uom.id === stockUomId;
            return (
              <View
                key={uom.id}
                style={[styles.optionChip, isActive && styles.optionChipActive]}
              >
                <Text
                  style={[styles.optionChipText, isActive && styles.optionChipTextActive]}
                >
                  {uom.code}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Costo unitario + Cantidad */}
      <View style={styles.row}>
        <View style={[styles.field, { flex: 2 }]}>
          <Text style={styles.label}>Costo unitario</Text>
          <View style={styles.inputWrap}>
            <Text style={styles.currencyPrefix}>$</Text>
            <TextInput
              style={styles.input}
              value={unitCost}
              onChangeText={setUnitCost}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colorScales.gray[400]}
            />
          </View>
        </View>
        <View style={[styles.field, { flex: 1 }]}>
          <Text style={styles.label}>Cantidad</Text>
          <TextInput
            style={[styles.input, styles.inputAlone]}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
            placeholder="1"
            placeholderTextColor={colorScales.gray[400]}
          />
        </View>
      </View>

      {/* Preview de conversión */}
      {showPreview && purchaseUom && stockUom && factor !== 1 ? (
        <View style={styles.previewBox}>
          <Icon name="info" size={14} color={colors.primary} />
          <Text style={styles.previewText}>
            {`1 ${purchaseUom.code} = ${factor} ${stockUom.code}`}
            {' · '}
            {`${parsedQty} ${purchaseUom.code} = ${stockQty} ${stockUom.code}`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing[3],
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: spacing[6],
    gap: spacing[2],
  },
  loadingText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  section: {
    gap: spacing[1.5],
  },
  label: {
    fontSize: 11,
    fontWeight: '700' as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1.5],
  },
  optionChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.card,
  },
  optionChipActive: {
    backgroundColor: colorScales.green[50],
    borderColor: colors.primary,
  },
  optionChipText: {
    fontSize: 13,
    fontWeight: '500' as any,
    color: colorScales.gray[700],
  },
  optionChipTextActive: {
    color: colors.primary,
    fontWeight: '700' as any,
  },
  row: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  field: {
    gap: spacing[1.5],
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
  },
  currencyPrefix: {
    fontSize: 14,
    color: colorScales.gray[500],
    marginRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: colorScales.gray[900],
    paddingVertical: spacing[2.5],
    fontFamily: typography.fontFamily,
  },
  inputAlone: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.card,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  previewBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.green[100],
  },
  previewText: {
    flex: 1,
    fontSize: 12,
    color: colorScales.green[800],
  },
});
