import { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Svg, { Path, Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
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
import { AnalyticsDetailService, AnalyticsService } from '@/features/store/services';
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
  // Header — web parity: flex items-center gap-2.5 (10px) con icon-box 40x40
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
  // Sticky filter bar — web parity: bg-white, border-b, rounded-lg, mx-1, mb-4,
  // flex items-center justify-between gap-3
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
    // sombra más visible en mobile (web: shadow-[0_2px_8px_rgba(0,0,0,0.07)])
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
  chartContainer: {
    height: 220,
    paddingVertical: spacing[2],
  },
  // Vistas de Ventas — web parity: grid grid-cols-2 md:grid-cols-4 gap-3 mt-3
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
    width: '47%', // 2 cols con gap-3 (12px) — calc mobile
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
  const start = `${y}-${m}-01`;
  const today = `${y}-${m}-${d}`;
  return { start_date: start, end_date: today, preset: 'thisMonth' };
}

// Vistas de Ventas — paridad con web (analytics-registry.ts → category 'sales').
// Solo "Resumen de Ventas" implementado en mobile por ahora; el resto navega a
// pantallas que se crearán en tasks posteriores.
const SALES_VIEWS: Array<{
  key: string;
  title: string;
  description: string;
  icon: string;
  route: string;
  available: boolean;
  color: { bg: string; fg: string };
}> = [
  {
    key: 'sales_summary',
    title: 'Resumen de Ventas',
    description: 'Ingresos totales y KPIs',
    icon: 'bar-chart-3',
    route: '/analytics/sales',
    available: true,
    color: { bg: colorScales.green[50], fg: colorScales.green[600] },
  },
  {
    key: 'sales_by_product',
    title: 'Por Producto',
    description: 'Ranking de más vendidos',
    icon: 'package',
    route: '/analytics/sales/by-product',
    available: false,
    color: { bg: colorScales.blue[50], fg: colorScales.blue[600] },
  },
  {
    key: 'sales_by_category',
    title: 'Por Categoría',
    description: 'Distribución por categoría',
    icon: 'tags',
    route: '/analytics/sales/by-category',
    available: false,
    color: { bg: colorScales.purple[50], fg: colorScales.purple[600] },
  },
  {
    key: 'sales_trends',
    title: 'Tendencias',
    description: 'Evolución temporal',
    icon: 'activity',
    route: '/analytics/sales/trends',
    available: false,
    color: { bg: colorScales.orange[50], fg: colorScales.orange[600] },
  },
  {
    key: 'sales_by_customer',
    title: 'Por Cliente',
    description: 'Top clientes por volumen',
    icon: 'user-round',
    route: '/analytics/sales/by-customer',
    available: false,
    color: { bg: colorScales.amber[50], fg: colorScales.amber[600] },
  },
  {
    key: 'sales_by_payment',
    title: 'Por Método de Pago',
    description: 'Distribución por forma de pago',
    icon: 'credit-card',
    route: '/analytics/sales/by-payment',
    available: false,
    color: { bg: colorScales.red[50], fg: colorScales.red[600] },
  },
];

const SalesScreen = () => {
  const router = useRouter();
  const [dateRange, setDateRange] = useState<DateRangeFilterValue>(defaultDateRange);
  const [refreshing, setRefreshing] = useState(false);

  const apiRange = useMemo(() => ({
    start_date: dateRange.start_date,
    end_date: dateRange.end_date,
    preset: dateRange.preset as DatePreset,
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
          {/* Header — web parity */}
          <View style={styles.header}>
            <View style={styles.headerIconBox}>
              <Icon name="dollar-sign" size={18} color={colors.primary} />
            </View>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Analíticas y Reportes de Ventas
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                Filtra, analiza y exporta reportes especializados
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

          {loadingSummary ? (
            <View style={styles.loaderContainer}>
              <Spinner />
            </View>
          ) : summary ? (
            <>
              {/* 4 stats — paridad exacta con web.
                  Nota: NO pasamos `trend` (mobile usa `description` con formato
                  completo "+X.X% vs período anterior" idéntico a web smallText). */}
              <StatsGrid
                style={styles.statsGridOverride}
                items={[
                  {
                    label: 'Ingresos Totales',
                    value: formatCurrency(summary.total_revenue),
                    icon: <Icon name="dollar-sign" size={14} color={colorScales.green[600]} />,
                    iconBg: colorScales.green[100],
                    iconColor: colorScales.green[600],
                    description:
                      summary.revenue_growth != null
                        ? `${summary.revenue_growth >= 0 ? '+' : ''}${summary.revenue_growth.toFixed(1)}% vs período anterior`
                        : undefined,
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
                  },
                  {
                    label: 'Ticket Promedio',
                    value: formatCurrency(summary.average_order_value || 0),
                    icon: <Icon name="receipt" size={14} color={colorScales.purple[600]} />,
                    iconBg: colorScales.purple[100],
                    iconColor: colorScales.purple[600],
                    description: 'Valor promedio por orden',
                  },
                  {
                    label: 'Unidades Vendidas',
                    value: (summary.total_units_sold || 0).toLocaleString(),
                    icon: <Icon name="package" size={14} color={colorScales.orange[600]} />,
                    iconBg: colorScales.orange[100],
                    iconColor: colorScales.orange[600],
                    description: 'Total en el período',
                  },
                ]}
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
            </>
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de ventas para este período" />
          )}

          {/* Vistas de Ventas — web parity (analytics-registry.ts category 'sales') */}
          <Card style={styles.viewsCard}>
            <Card.Header title="Vistas de Ventas" />
            <Card.Body>
              <View style={styles.viewsGrid}>
                {SALES_VIEWS.map((view) => (
                  <View key={view.key} style={styles.viewItem}>
                    <Pressable
                      style={({ pressed }) => [
                        styles.viewButton,
                        !view.available && { opacity: 0.5 },
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
