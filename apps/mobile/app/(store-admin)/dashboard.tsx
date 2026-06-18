import { useState, useMemo, useCallback } from 'react';
import { View, ScrollView, Text, Pressable, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
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
import { TrendChartFallback, ChannelListFallback } from '@/shared/components/chart/chart-fallback';

const PRESETS: { label: string; value: DatePreset }[] = [
  { label: 'Hoy', value: 'today' },
  { label: 'Ayer', value: 'yesterday' },
  { label: 'Esta Semana', value: 'thisWeek' },
  { label: 'Semana Pasada', value: 'lastWeek' },
  { label: 'Este Mes', value: 'thisMonth' },
  { label: 'Mes Pasado', value: 'lastMonth' },
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
    paddingBottom: spacing[6],
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
  alertsBody: {
    gap: spacing[2],
  },
  alertCallout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[3],
    borderRadius: borderRadius.lg,
  },
  alertLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    flex: 1,
  },
  alertIconWrapper: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertLabelText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    flex: 1,
  },
  chartContainer: {
    minHeight: 120,
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
    justifyContent: 'space-between',
    rowGap: spacing[2],
  },
  quickLinkItem: {
    width: '48%',
  },
  quickLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[3.5],
    paddingHorizontal: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    minHeight: 48,
  },
  quickLinkText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.primary,
    flex: 1,
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
    const items: {
      label: string;
      count: number;
      color: string;
      bgColor: string;
      iconBgColor: string;
      icon: string;
      route: string;
    }[] = [];
    if (inventory?.low_stock_count) {
      items.push({
        label: 'bajo stock',
        count: inventory.low_stock_count,
        color: colors.warning,
        bgColor: colorScales.amber[50],
        iconBgColor: colorScales.amber[100],
        icon: 'alert-triangle',
        route: '/analytics/inventory',
      });
    }
    if (inventory?.out_of_stock_count) {
      items.push({
        label: 'agotados',
        count: inventory.out_of_stock_count,
        color: colors.error,
        bgColor: colorScales.red[50],
        iconBgColor: colorScales.red[100],
        icon: 'x-circle',
        route: '/analytics/inventory',
      });
    }
    if (stats?.dispatchPendingCount) {
      items.push({
        label: 'listas para despachar',
        count: stats.dispatchPendingCount,
        color: colors.primary,
        bgColor: colors.primaryLight,
        iconBgColor: '#e8f8f0',
        icon: 'truck',
        route: '/orders?status=processing',
      });
    }
    if (stats?.refundPendingCount) {
      items.push({
        label: 'reembolsos pendientes',
        count: stats.refundPendingCount,
        color: colorScales.blue[600],
        bgColor: colorScales.blue[50],
        iconBgColor: colorScales.blue[100],
        icon: 'rotate-ccw',
        route: '/orders?status=refunded',
      });
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

  const quickLinks = [
    { label: 'Resumen de Ventas', icon: 'trending-up', route: '/analytics/sales' },
    { label: 'Ventas por Producto', icon: 'package', route: '/analytics/products' },
    { label: 'Órdenes', icon: 'shopping-cart', route: '/orders' },
    { label: 'Stock Info', icon: 'alert-triangle', route: '/analytics/inventory' },
    { label: 'Gastos', icon: 'credit-card', route: '/expenses' },
    { label: 'Clientes', icon: 'users', route: '/customers' },
    { label: 'Compras', icon: 'shopping-bag', route: '/inventory/pop' },
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
            <StatsGrid
              style={styles.statsGridOverride}
              items={[
                {
                  label: 'Ingresos',
                  value: formatCurrency(summary.total_revenue),
                  icon: <Icon name="dollar-sign" size={14} color={colors.primary} />,
                  iconBg: '#e8f8f0',
                  iconColor: colors.primary,
                  trend:
                    summary.revenue_growth != null
                      ? { value: summary.revenue_growth, positive: summary.revenue_growth >= 0 }
                      : undefined,
                },
                {
                  label: 'Órdenes',
                  value: summary.total_orders.toLocaleString(),
                  icon: <Icon name="shopping-cart" size={14} color={colorScales.blue[500]} />,
                  iconBg: colorScales.blue[50],
                  iconColor: colorScales.blue[500],
                  trend:
                    summary.orders_growth != null
                      ? { value: summary.orders_growth, positive: summary.orders_growth >= 0 }
                      : undefined,
                },
                {
                  label: 'Ticket Prom.',
                  value: formatCurrency(summary.average_order_value || 0),
                  icon: <Icon name="receipt" size={14} color={colorScales.blue[600]} />,
                  iconBg: colorScales.blue[50],
                  iconColor: colorScales.blue[600],
                  description: `${summary.total_units_sold || 0} uds. vendidas`,
                },
                {
                  label: 'Clientes',
                  value: (summary.total_customers || 0).toLocaleString(),
                  icon: <Icon name="users" size={14} color={colorScales.amber[600]} />,
                  iconBg: colorScales.amber[50],
                  iconColor: colorScales.amber[600],
                  description: 'clientes únicos',
                },
              ]}
            />
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de ventas" />
          )}

          <Card style={styles.chartCard}>
            <Card.Header title="Tendencia de Ventas" />
            <Card.Body>
              {chartData.length > 0 ? (
                <View style={styles.chartContainer}>
                  <TrendChartFallback data={chartData} />
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
                  <ChannelListFallback data={channelChartData} />
                </View>
              </Card.Body>
            </Card>
          )}

          <Card style={styles.alertsCard}>
            <Card.Header title="Alertas Operativas" />
            <Card.Body style={styles.alertsBody}>
              {alerts.length > 0 ? (
                alerts.map((alert) => (
                  <Pressable
                    key={alert.label}
                    style={({ pressed }) => [
                      styles.alertCallout,
                      { backgroundColor: alert.bgColor },
                      pressed && { opacity: 0.8 },
                    ]}
                    onPress={() => router.push(alert.route as any)}
                  >
                    <View style={styles.alertLeft}>
                      <View style={[styles.alertIconWrapper, { backgroundColor: alert.iconBgColor }]}>
                        <Icon name={alert.icon as any} size={14} color={alert.color} />
                      </View>
                      <Text style={[styles.alertLabelText, { color: alert.color }]} numberOfLines={1}>
                        {alert.count} {alert.label}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={14} color={alert.color} style={{ opacity: 0.6 }} />
                  </Pressable>
                ))
              ) : (
                <EmptyState title="Todo en orden" description="Sin alertas pendientes" />
              )}
            </Card.Body>
          </Card>

          <Card style={styles.quickLinksCard}>
            <Card.Header title="Accesos Rápidos" />
            <Card.Body>
              <View style={styles.quickLinksGrid}>
                {quickLinks.map((link) => (
                  <View key={link.route} style={styles.quickLinkItem}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.quickLinkButton,
                        pressed && { backgroundColor: colorScales.gray[100] },
                      ]}
                      onPress={() => router.push(link.route as any)}
                    >
                      <Icon name={link.icon as any} size={16} color={colors.text.secondary} />
                      <Text style={styles.quickLinkText} numberOfLines={1}>{link.label}</Text>
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
