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
import { useCartStore, getLineSubtotal } from '@/features/store/pos/store/cart.store';
import { useAuthStore } from '@/core/store/auth.store';
import { useTenantStore } from '@/core/store/tenant.store';
import { toastSuccess, toastError, toastWarning } from '@/shared/components/toast/toast.store';
import { formatSaleQuantity } from '@/features/store/pricing';
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
  // CP-POS-CREAR-EDITAR-COBRAR-001 — la política canónica
  // `settings.checkout.require_customer_data=true` rechaza ventas POS sin
  // cliente (`POS_CUSTOMER_REQUIRED_001`). Eliminamos la rama anónima del
  // payment modal: el cliente es obligatorio.
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

  const { data: paymentMethods = [], isLoading: methodsLoading } = useQuery({
    queryKey: ['pos-payment-methods'],
    queryFn: () => OrderService.getPaymentMethods(),
    enabled: visible,
  });

  // CP-POS-CREAR-EDITAR-COBRAR-001 — el CTA se bloquea cuando:
  //   1. Carrito vacío.
  //   2. Falta cliente (regla backend `POS_CUSTOMER_REQUIRED_001`).
  //   3. No hay método de pago seleccionado.
  //   4. paymentForm === 'credito' pero el método seleccionado NO es crédito.
  //   5. El catálogo de métodos directos (contado) está vacío — sin
  //      métodos no se puede cobrar nada.
  //   6. Procesamiento en curso.
  const directMethods = (paymentMethods || []).filter(
    (m) => getPaymentMethodType(m) !== 'credit',
  );
  const creditMethods = (paymentMethods || []).filter(
    (m) => getPaymentMethodType(m) === 'credit',
  );
  const selectedMethodType = selectedMethod ? getPaymentMethodType(selectedMethod) : '';
  const isCreditMode = paymentForm === 'credito';
  const creditMethodMissing =
    isCreditMode && selectedMethodType !== 'credit';
  const noDirectMethods = directMethods.length === 0;
  const noMethodsAtAll = (paymentMethods || []).length === 0;
  const canProcess =
    items.length > 0 &&
    !!customer &&
    !isProcessing &&
    !!selectedMethod &&
    !noDirectMethods &&
    !creditMethodMissing;

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
          // `unit_price` es el precio PUBLICADO (por `price_unit_quantity`
          // unidades de stock, o por paquete si la linea lleva presentacion).
          // El total lo resuelve `getLineSubtotal`, que aplica la escala y
          // redondea una sola vez al final: 2.500 mm de un cable a $5.000/m
          // son $12.500, no $12.500.000 ni $25.000.
          unit_price: Number(i.unitPrice.toFixed(2)),
          total_price: Number(getLineSubtotal(i).toFixed(2)),
          tax_amount_item: Number(i.taxAmount.toFixed(2)),
          cost: i.variant?.cost_price ?? i.product.cost_price ?? undefined,
          // El backend re-resuelve `stock_units_consumed` desde la tarifa; el
          // cliente solo declara CUAL presentacion aplico.
          applied_price_tier_id: i.appliedPriceTierId ?? undefined,
        })),
        subtotal: Number(summary.subtotal.toFixed(2)),
        tax_amount: Number(summary.taxAmount.toFixed(2)),
        discount_amount: Number(summary.discountAmount.toFixed(2)),
        total_amount: Number(summary.total.toFixed(2)),
        // CP-POS-CREAR-EDITAR-COBRAR-001 fase B.2 — Guardar es SIEMPRE un
        // draft sin pago. Backend valida `is_draft=true ∧ requires_payment=false`
        // y rechaza combinaciones inválidas con `POS_DRAFT_REQUIRES_PAYMENT_001`.
        is_draft: true,
        requires_payment: false,
        delivery_type: 'direct_delivery',
        internal_notes: state.notes || undefined,
        update_inventory: false,
        // NOTA: `allow_oversell` ya NO se manda. El backend lo ignora para
        // borradores y para cobros sin stock el rechazo viene por
        // `POS_STOCK_INSUFFICIENT_001`. Enviar `true` aquí era solo
        // client-intent misleading — el server es la fuente de verdad.
        // Coupon attachment — el cart store mobile todavía NO trackea cupones
        // (ver `cart.store.ts`), así que ambos campos quedan undefined. Se
        // incluyen en el payload para mantener paridad con el DTO y permitir
        // adopción futura sin tocar el call site.
        coupon_id: undefined,
        coupon_code: undefined,
        print_receipt: false,
      };

      const response = await OrderService.processPosPayment(payload);
      if (!response.success) {
        toastError(response.message || 'Error al guardar');
        return;
      }

      // CP-POS-CREAR-EDITAR-COBRAR-001 — el éxito del POST NO basta para
      // vaciar el carrito: hay que esperar a que la respuesta marque
      // `success: true` y el estado del cart reflejar la confirmación.
      // `clearCart()` se mueve al `finally` para garantizar que aunque
      // `onSuccess`/`onClose` cancele, el carrito queda en estado inicial.
      state.clearCart();
      handleReset();
      onClose();
      toastSuccess('Guardado correctamente');
    } catch (err: any) {
      const data = err?.response?.data;
      const errorCode = data?.error_code || data?.code;
      const requestId = data?.request_id || err?.response?.headers?.['x-request-id'];
      const baseMsg = data?.message || err?.message || 'Error al guardar';
      const details = data?.details?.validationErrors;
      const fullMsg = details ? `${baseMsg}: ${details.join(', ')}` : baseMsg;
      const codeSuffix = errorCode ? ` (${errorCode})` : '';
      const requestSuffix = requestId ? ` [req=${requestId}]` : '';
      // Log estructurado para correlacionar el toast del operador con el log
      // del backend (AllExceptionsFilter guarda el mismo `request_id`).
      // No leak de PII: solo IDs y códigos de error.
      // Re-leemos los stores aquí porque `storeId`/`customer` están en scope
      // del `try` y TypeScript no los ve en `catch`.
      // eslint-disable-next-line no-console
      console.error('[pos][payment-modal][saveDraft] failed', {
        store_id: useTenantStore.getState().storeId ?? useAuthStore.getState().user?.store?.id ?? useAuthStore.getState().user?.main_store_id,
        customer_id: state.customer ? Number(state.customer.id) : undefined,
        request_id: requestId,
        error_code: errorCode,
        status: err?.response?.status,
      });
      toastError(`${fullMsg}${codeSuffix}${requestSuffix}`);
    } finally {
      // Garantiza reset del spinner aunque el handler retorne antes. NO
      // vaciamos el carrito acá: `clearCart()` ya se ejecutó en el
      // happy-path y NO debe ejecutarse si la respuesta fue de error
      // (porque perderíamos el carrito y el cajero no podría reintentar).
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
    // CP-POS-CREAR-EDITAR-COBRAR-001 — el backend rechaza pagos POS sin
    // cliente (`POS_CUSTOMER_REQUIRED_001`). Bloqueamos aquí también para
    // no enviar un request inválido y mapear el error tipado.
    if (!state.customer || !Number.isFinite(Number(state.customer.id)) || Number(state.customer.id) <= 0) {
      toastError(
        'Selecciona o crea un cliente antes de cobrar. (POS_CUSTOMER_REQUIRED_001)',
      );
      setShowCustomerModal(true);
      return;
    }
    // CP-POS-CREAR-EDITAR-COBRAR-001 — bloqueos por método de pago.
    // - Sin catálogo: la query aún no resolvió → reintentar.
    // - Modo contado sin métodos directos: el catálogo solo trae créditos.
    // - Modo crédito sin método de crédito: el catálogo no tiene crédito.
    if (noMethodsAtAll) {
      toastError('Sin métodos de pago — no se puede cobrar. (POS_DIRECT_METHOD_MISSING_001)');
      return;
    }
    if (paymentForm === 'contado' && noDirectMethods) {
      toastError('No hay métodos de contado configurados. (POS_DIRECT_METHOD_MISSING_001)');
      return;
    }
    if (paymentForm === 'credito' && creditMethodMissing) {
      toastError('Selecciona un método de crédito antes de cobrar. (POS_CREDIT_METHOD_MISSING_001)');
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

      const customer = state.customer!;
      const summary = state.summary;
      // CP-POS-CREAR-EDITAR-COBRAR-001 — Cupón adjunto. El cart store mobile
      // todavía NO trackea cupones en el cliente (paridad con `cart.store.ts`),
      // pero el DTO ya los acepta: si en el futuro el POS mobile adopta
      // cupones, este call site está listo para recibirlos sin cambiar la
      // firma. Por ahora ambos campos quedan `undefined` y el backend trata
      // la orden como sin cupón.
      const couponId = undefined;
      const couponCode = undefined;
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
          // `unit_price` es el precio PUBLICADO (por `price_unit_quantity`
          // unidades de stock, o por paquete si la linea lleva presentacion).
          // El total lo resuelve `getLineSubtotal`, que aplica la escala y
          // redondea una sola vez al final: 2.500 mm de un cable a $5.000/m
          // son $12.500, no $12.500.000 ni $25.000.
          unit_price: Number(i.unitPrice.toFixed(2)),
          total_price: Number(getLineSubtotal(i).toFixed(2)),
          tax_amount_item: Number(i.taxAmount.toFixed(2)),
          cost: i.variant?.cost_price ?? i.product.cost_price ?? undefined,
          // El backend re-resuelve `stock_units_consumed` desde la tarifa; el
          // cliente solo declara CUAL presentacion aplico.
          applied_price_tier_id: i.appliedPriceTierId ?? undefined,
        })),
        subtotal: Number(summary.subtotal.toFixed(2)),
        tax_amount: Number(summary.taxAmount.toFixed(2)),
        discount_amount: Number(summary.discountAmount.toFixed(2)),
        total_amount: Number(summary.total.toFixed(2)),
        store_payment_method_id: selectedMethod.id,
        amount_received: needsCashInput ? parsedCash : undefined,
        payment_reference: needsReference ? reference.trim() || undefined : undefined,
        // CP-POS-CREAR-EDITAR-COBRAR-001 — el cobro es siempre
        // `is_draft=false, requires_payment=true`. El draft pertenece a
        // "Guardar"; el cobro va por `flow/pay`.
        is_draft: false,
        requires_payment: true,
        delivery_type: 'direct_delivery',
        update_inventory: true,
        // NOTA: `allow_oversell` ya NO se manda. El backend lo ignora y el
        // rechazo de stock insuficiente viene por `POS_STOCK_INSUFFICIENT_001`.
        // Enviar `true` aquí era solo client-intent misleading.
        payment_form: paymentForm === 'contado' ? '1' : '2',
        internal_notes: state.notes || undefined,
        // Coupon attachment — campos aceptados por el DTO backend. Se
        // mantienen como `undefined` porque el cart store mobile aún no
        // los captura (paridad con editor backend, ver `cart.store.ts`).
        coupon_id: couponId,
        coupon_code: couponCode,
        print_receipt: false,
      };

      const response = await OrderService.processPosPayment(payload);
      if (!response.success) {
        toastError(response.message || 'Error al procesar el pago');
        return;
      }

      const orderNum = response.order?.order_number || '';
      // CP-POS-CREAR-EDITAR-COBRAR-001 — emptyCart se mantiene en la rama
      // happy-path. La versión canónica mueve el cleanup al `finally`,
      // pero acá necesitamos que `onSuccess` se dispare con `orderNum`
      // ANTES de resetear el estado (el padre abre el modal de éxito
      // con el número). El `finally` solo suelta el spinner.
      state.clearCart();
      handleReset();
      onClose();
      onSuccess(orderNum);
      toastSuccess(response.message || 'Pago procesado exitosamente');
    } catch (err: any) {
      const data = err?.response?.data;
      // Backend `AllExceptionsFilter` preserva `error_code` — lo mostramos
      // verbatim para que el operador sepa qué falló y el soporte tenga
      // // referencia directa en logs.
      const errorCode = data?.error_code || data?.code;
      const requestId = data?.request_id || err?.response?.headers?.['x-request-id'];
      const baseMsg = data?.message || err?.message || 'Error al procesar el pago';
      const codeSuffix = errorCode ? ` (${errorCode})` : '';
      const requestSuffix = requestId ? ` [req=${requestId}]` : '';
      // Log estructurado para correlacionar el toast del operador con el log
      // del backend (AllExceptionsFilter guarda el mismo `request_id`).
      // No leak de PII: solo IDs y códigos de error.
      // Re-leemos los stores aquí porque `storeId`/`customer` están en scope
      // del `try` y TypeScript no los ve en `catch`.
      // eslint-disable-next-line no-console
      console.error('[pos][payment-modal][processPayment] failed', {
        store_id: useTenantStore.getState().storeId ?? useAuthStore.getState().user?.store?.id ?? useAuthStore.getState().user?.main_store_id,
        customer_id: state.customer ? Number(state.customer.id) : undefined,
        payment_method_id: selectedMethod?.id,
        request_id: requestId,
        error_code: errorCode,
        status: err?.response?.status,
      });
      toastError(`${baseMsg}${codeSuffix}${requestSuffix}`);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedMethod, needsCashInput, needsReference, parsedCash, summary.total, reference, paymentForm, handleReset, onClose, onSuccess]);

  const customerDisplayName = customer
    ? `${customer.first_name} ${customer.last_name || ''}`.trim()
    : '';

  if (!visible) return null;

  return (
    <View
      style={[styles.overlay, { paddingTop: insets.top }]}
      accessibilityViewIsModal
      accessibilityLiveRegion="polite"
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Procesar Pago</Text>
          <Pressable
            onPress={handleClose}
            hitSlop={8}
            style={styles.headerCloseBtn}
            accessibilityRole="button"
            accessibilityLabel="Cerrar modal de pago"
          >
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
                    {/* QUI-648 — la misma escala que muestra el carrito: si
                        el cajero capturó "3 m", el resumen de cobro no puede
                        decir "x3000". */}
                    <Text style={styles.productQty}>x{formatSaleQuantity(item)}</Text>
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
                <View
                  style={styles.tabHeaders}
                  accessibilityRole="tablist"
                >
                  <Pressable
                    style={[styles.tabBtn, paymentForm === 'contado' && styles.tabBtnActive]}
                    onPress={() => setPaymentForm('contado')}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: paymentForm === 'contado' }}
                    accessibilityLabel="Pago de contado"
                  >
                    <Icon name="zap" size={16} color={paymentForm === 'contado' ? '#FFFFFF' : colorScales.gray[600]} />
                    <Text style={[styles.tabBtnText, paymentForm === 'contado' && styles.tabBtnTextActive]}>
                      Contado
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.tabBtn, paymentForm === 'credito' && styles.tabBtnActive]}
                    onPress={() => setPaymentForm('credito')}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: paymentForm === 'credito' }}
                    accessibilityLabel="Pago a crédito"
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
                  ) : noMethodsAtAll ? (
                    <View style={styles.creditPlaceholder}>
                      <Icon name="alert-circle" size={24} color={colorScales.gray[300]} />
                      <Text style={styles.creditErrorText}>
                        Sin métodos de pago — no se puede cobrar
                      </Text>
                      <Pressable
                        style={styles.createNewBtn}
                        onPress={() => {
                          // Re-fetch methods (retry CTA). Re-uses the same
                          // query key — TanStack Query will refetch.
                          setSelectedMethod(null);
                          // Force re-mount of the query by incrementing a
                          // dummy counter (handled by the query's enabled
                          // state). The simplest UX is to dismiss and let
                          // the user manually re-open.
                          toastWarning('Reabre el modal para reintentar');
                        }}
                      >
                        <Icon name="refresh-cw" size={14} color="#FFFFFF" />
                        <Text style={styles.createNewBtnText}>Reintentar</Text>
                      </Pressable>
                    </View>
                  ) : noDirectMethods ? (
                    <View style={styles.creditPlaceholder}>
                      <Icon name="alert-circle" size={24} color={colorScales.gray[300]} />
                      <Text style={styles.creditErrorText}>
                        No hay métodos de contado configurados. (POS_DIRECT_METHOD_MISSING_001)
                      </Text>
                      <Text style={styles.creditPlaceholderText}>
                        Configura un método de pago de contado en Ajustes o usa la
                        pestaña Crédito.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.methodsGrid}>
                      {directMethods.map((method) => {
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
                <View style={styles.subSection}>
                  <Text style={styles.subSectionLabel}>Método de crédito</Text>
                  {creditMethods.length === 0 ? (
                    <View style={styles.creditPlaceholder}>
                      <Icon name="clock" size={24} color={colorScales.gray[300]} />
                      <Text style={styles.creditPlaceholderText}>
                        No hay métodos de crédito configurados
                      </Text>
                      <Text style={styles.creditErrorText}>
                        Configura al menos un método de tipo crédito en Ajustes ·
                        Pagos para habilitar la venta a crédito. (POS_CREDIT_METHOD_MISSING_001)
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.methodsGrid}>
                      {creditMethods.map((method) => {
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
                              name={getPaymentMethodIcon('credit')}
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
                  {!creditMethodMissing && creditMethods.length > 0 && (
                    <View style={styles.creditPlaceholder}>
                      <Icon name="clock" size={24} color={colorScales.gray[300]} />
                      <Text style={styles.creditPlaceholderText}>
                        Configuración de crédito próximamente
                      </Text>
                    </View>
                  )}
                  {creditMethodMissing && (
                    <Text style={styles.creditErrorText}>
                      Selecciona un método de crédito antes de continuar.
                      (POS_CREDIT_METHOD_MISSING_001)
                    </Text>
                  )}
                </View>
              )}
            </View>

          {/* === CLIENTE === */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIndicator} />
              <Text style={styles.sectionTitle}>Cliente</Text>
            </View>

              {/* CP-POS-CREAR-EDITAR-COBRAR-001 — el cliente es OBLIGATORIO.
                  Ya no existe la rama "Venta Anónima" porque el backend
                  rechaza el cobro (`POS_CUSTOMER_REQUIRED_001`). */}
              <View style={styles.saleTypeOptions}>
                <Pressable
                  style={[styles.saleTypeBtn, styles.saleTypeBtnSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: true }}
                  accessibilityLabel="Cliente obligatorio para cobrar"
                >
                  <View style={styles.radioIndicator}>
                    <View style={styles.radioDot} />
                  </View>
                  <Icon name="user" size={20} color={colors.primary} />
                  <View style={styles.saleTypeInfo}>
                    <Text style={styles.saleTypeName}>Cliente obligatorio</Text>
                    <Text style={styles.saleTypeDesc}>
                      {customer ? customerDisplayName : 'Seleccionar cliente'}
                    </Text>
                  </View>
                </Pressable>
              </View>

              {/* Selected customer display */}
              {customer && !showCustomerSearch && (
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
                              accessibilityRole="button"
                              accessibilityLabel={`Seleccionar cliente ${c.first_name} ${c.last_name ?? ''}`.trim()}
                              accessibilityHint="Asigna este cliente a la venta actual"
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
            </View>
        </ScrollView>

        {/* Footer with 3 buttons — accessibility: type=button + busy state + ARIA. */}
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[3] }]}>
          <View style={styles.footerRow}>
            <Pressable
              style={styles.cancelBtn}
              onPress={handleClose}
              disabled={isProcessing}
              accessibilityRole="button"
              accessibilityLabel="Cancelar cobro"
              accessibilityState={{ busy: isProcessing }}
            >
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={styles.draftBtn}
              onPress={handleSaveDraft}
              disabled={isProcessing || items.length === 0 || !customer}
              accessibilityRole="button"
              accessibilityLabel="Guardar orden sin cobrar"
              accessibilityHint="Crea una orden en borrador sin procesar pago"
              accessibilityState={{ busy: isProcessing, disabled: isProcessing || items.length === 0 || !customer }}
            >
              <Icon name="save" size={16} color={isProcessing ? colorScales.gray[400] : colors.primary} />
              <Text style={[styles.draftBtnText, isProcessing && { color: colorScales.gray[400] }]}>Guardar orden (no cobra)</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.chargeBtn, (!canProcess || isProcessing) && styles.chargeBtnDisabled]}
            onPress={handleProcessPayment}
            disabled={!canProcess || isProcessing}
            accessibilityRole="button"
            accessibilityLabel={
              noMethodsAtAll
                ? 'Sin métodos de pago — no se puede cobrar'
                : noDirectMethods
                  ? 'Sin métodos de contado — no se puede cobrar'
                  : creditMethodMissing
                    ? 'Selecciona un método de crédito para continuar'
                    : paymentForm === 'credito'
                      ? 'Crear venta a crédito'
                      : 'Cobrar orden'
            }
            accessibilityState={{ busy: isProcessing, disabled: !canProcess || isProcessing }}
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
  // CP-POS-CREAR-EDITAR-COBRAR-001 — error tipado para métodos faltantes
  // (sin métodos / sin crédito con paymentForm='credito'). El cajero
  // necesita ver el código para diagnosticarlo con soporte.
  creditErrorText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colors.error,
    textAlign: 'center',
    paddingTop: spacing[2],
    paddingHorizontal: spacing[2],
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
