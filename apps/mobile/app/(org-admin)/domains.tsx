import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { OrgDomainsService } from '@/features/org/services/org-domains.service';
import type { Domain, DomainOwnership, DomainStats, DomainStatus } from '@/core/models/org-admin/domains.types';
import { PENDING_PROVISIONING_STATUSES } from '@/core/models/org-admin/domains.types';
import { DomainCreateModal } from '@/features/org/components/domain-create-modal';
import {
  formatOwnership,
  formatStatus,
  getStatusColor,
} from '@/features/org/components/domain-formatters';
import { OrgListItem } from '@/shared/components/org-list-item';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Icon } from '@/shared/components/icon/icon';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

const STATUS_FILTERS: Array<{ label: string; value?: DomainStatus }> = [
  { label: 'Todos' },
  { label: 'Activos', value: 'ACTIVE' },
  { label: 'Pendientes', value: 'PENDING' },
  { label: 'Verificando', value: 'VERIFYING' },
  { label: 'Falló', value: 'FAILED' },
];

const OWNERSHIP_FILTERS: Array<{ label: string; value?: DomainOwnership }> = [
  { label: 'Todos' },
  { label: 'Sub. Vendix', value: 'VENDIX_SUBDOMAIN' },
  { label: 'Personalizado', value: 'CUSTOM_DOMAIN' },
  { label: 'Sub. propio', value: 'CUSTOM_SUBDOMAIN' },
];

/**
 * Pantalla de lista de dominios para ORG_ADMIN.
 *
 * Paridad con `domains.component.ts` de la web:
 *   - Stats grid (total / activos / pendientes / verificados).
 *   - Búsqueda por hostname + filtros por status y ownership.
 *   - Lista con badge de estado + ownership + app_type como subtitle.
 *   - FAB "+" para crear.
 *   - Tap en una fila → push al detalle `/domains/[id]`.
 *   - Polling cada 15s mientras algún dominio esté en estado
 *     `PENDING_PROVISIONING_STATUSES` (certificado/alias/propagación en curso).
 */
export default function DomainsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DomainStatus | undefined>();
  const [ownershipFilter, setOwnershipFilter] = useState<DomainOwnership | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: domains = [], isLoading, refetch } = useQuery({
    queryKey: ['org-domains-list', statusFilter, ownershipFilter, search],
    queryFn: () =>
      OrgDomainsService.list({
        limit: 200,
        ...(search ? { search } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(ownershipFilter ? { ownership: ownershipFilter } : {}),
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

  const filtered = useMemo(() => {
    if (!search) return domains;
    const s = search.toLowerCase();
    return domains.filter(
      (d) =>
        d.hostname.toLowerCase().includes(s) ||
        d.root_domain.toLowerCase().includes(s) ||
        (d.subdomain ?? '').toLowerCase().includes(s),
    );
  }, [domains, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleCreated = (created: Domain) => {
    // Refetch para que aparezca en la lista sin re-fetch manual.
    refetch();
    // Si el router soporta deep link por hostname, navegar al detalle.
    router.push(`/(org-admin)/domains/${created.id}` as never);
  };

  return (
    <View style={styles.root}>
      <FlatList
        data={filtered}
        keyExtractor={(d) => String(d.id)}
        ListHeaderComponent={
          <ListHeader
            stats={stats}
            search={search}
            onSearchChange={setSearch}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            ownershipFilter={ownershipFilter}
            onOwnershipFilterChange={setOwnershipFilter}
            totalCount={domains.length}
            filteredCount={filtered.length}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : search || statusFilter || ownershipFilter ? (
            <EmptyState
              icon="filter"
              title="Sin resultados"
              description="Ajusta los filtros o la búsqueda para ver más dominios."
              actionLabel="Limpiar filtros"
              onAction={() => {
                setSearch('');
                setStatusFilter(undefined);
                setOwnershipFilter(undefined);
              }}
            />
          ) : (
            <EmptyState
              icon="globe"
              title="Sin dominios"
              description="Agrega un dominio personalizado para tu organización."
              actionLabel="Crear dominio"
              onAction={() => setCreateOpen(true)}
            />
          )
        }
        renderItem={({ item }) => (
          <DomainRow
            domain={item}
            onPress={() => router.push(`/(org-admin)/domains/${item.id}` as never)}
          />
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

      <Pressable style={styles.fab} onPress={() => setCreateOpen(true)}>
        <Icon name="plus" size={24} color={colors.background} />
      </Pressable>

      <DomainCreateModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponentes locales
// ─────────────────────────────────────────────────────────────────────────────

interface ListHeaderProps {
  stats?: DomainStats;
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter?: DomainStatus;
  onStatusFilterChange: (v: DomainStatus | undefined) => void;
  ownershipFilter?: DomainOwnership;
  onOwnershipFilterChange: (v: DomainOwnership | undefined) => void;
  totalCount: number;
  filteredCount: number;
}

function ListHeader({
  stats,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  ownershipFilter,
  onOwnershipFilterChange,
  totalCount,
  filteredCount,
}: ListHeaderProps) {
  return (
    <View>
      <View style={styles.statsWrap}>
        <OrgStatsGrid
          stats={[
            { label: 'Total', value: stats?.total ?? 0, icon: 'globe', color: colors.primary },
            { label: 'Activos', value: stats?.active ?? 0, icon: 'check-circle', color: colorScales.green[500] },
            { label: 'Pendientes', value: stats?.pending ?? 0, icon: 'clock', color: colorScales.amber[500] },
            { label: 'Verificados', value: stats?.verified ?? 0, icon: 'shield-check', color: colorScales.blue[500] },
          ]}
        />
      </View>

      <View style={styles.searchWrap}>
        <SearchBar
          value={search}
          onChangeText={onSearchChange}
          placeholder="Buscar por hostname, raíz o subdominio…"
        />
      </View>

      <FilterRow
        label="Estado"
        options={STATUS_FILTERS}
        active={statusFilter}
        onSelect={(v) => onStatusFilterChange(v as DomainStatus | undefined)}
      />

      <FilterRow
        label="Propiedad"
        options={OWNERSHIP_FILTERS}
        active={ownershipFilter}
        onSelect={(v) => onOwnershipFilterChange(v as DomainOwnership | undefined)}
      />

      {(search || statusFilter || ownershipFilter) && totalCount > 0 ? (
        <Text style={styles.filterMeta}>
          {filteredCount} de {totalCount} dominios
        </Text>
      ) : null}
    </View>
  );
}

function FilterRow<T>({
  label,
  options,
  active,
  onSelect,
}: {
  label: string;
  options: Array<{ label: string; value?: T }>;
  active?: T;
  onSelect: (v: T | undefined) => void;
}) {
  return (
    <View style={styles.filterRow}>
      <Text style={styles.filterLabel}>{label}</Text>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={options}
        keyExtractor={(o) => o.label}
        contentContainerStyle={styles.filterList}
        renderItem={({ item }) => {
          const isActive = (item.value ?? '__all__') === (active ?? '__all__');
          return (
            <Pressable
              style={[styles.filterChip, isActive ? styles.filterChipActive : styles.filterChipInactive]}
              onPress={() => onSelect(item.value)}
            >
              <Text style={isActive ? styles.filterTextActive : styles.filterTextInactive}>
                {item.label}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function DomainRow({ domain, onPress }: { domain: Domain; onPress: () => void }) {
  const statusColor = getStatusColor(domain.status);
  const subtitle = `${formatOwnership(domain.ownership)} · ${domain.root_domain}${domain.subdomain ? ` · ${domain.subdomain}` : ''}`;
  const description = domain.store?.name
    ? `Tienda: ${domain.store.name}`
    : 'Dominio de organización';

  return (
    <OrgListItem
      title={domain.hostname}
      subtitle={subtitle}
      description={description}
      leftIcon="globe"
      leftIconColor={statusColor}
      rightBadge={
        domain.is_primary
          ? { label: 'Principal', variant: 'primary' }
          : { label: formatStatus(domain.status), variant: badgeVariantForStatus(domain.status) }
      }
      chevron
      onPress={onPress}
    />
  );
}

function badgeVariantForStatus(status: DomainStatus): 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'muted' {
  if (status === 'ACTIVE') return 'success';
  if (status.startsWith('FAILED') || status === 'EXPIRED' || status === 'DISABLED') return 'error';
  if (status === 'PROPAGATING' || status === 'ISSUING_CERTIFICATE') return 'info';
  if (
    status === 'PENDING' ||
    status === 'VERIFYING' ||
    status === 'PENDING_DNS' ||
    status === 'PENDING_OWNERSHIP' ||
    status === 'PENDING_SSL' ||
    status === 'PENDING_CERTIFICATE' ||
    status === 'PENDING_ALIAS' ||
    status === 'VERIFYING_OWNERSHIP'
  ) {
    return 'warning';
  }
  return 'muted';
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
  statsWrap: { marginBottom: spacing[4] },
  searchWrap: { marginBottom: spacing[3] },
  filterRow: { marginBottom: spacing[3] },
  filterLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[600],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: spacing[2],
    paddingHorizontal: spacing[4],
  },
  filterList: {
    paddingHorizontal: spacing[4],
    gap: spacing[2],
  },
  filterChip: {
    minHeight: 36,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterChipInactive: {
    backgroundColor: colors.background,
    borderColor: colorScales.gray[200],
  },
  filterTextActive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.background,
  },
  filterTextInactive: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
  },
  filterMeta: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    paddingHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[24],
    paddingTop: spacing[2],
  },
  separator: {
    height: spacing[3],
  },
  fab: {
    position: 'absolute',
    bottom: spacing[6],
    right: spacing[6],
    width: 56,
    height: 56,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lg,
  },
});
