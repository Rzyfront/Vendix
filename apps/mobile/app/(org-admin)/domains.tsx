import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  Text,
  View,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { OrgDomainsService } from '@/features/org/services/org-domains.service';
import { OrgStoreService } from '@/features/org/services/org-store.service';
import type { StoreListItem } from '@/core/models/org-admin/store.types';
import type { Domain, DomainOwnership, DomainStats, DomainStatus } from '@/core/models/org-admin/domains.types';
import { PENDING_PROVISIONING_STATUSES } from '@/core/models/org-admin/domains.types';
import { DomainCreateModal } from '@/features/org/components/domain-create-modal';
import { DomainEditModal } from '@/features/org/components/domain-edit-modal';
import { DomainVerifyModal } from '@/features/org/components/domain-verify-modal';
import { DomainDeleteModal } from '@/features/org/components/domain-delete-modal';
import { DomainRowCard } from '@/features/org/components/domain-row-card';
import { DOMAIN_OWNERSHIP_OPTIONS, DOMAIN_STATUS_OPTIONS } from '@/features/org/components/domain-formatters';
import type { DomainFilters } from '@/features/org/components/domain-filters.types';
import { EMPTY_FILTERS, hasActiveFilters } from '@/features/org/components/domain-filters.types';
import { Icon } from '@/shared/components/icon/icon';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { type RowAction } from '@/shared/components/row-actions-menu/row-actions-menu';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import {
  OptionsDropdown,
  type FilterConfig,
  type FilterValues,
} from '@/shared/components/options-dropdown';
import { borderRadius, colorScales, colors, spacing, typography, interFonts } from '@/shared/theme';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';

type SortKey = 'hostname-asc' | 'hostname-desc' | 'created-desc' | 'created-asc';

// Ancho de pantalla cacheado — usado para posicionar el popover de sort
// anclado al trigger (no se puede calcular dentro del useMemo porque
// `Dimensions.get` no es estable entre renders).
const SCREEN_WIDTH_SORT = Dimensions.get('window').width;

/**
 * Pantalla principal de ORG_ADMIN Dominios.
 *
 * Paridad con `domains.component.ts` de la web:
 *   - Stats grid con subText (Registrados / En funcionamiento / Verificación DNS/SSL / Certificados emitidos)
 *   - Título "Dominios (N)" + búsqueda + filtro dropdown + acciones dropdown
 *   - Cards por dominio con badges inline (status + app_type + ownership + SSL + Primario + fecha)
 *   - Menú 3 puntos por fila: Editar / Verificar DNS / Provisionar / Eliminar
 *   - Polling cada 15s mientras haya dominios en estados de aprovisionamiento.
 *
 * La pantalla de detalle NO existe (igual que en la web) — toda la interacción
 * ocurre en la fila a través del menú de acciones.
 */
export default function DomainsScreen() {
  const queryClient = useQueryClient();

  // ───── Filtros / búsqueda / sort ────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<DomainFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>('hostname-asc');
  const [refreshing, setRefreshing] = useState(false);

  // ───── Modales por fila ─────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Domain | null>(null);
  const [verifying, setVerifying] = useState<Domain | null>(null);
  const [deleting, setDeleting] = useState<Domain | null>(null);

  // ───── Modales del header (espejo del patrón users/stores) ─────────────────
  const [actionsModalOpen, setActionsModalOpen] = useState(false);

  // ───── Datos ───────────────────────────────────────────────────────────────
  const { data: domains = [], isLoading, refetch } = useQuery({
    queryKey: ['org-domains-list', filters.status, filters.ownership, filters.storeId, search],
    queryFn: () =>
      OrgDomainsService.list({
        limit: 200,
        ...(search ? { search } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.ownership ? { ownership: filters.ownership } : {}),
        ...(filters.storeId === '__organization__' ? { store_id: '__organization__' } : {}),
        ...(filters.storeId && filters.storeId !== '__organization__' ? { store_id: filters.storeId } : {}),
      }),
    refetchInterval: (query) => {
      const rows = (query.state.data as Domain[] | undefined) ?? [];
      const hasPending = rows.some((d) => PENDING_PROVISIONING_STATUSES.has(d.status));
      return hasPending ? 15000 : false;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['org-domains-stats'],
    queryFn: () => OrgDomainsService.stats(),
  });

  // Tiendas para alimentar el filtro "Tienda" del OptionsDropdown.
  // Reemplaza la carga que antes hacía DomainFiltersModal — ahora el filtro
  // vive dentro del mismo popover, pero los datos se cachean a nivel de
  // pantalla con useQuery para evitar recargas cada vez que se abre.
  const storesQuery = useQuery({
    queryKey: ['org-stores-list-for-domains-filter'],
    queryFn: () => OrgStoreService.list({ pageSize: 200 }).then((r) => r.data ?? []),
    staleTime: 5 * 60 * 1000, // 5 min — la lista de tiendas no cambia en cada interacción.
  });
  const stores = useMemo<StoreListItem[]>(() => storesQuery.data ?? [], [storesQuery.data]);

  // ───── Filtros del header (popover tipo web, NO modal) ───────────────────
  // El `<app-options-dropdown>` de la web se colapsa a un popover anclado
  // al trigger en mobile. Usamos el `OptionsDropdown` shared con
  // `showActions={false}` (solo muestra el trigger de filtros).
  const filterConfigs = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status',
        label: 'Estado',
        type: 'select',
        options: [
          { value: '', label: 'Todos' },
          ...DOMAIN_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
        ],
      },
      {
        key: 'ownership',
        label: 'Tipo',
        type: 'select',
        options: [
          { value: '', label: 'Todos' },
          ...DOMAIN_OWNERSHIP_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
        ],
      },
      {
        key: 'storeId',
        label: 'Tienda',
        type: 'select',
        options: [
          { value: '', label: 'Todas' },
          { value: '__organization__', label: 'Organización' },
          ...stores.map((s) => ({ value: String(s.id), label: s.name })),
        ],
      },
    ],
    [stores],
  );

  // Mapea DomainFilters → FilterValues para el OptionsDropdown.
  // Empty string `''` se transforma a `null` para que el popover sepa que
  // el filtro está "sin valor" (y pueda mostrar el check del primer option).
  const filterValues = useMemo<FilterValues>(
    () => ({
      status: filters.status || null,
      ownership: filters.ownership || null,
      storeId: filters.storeId || null,
    }),
    [filters],
  );

  const handleFilterChange = useCallback((values: FilterValues) => {
    setFilters({
      status: ((values.status as DomainStatus | null) ?? '') as DomainStatus | '',
      ownership: ((values.ownership as DomainOwnership | null) ?? '') as DomainOwnership | '',
      storeId: (values.storeId as string | null) ?? '',
    });
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
  }, []);

  // Bandera para mostrar el badge rojo en el trigger de filtros
  const activeFilterCount = !!(filters.status || filters.ownership || filters.storeId);

  // ───── Ordenamiento ────────────────────────────────────────────────────────
  const sortedDomains = useMemo(() => {
    const arr = [...domains];
    switch (sort) {
      case 'hostname-asc':
        arr.sort((a, b) => a.hostname.localeCompare(b.hostname));
        break;
      case 'hostname-desc':
        arr.sort((a, b) => b.hostname.localeCompare(a.hostname));
        break;
      case 'created-desc':
        arr.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
        break;
      case 'created-asc':
        arr.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
        break;
    }
    return arr;
  }, [domains, sort]);

  // ───── Mutations ───────────────────────────────────────────────────────────
  // NOTA: la verificación de DNS se ejecuta dentro del DomainVerifyModal
  // (muestra resultado inline + tabla de records DNS). El parent solo
  // invalida queries cuando `onVerified` se dispara — ver M3 fix en
  // <DomainVerifyModal onVerified={...}> más abajo.

  const provisionMutation = useMutation({
    mutationFn: (id: string) => OrgDomainsService.provisionNextById(id),
    onSuccess: () => {
      toastSuccess('Provisioning actualizado');
      queryClient.invalidateQueries({ queryKey: ['org-domains-list'] });
    },
    onError: () => toastError('Error al provisionar el dominio'),
  });

  const deleteMutation = useMutation({
    mutationFn: (hostname: string) => OrgDomainsService.remove(hostname),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-domains-list'] });
      queryClient.invalidateQueries({ queryKey: ['org-domains-stats'] });
      toastSuccess('Dominio eliminado');
      setDeleting(null);
    },
    onError: () => toastError('No se pudo eliminar el dominio'),
  });

  const renewSslMutation = useMutation({
    mutationFn: (id: string) => OrgDomainsService.renewSsl(id),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['org-domains-list'] });
      if (r.renewed) toastSuccess('Certificado SSL renovado');
      else toastError(r.message ?? 'No se pudo renovar el certificado');
    },
    onError: () => toastError('Error al renovar SSL'),
  });

  // ───── Handlers ────────────────────────────────────────────────────────────
  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  // ───── Helpers de dominio ─────────────────────────────────────────────────
  const canVerifyDomain = (d: Domain) =>
    d.ownership === 'CUSTOM_DOMAIN' || d.ownership === 'CUSTOM_SUBDOMAIN';

  const canProvisionDomain = (d: Domain) =>
    canVerifyDomain(d) && d.last_verified_at != null && d.status !== 'ACTIVE' && d.status !== 'FAILED_OWNERSHIP';

  const rowActionsFor = (domain: Domain): RowAction[] => {
    const actions: RowAction[] = [
      {
        key: 'edit',
        label: 'Editar',
        icon: 'edit',
        variant: 'info',
        onPress: () => setEditing(domain),
      },
    ];
    if (canVerifyDomain(domain)) {
      actions.push({
        key: 'verify',
        label: 'Verificar DNS',
        icon: 'shield-check',
        variant: 'secondary',
        onPress: () => setVerifying(domain),
      });
    }
    if (canProvisionDomain(domain)) {
      actions.push({
        key: 'provision',
        label: 'Provisionar',
        icon: 'refresh-cw',
        variant: 'warning',
        onPress: () => provisionMutation.mutate(String(domain.id)),
      });
    }
    if (domain.ssl_status && domain.certificate_id) {
      actions.push({
        key: 'ssl',
        label: 'Renovar SSL',
        icon: 'shield',
        variant: 'default',
        onPress: () => renewSslMutation.mutate(String(domain.id)),
      });
    }
    if (!domain.is_primary) {
      actions.push({
        key: 'delete',
        label: 'Eliminar',
        icon: 'trash-2',
        variant: 'danger',
        destructive: true,
        onPress: () => setDeleting(domain),
      });
    }
    return actions;
  };

  // ───── Render ──────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <FlatList
        data={sortedDomains}
        keyExtractor={(d) => String(d.id)}
        ListHeaderComponent={
          <ListHeader
            stats={stats}
            count={sortedDomains.length}
            search={search}
            onSearchChange={setSearch}
            onActionsPress={() => setActionsModalOpen(true)}
            filterConfigs={filterConfigs}
            filterValues={filterValues}
            onFilterChange={handleFilterChange}
            onClearAllFilters={handleClearAllFilters}
            activeFilterCount={activeFilterCount}
            sort={sort}
            onSortChange={setSort}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : search || hasActiveFilters(filters) ? (
            <EmptyState
              icon="filter"
              title="No se encontraron dominios"
              description="Intenta ajustar los filtros de búsqueda"
              actionLabel="Limpiar filtros"
              onAction={() => {
                setSearch('');
                setFilters(EMPTY_FILTERS);
              }}
            />
          ) : (
            <EmptyState
              icon="globe"
              title="No hay dominios registrados"
              description="Comienza creando tu primer dominio para tu organización o tiendas."
              actionLabel="Crear dominio"
              onAction={() => setCreateOpen(true)}
            />
          )
        }
        renderItem={({ item }) => (
          <DomainRowCard domain={item} actions={rowActionsFor(item)} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        contentContainerStyle={styles.listContent}
      />

      {/* ── Modales por fila (espejo del patrón users/stores) ────────── */}
      <DomainCreateModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          refetch();
        }}
      />
      <DomainEditModal
        visible={!!editing}
        domain={editing}
        onClose={() => setEditing(null)}
        onUpdated={() => {
          refetch();
          toastSuccess('Dominio actualizado');
        }}
      />
      <DomainVerifyModal
        visible={!!verifying}
        domain={verifying}
        onClose={() => setVerifying(null)}
        onVerified={() => {
          // M3 fix: la verificación ya se ejecutó dentro del modal y mostró
          // el resultado inline. NO re-llamar al endpoint acá para evitar
          // doble toast + doble invalidación. Solo refrescar la lista.
          setVerifying(null);
          queryClient.invalidateQueries({ queryKey: ['org-domains-list'] });
          queryClient.invalidateQueries({ queryKey: ['org-domains-stats'] });
        }}
      />
      <DomainDeleteModal
        visible={!!deleting}
        hostname={deleting?.hostname ?? null}
        isPrimary={deleting?.is_primary}
        loading={deleteMutation.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting && !deleting.is_primary) deleteMutation.mutate(deleting.hostname);
        }}
      />

      {/* ── Modales del header (espejo del patrón users/stores) ──────── */}

      {/* Actions Modal — Nuevo dominio + Actualizar (paridad 1:1 con users). */}
      <OrgCenteredModal
        visible={actionsModalOpen}
        onClose={() => setActionsModalOpen(false)}
        title="Acciones"
        subtitle="¿Qué quieres hacer con la lista de dominios?"
        size="sm"
      >
        <View style={styles.actionsModalList}>
          <Pressable
            style={styles.actionsModalOption}
            onPress={() => {
              setActionsModalOpen(false);
              setCreateOpen(true);
            }}
          >
            <View style={[styles.actionsModalIconWrap, { backgroundColor: colors.primary + '15' }]}>
              <Icon name="plus" size={16} color={colors.primary} />
            </View>
            <View style={styles.actionsModalTextWrap}>
              <Text style={styles.actionsModalOptionTitle}>Nuevo dominio</Text>
              <Text style={styles.actionsModalOptionHint}>
                Crear un nuevo dominio para la organización o una tienda
              </Text>
            </View>
          </Pressable>

          <Pressable
            style={styles.actionsModalOption}
            onPress={() => {
              setActionsModalOpen(false);
              onRefresh();
            }}
          >
            <View style={[styles.actionsModalIconWrap, { backgroundColor: colorScales.gray[100] }]}>
              <Icon name="refresh-cw" size={16} color={colorScales.gray[700]} />
            </View>
            <View style={styles.actionsModalTextWrap}>
              <Text style={styles.actionsModalOptionTitle}>Actualizar</Text>
              <Text style={styles.actionsModalOptionHint}>
                Recargar la lista con los últimos cambios
              </Text>
            </View>
          </Pressable>
        </View>
      </OrgCenteredModal>

      {/* Filters ya no es un modal: vive dentro del popover del `OptionsDropdown`
          (espejo del `<app-options-dropdown>` web mobile responsive).
          Sort tampoco es un modal: vive en su propio popover anclado al trigger
          dentro del `ListHeader`. */}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header — espejo del patrón users/stores (tableCard + titleRow + searchRow)
// ─────────────────────────────────────────────────────────────────────────────

interface ListHeaderProps {
  stats?: DomainStats;
  count: number;
  search: string;
  onSearchChange: (v: string) => void;
  onActionsPress: () => void;
  filterConfigs: FilterConfig[];
  filterValues: FilterValues;
  onFilterChange: (values: FilterValues) => void;
  onClearAllFilters: () => void;
  activeFilterCount: boolean;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
}

function ListHeader({
  stats,
  count,
  search,
  onSearchChange,
  onActionsPress,
  filterConfigs,
  filterValues,
  onFilterChange,
  onClearAllFilters,
  activeFilterCount,
  sort,
  onSortChange,
}: ListHeaderProps) {
  const [sortOpen, setSortOpen] = useState(false);
  const [sortTriggerPos, setSortTriggerPos] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const sortTriggerRef = useRef<View>(null);

  const sortLabel: Record<SortKey, string> = {
    'hostname-asc': 'Hostname A-Z',
    'hostname-desc': 'Hostname Z-A',
    'created-desc': 'Más recientes',
    'created-asc': 'Más antiguos',
  };

  // Abre el popover de sort anclado al trigger (mismo patrón que
  // `RowActionsMenu` — measureInWindow + Modal fullscreen).
  const openSortPopover = () => {
    const node = sortTriggerRef.current;
    if (!node) return;
    node.measureInWindow((x, y, width, height) => {
      setSortTriggerPos({ x, y, width, height });
      setSortOpen(true);
    });
  };

  // Posición del popover: alineado a la derecha del trigger (se expande
  // hacia la izquierda) — espejo del `<app-options-dropdown>` web mobile.
  const sortPopoverPosition = useMemo(() => {
    if (!sortTriggerPos) return null;
    const width = 200;
    let left = sortTriggerPos.x + sortTriggerPos.width - width;
    if (left < 12) left = 12;
    if (left + width > SCREEN_WIDTH_SORT - 12) left = SCREEN_WIDTH_SORT - width - 12;
    const top = sortTriggerPos.y + sortTriggerPos.height + 4;
    return { top, left, width };
  }, [sortTriggerPos]);

  return (
    <View>
      {/* Stats — espejo del bloque `stats-container` web */}
      <View style={styles.statsWrap}>
        <StatsGrid
          items={[
            {
              label: 'Total Dominios',
              value: stats?.total ?? 0,
              icon: 'globe',
              iconColor: colors.primary,
              iconBg: colors.primary + '15',
              description: 'Registrados',
            },
            {
              label: 'Activos',
              value: stats?.active ?? 0,
              icon: 'check-circle',
              iconColor: colorScales.green[500],
              iconBg: colorScales.green[500] + '15',
              description: 'En funcionamiento',
            },
            {
              label: 'Pendientes',
              value: stats?.pending ?? 0,
              icon: 'clock',
              iconColor: colorScales.amber[500],
              iconBg: colorScales.amber[500] + '15',
              description: 'Verificación DNS/SSL',
            },
            {
              label: 'SSL Activo',
              value: stats?.verified ?? 0,
              icon: 'shield-check',
              iconColor: colorScales.blue[500],
              iconBg: colorScales.blue[500] + '15',
              description: 'Certificados emitidos',
            },
          ]}
        />
      </View>

      {/* ── Table card header (paridad 1:1 con users/stores) ─────────── */}
      <View style={styles.tableHeader}>
        <View style={styles.tableTitleRow}>
          <Text style={styles.tableTitle}>
            Dominios{' '}
            <Text style={styles.tableTitleCount}>({count})</Text>
          </Text>
        </View>

        {/* Search + 3 icon-only triggers en UNA sola línea.
            Espejo del `<app-options-dropdown>` web mobile responsive
            (max-width: 1023px): cada trigger es 40x40, primary border, primary icon. */}
        <View style={styles.searchRow}>
          <View style={{ flex: 1 }}>
            <SearchBar
              value={search}
              onChangeText={onSearchChange}
              placeholder="Buscar dominios..."
              style={styles.searchInput}
            />
          </View>
          {/* Actions trigger (+ button) — abre modal con Nuevo dominio/Actualizar */}
          <Pressable
            style={({ pressed }) => [styles.optionsTrigger, pressed && { opacity: 0.85 }]}
            onPress={onActionsPress}
            accessibilityLabel="Abrir acciones"
          >
            <Icon name="plus" size={18} color={colors.primary} />
          </Pressable>
          {/* Filters trigger (espejo del `<app-options-dropdown>` web mobile).
              Usa el `OptionsDropdown` shared con `showActions={false}` para
              que solo se renderice el trigger de filtros; el popover se ancla
              al trigger (NO modal centrado) — paridad 1:1 con la web. */}
          <OptionsDropdown
            showActions={false}
            filters={filterConfigs}
            filterValues={filterValues}
            onFilterChange={onFilterChange}
            onClearAllFilters={onClearAllFilters}
          />
          {/* Sort trigger — abre popover anclado al trigger (mismo patrón
              que `RowActionsMenu`). El popover se renderiza en un Modal
              fullscreen con posicionamiento por measureInWindow. */}
          <Pressable
            ref={sortTriggerRef}
            style={({ pressed }) => [styles.optionsTrigger, pressed && { opacity: 0.85 }]}
            onPress={openSortPopover}
            accessibilityLabel="Ordenar"
          >
            <Icon name="arrow-up-down" size={16} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      {/* Sort popover — anclado al trigger (paridad web mobile). */}
      <Modal
        visible={sortOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortOpen(false)}
        statusBarTranslucent
      >
        <Pressable style={styles.sortBackdrop} onPress={() => setSortOpen(false)}>
          {sortPopoverPosition ? (
            <Pressable
              style={[
                styles.sortPopover,
                { top: sortPopoverPosition.top, left: sortPopoverPosition.left, width: sortPopoverPosition.width },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.sortPopoverHeader}>
                <Text style={styles.sortPopoverHeaderTitle}>Ordenar por</Text>
              </View>
              <View style={styles.sortPopoverList}>
                {(Object.keys(sortLabel) as SortKey[]).map((k) => {
                  const isActive = sort === k;
                  return (
                    <Pressable
                      key={k}
                      style={[styles.sortPopoverItem, isActive && styles.sortPopoverItemActive]}
                      onPress={() => {
                        onSortChange(k);
                        setSortOpen(false);
                      }}
                    >
                      <Text style={[styles.sortPopoverItemText, isActive && styles.sortPopoverItemTextActive]}>
                        {sortLabel[k]}
                      </Text>
                      {isActive ? <Icon name="check" size={14} color={colors.primary} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
    paddingHorizontal: spacing[4],
  },
  loading: {
    paddingVertical: spacing[12],
    alignItems: 'center',
  },
  statsWrap: {
    marginHorizontal: -spacing[4],
    marginBottom: spacing[3],
  },

  // ── Table card header (paridad 1:1 con users/stores) ──────────────
  tableHeader: {
    backgroundColor: '#fff',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    marginBottom: spacing[3],
  },
  tableTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  // Espejo del `<h2 class="text-lg font-semibold text-text-primary">` web
  tableTitle: {
    fontSize: typography.fontSize.lg,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
    flexShrink: 1,
  },
  // El count "(N)" hereda el tamaño del title pero con color secundario
  tableTitleCount: {
    fontFamily: interFonts.regular,
    color: colorScales.gray[400],
  },
  // Search + 3 triggers en UNA sola fila (paridad con users/stores)
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  // Espejo del `.inputsearch-wrapper-modern` web mobile (40px, 12px radius)
  searchInput: {
    width: '100%',
    height: 40,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
  },
  // Espejo del `.options-dropdown-trigger` web mobile responsive (40x40,
  // primary border, primary icon, 12px radius). Usado para los 3 triggers.
  optionsTrigger: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  optionsTriggerBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsTriggerBadgeText: {
    fontSize: 10,
    fontFamily: interFonts.bold,
    color: '#FFFFFF',
    lineHeight: 12,
  },

  // ── Sort popover (espejo del `.options-dropdown-content` web mobile) ──
  // El popover se ancla al trigger; el `Modal` fullscreen con
  // `Pressable` backdrop cierra el popover al tocar fuera.
  // Usamos `position: 'absolute' + top/left/right/bottom: 0` en el backdrop
  // para forzar que llene toda la pantalla (RN Modal a veces no estira un
  // child con solo `flex: 1`, dejándolo en el centro). Sin esto, el popover
  // absolute se renderiza relativo al content area contraído del Modal.
  sortBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  sortPopover: {
    position: 'absolute',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    // Sombra estilo web (tailwind shadow-lg).
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 6,
  },
  sortPopoverHeader: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    backgroundColor: colorScales.gray[50],
  },
  sortPopoverHeaderTitle: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[600],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  sortPopoverList: {
    paddingVertical: spacing[1],
  },
  sortPopoverItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  sortPopoverItemActive: {
    backgroundColor: colorScales.green[50],
  },
  sortPopoverItemText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.regular,
    color: colorScales.gray[700],
  },
  sortPopoverItemTextActive: {
    color: colors.primary,
    fontFamily: interFonts.semibold,
  },

  // ── Actions Modal (espejo del `<app-options-dropdown>` web) ───────
  actionsModalList: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: colors.card,
  },
  actionsModalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  actionsModalIconWrap: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionsModalTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  actionsModalOptionTitle: {
    fontSize: typography.fontSize.sm,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
  },
  actionsModalOptionHint: {
    fontSize: typography.fontSize.xs,
    fontFamily: interFonts.regular,
    color: colorScales.gray[500],
    marginTop: 2,
  },

  listContent: {
    paddingTop: spacing[2],
    paddingBottom: spacing[24],
  },
  separator: { height: spacing[1] },
});
