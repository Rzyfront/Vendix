import { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import type { CreateAdjustmentDto } from '@/features/store/services/inventory.service';
import type {
  StockAdjustment,
  AdjustmentType,
  AdjustmentState,
} from '@/features/store/types';
import {
  ADJUSTMENT_TYPE_LABELS,
  ADJUSTMENT_STATE_LABELS,
} from '@/features/store/types';
import { StatsCard } from '@/shared/components/stats-card/stats-card';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Icon } from '@/shared/components/icon/icon';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { formatRelative } from '@/shared/utils/date';
import { spacing, borderRadius, colorScales, typography, colors, shadows } from '@/shared/theme';

const TYPE_VARIANT: Record<AdjustmentType, 'success' | 'error' | 'info'> = {
  in: 'success',
  out: 'error',
  adjustment: 'info',
};

const STATE_VARIANT: Record<AdjustmentState, 'warning' | 'success'> = {
  pending: 'warning',
  applied: 'success',
};

type FilterChip = { label: string; value: AdjustmentType | 'all' };

const FILTER_CHIPS: FilterChip[] = [
  { label: 'Todas', value: 'all' },
  { label: 'Entrada', value: 'in' },
  { label: 'Salida', value: 'out' },
  { label: 'Ajuste', value: 'adjustment' },
];

const AdjustmentCard = ({ item }: { item: StockAdjustment }) => (
  <Card style={styles.cardMargin}>
    <View style={styles.cardHeader}>
      <View style={styles.cardHeaderLeft}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.description}</Text>
        <Text style={styles.cardSubtitle}>{item.product_name}</Text>
      </View>
      <View style={styles.badgeRow}>
        <Badge label={ADJUSTMENT_TYPE_LABELS[item.type]} variant={TYPE_VARIANT[item.type]} size="sm" />
        <Badge label={ADJUSTMENT_STATE_LABELS[item.state]} variant={STATE_VARIANT[item.state]} size="sm" />
      </View>
    </View>
    <View style={styles.cardFooter}>
      <Text style={styles.footerDetail}>Qty: {item.quantity}</Text>
      {item.location_name && <Text style={styles.footerDetail}>{item.location_name}</Text>}
      <Text style={styles.footerDate}>{formatRelative(item.created_at)}</Text>
    </View>
  </Card>
);

export default function AdjustmentsScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<AdjustmentType | 'all'>('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState<CreateAdjustmentDto>({
    product_id: '',
    description: '',
    type: 'in',
    quantity: 0,
    reason: '',
    location_id: '',
  });

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch, isRefetching } = useInfiniteQuery({
    queryKey: ['adjustments', search, activeFilter],
    queryFn: ({ pageParam = 1 }) =>
      InventoryService.getAdjustments({
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

  const createMutation = useMutation({
    mutationFn: (dto: CreateAdjustmentDto) => InventoryService.createAdjustment(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      setModalVisible(false);
      setForm({ product_id: '', description: '', type: 'in', quantity: 0, reason: '', location_id: '' });
      toastSuccess('Ajuste creado correctamente');
    },
    onError: () => toastError('Error al crear el ajuste'),
  });

  const adjustments = data?.pages.flatMap((p) => p.data) ?? [];

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleSubmit = () => {
    if (!form.product_id || !form.description || form.quantity <= 0) return;
    createMutation.mutate(form);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={adjustments}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <AdjustmentCard item={item} />}
        ListHeaderComponent={
          <View>
            <View style={styles.statsGrid}>
              <View style={styles.statsItem}>
                <StatsCard label="Total" value={adjustments.length} icon={<Icon name="clipboard-list" size={16} color={colorScales.blue[600]} />} />
              </View>
              <View style={styles.statsItem}>
                <StatsCard label="Pendientes" value={adjustments.filter((a) => a.state === 'pending').length} icon={<Icon name="clock" size={16} color={colorScales.amber[600]} />} />
              </View>
              <View style={styles.statsItem}>
                <StatsCard label="Aplicados" value={adjustments.filter((a) => a.state === 'applied').length} icon={<Icon name="check" size={16} color={colorScales.green[600]} />} />
              </View>
              <View style={styles.statsItem}>
                <StatsCard label="Total Qty" value={adjustments.reduce((s, a) => s + a.quantity, 0)} icon={<Icon name="package" size={16} color={colorScales.gray[600]} />} />
              </View>
            </View>

            <View style={styles.searchWrap}>
              <Input label="Buscar" value={search} onChangeText={setSearch} placeholder="Buscar ajustes..." />
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
          isLoading ? <Spinner /> : <EmptyState title="Sin ajustes" description="No se encontraron ajustes de stock" />
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
            <Text style={styles.modalTitle}>Nuevo Ajuste de Stock</Text>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Tipo</Text>
              <View style={styles.typeRow}>
                {(['in', 'out', 'adjustment'] as const).map((t) => (
                  <Pressable key={t} onPress={() => setForm({ ...form, type: t })} style={[styles.typeChip, form.type === t ? styles.typeChipActive : styles.typeChipInactive]}>
                    <Text style={[styles.chipText, form.type === t ? styles.chipTextActive : styles.chipTextInactive]}>
                      {ADJUSTMENT_TYPE_LABELS[t]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Input label="Producto ID" value={form.product_id} onChangeText={(t) => setForm({ ...form, product_id: t })} placeholder="ID del producto" />
            <Input label="Descripción" value={form.description} onChangeText={(t) => setForm({ ...form, description: t })} placeholder="Descripción del ajuste" />
            <Input label="Cantidad" value={form.quantity > 0 ? String(form.quantity) : ''} onChangeText={(t) => setForm({ ...form, quantity: parseInt(t) || 0 })} placeholder="0" keyboardType="numeric" />
            <Input label="Motivo" value={form.reason ?? ''} onChangeText={(t) => setForm({ ...form, reason: t })} placeholder="Motivo (opcional)" />
            <Input label="Ubicación ID" value={form.location_id ?? ''} onChangeText={(t) => setForm({ ...form, location_id: t })} placeholder="ID de ubicación (opcional)" />

            <View style={styles.modalActions}>
              <Button title="Cancelar" onPress={() => setModalVisible(false)} variant="outline" fullWidth />
              <View style={styles.actionSpacer} />
              <Button title="Crear Ajuste" onPress={handleSubmit} loading={createMutation.isPending} fullWidth />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScales.gray[50] },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], padding: spacing[4] },
  statsItem: { width: '48%' },
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
  badgeRow: { flexDirection: 'column', gap: spacing[1], alignItems: 'flex-end' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colorScales.gray[100] },
  footerDetail: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  footerDate: { fontSize: typography.fontSize.xs, color: colorScales.gray[400], marginLeft: 'auto' },
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
  typeRow: { flexDirection: 'row', gap: spacing[2] },
  typeChip: { paddingHorizontal: spacing[3], paddingVertical: 8, borderRadius: borderRadius.full },
  typeChipActive: { backgroundColor: colors.primary },
  typeChipInactive: { backgroundColor: colorScales.gray[200] },
  modalActions: { flexDirection: 'row', marginTop: spacing[4] },
  actionSpacer: { width: spacing[3] },
});
