import { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { PullToRefresh } from '@/shared/components/pull-to-refresh/pull-to-refresh';
import { ScrollableTabs, type ScrollableTab } from '@/shared/components/scrollable-tabs';
import { AnalyticsPeriodCard } from '@/shared/components/analytics-period-card/analytics-period-card';
import { AnalyticsViewsCard } from '@/shared/components/analytics-views-card/analytics-views-card';
import { type DateRangeFilterValue } from '@/shared/components/date-range-filter/date-range-filter';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { AnalyticsService } from '@/features/store/services';
import { TopProductsBarChart } from '@/features/store/components/top-products-bar-chart';
import { SALES_VIEWS, getQuickLinks } from '@/features/store/data/sales-views';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  inner: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing[4],
  },
  headerTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  headerBreadcrumb: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    lineHeight: 22,
  },
  // Wrapper inferior para que el border-bottom visual se mantenga al migrar
  // a ScrollableTabs (que ya no incluye border inferior en su layout base).
  tabsWrapper: {
    marginBottom: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
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
  productsCard: {
    marginBottom: spacing[6],
  },
});

function defaultDateRange(): DateRangeFilterValue {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const start = `${y}-${m}-01`;
  const today = `${y}-${m}-${d}`;
  return { start_date: start, end_date: today, preset: 'thisMonth' };
}

// Tabs del menú horizontal — incluye la vista actual como tab activo
// (no como link). Componente compartido ScrollableTabs tiene auto-scroll
// al tab activo (paridad con web scroll-snap-align: center).
const SALES_TABS: ScrollableTab[] = SALES_VIEWS.map((v) => ({
  id: v.key,
  label: v.title,
  icon: v.icon,
}));

const SalesByProductScreen = () => {
  const router = useRouter();
  const [dateRange, setDateRange] = useState<DateRangeFilterValue>(defaultDateRange);
  const [refreshing, setRefreshing] = useState(false);

  const apiRange = useMemo(() => ({
    start_date: dateRange.start_date,
    end_date: dateRange.end_date,
    preset: dateRange.preset as any,
  }), [dateRange]);

  const {
    data: productsData = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['analytics-sales-by-product', apiRange],
    queryFn: () => AnalyticsService.getSalesByProduct(apiRange),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  useEffect(() => {
    if (isError) toastError('Error cargando ventas por producto');
  }, [isError]);

  const handleExport = useCallback(() => {
    toastSuccess('Exportación iniciada — Recibirás el reporte en tu correo');
  }, []);

  const totalUnits = useMemo(() => {
    return productsData.reduce((sum, p) => sum + (p.units_sold || 0), 0);
  }, [productsData]);

  const totalRevenue = useMemo(() => {
    return productsData.reduce((sum, p) => sum + (p.revenue || 0), 0);
  }, [productsData]);

  const topProductName = useMemo(() => {
    if (productsData.length === 0) return '-';
    const sorted = [...productsData].sort((a, b) => (b.units_sold || 0) - (a.units_sold || 0));
    const top = sorted[0];
    if (!top) return '-';
    return top.product_name.length > 15
      ? top.product_name.substring(0, 15) + '…'
      : top.product_name;
  }, [productsData]);

  return (
    <View style={styles.root}>
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <ScrollView style={styles.inner} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerBreadcrumb}>
                Ventas  /  Por Producto
              </Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Ventas por Producto
              </Text>
            </View>
          </View>

          {/* Menú horizontal de pestañas (Tabs) — componente compartido
              ScrollableTabs con auto-scroll al tab activo y pill indicator
              inferior con el color de acento. */}
          <View style={styles.tabsWrapper}>
            <ScrollableTabs
              tabs={SALES_TABS}
              activeTab="sales_by_product"
              accentColor={colorScales.blue[600]}
              onTabChange={(key) => {
                const view = SALES_VIEWS.find((v) => v.key === key);
                if (!view || view.key === 'sales_by_product') return;
                if (view.available) router.push(view.route as any);
                else toastError('Próximamente: esta vista estará disponible');
              }}
            />
          </View>

          {isLoading ? (
            <View style={styles.loaderContainer}>
              <Spinner />
            </View>
          ) : (
            <>
              {/* 4 Stats Cards */}
              <StatsGrid
                style={styles.statsGridOverride}
                items={[
                  {
                    label: 'Total Productos',
                    value: productsData.length.toString(),
                    icon: <Icon name="package" size={14} color={colorScales.blue[600]} />,
                    iconBg: colorScales.blue[100],
                    iconColor: colorScales.blue[600],
                    description: 'productos en el período',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Unidades Vendidas',
                    value: totalUnits.toLocaleString(),
                    icon: <Icon name="boxes" size={14} color={colorScales.purple[600]} />,
                    iconBg: colorScales.purple[100],
                    iconColor: colorScales.purple[600],
                    description: 'totales',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Ingresos Totales',
                    value: formatCurrency(totalRevenue),
                    icon: <Icon name="dollar-sign" size={14} color={colorScales.green[600]} />,
                    iconBg: colorScales.green[100],
                    iconColor: colorScales.green[600],
                    description: 'totales',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Producto Más Vendido',
                    value: topProductName,
                    icon: <Icon name="award" size={14} color={colorScales.amber[600]} />,
                    iconBg: colorScales.amber[100],
                    iconColor: colorScales.amber[600],
                    description: 'más vendido',
                    descriptionColor: colorScales.green[600],
                  },
                ]}
              />

              {/* Filtros de Fecha — componente compartido idéntico en todas las
                  vistas de analytics (sales/summary, by-product, by-category, etc.).
                  DateRangeFilter + 2 DatePickerField interactivos + ExportButton.
                  Layout responsive: DESDE/HASTA wrappean en pantallas estrechas. */}
              <AnalyticsPeriodCard
                value={dateRange}
                onChange={setDateRange}
                onExport={handleExport}
              />

              {/* Gráfico de Productos Vendidos — paridad exacta con web (echarts bar chart) */}
              <Card style={styles.productsCard}>
                <Card.Header
                  title="Productos Vendidos"
                  subtitle={`${productsData.length} productos en el período`}
                />
                <Card.Body>
                  {productsData.length === 0 ? (
                    <EmptyState title="Sin ventas" description="No hay productos vendidos en este período" />
                  ) : (
                    <TopProductsBarChart products={productsData} />
                  )}
                </Card.Body>
              </Card>

              {/* Vistas de Ventas — paridad web. Componente compartido responsive. */}
              <AnalyticsViewsCard views={getQuickLinks('sales_by_product')} />
            </>
          )}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
};

export default SalesByProductScreen;
