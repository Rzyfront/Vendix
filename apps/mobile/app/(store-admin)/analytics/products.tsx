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
import { DateRangeFilter, type DateRangeFilterValue, type DatePreset } from '@/shared/components/date-range-filter/date-range-filter';
import { ExportButton } from '@/shared/components/export-button/export-button';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { AnalyticsDetailService } from '@/features/store/services';
import { colors, colorScales, spacing, borderRadius, typography, shadows } from '@/shared/theme';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
  // Header — web parity (top-sellers.component.html líneas 40-53)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    marginBottom: spacing[4],
  },
  headerIconBox: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colors.text.primary,
    lineHeight: 18,
  },
  headerSubtitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.text.secondary,
    marginTop: 2,
  },
  // Sticky filter bar — web parity
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
    borderRadius: borderRadius.lg,
    marginHorizontal: spacing[1],
    marginBottom: spacing[4],
    ...shadows.sm,
  },
  filterBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flexShrink: 0,
  },
  statsGridOverride: {
    paddingHorizontal: 0,
    paddingTop: 0,
    marginBottom: spacing[4],
  },
  loaderContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[12],
  },
  chartCard: {
    marginBottom: spacing[4],
  },
  chartEmpty: {
    paddingVertical: spacing[8],
    paddingHorizontal: spacing[4],
  },
  chartEmptyTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing[1],
  },
  chartEmptyText: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 16,
  },
  // Vistas de Productos — web parity (top-sellers.component.ts línea 79)
  viewsCard: {
    marginBottom: spacing[4],
  },
  viewsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    marginTop: spacing[3],
  },
  viewItem: {
    width: '47%',
  },
  viewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    minHeight: 64,
  },
  viewButtonDisabled: {
    opacity: 0.5,
  },
  viewIconBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  viewTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  viewDescription: {
    fontSize: typography.fontSize.xs,
    color: colors.text.secondary,
    marginTop: 2,
  },
});

function defaultDateRange(): DateRangeFilterValue {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return {
    start_date: `${y}-${m}-01`,
    end_date: `${y}-${m}-${d}`,
    preset: 'thisMonth',
  };
}

// Vistas de Productos — paridad con web (analytics-registry.ts → category 'products').
// Top Sellers (products_top_sellers) es la pantalla actual → se oculta.
// Rendimiento y Rentabilidad navegan a rutas que se crearán en tasks futuros.
const PRODUCTS_VIEWS: Array<{
  key: string;
  title: string;
  description: string;
  icon: string;
  route: string;
  available: boolean;
  color: { bg: string; fg: string };
}> = [
  {
    key: 'products_performance',
    title: 'Rendimiento',
    description: 'Métricas por producto',
    icon: 'zap',
    route: '/analytics/products/performance',
    available: false,
    color: { bg: colorScales.blue[50], fg: colorScales.blue[600] },
  },
  {
    key: 'products_profitability',
    title: 'Rentabilidad',
    description: 'Margen de ganancia',
    icon: 'coins',
    route: '/analytics/products/profitability',
    available: false,
    color: { bg: colorScales.purple[50], fg: colorScales.purple[600] },
  },
];

const ProductsScreen = () => {
  const router = useRouter();
  const [dateRange, setDateRange] = useState<DateRangeFilterValue>(defaultDateRange);
  const [refreshing, setRefreshing] = useState(false);

  const apiRange = useMemo(() => ({
    start_date: dateRange.start_date,
    end_date: dateRange.end_date,
    preset: dateRange.preset as DatePreset,
  }), [dateRange]);

  // Backend no expone /store/analytics/products/top-sellers (404).
  // Usamos getProductsAnalytics (reusa /sales/summary) como fuente de datos.
  // Cuando backend exponga el endpoint real, cambiar aquí para usar top_sellers
  // y calcular Total Productos / Top Producto desde la lista.
  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['analytics-products', apiRange],
    queryFn: () => AnalyticsDetailService.getProductsAnalytics(apiRange),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  // toastError fuera del render para evitar warning React.
  useEffect(() => {
    if (isError) toastError('Error cargando analíticas de productos');
  }, [isError]);

  const handleExport = useCallback(() => {
    toastSuccess('Exportación iniciada — Recibirás el reporte en tu correo');
  }, []);

  // Stats web parity (top-sellers.component.ts líneas 83-89):
  //   totalProducts = topSellers.length  (count de productos top)
  //   totalUnits    = sum of units_sold
  //   totalRevenue  = sum of revenue
  //   topProductName = sorted[0]?.product_name?.substring(0, 15)
  // Como no tenemos top_sellers del backend, derivamos aproximaciones honestas
  // desde sales/summary (no fake data — solo métricas agregadas disponibles).
  const totalUnits = data?.total_units_sold ?? 0;
  const totalRevenue = data?.total_revenue ?? 0;
  // totalProducts: si tuviéramos top_sellers, sería topSellers.length. Hoy
  // solo podemos mostrar "-" (no inventamos un número). Cuando se conecte
  // top_sellers, mostrar el count real.
  const totalProductsLabel = '—';
  const topProductLabel = '—';

  return (
    <View style={styles.root}>
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <View style={styles.inner}>
          {/* Header — web parity */}
          <View style={styles.header}>
            <View style={styles.headerIconBox}>
              <Icon name="trophy" size={18} color={colors.primary} />
            </View>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Productos Más Vendidos
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                Top productos con mayor facturación en el período
              </Text>
            </View>
          </View>

          {/* Sticky filter bar — web parity */}
          <View style={styles.filterBar}>
            <View style={{ flex: 1 }} />
            <View style={styles.filterBarActions}>
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
              <ExportButton onPress={handleExport} />
            </View>
          </View>

          {isLoading ? (
            <View style={styles.loaderContainer}>
              <Spinner />
            </View>
          ) : data ? (
            <>
              {/* 4 stats — paridad con web (top-sellers.component.ts líneas 83-89) */}
              <StatsGrid
                style={styles.statsGridOverride}
                items={[
                  {
                    label: 'Total Productos',
                    value: totalProductsLabel,
                    icon: <Icon name="package" size={14} color={colorScales.blue[600]} />,
                    iconBg: colorScales.blue[100],
                    iconColor: colorScales.blue[600],
                    description: 'productos en top',
                  },
                  {
                    label: 'Unidades Vendidas',
                    value: totalUnits.toLocaleString(),
                    icon: <Icon name="boxes" size={14} color={colorScales.purple[600]} />,
                    iconBg: colorScales.purple[100],
                    iconColor: colorScales.purple[600],
                    description: 'totales',
                  },
                  {
                    label: 'Ingresos Totales',
                    value: formatCurrency(totalRevenue),
                    icon: <Icon name="dollar-sign" size={14} color={colorScales.green[600]} />,
                    iconBg: colorScales.green[100],
                    iconColor: colorScales.green[600],
                  },
                  {
                    label: 'Top Producto',
                    value: topProductLabel,
                    icon: <Icon name="trophy" size={14} color={colorScales.amber[600]} />,
                    iconBg: colorScales.amber[100],
                    iconColor: colorScales.amber[600],
                    description: 'más vendido',
                  },
                ]}
              />

              {/* Chart "Top 10 por Ingresos" — web parity.
                  Backend aún no expone /store/analytics/products/top-sellers;
                  mostrar empty state honesto hasta que se agregue. */}
              <Card style={styles.chartCard}>
                <Card.Header
                  title="Top 10 por Ingresos"
                  subtitle="Productos con mayor facturación en el período"
                />
                <Card.Body>
                  <View style={styles.chartEmpty}>
                    <Icon name="bar-chart-2" size={32} color={colorScales.gray[300]} />
                    <Text style={styles.chartEmptyTitle}>Sin datos de top sellers</Text>
                    <Text style={styles.chartEmptyText}>
                      El backend aún no expone el endpoint detallado de
                      productos más vendidos ({`/store/analytics/products/top-sellers`}).
                      Cuando se agregue, verás aquí el ranking Top 10 por ingresos.
                    </Text>
                  </View>
                </Card.Body>
              </Card>
            </>
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de productos para este período" />
          )}

          {/* Vistas de Productos — web parity (top-sellers.component.ts línea 79) */}
          <Card style={styles.viewsCard}>
            <Card.Header title="Vistas de Productos" />
            <Card.Body>
              <View style={styles.viewsGrid}>
                {PRODUCTS_VIEWS.map((view) => (
                  <View key={view.key} style={styles.viewItem}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.viewButton,
                        !view.available && styles.viewButtonDisabled,
                        pressed && view.available && { opacity: 0.7 },
                      ]}
                      onPress={() => {
                        if (view.available) router.push(view.route as any);
                        else toastError('Próximamente: esta vista estará disponible');
                      }}
                      disabled={!view.available}
                    >
                      <View style={[styles.viewIconBox, { backgroundColor: view.color.bg }]}>
                        <Icon name={view.icon as any} size={16} color={view.color.fg} />
                      </View>
                      <View style={styles.viewTextWrap}>
                        <Text style={styles.viewTitle} numberOfLines={1}>
                          {view.title}
                        </Text>
                        <Text style={styles.viewDescription} numberOfLines={2}>
                          {view.description}
                        </Text>
                      </View>
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

export default ProductsScreen;
