import React, { useState, useCallback } from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { formatCurrency } from '@/shared/utils/currency';
import { OrderService, CustomerService } from '@/features/store/services';
import { useCartStore } from '@/features/store/pos/store/cart.store';
import { useAuthStore } from '@/core/store/auth.store';
import { useTenantStore } from '@/core/store/tenant.store';
import { toastSuccess, toastError, toastWarning } from '@/shared/components/toast/toast.store';
import type { PaymentMethod, PosCustomer } from '@/features/store/types';
import type { CreatePosPaymentDto } from '@/features/store/types';
import { CheckoutStepIndicator } from './checkout-step-indicator';
import { PosCustomerModal } from './pos-customer-modal';

function resolvePositiveId(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

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

interface PosPaymentModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: (orderNumber: string) => void;
}

export function PosPaymentModal({ visible, onClose, onSuccess }: PosPaymentModalProps) {
  const insets = useSafeAreaInsets();

  const items = useCartStore((s) => s.items);
  const customer = useCartStore((s) => s.customer);
  const summary = useCartStore((s) => s.summary);
  const setCustomer = useCartStore((s) => s.setCustomer);

  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentForm, setPaymentForm] = useState<'contado' | 'credito'>('contado');
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [cashReceived, setCashReceived] = useState('');
  const [reference, setReference] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);

  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<PosCustomer[]>([]);
  const [isSearchingCustomer, setIsSearchingCustomer] = useState(false);
  const [showCreateCustomer, setShowCreateCustomer] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({
    email: '',
    first_name: '',
    last_name: '',
    phone: '',
    document_type: '',
    document_number: '',
  });

  const parsedCash = parseFloat(cashReceived) || 0;
  const change = parsedCash - summary.total;
  const needsCashInput = selectedMethod && getPaymentMethodType(selectedMethod) === 'cash';
  const needsReference = selectedMethod && !needsCashInput;
  const canProcess = items.length > 0 && selectedMethod && (isAnonymous || !!customer) && !isProcessing;

  const { data: paymentMethods = [], isLoading: methodsLoading } = useQuery({
    queryKey: ['pos-payment-methods'],
    queryFn: () => OrderService.getPaymentMethods(),
    enabled: visible,
  });

  const handleSearchCustomer = useCallback(async (query: string) => {
    setCustomerSearchQuery(query);
    if (!query || query.trim().length < 2) {
      setCustomerSearchResults([]);
      setIsSearchingCustomer(false);
      return;
    }
    setIsSearchingCustomer(true);
    try {
      const res = await CustomerService.searchCustomers(query.trim(), 10);
      const results = Array.isArray(res) ? res : (res as any).data || [];
      setCustomerSearchResults(results as PosCustomer[]);
    } catch {
      setCustomerSearchResults([]);
    }
    setIsSearchingCustomer(false);
  }, []);

  const handleSelectCustomer = useCallback((c: PosCustomer) => {
    const posCustomer: PosCustomer = {
      id: Number(c.id) || 0,
      first_name: c.first_name,
      last_name: c.last_name,
      email: c.email,
      phone: typeof c.phone === 'string' ? c.phone : null,
      document_number: typeof c.document_number === 'string' ? c.document_number : null,
    };
    setCustomer(posCustomer);
    setShowCustomerSearch(false);
    setCustomerSearchQuery('');
    setCustomerSearchResults([]);
  }, [setCustomer]);

  const handleCreateCustomer = useCallback(async () => {
    const form = newCustomerForm;
    if (!form.first_name.trim() || !form.email.trim()) {
      toastWarning('Nombre y email son obligatorios');
      return;
    }
    try {
      const created = await CustomerService.create({
        email: form.email.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone: form.phone.trim() || undefined,
        document_number: form.document_number.trim() || undefined,
      });
      const posCustomer: PosCustomer = {
        id: Number(created.id) || 0,
        first_name: created.first_name,
        last_name: created.last_name,
        email: created.email,
        phone: created.phone || null,
        document_number: created.document_number || null,
      };
      setCustomer(posCustomer);
      setShowCreateCustomer(false);
      setShowCustomerSearch(false);
      setNewCustomerForm({ email: '', first_name: '', last_name: '', phone: '', document_type: '', document_number: '' });
      toastSuccess('Cliente creado exitosamente');
    } catch {
      toastError('Error al crear el cliente');
    }
  }, [newCustomerForm, setCustomer]);

  const handleReset = useCallback(() => {
    setIsProcessing(false);
    setPaymentForm('contado');
    setSelectedMethod(null);
    setCashReceived('');
    setReference('');
    setIsAnonymous(false);
    setShowCustomerSearch(false);
    setCustomerSearchQuery('');
    setCustomerSearchResults([]);
    setIsSearchingCustomer(false);
    setShowCreateCustomer(false);
  }, []);

  const handleClose = useCallback(() => {
    handleReset();
    onClose();
  }, [handleReset, onClose]);

  const handleSaveDraft = useCallback(async () => {
    const state = useCartStore.getState();
    const items = state.items;
    if (items.length === 0) {
      toastWarning('El carrito está vacío');
      return;
    }
    if (!state.customer) {
      toastWarning('Debe seleccionar un cliente para guardar');
      setShowCustomerSearch(true);
      return;
    }
    setIsProcessing(true);
    try {
      const tenantStoreId = useTenantStore.getState().storeId;
      const authStoreId = useAuthStore.getState().user?.store?.id ?? useAuthStore.getState().user?.main_store_id;
      const storeId = resolvePositiveId(tenantStoreId, authStoreId);
      if (!storeId) {
        toastError('La sesión no tiene una tienda activa');
        return;
      }

      const customer = state.customer;
      const summary = state.summary;
      const payload: CreatePosPaymentDto = {
        customer_id: Number(customer.id),
        customer_name: `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim(),
        customer_email: customer.email ?? undefined,
        customer_phone: customer.phone ?? undefined,
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
        internal_notes: state.notes || undefined,
        update_inventory: false,
        allow_oversell: true,
        print_receipt: false,
      };

      const response = await OrderService.processPosPayment(payload);
      if (!response.success) {
        toastError(response.message || 'Error al guardar');
        return;
      }

      state.clearCart();
      handleReset();
      onClose();
      toastSuccess('Guardado correctamente');
    } catch (err: any) {
      const data = err?.response?.data;
      const baseMsg = data?.message || err?.message || 'Error al guardar';
      const details = data?.details?.validationErrors;
      const fullMsg = details ? `${baseMsg}: ${details.join(', ')}` : baseMsg;
      toastError(fullMsg);
    } finally {
      setIsProcessing(false);
    }
  }, [handleReset, onClose]);

  const handleProcessPayment = useCallback(async () => {
    const state = useCartStore.getState();
    const items = state.items;
    if (items.length === 0) return;
    if (!selectedMethod) {
      toastWarning('Seleccione un método de pago');
      return;
    }
    if (!isAnonymous && !state.customer) {
      toastWarning('Seleccione un cliente o marque venta anónima');
      return;
    }
    if (needsCashInput && parsedCash < summary.total) {
      toastWarning('El monto recibido debe ser mayor o igual al total');
      return;
    }

    setIsProcessing(true);
    try {
      const tenantStoreId = useTenantStore.getState().storeId;
      const authStoreId = useAuthStore.getState().user?.store?.id ?? useAuthStore.getState().user?.main_store_id;
      const storeId = resolvePositiveId(tenantStoreId, authStoreId);
      if (!storeId) {
        toastError('La sesión no tiene una tienda activa');
        return;
      }

      const customer = state.customer;
      const summary = state.summary;
      const payload: CreatePosPaymentDto = {
        customer_id: isAnonymous ? undefined : (customer ? Number(customer.id) : undefined),
        customer_name: isAnonymous ? undefined : (customer ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || undefined : undefined),
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
        store_payment_method_id: selectedMethod.id,
        amount_received: needsCashInput ? parsedCash : undefined,
        payment_reference: needsReference ? reference.trim() || undefined : undefined,
        requires_payment: true,
        delivery_type: 'direct_delivery',
        update_inventory: true,
        allow_oversell: true,
        payment_form: paymentForm === 'contado' ? '1' : '2',
        internal_notes: state.notes || undefined,
        print_receipt: false,
      };

      const response = await OrderService.processPosPayment(payload);
      if (!response.success) {
        toastError(response.message || 'Error al procesar el pago');
        return;
      }

      const orderNum = response.order?.order_number || '';
      state.clearCart();
      handleReset();
      onClose();
      onSuccess(orderNum);
      toastSuccess(response.message || 'Pago procesado exitosamente');
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.message || 'Error al procesar el pago';
      toastError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedMethod, isAnonymous, needsCashInput, needsReference, parsedCash, summary.total, reference, paymentForm, handleReset, onClose, onSuccess]);

  const customerDisplayName = customer
    ? `${customer.first_name} ${customer.last_name || ''}`.trim()
    : '';

  if (!visible) return null;

  return (
    <View style={[styles.overlay, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Procesar Pago</Text>
          <Pressable onPress={handleClose} hitSlop={8} style={styles.headerCloseBtn}>
            <Icon name="x" size={24} color={colorScales.gray[500]} />
          </Pressable>
        </View>

        {/* Step indicator — UX: el usuario siempre sabe en qué paso está. */}
        <CheckoutStepIndicator currentStep="payment" />
        <View style={styles.stepDivider} />

        {/* Content - all sections stacked */}
        <ScrollView
          style={styles.scrollContent}
          contentContainerStyle={[styles.scrollInner, { paddingBottom: insets.bottom + 140 }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* === RESUMEN === */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIndicator} />
              <Text style={styles.sectionTitle}>Resumen</Text>
            </View>

              {/* Product list */}
              <View style={styles.productList}>
                {items.map((item) => (
                  <View key={item.id} style={styles.productRow}>
                    <View style={styles.productInfo}>
                      <Text style={styles.productName} numberOfLines={1}>
                        {item.product.name}
                      </Text>
                      {item.variant_display_name && (
                        <Text style={styles.productVariant}>{item.variant_display_name}</Text>
                      )}
                    </View>
                    <Text style={styles.productQty}>x{item.quantity}</Text>
                    <Text style={styles.productPrice}>{formatCurrency(item.totalPrice)}</Text>
                  </View>
                ))}
                {items.length === 0 && (
                  <Text style={styles.emptyText}>El carrito está vacío</Text>
                )}
              </View>

              {/* Summary */}
              <View style={styles.summaryBlock}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Productos</Text>
                  <Text style={styles.summaryValue}>{summary.itemCount}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Cantidad</Text>
                  <Text style={styles.summaryValue}>{summary.totalItems}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Subtotal</Text>
                  <Text style={styles.summaryValue}>{formatCurrency(summary.subtotal)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Impuestos</Text>
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
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total a Pagar</Text>
                  <Text style={styles.totalAmount}>{formatCurrency(summary.total)}</Text>
                </View>
            </View>
          </View>

          {/* === PAGO === */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIndicator} />
              <Text style={styles.sectionTitle}>Pago</Text>
            </View>

              {/* Forma de Pago */}
              <View style={styles.subSection}>
                <Text style={styles.subSectionLabel}>Forma de Pago</Text>
                <View style={styles.tabHeaders}>
                  <Pressable
                    style={[styles.tabBtn, paymentForm === 'contado' && styles.tabBtnActive]}
                    onPress={() => setPaymentForm('contado')}
                  >
                    <Icon name="zap" size={16} color={paymentForm === 'contado' ? '#FFFFFF' : colorScales.gray[600]} />
                    <Text style={[styles.tabBtnText, paymentForm === 'contado' && styles.tabBtnTextActive]}>
                      Contado
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.tabBtn, paymentForm === 'credito' && styles.tabBtnActive]}
                    onPress={() => setPaymentForm('credito')}
                  >
                    <Icon name="clock" size={16} color={paymentForm === 'credito' ? '#FFFFFF' : colorScales.gray[600]} />
                    <Text style={[styles.tabBtnText, paymentForm === 'credito' && styles.tabBtnTextActive]}>
                      Crédito
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Métodos de Pago */}
              {paymentForm === 'contado' && (
                <View style={styles.subSection}>
                  <Text style={styles.subSectionLabel}>Método de Pago</Text>
                  {methodsLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} style={styles.methodsLoader} />
                  ) : paymentMethods.length === 0 ? (
                    <Text style={styles.noMethodsText}>No hay métodos de pago disponibles</Text>
                  ) : (
                    <View style={styles.methodsGrid}>
                      {paymentMethods.map((method) => {
                        const type = getPaymentMethodType(method);
                        const isSelected = selectedMethod?.id === method.id;
                        return (
                          <Pressable
                            key={method.id}
                            style={[styles.methodBtn, isSelected && styles.methodBtnSelected]}
                            onPress={() => {
                              setSelectedMethod(method);
                              setCashReceived('');
                              setReference('');
                            }}
                          >
                            <Icon
                              name={getPaymentMethodIcon(type)}
                              size={20}
                              color={isSelected ? '#FFFFFF' : colors.primary}
                            />
                            <Text style={[styles.methodBtnText, isSelected && styles.methodBtnTextSelected]}>
                              {getPaymentMethodLabel(method)}
                            </Text>
                            {isSelected && (
                              <View style={styles.methodCheck}>
                                <Icon name="check" size={12} color="#FFFFFF" />
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              {/* Payment inputs */}
              {selectedMethod && paymentForm === 'contado' && (
                <View style={styles.subSection}>
                  {needsCashInput && (
                    <View style={styles.cashSection}>
                      <Text style={styles.subSectionLabel}>Efectivo recibido</Text>
                      <View style={styles.cashInputWrapper}>
                        <Text style={styles.cashCurrencySign}>$</Text>
                        <TextInput
                          style={styles.cashInput}
                          value={cashReceived}
                          onChangeText={(v) => setCashReceived(v.replace(/[^0-9.]/g, ''))}
                          placeholder="0.00"
                          placeholderTextColor={colorScales.gray[400]}
                          keyboardType="decimal-pad"
                        />
                      </View>
                      {parsedCash > 0 && (
                        <View style={styles.changeRow}>
                          <Text style={styles.changeLabel}>Cambio</Text>
                          <Text style={[styles.changeValue, change >= 0 ? { color: colorScales.green[600] } : { color: colors.error }]}>
                            {formatCurrency(Math.abs(change))}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                  {needsReference && (
                    <View>
                      <Text style={styles.subSectionLabel}>Referencia</Text>
                      <TextInput
                        style={styles.refInput}
                        value={reference}
                        onChangeText={setReference}
                        placeholder="Número de referencia"
                        placeholderTextColor={colorScales.gray[400]}
                      />
                    </View>
                  )}
                </View>
              )}

              {/* Crédito placeholder */}
              {paymentForm === 'credito' && (
                <View style={styles.creditPlaceholder}>
                  <Icon name="clock" size={24} color={colorScales.gray[300]} />
                  <Text style={styles.creditPlaceholderText}>Configuración de crédito próximamente</Text>
                </View>
              )}
            </View>

          {/* === CLIENTE === */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIndicator} />
              <Text style={styles.sectionTitle}>Cliente</Text>
            </View>

              {/* Anonymous sale */}
              <View style={styles.saleTypeOptions}>
                <Pressable
                  style={[styles.saleTypeBtn, isAnonymous && styles.saleTypeBtnSelected]}
                  onPress={() => { setIsAnonymous(true); setShowCustomerSearch(false); }}
                >
                  <View style={styles.radioIndicator}>
                    {isAnonymous && <View style={styles.radioDot} />}
                  </View>
                  <Icon name="user-x" size={20} color={isAnonymous ? colors.primary : colorScales.gray[600]} />
                  <View style={styles.saleTypeInfo}>
                    <Text style={styles.saleTypeName}>Venta Anónima</Text>
                    <Text style={styles.saleTypeDesc}>Sin cliente asociado</Text>
                  </View>
                </Pressable>

                <Pressable
                  style={[styles.saleTypeBtn, !isAnonymous && styles.saleTypeBtnSelected]}
                  onPress={() => setIsAnonymous(false)}
                >
                  <View style={styles.radioIndicator}>
                    {!isAnonymous && <View style={styles.radioDot} />}
                  </View>
                  <Icon name="user" size={20} color={!isAnonymous ? colors.primary : colorScales.gray[600]} />
                  <View style={styles.saleTypeInfo}>
                    <Text style={styles.saleTypeName}>Con Cliente</Text>
                    <Text style={styles.saleTypeDesc}>
                      {customer ? customerDisplayName : 'Seleccionar cliente'}
                    </Text>
                  </View>
                </Pressable>
              </View>

              {/* Selected customer display */}
              {!isAnonymous && customer && !showCustomerSearch && (
                <View style={styles.selectedCustomer}>
                  <View style={styles.customerAvatar}>
                    <Icon name="user-check" size={16} color={colorScales.green[700]} />
                  </View>
                  <View style={styles.customerInfo}>
                    <Text style={styles.customerName}>{customerDisplayName}</Text>
                    <Text style={styles.customerEmail}>{customer.email}</Text>
                  </View>
                  <Pressable
                    style={styles.changeCustomerBtn}
                    onPress={() => setShowCustomerModal(true)}
                  >
                    <Icon name="edit-2" size={14} color={colors.primary} />
                  </Pressable>
                </View>
              )}

              {/* Select customer / Search */}
              {!isAnonymous && (
                <>
                  {!customer && !showCustomerSearch && (
                    <Pressable
                      style={styles.selectCustomerBtn}
                      onPress={() => setShowCustomerModal(true)}
                    >
                      <Icon name="user-plus" size={18} color={colors.primary} />
                      <Text style={styles.selectCustomerText}>Buscar Cliente ...</Text>
                    </Pressable>
                  )}

                  {showCustomerSearch && (
                    <View style={styles.customerSearchContainer}>
                      <TextInput
                        style={styles.searchInput}
                        value={customerSearchQuery}
                        onChangeText={handleSearchCustomer}
                        placeholder="Buscar por nombre, email o documento..."
                        placeholderTextColor={colorScales.gray[400]}
                        autoFocus
                      />

                      {isSearchingCustomer && <ActivityIndicator size="small" color={colors.primary} />}

                      {customerSearchResults.length > 0 && (
                        <View style={styles.searchResults}>
                          {customerSearchResults.map((c) => (
                            <Pressable
                              key={c.id}
                              style={styles.customerResult}
                              onPress={() => handleSelectCustomer(c)}
                            >
                              <Icon name="user" size={16} color={colorScales.gray[500]} />
                              <View style={styles.customerResultInfo}>
                                <Text style={styles.customerResultName}>
                                  {c.first_name} {c.last_name || ''}
                                </Text>
                                <Text style={styles.customerResultDetail}>
                                  {c.email}{c.document_number ? ` · ${c.document_number}` : ''}
                                </Text>
                              </View>
                              <Icon name="chevron-right" size={16} color={colorScales.gray[300]} />
                            </Pressable>
                          ))}
                        </View>
                      )}

                      {customerSearchQuery.length >= 2 && customerSearchResults.length === 0 && !isSearchingCustomer && (
                        <View style={styles.noResults}>
                          <Text style={styles.noResultsText}>No se encontraron clientes</Text>
                          {!showCreateCustomer && (
                            <Pressable
                              style={styles.createNewBtn}
                              onPress={() => setShowCreateCustomer(true)}
                            >
                              <Icon name="plus" size={14} color="#FFFFFF" />
                              <Text style={styles.createNewBtnText}>Crear nuevo cliente</Text>
                            </Pressable>
                          )}
                        </View>
                      )}

                      {customerSearchQuery.length < 2 && !showCreateCustomer && (
                        <Pressable
                          style={styles.createNewBtn}
                          onPress={() => setShowCreateCustomer(true)}
                        >
                          <Icon name="plus" size={14} color="#FFFFFF" />
                          <Text style={styles.createNewBtnText}>Crear nuevo cliente</Text>
                        </Pressable>
                      )}

                      {/* Create customer inline form */}
                      {showCreateCustomer && (
                        <View style={styles.createForm}>
                          <TextInput
                            style={styles.createInput}
                            value={newCustomerForm.email}
                            onChangeText={(v) => setNewCustomerForm((prev) => ({ ...prev, email: v }))}
                            placeholder="Email *"
                            placeholderTextColor={colorScales.gray[400]}
                            keyboardType="email-address"
                            autoCapitalize="none"
                          />
                          <View style={styles.createRow}>
                            <TextInput
                              style={[styles.createInput, styles.createInputHalf]}
                              value={newCustomerForm.first_name}
                              onChangeText={(v) => setNewCustomerForm((prev) => ({ ...prev, first_name: v }))}
                              placeholder="Nombre *"
                              placeholderTextColor={colorScales.gray[400]}
                            />
                            <TextInput
                              style={[styles.createInput, styles.createInputHalf]}
                              value={newCustomerForm.last_name}
                              onChangeText={(v) => setNewCustomerForm((prev) => ({ ...prev, last_name: v }))}
                              placeholder="Apellido"
                              placeholderTextColor={colorScales.gray[400]}
                            />
                          </View>
                          <TextInput
                            style={styles.createInput}
                            value={newCustomerForm.phone}
                            onChangeText={(v) => setNewCustomerForm((prev) => ({ ...prev, phone: v }))}
                            placeholder="Teléfono"
                            placeholderTextColor={colorScales.gray[400]}
                            keyboardType="phone-pad"
                          />
                          <TextInput
                            style={styles.createInput}
                            value={newCustomerForm.document_number}
                            onChangeText={(v) => setNewCustomerForm((prev) => ({ ...prev, document_number: v }))}
                            placeholder="Número de documento"
                            placeholderTextColor={colorScales.gray[400]}
                          />
                          <View style={styles.createActions}>
                            <Pressable
                              style={styles.cancelCreateBtn}
                              onPress={() => setShowCreateCustomer(false)}
                            >
                              <Text style={styles.cancelCreateText}>Cancelar</Text>
                            </Pressable>
                            <Pressable
                              style={styles.confirmCreateBtn}
                              onPress={handleCreateCustomer}
                            >
                              <Icon name="check" size={14} color="#FFFFFF" />
                              <Text style={styles.confirmCreateText}>Crear Cliente</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}
            </View>
        </ScrollView>

        {/* Footer with 3 buttons */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[3] }]}>
          <View style={styles.footerRow}>
            <Pressable
              style={styles.cancelBtn}
              onPress={handleClose}
              disabled={isProcessing}
            >
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={styles.draftBtn}
              onPress={handleSaveDraft}
              disabled={isProcessing || items.length === 0}
            >
              <Icon name="save" size={16} color={isProcessing ? colorScales.gray[400] : colors.primary} />
              <Text style={[styles.draftBtnText, isProcessing && { color: colorScales.gray[400] }]}>Guardar</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.chargeBtn, (!canProcess || isProcessing) && styles.chargeBtnDisabled]}
            onPress={handleProcessPayment}
            disabled={!canProcess || isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Icon name="check-circle" size={20} color="#FFFFFF" />
            )}
            <Text style={styles.chargeBtnText}>
              {isProcessing ? 'Procesando...' : paymentForm === 'credito' ? 'Crear Venta a Crédito' : 'Cobrar'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <PosCustomerModal
        visible={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        onSelectCustomer={(c) => {
          if (c) {
            setCustomer(c);
            setIsAnonymous(false);
          }
          setShowCustomerModal(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    zIndex: 110,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerBackBtn: {
    width: 40,
    alignItems: 'center',
  },
  headerCloseBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  stepDivider: {
    height: 1,
    backgroundColor: colorScales.gray[100],
  },
  sectionTabs: {
    flexDirection: 'row',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    backgroundColor: colorScales.gray[50],
  },
  sectionTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  sectionTabActive: {
    backgroundColor: colorScales.green[50],
    borderColor: colors.primary,
  },
  sectionTabText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  sectionTabTextActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold as any,
  },
  scrollContent: {
    flex: 1,
  },
  scrollInner: {
    padding: spacing[4],
    gap: spacing[4],
  },
  section: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    backgroundColor: colorScales.gray[50],
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
  productInfo: {
    flex: 1,
    marginRight: spacing[2],
  },
  productName: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[800],
  },
  productVariant: {
    fontSize: 11,
    fontFamily: typography.fontFamily,
    color: colors.primary,
    marginTop: 1,
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
    paddingVertical: spacing[4],
  },
  summaryBlock: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    gap: spacing[1],
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
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  totalLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  totalAmount: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  subSection: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  subSectionLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    marginBottom: spacing[2],
  },
  tabHeaders: {
    flexDirection: 'row',
    gap: spacing[2],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[100],
  },
  tabBtnActive: {
    backgroundColor: colors.primary,
  },
  tabBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[600],
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
  },
  methodsLoader: {
    paddingVertical: spacing[4],
  },
  noMethodsText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    textAlign: 'center',
    paddingVertical: spacing[4],
  },
  methodsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  methodBtn: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
    position: 'relative',
  },
  methodBtnSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  methodBtnText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[700],
    flex: 1,
  },
  methodBtnTextSelected: {
    color: '#FFFFFF',
  },
  methodCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  cashSection: {
    gap: spacing[2],
  },
  cashInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background,
  },
  cashCurrencySign: {
    paddingLeft: spacing[3],
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  cashInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: spacing[2],
    fontSize: typography.fontSize.lg,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  changeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
  },
  changeLabel: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[600],
  },
  changeValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
  },
  refInput: {
    height: 44,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
  },
  creditPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[8],
    gap: spacing[2],
  },
  creditPlaceholderText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
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
    borderWidth: 1,
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
  saleTypeInfo: {
    flex: 1,
  },
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
  customerInfo: {
    flex: 1,
  },
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
  customerSearchContainer: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[2],
  },
  searchInput: {
    height: 44,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
  },
  searchResults: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    maxHeight: 200,
  },
  customerResult: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  customerResultInfo: {
    flex: 1,
  },
  customerResultName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[800],
  },
  customerResultDetail: {
    fontSize: 11,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 1,
  },
  noResults: {
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  noResultsText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
  },
  createNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
  },
  createNewBtnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  createForm: {
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  createInput: {
    height: 44,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
  },
  createRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  createInputHalf: {
    flex: 1,
  },
  createActions: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[1],
  },
  cancelCreateBtn: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
  },
  cancelCreateText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[600],
  },
  confirmCreateBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
  },
  confirmCreateText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    gap: spacing[2],
    backgroundColor: colors.background,
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing[3],
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
  draftBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  draftBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  chargeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  chargeBtnDisabled: {
    opacity: 0.5,
  },
  chargeBtnText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});
