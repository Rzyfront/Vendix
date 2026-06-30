import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { formatDate } from '@/shared/utils/date';
import { TRANSFER_STATE_LABELS, TRANSFER_STATE_MAP } from '@/features/store/constants/inventory-labels';
import { STAT_PALETTE } from '@/features/store/constants/inventory-icons';
import type { StockTransfer } from '@/features/store/types';

interface TransferCardProps {
  item: StockTransfer;
  onView?: (item: StockTransfer) => void;
}

/**
 * TransferCard — card individual de la lista de Transferencias.
 * Misma estructura visual que la web:
 *  - Header: ID (transfer_number) + badge de status
 *  - Subtitle: origen → destino
 *  - Detail grid: Fecha | Esperada
 *  - Footer: items count + botón (ver)
 */
export default function TransferCard({ item, onView }: TransferCardProps) {
  const displayId = item.transfer_number ?? `Transferencia #${item.id.slice(0, 8)}`;
  const stateInfo = TRANSFER_STATE_MAP[item.state];
  const stateColor = stateInfo?.palette
    ? STAT_PALETTE[stateInfo.palette as keyof typeof STAT_PALETTE] ?? STAT_PALETTE.gray
    : STAT_PALETTE.gray;
  const itemsCount = item.items_count ?? item.product_count ?? 0;

  return (
    <View style={styles.transferCard}>
      {/* Header: title (transfer_number) + status badge */}
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {displayId}
        </Text>
        <View
          style={[
            styles.statusBadge,
            { backgroundColor: stateColor.bg, borderColor: stateColor.color },
          ]}
        >
          <Text style={[styles.statusBadgeText, { color: stateColor.color }]}>
            {(stateInfo?.label ?? TRANSFER_STATE_LABELS[item.state]).toLowerCase()}
          </Text>
        </View>
      </View>

      {/* Subtitle: origin → destination */}
      <Text style={styles.cardSubtitle} numberOfLines={1}>
        {item.origin_location_name} {item.origin_location_name && item.destination_location_name ? '→' : ''}{' '}
        {item.destination_location_name}
      </Text>

      {/* Detail grid: Fecha | Esperada */}
      <View style={styles.cardDetailGrid}>
        <View style={styles.cardDetailCell}>
          <View style={styles.cardDetailLabelRow}>
            <Icon name="calendar" size={12} color={colorScales.gray[400]} />
            <Text style={styles.cardDetailLabel}>FECHA</Text>
          </View>
          <Text style={styles.cardDetailValue}>
            {item.transfer_date ? formatDate(item.transfer_date) : '—'}
          </Text>
        </View>
        <View style={styles.cardDetailCell}>
          <View style={styles.cardDetailLabelRow}>
            <Icon name="clock" size={12} color={colorScales.gray[400]} />
            <Text style={styles.cardDetailLabel}>ESPERADA</Text>
          </View>
          <Text style={styles.cardDetailValue}>
            {item.expected_date ? formatDate(item.expected_date) : '—'}
          </Text>
        </View>
      </View>

      {/* Footer: items count + view (eye) button */}
      <View style={styles.cardFooter}>
        <View style={styles.cardFooterCell}>
          <Text style={styles.cardDetailLabel}>ITEMS</Text>
          <Text style={styles.cardFooterValue}>{itemsCount}</Text>
        </View>
        {onView ? (
          <Pressable
            onPress={() => onView(item)}
            hitSlop={6}
            style={({ pressed }) => [styles.eyeBtn, pressed && { opacity: 0.6 }]}
            accessibilityLabel="Ver detalle de transferencia"
          >
            <Icon name="eye" size={16} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  transferCard: {
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    padding: spacing[4],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing[2] },
  cardTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900], flex: 1 },
  statusBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700' as any,
    textTransform: 'lowercase' as any,
    letterSpacing: 0.3,
  },
  cardSubtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: spacing[2] },
  cardDetailGrid: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  cardDetailCell: { flex: 1, gap: spacing[1] },
  cardDetailLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  cardDetailLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], letterSpacing: 0.5, textTransform: 'uppercase' as any },
  cardDetailValue: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[900] },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[3],
  },
  cardFooterCell: { gap: 2 },
  cardFooterValue: { fontSize: typography.fontSize.lg, fontWeight: '800' as any, color: colorScales.gray[900] },
  eyeBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
