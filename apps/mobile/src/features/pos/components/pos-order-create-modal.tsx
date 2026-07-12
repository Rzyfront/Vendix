import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { formatCurrency } from '@/shared/utils/currency';
import { useCartStore } from '@/features/store/pos/store/cart.store';
import { useAuthStore } from '@/core/store/auth.store';
import { useTenantStore } from '@/core/store/tenant.store';
import { OrderService } from '@/features/store/services';
import { toastSuccess, toastError, toastWarning } from '@/shared/components/toast/toast.store';
import type { CreatePosPaymentDto, PosCustomer } from '@/features/store/types';
import { PosCustomerModal } from './pos-customer-modal';

interface PosOrderCreateModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (orderNumber: string) => void;
}

/**
 * Modal-resumen "Crear" (parity web `pos-order-create-modal.component.ts`).
 *
 * Aparece antes de persistir el borrador de la orden. Muestra:
 *  - Resumen: lista de ítems del carrito + subtotal/impuestos/total.
 *  - Cliente: toggle Venta Anónima / Con Cliente + selector inline.
 *
 * Footer: Cancelar / Crear orden. El submit dispara
 * `OrderService.processPosPayment` con `requires_payment: false` (mismo
 * path que el botón "Guardar" actual) y limpia el carrito al éxito.
 *
 * Mobile no expone `product_type === 'prepared'` ni fulfillment restaurante
 * todavía (el tipo mobile es solo `'physical' | 'service'`), por lo que la
 * columna "Servicio" del modal web queda fuera de scope.
 */
export function PosOrderCreateModal({ visible, onClose, onCreated }: PosOrderCreateModalProps) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const items = useCartStore((s) => s.items);
  const customer = useCartStore((s) => s.customer);
  const summary = useCartStore((s) => s.summary);
  const setCustomer = useCartStore((s) => s.setCustomer);
  const clearCart = useCartStore((s) => s.clearCart);
  const notes = useCartStore((s) => s.notes);

  const [isAnonymous, setIsAnonymous] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function resolvePositiveId(...values: unknown[]): number | undefined {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
    return undefined;
  }

  // Reset state every time the modal re-opens so the operator always sees
  // a clean form (parity with the `effect(() => { if (isOpen()) ... })`
  // block in the web version).
  useEffect(() => {
    if (visible) {
      setIsAnonymous(!customer);
      setShowCustomerSearch(false);
      setIsSubmitting(false);
    }
  }, [visible, customer]);

  const canConfirm = items.length > 0 && (isAnonymous || !!customer);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleConfirm = useCallback(async () => {
    if (items.length === 0) {
      toastWarning('El carrito está vacío');
      return;
    }
    if (!isAnonymous && !customer) {
      toastWarning('Selecciona un cliente o marca venta anónima');
      return;
    }

    setIsSubmitting(true);
    try {
      const tenantStoreId = useTenantStore.getState().storeId;
      const authStoreId =
        useAuthStore.getState().user?.store?.id ?? useAuthStore.getState().user?.main_store_id;
      const storeId = resolvePositiveId(tenantStoreId, authStoreId);
      if (!storeId) {
        toastError('La sesión no tiene una tienda activa');
        setIsSubmitting(false);
        return;
      }

      const payload: CreatePosPaymentDto = {
        customer_id: isAnonymous
          ? undefined
          : customer
            ? Number(customer.id)
            : undefined,
        customer_name: isAnonymous
          ? undefined
          : customer
            ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || undefined
            : undefined,
        customer_email: isAnonymous ? undefined : (customer?.email ?? undefined),
        customer_phone: isAnonymous ? undefined : (customer?.phone ?? undefined),
        store_id: storeId,
        items: items.map((i) => ({
          product_id: i.product.id === 0 ? undefined : Number(i.product.id),
          product_variant_id: i.variant?.id ? Number(i.variant.id) : undefined,
          product_name: i.product.name,
          product_sku: i.product.sku || undefined,
          variant_sku: i.variant?.sku || undefined,
          quantity: i.quantity,
          unit_price: Number(i.unitPrice.toFixed(2)),
          total_price: Number((i.unitPrice * i.quantity).toFixed(2)),
          tax_amount_item: Number(i.taxAmount.toFixed(2)),
          cost: i.variant?.cost_price ?? i.product.cost_price ?? undefined,
        })),
        subtotal: Number(summary.subtotal.toFixed(2)),
        tax_amount: Number(summary.taxAmount.toFixed(2)),
        discount_amount: Number(summary.discountAmount.toFixed(2)),
        total_amount: Number(summary.total.toFixed(2)),
        requires_payment: false,
        delivery_type: 'direct_delivery',
        internal_notes: notes || undefined,
        update_inventory: false,
        allow_oversell: true,
        print_receipt: false,
      };

      const response = await OrderService.processPosPayment(payload);
      if (!response.success) {
        toastError(response.message || 'Error al crear la orden');
        setIsSubmitting(false);
        return;
      }

      const orderNum = response.order?.order_number || '';
      clearCart();
      setIsSubmitting(false);
      onClose();
      // Invalidar queries que dependan del estado de órdenes.
      queryClient.invalidateQueries({ queryKey: ['pos-orders'] });
      queryClient.invalidateQueries({ queryKey: ['sales-summary'] });
      toastSuccess(response.message || 'Orden creada correctamente');
      if (onCreated && orderNum) onCreated(orderNum);
    } catch (err: any) {
      const data = err?.response?.data;
      const baseMsg = data?.message || err?.message || 'Error al crear la orden';
      const details = data?.details?.validationErrors;
      const fullMsg = details ? `${baseMsg}: ${details.join(', ')}` : baseMsg;
      toastError(fullMsg);
      setIsSubmitting(false);
    }
  }, [items, isAnonymous, customer, summary, notes, clearCart, onClose, onCreated, queryClient]);

  if (!visible) return null;

  const customerDisplayName = customer
    ? `${customer.first_name} ${customer.last_name || ''}`.trim()
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
        {/* Sibling layout: backdrop tappable, modal container catches its own gestures.
            Nesting Pressables + stopPropagation does NOT work in RN. */}
        <Pressable style={styles.backdrop} onPress={handleClose} />
        <View style={styles.centerWrap}>
        <View style={[styles.container, { paddingBottom: 0 }]}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <Icon name="clipboard-list" size={20} color={colors.primary} />
              </View>
              <View style={styles.headerInfo}>
                <Text style={styles.headerTitle}>Crear orden</Text>
                <Text style={styles.headerSubtitle}>
                  Confirma los datos antes de generar el borrador
                </Text>
              </View>
              <Pressable onPress={handleClose} hitSlop={8} style={styles.closeBtn}>
                <Icon name="x" size={20} color={colorScales.gray[400]} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.body}
              contentContainerStyle={{ paddingBottom: spacing[4] }}
              keyboardShouldPersistTaps="handled"
            >
              {/* === RESUMEN === */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionIndicator} />
                  <Text style={styles.sectionTitle}>Resumen</Text>
                </View>

                <View style={styles.productList}>
                  {items.map((item) => (
                    <View key={item.id} style={styles.productRow}>
                      <View style={styles.productInfo}>
                        <Text style={styles.productName} numberOfLines={1}>
                          {item.product.name}
                          {item.variant_display_name ? (
                            <Text style={styles.productVariant}>
                              {' '}
                              - {item.variant_display_name}
                            </Text>
                          ) : null}
                        </Text>
                      </View>
                      <Text style={styles.productQty}>x{item.quantity}</Text>
                      <Text style={styles.productPrice}>
                        {formatCurrency(item.totalPrice)}
                      </Text>
                    </View>
                  ))}
                  {items.length === 0 && (
                    <Text style={styles.emptyText}>Sin productos</Text>
                  )}
                </View>

                <View style={styles.summaryBlock}>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Ítems</Text>
                    <Text style={styles.summaryValue}>{summary.itemCount}</Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Subtotal</Text>
                    <Text style={styles.summaryValue}>
                      {formatCurrency(summary.subtotal)}
                    </Text>
                  </View>
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Impuestos</Text>
                    <Text style={styles.summaryValue}>
                      {formatCurrency(summary.taxAmount)}
                    </Text>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalAmount}>
                      {formatCurrency(summary.total)}
                    </Text>
                  </View>
                </View>
              </View>

              {/* === CLIENTE === */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionIndicator} />
                  <Text style={styles.sectionTitle}>Cliente</Text>
                </View>

                {/* Toggle: Venta Anónima / Con Cliente */}
                <View style={styles.saleTypeOptions}>
                  <Pressable
                    style={[styles.saleTypeBtn, isAnonymous && styles.saleTypeBtnSelected]}
                    onPress={() => {
                      setIsAnonymous(true);
                      setShowCustomerSearch(false);
                    }}
                  >
                    <View style={styles.radioIndicator}>
                      {isAnonymous && <View style={styles.radioDot} />}
                    </View>
                    <Icon
                      name="user-x"
                      size={20}
                      color={isAnonymous ? colors.primary : colorScales.gray[600]}
                    />
                    <View style={styles.saleTypeInfo}>
                      <Text style={styles.saleTypeName}>Venta Anónima</Text>
                      <Text style={styles.saleTypeDesc}>Consumidor Final</Text>
                    </View>
                  </Pressable>

                  <Pressable
                    style={[styles.saleTypeBtn, !isAnonymous && styles.saleTypeBtnSelected]}
                    onPress={() => setIsAnonymous(false)}
                  >
                    <View style={styles.radioIndicator}>
                      {!isAnonymous && <View style={styles.radioDot} />}
                    </View>
                    <Icon
                      name="user"
                      size={20}
                      color={!isAnonymous ? colors.primary : colorScales.gray[600]}
                    />
                    <View style={styles.saleTypeInfo}>
                      <Text style={styles.saleTypeName}>Con Cliente</Text>
                      <Text style={styles.saleTypeDesc}>
                        {customer ? customerDisplayName : 'Seleccionar cliente'}
                      </Text>
                    </View>
                  </Pressable>
                </View>

                {/* Cliente seleccionado (chip verde + edit). */}
                {!isAnonymous && customer && (
                  <View style={styles.selectedCustomer}>
                    <View style={styles.customerAvatar}>
                      <Icon name="user-check" size={16} color={colorScales.green[700]} />
                    </View>
                    <View style={styles.customerInfo}>
                      <Text style={styles.customerName}>{customerDisplayName}</Text>
                      {customer.email ? (
                        <Text style={styles.customerEmail}>{customer.email}</Text>
                      ) : null}
                    </View>
                    <Pressable
                      style={styles.changeCustomerBtn}
                      onPress={() => setShowCustomerSearch(true)}
                      hitSlop={6}
                    >
                      <Icon name="edit-2" size={14} color={colors.primary} />
                    </Pressable>
                  </View>
                )}

                {/* CTA para abrir el selector. */}
                {!isAnonymous && !customer && (
                  <Pressable
                    style={styles.selectCustomerBtn}
                    onPress={() => setShowCustomerSearch(true)}
                  >
                    <Icon name="user-plus" size={18} color={colors.primary} />
                    <Text style={styles.selectCustomerText}>Seleccionar Cliente</Text>
                  </Pressable>
                )}
              </View>
            </ScrollView>

            {/* Footer */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[3] }]}>
              <Pressable
                style={styles.cancelBtn}
                onPress={handleClose}
                disabled={isSubmitting}
              >
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.createBtn,
                  (!canConfirm || isSubmitting) && styles.createBtnDisabled,
                ]}
                onPress={handleConfirm}
                disabled={!canConfirm || isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Icon name="check" size={16} color="#FFFFFF" />
                )}
                <Text style={styles.createBtnText}>
                  {isSubmitting ? 'Creando…' : 'Crear orden'}
                </Text>
              </Pressable>
            </View>
        </View>
        </View>
      </KeyboardAvoidingView>

      {/* Selector de cliente inline (re-usa PosCustomerModal ya implementado). */}
      <PosCustomerModal
        visible={showCustomerSearch}
        onClose={() => setShowCustomerSearch(false)}
        onSelectCustomer={(c) => {
          if (c) {
            setCustomer(c as PosCustomer);
            setIsAnonymous(false);
          }
          setShowCustomerSearch(false);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  container: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
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
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.green[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: { flex: 1 },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  headerSubtitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 1,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flexGrow: 0 },
  section: {
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  sectionIndicator: {
    width: 3,
    height: 16,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  sectionTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  productList: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[50],
  },
  productInfo: { flex: 1, marginRight: spacing[2] },
  productName: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[800],
  },
  productVariant: {
    fontSize: 11,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    opacity: 0.85,
  },
  productQty: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginRight: spacing[3],
    minWidth: 28,
    textAlign: 'right',
  },
  productPrice: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    minWidth: 70,
    textAlign: 'right',
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: spacing[4],
  },
  summaryBlock: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[1],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  summaryValue: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    fontWeight: typography.fontWeight.medium as any,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[2],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  totalLabel: {
    fontSize: 10,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: typography.fontWeight.semibold as any,
  },
  totalAmount: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  saleTypeOptions: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  saleTypeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  saleTypeBtnSelected: {
    borderColor: colors.primary,
    backgroundColor: colorScales.green[50],
  },
  radioIndicator: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colorScales.gray[300],
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  saleTypeInfo: { flex: 1 },
  saleTypeName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[800],
  },
  saleTypeDesc: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 1,
  },
  selectedCustomer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.green[200],
  },
  customerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  customerInfo: { flex: 1 },
  customerName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.green[800],
  },
  customerEmail: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.green[600],
  },
  changeCustomerBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.green[100],
    borderRadius: 16,
  },
  selectCustomerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    height: 44,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  selectCustomerText: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold as any,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  cancelBtn: {
    flex: 1,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    backgroundColor: colors.background,
  },
  cancelBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  createBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});