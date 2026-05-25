import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, FlatList, StyleSheet, RefreshControl, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OrgStoreService } from '@/features/org/services';
import { AuthService } from '@/core/auth/auth.service';
import { useTenantStore } from '@/core/store/tenant.store';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { Badge } from '@/shared/components/badge/badge';
import { Spinner } from '@/shared/components/spinner/spinner';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Button } from '@/shared/components/button/button';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { Modal } from '@/shared/components/modal/modal';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';

const storeTypeLabels: Record<string, string> = {
  physical: 'Física',
  online: 'En línea',
  hybrid: 'Híbrida',
  popup: 'Pop-up',
  kiosko: 'Kiosko',
};

const storeTypeIcons: Record<string, string> = {
  physical: 'store',
  online: 'globe',
  hybrid: 'layers',
  popup: 'calendar',
  kiosko: 'shopping-bag',
};

const STORE_TYPE_FILTERS = [
  { label: 'Todos', value: '' },
  { label: 'Física', value: 'physical' },
  { label: 'Online', value: 'online' },
  { label: 'Híbrida', value: 'hybrid' },
  { label: 'Temporal', value: 'popup' },
  { label: 'Kiosko', value: 'kiosko' },
];

const STATUS_FILTERS = [
  { label: 'Todos', value: '' },
  { label: 'Activas', value: 'active' },
  { label: 'Inactivas', value: 'inactive' },
];

function getStoreStatusBadge(state: string, isActive: boolean): { label: string; variant: 'success' | 'warning' | 'error' | 'default' } {
  if (!isActive) return { label: 'Inactiva', variant: 'error' };
  if (state === 'ACTIVE') return { label: 'Activa', variant: 'success' };
  if (state === 'DRAFT') return { label: 'Borrador', variant: 'warning' };
  if (state === 'SUSPENDED') return { label: 'Suspendida', variant: 'error' };
  return { label: state, variant: 'default' };
}

export default function StoresScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setStoreId = useTenantStore((s) => s.setStoreId);
  const setStoreName = useTenantStore((s) => s.setStoreName);
  const setStoreSlug = useTenantStore((s) => s.setStoreSlug);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [switchingStore, setSwitchingStore] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedStore, setSelectedStore] = useState<any>(null);
  const [showActionsSheet, setShowActionsSheet] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteSlug, setDeleteSlug] = useState('');

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['org-stores-stats'],
    queryFn: () => OrgStoreService.stats(),
  });

  const {
    data: storesData,
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ['org-stores', search, page, typeFilter, statusFilter],
    queryFn: () =>
      OrgStoreService.list({
        search: search || undefined,
        page,
        limit: 50,
        store_type: (typeFilter || undefined) as any,
        is_active: statusFilter === 'active' ? true : statusFilter === 'inactive' ? false : undefined,
      }),
  });

  const stores = useMemo(() => storesData?.data ?? [], [storesData]);
  const stats = statsData;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => OrgStoreService.deleteStore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-stores'] });
      queryClient.invalidateQueries({ queryKey: ['org-stores-stats'] });
      toastSuccess('Tienda eliminada exitosamente');
      setShowDeleteModal(false);
      setDeleteTarget(null);
      setDeleteSlug('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al eliminar tienda';
      toastError(message);
    },
  });

  const handleStorePress = useCallback(
    async (store: { id: number; name: string; slug: string }) => {
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
    },
    [setStoreId, setStoreName, setStoreSlug, router],
  );

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const handleStoreAction = useCallback((store: any, action: 'edit' | 'settings' | 'delete') => {
    setShowActionsSheet(false);
    setSelectedStore(null);

    if (action === 'edit') {
      router.push({ pathname: '/(org-admin)/stores/edit', params: { id: String(store.id) } } as never);
    } else if (action === 'settings') {
      router.push(`/(org-admin)/stores/${store.id}/settings` as never);
    } else if (action === 'delete') {
      setDeleteTarget(store);
      setDeleteSlug('');
      setShowDeleteModal(true);
    }
  }, [router]);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget || deleteSlug !== deleteTarget.slug) return;
    deleteMutation.mutate(deleteTarget.id);
  }, [deleteTarget, deleteSlug, deleteMutation]);

  const renderStoreItem = useCallback(
    ({ item }: { item: any }) => {
      const status = getStoreStatusBadge(item.state, item.is_active);
      const typeLabel = storeTypeLabels[item.store_type] || item.store_type;
      const typeIcon = storeTypeIcons[item.store_type] || 'store';

      return (
        <Pressable
          onPress={() => handleStorePress(item)}
          style={({ pressed }) => [styles.storeCard, pressed && { backgroundColor: colorScales.gray[50] }]}
        >
          <View style={styles.storeIcon}>
            <Icon name={typeIcon} size={20} color={colors.primary} />
          </View>

          <View style={styles.storeInfo}>
            <View style={styles.storeNameRow}>
              <Text style={styles.storeName} numberOfLines={1}>
                {item.name}
              </Text>
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

          <Pressable
            onPress={() => {
              setSelectedStore(item);
              setShowActionsSheet(true);
            }}
            hitSlop={8}
            style={styles.moreButton}
          >
            <Icon name="more-vertical" size={18} color={colorScales.gray[400]} />
          </Pressable>
        </Pressable>
      );
    },
    [handleStorePress],
  );

  const formatNumber = (num: number): string => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={stores}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        ListHeaderComponent={
          <View>
            {/* Stats Summary */}
            {stats && !statsLoading && (
              <View style={styles.statsRow}>
                <View style={[styles.statCard, { backgroundColor: colorScales.blue[50] }]}>
                  <Text style={[styles.statValue, { color: colorScales.blue[700] }]}>{stats.total_stores}</Text>
                  <Text style={[styles.statLabel, { color: colorScales.blue[600] }]}>Totales</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: colorScales.green[50] }]}>
                  <Text style={[styles.statValue, { color: colorScales.green[700] }]}>{stats.active_stores}</Text>
                  <Text style={[styles.statLabel, { color: colorScales.green[600] }]}>Activas</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: colorScales.amber[50] }]}>
                  <Text style={[styles.statValue, { color: colorScales.amber[700] }]}>{formatNumber(stats.total_orders)}</Text>
                  <Text style={[styles.statLabel, { color: colorScales.amber[600] }]}>Órdenes</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: colorScales.blue[50] }]}>
                  <Text style={[styles.statValue, { color: colorScales.blue[700], fontSize: 14 }]} numberOfLines={1} adjustsFontSizeToFit>
                    {formatCurrency(stats.total_revenue || 0)}
                  </Text>
                  <Text style={[styles.statLabel, { color: colorScales.blue[600] }]}>Ganancias</Text>
                </View>
              </View>
            )}

            {/* Search */}
            <View style={styles.searchContainer}>
              <SearchBar placeholder="Buscar tiendas..." value={search} onChangeText={handleSearch} />
            </View>

            {/* Filter: Store Type */}
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Tipo:</Text>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={STORE_TYPE_FILTERS}
                keyExtractor={(f) => f.value}
                contentContainerStyle={styles.chipList}
                renderItem={({ item: f }) => (
                  <Pressable
                    onPress={() => {
                      setTypeFilter(f.value);
                      setPage(1);
                    }}
                    style={[styles.filterChip, typeFilter === f.value && styles.filterChipActive]}
                  >
                    <Text style={[styles.filterChipText, typeFilter === f.value && styles.filterChipTextActive]}>
                      {f.label}
                    </Text>
                  </Pressable>
                )}
              />
            </View>

            {/* Filter: Status */}
            <View style={styles.filterRow}>
              <Text style={styles.filterLabel}>Estado:</Text>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={STATUS_FILTERS}
                keyExtractor={(f) => f.value}
                contentContainerStyle={styles.chipList}
                renderItem={({ item: f }) => (
                  <Pressable
                    onPress={() => {
                      setStatusFilter(f.value);
                      setPage(1);
                    }}
                    style={[styles.filterChip, statusFilter === f.value && styles.filterChipActive]}
                  >
                    <Text style={[styles.filterChipText, statusFilter === f.value && styles.filterChipTextActive]}>
                      {f.label}
                    </Text>
                  </Pressable>
                )}
              />
            </View>

            {/* Divider */}
            <View style={styles.divider} />
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.centerContent}>
              <Spinner />
            </View>
          ) : (
            <EmptyState
              title="Sin tiendas"
              description={search || typeFilter || statusFilter ? 'No se encontraron tiendas con esos filtros' : 'No hay tiendas disponibles'}
              icon="store"
            />
          )
        }
        renderItem={renderStoreItem}
      />

      {/* FAB: Create Store */}
      <Pressable onPress={() => router.push('/(org-admin)/stores/create' as never)} style={styles.fab}>
        <Icon name="plus" size={24} color={colors.background} />
      </Pressable>

      {/* Actions Bottom Sheet */}
      <BottomSheet visible={showActionsSheet} onClose={() => setShowActionsSheet(false)}>
        <View style={styles.sheetContent}>
          {selectedStore && (
            <>
              <Text style={styles.sheetTitle}>{selectedStore.name}</Text>
              <Pressable style={styles.sheetAction} onPress={() => handleStoreAction(selectedStore, 'edit')}>
                <Icon name="edit" size={20} color={colorScales.gray[700]} />
                <Text style={styles.sheetActionText}>Editar Tienda</Text>
              </Pressable>
              <Pressable style={styles.sheetAction} onPress={() => handleStoreAction(selectedStore, 'settings')}>
                <Icon name="settings" size={20} color={colorScales.gray[700]} />
                <Text style={styles.sheetActionText}>Configuración</Text>
              </Pressable>
              <View style={styles.sheetDivider} />
              <Pressable style={styles.sheetAction} onPress={() => handleStoreAction(selectedStore, 'delete')}>
                <Icon name="trash-2" size={20} color={colors.error} />
                <Text style={[styles.sheetActionText, { color: colors.error }]}>Eliminar Tienda</Text>
              </Pressable>
            </>
          )}
        </View>
      </BottomSheet>

      {/* Delete Confirmation Modal */}
      <Modal visible={showDeleteModal} onClose={() => setShowDeleteModal(false)} title="Eliminar Tienda">
        <View style={styles.deleteContent}>
          {deleteTarget && (
            <>
              <View style={styles.deleteWarning}>
                <Icon name="alert-triangle" size={24} color={colors.error} />
                <Text style={styles.deleteWarningText}>
                  Estás a punto de eliminar la tienda <Text style={styles.deleteStoreName}>{deleteTarget.name}</Text>.
                  Esta acción no se puede deshacer.
                </Text>
              </View>

              <Text style={styles.deleteInstruction}>
                Escribe <Text style={styles.deleteSlugText}>{deleteTarget.slug}</Text> para confirmar:
              </Text>

              <TextInput
                style={styles.deleteInput}
                value={deleteSlug}
                onChangeText={setDeleteSlug}
                placeholder={deleteTarget.slug}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <View style={styles.deleteActions}>
                <Pressable
                  style={styles.deleteCancelBtn}
                  onPress={() => {
                    setShowDeleteModal(false);
                    setDeleteTarget(null);
                    setDeleteSlug('');
                  }}
                >
                  <Text style={styles.deleteCancelText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  style={[styles.deleteConfirmBtn, deleteSlug !== deleteTarget.slug && styles.deleteConfirmBtnDisabled]}
                  onPress={handleConfirmDelete}
                  disabled={deleteSlug !== deleteTarget.slug || deleteMutation.isPending}
                >
                  <Text style={styles.deleteConfirmText}>
                    {deleteMutation.isPending ? 'Eliminando...' : 'Eliminar Tienda'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </Modal>
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
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  statCard: {
    flex: 1,
    borderRadius: borderRadius.xl,
    padding: spacing[2],
    alignItems: 'center',
    minWidth: 0,
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
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
  },
  filterLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginRight: spacing[2],
  },
  chipList: {
    gap: spacing[2],
  },
  filterChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  filterChipTextActive: {
    color: colors.background,
  },
  divider: {
    height: 1,
    backgroundColor: colorScales.gray[200],
    marginHorizontal: spacing[4],
    marginVertical: spacing[2],
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[16],
  },
  listContent: {
    paddingBottom: spacing[20],
  },
  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    marginHorizontal: spacing[4],
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
  moreButton: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: spacing[6],
    right: spacing[6],
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
  sheetContent: {
    padding: spacing[4],
    paddingBottom: spacing[8],
  },
  sheetTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    marginBottom: spacing[4],
  },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  sheetActionText: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  sheetDivider: {
    height: 1,
    backgroundColor: colorScales.gray[200],
    marginVertical: spacing[1],
  },
  deleteContent: {
    padding: spacing[4],
  },
  deleteWarning: {
    flexDirection: 'row',
    gap: spacing[3],
    backgroundColor: colorScales.red[50],
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    marginBottom: spacing[4],
  },
  deleteWarningText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.red[700],
    lineHeight: 20,
  },
  deleteStoreName: {
    fontWeight: typography.fontWeight.bold as any,
  },
  deleteInstruction: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
    marginBottom: spacing[3],
  },
  deleteSlugText: {
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  deleteInput: {
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily,
    backgroundColor: colors.background,
    marginBottom: spacing[4],
  },
  deleteActions: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  deleteCancelBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    alignItems: 'center',
  },
  deleteCancelText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  deleteConfirmBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.error,
    alignItems: 'center',
  },
  deleteConfirmBtnDisabled: {
    opacity: 0.4,
  },
  deleteConfirmText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: '#FFFFFF',
  },
});
