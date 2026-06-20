import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  Text,
  TextInput,
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
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { PaginationBar } from '@/features/org/components/audit-shared';
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
 * Layout mobile (espejo de logs.component.html):
 *   ┌──────────────────────────────────────────┐ ← sticky top-0 z-20
 *   │ [stats grid scroll horiz.]               │
 *   ├──────────────────────────────────────────┤ ← sticky top-[99px] z-10
 *   │ Intentos de inicio       [Acciones▾]     │
 *   │ 142 registros            [Filtros 1▾]    │
 *   ├──────────────────────────────────────────┤
 *   │ [OrgResponsiveCard × N]                  │ ← scroll
 *   ├──────────────────────────────────────────┤
 *   │ [PaginationBar]                          │
 *   └──────────────────────────────────────────┘
 *
 * El SearchBar (email) ahora vive dentro del OptionsDropdown → Filtros
 * (no como barra standalone), igual que en la web.
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
    await Promise.all([
      refetch(),
      // stats query not invalidated on purpose (kept fresh in 60s window)
    ]);
    setRefreshing(false);
  };

  const clearFilters = () => {
    setSearch('');
    setFilter('all');
    setPage(1);
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
      {/* Sticky top: stats grid (web: `stats-container sticky top-0 z-20`) */}
      <View style={styles.stickyStats}>
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

      {/* Sticky below: title row + options dropdown (web: `sticky top-[99px] z-10`) */}
      <View style={styles.stickyTitleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.titleMain}>
            Intentos de inicio{' '}
            <Text style={styles.titleCount}>({total})</Text>
          </Text>
        </View>
        <OrgOptionsDropdown
          actions={actions}
          activeFiltersCount={activeFiltersCount}
          renderFiltersContent={() => (
            <View>
              {/* Email search dentro del OptionsDropdown (web: filterConfigs.email) */}
              <View style={styles.filterSearchWrap}>
                <Icon name="search" size={14} color={colorScales.gray[500]} />
                <TextInput
                  style={styles.filterSearchInput}
                  value={search}
                  onChangeText={(v) => {
                    setSearch(v);
                    setPage(1);
                  }}
                  placeholder="Buscar por email…"
                  placeholderTextColor={colorScales.gray[400]}
                  autoCorrect={false}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  returnKeyType="search"
                />
                {search ? (
                  <Pressable onPress={() => setSearch('')} hitSlop={8}>
                    <Icon name="x" size={14} color={colorScales.gray[500]} />
                  </Pressable>
                ) : null}
              </View>

              <FilterSection
                label="Todos"
                value="Mostrar todos los intentos"
                active={filter === 'all'}
                onPress={() => {
                  setFilter('all');
                  setPage(1);
                }}
              />
              <FilterSection
                label="Exitosos"
                value="Sólo intentos con success=true"
                active={filter === 'success'}
                icon="check-circle"
                iconColor={colorScales.green[600]}
                onPress={() => {
                  setFilter('success');
                  setPage(1);
                }}
              />
              <FilterSection
                label="Fallidos"
                value="Sólo intentos con success=false"
                active={filter === 'failed'}
                icon="x-circle"
                iconColor={colorScales.red[600]}
                onPress={() => {
                  setFilter('failed');
                  setPage(1);
                }}
              />

              {hasFilters ? (
                <Pressable onPress={clearFilters} style={styles.clearAllRow}>
                  <Icon name="x" size={14} color={colors.error} />
                  <Text style={styles.clearAllText}>Limpiar todos los filtros</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        />
      </View>

      {/* Scrollable list */}
      <FlatList<LoginAttempt>
        data={attempts}
        keyExtractor={(a) => String(a.id)}
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
              onAction={clearFilters}
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
        style={styles.flatList}
      />

      {/* Detail modal — centered (espejo de app-modal web) */}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colorScales.gray[50] },
  loading: { paddingVertical: spacing[12], alignItems: 'center' },
  stickyStats: {
    backgroundColor: colorScales.gray[50],
    paddingBottom: spacing[2],
  },
  stickyTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  titleMain: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  titleCount: {
    fontWeight: typography.fontWeight.normal,
    color: colorScales.gray[500],
  },
  flatList: { flex: 1 },
  separator: { height: spacing[3] },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[24],
  },
  filterSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colorScales.gray[100],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    height: 38,
    marginHorizontal: spacing[2],
    marginTop: spacing[2],
    marginBottom: spacing[1],
  },
  filterSearchInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
    paddingVertical: 0,
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
  clearAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
  },
  clearAllText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.error,
  },
});
