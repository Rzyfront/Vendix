import { useState, useCallback } from 'react';
import {
  View, Text, FlatList, RefreshControl, Pressable, Modal, ScrollView, StyleSheet, TextInput,
} from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import { getNextPageParam } from '@/core/api/pagination';
import type { CreateAdjustmentDto } from '@/features/store/services/inventory.service';
import type { StockAdjustment, AdjustmentType, AdjustmentState } from '@/features/store/types';
import { ADJUSTMENT_TYPE_LABELS, ADJUSTMENT_STATE_LABELS } from '@/features/store/types';
import { Badge } from '@/shared/components/badge/badge';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { formatRelative } from '@/shared/utils/date';
import { spacing, borderRadius, colors, colorScales, typography, shadows } from '@/shared/theme';

const STATE_VARIANT: Record<AdjustmentState, 'warning' | 'success'> = {
  pending: 'warning',
  applied: 'success',
};

const ADJUSTMENT_TYPE_OPTIONS: { label: string; value: AdjustmentType | 'all' }[] = [
  { label: 'Todos los tipos', value: 'all' },
  { label: 'Daño', value: 'damage' },
  { label: 'Pérdida', value: 'loss' },
  { label: 'Robo', value: 'theft' },
  { label: 'Vencido', value: 'expiration' },
  { label: 'Conteo', value: 'count_variance' },
  { label: 'Corrección', value: 'manual_correction' },
];

interface StatItem {
  title: string;
  value: number;
  smallText: string;
  iconName: keyof typeof Ionicons.glyphMap;
  bgColor: string;
  iconColor: string;
}

const STATS: StatItem[] = [
  { title: 'Total Ajustes', value: 0, smallText: 'Movimientos registrados', iconName: 'clipboard-outline', bgColor: '#dbeafe', iconColor: '#2563eb' },
  { title: 'Pérdidas', value: 0, smallText: 'Productos extraviados', iconName: 'trending-down-outline', bgColor: '#fee2e2', iconColor: '#dc2626' },
  { title: 'Daños', value: 0, smallText: 'Productos dañados', iconName: 'warning-outline', bgColor: '#fef3c7', iconColor: '#d97706' },
  { title: 'Correcciones', value: 0, smallText: 'Ajustes de inventario', iconName: 'create-outline', bgColor: '#dcfce7', iconColor: '#16a34a' },
];

import { Ionicons } from '@expo/vector-icons';

function AdjustmentCard({ item }: { item: StockAdjustment }) {
  const productName = item.products?.name ?? item.description ?? '';
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.description ?? productName}</Text>
            <Text style={styles.cardSubtitle}>{productName}</Text>
          </View>
          <View style={styles.cardBadges}>
            <Badge label={ADJUSTMENT_TYPE_LABELS[item.adjustment_type]} variant="info" size="sm" />
            <Badge label={ADJUSTMENT_STATE_LABELS[item.approved_at ? 'applied' : 'pending']} variant={item.approved_at ? 'success' : 'warning'} size="sm" />
          </View>
        </View>
        <View style={styles.cardMeta}>
          <Text style={styles.metaText}>Qty: {item.quantity_change}</Text>
          {item.inventory_locations?.name && <Text style={styles.metaText}>{item.inventory_locations.name}</Text>}
          <Text style={[styles.metaText, { marginLeft: 'auto' }]}>{formatRelative(item.created_at)}</Text>
        </View>
      </View>
    </View>
  );
}

export default function AdjustmentsScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<AdjustmentType | 'all'>('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState<CreateAdjustmentDto>({
    product_id: '',
    description: '',
    type: 'manual_correction',
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
    getNextPageParam,
    initialPageParam: 1,
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreateAdjustmentDto) => InventoryService.createAdjustment(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      setModalVisible(false);
      setForm({ product_id: '', description: '', type: 'manual_correction', quantity: 0, reason: '', location_id: '' });
      toastSuccess('Ajuste creado correctamente');
    },
    onError: () => toastError('Error al crear el ajuste'),
  });

  const adjustments = data?.pages.flatMap((p) => p.data) ?? [];

  const totals = {
    total: adjustments.length,
    losses: adjustments.filter((a) => a.adjustment_type === 'loss').length,
    damages: adjustments.filter((a) => a.adjustment_type === 'damage').length,
    corrections: adjustments.filter((a) => a.adjustment_type === 'manual_correction').length,
  };

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleSubmit = () => {
    if (!form.product_id || !form.description || form.quantity <= 0) return;
    createMutation.mutate(form);
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={adjustments}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <AdjustmentCard item={item} />}
        ListHeaderComponent={
          <View>
            {/* Stats Bar: horizontal scroll */}
            <View style={styles.statsContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsScroll}>
                {STATS.map((stat, idx) => {
                  const vals = [totals.total, totals.losses, totals.damages, totals.corrections];
                  return (
                    <View key={idx} style={styles.statCard}>
                      <Ionicons name={stat.iconName} size={16} color={stat.iconColor} style={styles.statIcon} />
                      <Text style={styles.statLabel}>{stat.title}</Text>
                      <Text style={styles.statValue}>{vals[idx]}</Text>
                      <Text style={styles.statSmall}>{stat.smallText}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            {/* Search + Title row */}
            <View style={styles.searchHeader}>
              <Text style={styles.listTitle}>
                Ajustes de Inventario ({adjustments.length})
              </Text>
            </View>
            {/* POS-style search bar */}
            <View style={styles.searchRow}>
              <View style={styles.searchInput}>
                <Ionicons name="search-outline" size={16} color="#9ca3af" style={{ marginRight: 6 }} />
                <TextInput
                  style={styles.searchTextInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar ajuste..."
                  placeholderTextColor="#9ca3af"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {search.length > 0 && (
                  <Pressable onPress={() => setSearch('')} hitSlop={8}>
                    <Ionicons name="close" size={16} color="#9ca3af" />
                  </Pressable>
                )}
              </View>
              <Pressable style={styles.iconBtn} onPress={() => setShowFilters(true)} hitSlop={6}>
                <Ionicons name="filter-outline" size={18} color="#22C55E" />
              </Pressable>
              <Pressable style={styles.iconBtn} onPress={() => setShowActions(true)} hitSlop={6}>
                <Ionicons name="add-outline" size={20} color="#22C55E" />
              </Pressable>
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

      {/* Actions Dropdown */}
      <Modal visible={showActions} transparent animationType="fade" onRequestClose={() => setShowActions(false)}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setShowActions(false)} />
        <View style={styles.dropdownPositioner}>
          <View style={styles.dropdownArrow} />
          <View style={styles.dropdown}>
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); setModalVisible(true); }}>
              <View style={styles.dropdownIconWrap}>
                <Ionicons name="add" size={18} color="#22C55E" />
              </View>
              <Text style={styles.dropdownItemPrimary}>Nuevo Ajuste</Text>
            </Pressable>
            <View style={styles.dropdownDivider} />
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); /* bulk */ }}>
              <View style={styles.dropdownIconWrap}>
                <Ionicons name="cloud-upload-outline" size={18} color="#6b7280" />
              </View>
              <Text style={styles.dropdownItemText}>Carga Masiva</Text>
            </Pressable>
            <View style={styles.dropdownDivider} />
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); handleRefresh(); }}>
              <View style={styles.dropdownIconWrap}>
                <Ionicons name="refresh-outline" size={18} color="#6b7280" />
              </View>
              <Text style={styles.dropdownItemText}>Refrescar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Filter Dropdown */}
      <Modal visible={showFilters} transparent animationType="fade" onRequestClose={() => setShowFilters(false)}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setShowFilters(false)} />
        <View style={[styles.dropdownPositioner, styles.filterDropdownPositioner]}>
          <View style={styles.dropdownArrow} />
          <View style={styles.dropdown}>
            <Text style={styles.dropdownTitle}>Filtrar por tipo</Text>
            <View style={styles.dropdownDivider} />
            {ADJUSTMENT_TYPE_OPTIONS.map((opt) => (
              <Pressable key={opt.value} style={[styles.dropdownFilterItem, activeFilter === opt.value && styles.dropdownFilterActive]} onPress={() => { setActiveFilter(opt.value); setShowFilters(false); }}>
                <Text style={[styles.dropdownFilterText, activeFilter === opt.value && styles.dropdownFilterTextActive]}>{opt.label}</Text>
                {activeFilter === opt.value && <Ionicons name="checkmark" size={16} color="#22C55E" />}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      {/* Create Modal */}
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
                {(['damage', 'loss', 'theft', 'expiration', 'count_variance', 'manual_correction'] as const).map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setForm({ ...form, type: t })}
                    style={[styles.typeChip, form.type === t ? styles.typeChipActive : styles.typeChipInactive]}
                  >
                    <Text style={[styles.typeChipText, form.type === t ? styles.chipTextActive : styles.chipTextInactive]}>
                      {ADJUSTMENT_TYPE_LABELS[t]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Input
              label="Producto ID"
              value={form.product_id}
              onChangeText={(t) => setForm({ ...form, product_id: t })}
              placeholder="ID del producto"
            />
            <Input
              label="Descripción"
              value={form.description}
              onChangeText={(t) => setForm({ ...form, description: t })}
              placeholder="Descripción del ajuste"
            />
            <Input
              label="Cantidad"
              value={form.quantity > 0 ? String(form.quantity) : ''}
              onChangeText={(t) => setForm({ ...form, quantity: parseInt(t) || 0 })}
              placeholder="0"
              keyboardType="numeric"
            />
            <Input
              label="Motivo"
              value={form.reason ?? ''}
              onChangeText={(t) => setForm({ ...form, reason: t })}
              placeholder="Motivo (opcional)"
            />
            <Input
              label="Ubicación ID"
              value={form.location_id ?? ''}
              onChangeText={(t) => setForm({ ...form, location_id: t })}
              placeholder="ID de ubicación (opcional)"
            />

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
  screen: { flex: 1, backgroundColor: colorScales.gray[50] },

  /* Stats: horizontal scroll */
  statsContainer: {
    backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e5e7eb',
    paddingTop: spacing[3], paddingBottom: spacing[1],
  },
  statsScroll: { paddingHorizontal: 12, gap: 8 },
  statCard: {
    width: 150, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb',
    paddingHorizontal: 10, paddingVertical: 10, gap: 1,
  },
  statIcon: { position: 'absolute', top: 8, right: 8 },
  statLabel: { fontSize: 9, fontWeight: '700', color: colorScales.gray[500], letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2, maxWidth: '85%' },
  statValue: { fontSize: 20, fontWeight: '800', color: colorScales.gray[900], marginTop: 2 },
  statSmall: { fontSize: 9, fontWeight: '500', color: '#059669', marginTop: 1 },

  /* Search */
  searchHeader: { paddingHorizontal: spacing[4], paddingTop: spacing[3], marginBottom: spacing[2] },
  listTitle: { fontSize: 12, fontWeight: '700', color: colorScales.gray[600], letterSpacing: 0.3 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingHorizontal: spacing[4], paddingBottom: spacing[3],
    backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colorScales.gray[100],
  },
  searchInput: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colorScales.gray[50], borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    borderWidth: 1, borderColor: colorScales.gray[200], minHeight: 40,
  },
  searchTextInput: {
    flex: 1, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily,
    color: colorScales.gray[900], padding: 0, height: '100%',
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: borderRadius.xl,
    backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  /* Actions List */
  actionsList: { paddingHorizontal: spacing[4], gap: 0 },
  actionItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  actionIconWrap: { width: 32, height: 32, borderRadius: 8, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: typography.fontSize.base, fontWeight: '500' as any, color: colorScales.gray[900] },
  actionDivider: { height: 1, backgroundColor: colorScales.gray[100] },

  /* Card */
  card: {
    marginHorizontal: spacing[4], marginBottom: spacing[3],
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e5e7eb', overflow: 'hidden',
  },
  cardBody: { padding: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] },
  cardTitle: { fontSize: typography.fontSize.base, fontWeight: '600' as any, color: colorScales.gray[900] },
  cardSubtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 2 },
  cardBadges: { flexDirection: 'column', gap: spacing[1], alignItems: 'flex-end' },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colorScales.gray[100] },
  metaText: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },

  /* List */
  listContent: { paddingBottom: spacing[6] },

  /* Dropdowns (positioned near buttons) */
  dropdownBackdrop: { flex: 1 },
  dropdownPositioner: { position: 'absolute', top: 178, right: spacing[4], alignItems: 'flex-end' },
  filterDropdownPositioner: { top: 178 },
  dropdownArrow: {
    width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fff',
    marginRight: 14, marginBottom: -1,
  },
  dropdown: {
    backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: colorScales.gray[200],
    minWidth: 200, ...shadows.lg,
  },
  dropdownTitle: { fontSize: 12, fontWeight: '700', color: colorScales.gray[500], paddingVertical: spacing[2], paddingHorizontal: spacing[3], letterSpacing: 0.3, textTransform: 'uppercase' as any },
  dropdownDivider: { height: 1, backgroundColor: colorScales.gray[100] },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3] },
  dropdownIconWrap: { width: 28, height: 28, borderRadius: 6, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  dropdownItemText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownItemPrimary: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: '#16a34a' },
  dropdownFilterItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[2], paddingHorizontal: spacing[3] },
  dropdownFilterActive: { backgroundColor: '#f0fdf4' },
  dropdownFilterText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownFilterTextActive: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: '#16a34a' },

  /* Modal */
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85%', paddingBottom: spacing[6] },
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
  typeChipText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any },
  chipTextActive: { color: '#fff' },
  chipTextInactive: { color: colorScales.gray[600] },
  modalActions: { flexDirection: 'row', marginTop: spacing[4] },
  actionSpacer: { width: spacing[3] },
});
