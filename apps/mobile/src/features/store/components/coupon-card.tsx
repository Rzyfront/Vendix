/**
 * CuponCard — Card para FlatList de Cupones.
 *
 * Patrón visual (mirror del web ItemListCardConfig en coupons.component.ts:216-250):
 * - Header: nombre + badge estado (Activo/Inactivo) + menu de acciones
 * - Código (font mono) como subtitle
 * - Meta row: tipo de descuento + valor
 * - Footer: usos (current/max) + vigencia
 *
 * Acciones: Editar / Eliminar (sin state machine como promotions — solo is_active).
 */
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { RowActionsMenu, type RowAction } from '@/shared/components/row-actions-menu/row-actions-menu';
import { spacing, colorScales } from '@/shared/theme';
import type { Coupon } from '@/features/store/types/coupon.types';
import { COUPON_LABELS, formatDiscountValue } from '@/features/store/constants/coupon-labels';

export interface CuponCardProps {
  coupon: Coupon;
  onEdit: () => void;
  onDelete: () => void;
}

export function CuponCard({ coupon, onEdit, onDelete }: CuponCardProps) {
  const isActive = coupon.is_active;

  const actions: RowAction[] = [
    {
      key: 'edit',
      label: COUPON_LABELS.ctaEdit,
      icon: 'edit',
      variant: 'info',
      onPress: onEdit,
    },
    {
      key: 'delete',
      label: COUPON_LABELS.ctaDelete ?? 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      destructive: true,
      onPress: onDelete,
    },
  ];

  const discountDisplay = formatDiscountValue(
    Number(coupon.discount_value),
    coupon.discount_type,
  );

  const typeDisplay =
    coupon.discount_type === 'PERCENTAGE'
      ? COUPON_LABELS.typePercentage
      : COUPON_LABELS.typeFixed;

  const usesDisplay = coupon.max_uses
    ? `${coupon.current_uses}/${coupon.max_uses}`
    : `${coupon.current_uses}`;

  const validUntilDisplay = new Date(coupon.valid_until).toLocaleDateString('es-CO');

  return (
    <Card style={styles.cardMargin}>
      <View style={styles.cardHeader}>
        <View style={styles.flex1}>
          <Text style={styles.couponName}>{coupon.name}</Text>
          <Text style={styles.couponCode}>{coupon.code}</Text>
        </View>
        <Badge
          label={isActive ? COUPON_LABELS.badgeActive : COUPON_LABELS.badgeInactive}
          variant={isActive ? 'success' : 'neutral'}
          size="sm"
        />
        <RowActionsMenu actions={actions} />
      </View>

      <View style={styles.cardMetaRow}>
        <View style={styles.metaItem}>
          <Text style={styles.metaText}>{typeDisplay}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaText}>{discountDisplay}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaText}>
            {COUPON_LABELS.colUses}: {usesDisplay}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaText}>
            {COUPON_LABELS.colValidUntil}: {validUntilDisplay}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  cardMargin: {
    marginHorizontal: spacing[4],
    marginVertical: spacing[2],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  flex1: {
    flex: 1,
  },
  couponName: {
    fontWeight: '600',
    fontSize: 15,
    color: colorScales.gray[900],
  },
  couponCode: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  cardMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    paddingVertical: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    marginTop: spacing[2],
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaText: {
    fontSize: 12,
    color: colorScales.gray[600],
  },
});
