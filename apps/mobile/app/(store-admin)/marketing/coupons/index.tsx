/**
 * CuponsListScreen — Pantalla completa de Marketing → Cupones.
 *
 * Réplica del viewport web `coupons.component.ts`:
 * - StickyHeader con título + CTA crear
 * - CuponStatsCards (4 KPIs)
 * - SearchBar con debounce 300ms
 * - FlatList con CuponCard
 * - EmptyState ("No hay cupones creados")
 * - RefreshControl
 * - CuponUpsertModal (create / edit)
 * - ConfirmDialog para delete
 *
 * Pattern idéntico a PromotionsListScreen.
 */
import { useState, useCallback } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
import { CouponsService } from '@/features/store/services/coupons.service';
import {
  SearchBar,
  EmptyState,
  Spinner,
  ConfirmDialog,
} from '@/shared/components';
import { getNextPageParam } from '@/core/api/pagination';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import type { Coupon } from '@/features/store/types/coupon.types';
import { COUPON_LABELS } from '@/features/store/constants/coupon-labels';
import { CuponStatsCards } from '@/features/store/components/coupon-stats-cards';
import { CuponCard } from '@/features/store/components/coupon-card';
import { CuponUpsertModal } from '@/features/store/components/coupon-upsert-modal';
import { StickyHeader } from '@/shared/components/sticky-header/sticky-header';
import { spacing } from '@/shared/theme';

export default function CuponsListScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  // Modal upsert state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; code: string } | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isRefetching,
  } = useInfiniteQuery({
    queryKey: ['coupons', { search }],
    queryFn: ({ pageParam = 1 }) =>
      CouponsService.list({
        page: pageParam,
        limit: 20,
        search: search || undefined,
      }),
    getNextPageParam,
    initialPageParam: 1,
  });

  const coupons = data?.pages.flatMap((p) => p.data) ?? [];

  // ── Mutations ─────────────────────────────────────────────────────────
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['coupons'] });
    queryClient.invalidateQueries({ queryKey: ['coupon-stats'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => CouponsService.remove(id),
    onSuccess: (res) => {
      toastSuccess(res?.message ?? 'Cupón eliminado exitosamente');
      invalidate();
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.message ||
        err.message ||
        'Error al eliminar el cupón';
      toastError(msg);
      setDeleteTarget(null);
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleCreate = () => {
    setEditingCoupon(null);
    setModalOpen(true);
  };

  const handleEdit = (coupon: Coupon) => {
    setEditingCoupon(coupon);
    setModalOpen(true);
  };

  const handleDeleteClick = (coupon: Coupon) => {
    setDeleteTarget({ id: coupon.id, code: coupon.code });
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id);
  };

  // ── Render helpers ───────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: Coupon }) => (
      <CuponCard
        coupon={item}
        onEdit={() => handleEdit(item)}
        onDelete={() => handleDeleteClick(item)}
      />
    ),
    [],
  );

  const keyExtractor = useCallback(
    (item: Coupon | undefined, index: number) =>
      item ? String(item.id) : `coupon-${index}`,
    [],
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <FlatList
        data={coupons}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View>
            <StickyHeader
              title={COUPON_LABELS.title}
              actions={[
                {
                  label: COUPON_LABELS.ctaNew,
                  variant: 'primary',
                  icon: 'plus',
                  onPress: handleCreate,
                },
              ]}
            />
            <CuponStatsCards />
            <View style={styles.searchRow}>
              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder={COUPON_LABELS.ctaSearch}
                debounceMs={300}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              icon={COUPON_LABELS.emptyIcon}
              title={COUPON_LABELS.emptyTitle}
              description={COUPON_LABELS.emptyDescription}
              actionLabel={COUPON_LABELS.ctaNew}
              onAction={handleCreate}
            />
          )
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        contentContainerStyle={styles.listContent}
      />

      {/* Create / Edit modal */}
      <CuponUpsertModal
        visible={modalOpen}
        coupon={editingCoupon}
        onClose={() => {
          setModalOpen(false);
          setEditingCoupon(null);
        }}
        onSaved={(message) => {
          toastSuccess(message ?? 'Cupón guardado exitosamente');
          invalidate();
          setModalOpen(false);
          setEditingCoupon(null);
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        visible={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title={COUPON_LABELS.dialogDeleteTitle}
        message={
          deleteTarget
            ? COUPON_LABELS.dialogDeleteMessage(deleteTarget.code)
            : ''
        }
        confirmLabel={COUPON_LABELS.dialogDeleteConfirm}
        cancelLabel={COUPON_LABELS.dialogDeleteDeny}
        destructive
        loading={deleteMutation.isPending}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  listContent: {
    paddingBottom: spacing[8],
  },
  searchRow: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
});
