import { useState, useCallback } from 'react';
import { View, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
import { PromotionsService } from '@/features/store/services/promotions.service';
import {
  Card,
  SearchBar,
  EmptyState,
  Spinner,
  ConfirmDialog,
  Pagination,
} from '@/shared/components';
import { getNextPageParam } from '@/core/api/pagination';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import type {
  CreatePromotionDto,
  Promotion,
  UpdatePromotionDto,
} from '@/features/store/types/promotions.types';
import { PROMOTION_LABELS } from '@/features/store/constants/promotion-labels';
import { PromotionStatsCards } from '@/features/store/components/promotion-stats-cards';
import {
  PromotionCard,
} from '@/features/store/components/promotion-card';
import {
  PromotionFilters,
  type PromotionFiltersValue,
} from '@/features/store/components/promotion-filters';
import { PromotionUpsertModal } from '@/features/store/components/promotion-upsert-modal';
import { StickyHeader } from '@/shared/components/sticky-header/sticky-header';
import { spacing } from '@/shared/theme';

export default function PromotionsListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<PromotionFiltersValue>({});
  const [page, setPage] = useState(1);

  // Modal upsert state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);

  // Confirmation dialog state (mirror web — Cancel + Delete)
  const [confirm, setConfirm] = useState<
    | { kind: 'cancel'; id: number }
    | { kind: 'delete'; id: number }
    | null
  >(null);

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
    queryKey: ['promotions', { search, filters, page }],
    queryFn: ({ pageParam = 1 }) =>
      PromotionsService.list({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        state: filters.state,
        type: filters.type,
        scope: filters.scope,
      }),
    getNextPageParam: (last) => last.meta?.total_pages > last.meta?.page ? last.meta.page + 1 : undefined,
    initialPageParam: 1,
  });

  const promotions = data?.pages.flatMap((p) => p.data) ?? [];
  const totalMeta = data?.pages[0]?.meta;
  const total = totalMeta?.total ?? 0;
  const totalPages = totalMeta?.total_pages ?? 1;

  // ── Mutations ─────────────────────────────────────────────────────────
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['promotions'] });
    queryClient.invalidateQueries({ queryKey: ['promotion-stats'] });
  };

  function bindMutation<T>(
    key: string,
    fn: (id: number, ...rest: any[]) => Promise<any>,
    successMsg: (res: any) => string,
  ) {
    return useMutation({
      mutationFn: (id: number) => fn(id),
      onSuccess: (res) => {
        toastSuccess(successMsg(res) || 'Operacion exitosa');
        invalidate();
      },
      onError: (err: any) => {
        const msg =
          err?.response?.data?.message ||
          err?.message ||
          'Error';
        toastError(msg);
      },
    });
  }

  // Activar / Pausar / Cancelar / Eliminar — el backend devuelve `{ data, message }` verbatim.
  const activateMutation = bindMutation(
    'activate',
    (id: number) => PromotionsService.activate(id),
    (res) => res?.message ?? 'Promocion activada exitosamente',
  );
  const pauseMutation = bindMutation(
    'pause',
    (id: number) => PromotionsService.pause(id),
    (res) => res?.message ?? 'Promocion pausada exitosamente',
  );
  const cancelMutation = bindMutation(
    'cancel',
    (id: number) => PromotionsService.cancel(id),
    (res) => res?.message ?? 'Promocion cancelada exitosamente',
  );
  const deleteMutation = bindMutation(
    'delete',
    (id: number) => PromotionsService.remove(id),
    (res) => res?.message ?? 'Promocion eliminada exitosamente',
  );

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleCreate = () => {
    setEditingPromotion(null);
    setModalOpen(true);
  };
  const handleEdit = (promo: Promotion) => {
    setEditingPromotion(promo);
    setModalOpen(true);
  };
  const handlePress = (id: number) => {
    router.push(`/(store-admin)/marketing/promotions/${id}`);
  };
  const handleActivate = (id: number) => activateMutation.mutate(id);
  const handlePause = (id: number) => pauseMutation.mutate(id);
  const handleCancelClick = (id: number) =>
    setConfirm({ kind: 'cancel', id });
  const handleDeleteClick = (id: number) =>
    setConfirm({ kind: 'delete', id });

  const handleConfirm = () => {
    if (!confirm) return;
    if (confirm.kind === 'cancel') cancelMutation.mutate(confirm.id);
    if (confirm.kind === 'delete') deleteMutation.mutate(confirm.id);
    setConfirm(null);
  };

  // ── Render helpers ────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: Promotion }) => (
      <PromotionCard
        promotion={item}
        onPress={() => handlePress(item.id)}
        onEdit={() => handleEdit(item)}
        onActivate={() => handleActivate(item.id)}
        onPause={() => handlePause(item.id)}
        onCancel={() => handleCancelClick(item.id)}
        onDelete={() => handleDeleteClick(item.id)}
      />
    ),
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
        data={promotions}
        keyExtractor={(item, index) => item ? String(item.id) : `promotion-${index}`}
        renderItem={renderItem}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View>
            <StickyHeader
              title={PROMOTION_LABELS.title}
              actions={[
                {
                  label: PROMOTION_LABELS.ctaNew,
                  variant: 'primary',
                  icon: 'plus',
                  onPress: handleCreate,
                },
              ]}
            />
            <PromotionStatsCards />
            <View style={styles.searchRow}>
              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder={PROMOTION_LABELS.ctaSearch}
                debounceMs={300}
              />
            </View>
            <View style={styles.filterRow}>
              <PromotionFilters value={filters} onChange={setFilters} />
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              icon="tag"
              title={PROMOTION_LABELS.emptyTitle}
              description={PROMOTION_LABELS.emptyDescription}
              actionLabel={PROMOTION_LABELS.ctaNew}
              onAction={handleCreate}
            />
          )
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        ListFooterComponent={
          totalPages > 1 ? (
            <View style={styles.paginationWrap}>
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                info={`${total} ${PROMOTION_LABELS.pluralLabel}`}
              />
            </View>
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />

      <PromotionUpsertModal
        visible={modalOpen}
        promotion={editingPromotion}
        onClose={() => {
          setModalOpen(false);
          setEditingPromotion(null);
        }}
        onSaved={(message) => {
          toastSuccess(message || 'Promocion guardada exitosamente');
          invalidate();
          setModalOpen(false);
          setEditingPromotion(null);
        }}
      />

      <ConfirmDialog
        visible={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={handleConfirm}
        title={
          confirm?.kind === 'cancel'
            ? PROMOTION_LABELS.dialogCancelTitle
            : PROMOTION_LABELS.dialogDeleteTitle
        }
        message={
          confirm?.kind === 'cancel'
            ? PROMOTION_LABELS.dialogCancelMessage
            : PROMOTION_LABELS.dialogDeleteMessage
        }
        confirmLabel={
          confirm?.kind === 'cancel'
            ? PROMOTOTION_LABELS_DIALOG_CONFIRM_CANCEL
            : PROMOTOTION_LABELS_DIALOG_CONFIRM_DELETE
        }
        cancelLabel={
          confirm?.kind === 'cancel'
            ? PROMOTION_LABELS.dialogCancelDeny
            : PROMOTION_LABELS.dialogDeleteDeny
        }
        destructive={confirm?.kind === 'delete'}
        loading={
          confirm?.kind === 'cancel'
            ? cancelMutation.isPending
            : confirm?.kind === 'delete'
              ? deleteMutation.isPending
              : false
        }
      />
    </View>
  );
}

// Constantes para evitar typos (siguen al Web Visual Pattern verbatim).
const PROMOTOTION_LABELS_DIALOG_CONFIRM_CANCEL = PROMOTION_LABELS.dialogCancelConfirm;
const PROMOTOTION_LABELS_DIALOG_CONFIRM_DELETE = PROMOTION_LABELS.dialogDeleteConfirm;

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
  filterRow: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
  },
  paginationWrap: {
    paddingVertical: spacing[4],
  },
});
