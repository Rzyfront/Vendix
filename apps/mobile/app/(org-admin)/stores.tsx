import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { OrgStoreService } from '@/features/org/services';
import { AuthService } from '@/core/auth/auth.service';
import { useTenantStore } from '@/core/store/tenant.store';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { Spinner } from '@/shared/components/spinner/spinner';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

const storeTypeLabels: Record<string, string> = {
  PHYSICAL: 'Física',
  ONLINE: 'En línea',
  HYBRID: 'Híbrida',
  POPUP: 'Pop-up',
  KIOSKO: 'Kiosko',
};

const storeTypeIcons: Record<string, string> = {
  PHYSICAL: 'store',
  ONLINE: 'globe',
  HYBRID: 'layers',
  POPUP: 'calendar',
  KIOSKO: 'shopping-bag',
};

function getStoreStatusBadge(state: string, isActive: boolean): { label: string; variant: 'success' | 'warning' | 'error' | 'default' } {
  if (!isActive) return { label: 'Inactiva', variant: 'error' };
  if (state === 'ACTIVE') return { label: 'Activa', variant: 'success' };
  if (state === 'DRAFT') return { label: 'Borrador', variant: 'warning' };
  if (state === 'SUSPENDED') return { label: 'Suspendida', variant: 'error' };
  return { label: state, variant: 'default' };
}

export default function StoresScreen() {
  const router = useRouter();
  const setStoreId = useTenantStore((s) => s.setStoreId);
  const setStoreName = useTenantStore((s) => s.setStoreName);
  const setStoreSlug = useTenantStore((s) => s.setStoreSlug);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [switchingStore, setSwitchingStore] = useState<number | null>(null);

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['org-stores-stats'],
    queryFn: () => OrgStoreService.stats(),
  });

  const { data: storesData, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['org-stores', search, page],
    queryFn: () => OrgStoreService.list({ search: search || undefined, page, limit: 50 }),
  });

  const stores = useMemo(() => storesData?.data ?? [], [storesData]);
  const stats = statsData;

  const handleStorePress = useCallback(async (store: { id: number; name: string; slug: string }) => {
    setSwitchingStore(store.id);
    try {
      await AuthService.switchEnvironment('STORE_ADMIN', store.slug);
      setStoreId(String(store.id));
      setStoreName(store.name);
      setStoreSlug(store.slug);
      toastSuccess(`Cambiando a ${store.name}`);
      router.replace('/(store-admin)/dashboard' as never);
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || 'Error al cambiar de tienda';
      toastError(message);
    } finally {
      setSwitchingStore(null);
    }
  }, [setStoreId, setStoreName, setStoreSlug, router]);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const renderStoreItem = useCallback(({ item }: { item: import('@/features/org/services').OrgStore }) => {
    const status = getStoreStatusBadge(item.state, item.is_active);
    const typeLabel = storeTypeLabels[item.store_type] || item.store_type;
    const typeIcon = storeTypeIcons[item.store_type] || 'store';

    return (
      <Pressable
        onPress={() => handleStorePress(item)}
        style={({ pressed }) => [
          styles.storeCard,
          pressed && { backgroundColor: colorScales.gray[50] },
        ]}
      >
        <View style={styles.storeIcon}>
          <Icon name={typeIcon} size={20} color={colors.primary} />
        </View>

        <View style={styles.storeInfo}>
          <View style={styles.storeNameRow}>
            <Text style={styles.storeName} numberOfLines={1}>{item.name}</Text>
            {!item.is_active && <View style={styles.inactiveDot} />}
          </View>
          <Text style={styles.storeCode}>{item.store_code}</Text>
          {item.primary_address && (
            <Text style={styles.storeAddress} numberOfLines={1}>
              <Icon name="map-pin" size={12} color={colorScales.gray[400]} /> {item.primary_address}
            </Text>
          )}
          <View style={styles.storeMeta}>
            <Badge label={typeLabel} variant="info" size="sm" />
            <Badge label={status.label} variant={status.variant} size="sm" />
          </View>
          {item.orders_count > 0 && (
            <Text style={styles.ordersCount}>
              {item.orders_count} {item.orders_count === 1 ? 'orden' : 'órdenes'}
            </Text>
          )}
        </View>

        <Icon name="chevron-right" size={18} color={colorScales.gray[400]} />
      </Pressable>
    );
  }, [handleStorePress]);

  return (
    <View style={styles.container}>
      {/* Stats Summary */}
      {stats && !statsLoading && (
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colorScales.blue[50] }]}>
            <Text style={[styles.statValue, { color: colorScales.blue[700] }]}>
              {stats.total_stores}
            </Text>
            <Text style={[styles.statLabel, { color: colorScales.blue[600] }]}>Totales</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colorScales.green[50] }]}>
            <Text style={[styles.statValue, { color: colorScales.green[700] }]}>
              {stats.active_stores}
            </Text>
            <Text style={[styles.statLabel, { color: colorScales.green[600] }]}>Activas</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colorScales.amber[50] }]}>
            <Text style={[styles.statValue, { color: colorScales.amber[700] }]}>
              {stats.total_orders}
            </Text>
            <Text style={[styles.statLabel, { color: colorScales.amber[600] }]}>Órdenes</Text>
          </View>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchContainer}>
        <SearchBar
          placeholder="Buscar tiendas..."
          value={search}
          onChangeText={handleSearch}
        />
      </View>

      {/* Store List */}
      {isLoading ? (
        <View style={styles.centerContent}>
          <Spinner />
        </View>
      ) : stores.length === 0 ? (
        <EmptyState
          title="Sin tiendas"
          description={search ? 'No se encontraron tiendas' : 'No hay tiendas disponibles'}
          icon="store"
        />
      ) : (
        <FlatList
          data={stores}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          renderItem={renderStoreItem}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  statCard: {
    flex: 1,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    alignItems: 'center',
  },
  statValue: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
  },
  statLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    marginTop: 2,
  },
  searchContainer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
  },
  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    marginBottom: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
  },
  storeIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  storeInfo: {
    flex: 1,
    marginRight: spacing[2],
  },
  storeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  storeName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  inactiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
  },
  storeCode: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    marginTop: 2,
  },
  storeAddress: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  storeMeta: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  ordersCount: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: spacing[1],
  },
});
