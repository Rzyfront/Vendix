import { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import { StatsGrid, type StatsGridItem } from '@/shared/components/stats-card/stats-grid';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { formatCurrency } from '@/shared/utils/currency';
import { formatRelative } from '@/shared/utils/date';
import { spacing, borderRadius, colorScales, typography, colors } from '@/shared/theme';
import { INVENTORY_ICONS, STAT_PALETTE } from '@/features/store/constants/inventory-icons';
import { DASHBOARD_STATS } from '@/features/store/constants/inventory-labels';

interface QuickAction {
  title: string;
  subtitle: string;
  icon: string;
  route: string;
  palette: keyof typeof STAT_PALETTE;
}

// Replicates the web `app-stats` 4-card grid order:
// 1) Total Inventory Value (purple) 2) Products With Stock (blue)
// 3) Low Stock (amber) 4) Pending Orders (green)
const QUICK_ACTIONS: QuickAction[] = [
  {
    title: 'Nueva Orden',
    subtitle: 'Crear orden de compra',
    icon: INVENTORY_ICONS.quickNewOrder,
    route: 'pop',
    palette: 'green',
  },
  {
    title: 'Ajustar Stock',
    subtitle: 'Registrar ajuste de inventario',
    icon: INVENTORY_ICONS.quickAdjustStock,
    route: 'adjustments',
    palette: 'blue',
  },
  {
    title: 'Nuevo Proveedor',
    subtitle: 'Agregar proveedor',
    icon: INVENTORY_ICONS.quickNewSupplier,
    route: 'suppliers',
    palette: 'purple',
  },
  {
    title: 'Ver Productos',
    subtitle: 'Catálogo de productos',
    icon: INVENTORY_ICONS.quickViewProducts,
    route: '../products',
    palette: 'amber',
  },
];

export default function InventoryScreen() {
  const router = useRouter();

  const { data: stats, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['inventory-stats'],
    queryFn: () => InventoryService.getStats(),
  });

  const { data: recentOrdersResponse } = useQuery({
    queryKey: ['recent-orders'],
    queryFn: () => InventoryService.getPurchaseOrders({ page: 1, limit: 5 }),
  });

  // Top suppliers for the "Proveedores Principales" card (web parity).
  const { data: suppliersResponse } = useQuery({
    queryKey: ['top-suppliers'],
    queryFn: () => InventoryService.getSuppliers({ page: 1, limit: 5 }),
  });

  const recentOrders = recentOrdersResponse?.data ?? [];
  const topSuppliers = suppliersResponse?.data ?? [];

  const pendingOrdersCount = recentOrders.filter(
    (o) => o.status === 'pending' || o.status === 'draft',
  ).length;
  const pendingOrdersValue = recentOrders
    .filter((o) => o.status === 'pending' || o.status === 'draft')
    .reduce((sum, o) => sum + (o.total_amount ?? 0), 0);

  const lowStockTotal = (stats?.lowStock ?? 0) + (stats?.outOfStock ?? 0);
  const productsInStock = (stats?.totalProducts ?? 0) - (stats?.outOfStock ?? 0);

  const statsItems: StatsGridItem[] = useMemo(
    () => [
      {
        label: DASHBOARD_STATS.totalValue.label,
        value: formatCurrency(stats?.totalValue ?? 0),
        icon: INVENTORY_ICONS.valueStat,
        iconBg: STAT_PALETTE.purple.bg,
        iconColor: STAT_PALETTE.purple.color,
      },
      {
        label: DASHBOARD_STATS.productsInStock.label,
        value: productsInStock,
        icon: INVENTORY_ICONS.productStat,
        iconBg: STAT_PALETTE.blue.bg,
        iconColor: STAT_PALETTE.blue.color,
      },
      {
        label: DASHBOARD_STATS.lowStock.label,
        value: lowStockTotal,
        icon: INVENTORY_ICONS.lowStockStat,
        iconBg: STAT_PALETTE.amber.bg,
        iconColor: STAT_PALETTE.amber.color,
        smallText:
          stats && stats.outOfStock > 0
            ? `${stats.outOfStock} agotados`
            : undefined,
        smallTextColor: STAT_PALETTE.amber.color,
      },
      {
        label: DASHBOARD_STATS.pendingOrders.label,
        value: pendingOrdersCount,
        icon: INVENTORY_ICONS.pendingOrdersStat,
        iconBg: STAT_PALETTE.green.bg,
        iconColor: STAT_PALETTE.green.color,
        smallText:
          pendingOrdersCount > 0
            ? `${formatCurrency(pendingOrdersValue)} en camino`
            : undefined,
        smallTextColor: STAT_PALETTE.green.color,
      },
    ],
    [stats, productsInStock, lowStockTotal, pendingOrdersCount, pendingOrdersValue],
  );

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleNav = (route: string) => {
    if (route.startsWith('..')) {
      router.push(route as never);
    } else {
      router.push(`/(store-admin)/inventory/${route}` as never);
    }
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={[]}
        keyExtractor={() => 'spacer'}
        renderItem={() => null}
        ListHeaderComponent={
          <View>
            <StatsGrid style={styles.statsWrap} items={statsItems} />

            {/* Top suppliers — replicates the web `Proveedores Principales` card */}
            {topSuppliers.length > 0 && (
              <View style={styles.topSuppliersSection}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Proveedores Principales</Text>
                  <Pressable onPress={() => handleNav('suppliers')}>
                    <Text style={styles.seeAll}>Ver todos</Text>
                  </Pressable>
                </View>
                <Card style={styles.tableCard}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableHeaderCell, styles.colName]}>Nombre</Text>
                    <Text style={[styles.tableHeaderCell, styles.colContact]}>Contacto</Text>
                    <Text style={[styles.tableHeaderCell, styles.colStatus]}>Estado</Text>
                  </View>
                  {topSuppliers.map((s) => (
                    <View key={s.id} style={styles.tableRow}>
                      <View style={styles.colName}>
                        <Text style={styles.tableCellPrimary} numberOfLines={1}>
                          {s.name}
                        </Text>
                      </View>
                      <Text
                        style={[styles.tableCell, styles.colContact]}
                        numberOfLines={1}
                      >
                        {s.contact_person || s.email || '—'}
                      </Text>
                      <View style={styles.colStatus}>
                        <Badge
                          label={s.is_active ? 'Activo' : 'Inactivo'}
                          variant={s.is_active ? 'success' : 'default'}
                          size="sm"
                        />
                      </View>
                    </View>
                  ))}
                </Card>
              </View>
            )}

            {recentOrders.length > 0 && (
              <View style={styles.recentSection}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Órdenes Recientes</Text>
                  <Pressable onPress={() => handleNav('purchase')}>
                    <Text style={styles.seeAll}>Ver todas</Text>
                  </Pressable>
                </View>
                {recentOrders.slice(0, 3).map((order) => (
                  <Card key={order.id} style={styles.orderCard}>
                    <View style={styles.orderRow}>
                      <View style={styles.orderInfo}>
                        <Text style={styles.orderTitle} numberOfLines={1}>
                          {order.suppliers?.name || `Orden #${order.id}`}
                        </Text>
                        <Text style={styles.orderMeta}>
                          {formatCurrency(order.total_amount ?? 0)} ·{' '}
                          {formatRelative(order.created_at)}
                        </Text>
                      </View>
                      <Badge
                        label={
                          order.status === 'draft'
                            ? 'Borrador'
                            : order.status === 'approved'
                              ? 'Aprobada'
                              : order.status === 'received'
                                ? 'Recibida'
                                : order.status
                        }
                        variant={
                          order.status === 'received'
                            ? 'success'
                            : order.status === 'approved'
                              ? 'info'
                              : 'warning'
                        }
                        size="sm"
                      />
                    </View>
                  </Card>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>Acciones Rápidas</Text>

            <View style={styles.navSection}>
              {QUICK_ACTIONS.map((item) => {
                const palette = STAT_PALETTE[item.palette];
                return (
                  <Pressable
                    key={item.route}
                    onPress={() => handleNav(item.route)}
                    style={styles.navPressable}
                  >
                    <Card
                      style={StyleSheet.flatten([
                        styles.navCard,
                        { borderLeftWidth: 4, borderLeftColor: palette.color },
                      ])}
                    >
                      <View style={styles.navContent}>
                        <View
                          style={[styles.navIcon, { backgroundColor: palette.bg }]}
                        >
                          <Icon name={item.icon} size={20} color={palette.color} />
                        </View>
                        <View style={styles.navTextWrap}>
                          <Text style={styles.navTitle}>{item.title}</Text>
                          <Text style={styles.navSubtitle}>{item.subtitle}</Text>
                        </View>
                        <Icon
                          name="chevron-right"
                          size={16}
                          color={colorScales.gray[400]}
                        />
                      </View>
                    </Card>
                  </Pressable>
                );
              })}
            </View>

            {!isLoading && lowStockTotal === 0 && (
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon={
                    <Icon
                      name="package"
                      size={48}
                      color={colorScales.gray[300]}
                    />
                  }
                  title="Inventario al día"
                  description="No hay productos con stock bajo"
                />
              </View>
            )}
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  statsWrap: {
    paddingHorizontal: spacing[4],
  },
  sectionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: spacing[4],
  },
  seeAll: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: '600' as any,
  },
  topSuppliersSection: {
    marginTop: spacing[2],
  },
  tableCard: {
    marginHorizontal: spacing[4],
    overflow: 'hidden',
    padding: 0,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    backgroundColor: colorScales.gray[50],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  tableHeaderCell: {
    fontSize: typography.fontSize.xs,
    fontWeight: '700' as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  tableCell: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[600],
  },
  tableCellPrimary: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
    color: colorScales.gray[900],
  },
  colName: { flex: 2 },
  colContact: { flex: 2 },
  colStatus: { flex: 1, alignItems: 'flex-end' as any },
  recentSection: {
    marginTop: spacing[2],
  },
  orderCard: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  orderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing[3],
  },
  orderInfo: {
    flex: 1,
    marginRight: spacing[2],
  },
  orderTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
    color: colorScales.gray[900],
  },
  orderMeta: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  navSection: {
    paddingHorizontal: spacing[4],
  },
  navPressable: {
    marginBottom: spacing[3],
  },
  navCard: {
    overflow: 'hidden',
  },
  navContent: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing[4],
    gap: spacing[3],
  },
  navIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTextWrap: {
    flex: 1,
  },
  navTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: '600' as any,
    color: colorScales.gray[900],
  },
  navSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  emptyWrap: {
    paddingHorizontal: spacing[4],
  },
  listContent: {
    paddingBottom: spacing[6],
  },
});