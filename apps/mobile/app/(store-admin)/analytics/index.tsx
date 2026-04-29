import { useState, useMemo, useCallback } from 'react';
import { View, ScrollView, Text, Pressable, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { CartesianChart, Line } from 'victory-native';
import { SafeChart, TrendChartFallback } from '@/shared/components/chart/chart-fallback';
import { StatsCard } from '@/shared/components/stats-card/stats-card';
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing[4],
    gap: spacing[3],
  },
  statsItem: {
    width: '48%',
  },
  chartCard: {
    marginBottom: spacing[4],
  },
  chartContainer: {
    height: 200,
    marginVertical: spacing[2],
  },
  gaugeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
  },
  gaugeLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
    marginTop: spacing[2],
  },
  gaugeValue: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: '700',
    color: colorScales.gray[900],
  },
  quickLinksCard: {
    marginBottom: spacing[4],
  },
  quickLinksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
  },
  quickLinkItem: {
    width: '48%',
  },
  quickLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    minHeight: 56,
  },
  quickLinkText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
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

function getGaugeColor(ratio: number): string {
  if (ratio <= 0.7) return colors.primary;
  if (ratio <= 0.9) return colors.warning;
  return colors.error;
}

const OverviewScreen = () => {
  const router = useRouter();
  const [preset, setPreset] = useState<DatePreset>('thisMonth');
  const [refreshing, setRefreshing] = useState(false);
  const dateRange = useMemo(() => presetToDateRange(preset), [preset]);

  const { data: summary, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics-overview', preset],
    queryFn: () => AnalyticsDetailService.getOverviewSummary(dateRange),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  if (isError) {
    toastError('Error cargando analíticas');
  }

  const expenseRatio = summary ? summary.total_revenue > 0 ? summary.total_expenses / summary.total_revenue : 0 : 0;
  const profitMargin = summary?.profit_margin ?? 0;
  const gaugeColor = getGaugeColor(expenseRatio);

  const comparativeData = useMemo(() => {
    if (!summary) return [];
    return [
      { period: 'Ingresos', value: summary.total_revenue },
      { period: 'Gastos', value: summary.total_expenses },
      { period: 'Ganancia', value: summary.net_profit },
    ];
  }, [summary]);

  const comparativeFallbackData = useMemo(() => {
    if (!summary) return [];
    return [
      { x: 'Ingresos', revenue: summary.total_revenue },
      { x: 'Gastos', revenue: summary.total_expenses },
      { x: 'Ganancia', revenue: summary.net_profit },
    ];
  }, [summary]);

  const quickLinks = [
    { label: 'Ventas', icon: 'trending-up' as const, route: '/analytics/sales', bg: colorScales.green[50], border: colorScales.green[500], text: colorScales.green[700] },
    { label: 'Inventario', icon: 'package' as const, route: '/analytics/inventory', bg: colorScales.amber[50], border: colorScales.amber[500], text: colorScales.amber[700] },
    { label: 'Financiero', icon: 'dollar-sign' as const, route: '/analytics/financial', bg: colorScales.blue[50], border: colorScales.blue[500], text: colorScales.blue[700] },
    { label: 'Productos', icon: 'bar-chart' as const, route: '/analytics/products', bg: colorScales.gray[100], border: colorScales.gray[500], text: colorScales.gray[700] },
  ];

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
          ) : summary ? (
            <>
              <View style={styles.statsGrid}>
                <View style={styles.statsItem}>
                  <StatsCard
                    label="Ingresos Totales"
                    value={formatCurrency(summary.total_revenue)}
                    icon={<Icon name="trending-up" size={18} color={colors.primary} />}
                    trend={
                      summary.revenue_growth != null
                        ? { value: summary.revenue_growth, positive: summary.revenue_growth >= 0 }
                        : undefined
                    }
                  />
                </View>
                <View style={styles.statsItem}>
                  <StatsCard
                    label="Gastos Totales"
                    value={formatCurrency(summary.total_expenses)}
                    icon={<Icon name="wallet" size={18} color={colors.error} />}
                    trend={
                      summary.expense_growth != null
                        ? { value: summary.expense_growth, positive: summary.expense_growth <= 0 }
                        : undefined
                    }
                  />
                </View>
                <View style={styles.statsItem}>
                  <StatsCard
                    label="Impuestos"
                    value={formatCurrency(summary.total_taxes)}
                    icon={<Icon name="calculator" size={18} color={colorScales.blue[500]} />}
                  />
                </View>
                <View style={styles.statsItem}>
                  <StatsCard
                    label="Ganancia Neta"
                    value={formatCurrency(summary.net_profit)}
                    icon={<Icon name="dollar-sign" size={18} color={colors.primary} />}
                  />
                </View>
              </View>

              <Card style={styles.chartCard}>
                <Card.Header title="Margen de Ganancia" />
                <Card.Body>
                  <View style={styles.gaugeContainer}>
                    <Text style={styles.gaugeValue}>{profitMargin.toFixed(1)}%</Text>
                    <Text style={styles.gaugeLabel}>Margen de ganancia</Text>
                  </View>
                </Card.Body>
              </Card>

              <Card style={styles.chartCard}>
                <Card.Header title="Comparativo" />
                <Card.Body>
                  <View style={styles.chartContainer}>
                    <SafeChart
                      fallback={<TrendChartFallback data={comparativeFallbackData} title="Comparativo" />}
                    >
                      <CartesianChart
                        data={comparativeData}
                        xKey="period"
                        yKeys={['value']}
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
                          <Line points={points.value} color={colors.primary} strokeWidth={2} />
                        )}
                      </CartesianChart>
                    </SafeChart>
                  </View>
                </Card.Body>
              </Card>

              <Card style={styles.quickLinksCard}>
                <Card.Header title="Secciones" />
                <Card.Body>
                  <View style={styles.quickLinksGrid}>
                    {quickLinks.map((link) => (
                      <View key={link.route} style={styles.quickLinkItem}>
                        <Pressable
                          style={({ pressed }) => [
                            styles.quickLinkButton,
                            { backgroundColor: link.bg, borderColor: link.border },
                            pressed && { opacity: 0.7 },
                          ]}
                          onPress={() => router.push(link.route as any)}
                        >
                          <Icon name={link.icon} size={20} color={link.text} />
                          <Text style={[styles.quickLinkText, { color: link.text }]}>{link.label}</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </Card.Body>
              </Card>
            </>
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de analíticas para este período" />
          )}
        </View>
      </PullToRefresh>
    </View>
  );
};

export default OverviewScreen;
