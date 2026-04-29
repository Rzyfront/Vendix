import { useState, useMemo, useCallback } from 'react';
import { View, ScrollView, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
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
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[900],
  },
  productDetail: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: spacing[0.5],
  },
  productRevenue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
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

const SalesScreen = () => {
  const [preset, setPreset] = useState<DatePreset>('thisMonth');
  const [refreshing, setRefreshing] = useState(false);
  const dateRange = useMemo(() => presetToDateRange(preset), [preset]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics-sales', preset],
    queryFn: () => AnalyticsDetailService.getSalesAnalytics(dateRange),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  if (isError) {
    toastError('Error cargando analíticas de ventas');
  }

  const trendData = useMemo(() => {
    if (!data?.trends?.length) return [];
    return data.trends.map((t) => ({
      period: t.period.slice(5),
      revenue: t.revenue,
    }));
  }, [data]);

  const trendFallbackData = useMemo(() => {
    if (!data?.trends?.length) return [];
    return data.trends.map((t) => ({
      x: t.period.slice(5),
      revenue: t.revenue,
    }));
  }, [data]);

  const channelData = useMemo(() => {
    if (!data?.by_channel?.length) return null;
    const channelColors: Record<string, string> = {
      pos: colorScales.blue[400],
      ecommerce: colorScales.green[400],
    };
    return data.by_channel.slice(0, 3).map((c) => ({
      value: c.revenue,
      color: channelColors[c.channel.toLowerCase()] || colorScales.gray[400],
      label: c.channel,
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
              <View style={styles.statsGrid}>
                <View style={styles.statsItem}>
                  <StatsCard
                    label="Ingresos"
                    value={formatCurrency(data.total_revenue)}
                    icon={<Icon name="trending-up" size={18} color={colors.primary} />}
                  />
                </View>
                <View style={styles.statsItem}>
                  <StatsCard
                    label="Órdenes"
                    value={data.total_orders.toLocaleString()}
                    icon={<Icon name="shopping-bag" size={18} color={colors.primary} />}
                  />
                </View>
                <View style={styles.statsItem}>
                  <StatsCard
                    label="Ticket Promedio"
                    value={formatCurrency(data.average_ticket)}
                    icon={<Icon name="dollar-sign" size={18} color={colorScales.blue[500]} />}
                  />
                </View>
                <View style={styles.statsItem}>
                  <StatsCard
                    label="Productos Vendidos"
                    value={data.total_products_sold.toLocaleString()}
                    icon={<Icon name="package" size={18} color={colors.warning} />}
                  />
                </View>
              </View>

              <Card style={styles.chartCard}>
                <Card.Header title="Tendencia de Ingresos" />
                <Card.Body>
                  {trendData.length > 0 ? (
                    <View style={styles.chartContainer}>
                      <SafeChart
                        fallback={<TrendChartFallback data={trendFallbackData} title="Tendencia de Ingresos" />}
                      >
                        <CartesianChart
                          data={trendData}
                          xKey="period"
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

              {channelData && (
                <Card style={styles.chartCard}>
                  <Card.Header title="Ventas por Canal" />
                  <Card.Body>
                    <View style={styles.chartContainer}>
                      {channelData.map((item, index) => (
                        <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: item.color }} />
                          <Text style={{ flex: 1, fontSize: 14, color: colors.text.primary }}>{item.label}</Text>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text.primary }}>{((item.value / channelData.reduce((s, i) => s + i.value, 0)) * 100).toFixed(0)}%</Text>
                        </View>
                      ))}
                    </View>
                  </Card.Body>
                </Card>
              )}

              {data.top_products?.length > 0 && (
                <Card style={styles.chartCard}>
                  <Card.Header title="Productos Más Vendidos" />
                  <Card.Body>
                    <FlatList
                      data={data.top_products}
                      keyExtractor={(item, i) => `${item.product_name}-${i}`}
                      scrollEnabled={false}
                      renderItem={({ item }) => (
                        <View style={styles.productRow}>
                          <View style={styles.productInfo}>
                            <Text style={styles.productName}>{item.product_name}</Text>
                            <Text style={styles.productDetail}>{item.quantity_sold} unidades</Text>
                          </View>
                          <Text style={styles.productRevenue}>{formatCurrency(item.revenue)}</Text>
                        </View>
                      )}
                    />
                  </Card.Body>
                </Card>
              )}
            </>
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de ventas para este período" />
          )}
        </View>
      </PullToRefresh>
    </View>
  );
};

export default SalesScreen;
