import { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import type { CreateLocationDto, UpdateLocationDto } from '@/features/store/services/inventory.service';
import { LOCATION_TYPE_LABELS } from '@/features/store/types';
import type { Location, LocationType } from '@/features/store/types';
import { Card } from '@/shared/components/card/card';
import { Badge } from '@/shared/components/badge/badge';
import { Icon } from '@/shared/components/icon/icon';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { spacing, borderRadius, colorScales, typography, colors, shadows } from '@/shared/theme';

const TYPE_VARIANT: Record<LocationType, 'info' | 'warning' | 'default'> = {
  warehouse: 'info',
  store: 'warning',
  virtual: 'default',
};

const STATE_VARIANT: Record<string, 'success' | 'default'> = {
  active: 'success',
  inactive: 'default',
};

const STATE_LABELS: Record<string, string> = {
  active: 'Activa',
  inactive: 'Inactiva',
};

const LocationCard = ({ item, onEdit }: { item: Location; onEdit: () => void }) => (
  <Pressable onPress={onEdit}>
    <Card style={styles.cardMargin}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
          {item.code && <Text style={styles.cardSubtitle}>{item.code}</Text>}
        </View>
        <View style={styles.badgeRow}>
          <Badge label={LOCATION_TYPE_LABELS[item.type]} variant={TYPE_VARIANT[item.type]} size="sm" />
          <Badge label={STATE_LABELS[item.state]} variant={STATE_VARIANT[item.state]} size="sm" />
        </View>
      </View>
      {item.address && (
        <View style={styles.cardFooter}>
          <Icon name="building" size={12} color={colorScales.gray[400]} />
          <Text style={styles.footerDetail} numberOfLines={1}>{item.address}</Text>
        </View>
      )}
    </Card>
  </Pressable>
);

const emptyForm: CreateLocationDto = { name: '', code: '', type: 'warehouse', address: '' };

export default function LocationsScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateLocationDto>({ ...emptyForm });

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch, isRefetching } = useInfiniteQuery({
    queryKey: ['locations', search],
    queryFn: ({ pageParam = 1 }) =>
      InventoryService.getLocations({
        page: pageParam,
        limit: 20,
        search: search || undefined,
      }),
    getNextPageParam: (lastPage) => {
      const { page, totalPages } = lastPage.pagination;
      return page < totalPages ? page + 1 : undefined;
    },
    initialPageParam: 1,
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreateLocationDto) => InventoryService.createLocation(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      closeModal();
      toastSuccess('Ubicación creada correctamente');
    },
    onError: () => toastError('Error al crear la ubicación'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateLocationDto }) => InventoryService.updateLocation(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      closeModal();
      toastSuccess('Ubicación actualizada correctamente');
    },
    onError: () => toastError('Error al actualizar la ubicación'),
  });

  const locations = data?.pages.flatMap((p) => p.data) ?? [];

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const closeModal = () => {
    setModalVisible(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const handleEdit = (location: Location) => {
    setEditingId(location.id);
    setForm({
      name: location.name,
      code: location.code,
      type: location.type,
      address: location.address,
    });
    setModalVisible(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim()) return;
    if (editingId) {
      updateMutation.mutate({ id: editingId, dto: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  return (
    <View style={styles.container}>
      <FlatList
        data={locations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <LocationCard item={item} onEdit={() => handleEdit(item)} />
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.searchWrap}>
              <Input label="Buscar" value={search} onChangeText={setSearch} placeholder="Buscar ubicaciones..." />
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? <Spinner /> : <EmptyState title="Sin ubicaciones" description="No se encontraron ubicaciones" />
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

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={closeModal}>
        <Pressable style={styles.modalBackdrop} onPress={closeModal} />
        <View style={styles.modalContent}>
          <View style={styles.modalHandleWrap}>
            <View style={styles.modalHandle} />
          </View>
          <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>{editingId ? 'Editar Ubicación' : 'Nueva Ubicación'}</Text>

            <Input label="Nombre" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} placeholder="Nombre de la ubicación" />
            <Input label="Código" value={form.code ?? ''} onChangeText={(t) => setForm({ ...form, code: t })} placeholder="Código (opcional)" />

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Tipo</Text>
              <View style={styles.typeRow}>
                {(['warehouse', 'store', 'virtual'] as LocationType[]).map((t) => (
                  <Pressable key={t} onPress={() => setForm({ ...form, type: t })} style={[styles.typeChip, form.type === t ? styles.typeChipActive : styles.typeChipInactive]}>
                    <Text style={[styles.chipText, form.type === t ? styles.chipTextActive : styles.chipTextInactive]}>
                      {LOCATION_TYPE_LABELS[t]}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <Input label="Dirección" value={form.address ?? ''} onChangeText={(t) => setForm({ ...form, address: t })} placeholder="Dirección (opcional)" />

            <View style={styles.modalActions}>
              <Button title="Cancelar" onPress={closeModal} variant="outline" fullWidth />
              <View style={styles.actionSpacer} />
              <Button title={editingId ? 'Actualizar' : 'Crear'} onPress={handleSubmit} loading={isSubmitting} fullWidth />
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScales.gray[50] },
  searchWrap: { paddingHorizontal: spacing[4], marginBottom: spacing[3] },
  cardMargin: { marginHorizontal: spacing[4], marginBottom: spacing[3] },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] },
  cardHeaderLeft: { flex: 1 },
  cardTitle: { fontSize: typography.fontSize.base, fontWeight: '600' as any, color: colorScales.gray[900] },
  cardSubtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 2 },
  badgeRow: { flexDirection: 'column', gap: spacing[1], alignItems: 'flex-end' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colorScales.gray[100] },
  footerDetail: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
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
  chipText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any },
  chipTextActive: { color: '#fff' },
  chipTextInactive: { color: colorScales.gray[600] },
  modalActions: { flexDirection: 'row', marginTop: spacing[4] },
  actionSpacer: { width: spacing[3] },
});
