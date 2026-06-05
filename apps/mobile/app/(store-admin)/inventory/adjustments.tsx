import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, RefreshControl, Pressable, Modal, ScrollView, StyleSheet, TextInput, Dimensions,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import { getNextPageParam } from '@/core/api/pagination';
import type { CreateAdjustmentDto } from '@/features/store/services/inventory.service';
import type { StockAdjustment, AdjustmentType, AdjustmentState, Location } from '@/features/store/types';
import { ADJUSTMENT_TYPE_LABELS, ADJUSTMENT_STATE_LABELS } from '@/features/store/types';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { Icon } from '@/shared/components/icon/icon';
import { formatDate } from '@/shared/utils/date';
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

// (Los colores de las stat cards usan hex legacy para el badge/icono del header — no son parte de los contenedores)

import { Ionicons } from '@expo/vector-icons';

function AdjustmentCard({ item }: { item: StockAdjustment }) {
  // Fallbacks seguros para evitar "[object Object]" si el backend devuelve un objeto en campos string
  const productName =
    typeof item.products?.name === 'string'
      ? item.products.name
      : typeof item.description === 'string'
      ? item.description
      : 'Producto sin nombre';
  const locationName =
    typeof item.inventory_locations?.name === 'string'
      ? item.inventory_locations.name
      : 'Sin ubicación';
  const typeLabel = ADJUSTMENT_TYPE_LABELS[item.adjustment_type] ?? 'Ajuste';
  const dateLabel = formatDate(item.created_at);
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        {/* Fila 1: Título + badge de tipo (alineado con la web) */}
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle} numberOfLines={1}>{productName}</Text>
          <View style={styles.cardBadge}>
            <Text style={styles.cardBadgeText}>{typeLabel}</Text>
          </View>
        </View>

        {/* Fila 2: Grid 2 columnas — FECHA | UBICACIÓN (como la web) */}
        <View style={styles.cardGrid}>
          <View style={styles.cardGridItem}>
            <Text style={styles.cardGridLabel}>FECHA</Text>
            <Text style={styles.cardGridValue}>{dateLabel}</Text>
          </View>
          <View style={styles.cardGridItem}>
            <Text style={styles.cardGridLabel}>UBICACIÓN</Text>
            <Text style={styles.cardGridValue} numberOfLines={1}>{locationName}</Text>
          </View>
        </View>

        {/* Fila 3: Footer con CAMBIO + pin (como la web) */}
        <View style={styles.cardFooter}>
          <View style={styles.cardFooterLeft}>
            <Text style={styles.cardFooterLabel}>CAMBIO</Text>
            <Text style={styles.cardFooterValue}>{Number(item.quantity_change ?? 0)}</Text>
          </View>
          <Icon name="map-pin" size={16} color={colorScales.gray[500]} />
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
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showTypeOptions, setShowTypeOptions] = useState(false);
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
  // Productos mock para búsqueda (en la web viene de `searchAdjustableProducts`)
  // Incluye productos con "kit", "limpieza", etc. para que la búsqueda por texto parcial funcione
  const ALL_PRODUCTS: Array<{ id: number; name: string; sku?: string; stock: number; category?: string }> = [
    { id: 101, name: 'Kit de Limpieza Soplete', sku: 'KIT-LIM-SOP', stock: 20, category: 'Kits' },
    { id: 102, name: 'Kit de Limpieza Industrial', sku: 'KIT-LIM-IND', stock: 15, category: 'Kits' },
    { id: 103, name: 'Kit de Limpieza Deluxe', sku: 'KIT-LIM-DLX', stock: 8, category: 'Kits' },
    { id: 104, name: 'Camiseta Básica Blanca', sku: 'CAM-BAS-BLA', stock: 50, category: 'Ropa' },
    { id: 105, name: 'Pantalón Jean Clásico', sku: 'PAN-JEA-CLA', stock: 30, category: 'Ropa' },
    { id: 106, name: 'Zapatillas Deportivas', sku: 'ZAP-DEP-001', stock: 25, category: 'Calzado' },
    { id: 107, name: 'Gorra Ajustable', sku: 'GOR-AJU-001', stock: 100, category: 'Accesorios' },
    { id: 108, name: 'Mochila Escolar', sku: 'MOC-ESC-001', stock: 15, category: 'Accesorios' },
    { id: 109, name: 'Camiseta Kit Premium', sku: 'CAM-KIT-PRM', stock: 12, category: 'Ropa' },
    { id: 110, name: 'Kit de Herramientas Pro', sku: 'KIT-HER-PRO', stock: 10, category: 'Kits' },
  ];
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

  // Refetch cuando la pantalla toma foco (ej. usuario vuelve del web al mobile)
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
    if (!form.product_id || !form.description || form.quantity_after <= 0 || !selectedLocation) return;
    // Construir el DTO batch que espera el backend
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

  // --- Wizard helpers (Crear Ajuste — 3 pasos como la web) ---
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
    const lower = term.toLowerCase().trim();
    // Búsqueda por coincidencia parcial en nombre, SKU y categoría (como la web)
    setProductSearchResults(
      ALL_PRODUCTS.filter((p) => {
        const nameMatch = p.name.toLowerCase().includes(lower);
        const skuMatch = p.sku ? p.sku.toLowerCase().includes(lower) : false;
        const categoryMatch = p.category ? p.category.toLowerCase().includes(lower) : false;
        return nameMatch || skuMatch || categoryMatch;
      }).filter((p) => p.id !== form.product_id),
    );
  };
  const selectProduct = (product: { id: number; name: string; sku?: string; stock: number }) => {
    setForm({ ...form, product_id: product.id, description: product.name });
    setProductSearchResults([]);
    setProductSearchTerm('');
  };
  const locationLabel = (id: number | null) => (id ? LOCATIONS.find((l) => l.value === id)?.label : '');

  return (
    <View style={styles.screen}>
      {/* Stats: ancho completo de la pantalla (fuera del card) */}
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

      {/* Card contenedor: título + búsqueda + cards de ajustes (con margen y border radius) */}
      <View style={styles.cardContainer}>
      <FlatList
        data={adjustments}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <AdjustmentCard item={item} />}
        ListHeaderComponent={
          <View>
            {/* Search + Title row */}
            <View style={styles.searchHeader}>
              <Text style={styles.listTitle}>
                Ajustes de Inventario ({adjustments.length})
              </Text>
            </View>
            {/* POS-style search bar — fondo transparente para integrarse con el card */}
            <View style={styles.searchRow}>
              <View style={styles.searchInput}>
                <Ionicons name="search-outline" size={16} color={colorScales.gray[400]} style={{ marginRight: 6 }} />
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
                    <Ionicons name="close" size={16} color={colorScales.gray[400]} />
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
      </View>

      {/* Actions Dropdown */}
      <Modal visible={showActions} transparent animationType="fade" onRequestClose={() => setShowActions(false)}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setShowActions(false)} />
        <View style={[styles.dropdownPositioner, { top: actionsDropdownPos.top, right: actionsDropdownPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: Math.max(actionsDropdownPos.right, 14) }]} />
          <View style={styles.dropdown}>
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); setModalVisible(true); }}>
              <View style={styles.dropdownIconWrap}>
                <Ionicons name="add-outline" size={18} color={colors.primary} />
              </View>
              <Text style={styles.dropdownItemPrimary}>Nuevo Ajuste</Text>
            </Pressable>
            <View style={styles.dropdownDivider} />
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); /* bulk */ }}>
              <View style={styles.dropdownIconWrap}>
                <Ionicons name="cloud-upload-outline" size={18} color={colorScales.gray[500]} />
              </View>
              <Text style={styles.dropdownItemText}>Carga Masiva</Text>
            </Pressable>
            <View style={styles.dropdownDivider} />
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); handleRefresh(); }}>
              <View style={styles.dropdownIconWrap}>
                <Ionicons name="sync-outline" size={18} color={colorScales.gray[500]} />
              </View>
              <Text style={styles.dropdownItemText}>Refrescar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Filter Dropdown */}
      <Modal visible={showFilters} transparent animationType="fade" onRequestClose={() => { setShowFilters(false); setShowTypeOptions(false); }}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => { setShowFilters(false); setShowTypeOptions(false); }} />
        <View style={[styles.dropdownPositioner, { top: filterDropdownPos.top, right: filterDropdownPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: Math.max(filterDropdownPos.right, 14) }]} />
          <View style={styles.dropdown}>
            <Text style={styles.dropdownTitle}>Tipos de filtro</Text>
            <View style={styles.dropdownDivider} />
            <View style={styles.dropdownFilterRow}>
              <Text style={styles.dropdownFilterLabel}>Tipo</Text>
              <Pressable style={styles.dropdownSelectBtn} onPress={() => setShowTypeOptions((v) => !v)}>
                <Text style={styles.dropdownSelectText}>
                  {ADJUSTMENT_TYPE_OPTIONS.find((o) => o.value === activeFilter)?.label ?? 'Todos los tipos'}
                </Text>
                <Ionicons name="chevron-down" size={14} color={colorScales.gray[500]} />
              </Pressable>
            </View>
            <View style={styles.dropdownDivider} />
            {showTypeOptions && (
              <View>
                {ADJUSTMENT_TYPE_OPTIONS.map((opt) => (
                  <Pressable key={opt.value} style={[styles.dropdownOption, activeFilter === opt.value && styles.dropdownOptionActive]} onPress={() => { setActiveFilter(opt.value); setShowTypeOptions(false); setShowFilters(false); }}>
                    <Text style={[styles.dropdownOptionText, activeFilter === opt.value && styles.dropdownOptionTextActive]}>{opt.label}</Text>
                    {activeFilter === opt.value && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Create Modal — alineado con la web (centered dialog + wizard 2 pasos) */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={closeCreateModal}>
        <View style={styles.createModalOverlay}>
          <View style={styles.createModal}>
            {/* Header: icon + dynamic title (cambia por paso) + subtitle */}
            <View style={styles.createHeader}>
              <View style={styles.createHeaderTitle}>
                <Icon name="sliders" size={22} color={colors.primary} />
                <View style={styles.createHeaderText}>
                  <Text style={styles.createTitle}>
                    {createStep === 1
                      ? 'Seleccionar Ubicación'
                      : createStep === 2
                        ? 'Agregar Productos'
                        : 'Confirmar Ajustes'}
                  </Text>
                  <Text style={styles.createSubtitle}>Registrar ajustes de inventario</Text>
                </View>
              </View>
              <Pressable onPress={closeCreateModal} hitSlop={8}>
                <Icon name="x" size={22} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            {/* Steps indicator (como la web: UBICACION, PRODUCTOS, CONFIRMAR) */}
            <View style={styles.stepsRow}>
              {STEPS.map((s, idx) => {
                const isActive = createStep === s.num;
                const isDone = createStep > s.num;
                return (
                  <React.Fragment key={s.num}>
                    <View style={styles.stepItem}>
                      <View style={[styles.stepCircle, isActive && styles.stepCircleActive, isDone && styles.stepCircleDone]}>
                        {isDone ? (
                          <Icon name="check" size={12} color={colors.background} />
                        ) : (
                          <Text style={[styles.stepNum, isActive && styles.stepNumActive]}>{s.num}</Text>
                        )}
                      </View>
                      <Text style={[styles.stepLabel, (isActive || isDone) && styles.stepLabelActive]}>{s.label}</Text>
                    </View>
                    {idx < STEPS.length - 1 && (
                      <View style={[styles.stepLine, isDone && styles.stepLineDone]} />
                    )}
                  </React.Fragment>
                );
              })}
            </View>

            <ScrollView style={styles.createBody} contentContainerStyle={styles.createBodyContent} showsVerticalScrollIndicator={false}>
              {/* STEP 1: UBICACIÓN — dropdown selector (como la web usa `app-selector`) */}
              {createStep === 1 && (
                <View style={styles.createStepContent}>
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Ubicación *</Text>
                    {/* Dropdown trigger */}
                    <Pressable
                      onPress={() => setShowLocationDropdown(!showLocationDropdown)}
                      style={styles.locationDropdownTrigger}
                    >
                      <Icon
                        name="warehouse"
                        size={18}
                        color={selectedLocation ? colors.primary : colorScales.gray[400]}
                      />
                      <Text
                        style={[
                          styles.locationDropdownText,
                          !selectedLocation && styles.locationDropdownPlaceholder,
                          !!selectedLocation && styles.locationDropdownTextSelected,
                        ]}
                        numberOfLines={1}
                      >
                        {selectedLocation ? locationLabel(selectedLocation) : 'Seleccionar ubicación'}
                      </Text>
                      <Icon
                        name="chevron-down"
                        size={16}
                        color={colorScales.gray[500]}
                        style={{ transform: showLocationDropdown ? [{ rotate: '180deg' }] : [] }}
                      />
                    </Pressable>

                    {/* Dropdown options (expandible) */}
                    {showLocationDropdown && (
                      <View style={styles.locationDropdownList}>
                        {isLoadingLocations ? (
                          <View style={styles.locationDropdownLoading}>
                            <Spinner size="sm" />
                            <Text style={styles.locationDropdownLoadingText}>Cargando ubicaciones...</Text>
                          </View>
                        ) : LOCATIONS.length === 0 ? (
                          <View style={styles.locationDropdownLoading}>
                            <Icon name="warehouse" size={20} color={colorScales.gray[400]} />
                            <Text style={styles.locationDropdownLoadingText}>No hay ubicaciones registradas</Text>
                          </View>
                        ) : (
                          LOCATIONS.map((loc) => (
                            <Pressable
                              key={loc.value}
                              onPress={() => {
                                setSelectedLocation(loc.value);
                                setShowLocationDropdown(false);
                              }}
                              style={[
                                styles.locationDropdownOption,
                                selectedLocation === loc.value && styles.locationDropdownOptionActive,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.locationDropdownOptionText,
                                  selectedLocation === loc.value && styles.locationDropdownOptionTextActive,
                                ]}
                              >
                                {loc.label}
                              </Text>
                              {selectedLocation === loc.value && (
                                <Icon name="check" size={16} color={colors.primary} />
                              )}
                            </Pressable>
                          ))
                        )}
                      </View>
                    )}
                  </View>

                  {selectedLocation && (
                    <View style={styles.locationSelectedCard}>
                      <Text style={styles.locationSelectedLabel}>Ubicación seleccionada</Text>
                      <Text style={styles.locationSelectedName}>{locationLabel(selectedLocation)}</Text>
                    </View>
                  )}
                </View>
              )}

              {/* STEP 2: PRODUCTOS — ubicación + búsqueda + producto a ajustar (como la web) */}
              {createStep === 2 && (
                <View style={styles.createStepContent}>
                  {/* Resumen de ubicación con botón Cambiar */}
                  <View style={styles.locationSummaryCard}>
                    <Icon name="warehouse" size={18} color={colors.primary} />
                    <Text style={styles.locationSummaryName}>{locationLabel(selectedLocation)}</Text>
                    <Pressable onPress={goBackToStep1} hitSlop={4}>
                      <Text style={styles.locationChangeLink}>Cambiar</Text>
                    </Pressable>
                  </View>

                  {/* Búsqueda de producto */}
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Buscar producto</Text>
                    <View style={styles.searchBox}>
                      <Icon name="search" size={16} color={colorScales.gray[400]} />
                      <TextInput
                        style={styles.searchInputWizard}
                        value={productSearchTerm}
                        onChangeText={searchProducts}
                        placeholder="Buscar por nombre o SKU..."
                        placeholderTextColor={colorScales.gray[400]}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {productSearchTerm.length > 0 && (
                        <Pressable onPress={() => searchProducts('')} hitSlop={6}>
                          <Icon name="x" size={14} color={colorScales.gray[400]} />
                        </Pressable>
                      )}
                    </View>
                    {productSearchResults.length > 0 && (
                      <View style={styles.searchResults}>
                        {productSearchResults.map((p) => (
                          <Pressable
                            key={p.id}
                            style={styles.searchResultItem}
                            onPress={() => selectProduct(p)}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.searchResultName} numberOfLines={1}>{p.name}</Text>
                              <Text style={styles.searchResultSku}>SKU: {p.sku ?? 'N/A'}</Text>
                            </View>
                            <Text style={styles.searchResultStock}>Stock: {p.stock}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>

                  {/* Producto a ajustar (form fields) */}
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Producto a ajustar</Text>
                    {form.product_id ? (
                      <View style={styles.selectedProductCard}>
                        <View style={styles.selectedProductHeader}>
                          <Text style={styles.selectedProductName} numberOfLines={1}>{form.description || `Producto #${form.product_id}`}</Text>
                          <Pressable onPress={() => setForm({ ...form, product_id: 0, description: '' })} hitSlop={4}>
                            <Icon name="trash" size={16} color={colors.error} />
                          </Pressable>
                        </View>
                        <Text style={styles.selectedProductStock}>
                          Stock actual: {ALL_PRODUCTS.find((p) => p.id === form.product_id)?.stock ?? 0}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.productEmptyState}>
                        <Icon name="clipboard-list" size={28} color={colorScales.gray[300]} />
                        <Text style={styles.productEmptyText}>Busca y selecciona un producto</Text>
                      </View>
                    )}
                  </View>

                  {/* Tipo: grid 3×2 con iconos (como la web) */}
                  {form.product_id && (
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Tipo *</Text>
                      <View style={styles.typeGrid}>
                        {TYPE_OPTIONS.map((t) => (
                          <Pressable
                            key={t.value}
                            onPress={() => setForm({ ...form, type: t.value })}
                            style={[styles.typeGridItem, form.type === t.value ? styles.typeGridItemActive : styles.typeGridItemInactive]}
                          >
                            <Icon
                              name={t.icon as any}
                              size={14}
                              color={form.type === t.value ? colors.primary : colorScales.gray[500]}
                            />
                            <Text style={[styles.typeGridText, form.type === t.value ? styles.typeGridTextActive : styles.typeGridTextInactive]}>{t.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  )}

                  {/* Cantidad y motivo (solo si hay producto) */}
                  {form.product_id && (
                    <>
                      <View style={styles.qtyRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.formLabel}>Nueva cantidad *</Text>
                          <TextInput
                            style={styles.qtyInput}
                            value={form.quantity_after > 0 ? String(form.quantity_after) : ''}
                            onChangeText={(t) => setForm({ ...form, quantity_after: parseInt(t) || 0 })}
                            keyboardType="numeric"
                            placeholder="0"
                            placeholderTextColor={colorScales.gray[400]}
                          />
                        </View>
                        <View style={styles.qtyPreview}>
                          <Text style={styles.qtyPreviewLabel}>Cambio</Text>
                          <Text style={[styles.qtyPreviewValue, form.quantity_after > 0 ? styles.qtyPreviewValuePositive : styles.qtyPreviewValueNeutral]}>
                            {form.quantity_after > 0 ? `+${form.quantity_after}` : '0'}
                          </Text>
                        </View>
                      </View>

                      <Input
                        label="Motivo / Nota (opcional)"
                        value={form.reason_code}
                        onChangeText={(t) => setForm({ ...form, reason_code: t })}
                        placeholder="Nota adicional..."
                      />
                    </>
                  )}
                </View>
              )}

              {/* STEP 3: CONFIRMAR — resumen + checkbox + botón dinámico (como la web) */}
              {createStep === 3 && (
                <View style={styles.createStepContent}>
                  {/* Info de ubicación */}
                  <View style={styles.locationInfoCard}>
                    <Icon name="warehouse" size={18} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.locationInfoLabel}>Ubicación</Text>
                      <Text style={styles.locationInfoName}>{locationLabel(selectedLocation)}</Text>
                    </View>
                  </View>

                  {/* Card con el resumen del producto */}
                  <View style={styles.summaryCard}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Tipo</Text>
                      <View style={[styles.typeBadge, { backgroundColor: form.type === 'manual_correction' ? colorScales.green[50] : colorScales.amber[50] }]}>
                        <Text style={[styles.typeBadgeText, { color: form.type === 'manual_correction' ? colors.primary : colorScales.amber[700] }]}>
                          {ADJUSTMENT_TYPE_LABELS[form.type]}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Producto</Text>
                      <Text style={styles.summaryValue} numberOfLines={1}>{form.description || `Producto #${form.product_id}`}</Text>
                    </View>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Cambio</Text>
                      <Text style={[styles.summaryValue, styles.summaryValueBold]}>
                        {form.quantity_after > 0 ? `+${form.quantity_after}` : '0'}
                      </Text>
                    </View>
                    {form.reason_code ? (
                      <>
                        <View style={styles.summaryDivider} />
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>Motivo</Text>
                          <Text style={styles.summaryValue} numberOfLines={2}>{form.reason_code}</Text>
                        </View>
                      </>
                    ) : null}
                  </View>

                  {/* Total */}
                  <View style={styles.totalCard}>
                    <Text style={styles.totalCardLabel}>Total de productos a ajustar</Text>
                    <Text style={styles.totalCardValue}>1</Text>
                  </View>

                  {/* Checkbox de confirmación (como la web) */}
                  <Pressable
                    style={styles.confirmCheckboxRow}
                    onPress={() => setConfirmCreate(!confirmCreate)}
                  >
                    <View style={[styles.checkbox, confirmCreate && styles.checkboxChecked]}>
                      {confirmCreate && <Icon name="check" size={12} color={colors.background} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.confirmCheckboxLabel}>Confirmar creación de ajuste</Text>
                      <Text style={styles.confirmCheckboxDesc}>
                        Al crear y aplicar, el movimiento de inventario será aplicado inmediatamente y no podrá ser revertido.
                      </Text>
                    </View>
                  </Pressable>
                </View>
              )}
            </ScrollView>

            {/* Footer: acción primaria (full-width) + acciones secundarias (iconos) */}
            <View style={styles.createFooter}>
              {/* Acción primaria según el paso */}
              {createStep === 1 && (
                <Button
                  title="Continuar"
                  onPress={goToStep2}
                  disabled={!canAdvanceStep1}
                  variant="primary"
                  fullWidth
                />
              )}
              {createStep === 2 && (
                <Button
                  title="Continuar"
                  onPress={goToStep3}
                  disabled={!canAdvanceStep2}
                  variant="primary"
                  fullWidth
                />
              )}
              {createStep === 3 && confirmCreate && (
                <Button
                  title="Crear y Aplicar"
                  onPress={handleSubmit}
                  loading={createMutation.isPending}
                  variant="primary"
                  fullWidth
                />
              )}
              {createStep === 3 && !confirmCreate && (
                <Button
                  title="Guardar Borrador"
                  onPress={handleSubmit}
                  loading={createMutation.isPending}
                  variant="primary"
                  fullWidth
                />
              )}

              {/* Acciones secundarias (icon-only row) */}
              <View style={styles.createFooterActions}>
                {createStep > 1 && (
                  <Pressable
                    onPress={createStep === 2 ? goBackToStep1 : goBackToStep2}
                    hitSlop={8}
                    style={styles.createFooterIcon}
                  >
                    <Icon name="arrow-left" size={22} color={colorScales.gray[500]} />
                  </Pressable>
                )}
                <Pressable onPress={closeCreateModal} hitSlop={8} style={styles.createFooterIcon}>
                  <Icon name="x" size={22} color={colors.error} />
                </Pressable>
                {createStep === 3 && confirmCreate && (
                  <Pressable onPress={handleSubmit} hitSlop={8} style={styles.createFooterIcon}>
                    <Icon name="check-circle" size={22} color={colorScales.gray[500]} />
                  </Pressable>
                )}
                {createStep === 3 && !confirmCreate && (
                  <Pressable
                    onPress={() => setConfirmCreate(true)}
                    hitSlop={8}
                    style={[styles.createFooterIcon, { opacity: 0.4 }]}
                  >
                    <Icon name="check-circle" size={22} color={colorScales.gray[500]} />
                  </Pressable>
                )}
                {createStep === 3 && (
                  <View style={styles.footerDivider} />
                )}
                {createStep === 3 && !confirmCreate && (
                  <Pressable onPress={handleSubmit} hitSlop={8} style={styles.createFooterIcon}>
                    <Icon name="save" size={22} color={colorScales.gray[500]} />
                  </Pressable>
                )}
                {createStep === 3 && confirmCreate && (
                  <Pressable
                    onPress={() => setConfirmCreate(false)}
                    hitSlop={8}
                    style={[styles.createFooterIcon, { opacity: 0.4 }]}
                  >
                    <Icon name="save" size={22} color={colorScales.gray[500]} />
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colorScales.gray[50] },

  /* Card contenedor principal — margen lateral + bottom + border radius + fondo blanco (alineado con la web) */
  cardContainer: {
    flex: 1,
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },

  /* Stats: horizontal scroll — ancho completo, fondo transparente (gris de la pantalla) */
  statsContainer: {
    backgroundColor: 'transparent',
    paddingTop: spacing[3], paddingBottom: spacing[2.5],
  },
  statsScroll: { paddingHorizontal: spacing[3], gap: spacing[2] },
  statCard: {
    width: 150, backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    paddingHorizontal: spacing[2.5], paddingVertical: spacing[2.5], gap: 1,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  statIcon: { position: 'absolute', top: spacing[2], right: spacing[2] },
  statLabel: { fontSize: 9, fontWeight: '700' as any, color: colorScales.gray[500], letterSpacing: 0.5, textTransform: 'uppercase' as any, marginTop: 2, maxWidth: '85%' },
  statValue: { fontSize: 20, fontWeight: '800' as any, color: colorScales.gray[900], marginTop: 2 },
  statSmall: { fontSize: 9, fontWeight: '500' as any, color: colors.primary, marginTop: 1 },

  /* Search — fondo transparente para integrarse con el card (mismo color que el fondo del card) */
  searchHeader: { paddingHorizontal: spacing[4], paddingTop: spacing[3], marginBottom: spacing[4] },
  listTitle: { fontSize: 12, fontWeight: '700' as any, color: colorScales.gray[600], letterSpacing: 0.3 },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingHorizontal: spacing[4], paddingBottom: spacing[3],
    backgroundColor: 'transparent', borderBottomWidth: 1, borderBottomColor: colorScales.gray[100],
  },
  searchInput: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colorScales.gray[50], borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    borderWidth: 1, borderColor: colorScales.gray[200], minHeight: 40,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  searchTextInput: {
    flex: 1, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily,
    color: colorScales.gray[900], padding: 0, height: '100%',
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: borderRadius.lg,
    backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },

  /* Actions List */
  actionsList: { paddingHorizontal: spacing[4], gap: 0 },
  actionItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  actionIconWrap: { width: 32, height: 32, borderRadius: 8, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: typography.fontSize.base, fontWeight: '500' as any, color: colorScales.gray[900] },
  actionDivider: { height: 1, backgroundColor: colorScales.gray[100] },

  /* Card — alineado con la web: título + badge, grid 2 cols (FECHA/UBICACIÓN), footer (CAMBIO + pin) */
  card: {
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardBody: { padding: spacing[4] },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  cardTitle: {
    flex: 1,
    fontSize: typography.fontSize.base,
    fontWeight: '700' as any,
    color: colorScales.gray[900],
  },
  // Pill de tipo (Conteo, Daño, Pérdida, etc.) — estilo web
  cardBadge: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.blue[50],
    borderWidth: 1,
    borderColor: colorScales.blue[100],
  },
  cardBadgeText: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.blue[700],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.3,
  },
  // Grid 2 columnas: FECHA | UBICACIÓN
  cardGrid: {
    flexDirection: 'row',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  cardGridItem: { flex: 1, gap: 2 },
  cardGridLabel: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  cardGridValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: '600' as any,
    color: colorScales.gray[900],
  },
  // Footer: CAMBIO (izquierda) + pin (derecha), separados por línea superior
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
  },
  cardFooterLeft: { gap: 2 },
  cardFooterLabel: {
    fontSize: 10,
    fontWeight: '700' as any,
    color: colorScales.gray[500],
    textTransform: 'uppercase' as any,
    letterSpacing: 0.5,
  },
  cardFooterValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: '800' as any,
    color: colorScales.gray[900],
  },

  /* List */
  listContent: { paddingBottom: spacing[6] },

  /* Dropdowns (positioned near buttons) */
  dropdownBackdrop: { flex: 1 },
  dropdownPositioner: { position: 'absolute', alignItems: 'flex-end' },
  dropdownArrow: {
    width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderBottomWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: colors.background,
    marginRight: 14, marginBottom: -1,
  },
  dropdown: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    minWidth: 200, ...shadows.lg,
  },
  dropdownTitle: { fontSize: 12, fontWeight: '700' as any, color: colorScales.gray[500], paddingVertical: spacing[2], paddingHorizontal: spacing[3], letterSpacing: 0.3, textTransform: 'uppercase' as any },
  dropdownDivider: { height: 1, backgroundColor: colorScales.gray[100] },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3] },
  dropdownIconWrap: { width: 28, height: 28, borderRadius: 6, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  dropdownItemText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownItemPrimary: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.primary },
  dropdownFilterRow: { paddingVertical: spacing[2], paddingHorizontal: spacing[3], gap: spacing[1] },
  dropdownFilterLabel: { fontSize: 11, fontWeight: '600' as any, color: colorScales.gray[500], letterSpacing: 0.5, textTransform: 'uppercase' as any },
  dropdownSelectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: spacing[2], borderRadius: 6, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colorScales.gray[50], marginTop: 4 },
  dropdownSelectText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[800] },
  dropdownOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[2], paddingHorizontal: spacing[3] },
  dropdownOptionActive: { backgroundColor: colorScales.green[50] },
  dropdownOptionText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownOptionTextActive: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.primary },

  /* Create Modal — centered dialog + wizard (alineado con la web) */
  createModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  createModal: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    width: '100%', maxWidth: 520, maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  createHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3.5], borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  createHeaderTitle: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], flex: 1, marginRight: spacing[3] },
  createHeaderText: { flex: 1 },
  createTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  createSubtitle: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },

  /* Steps indicator */
  stepsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colorScales.gray[50], borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  stepItem: { alignItems: 'center', gap: 4 },
  stepCircle: { width: 24, height: 24, borderRadius: 12, backgroundColor: colorScales.gray[200], alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: colors.primary },
  stepCircleDone: { backgroundColor: colors.primary },
  stepNum: { fontSize: 11, fontWeight: '700' as any, color: colorScales.gray[500] },
  stepNumActive: { color: colors.background },
  stepLabel: { fontSize: 10, fontWeight: '600' as any, color: colorScales.gray[500], letterSpacing: 0.5 },
  stepLabelActive: { color: colors.primary },
  stepLine: { flex: 1, height: 2, backgroundColor: colorScales.gray[200], marginHorizontal: 6, marginBottom: 16 },
  stepLineDone: { backgroundColor: colors.primary },

  /* Body */
  createBody: { flexGrow: 0, flexShrink: 1, maxHeight: 420 },
  createBodyContent: { padding: spacing[4], gap: spacing[3] },
  createStepContent: { gap: spacing[3] },

  formGroup: { marginBottom: spacing[1] },
  formLabel: { fontSize: typography.fontSize.xs, fontWeight: '600' as any, color: colorScales.gray[500], marginBottom: spacing[2], textTransform: 'uppercase', letterSpacing: 0.5 },

  /* Type grid 3x2 con iconos (como la web) */
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  typeGridItem: { width: '31%', flexDirection: 'column', alignItems: 'center', paddingVertical: spacing[2], paddingHorizontal: 4, borderRadius: 8, borderWidth: 1, backgroundColor: colors.background },
  typeGridItemActive: { borderColor: colors.primary, backgroundColor: colorScales.green[50] },
  typeGridItemInactive: { borderColor: colorScales.gray[200] },
  typeGridText: { fontSize: 10, fontWeight: '600' as any, marginTop: 4, textAlign: 'center' },
  typeGridTextActive: { color: colors.primary },
  typeGridTextInactive: { color: colorScales.gray[500] },

  /* Confirm step */
  confirmBanner: { flexDirection: 'row', gap: spacing[2], backgroundColor: colorScales.blue[50], borderRadius: 8, borderWidth: 1, borderColor: colorScales.blue[200], padding: spacing[2.5], alignItems: 'flex-start' },
  confirmBannerTitle: { fontSize: 12, fontWeight: '700' as any, color: colorScales.blue[800] },
  confirmBannerDesc: { fontSize: 11, color: colorScales.blue[900], marginTop: 2, lineHeight: 15 },

  summaryCard: { backgroundColor: colorScales.gray[50], borderRadius: 10, borderWidth: 1, borderColor: colorScales.gray[200], padding: spacing[3], gap: spacing[2] },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  summaryLabel: { fontSize: 12, color: colorScales.gray[500], fontWeight: '500' as any, flex: 1 },
  summaryValue: { fontSize: 13, color: colorScales.gray[900], fontWeight: '500' as any, flex: 1, textAlign: 'right' },
  summaryValueBold: { fontWeight: '700' as any },
  summaryDivider: { height: 1, backgroundColor: colorScales.gray[200] },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  typeBadgeText: { fontSize: 10, fontWeight: '700' as any, textTransform: 'uppercase' as any },

  confirmCheckboxRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2.5], padding: spacing[3],
    backgroundColor: colorScales.amber[50], borderRadius: 10, borderWidth: 1, borderColor: colorScales.amber[200],
  },
  checkbox: { width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: colorScales.gray[300], backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  confirmCheckboxLabel: { fontSize: 13, fontWeight: '600' as any, color: colorScales.gray[900] },
  confirmCheckboxDesc: { fontSize: 11, color: colorScales.gray[500], marginTop: 2, lineHeight: 15 },

  /* Footer */
  createFooter: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[4], borderTopWidth: 1, borderTopColor: colorScales.gray[200], backgroundColor: colorScales.gray[50] },
  createFooterActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[6], paddingTop: spacing[2] },
  createFooterIcon: { padding: spacing[1] },
  footerDivider: { width: 1, height: 20, backgroundColor: colorScales.gray[300] },

  /* Step 1: UBICACIÓN — dropdown selector (como la web usa `app-selector`) */
  locationDropdownTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingVertical: spacing[3], paddingHorizontal: spacing[3],
    borderRadius: 10, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colors.background,
  },
  locationDropdownText: { flex: 1, fontSize: 14, fontWeight: '500' as any, color: colorScales.gray[900] },
  locationDropdownPlaceholder: { color: colorScales.gray[400], fontWeight: '400' as any },
  locationDropdownTextSelected: { fontWeight: '600' as any, color: colors.primary },
  locationDropdownList: {
    marginTop: 4, borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: 10,
    backgroundColor: colors.background, overflow: 'hidden',
  },
  locationDropdownOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing[3], paddingHorizontal: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colorScales.gray[100],
  },
  locationDropdownOptionActive: { backgroundColor: colorScales.green[50] },
  locationDropdownOptionText: { fontSize: 14, color: colorScales.gray[700] },
  locationDropdownOptionTextActive: { fontWeight: '600' as any, color: colors.primary },
  locationDropdownLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: spacing[4] },
  locationDropdownLoadingText: { fontSize: 12, color: colorScales.gray[500] },
  locationSelectedCard: {
    backgroundColor: colorScales.green[50], borderRadius: 10, borderWidth: 1,
    borderColor: colorScales.green[200], padding: spacing[3], alignItems: 'center', gap: 4,
  },
  locationSelectedLabel: { fontSize: 11, color: colorScales.gray[500] },
  locationSelectedName: { fontSize: 16, fontWeight: '700' as any, color: colors.primary },

  /* Step 2: PRODUCTOS — location summary + product search */
  locationSummaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    padding: spacing[2.5], borderRadius: 10, borderWidth: 1,
    borderColor: colorScales.gray[200], backgroundColor: colorScales.gray[50],
  },
  locationSummaryName: { flex: 1, fontSize: 13, fontWeight: '600' as any, color: colorScales.gray[900] },
  locationChangeLink: { fontSize: 12, fontWeight: '600' as any, color: colors.primary, textDecorationLine: 'underline' },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: 8,
    paddingHorizontal: spacing[2.5], paddingVertical: spacing[2], backgroundColor: colors.background,
  },
  searchInputWizard: { flex: 1, fontSize: 13, color: colorScales.gray[900], padding: 0 },
  searchResults: {
    marginTop: 6, borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: 8,
    maxHeight: 180, backgroundColor: colors.background,
  },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[2], paddingHorizontal: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colorScales.gray[100], gap: spacing[2],
  },
  searchResultName: { fontSize: 12, fontWeight: '500' as any, color: colorScales.gray[900] },
  searchResultSku: { fontSize: 10, color: colorScales.gray[500], marginTop: 2 },
  searchResultStock: { fontSize: 11, fontWeight: '600' as any, color: colorScales.gray[700] },

  /* Selected product card (después de seleccionar) */
  selectedProductCard: {
    backgroundColor: colors.background, borderRadius: 10, borderWidth: 1,
    borderColor: colorScales.gray[200], padding: spacing[2.5], gap: 4,
  },
  selectedProductHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  selectedProductName: { flex: 1, fontSize: 13, fontWeight: '700' as any, color: colorScales.gray[900] },
  selectedProductStock: { fontSize: 11, color: colorScales.gray[500] },

  productEmptyState: {
    alignItems: 'center', paddingVertical: spacing[5], gap: 4,
    borderWidth: 1, borderColor: colorScales.gray[200], borderStyle: 'dashed', borderRadius: 10,
    backgroundColor: colors.background,
  },
  productEmptyText: { fontSize: 12, color: colorScales.gray[500] },

  /* Cantidad con preview de cambio (como la web) */
  qtyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[3] },
  qtyInput: {
    borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: 8,
    paddingHorizontal: spacing[2.5], paddingVertical: spacing[2], fontSize: 14,
    fontWeight: '600' as any, color: colorScales.gray[900], backgroundColor: colors.background, textAlign: 'center',
  },
  qtyPreview: { alignItems: 'center', paddingBottom: 4 },
  qtyPreviewLabel: { fontSize: 10, color: colorScales.gray[500], textTransform: 'uppercase' as any, fontWeight: '600' as any, marginBottom: 2 },
  qtyPreviewValue: { fontSize: 16, fontWeight: '700' as any },
  qtyPreviewValuePositive: { color: colors.primary },
  qtyPreviewValueNeutral: { color: colorScales.gray[500] },

  /* Step 3: CONFIRMAR — location info + total */
  locationInfoCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2.5],
    padding: spacing[3], borderRadius: 10, borderWidth: 1, borderColor: colorScales.gray[200],
    backgroundColor: colorScales.gray[50],
  },
  locationInfoLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any },
  locationInfoName: { fontSize: 14, fontWeight: '600' as any, color: colorScales.gray[900] },

  totalCard: {
    backgroundColor: colorScales.green[50], borderRadius: 10, borderWidth: 1,
    borderColor: colorScales.green[200], padding: spacing[3], alignItems: 'center', gap: 4,
  },
  totalCardLabel: { fontSize: 12, color: colorScales.gray[500] },
  totalCardValue: { fontSize: 24, fontWeight: '800' as any, color: colors.primary },
});
