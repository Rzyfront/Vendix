/**
 * CuponStatsCards — 4 KPI cards para la pantalla lista de Cupones.
 *
 * Réplica el bloque stats del web `coupons.component.ts:44-80`:
 * 1. Total Cupones    (ticket, blue)
 * 2. Activos         (check-circle, green)
 * 3. Usos Totales    (bar-chart-2, purple)
 * 4. Descuento Appli (dollar-sign, amber + COP formatting)
 *
 * Pattern idéntico a PromotionStatsCards.
 */
import { useQuery } from '@tanstack/react-query';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Spinner } from '@/shared/components/spinner/spinner';
import { View, StyleSheet } from 'react-native';
import { spacing } from '@/shared/theme';
import { CouponsService } from '@/features/store/services/coupons.service';
import { formatCurrency } from '@/shared/utils/currency';
import { COUPON_LABELS } from '@/features/store/constants/coupon-labels';

export function CuponStatsCards() {
  const { data, isLoading } = useQuery({
    queryKey: ['coupon-stats'],
    queryFn: () => CouponsService.getStats(),
  });

  if (isLoading) {
    return (
      <View style={styles.loadingWrap}>
        <Spinner size="sm" />
      </View>
    );
  }

  const totalCoupons = data?.total_coupons ?? 0;
  const activeCoupons = data?.active_coupons ?? 0;
  const totalUses = data?.total_uses ?? 0;
  const totalDiscount = data?.total_discount_applied ?? 0;

  return (
    <StatsGrid
      items={[
        {
          label: COUPON_LABELS.statsTotalCoupons,
          value: totalCoupons,
          icon: 'ticket',
          iconBg: '#DBEAFE',
          iconColor: '#2563EB',
          smallText: COUPON_LABELS.statsSmallText,
          smallTextColor: '#2563EB',
        },
        {
          label: COUPON_LABELS.statsActiveCoupons,
          value: activeCoupons,
          icon: 'check-circle',
          iconBg: '#DCFCE7',
          iconColor: '#16A34A',
          smallText: COUPON_LABELS.statsActiveSmallText,
          smallTextColor: '#16A34A',
        },
        {
          label: COUPON_LABELS.statsTotalUses,
          value: totalUses,
          icon: 'bar-chart-2',
          iconBg: '#EDE9FE',
          iconColor: '#7C3AED',
          smallText: COUPON_LABELS.statsUsesSmallText,
          smallTextColor: '#7C3AED',
        },
        {
          label: COUPON_LABELS.statsDiscountApplied,
          value: formatCurrency(totalDiscount),
          icon: 'dollar-sign',
          iconBg: '#FEF3C7',
          iconColor: '#D97706',
          smallText: COUPON_LABELS.statsDiscountSmallText,
          smallTextColor: '#D97706',
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  loadingWrap: {
    paddingVertical: spacing[6],
    alignItems: 'center',
  },
});
