import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { OrgDomainsService } from '@/features/org/services/org-domains.service';
import type { Domain, DomainOwnership, DomainStats, DomainStatus } from '@/core/models/org-admin/domains.types';
import { PENDING_PROVISIONING_STATUSES } from '@/core/models/org-admin/domains.types';
import type { DomainOwnership as OwnershipEnum } from '@/core/models/org-admin/domains.types';
import { DomainCreateModal } from '@/features/org/components/domain-create-modal';
import { DomainEditModal } from '@/features/org/components/domain-edit-modal';
import { DomainVerifyModal } from '@/features/org/components/domain-verify-modal';
import { DomainDeleteModal } from '@/features/org/components/domain-delete-modal';
import { DomainFiltersModal } from '@/features/org/components/domain-filters-modal';
import { DomainRowCard } from '@/features/org/components/domain-row-card';
import type { DomainFilters } from '@/features/org/components/domain-filters.types';
import { EMPTY_FILTERS, hasActiveFilters } from '@/features/org/components/domain-filters.types';
import { Icon } from '@/shared/components/icon/icon';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { RowActionsMenu, type RowAction } from '@/shared/components/row-actions-menu/row-actions-menu';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';

type SortKey = 'hostname-asc' | 'hostname-desc' | 'created-desc' | 'created-asc';

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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>('hostname-asc');
  const [refreshing, setRefreshing] = useState(false);

  // ───── Modales por fila ─────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Domain | null>(null);
  const [verifying, setVerifying] = useState<Domain | null>(null);
  const [deleting, setDeleting] = useState<Domain | null>(null);

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
  const verifyMutation = useMutation({
    mutationFn: (hostname: string) => OrgDomainsService.verify(hostname),
    onSuccess: (r) => {
      if (r.verified) {
        queryClient.invalidateQueries({ queryKey: ['org-domains-list'] });
        queryClient.invalidateQueries({ queryKey: ['org-domains-stats'] });
        toastSuccess('Propiedad verificada. Certificado pendiente de emisión.');
      } else {
        toastError(r.message ?? 'No se pudo verificar');
      }
    },
    onError: () => toastError('Error al verificar el dominio'),
  });

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
            filtersActive={hasActiveFilters(filters)}
            onOpenFilters={() => setFiltersOpen(true)}
            onCreate={() => setCreateOpen(true)}
            onRefresh={onRefresh}
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

      {/* Modales */}
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
          verifyMutation.mutate(verifying!.hostname);
          setVerifying(null);
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
      <DomainFiltersModal
        visible={filtersOpen}
        initial={filters}
        onClose={() => setFiltersOpen(false)}
        onApply={setFilters}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

interface ListHeaderProps {
  stats?: DomainStats;
  count: number;
  search: string;
  onSearchChange: (v: string) => void;
  filtersActive: boolean;
  onOpenFilters: () => void;
  onCreate: () => void;
  onRefresh: () => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
}

function ListHeader({
  stats,
  count,
  search,
  onSearchChange,
  filtersActive,
  onOpenFilters,
  onCreate,
  onRefresh,
  sort,
  onSortChange,
}: ListHeaderProps) {
  const [sortOpen, setSortOpen] = useState(false);

  const sortLabel: Record<SortKey, string> = {
    'hostname-asc': 'Hostname A-Z',
    'hostname-desc': 'Hostname Z-A',
    'created-desc': 'Más recientes',
    'created-asc': 'Más antiguos',
  };

  return (
    <View>
      <View style={styles.statsWrap}>
        <OrgStatsGrid
          columns={2}
          stats={[
            {
              label: 'Total Dominios',
              value: stats?.total ?? 0,
              icon: 'globe',
              color: colors.primary,
              subText: 'Registrados',
            },
            {
              label: 'Activos',
              value: stats?.active ?? 0,
              icon: 'check-circle',
              color: colorScales.green[500],
              subText: 'En funcionamiento',
            },
            {
              label: 'Pendientes',
              value: stats?.pending ?? 0,
              icon: 'clock',
              color: colorScales.amber[500],
              subText: 'Verificación DNS/SSL',
            },
            {
              label: 'SSL Activo',
              value: stats?.verified ?? 0,
              icon: 'shield-check',
              color: colorScales.blue[500],
              subText: 'Certificados emitidos',
            },
          ]}
        />
      </View>

      {/* Title row */}
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.titleMain}>
            Dominios{' '}
            <Text style={styles.titleCountInline}>({count})</Text>
          </Text>
        </View>
        <RowActionsMenu
          actions={[
            { key: 'create', label: 'Nuevo dominio', icon: 'plus', variant: 'primary', onPress: onCreate },
            { key: 'refresh', label: 'Actualizar', icon: 'refresh-cw', variant: 'default', onPress: onRefresh },
          ]}
          accessibilityLabel="Acciones de la lista"
        />
      </View>

      {/* Search + filter + sort */}
      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <SearchBar
            value={search}
            onChangeText={onSearchChange}
            placeholder="Buscar dominios..."
          />
        </View>
        <Pressable
          style={[styles.filterBtn, filtersActive && styles.filterBtnActive]}
          onPress={onOpenFilters}
        >
          <Icon
            name="sliders-horizontal"
            size={18}
            color={filtersActive ? '#FFFFFF' : colorScales.gray[700]}
          />
          {filtersActive ? <View style={styles.filterDot} /> : null}
        </Pressable>
        <Pressable
          style={styles.filterBtn}
          onPress={() => setSortOpen((v) => !v)}
        >
          <Icon name="arrow-up-down" size={18} color={colorScales.gray[700]} />
        </Pressable>
      </View>

      {sortOpen ? (
        <View style={styles.sortDropdown}>
          {(Object.keys(sortLabel) as SortKey[]).map((k) => (
            <Pressable
              key={k}
              style={[styles.sortItem, sort === k && styles.sortItemActive]}
              onPress={() => {
                onSortChange(k);
                setSortOpen(false);
              }}
            >
              <Text style={[styles.sortText, sort === k && styles.sortTextActive]}>
                {sortLabel[k]}
              </Text>
              {sort === k ? <Icon name="check" size={14} color={colors.primary} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {filtersActive ? (
        <Text style={styles.filterMeta}>Filtros activos · tocas el ícono de filtros para ajustar</Text>
      ) : null}
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
  },
  loading: {
    paddingVertical: spacing[12],
    alignItems: 'center',
  },
  statsWrap: {
    marginBottom: spacing[3],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[1],
    marginBottom: spacing[2],
  },
  // Espejo del `<h2 class="text-[13px] font-bold text-gray-600 tracking-wide">`
  // que usa la web en su bloque sticky `top-[99px]`.
  titleMain: {
    fontSize: 13,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[600],
    letterSpacing: 1.5,
  },
  titleCountInline: {
    fontSize: 13,
    fontWeight: typography.fontWeight.normal,
    color: colorScales.gray[500],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    position: 'relative',
  },
  filterBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colorScales.amber[400],
  },
  sortDropdown: {
    marginBottom: spacing[3],
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  sortItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  sortItemActive: { backgroundColor: colorScales.green[50] },
  sortText: { fontSize: typography.fontSize.sm, color: colorScales.gray[700] },
  sortTextActive: { color: colors.primary, fontWeight: typography.fontWeight.semibold },
  filterMeta: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    paddingHorizontal: spacing[1],
    marginBottom: spacing[3],
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[24],
  },
  separator: { height: spacing[1] },
});
