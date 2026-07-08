import { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
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
import {
  SalesTrendsCombinedChart,
  SalesTrendsAovChart,
} from '@/features/store/components/sales-trends-chart';
import { SALES_VIEWS, getQuickLinks } from '@/features/store/data/sales-views';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

type Granularity = 'day' | 'week' | 'month';

const GRANULARITY_OPTIONS: Array<{ value: Granularity; label: string }> = [
  { value: 'day', label: 'Diario' },
  { value: 'week', label: 'Semanal' },
  { value: 'month', label: 'Mensual' },
];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  inner: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[4] },
  headerTextWrap: { flex: 1, minWidth: 0 },
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
  statsGridOverride: { paddingHorizontal: 0, paddingTop: 0, marginBottom: spacing[4] },
  // Granularity selector — paridad con web `<app-selector size="sm">`.
  // `granularityField` y `granularityLabel` replican los estilos `field`/`label`
  // del AnalyticsPeriodCard para que el bloque GRANULARIDAD (inyectado como
  // children) respete el mismo spacing/tipografía que PERÍODO/DESDE/HASTA.
  granularityField: { gap: spacing[1.5] },
  granularityLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  granularityRow: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  granularityChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  granularityChipActive: {
    backgroundColor: colorScales.orange[50],
    borderColor: colorScales.orange[300],
  },
  granularityText: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium, color: colorScales.gray[600] },
  granularityTextActive: { color: colorScales.orange[700], fontWeight: typography.fontWeight.semibold },
  loaderContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[12] },
  chartCard: { marginBottom: spacing[6] },
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

function presetLabel(preset: string): string {
  const map: Record<string, string> = {
    today: 'Hoy',
    yesterday: 'Ayer',
    thisWeek: 'Esta Semana',
    lastWeek: 'Semana Pasada',
    thisMonth: 'Este Mes',
    lastMonth: 'Mes Pasado',
    thisYear: 'Este Año',
    lastYear: 'Año Pasado',
    custom: 'Personalizado',
  };
  return map[preset] || preset;
}

const SALES_TABS: ScrollableTab[] = SALES_VIEWS.map((v) => ({
  id: v.key,
  label: v.title,
  icon: v.icon,
}));

const SalesTrendsScreen = () => {
  const router = useRouter();
  const [dateRange, setDateRange] = useState<DateRangeFilterValue>(defaultDateRange);
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [refreshing, setRefreshing] = useState(false);

  const apiRange = useMemo(() => ({
    start_date: dateRange.start_date,
    end_date: dateRange.end_date,
    preset: dateRange.preset as any,
  }), [dateRange]);

  const {
    data: trends = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['analytics-sales-trends', apiRange, granularity],
    queryFn: () => AnalyticsService.getSalesTrends(apiRange, granularity),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  useEffect(() => {
    if (isError) toastError('Error cargando tendencias de ventas');
  }, [isError]);

  const handleExport = useCallback(() => {
    toastSuccess('Exportación iniciada — Recibirás el reporte en tu correo');
  }, []);

  // Stats — paridad con web (getTotalOrders, getTotalRevenue, getAvgOrder).
  const totalOrders = useMemo(
    () => trends.reduce((s, d) => s + (d.orders || 0), 0),
    [trends],
  );
  const totalRevenue = useMemo(
    () => trends.reduce((s, d) => s + (d.revenue || 0), 0),
    [trends],
  );
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const periodLabel = presetLabel(dateRange.preset);

  return (
    <View style={styles.root}>
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <ScrollView style={styles.inner} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerBreadcrumb}>Ventas / Tendencias</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Tendencias de Ventas
              </Text>
            </View>
          </View>

          {/* Tabs — componente compartido ScrollableTabs con auto-scroll al
              tab activo (paridad con web scroll-snap-align: center). */}
          <View style={styles.tabsWrapper}>
            <ScrollableTabs
              tabs={SALES_TABS}
              activeTab="sales_trends"
              accentColor={colorScales.orange[600]}
              onTabChange={(key) => {
                const view = SALES_VIEWS.find((v) => v.key === key);
                if (!view || view.key === 'sales_trends') return;
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
              {/* 4 Stats — paridad con web */}
              <StatsGrid
                style={styles.statsGridOverride}
                items={[
                  {
                    label: 'Período',
                    value: periodLabel,
                    icon: <Icon name="calendar" size={14} color={colorScales.blue[600]} />,
                    iconBg: colorScales.blue[100],
                    iconColor: colorScales.blue[600],
                    description: 'rango activo',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Total Órdenes',
                    value: totalOrders.toLocaleString(),
                    icon: <Icon name="shopping-cart" size={14} color={colorScales.purple[600]} />,
                    iconBg: colorScales.purple[100],
                    iconColor: colorScales.purple[600],
                    description: 'en el período',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Ingresos Total',
                    value: formatCurrency(totalRevenue).replace('$ ', '$'),
                    icon: <Icon name="dollar-sign" size={14} color={colorScales.green[600]} />,
                    iconBg: colorScales.green[100],
                    iconColor: colorScales.green[600],
                    description: 'suma del período',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Ticket Promedio',
                    value: formatCurrency(avgOrderValue).replace('$ ', '$'),
                    icon: <Icon name="receipt" size={14} color={colorScales.amber[600]} />,
                    iconBg: colorScales.amber[100],
                    iconColor: colorScales.amber[600],
                    description: 'promedio',
                    descriptionColor: colorScales.green[600],
                  },
                ]}
              />

              {/* Filtros + Granularidad + Descarga — período compartido con todas las
                  vistas de analytics. La sección GRANULARIDAD es específica de
                  Tendencias y se inyecta via `children` para mantener el wrapper
                  visualmente agrupado sin romper la consistencia entre vistas. */}
              <AnalyticsPeriodCard
                value={dateRange}
                onChange={setDateRange}
                onExport={handleExport}
              >
                {/* Granularidad — paridad con web `<app-selector>` (sales-trends.component.ts).
                    Wrapper field replica el spacing/gap del AnalyticsPeriodCard. */}
                <View style={styles.granularityField}>
                  <Text style={styles.granularityLabel}>GRANULARIDAD</Text>
                  <View style={styles.granularityRow}>
                    {GRANULARITY_OPTIONS.map((opt) => {
                      const isActive = granularity === opt.value;
                      return (
                        <Pressable
                          key={opt.value}
                          onPress={() => setGranularity(opt.value)}
                          style={({ pressed }) => [
                            styles.granularityChip,
                            isActive && styles.granularityChipActive,
                            pressed && { opacity: 0.85 },
                          ]}
                        >
                          <Text
                            style={[
                              styles.granularityText,
                              isActive && styles.granularityTextActive,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </AnalyticsPeriodCard>

              {/* Chart 1 — Ingresos vs Órdenes */}
              <Card style={styles.chartCard}>
                <Card.Header
                  title="Ingresos vs Órdenes"
                  subtitle="Comparación de tendencias"
                />
                <Card.Body>
                  {trends.length === 0 ? (
                    <EmptyState title="Sin datos" description="No hay datos para el período seleccionado" />
                  ) : (
                    <SalesTrendsCombinedChart data={trends} granularity={granularity} />
                  )}
                </Card.Body>
              </Card>

              {/* Chart 2 — Ticket Promedio (AOV) */}
              <Card style={styles.chartCard}>
                <Card.Header
                  title="Ticket Promedio"
                  subtitle="Evolución del valor promedio de orden"
                />
                <Card.Body>
                  {trends.length === 0 ? (
                    <EmptyState title="Sin datos" description="No hay datos para el período seleccionado" />
                  ) : (
                    <SalesTrendsAovChart data={trends} granularity={granularity} />
                  )}
                </Card.Body>
              </Card>

              {/* Vistas de Ventas — paridad web. Componente compartido responsive. */}
              <AnalyticsViewsCard views={getQuickLinks('sales_trends')} />
            </>
          )}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
};

export default SalesTrendsScreen;