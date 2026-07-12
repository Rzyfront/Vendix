import { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Svg, { Path, Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
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
import { AnalyticsDetailService, AnalyticsService } from '@/features/store/services';
import { getQuickLinks, SALES_VIEWS } from '@/features/store/data/sales-views';
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
  // Wrapper inferior para que el border-bottom visual (debajo de los tabs)
  // se mantenga al migrar a ScrollableTabs (que ya no incluye border inferior).
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
    marginBottom: spacing[4],
  },
  chartContainer: {
    height: 220,
    paddingVertical: spacing[2],
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

// Quick Links — paridad web (sales-by-product.component.ts → salesViews).
// En la página de Resumen de Ventas se excluye `sales_summary` (la página actual)
// para no mostrar un link que navega a sí misma. Mismo patrón que web:
// `getViewsByCategory('sales').filter(v => v.key !== <current_view_key>)`.
const QUICK_LINKS = getQuickLinks('sales_summary');

// Tabs del menú horizontal — incluye la vista actual (que se renderiza como
// tab activo, no como link). Componente compartido ScrollableTabs ya tiene
// auto-scroll al tab activo (paridad con web scroll-snap-align: center).
const SALES_TABS: ScrollableTab[] = SALES_VIEWS.map((v) => ({
  id: v.key,
  label: v.title,
  icon: v.icon,
}));

const SalesScreen = () => {
  const router = useRouter();
  const [dateRange, setDateRange] = useState<DateRangeFilterValue>(defaultDateRange);
  const [refreshing, setRefreshing] = useState(false);

  const apiRange = useMemo(() => ({
    start_date: dateRange.start_date,
    end_date: dateRange.end_date,
    preset: dateRange.preset as any,
  }), [dateRange]);

  // Resumen de KPIs (4 stats)
  const {
    data: summary,
    isLoading: loadingSummary,
    isError: summaryError,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['analytics-sales', apiRange],
    queryFn: () => AnalyticsDetailService.getSalesAnalytics(apiRange),
  });

  // Tendencia de ingresos (chart)
  const {
    data: trends,
    isLoading: loadingTrends,
    refetch: refetchTrends,
  } = useQuery({
    queryKey: ['analytics-sales-trends', apiRange],
    queryFn: () => AnalyticsService.getSalesTrends(apiRange),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchSummary(), refetchTrends()]);
    setRefreshing(false);
  }, [refetchSummary, refetchTrends]);

  // toastError fuera del render para evitar warning React.
  useEffect(() => {
    if (summaryError) toastError('Error cargando analíticas de ventas');
  }, [summaryError]);

  const handleExport = useCallback(() => {
    // Backend no expone endpoint de export mobile-side todavía; mientras tanto,
    // notificamos al usuario. Cuando se implemente, llamar al endpoint de export.
    toastSuccess('Exportación iniciada — Recibirás el reporte en tu correo');
  }, []);

  return (
    <View style={styles.root}>
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <View style={styles.inner}>
          {/* Header — web parity 6.png */}
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerBreadcrumb}>
                Ventas  /  Resumen de Ventas
              </Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Resumen de Ventas
              </Text>
            </View>
          </View>

          {/* Menú horizontal de pestañas (Tabs) — paridad web 6.png.
              Componente compartido ScrollableTabs: auto-scroll al tab activo
              (paridad con web scroll-snap-align: center) y pill indicator
              inferior con el color de acento. */}
          <View style={styles.tabsWrapper}>
            <ScrollableTabs
              tabs={SALES_TABS}
              activeTab="sales_summary"
              accentColor={colorScales.green[600]}
              onTabChange={(key) => {
                const view = SALES_VIEWS.find((v) => v.key === key);
                if (!view || view.key === 'sales_summary') return;
                if (view.available) router.push(view.route as any);
                else toastError('Próximamente: esta vista estará disponible');
              }}
            />
          </View>

          {loadingSummary ? (
            <View style={styles.loaderContainer}>
              <Spinner />
            </View>
          ) : summary ? (
            <>
              {/* 4 stats — paridad exacta con web 6.png. */}
              <StatsGrid
                style={styles.statsGridOverride}
                items={[
                  {
                    label: 'Ingresos Totales',
                    value: formatCurrency(summary.total_revenue).replace('$ ', '$'),
                    icon: <Icon name="dollar-sign" size={14} color={colorScales.green[600]} />,
                    iconBg: colorScales.green[100],
                    iconColor: colorScales.green[600],
                    description:
                      summary.revenue_growth != null
                        ? `${summary.revenue_growth >= 0 ? '+' : ''}${summary.revenue_growth.toFixed(1)}% vs período anterior`
                        : undefined,
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Total Órdenes',
                    value: (summary.total_orders || 0).toLocaleString(),
                    icon: <Icon name="shopping-cart" size={14} color={colorScales.blue[600]} />,
                    iconBg: colorScales.blue[100],
                    iconColor: colorScales.blue[600],
                    description:
                      summary.orders_growth != null
                        ? `${summary.orders_growth >= 0 ? '+' : ''}${summary.orders_growth.toFixed(1)}% vs período anterior`
                        : undefined,
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Ticket Promedio',
                    value: formatCurrency(summary.average_order_value || 0).replace('$ ', '$'),
                    icon: <Icon name="receipt" size={14} color={colorScales.purple[600]} />,
                    iconBg: colorScales.purple[100],
                    iconColor: colorScales.purple[600],
                    description: 'Valor promedio por orden',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Unidades Vendidas',
                    value: (summary.total_units_sold || 0).toLocaleString(),
                    icon: <Icon name="package" size={14} color={colorScales.orange[600]} />,
                    iconBg: colorScales.orange[100],
                    iconColor: colorScales.orange[600],
                    description: 'Total en el período',
                    descriptionColor: colorScales.green[600],
                  },
                ]}
              />

              {/* Tarjeta de Filtros de Período — paridad web (idéntica en todas las
                  vistas de analytics: sales/summary, by-product, by-category, etc.).
                  Componente reutilizable con DateRangeFilter + 2 DatePickerField +
                  ExportButton. Layout responsive (DESDE/HASTA wrappean en
                  pantallas estrechas gracias a flexWrap + minWidth 130). */}
              <AnalyticsPeriodCard
                value={dateRange}
                onChange={setDateRange}
                onExport={handleExport}
              />

              {/* Gráfico de Tendencia de Ingresos — web parity (echarts line+area) */}
              <Card style={styles.chartCard}>
                <Card.Header
                  title="Tendencia de Ingresos"
                  subtitle="Evolución de ingresos en el período"
                />
                <Card.Body>
                  {loadingTrends ? (
                    <View style={styles.loaderContainer}>
                      <Spinner />
                    </View>
                  ) : trends && trends.length > 0 ? (
                    <View style={styles.chartContainer}>
                      <RevenueTrendChart trends={trends} />
                    </View>
                  ) : (
                    <EmptyState title="Sin datos" description="Sin datos de tendencia" />
                  )}
                </Card.Body>
              </Card>

              {/* Vistas de Ventas — paridad web (sales-by-product.component.ts →
                  <app-card> con grid grid-cols-2 md:grid-cols-4 de <app-analytics-card>).
                  Componente compartido AnalyticsViewsCard con grid responsive
                  (2 cols móvil / 4 cols tablet+). */}
              <AnalyticsViewsCard views={QUICK_LINKS} />
            </>
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de ventas para este período" />
          )}
        </View>
      </PullToRefresh>
    </View>
  );
};

// Mini componente de tendencia — placeholder que muestra puntos + área.
// Web usa ECharts line+area con gradient; mobile usa un canvas simple.
function RevenueTrendChart({ trends }: { trends: Array<{ period: string; revenue: number }> }) {
  const max = Math.max(1, ...trends.map((t) => t.revenue));
  const W = 360;
  const H = 200;
  const padX = 24;
  const padY = 24;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const stepX = trends.length > 1 ? innerW / (trends.length - 1) : 0;
  const points = trends.map((t, i) => ({
    x: padX + i * stepX,
    y: padY + innerH - (t.revenue / max) * innerH,
    label: t.period.slice(5), // MM-DD
    value: t.revenue,
  }));

  // Polyline path
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaPath = `${path} L ${points[points.length - 1].x} ${padY + innerH} L ${points[0].x} ${padY + innerH} Z`;

  return (
    <View>
      <Svg width={W} height={H}>
        <Defs>
          <SvgLinearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colorScales.green[500]} stopOpacity="0.3" />
            <Stop offset="100%" stopColor={colorScales.green[500]} stopOpacity="0.02" />
          </SvgLinearGradient>
        </Defs>
        {/* area fill */}
        <Path d={areaPath} fill="url(#grad)" />
        {/* line */}
        <Path d={path} stroke={colorScales.green[500]} strokeWidth={2} fill="none" />
        {/* dots */}
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill={colorScales.green[500]} />
        ))}
      </Svg>
    </View>
  );
}

export default SalesScreen;
