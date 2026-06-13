import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, RefreshControl, Pressable, Modal, ScrollView, StyleSheet, TextInput, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { InventoryService } from '@/features/store/services/inventory.service';
import { getNextPageParam } from '@/core/api/pagination';
import type { CreateSupplierDto, UpdateSupplierDto } from '@/features/store/services/inventory.service';
import type { Supplier } from '@/features/store/types';
import { useTenantStore } from '@/core/store/tenant.store';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

const STATE_LABELS = {
  true: 'Activo',
  false: 'Inactivo',
} as const;

function SupplierCard({
  item,
  onPress,
  onDelete,
}: {
  item: Supplier;
  onPress: () => void;
  onDelete: (item: Supplier) => void;
}) {
  const isActive = !!item.is_active;

  return (
    <View style={styles.supplierCard}>
      {/* Fila 1: Ícono building-2 + (nombre + contacto + email/código) + badge estado */}
      <View style={styles.cardTopRow}>
        <View style={styles.cardMedia}>
          <Icon name="building-2" size={24} color={colorScales.gray[500]} />
        </View>

        <View style={styles.cardCenter}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
          {item.contact_person ? (
            <Text style={styles.cardSubtitle} numberOfLines={1}>{item.contact_person}</Text>
          ) : null}

          <View style={styles.cardMetaRow}>
            <View style={styles.cardMetaItem}>
              <Icon name="hash" size={12} color={colorScales.gray[400]} />
              <Text style={styles.cardMetaValue} numberOfLines={1}>{item.code || '—'}</Text>
            </View>
            <View style={styles.cardMetaItem}>
              <Icon name="mail" size={12} color={colorScales.gray[400]} />
              <Text style={styles.cardMetaValue} numberOfLines={1}>{item.email || '—'}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.cardStatusBadge, { backgroundColor: isActive ? colorScales.green[50] : colorScales.gray[100] }]}>
          <Text style={[styles.cardStatusBadgeText, { color: isActive ? colorScales.green[700] : colorScales.gray[500] }]}>
            {isActive ? 'Activo' : 'Inactivo'}
          </Text>
        </View>
      </View>

      {/* Fila 2 (footer): TELÉFONO + 2 botones directos (editar azul, eliminar rojo) */}
      <View style={styles.cardFooter}>
        <View style={styles.cardFooterLeft}>
          <View style={styles.cardFooterItem}>
            <Icon name="phone" size={12} color={colorScales.gray[400]} />
            <Text style={styles.cardFooterValue} numberOfLines={1}>{item.phone || '—'}</Text>
          </View>
        </View>
        <View style={styles.cardActions}>
          {/* Botón 1: edit (azul) */}
          <Pressable onPress={onPress} hitSlop={6} style={styles.cardActionEdit}>
            <Icon name="edit" size={16} color={colorScales.blue[600]} />
          </Pressable>
          {/* Botón 2: trash-2 (rojo) — elimina directamente */}
          <Pressable onPress={() => onDelete(item)} hitSlop={6} style={styles.cardActionDelete}>
            <Icon name="trash-2" size={16} color={colorScales.red[600]} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const emptyForm: CreateSupplierDto & { is_active?: boolean } = {
  name: '', code: '', contact_person: '', email: '', phone: '', mobile: '',
  website: '', tax_id: '', payment_terms: '', currency: 'COP', lead_time_days: null,
  notes: '', address: '', is_active: true,
};

export default function SuppliersScreen() {
  const queryClient = useQueryClient();
  const currentStoreId = useTenantStore((s) => s.storeId);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showActions, setShowActions] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showFilterStateList, setShowFilterStateList] = useState(false);
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const actionsBtnRef = useRef<View>(null);
  const filterBtnRef = useRef<View>(null);
  const [actionsPos, setActionsPos] = useState({ top: 0, right: 0 });
  const [filterPos, setFilterPos] = useState({ top: 0, right: 0 });
  const screenW = Dimensions.get('window').width;

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateSupplierDto & { is_active?: boolean }>({ ...emptyForm });

  const FILTER_OPTIONS: { label: string; value: 'all' | 'active' | 'inactive' }[] = [
    { label: 'Todos los estados', value: 'all' },
    { label: 'Activos', value: 'active' },
    { label: 'Inactivos', value: 'inactive' },
  ];

  const CURRENCY_OPTIONS: { code: string; label: string }[] = [
    { code: 'COP', label: 'COP - Peso Colombiano' },
    { code: 'USD', label: 'USD - Dólar Americano' },
    { code: 'EUR', label: 'EUR - Euro' },
    { code: 'MXN', label: 'MXN - Peso Mexicano' },
    { code: 'ARS', label: 'ARS - Peso Argentino' },
    { code: 'CLP', label: 'CLP - Peso Chileno' },
    { code: 'PEN', label: 'PEN - Sol Peruano' },
    { code: 'BRL', label: 'BRL - Real Brasileiro' },
  ];

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch, isRefetching } = useInfiniteQuery({
    queryKey: ['suppliers', search, activeFilter],
    queryFn: ({ pageParam = 1 }) =>
      InventoryService.getSuppliers({
        page: pageParam,
        limit: 20,
        search: search || undefined,
      }),
    getNextPageParam,
    initialPageParam: 1,
  });

  const allSuppliers: Supplier[] = data?.pages.flatMap((p) => p.data) ?? [];

  // Filtro client-side por estado (workaround si el backend no lo soporta directamente)
  const suppliers = activeFilter === 'all'
    ? allSuppliers
    : allSuppliers.filter((s) => (s.is_active ? 'active' : 'inactive') === activeFilter);

  // Totales
  const totals = {
    total: allSuppliers.length,
    active: allSuppliers.filter((s) => !!s.is_active).length,
    inactive: allSuppliers.filter((s) => !s.is_active).length,
    withEmail: allSuppliers.filter((s) => s.email).length,
  };

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRefresh = useCallback(() => {
    refetch();
    toastSuccess('Proveedores actualizados');
  }, [refetch]);

  const createMutation = useMutation({
    mutationFn: (dto: CreateSupplierDto) => InventoryService.createSupplier(dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      closeModal();
      toastSuccess('Proveedor creado correctamente');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al crear el proveedor';
      toastError(typeof message === 'string' ? message : 'Error al crear el proveedor');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateSupplierDto }) => InventoryService.updateSupplier(id, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeModal();
      toastSuccess('Proveedor actualizado correctamente');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al actualizar el proveedor';
      toastError(typeof message === 'string' ? message : 'Error al actualizar el proveedor');
    },
  });

  const toggleStateMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      InventoryService.updateSupplier(id, { is_active }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toastSuccess(vars.is_active ? 'Proveedor activado' : 'Proveedor desactivado');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al cambiar el estado';
      toastError(typeof message === 'string' ? message : 'Error al cambiar el estado');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => InventoryService.deleteSupplier(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-stats'] });
      toastSuccess('Proveedor eliminado');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al eliminar el proveedor';
      toastError(typeof message === 'string' ? message : 'Error al eliminar el proveedor');
    },
  });

  const closeModal = () => {
    setModalVisible(false);
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowCurrencyDropdown(false);
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingId(supplier.id);
    setForm({
      name: supplier.name,
      code: supplier.code,
      contact_person: supplier.contact_person,
      email: supplier.email,
      phone: supplier.phone,
      mobile: supplier.mobile,
      website: supplier.website,
      tax_id: supplier.tax_id,
      payment_terms: supplier.payment_terms,
      currency: supplier.currency || 'COP',
      lead_time_days: supplier.lead_time_days ?? null,
      notes: supplier.notes,
      address: supplier.address,
      is_active: !!supplier.is_active,
    });
    setModalVisible(true);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.code?.trim()) {
      toastError('Nombre y código son obligatorios');
      return;
    }
    const dto: CreateSupplierDto = {
      name: form.name.trim(),
      code: form.code.trim(),
      contact_person: form.contact_person?.trim() || undefined,
      email: form.email?.trim() || undefined,
      phone: form.phone?.trim() || undefined,
      mobile: form.mobile?.trim() || undefined,
      website: form.website?.trim() || undefined,
      tax_id: form.tax_id?.trim() || undefined,
      payment_terms: form.payment_terms?.trim() || undefined,
      currency: form.currency || undefined,
      lead_time_days: form.lead_time_days ?? null,
      notes: form.notes?.trim() || undefined,
      address: form.address?.trim() || undefined,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, dto });
    } else {
      createMutation.mutate(dto);
    }
  };

  const openCreateModal = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowCurrencyDropdown(false);
    setModalVisible(true);
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
      setShowFilterStateList(false);
    });
  }, [screenW]);

  const handleDelete = useCallback((item: Supplier) => {
    deleteMutation.mutate(item.id);
  }, [deleteMutation]);

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isFormValid = !!(form.name.trim() && form.code?.trim());

  return (
    <View style={styles.screen}>
      {/* Stats: ancho completo de la pantalla (fuera del card) */}
      <StatsGrid
        style={styles.statsWrap}
        items={[
          {
            label: 'Total',
            value: totals.total,
            icon: <Icon name="building" size={14} color={colorScales.blue[600]} />,
            description: 'Proveedores',
          },
          {
            label: 'Activos',
            value: totals.active,
            icon: <Icon name="check-circle" size={14} color={colorScales.green[600]} />,
            description: 'Operativos',
          },
          {
            label: 'Inactivos',
            value: totals.inactive,
            icon: <Ionicons name="ellipsis-horizontal" size={14} color={colorScales.gray[500]} />,
            description: 'Fuera de operación',
          },
          {
            label: 'Con email',
            value: totals.withEmail,
            icon: <Icon name="mail" size={14} color={colorScales.amber[600]} />,
            description: 'Registrados',
          },
        ]}
      />

      {/* Card contenedor: título + búsqueda + filtros + cards de proveedores */}
      <View style={styles.cardContainer}>
        <FlatList
          data={suppliers}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <SupplierCard
              item={item}
              onPress={() => handleEdit(item)}
              onDelete={handleDelete}
            />
          )}
          ListHeaderComponent={
            <View>
              <View style={styles.titleRow}>
                <Text style={styles.listTitle}>Proveedores ({suppliers.length})</Text>
              </View>
              <View style={styles.searchRow}>
                <View style={styles.searchInputWrap}>
                  <Ionicons name="search-outline" size={16} color={colorScales.gray[400]} style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInputField}
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Buscar proveedor..."
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
              <EmptyState title="Sin proveedores" description="No se encontraron proveedores" />
            )
          }
          ListFooterComponent={isFetchingNextPage ? <Spinner /> : null}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} />}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          contentContainerStyle={styles.listContent}
        />
      </View>

      {/* Dropdown de acciones (Refrescar + Nuevo Proveedor) — estilo web con íconos lucide */}
      <Modal visible={showActions} transparent animationType="fade" onRequestClose={() => setShowActions(false)}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setShowActions(false)} />
        <View style={[styles.dropdownPositioner, { top: actionsPos.top, right: actionsPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: 14 }]} />
          <View style={styles.dropdown}>
            <Text style={styles.dropdownTitle}>Acciones</Text>
            <View style={styles.dropdownDivider} />
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); handleRefresh(); }}>
              <View style={styles.dropdownIconWrap}>
                <Icon name="refresh" size={18} color={colorScales.gray[500]} />
              </View>
              <Text style={styles.dropdownItemText}>Refrescar</Text>
            </Pressable>
            <View style={styles.dropdownDivider} />
            <Pressable style={styles.dropdownItem} onPress={() => { setShowActions(false); openCreateModal(); }}>
              <View style={styles.dropdownIconWrap}>
                <Icon name="plus" size={18} color={colors.primary} />
              </View>
              <Text style={styles.dropdownItemPrimary}>Nuevo Proveedor</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Dropdown de filtro por estado (popup con Filtros + Estado + lista desplegable) */}
      <Modal visible={showFilters} transparent animationType="fade" onRequestClose={() => { setShowFilters(false); setShowFilterStateList(false); }}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => { setShowFilters(false); setShowFilterStateList(false); }} />
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
                onPress={() => setShowFilterStateList(!showFilterStateList)}
              >
                <Text style={styles.filterPopupSelectText}>
                  {FILTER_OPTIONS.find((o) => o.value === activeFilter)?.label ?? 'Todos los estados'}
                </Text>
                <Ionicons name={showFilterStateList ? 'chevron-up' : 'chevron-down'} size={16} color={colorScales.gray[500]} />
              </Pressable>
              {showFilterStateList && (
                <View style={styles.filterPopupOptionsList}>
                  {FILTER_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt.value}
                      style={[styles.filterPopupOption, activeFilter === opt.value && styles.filterPopupOptionActive]}
                      onPress={() => { setActiveFilter(opt.value); setShowFilters(false); setShowFilterStateList(false); }}
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

      {/* Modal de creación / edición (estilo web) */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.createModalOverlay}>
          <View style={styles.createModal}>
            <View style={styles.createHeader}>
              <View style={styles.createHeaderText}>
                <Text style={styles.createTitle}>
                  {editingId ? 'Editar Proveedor' : 'Nuevo Proveedor'}
                </Text>
                <Text style={styles.createSubtitle}>
                  {editingId ? 'Modifica los datos del proveedor' : 'Agrega un nuevo proveedor a tu tienda'}
                </Text>
              </View>
              <Pressable onPress={closeModal} hitSlop={8} style={styles.createCloseBtn}>
                <Ionicons name="close" size={22} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            <ScrollView style={styles.createBody} contentContainerStyle={styles.createBodyContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* ── Sección: Identificación ── */}
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Código <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.inputField}
                  value={form.code ?? ''}
                  onChangeText={(t) => setForm({ ...form, code: t })}
                  placeholder="Ej: PROV-001"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Nombre <Text style={styles.required}>*</Text></Text>
                <TextInput
                  style={styles.inputField}
                  value={form.name}
                  onChangeText={(t) => setForm({ ...form, name: t })}
                  placeholder="Nombre del proveedor"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Persona de Contacto</Text>
                <TextInput
                  style={styles.inputField}
                  value={form.contact_person ?? ''}
                  onChangeText={(t) => setForm({ ...form, contact_person: t })}
                  placeholder="Nombre del contacto"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Email</Text>
                <TextInput
                  style={styles.inputField}
                  value={form.email ?? ''}
                  onChangeText={(t) => setForm({ ...form, email: t })}
                  placeholder="email@ejemplo.com"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Teléfono</Text>
                <TextInput
                  style={styles.inputField}
                  value={form.phone ?? ''}
                  onChangeText={(t) => setForm({ ...form, phone: t })}
                  placeholder="+1 234 567 890"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="phone-pad"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Móvil</Text>
                <TextInput
                  style={styles.inputField}
                  value={form.mobile ?? ''}
                  onChangeText={(t) => setForm({ ...form, mobile: t })}
                  placeholder="+1 234 567 890"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="phone-pad"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Sitio Web</Text>
                <TextInput
                  style={styles.inputField}
                  value={form.website ?? ''}
                  onChangeText={(t) => setForm({ ...form, website: t })}
                  placeholder="https://ejemplo.com"
                  placeholderTextColor={colorScales.gray[400]}
                  autoCapitalize="none"
                  keyboardType="url"
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>ID Fiscal / NIT</Text>
                <TextInput
                  style={styles.inputField}
                  value={form.tax_id ?? ''}
                  onChangeText={(t) => setForm({ ...form, tax_id: t })}
                  placeholder="123-456-789"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Términos de Pago</Text>
                <TextInput
                  style={styles.inputField}
                  value={form.payment_terms ?? ''}
                  onChangeText={(t) => setForm({ ...form, payment_terms: t })}
                  placeholder="Ej: Net 30"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Moneda</Text>
                <Pressable
                  style={[styles.inputField, { flexDirection: 'row', alignItems: 'center' }]}
                  onPress={() => setShowCurrencyDropdown(!showCurrencyDropdown)}
                >
                  <Text style={{ flex: 1, fontSize: 14, color: colorScales.gray[900] }}>
                    {CURRENCY_OPTIONS.find((c) => c.code === form.currency)?.label || 'Seleccionar moneda'}
                  </Text>
                  <Ionicons
                    name={showCurrencyDropdown ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colorScales.gray[500]}
                  />
                </Pressable>
                {showCurrencyDropdown && (
                  <View style={styles.currencyDropdownList}>
                    {CURRENCY_OPTIONS.map((opt) => (
                      <Pressable
                        key={opt.code}
                        style={[styles.currencyDropdownOption, form.currency === opt.code && styles.currencyDropdownOptionActive]}
                        onPress={() => { setForm({ ...form, currency: opt.code }); setShowCurrencyDropdown(false); }}
                      >
                        <Text style={[styles.currencyDropdownOptionText, form.currency === opt.code && styles.currencyDropdownOptionTextActive]}>
                          {opt.label}
                        </Text>
                        {form.currency === opt.code && <Ionicons name="checkmark" size={16} color={colors.primary} />}
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Días de Entrega</Text>
                <TextInput
                  style={styles.inputField}
                  value={form.lead_time_days != null ? String(form.lead_time_days) : ''}
                  onChangeText={(t) => setForm({ ...form, lead_time_days: t ? parseInt(t) || null : null })}
                  placeholder="15"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="numeric"
                />
              </View>

              {/* Proveedor activo — toggle (estilo web) */}
              <Pressable
                style={styles.toggleRow}
                onPress={() => setForm({ ...form, is_active: !form.is_active })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Proveedor activo</Text>
                  <Text style={styles.toggleDesc}>Desactiva para ocultar este proveedor de las listas</Text>
                </View>
                <View style={[styles.toggleSwitch, form.is_active && styles.toggleSwitchOn]}>
                  <View style={[styles.toggleKnob, form.is_active && styles.toggleKnobOn]} />
                </View>
              </Pressable>
            </ScrollView>

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
                  <Text style={styles.confirmBtnText}>{editingId ? 'Guardar Cambios' : 'Crear Proveedor'}</Text>
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
  listContent: { paddingBottom: spacing[6] },

  /* Supplier card — estilo web */
  supplierCard: {
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
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], paddingBottom: spacing[2] },
  cardMedia: {
    width: 56, height: 56, borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colorScales.gray[200],
  },
  cardCenter: { flex: 1, gap: 2 },
  cardTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  cardSubtitle: { fontSize: 12, color: colorScales.gray[500], marginBottom: 2 },
  cardCode: { fontSize: 11, color: colorScales.gray[500], marginBottom: 4 },
  cardMetaRow: { flexDirection: 'row', gap: spacing[3], marginTop: 4 },
  cardMetaItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardMetaCol: { flex: 1, gap: 1 },
  cardMetaValue: { fontSize: typography.fontSize.sm, fontWeight: '600' as any, color: colorScales.gray[900] },
  cardStatusBadge: {
    paddingHorizontal: spacing[2.5], paddingVertical: 3, borderRadius: borderRadius.full,
    backgroundColor: colorScales.gray[100], alignSelf: 'flex-start',
  },
  cardStatusBadgeText: { fontSize: 10, fontWeight: '700' as any, textTransform: 'uppercase' as any, letterSpacing: 0.3 },
  cardGridLabel: { fontSize: 10, fontWeight: '700' as any, color: colorScales.gray[500], textTransform: 'uppercase' as any, letterSpacing: 0.5 },
  cardFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    borderTopWidth: 1, borderTopColor: colorScales.gray[100],
    backgroundColor: colorScales.gray[50],
  },
  cardFooterLeft: { gap: 2 },
  cardFooterItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardFooterValue: { fontSize: typography.fontSize.lg, fontWeight: '800' as any, color: colorScales.gray[900] },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  cardActionEdit: { width: 36, height: 36, borderRadius: borderRadius.md, backgroundColor: colorScales.blue[50], alignItems: 'center', justifyContent: 'center' },
  cardActionDelete: { width: 36, height: 36, borderRadius: borderRadius.md, backgroundColor: colorScales.red[50], alignItems: 'center', justifyContent: 'center' },

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
    minWidth: 180, ...shadows.lg,
  },
  dropdownDivider: { height: 1, backgroundColor: colorScales.gray[100] },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3] },
  dropdownIconWrap: { width: 28, height: 28, borderRadius: 6, backgroundColor: colorScales.gray[100], alignItems: 'center', justifyContent: 'center' },
  dropdownItemText: { fontSize: typography.fontSize.sm, fontWeight: '500' as any, color: colorScales.gray[700] },
  dropdownItemPrimary: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colors.primary },
  dropdownItemDanger: { fontSize: typography.fontSize.sm, fontWeight: '700' as any, color: colorScales.red[600] },
  dropdownTitle: { fontSize: 11, fontWeight: '700' as any, color: colorScales.gray[500], paddingVertical: spacing[2.5], paddingHorizontal: spacing[3], letterSpacing: 0.5, textTransform: 'uppercase' as any },

  /* Toggle switch (estilo iOS) */
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3], paddingVertical: spacing[2] },
  toggleLabel: { fontSize: 14, fontWeight: '700' as any, color: colorScales.gray[900] },
  toggleDesc: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },
  toggleSwitch: { width: 44, height: 26, borderRadius: 13, backgroundColor: colorScales.gray[300], padding: 2, justifyContent: 'center' },
  toggleSwitchOn: { backgroundColor: colors.primary },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.background, ...shadows.sm, alignItems: 'center', justifyContent: 'center' },
  toggleKnobOn: { transform: [{ translateX: 18 }] },

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

  /* Modal wizard estilo web */
  createModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  createModal: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200],
    width: '100%', maxWidth: 520, maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  createHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  createHeaderText: { flex: 1 },
  createTitle: { fontSize: typography.fontSize.lg, fontWeight: '700' as any, color: colorScales.gray[900] },
  createSubtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
  createCloseBtn: { padding: spacing[1] },
  createBody: { flexGrow: 0, flexShrink: 1, maxHeight: 480 },
  createBodyContent: { padding: spacing[4], gap: spacing[3] },
  formGroup: { marginBottom: spacing[3] },
  formRow: { flexDirection: 'row', gap: spacing[3] },
  formCol: { flex: 1, gap: spacing[2] },
  formLabel: { fontSize: typography.fontSize.xs, fontWeight: '600' as any, color: colorScales.gray[500], marginBottom: spacing[2], textTransform: 'uppercase' as any, letterSpacing: 1 },
  required: { color: colors.error },
  inputField: {
    borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2.5], fontSize: 14, color: colorScales.gray[900], backgroundColor: colors.background,
    minHeight: 40, justifyContent: 'center' as any,
  },
  textArea: { minHeight: 60, textAlignVertical: 'top' as any },
  /* Dropdown de Moneda (en el form) */
  currencyDropdownList: { marginTop: 4, borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, backgroundColor: colors.background, overflow: 'hidden' },
  currencyDropdownOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[2.5], paddingHorizontal: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  currencyDropdownOptionActive: { backgroundColor: colorScales.green[50] },
  currencyDropdownOptionText: { fontSize: 14, color: colorScales.gray[700] },
  currencyDropdownOptionTextActive: { fontWeight: '700' as any, color: colors.primary },
  createFooter: { flexDirection: 'row', paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[4], borderTopWidth: 1, borderTopColor: colorScales.gray[200], backgroundColor: colors.background, gap: spacing[2] },
  cancelBtn: { flex: 1, paddingVertical: 10, borderRadius: borderRadius.full, backgroundColor: colorScales.gray[900], alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 13, fontWeight: '700' as any, color: colors.background },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: borderRadius.full, backgroundColor: colorScales.green[100], alignItems: 'center', justifyContent: 'center' },
  confirmBtnDisabled: { backgroundColor: colorScales.gray[100] },
  confirmBtnText: { fontSize: 13, fontWeight: '700' as any, color: colorScales.green[800] },
  actionSpacer: { width: spacing[3] },
});
