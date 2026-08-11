/**
 * Captura de CANTIDAD en la unidad de venta (QUI-648, fase 2).
 *
 * El cajero pide "3 metros", no "3000 milímetros". Este modal captura el 3 y
 * devuelve el 3; la conversión a la unidad mínima —la que viaja en
 * `order_items.quantity`— la hace el caller con
 * `resolveStockUnitsFromCapture`, para que el modal no sepa nada de inventario.
 *
 * Es el equivalente móvil del `dialogService.prompt({ title: 'Cantidad en …' })`
 * que usa `pos-product-selection.component.ts` en el web. React Native no tiene
 * `prompt` portable (`Alert.prompt` es solo iOS), así que la captura vive en un
 * modal propio en vez de en un diálogo del sistema.
 *
 * Solo se abre para productos que declaran unidad de stock CON una unidad de
 * captura distinta (`requiresSaleQuantityCapture`). Un producto por pieza nunca
 * lo ve: se sigue agregando de un toque.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { formatCurrency } from '@/shared/utils/currency';
import type { Product } from '@/features/store/types';
import {
  resolveStockUnitsFromCapture,
  type SaleUnitConfig,
} from '@/features/store/pricing';

interface PosSaleQuantityModalProps {
  visible: boolean;
  product: Product | null;
  /** Configuración resuelta con `resolveSaleUnitConfig`. */
  config: SaleUnitConfig | null;
  /** Cantidad EN UNIDADES DE CAPTURA (3 = "3 metros"). */
  onConfirm: (amount: number) => void;
  onClose: () => void;
}

/** Acepta coma o punto: el cajero colombiano teclea "2,5". */
function parseAmount(raw: string): number {
  const parsed = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Sin ceros de relleno: "3", "2,5". */
function formatAmount(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
}

export function PosSaleQuantityModal({
  visible,
  product,
  config,
  onConfirm,
  onClose,
}: PosSaleQuantityModalProps) {
  const [amount, setAmount] = useState('1');

  // Cada apertura arranca en 1: arrastrar la cantidad del producto anterior es
  // la clase de error que en un POS se cobra.
  useEffect(() => {
    if (visible) setAmount('1');
  }, [visible, product?.id]);

  const unitCode = config?.captureUnit?.code ?? config?.stockUnit?.code ?? '';
  const unitsPerCapture = Number(config?.unitsPerCapture ?? 1) || 1;
  const unitPrice = Number(product?.final_price ?? product?.base_price ?? 0) || 0;

  const parsed = parseAmount(amount);
  const stockUnits = resolveStockUnitsFromCapture(parsed, unitsPerCapture);
  const isValid = stockUnits > 0;

  // El mínimo real es UNA unidad mínima expresada en la unidad de captura:
  // con stock en mm y precio por metro, 0,001 m. Decírselo al cajero es más
  // útil que rechazar la captura sin explicación.
  const minimum = useMemo(
    () => formatAmount(1 / (unitsPerCapture > 1 ? unitsPerCapture : 1)),
    [unitsPerCapture],
  );

  const step = (delta: number) => {
    const next = Math.max(0, Math.round((parsed + delta) * 1000) / 1000);
    setAmount(formatAmount(next));
  };

  const handleConfirm = () => {
    if (!isValid) return;
    onConfirm(parsed);
  };

  if (!visible || !product || !config) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.container} onPress={(e) => e.stopPropagation()}>
            <View style={styles.header}>
              <View style={styles.flex1}>
                <Text style={styles.title}>Cantidad en {unitCode}</Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {product.name}
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="Cerrar captura de cantidad"
              >
                <Icon name="x" size={18} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            <View style={styles.body}>
              <Text style={styles.priceLine}>
                {formatCurrency(unitPrice)} por {unitCode}
              </Text>

              <View style={styles.qtyRow}>
                <Pressable
                  onPress={() => step(-1)}
                  style={({ pressed }) => [styles.qtyBtn, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Restar una unidad"
                >
                  <Icon name="minus" size={16} color={colorScales.gray[600]} />
                </Pressable>
                <TextInput
                  style={styles.qtyInput}
                  value={amount}
                  onChangeText={(v) => setAmount(v.replace(/[^0-9.,]/g, ''))}
                  keyboardType="decimal-pad"
                  textAlign="center"
                  autoFocus
                  selectTextOnFocus
                  accessibilityLabel={`Cantidad en ${unitCode}`}
                />
                <Pressable
                  onPress={() => step(1)}
                  style={({ pressed }) => [
                    styles.qtyBtn,
                    styles.qtyBtnPlus,
                    pressed && { opacity: 0.6 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Sumar una unidad"
                >
                  <Icon name="plus" size={16} color={colors.primary} />
                </Pressable>
              </View>

              {isValid ? (
                <Text style={styles.totalLine}>
                  Total {formatCurrency(unitPrice * parsed)}
                </Text>
              ) : (
                <Text style={styles.errorLine}>
                  La cantidad mínima es {minimum} {unitCode}
                </Text>
              )}
            </View>

            <View style={styles.footer}>
              <Pressable style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[styles.addBtn, !isValid && styles.addBtnDisabled]}
                onPress={handleConfirm}
                disabled={!isValid}
              >
                <Icon name="plus" size={18} color="#FFFFFF" />
                <Text style={styles.addText}>Agregar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  root: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  container: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  subtitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    padding: spacing[4],
    gap: spacing[3],
  },
  priceLine: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[600],
    textAlign: 'center',
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  qtyBtn: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  qtyBtnPlus: {
    backgroundColor: colorScales.green[50],
  },
  qtyInput: {
    flex: 1,
    height: 52,
    textAlign: 'center',
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  totalLine: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    textAlign: 'center',
  },
  errorLine: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.red[600],
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
  },
  cancelText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  addBtn: {
    flex: 2,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});
