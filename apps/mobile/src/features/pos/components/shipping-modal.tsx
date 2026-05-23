import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { formatCurrency } from '@/shared/utils/currency';
import { ShippingService, OrderService } from '@/features/store/services';
import { useAuthStore } from '@/core/store/auth.store';
import { useTenantStore } from '@/core/store/tenant.store';
import { useCartStore } from '@/features/store/pos/store/cart.store';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import type { CreatePosPaymentDto, PaymentMethod, PosCustomer } from '@/features/store/types';

function getPaymentMethodType(method?: PaymentMethod | null): string {
  return method?.system_payment_method?.type || method?.type || '';
}

function getPaymentMethodLabel(method?: PaymentMethod | null): string {
  return (
    method?.display_name ||
    method?.name ||
    method?.system_payment_method?.display_name ||
    method?.system_payment_method?.name ||
    'Método de pago'
  );
}

function getPaymentMethodIcon(type: string): string {
  if (type === 'cash') return 'dollar-sign';
  if (type === 'card') return 'credit-card';
  if (type === 'bank_transfer' || type === 'transfer') return 'wallet';
  return 'credit-card';
}

interface ShippingModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (orderNumber: string) => void;
  onSelectCustomer: () => void;
}

export function ShippingModal({ visible, onClose, onSuccess, onSelectCustomer }: ShippingModalProps) {
  const items = useCartStore((s) => s.items);
  const summary = useCartStore((s) => s.summary);
  const customer = useCartStore((s) => s.customer);
  const notes = useCartStore((s) => s.notes);
  const clearCart = useCartStore((s) => s.clearCart);
  const tenantStoreId = useTenantStore((s) => s.storeId);
  const authStoreId = useAuthStore((s) => s.user?.store?.id ?? s.user?.main_store_id);

  const storeId = useMemo(() => {
    const id = tenantStoreId ?? authStoreId;
    if (typeof id === 'number' && id > 0) return id;
    if (typeof id === 'string') { const n = parseInt(id, 10); if (!isNaN(n) && n > 0) return n; }
    return undefined;
  }, [tenantStoreId, authStoreId]);

  const [paymentForm, setPaymentForm] = useState<'contado' | 'credito'>('contado');
  const [paymentMode, setPaymentMode] = useState<'on_delivery' | 'pay_now'>('on_delivery');
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<number | null>(null);
  const [deliveryType, setDeliveryType] = useState<'pickup' | 'home_delivery'>('home_delivery');
  const [address, setAddress] = useState('');
  const [addressDetail, setAddressDetail] = useState('');
  const [selectedShippingMethodId, setSelectedShippingMethodId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: shippingMethods, isLoading: methodsLoading } = useQuery({
    queryKey: ['pos-shipping-methods'],
    queryFn: () => ShippingService.list(),
    enabled: visible,
  });

  const { data: paymentMethods = [], isLoading: paymentMethodsLoading } = useQuery({
    queryKey: ['pos-payment-methods-shipping'],
    queryFn: () => OrderService.getPaymentMethods(),
    enabled: visible,
  });

  const enabledShippingMethods = (shippingMethods || []).filter((m) => m.is_enabled);
  const selectedShippingMethod = enabledShippingMethods.find((m) => m.id === selectedShippingMethodId);
  const selectedPaymentMethod = paymentMethods.find((m) => m.id === selectedPaymentMethodId);

  const canSubmit = useMemo(() => {
    if (items.length === 0) return false;
    if (deliveryType === 'home_delivery' && (!address.trim() || !selectedShippingMethod)) return false;
    if (paymentMode === 'pay_now' && !selectedPaymentMethod) return false;
    return true;
  }, [items.length, deliveryType, address, selectedShippingMethod, paymentMode, selectedPaymentMethod]);

  const shippingCost = selectedShippingMethod?.price ?? 0;
  const totalWithShipping = summary.total + shippingCost;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (!storeId) {
      toastError('La sesión no tiene una tienda activa');
      return;
    }

    setSaving(true);
    try {
      const payload: CreatePosPaymentDto = {
        customer_id: customer?.id ? Number(customer.id) : undefined,
        customer_name: customer ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() : undefined,
        customer_email: customer?.email,
        customer_phone: customer?.phone ?? undefined,
        store_id: storeId,
        items: items.map((i) => ({
          product_id: i.product.id === 0 ? 0 : Number(i.product.id),
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
        total_amount: Number(totalWithShipping.toFixed(2)),
        requires_payment: paymentMode === 'pay_now',
        store_payment_method_id: selectedPaymentMethod?.id,
        delivery_type: deliveryType === 'pickup' ? 'pickup' : 'home_delivery',
        internal_notes: [
          notes || '',
          deliveryType === 'home_delivery' && selectedShippingMethod
            ? `Envío: ${selectedShippingMethod.name} - ${address}${addressDetail ? ` (${addressDetail})` : ''}`
            : deliveryType === 'pickup'
              ? 'Recoge en tienda'
              : '',
        ]
          .filter(Boolean)
          .join(' | ') || undefined,
        update_inventory: paymentMode === 'pay_now',
        allow_oversell: true,
        print_receipt: false,
        payment_form: paymentForm === 'credito' ? '2' : '1',
        credit_type: paymentForm === 'credito' ? 'installments' : undefined,
      };

      const response = await OrderService.processPosPayment(payload);
      if (!response.success) {
        toastError(response.message || 'Error al procesar el pedido');
        return;
      }

      clearCart();
      onClose();
      if (response.order?.order_number) {
        onSuccess(response.order.order_number);
      }
      toastSuccess('Pedido creado exitosamente');
    } catch (err: any) {
      const apiMsg = err?.response?.data?.message;
      const detailMsg = err?.response?.data?.errors?.[0];
      toastError(apiMsg || detailMsg || err?.message || 'Error al procesar el pedido');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="full">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Pedido con envío</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Icon name="x" size={24} color={colorScales.gray[500]} />
          </Pressable>
        </View>

        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
          {/* Customer Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIndicator} />
              <Icon name="user" size={16} color={colors.primary} />
              <Text style={styles.sectionTitle}>Cliente</Text>
            </View>
            {customer ? (
              <View style={styles.selectedCustomer}>
                <View style={styles.customerAvatar}>
                  <Text style={styles.customerInitials}>
                    {customer.first_name?.[0]}{customer.last_name?.[0]}
                  </Text>
                </View>
                <View style={styles.customerInfo}>
                  <Text style={styles.customerName}>
                    {customer.first_name} {customer.last_name}
                  </Text>
                  {customer.email && <Text style={styles.customerDetail}>{customer.email}</Text>}
                </View>
                <Pressable onPress={onSelectCustomer} style={styles.changeBtn}>
                  <Icon name="refresh-cw" size={16} color={colorScales.gray[500]} />
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.selectCustomerBtn} onPress={onSelectCustomer}>
                <Icon name="user-plus" size={18} color={colorScales.gray[400]} />
                <Text style={styles.selectCustomerText}>Seleccionar o crear cliente</Text>
              </Pressable>
            )}
          </View>

          {/* Forma de Pago */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIndicator} />
              <Icon name="dollar-sign" size={16} color={colors.primary} />
              <Text style={styles.sectionTitle}>Forma de pago</Text>
            </View>
            <View style={styles.tabGroup}>
              <Pressable
                style={[styles.tabBtn, paymentForm === 'contado' && styles.tabBtnActive]}
                onPress={() => setPaymentForm('contado')}
              >
                <Icon name="dollar-sign" size={16} color={paymentForm === 'contado' ? colors.primary : colorScales.gray[500]} />
                <Text style={[styles.tabBtnText, paymentForm === 'contado' && styles.tabBtnTextActive]}>Contado</Text>
              </Pressable>
              <Pressable
                style={[styles.tabBtn, paymentForm === 'credito' && styles.tabBtnActive]}
                onPress={() => setPaymentForm('credito')}
              >
                <Icon name="calendar" size={16} color={paymentForm === 'credito' ? colors.primary : colorScales.gray[500]} />
                <Text style={[styles.tabBtnText, paymentForm === 'credito' && styles.tabBtnTextActive]}>Crédito</Text>
              </Pressable>
            </View>
          </View>

          {/* Modalidad de pago + Método de pago */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIndicator} />
              <Icon name="credit-card" size={16} color={colors.primary} />
              <Text style={styles.sectionTitle}>Modalidad de pago</Text>
            </View>
            <View style={styles.paymentModeOptions}>
              <Pressable
                style={[styles.saleTypeBtn, paymentMode === 'on_delivery' && styles.saleTypeBtnSelected]}
                onPress={() => { setPaymentMode('on_delivery'); setSelectedPaymentMethodId(null); }}
              >
                <View style={styles.radioOuter}>
                  {paymentMode === 'on_delivery' && <View style={styles.radioInner} />}
                </View>
                <View style={styles.saleTypeIcon}>
                  <Icon name="package" size={18} color={paymentMode === 'on_delivery' ? colors.primary : colorScales.gray[500]} />
                </View>
                <View style={styles.saleTypeInfo}>
                  <Text style={styles.saleTypeName}>Pago contra entrega</Text>
                  <Text style={styles.saleTypeDesc}>Paga cuando recibas el pedido</Text>
                </View>
              </Pressable>

              <Pressable
                style={[styles.saleTypeBtn, paymentMode === 'pay_now' && styles.saleTypeBtnSelected]}
                onPress={() => setPaymentMode('pay_now')}
              >
                <View style={styles.radioOuter}>
                  {paymentMode === 'pay_now' && <View style={styles.radioInner} />}
                </View>
                <View style={styles.saleTypeIcon}>
                  <Icon name="credit-card" size={18} color={paymentMode === 'pay_now' ? colors.primary : colorScales.gray[500]} />
                </View>
                <View style={styles.saleTypeInfo}>
                  <Text style={styles.saleTypeName}>Pagar ahora</Text>
                  <Text style={styles.saleTypeDesc}>Paga en línea con tu método de pago</Text>
                </View>
              </Pressable>
            </View>

            {paymentMode === 'pay_now' && (
              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>Método de pago</Text>
                {paymentMethodsLoading ? (
                  <View style={styles.loadingBox}>
                    <Spinner />
                  </View>
                ) : paymentMethods.length === 0 ? (
                  <View style={styles.noMethodsBox}>
                    <Icon name="credit-card" size={18} color={colorScales.gray[400]} />
                    <Text style={styles.noCustomerText}>Sin métodos de pago disponibles</Text>
                  </View>
                ) : (
                  <View style={styles.paymentGrid}>
                    {paymentMethods.map((method) => {
                      const type = getPaymentMethodType(method);
                      return (
                        <Pressable
                          key={method.id}
                          style={[styles.paymentGridBtn, selectedPaymentMethodId === method.id && styles.paymentGridBtnSelected]}
                          onPress={() => setSelectedPaymentMethodId(
                            selectedPaymentMethodId === method.id ? null : method.id,
                          )}
                        >
                          <Icon
                            name={getPaymentMethodIcon(type)}
                            size={22}
                            color={selectedPaymentMethodId === method.id ? colors.primary : colorScales.gray[500]}
                          />
                          <Text style={[
                            styles.paymentGridLabel,
                            selectedPaymentMethodId === method.id && { color: colors.primary },
                          ]} numberOfLines={2}>
                            {getPaymentMethodLabel(method)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Delivery Type + Address + Shipping Method */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIndicator} />
              <Icon name="truck" size={16} color={colors.primary} />
              <Text style={styles.sectionTitle}>Tipo de entrega</Text>
            </View>
            <View style={styles.deliveryTypeRow}>
              <Pressable
                style={[styles.tabBtn, deliveryType === 'home_delivery' && styles.tabBtnActive]}
                onPress={() => setDeliveryType('home_delivery')}
              >
                <Icon name="truck" size={16} color={deliveryType === 'home_delivery' ? colors.primary : colorScales.gray[500]} />
                <Text style={[styles.tabBtnText, deliveryType === 'home_delivery' && styles.tabBtnTextActive]}>
                  Entrega rápida local
                </Text>
              </Pressable>
              <Pressable
                style={[styles.tabBtn, deliveryType === 'pickup' && styles.tabBtnActive]}
                onPress={() => setDeliveryType('pickup')}
              >
                <Icon name="store" size={16} color={deliveryType === 'pickup' ? colors.primary : colorScales.gray[500]} />
                <Text style={[styles.tabBtnText, deliveryType === 'pickup' && styles.tabBtnTextActive]}>
                  Recogida en tienda
                </Text>
              </Pressable>
            </View>

            {deliveryType === 'home_delivery' && (
              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>Dirección de entrega</Text>
                <TextInput
                  style={styles.input}
                  value={address}
                  onChangeText={setAddress}
                  placeholder="Dirección *"
                  placeholderTextColor={colorScales.gray[400]}
                />
                <TextInput
                  style={[styles.input, { marginTop: spacing[2] }]}
                  value={addressDetail}
                  onChangeText={setAddressDetail}
                  placeholder="Complemento (opcional)"
                  placeholderTextColor={colorScales.gray[400]}
                />

                <Text style={[styles.subSectionTitle, { marginTop: spacing[3] }]}>Método de envío</Text>
                {methodsLoading ? (
                  <View style={styles.loadingBox}>
                    <Spinner />
                  </View>
                ) : enabledShippingMethods.length === 0 ? (
                  <View style={styles.noMethodsBox}>
                    <Icon name="truck" size={18} color={colorScales.gray[400]} />
                    <Text style={styles.noCustomerText}>No hay métodos de envío configurados</Text>
                  </View>
                ) : (
                  <View style={styles.methodsList}>
                    {enabledShippingMethods.map((method) => (
                      <Pressable
                        key={method.id}
                        style={[styles.shippingMethodRow, selectedShippingMethodId === method.id && styles.shippingMethodRowSelected]}
                        onPress={() => setSelectedShippingMethodId(method.id)}
                      >
                        <View style={styles.radioOuter}>
                          {selectedShippingMethodId === method.id && <View style={styles.radioInner} />}
                        </View>
                        <View style={styles.shippingMethodInfo}>
                          <Text style={styles.methodName}>{method.name}</Text>
                          {method.description && (
                            <Text style={styles.methodDesc} numberOfLines={2}>{method.description}</Text>
                          )}
                          <Text style={styles.methodTime}>{method.processing_time_days} día(s)</Text>
                        </View>
                        <Text style={styles.methodPrice}>{formatCurrency(method.price)}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Order Summary */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIndicator} />
              <Icon name="shopping-cart" size={16} color={colors.primary} />
              <Text style={styles.sectionTitle}>Resumen del pedido</Text>
            </View>
            <View style={styles.summaryCard}>
              {items.map((item) => (
                <View key={item.id} style={styles.productRow}>
                  <Text style={styles.productName} numberOfLines={1}>{item.product.name}</Text>
                  <Text style={styles.productQty}>x{item.quantity}</Text>
                  <Text style={styles.productTotal}>{formatCurrency(item.totalPrice)}</Text>
                </View>
              ))}
              <View style={styles.summaryDivider} />
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal</Text>
                <Text style={styles.summaryValue}>{formatCurrency(summary.subtotal)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>IVA / impuestos</Text>
                <Text style={styles.summaryValue}>{formatCurrency(summary.taxAmount)}</Text>
              </View>
              {summary.discountAmount > 0 && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Descuento</Text>
                  <Text style={[styles.summaryValue, { color: colors.error }]}>
                    -{formatCurrency(summary.discountAmount)}
                  </Text>
                </View>
              )}
              {deliveryType === 'home_delivery' && selectedShippingMethod && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Envío ({selectedShippingMethod.name})</Text>
                  <Text style={[styles.summaryValue, { color: colors.primary }]}>
                    {formatCurrency(shippingCost)}
                  </Text>
                </View>
              )}
              <View style={styles.totalSection}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalAmount}>{formatCurrency(totalWithShipping)}</Text>
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
          <Pressable
            style={[styles.submitBtn, (!canSubmit || saving) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || saving}
          >
            {saving ? (
              <Spinner size="sm" color="#FFFFFF" />
            ) : (
              <>
                <Icon name="truck" size={18} color="#FFFFFF" />
                <Text style={styles.submitText}>Crear pedido</Text>
              </>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colorScales.gray[200],
  },
  title: {
    fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[900],
  },
  closeBtn: { padding: spacing[1] },
  body: { flex: 1 },
  bodyContent: { padding: spacing[4], gap: spacing[5], paddingBottom: spacing[10] },
  section: { gap: spacing[3] },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
  },
  sectionIndicator: {
    width: 4, height: 18, backgroundColor: colors.primary, borderRadius: 2,
  },
  sectionTitle: {
    fontSize: 14, fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[900],
  },

  selectedCustomer: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    padding: spacing[3], backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.lg,
  },
  customerAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  customerInitials: {
    fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily, color: '#FFFFFF',
  },
  customerInfo: { flex: 1 },
  customerName: {
    fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[900],
  },
  customerDetail: {
    fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily,
    color: colorScales.gray[500], marginTop: 2,
  },
  changeBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center',
  },
  selectCustomerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2],
    padding: spacing[4], borderWidth: 2, borderColor: colorScales.gray[200],
    borderStyle: 'dashed', borderRadius: borderRadius.lg,
  },
  selectCustomerText: {
    fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },

  tabGroup: {
    flexDirection: 'row', gap: spacing[2],
    backgroundColor: colorScales.gray[100], borderRadius: borderRadius.lg,
    padding: spacing[1],
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing[1], paddingVertical: spacing[3], paddingHorizontal: spacing[3],
    borderRadius: borderRadius.md,
  },
  tabBtnActive: { backgroundColor: colors.background },
  tabBtnText: {
    fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[500],
  },
  tabBtnTextActive: { color: colors.primary },

  paymentModeOptions: { gap: spacing[2] },
  saleTypeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    padding: spacing[3], borderWidth: 2, borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
  },
  saleTypeBtnSelected: {
    borderColor: colors.primary, backgroundColor: colorScales.blue[50],
  },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: colorScales.gray[300],
    alignItems: 'center', justifyContent: 'center',
  },
  radioInner: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary,
  },
  saleTypeIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: colorScales.green[100],
    alignItems: 'center', justifyContent: 'center',
  },
  saleTypeInfo: { flex: 1 },
  saleTypeName: {
    fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[900],
  },
  saleTypeDesc: {
    fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily,
    color: colorScales.gray[500], marginTop: 2,
  },

  subSection: { marginTop: spacing[2], paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colorScales.gray[200] },
  subSectionTitle: {
    fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[500],
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing[2],
  },

  loadingBox: { paddingVertical: spacing[8], alignItems: 'center' },
  noMethodsBox: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    padding: spacing[3], backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
  },

  paymentGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2],
  },
  paymentGridBtn: {
    width: '47%', alignItems: 'center', justifyContent: 'center',
    gap: spacing[2], paddingVertical: spacing[4], paddingHorizontal: spacing[2],
    borderWidth: 1, borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
  },
  paymentGridBtnSelected: {
    borderWidth: 2, borderColor: colors.primary,
    backgroundColor: colorScales.blue[50],
  },
  paymentGridLabel: {
    fontSize: 11, fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[600],
    textAlign: 'center', lineHeight: 14,
  },

  deliveryTypeRow: {
    flexDirection: 'row', gap: spacing[2],
    backgroundColor: colorScales.gray[100], borderRadius: borderRadius.lg,
    padding: spacing[1],
  },

  input: {
    height: 44, borderWidth: 1, borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg, paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.base, fontFamily: typography.fontFamily,
    color: colorScales.gray[900], backgroundColor: colors.background,
  },

  methodsList: { gap: spacing[2] },
  shippingMethodRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    padding: spacing[3], borderWidth: 1, borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
  },
  shippingMethodRowSelected: {
    borderColor: colors.primary, backgroundColor: colorScales.blue[50],
  },
  shippingMethodInfo: { flex: 1 },
  methodName: {
    fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[900],
  },
  methodDesc: {
    fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily,
    color: colorScales.gray[500], marginTop: 2,
  },
  methodTime: {
    fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily,
    color: colorScales.gray[400], marginTop: 2,
  },
  methodPrice: {
    fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily, color: colors.primary,
  },

  noCustomerText: {
    fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },

  summaryCard: {
    padding: spacing[3], backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
  },
  productRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingVertical: spacing[1],
  },
  productName: {
    flex: 1, fontSize: 13, fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  productQty: {
    fontSize: 12, fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[500],
    minWidth: 28, textAlign: 'right',
  },
  productTotal: {
    fontSize: 13, fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[700],
    minWidth: 72, textAlign: 'right',
  },
  summaryDivider: {
    height: 1, backgroundColor: colorScales.gray[200],
    marginVertical: spacing[2],
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 2,
  },
  summaryLabel: {
    fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  summaryValue: {
    fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[700],
  },
  totalSection: {
    marginTop: spacing[3], paddingTop: spacing[3],
    borderTopWidth: 1, borderTopColor: colorScales.gray[200],
  },
  totalLabel: {
    fontSize: 10, fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[500],
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  totalAmount: {
    fontSize: 24, fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily, color: colors.primary,
    marginTop: spacing[1],
  },

  footer: {
    flexDirection: 'row', gap: spacing[3], padding: spacing[4],
    borderTopWidth: 1, borderTopColor: colorScales.gray[200],
  },
  cancelBtn: {
    flex: 1, height: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colorScales.gray[300],
  },
  cancelText: {
    fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily, color: colorScales.gray[700],
  },
  submitBtn: {
    flex: 2, height: 48, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: {
    fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily, color: '#FFFFFF',
  },
});
