import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';
import { formatDate } from '@/shared/utils/date';
import { formatCurrency } from '@/shared/utils/currency';

export type PoDetailTab = 'detail' | 'receive' | 'payments' | 'timeline';

export interface PoDetailItem {
  product_id: number;
  product_name?: string;
  quantity_ordered: number;
  quantity_received?: number;
  unit_price: number;
}

export interface PoDetailReception {
  id: number;
  received_at: string;
  received_by?: string;
  items?: Array<{ product_id: number; quantity: number }>;
}

export interface PoDetailPayment {
  id: number;
  paid_at: string;
  amount: number;
  method: string;
  reference?: string;
}

export interface PoDetailData {
  id: number;
  order_number: string;
  status: string;
  payment_status?: string;
  supplier_name?: string;
  location_name?: string;
  order_date?: string;
  expected_date?: string;
  received_date?: string;
  subtotal?: number;
  tax_amount?: number;
  total_amount?: number;
  notes?: string;
  items?: PoDetailItem[];
  receptions?: PoDetailDetail[];
  payments?: PoDetailPayment[];
}

export interface PoDetailDetail {
  id: number;
  product_id: number;
  product_name?: string;
  quantity_requested: number;
  quantity_received: number;
  received_at?: string;
}

interface PoDetailModalProps {
  visible: boolean;
  onClose: () => void;
  order: PoDetailData | null;
  onReceive?: (order: PoDetailData) => void;
  onPay?: (order: PoDetailData) => void;
  isSubmitting?: boolean;
}

const TABS: { key: PoDetailTab; label: string; icon: string }[] = [
  { key: 'detail', label: 'Detalle', icon: 'file-text' },
  { key: 'receive', label: 'Recepciones', icon: 'package-check' },
  { key: 'payments', label: 'Pagos', icon: 'wallet' },
  { key: 'timeline', label: 'Historial', icon: 'history' },
];

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  submitted: 'Enviada',
  approved: 'Aprobada',
  ordered: 'Ordenada',
  partial: 'Parcial',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

const STATUS_PALETTE: Record<string, { bg: string; color: string }> = {
  draft: { bg: colorScales.gray[100], color: colorScales.gray[700] },
  submitted: { bg: colorScales.blue[100], color: colorScales.blue[700] },
  approved: { bg: colorScales.green[100], color: colorScales.green[700] },
  ordered: { bg: colorScales.blue[100], color: colorScales.blue[700] },
  partial: { bg: colorScales.amber[100], color: colorScales.amber[700] },
  received: { bg: colorScales.green[100], color: colorScales.green[700] },
  cancelled: { bg: colorScales.red[100], color: colorScales.red[700] },
};

/**
 * po-detail-modal — modal con tabs que muestra el detalle de una orden
 * de compra. Replica el patrón visual de la web con tabs scrollables
 * (Detail / Recepciones / Pagos / Historial).
 */
export default function PoDetailModal({
  visible,
  onClose,
  order,
  onReceive,
  onPay,
  isSubmitting = false,
}: PoDetailModalProps) {
  const [activeTab, setActiveTab] = useState<PoDetailTab>('detail');

  if (!visible || !order) return null;

  const statusInfo = STATUS_PALETTE[order.status] ?? STATUS_PALETTE.draft;
  const statusLabel = STATUS_LABELS[order.status] ?? order.status;
  const totalReceived = (order.items ?? []).reduce(
    (sum, it) => sum + (it.quantity_received ?? 0),
    0,
  );
  const totalOrdered = (order.items ?? []).reduce(
    (sum, it) => sum + (it.quantity_ordered ?? 0),
    0,
  );

  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.modal}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {order.order_number ?? `Orden #${order.id}`}
            </Text>
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: statusInfo.bg },
                ]}
              >
                <Text
                  style={[styles.badgeText, { color: statusInfo.color }]}
                >
                  {statusLabel}
                </Text>
              </View>
              {order.payment_status ? (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor:
                        order.payment_status === 'paid'
                          ? colorScales.green[100]
                          : colorScales.amber[100],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      {
                        color:
                          order.payment_status === 'paid'
                            ? colorScales.green[700]
                            : colorScales.amber[700],
                      },
                    ]}
                  >
                    {order.payment_status === 'paid' ? 'Pagado' : 'Pago parcial'}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
            <Icon name="x" size={22} color={colorScales.gray[500]} />
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={styles.tabsRow}>
          {TABS.map((t) => {
            const isActive = activeTab === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setActiveTab(t.key)}
                style={[styles.tab, isActive && styles.tabActive]}
              >
                <Icon
                  name={t.icon}
                  size={14}
                  color={isActive ? colors.primary : colorScales.gray[500]}
                />
                <Text
                  style={[
                    styles.tabText,
                    isActive && styles.tabTextActive,
                  ]}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          {activeTab === 'detail' && (
            <DetailTab
              order={order}
              totalOrdered={totalOrdered}
              totalReceived={totalReceived}
            />
          )}
          {activeTab === 'receive' && (
            <ReceiveTab
              order={order}
              totalOrdered={totalOrdered}
              totalReceived={totalReceived}
            />
          )}
          {activeTab === 'payments' && (
            <PaymentsTab order={order} />
          )}
          {activeTab === 'timeline' && (
            <TimelineTab order={order} />
          )}
        </ScrollView>

        {/* Footer: contextual actions */}
        {(order.status === 'ordered' || order.status === 'partial') && onReceive ? (
          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, isSubmitting && styles.btnDisabled]}
              onPress={() => onReceive(order)}
              disabled={isSubmitting}
            >
              <Icon name="package-check" size={16} color={colors.background} />
              <Text style={styles.primaryBtnText}>Recibir</Text>
            </Pressable>
          </View>
        ) : null}
        {order.status === 'received' && onPay && order.payment_status !== 'paid' ? (
          <View style={styles.footer}>
            <Pressable
              style={[styles.primaryBtn, isSubmitting && styles.btnDisabled]}
              onPress={() => onPay(order)}
              disabled={isSubmitting}
            >
              <Icon name="dollar-sign" size={16} color={colors.background} />
              <Text style={styles.primaryBtnText}>Registrar pago</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DetailTab({
  order,
  totalOrdered,
  totalReceived,
}: {
  order: PoDetailData;
  totalOrdered: number;
  totalReceived: number;
}) {
  return (
    <View style={styles.tabContent}>
      <View style={styles.summaryGrid}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Proveedor</Text>
          <Text style={styles.summaryValue} numberOfLines={2}>
            {order.supplier_name ?? '—'}
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Bodega</Text>
          <Text style={styles.summaryValue} numberOfLines={2}>
            {order.location_name ?? '—'}
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Fecha de orden</Text>
          <Text style={styles.summaryValue}>
            {order.order_date ? formatDate(order.order_date) : '—'}
          </Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total</Text>
          <Text style={[styles.summaryValue, { color: colors.primary }]}>
            {formatCurrency(order.total_amount ?? 0)}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Items ({order.items?.length ?? 0})</Text>
        {(order.items ?? []).map((it) => (
          <View key={it.product_id} style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{it.product_name ?? `Producto #${it.product_id}`}</Text>
              <Text style={styles.itemMeta}>
                {`${it.quantity_ordered} ordered · ${it.quantity_received ?? 0} recibidos`}
              </Text>
            </View>
            <Text style={styles.itemPrice}>{formatCurrency(it.unit_price)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReceiveTab({
  order,
  totalOrdered,
  totalReceived,
}: {
  order: PoDetailData;
  totalOrdered: number;
  totalReceived: number;
}) {
  return (
    <View style={styles.tabContent}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recepciones</Text>
        <Text style={styles.timelineText}>
          {totalOrdered > 0
            ? `${totalReceived} / ${totalOrdered} unidades recibidas`
            : 'Sin items'}
        </Text>
      </View>
    </View>
  );
}

function PaymentsTab({ order }: { order: PoDetailData }) {
  return (
    <View style={styles.tabContent}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pagos</Text>
        {(order.payments ?? []).length === 0 ? (
          <Text style={styles.timelineText}>Sin pagos registrados</Text>
        ) : (
          (order.payments ?? []).map((p) => (
            <View key={p.id} style={styles.paymentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{p.method}</Text>
                <Text style={styles.itemMeta}>
                  {formatDate(p.paid_at)} · {p.reference ?? '—'}
                </Text>
              </View>
              <Text style={[styles.itemPrice, { color: colors.primary }]}>
                {formatCurrency(p.amount)}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function TimelineTab({ order }: { order: PoDetailData }) {
  const events: Array<{ icon: string; label: string; date?: string; color: string }> = [];
  if (order.order_date) {
    events.push({ icon: 'plus', label: 'Orden creada', date: order.order_date, color: colorScales.blue[500] });
  }
  if (order.expected_date) {
    events.push({ icon: 'calendar', label: 'Fecha esperada', date: order.expected_date, color: colorScales.amber[500] });
  }
  if (order.received_date) {
    events.push({ icon: 'package-check', label: 'Orden recibida', date: order.received_date, color: colorScales.green[500] });
  }
  (order.payments ?? []).forEach((p) => {
    events.push({ icon: 'dollar-sign', label: `Pago: ${p.method}`, date: p.paid_at, color: colorScales.green[600] });
  });
  (order.receptions ?? []).forEach((r) => {
    events.push({ icon: 'package', label: 'Recepción parcial', date: r.received_at, color: colorScales.blue[500] });
  });

  events.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));

  return (
    <View style={styles.tabContent}>
      <View style={styles.timeline}>
        {events.map((ev, i) => (
          <View key={i} style={styles.timelineItem}>
            <View style={[styles.timelineDot, { backgroundColor: ev.color }]}>
              <Icon name={ev.icon} size={12} color={colors.background} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.timelineLabel}>{ev.label}</Text>
              {ev.date ? (
                <Text style={styles.timelineDate}>{formatDate(ev.date)}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  modal: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: '100%',
    maxWidth: 560,
    maxHeight: '92%',
    ...shadows.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  title: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900] },
  badgeRow: { flexDirection: 'row', gap: spacing[1.5], marginTop: spacing[2], flexWrap: 'wrap' as any },
  badge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  badgeText: { fontSize: 10, fontWeight: '700' as any, textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  closeBtn: { padding: spacing[1] },
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: colorScales.gray[50],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.primary,
  },
  tabText: { fontSize: 12, fontWeight: '600' as any, color: colorScales.gray[500] },
  tabTextActive: { color: colors.primary, fontWeight: '700' as any },
  body: { flexGrow: 0, flexShrink: 1, maxHeight: 480 },
  bodyContent: { padding: spacing[4], gap: spacing[4] },
  tabContent: { gap: spacing[3] },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap' as any,
    gap: spacing[2],
  },
  summaryCard: {
    flexBasis: '47%',
    flexGrow: 1,
    padding: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  summaryLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  summaryValue: { fontSize: 13, fontWeight: '700' as any, color: colorScales.gray[900], marginTop: 2 },
  section: { gap: spacing[2] },
  sectionTitle: { fontSize: 13, fontWeight: '700' as any, color: colorScales.gray[900] },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    backgroundColor: colors.card,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  itemName: { fontSize: 13, fontWeight: '600' as any, color: colorScales.gray[900] },
  itemMeta: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },
  itemPrice: { fontSize: 13, fontWeight: '700' as any, color: colorScales.gray[900] },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    backgroundColor: colorScales.green[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.green[100],
  },
  timelineText: { fontSize: 13, color: colorScales.gray[600] },
  timeline: { gap: spacing[2] },
  timelineItem: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineLabel: { fontSize: 13, fontWeight: '600' as any, color: colorScales.gray[900] },
  timelineDate: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colorScales.gray[50],
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: 12,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 14, fontWeight: '700' as any, color: colors.background },
});
