import { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import type { StockMovement, MovementType } from '@/features/store/types';
import { MOVEMENT_TYPE_LABELS, MOVEMENT_INBOUND_TYPES, MOVEMENT_OUTBOUND_TYPES } from '@/features/store/types';
import { RecordCard } from '@/shared/components/record-card/record-card';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { formatRelative } from '@/shared/utils/date';
import { spacing, borderRadius, colorScales, typography, colors } from '@/shared/theme';

const TYPE_VARIANT: Record<MovementType, 'success' | 'error' | 'info' | 'warning' | 'default'> = {
  stock_in: 'success',
  stock_out: 'error',
  transfer: 'warning',
  adjustment: 'info',
  sale: 'error',
  return: 'success',
  damage: 'error',
  expiration: 'error',
};

const TYPE_ICON: Record<MovementType, string> = {
  stock_in: 'arrow-down-circle',
  stock_out: 'arrow-up-circle',
  transfer: 'repeat',
  adjustment: 'edit-3',
  sale: 'shopping-cart',
  return: 'corner-up-left',
  damage: 'alert-triangle',
  expiration: 'clock',
};

type FilterChip = { label: string; value: MovementType | 'all' };

const FILTER_CHIPS: FilterChip[] = [
  { label: 'Todos', value: 'all' },
  { label: 'Entrada', value: 'stock_in' },
  { label: 'Salida', value: 'stock_out' },
  { label: 'Venta', value: 'sale' },
  { label: 'Transferencia', value: 'transfer' },
  { label: 'Ajuste', value: 'adjustment' },
];

function signFor(item: StockMovement): '+' | '-' | '' {
  if (MOVEMENT_INBOUND_TYPES.has(item.movement_type)) return '+';
  if (MOVEMENT_OUTBOUND_TYPES.has(item.movement_type)) return '-';
  if (item.movement_type === 'adjustment') return item.quantity < 0 ? '-' : '+';
  return '';
}

function footerToneFor(item: StockMovement): 'success' | 'error' | 'default' {
  if (MOVEMENT_INBOUND_TYPES.has(item.movement_type)) return 'success';
  if (MOVEMENT_OUTBOUND_TYPES.has(item.movement_type)) return 'error';
  if (item.movement_type === 'adjustment') return item.quantity < 0 ? 'error' : 'success';
  return 'default';
}

const MovementCard = ({ item }: { item: StockMovement }) => {
  const variant = TYPE_VARIANT[item.movement_type] ?? 'default';
  const label = MOVEMENT_TYPE_LABELS[item.movement_type] ?? item.movement_type;
  const icon = TYPE_ICON[item.movement_type] ?? 'package';
  const sign = signFor(item);
  const absQty = Math.abs(item.quantity);
  const subtitle = item.reference || item.notes || undefined;

  return (
    <RecordCard
      title={item.product_name || 'Producto sin nombre'}
      subtitle={subtitle}
      eyebrow={label.toUpperCase()}
      media={{ icon }}
      badges={[{ label, variant }]}
      details={[
        { label: 'Ubicación', value: item.location_name || '—', icon: 'map-pin' },
        { label: 'Tienda', value: item.store_name || '—', icon: 'store' },
        { label: 'Usuario', value: item.user_name || '—', icon: 'user' },
        { label: 'Fecha', value: formatRelative(item.created_at), icon: 'clock' },
      ]}
      footerLabel="Cantidad"
      footerValue={`${sign}${absQty}`}
      footerTone={footerToneFor(item)}
    />
  );
};

export default function MovementsScreen() {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<MovementType | 'all'>('all');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['movements', search, activeFilter],
    queryFn: () =>
      InventoryService.getMovements({
        search: search || undefined,
        movement_type: activeFilter === 'all' ? undefined : activeFilter,
      }),
  });

  const movements: StockMovement[] = data?.data ?? [];

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  return (
    <View style={styles.container}>
      <FlatList
        data={movements}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <MovementCard item={item} />}
        ListHeaderComponent={
          <View>
            <View style={styles.searchWrap}>
              <SearchBar value={search} onChangeText={setSearch} onClear={() => setSearch('')} placeholder="Buscar movimientos..." />
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
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScales.gray[50] },
  searchWrap: { marginBottom: spacing[3] },
  filterRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3], flexWrap: 'wrap' },
  chip: { paddingHorizontal: spacing[3], paddingVertical: 6, borderRadius: borderRadius.full },
  chipActive: { backgroundColor: colors.primary },
  chipInactive: { backgroundColor: colorScales.gray[200] },
  chipText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any },
  chipTextActive: { color: '#fff' },
  chipTextInactive: { color: colorScales.gray[600] },
  separator: { height: spacing[3] },
  listContent: { paddingHorizontal: spacing[4], paddingBottom: spacing[6] },
});
