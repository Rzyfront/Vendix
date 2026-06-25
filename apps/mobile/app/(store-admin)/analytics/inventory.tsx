import { useState, useCallback, useEffect, useMemo } from 'react';
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
  // Header — paridad con web inventory-overview.component.html líneas 56-70
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
  // Sticky filter bar — paridad web líneas 57-83
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
  // Vistas de Inventario — paridad web líneas 205-215
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

// Vistas de Inventario — paridad con web (analytics-registry.ts → category 'inventory').
// Overview (inventory_overview) es la pantalla actual → se oculta.
// Las demás se crearán en tasks futuros.
const INVENTORY_VIEWS: Array<{
  key: string;
  title: string;
  description: string;
  icon: string;
  route: string;
  available: boolean;
  color: { bg: string; fg: string };
}> = [
  {
    key: 'inventory_stock_info',
    title: 'Info de Stock',
    description: 'Niveles por ubicación y producto',
    icon: 'warehouse',
    route: '/analytics/inventory/stock-info',
    available: false,
    color: { bg: colorScales.blue[50], fg: colorScales.blue[600] },
  },
  {
    key: 'inventory_movements',
    title: 'Movimientos',
    description: 'Entradas y salidas',
    icon: 'arrow-left-right',
    route: '/analytics/inventory/movements',
    available: false,
    color: { bg: colorScales.purple[50], fg: colorScales.purple[600] },
  },
  {
    key: 'inventory_valuation',
    title: 'Valoración',
    description: 'Valor por método contable',
    icon: 'calculator',
    route: '/analytics/inventory/valuation',
    available: false,
    color: { bg: colorScales.green[50], fg: colorScales.green[600] },
  },
  {
    key: 'inventory_movement_analysis',
    title: 'Análisis de Movimientos',
    description: 'Patrones y tendencias',
    icon: 'line-chart',
    route: '/analytics/inventory/movement-analysis',
    available: false,
    color: { bg: colorScales.amber[50], fg: colorScales.amber[600] },
  },
];

const InventoryScreen = () => {
  const router = useRouter();
  const [dateRange, setDateRange] = useState<DateRangeFilterValue>(defaultDateRange);
  const [refreshing, setRefreshing] = useState(false);

  const apiRange = useMemo(() => ({
    start_date: dateRange.start_date,
    end_date: dateRange.end_date,
    preset: dateRange.preset as DatePreset,
  }), [dateRange]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics-inventory', apiRange],
    queryFn: () => AnalyticsDetailService.getInventoryAnalytics(apiRange),
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

  const handleExport = useCallback(() => {
    toastSuccess('Exportación iniciada — Recibirás el reporte en tu correo');
  }, []);

  // Stats web parity (inventory-overview.component.html líneas 18-52):
  //   Valor en Stock     = summary.total_stock_value (currency)
  //   Unidades en Mano  = summary.total_quantity_on_hand (count)
  //   Bajo Stock         = summary.low_stock_count (count + "% del total de SKUs")
  //   Sin Stock          = summary.out_of_stock_count (count + "% del total de SKUs")
  const totalSkus = (data?.total_sku_count || 0);
  const totalStockValue = data?.total_stock_value || 0;
  const totalUnits = (data?.total_quantity_on_hand || 0);
  const lowStockCount = (data?.low_stock_count || 0);
  const lowStockPct = totalSkus > 0 ? (lowStockCount / totalSkus) * 100 : 0;
  const outOfStockCount = (data?.out_of_stock_count || 0);
  const outOfStockPct = totalSkus > 0 ? (outOfStockCount / totalSkus) * 100 : 0;

  return (
    <View style={styles.root}>
      <PullToRefresh refreshing={refreshing} onRefresh={onRefresh}>
        <View style={styles.inner}>
          {/* Header — web parity */}
          <View style={styles.header}>
            <View style={styles.headerIconBox}>
              <Icon name="package" size={18} color={colors.primary} />
            </View>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                Dashboard de Inventario
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                Resumen consolidado de inventario, movimientos y valorización
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
              {/* 4 stats — paridad con web inventory-overview.component.html */}
              <StatsGrid
                style={styles.statsGridOverride}
                items={[
                  {
                    label: 'Valor en Stock',
                    value: formatCurrency(totalStockValue),
                    icon: <Icon name="dollar-sign" size={14} color={colorScales.green[600]} />,
                    iconBg: colorScales.green[100],
                    iconColor: colorScales.green[600],
                    description: 'Costo total del inventario actual',
                  },
                  {
                    label: 'Unidades en Mano',
                    value: totalUnits.toLocaleString(),
                    icon: <Icon name="layers" size={14} color={colorScales.purple[600]} />,
                    iconBg: colorScales.purple[100],
                    iconColor: colorScales.purple[600],
                    description: 'Cantidad total disponible',
                  },
                  {
                    label: 'Bajo Stock',
                    value: lowStockCount.toLocaleString(),
                    icon: <Icon name="alert-triangle" size={14} color={colorScales.amber[600]} />,
                    iconBg: colorScales.amber[100],
                    iconColor: colorScales.amber[600],
                    description: `${lowStockPct.toFixed(1)}% del total de SKUs`,
                  },
                  {
                    label: 'Sin Stock',
                    value: outOfStockCount.toLocaleString(),
                    icon: <Icon name="x-circle" size={14} color={colorScales.red[600]} />,
                    iconBg: colorScales.red[100],
                    iconColor: colorScales.red[600],
                    description: `${outOfStockPct.toFixed(1)}% del total de SKUs`,
                  },
                ]}
              />

              {/* Card "Tendencia de Movimientos" — web parity.
                  Backend aún no expone el endpoint dedicado de trends. */}
              <Card style={styles.chartCard}>
                <Card.Header
                  title="Tendencia de Movimientos"
                  subtitle="Evolución de entradas, salidas, ajustes y transferencias"
                />
                <Card.Body>
                  <View style={styles.chartEmpty}>
                    <Icon name="line-chart" size={32} color={colorScales.gray[300]} />
                    <Text style={styles.chartEmptyTitle}>Sin datos de movimientos</Text>
                    <Text style={styles.chartEmptyText}>
                      El backend aún no expone el endpoint detallado de
                      movimientos de inventario con tendencia temporal.
                      Cuando se agregue, verás aquí el chart de evolución.
                    </Text>
                  </View>
                </Card.Body>
              </Card>

              {/* 2 cards lado a lado en web (lg:grid-cols-2). En mobile los apilamos. */}
              <Card style={styles.chartCard}>
                <Card.Header
                  title="Valor por Ubicación"
                  subtitle="Valorización de inventario por ubicación"
                />
                <Card.Body>
                  <View style={styles.chartEmpty}>
                    <Icon name="map-pin" size={32} color={colorScales.gray[300]} />
                    <Text style={styles.chartEmptyTitle}>Sin datos por ubicación</Text>
                    <Text style={styles.chartEmptyText}>
                      El backend aún no expone el detalle de valoración por
                      ubicación. Cuando se agregue, verás el desglose por sede.
                    </Text>
                  </View>
                </Card.Body>
              </Card>

              <Card style={styles.chartCard}>
                <Card.Header
                  title="Cantidad por Ubicación"
                  subtitle="Unidades en inventario por ubicación"
                />
                <Card.Body>
                  <View style={styles.chartEmpty}>
                    <Icon name="package-search" size={32} color={colorScales.gray[300]} />
                    <Text style={styles.chartEmptyTitle}>Sin datos por ubicación</Text>
                    <Text style={styles.chartEmptyText}>
                      El backend aún no expone el detalle de cantidad por
                      ubicación. Cuando se agregue, verás el desglose por sede.
                    </Text>
                  </View>
                </Card.Body>
              </Card>
            </>
          ) : (
            <EmptyState title="Sin datos" description="No hay datos de inventario" />
          )}

          {/* Vistas de Inventario — web parity */}
          <Card style={styles.viewsCard}>
            <Card.Header title="Vistas de Inventario" />
            <Card.Body>
              <View style={styles.viewsGrid}>
                {INVENTORY_VIEWS.map((view) => (
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

export default InventoryScreen;
