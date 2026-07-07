import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';
import { TRANSFER_STATE_MAP } from '@/features/store/constants/inventory-labels';
import { STAT_PALETTE } from '@/features/store/constants/inventory-icons';
import { formatDate } from '@/shared/utils/date';
import type { StockTransfer } from '@/features/store/types';
import { TRANSFER_STATE_LABELS } from '@/features/store/types';

/**
 * Transfer detail popup — opened when the user taps the eye (ver) button on
 * a TransferCard. Matches the web `app-transfer-detail-modal` visual contract:
 * header with status badge, origin → destination summary, dates, items list,
 * and contextual actions footer (Aprobar / Recibir / Cancelar / Cerrar).
 */
export default function TransferDetailModal({
  transfer,
  onClose,
  onApprove,
  onComplete,
  onCancel,
  isSubmitting = false,
}: {
  transfer: StockTransfer | null;
  onClose: () => void;
  onApprove?: (transfer: StockTransfer) => void;
  onComplete?: (transfer: StockTransfer) => void;
  onCancel?: (transfer: StockTransfer) => void;
  isSubmitting?: boolean;
}) {
  const stateInfo = transfer ? TRANSFER_STATE_MAP[transfer.state] : undefined;
  const stateColor = stateInfo?.palette
    ? STAT_PALETTE[stateInfo.palette as keyof typeof STAT_PALETTE] ?? STAT_PALETTE.gray
    : STAT_PALETTE.gray;

  if (!transfer) return null;

  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.modal}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>
              {transfer.transfer_number ?? `Transferencia #${transfer.id.slice(0, 8)}`}
            </Text>
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: stateColor.bg, borderColor: stateColor.color },
                ]}
              >
                <Text style={[styles.statusBadgeText, { color: stateColor.color }]}>
                  {stateInfo?.label ?? TRANSFER_STATE_LABELS[transfer.state]}
                </Text>
              </View>
            </View>
          </View>
          <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
            <Icon name="x" size={22} color={colorScales.gray[500]} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Origin → Destination */}
          <View style={styles.routeCard}>
            <View style={styles.routeItem}>
              <Icon name="map-pin" size={16} color={colorScales.red[500]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>ORIGEN</Text>
                <Text style={styles.routeValue}>{transfer.origin_location_name}</Text>
              </View>
            </View>
            <View style={styles.routeArrow}>
              <Icon name="arrow-right" size={16} color={colorScales.gray[400]} />
            </View>
            <View style={styles.routeItem}>
              <Icon name="map-pin" size={16} color={colorScales.green[500]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeLabel}>DESTINO</Text>
                <Text style={styles.routeValue}>{transfer.destination_location_name}</Text>
              </View>
            </View>
          </View>

          {/* Dates grid */}
          <View style={styles.datesGrid}>
            <View style={styles.dateCell}>
              <View style={styles.dateLabelRow}>
                <Icon name="calendar" size={14} color={colorScales.gray[500]} />
                <Text style={styles.dateLabel}>FECHA</Text>
              </View>
              <Text style={styles.dateValue}>
                {transfer.transfer_date ? formatDate(transfer.transfer_date) : '—'}
              </Text>
            </View>
            <View style={styles.dateCell}>
              <View style={styles.dateLabelRow}>
                <Icon name="clock" size={14} color={colorScales.gray[500]} />
                <Text style={styles.dateLabel}>ESPERADA</Text>
              </View>
              <Text style={styles.dateValue}>
                {transfer.expected_date ? formatDate(transfer.expected_date) : '—'}
              </Text>
            </View>
          </View>

          {/* Items section */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Icon name="package" size={14} color={colorScales.gray[500]} />
              <Text style={styles.sectionTitle}>ITEMS ({transfer.items_count ?? transfer.product_count ?? 0})</Text>
            </View>
            <View style={styles.itemsInfo}>
              <Text style={styles.itemsInfoText}>
                {transfer.items_count ?? transfer.product_count ?? 0} productos en esta transferencia
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Footer: contextual actions */}
        <View style={styles.footer}>
          {transfer.state === 'pending' && onCancel ? (
            <>
              <Pressable
                style={[styles.dangerBtn, isSubmitting && styles.btnDisabled]}
                onPress={() => onCancel(transfer)}
                disabled={isSubmitting}
              >
                <Text style={styles.dangerBtnText}>Cancelar</Text>
              </Pressable>
              <View style={{ width: spacing[2] }} />
              {onApprove ? (
                <Pressable
                  style={[styles.primaryBtn, isSubmitting && styles.btnDisabled]}
                  onPress={() => onApprove(transfer)}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Spinner size="sm" />
                  ) : (
                    <Icon name="check" size={16} color={colors.background} />
                  )}
                  <Text style={styles.primaryBtnText}>
                    {isSubmitting ? 'Aprobando…' : 'Aprobar'}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : transfer.state === 'in_transit' && onComplete ? (
            <Pressable
              style={[styles.primaryBtn, isSubmitting && styles.btnDisabled]}
              onPress={() => onComplete(transfer)}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Spinner size="sm" />
              ) : (
                <Icon name="package-check" size={16} color={colors.background} />
              )}
              <Text style={styles.primaryBtnText}>
                {isSubmitting ? 'Recibiendo…' : 'Recibir'}
              </Text>
            </Pressable>
          ) : (
            <Pressable style={styles.outlineBtn} onPress={onClose}>
              <Text style={styles.outlineBtnText}>Cerrar</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  modal: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1, borderColor: colorScales.gray[200],
    width: '100%', maxWidth: 520, maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[4],
    borderBottomWidth: 1, borderBottomColor: colorScales.gray[100],
  },
  title: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900] },
  badgeRow: { flexDirection: 'row', gap: spacing[1.5], marginTop: spacing[2], flexWrap: 'wrap' as any },
  statusBadge: {
    paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  statusBadgeText: { fontSize: 10, fontWeight: '700' as any, textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  closeBtn: { padding: spacing[1] },
  body: { flexGrow: 0, flexShrink: 1, maxHeight: 480 },
  bodyContent: { padding: spacing[4], gap: spacing[4] },
  routeCard: {
    flexDirection: 'column',
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1, borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
    gap: spacing[2],
  },
  routeItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  routeArrow: { alignItems: 'center', paddingVertical: spacing[1] },
  routeLabel: { fontSize: 9, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  routeValue: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[900], marginTop: 2 },
  datesGrid: { flexDirection: 'row', gap: spacing[3] },
  dateCell: { flex: 1, gap: spacing[1] },
  dateLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  dateLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  dateValue: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colorScales.gray[900] },
  section: { gap: spacing[2] },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  sectionTitle: { fontSize: 11, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  itemsInfo: {
    padding: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.md,
    borderWidth: 1, borderColor: colorScales.gray[200],
  },
  itemsInfoText: { fontSize: 12, color: colorScales.gray[700] },
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2],
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    borderTopWidth: 1, borderTopColor: colorScales.gray[200],
    backgroundColor: colorScales.gray[50],
  },
  dangerBtn: {
    flex: 1, paddingVertical: 12, borderRadius: borderRadius.lg, borderWidth: 1.5, borderColor: colorScales.red[500], alignItems: 'center', justifyContent: 'center',
  },
  dangerBtnText: { fontSize: 14, fontWeight: '700' as any, color: colorScales.red[600] },
  outlineBtn: { flex: 1, paddingVertical: 12, borderRadius: borderRadius.lg, borderWidth: 1.5, borderColor: colorScales.gray[300], alignItems: 'center', justifyContent: 'center' },
  outlineBtnText: { fontSize: 14, fontWeight: '700' as any, color: colorScales.gray[700] },
  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2],
    paddingVertical: 12, borderRadius: borderRadius.lg, backgroundColor: colors.primary,
  },
  btnDisabled: { opacity: 0.5 },
  primaryBtnText: { fontSize: 14, fontWeight: '700' as any, color: colors.background },
});
