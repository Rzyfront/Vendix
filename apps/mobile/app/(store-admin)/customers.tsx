import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  TextInput,
  Modal,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CustomerService } from '@/features/store/services/customer.service';
import { CustomerBulkUploadModal } from '@/features/store/components/customer-bulk-upload-modal';
import { useTenantStore } from '@/core/store/tenant.store';
import type { Customer, CustomerState, CustomerStats, UpdateCustomerDto, CreateCustomerDto } from '@/features/store/types';
import { Avatar } from '@/shared/components/avatar/avatar';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { ConfirmDialog } from '@/shared/components/confirm-dialog/confirm-dialog';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { formatCurrency } from '@/shared/utils/currency';
import { formatDate, formatRelative } from '@/shared/utils/date';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

const STATE_FILTERS: { label: string; value?: CustomerState }[] = [
  { label: 'Todos' },
  { label: 'Activos', value: 'active' },
  { label: 'Inactivos', value: 'inactive' },
];

function customerName(customer: Customer): string {
  return `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Cliente sin nombre';
}

type CustomerCardProps = {
  customer: Customer;
  onView: () => void;
  onEdit: () => void;
  onMoreActions: (ref: View, item: Customer) => void;
};

const CustomerCard = ({ customer, onView, onEdit, onMoreActions }: CustomerCardProps) => {
  const fullName = customerName(customer);
  const orders = Number(customer.total_orders ?? 0);
  const isActive = customer.state === 'active';
  const moreBtnRef = useRef<View>(null);

  return (
    <View style={styles.customerCard}>
      {/* Top row: avatar (user icon) + nombre/email + badge estado (estilo web) */}
      <View style={styles.cardTopRow}>
        <View style={styles.cardMedia}>
          <Icon name="user" size={22} color={colorScales.gray[500]} />
        </View>

        <View style={styles.cardCenter}>
          <Text style={styles.cardTitle} numberOfLines={1}>{fullName}</Text>
          <Text style={styles.cardEmail} numberOfLines={1}>
            {customer.email || 'Sin correo registrado'}
          </Text>
        </View>

        <View
          style={[
            styles.cardStatusBadge,
            { backgroundColor: isActive ? colorScales.green[50] : colorScales.blue[50] },
          ]}
        >
          <Text
            style={[
              styles.cardStatusBadgeText,
              { color: isActive ? colorScales.green[700] : colorScales.blue[700] },
            ]}
          >
            {isActive ? 'Activo' : 'Inactivo'}
          </Text>
        </View>
      </View>

      {/* Detalles: 5 items en grid 3+2 — Teléfono / Documento / Pedidos (row 1) + Última compra / Registrado (row 2) */}
      {/* Row 1: 3 columnas */}
      <View style={styles.cardDetailsRow3}>
        <View style={styles.cardDetailItemThird}>
          <View style={styles.cardDetailLabelRow}>
            <Icon name="phone" size={11} color={colorScales.gray[400]} />
            <Text style={styles.cardDetailLabel}>TELÉFONO</Text>
          </View>
          <Text style={styles.cardDetailValue} numberOfLines={1}>
            {customer.phone || '—'}
          </Text>
        </View>

        <View style={styles.cardDetailItemThird}>
          <View style={styles.cardDetailLabelRow}>
            <Icon name="credit-card" size={11} color={colorScales.gray[400]} />
            <Text style={styles.cardDetailLabel}>DOCUMENTO</Text>
          </View>
          <Text style={styles.cardDetailValue} numberOfLines={1}>
            {customer.document_number || '—'}
          </Text>
        </View>

        <View style={styles.cardDetailItemThird}>
          <View style={styles.cardDetailLabelRow}>
            <Icon name="shopping-bag" size={11} color={colorScales.gray[400]} />
            <Text style={styles.cardDetailLabel}>PEDIDOS</Text>
          </View>
          <Text style={styles.cardDetailValue} numberOfLines={1}>{orders}</Text>
        </View>
      </View>

      {/* Row 2: 2 columnas */}
      <View style={styles.cardDetailsRow2}>
        <View style={styles.cardDetailItemHalf}>
          <View style={styles.cardDetailLabelRow}>
            <Icon name="clock" size={11} color={colorScales.gray[400]} />
            <Text style={styles.cardDetailLabel}>ÚLTIMA COMPRA</Text>
          </View>
          <Text style={styles.cardDetailValue} numberOfLines={1}>
            {customer.last_purchase_at ? formatRelative(customer.last_purchase_at) : '—'}
          </Text>
        </View>

        <View style={styles.cardDetailItemHalf}>
          <View style={styles.cardDetailLabelRow}>
            <Icon name="calendar" size={11} color={colorScales.gray[400]} />
            <Text style={styles.cardDetailLabel}>REGISTRADO</Text>
          </View>
          <Text style={styles.cardDetailValue} numberOfLines={1}>
            {customer.created_at ? formatDate(customer.created_at) : '—'}
          </Text>
        </View>
      </View>

      {/* Footer: Total gastado + 3 acciones (Ver / Editar / Eliminar) — estilo web */}
      <View style={styles.cardFooter}>
        <View style={styles.cardFooterLeft}>
          <Text style={styles.cardFooterLabel}>TOTAL GASTADO</Text>
          <Text style={styles.cardFooterValue}>
            {formatCurrency(customer.total_spent ?? 0)}
          </Text>
        </View>
        <View style={styles.cardActions}>
          {/* Ver: ojo gris (popup) */}
          <Pressable onPress={onView} hitSlop={6} style={styles.cardActionView}>
            <Icon name="eye" size={16} color={colorScales.gray[500]} />
          </Pressable>
          {/* Editar: lápiz azul (popup) */}
          <Pressable onPress={onEdit} hitSlop={6} style={styles.cardActionEdit}>
            <Icon name="edit" size={16} color={colorScales.blue[600]} />
          </Pressable>
          {/* Eliminar: 3 puntos gris oscuro (popup) */}
          <Pressable
            ref={moreBtnRef}
            onPress={() => onMoreActions(moreBtnRef.current as View, customer)}
            hitSlop={6}
            style={styles.cardActionMore}
          >
            <Ionicons name="ellipsis-horizontal" size={16} color={colorScales.gray[700]} />
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const CustomerStatsGrid = ({ stats }: { stats: CustomerStats | undefined }) => (
  <StatsGrid
    items={[
      { label: 'Total Clientes', value: String(stats?.total_customers ?? 0), icon: 'users', trend: { value: 12, positive: true } },
      { label: 'Activos', value: String(stats?.active_customers ?? 0), icon: 'user-check', trend: { value: 5, positive: true } },
      { label: 'Nuevos (este mes)', value: String(stats?.new_customers_this_month ?? 0), icon: 'user-plus', trend: { value: 8, positive: true } },
      { label: 'Ingresos', value: formatCurrency(stats?.total_revenue ?? 0), icon: 'dollar-sign', trend: { value: 15, positive: true } },
    ]}
  />
);

export default function CustomersScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState<CustomerState | undefined>();
  const [page, setPage] = useState(1);
  const storeId = useTenantStore((s) => s.storeId);

  // Sort state
  type SortField = 'first_name' | 'email' | 'total_orders' | 'last_purchase_at' | 'created_at';
  type SortDir = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('first_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showSortPopup, setShowSortPopup] = useState(false);

  const SORT_OPTIONS: { label: string; field: SortField }[] = [
    { label: 'Cliente', field: 'first_name' },
    { label: 'Correo', field: 'email' },
    { label: 'Pedidos', field: 'total_orders' },
    { label: 'Última compra', field: 'last_purchase_at' },
    { label: 'Registrado', field: 'created_at' },
  ];
  const screenW = Dimensions.get('window').width;
  const insets = useSafeAreaInsets();

  // Popup unificado de opciones (filtro + acciones) — estilo web
  const [showOptions, setShowOptions] = useState(false);
  const [showFilterTypeList, setShowFilterTypeList] = useState(false);
  const optionsBtnRef = useRef<View>(null);
  const [optionsPos, setOptionsPos] = useState({ top: 0, right: 0 });

  // Estado del popup "más opciones" por card (Eliminar)
  const [cardMoreAnchor, setCardMoreAnchor] = useState<{ top: number; right: number; item: Customer } | null>(null);

  // Estado del confirm dialog de eliminación
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  // Estado del modal Ver (popup eye)
  const [viewTarget, setViewTarget] = useState<Customer | null>(null);

  // Estado del modal Editar (popup pencil) + form
  const [editTarget, setEditTarget] = useState<Customer | null>(null);

  // Estado del modal de carga masiva
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editDocumentType, setEditDocumentType] = useState<string>('');
  const [editDocument, setEditDocument] = useState('');
  const [showEditDocTypeDropdown, setShowEditDocTypeDropdown] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [editTaxRegime, setEditTaxRegime] = useState<string>('');
  const [showEditTaxRegimeDropdown, setShowEditTaxRegimeDropdown] = useState(false);
  const [editPersonType, setEditPersonType] = useState<string>('');
  const [showEditPersonTypeDropdown, setShowEditPersonTypeDropdown] = useState(false);
  const [editIsWithholdingAgent, setEditIsWithholdingAgent] = useState(false);

  // Estado del modal Nuevo Cliente (popup) + form
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createFirstName, setCreateFirstName] = useState('');
  const [createLastName, setCreateLastName] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createDocumentType, setCreateDocumentType] = useState<string>('');
  const [createDocumentNumber, setCreateDocumentNumber] = useState('');
  const [showCreateDocTypeDropdown, setShowCreateDocTypeDropdown] = useState(false);
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({});
  const [createTaxRegime, setCreateTaxRegime] = useState<string>('');
  const [showCreateTaxRegimeDropdown, setShowCreateTaxRegimeDropdown] = useState(false);
  const [createPersonType, setCreatePersonType] = useState<string>('');
  const [showCreatePersonTypeDropdown, setShowCreatePersonTypeDropdown] = useState(false);
  const [createIsWithholdingAgent, setCreateIsWithholdingAgent] = useState(false);

  // Tipos de documento (alineado con customer-modal web)
  const CREATE_DOCUMENT_TYPES = [
    { value: 'CC', label: 'Cédula de Ciudadanía' },
    { value: 'CE', label: 'Cédula de Extranjería' },
    { value: 'NIT', label: 'NIT' },
    { value: 'PAS', label: 'Pasaporte' },
    { value: 'TI', label: 'Tarjeta de Identidad' },
  ];

  const TAX_REGIME_OPTIONS = [
    { value: 'COMUN', label: 'Régimen Común' },
    { value: 'SIMPLIFICADO', label: 'Régimen Simple' },
    { value: 'GRAN_CONTRIBUYENTE', label: 'Gran Contribuyente' },
  ];

  const PERSON_TYPE_OPTIONS = [
    { value: 'NATURAL', label: 'Persona Natural' },
    { value: 'JURIDICA', label: 'Persona Jurídica' },
  ];

  const { data: stats } = useQuery({
    queryKey: ['customer-stats', storeId],
    queryFn: () => CustomerService.stats(Number(storeId)),
    enabled: !!storeId,
  });

  const {
    data: pageData,
    isLoading: customersLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['customers', search, stateFilter, page],
    queryFn: () =>
      CustomerService.list({
        page,
        limit: 10,
        search: search || undefined,
        state: stateFilter,
      }),
  });

  // Mutación: eliminar cliente (estilo web: toast success/error + invalidar queries)
  const deleteMutation = useMutation({
    mutationFn: (id: string) => CustomerService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      toastSuccess('Cliente eliminado correctamente');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al eliminar el cliente';
      toastError(typeof message === 'string' ? message : 'Error al eliminar el cliente');
    },
  });

  // Mutación: actualizar cliente (popup Editar)
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCustomerDto }) =>
      CustomerService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      toastSuccess('Cliente actualizado correctamente');
      setEditTarget(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al actualizar el cliente';
      toastError(typeof message === 'string' ? message : 'Error al actualizar el cliente');
    },
  });

  // Mutación: crear cliente (popup Nuevo Cliente)
  const createMutation = useMutation({
    mutationFn: (data: CreateCustomerDto) => CustomerService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      toastSuccess('Cliente creado exitosamente');
      closeCreateModal();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al crear el cliente';
      toastError(typeof message === 'string' ? message : 'Error al crear el cliente');
    },
  });

  const customers = (pageData?.data ?? []).slice().sort((a, b) => {
    let aVal: string | number = '';
    let bVal: string | number = '';

    switch (sortField) {
      case 'first_name':
        aVal = `${a.first_name || ''} ${a.last_name || ''}`.toLowerCase();
        bVal = `${b.first_name || ''} ${b.last_name || ''}`.toLowerCase();
        break;
      case 'email':
        aVal = (a.email || '').toLowerCase();
        bVal = (b.email || '').toLowerCase();
        break;
      case 'total_orders':
        aVal = Number(a.total_orders ?? 0);
        bVal = Number(b.total_orders ?? 0);
        break;
      case 'last_purchase_at':
        aVal = a.last_purchase_at || '';
        bVal = b.last_purchase_at || '';
        break;
      case 'created_at':
        aVal = a.created_at || '';
        bVal = b.created_at || '';
        break;
    }

    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  const pagination = pageData?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    setPage(1);
  }, []);

  // Mostrar popup "más opciones" (Eliminar) — mide posición del botón
  const handleMoreActions = useCallback(
    (ref: View, item: Customer) => {
      ref.measureInWindow((x, y, w, h) => {
        setCardMoreAnchor({ top: y + h + 6, right: screenW - x - w, item });
      });
    },
    [screenW],
  );

  // Abrir confirm dialog de eliminar
  const handleAskDelete = useCallback((item: Customer) => {
    setCardMoreAnchor(null);
    setDeleteTarget(item);
  }, []);

  // Confirmar eliminar
  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    setDeleteTarget(null);
    deleteMutation.mutate(id);
  }, [deleteTarget, deleteMutation]);

  // Abrir popup unificado — mide posición del botón sliders
  const openOptions = useCallback(() => {
    optionsBtnRef.current?.measureInWindow((x, y, w, h) => {
      setOptionsPos({ top: y + h + 6, right: screenW - x - w });
      setShowOptions(true);
      setShowFilterTypeList(false);
    });
  }, [screenW]);

  // Acción: Carga Masiva — abre el wizard de carga masiva
  const handleBulkUpload = useCallback(() => {
    setShowOptions(false);
    setShowBulkUpload(true);
  }, []);

  // Acción: Nuevo Cliente — abre popup modal con el form de creación
  const openCreateModal = useCallback(() => {
    setShowOptions(false);
    setCreateFirstName('');
    setCreateLastName('');
    setCreateEmail('');
    setCreatePhone('');
    setCreateDocumentType('');
    setCreateDocumentNumber('');
    setCreateTaxRegime('');
    setCreatePersonType('');
    setCreateIsWithholdingAgent(false);
    setCreateErrors({});
    setShowCreateDocTypeDropdown(false);
    setShowCreateTaxRegimeDropdown(false);
    setShowCreatePersonTypeDropdown(false);
    setCreateModalOpen(true);
  }, []);

  const closeCreateModal = useCallback(() => {
    setCreateModalOpen(false);
    setCreateErrors({});
    setShowCreateDocTypeDropdown(false);
  }, []);

  const handleSubmitCreate = useCallback(() => {
    setCreateErrors({});
    const newErrors: Record<string, string> = {};
    if (!createFirstName.trim()) {
      newErrors.firstName = 'El nombre es requerido';
    } else if (createFirstName.trim().length < 2) {
      newErrors.firstName = 'Mínimo 2 caracteres';
    }
    if (!createLastName.trim()) {
      newErrors.lastName = 'El apellido es requerido';
    } else if (createLastName.trim().length < 2) {
      newErrors.lastName = 'Mínimo 2 caracteres';
    }
    if (!createEmail.trim()) {
      newErrors.email = 'El email es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createEmail)) {
      newErrors.email = 'Ingresa un email válido';
    }
    if (createPhone.trim() && !/^[\d+#*\s()-]+$/.test(createPhone.trim())) {
      newErrors.phone = 'El teléfono solo admite números y + # * ( ) -';
    }
    if (Object.keys(newErrors).length > 0) {
      setCreateErrors(newErrors);
      toastError('Revisa los campos marcados');
      return;
    }
    const dto: CreateCustomerDto = {
      first_name: createFirstName.trim(),
      last_name: createLastName.trim(),
      email: createEmail.trim(),
      phone: createPhone.trim() || undefined,
      document_type: createDocumentType || undefined,
      document_number: createDocumentNumber.trim() || undefined,
      tax_regime: createTaxRegime || undefined,
      person_type: createPersonType || undefined,
      is_withholding_agent: createIsWithholdingAgent,
    };
    createMutation.mutate(dto);
  }, [createFirstName, createLastName, createEmail, createPhone, createDocumentType, createDocumentNumber, createMutation]);

  // Abrir popup Ver (eye) — muestra detalles del cliente
  const handleView = useCallback((item: Customer) => {
    setViewTarget(item);
  }, []);

  // Abrir popup Editar (pencil) — pre-rellena form con datos del cliente
  const handleEdit = useCallback((item: Customer) => {
    setEditTarget(item);
    setEditFirstName(item.first_name || '');
    setEditLastName(item.last_name || '');
    setEditEmail(item.email || '');
    setEditPhone(item.phone || '');
    setEditDocumentType(item.document_type || '');
    setEditDocument(item.document_number || '');
    setEditTaxRegime(item.tax_regime ?? '');
    setEditPersonType(item.person_type ?? '');
    setEditIsWithholdingAgent(item.is_withholding_agent ?? false);
    setShowEditDocTypeDropdown(false);
    setShowEditTaxRegimeDropdown(false);
    setShowEditPersonTypeDropdown(false);
    setEditErrors({});
  }, []);

  const closeEditModal = useCallback(() => {
    setEditTarget(null);
    setEditErrors({});
    setShowEditDocTypeDropdown(false);
    setShowEditTaxRegimeDropdown(false);
    setShowEditPersonTypeDropdown(false);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editTarget) return;
    setEditErrors({});
    // Validar
    const newErrors: Record<string, string> = {};
    if (!editFirstName.trim()) {
      newErrors.firstName = 'El nombre es requerido';
    } else if (editFirstName.trim().length < 2) {
      newErrors.firstName = 'Mínimo 2 caracteres';
    }
    if (!editLastName.trim()) {
      newErrors.lastName = 'El apellido es requerido';
    } else if (editLastName.trim().length < 2) {
      newErrors.lastName = 'Mínimo 2 caracteres';
    }
    if (!editEmail.trim()) {
      newErrors.email = 'El email es requerido';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editEmail)) {
      newErrors.email = 'Ingresa un email válido';
    }
    if (editPhone.trim() && !/^[\d+#*\s()-]+$/.test(editPhone.trim())) {
      newErrors.phone = 'El teléfono solo admite números y + # * ( ) -';
    }
    if (Object.keys(newErrors).length > 0) {
      setEditErrors(newErrors);
      toastError('Revisa los campos marcados');
      return;
    }
    const dto: UpdateCustomerDto = {
      first_name: editFirstName.trim(),
      last_name: editLastName.trim(),
      email: editEmail.trim(),
      phone: editPhone.trim() || undefined,
      document_type: editDocumentType || undefined,
      document_number: editDocument.trim() || undefined,
      tax_regime: editTaxRegime || undefined,
      person_type: editPersonType || undefined,
      is_withholding_agent: editIsWithholdingAgent,
    };
    updateMutation.mutate({ id: editTarget.id, data: dto });
  }, [editTarget, editFirstName, editLastName, editEmail, editPhone, editDocumentType, editDocument, editTaxRegime, editPersonType, editIsWithholdingAgent, updateMutation]);

  const renderCustomer = useCallback(
    ({ item }: { item: Customer }) => (
      <CustomerCard
        customer={item}
        onView={() => handleView(item)}
        onEdit={() => handleEdit(item)}
        onMoreActions={handleMoreActions}
      />
    ),
    [handleView, handleEdit, handleMoreActions],
  );

  const paginationRange = useMemo(() => {
    const range: (number | 'dots')[] = [];
    const delta = 1;
    const left = Math.max(2, page - delta);
    const right = Math.min(totalPages - 1, page + delta);

    range.push(1);
    if (left > 2) range.push('dots');
    for (let i = left; i <= right; i++) range.push(i);
    if (right < totalPages - 1) range.push('dots');
    if (totalPages > 1) range.push(totalPages);

    return range;
  }, [page, totalPages]);

  if (customersLoading && !pageData) {
    return (
      <View style={styles.loader}>
        <Spinner />
      </View>
    );
  }

  if (isError && !pageData) {
    return (
      <View style={styles.root}>
        <EmptyState
          title="No se pudieron cargar los clientes"
          description="Revisa tu sesión o conexión e intenta de nuevo."
          actionLabel="Reintentar"
          onAction={() => refetch()}
          icon="users"
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={customers}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderCustomer}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.headerSection}>
            <CustomerStatsGrid stats={stats} />
            <Text style={styles.title}>Todos los Clientes ({pagination?.total ?? 0})</Text>
            <View style={styles.searchRow}>
              <View style={styles.searchInputWrap}>
                <Ionicons name="search-outline" size={16} color={colorScales.gray[400]} style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInputField}
                  value={search}
                  onChangeText={handleSearch}
                  placeholder="Buscar clientes..."
                  placeholderTextColor={colorScales.gray[400]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {search.length > 0 && (
                  <Pressable onPress={() => handleSearch('')} hitSlop={8}>
                    <Ionicons name="close" size={16} color={colorScales.gray[400]} />
                  </Pressable>
                )}
              </View>
              <Pressable
                ref={optionsBtnRef}
                onPress={openOptions}
                style={styles.iconBtn}
                hitSlop={6}
              >
                <Icon name="sliders" size={18} color={colors.primary} />
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            title="Sin clientes"
            description="Aún no tienes clientes registrados"
            actionLabel="Crear cliente"
            onAction={() => router.push('/(store-admin)/customers/create' as never)}
            icon="users"
          />
        }
        ListFooterComponent={
          totalPages > 1 ? (
            <View style={styles.pagination}>
              <Pressable
                onPress={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
              >
                <Icon name="chevron-left" size={16} color={page <= 1 ? colorScales.gray[300] : colorScales.gray[600]} />
              </Pressable>
              {paginationRange.map((item, idx) =>
                item === 'dots' ? (
                  <Text key={`dots-${idx}`} style={styles.pageDots}>...</Text>
                ) : (
                  <Pressable
                    key={item}
                    onPress={() => setPage(item)}
                    style={[styles.pageNumBtn, page === item && styles.pageNumBtnActive]}
                  >
                    <Text style={[styles.pageNumText, page === item && styles.pageNumTextActive]}>
                      {item}
                    </Text>
                  </Pressable>
                ),
              )}
              <Pressable
                onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={[styles.pageBtn, page >= totalPages && styles.pageBtnDisabled]}
              >
                <Icon name="chevron-right" size={16} color={page >= totalPages ? colorScales.gray[300] : colorScales.gray[600]} />
              </Pressable>
            </View>
          ) : null
        }
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + spacing[6] }]}
      />

      {/* Popup unificado (botón sliders) — Filtros + Carga Masiva + Nuevo Cliente */}
      <Modal
        visible={showOptions}
        transparent
        animationType="fade"
        onRequestClose={() => { setShowOptions(false); setShowFilterTypeList(false); }}
      >
        <Pressable
          style={styles.dropdownBackdrop}
          onPress={() => { setShowOptions(false); setShowFilterTypeList(false); }}
        />
        <View style={[styles.dropdownPositioner, { top: optionsPos.top, right: optionsPos.right }]}>
          <View style={[styles.dropdownArrow, { marginRight: Math.max(optionsPos.right, 14) }]} />
          <View style={styles.filterPopup}>
            {/* Header: Filtros */}
            <View style={styles.filterPopupHeader}>
              <Text style={styles.filterPopupTitle}>Filtros</Text>
            </View>
            {/* Body: Estado select */}
            <View style={styles.filterPopupBody}>
              <Text style={styles.filterPopupLabel}>Estado</Text>
              <Pressable
                style={styles.filterPopupSelect}
                onPress={() => setShowFilterTypeList(!showFilterTypeList)}
              >
                <Text style={styles.filterPopupSelectText}>
                  {STATE_FILTERS.find((f) => f.value === stateFilter)?.label ?? 'Todos'}
                </Text>
                <Ionicons
                  name={showFilterTypeList ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colorScales.gray[500]}
                />
              </Pressable>
              {showFilterTypeList && (
                <View style={styles.filterPopupOptionsList}>
                  {STATE_FILTERS.map((opt) => (
                    <Pressable
                      key={opt.label}
                      style={[
                        styles.filterPopupOption,
                        opt.value === stateFilter && styles.filterPopupOptionActive,
                      ]}
                      onPress={() => {
                        setStateFilter(opt.value);
                        setPage(1);
                        setShowFilterTypeList(false);
                        setShowOptions(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.filterPopupOptionText,
                          opt.value === stateFilter && styles.filterPopupOptionTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                      {opt.value === stateFilter && (
                        <Ionicons name="checkmark" size={16} color={colors.primary} />
                      )}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
            {/* Acciones: Carga Masiva + Nuevo Cliente */}
            <View style={styles.filterPopupActionsDivider} />
            <View style={styles.filterPopupActions}>
              <Pressable style={styles.dropdownItem} onPress={handleBulkUpload}>
                <View style={styles.dropdownIconWrap}>
                  <Ionicons name="cloud-upload-outline" size={18} color={colorScales.gray[500]} />
                </View>
                <Text style={styles.dropdownItemText}>Carga Masiva</Text>
              </Pressable>
              <View style={styles.dropdownDivider} />
              <Pressable style={styles.dropdownItem} onPress={openCreateModal}>
                <View style={[styles.dropdownIconWrap, { backgroundColor: colorScales.green[50] }]}>
                  <Ionicons name="add-outline" size={18} color={colors.primary} />
                </View>
                <Text style={styles.dropdownItemPrimary}>Nuevo Cliente</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Popup "más opciones" por card (Eliminar) — mismo estilo que locations.tsx */}
      {cardMoreAnchor && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setCardMoreAnchor(null)}>
          <Pressable style={styles.dropdownBackdrop} onPress={() => setCardMoreAnchor(null)} />
          <View style={[styles.dropdownPositioner, { top: cardMoreAnchor.top, right: cardMoreAnchor.right }]}>
            <View style={[styles.dropdownArrow, { marginRight: 14 }]} />
            <View style={styles.dropdown}>
              <Pressable
                style={styles.dropdownItem}
                onPress={() => handleAskDelete(cardMoreAnchor.item)}
              >
                <View style={[styles.dropdownIconWrap, { backgroundColor: colorScales.red[50] }]}>
                  <Ionicons name="trash" size={18} color={colorScales.red[600]} />
                </View>
                <Text style={styles.dropdownItemDanger}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}

      {/* Confirm dialog de eliminación — estilo web */}
      <ConfirmDialog
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Eliminar cliente"
        message={
          deleteTarget
            ? `¿Estás seguro de que quieres eliminar a "${customerName(deleteTarget)}"? Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        destructive
        loading={deleteMutation.isPending}
      />

      {/* Modal Ver (popup eye) — muestra detalles del cliente estilo web */}
      <Modal visible={!!viewTarget} transparent animationType="fade" onRequestClose={() => setViewTarget(null)}>
        <View style={styles.createModalOverlay}>
          <View style={styles.createModal}>
            {/* Header */}
            <View style={styles.createHeader}>
              <View style={styles.createHeaderText}>
                <Text style={styles.createTitle}>Detalle del Cliente</Text>
                <Text style={styles.createSubtitle}>Información completa del cliente</Text>
              </View>
              <Pressable onPress={() => setViewTarget(null)} hitSlop={8} style={styles.createCloseBtn}>
                <Ionicons name="close" size={22} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            {/* Body: avatar + nombre + status + grid de detalles */}
            <ScrollView style={styles.createBody} contentContainerStyle={styles.createBodyContent} showsVerticalScrollIndicator={false}>
              {viewTarget && (
                <>
                  <View style={styles.viewProfileRow}>
                    <Avatar name={customerName(viewTarget)} size="lg" style={styles.viewAvatar} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.viewName}>{customerName(viewTarget)}</Text>
                      <Text style={styles.viewEmail}>{viewTarget.email || 'Sin correo'}</Text>
                      <View
                        style={[
                          styles.viewStatusBadge,
                          { backgroundColor: viewTarget.state === 'active' ? colorScales.green[50] : colorScales.gray[100] },
                        ]}
                      >
                        <Text
                          style={[
                            styles.viewStatusBadgeText,
                            { color: viewTarget.state === 'active' ? colorScales.green[700] : colorScales.gray[500] },
                          ]}
                        >
                          {viewTarget.state === 'active' ? 'Activo' : 'Inactivo'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.viewGrid}>
                    <View style={styles.viewGridItem}>
                      <View style={styles.viewGridLabelRow}>
                        <Icon name="phone" size={13} color={colorScales.gray[400]} />
                        <Text style={styles.viewGridLabel}>TELÉFONO</Text>
                      </View>
                      <Text style={styles.viewGridValue}>{viewTarget.phone || '—'}</Text>
                    </View>
                    <View style={styles.viewGridItem}>
                      <View style={styles.viewGridLabelRow}>
                        <Icon name="credit-card" size={13} color={colorScales.gray[400]} />
                        <Text style={styles.viewGridLabel}>DOCUMENTO</Text>
                      </View>
                      <Text style={styles.viewGridValue}>{viewTarget.document_number || '—'}</Text>
                    </View>
                    <View style={styles.viewGridItem}>
                      <View style={styles.viewGridLabelRow}>
                        <Icon name="shopping-bag" size={13} color={colorScales.gray[400]} />
                        <Text style={styles.viewGridLabel}>PEDIDOS</Text>
                      </View>
                      <Text style={styles.viewGridValue}>{Number(viewTarget.total_orders ?? 0)}</Text>
                    </View>
                    <View style={styles.viewGridItem}>
                      <View style={styles.viewGridLabelRow}>
                        <Icon name="dollar-sign" size={13} color={colorScales.gray[400]} />
                        <Text style={styles.viewGridLabel}>TOTAL GASTADO</Text>
                      </View>
                      <Text style={styles.viewGridValue}>{formatCurrency(viewTarget.total_spent ?? 0)}</Text>
                    </View>
                    <View style={styles.viewGridItem}>
                      <View style={styles.viewGridLabelRow}>
                        <Icon name="clock" size={13} color={colorScales.gray[400]} />
                        <Text style={styles.viewGridLabel}>ÚLTIMA COMPRA</Text>
                      </View>
                      <Text style={styles.viewGridValue}>{viewTarget.last_purchase_at ? formatRelative(viewTarget.last_purchase_at) : '—'}</Text>
                    </View>
                    <View style={styles.viewGridItem}>
                      <View style={styles.viewGridLabelRow}>
                        <Icon name="calendar" size={13} color={colorScales.gray[400]} />
                        <Text style={styles.viewGridLabel}>REGISTRADO</Text>
                      </View>
                      <Text style={styles.viewGridValue}>{viewTarget.created_at ? formatDate(viewTarget.created_at) : '—'}</Text>
                    </View>
                  </View>
                </>
              )}
            </ScrollView>

            {/* Footer: Cerrar + Ver detalle completo */}
            <View style={styles.createFooter}>
              <Pressable style={styles.cancelBtn} onPress={() => setViewTarget(null)}>
                <Text style={styles.cancelBtnText}>Cerrar</Text>
              </Pressable>
              <View style={styles.actionSpacer} />
              <Pressable
                style={styles.confirmBtn}
                onPress={() => {
                  const id = viewTarget?.id;
                  setViewTarget(null);
                  if (id) router.push(`/(store-admin)/customers/${id}` as never);
                }}
              >
                <Text style={styles.confirmBtnText}>Ver detalle completo</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Editar (popup pencil) — form con datos del cliente (estilo web) */}
      <Modal visible={!!editTarget} transparent animationType="fade" onRequestClose={closeEditModal}>
        <View style={styles.createModalOverlay}>
          <View style={styles.createModal}>
            {/* Header */}
            <View style={styles.createHeader}>
              <View style={styles.createHeaderText}>
                <Text style={styles.createTitle}>Editar cliente</Text>
                <Text style={styles.createSubtitle}>Administra la información del cliente</Text>
              </View>
              <Pressable onPress={closeEditModal} hitSlop={8} style={styles.createCloseBtn}>
                <Ionicons name="close" size={22} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            <ScrollView style={styles.createBody} contentContainerStyle={styles.createBodyContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Email */}
              <View>
                <Text style={styles.editFormLabel}>EMAIL <Text style={styles.requiredStar}>*</Text></Text>
                <TextInput
                  style={[styles.editInput, !!editErrors.email && styles.editInputError]}
                  value={editEmail}
                  onChangeText={(v) => { setEditEmail(v); setEditErrors((p) => { const n = { ...p }; delete n.email; return n; }); }}
                  placeholder="cliente@ejemplo.com"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                {!!editErrors.email && <Text style={styles.editErrorText}>{editErrors.email}</Text>}
              </View>

              {/* Nombre + Apellido (row) */}
              <View style={styles.editRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.editFormLabel}>NOMBRE <Text style={styles.requiredStar}>*</Text></Text>
                  <TextInput
                    style={[styles.editInput, !!editErrors.firstName && styles.editInputError]}
                    value={editFirstName}
                    onChangeText={(v) => { setEditFirstName(v); setEditErrors((p) => { const n = { ...p }; delete n.firstName; return n; }); }}
                    placeholder="Ej. María"
                    placeholderTextColor={colorScales.gray[400]}
                  />
                  {!!editErrors.firstName && <Text style={styles.editErrorText}>{editErrors.firstName}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.editFormLabel}>APELLIDO <Text style={styles.requiredStar}>*</Text></Text>
                  <TextInput
                    style={[styles.editInput, !!editErrors.lastName && styles.editInputError]}
                    value={editLastName}
                    onChangeText={(v) => { setEditLastName(v); setEditErrors((p) => { const n = { ...p }; delete n.lastName; return n; }); }}
                    placeholder="Ej. Rodríguez"
                    placeholderTextColor={colorScales.gray[400]}
                  />
                  {!!editErrors.lastName && <Text style={styles.editErrorText}>{editErrors.lastName}</Text>}
                </View>
              </View>

              {/* Teléfono */}
              <View>
                <Text style={styles.editFormLabel}>TELÉFONO</Text>
                <TextInput
                  style={[styles.editInput, !!editErrors.phone && styles.editInputError]}
                  value={editPhone}
                  onChangeText={(v) => { setEditPhone(v); setEditErrors((p) => { const n = { ...p }; delete n.phone; return n; }); }}
                  placeholder="+57 300 567 8900"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="phone-pad"
                />
                {!!editErrors.phone && <Text style={styles.editErrorText}>{editErrors.phone}</Text>}
              </View>

              {/* Tipo documento + Nº documento (row) — estilo web */}
              <View style={styles.editRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.editFormLabel}>TIPO DOCUMENTO</Text>
                  <Pressable
                    style={[styles.editInput, styles.createSelectTrigger]}
                    onPress={() => setShowEditDocTypeDropdown((v) => !v)}
                  >
                    <Text style={[
                      styles.createSelectText,
                      !editDocumentType && styles.createSelectPlaceholder,
                    ]}>
                      {CREATE_DOCUMENT_TYPES.find((d) => d.value === editDocumentType)?.label
                        || 'Seleccionar tipo'}
                    </Text>
                    <Ionicons
                      name={showEditDocTypeDropdown ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colorScales.gray[500]}
                    />
                  </Pressable>
                  {showEditDocTypeDropdown && (
                    <View style={styles.createSelectDropdown}>
                      {CREATE_DOCUMENT_TYPES.map((d) => (
                        <Pressable
                          key={d.value}
                          onPress={() => {
                            setEditDocumentType(d.value);
                            setShowEditDocTypeDropdown(false);
                          }}
                          style={[
                            styles.createSelectOption,
                            editDocumentType === d.value && styles.editStateChipActive,
                          ]}
                        >
                          <Text style={[
                            styles.createSelectOptionText,
                            editDocumentType === d.value && styles.editStateChipTextActive,
                          ]}>
                            {d.label}
                          </Text>
                          {editDocumentType === d.value && (
                            <Ionicons name="checkmark" size={16} color={colors.primary} />
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.editFormLabel}>Nº DOCUMENTO</Text>
                  <TextInput
                    style={styles.editInput}
                    value={editDocument}
                    onChangeText={setEditDocument}
                    placeholder="12345678"
                    placeholderTextColor={colorScales.gray[400]}
                  />
                </View>
              </View>

              {/* Régimen tributario + Tipo de persona (row) — espejo web */}
              <View style={styles.editRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.editFormLabel}>RÉGIMEN TRIBUTARIO</Text>
                  <Pressable
                    style={[styles.editInput, styles.createSelectTrigger]}
                    onPress={() => setShowEditTaxRegimeDropdown((v) => !v)}
                  >
                    <Text style={[
                      styles.createSelectText,
                      !editTaxRegime && styles.createSelectPlaceholder,
                    ]}>
                      {TAX_REGIME_OPTIONS.find((d) => d.value === editTaxRegime)?.label
                        || 'Seleccionar'}
                    </Text>
                    <Ionicons
                      name={showEditTaxRegimeDropdown ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colorScales.gray[500]}
                    />
                  </Pressable>
                  {showEditTaxRegimeDropdown && (
                    <View style={styles.createSelectDropdown}>
                      {TAX_REGIME_OPTIONS.map((d) => (
                        <Pressable
                          key={d.value}
                          onPress={() => {
                            setEditTaxRegime(d.value);
                            setShowEditTaxRegimeDropdown(false);
                          }}
                          style={[
                            styles.createSelectOption,
                            editTaxRegime === d.value && styles.editStateChipActive,
                          ]}
                        >
                          <Text style={[
                            styles.createSelectOptionText,
                            editTaxRegime === d.value && styles.editStateChipTextActive,
                          ]}>
                            {d.label}
                          </Text>
                          {editTaxRegime === d.value && (
                            <Ionicons name="checkmark" size={16} color={colors.primary} />
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.editFormLabel}>TIPO DE PERSONA</Text>
                  <Pressable
                    style={[styles.editInput, styles.createSelectTrigger]}
                    onPress={() => setShowEditPersonTypeDropdown((v) => !v)}
                  >
                    <Text style={[
                      styles.createSelectText,
                      !editPersonType && styles.createSelectPlaceholder,
                    ]}>
                      {PERSON_TYPE_OPTIONS.find((d) => d.value === editPersonType)?.label
                        || 'Seleccionar'}
                    </Text>
                    <Ionicons
                      name={showEditPersonTypeDropdown ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colorScales.gray[500]}
                    />
                  </Pressable>
                  {showEditPersonTypeDropdown && (
                    <View style={styles.createSelectDropdown}>
                      {PERSON_TYPE_OPTIONS.map((d) => (
                        <Pressable
                          key={d.value}
                          onPress={() => {
                            setEditPersonType(d.value);
                            setShowEditPersonTypeDropdown(false);
                          }}
                          style={[
                            styles.createSelectOption,
                            editPersonType === d.value && styles.editStateChipActive,
                          ]}
                        >
                          <Text style={[
                            styles.createSelectOptionText,
                            editPersonType === d.value && styles.editStateChipTextActive,
                          ]}>
                            {d.label}
                          </Text>
                          {editPersonType === d.value && (
                            <Ionicons name="checkmark" size={16} color={colors.primary} />
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              {/* Agente de retención — espejo web toggle */}
              <Pressable
                style={styles.toggleRow}
                onPress={() => setEditIsWithholdingAgent((v) => !v)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.editFormLabel}>AGENTE DE RETENCIÓN</Text>
                  <Text style={styles.toggleHint}>Responsable de retener impuestos en compras</Text>
                </View>
                <View style={[
                  styles.toggle,
                  editIsWithholdingAgent && styles.toggleActive,
                ]}>
                  <View style={[
                    styles.toggleThumb,
                    editIsWithholdingAgent && styles.toggleThumbActive,
                  ]} />
                </View>
              </Pressable>
            </ScrollView>

            {/* Footer: Cancelar (oscuro) + Actualizar (primary verde) — estilo web */}
            <View style={styles.createFooter}>
              <Pressable style={styles.cancelBtn} onPress={closeEditModal}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </Pressable>
              <View style={styles.actionSpacer} />
              <Pressable
                style={[styles.confirmBtn, updateMutation.isPending && styles.confirmBtnDisabled]}
                onPress={handleSaveEdit}
                disabled={updateMutation.isPending}
              >
                <Text style={styles.confirmBtnText}>
                  {updateMutation.isPending ? 'Actualizando...' : 'Actualizar'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Nuevo Cliente (popup) — estilo web con campos de la imagen */}
      <Modal visible={createModalOpen} transparent animationType="fade" onRequestClose={closeCreateModal}>
        <View style={styles.createModalOverlay}>
          <View style={styles.createModal}>
            {/* Header */}
            <View style={styles.createHeader}>
              <View style={styles.createHeaderText}>
                <Text style={styles.createTitle}>Crear cliente</Text>
                <Text style={styles.createSubtitle}>Administra la información del cliente</Text>
              </View>
              <Pressable onPress={closeCreateModal} hitSlop={8} style={styles.createCloseBtn}>
                <Ionicons name="close" size={22} color={colorScales.gray[500]} />
              </Pressable>
            </View>

            <ScrollView style={styles.createBody} contentContainerStyle={styles.createBodyContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Correo electrónico */}
              <View>
                <Text style={styles.createFormLabel}>CORREO ELECTRONICO <Text style={styles.requiredStar}>*</Text></Text>
                <TextInput
                  style={[styles.createInput, !!createErrors.email && styles.editInputError]}
                  value={createEmail}
                  onChangeText={(v) => { setCreateEmail(v); setCreateErrors((p) => { const n = { ...p }; delete n.email; return n; }); }}
                  placeholder="cliente@ejemplo.com"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                {!!createErrors.email && <Text style={styles.editErrorText}>{createErrors.email}</Text>}
              </View>

              {/* Nombre + Apellido (row) */}
              <View style={styles.editRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.createFormLabel}>NOMBRE <Text style={styles.requiredStar}>*</Text></Text>
                  <TextInput
                    style={[styles.createInput, !!createErrors.firstName && styles.editInputError]}
                    value={createFirstName}
                    onChangeText={(v) => { setCreateFirstName(v); setCreateErrors((p) => { const n = { ...p }; delete n.firstName; return n; }); }}
                    placeholder="Ej. María"
                    placeholderTextColor={colorScales.gray[400]}
                  />
                  {!!createErrors.firstName && <Text style={styles.editErrorText}>{createErrors.firstName}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.createFormLabel}>APELLIDO <Text style={styles.requiredStar}>*</Text></Text>
                  <TextInput
                    style={[styles.createInput, !!createErrors.lastName && styles.editInputError]}
                    value={createLastName}
                    onChangeText={(v) => { setCreateLastName(v); setCreateErrors((p) => { const n = { ...p }; delete n.lastName; return n; }); }}
                    placeholder="Ej. Rodríguez"
                    placeholderTextColor={colorScales.gray[400]}
                  />
                  {!!createErrors.lastName && <Text style={styles.editErrorText}>{createErrors.lastName}</Text>}
                </View>
              </View>

              {/* Teléfono */}
              <View>
                <Text style={styles.createFormLabel}>TELÉFONO</Text>
                <TextInput
                  style={[styles.createInput, !!createErrors.phone && styles.editInputError]}
                  value={createPhone}
                  onChangeText={(v) => { setCreatePhone(v); setCreateErrors((p) => { const n = { ...p }; delete n.phone; return n; }); }}
                  placeholder="+57 300 000 0000"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="phone-pad"
                />
                {!!createErrors.phone && <Text style={styles.editErrorText}>{createErrors.phone}</Text>}
              </View>

              {/* Tipo de documento + Número de documento (row) */}
              <View style={styles.editRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.createFormLabel}>TIPO DE DOCUMENTO</Text>
                  <Pressable
                    style={[styles.createInput, styles.createSelectTrigger]}
                    onPress={() => setShowCreateDocTypeDropdown((v) => !v)}
                  >
                    <Text style={[
                      styles.createSelectText,
                      !createDocumentType && styles.createSelectPlaceholder,
                    ]}>
                      {CREATE_DOCUMENT_TYPES.find((d) => d.value === createDocumentType)?.label
                        || 'Selecciona un tipo'}
                    </Text>
                    <Ionicons
                      name={showCreateDocTypeDropdown ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colorScales.gray[500]}
                    />
                  </Pressable>
                  {showCreateDocTypeDropdown && (
                    <View style={styles.createSelectDropdown}>
                      {CREATE_DOCUMENT_TYPES.map((d) => (
                        <Pressable
                          key={d.value}
                          onPress={() => {
                            setCreateDocumentType(d.value);
                            setShowCreateDocTypeDropdown(false);
                          }}
                          style={[
                            styles.createSelectOption,
                            createDocumentType === d.value && styles.editStateChipActive,
                          ]}
                        >
                          <Text style={[
                            styles.createSelectOptionText,
                            createDocumentType === d.value && styles.editStateChipTextActive,
                          ]}>
                            {d.label}
                          </Text>
                          {createDocumentType === d.value && (
                            <Ionicons name="checkmark" size={16} color={colors.primary} />
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.createFormLabel}>NÚMERO DE DOCUMENTO</Text>
                  <TextInput
                    style={styles.createInput}
                    value={createDocumentNumber}
                    onChangeText={setCreateDocumentNumber}
                    placeholder={createDocumentType ? 'Selecciona primero el tipo' : 'Selecciona primero el tipo'}
                    placeholderTextColor={colorScales.gray[400]}
                    editable={!!createDocumentType}
                  />
                </View>
              </View>

              {/* Régimen tributario + Tipo de persona (row) */}
              <View style={styles.editRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.createFormLabel}>RÉGIMEN TRIBUTARIO</Text>
                  <Pressable
                    style={[styles.createInput, styles.createSelectTrigger]}
                    onPress={() => setShowCreateTaxRegimeDropdown((v) => !v)}
                  >
                    <Text style={[
                      styles.createSelectText,
                      !createTaxRegime && styles.createSelectPlaceholder,
                    ]}>
                      {TAX_REGIME_OPTIONS.find((d) => d.value === createTaxRegime)?.label
                        || 'Seleccionar'}
                    </Text>
                    <Ionicons
                      name={showCreateTaxRegimeDropdown ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colorScales.gray[500]}
                    />
                  </Pressable>
                  {showCreateTaxRegimeDropdown && (
                    <View style={styles.createSelectDropdown}>
                      {TAX_REGIME_OPTIONS.map((d) => (
                        <Pressable
                          key={d.value}
                          onPress={() => {
                            setCreateTaxRegime(d.value);
                            setShowCreateTaxRegimeDropdown(false);
                          }}
                          style={[
                            styles.createSelectOption,
                            createTaxRegime === d.value && styles.editStateChipActive,
                          ]}
                        >
                          <Text style={[
                            styles.createSelectOptionText,
                            createTaxRegime === d.value && styles.editStateChipTextActive,
                          ]}>
                            {d.label}
                          </Text>
                          {createTaxRegime === d.value && (
                            <Ionicons name="checkmark" size={16} color={colors.primary} />
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.createFormLabel}>TIPO DE PERSONA</Text>
                  <Pressable
                    style={[styles.createInput, styles.createSelectTrigger]}
                    onPress={() => setShowCreatePersonTypeDropdown((v) => !v)}
                  >
                    <Text style={[
                      styles.createSelectText,
                      !createPersonType && styles.createSelectPlaceholder,
                    ]}>
                      {PERSON_TYPE_OPTIONS.find((d) => d.value === createPersonType)?.label
                        || 'Seleccionar'}
                    </Text>
                    <Ionicons
                      name={showCreatePersonTypeDropdown ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colorScales.gray[500]}
                    />
                  </Pressable>
                  {showCreatePersonTypeDropdown && (
                    <View style={styles.createSelectDropdown}>
                      {PERSON_TYPE_OPTIONS.map((d) => (
                        <Pressable
                          key={d.value}
                          onPress={() => {
                            setCreatePersonType(d.value);
                            setShowCreatePersonTypeDropdown(false);
                          }}
                          style={[
                            styles.createSelectOption,
                            createPersonType === d.value && styles.editStateChipActive,
                          ]}
                        >
                          <Text style={[
                            styles.createSelectOptionText,
                            createPersonType === d.value && styles.editStateChipTextActive,
                          ]}>
                            {d.label}
                          </Text>
                          {createPersonType === d.value && (
                            <Ionicons name="checkmark" size={16} color={colors.primary} />
                          )}
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              {/* Agente de retención */}
              <Pressable
                style={styles.toggleRow}
                onPress={() => setCreateIsWithholdingAgent((v) => !v)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.createFormLabel}>AGENTE DE RETENCIÓN</Text>
                  <Text style={styles.toggleHint}>Responsable de retener impuestos en compras</Text>
                </View>
                <View style={[
                  styles.toggle,
                  createIsWithholdingAgent && styles.toggleActive,
                ]}>
                  <View style={[
                    styles.toggleThumb,
                    createIsWithholdingAgent && styles.toggleThumbActive,
                  ]} />
                </View>
              </Pressable>
            </ScrollView>

            {/* Footer: Cancelar + Crear — estilo web */}
            <View style={styles.createFooter}>
              <Pressable style={styles.cancelBtn} onPress={closeCreateModal}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </Pressable>
              <View style={styles.actionSpacer} />
              <Pressable
                style={[styles.confirmBtn, createMutation.isPending && styles.confirmBtnDisabled]}
                onPress={handleSubmitCreate}
                disabled={createMutation.isPending}
              >
                <Text style={styles.confirmBtnText}>
                  {createMutation.isPending ? 'Creando...' : 'Crear'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal Carga Masiva de Clientes — wizard 3 pasos */}
      <CustomerBulkUploadModal
        visible={showBulkUpload}
        onClose={() => setShowBulkUpload(false)}
        onUploadComplete={() => {
          queryClient.invalidateQueries({ queryKey: ['customers'] });
          queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
  },
  headerSection: {
    backgroundColor: 'transparent',
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  title: {
    fontSize: 13,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[600],
    marginTop: spacing[3],
    marginBottom: spacing[2],
    paddingHorizontal: spacing[4],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    minHeight: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  searchIcon: { marginRight: spacing[2] },
  searchInputField: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
    padding: 0,
    height: '100%',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  /* === Modales Ver / Editar — estilo web (mismo patrón que locations.tsx createModal) === */
  createModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing[4],
  },
  createModal: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: '100%',
    maxWidth: 520,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  createHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  createHeaderText: { flex: 1 },
  createTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  createSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  createCloseBtn: { padding: spacing[1] },
  createBody: { flexGrow: 0, flexShrink: 1, maxHeight: 480 },
  createBodyContent: { padding: spacing[4], gap: spacing[3] },
  createFooter: {
    flexDirection: 'row',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
    gap: spacing[2],
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.gray[900],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.bold as any,
    color: colors.background,
  },
  actionSpacer: { width: spacing[3] },
  confirmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnDisabled: { backgroundColor: colorScales.gray[100] },
  confirmBtnText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.green[800],
  },

  /* Modal Ver — header con avatar + nombre + status + grid de detalles */
  viewProfileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingBottom: spacing[2],
  },
  viewAvatar: {
    width: 56,
    height: 56,
  },
  viewName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  viewEmail: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  viewStatusBadge: {
    alignSelf: 'flex-start',
    marginTop: spacing[1],
    paddingHorizontal: spacing[2.5],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  viewStatusBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  viewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  viewGridItem: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 126,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  viewGridLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  viewGridLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  viewGridValue: {
    marginTop: 2,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[800],
  },

  /* Modal Editar — form */
  editRow: { flexDirection: 'row', gap: spacing[3] },
  editFormLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginBottom: spacing[1.5],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  editInput: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: 14,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
    fontFamily: typography.fontFamily,
  },
  editInputError: { borderColor: colorScales.red[500] },
  editErrorText: {
    fontSize: 11,
    color: colorScales.red[600],
    marginTop: spacing[1],
  },
  editStateRow: { flexDirection: 'row', gap: spacing[2] },
  editStateChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  editStateChipActive: {
    backgroundColor: colorScales.green[50],
    borderColor: colorScales.green[500],
  },
  editStateChipText: {
    fontSize: 13,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  editStateChipTextActive: {
    color: colors.primary,
    fontWeight: typography.fontWeight.bold as any,
  },

  /* Modal Nuevo Cliente — form con campos de la imagen */
  createFormLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    marginBottom: spacing[1.5],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  requiredStar: { color: colorScales.red[500] },
  createInput: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: 14,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
    fontFamily: typography.fontFamily,
  },
  createSelectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
  },
  createSelectText: {
    flex: 1,
    fontSize: 14,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  createSelectPlaceholder: { color: colorScales.gray[400] },
  createSelectDropdown: {
    marginTop: spacing[1],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  createSelectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  createSelectOptionText: {
    fontSize: 14,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },

  /* === Filter popup (estilo web options-dropdown) === */
  filterPopup: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    width: 220,
    ...shadows.lg,
    overflow: 'hidden',
  },
  filterPopupHeader: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  filterPopupTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  filterPopupBody: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  filterPopupLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  filterPopupSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  filterPopupSelectText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[800],
  },
  filterPopupOptionsList: {
    marginTop: spacing[1],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  filterPopupOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  filterPopupOptionActive: {
    backgroundColor: colorScales.green[50],
  },
  filterPopupOptionText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  filterPopupOptionTextActive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  filterPopupActionsDivider: {
    height: 1,
    backgroundColor: colorScales.gray[100],
  },
  filterPopupActions: {
    paddingVertical: spacing[1],
  },
  listContent: {
    paddingBottom: spacing[6],
  },
  separator: {
    height: spacing[3],
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingVertical: spacing[4],
  },
  pageBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
  },
  pageBtnDisabled: {
    opacity: 0.4,
  },
  pageNumBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pageNumBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pageNumText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    color: colorScales.gray[700],
  },
  pageNumTextActive: {
    color: colors.background,
  },
  pageDots: {
    width: 36,
    textAlign: 'center',
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[400],
  },

  /* === Customer card — estilo web: top row (avatar + nombre/email + badge) + grid (4 details) + footer (total + 3 acciones) === */
  customerCard: {
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
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[4],
    paddingBottom: spacing[2],
  },
  cardMedia: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardAvatar: {
    width: 44,
    height: 44,
  },
  cardCenter: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  cardEmail: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  cardStatusBadge: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  cardStatusBadgeText: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  cardDetailsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  cardDetailsRow3: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
  },
  cardDetailsRow2: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  cardDetailItemThird: {
    flex: 1,
    minWidth: 0,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[2],
  },
  cardDetailItemHalf: {
    flex: 1,
    minWidth: 0,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  cardDetailItem: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 126,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[50],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  cardDetailLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  cardDetailLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardDetailValue: {
    marginTop: 2,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[800],
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[100],
    backgroundColor: colorScales.gray[50],
  },
  cardFooterLeft: {
    gap: 2,
  },
  cardFooterLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardFooterValue: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  cardActionView: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionEdit: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.blue[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionMore: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Dropdown de acciones (popup "Eliminar") — mismo estilo que locations.tsx */
  dropdownBackdrop: { flex: 1 },
  dropdownPositioner: { position: 'absolute', alignItems: 'flex-end' },
  dropdownArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: colors.background,
    marginRight: 14,
    marginBottom: -1,
  },
  dropdown: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    minWidth: 200,
    ...shadows.lg,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
  },
  dropdownItemText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[700],
  },
  dropdownItemPrimary: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  dropdownIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: colorScales.gray[100],
  },
  dropdownItemDanger: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.red[600],
  },

  /* Toggle (agente de retención) */
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
  },
  toggleHint: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: colorScales.gray[300],
    padding: 2,
    justifyContent: 'center',
  },
  toggleActive: {
    backgroundColor: colors.primary,
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.background,
    alignSelf: 'flex-start',
  },
  toggleThumbActive: {
    alignSelf: 'flex-end',
  },
});
