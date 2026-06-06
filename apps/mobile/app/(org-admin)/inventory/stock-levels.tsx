import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgInventoryService } from '@/features/org/services/org-inventory.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function StockLevelsScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const stocksQuery = useQuery({
    queryKey: ['org-inventory-stock-levels'],
    queryFn: () => OrgInventoryService.listStockLevels({ pageSize: 100 }),
  });
  const statsQuery = useQuery({
    queryKey: ['org-inventory-stock-stats'],
    queryFn: () => OrgInventoryService.getStockStats(),
  });
  const alertsQuery = useQuery({
    queryKey: ['org-inventory-stock-alerts'],
    queryFn: () => OrgInventoryService.getStockAlerts(),
  });

  const stocks = stocksQuery.data ?? [];
  const stats = statsQuery.data;
  const alerts = alertsQuery.data ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([stocksQuery.refetch(), statsQuery.refetch(), alertsQuery.refetch()]);
    setRefreshing(false);
  };

  return (
    <OrgPageContainer
      loading={stocksQuery.isLoading}
      refreshing={refreshing}
      onRefresh={onRefresh}
      empty={
        stocks.length === 0
          ? { icon: 'package', title: 'Sin stock', message: 'No hay niveles de stock para mostrar.' }
          : undefined
      }
    >
      {stats ? (
        <View style={styles.statsRow}>
          <View style={[styles.statBox, { backgroundColor: colorScales.blue[50] }]}>
            <Text style={[styles.statValue, { color: colorScales.blue[700] }]}>{stats.total_products}</Text>
            <Text style={styles.statLabel}>Productos</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: colorScales.amber[50] }]}>
            <Text style={[styles.statValue, { color: colorScales.amber[700] }]}>{stats.low_stock_count}</Text>
            <Text style={styles.statLabel}>Stock bajo</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: colorScales.green[50] }]}>
            <Text style={[styles.statValue, { color: colorScales.green[700] }]}>
              {formatCurrency(stats.total_value.amount)}
            </Text>
            <Text style={styles.statLabel}>Valor total</Text>
          </View>
        </View>
      ) : null}

      {alerts.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Alertas</Text>
          {alerts.map((a, i) => (
            <OrgListItem
              key={i}
              title={a.product_name}
              subtitle={`Stock: ${a.current_quantity} • Mínimo: ${a.min_stock}`}
              description={a.store_name}
              leftIcon="alert-triangle"
              leftIconColor={
                a.severity === 'OUT' ? colorScales.red[600] :
                a.severity === 'CRITICAL' ? colorScales.red[500] :
                colorScales.amber[500]
              }
              rightBadge={
                a.severity === 'OUT' ? { label: 'Agotado', variant: 'error' } :
                a.severity === 'CRITICAL' ? { label: 'Crítico', variant: 'error' } :
                { label: 'Bajo', variant: 'warning' }
              }
              chevron={false}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Niveles</Text>
        {stocks.map((s) => (
          <OrgListItem
            key={s.id}
            title={s.product_name}
            subtitle={`${s.store_name ?? ''} ${s.location_name ? `• ${s.location_name}` : ''}`.trim()}
            description={`SKU: ${s.product_sku ?? '—'}`}
            leftIcon="package"
            rightValue={`${s.available_quantity}`}
            rightMeta={s.total_value ? formatCurrency(s.total_value.amount) : undefined}
            chevron={false}
          />
        ))}
      </View>
    </OrgPageContainer>
  );
}

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] },
  statBox: {
    flex: 1,
    padding: spacing[3],
    borderRadius: 12,
    alignItems: 'center',
  },
  statValue: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.bold },
  statLabel: { fontSize: 11, color: colorScales.gray[600], marginTop: 2 },
  section: { marginBottom: spacing[4] },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
});
