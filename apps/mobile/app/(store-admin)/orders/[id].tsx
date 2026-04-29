import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OrderService } from '@/features/store/services/order.service';
import { apiClient, Endpoints } from '@/core/api';
import {
  Order,
  OrderState,
  ORDER_STATE_LABELS,
  ORDER_STATE_COLORS,
  ShipOrderDto,
  CancelOrderDto,
  RefundOrderDto,
  OrderTimelineEntry,
} from '@/features/store/types';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { Spinner } from '@/shared/components/spinner/spinner';
import { ListItem } from '@/shared/components/list-item/list-item';
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

  const { data: order, isLoading: orderLoading } = useQuery({
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

  if (orderLoading || !order) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner />
      </View>
    );
  }

  const badgeVariant =
    STATE_VARIANT_MAP[ORDER_STATE_COLORS[order.state]] ?? 'default';

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
          <Pressable onPress={() => router.back()}>
            <Icon name="arrow-left" size={24} color={colorScales.gray[700]} />
          </Pressable>
          <View style={styles.flex1}>
            <ListItem title={`Orden #${order.order_number}`} />
          </View>
          <Badge
            label={ORDER_STATE_LABELS[order.state]}
            variant={badgeVariant}
          />
        </View>

        <Card style={styles.cardMargin}>
          <View style={styles.rowBetween}>
            <View>
              {order.channel && (
                <ListItem
                  title={CHANNEL_LABELS[order.channel] ?? order.channel}
                />
              )}
            </View>
            <ListItem title={formatDateTime(order.created_at)} />
          </View>
        </Card>

        {order.customer && (
          <Card style={styles.cardMargin}>
            <ListItem
              title="Cliente"
              subtitle={`${order.customer.first_name} ${order.customer.last_name}`}
            />
            <View style={styles.mt2Gap1}>
              <ListItem title={order.customer.email} />
              {order.customer.phone && (
                <ListItem title={order.customer.phone} />
              )}
            </View>
          </Card>
        )}

        <Card style={styles.cardMargin}>
          <ListItem title="Timeline" />
          <View style={styles.timelineContainer}>
            {timeline.map((entry: OrderTimelineEntry, idx: number) => (
              <View key={idx} style={styles.timelineRow}>
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
                  <ListItem title={entry.description} />
                  <ListItem title={formatRelative(entry.created_at)} />
                </View>
              </View>
            ))}
          </View>
        </Card>

        <Card style={styles.cardMargin}>
          <ListItem title="Productos" />
          <View style={styles.mt2}>
            {(order.order_items ?? []).map((item) => (
              <View
                key={item.id}
                style={styles.itemRow}
              >
                <View style={styles.flex1}>
                  <ListItem title={item.product_name} />
                  {item.variant_sku && (
                    <ListItem title={`SKU: ${item.variant_sku}`} />
                  )}
                  <ListItem
                    title={`${item.quantity} × ${formatCurrency(item.unit_price)}`}
                  />
                </View>
                <ListItem title={formatCurrency(item.total_price)} />
              </View>
            ))}
          </View>
        </Card>

        <Card style={styles.cardMargin}>
          <ListItem title="Resumen de Pago" />
          <View style={styles.mt2Gap1}>
            <View style={styles.rowBetween}>
              <ListItem title="Subtotal" />
              <ListItem title={formatCurrency(order.subtotal_amount)} />
            </View>
            <View style={styles.rowBetween}>
              <ListItem title="Impuestos" />
              <ListItem title={formatCurrency(order.tax_amount)} />
            </View>
            <View style={styles.rowBetween}>
              <ListItem title="Envío" />
              <ListItem title={formatCurrency(order.shipping_cost)} />
            </View>
            {order.discount_amount > 0 && (
              <View style={styles.rowBetween}>
                <ListItem title="Descuento" />
                <ListItem title={`-${formatCurrency(order.discount_amount)}`} />
              </View>
            )}
            <View style={styles.totalRow}>
              <ListItem title="Total" />
              <ListItem title={formatCurrency(order.grand_total)} />
            </View>
          </View>
        </Card>

        {(order.payments ?? []).length > 0 && (
          <Card style={styles.cardMargin}>
            <ListItem title="Pagos" />
            <View style={styles.mt2}>
              {order.payments!.map((payment) => (
                <View
                  key={payment.id}
                  style={styles.paymentRow}
                >
                  <View>
                    <ListItem
                      title={
                        payment.store_payment_method?.display_name ?? 'Pago'
                      }
                    />
                    <ListItem title={formatDateTime(payment.created_at)} />
                  </View>
                  <View style={styles.paymentRight}>
                    <ListItem title={formatCurrency(payment.amount)} />
                    <Badge label={payment.state} variant="default" size="sm" />
                  </View>
                </View>
              ))}
            </View>
          </Card>
        )}

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
            placeholder={formatCurrency(order.grand_total)}
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
  cardMargin: {
    marginBottom: spacing[3],
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mt2: {
    marginTop: spacing[2],
  },
  mt2Gap1: {
    marginTop: spacing[2],
    gap: spacing[1],
  },
  timelineContainer: {
    marginTop: spacing[2],
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
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  paymentRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
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
