import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  StyleSheet,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Button } from '@/shared/components/button/button';
import { MoneyInput } from '@/shared/components/money-input/money-input';
import { formatCurrency, parseCurrency } from '@/shared/utils/currency';
import { useCartStore } from '@/features/store/pos/store/cart.store';
import { LayawayService } from '@/features/store/services/layaway.service';
import {
  toastSuccess,
  toastError,
  toastWarning,
} from '@/shared/components/toast/toast.store';
import {
  buildLayawaySchedule,
  isLayawayConfigValid,
  allocateCartDiscounts,
  FREQ_LABELS,
  MAX_INSTALLMENTS,
  type LayawayFrequency,
} from '@/features/store/utils/layaway-schedule';
import type {
  LayawayItemInput,
  LayawayInstallmentInput,
} from '@/features/store/types/layaway.types';
import type { CartItem } from '@/features/store/types';

interface PosLayawayConfigModalProps {
  visible: boolean;
  onClose: () => void;
  /** Called when the plan is successfully created. The parent uses the
   *  plan_number (e.g. `LAY-00001`) to show the SuccessModal. */
  onSuccess?: (planNumber: string) => void;
}

const FREQUENCIES: LayawayFrequency[] = ['weekly', 'biweekly', 'monthly'];

/**
 * PosLayawayConfigModal — Mobile POS "Configurar Plan Separé" modal.
 *
 * Mirror del desktop Angular `LayawayConfigModalComponent`
 * (`apps/frontend/src/app/private/modules/store/pos/components/layaway-config-modal/
 *  layaway-config-modal.component.ts`) portado a React Native + Expo.
 *
 * Captures:
 * - down_payment_amount (opcional, >= 0, < cartTotal)
 * - frequency (weekly / biweekly / monthly)
 * - num_installments (1..60)
 * - notes + internal_notes (opcional)
 *
 * El preview de cuotas y la suma exacta (sum == total - down) están delegados
 * al helper puro `buildLayawaySchedule` (utils/layaway-schedule.ts), que es
 * testado sin React Native.
 *
 * On submit: POST /store/layaway via `LayawayService.create`. Errores mapeados
 * según el plan §4 (LAY_INSTALLMENT_001, 403, etc.).
 */
export function PosLayawayConfigModal({
  visible,
  onClose,
  onSuccess,
}: PosLayawayConfigModalProps) {
  const insets = useSafeAreaInsets();

  const items = useCartStore((s) => s.items);
  const customer = useCartStore((s) => s.customer);
  const summary = useCartStore((s) => s.summary);
  const clearCart = useCartStore((s) => s.clearCart);

  // Form state — strings for inputs (MoneyInput / TextInput manage their own),
  // numbers for parsed numeric values used by the schedule helper.
  const [downPaymentRaw, setDownPaymentRaw] = useState('');
  const [frequency, setFrequency] = useState<LayawayFrequency>('monthly');
  const [numInstallmentsRaw, setNumInstallmentsRaw] = useState('3');
  const [notes, setNotes] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const downPayment = useMemo(() => {
    const n = parseCurrency(downPaymentRaw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [downPaymentRaw]);

  const numInstallments = useMemo(() => {
    const n = parseInt(numInstallmentsRaw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [numInstallmentsRaw]);

  // Custom-item guard (Q3 — per y0ner's decision, layaway rejects custom items).
  const hasCustomItems = useMemo(
    () => items.some((it) => it.itemType === 'custom'),
    [items],
  );

  // Discount sanity guard: layaway rejects when a cart-level discount exceeds
  // the items' gross subtotal. The discount allocator (`allocateCartDiscounts`)
  // would otherwise cap allocations per line and leave `Σ allocations <
  // totalDiscount`, causing the backend's per-line reconstruction to under-fire
  // and POST /store/layaway to fail with LAY_INSTALLMENT_001.
  const discountExceedsSubtotal = useMemo(
    () =>
      (summary.discountAmount ?? 0) > (summary.subtotal ?? 0) + 0.005,
    [summary.discountAmount, summary.subtotal],
  );

  const cartTotal = summary.total;

  const remainingBalance = Math.max(0, cartTotal - downPayment);

  const preview = useMemo(
    () =>
      buildLayawaySchedule({
        cartTotal,
        downPayment,
        numInstallments,
        frequency,
      }),
    [cartTotal, downPayment, numInstallments, frequency],
  );

  const configValid = isLayawayConfigValid({
    cartTotal,
    downPayment,
    numInstallments,
  });
  const installmentsWithinCap = numInstallments <= MAX_INSTALLMENTS;

  const canSubmit =
    configValid &&
    installmentsWithinCap &&
    !hasCustomItems &&
    !discountExceedsSubtotal &&
    !!customer &&
    items.length > 0 &&
    !isSubmitting;

  // Reset state every time the modal re-opens.
  useEffect(() => {
    if (visible) {
      setDownPaymentRaw('');
      setFrequency('monthly');
      setNumInstallmentsRaw('3');
      setNotes('');
      setInternalNotes('');
      setIsSubmitting(false);
    }
  }, [visible]);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    onClose();
  }, [isSubmitting, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!customer) {
      toastWarning('Debes asignar un cliente para crear un plan separé');
      return;
    }
    if (items.length === 0) {
      toastWarning('El carrito está vacío');
      return;
    }
    if (hasCustomItems) {
      toastWarning(
        'Los ítems personalizados no se pueden incluir en un plan separé. Elimínalos del carrito.',
      );
      return;
    }
    if (discountExceedsSubtotal) {
      toastWarning(
        'El descuento del carrito es mayor al subtotal. Redúcelo antes de crear el plan.',
      );
      return;
    }
    if (!configValid || !installmentsWithinCap) {
      toastWarning('Verifica los datos del plan separé');
      return;
    }
    if (preview.length === 0) {
      toastError('No se pudo generar la vista previa de cuotas');
      return;
    }

    setIsSubmitting(true);
    try {
      // Distribute any cart-level discount onto per-item discount_amount so the
      // backend can reconstruct `total_amount = Σ (unit_price*qty - discount +
      // tax)` exactly. Without this, LAY_INSTALLMENT_001 fires whenever the
      // cart has any cart-level discount (coupons, manual promo, etc.).
      // See `allocateCartDiscounts` for the cent-exact algorithm.
      const itemDiscounts = allocateCartDiscounts(
        items,
        Math.max(0, summary.discountAmount ?? 0),
      );

      const layawayItems: LayawayItemInput[] = items.map((i: CartItem, idx: number) => {
        const variantName =
          typeof i.variant?.name === 'string' ? i.variant.name : undefined;
        const sku = i.variant?.sku || i.product.sku;
        const perItemDiscount = itemDiscounts[idx] ?? 0;
        return {
          product_id: Number(i.product.id),
          ...(i.variant?.id ? { product_variant_id: Number(i.variant.id) } : {}),
          product_name: i.product.name,
          ...(variantName ? { variant_name: variantName } : {}),
          ...(sku ? { sku } : {}),
          quantity: i.quantity,
          unit_price: Number(i.unitPrice.toFixed(2)),
          ...(perItemDiscount > 0
            ? { discount_amount: Number(perItemDiscount.toFixed(2)) }
            : {}),
          tax_amount: Number(i.taxAmount.toFixed(2)),
        };
      });

      const installments: LayawayInstallmentInput[] = preview.map((p) => ({
        amount: p.amount,
        due_date: p.due_date,
      }));

      const plan = await LayawayService.create({
        customer_id: Number(customer.id),
        ...(downPayment > 0 ? { down_payment_amount: downPayment } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(internalNotes.trim() ? { internal_notes: internalNotes.trim() } : {}),
        items: layawayItems,
        installments,
      });

      clearCart();
      toastSuccess(`Plan separé ${plan.plan_number} creado`);
      if (onSuccess) onSuccess(plan.plan_number);
      onClose();
    } catch (err: any) {
      const data = err?.response?.data;
      const code = data?.error_code || data?.code;
      const status = err?.response?.status;
      const baseMsg = data?.message || err?.message;
      let friendly = baseMsg || 'Error al crear plan separé';

      // Error mapping per plan §4.
      switch (code) {
        case 'LAY_INSTALLMENT_001':
          friendly =
            'Las cuotas no suman el saldo restante. Ajusta el número de cuotas o el abono.';
          break;
        case 'LAY_INSTALLMENT_002':
          friendly = 'Una de las cuotas ya fue pagada.';
          break;
        case 'LAY_STATE_001':
          friendly = 'El plan separé no se puede crear en su estado actual.';
          break;
        case 'LAY_FIND_001':
          friendly = 'No se encontró el plan separé.';
          break;
        case 'LAY_PAYMENT_001':
          friendly = 'El pago supera el saldo restante.';
          break;
        default:
          if (status === 403) {
            friendly =
              'No tienes permiso para crear planes separé. Contacta al administrador.';
          }
          break;
      }
      toastError(friendly);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    customer,
    items,
    hasCustomItems,
    configValid,
    installmentsWithinCap,
    preview,
    downPayment,
    notes,
    internalNotes,
    clearCart,
    onSuccess,
    onClose,
  ]);

  if (!visible) return null;

  const customerName = customer
    ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()
    : '';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={styles.centerWrap}>
          <View style={[styles.container, { paddingBottom: insets.bottom }]}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <Icon name="calendar" size={20} color={colors.primary} />
              </View>
              <View style={styles.headerInfo}>
                <Text style={styles.headerTitle}>Configurar Plan Separé</Text>
                <Text style={styles.headerSubtitle}>
                  Define el número de cuotas y la periodicidad
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                hitSlop={8}
                style={styles.closeBtn}
                disabled={isSubmitting}
              >
                <Icon name="x" size={20} color={colorScales.gray[400]} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* === Summary card === */}
              <View style={styles.summaryCard}>
                <View style={styles.summaryRow}>
                  <View style={styles.customerChip}>
                    <Icon name="user" size={16} color={colors.primary} />
                    <Text style={styles.customerName} numberOfLines={1}>
                      {customerName || 'Sin cliente'}
                    </Text>
                  </View>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Total del carrito</Text>
                  <Text style={styles.summaryTotalValue}>
                    {formatCurrency(cartTotal)}
                  </Text>
                </View>
              </View>

              {/* === Custom items warning === */}
              {hasCustomItems ? (
                <View style={styles.warningCard}>
                  <Icon
                    name="alert-triangle"
                    size={18}
                    color={colors.error}
                  />
                  <Text style={styles.warningText}>
                    Los ítems personalizados no se pueden incluir en un plan
                    separé. Elimínalos del carrito antes de continuar.
                  </Text>
                </View>
              ) : null}

              {/* === Discount exceeds subtotal warning ===
                  When the cart-level discount is larger than the items' gross
                  subtotal, `allocateCartDiscounts` cannot reconcile per-item
                  allocations to the cart total and the backend would reject
                  with LAY_INSTALLMENT_001. Block submit and instruct the
                  operator to reduce the discount. */}
              {discountExceedsSubtotal ? (
                <View style={styles.warningCard}>
                  <Icon
                    name="alert-triangle"
                    size={18}
                    color={colors.error}
                  />
                  <Text style={styles.warningText}>
                    El descuento del carrito ({formatCurrency(summary.discountAmount ?? 0)})
                    supera el subtotal de los productos ({formatCurrency(summary.subtotal ?? 0)}).
                    Redúcelo antes de crear el plan separé.
                  </Text>
                </View>
              ) : null}

              {/* === Down payment === */}
              <View style={styles.section}>
                <MoneyInput
                  label="Abono inicial"
                  value={downPaymentRaw}
                  onChangeText={setDownPaymentRaw}
                  prefix="$"
                  placeholder="0"
                  helperText="Opcional. Se descuenta del total antes de generar las cuotas."
                  editable={!isSubmitting}
                />
              </View>

              {/* === Frequency === */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Periodicidad</Text>
                <View style={styles.frequencyGrid}>
                  {FREQUENCIES.map((freq) => {
                    const selected = freq === frequency;
                    return (
                      <Pressable
                        key={freq}
                        onPress={() => setFrequency(freq)}
                        disabled={isSubmitting}
                        style={({ pressed }) => [
                          styles.frequencyOption,
                          selected && styles.frequencyOptionSelected,
                          pressed && !selected && { opacity: 0.7 },
                        ]}
                      >
                        <Icon
                          name="calendar"
                          size={16}
                          color={
                            selected ? colors.primary : colorScales.gray[500]
                          }
                        />
                        <Text
                          style={[
                            styles.frequencyLabel,
                            selected && styles.frequencyLabelSelected,
                          ]}
                        >
                          {FREQ_LABELS[freq]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* === Num installments === */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Número de cuotas</Text>
                <TextInput
                  value={numInstallmentsRaw}
                  onChangeText={(text) => {
                    // Only digits, capped at MAX_INSTALLMENTS chars.
                    const cleaned = text.replace(/[^0-9]/g, '').slice(0, 3);
                    setNumInstallmentsRaw(cleaned);
                  }}
                  editable={!isSubmitting}
                  keyboardType="number-pad"
                  placeholder="3"
                  placeholderTextColor={colors.text.muted}
                  style={[
                    styles.numInput,
                    numInstallments > MAX_INSTALLMENTS && styles.numInputError,
                  ]}
                />
                {numInstallments > MAX_INSTALLMENTS ? (
                  <Text style={styles.helperError}>
                    Máximo {MAX_INSTALLMENTS} cuotas
                  </Text>
                ) : null}
              </View>

              {/* === Remaining balance === */}
              <View style={styles.balanceCard}>
                <Text style={styles.balanceLabel}>Saldo a financiar</Text>
                <Text
                  style={[
                    styles.balanceValue,
                    remainingBalance <= 0 && { color: colors.error },
                  ]}
                >
                  {formatCurrency(remainingBalance)}
                </Text>
              </View>

              {/* === Preview === */}
              {preview.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>
                    Vista previa de cuotas ({preview.length})
                  </Text>
                  <View style={styles.previewList}>
                    {preview.map((inst, idx) => (
                      <View key={inst.installment_number} style={styles.previewRow}>
                        <View style={styles.previewIdx}>
                          <Text style={styles.previewIdxText}>{idx + 1}</Text>
                        </View>
                        <Text style={styles.previewDate}>{inst.due_date}</Text>
                        <Text style={styles.previewAmount}>
                          {formatCurrency(inst.amount)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              {/* === Notes === */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Notas (opcional)</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  editable={!isSubmitting}
                  multiline
                  numberOfLines={2}
                  placeholder="Notas visibles para el cliente..."
                  placeholderTextColor={colors.text.muted}
                  style={styles.notesInput}
                />
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Notas internas (opcional)</Text>
                <TextInput
                  value={internalNotes}
                  onChangeText={setInternalNotes}
                  editable={!isSubmitting}
                  multiline
                  numberOfLines={2}
                  placeholder="Solo visible para el equipo..."
                  placeholderTextColor={colors.text.muted}
                  style={styles.notesInput}
                />
              </View>
            </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              <Button
                title="Cancelar"
                onPress={handleClose}
                variant="outline"
                disabled={isSubmitting}
                style={styles.footerBtn}
              />
              <Button
                title="Crear Plan Separé"
                onPress={handleSubmit}
                variant="primary"
                loading={isSubmitting}
                disabled={!canSubmit}
                style={styles.footerBtn}
                leftIcon={
                  <Icon name="check-circle" size={16} color="#FFFFFF" />
                }
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
  },
  container: {
    backgroundColor: colors.card,
    borderRadius: 16,
    maxHeight: '90%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: `${colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  headerSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  closeBtn: {
    padding: spacing[1],
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
  },
  summaryCard: {
    backgroundColor: `${colors.primary}08`,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: `${colors.primary}25`,
    marginBottom: spacing[3],
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryDivider: {
    height: 1,
    backgroundColor: `${colors.primary}15`,
    marginVertical: spacing[2],
  },
  summaryLabel: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    fontWeight: typography.fontWeight.medium,
  },
  summaryTotalValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  customerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flex: 1,
  },
  customerName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    flex: 1,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    backgroundColor: `${colors.error}10`,
    borderColor: `${colors.error}40`,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  warningText: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colors.error,
    lineHeight: 16,
  },
  section: {
    marginBottom: spacing[3],
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[700],
    marginBottom: spacing[1.5],
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  frequencyGrid: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  frequencyOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[1],
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  frequencyOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: `${colors.primary}10`,
  },
  frequencyLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
  },
  frequencyLabelSelected: {
    color: colors.primary,
  },
  numInput: {
    height: 40,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
  },
  numInputError: {
    borderColor: colors.error,
    borderWidth: 1.5,
  },
  helperError: {
    fontSize: typography.fontSize.xs,
    color: colors.error,
    marginTop: spacing[1],
  },
  balanceCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    marginBottom: spacing[3],
  },
  balanceLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    fontWeight: typography.fontWeight.medium,
  },
  balanceValue: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  previewList: {
    gap: spacing[1.5],
    maxHeight: 180,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
  },
  previewIdx: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: `${colors.primary}15`,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[2],
  },
  previewIdxText: {
    fontSize: 11,
    fontWeight: typography.fontWeight.bold,
    color: colors.primary,
  },
  previewDate: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
  },
  previewAmount: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  notesInput: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: 10,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
    textAlignVertical: 'top',
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    backgroundColor: colorScales.gray[50],
  },
  footerBtn: {
    flex: 1,
  },
});