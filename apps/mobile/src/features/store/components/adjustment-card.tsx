import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { formatDate } from '@/shared/utils/date';
import { ADJUSTMENT_TYPE_LABELS } from '@/features/store/types';
import type { StockAdjustment } from '@/features/store/types';

interface AdjustmentCardProps {
  item: StockAdjustment;
  onView?: (item: StockAdjustment) => void;
}

/**
 * AdjustmentCard — card individual de la lista de Ajustes de Stock.
 * Misma estructura visual que la web:
 *  - Fila 1: Título del producto + badge del tipo de ajuste
 *  - Fila 2: Grid 2 col (FECHA | UBICACIÓN)
 *  - Fila 3: Footer con CAMBIO + botón (ver)
 */
export default function AdjustmentCard({ item, onView }: AdjustmentCardProps) {
  // Fallbacks seguros para evitar "[object Object]" si el backend devuelve un objeto en campos string
  const productName =
    typeof item.products?.name === 'string'
      ? item.products.name
      : typeof item.description === 'string'
      ? item.description
      : 'Producto sin nombre';
  const locationName =
    typeof item.inventory_locations?.name === 'string'
      ? item.inventory_locations.name
      : 'Sin ubicación';
  const typeLabel = ADJUSTMENT_TYPE_LABELS[item.adjustment_type] ?? 'Ajuste';
  const dateLabel = formatDate(item.created_at);
  const quantityChange = Number(item.quantity_change ?? 0);

  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        {/* Fila 1: Título + badge de tipo */}
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>{productName}</Text>
          <View style={styles.cardBadge}>
            <Text style={styles.cardBadgeText}>{typeLabel}</Text>
          </View>
        </View>

        {/* Fila 2: Grid 2 columnas — FECHA | UBICACIÓN */}
        <View style={styles.cardGrid}>
          <View style={styles.cardGridItem}>
            <Text style={styles.cardGridLabel}>FECHA</Text>
            <Text style={styles.cardGridValue}>{dateLabel}</Text>
          </View>
          <View style={styles.cardGridItem}>
            <Text style={styles.cardGridLabel}>UBICACIÓN</Text>
            <Text style={styles.cardGridValue} numberOfLines={1}>{locationName}</Text>
          </View>
        </View>

        {/* Fila 3: Footer con CAMBIO + botón (ver) */}
        <View style={styles.cardFooter}>
          <View style={styles.cardFooterLeft}>
            <Text style={styles.cardFooterLabel}>CAMBIO</Text>
            <Text style={styles.cardFooterValue}>{`${quantityChange}`}</Text>
          </View>
          {onView ? (
            <Pressable
              onPress={() => onView(item)}
              hitSlop={8}
              style={({ pressed }) => [styles.eyeBtn, pressed && { opacity: 0.6 }]}
              accessibilityLabel="Ver detalle del ajuste"
            >
              <Icon name="eye" size={16} color={colorScales.gray[500]} />
            </Pressable>
          ) : (
            <Icon name="map-pin" size={16} color={colorScales.gray[500]} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardBody: { padding: spacing[4] },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  cardTitle: {
    flex: 1,
    fontSize: typography.fontSize.base,
    fontWeight: '700' as any,
    color: colorScales.gray[900],
  },
  cardBadge: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.blue[50],
    borderWidth: 1,
    borderColor: colorScales.blue[100],
  },
  cardBadgeText: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.blue[700],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.3,
  },
  cardGrid: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  cardGridItem: { flex: 1, gap: 2 },
  cardGridLabel: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  cardGridValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
    color: colorScales.gray[900],
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  cardFooterLeft: { gap: 2 },
  cardFooterLabel: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  cardFooterValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: '800' as any,
    color: colorScales.gray[900],
  },
  eyeBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
