import { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import { getNextPageParam } from '@/core/api/pagination';
import type { CreateTransferDto } from '@/features/store/services/inventory.service';
import type { StockTransfer, TransferState } from '@/features/store/types';
import { TRANSFER_STATE_LABELS } from '@/features/store/types';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Icon } from '@/shared/components/icon/icon';
import { Input } from '@/shared/components/input/input';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Button } from '@/shared/components/button/button';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { formatRelative } from '@/shared/utils/date';
import { spacing, borderRadius, colorScales, typography, colors, shadows } from '@/shared/theme';

const STATE_VARIANT: Record<TransferState, 'warning' | 'info' | 'success' | 'default'> = {
  pending: 'warning',
  in_transit: 'info',
  completed: 'success',
  cancelled: 'default',
};

type FilterChip = { label: string; value: TransferState | 'all' };

const FILTER_CHIPS: FilterChip[] = [
  { label: 'Todas', value: 'all' },
  { label: 'Pendientes', value: 'pending' },
  { label: 'En Tránsito', value: 'in_transit' },
  { label: 'Completadas', value: 'completed' },
  { label: 'Canceladas', value: 'cancelled' },
];

const TransferCard = ({ item }: { item: StockTransfer }) => (
  <Card style={styles.cardMargin}>
    <View style={styles.cardHeader}>
      <View style={styles.cardHeaderLeft}>
        <Text style={styles.cardTitle}>Transferencia #{item.id.slice(0, 8)}</Text>
        <Text style={styles.cardSubtitle}>
          {item.origin_location_name} → {item.destination_location_name}
        </Text>
      </View>
      <Badge label={TRANSFER_STATE_LABELS[item.state]} variant={STATE_VARIANT[item.state]} size="sm" />
    </View>
    <View style={styles.cardFooter}>
      <View style={styles.footerLeft}>
        <Icon name="package" size={14} color={colorScales.gray[500]} />
        <Text style={styles.footerDetail}>{item.product_count} productos</Text>
      </View>
      <Text style={styles.footerDate}>{formatRelative(item.created_at)}</Text>
    </View>
  </Card>
);

export default function TransfersScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<TransferState | 'all'>('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<CreateTransferDto>({
    origin_location_id: '',
    destination_location_id: '',
    items: [],
  });

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch, isRefetching } = useInfiniteQuery({
    queryKey: ['transfers', search, activeFilter],
    queryFn: ({ pageParam = 1 }) =>
      InventoryService.getTransfers({
        page: pageParam,
        limit: 20,
        search: search || undefined,
        state: activeFilter === 'all' ? undefined : activeFilter,
      }),
    getNextPageParam,
    initialPageParam: 1,
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreateTransferDto) => InventoryService.createTransfer(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      setModalVisible(false);
      setForm({ origin_location_id: '', destination_location_id: '', items: [] });
      toastSuccess('Transferencia creada correctamente');
    },
    onError: () => toastError('Error al crear la transferencia'),
  });

  const transfers = data?.pages.flatMap((p) => p.data) ?? [];

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleSubmit = () => {
    if (!form.origin_location_id || !form.destination_location_id || form.items.length === 0) return;
    createMutation.mutate(form);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={transfers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TransferCard item={item} />}
        ListHeaderComponent={
          <View>
            <StatsGrid
              style={styles.statsWrap}
              items={[
                {
                  label: 'Pendientes',
                  value: transfers.filter((t) => t.state === 'pending').length,
                  icon: <Icon name="clock" size={14} color={colorScales.amber[600]} />,
                },
                {
                  label: 'En Tránsito',
                  value: transfers.filter((t) => t.state === 'in_transit').length,
                  icon: <Icon name="truck" size={14} color={colorScales.blue[600]} />,
                },
              ]}
            />

            <View style={styles.searchWrap}>
              <SearchBar value={search} onChangeText={setSearch} onClear={() => setSearch('')} placeholder="Buscar transferencias..." />
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
          isLoading ? <Spinner /> : <EmptyState title="Sin transferencias" description="No se encontraron transferencias" />
        }
        ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
      />

      <Pressable style={styles.fab} onPress={() => setModalVisible(true)} hitSlop={8}>
        <Icon name="plus" size={24} color="#fff" />
      </Pressable>

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setModalVisible(false)} />
        <View style={styles.modalContent}>
          <View style={styles.modalHandleWrap}>
            <View style={styles.modalHandle} />
          </View>
          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>Nueva Transferencia</Text>

            <Input label="Ubicación Origen ID" value={form.origin_location_id} onChangeText={(t) => setForm({ ...form, origin_location_id: t })} placeholder="ID de ubicación origen" />
            <Input label="Ubicación Destino ID" value={form.destination_location_id} onChangeText={(t) => setForm({ ...form, destination_location_id: t })} placeholder="ID de ubicación destino" />

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Productos ({form.items.length})</Text>
              <Pressable style={styles.addProductBtn} onPress={() => setForm({ ...form, items: [...form.items, { product_id: '', quantity: 1 }] })}>
                <Icon name="plus" size={16} color={colors.primary} />
                <Text style={styles.addProductText}>Agregar producto</Text>
              </Pressable>

              {form.items.map((item, idx) => (
                <View key={idx} style={styles.productRow}>
                  <Input
                    label={`Producto ${idx + 1} ID`}
                    value={item.product_id}
                    onChangeText={(t) => {
                      const items = [...form.items];
                      items[idx] = { ...items[idx], product_id: t };
                      setForm({ ...form, items });
                    }}
                    placeholder="ID del producto"
                  />
                  <Input
                    label="Cantidad"
                    value={String(item.quantity)}
                    onChangeText={(t) => {
                      const items = [...form.items];
                      items[idx] = { ...items[idx], quantity: parseInt(t) || 1 };
                      setForm({ ...form, items });
                    }}
                    placeholder="1"
                    keyboardType="numeric"
                  />
                  <Pressable onPress={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })} hitSlop={8}>
                    <Icon name="trash" size={16} color={colorScales.red[500]} />
                  </Pressable>
                </View>
              ))}
            </View>

            <View style={styles.modalActions}>
              <Button title="Cancelar" onPress={() => setModalVisible(false)} variant="outline" fullWidth />
              <View style={styles.actionSpacer} />
              <Button title="Crear Transferencia" onPress={handleSubmit} loading={createMutation.isPending} fullWidth />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScales.gray[50] },
  statsWrap: { paddingHorizontal: spacing[4] },
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
  cardSubtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 2 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colorScales.gray[100] },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  footerDetail: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  footerDate: { fontSize: typography.fontSize.xs, color: colorScales.gray[400] },
  listContent: { paddingBottom: spacing[6] },
  fab: { position: 'absolute', bottom: spacing[6], right: spacing[6], width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadows.lg },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { backgroundColor: colors.card, borderTopLeftRadius: borderRadius['2xl'], borderTopRightRadius: borderRadius['2xl'], maxHeight: '85%', paddingBottom: spacing[6] },
  modalHandleWrap: { width: '100%', alignItems: 'center', paddingTop: spacing[2], paddingBottom: spacing[4] },
  modalHandle: { width: 40, height: 4, backgroundColor: colorScales.gray[300], borderRadius: borderRadius.full },
  modalScroll: { paddingHorizontal: spacing[4] },
  modalTitle: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900], marginBottom: spacing[4] },
  formGroup: { marginBottom: spacing[4] },
  formLabel: { fontSize: typography.fontSize.xs, fontWeight: '600' as any, color: colors.text.secondary, marginBottom: spacing[2], textTransform: 'uppercase', letterSpacing: 1 },
  addProductBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[3], borderWidth: 1, borderStyle: 'dashed', borderColor: colorScales.gray[300], borderRadius: borderRadius.lg, marginBottom: spacing[3] },
  addProductText: { fontSize: typography.fontSize.sm, color: colors.primary, fontWeight: '500' as any },
  productRow: { gap: spacing[2], marginBottom: spacing[3] },
  modalActions: { flexDirection: 'row', marginTop: spacing[4] },
  actionSpacer: { width: spacing[3] },
});
