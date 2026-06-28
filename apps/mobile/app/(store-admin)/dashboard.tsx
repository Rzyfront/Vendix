import { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { PullToRefresh } from '@/shared/components/pull-to-refresh/pull-to-refresh';
import { OptionsDropdown, type FilterConfig, type FilterValues } from '@/shared/components/options-dropdown/options-dropdown';
import { toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { DashboardService, AnalyticsService } from '@/features/store/services';
import type { DatePreset } from '@/features/store/types';
import { DashboardTrendChart } from '@/features/store/components/dashboard-trend-chart';
import { DashboardChannelPie } from '@/features/store/components/dashboard-channel-pie';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

// Paridad exacta con web (dashboard.component.ts → presetOptions).
// Se usa en el OptionsDropdown dentro del chart card header.
const PRESET_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'thisWeek', label: 'Esta Semana' },
  { value: 'lastWeek', label: 'Semana Pasada' },
  { value: 'thisMonth', label: 'Este Mes' },
  { value: 'lastMonth', label: 'Mes Pasado' },
  { value: 'thisYear', label: 'Este Año' },
  { value: 'lastYear', label: 'Año Pasado' },
  { value: 'custom', label: 'Personalizado' },
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
  // Web parity: p-4 — paridad con `<div class="p-4 flex-1">` del chart card body
  chartBody: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
  },
  alertsCard: {
    marginBottom: spacing[4],
  },
  alertsBody: {
    padding: spacing[3],
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
  quickLinksCard: {
    marginBottom: spacing[4],
  },
  // Web parity: p-3 (12px) — override Card.Body default (16px)
  quickLinksBody: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  // Web parity: p-3 grid grid-cols-2 gap-1 (12px padding, 4px gap, 2 cols)
  quickLinksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  quickLinkItem: {
    width: '50%',
    padding: 2, // half of gap-1 (4px) on each side → 4px between buttons
  },
  // Web parity: flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-primary/5 rounded-lg
  quickLinkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2], // gap-2 (8px) icon→text
    paddingVertical: spacing[2.5], // py-2.5 (10px)
    paddingHorizontal: spacing[3], // px-3 (12px)
    backgroundColor: 'transparent',
    borderRadius: borderRadius.md, // rounded-lg (8px) = md in this theme
  },
  quickLinkText: {
    fontSize: typography.fontSize.sm, // text-sm (14px)
    fontWeight: typography.fontWeight.normal,
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
    queryFn: () => AnalyticsService.getSalesTrends(dateRange, 'day'),
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

  // Web parity: etiqueta legible del rango seleccionado (paridad con `dateRangeLabel` web)
  const dateRangeLabel = useMemo(() => {
    const fmt = (iso: string) => {
      const d = new Date(iso + 'T12:00:00');
      return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    };
    return `${fmt(dateRange.start_date)} - ${fmt(dateRange.end_date)}`;
  }, [dateRange]);

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

  const quickLinks = [
    { label: 'Resumen de Ventas', icon: 'trending-up', route: '/analytics/sales' },
    { label: 'Ventas por Producto', icon: 'package', route: '/analytics/products' },
    { label: 'Órdenes', icon: 'shopping-cart', route: '/orders' },
    { label: 'Stock Info', icon: 'alert-triangle', route: '/analytics/inventory' },
    { label: 'Gastos', icon: 'credit-card', route: '/expenses' },
    { label: 'Clientes', icon: 'users', route: '/customers' },
    { label: 'Compras', icon: 'shopping-bag', route: '/inventory/pop' },
  ];

  // Paridad con web (dashboard.component.ts → dateFilters / dateFilterValues).
  // OptionsDropdown para filtrar el período del chart — se muestra en el chart card header.
  const dateFilters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'preset',
        label: 'Período',
        type: 'select',
        options: PRESET_OPTIONS,
        placeholder: 'Seleccionar período',
      },
    ],
    [],
  );

  const dateFilterValues = useMemo<FilterValues>(
    () => ({ preset }),
    [preset],
  );

  const onDateFilterChange = useCallback((values: FilterValues) => {
    const next = values['preset'] as DatePreset | null;
    if (!next) return;
    setPreset(next);
  }, []);

  // toastError fuera del render para evitar warning React.
  useEffect(() => {
    if (summaryError) toastError('Error cargando datos del dashboard');
  }, [summaryError]);

  return (
    <View style={styles.root}>
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <View style={styles.inner}>
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
                  iconBg: `${colors.primary}1A`,
                  iconColor: colors.primary,
                  trend:
                    summary.revenue_growth != null
                      ? { value: summary.revenue_growth, positive: summary.revenue_growth >= 0 }
                      : undefined,
                },
                {
                  label: 'Ganancias',
                  value: formatCurrency(summary.total_profit ?? 0),
                  icon: <Icon name="trending-up" size={14} color={colors.success} />,
                  iconBg: `${colors.success}1A`,
                  iconColor: colors.success,
                  trend:
                    summary.profit_growth != null
                      ? { value: summary.profit_growth, positive: summary.profit_growth >= 0 }
                      : undefined,
                },
                {
                  label: 'Órdenes',
                  value: summary.total_orders.toLocaleString(),
                  icon: <Icon name="shopping-cart" size={14} color={colorScales.emerald[600]} />,
                  iconBg: `${colorScales.emerald[600]}1A`,
                  iconColor: colorScales.emerald[600],
                  trend:
                    summary.orders_growth != null
                      ? { value: summary.orders_growth, positive: summary.orders_growth >= 0 }
                      : undefined,
                },
                {
                  label: 'Gastos',
                  value: formatCurrency(summary.total_expenses ?? 0),
                  icon: <Icon name="credit-card" size={14} color={colorScales.cyan[500]} />,
                  iconBg: `${colorScales.cyan[500]}1A`,
                  iconColor: colorScales.cyan[500],
                  trend:
                    summary.expenses_growth != null
                      ? { value: summary.expenses_growth, positive: summary.expenses_growth >= 0 }
                      : undefined,
                },
              ]}
            />
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de ventas" />
          )}

          {/* Tendencia de Ventas — paridad con web (smooth area + bar dual-axis) */}
          <Card style={styles.chartCard}>
            <Card.Header
              title="Tendencia de Ventas"
              subtitle={dateRangeLabel}
              right={
                <OptionsDropdown
                  filters={dateFilters}
                  filterValues={dateFilterValues}
                  filtersTitle="Período"
                  showActions={false}
                  debounceMs={0}
                  onFilterChange={onDateFilterChange}
                />
              }
            />
            <Card.Body style={styles.chartBody}>
              {trends && trends.length > 0 ? (
                <DashboardTrendChart data={trends} />
              ) : (
                <EmptyState title="No hay datos de ventas" description="Realiza ventas para ver las tendencias" />
              )}
            </Card.Body>
          </Card>

          {/* Ventas por Canal — paridad con web (rose pie chart) */}
          {channelData && channelData.length > 0 && (
            <Card style={styles.chartCard}>
              <Card.Header
                title="Ventas por Canal"
                subtitle="Distribución del período"
              />
              <Card.Body style={styles.chartBody}>
                <DashboardChannelPie channels={channelData} />
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
            <Card.Body style={styles.quickLinksBody}>
              <View style={styles.quickLinksGrid}>
                {quickLinks.map((link) => (
                  <View key={link.route} style={styles.quickLinkItem}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.quickLinkButton,
                        pressed && { backgroundColor: 'rgba(46, 204, 113, 0.05)' }, // hover:bg-primary/5
                      ]}
                      onPress={() => router.push(link.route as any)}
                    >
                      <Icon name={link.icon as any} size={15} color={colors.text.secondary} />
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