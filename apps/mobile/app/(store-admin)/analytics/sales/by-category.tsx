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
import { CategorySalesBarChart } from '@/features/store/components/category-sales-bar-chart';
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
    fontWeight: typography.fontWeight.semibold as any,
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
  // Wrapper inferior para mantener el border-bottom visual al migrar a ScrollableTabs.
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
  chartCard: {
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

const SALES_TABS: ScrollableTab[] = SALES_VIEWS.map((v) => ({
  id: v.key,
  label: v.title,
  icon: v.icon,
}));

const SalesByCategoryScreen = () => {
  const router = useRouter();
  const [dateRange, setDateRange] = useState<DateRangeFilterValue>(defaultDateRange);
  const [refreshing, setRefreshing] = useState(false);

  const apiRange = useMemo(() => ({
    start_date: dateRange.start_date,
    end_date: dateRange.end_date,
    preset: dateRange.preset as any,
  }), [dateRange]);

  const {
    data: categoriesData = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['analytics-sales-by-category', apiRange],
    queryFn: () => AnalyticsService.getSalesByCategory(apiRange),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  useEffect(() => {
    if (isError) toastError('Error cargando ventas por categoría');
  }, [isError]);

  const handleExport = useCallback(() => {
    toastSuccess('Exportación iniciada — Recibirás el reporte en tu correo');
  }, []);

  // Stats (paridad con web: getCategoryCount, getTotalRevenue, getTopCategoryName, getAvgRevenue).
  const totalRevenue = useMemo(
    () => categoriesData.reduce((sum, c) => sum + (c.revenue || 0), 0),
    [categoriesData],
  );

  const topCategoryName = useMemo(() => {
    if (categoriesData.length === 0) return '-';
    const sorted = [...categoriesData].sort((a, b) => b.revenue - a.revenue);
    const top = sorted[0];
    if (!top) return '-';
    return top.category_name.length > 15
      ? top.category_name.substring(0, 15) + '...'
      : top.category_name;
  }, [categoriesData]);

  return (
    <View style={styles.root}>
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <ScrollView style={styles.inner} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerBreadcrumb}>
                Ventas  /  Por Categoría
              </Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Ventas por Categoría
              </Text>
            </View>
          </View>

          {/* Tabs — paridad web. Componente compartido ScrollableTabs con
              auto-scroll al tab activo (paridad con web scroll-snap-align: center). */}
          <View style={styles.tabsWrapper}>
            <ScrollableTabs
              tabs={SALES_TABS}
              activeTab="sales_by_category"
              accentColor={colorScales.purple[600]}
              onTabChange={(key) => {
                const view = SALES_VIEWS.find((v) => v.key === key);
                if (!view || view.key === 'sales_by_category') return;
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
              {/* 4 Stats — paridad exacta con web sales-by-category.component.ts */}
              <StatsGrid
                style={styles.statsGridOverride}
                items={[
                  {
                    label: 'Total Categorías',
                    value: categoriesData.length.toString(),
                    icon: <Icon name="tag" size={14} color={colorScales.blue[600]} />,
                    iconBg: colorScales.blue[100],
                    iconColor: colorScales.blue[600],
                    description: 'categorías',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Total Ingresos',
                    value: formatCurrency(totalRevenue).replace('$ ', '$'),
                    icon: <Icon name="dollar-sign" size={14} color={colorScales.green[600]} />,
                    iconBg: colorScales.green[100],
                    iconColor: colorScales.green[600],
                    description: 'totales',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Categoría Top',
                    value: topCategoryName,
                    icon: <Icon name="trophy" size={14} color={colorScales.amber[600]} />,
                    iconBg: colorScales.amber[100],
                    iconColor: colorScales.amber[600],
                    description: 'mayor revenue',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Ingreso Promedio',
                    value:
                      categoriesData.length > 0
                        ? formatCurrency(totalRevenue / categoriesData.length).replace('$ ', '$')
                        : '-',
                    icon: <Icon name="bar-chart-2" size={14} color={colorScales.purple[600]} />,
                    iconBg: colorScales.purple[100],
                    iconColor: colorScales.purple[600],
                    description: 'por categoría',
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

              {/* Gráfico dual-bar — paridad exacta con web echarts */}
              <Card style={styles.chartCard}>
                <Card.Header
                  title="Distribución por Categoría"
                  subtitle={`${categoriesData.length} categorías en el período`}
                />
                <Card.Body>
                  {categoriesData.length === 0 ? (
                    <EmptyState title="Sin datos" description="No hay datos para el período seleccionado" />
                  ) : (
                    <CategorySalesBarChart categories={categoriesData} />
                  )}
                </Card.Body>
              </Card>

              {/* Vistas de Ventas — paridad web. Componente compartido responsive. */}
              <AnalyticsViewsCard views={getQuickLinks('sales_by_category')} />
            </>
          )}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
};

export default SalesByCategoryScreen;
