import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, RefreshControl, Pressable, Modal, ScrollView, StyleSheet, TextInput, Dimensions, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import { getNextPageParam } from '@/core/api/pagination';
import type { CreateTransferDto } from '@/features/store/services/inventory.service';
import type { StockTransfer, TransferState, Location } from '@/features/store/types';
import { TRANSFER_STATE_LABELS } from '@/features/store/types';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { Badge } from '@/shared/components/badge/badge';
import { Icon } from '@/shared/components/icon/icon';
import { Input } from '@/shared/components/input/input';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Button } from '@/shared/components/button/button';
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

const FILTER_OPTIONS: FilterChip[] = [
  { label: 'Todos los estados', value: 'all' },
  { label: 'Pendientes', value: 'pending' },
  { label: 'En Tránsito', value: 'in_transit' },
  { label: 'Completadas', value: 'completed' },
  { label: 'Canceladas', value: 'cancelled' },
];

const TransferCard = ({ item }: { item: StockTransfer }) => (
  <View style={styles.transferCard}>
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
  </View>
);

function EmptyTransfers({ onCreate }: { onCreate: () => void }) {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconCircle}>
        <Icon name="refresh-cw" size={36} color={colorScales.gray[400]} />
      </View>
      <Text style={styles.emptyTitle}>No hay transferencias de inventario</Text>
      <Text style={styles.emptyDesc}>
        Crea una transferencia para mover productos{'\n'}entre ubicaciones.
      </Text>
      <Pressable style={styles.emptyCreateBtn} onPress={onCreate}>
        <Icon name="plus" size={18} color={colors.background} />
        <Text style={styles.emptyCreateText}>Nueva Transferencia</Text>
      </Pressable>
    </View>
  );
}

export default function TransfersScreen() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<TransferState | 'all'>('all');
  const [modalVisible, setModalVisible] = useState(false);
  // Dropdowns posicionados (acciones + y filtro)
  const [showActions, setShowActions] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showFilterOptions, setShowFilterOptions] = useState(false);
  const actionsBtnRef = useRef<View>(null);
  const filterBtnRef = useRef<View>(null);
  const [actionsPos, setActionsPos] = useState({ top: 0, right: 0 });
  const [filterPos, setFilterPos] = useState({ top: 0, right: 0 });
  const screenW = Dimensions.get('window').width;

  // --- Wizard state (Nueva Transferencia — 3 pasos como la web) ---
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [originLocation, setOriginLocation] = useState<number | null>(null);
  const [destinationLocation, setDestinationLocation] = useState<number | null>(null);
  const [expectedDate, setExpectedDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [showOriginDropdown, setShowOriginDropdown] = useState(false);
  const [showDestinationDropdown, setShowDestinationDropdown] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [transferItems, setTransferItems] = useState<Array<{ product_id: number; quantity: number }>>([]);
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

  // Productos mock (alineado con adjustments.tsx)
  const ALL_PRODUCTS: Array<{ id: number; name: string; sku?: string; stock: number; category?: string }> = [
    { id: 101, name: 'Kit de Limpieza Soplete', sku: 'KIT-LIM-SOP', stock: 20, category: 'Kits' },
    { id: 102, name: 'Kit de Limpieza Industrial', sku: 'KIT-LIM-IND', stock: 15, category: 'Kits' },
    { id: 103, name: 'Camiseta Básica Blanca', sku: 'CAM-BAS-BLA', stock: 50, category: 'Ropa' },
    { id: 104, name: 'Pantalón Jean Clásico', sku: 'PAN-JEA-CLA', stock: 30, category: 'Ropa' },
    { id: 105, name: 'Zapatillas Deportivas', sku: 'ZAP-DEP-001', stock: 25, category: 'Calzado' },
    { id: 106, name: 'Gorra Ajustable', sku: 'GOR-AJU-001', stock: 100, category: 'Accesorios' },
    { id: 107, name: 'Mochila Escolar', sku: 'MOC-ESC-001', stock: 15, category: 'Accesorios' },
  ];

  const STEPS = [
    { num: 1, label: 'UBICACIONES' },
    { num: 2, label: 'PRODUCTOS' },
    { num: 3, label: 'CONFIRMAR' },
  ];

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
      closeCreateModal();
      toastSuccess('Transferencia creada correctamente');
    },
    onError: () => toastError('Error al crear la transferencia'),
  });

  const transfers = data?.pages.flatMap((p) => p.data) ?? [];

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => {
    refetch();
    toastSuccess('Transferencias actualizadas');
  }, [refetch]);

  // --- Wizard helpers ---
  const canAdvanceStep1 = originLocation !== null && destinationLocation !== null;
  const canAdvanceStep2 = transferItems.length > 0;
  const goToStep2 = () => { if (canAdvanceStep1) setCreateStep(2); };
  const goToStep3 = () => { if (canAdvanceStep2) setCreateStep(3); };
  const goBackToStep1 = () => setCreateStep(1);
  const goBackToStep2 = () => setCreateStep(2);

  const openCreateModal = () => {
    setCreateStep(1);
    setOriginLocation(null);
    setDestinationLocation(null);
    setExpectedDate('');
    setNotes('');
    setShowOriginDropdown(false);
    setShowDestinationDropdown(false);
    setTransferItems([]);
    setProductSearchTerm('');
    setProductSearchResults([]);
    setModalVisible(true);
  };

  const closeCreateModal = () => {
    setModalVisible(false);
    setCreateStep(1);
  };

  const handleSubmit = () => {
    if (!originLocation || !destinationLocation || transferItems.length === 0) return;
    const dto: CreateTransferDto = {
      origin_location_id: String(originLocation),
      destination_location_id: String(destinationLocation),
      items: transferItems.map((i) => ({ product_id: String(i.product_id), quantity: i.quantity })),
    };
    createMutation.mutate(dto);
  };

  const handleDateChange = (_e: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (!selectedDate) return;
    setExpectedDate(selectedDate.toISOString().slice(0, 10));
  };

  const locationLabel = (id: number | null) => (id ? LOCATIONS.find((l) => l.value === id)?.label : '');

  const searchProducts = (term: string) => {
    setProductSearchTerm(term);
    if (term.trim().length < 1) {
      setProductSearchResults([]);
      return;
    }
    const lower = term.toLowerCase().trim();
    setProductSearchResults(
      ALL_PRODUCTS.filter((p) => {
        const nameMatch = p.name.toLowerCase().includes(lower);
        const skuMatch = p.sku ? p.sku.toLowerCase().includes(lower) : false;
        return nameMatch || skuMatch;
      }).filter((p) => !transferItems.some((ti) => ti.product_id === p.id))
    );
  };

  const addProduct = (product: { id: number; name: string }) => {
    setTransferItems([...transferItems, { product_id: product.id, quantity: 1 }]);
    setProductSearchTerm('');
    setProductSearchResults([]);
  };

  const removeProduct = (productId: number) => {
    setTransferItems(transferItems.filter((i) => i.product_id !== productId));
  };

  const updateProductQuantity = (productId: number, quantity: number) => {
    setTransferItems(transferItems.map((i) => (i.product_id === productId ? { ...i, quantity } : i)));
  };

  const openActions = useCallback(() => {
    actionsBtnRef.current?.measureInWindow((x, y, w, h) => {
      setActionsPos({ top: y + h + 6, right: screenW - x - w });
      setShowActions(true);
    });
  }, [screenW]);

  const openFilters = useCallback(() => {
    filterBtnRef.current?.measureInWindow((x, y, w, h) => {
      setFilterPos({ top: y + h + 6, right: screenW - x - w });
      setShowFilters(true);
    });
  }, [screenW]);

  // --- Wizard header data: title y subtitle dinámicos por paso ---
  const wizardHeader = {
    1: { title: 'Ubicaciones', subtitle: 'Mover productos entre ubicaciones' },
    2: { title: 'Productos', subtitle: 'Selecciona los productos a transferir' },
    3: { title: 'Confirmar', subtitle: 'Revisa y crea la transferencia' },
  }[createStep];

  return (
    <View style={styles.container}>
      {/* Stats: ancho completo de la pantalla (fuera del card) — alineado con la web */}
      <StatsGrid
        style={styles.statsWrap}
        items={[
          {
            label: 'Total',
            value: transfers.length,
            icon: <Icon name="clipboard-list" size={14} color={colorScales.blue[600]} />,
            description: 'Movimientos',
          },
          {
            label: 'Borradores',
            value: transfers.filter((t) => t.state === 'pending').length,
            icon: <Icon name="clock" size={14} color={colorScales.amber[600]} />,
            description: 'Pendientes',
          },
          {
            label: 'En Tránsito',
            value: transfers.filter((t) => t.state === 'in_transit').length,
            icon: <Icon name="truck" size={14} color={colorScales.amber[600]} />,
            description: 'En camino',
          },
          {
            label: 'Completadas',
            value: transfers.filter((t) => t.state === 'completed').length,
            icon: <Icon name="check-circle" size={14} color={colorScales.green[600]} />,
            description: 'Recibidas',
          },
        ]}
      />

      {/* Card contenedor: título + búsqueda + filtros + cards de transferencias */}
      <View style={styles.cardContainer}>
      <FlatList
        data={transfers}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TransferCard item={item} />}
        ListHeaderComponent={
          <View>
            {/* Título "Transferencias (N)" — alineado con la web */}
            <View style={styles.titleRow}>
              <Text style={styles.listTitle}>
                Transferencias ({transfers.length})
              </Text>
            </View>

            {/* Barra de búsqueda + botones + y filtro (alineado con la web) */}
            <View style={styles.searchRow}>
              <View style={styles.searchInputWrap}>
                <Ionicons name="search-outline" size={16} color={colorScales.gray[400]} style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInputField}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Buscar transferencia..."
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
              <Pressable ref={actionsBtnRef} style={styles.iconBtn} onPress={openActions} hitSlop={6}>
                <Icon name="plus" size={20} color={colors.primary} />
              </Pressable>
              <Pressable ref={filterBtnRef} style={styles.iconBtn} onPress={openFilters} hitSlop={6}>
                <Icon name="filter" size={18} color={colors.primary} />
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <Spinner />
          ) : transfers.length === 0 && !search ? (
            <EmptyTransfers onCreate={openCreateModal} />
          ) : transfers.length === 0 ? (
            <View style={styles.emptySearch}>
              <Icon name="search" size={28} color={colorScales.gray[400]} />
              <Text style={styles.emptySearchText}>Sin resultados para "{search}"</Text>
            </View>
          ) : null
        }
        ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.listContent}
      />
      </View>

      {/* Dropdown de acciones (Refrescar + Nueva Transferencia) */}
      <Modal visible={showActions} transparent animationType="fade" onRequestClose={() => setShowActions(false)}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setShowActions(false)} />
        <View style={[styles.dropdownPositioner, { top: actionsPos.top, right: actionsPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: 14 }]} />
          <View style={styles.dropdown}>
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); handleRefresh(); }}>
              <View style={styles.dropdownIconWrap}>
                <Ionicons name="sync-outline" size={18} color={colorScales.gray[500]} />
              </View>
              <Text style={styles.dropdownItemText}>Refrescar</Text>
            </Pressable>
            <View style={styles.dropdownDivider} />
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); openCreateModal(); }}>
              <View style={styles.dropdownIconWrap}>
                <Ionicons name="add-outline" size={18} color={colors.primary} />
              </View>
              <Text style={styles.dropdownItemPrimary}>Nueva Transferencia</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Dropdown de filtro por estado — popup modal con estilo web */}
      <Modal visible={showFilters} transparent animationType="fade" onRequestClose={() => { setShowFilters(false); setShowFilterOptions(false); }}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => { setShowFilters(false); setShowFilterOptions(false); }} />
        <View style={[styles.dropdownPositioner, { top: filterPos.top, right: filterPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: Math.max(filterPos.right, 14) }]} />
          <View style={styles.filterPopup}>
            <View style={styles.filterPopupHeader}>
              <Text style={styles.filterPopupTitle}>Filtros</Text>
            </View>
            <View style={styles.filterPopupBody}>
              <Text style={styles.filterPopupLabel}>Estado</Text>
              <Pressable
                style={styles.filterPopupSelect}
                onPress={() => setShowFilterOptions(!showFilterOptions)}
              >
                <Text style={styles.filterPopupSelectText}>
                  {FILTER_OPTIONS.find((o) => o.value === activeFilter)?.label ?? 'Todos los estados'}
                </Text>
                <Ionicons name={showFilterOptions ? 'chevron-up' : 'chevron-down'} size={16} color={colorScales.gray[500]} />
              </Pressable>
              {showFilterOptions && (
                <View style={styles.filterPopupOptionsList}>
                  {FILTER_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.value}
                      style={[styles.filterPopupOption, activeFilter === opt.value && styles.filterPopupOptionActive]}
                      onPress={() => { setActiveFilter(opt.value); setShowFilters(false); setShowFilterOptions(false); }}
                    >
                      <Text style={[styles.filterPopupOptionText, activeFilter === opt.value && styles.filterPopupOptionTextActive]}>
                        {opt.label}
                      </Text>
                      {activeFilter === opt.value && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal wizard: Nueva Transferencia — 3 pasos como la web */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={closeCreateModal}>
        <View style={styles.createModalOverlay}>
          <View style={styles.createModal}>
            {/* Header con título dinámico + botón cerrar */}
            <View style={styles.createHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.createTitle}>{wizardHeader.title}</Text>
                <Text style={styles.createSubtitle}>{wizardHeader.subtitle}</Text>
              </View>
              <Pressable onPress={closeCreateModal} hitSlop={8}>
                <Ionicons name="close" size={22} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            {/* Stepper: 3 círculos conectados por líneas */}
            <View style={styles.stepsRow}>
              {STEPS.map((s, idx) => {
                const isActive = createStep === s.num;
                const isDone = createStep > s.num;
                return (
                  <React.Fragment key={s.num}>
                    <View style={styles.stepItem}>
                      <View style={[styles.stepCircle, (isActive || isDone) && styles.stepCircleActive]}>
                        {isDone ? (
                          <Ionicons name="checkmark" size={14} color={colors.background} />
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
              {/* STEP 1: UBICACIONES */}
              {createStep === 1 && (
                <View style={styles.createStepContent}>
                  {/* Ubicación Origen */}
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Ubicación Origen <Text style={styles.required}>*</Text></Text>
                    <Pressable
                      onPress={() => { setShowOriginDropdown(!showOriginDropdown); setShowDestinationDropdown(false); }}
                      style={styles.locationDropdownTrigger}
                    >
                      <Icon name="warehouse" size={18} color={originLocation ? colors.primary : colorScales.gray[400]} />
                      <Text style={[styles.locationDropdownText, !originLocation && styles.locationDropdownPlaceholder, !!originLocation && styles.locationDropdownTextSelected]} numberOfLines={1}>
                        {originLocation ? locationLabel(originLocation) : 'Seleccionar origen'}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={colorScales.gray[500]} style={{ transform: showOriginDropdown ? [{ rotate: '180deg' }] : [] }} />
                    </Pressable>
                    {showOriginDropdown && (
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
                              key={`o-${loc.value}`}
                              onPress={() => { setOriginLocation(loc.value); setShowOriginDropdown(false); }}
                              style={[styles.locationDropdownOption, originLocation === loc.value && styles.locationDropdownOptionActive]}
                            >
                              <Text style={[styles.locationDropdownOptionText, originLocation === loc.value && styles.locationDropdownOptionTextActive]}>
                                {loc.label}
                              </Text>
                              {originLocation === loc.value && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                            </Pressable>
                          ))
                        )}
                      </View>
                    )}
                  </View>

                  {/* Ubicación Destino */}
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Ubicación Destino <Text style={styles.required}>*</Text></Text>
                    <Pressable
                      onPress={() => { setShowDestinationDropdown(!showDestinationDropdown); setShowOriginDropdown(false); }}
                      style={styles.locationDropdownTrigger}
                    >
                      <Icon name="warehouse" size={18} color={destinationLocation ? colors.primary : colorScales.gray[400]} />
                      <Text style={[styles.locationDropdownText, !destinationLocation && styles.locationDropdownPlaceholder, !!destinationLocation && styles.locationDropdownTextSelected]} numberOfLines={1}>
                        {destinationLocation ? locationLabel(destinationLocation) : 'Seleccionar destino'}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={colorScales.gray[500]} style={{ transform: showDestinationDropdown ? [{ rotate: '180deg' }] : [] }} />
                    </Pressable>
                    {showDestinationDropdown && (
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
                          LOCATIONS
                            .filter((loc) => loc.value !== originLocation)
                            .map((loc) => (
                              <Pressable
                                key={`d-${loc.value}`}
                                onPress={() => { setDestinationLocation(loc.value); setShowDestinationDropdown(false); }}
                                style={[styles.locationDropdownOption, destinationLocation === loc.value && styles.locationDropdownOptionActive]}
                              >
                                <Text style={[styles.locationDropdownOptionText, destinationLocation === loc.value && styles.locationDropdownOptionTextActive]}>
                                  {loc.label}
                                </Text>
                                {destinationLocation === loc.value && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                              </Pressable>
                            ))
                        )}
                      </View>
                    )}
                  </View>

                  {/* Fecha Esperada */}
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Fecha Esperada</Text>
                    <Pressable style={styles.dateInput} onPress={() => setShowDatePicker(true)}>
                      <Ionicons name="calendar-outline" size={16} color={colorScales.gray[500]} />
                      <Text style={[styles.dateValue, !expectedDate && styles.datePlaceholder]}>
                        {expectedDate || 'dd/mm/aaaa'}
                      </Text>
                    </Pressable>
                    {showDatePicker && (
                      <DateTimePicker
                        value={expectedDate ? new Date(expectedDate + 'T12:00:00') : new Date()}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                        onChange={handleDateChange}
                      />
                    )}
                  </View>

                  {/* Notas */}
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>NOTAS</Text>
                    <TextInput
                      style={styles.textArea}
                      value={notes}
                      onChangeText={setNotes}
                      placeholder="Notas opcionales sobre la transferencia..."
                      placeholderTextColor={colorScales.gray[400]}
                      multiline
                      numberOfLines={3}
                    />
                  </View>
                </View>
              )}

              {/* STEP 2: PRODUCTOS */}
              {createStep === 2 && (
                <View style={styles.createStepContent}>
                  <View style={styles.locationSummaryCard}>
                    <Icon name="warehouse" size={18} color={colors.primary} />
                    <Text style={styles.locationSummaryName} numberOfLines={1}>
                      {locationLabel(originLocation)} → {locationLabel(destinationLocation)}
                    </Text>
                    <Pressable onPress={goBackToStep1} hitSlop={4}>
                      <Text style={styles.locationChangeLink}>Cambiar</Text>
                    </Pressable>
                  </View>

                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Buscar producto</Text>
                    <View style={styles.searchBox}>
                      <Ionicons name="search" size={16} color={colorScales.gray[400]} />
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
                          <Ionicons name="close" size={14} color={colorScales.gray[400]} />
                        </Pressable>
                      )}
                    </View>
                    {productSearchResults.length > 0 && (
                      <View style={styles.searchResults}>
                        {productSearchResults.map((p) => (
                          <Pressable key={p.id} style={styles.searchResultItem} onPress={() => addProduct(p)}>
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

                  {transferItems.length > 0 && (
                    <View style={styles.formGroup}>
                      <Text style={styles.formLabel}>Productos seleccionados ({transferItems.length})</Text>
                      {transferItems.map((item) => {
                        const product = ALL_PRODUCTS.find((p) => p.id === item.product_id);
                        return (
                          <View key={item.product_id} style={styles.selectedProductCard}>
                            <View style={styles.selectedProductHeader}>
                              <Text style={styles.selectedProductName} numberOfLines={1}>{product?.name ?? `Producto #${item.product_id}`}</Text>
                              <Pressable onPress={() => removeProduct(item.product_id)} hitSlop={4}>
                                <Ionicons name="trash" size={16} color={colors.error} />
                              </Pressable>
                            </View>
                            <View style={styles.qtyRow}>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.qtyLabel}>Cantidad</Text>
                                <TextInput
                                  style={styles.qtyInput}
                                  value={String(item.quantity)}
                                  onChangeText={(t) => updateProductQuantity(item.product_id, parseInt(t) || 1)}
                                  keyboardType="numeric"
                                />
                              </View>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              {/* STEP 3: CONFIRMAR */}
              {createStep === 3 && (
                <View style={styles.createStepContent}>
                  <View style={styles.locationInfoCard}>
                    <Icon name="warehouse" size={18} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.locationInfoLabel}>Ruta</Text>
                      <Text style={styles.locationInfoName}>
                        {locationLabel(originLocation)} → {locationLabel(destinationLocation)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.summaryCard}>
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Fecha Esperada</Text>
                      <Text style={styles.summaryValue}>{expectedDate || '—'}</Text>
                    </View>
                    <View style={styles.summaryDivider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Productos</Text>
                      <Text style={styles.summaryValue}>{transferItems.length}</Text>
                    </View>
                    {notes ? (
                      <>
                        <View style={styles.summaryDivider} />
                        <View style={styles.summaryRow}>
                          <Text style={styles.summaryLabel}>Notas</Text>
                          <Text style={styles.summaryValue}>{notes}</Text>
                        </View>
                      </>
                    ) : null}
                  </View>

                  {expectedDate ? null : (
                    <View style={styles.warningBanner}>
                      <Icon name="info" size={16} color={colorScales.amber[700]} />
                      <Text style={styles.warningText}>Sin fecha esperada, se usará la fecha actual</Text>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>

            {/* Footer: Cancelar + Continuar/Crear */}
            <View style={styles.createFooter}>
              {createStep === 1 && (
                <>
                  <Pressable style={styles.cancelBtnWizard} onPress={closeCreateModal}>
                    <Text style={styles.cancelBtnWizardText}>Cancelar</Text>
                  </Pressable>
                  <View style={{ width: spacing[3] }} />
                  <Pressable
                    style={[styles.continueBtn, !canAdvanceStep1 && styles.continueBtnDisabled]}
                    onPress={goToStep2}
                    disabled={!canAdvanceStep1}
                  >
                    <Ionicons name="chevron-forward" size={18} color={colors.background} />
                    <Text style={styles.continueBtnText}>Continuar</Text>
                  </Pressable>
                </>
              )}
              {createStep === 2 && (
                <>
                  <Pressable style={styles.cancelBtnWizard} onPress={goBackToStep1}>
                    <Text style={styles.cancelBtnWizardText}>Atrás</Text>
                  </Pressable>
                  <View style={{ width: spacing[3] }} />
                  <Pressable
                    style={[styles.continueBtn, !canAdvanceStep2 && styles.continueBtnDisabled]}
                    onPress={goToStep3}
                    disabled={!canAdvanceStep2}
                  >
                    <Ionicons name="chevron-forward" size={18} color={colors.background} />
                    <Text style={styles.continueBtnText}>Continuar</Text>
                  </Pressable>
                </>
              )}
              {createStep === 3 && (
                <>
                  <Pressable style={styles.cancelBtnWizard} onPress={goBackToStep2}>
                    <Text style={styles.cancelBtnWizardText}>Atrás</Text>
                  </Pressable>
                  <View style={{ width: spacing[3] }} />
                  <Pressable
                    style={[styles.continueBtn, createMutation.isPending && styles.continueBtnDisabled]}
                    onPress={handleSubmit}
                    disabled={createMutation.isPending}
                  >
                    {createMutation.isPending ? (
                      <Spinner size="sm" />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={colors.background} />
                    )}
                    <Text style={styles.continueBtnText}>{createMutation.isPending ? 'Creando...' : 'Crear Transferencia'}</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colorScales.gray[50] },
  /* Card contenedor — debajo de las stats, con margen lateral + bottom + border radius + fondo blanco */
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
  statsWrap: {},

  /* Título "Transferencias (N)" — alineado con la web */
  titleRow: { paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[2] },
  listTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },

  /* Barra de búsqueda + botones + / filtro */
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingHorizontal: spacing[4], paddingBottom: spacing[3],
  },
  searchInputWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2],
    borderWidth: 1, borderColor: colorScales.gray[200], minHeight: 40,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },
  searchIcon: { marginRight: spacing[2] },
  searchInputField: {
    flex: 1, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily,
    color: colorScales.gray[900], padding: 0, height: '100%',
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: borderRadius.lg,
    backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1,
  },

  /* Empty state central — alineado con la web */
  emptyContainer: {
    alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[10], paddingHorizontal: spacing[6], gap: spacing[2],
  },
  emptyIconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colorScales.gray[100],
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing[2],
  },
  emptyTitle: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900], textAlign: 'center' },
  emptyDesc: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], textAlign: 'center', lineHeight: 20, marginBottom: spacing[3] },
  emptyCreateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[5], paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  emptyCreateText: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.background },

  /* Empty cuando hay búsqueda sin resultados */
  emptySearch: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[8], gap: spacing[2] },
  emptySearchText: { fontSize: typography.fontSize.sm, color: colorScales.gray[500] },

  /* Transfer card: mismo estilo que AdjustmentCard (blanco, borderRadius.lg, gray[200], padding spacing[4]) */
  transferCard: {
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    padding: spacing[4],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[2] },
  cardHeaderLeft: { flex: 1 },
  cardTitle: { fontSize: typography.fontSize.base, fontWeight: '600' as any, color: colorScales.gray[900] },
  cardSubtitle: { fontSize: typography.fontSize.sm, color: colorScales.gray[500], marginTop: 2 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[3], paddingTop: spacing[3], borderTopWidth: 1, borderTopColor: colorScales.gray[100] },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  footerDetail: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  footerDate: { fontSize: typography.fontSize.xs, color: colorScales.gray[400] },
  listContent: { paddingBottom: spacing[6] },

  /* Dropdowns posicionados (acciones + y filtro) */
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
  dropdownTitle: { fontSize: 11, fontWeight: '700' as any, color: colorScales.gray[500], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3], letterSpacing: 0.5, textTransform: 'uppercase' as any },
  dropdownDivider: { height: 1, backgroundColor: colorScales.gray[100] },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3] },
  dropdownIconWrap: { width: 28, height: 28, borderRadius: 6, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  dropdownItemText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownItemPrimary: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.primary },
  dropdownFilterOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[2.5], paddingHorizontal: spacing[3] },
  dropdownFilterOptionActive: { backgroundColor: colorScales.green[50] },
  dropdownFilterOptionText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownFilterOptionTextActive: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.primary },

  /* Modal de creación (bottom sheet) */
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { backgroundColor: colors.background, borderTopLeftRadius: borderRadius['2xl'], borderTopRightRadius: borderRadius['2xl'], maxHeight: '85%', paddingBottom: spacing[6] },
  modalHandleWrap: { width: '100%', alignItems: 'center', paddingTop: spacing[2], paddingBottom: spacing[4] },
  modalHandle: { width: 40, height: 4, backgroundColor: colorScales.gray[300], borderRadius: borderRadius.full },
  modalScroll: { paddingHorizontal: spacing[4] },
  modalTitle: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900], marginBottom: spacing[4] },
  formGroup: { marginBottom: spacing[4] },
  formLabel: { fontSize: typography.fontSize.xs, fontWeight: '600' as any, color: colorScales.gray[500], marginBottom: spacing[2], textTransform: 'uppercase' as any, letterSpacing: 1 },
  addProductBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[3], borderWidth: 1, borderStyle: 'dashed', borderColor: colorScales.gray[300], borderRadius: borderRadius.lg, marginBottom: spacing[3] },
  addProductText: { fontSize: typography.fontSize.sm, color: colors.primary, fontWeight: '500' as any },
  productRow: { gap: spacing[2], marginBottom: spacing[3] },
  modalActions: { flexDirection: 'row', marginTop: spacing[4] },
  actionSpacer: { width: spacing[3] },

  /* Filtro: modal popup con estilo web (Filtros + Estado + dropdown) */
  filterPopup: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: 200,
    ...shadows.lg,
    overflow: 'hidden',
  },
  filterPopupHeader: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[2] },
  filterPopupTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  filterPopupBody: { paddingHorizontal: spacing[4], paddingBottom: spacing[3], gap: spacing[2] },
  filterPopupLabel: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[700] },
  filterPopupSelect: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing[2.5], paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg, borderWidth: 1.5, borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  filterPopupSelectText: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[800] },
  filterPopupOptionsList: { marginTop: spacing[1], borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, backgroundColor: colors.background, overflow: 'hidden' },
  filterPopupOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[2.5], paddingHorizontal: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  filterPopupOptionActive: { backgroundColor: colorScales.green[50] },
  filterPopupOptionText: { fontSize: typography.fontSize.sm, color: colorScales.gray[700] },
  filterPopupOptionTextActive: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.primary },

  /* Modal wizard: Nueva Transferencia — 3 pasos (como la web) */
  createModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  createModal: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    width: '100%', maxWidth: 520, maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  createHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[3] },
  createTitle: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900] },
  createSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },

  /* Stepper (3 círculos conectados por líneas) */
  stepsRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colorScales.gray[50], borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  stepItem: { alignItems: 'center', gap: 4, width: 80 },
  stepCircle: { width: 28, height: 28, borderRadius: 14, backgroundColor: colorScales.gray[200], alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colorScales.gray[200] },
  stepCircleActive: { backgroundColor: colors.background, borderColor: colors.primary },
  stepNum: { fontSize: 12, fontWeight: '700' as any, color: colorScales.gray[500] },
  stepNumActive: { color: colors.primary },
  stepLabel: { fontSize: 10, fontWeight: '600' as any, color: colorScales.gray[500], letterSpacing: 0.5, textAlign: 'center' },
  stepLabelActive: { color: colors.primary },
  stepLine: { flex: 1, height: 2, backgroundColor: colorScales.gray[200], marginTop: 13, marginHorizontal: 4 },
  stepLineDone: { backgroundColor: colors.primary },

  /* Body del wizard */
  createBody: { flexGrow: 0, flexShrink: 1, maxHeight: 360 },
  createBodyContent: { padding: spacing[4], gap: spacing[3] },
  createStepContent: { gap: spacing[3] },

  /* Inputs del wizard (selects nativos con icono) */
  locationDropdownTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingVertical: spacing[3], paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colors.background,
  },
  locationDropdownText: { flex: 1, fontSize: 14, fontWeight: '500' as any, color: colorScales.gray[900] },
  locationDropdownPlaceholder: { color: colorScales.gray[400], fontWeight: '400' as any },
  locationDropdownTextSelected: { fontWeight: '600' as any, color: colors.primary },
  locationDropdownList: { marginTop: 4, borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, backgroundColor: colors.background, overflow: 'hidden' },
  locationDropdownOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[3], paddingHorizontal: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  locationDropdownOptionActive: { backgroundColor: colorScales.green[50] },
  locationDropdownOptionText: { fontSize: 14, color: colorScales.gray[700] },
  locationDropdownOptionTextActive: { fontWeight: '600' as any, color: colors.primary },
  locationDropdownLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: spacing[4] },
  locationDropdownLoadingText: { fontSize: 12, color: colorScales.gray[500] },
  required: { color: colors.error },
  dateInput: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3], paddingVertical: spacing[3], backgroundColor: colors.background },
  dateValue: { fontSize: 14, color: colorScales.gray[900] },
  datePlaceholder: { color: colorScales.gray[400] },
  textArea: { borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3], paddingVertical: spacing[3], fontSize: 14, color: colorScales.gray[900], backgroundColor: colors.background, minHeight: 80, textAlignVertical: 'top' },

  /* Step 2: location summary + product search */
  locationSummaryCard: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colorScales.gray[50] },
  locationSummaryName: { flex: 1, fontSize: 13, fontWeight: '600' as any, color: colorScales.gray[900] },
  locationChangeLink: { fontSize: 12, fontWeight: '600' as any, color: colors.primary, textDecorationLine: 'underline' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, paddingHorizontal: spacing[2.5], paddingVertical: spacing[2], backgroundColor: colors.background },
  searchInputWizard: { flex: 1, fontSize: 13, color: colorScales.gray[900], padding: 0 },
  searchResults: { marginTop: 6, borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, maxHeight: 180, backgroundColor: colors.background },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[2], paddingHorizontal: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100], gap: spacing[2] },
  searchResultName: { fontSize: 12, fontWeight: '500' as any, color: colorScales.gray[900] },
  searchResultSku: { fontSize: 10, color: colorScales.gray[500], marginTop: 2 },
  searchResultStock: { fontSize: 11, fontWeight: '600' as any, color: colorScales.gray[700] },
  selectedProductCard: { backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200], padding: spacing[2.5], gap: 4 },
  selectedProductHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  selectedProductName: { flex: 1, fontSize: 13, fontWeight: '700' as any, color: colorScales.gray[900] },
  qtyRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[3] },
  qtyLabel: { fontSize: 11, fontWeight: '600' as any, color: colorScales.gray[500], marginBottom: 4, textTransform: 'uppercase' as any },
  qtyInput: { borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, paddingHorizontal: spacing[2.5], paddingVertical: spacing[2], fontSize: 14, fontWeight: '600' as any, color: colorScales.gray[900], backgroundColor: colors.background, textAlign: 'center' },

  /* Step 3: location info + summary + warning */
  locationInfoCard: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], padding: spacing[3], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colorScales.gray[50] },
  locationInfoLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any },
  locationInfoName: { fontSize: 14, fontWeight: '600' as any, color: colorScales.gray[900] },
  summaryCard: { backgroundColor: colorScales.gray[50], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200], padding: spacing[3], gap: spacing[2] },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  summaryLabel: { fontSize: 12, color: colorScales.gray[500], fontWeight: '500' as any, flex: 1 },
  summaryValue: { fontSize: 13, color: colorScales.gray[900], fontWeight: '500' as any, flex: 1, textAlign: 'right' },
  summaryDivider: { height: 1, backgroundColor: colorScales.gray[200] },
  warningBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], padding: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.amber[200], backgroundColor: colorScales.amber[50] },
  warningText: { fontSize: 12, color: colorScales.amber[800], flex: 1 },

  /* Footer del wizard (Cancelar + Continuar) */
  createFooter: { flexDirection: 'row', paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[4], borderTopWidth: 1, borderTopColor: colorScales.gray[200], backgroundColor: colorScales.gray[50] },
  cancelBtnWizard: { flex: 1, paddingVertical: 12, borderRadius: borderRadius.lg, borderWidth: 1.5, borderColor: colorScales.red[500], alignItems: 'center', justifyContent: 'center' },
  cancelBtnWizardText: { fontSize: 14, fontWeight: '600' as any, color: colorScales.red[600] },
  continueBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: borderRadius.lg, backgroundColor: colors.primary, shadowColor: colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  continueBtnDisabled: { backgroundColor: colorScales.gray[200], shadowOpacity: 0, elevation: 0 },
  continueBtnText: { fontSize: 14, fontWeight: '700' as any, color: colors.background },
});
