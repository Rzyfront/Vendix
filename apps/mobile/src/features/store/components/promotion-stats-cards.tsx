import { useQuery } from '@tanstack/react-query';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Spinner } from '@/shared/components/spinner/spinner';
import { View, StyleSheet } from 'react-native';
import { spacing } from '@/shared/theme';
import { PromotionsService } from '@/features/store/services/promotions.service';
import { formatCurrency } from '@/shared/utils/currency';
import { PROMOTION_LABELS } from '@/features/store/constants/promotion-labels';

/**
 * 4 stats cards sticky-top para la pantalla lista de Promociones:
 * 1. Activas (count)
 * 2. Programadas (count)
 * 3. Total descuentos (currency formateado por currency-formatting)
 * 4. Usos totales (count)
 *
 * Replica el bloque stats del web `promotions.component.ts:42-84`.
 * Si la query falla, retorna stats en cero (NO rompe la lista).
 */
export function PromotionStatsCards() {
  const { data, isLoading } = useQuery({
    queryKey: ['promotion-stats'],
    queryFn: () => PromotionsService.getSummary(),
  });

  if (isLoading) {
    return (
      <View style={styles.loadingWrap}>
        <Spinner size="sm" />
      </View>
    );
  }

  const totalActive = data?.total_active ?? 0;
  const totalScheduled = data?.total_scheduled ?? 0;
  const totalDiscount = data?.total_discount_given ?? 0;
  const totalUsage = data?.total_usage ?? 0;

  return (
    <StatsGrid
      items={[
        {
          label: PROMOTION_LABELS.statsActive,
          value: totalActive,
          icon: 'zap',
          iconBg: '#FEF3C7',
          iconColor: '#D97706',
        },
        {
          label: PROMOTION_LABELS.statsScheduled,
          value: totalScheduled,
          icon: 'clock',
          iconBg: '#DBEAFE',
          iconColor: '#2563EB',
        },
        {
          label: PROMOTION_LABELS.statsTotalDiscount,
          value: formatCurrency(totalDiscount),
          icon: 'dollar-sign',
          iconBg: '#DCFCE7',
          iconColor: '#16A34A',
        },
        {
          label: PROMOTION_LABELS.statsTotalUsage,
          value: totalUsage,
          icon: 'bar-chart-3',
          iconBg: '#EDE9FE',
          iconColor: '#7C3AED',
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
