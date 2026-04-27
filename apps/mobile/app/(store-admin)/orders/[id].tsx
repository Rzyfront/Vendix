import { useState } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OrderService } from '@/features/store/services/order.service';
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
  const [payMethodId, setPayMethodId] = useState('');
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
    setPayMethodId('');
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
      <View className="flex-1 items-center justify-center bg-gray-50">
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
    <View className="flex-1 bg-gray-50">
      <ScrollView contentContainerClassName="p-4 pb-32">
        <View className="flex-row items-center gap-3 mb-4">
          <Pressable onPress={() => router.back()}>
            <Icon name="arrow-left" size={24} color="#374151" />
          </Pressable>
          <View className="flex-1">
            <ListItem title={`Orden #${order.order_number}`} />
          </View>
          <Badge
            label={ORDER_STATE_LABELS[order.state]}
            variant={badgeVariant}
          />
        </View>

        <Card className="mb-3">
          <View className="flex-row justify-between items-center">
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
          <Card className="mb-3">
            <ListItem
              title="Cliente"
              subtitle={`${order.customer.first_name} ${order.customer.last_name}`}
            />
            <View className="mt-2 gap-1">
              <ListItem title={order.customer.email} />
              {order.customer.phone && (
                <ListItem title={order.customer.phone} />
              )}
            </View>
          </Card>
        )}

        <Card className="mb-3">
          <ListItem title="Timeline" />
          <View className="mt-2 ml-2">
            {timeline.map((entry: OrderTimelineEntry, idx: number) => (
              <View key={idx} className="flex-row gap-3 mb-3">
                <View className="items-center">
                  <View
                    className={`w-3 h-3 rounded-full ${
                      idx === 0 ? 'bg-primary-600' : 'bg-gray-300'
                    }`}
                  />
                  {idx < timeline.length - 1 && (
                    <View className="w-0.5 flex-1 bg-gray-200" />
                  )}
                </View>
                <View className="flex-1 pb-2">
                  <ListItem title={entry.description} />
                  <ListItem title={formatRelative(entry.created_at)} />
                </View>
              </View>
            ))}
          </View>
        </Card>

        <Card className="mb-3">
          <ListItem title="Productos" />
          <View className="mt-2">
            {(order.order_items ?? []).map((item) => (
              <View
                key={item.id}
                className="flex-row justify-between items-start py-2 border-b border-gray-100 last:border-b-0"
              >
                <View className="flex-1">
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

        <Card className="mb-3">
          <ListItem title="Resumen de Pago" />
          <View className="mt-2 gap-1">
            <View className="flex-row justify-between">
              <ListItem title="Subtotal" />
              <ListItem title={formatCurrency(order.subtotal_amount)} />
            </View>
            <View className="flex-row justify-between">
              <ListItem title="Impuestos" />
              <ListItem title={formatCurrency(order.tax_amount)} />
            </View>
            <View className="flex-row justify-between">
              <ListItem title="Envío" />
              <ListItem title={formatCurrency(order.shipping_cost)} />
            </View>
            {order.discount_amount > 0 && (
              <View className="flex-row justify-between">
                <ListItem title="Descuento" />
                <ListItem title={`-${formatCurrency(order.discount_amount)}`} />
              </View>
            )}
            <View className="flex-row justify-between pt-2 border-t border-gray-200">
              <ListItem title="Total" />
              <ListItem title={formatCurrency(order.grand_total)} />
            </View>
          </View>
        </Card>

        {(order.payments ?? []).length > 0 && (
          <Card className="mb-3">
            <ListItem title="Pagos" />
            <View className="mt-2">
              {order.payments!.map((payment) => (
                <View
                  key={payment.id}
                  className="flex-row justify-between items-center py-2 border-b border-gray-100 last:border-b-0"
                >
                  <View>
                    <ListItem
                      title={
                        payment.store_payment_method?.display_name ?? 'Pago'
                      }
                    />
                    <ListItem title={formatDateTime(payment.created_at)} />
                  </View>
                  <View className="flex-row items-center gap-2">
                    <ListItem title={formatCurrency(payment.amount)} />
                    <Badge label={payment.state} variant="default" size="sm" />
                  </View>
                </View>
              ))}
            </View>
          </Card>
        )}

        <View className="gap-2 mt-2">
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
        <View className="gap-3">
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
          />
        </View>
      </Modal>

      <BottomSheet
        visible={shipModalVisible}
        onClose={() => setShipModalVisible(false)}
        snapPoint="partial"
      >
        <View className="gap-3 p-4">
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

export default OrderDetail;
