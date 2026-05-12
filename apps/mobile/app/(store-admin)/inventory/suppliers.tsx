import { useState, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable, Modal, ScrollView, StyleSheet } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import { getNextPageParam } from '@/core/api/pagination';
import type { CreateSupplierDto, UpdateSupplierDto } from '@/features/store/services/inventory.service';
import type { Supplier } from '@/features/store/types';
import { Icon } from '@/shared/components/icon/icon';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { RecordCard } from '@/shared/components/record-card/record-card';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { formatRelative } from '@/shared/utils/date';
import { spacing, borderRadius, colorScales, typography, colors, shadows } from '@/shared/theme';

const SUPPLIER_STATE_VARIANT: Record<string, 'success' | 'default'> = {
  active: 'success',
  inactive: 'default',
};

const SUPPLIER_STATE_LABELS: Record<string, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
};

const SupplierCard = ({ item, onEdit }: { item: Supplier; onEdit: () => void }) => (
  <RecordCard
    title={item.name}
    subtitle={item.email || item.phone || 'Sin contacto registrado'}
    eyebrow={item.code ? `Código ${item.code}` : undefined}
    media={{ icon: 'building' }}
    badges={[
      {
        label: SUPPLIER_STATE_LABELS[item.state],
        variant: SUPPLIER_STATE_VARIANT[item.state],
      },
    ]}
    details={[
      { label: 'Email', value: item.email || 'Sin email', icon: 'mail' },
      { label: 'Teléfono', value: item.phone || 'Sin teléfono', icon: 'phone' },
      { label: 'Dirección', value: item.address || 'Sin dirección', icon: 'store' },
      { label: 'Creado', value: formatRelative(item.created_at), icon: 'calendar' },
    ]}
    onPress={onEdit}
  />
);

const emptyForm: CreateSupplierDto = { name: '', code: '', email: '', phone: '', address: '' };

export default function SuppliersScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateSupplierDto>({ ...emptyForm });

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch, isRefetching } = useInfiniteQuery({
    queryKey: ['suppliers', search],
    queryFn: ({ pageParam = 1 }) =>
      InventoryService.getSuppliers({
        page: pageParam,
        limit: 20,
        search: search || undefined,
      }),
    getNextPageParam,
    initialPageParam: 1,
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreateSupplierDto) => InventoryService.createSupplier(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeModal();
      toastSuccess('Proveedor creado correctamente');
    },
    onError: () => toastError('Error al crear el proveedor'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateSupplierDto }) => InventoryService.updateSupplier(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeModal();
      toastSuccess('Proveedor actualizado correctamente');
    },
    onError: () => toastError('Error al actualizar el proveedor'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => InventoryService.deleteSupplier(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toastSuccess('Proveedor eliminado');
    },
    onError: () => toastError('Error al eliminar el proveedor'),
  });

  const suppliers = data?.pages.flatMap((p) => p.data) ?? [];

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const closeModal = () => {
    setModalVisible(false);
    setEditingId(null);
    setForm({ ...emptyForm });
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingId(supplier.id);
    setForm({
      name: supplier.name,
      code: supplier.code,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
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
        data={suppliers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <SupplierCard item={item} onEdit={() => handleEdit(item)} />
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.searchWrap}>
              <SearchBar value={search} onChangeText={setSearch} placeholder="Buscar proveedores..." />
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? <Spinner /> : <EmptyState title="Sin proveedores" description="No se encontraron proveedores" />
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
            <Text style={styles.modalTitle}>{editingId ? 'Editar Proveedor' : 'Nuevo Proveedor'}</Text>

            <Input label="Nombre" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} placeholder="Nombre del proveedor" />
            <Input label="Código" value={form.code ?? ''} onChangeText={(t) => setForm({ ...form, code: t })} placeholder="Código (opcional)" />
            <Input label="Email" value={form.email ?? ''} onChangeText={(t) => setForm({ ...form, email: t })} placeholder="Email (opcional)" keyboardType="email-address" autoCapitalize="none" />
            <Input label="Teléfono" value={form.phone ?? ''} onChangeText={(t) => setForm({ ...form, phone: t })} placeholder="Teléfono (opcional)" keyboardType="phone-pad" />
            <Input label="Dirección" value={form.address ?? ''} onChangeText={(t) => setForm({ ...form, address: t })} placeholder="Dirección (opcional)" />

            <View style={styles.modalActions}>
              <Button title="Cancelar" onPress={closeModal} variant="outline" fullWidth />
              <View style={styles.actionSpacer} />
              <Button title={editingId ? 'Actualizar' : 'Crear'} onPress={handleSubmit} loading={isSubmitting} fullWidth />
            </View>

            {editingId && (
              <View style={styles.deleteWrap}>
                <Button title="Eliminar Proveedor" onPress={() => deleteMutation.mutate(editingId)} variant="destructive" fullWidth />
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScales.gray[50] },
  searchWrap: { marginBottom: spacing[3] },
  cardMargin: { marginHorizontal: spacing[4], marginBottom: spacing[3] },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] },
  cardHeaderLeft: { flex: 1 },
  cardTitle: { fontSize: typography.fontSize.base, fontWeight: '600' as any, color: colorScales.gray[900] },
  cardSubtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 2 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colorScales.gray[100], flexWrap: 'wrap' },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  footerDetail: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  footerDate: { fontSize: typography.fontSize.xs, color: colorScales.gray[400], marginLeft: 'auto' },
  listContent: { paddingHorizontal: spacing[4], paddingBottom: spacing[6], gap: spacing[3] },
  fab: { position: 'absolute', bottom: spacing[6], right: spacing[6], width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadows.lg },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { backgroundColor: colors.card, borderTopLeftRadius: borderRadius['2xl'], borderTopRightRadius: borderRadius['2xl'], maxHeight: '85%', paddingBottom: spacing[6] },
  modalHandleWrap: { width: '100%', alignItems: 'center', paddingTop: spacing[2], paddingBottom: spacing[4] },
  modalHandle: { width: 40, height: 4, backgroundColor: colorScales.gray[300], borderRadius: borderRadius.full },
  modalScroll: { paddingHorizontal: spacing[4] },
  modalTitle: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900], marginBottom: spacing[4] },
  modalActions: { flexDirection: 'row', marginTop: spacing[4] },
  actionSpacer: { width: spacing[3] },
  deleteWrap: { marginTop: spacing[4] },
});
