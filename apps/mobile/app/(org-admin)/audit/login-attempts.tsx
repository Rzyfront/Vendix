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
import { OrgListItem } from '@/shared/components/org-list-item';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Modal } from '@/shared/components/modal/modal';
import { OrgDetailRow } from '@/shared/components/org-detail-row';
import { PaginationBar } from '@/features/org/components/audit-shared';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import { RowActionsMenu } from '@/shared/components/row-actions-menu/row-actions-menu';
import { Icon } from '@/shared/components/icon/icon';
import {
  getLoginAttemptStatusColor,
  getLoginAttemptStatusIcon,
  LOGIN_ATTEMPT_STATUS_LABELS,
} from '@/features/org/components/audit-formatters';
import type { LoginAttempt, LoginAttemptsStats } from '@/core/models/org-admin/audit.types';
import { borderRadius, colorScales, colors, spacing, typography } from '@/shared/theme';

/**
 * Auditoría · Intentos de Login.
 *
 * Paridad con `login-attempts.component.ts` (web):
 *   - 4-stat grid (Total / Exitosos / Fallidos / Tasa éxito %)
 *   - Búsqueda por email (debounced por SearchBar)
 *   - Filtro de status (Todos / Exitosos / Fallidos)
 *   - Cards con badge de estado (SUCCESS=success / FAILED=error),
 *     email, IP, fecha, tienda
 *   - Paginación manual
 *   - Modal de detalle (no en web — agregado para paridad funcional)
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

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

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
            onRefresh={onRefresh}
          />
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : search || filter !== 'all' ? (
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
          return (
            <OrgListItem
              title={item.email}
              subtitle={[
                item.stores?.name ? `Tienda: ${item.stores.name}` : null,
                item.ip_address ?? null,
              ]
                .filter(Boolean)
                .join(' · ')}
              description={item.failure_reason ?? `User agent: ${item.user_agent ?? 'N/A'}`}
              leftIcon={getLoginAttemptStatusIcon(status)}
              leftIconColor={getLoginAttemptStatusColor(status)}
              rightBadge={{
                label: LOGIN_ATTEMPT_STATUS_LABELS[status] ?? status,
                variant:
                  status === 'SUCCESS'
                    ? 'success'
                    : status === 'FAILED'
                      ? 'error'
                      : 'warning',
              }}
              rightMeta={new Date(
                item.created_at ?? (item as any).attempted_at ?? new Date().toISOString(),
              ).toLocaleString()}
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
                      getLoginAttemptStatusColor(selected.status ?? (selected.success ? 'SUCCESS' : 'FAILED')) +
                      '15',
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
              <OrgDetailRow icon="globe" label="IP" value={selected.ip_address ?? 'N/A'} monospace />
              <OrgDetailRow icon="monitor" label="User agent" value={selected.user_agent ?? 'N/A'} />
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
  onRefresh: () => void;
}

function ListHeader({
  stats,
  total,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  onRefresh,
}: ListHeaderProps) {
  return (
    <View>
      <View style={styles.statsWrap}>
        <OrgStatsGrid
          columns={2}
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
          <Text style={styles.titleCount}>{total} {total === 1 ? 'registro' : 'registros'}</Text>
        </View>
        <RowActionsMenu
          actions={[
            {
              key: 'refresh',
              label: 'Actualizar',
              icon: 'refresh-cw',
              variant: 'default',
              onPress: onRefresh,
            },
          ]}
          accessibilityLabel="Acciones de intentos"
        />
      </View>

      <View style={styles.searchRow}>
        <View style={{ flex: 1 }}>
          <SearchBar
            value={search}
            onChangeText={onSearchChange}
            placeholder="Buscar por email…"
          />
        </View>
      </View>

      <View style={styles.quickFilters}>
        <Pressable
          style={[styles.quickBtn, filter === 'all' && styles.quickBtnActive]}
          onPress={() => onFilterChange('all')}
        >
          <Text style={[styles.quickBtnText, filter === 'all' && styles.quickBtnTextActive]}>
            Todos
          </Text>
        </Pressable>
        <Pressable
          style={[styles.quickBtn, filter === 'success' && styles.quickBtnActive]}
          onPress={() => onFilterChange('success')}
        >
          <Icon name="check-circle" size={14} color={filter === 'success' ? '#FFFFFF' : colorScales.green[600]} />
          <Text style={[styles.quickBtnText, filter === 'success' && styles.quickBtnTextActive]}>
            Exitosos
          </Text>
        </Pressable>
        <Pressable
          style={[styles.quickBtn, filter === 'failed' && styles.quickBtnActive]}
          onPress={() => onFilterChange('failed')}
        >
          <Icon name="x-circle" size={14} color={filter === 'failed' ? '#FFFFFF' : colorScales.red[600]} />
          <Text style={[styles.quickBtnText, filter === 'failed' && styles.quickBtnTextActive]}>
            Fallidos
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colorScales.gray[50] },
  loading: { paddingVertical: spacing[12], alignItems: 'center' },
  statsWrap: { marginBottom: spacing[3] },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  quickFilters: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  quickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  quickBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickBtnText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[700],
    fontWeight: typography.fontWeight.medium,
  },
  quickBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: typography.fontWeight.semibold,
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[24],
  },
  separator: { height: spacing[1] },
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
});
