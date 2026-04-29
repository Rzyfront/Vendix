import { useState, useMemo, useCallback } from 'react';
import { View, ScrollView, Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { CartesianChart, Line } from 'victory-native';
import { StatsCard } from '@/shared/components/stats-card/stats-card';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { PullToRefresh } from '@/shared/components/pull-to-refresh/pull-to-refresh';
import { toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { DashboardService, AnalyticsService } from '@/features/store/services';
import type { DatePreset } from '@/features/store/types';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';
import { SafeChart, TrendChartFallback, ChannelListFallback } from '@/shared/components/chart/chart-fallback';

const PRESETS: { label: string; value: DatePreset }[] = [
  { label: 'Hoy', value: 'today' },
  { label: 'Ayer', value: 'yesterday' },
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
  chartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[1],
  },
  chartLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.text.secondary,
  },
  chartValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.primary,
  },
  alertsCard: {
    marginBottom: spacing[4],
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  alertLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  alertDot: {
    height: 8,
    width: 8,
    borderRadius: borderRadius.full,
  },
  alertLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
  },
  alertCount: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  chartContainer: {
    height: 200,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[2],
  },
  channelDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  channelLabel: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
  },
  channelValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  alertPressable: {
    cursor: 'pointer',
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
    backgroundColor: colors.primaryLight,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    minHeight: 56,
  },
  quickLinkText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.primary,
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

const DashboardScreen = () => {
  const router = useRouter();
  const [preset, setPreset] = useState<DatePreset>('thisMonth');
  const [refreshing, setRefreshing] = useState(false);
  const dateRange = useMemo(() => presetToDateRange(preset), [preset]);

  const { data: summary, isLoading: summaryLoading, isError: summaryError, refetch: refetchSummary } = useQuery({
    queryKey: ['sales-summary', preset],
    queryFn: () => AnalyticsService.getSalesSummary(dateRange),
  });

  const { data: trends, refetch: refetchTrends } = useQuery({
    queryKey: ['sales-trends', preset],
    queryFn: () => AnalyticsService.getSalesTrends(dateRange),
  });

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['store-stats'],
    queryFn: () => DashboardService.getStats(),
  });

  const { data: inventory, refetch: refetchInventory } = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: () => AnalyticsService.getInventorySummary(),
  });

  const { data: channelData } = useQuery({
    queryKey: ['sales-by-channel', preset],
    queryFn: () => AnalyticsService.getSalesByChannel(dateRange),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchSummary(), refetchTrends(), refetchStats(), refetchInventory()]);
    setRefreshing(false);
  }, [refetchSummary, refetchTrends, refetchStats, refetchInventory]);

  const chartData = useMemo(() => {
    if (!trends?.length) return [];
    return trends.map((t) => ({
      x: t.period.slice(5),
      revenue: t.revenue,
      orders: t.orders,
    }));
  }, [trends]);

  const alerts = useMemo(() => {
    const items: { label: string; count: number; color: string; route: string }[] = [];
    if (stats?.dispatchPendingCount) {
      items.push({ label: 'Despachos pendientes', count: stats.dispatchPendingCount, color: colors.warning, route: '/orders?status=processing' });
    }
    if (stats?.refundPendingCount) {
      items.push({ label: 'Reembolsos pendientes', count: stats.refundPendingCount, color: colors.warning, route: '/orders?status=refunded' });
    }
    if (inventory?.low_stock_count) {
      items.push({ label: 'Stock bajo', count: inventory.low_stock_count, color: colors.warning, route: '/inventory' });
    }
    if (inventory?.out_of_stock_count) {
      items.push({ label: 'Sin stock', count: inventory.out_of_stock_count, color: colors.error, route: '/inventory' });
    }
    return items;
  }, [stats, inventory]);

  const channelChartData = useMemo(() => {
    if (!channelData?.length) return null;
    const channelColors: Record<string, string> = {
      pos: colorScales.blue[400],
      ecommerce: colorScales.green[400],
    };
    return channelData.slice(0, 3).map((c) => ({
      value: c.revenue,
      color: channelColors[c.channel.toLowerCase()] || colorScales.gray[400],
      label: c.channel,
    }));
  }, [channelData]);

  const screenWidth = Dimensions.get('window').width;
  const chartWidth = screenWidth - spacing[4] * 4;

  const quickLinks = [
    { label: 'Ventas', icon: 'bar-chart-2', route: '/analytics' },
    { label: 'Productos', icon: 'package', route: '/products' },
    { label: 'Órdenes', icon: 'shopping-bag', route: '/orders' },
    { label: 'Gastos', icon: 'wallet', route: '/expenses' },
  ];

  if (summaryError) {
    toastError('Error cargando datos del dashboard');
  }

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
                <Text
                  style={preset === p.value ? styles.presetTextActive : styles.presetTextInactive}
                >
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {summaryLoading ? (
            <View style={styles.loaderContainer}>
              <Spinner />
            </View>
          ) : summary ? (
            <View style={styles.statsGrid}>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Ingresos"
                  value={formatCurrency(summary.total_revenue)}
                  icon={<Icon name="dollar-sign" size={18} color={colors.primary} />}
                  trend={
                    summary.revenue_growth != null
                      ? { value: summary.revenue_growth, positive: summary.revenue_growth >= 0 }
                      : undefined
                  }
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Órdenes"
                  value={summary.total_orders.toLocaleString()}
                  icon={<Icon name="shopping-cart" size={18} color={colors.primary} />}
                  trend={
                    summary.orders_growth != null
                      ? { value: summary.orders_growth, positive: summary.orders_growth >= 0 }
                      : undefined
                  }
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Ticket Promedio"
                  value={formatCurrency(summary.average_order_value)}
                  icon={<Icon name="trending-up" size={18} color={colors.primary} />}
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Clientes"
                  value={summary.total_customers.toLocaleString()}
                  icon={<Icon name="home" size={18} color={colors.primary} />}
                />
              </View>
            </View>
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de ventas" />
          )}

          <Card style={styles.chartCard}>
            <Card.Header title="Tendencia de Ventas" />
            <Card.Body>
              {chartData.length > 0 ? (
                <View style={styles.chartContainer}>
                  <SafeChart
                    fallback={<TrendChartFallback data={chartData} />}
                  >
                    <CartesianChart
                      data={chartData}
                      xKey="x"
                      yKeys={['revenue']}
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
                        <Line points={points.revenue} color={colors.primary} strokeWidth={2} />
                      )}
                    </CartesianChart>
                  </SafeChart>
                </View>
              ) : (
                <EmptyState title="Sin datos" description="Sin datos de tendencia" />
              )}
            </Card.Body>
          </Card>

          {channelChartData && (
            <Card style={styles.chartCard}>
              <Card.Header title="Ventas por Canal" />
              <Card.Body>
                <View style={styles.chartContainer}>
                  <SafeChart
                    fallback={<ChannelListFallback data={channelChartData} />}
                  >
                    {channelChartData.map((item, index) => (
                      <View key={index} style={styles.channelRow}>
                        <View style={[styles.channelDot, { backgroundColor: item.color }]} />
                        <Text style={styles.channelLabel}>{item.label}</Text>
                        <Text style={styles.channelValue}>
                          {((item.value / channelChartData.reduce((s, i) => s + i.value, 0)) * 100).toFixed(0)}%
                        </Text>
                      </View>
                    ))}
                  </SafeChart>
                </View>
              </Card.Body>
            </Card>
          )}

          {alerts.length > 0 && (
            <Card style={styles.alertsCard}>
              <Card.Header title="Alertas" />
              <Card.Body>
                {alerts.map((alert) => (
                  <Pressable
                    key={alert.label}
                    style={({ pressed }) => [
                      styles.alertRow,
                      pressed && styles.alertPressable,
                    ]}
                    onPress={() => router.push(alert.route as any)}
                  >
                    <View style={styles.alertLeft}>
                      <View
                        style={[styles.alertDot, { backgroundColor: alert.color }]}
                      />
                      <Text style={styles.alertLabel}>{alert.label}</Text>
                    </View>
                    <Text style={styles.alertCount}>{alert.count}</Text>
                  </Pressable>
                ))}
              </Card.Body>
            </Card>
          )}

          <Card style={styles.quickLinksCard}>
            <Card.Header title="Accesos Rápidos" />
            <Card.Body>
              <View style={styles.quickLinksGrid}>
                {quickLinks.map((link) => (
                  <View key={link.route} style={styles.quickLinkItem}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.quickLinkButton,
                        pressed && { opacity: 0.7 },
                      ]}
                      onPress={() => router.push(link.route as any)}
                    >
                      <Icon name={link.icon as any} size={20} color={colors.primary} />
                      <Text style={styles.quickLinkText}>{link.label}</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            </Card.Body>
          </Card>
        </View>
      </PullToRefresh>
    </View>
  );
};

export default DashboardScreen;
