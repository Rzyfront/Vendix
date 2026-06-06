import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, RefreshControl, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrgDashboardService } from '@/features/org/services/org-dashboard.service';
import { OrgOrdersService } from '@/features/org/services/org-orders.service';
import { OrgStoreService } from '@/features/org/services/org-store.service';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { OrgSectionHeader } from '@/shared/components/org-section-header';
import { Spinner } from '@/shared/components/spinner/spinner';
import { useAuthStore } from '@/core/store/auth.store';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { useState } from 'react';
import { formatCurrency } from '@/shared/utils/currency';
import { OrgBadge } from '@/shared/components/org-badge';
import { Card } from '@/shared/components/card/card';

export default function OrgDashboard() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [refreshing, setRefreshing] = useState(false);

  const statsQuery = useQuery({
    queryKey: ['org-dashboard-stats'],
    queryFn: () => OrgDashboardService.getStats(),
  });

  const recentQuery = useQuery({
    queryKey: ['org-dashboard-recent-orders'],
    queryFn: () => OrgDashboardService.getRecentOrders(8),
  });

  const storeStatsQuery = useQuery({
    queryKey: ['org-stores-stats'],
    queryFn: () => OrgStoreService.stats(),
  });

  const orderStatsQuery = useQuery({
    queryKey: ['org-orders-stats'],
    queryFn: () => OrgOrdersService.getStats(),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      statsQuery.refetch(),
      recentQuery.refetch(),
      storeStatsQuery.refetch(),
      orderStatsQuery.refetch(),
    ]);
    setRefreshing(false);
  }, []);

  const loading =
    statsQuery.isLoading &&
    recentQuery.isLoading &&
    storeStatsQuery.isLoading &&
    orderStatsQuery.isLoading;

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={['bottom']}>
        <Spinner size="large" />
      </SafeAreaView>
    );
  }

  const stats = statsQuery.data;
  const recent = recentQuery.data ?? [];
  const orderStats = orderStatsQuery.data;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.greetingBlock}>
          <Text style={styles.greeting}>Hola, {user?.first_name || 'Admin'}</Text>
          <Text style={styles.orgName}>
            {user?.organizations?.name ?? 'Panel de Organización'}
          </Text>
        </View>

        <OrgStatsGrid
          columns={2}
          stats={[
            {
              label: 'Tiendas activas',
              value: stats?.active_stores ?? 0,
              icon: 'store',
              color: colors.primary,
            },
            {
              label: 'Usuarios',
              value: stats?.total_users ?? 0,
              icon: 'users',
              color: colorScales.blue[500],
            },
            {
              label: 'Ingresos del mes',
              value: formatCurrency(stats?.revenue_month ?? 0),
              icon: 'dollar-sign',
              color: colorScales.green[600],
            },
            {
              label: 'Órdenes del mes',
              value: stats?.total_orders_month ?? 0,
              icon: 'shopping-cart',
              color: colorScales.amber[500],
            },
          ]}
        />

        {stats && (stats.low_stock_products > 0 || stats.expiring_batches > 0 || stats.pending_orders > 0) ? (
          <View style={styles.alertsRow}>
            {stats.pending_orders > 0 ? (
              <Card style={StyleSheet.flatten([styles.alertCard, { backgroundColor: colorScales.amber[50] }])}>
                <Text style={[styles.alertValue, { color: colorScales.amber[700] }]}>
                  {stats.pending_orders}
                </Text>
                <Text style={styles.alertLabel}>Órdenes pendientes</Text>
              </Card>
            ) : null}
            {stats.low_stock_products > 0 ? (
              <Card style={StyleSheet.flatten([styles.alertCard, { backgroundColor: colorScales.red[50] }])}>
                <Text style={[styles.alertValue, { color: colorScales.red[700] }]}>
                  {stats.low_stock_products}
                </Text>
                <Text style={styles.alertLabel}>Stock bajo</Text>
              </Card>
            ) : null}
            {stats.expiring_batches > 0 ? (
              <Card style={StyleSheet.flatten([styles.alertCard, { backgroundColor: colorScales.blue[50] }])}>
                <Text style={[styles.alertValue, { color: colorScales.blue[700] }]}>
                  {stats.expiring_batches}
                </Text>
                <Text style={styles.alertLabel}>Lotes por vencer</Text>
              </Card>
            ) : null}
          </View>
        ) : null}

        {orderStats ? (
          <View style={styles.section}>
            <OrgSectionHeader title="Resumen de Órdenes" subtitle="Métricas globales" />
            <View style={styles.ordersRow}>
              <Card style={styles.orderMiniCard}>
                <Text style={styles.miniValue}>{orderStats.total_orders}</Text>
                <Text style={styles.miniLabel}>Total</Text>
              </Card>
              <Card style={styles.orderMiniCard}>
                <Text style={[styles.miniValue, { color: colors.success }]}>
                  {orderStats.completed_orders}
                </Text>
                <Text style={styles.miniLabel}>Completadas</Text>
              </Card>
              <Card style={styles.orderMiniCard}>
                <Text style={[styles.miniValue, { color: colorScales.amber[600] }]}>
                  {orderStats.pending_orders}
                </Text>
                <Text style={styles.miniLabel}>Pendientes</Text>
              </Card>
              <Card style={styles.orderMiniCard}>
                <Text style={[styles.miniValue, { color: colorScales.red[600] }]}>
                  {orderStats.cancelled_orders}
                </Text>
                <Text style={styles.miniLabel}>Canceladas</Text>
              </Card>
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <OrgSectionHeader
            title="Órdenes recientes"
            subtitle="Últimas órdenes de la organización"
            action={
              <Pressable onPress={() => router.push('/(org-admin)/orders' as never)}>
                <Text style={styles.linkAction}>Ver todas</Text>
              </Pressable>
            }
          />
          {recent.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyText}>No hay órdenes recientes</Text>
            </Card>
          ) : (
            recent.map((o) => (
              <OrgListItem
                key={o.id}
                title={`#${o.order_number}`}
                subtitle={`${o.store_name} • ${o.customer_name}`}
                leftIcon="shopping-bag"
                rightValue={formatCurrency(o.total)}
                rightMeta={new Date(o.created_at).toLocaleDateString()}
                onPress={() => router.push('/(org-admin)/orders' as never)}
                chevron
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  content: {
    padding: spacing[4],
    paddingBottom: spacing[8],
  },
  greetingBlock: {
    marginBottom: spacing[4],
  },
  greeting: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  orgName: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  alertsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  alertCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[3],
  },
  alertValue: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
  },
  alertLabel: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[600],
    marginTop: 2,
    textAlign: 'center',
  },
  section: {
    marginTop: spacing[5],
  },
  ordersRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  orderMiniCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[3],
  },
  miniValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  miniLabel: {
    fontSize: 11,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing[6],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
  },
  linkAction: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: typography.fontWeight.semibold,
  },
});
