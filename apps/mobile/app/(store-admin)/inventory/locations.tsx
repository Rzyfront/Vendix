import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, RefreshControl, Pressable, Modal, ScrollView, StyleSheet, TextInput, Dimensions,
} from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { InventoryService } from '@/features/store/services/inventory.service';
import { getNextPageParam } from '@/core/api/pagination';
import type { CreateLocationDto, UpdateLocationDto } from '@/features/store/services/inventory.service';
import { LOCATION_TYPE_LABELS } from '@/features/store/types';
import type { Location, LocationType } from '@/features/store/types';
import { useTenantStore } from '@/core/store/tenant.store';
import { Icon } from '@/shared/components/icon/icon';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

const TYPE_VARIANT: Record<LocationType, 'info' | 'warning' | 'default'> = {
  warehouse: 'info',
  store: 'warning',
  virtual: 'default',
};

const TYPE_ICON: Record<LocationType, string> = {
  warehouse: 'warehouse',
  store: 'store',
  virtual: 'circle',
};

const STATE_VARIANT: Record<string, 'success' | 'default'> = {
  active: 'success',
  inactive: 'default',
};

const STATE_LABELS: Record<string, string> = {
  active: 'Activa',
  inactive: 'Inactiva',
};

function LocationCard({ item, onPress }: { item: Location; onPress: () => void }) {
  const isActive = item.state === 'active';
  const typeLabel = LOCATION_TYPE_LABELS[item.type] ?? item.type;
  const typeColor =
    item.type === 'warehouse'
      ? { icon: colorScales.blue[600] }
      : item.type === 'store'
      ? { icon: colorScales.amber[600] }
      : { icon: colorScales.gray[500] };

  return (
    <View style={styles.locationCard}>
      {/* Fila 1: Ícono + (nombre + código + tipo/estado) + badge de estado */}
      <View style={styles.cardTopRow}>
        {/* Ícono a la izquierda */}
        <View style={styles.cardMedia}>
          <Icon name="map-pin" size={24} color={typeColor.icon} />
        </View>

        {/* Centro: nombre + código + grid tipo/estado */}
        <View style={styles.cardCenter}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
          {item.code ? <Text style={styles.cardCode}>{item.code}</Text> : null}

          <View style={styles.cardMetaRow}>
            <View style={styles.cardMetaCol}>
              <Text style={styles.cardGridLabel}>TIPO</Text>
              <Text style={styles.cardMetaValue} numberOfLines={1}>{typeLabel}</Text>
            </View>
            <View style={styles.cardMetaCol}>
              <Text style={styles.cardGridLabel}>ESTADO</Text>
              <Text style={[styles.cardMetaValue, { color: isActive ? colorScales.green[700] : colorScales.gray[500] }]}>
                {isActive ? 'Activo' : 'Inactivo'}
              </Text>
            </View>
          </View>
        </View>

        {/* Badge de estado arriba a la derecha */}
        <View style={[styles.cardStatusBadge, { backgroundColor: isActive ? colorScales.green[50] : colorScales.gray[100] }]}>
          <Text style={[styles.cardStatusBadgeText, { color: isActive ? colorScales.green[700] : colorScales.gray[500] }]}>
            {isActive ? 'Activo' : 'Inactivo'}
          </Text>
        </View>
      </View>

      {/* Fila 2 (footer): TIPO grande + acciones */}
      <View style={styles.cardFooter}>
        <View style={styles.cardFooterLeft}>
          <Text style={styles.cardGridLabel}>TIPO</Text>
          <Text style={styles.cardFooterValue}>{typeLabel}</Text>
        </View>
        <View style={styles.cardActions}>
          <Pressable onPress={onPress} hitSlop={6} style={styles.cardActionBtn}>
            <Icon name="edit-2" size={16} color={colors.primary} />
          </Pressable>
          <Pressable onPress={onPress} hitSlop={6} style={styles.cardActionBtn}>
            <Icon name="more-horizontal" size={16} color={colorScales.gray[500]} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const emptyForm: CreateLocationDto & { is_active?: boolean; is_principal?: boolean } = {
  name: '', code: '', type: 'warehouse', address: '', is_active: true, is_principal: false,
};

type AddressFields = {
  address_line1?: string;
  address_line2?: string;
  country?: string;
  state?: string;
  city?: string;
  postal_code?: string;
};

// Lista de países alineada con la web (apps/frontend/src/app/services/country.service.ts)
const COUNTRIES: { code: string; name: string }[] = [
  { code: 'CO', name: 'Colombia' },
  { code: 'MX', name: 'México' },
  { code: 'US', name: 'Estados Unidos' },
  { code: 'DO', name: 'República Dominicana' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'PA', name: 'Panamá' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'PE', name: 'Perú' },
  { code: 'ES', name: 'España' },
];

export default function LocationsScreen() {
  const queryClient = useQueryClient();
  const currentStoreId = useTenantStore((s) => s.storeId);
  const [search, setSearch] = useState('');
  const [showActions, setShowActions] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showFilterTypeList, setShowFilterTypeList] = useState(false);
  const actionsBtnRef = useRef<View>(null);
  const filterBtnRef = useRef<View>(null);
  const [actionsPos, setActionsPos] = useState({ top: 0, right: 0 });
  const [filterPos, setFilterPos] = useState({ top: 0, right: 0 });
  const screenW = Dimensions.get('window').width;

  const [activeFilter, setActiveFilter] = useState<LocationType | 'all'>('all');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateLocationDto & { is_active?: boolean; is_principal?: boolean }>({ ...emptyForm });
  const [addressFields, setAddressFields] = useState<AddressFields>({
    address_line1: '', address_line2: '', country: '', state: '', city: '', postal_code: '',
  });
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [showAddress, setShowAddress] = useState(false);

  const FILTER_OPTIONS: { label: string; value: LocationType | 'all' }[] = [
    { label: 'Todos los tipos', value: 'all' },
    { label: LOCATION_TYPE_LABELS.warehouse, value: 'warehouse' },
    { label: LOCATION_TYPE_LABELS.store, value: 'store' },
    { label: LOCATION_TYPE_LABELS.virtual, value: 'virtual' },
  ];

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch, isRefetching } = useInfiniteQuery({
    queryKey: ['locations', search],
    queryFn: ({ pageParam = 1 }) =>
      InventoryService.getLocations({
        page: pageParam,
        limit: 20,
        search: search || undefined,
      }),
    getNextPageParam,
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
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al crear la ubicación';
      toastError(typeof message === 'string' ? message : 'Error al crear la ubicación');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateLocationDto }) => InventoryService.updateLocation(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locations'] });
      closeModal();
      toastSuccess('Ubicación actualizada correctamente');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al actualizar la ubicación';
      toastError(typeof message === 'string' ? message : 'Error al actualizar la ubicación');
    },
  });

  const allLocations = data?.pages.flatMap((p) => p.data) ?? [];

  // Filtro client-side por tipo (la LocationQuery no soporta type en este momento)
  const locations = activeFilter === 'all'
    ? allLocations
    : allLocations.filter((l) => l.type === activeFilter);

  const totals = {
    total: allLocations.length,
    warehouse: allLocations.filter((l) => l.type === 'warehouse').length,
    store: allLocations.filter((l) => l.type === 'store').length,
    virtual: allLocations.filter((l) => l.type === 'virtual').length,
  };

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
      is_active: location.state === 'active',
      is_principal: false,
    });
    setModalVisible(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.code?.trim()) {
      toastError('Nombre y código son obligatorios');
      return;
    }
    // Solo enviar campos que el DTO espera (filtrar is_active / is_principal)
    const dto: CreateLocationDto = {
      name: form.name.trim(),
      code: form.code.trim(),
      type: form.type,
      address: (form.address ?? '').trim() || undefined,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, dto });
    } else {
      createMutation.mutate(dto);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isFormValid = !!(form.name.trim() && form.code?.trim());

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
      setShowFilterTypeList(false);
    });
  }, [screenW]);

  return (
    <View style={styles.screen}>
      {/* Stats: ancho completo de la pantalla (fuera del card) — alineado con la web */}
      <StatsGrid
        style={styles.statsWrap}
        items={[
          {
            label: 'Total',
            value: totals.total,
            icon: <Icon name="warehouse" size={14} color={colorScales.blue[600]} />,
            description: 'Ubicaciones',
          },
          {
            label: LOCATION_TYPE_LABELS.warehouse,
            value: totals.warehouse,
            icon: <Icon name="warehouse" size={14} color={colorScales.blue[600]} />,
            description: 'Almacenes',
          },
          {
            label: LOCATION_TYPE_LABELS.store,
            value: totals.store,
            icon: <Icon name="store" size={14} color={colorScales.amber[600]} />,
            description: 'Tiendas',
          },
          {
            label: LOCATION_TYPE_LABELS.virtual,
            value: totals.virtual,
            icon: <Icon name="circle" size={14} color={colorScales.blue[400]} />,
            description: 'Virtuales',
          },
        ]}
      />

      {/* Card contenedor: título + búsqueda + filtros + cards de ubicaciones */}
      <View style={styles.cardContainer}>
        <FlatList
          data={locations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <LocationCard item={item} onPress={() => handleEdit(item)} />}
          ListHeaderComponent={
            <View>
              <View style={styles.titleRow}>
                <Text style={styles.listTitle}>Ubicaciones ({locations.length})</Text>
              </View>
              <View style={styles.searchRow}>
                <View style={styles.searchInputWrap}>
                  <Ionicons name="search-outline" size={16} color={colorScales.gray[400]} style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInputField}
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Buscar ubicación..."
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
            ) : (
              <EmptyState title="Sin ubicaciones" description="No se encontraron ubicaciones" />
            )
          }
          ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          contentContainerStyle={styles.listContent}
        />
      </View>

      {/* Dropdown de acciones (Refrescar + Nueva Ubicación) */}
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
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); setEditingId(null); setForm({ ...emptyForm }); setModalVisible(true); }}>
              <View style={styles.dropdownIconWrap}>
                <Ionicons name="add-outline" size={18} color={colors.primary} />
              </View>
              <Text style={styles.dropdownItemPrimary}>Nueva Ubicación</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Dropdown de filtro por tipo — estilo web (popup con Filtros + Tipo + dropdown) */}
      <Modal visible={showFilters} transparent animationType="fade" onRequestClose={() => { setShowFilters(false); setShowFilterTypeList(false); }}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => { setShowFilters(false); setShowFilterTypeList(false); }} />
        <View style={[styles.dropdownPositioner, { top: filterPos.top, right: filterPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: Math.max(filterPos.right, 14) }]} />
          <View style={styles.filterPopup}>
            <View style={styles.filterPopupHeader}>
              <Text style={styles.filterPopupTitle}>Filtros</Text>
            </View>
            <View style={styles.filterPopupBody}>
              <Text style={styles.filterPopupLabel}>Tipo</Text>
              <Pressable
                style={styles.filterPopupSelect}
                onPress={() => setShowFilterTypeList(!showFilterTypeList)}
              >
                <Text style={styles.filterPopupSelectText}>
                  {FILTER_OPTIONS.find((o) => o.value === activeFilter)?.label ?? 'Todos los tipos'}
                </Text>
                <Ionicons name={showFilterTypeList ? 'chevron-up' : 'chevron-down'} size={16} color={colorScales.gray[500]} />
              </Pressable>
              {showFilterTypeList && (
                <View style={styles.filterPopupOptionsList}>
                  {FILTER_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.value}
                      style={[styles.filterPopupOption, activeFilter === opt.value && styles.filterPopupOptionActive]}
                      onPress={() => { setActiveFilter(opt.value); setShowFilters(false); setShowFilterTypeList(false); }}
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

      {/* Modal de creación / edición (estilo web: centrado, con header + form sin iconos + footer Cancelar/Crear) */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.createModalOverlay}>
          <View style={styles.createModal}>
            {/* Header: título + subtítulo + botón cerrar (sin ícono) */}
            <View style={styles.createHeader}>
              <View style={styles.createHeaderText}>
                <Text style={styles.createTitle}>
                  {editingId ? 'Editar Ubicación' : 'Nueva Ubicación'}
                </Text>
                <Text style={styles.createSubtitle}>
                  {editingId ? 'Modifica los datos de la ubicación' : 'Crea una nueva ubicación para tu tienda'}
                </Text>
              </View>
              <Pressable onPress={closeModal} hitSlop={8} style={styles.createCloseBtn}>
                <Ionicons name="close" size={22} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            <ScrollView style={styles.createBody} contentContainerStyle={styles.createBodyContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Nombre */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Nombre <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.inputField}
                  value={form.name}
                  onChangeText={(t) => setForm({ ...form, name: t })}
                  placeholder="Ej: Almacén Principal"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>

              {/* Código */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Código <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.inputField}
                  value={form.code ?? ''}
                  onChangeText={(t) => setForm({ ...form, code: t })}
                  placeholder="Ej: ALM-01"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>

              {/* Tipo — dropdown selector (estilo web) */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Tipo de ubicación <Text style={styles.required}>*</Text></Text>
                <Pressable
                  style={styles.typeDropdownTrigger}
                  onPress={() => setShowTypeDropdown(!showTypeDropdown)}
                >
                  <Text style={styles.typeDropdownText}>
                    {form.type === 'warehouse' ? 'Almacén / Bodega' : form.type === 'store' ? 'Tienda / Local' : 'Virtual'}
                  </Text>
                  <Ionicons
                    name={showTypeDropdown ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colorScales.gray[500]}
                    style={{ transform: showTypeDropdown ? [{ rotate: '0deg' }] : [] }}
                  />
                </Pressable>
                {showTypeDropdown && (
                  <View style={styles.typeDropdownList}>
                    {(['warehouse', 'store', 'virtual'] as LocationType[]).map((t) => (
                      <Pressable
                        key={t}
                        style={[styles.typeDropdownOption, form.type === t && styles.typeDropdownOptionActive]}
                        onPress={() => { setForm({ ...form, type: t }); setShowTypeDropdown(false); }}
                      >
                        <Text style={[styles.typeDropdownOptionText, form.type === t && styles.typeDropdownOptionTextActive]}>
                          {t === 'warehouse' ? 'Almacén / Bodega' : t === 'store' ? 'Tienda / Local' : 'Virtual'}
                        </Text>
                        {form.type === t && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>

              {/* Ubicación activa — toggle con pestillo */}
              <Pressable
                style={styles.toggleRow}
                onPress={() => setForm({ ...form, is_active: !form.is_active })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Ubicación activa</Text>
                  <Text style={styles.toggleDesc}>Desactiva para ocultar esta ubicación</Text>
                </View>
                <View style={[styles.toggleSwitch, form.is_active && styles.toggleSwitchOn]}>
                  <View style={[styles.toggleKnob, form.is_active && styles.toggleKnobOn]} />
                </View>
              </Pressable>

              {/* Bodega principal — toggle con pestillo (mismo estilo que Ubicación activa) */}
              <Pressable
                style={styles.toggleRow}
                onPress={() => setForm({ ...form, is_principal: !form.is_principal })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Bodega principal</Text>
                  <Text style={styles.toggleDesc}>
                    Define esta ubicación como la bodega por defecto del store para ventas y operaciones.
                  </Text>
                </View>
                <View style={[styles.toggleSwitch, form.is_principal && styles.toggleSwitchOn]}>
                  <View style={[styles.toggleKnob, form.is_principal && styles.toggleKnobOn]} />
                </View>
              </Pressable>

              {/* Dirección Física — card expandible con form */}
              <Pressable style={styles.direccionCard} onPress={() => setShowAddress(!showAddress)}>
                <View style={styles.direccionCardLeft}>
                  <View style={styles.direccionIconWrap}>
                    <Ionicons name="location-outline" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.direccionTitle}>Dirección Física</Text>
                    <Text style={styles.direccionLink}>Agregar ubicación geográfica específica</Text>
                  </View>
                </View>
                <Ionicons
                  name={showAddress ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colorScales.gray[500]}
                />
              </Pressable>

              {/* Formulario de dirección (se muestra al expandir) */}
              {showAddress && (
                <View style={styles.addressForm}>
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Línea de dirección 1 <Text style={styles.required}>*</Text></Text>
                    <TextInput
                      style={styles.inputField}
                      value={addressFields.address_line1 ?? ''}
                      onChangeText={(t) => setAddressFields({ ...addressFields, address_line1: t })}
                      placeholder="Ej: Calle 123 # 45 - 67"
                      placeholderTextColor={colorScales.gray[400]}
                    />
                  </View>
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Línea de dirección 2</Text>
                    <TextInput
                      style={styles.inputField}
                      value={addressFields.address_line2 ?? ''}
                      onChangeText={(t) => setAddressFields({ ...addressFields, address_line2: t })}
                      placeholder="Ej: Bodega 4 o Apt 101"
                      placeholderTextColor={colorScales.gray[400]}
                    />
                  </View>
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>País <Text style={styles.required}>*</Text></Text>
                    <Pressable
                      style={styles.typeDropdownTrigger}
                      onPress={() => setShowCountryDropdown(!showCountryDropdown)}
                    >
                      <Text style={styles.typeDropdownText}>
                        {COUNTRIES.find((c) => c.code === addressFields.country)?.name ?? 'Seleccionar país'}
                      </Text>
                      <Ionicons
                        name={showCountryDropdown ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={colorScales.gray[500]}
                      />
                    </Pressable>
                    {showCountryDropdown && (
                      <View style={styles.typeDropdownList}>
                        {COUNTRIES.map((c) => (
                          <Pressable
                            key={c.code}
                            style={[styles.typeDropdownOption, addressFields.country === c.code && styles.typeDropdownOptionActive]}
                            onPress={() => { setAddressFields({ ...addressFields, country: c.code }); setShowCountryDropdown(false); }}
                          >
                            <Text style={[styles.typeDropdownOptionText, addressFields.country === c.code && styles.typeDropdownOptionTextActive]}>
                              {c.name}
                            </Text>
                            {addressFields.country === c.code && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Estado / Provincia <Text style={styles.required}>*</Text></Text>
                    <TextInput
                      style={styles.inputField}
                      value={addressFields.state ?? ''}
                      onChangeText={(t) => setAddressFields({ ...addressFields, state: t })}
                      placeholder="Ej: Cundinamarca"
                      placeholderTextColor={colorScales.gray[400]}
                    />
                  </View>
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Ciudad <Text style={styles.required}>*</Text></Text>
                    <TextInput
                      style={styles.inputField}
                      value={addressFields.city ?? ''}
                      onChangeText={(t) => setAddressFields({ ...addressFields, city: t })}
                      placeholder="Ej: Bogotá"
                      placeholderTextColor={colorScales.gray[400]}
                    />
                  </View>
                  <View style={styles.formGroup}>
                    <Text style={styles.formLabel}>Código postal <Text style={styles.required}>*</Text></Text>
                    <TextInput
                      style={styles.inputField}
                      value={addressFields.postal_code ?? ''}
                      onChangeText={(t) => setAddressFields({ ...addressFields, postal_code: t })}
                      placeholder="Ej: 110111"
                      placeholderTextColor={colorScales.gray[400]}
                    />
                  </View>
                </View>
              )}
            </ScrollView>

            {/* Footer: Cancelar (outline rojo) + Crear/Actualizar (primary verde) */}
            <View style={styles.createFooter}>
              <Pressable style={styles.cancelBtn} onPress={closeModal}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </Pressable>
              <View style={styles.actionSpacer} />
              <Pressable
                style={[styles.confirmBtn, (!isFormValid || isSubmitting) && styles.confirmBtnDisabled]}
                onPress={handleSubmit}
                disabled={!isFormValid || isSubmitting}
              >
                {isSubmitting ? (
                  <Text style={styles.confirmBtnText}>Guardando...</Text>
                ) : (
                  <Text style={styles.confirmBtnText}>{editingId ? 'Actualizar' : 'Crear'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colorScales.gray[50] },
  /* Card contenedor — mismo estilo que adjustments/transfers/movements */
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
  titleRow: { paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[2] },
  listTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
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
  separator: { height: spacing[3] },
  listContent: { paddingBottom: spacing[6] },

  /* Location card — estilo web: ícono + nombre/código + meta + footer con acciones */
  locationCard: {
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], padding: spacing[4], paddingBottom: spacing[2] },
  cardMedia: {
    width: 56, height: 56, borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colorScales.gray[200],
  },
  cardCenter: { flex: 1, gap: 2 },
  cardTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  cardCode: { fontSize: 11, color: colorScales.gray[500], marginBottom: 4 },
  cardMetaRow: { flexDirection: 'row', gap: spacing[3], marginTop: 4 },
  cardMetaCol: { flex: 1, gap: 1 },
  cardMetaValue: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[900] },
  cardStatusBadge: {
    paddingHorizontal: spacing[2.5], paddingVertical: 3, borderRadius: borderRadius.full,
    backgroundColor: colorScales.gray[100], alignSelf: 'flex-start',
  },
  cardStatusBadgeText: { fontSize: 10, fontWeight: '700' as any, textTransform: 'uppercase' as any, letterSpacing: 0.3 },
  cardGrid: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[3] },
  cardGridItem: { flex: 1, gap: 2 },
  cardGridLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  cardGridValue: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[900] },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    borderTopWidth: 1, borderTopColor: colorScales.gray[100],
    backgroundColor: colorScales.gray[50],
  },
  cardFooterLeft: { gap: 2 },
  cardFooterLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  cardFooterValue: { fontSize: typography.fontSize.lg, fontWeight: '800' as any, color: colorScales.gray[900] },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  cardActionBtn: { width: 36, height: 36, borderRadius: borderRadius.md, backgroundColor: colorScales.green[100], alignItems: 'center', justifyContent: 'center' },

  /* Dropdown de acciones */
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
  dropdownDivider: { height: 1, backgroundColor: colorScales.gray[100] },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3] },
  dropdownIconWrap: { width: 28, height: 28, borderRadius: 6, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  dropdownItemText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownItemPrimary: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.primary },

  /* Filter popup (estilo web) */
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

  /* Modal wizard estilo web — Nueva/Editar Ubicación */
  createModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  createModal: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    width: '100%', maxWidth: 520, maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  createHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  createHeaderText: { flex: 1 },
  createTitle: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900] },
  createSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
  createCloseBtn: { padding: spacing[1] },
  createBody: { flexGrow: 0, flexShrink: 1, maxHeight: 480 },
  createBodyContent: { padding: spacing[4], gap: spacing[3] },
  /* Inputs sin iconos (estilo web) */
  inputField: {
    borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2.5], fontSize: 14, color: colorScales.gray[900], backgroundColor: colors.background,
  },
  textArea: { minHeight: 60, textAlignVertical: 'top' as any },
  required: { color: colors.error },
  formGroup: { marginBottom: spacing[2] },
  formLabel: { fontSize: typography.fontSize.xs, fontWeight: '600' as any, color: colorScales.gray[500], marginBottom: spacing[2], textTransform: 'uppercase' as any, letterSpacing: 1 },
  typeRow: { flexDirection: 'row', gap: spacing[2] },
  typeChip: { paddingHorizontal: spacing[3], paddingVertical: 8, borderRadius: borderRadius.full },
  typeChipActive: { backgroundColor: colors.primary },
  typeChipInactive: { backgroundColor: colorScales.gray[200] },
  chipText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any },
  chipTextActive: { color: colors.background },
  chipTextInactive: { color: colorScales.gray[600] },
  /* Footer: Cancelar (oscuro) + Crear (primary verde) — estilo web */
  createFooter: { flexDirection: 'row', paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[4], borderTopWidth: 1, borderTopColor: colorScales.gray[200], backgroundColor: colors.background, gap: spacing[2] },
  cancelBtn: { flex: 1, paddingVertical: 10, borderRadius: borderRadius.full, backgroundColor: colorScales.gray[900], alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 13, fontWeight: '700' as any, color: colors.background },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: borderRadius.full, backgroundColor: colorScales.green[100], alignItems: 'center', justifyContent: 'center' },
  confirmBtnDisabled: { backgroundColor: colorScales.gray[100] },
  confirmBtnText: { fontSize: 13, fontWeight: '700' as any, color: colorScales.green[800] },
  actionSpacer: { width: spacing[3] },

  /* Dropdown selector para Tipo */
  typeDropdownTrigger: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing[3], paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg, borderWidth: 1.5, borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  typeDropdownText: { flex: 1, fontSize: 14, fontWeight: '500' as any, color: colorScales.gray[900] },
  typeDropdownList: { marginTop: 4, borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, backgroundColor: colors.background, overflow: 'hidden' },
  typeDropdownOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[3], paddingHorizontal: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  typeDropdownOptionActive: { backgroundColor: colorScales.green[50] },
  typeDropdownOptionText: { fontSize: 14, color: colorScales.gray[700] },
  typeDropdownOptionTextActive: { fontWeight: '600' as any, color: colors.primary },

  /* Toggle switch (estilo iOS) */
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3], paddingVertical: spacing[2] },
  toggleLabel: { fontSize: 14, fontWeight: '700' as any, color: colorScales.gray[900] },
  toggleDesc: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },
  toggleSwitch: { width: 44, height: 26, borderRadius: 13, backgroundColor: colorScales.gray[300], padding: 2, justifyContent: 'center' },
  toggleSwitchOn: { backgroundColor: colors.primary },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.background, ...shadows.sm, alignItems: 'center', justifyContent: 'center' },
  toggleKnobOn: { transform: [{ translateX: 18 }] },

  /* Dirección Física — card expandible */
  direccionCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing[3], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200], backgroundColor: colors.background },
  direccionCardLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 },
  direccionIconWrap: { width: 36, height: 36, borderRadius: borderRadius.md, backgroundColor: colorScales.green[50], borderWidth: 1, borderColor: colorScales.green[100], alignItems: 'center', justifyContent: 'center' },
  direccionTitle: { fontSize: 14, fontWeight: '700' as any, color: colorScales.gray[900] },
  direccionLink: { fontSize: 12, color: colors.primary, marginTop: 2 },

  /* Formulario de dirección (contenedor con borde) */
  addressForm: { borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, padding: spacing[3], gap: spacing[2], backgroundColor: colors.background },
});
