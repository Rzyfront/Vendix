import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  Text,
  View,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
  Modal,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { OrgAuditService } from '@/features/org/services/org-audit.service';
import { StatsGrid } from '@/shared/components/stats-card/stats-grid';
import { OrgResponsiveCard, type OrgCardAction } from '@/shared/components/org-responsive-card';
import { OrgCenteredModal } from '@/shared/components/org-centered-modal';
import { EmptyState } from '@/shared/components/empty-state/empty-state';
import { Icon } from '@/shared/components/icon/icon';
import { SearchBar } from '@/shared/components/search-bar/search-bar';
import {
  OptionsDropdown,
  type FilterConfig,
  type FilterValues,
} from '@/shared/components/options-dropdown';
import {
  AuditLogDetailModal,
  PaginationBar,
} from '@/features/org/components/audit-shared';
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_RESOURCE_OPTIONS,
  formatAction,
  formatResource,
  formatUser,
  getActionBadgeVariant,
  getActionColor,
  getActionIcon,
  getResourceIcon,
} from '@/features/org/components/audit-formatters';
import type {
  AuditLogAction,
  AuditLog,
  AuditLogResource,
  AuditQueryParams,
  AuditStats,
} from '@/core/models/org-admin/audit.types';
import { borderRadius, colorScales, colors, spacing, typography, interFonts } from '@/shared/theme';
import { formatDateTimeUTC } from '@/shared/utils/date';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';

/**
 * Auditoría · Registros de auditoría (paridad visual con web).
 *
 * Layout mobile (espejo de `logs.component.html`):
 *   ┌──────────────────────────────────────────┐ ← Stats grid scroll horiz.
 *   ├──────────────────────────────────────────┤
 *   │ ┌──────────────────────────────────────┐ │
 *   │ │ Registros de auditoría (N)           │ │ ← tableCard
 *   │ │ [🔍 search] [+] [⚙ filter]          │ │
 *   │ ├──────────────────────────────────────┤ │
 *   │ │ [OrgResponsiveCard × N]              │ │
 *   │ └──────────────────────────────────────┘ │
 *   └──────────────────────────────────────────┘
 *
 * Paridad con el patrón aplicado a users/stores/domains:
 *   - `tableCard` + `tableHeader` (1:1 con el `<app-card>` web)
 *   - Search bar + 3 icon-only triggers (40x40, primary border, primary icon)
 *   - Filters → popover anclado al trigger (`<OptionsDropdown showActions={false}>`)
 *   - Actions → modal centrado (`<OrgCenteredModal>`)
 */

const PAGE_SIZE = 10;
const SCREEN_WIDTH = Dimensions.get('window').width;

// Empty-string sentinels ('') en lugar de null para que `FilterValues` (que
// permite string | string[] | null) pueda representar "Todos" sin ambigüedad.
const DEFAULT_FILTERS = {
  resource: '' as AuditLogResource | '',
  action: '' as AuditLogAction | '',
  from: '' as string | '',
  to: '' as string | '',
};
type LocalFilters = typeof DEFAULT_FILTERS;

function auditStatsItems(stats: AuditStats | null | undefined) {
  const combined = stats?.logs_by_action_and_resource ?? {};
  const byAction = stats?.logs_by_action ?? {};
  const byResource = stats?.logs_by_resource ?? {};
  const sum = (rec: Record<string, number>, keys: string[]) =>
    keys.reduce((acc, k) => acc + (rec[k] || 0), 0);
  const sumCombined = (resources: string[]) =>
    resources.reduce(
      (acc, r) =>
        acc +
        (combined[`CREATE_${r}`] ?? 0) +
        (combined[`UPDATE_${r}`] ?? 0) +
        (combined[`DELETE_${r}`] ?? 0) +
        (combined[`PERMISSION_CHANGE_${r}`] ?? 0),
      0,
    );
  const authAction =
    sum(byAction, [
      'LOGIN',
      'LOGOUT',
      'LOGIN_FAILED',
      'ACCOUNT_LOCKED',
      'ACCOUNT_UNLOCKED',
      'SUSPICIOUS_ACTIVITY',
      'PASSWORD_RESET',
      'PASSWORD_CHANGE',
    ]) || sum(byResource, ['auth']);
  return [
    {
      label: 'Eventos',
      value: stats?.total_logs ?? 0,
      icon: 'history',
      iconColor: colorScales.blue[600],
      iconBg: colorScales.blue[600] + '15',
      description: 'registros de auditoría',
    },
    {
      label: 'Seguridad',
      value: authAction,
      icon: 'shield-check',
      iconColor: colorScales.red[600],
      iconBg: colorScales.red[600] + '15',
      description: 'sesiones y alertas',
    },
    {
      label: 'Usuarios',
      value:
        sumCombined(['users', 'roles', 'permissions']) ||
        sum(byResource, ['users', 'roles', 'permissions']),
      icon: 'users',
      iconColor: colorScales.green[600],
      iconBg: colorScales.green[600] + '15',
      description: 'usuarios, roles y permisos',
    },
    {
      label: 'Configuración',
      value:
        sumCombined(['settings', 'domain_settings', 'organizations', 'stores']) ||
        sum(byResource, ['settings', 'domain_settings', 'organizations', 'stores']),
      icon: 'settings',
      iconColor: colorScales.blue[700],
      iconBg: colorScales.blue[700] + '15',
      description: 'ajustes críticos',
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// ListHeader — espejo del patrón users/stores/domains
// (tableCard + tableHeader + título + search + 2 icon-only triggers)
// ─────────────────────────────────────────────────────────────────────────────

interface ListHeaderProps {
  stats: AuditStats | null | undefined;
  count: number;
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
}: ListHeaderProps) {
  return (
    <View>
      {/* Stats — espejo del bloque `stats-container` web */}
      <View style={styles.statsWrap}>
        <StatsGrid items={auditStatsItems(stats)} />
      </View>

      {/* ── Table card header (paridad 1:1 con users/stores/domains) ─── */}
      <View style={styles.tableHeader}>
        <View style={styles.tableTitleRow}>
          <Text style={styles.tableTitle}>
            Registros de auditoría{' '}
            <Text style={styles.tableTitleCount}>({count})</Text>
          </Text>
        </View>

        {/* Search + 2 icon-only triggers en UNA sola línea.
            Espejo del `<app-options-dropdown>` web mobile responsive
            (max-width: 1023px): cada trigger es 40x40, primary border,
            primary icon. */}
        <View style={styles.searchRow}>
          <View style={{ flex: 1 }}>
            <SearchBar
              value={search}
              onChangeText={onSearchChange}
              placeholder="Buscar registros..."
              style={styles.searchInput}
            />
          </View>
          {/* Actions trigger (+ button) — abre modal con Actualizar/Exportar */}
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
              al trigger (NO modal/sheet centrado) — paridad 1:1 con la web. */}
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

export default function AuditLogsScreen() {
  const queryClient = useQueryClient();

  const [filters, setFilters] = useState<LocalFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const [actionsModalOpen, setActionsModalOpen] = useState(false);

  // ───── Queries ───────────────────────────────────────────────────────────
  const queryParams: AuditQueryParams = useMemo(
    () => ({
      offset: (page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(filters.resource ? { resource: filters.resource as AuditLogResource } : {}),
      ...(filters.action ? { action: filters.action as AuditLogAction } : {}),
      ...(filters.from ? { from_date: filters.from } : {}),
      ...(filters.to ? { to_date: filters.to } : {}),
    }),
    [page, search, filters],
  );

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-audit-logs', queryParams],
    queryFn: () => OrgAuditService.listLogs(queryParams as any),
  });

  const { data: stats } = useQuery({
    queryKey: ['org-audit-logs-stats'],
    queryFn: () => OrgAuditService.getStats(),
    staleTime: 60_000,
  });

  const logs = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = data?.meta?.totalPages ?? Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hasFilters =
    !!search || !!filters.resource || !!filters.action || !!filters.from || !!filters.to;
  const activeFilterCount = !!(filters.resource || filters.action || filters.from || filters.to);

  // ───── Filter configs (espejo del `filterConfigs` web) ─────────────────
  const filterConfigs = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'resource',
        label: 'Recurso',
        type: 'select',
        options: [
          { value: '', label: 'Todos los recursos' },
          ...AUDIT_RESOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
        ],
      },
      {
        key: 'action',
        label: 'Acción',
        type: 'select',
        options: [
          { value: '', label: 'Todas las acciones' },
          ...AUDIT_ACTION_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
        ],
      },
      {
        key: 'from',
        label: 'Desde',
        type: 'date',
        helpText: 'Fecha inicial del evento',
      },
      {
        key: 'to',
        label: 'Hasta',
        type: 'date',
        helpText: 'Fecha final del evento',
      },
    ],
    [],
  );

  // Mapea LocalFilters → FilterValues para el OptionsDropdown.
  // Empty string `''` se transforma a `null` para que el popover sepa que
  // el filtro está "sin valor" (y pueda mostrar el check del primer option).
  const filterValues = useMemo<FilterValues>(
    () => ({
      resource: filters.resource || null,
      action: filters.action || null,
      from: filters.from || null,
      to: filters.to || null,
    }),
    [filters],
  );

  const handleFilterChange = useCallback((values: FilterValues) => {
    setFilters({
      resource: ((values.resource as AuditLogResource | null) ?? '') as AuditLogResource | '',
      action: ((values.action as AuditLogAction | null) ?? '') as AuditLogAction | '',
      from: (values.from as string | null) ?? '',
      to: (values.to as string | null) ?? '',
    });
    setPage(1);
  }, []);

  const handleClearAllFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }, []);

  // ───── Export CSV mutation ────────────────────────────────────────────────
  const exportMutation = useMutation({
    mutationFn: () => {
      const params: Record<string, string | undefined> = {
        resource: filters.resource || undefined,
        action: filters.action || undefined,
        from_date: filters.from || undefined,
        to_date: filters.to || undefined,
      };
      return OrgAuditService.exportLogsCsv(params);
    },
    onSuccess: async ({ filename, csv }) => {
      try {
        const fileUri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, csv, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        const available = await Sharing.isAvailableAsync();
        if (available) {
          await Sharing.shareAsync(fileUri, {
            mimeType: 'text/csv',
            dialogTitle: 'Exportar logs de auditoría',
            UTI: 'public.comma-separated-values-text',
          });
          toastSuccess('CSV listo para compartir');
        } else {
          toastSuccess(`${filename} generado (${(csv.length / 1024).toFixed(1)} KB)`);
        }
      } catch (err: any) {
        const msg =
          err?.message ||
          'El archivo CSV se generó pero no se pudo abrir el diálogo de compartir.';
        toastError(`${msg} (el archivo quedó guardado en caché).`);
      }
    },
    onError: () => toastError('No se pudo exportar el CSV'),
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ['org-audit-logs-stats'] }),
    ]);
    setRefreshing(false);
  };

  const handleSearchChange = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const handleClearAll = () => {
    handleClearAllFilters();
    setSearch('');
  };

  return (
    <View style={styles.root}>
      <FlatList<AuditLog>
        data={logs}
        keyExtractor={(l) => String(l.id)}
        ListHeaderComponent={
          <ListHeader
            stats={stats}
            count={total}
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
              title="No hay registros con estos filtros"
              description="Limpia los filtros o actualiza la lista para revisar nuevos eventos."
              actionLabel="Limpiar filtros"
              onAction={handleClearAll}
            />
          ) : (
            <EmptyState
              icon="history"
              title="No hay registros de auditoría"
              description="Los eventos aparecerán aquí cuando se registren cambios auditables."
              actionLabel="Actualizar"
              onAction={onRefresh}
            />
          )
        }
        renderItem={({ item }) => {
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
              title={formatAction(item.action)}
              subtitle={`${formatResource(item.resource)}${
                item.resource_id ? ` · #${item.resource_id}` : ''
              }`}
              leftIcon={getActionIcon(item.action)}
              leftIconColor={getActionColor(item.action)}
              badge={{
                label: formatAction(item.action),
                variant: getActionBadgeVariant(item.action),
              }}
              details={[
                { label: 'Usuario', value: formatUser(item), icon: 'user' },
                { label: 'Fecha', value: formatDateTimeUTC(item.created_at), icon: 'calendar' },
                { label: 'IP', value: item.ip_address ?? '—', icon: 'globe', monospace: true },
              ]}
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

      <AuditLogDetailModal
        visible={!!selected}
        log={selected}
        formatAction={formatAction}
        formatResource={formatResource}
        getActionIcon={getActionIcon}
        getActionColor={getActionColor}
        formatUser={formatUser}
        onClose={() => setSelected(null)}
      />

      {/* ── Actions Modal — espejo del patrón users/stores/domains ── */}
      <OrgCenteredModal
        visible={actionsModalOpen}
        onClose={() => setActionsModalOpen(false)}
        title="Acciones"
        subtitle="¿Qué quieres hacer con la lista de registros?"
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

          <Pressable
            style={styles.actionsModalOption}
            onPress={() => {
              setActionsModalOpen(false);
              exportMutation.mutate();
            }}
            disabled={exportMutation.isPending}
          >
            <View style={[styles.actionsModalIconWrap, { backgroundColor: colors.primary + '15' }]}>
              <Icon name="download" size={16} color={colors.primary} />
            </View>
            <View style={styles.actionsModalTextWrap}>
              <Text style={styles.actionsModalOptionTitle}>
                {exportMutation.isPending ? 'Exportando…' : 'Exportar CSV'}
              </Text>
              <Text style={styles.actionsModalOptionHint}>
                Descargar todos los registros visibles en formato CSV
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

  // ── Stats wrap (mismo patrón users/stores/domains) ─────────────
  statsWrap: {
    marginHorizontal: -spacing[4],
    marginBottom: spacing[3],
  },

  // ── Table card header (paridad 1:1 con users/stores/domains) ───
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
  // Espejo del `.options-dropdown-trigger` web mobile responsive (40x40,
  // primary border, primary icon, 12px radius).
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
});