import { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { PullToRefresh } from '@/shared/components/pull-to-refresh/pull-to-refresh';
import { toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { AnalyticsDetailService } from '@/features/store/services';
import { colors, colorScales, spacing, typography } from '@/shared/theme';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
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
  footerRow: {
    paddingTop: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  footerText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    textAlign: 'center',
  },
});

const InventoryScreen = () => {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics-inventory'],
    queryFn: () => AnalyticsDetailService.getInventoryAnalytics(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // toastError fuera del render para evitar warning React.
  useEffect(() => {
    if (isError) toastError('Error cargando analíticas de inventario');
  }, [isError]);

  return (
    <View style={styles.root}>
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <View style={styles.inner}>
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
                    label: 'Total SKUs',
                    value: (data.total_sku_count || 0).toLocaleString(),
                    icon: <Icon name="package" size={14} color={colors.primary} />,
                  },
                  {
                    label: 'Valor Stock',
                    value: formatCurrency(data.total_stock_value || 0),
                    icon: <Icon name="dollar-sign" size={14} color={colorScales.blue[500]} />,
                  },
                  {
                    label: 'Unidades en mano',
                    value: (data.total_quantity_on_hand || 0).toLocaleString(),
                    icon: <Icon name="boxes" size={14} color={colorScales.amber[600]} />,
                  },
                  {
                    label: '% Stock Bajo',
                    value: `${(data.low_stock_percentage || 0).toFixed(1)}%`,
                    icon: <Icon name="alert-triangle" size={14} color={colors.warning} />,
                    description: `${data.low_stock_count || 0} SKUs`,
                  },
                ]}
              />

              {(data.low_stock_count > 0 || data.out_of_stock_count > 0) && (
                <Card style={styles.cardSection}>
                  <Card.Header title="Alertas de Stock" />
                  <Card.Body>
                    <View style={styles.row}>
                      <View style={styles.rowInfo}>
                        <Text style={styles.rowTitle}>Stock bajo</Text>
                        <Text style={styles.rowDetail}>SKUs por debajo del umbral mínimo</Text>
                      </View>
                      <Text style={[styles.rowValue, styles.stockWarning]}>
                        {data.low_stock_count}
                      </Text>
                    </View>
                    <View style={[styles.row, { borderBottomWidth: 0 }]}>
                      <View style={styles.rowInfo}>
                        <Text style={styles.rowTitle}>Agotados</Text>
                        <Text style={styles.rowDetail}>SKUs sin stock disponible</Text>
                      </View>
                      <Text style={[styles.rowValue, styles.stockDanger]}>
                        {data.out_of_stock_count}
                      </Text>
                    </View>
                    {data.out_of_stock_percentage != null && (
                      <View style={styles.footerRow}>
                        <Text style={styles.footerText}>
                          {data.out_of_stock_percentage.toFixed(1)}% del catálogo agotado
                        </Text>
                      </View>
                    )}
                  </Card.Body>
                </Card>
              )}
            </>
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de inventario" />
          )}
        </View>
      </PullToRefresh>
    </View>
  );
};

export default InventoryScreen;
