import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  Text,
  View,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { OrgAuditService } from '@/features/org/services/org-audit.service';
import { OrgStatsGrid } from '@/shared/components/org-stats-grid';
import {
  OrgResponsiveCard,
  type OrgCardAction,
} from '@/shared/components/org-responsive-card';
import {
  OrgOptionsDropdown,
  type OrgOptionsAction,
} from '@/shared/components/org-options-dropdown';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Modal } from '@/shared/components/modal/modal';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { PaginationBar } from '@/features/org/components/audit-shared';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { Icon } from '@/shared/components/icon/icon';
import {
  getLoginAttemptStatusColor,
  getLoginAttemptStatusIcon,
  LOGIN_ATTEMPT_STATUS_LABELS,
} from '@/features/org/components/audit-formatters';
import type { LoginAttempt, LoginAttemptsStats } from '@/core/models/org-admin/audit.types';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';

/**
 * Auditoría · Intentos de Login (paridad visual con web).
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │ [stats grid scroll horiz.]               │ ← sticky-top
 *   ├──────────────────────────────────────────┤
 *   │ Intentos de inicio       [Acciones▾]     │
 *   │ 142 registros            [Filtros 0▾]    │
 *   │ [🔎 SearchBar ───────────────────]       │
 *   ├──────────────────────────────────────────┤
 *   │ [OrgResponsiveCard × N]                  │
 *   │  - avatar + email + badge status         │
 *   │  - details grid                          │
 *   │  - footer: 👁 Ver                        │
 *   ├──────────────────────────────────────────┤
 *   │ [PaginationBar]                          │
 *   └──────────────────────────────────────────┘
 */

const PAGE_SIZE = 10;
type SuccessFilter = 'all' | 'success' | 'failed';

export default function LoginAttemptsScreen() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SuccessFilter>('all');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<LoginAttempt | null>(null);

  const queryParams = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(search ? { email: search } : {}),
      ...(filter === 'success' ? { success: true } : {}),
      ...(filter === 'failed' ? { success: false } : {}),
    }),
    [page, search, filter],
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-audit-login-attempts', queryParams],
    queryFn: () => OrgAuditService.listLoginAttempts(queryParams),
  });

  const { data: stats } = useQuery({
    queryKey: ['org-audit-login-attempts-stats'],
    queryFn: () => OrgAuditService.getLoginAttemptsStats(),
    staleTime: 60_000,
  });

  const attempts = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = data?.meta?.totalPages ?? Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!search || filter !== 'all';
  const activeFiltersCount = (search ? 1 : 0) + (filter !== 'all' ? 1 : 0);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const actions: OrgOptionsAction[] = [
    {
      key: 'refresh',
      label: 'Actualizar',
      icon: 'refresh-cw',
      onPress: onRefresh,
    },
  ];

  return (
    <View style={styles.root}>
      <FlatList<LoginAttempt>
        data={attempts}
        keyExtractor={(a) => String(a.id)}
        ListHeaderComponent={
          <ListHeader
            stats={stats ?? null}
            total={total}
            search={search}
            onSearchChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            filter={filter}
            onFilterChange={(f) => {
              setFilter(f);
              setPage(1);
            }}
            actions={actions}
            activeFiltersCount={activeFiltersCount}
            onRefresh={onRefresh}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : hasFilters ? (
            <EmptyState
              icon="filter"
              title="Sin intentos con este filtro"
              description="Ajusta la búsqueda o cambia el filtro para revisar más eventos."
              actionLabel="Limpiar filtros"
              onAction={() => {
                setSearch('');
                setFilter('all');
                setPage(1);
              }}
            />
          ) : (
            <EmptyState
              icon="log-in"
              title="Sin intentos de inicio de sesión"
              description="Los intentos aparecerán aquí cuando alguien intente acceder."
            />
          )
        }
        renderItem={({ item }) => {
          const status = item.status ?? (item.success ? 'SUCCESS' : 'FAILED');
          const cardActions: OrgCardAction[] = [
            {
              key: 'view',
              label: 'Ver detalle',
              icon: 'eye',
              variant: 'primary',
              showInFooter: true,
              onPress: () => setSelected(item),
            },
          ];
          return (
            <OrgResponsiveCard
              title={item.email}
              subtitle={[
                item.stores?.name ? `Tienda: ${item.stores.name}` : null,
                item.ip_address ?? null,
              ]
                .filter(Boolean)
                .join(' · ')}
              leftIcon={getLoginAttemptStatusIcon(status)}
              leftIconColor={getLoginAttemptStatusColor(status)}
              badge={{
                label: LOGIN_ATTEMPT_STATUS_LABELS[status] ?? status,
                variant:
                  status === 'SUCCESS'
                    ? 'success'
                    : status === 'FAILED'
                      ? 'error'
                      : 'warning',
              }}
              details={[
                {
                  label: 'IP',
                  value: item.ip_address ?? '—',
                  icon: 'globe',
                  monospace: true,
                },
                {
                  label: 'Fecha',
                  value: new Date(
                    item.created_at ?? (item as any).attempted_at ?? new Date().toISOString(),
                  ).toLocaleString(),
                  icon: 'calendar',
                },
                {
                  label: 'User agent',
                  value: item.user_agent ?? '—',
                  icon: 'monitor',
                },
                {
                  label: 'Tienda',
                  value: item.stores?.name ?? '—',
                  icon: 'store',
                },
              ]}
              footerLabel="Motivo"
              footerValue={item.failure_reason ?? '—'}
              actions={cardActions}
              onPress={() => setSelected(item)}
              chevron={false}
            />
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListFooterComponent={
          <PaginationBar
            page={page}
            totalPages={totalPages}
            total={total}
            onChange={(p) => setPage(p)}
          />
        }
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

      <Modal
        visible={!!selected}
        onClose={() => setSelected(null)}
        title="Detalle de intento"
      >
        {selected ? (
          <View>
            <View style={styles.detailHero}>
              <View
                style={[
                  styles.detailHeroIcon,
                  {
                    backgroundColor:
                      getLoginAttemptStatusColor(
                        selected.status ?? (selected.success ? 'SUCCESS' : 'FAILED'),
                      ) + '15',
                  },
                ]}
              >
                <Icon
                  name={getLoginAttemptStatusIcon(
                    selected.status ?? (selected.success ? 'SUCCESS' : 'FAILED'),
                  )}
                  size={22}
                  color={getLoginAttemptStatusColor(
                    selected.status ?? (selected.success ? 'SUCCESS' : 'FAILED'),
                  )}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailHeroTitle}>{selected.email}</Text>
                <Text style={styles.detailHeroSub}>
                  {LOGIN_ATTEMPT_STATUS_LABELS[selected.status] ??
                    (selected.success ? 'Exitoso' : 'Fallido')}
                </Text>
              </View>
            </View>

            <View style={styles.card}>
              <OrgDetailRow
                icon="calendar"
                label="Fecha"
                value={new Date(
                  selected.created_at ?? (selected as any).attempted_at ?? new Date().toISOString(),
                ).toLocaleString()}
              />
              <OrgDetailRow
                icon="globe"
                label="IP"
                value={selected.ip_address ?? 'N/A'}
                monospace
              />
              <OrgDetailRow
                icon="monitor"
                label="User agent"
                value={selected.user_agent ?? 'N/A'}
              />
              {selected.stores?.name ? (
                <OrgDetailRow icon="store" label="Tienda" value={selected.stores.name} />
              ) : null}
              {selected.failure_reason ? (
                <OrgDetailRow
                  icon="alert-triangle"
                  label="Motivo de fallo"
                  value={selected.failure_reason}
                />
              ) : null}
            </View>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

interface ListHeaderProps {
  stats: LoginAttemptsStats | null;
  total: number;
  search: string;
  onSearchChange: (v: string) => void;
  filter: SuccessFilter;
  onFilterChange: (f: SuccessFilter) => void;
  actions: OrgOptionsAction[];
  activeFiltersCount: number;
  onRefresh: () => void;
}

function ListHeader({
  stats,
  total,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  actions,
  activeFiltersCount,
  onRefresh,
}: ListHeaderProps) {
  return (
    <View>
      <View style={styles.statsWrap}>
        <OrgStatsGrid
          stats={[
            {
              label: 'Total Intentos',
              value: stats?.total_attempts ?? total,
              icon: 'log-in',
              color: colorScales.blue[600],
              subText: 'intentos de login',
            },
            {
              label: 'Exitosos',
              value: stats?.successful_attempts ?? 0,
              icon: 'check-circle',
              color: colorScales.green[600],
              subText: 'inicios exitosos',
            },
            {
              label: 'Fallidos',
              value: stats?.failed_attempts ?? 0,
              icon: 'x-circle',
              color: colorScales.red[600],
              subText: 'intentos fallidos',
            },
            {
              label: 'Tasa de éxito',
              value: `${Math.round(stats?.success_rate ?? 0)}%`,
              icon: 'trending-up',
              color: colorScales.blue[700],
              subText: '% exitosos',
            },
          ]}
        />
      </View>

      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.titleMain}>Intentos de inicio de sesión</Text>
          <Text style={styles.titleCount}>
            {total} {total === 1 ? 'registro' : 'registros'}
          </Text>
        </View>
        <OrgOptionsDropdown
          actions={actions}
          activeFiltersCount={activeFiltersCount}
          renderFiltersContent={() => (
            <View>
              <FilterSection
                label="Todos"
                value="Mostrar todos los intentos"
                active={filter === 'all'}
                onPress={() => onFilterChange('all')}
              />
              <FilterSection
                label="Exitosos"
                value="Sólo intentos con success=true"
                active={filter === 'success'}
                icon="check-circle"
                iconColor={colorScales.green[600]}
                onPress={() => onFilterChange('success')}
              />
              <FilterSection
                label="Fallidos"
                value="Sólo intentos con success=false"
                active={filter === 'failed'}
                icon="x-circle"
                iconColor={colorScales.red[600]}
                onPress={() => onFilterChange('failed')}
              />
            </View>
          )}
        />
      </View>

      <View style={styles.searchRow}>
        <SearchBar
          value={search}
          onChangeText={onSearchChange}
          placeholder="Buscar por email…"
        />
      </View>
    </View>
  );
}

function FilterSection({
  label,
  value,
  active,
  icon,
  iconColor,
  onPress,
}: {
  label: string;
  value: string;
  active: boolean;
  icon?: string;
  iconColor?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.filterSection, active && styles.filterSectionActive]}
      onPress={onPress}
    >
      {icon ? (
        <View
          style={[
            styles.filterIcon,
            { backgroundColor: (iconColor ?? colorScales.gray[500]) + '15' },
          ]}
        >
          <Icon name={icon} size={14} color={iconColor ?? colorScales.gray[500]} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text style={styles.filterLabel}>{label}</Text>
        <Text style={styles.filterValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
      {active ? (
        <Icon name="check" size={16} color={colorScales.green[600]} />
      ) : (
        <Icon name="chevron-right" size={16} color={colorScales.gray[400]} />
      )}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colorScales.gray[50] },
  loading: { paddingVertical: spacing[12], alignItems: 'center' },
  statsWrap: {
    marginHorizontal: -spacing[4],
    marginBottom: spacing[3],
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[1],
    marginBottom: spacing[3],
  },
  titleMain: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  titleCount: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  searchRow: {
    marginBottom: spacing[3],
  },
  separator: { height: spacing[1] },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[24],
  },
  detailHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  detailHeroIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHeroTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  detailHeroSub: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  card: {
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    paddingHorizontal: spacing[3],
  },
  filterSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  filterSectionActive: {
    backgroundColor: colorScales.green[50],
  },
  filterIcon: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterLabel: {
    fontSize: 10,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  filterValue: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
    marginTop: 2,
    fontWeight: typography.fontWeight.medium,
  },
});
