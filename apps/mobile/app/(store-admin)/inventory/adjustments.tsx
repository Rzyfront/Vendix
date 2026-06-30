import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, FlatList, RefreshControl, Pressable, ScrollView, StyleSheet, Dimensions,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import { ProductService } from '@/features/store/services/product.service';
import { getNextPageParam } from '@/core/api/pagination';
import type { CreateAdjustmentDto } from '@/features/store/services/inventory.service';
import type { StockAdjustment, AdjustmentType, AdjustmentState, Location } from '@/features/store/types';
import { ADJUSTMENT_TYPE_LABELS } from '@/features/store/types';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import BulkAdjustmentModal from '@/features/store/components/bulk-adjustment-modal';
import AdjustmentCard from '@/features/store/components/adjustment-card';
import AdjustmentDetailModal from '@/features/store/components/adjustment-detail-modal';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { Icon } from '@/shared/components/icon/icon';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { formatDate } from '@/shared/utils/date';
import { spacing, borderRadius, colors, colorScales, typography, shadows } from '@/shared/theme';
import { INVENTORY_ICONS, STAT_PALETTE } from '@/features/store/constants/inventory-icons';
import { ADJUSTMENT_STATS, ADJUSTMENT_TYPE_OPTIONS, WIZARD_STEPS } from '@/features/store/constants/inventory-labels';

const STATE_VARIANT: Record<AdjustmentState, 'warning' | 'success'> = {
  pending: 'warning',
  applied: 'success',
};

// La función AdjustmentCard fue extraída a features/store/components/adjustment-card.tsx
// El BulkAdjustmentModal fue extraído a features/store/components/bulk-adjustment-modal.tsx

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
  },
  statsContainer: {
    marginBottom: spacing[4],
  },
  cardContainer: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    ...shadows.sm,
    overflow: 'hidden',
  },
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[2],
  },
  listTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4],
  },
  searchInput: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    height: 40,
  },
  searchTextInput: {
    flex: 1,
    height: 40,
    fontSize: typography.fontSize.sm,
    color: colors.text.primary,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: spacing[6],
  },
});

interface BulkResultItem {
  row_number: number;
  sku: string;
  product_name?: string;
  status: 'success' | 'error';
  message?: string;
  quantity_change?: number;
}

interface BulkUploadResult {
  total_processed: number;
  successful: number;
  failed: number;
  results: BulkResultItem[];
}

export default function AdjustmentsScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<AdjustmentType | 'all'>('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showTypeOptions, setShowTypeOptions] = useState(false);
  const [detailAdjustment, setDetailAdjustment] = useState<StockAdjustment | null>(null);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const filterBtnRef = useRef<View>(null);
  const actionsBtnRef = useRef<View>(null);
  const [filterDropdownPos, setFilterDropdownPos] = useState({ top: 0, right: 0 });
  const [actionsDropdownPos, setActionsDropdownPos] = useState({ top: 0, right: 0 });
  const screenW = Dimensions.get('window').width;
  const [form, setForm] = useState<{
    product_id: number;
    description: string;
    type: AdjustmentType;
    quantity_after: number;
    reason_code: string;
  }>({
    product_id: 0,
    description: '',
    type: 'manual_correction',
    quantity_after: 0,
    reason_code: '',
  });

  // --- Wizard state (Crear Ajuste — 3 pasos como la web) ---
  const [selectedLocation, setSelectedLocation] = useState<number | null>(null);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState('');
  const [productSearchResults, setProductSearchResults] = useState<Array<{ id: number; name: string; sku?: string; stock: number }>>([]);

  // Ubicaciones reales desde el backend
  const { data: locationsData, isLoading: isLoadingLocations } = useQuery({
    queryKey: ['locations', 'all'],
    queryFn: () => InventoryService.getLocations({ page: 1, limit: 100 }),
  });
  const LOCATIONS: { value: number; label: string }[] = (locationsData?.data ?? []).map((loc: Location) => ({
    value: Number(loc.id),
    label: loc.name,
  }));

  const productsQuery = useQuery({
    queryKey: ['adjustments-products-search', productSearchTerm],
    queryFn: () =>
      ProductService.list({
        page: 1,
        limit: 50,
        search: productSearchTerm.trim() || undefined,
        include_variants: true,
      }),
    enabled: createStep === 2 && productSearchTerm.trim().length > 0,
    staleTime: 30_000,
  });
  const storeProducts: Array<{ id: number; name: string; sku?: string; stock: number; category?: string }> =
    (productsQuery.data?.data ?? []).map((p) => ({
      id: Number(p.id),
      name: p.name,
      sku: p.sku ?? undefined,
      stock: p.stock_quantity ?? 0,
      category: (p as any).category?.name,
    }));
  const selectedLocationName = selectedLocation ? LOCATIONS.find((l) => l.value === selectedLocation)?.label : '';

  const isFocused = useIsFocused();

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
    staleTime: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    if (isFocused) {
      refetch();
    }
  }, [isFocused, refetch]);

  const createMutation = useMutation({
    mutationFn: (dto: CreateAdjustmentDto) => InventoryService.createAdjustment(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      setModalVisible(false);
      setForm({ product_id: 0, description: '', type: 'manual_correction', quantity_after: 0, reason_code: '' });
      setSelectedLocation(null);
      setShowLocationDropdown(false);
      setProductSearchTerm('');
      setProductSearchResults([]);
      setCreateStep(1);
      setConfirmCreate(false);
      toastSuccess('Ajuste creado correctamente');
    },
    onError: (e: any) => {
      const message =
        e?.response?.data?.message ??
        e?.response?.data?.error?.message ??
        e?.response?.data?.error ??
        (Array.isArray(e?.response?.data?.message) ? e.response.data.message.join(', ') : null) ??
        e?.message;
      const errMsg =
        e?.response?.status === 400
          ? `Error 400: ${message ?? 'datos inválidos. Verifica la plantilla y los campos.'}`
          : message ?? 'Error al crear el ajuste';
      toastError(typeof errMsg === 'string' ? errMsg : 'Error al crear el ajuste');
    },
  });

  // Action mutations wired to AdjustmentDetailModal contextual buttons
  const approveMutation = useMutation({
    mutationFn: (id: number) => InventoryService.approveAdjustment(id, 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      setDetailAdjustment(null);
      toastSuccess('Ajuste aprobado');
    },
    onError: () => toastError('No se pudo aprobar el ajuste'),
  });

  const deleteAdjustmentMutation = useMutation({
    mutationFn: (id: number) => InventoryService.deleteAdjustment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adjustments'] });
      setDetailAdjustment(null);
      toastSuccess('Ajuste eliminado');
    },
    onError: () => toastError('No se pudo eliminar el ajuste'),
  });

  const adjustments = data?.pages.flatMap((p) => p.data) ?? [];

  // Filtro client-side por tienda actual
  const storeAdjustments = adjustments;

  // Totales
  const totals = {
    total: storeAdjustments.length,
    losses: storeAdjustments.filter((a) => a.adjustment_type === 'loss').length,
    damages: storeAdjustments.filter((a) => a.adjustment_type === 'damage').length,
    corrections: storeAdjustments.filter((a) => a.adjustment_type === 'manual_correction').length,
  };

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => refetch(), [refetch]);

  const handleShowFilters = useCallback(() => {
    filterBtnRef.current?.measureInWindow((x, y, width, btnHeight) => {
      setFilterDropdownPos({ top: y + btnHeight + 6, right: screenW - x - width });
      setShowFilters(true);
    });
  }, [screenW]);

  const handleShowActions = useCallback(() => {
    actionsBtnRef.current?.measureInWindow((x, y, width, btnHeight) => {
      setActionsDropdownPos({ top: y + btnHeight + 6, right: screenW - x - width });
      setShowActions(true);
    });
  }, [screenW]);

  const handleSubmit = () => {
    if (!form.product_id || !form.description || form.quantity_after <= 0 || !selectedLocation) {
      toastError('Completa todos los campos requeridos');
      return;
    }
    const dto: CreateAdjustmentDto = {
      location_id: selectedLocation,
      items: [{
        product_id: form.product_id,
        type: form.type,
        quantity_after: form.quantity_after,
        ...(form.reason_code && { reason_code: form.reason_code }),
        ...(form.description && { description: form.description }),
      }],
    };
    createMutation.mutate(dto);
  };

  const canAdvanceStep1 = selectedLocation !== null;
  const canAdvanceStep2 = !!(form.product_id && form.description && form.quantity_after > 0);
  const goToStep2 = () => { if (canAdvanceStep1) setCreateStep(2); };
  const goToStep3 = () => { if (canAdvanceStep2) setCreateStep(3); };
  const goBackToStep1 = () => setCreateStep(1);
  const goBackToStep2 = () => setCreateStep(2);
  const openCreateModal = () => { setCreateStep(1); setConfirmCreate(false); setSelectedLocation(null); setShowLocationDropdown(false); setProductSearchTerm(''); setProductSearchResults([]); setModalVisible(true); };
  const closeCreateModal = () => { setModalVisible(false); setCreateStep(1); setConfirmCreate(false); setSelectedLocation(null); setShowLocationDropdown(false); setProductSearchTerm(''); setProductSearchResults([]); };
  const STEPS = [
    { num: 1, label: 'UBICACIÓN' },
    { num: 2, label: 'PRODUCTOS' },
    { num: 3, label: 'CONFIRMAR' },
  ];
  const TYPE_OPTIONS: { value: AdjustmentType; label: string; icon: string }[] = [
    { value: 'damage', label: 'Daño', icon: 'alert-triangle' },
    { value: 'loss', label: 'Pérdida', icon: 'trending-down' },
    { value: 'theft', label: 'Robo', icon: 'lock' },
    { value: 'expiration', label: 'Vencido', icon: 'clock' },
    { value: 'count_variance', label: 'Conteo', icon: 'layers' },
    { value: 'manual_correction', label: 'Corrección', icon: 'edit-2' },
  ];
  const searchProducts = (term: string) => {
    setProductSearchTerm(term);
    if (term.trim().length < 1) {
      setProductSearchResults([]);
      return;
    }
    setProductSearchResults(
      storeProducts.filter((p) => p.id !== form.product_id),
    );
  };
  const selectProduct = (product: { id: number; name: string; sku?: string; stock: number }) => {
    setForm({ ...form, product_id: product.id, description: product.name });
    setProductSearchResults([]);
    setProductSearchTerm('');
  };
  const locationLabel = (id: number | null) => (id ? LOCATIONS.find((l) => l.value === id)?.label : '');

  // Stock actual del producto seleccionado
  const selectedProductCurrentStock =
    storeProducts.find((p) => p.id === form.product_id)?.stock ?? 0;
  const calculatedQuantityChange = form.quantity_after - selectedProductCurrentStock;

  return (
    <View style={styles.screen}>
      <StatsGrid
        style={styles.statsContainer}
        items={[
          { label: ADJUSTMENT_STATS.total.label, value: totals.total, icon: INVENTORY_ICONS.adjustmentsTotalStat, iconBg: STAT_PALETTE.blue.bg, iconColor: STAT_PALETTE.blue.color, description: ADJUSTMENT_STATS.total.description },
          { label: ADJUSTMENT_STATS.loss.label, value: totals.losses, icon: INVENTORY_ICONS.lossStat, iconBg: STAT_PALETTE.red.bg, iconColor: STAT_PALETTE.red.color, description: ADJUSTMENT_STATS.loss.description },
          { label: ADJUSTMENT_STATS.damage.label, value: totals.damages, icon: INVENTORY_ICONS.damageStat, iconBg: STAT_PALETTE.amber.bg, iconColor: STAT_PALETTE.amber.color, description: ADJUSTMENT_STATS.damage.description },
          { label: ADJUSTMENT_STATS.correction.label, value: totals.corrections, icon: INVENTORY_ICONS.correctionStat, iconBg: STAT_PALETTE.green.bg, iconColor: STAT_PALETTE.green.color, description: ADJUSTMENT_STATS.correction.description },
        ]}
      />

      {/* Card contenedor: título + búsqueda + filtros + cards de ajustes */}
      <View style={styles.cardContainer}>
      <FlatList
        data={storeAdjustments}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <AdjustmentCard item={item} onView={setDetailAdjustment} />
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.searchHeader}>
              <Text style={styles.listTitle}>
                Ajustes de Inventario ({storeAdjustments.length})
              </Text>
            </View>
            <View style={styles.searchRow}>
              <View style={styles.searchInput}>
                <Icon name="search" size={16} color={colorScales.gray[400]} style={{ marginRight: 6 }} />
                <TextInput
                  style={styles.searchTextInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar ajuste..."
                  placeholderTextColor={colorScales.gray[400]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {search.length > 0 && (
                  <Pressable onPress={() => setSearch('')} hitSlop={8}>
                    <Icon name="x" size={16} color={colorScales.gray[400]} />
                  </Pressable>
                )}
              </View>
              <Pressable ref={actionsBtnRef} style={styles.iconBtn} onPress={handleShowActions} hitSlop={6}>
                <Icon name="plus" size={20} color={colors.primary} />
              </Pressable>
              <Pressable ref={filterBtnRef} style={styles.iconBtn} onPress={handleShowFilters} hitSlop={6}>
                <Icon name="filter" size={18} color={colors.primary} />
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : (
            <EmptyState
              title="Sin ajustes"
              description="No se encontraron ajustes de stock"
              actionLabel="Crear Ajustes"
              onAction={openCreateModal}
              secondaryActionLabel="Actualizar"
              onSecondaryAction={handleRefresh}
            />
          )
        }
        ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
      />

      {/* Modal BulkAdjustmentModal extraido a features/store/components/bulk-adjustment-modal.tsx */}
      <BulkAdjustmentModal
        visible={bulkUploadOpen}
        onClose={() => setBulkUploadOpen(false)}
        locations={LOCATIONS}
        onCompleted={handleRefresh}
      />

      {/* Modal de detalle — abierto al pulsar el botón (ver) en una card */}
      <AdjustmentDetailModal
        adjustment={detailAdjustment}
        onClose={() => setDetailAdjustment(null)}
        onApprove={(a: any) => approveMutation.mutate(Number(a.id))}
        onDelete={(a: any) => deleteAdjustmentMutation.mutate(Number(a.id))}
        isSubmitting={approveMutation.isPending || deleteAdjustmentMutation.isPending}
      />
      </View>
    </View>
  );
}
