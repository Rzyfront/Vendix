import { Pressable, View, StyleSheet } from 'react-native';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { ListItem } from '@/shared/components/list-item/list-item';
import { Icon } from '@/shared/components/icon/icon';
import { RowActionsMenu, type RowAction } from '@/shared/components/row-actions-menu/row-actions-menu';
import { formatCurrency } from '@/shared/utils/currency';
import { spacing, colorScales } from '@/shared/theme';
import type { Promotion } from '@/features/store/types/promotions.types';
import {
  PROMOTION_LABELS,
  PROMOTION_STATE_BADGE_VARIANT,
  PROMOTION_STATE_LABEL,
  PROMOTION_TYPE_LABEL,
  PROMOTION_SCOPE_LABEL,
  PROMOTION_RULE_TYPE_LABEL,
} from '@/features/store/constants/promotion-labels';

/**
 * Card item de la lista de promociones.
 *
 * Patrón visual:
 * - Tap → navega al detalle
 * - Header: nombre + badge de estado + código mono si existe
 * - Footer: tipo + valor formateado + usos + acciones contextuales
 *
 * Las acciones por fila se exponen en un `RowActionsMenu` (icono
 * `more-vertical`). Visibilidad según `state` (mismo web):
 *
 * - `Edit`: siempre
 * - `Activate`: `state IN [draft, scheduled, paused]`
 * - `Pause`: `state === active`
 * - `Cancel`: `state NOT IN [cancelled, expired]`
 * - `Delete`: `state === draft`
 *
 * Acciones destructivas (Cancel, Delete) usan `variant="danger"` en
 * el menu y abren confirmación externa (`ConfirmDialog`).
 */
export interface PromotionCardProps {
  promotion: Promotion;
  onPress: () => void;
  onEdit: () => void;
  onActivate: () => void;
  onPause: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

export function PromotionCard({
  promotion,
  onPress,
  onEdit,
  onActivate,
  onPause,
  onCancel,
  onDelete,
}: PromotionCardProps) {
  const state = promotion.state;
  const canActivate = ['draft', 'scheduled', 'paused'].includes(state);
  const canPause = state === 'active';
  const canCancel = !['cancelled', 'expired'].includes(state);
  const canDelete = state === 'draft';

  const actions: RowAction[] = [
    {
      key: 'edit',
      label: PROMOTION_LABELS.rowEdit,
      icon: 'edit',
      variant: 'info',
      onPress: onEdit,
    },
    {
      key: 'activate',
      label: PROMOTION_LABELS.rowActivate,
      icon: 'play',
      variant: 'primary',
      onPress: onActivate,
      visible: canActivate,
    },
    {
      key: 'pause',
      label: PROMOTION_LABELS.rowPause,
      icon: 'pause',
      variant: 'warning',
      onPress: onPause,
      visible: canPause,
    },
    {
      key: 'cancel',
      label: PROMOTION_LABELS.rowCancel,
      icon: 'x-circle',
      variant: 'danger',
      onPress: onCancel,
      visible: canCancel,
    },
    {
      key: 'delete',
      label: PROMOTION_LABELS.rowDelete,
      icon: 'trash-2',
      variant: 'danger',
      destructive: true,
      onPress: onDelete,
      visible: canDelete,
    },
  ];

  const valueDisplay =
    promotion.type === 'percentage'
      ? `${promotion.value}%`
      : formatCurrency(promotion.value);

  const usageDisplay = promotion.usage_limit
    ? `${promotion.usage_count}/${promotion.usage_limit}`
    : `${promotion.usage_count}`;

  return (
    <Pressable onPress={onPress}>
      <Card style={styles.cardMargin}>
        <View style={styles.cardHeader}>
          <View style={styles.flex1}>
            <ListItem title={promotion.name} subtitle={promotion.code ?? undefined} />
          </View>
          <Badge
            label={PROMOTION_STATE_LABEL[state]}
            variant={PROMOTION_STATE_BADGE_VARIANT[state]}
            size="sm"
          />
          <RowActionsMenu actions={actions} />
        </View>
        <View style={styles.cardMetaRow}>
          <View style={styles.metaItem}>
            <Icon name="tag" size={12} color={colorScales.gray[500]} />
            <ListItem title={PROMOTION_RULE_TYPE_LABEL[promotion.rule_type]} />
          </View>
          <View style={styles.metaItem}>
            <Icon name="percent" size={12} color={colorScales.gray[500]} />
            <ListItem title={PROMOTION_TYPE_LABEL[promotion.type]} />
          </View>
          <View style={styles.metaItem}>
            <Icon name="hash" size={12} color={colorScales.gray[500]} />
            <ListItem title={PROMOTION_SCOPE_LABEL[promotion.scope]} />
          </View>
        </View>
        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <ListItem title={valueDisplay} />
            <ListItem title={`Usos: ${usageDisplay}`} />
          </View>
        </View>
      </Card>
    </Pressable>
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
  cardMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    paddingVertical: spacing[2],
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    marginTop: spacing[2],
  },
  footerLeft: {
    flexDirection: 'row',
    gap: spacing[4],
  },
  flex1: {
    flex: 1,
  },
});
