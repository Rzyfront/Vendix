import { useState, useMemo } from 'react';
import { View, ScrollView, Text, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { StatsCard } from '@/shared/components/stats-card/stats-card';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { DashboardService, AnalyticsService } from '@/features/store/services';
import type { DatePreset } from '@/features/store/types';
import { colors } from '@/shared/theme/colors';

const PRESETS: { label: string; value: DatePreset }[] = [
  { label: 'Hoy', value: 'today' },
  { label: 'Ayer', value: 'yesterday' },
  { label: 'Esta Semana', value: 'thisWeek' },
  { label: 'Este Mes', value: 'thisMonth' },
  { label: 'Este Año', value: 'thisYear' },
];

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
  const [preset, setPreset] = useState<DatePreset>('thisMonth');
  const dateRange = useMemo(() => presetToDateRange(preset), [preset]);

  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useQuery({
    queryKey: ['sales-summary', preset],
    queryFn: () => AnalyticsService.getSalesSummary(dateRange),
  });

  const { data: trends } = useQuery({
    queryKey: ['sales-trends', preset],
    queryFn: () => AnalyticsService.getSalesTrends(dateRange),
  });

  const { data: stats } = useQuery({
    queryKey: ['store-stats'],
    queryFn: () => DashboardService.getStats(),
  });

  const { data: inventory } = useQuery({
    queryKey: ['inventory-summary'],
    queryFn: () => AnalyticsService.getInventorySummary(),
  });

  if (summaryError) {
    toastError('Error cargando datos del dashboard');
  }

  const chartData = useMemo(() => {
    if (!trends?.length) return [];
    return trends.map((t) => ({
      x: t.period.slice(5),
      revenue: t.revenue,
      orders: t.orders,
    }));
  }, [trends]);

  const alerts = useMemo(() => {
    const items: { label: string; count: number; color: string }[] = [];
    if (stats?.dispatchPendingCount) {
      items.push({ label: 'Despachos pendientes', count: stats.dispatchPendingCount, color: colors.warning });
    }
    if (stats?.refundPendingCount) {
      items.push({ label: 'Reembolsos pendientes', count: stats.refundPendingCount, color: colors.warning });
    }
    if (inventory?.low_stock_count) {
      items.push({ label: 'Stock bajo', count: inventory.low_stock_count, color: colors.warning });
    }
    if (inventory?.out_of_stock_count) {
      items.push({ label: 'Sin stock', count: inventory.out_of_stock_count, color: colors.error });
    }
    return items;
  }, [stats, inventory]);

  return (
    <View className="flex-1 bg-background">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-6">
        <View className="px-4 pt-2">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
            {PRESETS.map((p) => (
              <Pressable
                key={p.value}
                onPress={() => setPreset(p.value)}
                className={`mr-2 rounded-full px-4 py-2 ${
                  preset === p.value ? 'bg-primary' : 'bg-card'
                }`}
              >
                <Text
                  className={`text-sm font-medium ${
                    preset === p.value ? 'text-white' : 'text-text'
                  }`}
                >
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {summaryLoading ? (
            <View className="items-center justify-center py-12">
              <Spinner />
            </View>
          ) : summary ? (
            <View className="mb-4 grid grid-cols-2 gap-3">
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
              <StatsCard
                label="Ticket Promedio"
                value={formatCurrency(summary.average_order_value)}
                icon={<Icon name="trending-up" size={18} color={colors.primary} />}
              />
              <StatsCard
                label="Clientes"
                value={summary.total_customers.toLocaleString()}
                icon={<Icon name="home" size={18} color={colors.primary} />}
              />
            </View>
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de ventas" />
          )}

          <Card className="mb-4">
            <Card.Header title="Tendencia de Ventas" />
            <Card.Body>
              {chartData.length > 0 ? (
                <View className="gap-2">
                  {chartData.map((d) => (
                    <View key={d.x} className="flex-row items-center justify-between py-1">
                      <Text className="text-sm text-text-secondary">{d.x}</Text>
                      <Text className="text-sm font-medium text-text">
                        {formatCurrency(d.revenue)} ({d.orders} órdenes)
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <EmptyState title="Sin datos" description="Sin datos de tendencia" />
              )}
            </Card.Body>
          </Card>

          {alerts.length > 0 && (
            <Card className="mb-4">
              <Card.Header title="Alertas">
              </Card.Header>
              <Card.Body>
                {alerts.map((alert) => (
                  <View
                    key={alert.label}
                    className="flex-row items-center justify-between border-b border-border py-3 last:border-b-0"
                  >
                    <View className="flex-row items-center gap-3">
                      <View
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: alert.color }}
                      />
                      <Text className="text-sm text-text">{alert.label}</Text>
                    </View>
                    <Text className="text-sm font-semibold text-text">{alert.count}</Text>
                  </View>
                ))}
              </Card.Body>
            </Card>
          )}
        </View>
      </ScrollView>
    </View>
  );
};

export default DashboardScreen;
