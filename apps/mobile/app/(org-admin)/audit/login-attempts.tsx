import { useCallback, useMemo, useState } from 'react';
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
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { OrgResponsiveCard, type OrgCardAction } from '@/shared/components/org-responsive-card';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { PaginationBar } from '@/features/org/components/audit-shared';
import { Icon } from '@/shared/components/icon/icon';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import {
  OptionsDropdown,
  type FilterConfig,
  type FilterValues,
} from '@/shared/components/options-dropdown';
import {
  getLoginAttemptStatusColor,
  getLoginAttemptStatusIcon,
  LOGIN_ATTEMPT_STATUS_LABELS,
} from '@/features/org/components/audit-formatters';
import type { LoginAttempt, LoginAttemptsStats } from '@/core/models/org-admin/audit.types';
import { borderRadius, colorScales, colors, spacing, typography, interFonts } from '@/shared/theme';

/**
 * Auditoría · Intentos de Login (paridad visual con web).
 *
 * Layout mobile (espejo del `login-attempts.component.ts` web):
 *   ┌──────────────────────────────────────────┐ ← Stats grid scroll horiz.
 *   ├──────────────────────────────────────────┤
 *   │ ┌──────────────────────────────────────┐ │
 *   │ │ Intentos de inicio (N)              │ │ ← tableCard
 *   │ │ [🔍 email search] [+] [⚙ Estado ▾]  │ │
 *   │ ├──────────────────────────────────────┤ │
 *   │ │ [OrgResponsiveCard × N]              │ │
 *   │ └──────────────────────────────────────┘ │
 *   └──────────────────────────────────────────┘
 *
 * Paridad con el patrón aplicado a users/stores/domains/logs/sessions:
 *   - `tableCard` + `tableHeader` (1:1 con el `<app-card>` web)
 *   - Search bar (email) + 2 icon-only triggers (actions + filters)
 *   - Filters → popover anclado al trigger (`<OptionsDropdown showActions={false}>`)
 *   - Actions → modal centrado (`<OrgCenteredModal>`)
 *
 * En la web el email search vive como input standalone en el header
 * (NO dentro del dropdown). Eso lo respetamos acá.
 */

const PAGE_SIZE = 10;
type SuccessFilter = 'all' | 'success' | 'failed';
const SUCCESS_OPTIONS: { value: SuccessFilter; label: string }[] = [
  { value: 'all', label: 'Todos los intentos' },
  { value: 'success', label: 'Sólo exitosos' },
  { value: 'failed', label: 'Sólo fallidos' },
];

// ─────────────────────────────────────────────────────────────────────────────
// ListHeader — espejo del patrón users/stores/domains/logs/sessions
// ─────────────────────────────────────────────────────────────────────────────

interface ListHeaderProps {
  count: number;
  stats: LoginAttemptsStats | null | undefined;
  search: string;
  onSearchChange: (v: string) => void;
  onActionsPress: () => void;
  filterConfigs: FilterConfig[];
  filterValues: FilterValues;
  onFilterChange: (values: FilterValues) => void;
  onClearAllFilters: () => void;
  activeFilterCount: boolean;
}

function ListHeader({
  count,
  stats,
  search,
  onSearchChange,
  onActionsPress,
  filterConfigs,
  filterValues,
  onFilterChange,
  onClearAllFilters,
  activeFilterCount,
}: ListHeaderProps) {
  return (
    <View>
      {/* Stats — espejo del bloque `stats-container` web */}
      <View style={styles.statsWrap}>
        <StatsGrid
          items={[
            {
              label: 'Total Intentos',
              value: stats?.total_attempts ?? count,
              icon: 'log-in',
              iconColor: colorScales.blue[600],
              iconBg: colorScales.blue[600] + '15',
              description: 'intentos de login',
            },
            {
              label: 'Exitosos',
              value: stats?.successful_attempts ?? 0,
              icon: 'check-circle',
              iconColor: colorScales.green[600],
              iconBg: colorScales.green[600] + '15',
              description: 'inicios exitosos',
            },
            {
              label: 'Fallidos',
              value: stats?.failed_attempts ?? 0,
              icon: 'x-circle',
              iconColor: colorScales.red[600],
              iconBg: colorScales.red[600] + '15',
              description: 'intentos fallidos',
            },
            {
              label: 'Tasa de éxito',
              value: `${Math.round(stats?.success_rate ?? 0)}%`,
              icon: 'trending-up',
              iconColor: colorScales.blue[700],
              iconBg: colorScales.blue[700] + '15',
              description: '% exitosos',
            },
          ]}
        />
      </View>

      {/* ── Table card header (paridad 1:1 con users/stores/domains/logs/sessions) */}
      <View style={styles.tableHeader}>
        <View style={styles.tableTitleRow}>
          <Text style={styles.tableTitle}>
            Intentos de inicio{' '}
            <Text style={styles.tableTitleCount}>({count})</Text>
          </Text>
        </View>

        {/* Search bar (email) + 2 icon-only triggers en UNA sola línea.
            Espejo del `<app-options-dropdown>` web mobile responsive. */}
        <View style={styles.searchRow}>
          <View style={{ flex: 1 }}>
            <SearchBar
              value={search}
              onChangeText={onSearchChange}
              placeholder="Buscar por email..."
              style={styles.searchInput}
            />
          </View>
          {/* Actions trigger (+ button) — abre modal con Actualizar */}
          <Pressable
            style={({ pressed }) => [styles.optionsTrigger, pressed && { opacity: 0.85 }]}
            onPress={onActionsPress}
            accessibilityLabel="Abrir acciones"
          >
            <Icon name="plus" size={18} color={colors.primary} />
          </Pressable>
          {/* Filters trigger (espejo del `<app-options-dropdown>` web mobile).
              Popover anclado al trigger (NO modal/sheet centrado). */}
          <OptionsDropdown
            showActions={false}
            filters={filterConfigs}
            filterValues={filterValues}
            onFilterChange={onFilterChange}
            onClearAllFilters={onClearAllFilters}
          />
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LoginAttemptsScreen() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SuccessFilter>('all');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<LoginAttempt | null>(null);
  const [actionsModalOpen, setActionsModalOpen] = useState(false);

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
  const activeFilterCount = filter !== 'all';

  // ───── Filter configs (espejo del form web) ──────────────────────
  const filterConfigs = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status',
        label: 'Estado',
        type: 'select',
        options: SUCCESS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
      },
    ],
    [],
  );

  const filterValues = useMemo<FilterValues>(
    () => ({
      status: filter || null,
    }),
    [filter],
  );

  const handleFilterChange = useCallback((values: FilterValues) => {
    const next = (values.status as SuccessFilter | null) ?? 'all';
    setFilter(next);
    setPage(1);
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setFilter('all');
    setPage(1);
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetch()]);
    setRefreshing(false);
  };

  const handleSearchChange = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const handleClearAll = () => {
    handleClearAllFilters();
    setSearch('');
    setPage(1);
  };

  return (
    <View style={styles.root}>
      <FlatList<LoginAttempt>
        data={attempts}
        keyExtractor={(a) => String(a.id)}
        ListHeaderComponent={
          <ListHeader
            count={total}
            stats={stats}
            search={search}
            onSearchChange={handleSearchChange}
            onActionsPress={() => setActionsModalOpen(true)}
            filterConfigs={filterConfigs}
            filterValues={filterValues}
            onFilterChange={handleFilterChange}
            onClearAllFilters={handleClearAllFilters}
            activeFilterCount={activeFilterCount}
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
              onAction={handleClearAll}
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
                { label: 'IP', value: item.ip_address ?? '—', icon: 'globe', monospace: true },
                {
                  label: 'Fecha',
                  value: new Date(
                    item.created_at ?? (item as any).attempted_at ?? new Date().toISOString(),
                  ).toLocaleString(),
                  icon: 'calendar',
                },
                { label: 'User agent', value: item.user_agent ?? '—', icon: 'monitor' },
                { label: 'Tienda', value: item.stores?.name ?? '—', icon: 'store' },
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

      {/* Detail modal — centrado (espejo de app-modal web) */}
      <OrgCenteredModal
        visible={!!selected}
        onClose={() => setSelected(null)}
        title="Detalle de intento"
        subtitle={selected?.email}
        size="md"
        footer={
          <View style={styles.modalActions}>
            <Pressable
              style={[styles.modalBtn, styles.modalBtnSecondary]}
              onPress={() => setSelected(null)}
            >
              <Text style={styles.modalBtnSecondaryText}>Cerrar</Text>
            </Pressable>
          </View>
        }
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
      </OrgCenteredModal>

      {/* ── Actions Modal — espejo del patrón users/stores/domains/logs/sessions */}
      <OrgCenteredModal
        visible={actionsModalOpen}
        onClose={() => setActionsModalOpen(false)}
        title="Acciones"
        subtitle="¿Qué quieres hacer con la lista de intentos?"
        size="sm"
      >
        <View style={styles.actionsModalList}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colorScales.gray[50],
    paddingHorizontal: spacing[4],
  },
  loading: { paddingVertical: spacing[12], alignItems: 'center' },
  separator: { height: spacing[3] },
  listContent: {
    paddingTop: spacing[2],
    paddingBottom: spacing[24],
  },

  // ── Stats wrap (mismo patrón users/stores/domains/logs/sessions)
  statsWrap: {
    marginHorizontal: -spacing[4],
    marginBottom: spacing[3],
  },

  // ── Table card header (paridad 1:1 con users/stores/domains/logs/sessions)
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
  tableTitle: {
    fontSize: typography.fontSize.lg,
    fontFamily: interFonts.semibold,
    color: colorScales.gray[900],
    flexShrink: 1,
  },
  tableTitleCount: {
    fontFamily: interFonts.regular,
    color: colorScales.gray[400],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  searchInput: {
    width: '100%',
    height: 40,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
  },
  // Espejo del `.options-dropdown-trigger` web mobile responsive.
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

  // ── Actions Modal (espejo del `<app-options-dropdown>` web) ────
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

  // ── Detail modal styles ─────────────────────────────────────
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
  modalActions: {
    flexDirection: 'row',
    gap: spacing[2],
    justifyContent: 'flex-end',
  },
  modalBtn: {
    height: 40,
    paddingHorizontal: spacing[4],
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnSecondary: { backgroundColor: colorScales.gray[100] },
  modalBtnSecondaryText: { color: colorScales.gray[700], fontWeight: typography.fontWeight.semibold },
});