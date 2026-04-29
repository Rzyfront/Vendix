import { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import type { StockMovement, MovementType } from '@/features/store/types';
import { MOVEMENT_TYPE_LABELS } from '@/features/store/types';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Icon } from '@/shared/components/icon/icon';
import { Input } from '@/shared/components/input/input';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { formatRelative } from '@/shared/utils/date';
import { spacing, borderRadius, colorScales, typography, colors } from '@/shared/theme';

const TYPE_VARIANT: Record<MovementType, 'success' | 'error' | 'info' | 'warning'> = {
  purchase: 'success',
  sale: 'error',
  adjustment: 'info',
  transfer_in: 'warning',
  transfer_out: 'warning',
};

type FilterChip = { label: string; value: MovementType | 'all' };

const FILTER_CHIPS: FilterChip[] = [
  { label: 'Todos', value: 'all' },
  { label: 'Compra', value: 'purchase' },
  { label: 'Venta', value: 'sale' },
  { label: 'Ajuste', value: 'adjustment' },
  { label: 'Transferencia', value: 'transfer_in' },
];

const MovementCard = ({ item }: { item: StockMovement }) => {
  const isPositive = item.type === 'purchase' || item.type === 'transfer_in';
  const variant = TYPE_VARIANT[item.type];
  const label = item.type === 'transfer_in' ? 'Transfer. Entrante' : item.type === 'transfer_out' ? 'Transfer. Saliente' : MOVEMENT_TYPE_LABELS[item.type];

  return (
    <Card style={styles.cardMargin}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.product_name}</Text>
          <View style={styles.subtitleRow}>
            <Text style={styles.quantityText}>
              {isPositive ? '+' : '-'}{item.quantity}
            </Text>
            {item.location_name && <Text style={styles.cardSubtitle}>{item.location_name}</Text>}
          </View>
        </View>
        <Badge label={label} variant={variant} size="sm" />
      </View>
      <View style={styles.cardFooter}>
        {item.reference && <Text style={styles.footerDetail}>Ref: {item.reference}</Text>}
        <Text style={styles.footerDate}>{formatRelative(item.created_at)}</Text>
      </View>
    </Card>
  );
};

export default function MovementsScreen() {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<MovementType | 'all'>('all');

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch, isRefetching } = useInfiniteQuery({
    queryKey: ['movements', search, activeFilter],
    queryFn: ({ pageParam = 1 }) =>
      InventoryService.getMovements({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        type: activeFilter === 'all' ? undefined : activeFilter,
      }),
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination;
      return page < totalPages ? page + 1 : undefined;
    },
    initialPageParam: 1,
  });

  const movements = data?.pages.flatMap((p) => p.data) ?? [];

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  return (
    <View style={styles.container}>
      <FlatList
        data={movements}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MovementCard item={item} />}
        ListHeaderComponent={
          <View>
            <View style={styles.searchWrap}>
              <Input label="Buscar" value={search} onChangeText={setSearch} placeholder="Buscar movimientos..." />
            </View>

            <View style={styles.filterRow}>
              {FILTER_CHIPS.map((chip) => (
                <Pressable
                  key={chip.value}
                  onPress={() => setActiveFilter(chip.value)}
                  style={[styles.chip, activeFilter === chip.value ? styles.chipActive : styles.chipInactive]}
                >
                  <Text style={[styles.chipText, activeFilter === chip.value ? styles.chipTextActive : styles.chipTextInactive]}>
                    {chip.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? <Spinner /> : <EmptyState title="Sin movimientos" description="No se encontraron movimientos de stock" />
        }
        ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScales.gray[50] },
  searchWrap: { paddingHorizontal: spacing[4], marginBottom: spacing[3] },
  filterRow: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], marginBottom: spacing[3] },
  chip: { paddingHorizontal: spacing[3], paddingVertical: 6, borderRadius: borderRadius.full },
  chipActive: { backgroundColor: colors.primary },
  chipInactive: { backgroundColor: colorScales.gray[200] },
  chipText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any },
  chipTextActive: { color: '#fff' },
  chipTextInactive: { color: colorScales.gray[600] },
  cardMargin: { marginHorizontal: spacing[4], marginBottom: spacing[3] },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] },
  cardHeaderLeft: { flex: 1 },
  cardTitle: { fontSize: typography.fontSize.base, fontWeight: '600' as any, color: colorScales.gray[900] },
  subtitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 2 },
  quantityText: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colorScales.gray[700] },
  cardSubtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500] },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colorScales.gray[100] },
  footerDetail: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  footerDate: { fontSize: typography.fontSize.xs, color: colorScales.gray[400] },
  listContent: { paddingBottom: spacing[6] },
});
