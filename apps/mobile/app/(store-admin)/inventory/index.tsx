import { useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import { StatsCard } from '@/shared/components/stats-card/stats-card';
import { Card } from '@/shared/components/card/card';
import { Icon } from '@/shared/components/icon/icon';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { formatCurrency } from '@/shared/utils/currency';
import { spacing, borderRadius, colorScales, typography } from '@/shared/theme';

interface QuickNavLink {
  title: string;
  subtitle: string;
  icon: string;
  route: string;
  color: string;
  bgColor: string;
}

const QUICK_LINKS: QuickNavLink[] = [
  { title: 'Ajustes de Stock', subtitle: 'Entradas, salidas y ajustes', icon: 'sliders', route: 'adjustments', color: colorScales.blue[600], bgColor: colorScales.blue[50] },
  { title: 'Transferencias', subtitle: 'Movimientos entre ubicaciones', icon: 'truck', route: 'transfers', color: colorScales.green[600], bgColor: colorScales.green[50] },
  { title: 'Movimientos', subtitle: 'Historial de movimientos', icon: 'activity', route: 'movements', color: colorScales.amber[600], bgColor: colorScales.amber[50] },
  { title: 'Proveedores', subtitle: 'Gestión de proveedores', icon: 'store', route: 'suppliers', color: colorScales.red[600], bgColor: colorScales.red[50] },
  { title: 'Ubicaciones', subtitle: 'Bodegas, tiendas y virtuales', icon: 'warehouse', route: 'locations', color: colorScales.gray[700], bgColor: colorScales.gray[100] },
];

export default function InventoryScreen() {
  const router = useRouter();

  const { data: stats, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['inventory-stats'],
    queryFn: () => InventoryService.getStats(),
  });

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleNav = (route: string) => {
    router.push(`/(store-admin)/inventory/${route}` as never);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={[]}
        keyExtractor={() => 'spacer'}
        renderItem={() => null}
        ListHeaderComponent={
          <View>
            <View style={styles.statsGrid}>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Total Productos"
                  value={stats?.totalProducts ?? 0}
                  icon={<Icon name="package" size={16} color={colorScales.blue[600]} />}
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Bajo Stock"
                  value={stats?.lowStock ?? 0}
                  icon={<Icon name="alert-triangle" size={16} color={colorScales.amber[600]} />}
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Sin Stock"
                  value={stats?.outOfStock ?? 0}
                  icon={<Icon name="x" size={16} color={colorScales.red[600]} />}
                />
              </View>
              <View style={styles.statsItem}>
                <StatsCard
                  label="Valor Total"
                  value={formatCurrency(stats?.totalValue ?? 0)}
                  icon={<Icon name="dollar-sign" size={16} color={colorScales.green[600]} />}
                />
              </View>
            </View>

            <Text style={styles.sectionTitle}>Acciones Rápidas</Text>

            <View style={styles.navSection}>
              {QUICK_LINKS.map((item) => (
                <Pressable key={item.route} onPress={() => handleNav(item.route)} style={styles.navPressable}>
                  <Card style={StyleSheet.flatten([styles.navCard, { borderLeftWidth: 4, borderLeftColor: item.color }])}>
                    <View style={styles.navContent}>
                      <View style={[styles.navIcon, { backgroundColor: item.bgColor }]}>
                        <Icon name={item.icon} size={20} color={item.color} />
                      </View>
                      <View style={styles.navTextWrap}>
                        <Text style={styles.navTitle}>{item.title}</Text>
                        <Text style={styles.navSubtitle}>{item.subtitle}</Text>
                      </View>
                      <Icon name="chevron-right" size={16} color={colorScales.gray[400]} />
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>

            {!isLoading && (stats?.lowStock ?? 0) === 0 && (
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon={<Icon name="package" size={48} color={colorScales.gray[300]} />}
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[3],
    padding: spacing[4],
  },
  statsItem: {
    width: '48%',
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
