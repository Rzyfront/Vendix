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
import { PaymentMethodsBarChart } from '@/features/store/components/payment-methods-bar-chart';
import { SALES_VIEWS, getQuickLinks } from '@/features/store/data/sales-views';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

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

const SALES_TABS: ScrollableTab[] = SALES_VIEWS.map((v) => ({
  id: v.key,
  label: v.title,
  icon: v.icon,
}));

const SalesByPaymentScreen = () => {
  const router = useRouter();
  const [dateRange, setDateRange] = useState<DateRangeFilterValue>(defaultDateRange);
  const [refreshing, setRefreshing] = useState(false);

  const apiRange = useMemo(() => ({
    start_date: dateRange.start_date,
    end_date: dateRange.end_date,
    preset: dateRange.preset as any,
  }), [dateRange]);

  const {
    data: methodsData = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['analytics-sales-by-payment', apiRange],
    queryFn: () => AnalyticsService.getSalesByPaymentMethod(apiRange),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  useEffect(() => {
    if (isError) toastError('Error cargando ventas por método de pago');
  }, [isError]);

  const handleExport = useCallback(() => {
    toastSuccess('Exportación iniciada — Recibirás el reporte en tu correo');
  }, []);

  // Stats — paridad con web (getMethodCount, getTotalTransactions, getTotalRevenue, getTopMethod).
  const totalTransactions = useMemo(
    () => methodsData.reduce((s, m) => s + (m.transaction_count || 0), 0),
    [methodsData],
  );
  const totalRevenue = useMemo(
    () => methodsData.reduce((s, m) => s + (m.total_amount || 0), 0),
    [methodsData],
  );
  const topMethodName = useMemo(() => {
    if (methodsData.length === 0) return '-';
    const sorted = [...methodsData].sort((a, b) => (b.total_amount || 0) - (a.total_amount || 0));
    const top = sorted[0];
    if (!top) return '-';
    const name = top.display_name || top.payment_method;
    return name.length > 15 ? name.substring(0, 15) : name;
  }, [methodsData]);

  return (
    <View style={styles.root}>
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <ScrollView style={styles.inner} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerBreadcrumb}>Ventas / Por Método de Pago</Text>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Ventas por Método de Pago
              </Text>
            </View>
          </View>

          {/* Tabs — componente compartido ScrollableTabs con auto-scroll al
              tab activo (paridad con web scroll-snap-align: center). */}
          <View style={styles.tabsWrapper}>
            <ScrollableTabs
              tabs={SALES_TABS}
              activeTab="sales_by_payment"
              accentColor={colorScales.red[600]}
              onTabChange={(key) => {
                const view = SALES_VIEWS.find((v) => v.key === key);
                if (!view || view.key === 'sales_by_payment') return;
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
              {/* 4 Stats — paridad con web sales-by-payment.component.ts */}
              <StatsGrid
                style={styles.statsGridOverride}
                items={[
                  {
                    label: 'Métodos Pago',
                    value: methodsData.length.toString(),
                    icon: <Icon name="credit-card" size={14} color={colorScales.blue[600]} />,
                    iconBg: colorScales.blue[100],
                    iconColor: colorScales.blue[600],
                    description: 'métodos',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Transacciones',
                    value: totalTransactions.toLocaleString(),
                    icon: <Icon name="repeat" size={14} color={colorScales.purple[600]} />,
                    iconBg: colorScales.purple[100],
                    iconColor: colorScales.purple[600],
                    description: 'totales',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Ingresos Total',
                    value: formatCurrency(totalRevenue).replace('$ ', '$'),
                    icon: <Icon name="dollar-sign" size={14} color={colorScales.green[600]} />,
                    iconBg: colorScales.green[100],
                    iconColor: colorScales.green[600],
                    description: 'suma',
                    descriptionColor: colorScales.green[600],
                  },
                  {
                    label: 'Método Principal',
                    value: topMethodName,
                    icon: <Icon name="trophy" size={14} color={colorScales.amber[600]} />,
                    iconBg: colorScales.amber[100],
                    iconColor: colorScales.amber[600],
                    description: 'mayor monto',
                    descriptionColor: colorScales.green[600],
                  },
                ]}
              />

              {/* Filtros de Fecha — componente compartido idéntico en todas las
                  vistas de analytics. Layout responsive. */}
              <AnalyticsPeriodCard
                value={dateRange}
                onChange={setDateRange}
                onExport={handleExport}
              />

              {/* Gráfico Distribución por Método — paridad exacta con web echarts bar chart */}
              <Card style={styles.chartCard}>
                <Card.Header
                  title="Distribución por Método"
                  subtitle={`${methodsData.length} métodos en el período`}
                />
                <Card.Body>
                  {methodsData.length === 0 ? (
                    <EmptyState title="Sin datos" description="No hay datos para el período seleccionado" />
                  ) : (
                    <PaymentMethodsBarChart methods={methodsData} />
                  )}
                </Card.Body>
              </Card>

              {/* Vistas de Ventas — paridad web. Componente compartido responsive. */}
              <AnalyticsViewsCard views={getQuickLinks('sales_by_payment')} />
            </>
          )}
        </ScrollView>
      </PullToRefresh>
    </View>
  );
};

export default SalesByPaymentScreen;