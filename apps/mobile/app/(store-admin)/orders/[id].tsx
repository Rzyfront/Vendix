import { useState, type ReactNode } from 'react';
import {
  Image,
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OrderService } from '@/features/store/services/order.service';
import { apiClient, Endpoints } from '@/core/api';
import {
  Order,
  ORDER_STATE_LABELS,
  ORDER_STATE_COLORS,
  ShipOrderDto,
  RefundOrderDto,
  OrderTimelineEntry,
  OrderAddress,
  OrderInstallment,
  OrderItem,
  Payment,
} from '@/features/store/types';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Modal } from '@/shared/components/modal/modal';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { formatDateTime, formatRelative } from '@/shared/utils/date';
import { spacing, borderRadius, colorScales, colors } from '@/shared/theme';

const STATE_VARIANT_MAP: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  default: 'default',
  warning: 'warning',
  success: 'success',
  error: 'error',
  info: 'info',
};

const CHANNEL_LABELS: Record<string, string> = {
  pos: 'POS',
  ecommerce: 'E-commerce',
  agent: 'Agente',
  whatsapp: 'WhatsApp',
  marketplace: 'Marketplace',
};

const DELIVERY_TYPE_LABELS: Record<string, string> = {
  pickup: 'Recoger en tienda',
  home_delivery: 'Domicilio',
  direct_delivery: 'Entrega directa',
  other: 'Otra entrega',
};

const PAYMENT_FORM_LABELS: Record<string, string> = {
  '1': 'Contado',
  '2': 'Crédito',
};

const CREDIT_TYPE_LABELS: Record<string, string> = {
  free: 'Crédito libre',
  installments: 'Crédito por cuotas',
};

const PAYMENT_STATE_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  succeeded: 'Aprobado',
  failed: 'Fallido',
  authorized: 'Autorizado',
  captured: 'Capturado',
  refunded: 'Reembolsado',
  partially_refunded: 'Reembolso parcial',
  cancelled: 'Cancelado',
};

const INSTALLMENT_STATE_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  paid: 'Pagada',
  partial: 'Parcial',
  overdue: 'Vencida',
  forgiven: 'Condonada',
};

const DATE_ONLY_FORMATTER = new Intl.DateTimeFormat('es-CO', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

function normalizeCurrency(currency?: string | null): 'COP' | 'USD' {
  return currency === 'USD' ? 'USD' : 'COP';
}

function money(value: unknown, currency?: string | null): string {
  return formatCurrency(Number(value) || 0, normalizeCurrency(currency));
}

function moneyOptional(value: unknown, currency?: string | null): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return money(value, currency);
}

function optionalText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text.length > 0 ? text : undefined;
}

function formatMaybeDate(value?: string | null): string | undefined {
  return value ? formatDateTime(value) : undefined;
}

function formatDateOnly(value?: string | null): string | undefined {
  if (!value) return undefined;
  const dateOnly = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    const [year, month, day] = dateOnly.split('-').map(Number);
    return DATE_ONLY_FORMATTER.format(new Date(Date.UTC(year, month - 1, day)));
  }
  return formatDateTime(value);
}

function formatPercent(value?: number | string | null): string | undefined {
  if (value === null || value === undefined) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return `${percent.toFixed(percent % 1 === 0 ? 0 : 2)}%`;
}

function parseVariantAttributes(value?: string | Record<string, unknown> | null) {
  if (!value) return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [{ label: 'Variante', value }];
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>)
    .map(([label, attrValue]) => ({
      label,
      value: optionalText(attrValue),
    }))
    .filter((attr): attr is { label: string; value: string } => Boolean(attr.value));
}

function snapshotValue(snapshot: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!snapshot) return undefined;
  for (const key of keys) {
    const value = optionalText(snapshot[key]);
    if (value) return value;
  }
  return undefined;
}

function getAddressLines(
  address?: OrderAddress | null,
  snapshot?: Record<string, unknown> | null,
) {
  const line1 = address?.address_line1 || snapshotValue(snapshot, ['address_line1', 'line1', 'street']);
  const line2 = address?.address_line2 || snapshotValue(snapshot, ['address_line2', 'line2', 'details']);
  const city = address?.city || snapshotValue(snapshot, ['city']);
  const state = address?.state_province || snapshotValue(snapshot, ['state_province', 'state', 'department']);
  const postal = address?.postal_code || snapshotValue(snapshot, ['postal_code', 'zip']);
  const country = address?.country_code || snapshotValue(snapshot, ['country_code', 'country']);
  const phone = address?.phone_number || snapshotValue(snapshot, ['phone_number', 'phone']);
  return {
    main: [line1, line2].filter(Boolean).join(', '),
    location: [city, state, postal, country].filter(Boolean).join(', '),
    phone,
  };
}

function getGatewayString(payment: Payment, keys: string[]) {
  const response = payment.gateway_response;
  if (!response || typeof response !== 'object') return undefined;
  for (const key of keys) {
    const direct = optionalText(response[key]);
    if (direct) return direct;
  }
  const metadata = response.metadata;
  if (metadata && typeof metadata === 'object') {
    for (const key of keys) {
      const value = optionalText((metadata as Record<string, unknown>)[key]);
      if (value) return value;
    }
  }
  return undefined;
}

function getGatewayNumber(payment: Payment, keys: string[]) {
  const value = getGatewayString(payment, keys);
  if (!value) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function paymentVariant(state?: string | null): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (state === 'succeeded' || state === 'captured' || state === 'authorized') return 'success';
  if (state === 'pending') return 'warning';
  if (state === 'failed' || state === 'cancelled') return 'error';
  if (state === 'refunded' || state === 'partially_refunded') return 'info';
  return 'default';
}

function installmentVariant(state?: string | null): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (state === 'paid') return 'success';
  if (state === 'partial') return 'info';
  if (state === 'overdue') return 'error';
  if (state === 'pending') return 'warning';
  return 'default';
}

function SectionCard({
  title,
  subtitle,
  icon,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card style={styles.cardMargin}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          {icon && (
            <View style={styles.sectionIcon}>
              <Icon name={icon} size={16} color={colors.primary} />
            </View>
          )}
          <View style={styles.flex1}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
          </View>
        </View>
        {right}
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </Card>
  );
}

function DetailRow({
  label,
  value,
  mono,
  strong,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
  strong?: boolean;
}) {
  const display = optionalText(value) ?? 'No registrado';
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text
        style={[
          styles.detailValue,
          mono ? styles.monoText : undefined,
          strong ? styles.strongValue : undefined,
        ]}
      >
        {display}
      </Text>
    </View>
  );
}

function EmptyDetail({ text }: { text: string }) {
  return (
    <View style={styles.emptyDetail}>
      <Text style={styles.emptyDetailText}>{text}</Text>
    </View>
  );
}

function AddressBlock({
  title,
  address,
  snapshot,
}: {
  title: string;
  address?: OrderAddress | null;
  snapshot?: Record<string, unknown> | null;
}) {
  const lines = getAddressLines(address, snapshot);
  const hasAddress = Boolean(lines.main || lines.location || lines.phone);

  return (
    <View style={styles.addressBox}>
      <Text style={styles.addressTitle}>{title}</Text>
      {hasAddress ? (
        <View style={styles.detailGroup}>
          {lines.main && <Text style={styles.addressMain}>{lines.main}</Text>}
          {lines.location && <Text style={styles.addressMeta}>{lines.location}</Text>}
          {lines.phone && <Text style={styles.addressMeta}>{lines.phone}</Text>}
        </View>
      ) : (
        <Text style={styles.emptyDetailText}>No registrada</Text>
      )}
    </View>
  );
}

function OrderItemDetail({
  item,
  currency,
}: {
  item: OrderItem;
  currency?: string | null;
}) {
  const product = item.products ?? item.product;
  const variant = item.product_variants ?? item.product_variant;
  const imageUrl = product?.image_url || product?.product_images?.[0]?.image_url;
  const attributes = parseVariantAttributes(item.variant_attributes ?? variant?.attributes);

  return (
    <View style={styles.productItem}>
      <View style={styles.productTopRow}>
        <View style={styles.productImageBox}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.productImage} resizeMode="cover" />
          ) : (
            <Icon name="package" size={22} color={colorScales.gray[300]} />
          )}
        </View>
        <View style={styles.productInfo}>
          <Text style={styles.productName} numberOfLines={2}>
            {item.product_name}
          </Text>
          <View style={styles.productMetaRow}>
            <Text style={styles.productMetaText}>
              {item.quantity} x {money(item.unit_price, currency)}
            </Text>
            {(item.variant_sku || variant?.sku || product?.sku) && (
              <Text style={styles.productSku} numberOfLines={1}>
                SKU {item.variant_sku || variant?.sku || product?.sku}
              </Text>
            )}
          </View>
        </View>
        <Text style={styles.productTotal}>{money(item.total_price, currency)}</Text>
      </View>

      {attributes.length > 0 && (
        <View style={styles.attributeWrap}>
          {attributes.map((attr) => (
            <View key={`${item.id}-${attr.label}-${attr.value}`} style={styles.attributeChip}>
              <Text style={styles.attributeText}>
                {attr.label}: {attr.value}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.inlineDetails}>
        <DetailRow label="Producto ID" value={item.product_id} mono />
        <DetailRow label="Variante ID" value={item.product_variant_id} mono />
        <DetailRow label="Variante" value={variant?.name} />
        <DetailRow label="Tipo" value={item.item_type} />
        <DetailRow label="Impuesto" value={moneyOptional(item.tax_amount_item, currency)} />
        <DetailRow label="Tasa IVA" value={formatPercent(item.tax_rate)} />
        <DetailRow label="Costo" value={moneyOptional(item.cost_price, currency)} />
        <DetailRow
          label="Peso"
          value={item.weight ? `${item.weight}${item.weight_unit ? ` ${item.weight_unit}` : ''}` : undefined}
        />
        <DetailRow label="Creado" value={formatMaybeDate(item.created_at)} />
        <DetailRow label="Actualizado" value={formatMaybeDate(item.updated_at)} />
      </View>
    </View>
  );
}

function PaymentDetail({
  payment,
  currency,
}: {
  payment: Payment;
  currency?: string | null;
}) {
  const method = payment.store_payment_method;
  const systemMethod = method?.system_payment_method;
  const amountReceived = getGatewayNumber(payment, ['amount_received']);
  const change = getGatewayNumber(payment, ['change']);
  const reference = payment.gateway_reference || getGatewayString(payment, ['payment_reference', 'reference']);
  const registerId = getGatewayString(payment, ['register_id']);
  const sellerId = getGatewayString(payment, ['seller_user_id']);

  return (
    <View style={styles.paymentCard}>
      <View style={styles.paymentHeader}>
        <View style={styles.flex1}>
          <Text style={styles.paymentTitle}>
            {method?.display_name || systemMethod?.display_name || systemMethod?.name || 'Pago'}
          </Text>
          <Text style={styles.paymentSubtitle}>
            {formatMaybeDate(payment.paid_at) || formatMaybeDate(payment.created_at) || 'Sin fecha'}
          </Text>
        </View>
        <View style={styles.paymentAmountBox}>
          <Text style={styles.paymentAmount}>{money(payment.amount, payment.currency || currency)}</Text>
          <Badge
            label={PAYMENT_STATE_LABELS[payment.state] ?? payment.state}
            variant={paymentVariant(payment.state)}
            size="sm"
          />
        </View>
      </View>
      <View style={styles.inlineDetails}>
        <DetailRow label="Pago ID" value={payment.id} mono />
        <DetailRow label="Método ID" value={payment.store_payment_method_id} mono />
        <DetailRow label="Tipo método" value={systemMethod?.type} />
        <DetailRow label="Proveedor" value={systemMethod?.provider} />
        <DetailRow label="Código DIAN" value={systemMethod?.dian_code} mono />
        <DetailRow label="Transacción" value={payment.transaction_id} mono />
        <DetailRow label="Referencia" value={reference} mono />
        <DetailRow
          label="Recibido"
          value={amountReceived !== undefined ? money(amountReceived, payment.currency || currency) : undefined}
        />
        <DetailRow
          label="Cambio"
          value={change !== undefined ? money(change, payment.currency || currency) : undefined}
        />
        <DetailRow label="Caja" value={registerId} mono />
        <DetailRow label="Vendedor" value={sellerId} mono />
        <DetailRow label="Actualizado" value={formatMaybeDate(payment.updated_at)} />
      </View>
    </View>
  );
}

function InstallmentDetail({
  installment,
  currency,
}: {
  installment: OrderInstallment;
  currency?: string | null;
}) {
  return (
    <View style={styles.installmentCard}>
      <View style={styles.installmentHeader}>
        <View>
          <Text style={styles.installmentTitle}>Cuota {installment.installment_number}</Text>
          <Text style={styles.installmentSubtitle}>
            Vence {formatDateOnly(installment.due_date) || 'No registrado'}
          </Text>
        </View>
        <Badge
          label={INSTALLMENT_STATE_LABELS[installment.state] ?? installment.state}
          variant={installmentVariant(installment.state)}
          size="sm"
        />
      </View>
      <View style={styles.inlineDetails}>
        <DetailRow label="Total" value={money(installment.amount, currency)} strong />
        <DetailRow label="Capital" value={money(installment.capital_amount, currency)} />
        <DetailRow label="Interés" value={money(installment.interest_amount, currency)} />
        <DetailRow label="Pagado" value={money(installment.amount_paid, currency)} />
        <DetailRow label="Pendiente" value={money(installment.remaining_balance, currency)} />
        <DetailRow label="Pagada el" value={formatMaybeDate(installment.paid_at)} />
        <DetailRow label="Notas" value={installment.notes} />
      </View>
    </View>
  );
}

const OrderDetail = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const orderId = Number(id);

  const [payModalVisible, setPayModalVisible] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethodId, setPayMethodId] = useState<number | undefined>();
  const [shipModalVisible, setShipModalVisible] = useState(false);
  const [shipTracking, setShipTracking] = useState('');
  const [shipCarrier, setShipCarrier] = useState('');
  const [shipNotes, setShipNotes] = useState('');
  const [cancelDialogVisible, setCancelDialogVisible] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [deliverDialogVisible, setDeliverDialogVisible] = useState(false);
  const [refundDialogVisible, setRefundDialogVisible] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [fastTrackDialogVisible, setFastTrackDialogVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const { data: order, isLoading: orderLoading, isError: orderError } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => OrderService.getById(orderId),
    enabled: !!orderId,
  });

  const { data: timeline = [] } = useQuery({
    queryKey: ['order-timeline', orderId],
    queryFn: () => OrderService.timeline(orderId),
    enabled: !!orderId,
  });

  const { data: paymentMethods = [] } = useQuery({
    queryKey: ['payment-methods'],
    queryFn: async () => {
      const res = await apiClient.get(Endpoints.STORE.PAYMENT_METHODS.LIST);
      const d = res.data as { data?: any[] } | any[];
      return Array.isArray(d) ? d : d.data ?? [];
    },
    enabled: payModalVisible,
  });

  const invalidateOrder = async () => {
    await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    await queryClient.invalidateQueries({ queryKey: ['order-timeline', orderId] });
    await queryClient.invalidateQueries({ queryKey: ['orders'] });
    await queryClient.invalidateQueries({ queryKey: ['order-stats'] });
  };

  const handleAction = async (actionFn: () => Promise<Order>, successMsg: string) => {
    setActionLoading(true);
    try {
      await actionFn();
      await invalidateOrder();
      toastSuccess(successMsg);
    } catch (e: any) {
      toastError(e?.message ?? 'Error al procesar la acción');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePay = () => {
    handleAction(
      () =>
        OrderService.pay(orderId, {
          store_payment_method_id: Number(payMethodId) || 1,
          payment_type: 'direct',
          amount: payAmount ? Number(payAmount) : undefined,
        }),
      'Pago registrado exitosamente',
    );
    setPayModalVisible(false);
    setPayAmount('');
    setPayMethodId(undefined);
  };

  const handleShip = () => {
    const dto: ShipOrderDto = {};
    if (shipTracking) dto.tracking_number = shipTracking;
    if (shipCarrier) dto.carrier = shipCarrier;
    if (shipNotes) dto.notes = shipNotes;
    handleAction(() => OrderService.ship(orderId, dto), 'Envío registrado exitosamente');
    setShipModalVisible(false);
    setShipTracking('');
    setShipCarrier('');
    setShipNotes('');
  };

  const handleCancel = () => {
    handleAction(
      () => OrderService.cancel(orderId, { reason: cancelReason }),
      'Orden cancelada exitosamente',
    );
    setCancelDialogVisible(false);
    setCancelReason('');
  };

  const handleDeliver = () => {
    handleAction(() => OrderService.deliver(orderId), 'Entrega confirmada exitosamente');
    setDeliverDialogVisible(false);
  };

  const handleRefund = () => {
    const dto: RefundOrderDto = { reason: refundReason };
    if (refundAmount) dto.amount = Number(refundAmount);
    handleAction(() => OrderService.refund(orderId, dto), 'Reembolso procesado exitosamente');
    setRefundDialogVisible(false);
    setRefundReason('');
    setRefundAmount('');
  };

  const handleFastTrack = () => {
    handleAction(() => OrderService.fastTrack(orderId), 'Fast Track aplicado exitosamente');
    setFastTrackDialogVisible(false);
  };

  if (orderLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner />
      </View>
    );
  }

  if (orderError || !order) {
    return (
      <View style={styles.loadingContainer}>
        <EmptyDetail text="No se pudo cargar el detalle de la orden." />
      </View>
    );
  }

  const badgeVariant =
    STATE_VARIANT_MAP[ORDER_STATE_COLORS[order.state]] ?? 'default';
  const currency = order.currency || 'COP';
  const customer = order.users ?? order.customer;
  const customerName = customer
    ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || `Cliente #${customer.id}`
    : 'Venta anónima';
  const items = order.order_items ?? [];
  const payments = order.payments ?? [];
  const installments = order.order_installments ?? [];
  const billingAddress = order.addresses_orders_billing_address_idToaddresses;
  const shippingAddress = order.addresses_orders_shipping_address_idToaddresses;
  const totalPaid = Number(order.total_paid ?? 0);
  const remainingBalance = Number(order.remaining_balance ?? 0);
  const isCredit = order.payment_form === '2' || Boolean(order.credit_type) || remainingBalance > 0;
  const hasShippingData = Boolean(
    order.delivery_type ||
      order.shipping_method ||
      order.shipping_rate ||
      Number(order.shipping_cost) > 0 ||
      shippingAddress ||
      billingAddress ||
      order.shipping_address_snapshot ||
      order.billing_address_snapshot ||
      order.estimated_ready_at ||
      order.estimated_delivered_at,
  );
  const lifecycleRows = [
    { label: 'Creada', value: formatMaybeDate(order.created_at) },
    { label: 'Actualizada', value: formatMaybeDate(order.updated_at) },
    { label: 'Realizada', value: formatMaybeDate(order.placed_at) },
    { label: 'Completada', value: formatMaybeDate(order.completed_at) },
    { label: 'Lista estimada', value: formatMaybeDate(order.estimated_ready_at) },
    { label: 'Entrega estimada', value: formatMaybeDate(order.estimated_delivered_at) },
  ];

  const showPay = order.state === 'pending_payment';
  const showShip = order.state === 'processing';
  const showDeliver = order.state === 'shipped';
  const showCancel = order.state === 'created' || order.state === 'pending_payment';
  const showRefund = order.state === 'delivered' || order.state === 'finished';
  const showFastTrack = order.state !== 'cancelled' && order.state !== 'refunded';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Icon name="arrow-left" size={24} color={colorScales.gray[700]} />
          </Pressable>
          <View style={styles.headerTitleBlock}>
            <Text style={styles.headerEyebrow}>Detalle de venta</Text>
            <Text style={styles.headerTitle}>Orden #{order.order_number}</Text>
            <Text style={styles.headerSubtitle}>
              {order.stores?.name || `Tienda #${order.store_id}`}
            </Text>
          </View>
          <Badge
            label={ORDER_STATE_LABELS[order.state] ?? order.state}
            variant={badgeVariant}
          />
        </View>

        <Card style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroLabel}>Total de la venta</Text>
              <Text style={styles.heroTotal}>{money(order.grand_total, currency)}</Text>
            </View>
            <View style={styles.heroBadgeStack}>
              <Badge
                label={CHANNEL_LABELS[order.channel || ''] ?? order.channel ?? 'Sin canal'}
                variant="info"
                size="sm"
              />
              {isCredit && (
                <Badge
                  label={PAYMENT_FORM_LABELS[order.payment_form || ''] ?? 'Crédito'}
                  variant="warning"
                  size="sm"
                />
              )}
            </View>
          </View>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Pagado</Text>
              <Text style={styles.heroStatValue}>{money(totalPaid, currency)}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Pendiente</Text>
              <Text style={styles.heroStatValue}>{money(remainingBalance, currency)}</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Items</Text>
              <Text style={styles.heroStatValue}>{items.length}</Text>
            </View>
          </View>
        </Card>

        <SectionCard title="Datos de la orden" icon="receipt">
          <View style={styles.inlineDetails}>
            <DetailRow label="ID orden" value={order.id} mono />
            <DetailRow label="Número" value={order.order_number} mono strong />
            <DetailRow label="Estado" value={ORDER_STATE_LABELS[order.state] ?? order.state} />
            <DetailRow label="Canal" value={CHANNEL_LABELS[order.channel || ''] ?? order.channel} />
            <DetailRow
              label="Tipo entrega"
              value={DELIVERY_TYPE_LABELS[order.delivery_type || ''] ?? order.delivery_type}
            />
            <DetailRow label="Moneda" value={currency} mono />
            <DetailRow
              label="Forma pago"
              value={PAYMENT_FORM_LABELS[order.payment_form || ''] ?? order.payment_form}
            />
            <DetailRow
              label="Tipo crédito"
              value={CREDIT_TYPE_LABELS[order.credit_type || ''] ?? order.credit_type}
            />
            <DetailRow label="Cupón" value={order.coupon_code} mono />
          </View>
          <View style={styles.dateGrid}>
            {lifecycleRows.map((row) => (
              <DetailRow key={row.label} label={row.label} value={row.value} />
            ))}
          </View>
        </SectionCard>

        <SectionCard title="Cliente" icon="user">
          <View style={styles.customerHeader}>
            <View style={styles.customerAvatar}>
              <Icon name="user" size={20} color={colors.primary} />
            </View>
            <View style={styles.flex1}>
              <Text style={styles.customerName}>{customerName}</Text>
              <Text style={styles.customerMeta}>{customer?.email || 'Sin correo registrado'}</Text>
            </View>
          </View>
          <View style={styles.inlineDetails}>
            <DetailRow label="Cliente ID" value={order.customer_id || customer?.id} mono />
            <DetailRow label="Teléfono" value={customer?.phone} />
            <DetailRow label="Correo" value={customer?.email} />
          </View>
        </SectionCard>

        <SectionCard
          title="Artículos vendidos"
          subtitle={`${items.length} producto${items.length === 1 ? '' : 's'}`}
          icon="package"
        >
          {items.length > 0 ? (
            <View style={styles.productList}>
              {items.map((item) => (
                <OrderItemDetail key={item.id} item={item} currency={currency} />
              ))}
            </View>
          ) : (
            <EmptyDetail text="Esta orden no tiene artículos registrados." />
          )}
        </SectionCard>

        <SectionCard title="Resumen financiero" icon="wallet">
          <View style={styles.moneyRows}>
            <View style={styles.moneyRow}>
              <Text style={styles.moneyLabel}>Subtotal</Text>
              <Text style={styles.moneyValue}>{money(order.subtotal_amount, currency)}</Text>
            </View>
            <View style={styles.moneyRow}>
              <Text style={styles.moneyLabel}>Descuento</Text>
              <Text style={[styles.moneyValue, Number(order.discount_amount) > 0 && styles.discountValue]}>
                -{money(order.discount_amount, currency)}
              </Text>
            </View>
            <View style={styles.moneyRow}>
              <Text style={styles.moneyLabel}>Impuestos</Text>
              <Text style={styles.moneyValue}>{money(order.tax_amount, currency)}</Text>
            </View>
            <View style={styles.moneyRow}>
              <Text style={styles.moneyLabel}>Envío</Text>
              <Text style={styles.moneyValue}>{money(order.shipping_cost, currency)}</Text>
            </View>
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Total</Text>
              <Text style={styles.grandTotalValue}>{money(order.grand_total, currency)}</Text>
            </View>
          </View>
          <View style={styles.inlineDetails}>
            <DetailRow label="Pagado" value={money(order.total_paid, currency)} strong />
            <DetailRow label="Saldo pendiente" value={money(order.remaining_balance, currency)} strong />
            <DetailRow label="Total con interés" value={moneyOptional(order.total_with_interest, currency)} />
            <DetailRow label="Tasa interés" value={formatPercent(order.interest_rate)} />
            <DetailRow label="Tipo interés" value={order.interest_type} />
            <DetailRow label="Cupón ID" value={order.coupon_id} mono />
          </View>
        </SectionCard>

        <SectionCard
          title="Pagos"
          subtitle={`${payments.length} registro${payments.length === 1 ? '' : 's'}`}
          icon="credit-card"
        >
          {payments.length > 0 ? (
            <View style={styles.paymentList}>
              {payments.map((payment) => (
                <PaymentDetail key={payment.id} payment={payment} currency={currency} />
              ))}
            </View>
          ) : (
            <EmptyDetail text="No hay pagos registrados para esta orden." />
          )}
        </SectionCard>

        {installments.length > 0 && (
          <SectionCard
            title="Plan de cuotas"
            subtitle={`${installments.length} cuota${installments.length === 1 ? '' : 's'}`}
            icon="calendar"
          >
            <View style={styles.paymentList}>
              {installments.map((installment) => (
                <InstallmentDetail
                  key={installment.id}
                  installment={installment}
                  currency={currency}
                />
              ))}
            </View>
          </SectionCard>
        )}

        <SectionCard title="Entrega y direcciones" icon="truck">
          {hasShippingData ? (
            <View style={styles.detailGroup}>
              <View style={styles.inlineDetails}>
                <DetailRow label="Método" value={order.shipping_method?.name} />
                <DetailRow label="Tipo método" value={order.shipping_method?.type} />
                <DetailRow label="Transportadora" value={order.shipping_method?.provider_name} />
                <DetailRow label="Tarifa" value={order.shipping_rate?.name} />
                <DetailRow
                  label="Zona"
                  value={
                    order.shipping_rate?.shipping_zone?.display_name ||
                    order.shipping_rate?.shipping_zone?.name
                  }
                />
                <DetailRow
                  label="Costo tarifa"
                  value={moneyOptional(order.shipping_rate?.base_cost, currency)}
                />
                <DetailRow
                  label="Tiempo estimado"
                  value={
                    order.shipping_method?.min_days || order.shipping_method?.max_days
                      ? `${order.shipping_method?.min_days ?? 0}-${order.shipping_method?.max_days ?? order.shipping_method?.min_days} días`
                      : undefined
                  }
                />
              </View>
              <AddressBlock
                title="Dirección de envío"
                address={shippingAddress}
                snapshot={order.shipping_address_snapshot}
              />
              <AddressBlock
                title="Dirección de facturación"
                address={billingAddress}
                snapshot={order.billing_address_snapshot}
              />
            </View>
          ) : (
            <EmptyDetail text="No hay información de entrega registrada." />
          )}
        </SectionCard>

        {order.internal_notes && (
          <SectionCard title="Notas internas" icon="file-text">
            <Text style={styles.notesText}>{order.internal_notes}</Text>
          </SectionCard>
        )}

        <SectionCard title="Historial" icon="clock">
          {timeline.length > 0 ? (
            <View style={styles.timelineContainer}>
              {timeline.map((entry: OrderTimelineEntry, idx: number) => (
                <View key={entry.id ?? idx} style={styles.timelineRow}>
                  <View style={styles.timelineDotColumn}>
                    <View
                      style={[
                        styles.timelineDot,
                        idx === 0 ? styles.timelineDotActive : styles.timelineDotInactive,
                      ]}
                    />
                    {idx < timeline.length - 1 && (
                      <View style={styles.timelineLine} />
                    )}
                  </View>
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineTitle}>{entry.description}</Text>
                    <Text style={styles.timelineMeta}>
                      {formatRelative(entry.created_at)} · {formatDateTime(entry.created_at)}
                    </Text>
                    {entry.performed_by && (
                      <Text style={styles.timelineMeta}>Por {entry.performed_by}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <EmptyDetail text="No hay eventos registrados." />
          )}
        </SectionCard>

        <SectionCard title="Datos técnicos" icon="sliders">
          <View style={styles.inlineDetails}>
            <DetailRow label="Store ID" value={order.store_id} mono />
            <DetailRow label="Código tienda" value={order.stores?.store_code} mono />
            <DetailRow label="Shipping method ID" value={order.shipping_method_id} mono />
            <DetailRow label="Shipping rate ID" value={order.shipping_rate_id} mono />
            <DetailRow label="Shipping address ID" value={order.shipping_address_id} mono />
            <DetailRow label="Billing address ID" value={order.billing_address_id} mono />
            <DetailRow label="Payment form" value={order.payment_form} mono />
            <DetailRow label="Credit type" value={order.credit_type} mono />
          </View>
        </SectionCard>

        <View style={styles.actionsGap}>
          {showPay && (
            <Button
              title="Cobrar"
              onPress={() => setPayModalVisible(true)}
              variant="primary"
              loading={actionLoading}
            />
          )}
          {showShip && (
            <Button
              title="Enviar"
              onPress={() => setShipModalVisible(true)}
              variant="primary"
              loading={actionLoading}
            />
          )}
          {showDeliver && (
            <Button
              title="Entregar"
              onPress={() => setDeliverDialogVisible(true)}
              variant="primary"
              loading={actionLoading}
            />
          )}
          {showCancel && (
            <Button
              title="Cancelar"
              onPress={() => setCancelDialogVisible(true)}
              variant="destructive"
              loading={actionLoading}
            />
          )}
          {showRefund && (
            <Button
              title="Reembolso"
              onPress={() => setRefundDialogVisible(true)}
              variant="secondary"
              loading={actionLoading}
            />
          )}
          {showFastTrack && (
            <Button
              title="Fast Track"
              onPress={() => setFastTrackDialogVisible(true)}
              variant="secondary"
              loading={actionLoading}
            />
          )}
        </View>
      </ScrollView>

      <Modal visible={payModalVisible} onClose={() => setPayModalVisible(false)} title="Cobrar">
        <View style={styles.modalGap}>
          <View style={styles.pmSection}>
            <Text style={styles.pmLabel}>Método de pago</Text>
            {paymentMethods.length === 0 ? (
              <Text style={styles.pmEmpty}>Cargando métodos...</Text>
            ) : (
              <View style={styles.pmList}>
                {paymentMethods.map((pm: { id: number; display_name?: string; name?: string; type?: string }) => (
                  <Pressable
                    key={pm.id}
                    onPress={() => setPayMethodId(pm.id)}
                    style={[
                      styles.pmItem,
                      payMethodId === pm.id ? styles.pmItemSelected : styles.pmItemDefault,
                    ]}
                  >
                    <Text style={[
                      styles.pmItemText,
                      payMethodId === pm.id ? styles.pmItemSelectedText : styles.pmItemDefaultText,
                    ]}>
                      {pm.display_name ?? pm.name ?? `Método ${pm.id}`}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
          <Input
            label="Monto a cobrar"
            value={payAmount}
            onChangeText={setPayAmount}
            keyboardType="decimal-pad"
            placeholder={money(order.grand_total, currency)}
          />
          <Button
            title="Confirmar Pago"
            onPress={handlePay}
            loading={actionLoading}
            disabled={!payMethodId}
          />
        </View>
      </Modal>

      <BottomSheet
        visible={shipModalVisible}
        onClose={() => setShipModalVisible(false)}
        snapPoint="partial"
      >
        <View style={styles.bottomSheetContent}>
          <Input
            label="Número de guía"
            value={shipTracking}
            onChangeText={setShipTracking}
            placeholder="Ej: TRACK123456"
          />
          <Input
            label="Transportadora"
            value={shipCarrier}
            onChangeText={setShipCarrier}
            placeholder="Ej: DHL, FedEx"
          />
          <Input
            label="Notas"
            value={shipNotes}
            onChangeText={setShipNotes}
            placeholder="Notas adicionales"
            multiline
          />
          <Button
            title="Confirmar Envío"
            onPress={handleShip}
            loading={actionLoading}
          />
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={cancelDialogVisible}
        onClose={() => setCancelDialogVisible(false)}
        onConfirm={handleCancel}
        title="Cancelar Orden"
        message={`¿Estás seguro de que deseas cancelar esta orden?${cancelReason ? `\n\nMotivo: ${cancelReason}` : ''}`}
        confirmLabel="Cancelar Orden"
        destructive
        loading={actionLoading}
      />

      <ConfirmDialog
        visible={deliverDialogVisible}
        onClose={() => setDeliverDialogVisible(false)}
        onConfirm={handleDeliver}
        title="Confirmar Entrega"
        message="¿Confirmas que la orden fue entregada?"
        loading={actionLoading}
      />

      <ConfirmDialog
        visible={refundDialogVisible}
        onClose={() => setRefundDialogVisible(false)}
        onConfirm={handleRefund}
        title="Reembolso"
        message={`¿Estás seguro de que deseas procesar un reembolso?${refundAmount ? `\n\nMonto: ${formatCurrency(Number(refundAmount))}` : ''}${refundReason ? `\n\nMotivo: ${refundReason}` : ''}`}
        loading={actionLoading}
        destructive
      />

      <ConfirmDialog
        visible={fastTrackDialogVisible}
        onClose={() => setFastTrackDialogVisible(false)}
        onConfirm={handleFastTrack}
        title="Fast Track"
        message="¿Deseas aplicar Fast Track a esta orden?"
        loading={actionLoading}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  scrollContent: {
    padding: spacing[4],
    paddingBottom: spacing[24],
  },
  flex1: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  headerTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  headerEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: colorScales.gray[500],
    textTransform: 'uppercase',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colorScales.gray[900],
    marginTop: 2,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  cardMargin: {
    marginBottom: spacing[3],
  },
  heroCard: {
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  heroLabel: {
    fontSize: 12,
    color: colorScales.gray[500],
    fontWeight: '600',
  },
  heroTotal: {
    fontSize: 30,
    lineHeight: 36,
    color: colors.primary,
    fontWeight: '900',
    marginTop: spacing[1],
  },
  heroBadgeStack: {
    alignItems: 'flex-end',
    gap: spacing[1],
  },
  heroStats: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[4],
  },
  heroStat: {
    flex: 1,
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
  },
  heroStatLabel: {
    fontSize: 11,
    color: colorScales.gray[500],
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  heroStatValue: {
    marginTop: spacing[1],
    fontSize: 15,
    color: colorScales.gray[900],
    fontWeight: '800',
  },
  sectionHeader: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  sectionTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.blue[50],
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colorScales.gray[900],
  },
  sectionSubtitle: {
    fontSize: 12,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  sectionBody: {
    padding: spacing[4],
  },
  inlineDetails: {
    gap: spacing[2],
  },
  dateGrid: {
    gap: spacing[2],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  detailGroup: {
    gap: spacing[3],
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing[3],
    paddingVertical: spacing[1],
  },
  detailLabel: {
    flex: 0.9,
    fontSize: 12,
    color: colorScales.gray[500],
    fontWeight: '600',
  },
  detailValue: {
    flex: 1.1,
    fontSize: 13,
    color: colorScales.gray[900],
    fontWeight: '600',
    textAlign: 'right',
  },
  strongValue: {
    fontWeight: '800',
  },
  monoText: {
    fontFamily: 'monospace',
  },
  emptyDetail: {
    padding: spacing[4],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
  },
  emptyDetailText: {
    fontSize: 13,
    color: colorScales.gray[500],
    lineHeight: 19,
  },
  customerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  customerAvatar: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.blue[50],
  },
  customerName: {
    fontSize: 16,
    fontWeight: '800',
    color: colorScales.gray[900],
  },
  customerMeta: {
    fontSize: 13,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  productList: {
    gap: spacing[3],
  },
  productItem: {
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    gap: spacing[3],
  },
  productTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  productImageBox: {
    width: 58,
    height: 58,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  productImage: {
    width: '100%',
    height: '100%',
  },
  productInfo: {
    flex: 1,
    minWidth: 0,
  },
  productName: {
    fontSize: 15,
    lineHeight: 20,
    color: colorScales.gray[900],
    fontWeight: '800',
  },
  productMetaRow: {
    gap: spacing[1],
    marginTop: spacing[1],
  },
  productMetaText: {
    fontSize: 12,
    color: colorScales.gray[600],
    fontWeight: '600',
  },
  productSku: {
    fontSize: 11,
    color: colorScales.gray[500],
    fontFamily: 'monospace',
  },
  productTotal: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '900',
    textAlign: 'right',
  },
  attributeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[1],
  },
  attributeChip: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  attributeText: {
    fontSize: 11,
    color: colorScales.gray[700],
    fontWeight: '600',
  },
  moneyRows: {
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  moneyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  moneyLabel: {
    fontSize: 13,
    color: colorScales.gray[500],
    fontWeight: '600',
  },
  moneyValue: {
    fontSize: 14,
    color: colorScales.gray[900],
    fontWeight: '700',
  },
  discountValue: {
    color: colorScales.green[700],
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing[3],
    marginTop: spacing[1],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  grandTotalLabel: {
    fontSize: 15,
    color: colorScales.gray[900],
    fontWeight: '800',
  },
  grandTotalValue: {
    fontSize: 20,
    color: colors.primary,
    fontWeight: '900',
  },
  paymentList: {
    gap: spacing[3],
  },
  paymentCard: {
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    gap: spacing[3],
  },
  paymentHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  paymentTitle: {
    fontSize: 14,
    color: colorScales.gray[900],
    fontWeight: '800',
  },
  paymentSubtitle: {
    fontSize: 12,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  paymentAmountBox: {
    alignItems: 'flex-end',
    gap: spacing[1],
  },
  paymentAmount: {
    fontSize: 14,
    color: colorScales.gray[900],
    fontWeight: '900',
  },
  installmentCard: {
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    gap: spacing[3],
  },
  installmentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  installmentTitle: {
    fontSize: 14,
    color: colorScales.gray[900],
    fontWeight: '800',
  },
  installmentSubtitle: {
    fontSize: 12,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  addressBox: {
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
  },
  addressTitle: {
    fontSize: 12,
    color: colorScales.gray[500],
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  addressMain: {
    fontSize: 14,
    color: colorScales.gray[900],
    fontWeight: '700',
    lineHeight: 19,
  },
  addressMeta: {
    fontSize: 12,
    color: colorScales.gray[600],
    lineHeight: 18,
  },
  notesText: {
    fontSize: 14,
    color: colorScales.gray[700],
    lineHeight: 20,
  },
  timelineContainer: {
    marginLeft: spacing[2],
  },
  timelineRow: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  timelineDotColumn: {
    alignItems: 'center',
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: borderRadius.full,
  },
  timelineDotActive: {
    backgroundColor: colors.primary,
  },
  timelineDotInactive: {
    backgroundColor: colorScales.gray[300],
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: colorScales.gray[200],
  },
  timelineContent: {
    flex: 1,
    paddingBottom: spacing[2],
  },
  timelineTitle: {
    fontSize: 13,
    color: colorScales.gray[900],
    fontWeight: '700',
    lineHeight: 18,
  },
  timelineMeta: {
    fontSize: 11,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  actionsGap: {
    gap: spacing[2],
    marginTop: spacing[2],
  },
  modalGap: {
    gap: spacing[3],
  },
  pmSection: {
    gap: spacing[2],
  },
  pmLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: colorScales.gray[700],
  },
  pmEmpty: {
    fontSize: 13,
    color: colorScales.gray[400],
  },
  pmList: {
    gap: spacing[2],
  },
  pmItem: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  pmItemSelected: {
    backgroundColor: colorScales.blue[50],
    borderColor: colors.primary,
  },
  pmItemDefault: {
    backgroundColor: colorScales.gray[50],
    borderColor: colorScales.gray[200],
  },
  pmItemText: {
    fontSize: 14,
    fontWeight: '500' as const,
  },
  pmItemSelectedText: {
    color: colors.primary,
  },
  pmItemDefaultText: {
    color: colorScales.gray[700],
  },
  bottomSheetContent: {
    gap: spacing[3],
    padding: spacing[4],
  },
});

export default OrderDetail;
