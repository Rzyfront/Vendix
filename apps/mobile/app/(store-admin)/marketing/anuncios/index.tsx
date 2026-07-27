/**
 * AnunciosListScreen — Pantalla lista del módulo Marketing — Anuncios.
 *
 * Replica la estructura de `promotions/index.tsx` (ya en el repo):
 *  - FlatList + useInfiniteQuery
 *  - 4 stats cards sticky-top (AnuncioStatsCards)
 *  - SearchBar (debounceMs 700, ver `docs/parity-audit-anuncios.md` §3)
 *  - FilterDropdown status
 *  - AnuncioCard render con RowActionsMenu
 *  - EmptyState verbatim ("Aun no tienes anuncios" / "Sin anuncios para estos filtros" / "No se pudieron cargar los anuncios")
 *  - AnuncioPreviewModal (centered-card xl)
 *  - ConfirmDialog para delete (verbatim "Eliminar anuncio" / `Se eliminara "{title}".`)
 *  - toast verbatim ("Anuncio eliminado." / "Error al eliminar")
 *  - Pull-to-refresh
 *
 * Permission gating (`store:marketing_anuncios:read`) se aplica via `useCan`
 * — ver Step 11. Owners/admins tienen bypass automático.
 */

import { useState, useCallback } from 'react';
import { View, FlatList, RefreshControl, Pressable, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
  type InfiniteData,
} from '@tanstack/react-query';

import { AnunciosService } from '@/features/store/services/anuncios.service';
import { AdCreativeAssetService } from '@/features/store/services/ad-creative-asset.service';

import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { StickyHeader } from '@/shared/components/sticky-header/sticky-header';

import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';

import { spacing, colors, borderRadius, typography } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';

import { AnuncioStatsCards } from '@/features/store/components/anuncio-stats-cards';
import { AnuncioCard } from '@/features/store/components/anuncio-card';
import { AnuncioFilters, type AnuncioFiltersValue } from '@/features/store/components/anuncio-filters';
import { AnuncioPreviewModal } from '@/features/store/components/anuncio-preview-modal';
import { ANUNCIO_LABELS } from '@/features/store/constants/anuncio-labels';
import type { AdCreativeStatus, MarketingAdCreative, PaginatedResponse } from '@/features/store/types/anuncios.types';

const PAGE_LIMIT = 20;

export default function AnunciosListScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<AnuncioFiltersValue>({});

  // Preview modal state
  const [previewing, setPreviewing] = useState<MarketingAdCreative | null>(null);

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<MarketingAdCreative | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    refetch,
    isRefetching,
  } = useInfiniteQuery<PaginatedResponse<MarketingAdCreative>, Error, InfiniteData<PaginatedResponse<MarketingAdCreative>>, ['anuncios', { search: string; status: AdCreativeStatus | undefined }], number>({
    queryKey: ['anuncios', { search, status: filters.status }],
    queryFn: ({ pageParam }) =>
      AnunciosService.list({
        page: pageParam,
        limit: PAGE_LIMIT,
        search: search || undefined,
        status: filters.status,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const p = lastPage?.pagination;
      if (!p) return undefined;
      const hasNext = p.hasNext ?? p.page < p.totalPages;
      return hasNext ? p.page + 1 : undefined;
    },
  });

  // Summary query (used to detect errors)
  const { isError: summaryError } = useQuery({
    queryKey: ['anuncio-stats'],
    queryFn: () => AnunciosService.getSummary(),
  });

  const anuncios = data?.pages.flatMap((p) => p.data ?? []) ?? [];
  const firstPage = data?.pages[0];
  const total = firstPage?.pagination?.total ?? 0;

  // ── Mutations ──────────────────────────────────────────────────────────
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['anuncios'] });
    queryClient.invalidateQueries({ queryKey: ['anuncio-stats'] });
  }, [queryClient]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => AnunciosService.remove(id),
    onSuccess: (res) => {
      toastSuccess(res?.message || ANUNCIO_LABELS.toastDeleted);
      invalidate();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      const msg =
        e?.response?.data?.message ||
        e?.message ||
        ANUNCIO_LABELS.toastErrDelete;
      toastError(msg);
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────
  const handlePress = useCallback(
    (id: number) => {
      router.push(`/(store-admin)/marketing/anuncios/${id}` as never);
    },
    [router],
  );

  const handleOpenPreview = useCallback((anuncio: MarketingAdCreative) => {
    setPreviewing(anuncio);
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewing(null);
  }, []);

  const handleCopy = useCallback((anuncio: MarketingAdCreative) => {
    void AdCreativeAssetService.copyImage(anuncio);
  }, []);
  const handleDownload = useCallback((anuncio: MarketingAdCreative) => {
    void AdCreativeAssetService.download(anuncio);
  }, []);
  const handleShare = useCallback((anuncio: MarketingAdCreative) => {
    void AdCreativeAssetService.share(anuncio);
  }, []);
  const handleDelete = useCallback((anuncio: MarketingAdCreative) => {
    setConfirmDelete(anuncio);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (!confirmDelete) return;
    deleteMutation.mutate(confirmDelete.id);
    setConfirmDelete(null);
  }, [confirmDelete, deleteMutation]);

  const handleCreate = useCallback(() => {
    router.push('/(store-admin)/marketing/anuncios/create' as never);
  }, [router]);

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  // ── Render helpers ────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: MarketingAdCreative }) => (
      <AnuncioCard
        anuncio={item}
        onPress={() => handlePress(item.id)}
        onView={() => handleOpenPreview(item)}
        onCopy={() => handleCopy(item)}
        onDownload={() => handleDownload(item)}
        onShare={() => handleShare(item)}
        onDelete={() => handleDelete(item)}
      />
    ),
    [handlePress, handleOpenPreview, handleCopy, handleDownload, handleShare, handleDelete],
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const hasFilters = Boolean(search.trim() || filters.status);

  return (
    <View style={styles.container}>
      <FlatList
        data={anuncios}
        keyExtractor={(item, index) => (item ? String(item.id) : `anuncio-${index}`)}
        renderItem={renderItem}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View>
            <StickyHeader
              title={ANUNCIO_LABELS.title}
              actions={[
                {
                  label: ANUNCIO_LABELS.ctaNew,
                  variant: 'primary',
                  icon: 'plus',
                  onPress: handleCreate,
                },
              ]}
            />
            <AnuncioStatsCards />
            <View style={styles.searchRow}>
              <SearchBar
                value={search}
                onChangeText={setSearch}
                placeholder={ANUNCIO_LABELS.ctaSearch}
                debounceMs={700}
              />
              <Pressable
                onPress={handleCreate}
                accessibilityLabel={ANUNCIO_LABELS.ctaNew}
                style={({ pressed }) => [
                  styles.createBtn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Icon name="plus" size={18} color={colors.background} />
                <Text style={styles.createBtnText}>{ANUNCIO_LABELS.ctaNew}</Text>
              </Pressable>
            </View>
            <View style={styles.filterRow}>
              <AnuncioFilters value={filters} onChange={setFilters} />
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              icon="image-plus"
              title={summaryError ? ANUNCIO_LABELS.emptyNoAnunciosLoad : (hasFilters ? ANUNCIO_LABELS.emptyNoAnunciosForFilters : ANUNCIO_LABELS.emptyNoAnuncios)}
              description={
                summaryError
                  ? ANUNCIO_LABELS.toastErrLoad
                  : hasFilters
                    ? ANUNCIO_LABELS.emptyNoAnunciosForFiltersDesc
                    : ANUNCIO_LABELS.emptyNoAnunciosDesc
              }
              actionLabel={hasFilters ? ANUNCIO_LABELS.ctaClearFilters : ANUNCIO_LABELS.ctaCreate}
              onAction={hasFilters ? () => { setSearch(''); setFilters({}); } : handleCreate}
            />
          )
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />
        }
        contentContainerStyle={styles.listContent}
      />

      <AnuncioPreviewModal
        visible={previewing !== null}
        anuncio={previewing}
        onClose={handleClosePreview}
      />

      <ConfirmDialog
        visible={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleConfirmDelete}
        title={ANUNCIO_LABELS.dialogDeleteTitle}
        message={
          confirmDelete
            ? ANUNCIO_LABELS.dialogDeleteMessageTemplate.replace(
                '{title}',
                confirmDelete.title,
              )
            : ''
        }
        confirmLabel={ANUNCIO_LABELS.dialogDeleteConfirm}
        cancelLabel={ANUNCIO_LABELS.dialogDeleteDeny}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
  },
  createBtnText: {
    color: colors.background,
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
  },
  filterRow: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
  },
});
