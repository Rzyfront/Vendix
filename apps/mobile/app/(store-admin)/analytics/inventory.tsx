import { useState, useMemo, useCallback } from 'react';
import { View, ScrollView, Text, Pressable, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { FlatList } from 'react-native';
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
  cardSection: {
    marginBottom: spacing[4],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[900],
  },
  rowDetail: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: spacing[0.5],
  },
  rowValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  stockWarning: {
    fontSize: typography.fontSize.xs,
    color: colors.warning,
  },
  stockDanger: {
    fontSize: typography.fontSize.xs,
    color: colors.error,
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

const InventoryScreen = () => {
  const [preset, setPreset] = useState<DatePreset>('thisMonth');
  const [refreshing, setRefreshing] = useState(false);
  const dateRange = useMemo(() => presetToDateRange(preset), [preset]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics-inventory', preset],
    queryFn: () => AnalyticsDetailService.getInventoryAnalytics(dateRange),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  if (isError) {
    toastError('Error cargando analíticas de inventario');
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
                    label: 'Total Productos',
                    value: data.total_products.toLocaleString(),
                    icon: <Icon name="package" size={14} color={colors.primary} />,
                  },
                  {
                    label: 'Valor Total',
                    value: formatCurrency(data.total_value),
                    icon: <Icon name="dollar-sign" size={14} color={colorScales.blue[500]} />,
                  },
                ]}
              />

              {data.top_movers?.length > 0 && (
                <Card style={styles.cardSection}>
                  <Card.Header title="Productos Más Movidos" />
                  <Card.Body>
                    <FlatList
                      data={data.top_movers}
                      keyExtractor={(item, i) => `${item.product_name}-${i}`}
                      scrollEnabled={false}
                      renderItem={({ item }) => (
                        <View style={styles.row}>
                          <View style={styles.rowInfo}>
                            <Text style={styles.rowTitle}>{item.product_name}</Text>
                            <Text style={styles.rowDetail}>Movimientos totales</Text>
                          </View>
                          <Text style={styles.rowValue}>{item.total_moved}</Text>
                        </View>
                      )}
                    />
                  </Card.Body>
                </Card>
              )}

              {data.low_stock_items?.length > 0 && (
                <Card style={styles.cardSection}>
                  <Card.Header title="Alertas de Stock Bajo" />
                  <Card.Body>
                    <FlatList
                      data={data.low_stock_items}
                      keyExtractor={(item, i) => `${item.product_name}-${i}`}
                      scrollEnabled={false}
                      renderItem={({ item }) => (
                        <View style={styles.row}>
                          <View style={styles.rowInfo}>
                            <Text style={styles.rowTitle}>{item.product_name}</Text>
                            <Text
                              style={
                                item.current_stock === 0
                                  ? styles.stockDanger
                                  : styles.stockWarning
                              }
                            >
                              {item.current_stock === 0
                                ? 'Sin stock'
                                : `${item.current_stock} / ${item.threshold} mínimo`}
                            </Text>
                          </View>
                          <Text style={styles.rowValue}>{item.current_stock}</Text>
                        </View>
                      )}
                    />
                  </Card.Body>
                </Card>
              )}
            </>
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de inventario para este período" />
          )}
        </View>
      </PullToRefresh>
    </View>
  );
};

export default InventoryScreen;
