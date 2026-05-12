import { useState, useMemo, useCallback } from 'react';
import { View, ScrollView, Text, Pressable, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { CartesianChart, Line } from 'victory-native';
import { SafeChart, TrendChartFallback } from '@/shared/components/chart/chart-fallback';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { PullToRefresh } from '@/shared/components/pull-to-refresh/pull-to-refresh';
import { toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { AnalyticsDetailService } from '@/features/store/services';
import type { DatePreset } from '@/features/store/types';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

const PRESETS: { label: string; value: DatePreset }[] = [
  { label: 'Hoy', value: 'today' },
  { label: 'Esta Semana', value: 'thisWeek' },
  { label: 'Este Mes', value: 'thisMonth' },
  { label: 'Este Año', value: 'thisYear' },
];

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
  presetScroll: {
    marginBottom: spacing[4],
  },
  presetActive: {
    marginRight: spacing[2],
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colors.primary,
  },
  presetInactive: {
    marginRight: spacing[2],
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colors.card,
  },
  presetTextActive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.background,
  },
  presetTextInactive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.primary,
  },
  loaderContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[12],
  },
  statsGridOverride: {
    paddingHorizontal: 0,
    paddingTop: 0,
    marginBottom: spacing[4],
  },
  chartCard: {
    marginBottom: spacing[4],
  },
  chartContainer: {
    height: 200,
    marginVertical: spacing[2],
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing[4],
    marginTop: spacing[2],
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: borderRadius.full,
  },
  legendText: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
  },
});

function presetToDateRange(preset: DatePreset) {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const startOfWeek = (d: Date) => {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  };

  switch (preset) {
    case 'today':
      return { start_date: fmt(now), end_date: fmt(now), preset };
    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { start_date: fmt(y), end_date: fmt(y), preset };
    }
    case 'thisWeek':
      return { start_date: fmt(startOfWeek(new Date(now))), end_date: fmt(now), preset };
    case 'lastWeek': {
      const lw = new Date(now);
      lw.setDate(lw.getDate() - 7);
      return { start_date: fmt(startOfWeek(new Date(lw))), end_date: fmt(lw), preset };
    }
    case 'thisMonth':
      return { start_date: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), end_date: fmt(now), preset };
    case 'lastMonth': {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { start_date: fmt(lm), end_date: fmt(new Date(now.getFullYear(), now.getMonth(), 0)), preset };
    }
    case 'thisYear':
      return { start_date: fmt(new Date(now.getFullYear(), 0, 1)), end_date: fmt(now), preset };
    default:
      return { start_date: fmt(now), end_date: fmt(now), preset };
  }
}

const FinancialScreen = () => {
  const [preset, setPreset] = useState<DatePreset>('thisMonth');
  const [refreshing, setRefreshing] = useState(false);
  const dateRange = useMemo(() => presetToDateRange(preset), [preset]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics-financial', preset],
    queryFn: () => AnalyticsDetailService.getFinancialAnalytics(dateRange),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  if (isError) {
    toastError('Error cargando analíticas financieras');
  }

  const chartData = useMemo(() => {
    if (!data?.profit_loss_trends?.length) return [];
    return data.profit_loss_trends.map((t) => ({
      period: t.period.slice(5),
      revenue: t.revenue,
      expenses: t.expenses,
      profit: t.profit,
    }));
  }, [data]);

  const chartFallbackData = useMemo(() => {
    if (!data?.profit_loss_trends?.length) return [];
    return data.profit_loss_trends.map((t) => ({
      x: t.period.slice(5),
      revenue: t.revenue,
    }));
  }, [data]);

  return (
    <View style={styles.root}>
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <View style={styles.inner}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetScroll}>
            {PRESETS.map((p) => (
              <Pressable
                key={p.value}
                onPress={() => setPreset(p.value)}
                style={preset === p.value ? styles.presetActive : styles.presetInactive}
              >
                <Text style={preset === p.value ? styles.presetTextActive : styles.presetTextInactive}>
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {isLoading ? (
            <View style={styles.loaderContainer}>
              <Spinner />
            </View>
          ) : data ? (
            <>
              <StatsGrid
                style={styles.statsGridOverride}
                items={[
                  {
                    label: 'Ganancia Bruta',
                    value: formatCurrency(data.gross_profit),
                    icon: <Icon name="trending-up" size={14} color={colors.primary} />,
                  },
                  {
                    label: 'Ganancia Neta',
                    value: formatCurrency(data.net_profit),
                    icon: <Icon name="dollar-sign" size={14} color={colorScales.blue[500]} />,
                  },
                ]}
              />

              <Card style={styles.chartCard}>
                <Card.Header title="Tendencia Ganancias / Gastos" />
                <Card.Body>
                  {chartData.length > 0 ? (
                    <View style={styles.chartContainer}>
                      <SafeChart
                        fallback={<TrendChartFallback data={chartFallbackData} title="Tendencia Ganancias / Gastos" />}
                      >
                        <CartesianChart
                          data={chartData}
                          xKey="period"
                          yKeys={['revenue', 'expenses', 'profit']}
                          padding={{ top: 20, bottom: 40, left: 50, right: 20 }}
                          axisOptions={{
                            font: null,
                            tickCount: 5,
                            formatYLabel: (value: number) => formatCurrency(value),
                            lineColor: colors.cardBorder,
                            labelColor: colors.text.secondary,
                          }}
                        >
                          {({ points }: any) => (
                            <>
                              <Line points={points.revenue} color={colors.primary} strokeWidth={2} />
                              <Line points={points.expenses} color={colors.error} strokeWidth={2} />
                              <Line points={points.profit} color={colorScales.blue[500]} strokeWidth={2} />
                            </>
                          )}
                        </CartesianChart>
                      </SafeChart>
                      <View style={styles.legendRow}>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
                          <Text style={styles.legendText}>Ingresos</Text>
                        </View>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: colors.error }]} />
                          <Text style={styles.legendText}>Gastos</Text>
                        </View>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: colorScales.blue[500] }]} />
                          <Text style={styles.legendText}>Ganancia</Text>
                        </View>
                      </View>
                    </View>
                  ) : (
                    <EmptyState title="Sin datos" description="Sin datos de tendencia financiera" />
                  )}
                </Card.Body>
              </Card>
            </>
          ) : (
            <EmptyState title="Sin datos" description="No hay datos financieros para este período" />
          )}
        </View>
      </PullToRefresh>
    </View>
  );
};

export default FinancialScreen;
