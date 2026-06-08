import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { OrgOrdersService } from '@/features/org/services/org-orders.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { OrgSectionHeader } from '@/shared/components/org-section-header';
import { colors, colorScales, spacing, typography } from '@/shared/theme';
import { formatCurrency } from '@/shared/utils/currency';

export default function OrdersList() {
  const [refreshing, setRefreshing] = useState(false);

  const ordersQuery = useQuery({
    queryKey: ['org-orders-list'],
    queryFn: () => OrgOrdersService.list({ pageSize: 50 }),
  });
  const statsQuery = useQuery({
    queryKey: ['org-orders-stats'],
    queryFn: () => OrgOrdersService.getStats(),
  });

  const orders = ordersQuery.data ?? [];
  const stats = statsQuery.data;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([ordersQuery.refetch(), statsQuery.refetch()]);
    setRefreshing(false);
  };

  return (
    <OrgPageContainer
      loading={ordersQuery.isLoading}
      refreshing={refreshing}
      onRefresh={onRefresh}
      empty={
        orders.length === 0
          ? { icon: 'clipboard-list', title: 'No hay órdenes', message: 'Las órdenes de tus tiendas aparecerán aquí.' }
          : undefined
      }
    >
      {stats ? (
        <View style={styles.section}>
          <OrgStatsGrid
            columns={2}
            stats={[
              { label: 'Total órdenes', value: stats.total_orders, icon: 'clipboard-list' },
              { label: 'Ingresos totales', value: formatCurrency(stats.total_revenue.amount), icon: 'dollar-sign', color: colors.success },
              { label: 'Ticket promedio', value: formatCurrency(stats.average_ticket.amount), icon: 'trending-up', color: colorScales.blue[500] },
              { label: 'Pendientes', value: stats.pending_orders, icon: 'clock', color: colorScales.amber[500] },
            ]}
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <OrgSectionHeader title="Órdenes" subtitle={`${orders.length} resultados`} />
        {orders.map((o) => (
          <OrgListItem
            key={o.id}
            title={`#${o.order_number}`}
            subtitle={`${o.store_name} • ${o.customer_name}`}
            description={`${o.channel} • ${o.items_count} items`}
            leftIcon="shopping-bag"
            rightValue={formatCurrency(o.total.amount)}
            rightBadge={
              o.status === 'DELIVERED'
                ? { label: o.status, variant: 'success' }
                : o.status === 'CANCELLED' || o.status === 'REFUNDED'
                ? { label: o.status, variant: 'error' }
                : { label: o.status, variant: 'warning' }
            }
            rightMeta={new Date(o.created_at).toLocaleDateString()}
            chevron
          />
        ))}
      </View>
    </OrgPageContainer>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing[4] },
});
